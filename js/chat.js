// The live page's chat, for registered users over 18. It runs on Firestore (chat/live/messages) and keeps
// nothing for long: messages are deleted an hour after they were sent (a TTL policy on expireAt). There is no
// moderation, but the rules check every message: sent by its own author, under their own nick and picture,
// 300 characters at most, one message every 2 seconds per user (chatRate/{uid}, written in the same batch).
// Everyone else sees the column blurred, with placeholder messages and a prompt to sign in. Messages of users the
// reader blocked are not shown.

import { collection, doc, query, orderBy, limit, onSnapshot, writeBatch, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, el } from "./common.js?v=202611240845";
import { account, onAccount, onBlocks, isBlocked, avatar, toast, blockUser } from "./account.js?v=202611240845";
import { userCard } from "./usercard.js?v=202611240845";
import { linkify, locked, LOREM, LOREM_NICKS } from "./social.js?v=202611240845";

const MAX = 300;
const GAP = 2000;            // ms between two messages (the rules allow one every 2 s)
const KEEP = 60 * 60 * 1000; // a message lives an hour
const SHOWN = 120;

const messages = () => collection(db, "chat", "live", "messages");

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
    list.append(li);
  }
  return list;
}

// stage: the box the chat column joins (next to the player).
export function mountChat(stage) {
  stage.dataset.chat = "on";
  let col = stage.querySelector(":scope > .chat");  // in the page already, so the player has its final size from the start
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
    const next = uid || `off:${Boolean(a.user)}:${a.registered}`;
    if (next === state) return;
    state = next;
    if (stop) { stop(); stop = null; }
    col.replaceChildren(head(fold.close));
    if (uid) { stop = liveChat(col, uid, fold); return; }
    fold.messages([], null, true);  // a visitor can't read the chat: nothing to count
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
  function render() {
    const atEnd = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const cutoff = Date.now() - KEEP;  // the TTL deletes late (within a day): hide what is past its hour
    const shown = docs.filter((m) => (!m.createdAt || m.createdAt.toMillis() > cutoff) && !isBlocked(m.uid));
    const keep = new Set(shown.map((m) => m.id));
    for (const [id, n] of nodes) if (!keep.has(id)) { n.remove(); nodes.delete(id); }
    list.replaceChildren(...shown.map((m) => nodes.get(m.id) || remember(m)));
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
    nodes.set(m.id, li);
    return li;
  }

  let last = 0;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    if (Date.now() - last < GAP) { toast("Lassabban: 2 másodpercenként egy üzenet."); return; }
    const p = account.profile || {};
    const b = writeBatch(db);
    b.set(doc(messages()), {
      uid, nick: p.nick || "", photo: (p.photo && p.photo["64"]) || null, text: text.slice(0, MAX),
      createdAt: serverTimestamp(), expireAt: Timestamp.fromMillis(Date.now() + KEEP),
    });
    b.set(doc(db, "chatRate", uid), { last: serverTimestamp() });
    last = Date.now();
    input.value = "";
    send.disabled = true;
    try {
      await b.commit();
      list.scrollTop = list.scrollHeight;
    } catch (err) {
      console.warn("chat send:", err);
      input.value = text;
      toast(err.code === "permission-denied"
        ? "Nem ment el: túl gyorsan írtál, vagy nem pontos a géped órája."
        : "Nem ment el, próbáld újra.");
    } finally {
      send.disabled = false;
      input.focus();
    }
  });

  return () => { unsub(); stopBlocks(); };
}
