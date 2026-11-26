// Accounts: Google sign-in, registration (16+), profile and profile picture, deleting the account, and calls to the
// user API.
//
// The server decides everything that matters (age, nick uniqueness, rate limits, moderation): this module only
// asks. Everything a user typed is put on the page with textContent, never as HTML.

import {
  onAuthStateChanged, getIdToken, getIdTokenResult, reauthenticateWithPopup, GoogleAuthProvider, browserPopupRedirectResolver,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { auth, db, appCheckHeaders, signInWithGoogle, signOut } from "./firebase.js?v=202611260345";
import { apiUrl, avatarUrl, photoPrefix } from "./config.js?v=202611241021";
import { el, initials, huDate } from "./common.js?v=202611260345";
import { cdnReady, cdnUrl } from "./cdn.js?v=202611260345";
import { profileHref } from "./links.js?v=202611241021";

export const account = {
  user: null, registered: false, a18: false, profile: null, private: null, ready: false,
  blocked: {},           // uid -> nick: users whose comments and chat messages this user does not see
  points: null,          // the game points (users/{uid}.points), shown on the header's avatar
  flagged: new Set(),    // comment ids this user flagged
};
const listeners = new Set();
const blockListeners = new Set();
const pointListeners = new Set();
// Called whenever the user's points change (the header avatar's corner badge).
export function onPoints(fn) {
  pointListeners.add(fn);
  if (account.points != null) fn(account.points);
  return () => pointListeners.delete(fn);
}

// Called whenever the blocked users or the flagged comments change (another tab included).
export function onBlocks(fn) {
  blockListeners.add(fn);
  return () => blockListeners.delete(fn);
}
export const isBlocked = (uid) => Boolean(uid && account.blocked[uid]);

let stopPrivate = null;
function watchPrivate(uid) {  // users/{uid}: readable by its owner only (rules)
  if (stopPrivate) { stopPrivate(); stopPrivate = null; }
  account.blocked = {};
  account.flagged = new Set();
  account.points = null;
  if (!uid) { blockListeners.forEach((fn) => fn(account)); return; }
  stopPrivate = onSnapshot(doc(db, "users", uid), (snap) => {
    const d = snap.data() || {};
    account.blocked = d.blocked && typeof d.blocked === "object" ? d.blocked : {};
    account.flagged = new Set(Array.isArray(d.flagged) ? d.flagged : []);
    blockListeners.forEach((fn) => { try { fn(account); } catch (e) { console.warn(e); } });
    const points = Number(d.points || 0);
    if (points !== account.points) {
      account.points = points;
      pointListeners.forEach((fn) => { try { fn(points); } catch (e) { console.warn(e); } });
    }
  }, (e) => console.warn("account data:", e));
}

export function onAccount(fn) {
  listeners.add(fn);
  if (account.ready) fn(account);
  return () => listeners.delete(fn);
}
function emit() {
  account.ready = true;
  listeners.forEach((fn) => { try { fn(account); } catch (e) { console.warn(e); } });
}

export class ApiError extends Error {
  constructor(code, message, data = {}) { super(message); this.code = code; this.data = data; }
}

async function authHeaders(force = false) {
  const user = auth.currentUser;
  if (!user) throw new ApiError("signin", "Jelentkezz be.");
  return { ...(await appCheckHeaders()), Authorization: `Bearer ${await getIdToken(user, force)}` };
}

async function readReply(r) {
  let data = {};
  try { data = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) throw new ApiError(data.error || "server", data.message || "Hiba történt, próbáld újra.", { ...data, status: r.status });
  return data;
}

export async function api(path, body = {}) {
  const r = await fetch(apiUrl + path, {
    method: "POST", headers: { ...(await authHeaders()), "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return readReply(r);
}

export function safePhoto(url) {  // only the picture addresses our server writes
  return typeof url === "string" && url.startsWith(photoPrefix) ? url : null;
}

// Signed in but not registered: ask to sign in or to finish the registration first. Returns true if ready.
export function needAccount() {
  if (account.registered) return true;
  if (!account.user) signIn();
  else openRegister({});
  return false;
}

export async function signIn() {
  try { await signInWithGoogle(); }
  catch (e) { if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") toast(`Nem sikerült belépni (${e.code || e.message}).`); }
}

async function load(user) {
  const me = await api("/me");
  if (me.refresh) await getIdToken(user, true);  // new age claims: the rules (comments, chat) read them
  Object.assign(account, { registered: Boolean(me.registered), a18: Boolean(me.a18), profile: me.profile || null,
    private: me.registered ? { email: me.email, birthdate: me.birthdate } : null });
  return me;
}

onAuthStateChanged(auth, async (user) => {
  Object.assign(account, { user, registered: false, a18: false, profile: null, private: null });
  if (!user) { watchPrivate(null); emit(); return; }
  try {
    const me = await load(user);
    watchPrivate(me.registered ? user.uid : null);
    emit();
    if (!me.registered) openRegister(me.suggest || {});
  } catch (e) {
    console.warn("account:", e);
    toast(e.message || "A fiók most nem érhető el.");
    emit();
  }
});

// ------------------------------------------------------------------ small UI helpers
export function toast(text) {
  let box = document.getElementById("toasts");
  if (!box) { box = el("div", "toasts"); box.id = "toasts"; box.setAttribute("role", "status"); document.body.append(box); }
  const t = el("div", "toast", text);
  box.append(t);
  setTimeout(() => t.remove(), 6000);
}

export function dialog(title, body, actions, { onClose } = {}) {
  const d = el("dialog", "dlg");
  const form = el("form", "dlg-form");
  form.method = "dialog";
  const head = el("h2", "dlg-title", title);
  const err = el("p", "dlg-error");
  err.setAttribute("role", "alert");
  err.hidden = true;
  const bar = el("div", "dlg-actions");
  for (const a of actions) {
    const b = el("button", a.primary ? "btn" : "btn ghost", a.label);
    if (a.danger) b.classList.add("danger");
    b.type = a.submit ? "submit" : "button";
    b.value = a.value || "";
    if (a.onClick) b.addEventListener("click", (e) => { e.preventDefault(); a.onClick(e); });
    bar.append(b);
  }
  form.append(head, ...body, err, bar);
  d.append(form);
  d.addEventListener("close", () => { d.remove(); onClose && onClose(); });
  document.body.append(d);
  d.showModal();
  return {
    el: d, form,
    close: () => d.close(),
    error: (msg) => { err.textContent = msg || ""; err.hidden = !msg; },
    busy: (on) => bar.querySelectorAll("button").forEach((b) => { b.disabled = on; }),
  };
}

function field(label, input, hint) {
  const wrap = el("label", "fld");
  wrap.append(el("span", "fld-label", label), input);
  if (hint) wrap.append(el("span", "fld-hint", hint));
  return wrap;
}

function input(type, attrs = {}) {
  const i = el("input", "field");
  i.type = type;
  for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
  return i;
}

const isoDay = (d) => d.toISOString().slice(0, 10);

// ------------------------------------------------------------------ registration (16+)
let registering = null;
export function openRegister(suggest) {
  if (registering || account.registered || !account.user) return;
  const today = new Date();
  const name = input("text", { maxlength: "150", autocomplete: "name", required: "" });
  name.value = (suggest.name || account.user.displayName || "").slice(0, 150);
  const nick = input("text", { maxlength: "40", autocomplete: "nickname", required: "", pattern: "[0-9A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű_.\\-]{3,40}" });
  const born = input("date", { required: "", max: isoDay(today), min: "1900-01-01" });
  const ok = input("checkbox", { required: "" });
  const consent = el("label", "fld check");
  consent.append(ok, el("span", null, "Elmúltam 16 éves. Hozzájárulok, hogy a vitaradar.hu tárolja a nevemet, a becenevemet, " +
    "az e-mail címemet és a születési dátumomat. Az e-mail címemet és a születési dátumomat senki más nem látja."));
  const dlg = dialog("Regisztráció", [
    el("p", "dlg-text", "A szavazáshoz és a hozzászóláshoz hozd létre a profilodat. A chat 18 év felettieknek szól."),
    field("Teljes név", name), field("Becenév", nick, "3–40 karakter: betű, szám, pont, kötőjel, aláhúzás. Ezt látják mások."),
    field("Születési dátum", born, "Legalább 16 évesnek kell lenned."), consent,
  ], [
    { label: "Mégse", value: "cancel", onClick: () => dlg.close() },
    { label: "Regisztrálok", primary: true, submit: true },
  ], { onClose: () => { registering = null; } });
  registering = dlg;
  dlg.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!dlg.form.reportValidity()) return;
    dlg.busy(true);
    dlg.error("");
    try {
      const r = await api("/register", { name: name.value, nick: nick.value, birthdate: born.value });
      await getIdToken(account.user, true);
      Object.assign(account, { registered: true, a18: Boolean(r.a18), profile: r.profile });
      await load(account.user);
      watchPrivate(account.user.uid);
      emit();
      dlg.close();
      toast(`Üdv, ${r.profile.nick}!`);
    } catch (err) {
      dlg.error(err.message);
      if (err.code === "underage") setTimeout(() => { dlg.close(); signOut(); }, 4000);
    } finally {
      dlg.busy(false);
    }
  });
}

// ------------------------------------------------------------------ profile and picture
export function avatar(url, name, size = 32) {
  const box = el("span", "avatar");
  box.style.setProperty("--size", `${size}px`);
  const src = safePhoto(url);
  if (src) {
    const img = el("img");
    img.alt = "";
    img.loading = "lazy";
    img.onerror = () => { img.remove(); box.textContent = initials(name); };
    cdnReady().then(() => { img.src = cdnUrl(src); });  // from cdn.vitaradar.hu once its cookie is set
    box.append(img);
  } else {
    box.textContent = initials(name);
  }
  return box;
}

const MAX_PHOTO = 2 * 1024 * 1024;
const PHOTO_ERRORS = {  // the picture service answers with English codes only
  400: "Ezt a képet nem lehet feltölteni.", 401: "Frissítsd az oldalt, és próbáld újra.",
  403: "Előbb fejezd be a regisztrációt.", 413: "A kép túl nagy: legfeljebb 2 MB és 30 megapixel lehet.",
  415: "Csak JPEG, PNG vagy WEBP kép tölthető fel.", 422: "Ezt a képet nem lehet feltölteni.",
  429: "Naponta legfeljebb 10 képet tölthetsz fel.",
};

// What others may see on a profile: each section its owner can hide (the API's /privacy; the server keeps a hidden
// one from everyone else). [key, label, hint]
export const PRIVACY = [
  ["stats", "Pontok és statisztikák", "pontok, megnyert és elvesztett játékok, kapott like-ok és dislike-ok"],
  ["games", "Játékelőzmények", "a megválaszolt kihívások, beszédtippek és szavazási tippek"],
  ["comments", "Hozzászólások listája", "a tényellenőrzések alatt a hozzászólásaid ettől még látszanak"],
  ["name", "Teljes név a beceneved mellett", ""],
];

// The privacy switches of the profile editor: ticked = others see it. Each change is saved at once.
function privacyBox() {
  const box = el("fieldset", "fld prof-privacy");
  box.append(el("legend", "fld-label", "Mások ezt látják a profilodon"));
  const boxes = {};
  const hidden = new Set(account.profile?.hide || []);
  for (const [key, label, hint] of PRIVACY) {
    const cb = input("checkbox", { name: `show-${key}` });
    cb.checked = !hidden.has(key);
    boxes[key] = cb;
    const text = el("span", null, label);
    if (hint) text.append(el("span", "fld-hint", hint));
    const row = el("label", "fld check");
    row.append(cb, text);
    box.append(row);
  }
  const msg = el("p", "prof-saved");
  msg.setAttribute("role", "status");
  box.append(el("span", "fld-hint", "Ami nincs bejelölve, azt csak te látod. A változást azonnal mentjük."), msg);
  const show = (hide) => { for (const [k] of PRIVACY) boxes[k].checked = !hide.includes(k); };
  box.addEventListener("change", async (e) => {
    if (e.target.type !== "checkbox") return;
    const hide = PRIVACY.map(([k]) => k).filter((k) => !boxes[k].checked);
    Object.values(boxes).forEach((b) => { b.disabled = true; });
    msg.classList.remove("is-error");
    msg.textContent = "mentés…";
    try {
      const r = await api("/privacy", { hide });
      account.profile = { ...account.profile, hide: r.hide || hide };
      show(account.profile.hide);
      emit();
      msg.textContent = "Elmentve.";
    } catch (err) {
      show(account.profile?.hide || []);
      msg.classList.add("is-error");
      msg.textContent = err.message;
    } finally {
      Object.values(boxes).forEach((b) => { b.disabled = false; });
    }
  });
  return box;
}

// The profile editor of one's own profile page (profile.html): picture, full name and nick; the e-mail address and the
// birth date shown but fixed; who sees what on the profile; the blocked users, each with "feloldás"; sign-out; and,
// apart at the bottom, deleting the account.
// Saving goes through the API (/profile, /privacy and the picture service), which validates everything again.
// Returns {el, destroy}.
export function profileEditor() {
  const p = account.profile || {};
  const pic = el("div", "profile-pic");
  pic.append(avatar(p.photo && p.photo["256"], p.nick, 96));
  const file = input("file", { name: "photo", accept: "image/jpeg,image/png,image/webp" });
  const name = input("text", { name: "name", maxlength: "150", autocomplete: "name", required: "" });
  name.value = p.name || "";
  const nick = input("text", { name: "nick", maxlength: "40", autocomplete: "off", required: "" });
  nick.value = p.nick || "";
  const locked = (key, auto, value) => {  // private and fixed: shown, never sent back
    const i = input("text", { name: key, autocomplete: auto, disabled: "", readonly: "" });
    i.value = value || "–";
    return i;
  };
  const email = field("E-mail · csak te látod", locked("email", "email", account.private?.email), "Nem módosítható.");
  const born = field("Születési dátum · csak te látod", locked("birthdate", "bday", huDate(account.private?.birthdate)), "Nem módosítható.");
  const blockedBox = el("div", "fld");
  const drawBlocked = () => {
    const list = el("ul", "blocked-list");
    for (const [uid, bnick] of Object.entries(account.blocked).sort((a, b) => String(a[1]).localeCompare(String(b[1]), "hu"))) {
      const li = el("li", null);
      const b = el("button", "link-btn", "feloldás");
      b.type = "button";
      b.addEventListener("click", async () => {
        b.disabled = true;
        try { await api("/block", { uid, block: false }); } catch (e) { toast(e.message); b.disabled = false; }
      });
      li.append(el("span", null, bnick), b);
      list.append(li);
    }
    if (!list.children.length) list.append(el("li", "muted", "senki"));
    blockedBox.replaceChildren(el("span", "fld-label", "Letiltott felhasználók"), list);
  };
  drawBlocked();
  const stopBlocks = onBlocks(drawBlocked);
  const form = el("form", "prof-form");
  const err = el("p", "dlg-error");
  err.setAttribute("role", "alert");
  err.hidden = true;
  const saved = el("p", "prof-saved");
  saved.setAttribute("role", "status");
  const bar = el("div", "dlg-actions");
  const out = el("button", "btn ghost", "Kilépés");
  out.type = "button";
  out.addEventListener("click", () => signOut());
  const save = el("button", "btn", "Mentés");
  save.type = "submit";
  bar.append(out, save);
  const remove = el("button", "btn danger small", "Fiók törlése");
  remove.type = "button";
  remove.addEventListener("click", () => deleteAccount());
  const removeBox = el("div", "fld prof-delete");
  removeBox.append(el("span", "fld-label", "Fiók törlése"),
    el("span", "fld-hint", "A fiókodat és minden adatodat véglegesen töröljük. Előtte még megkérdezzük."), remove);
  form.append(pic, field("Profilkép", file, "JPEG, PNG vagy WEBP, legfeljebb 2 MB."),
    field("Teljes név", name), field("Becenév", nick, "3–40 karakter: betű, szám, pont, kötőjel, aláhúzás. Ezt látják mások."),
    email, born, privacyBox(), blockedBox, err, saved, bar, removeBox);
  const dlg = {  // the same calls as a dialog's, so the flows below stay as they were
    form,
    error: (msg) => { err.textContent = msg || ""; err.hidden = !msg; if (msg) saved.textContent = ""; },
    busy: (on) => bar.querySelectorAll("button").forEach((b) => { b.disabled = on; }),
  };
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (!f) return;
    if (f.size > MAX_PHOTO) { dlg.error("A kép legfeljebb 2 MB lehet."); file.value = ""; return; }
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) { dlg.error("Csak JPEG, PNG vagy WEBP kép tölthető fel."); file.value = ""; return; }
    dlg.busy(true);
    dlg.error("");
    pic.replaceChildren(el("span", "muted", "feltöltés…"));
    try {
      const r = await fetch(avatarUrl, { method: "POST", headers: { ...(await authHeaders()), "Content-Type": f.type }, body: f });
      const data = await readReply(r);
      account.profile = { ...account.profile, photo: data.photo };
      pic.replaceChildren(avatar(data.photo["256"], account.profile.nick, 96));
      emit();
    } catch (err) {
      pic.replaceChildren(avatar(p.photo && p.photo["256"], p.nick, 96));
      dlg.error(PHOTO_ERRORS[err.data?.status] || err.message);
    } finally {
      dlg.busy(false);
      file.value = "";
    }
  });
  dlg.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!dlg.form.reportValidity()) return;
    dlg.busy(true);
    dlg.error("");
    try {
      const r = await api("/profile", { name: name.value, nick: nick.value });
      account.profile = { ...account.profile, ...r.profile };
      name.value = account.profile.name || "";
      nick.value = account.profile.nick || "";
      emit();
      saved.textContent = "Elmentve.";
    } catch (err) {
      dlg.error(err.message);
    } finally {
      dlg.busy(false);
    }
  });
  return { el: form, destroy: stopBlocks };
}

