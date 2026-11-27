// Accounts: Google sign-in, registration (16+), profile and profile picture, deleting the account, and calls to the
// user API.
//
// The server decides everything that matters (age, nick uniqueness, rate limits, moderation): this module only
// asks. Everything a user typed is put on the page with textContent, never as HTML.

import {
  onAuthStateChanged, getIdToken, getIdTokenResult,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  auth, db, appCheckHeaders, signInWithGoogle, signInAgain, readySignIn, signOut, signInLeavesPage, redirectError,
  signInRefused,
} from "./firebase.js?v=202611272000";
import { apiUrl, avatarUrl, photoPrefix } from "./config.js?v=202611241021";
import { el, initials, huDate } from "./common.js?v=202611272000";
import { cdnReady, cdnUrl } from "./cdn.js?v=202611272000";
import { fetchT, withTimeout, sleep } from "./net.js?v=202611270600";
import { profileHref } from "./links.js?v=202611241021";

export const account = {
  user: null, registered: false, a18: false, profile: null, private: null, ready: false,
  failed: false,         // signed in, but the account did not load (/me): pages say so, and do not ask to register
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
  const token = await withTimeout(getIdToken(user, force), 15000, "bejelentkezés").catch((e) => {
    throw new ApiError(e.code === "timeout" ? "timeout" : "signin", "A bejelentkezésedet most nem sikerült ellenőrizni. Próbáld újra.");
  });
  return { ...(await appCheckHeaders()), Authorization: `Bearer ${token}` };
}

// Every call to our API has a limit: a request that gets no answer (a stalled phone connection) fails with this.
const TIMEOUT_TEXT = "A szerver nem válaszolt időben. Próbáld újra.";
async function post(url, options, ms) {
  try { return await fetchT(url, options, ms); }
  catch (e) { throw e.code === "timeout" ? new ApiError("timeout", TIMEOUT_TEXT) : e; }
}

async function readReply(r) {
  let data = {};
  try { data = await r.json(); } catch { /* not JSON */ }
  if (!r.ok) throw new ApiError(data.error || "server", data.message || "Hiba történt, próbáld újra.", { ...data, status: r.status });
  return data;
}

export async function api(path, body = {}) {
  const r = await post(apiUrl + path, {
    method: "POST", headers: { ...(await authHeaders()), "Content-Type": "application/json" }, body: JSON.stringify(body),
  }, 20000);
  return readReply(r);
}

export function safePhoto(url) {  // only the picture addresses our server writes
  return typeof url === "string" && url.startsWith(photoPrefix) ? url : null;
}

// Signed in but not registered: ask to sign in or to finish the registration first. Returns true if ready.
export function needAccount() {
  if (account.registered) return true;
  if (account.failed) { toast("A fiókodat most nem sikerült betölteni. Töltsd újra az oldalt."); return false; }
  if (!account.user) signIn();
  else openRegister({});
  return false;
}

