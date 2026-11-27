// The live page's chat, for registered users over 18. It runs on Firestore (chat/live/messages) and keeps
// nothing for long: messages are deleted an hour after they were sent (a TTL policy on expireAt). There is no
// moderation, but the rules check every message: sent by its own author, under their own nick and picture,
// 300 characters at most, one message every 2 seconds per user (chatRate/{uid}, written in the same batch).
// The nick and the picture sent with a message are the profile document's (followed live): one changed in another tab,
// or on the profile page before coming back to a page restored from the browser's history, would be refused. The
// expiry is set by the site's clock (the Date header), not the browser's. A refused message says why, as far as the
// page can tell, and is sent once more when the reason was something the page could fix.
// Everyone else sees the column blurred, with placeholder messages and a prompt to sign in. Messages of users the
// reader blocked are not shown. Readers react to messages (👍 ❤️ 😂 😠 😮, one each), see reactions() below.

import { collection, doc, query, orderBy, limit, onSnapshot, writeBatch, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { FieldPath, deleteField } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";  // reactions
import { getToken } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js";
import { getIdToken, getIdTokenResult } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { appCheck } from "./firebase.js?v=202611270600";
import { db, el, getDoc } from "./common.js?v=202611270600";
import { account, onAccount, onBlocks, isBlocked, avatar, toast, blockUser } from "./account.js?v=202611270327";
import { userCard } from "./usercard.js?v=202611270327";
import { linkify, locked, LOREM, LOREM_NICKS } from "./social.js?v=202611270327";
import { fetchT, withTimeout } from "./net.js?v=202611270600";

const MAX = 300;
const GAP = 2000;            // ms between two messages (the rules allow one every 2 s)
const KEEP = 60 * 60 * 1000; // a message lives an hour
const SHOWN = 120;

const messages = () => collection(db, "chat", "live", "messages");

// The site's clock minus the browser's, in ms, from the Date header of a small request to the site itself (whole
// seconds). The rules want a message's expiry about an hour after the server's time; a phone set by hand can be minutes
// or hours off. Under 30 s it counts as none. null: not measured (no answer, or no Date header).
let skew = 0;
async function measureSkew() {
  try {
    const t0 = Date.now();
    const r = await fetchT(`/robots.txt?clock=${t0}`, { method: "HEAD", cache: "no-store" }, 8000);
    const t1 = Date.now();
    const server = Date.parse(r.headers.get("Date") || "");
    if (!Number.isFinite(server)) return null;
    const d = server + 500 - (t0 + t1) / 2;  // the header drops the milliseconds: half a second on average
    skew = Math.abs(d) > 30000 ? d : 0;
    return d;
  } catch {
    return null;
  }
}
const now = () => Date.now() + skew;

const REFUSED = "Nem ment el: a szerver elutasította. Töltsd újra az oldalt, és próbáld újra.";

function head(onClose) {
  const h = el("div", "chat-head");
  const close = el("button", "chat-close", "✕");
  close.type = "button";
  close.title = "Chat bezárása";
  close.setAttribute("aria-label", close.title);
  close.setAttribute("aria-controls", "chat");
  close.setAttribute("aria-expanded", "true");
  close.addEventListener("click", onClose);
  h.append(el("h2", null, "Chat"), el("span", "count", "18+ · 1 óra után törlődik"), close);
  return h;
}

// Closing: the chat folds into a button on the player (#chat-open, in the page, like the column) that counts the messages
// that arrive while it is closed: not the ones already there, not the reader's own, not the blocked users'. It starts
// closed; vr-chat keeps the reader's choice once they open or close it, and the head's script sets
// :root[data-chat="closed"] from it (closed unless "open") before the first paint.
const KEY = "vr-chat";

function folding(stage, col) {
  const root = document.documentElement;
  let button = document.getElementById("chat-open");
  if (!button) {
    button = el("button", "chat-open");
    button.type = "button";
    button.id = "chat-open";
    button.setAttribute("aria-controls", "chat");
    button.setAttribute("aria-expanded", "false");
    const label = el("span", null, "Chat");
    label.setAttribute("aria-hidden", "true");
    const n = el("span", "chat-missed");
    n.setAttribute("aria-hidden", "true");
    n.hidden = true;
    button.append(label, n);
    stage.append(button);
  }
  const badge = button.querySelector(".chat-missed");
  let closed = root.dataset.chat === "closed";
  let seen = new Set();     // message ids already there, or counted
  const missed = new Set();
  let docs = [], uid = null;

  function show() {
    const n = missed.size;
    const had = badge.textContent;
    badge.textContent = n > 99 ? "99+" : String(n);
    badge.hidden = !n;
    if (n && had !== badge.textContent) { badge.classList.remove("bump"); void badge.offsetWidth; badge.classList.add("bump"); }
    button.setAttribute("aria-label", n ? `Chat megnyitása, ${n > 99 ? "több mint 99" : n} új üzenet` : "Chat megnyitása");
    col.inert = closed;
  }

  function set(next) {
    closed = next;
    if (closed) root.dataset.chat = "closed"; else delete root.dataset.chat;
    try { localStorage.setItem(KEY, closed ? "closed" : "open"); } catch { /* private mode: for this page only */ }
    seen = new Set(docs.map((m) => m.id));
    missed.clear();
    show();
  }

  button.addEventListener("click", () => {
    set(false);
    col.querySelector(".chat-close")?.focus({ preventScroll: true });
  });
  show();

  return {
    close() { set(true); button.focus({ preventScroll: true }); },
    // every snapshot of the messages; backlog: what a new subscription finds already there, which never counts
    messages(list, reader, backlog) {
      docs = list;
      uid = reader;
      for (const m of list) {
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        if (closed && !backlog && m.uid !== uid && !isBlocked(m.uid)) missed.add(m.id);
      }
      if (closed) show();
    },
  };
}

function fakeChat() {
  const list = el("ol", "chat-list");
  for (let i = 0; i < 14; i++) {
    const li = el("li", "msg");
    const nick = LOREM_NICKS[(i * 5) % LOREM_NICKS.length];
    li.append(avatar(null, nick, 20), el("span", "msg-nick", nick), el("time", "msg-time", `18:${String(10 + i * 2).padStart(2, "0")}`),
      el("span", "msg-text", LOREM[(i * 3) % LOREM.length]));
    if (i % 4 === 1) {  // a few reactions, so the blurred column shows that there are some
      const row = el("div", "rx-chips");
      row.append(el("span", "rx-chip", `${REACTIONS[i % 5][1]} ${1 + (i % 3)}`), el("span", "rx-chip", `${REACTIONS[(i + 2) % 5][1]} 1`));
      li.append(row);
    }
    list.append(li);
  }
  return list;
}

// stage: the box the chat column joins (next to the player).
export function mountChat(stage) {
  stage.dataset.chat = "on";
  let col = document.getElementById("chat");  // in the page already, so the player has its final size from the start
  // (by id: on phones js/mobile.js has moved it under the player by now)
  if (!col) {
    col = el("aside", "chat panel");
    col.setAttribute("aria-label", "Chat");
    stage.append(col);
  }
  col.id = "chat";
  const fold = folding(stage, col);
  let state = null, stop = null;
  onAccount((a) => {
    const uid = a.registered && a.a18 && a.user ? a.user.uid : null;
    const next = uid || `off:${Boolean(a.user)}:${a.registered}:${a.failed}`;
    if (next === state) return;
    state = next;
    if (stop) { stop(); stop = null; }
    col.replaceChildren(head(fold.close));
    if (uid) { stop = liveChat(col, uid, fold); return; }
    fold.messages([], null, true);  // a visitor can't read the chat: nothing to count
    if (a.failed) {  // signed in, but the account did not load (js/account.js): not a registration to finish
      col.append(locked(fakeChat(), "A fiókodat most nem sikerült betölteni.", "Újrapróbálás", () => location.reload()));
      return;
    }
    const text = a.registered ? "A chat 18 év feletti felhasználóknak szól."
      : a.user ? "Fejezd be a regisztrációt, és csevegj élőben a közvetítés alatt (18+)."
        : "Lépj be, és csevegj élőben a közvetítés alatt (18+).";
    const button = a.registered ? null : a.user ? "Regisztráció" : "Belépés";
    col.append(locked(fakeChat(), text, button));
  });
}

function liveChat(col, uid, fold) {
  const list = el("ol", "chat-list");
  list.setAttribute("aria-live", "polite");
  const form = el("form", "chat-form");
  const input = el("input", "field");
  input.type = "text";
  input.maxLength = MAX;
  input.placeholder = "> üzenet…";
  input.setAttribute("aria-label", "Üzenet");
  input.autocomplete = "off";
  const send = el("button", "btn small", "Küld");
  send.type = "submit";
  form.append(input, send);
  col.append(list, form);

  const nodes = new Map();
  let docs = [];
  const expired = (m) => Boolean(m.createdAt) && m.createdAt.toMillis() <= now() - KEEP;  // by the site's clock
  const rx = reactions(list, uid, expired, () => render());
  function render() {
    const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    // the TTL deletes late (within a day): hide what is past its hour
    const shown = docs.filter((m) => !expired(m) && !isBlocked(m.uid));
    const keep = new Set(shown.map((m) => m.id));
    for (const [id, n] of nodes) if (!keep.has(id)) { n.remove(); nodes.delete(id); rx.forget(id); }
    // in order, moving only what is out of place: a reaction changes a message, and a moved node would lose the focus
    shown.forEach((m, i) => {
      const n = nodes.get(m.id) || remember(m);
      if (list.children[i] !== n) list.insertBefore(n, list.children[i] || null);
      rx.paint(m);
    });
    while (list.children.length > shown.length) list.lastElementChild.remove();
    if (atEnd) list.scrollTop = list.scrollHeight;
  }
  let backlog = true;  // until the server's first answer: what was there before
  const unsub = onSnapshot(query(messages(), orderBy("createdAt", "desc"), limit(SHOWN)), (snap) => {
    docs = snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) })).reverse();
    render();
    fold.messages(docs, uid, backlog);
    if (!snap.metadata.fromCache) backlog = false;
  }, (e) => {
    console.warn("chat:", e);
    list.replaceChildren(el("li", "empty", "a chat most nem érhető el"));
  });
  const stopBlocks = onBlocks(render);
  // the nick and picture the rules compare a message with: the profile as it is now (account.profile is the one this
  // page loaded)
  let me = account.profile || {};
  const stopMe = onSnapshot(doc(db, "profiles", uid), (snap) => { if (snap.exists()) me = snap.data(); },
    (e) => console.warn("chat profile:", e));
  measureSkew();

  function remember(m) {
    const li = el("li", "msg");
    if (m.uid === uid) li.classList.add("own");
    const t = m.createdAt ? m.createdAt.toDate() : new Date();
    const time = el("time", "msg-time", t.toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" }));
    const text = el("span", "msg-text");
    text.append(...linkify(String(m.text || "")));
    li.append(avatar(m.photo, m.nick, 20), userCard(el("span", "msg-nick", m.nick || "?"), m.uid), time, text);
    if (m.uid !== uid) {
      const b = el("button", "msg-block", "⊘");
      b.type = "button";
      b.title = `${m.nick || "?"} letiltása`;
      b.setAttribute("aria-label", b.title);
      b.addEventListener("click", () => blockUser(m.uid, m.nick));
      li.append(b);
    }
    rx.attach(m, li);
    nodes.set(m.id, li);
    return li;
  }

  function message(text) {
    return {
      uid, nick: me.nick || "", photo: (me.photo && me.photo["64"]) || null, text: text.slice(0, MAX),
      createdAt: serverTimestamp(), expireAt: Timestamp.fromMillis(now() + KEEP),
    };
  }
  function commit(msg) {
    const b = writeBatch(db);
    b.set(doc(messages()), msg);
    b.set(doc(db, "chatRate", uid), { last: serverTimestamp() });
    return b.commit();
  }

  // Why the rules refused a message: { retry: true } when the page fixed the reason (sending again may work), else
  // { text } for the toast. The checks are the rules' own, minus the ones the page never gets wrong (text, fields).
  async function refused(msg) {
    let retry = false;
    try {  // the nick or picture changed since this page had them
      const p = (await getDoc(doc(db, "profiles", uid))).data() || {};
      if ((p.nick || "") !== msg.nick || ((p.photo && p.photo["64"]) || null) !== msg.photo) { me = p; retry = true; }
    } catch (e) { console.warn("chat profile:", e); }
    try {  // the sign-in token lacks the 18+ mark (the rules read it from there)
      if ((await withTimeout(getIdTokenResult(account.user), 10000, "ID token")).claims.a18 !== true) {
        await withTimeout(getIdToken(account.user, true), 10000, "ID token");
        retry = true;
      }
    } catch (e) { console.warn("chat token:", e); }
    const had = skew;
    const d = await measureSkew();  // the browser's clock (the expiry)
    if (skew !== had) retry = true;
    if (retry) return { retry };
    try { await withTimeout(getToken(appCheck, false), 15000, "App Check"); }  // the site check (reCAPTCHA): Firestore refuses requests without it
    catch (e) {
      console.warn("chat app check:", e);
      return { text: "Nem ment el: a böngésződet nem sikerült ellenőrizni (reCAPTCHA). Töltsd újra az oldalt, és próbáld újra." };
    }
    const mine = docs.filter((m) => m.uid === uid && m.createdAt).at(-1);  // another tab or device of this user
    if (mine && now() - mine.createdAt.toMillis() < GAP + 1000) return { text: "Lassabban: 2 másodpercenként egy üzenet." };
    return { text: d == null ? `${REFUSED} Ha így sem megy, nézd meg, pontos-e a géped órája.` : REFUSED };
  }

  // Sends a message; refused once for a reason the page could fix, it tries once more. Throws with .text for the toast.
  async function deliver(text) {
    for (let attempt = 0; ; attempt++) {
      const msg = message(text);
      try {
        await commit(msg);
        return;
      } catch (err) {
        if (err.code !== "permission-denied") throw err;
        const why = await refused(msg);
        if (!why.retry || attempt) { err.text = why.text || REFUSED; throw err; }
      }
    }
  }

  let last = 0;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (Date.now() - last < GAP) { toast("Lassabban: 2 másodpercenként egy üzenet."); return; }
    last = Date.now();
    input.value = "";
    send.disabled = true;
    // Firestore sends a write once it can, and only then answers: on a stalled connection the button would stay off.
    // After 15 s it is back on, and the message still goes (it is not put back: that would send it twice).
    const slow = setTimeout(() => {
      toast("Lassú a kapcsolat: az üzenet elmegy, amint a szerver válaszol.");
      send.disabled = false;
    }, 15000);
    try {
      await deliver(text);
      list.scrollTop = list.scrollHeight;
    } catch (err) {
      console.warn("chat send:", err);
      if (!input.value) input.value = text;  // not over a newer one typed after the slow notice
      toast(err.text || "Nem ment el, próbáld újra.");
    } finally {
      clearTimeout(slow);
      send.disabled = false;
      input.focus();
    }
  });

  return () => { unsub(); stopBlocks(); stopMe(); rx.stop(); };
}