// ------------------------------------------------------------------ deleting the account
// Everything goes, server side (the API's /account/delete), which wants the typed word and a sign-in from the last 10
// minutes. So the dialog asks for both: Google's sign-in window again when the last sign-in is over 5 minutes old.
const DELETE_WORD = "TÖRLÉS";
const RECENT_SIGNIN_MS = 5 * 60 * 1000;
const fold = (s) => String(s || "").trim().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const DELETED = [
  "a profilodat: a nevedet, a becenevedet, a profilképedet, az e-mail címedet és a születési dátumodat",
  "a hozzászólásaidat (ha valaki válaszolt rájuk, a helyükön egy üres helyőrző marad)",
  "a szavazataidat (a számlálókból is levonjuk őket)",
  "a játékokban adott válaszaidat és tippjeidet, a pontjaidat",
  "a jelentéseidet, a letiltásaidat, a chatüzeneteidet és az elutasított hozzászólásaidat",
  "a belépésedet a vitaradar.hu-ra (a Google-fiókod megmarad)",
];
const REAUTH_ERRORS = {
  "auth/popup-closed-by-user": "A belépés megszakadt. A törléshez lépj be újra.",
  "auth/cancelled-popup-request": "A belépés megszakadt. A törléshez lépj be újra.",
  "auth/popup-blocked": "A böngésző nem engedte megnyitni a belépés ablakát. Engedélyezd, és próbáld újra.",
  "auth/user-mismatch": "Azzal a Google-fiókkal lépj be, amelyikkel regisztráltál.",
};

