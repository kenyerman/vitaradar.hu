// Accounts: Google sign-in, registration (16+), profile and profile picture, and calls to the user API.
//
// The server decides everything that matters (age, nick uniqueness, rate limits, moderation): this module only
// asks. Everything a user typed is put on the page with textContent, never as HTML.

import { onAuthStateChanged, getIdToken } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { auth, db, appCheckHeaders, signInWithGoogle, signOut } from "./firebase.js?v=202611241130";
import { apiUrl, avatarUrl, photoPrefix } from "./config.js?v=202611241130";
import { el, initials, huDate } from "./common.js?v=202611241130";

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
    img.src = src;
    img.onerror = () => { img.remove(); box.textContent = initials(name); };
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

function openProfile() {
  if (!account.registered) return;
  const p = account.profile || {};
  const pic = el("div", "profile-pic");
  pic.append(avatar(p.photo && p.photo["256"], p.nick, 96));
  const file = input("file", { accept: "image/jpeg,image/png,image/webp" });
  const name = input("text", { maxlength: "150", required: "" });
  name.value = p.name || "";
  const nick = input("text", { maxlength: "40", required: "" });
  nick.value = p.nick || "";
  const locked = (value) => {  // private and fixed: shown, never sent back
    const i = input("text", { disabled: "", readonly: "" });
    i.value = value || "–";
    return i;
  };
  const email = field("E-mail · csak te látod", locked(account.private?.email), "Nem módosítható.");
  const born = field("Születési dátum · csak te látod", locked(huDate(account.private?.birthdate)), "Nem módosítható.");
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
  const dlg = dialog("Profil", [pic, field("Profilkép", file, "JPEG, PNG vagy WEBP, legfeljebb 2 MB."),
    field("Teljes név", name), field("Becenév", nick), email, born, blockedBox], [
    { label: "Kilépés", value: "signout", onClick: () => { dlg.close(); signOut(); } },
    { label: "Bezár", value: "cancel", onClick: () => dlg.close() },
    { label: "Mentés", primary: true, submit: true },
  ], { onClose: stopBlocks });
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
      emit();
      dlg.close();
    } catch (err) {
      dlg.error(err.message);
    } finally {
      dlg.busy(false);
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
export function mountAccount() {
  const row = document.querySelector(".site-header .header-row");
  if (!row) return;
  const box = el("div", "acct");
  row.append(box);
  let stopPoints = null;
  onAccount((a) => {
    if (stopPoints) { stopPoints(); stopPoints = null; }
    box.replaceChildren();
    if (!a.user) {
      const b = el("button", "btn acct-btn", "Belépés");
      b.type = "button";
      b.addEventListener("click", signIn);
      box.append(b);
    } else if (!a.registered) {
      const b = el("button", "btn acct-btn", "Regisztráció befejezése");
      b.type = "button";
      b.addEventListener("click", () => openRegister({}));
      box.append(b);
    } else {
      const b = el("button", "acct-me");
      b.type = "button";
      const pts = el("span", "acct-points");
      pts.hidden = true;
      b.append(avatar(a.profile?.photo && a.profile.photo["64"], a.profile?.nick, 32), pts);
      const label = (p) => {
        b.title = p == null ? "Profil" : `Profil · ${p.toLocaleString("hu-HU")} pont`;
        b.setAttribute("aria-label", b.title);
      };
      label(null);
      b.addEventListener("click", openProfile);
      box.append(b);
      stopPoints = onPoints((p) => {  // the corner badge: just the number, bumped when it grows
        const before = pts.hidden ? null : Number(pts.dataset.points);
        pts.dataset.points = String(p);
        pts.textContent = p.toLocaleString("hu-HU");
        pts.hidden = false;
        label(p);
        if (before != null && p > before) { pts.classList.remove("bump"); void pts.offsetWidth; pts.classList.add("bump"); }
      });
    }
  });
}