export async function signIn() {
  if (signInRefused) { signInElsewhere(); return; }
  try { await signInWithGoogle(); }
  catch (e) { if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") toast(`Nem sikerült belépni (${e.code || e.message}).`); }
}

// Apps' own browsers (Facebook, Instagram, Messenger…): Google signs no one in there (js/firebase.js), so instead of
// Google's refusal the reader learns how to open the page in the browser, where the sign-in works.
function signInElsewhere() {
  const android = /Android/.test(navigator.userAgent);
  const note = el("p", "dlg-text");
  note.setAttribute("role", "status");
  const dlg = dialog("Belépés a böngészőben", [
    el("p", "dlg-text", "Az appok saját böngészőjéből (Facebook, Instagram, Messenger…) a Google nem enged belépni."),
    el("p", "dlg-text", `Nyisd meg az oldalt ${android ? "a böngésződben" : "a Safariban"}: az app menüjében (${android ? "⋮" : "•••"})`
      + " válaszd a Megnyitás böngészőben (Open in browser) pontot, vagy másold ki a linket. Ott be tudsz lépni."),
    note,
  ], [
    { label: "Link másolása", onClick: (e) => copyLink(e.currentTarget, note, dlg.el) },
    { label: "Rendben", primary: true, onClick: () => dlg.close() },
  ]);
}

// The old way first, inside the tap (apps' browsers often refuse the clipboard API); then the API; else the link shown.
async function copyLink(button, note, box) {
  const url = location.href;
  let ok = false;
  const t = el("textarea");
  t.value = url;
  t.setAttribute("readonly", "");
  t.style.cssText = "position:fixed;opacity:0;pointer-events:none";
  box.append(t);  // in the dialog: the page behind it is inert
  t.select();
  t.setSelectionRange(0, url.length);
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  t.remove();
  button.focus({ preventScroll: true });
  if (!ok) {
    try { await navigator.clipboard.writeText(url); ok = true; } catch { /* shown below to copy by hand */ }
  }
  note.textContent = ok ? "Kimásolva. Illeszd be a böngésző címsorába." : `A link: ${url}`;
}

// the iPhone app signs in by leaving the page (js/firebase.js): a sign-in that failed there is told when it is back
redirectError().then((e) => {
  if (e && e.code !== "auth/redirect-cancelled-by-user") toast(`Nem sikerült belépni (${e.code || e.message}).`);
});

async function load(user) {
  const me = await api("/me");
  if (me.refresh) await getIdToken(user, true);  // new age claims: the rules (comments, chat) read them
  Object.assign(account, { registered: Boolean(me.registered), a18: Boolean(me.a18), profile: me.profile || null,
    private: me.registered ? { email: me.email, birthdate: me.birthdate } : null });
  return me;
}

onAuthStateChanged(auth, async (user) => {
  Object.assign(account, { user, registered: false, a18: false, profile: null, private: null, failed: false });
  if (!user) { watchPrivate(null); emit(); return; }
  try {
    // a second try after a failed first (a dropped request); a refusal (4xx) is not tried again
    const me = await load(user).catch(async (e) => {
      if (e.data?.status >= 400 && e.data?.status < 500 && e.data.status !== 401) throw e;
      await sleep(2000);
      return load(user);
    });
    watchPrivate(me.registered ? user.uid : null);
    emit();
    if (!me.registered) openRegister(me.suggest || {});
  } catch (e) {
    console.warn("account:", e);
    account.failed = true;
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

// The privacy switches of the profile editor: on = others see it. Each change is saved at once.
function privacyBox() {
  const box = el("fieldset", "fld prof-privacy");
  box.append(el("legend", "fld-label", "Mások ezt látják a profilodon"));
  const boxes = {};
  const hidden = new Set(account.profile?.hide || []);
  for (const [key, label, hint] of PRIVACY) {
    const cb = input("checkbox", { name: `show-${key}`, role: "switch" });
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
  box.append(msg);
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

// The profile editor of one's own profile page (profile.html): a sheet that comes up from the bottom on phones, a dialog
// on wider screens (css .prof-sheet). Mégse and Mentés at the top on phones, at the foot on wider screens; Mentés only
// once something changed. The picture is shown first and sent with Mentés; the nick has its count; the e-mail address
// and the birth date are text. Who sees what and the blocked users open inside it, and save at once, as before. At the
// bottom, away from Mentés: sign-out and deleting the account. Saving goes through the API (/profile and the picture
// service), which validates everything again.
const NICK_RE = /^[0-9A-Za-zÁÉÍÓÖŐÚÜŰáéíóöőúüű_.-]{3,40}$/;
const VIEWS = { main: "Profil szerkesztése", privacy: "Ki látja?", blocked: "Letiltott felhasználók" };
let editing = null;  // the open editor, {close}

export function openProfileEditor() {
  if (editing) return editing;
  if (!account.registered) return null;
  const now = () => account.profile || {};
  const d = el("dialog", "dlg prof-sheet");
  d.dataset.view = "main";
  d.autofocus = true;  // the sheet itself takes the focus when it opens: no button lit up on a phone, Tab goes on from it
  d.tabIndex = -1;
  d.setAttribute("aria-labelledby", "sheet-title");
  const form = el("form", "sheet-form");
  form.noValidate = true;  // the checks below speak Hungarian; the server checks again

  // the head: Mégse, the title, Mentés (phones); the title and × (wider screens); ‹ Vissza in the inner views
  const head = el("div", "sheet-head");
  const button = (cls, text, type = "button") => { const b = el("button", cls, text); b.type = type; return b; };
  const cancel = button("sheet-cancel", "Mégse");
  const back = button("sheet-back", "‹ Vissza");
  const title = el("h2", "sheet-title", VIEWS.main);
  title.id = "sheet-title";
  const saveTop = button("btn small sheet-save", "Mentés", "submit");
  const x = button("sheet-x", "×");
  x.setAttribute("aria-label", "Bezárás");
  head.append(el("span", "sheet-grab"), cancel, back, title, saveTop, x);

  // the picture: the chosen one is shown at once and sent with Mentés
  let pending = null, preview = "";
  const file = input("file", { name: "photo", accept: "image/jpeg,image/png,image/webp" });
  file.className = "sheet-file";  // out of sight: the button is its label
  const choose = el("label", "btn ghost small sheet-choose");
  choose.append(el("span", null, "Kép cseréje"), file);
  const picSide = el("div", "sheet-pic-side");
  picSide.append(choose, el("span", "fld-hint", "JPEG, PNG vagy WEBP, legfeljebb 2 MB. A Mentéssel kerül fel."));
  const pic = el("div", "sheet-pic");
  const drawPic = () => {
    const face = avatar(now().photo && now().photo["256"], now().nick, 96);
    if (preview) {
      const img = el("img");
      img.alt = "";
      img.src = preview;
      face.replaceChildren(img);
    }
    pic.replaceChildren(face, picSide);
  };

  // the nick with its count, the name; what only its owner sees, as text
  const nick = input("text", { name: "nick", maxlength: "40", autocomplete: "off", autocapitalize: "off", spellcheck: "false" });
  const name = input("text", { name: "name", maxlength: "150", autocomplete: "name" });
  nick.value = now().nick || "";
  name.value = now().name || "";
  const count = el("span", "sheet-count");
  const nickFoot = el("span", "sheet-fieldfoot");
  nickFoot.append(el("span", "fld-hint", "Betű, szám, pont, kötőjel, aláhúzás. Ezt látják mások."), count);
  const nickField = el("label", "fld");
  nickField.append(el("span", "fld-label", "Becenév"), nick, nickFoot);
  const fact = (label, value) => { const l = el("p", null, `${label}: `); l.append(el("b", null, value || "–")); return l; };
  const mine = el("div", "sheet-mine");
  mine.append(el("span", "fld-label", "Csak te látod"), fact("E-mail", account.private?.email),
    fact("Születési dátum", huDate(account.private?.birthdate)));
  const fields = el("div", "sheet-fields");
  fields.append(nickField, field("Teljes név", name), mine);
  const top = el("div", "sheet-top");
  top.append(pic, fields);
  const err = el("p", "dlg-error");
  err.setAttribute("role", "alert");
  err.hidden = true;
  const error = (msg) => { err.textContent = msg || ""; err.hidden = !msg; };

  // the rows: who sees what and the blocked users inside the editor; sign-out and deleting the account apart
  const row = (label, cls, onClick) => {
    const b = button(`sheet-row${cls ? ` ${cls}` : ""}`, "");
    const v = el("span", "sheet-row-v");
    b.append(el("span", "sheet-row-k", label), v);
    b.addEventListener("click", onClick);
    return { b, v };
  };
  const privRow = row("Ki látja a profilodat?", "", (e) => go("privacy", e));
  const blockRow = row("Letiltott felhasználók", "", (e) => go("blocked", e));
  const outRow = row("Kilépés", "sheet-out", () => { close(); signOut(); });
  const delRow = row("Fiók törlése", "sheet-del", () => { close(); deleteAccount(); });
  const rows = el("div", "sheet-rows");
  rows.append(privRow.b, blockRow.b);
  const leave = el("div", "sheet-rows sheet-leave");
  leave.append(outRow.b, delRow.b);
  const main = el("div", "sheet-view sheet-main");
  main.append(top, err, rows, leave);

  const privacy = el("div", "sheet-view sheet-privacy");
  privacy.append(el("p", "sheet-intro", "Ami ki van kapcsolva, azt csak te látod. A kapcsolók azonnal mentenek."), privacyBox());
  const blocked = el("div", "sheet-view sheet-blocked");
  const drawBlocked = () => {
    const list = el("ul", "blocked-list");
    const all = Object.entries(account.blocked).sort((a, b) => String(a[1]).localeCompare(String(b[1]), "hu"));
    for (const [uid, bnick] of all) {
      const li = el("li", null);
      const b = button("link-btn", "feloldás");
      b.addEventListener("click", async () => {
        b.disabled = true;
        try { await api("/block", { uid, block: false }); } catch (e) { toast(e.message); b.disabled = false; }
      });
      li.append(el("span", null, bnick), b);
      list.append(li);
    }
    if (!all.length) list.append(el("li", "muted", "Senkit nem tiltottál le."));
    blocked.replaceChildren(el("p", "sheet-intro", "Akiket letiltottál: nem látod a hozzászólásaikat és a chatüzeneteiket."), list);
    blockRow.v.textContent = all.length ? String(all.length) : "senki";
  };

  // the foot on wider screens: Mégse and Mentés
  const foot = el("div", "sheet-foot");
  const cancelFoot = button("btn ghost", "Mégse");
  const saveFoot = button("btn", "Mentés", "submit");
  foot.append(cancelFoot, saveFoot);
  const body = el("div", "sheet-body");
  body.append(main, privacy, blocked);
  form.append(head, body, foot);
  d.append(form);

  let busy = false;
  const changed = () => Boolean(pending) || nick.value !== (now().nick || "") || name.value !== (now().name || "");
  const refresh = () => {
    count.textContent = `${[...nick.value].length}/40`;
    nick.readOnly = name.readOnly = busy;
    for (const b of [saveTop, saveFoot]) { b.disabled = busy || !changed(); b.textContent = busy ? "mentés…" : "Mentés"; }
    const hidden = (now().hide || []).length;
    privRow.v.textContent = hidden ? `${hidden} rejtve` : "mindenki";
  };
  const go = (view, e) => {
    d.dataset.view = view;
    title.textContent = VIEWS[view];
    body.scrollTop = 0;
    refresh();
    // from the keyboard the focus goes on to the view's first button (a tap leaves it: a lit-up button there otherwise)
    if (!e || e.detail === 0) (view === "main" ? cancel : back).focus({ preventScroll: true });
  };
  const close = () => { if (d.open) d.close(); };

  drawPic();
  drawBlocked();
  refresh();
  // phones: the sheet keeps to what is visible (css --sheet-top, --sheet-h): with the keyboard up iOS moves the page
  // under it, and its head with Mégse and Mentés went under the status bar
  const vv = window.visualViewport;
  const fit = () => {
    d.style.setProperty("--sheet-top", `${Math.round(vv.offsetTop)}px`);
    d.style.setProperty("--sheet-h", `${Math.round(vv.height)}px`);
  };
  if (vv) { fit(); vv.addEventListener("resize", fit); vv.addEventListener("scroll", fit); }
  const opener = document.activeElement, y0 = scrollY;
  const stopBlocks = onBlocks(drawBlocked);
  const stopAccount = onAccount((a) => { if (!a.registered) close(); else refresh(); });
  form.addEventListener("input", (e) => { if (e.target !== file) { error(""); refresh(); } });
  file.addEventListener("change", () => {
    const f = file.files[0];
    file.value = "";
    if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) { error("Csak JPEG, PNG vagy WEBP kép tölthető fel."); return; }
    if (f.size > MAX_PHOTO) { error("A kép legfeljebb 2 MB lehet."); return; }
    error("");
    if (preview) URL.revokeObjectURL(preview);
    pending = f;
    preview = URL.createObjectURL(f);
    drawPic();
    refresh();
  });
  for (const b of [cancel, cancelFoot, x]) b.addEventListener("click", close);
  back.addEventListener("click", (e) => go("main", e));
  d.addEventListener("cancel", (e) => { if (busy) e.preventDefault(); });  // Escape closes, and the changes go
  d.addEventListener("click", (e) => { if (e.target === d && !busy && !changed()) close(); });  // the page behind: when nothing is lost
  d.addEventListener("close", () => {
    if (preview) URL.revokeObjectURL(preview);
    if (vv) { vv.removeEventListener("resize", fit); vv.removeEventListener("scroll", fit); }
    stopBlocks();
    stopAccount();
    d.remove();
    editing = null;
    // the page as it was: where it was scrolled (the keyboard moved it), and no other button lit up when the one that
    // opened the sheet was drawn anew meanwhile (a save redraws the profile's head)
    if (Math.abs(scrollY - y0) > 1) scrollTo({ top: y0 });
    if (!opener?.isConnected && document.activeElement !== document.body) document.activeElement?.blur?.();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy || !changed()) return;
    const n = nick.value.trim(), nm = name.value.trim();
    if (!NICK_RE.test(n)) { error("A becenév 3–40 karakter lehet: betű, szám, pont, kötőjel, aláhúzás."); nick.focus(); return; }
    if (!nm) { error("Add meg a teljes nevedet."); name.focus(); return; }
    busy = true;
    error("");
    refresh();
    try {
      if (pending) {
        let data;
        try {
          const r = await post(avatarUrl, { method: "POST", headers: { ...(await authHeaders()), "Content-Type": pending.type }, body: pending }, 60000);
          data = await readReply(r);
        } catch (err) {
          throw new ApiError(err.code || "photo", PHOTO_ERRORS[err.data?.status] || err.message);
        }
        account.profile = { ...account.profile, photo: data.photo };
        pending = null;
        URL.revokeObjectURL(preview);
        preview = "";
        emit();
      }
      if (n !== (now().nick || "") || nm !== (now().name || "")) {
        const r = await api("/profile", { name: nm, nick: n });
        account.profile = { ...account.profile, ...r.profile };
        emit();
      }
      close();
      toast("Elmentve.");
    } catch (err) {
      error(err.message);
    } finally {
      busy = false;
      if (d.open) { drawPic(); refresh(); }
    }
  });

  document.body.append(d);
  d.showModal();
  d.focus({ preventScroll: true });  // the sheet itself: a dialog's autofocus is not honoured everywhere (Chrome focused Mégse)
  editing = { close };
  return editing;
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
  if (!fresh) readySignIn();  // the sign-in helper in while the word is typed: Google's window opens on the tap
  const word = input("text", { name: "confirm", autocomplete: "off", autocapitalize: "characters", spellcheck: "false" });
  const list = el("ul", "dlg-list");
  for (const t of DELETED) list.append(el("li", null, t));
  const again = el("p", "dlg-text", "Biztonsági okból a törlés előtt még egyszer be kell lépned a Google-fiókoddal."
    + (signInLeavesPage ? " Az appban ehhez a Google oldalára lépsz; ha visszatértél, kezdd újra a törlést." : ""));
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
        await signInAgain(user);
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
      if (err.code === "recent_signin") { fresh = false; again.hidden = false; readySignIn(); }
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