async function signedInLately(user) {
  try { return Date.now() - new Date((await getIdTokenResult(user)).authTime).getTime() < RECENT_SIGNIN_MS; }
  catch { return false; }
}

// Asks first (what goes, the typed word, a new sign-in if needed), then deletes everything and signs out.
export async function deleteAccount() {
  const user = account.user;
  if (!user) return;
  let fresh = await signedInLately(user);
  const word = input("text", { name: "confirm", autocomplete: "off", autocapitalize: "characters", spellcheck: "false" });
  const list = el("ul", "dlg-list");
  for (const t of DELETED) list.append(el("li", null, t));
  const again = el("p", "dlg-text", "Biztonsági okból a törlés előtt még egyszer be kell lépned a Google-fiókoddal.");
  again.hidden = fresh;
  const dlg = dialog("Fiók törlése", [
    el("p", "dlg-text", "A fiókoddal együtt minden adatodat véglegesen töröljük:"), list,
    el("p", "dlg-text", "Ez nem vonható vissza. Később újra regisztrálhatsz, de üres profillal."),
    again, field(`A megerősítéshez írd be: ${DELETE_WORD}`, word),
  ], [
    { label: "Mégse", onClick: () => dlg.close() },
    { label: "Végleges törlés", primary: true, danger: true, submit: true },
  ]);
  const go = dlg.form.querySelector('button[type="submit"]');
  const typed = () => fold(word.value) === fold(DELETE_WORD);
  const ready = () => { go.disabled = !typed(); };
  word.addEventListener("input", ready);
  ready();
  word.focus();
  dlg.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (!typed()) return;
    dlg.busy(true);
    dlg.error("");
    try {
      if (!fresh) {  // first, straight from the click: browsers open the sign-in window only then
        const provider = new GoogleAuthProvider();
        if (user.email) provider.setCustomParameters({ login_hint: user.email });
        await reauthenticateWithPopup(user, provider, browserPopupRedirectResolver);
        fresh = true;
        again.hidden = true;
      }
      await getIdToken(user, true);
      for (let call = 1; ; call++) {  // a long history may take more than one call; each goes on where the last stopped
        const r = await api("/account/delete", { confirm: word.value });
        if (r.deleted) break;
        if (!r.more || call >= 20) throw new ApiError("server", "Nem sikerült mindent törölni, próbáld újra.");
      }
      dlg.close();
      try { await signOut(); } catch { /* the account is gone already */ }
      toast("A fiókodat és minden adatodat töröltük.");
    } catch (err) {
      if (err.code === "recent_signin") { fresh = false; again.hidden = false; }
      const code = String(err.code || "");
      dlg.error(REAUTH_ERRORS[code] || (code.startsWith("auth/") ? `Nem sikerült belépni (${code}).` : err.message));
      dlg.busy(false);
      ready();
    }
  });
}