// ------------------------------------------------------------------ reactions
// One reaction per reader on a message, which they can change or take back: the message's map r (uid -> reaction).
// The rules let a reader write only their own entry, an allowed one, within the message's hour (its createdAt), and
// at most once a second (reactRate/{uid}, in the same batch); so reactions go with the message, nothing else keeps them.
// The counts under a message leave out the users the reader blocked. Clicks faster than that wait their turn here, and
// only the last choice for a message is sent; the message's listener shows a sent one at once (and takes it back if
// the rules refuse it). A bar of the five shows on hover or keyboard focus (one tab stop per message, the arrows move
// in it); on touch screens a tap on the message opens it.
const REACTIONS = [["like", "👍", "Tetszik"], ["heart", "❤️", "Imádom"], ["haha", "😂", "Haha"], ["angry", "😠", "Dühös"],
  ["wow", "😮", "Hűha"]];
const REACT_GAP = 1100;  // ms between two reaction writes (the rules allow one a second)

function reactions(list, uid, expired, refresh) {
  const want = new Map();     // message id -> the reader's choice waiting for its turn (null: taken back)
  const parts = new Map();    // message id -> its bar and chips
  const current = new Map();  // message id -> its latest data
  let last = 0, busy = false, timer = 0, open = null, pointer = "mouse";
  const hover = matchMedia("(hover: hover)");
  const tapping = () => pointer !== "mouse" || !hover.matches;  // a touch, or a screen without hover

  const stored = (m) => (m.r && typeof m.r[uid] === "string" ? m.r[uid] : null);
  const mine = (m) => (want.has(m.id) ? want.get(m.id) : stored(m));

  function paint(m) {
    current.set(m.id, m);
    const p = parts.get(m.id);
    if (!p) return;
    const me = mine(m);
    const n = {};
    for (const [who, type] of Object.entries(m.r || {})) if (who !== uid && !isBlocked(who)) n[type] = (n[type] || 0) + 1;
    if (me) n[me] = (n[me] || 0) + 1;
    const focused = p.bar.contains(document.activeElement);
    let any = false, lost = false;
    REACTIONS.forEach(([type, , label], i) => {
      const b = p.picks[type], c = p.chips[type], k = n[type] || 0;
      b.setAttribute("aria-pressed", String(me === type));
      if (!focused) b.tabIndex = (me ? me === type : i === 0) ? 0 : -1;
      if (!k && c === document.activeElement) lost = true;
      c.hidden = !k;
      any ||= k > 0;
      if (!k) return;
      c.lastChild.textContent = String(k);
      c.setAttribute("aria-pressed", String(me === type));
      c.title = `${label}: ${k}${me === type ? " (te is)" : ""}`;
      c.setAttribute("aria-label", c.title);
    });
    p.row.hidden = !any;
    if (lost) p.bar.querySelector('[tabindex="0"]').focus({ preventScroll: true });
  }

  function choose(id, type) {
    const m = current.get(id);
    if (!m) return;
    if (expired(m)) { toast("Ez az üzenet már lejárt."); refresh(); return; }  // and it goes from the list
    want.set(id, mine(m) === type ? null : type);  // the same one again takes it back
    paint(m);
    send();
  }

  async function send() {
    clearTimeout(timer);
    if (busy || !want.size) return;
    const wait = last + REACT_GAP - Date.now();
    if (wait > 0) { timer = setTimeout(send, wait); return; }
    const [id, type] = want.entries().next().value;
    want.delete(id);
    const m = current.get(id);
    if (!m || stored(m) === type || expired(m)) { if (m) paint(m); send(); return; }  // nothing to change
    busy = true;
    const b = writeBatch(db);
    b.update(doc(messages(), id), new FieldPath("r", uid), type || deleteField());
    b.set(doc(db, "reactRate", uid), { at: serverTimestamp() });
    try {
      await b.commit();
    } catch (err) {
      console.warn("chat reaction:", err);
      toast("A reakció nem ment el, próbáld újra.");
    } finally {
      last = Date.now();
      busy = false;
      if (current.has(id)) paint(current.get(id));
      send();
    }
  }

  // the bar above the message, or under it when the message is at the top of the list (it would be cut off there)
  function place(li) {
    li.classList.toggle("rx-below", li.getBoundingClientRect().top - list.getBoundingClientRect().top < 52);
  }
  function show(id) {
    if (open && parts.has(open)) parts.get(open).li.classList.remove("rx-open");
    open = id && parts.has(id) ? id : null;
    if (!open) return;
    const { li } = parts.get(open);
    place(li);
    li.classList.add("rx-open");
  }

  function attach(m, li) {
    li.dataset.id = m.id;
    const bar = el("div", "rx-bar");
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", m.uid === uid ? "Reakció a saját üzenetedre" : `Reakció ${m.nick || "?"} üzenetére`);
    const row = el("div", "rx-chips");
    row.setAttribute("aria-live", "off");  // others' reactions are not read out as new messages
    row.hidden = true;
    const picks = {}, chips = {};
    for (const [type, face, label] of REACTIONS) {
      const b = el("button", "rx-pick", face);
      b.type = "button";
      b.title = label;
      b.setAttribute("aria-label", label);
      b.addEventListener("click", (e) => {
        for (const x of bar.children) x.tabIndex = x === b ? 0 : -1;
        choose(m.id, type);
        if (e.detail && tapping()) show(null);  // a tap chose: the bar goes
      });
      picks[type] = b;
      bar.append(b);
      const c = el("button", "rx-chip");
      c.type = "button";
      const f = el("span", "rx-face", face);
      f.setAttribute("aria-hidden", "true");
      c.append(f, el("span", "rx-n"));
      c.hidden = true;
      c.addEventListener("click", () => choose(m.id, type));
      chips[type] = c;
      row.append(c);
    }
    bar.addEventListener("keydown", (e) => {
      const all = [...bar.children], i = all.indexOf(document.activeElement);
      const j = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: all.length - 1 }[e.key];
      if (e.key === "Escape") { show(null); return; }
      if (j === undefined || i < 0) return;
      e.preventDefault();
      const k = (j + all.length) % all.length;
      all.forEach((b, x) => { b.tabIndex = x === k ? 0 : -1; });
      all[k].focus();
    });
    parts.set(m.id, { li, bar, row, picks, chips });
    li.append(bar, row);
    current.set(m.id, m);
  }

  // touch: a tap on a message (not on its name, a link or a button) opens its bar; a tap anywhere else closes it
  const onDown = (e) => {
    if (open && parts.has(open) && !parts.get(open).li.contains(e.target)) show(null);
  };
  const onKey = (e) => { if (e.key === "Escape" && open) show(null); };
  list.addEventListener("pointerdown", (e) => { pointer = e.pointerType || "mouse"; }, true);
  list.addEventListener("click", (e) => {
    if (!tapping() || e.target.closest("a, button, [role='button'], input")) return;
    const li = e.target.closest(".msg");
    if (li && parts.has(li.dataset.id)) show(open === li.dataset.id ? null : li.dataset.id);
  });
  list.addEventListener("pointerover", (e) => {  // hover and keyboard: the bar where it is not cut off
    const li = e.pointerType === "mouse" && e.target.closest(".msg");
    if (li && !li.classList.contains("rx-open")) place(li);
  });
  list.addEventListener("focusin", (e) => { const li = e.target.closest(".msg"); if (li && li !== parts.get(open)?.li) place(li); });
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey);

  return {
    attach,
    paint,
    forget(id) {
      parts.delete(id);
      current.delete(id);
      if (open === id) open = null;
    },
    stop() {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
    },
  };
}