// Blocks a user after asking: their comments and chat messages disappear for this user.
export function blockUser(uid, nick) {
  if (!needAccount() || !uid || uid === account.user?.uid) return;
  const dlg = dialog(`${nick || "Felhasználó"} letiltása`, [
    el("p", "dlg-text", "Nem látod többé a hozzászólásait és a chatüzeneteit. A profilodban bármikor feloldhatod."),
  ], [
    { label: "Mégse", onClick: () => dlg.close() },
    { label: "Letiltás", primary: true, onClick: async () => {
      dlg.busy(true);
      try { await api("/block", { uid, block: true }); dlg.close(); } catch (e) { dlg.error(e.message); dlg.busy(false); }
    } },
  ]);
}

// ------------------------------------------------------------------ the header's account button
const ACCT_KEY = "vr-acct";  // "out", "reg" or "in": read by the inline script in each page's head

export function mountAccount() {
  const row = document.querySelector(".site-header .header-row");
  if (!row) return;
  // The page has the box already, with a placeholder the size of the last known state (html[data-acct], set in the
  // page's head from localStorage), so nothing in the header moves when the real button arrives.
  let box = row.querySelector(":scope > .acct");
  if (!box) { box = el("div", "acct"); row.append(box); }
  let stopPoints = null;
  onAccount((a) => {
    if (stopPoints) { stopPoints(); stopPoints = null; }
    const known = !a.user ? "out" : a.registered ? "in" : "reg";
    document.documentElement.dataset.acct = known;
    try {  // a visitor needs nothing stored: "out" is the head script's default
      if (known === "out") localStorage.removeItem(ACCT_KEY); else localStorage.setItem(ACCT_KEY, known);
    } catch { /* no storage: the placeholder stays the visitor's */ }
    box.replaceChildren();
    // The phone menu shows more of each state (css: hidden in the header): a door for newcomers next to "Belépés"
    // (the same sign-in; the nickname is asked for after it), why the registration waits, the nick and the points.
    if (!a.user) {
      const b = el("button", "btn acct-btn", "Belépés");
      b.type = "button";
      b.addEventListener("click", signIn);
      const n = el("button", "btn acct-btn acct-new", "Regisztráció");
      n.type = "button";
      n.addEventListener("click", signIn);
      box.append(b, n);
    } else if (!a.registered) {
      const b = el("button", "btn acct-btn acct-reg", "Regisztráció");
      b.append(el("span", "acct-more", " befejezése"));  // phones show only the first word (css)
      b.type = "button";
      b.title = "Regisztráció befejezése";
      b.addEventListener("click", () => openRegister({}));
      box.append(el("span", "acct-hint", "Már csak a beceneved hiányzik."), b);
    } else {
      const b = el("a", "acct-me");  // to one's own profile page, where it can be edited
      b.href = profileHref(null);
      const pts = el("span", "acct-points");
      pts.hidden = true;
      const sub = el("span", "acct-sub", "profil");
      const text = el("span", "acct-text");
      text.append(el("b", "acct-nick", a.profile?.nick || "Profil"), sub);
      b.append(avatar(a.profile?.photo && a.profile.photo["64"], a.profile?.nick, 32), pts, text);
      const label = (p) => {
        b.title = p == null ? "Profil" : `Profil · ${p.toLocaleString("hu-HU")} pont`;
        b.setAttribute("aria-label", b.title);
      };
      label(null);
      box.append(b);
      stopPoints = onPoints((p) => {  // the corner badge: just the number, bumped when it grows
        const before = pts.hidden ? null : Number(pts.dataset.points);
        pts.dataset.points = String(p);
        pts.textContent = p.toLocaleString("hu-HU");
        pts.hidden = false;
        sub.textContent = `${p.toLocaleString("hu-HU")} pont · profil`;
        label(p);
        if (before != null && p > before) { pts.classList.remove("bump"); void pts.offsetWidth; pts.classList.add("bump"); }
      });
    }
  });
}
