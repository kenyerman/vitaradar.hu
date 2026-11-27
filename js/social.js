// Votes and comments on fact checks.
//
// Vote counts are public (facts/{c:session:claim}: up, down, comments); each user's own votes are private
// (myvotes/{uid}/v). Comments are for registered users only, which the Firestore rules enforce; everyone else sees a
// blurred placeholder with a prompt to sign in. Every write goes through the user API, which applies the rate limits
// and decides whether a comment is published; a refusal gets one generic answer. Text from users goes on the page with
// textContent only; the only links made are http(s) ones, and following one asks first (unless the user chose not to
// be asked again). Users can delete their own comments, flag others' and block users: a blocked user's comments
// disappear for the user who blocked them.

import { collection, query, where, orderBy, limit, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, el } from "./common.js?v=202611281400";
import { account, onAccount, onBlocks, isBlocked, api, needAccount, avatar, dialog, toast, blockUser } from "./account.js?v=202611281400";
import { userCard } from "./usercard.js?v=202611281400";

export const MAX_COMMENT = 250;
const MAX_DEPTH = 2;          // a comment, a reply, a reply to the reply
const PER_SESSION = 1000;     // the newest comments of a sitting
const FIRST_SHOWN = 3;        // top-level comments shown under a fact before "more"
const GAP = 10000;            // ms between two comments of a user (the API refuses faster ones)

// A link to one comment (?c=<id>, from a profile page): when it arrives, its thread opens in full, the folded levels
// above it open, and it is scrolled to and highlighted, once.
const FOCUS = new URLSearchParams(location.search).get("c");
let focused = !FOCUS;

function reveal(node) {
  for (let d = node.closest("details"); d; d = d.parentElement && d.parentElement.closest("details")) d.open = true;
  node.classList.add("cmt-focus");
  requestAnimationFrame(() => node.scrollIntoView({ block: "center" }));
}

const counts = new Map();     // key -> {up, down, comments?}: "c:<session>:<claim>" for facts, "m:<id>" for comments
const mine = new Map();       // key -> 1 | -1: this user's votes
const widgets = new Map();    // key -> Set of redraw functions
const sessions = new Map();   // session -> {counts, mine}: the vote listeners' unsubscribe functions
const comments = new Map();   // session -> {unsub, byTarget: Map(target -> Map(id -> comment))}
const threads = new Set();    // the comment threads on the page

function redraw(key) {
  (widgets.get(key) || []).forEach((fn) => fn());
}
function onKey(key, fn) {
  if (!widgets.has(key)) widgets.set(key, new Set());
  widgets.get(key).add(fn);
  fn();
}
const regUid = () => (account.registered && account.user ? account.user.uid : null);

// ------------------------------------------------------------------ live counts and my votes, per sitting
export function watchSession(session) {
  if (!session || sessions.has(session)) return;
  const s = { counts: null, mine: null };
  sessions.set(session, s);
  s.counts = onSnapshot(query(collection(db, "facts"), where("session", "==", session)), (snap) => {
    snap.docChanges().forEach((ch) => {
      if (ch.type === "removed") counts.delete(ch.doc.id);
      else counts.set(ch.doc.id, ch.doc.data());
      redraw(ch.doc.id);
    });
  }, (e) => console.warn("votes:", e));
  watchMine(session, s);
}

function watchMine(session, s) {
  if (s.mine) { s.mine(); s.mine = null; }
  const uid = regUid();
  if (!uid) return;
  s.mine = onSnapshot(query(collection(db, "myvotes", uid, "v"), where("session", "==", session)), (snap) => {
    snap.docChanges().forEach((ch) => {
      if (ch.type === "removed") mine.delete(ch.doc.id);
      else mine.set(ch.doc.id, ch.doc.data().v);
      redraw(ch.doc.id);
    });
  }, (e) => console.warn("my votes:", e));
}

// A sitting's comments, newest first, for registered users: one listener for every fact check of the sitting.
function watchComments(session) {
  if (!regUid() || comments.has(session)) return;
  const entry = { unsub: null, byTarget: new Map() };
  comments.set(session, entry);
  const q = query(collection(db, "comments"), where("session", "==", session), orderBy("createdAt", "desc"), limit(PER_SESSION));
  entry.unsub = onSnapshot(q, (snap) => {
    const touched = new Set();
    for (const ch of snap.docChanges()) {
      const c = { id: ch.doc.id, ...ch.doc.data() };
      if (!entry.byTarget.has(c.target)) entry.byTarget.set(c.target, new Map());
      if (ch.type === "removed") entry.byTarget.get(c.target).delete(c.id);
      else entry.byTarget.get(c.target).set(c.id, c);
      counts.set(`m:${c.id}`, { up: c.up || 0, down: c.down || 0 });
      redraw(`m:${c.id}`);
      touched.add(c.target);
    }
    threads.forEach((t) => { if (touched.has(t.key)) t.draw(); });
  }, (e) => {
    console.warn("comments:", e);
    threads.forEach((t) => { if (t.session === session) t.fail(); });
  });
}

function stopComments() {
  comments.forEach((c) => c.unsub && c.unsub());
  comments.clear();
}

let seenUid;
onAccount(() => {
  const uid = regUid();
  if (uid === seenUid) return;
  seenUid = uid;
  const had = [...mine.keys()];
  mine.clear();
  had.forEach(redraw);
  sessions.forEach((s, session) => watchMine(session, s));
  stopComments();
  threads.forEach((t) => t.sync());
});
onBlocks(() => threads.forEach((t) => t.draw()));

// ------------------------------------------------------------------ voting
const THUMB = {  // Feather icons (MIT): thumbs-up, thumbs-down
  up: "M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3",
  down: "M10 15v4a3 3 0 0 0 3 3l4-9V2H5.72a2 2 0 0 0-2 1.7l-1.38 9a2 2 0 0 0 2 2.3zm7-13h2.67A2.31 2.31 0 0 1 22 4v7a2.31 2.31 0 0 1-2.33 2H17",
};

function icon(path) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", path);
  svg.append(p);
  return svg;
}

const inflight = new Set();

async function cast(key, v) {
  if (!needAccount() || inflight.has(key)) return;
  const old = mine.get(key) || 0;
  const next = old === v ? 0 : v;  // the same thumb again takes the vote back
  const before = counts.get(key);
  const c = { up: 0, down: 0, ...(before || {}) };
  c.up += (next === 1) - (old === 1);
  c.down += (next === -1) - (old === -1);
  counts.set(key, c);  // at once; the live counts overwrite it when the server has it
  if (next) mine.set(key, next); else mine.delete(key);
  redraw(key);
  inflight.add(key);
  try {
    await api("/vote", { target: key, v: next });
  } catch (e) {
    if (before) counts.set(key, before); else counts.delete(key);
    if (old) mine.set(key, old); else mine.delete(key);
    redraw(key);
    toast(e.message);
  } finally {
    inflight.delete(key);
  }
}

function voteButtons(key, upLabel, downLabel) {
  const box = el("span", "votes");
  const make = (dir, label) => {
    const b = el("button", `vote ${dir}`);
    b.type = "button";
    b.title = label;
    b.setAttribute("aria-label", label);
    const n = el("span", "vote-n", "0");
    b.append(icon(THUMB[dir]), n);
    b.addEventListener("click", () => cast(key, dir === "up" ? 1 : -1));
    box.append(b);
    return { b, n };
  };
  const up = make("up", upLabel), down = make("down", downLabel);
  onKey(key, () => {
    const c = counts.get(key) || {}, m = mine.get(key) || 0;
    up.n.textContent = String(Math.max(0, c.up || 0));
    down.n.textContent = String(Math.max(0, c.down || 0));
    up.b.setAttribute("aria-pressed", String(m === 1));
    down.b.setAttribute("aria-pressed", String(m === -1));
  });
  return box;
}

// ------------------------------------------------------------------ links: http(s) only, and ask before leaving
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+/gi;  // like the API's validate.links (bare domains stay text)
const TRAILING = /[.,;:!?)\]}>'"»”]+$/;
const LEAVE_OK = "vitaradar.leave-ok";

function leaveOk() {
  try { return localStorage.getItem(LEAVE_OK) === "1"; } catch { return false; }
}

export function confirmLeave(href) {
  const u = new URL(href);
  const never = el("input");
  never.type = "checkbox";
  const check = el("label", "fld check");
  check.append(never, el("span", null, "Ne kérdezd meg többet"));
  const dlg = dialog("Elhagyod a vitaradar.hu-t", [
    el("p", "dlg-text", "Ez a link egy felhasználó írásából egy külső oldalra visz. Az oldal tartalmáért a vitaradar.hu nem felel."),
    el("p", "leave-host", u.hostname),  // an IDN shows as punycode (xn--…): look-alike domains stand out
    el("p", "leave-url", u.href),
    check,
  ], [
    { label: "Mégse", onClick: () => dlg.close() },
    { label: "Tovább", primary: true, onClick: () => {
      if (never.checked) { try { localStorage.setItem(LEAVE_OK, "1"); } catch { /* private mode */ } }
      dlg.close();
      window.open(u.href, "_blank", "noopener,noreferrer");
    } },
  ]);
}

function extLink(href, label) {
  const a = el("a", "ext", label);
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener noreferrer nofollow ugc";
  const guard = (e) => {
    if (e.type === "auxclick" && e.button !== 1) return;
    if (leaveOk()) return;
    e.preventDefault();
    confirmLeave(href);
  };
  a.addEventListener("click", guard);
  a.addEventListener("auxclick", guard);
  return a;
}

// Text and link nodes for a user's text. Never HTML.
export function linkify(text) {
  const out = [];
  let at = 0;
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0].replace(TRAILING, "");
    if (!raw || m.index < at) continue;
    let url;
    try { url = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`); } catch { continue; }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (m.index > at) out.push(document.createTextNode(text.slice(at, m.index)));
    out.push(extLink(url.href, raw));
    at = m.index + raw.length;
  }
  if (at < text.length) out.push(document.createTextNode(text.slice(at)));
  return out;
}

// ------------------------------------------------------------------ locked content: blurred, with a prompt
export const LOREM = [
  "Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor.",
  "Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip.",
  "Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore.",
  "Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia.",
  "Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium.",
  "Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit.",
  "Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet.",
  "Quis autem vel eum iure reprehenderit qui in ea voluptate velit esse.",
];
export const LOREM_NICKS = ["lorem", "ipsum_dolor", "sit.amet", "consectetur", "adipiscing", "elit_sed", "tempor", "magna.aliqua"];

// fake: placeholder content (it is blurred and hidden from screen readers); text: what to do to see the real thing.
export function locked(fake, text, button, onClick = needAccount) {
  const box = el("div", "locked");
  fake.classList.add("locked-fake");
  fake.setAttribute("aria-hidden", "true");
  fake.inert = true;
  const cta = el("div", "locked-cta");
  const card = el("div", "locked-card");
  card.append(el("p", null, text));
  if (button) {
    const b = el("button", "btn small", button);
    b.type = "button";
    b.addEventListener("click", onClick);
    card.append(b);
  }
  cta.append(card);
  box.append(fake, cta);
  return box;
}

function fakeComments(seed) {
  const list = el("ol", "cmts");
  for (let i = 0; i < 2; i++) {
    const k = (seed + i * 3) % LOREM.length;
    const li = el("li", "cmt");
    const head = el("div", "cmt-head");
    head.append(avatar(null, LOREM_NICKS[k], 22), el("span", "cmt-nick", LOREM_NICKS[k]), el("span", "cmt-time", `${k + 2} perce`));
    const actions = el("div", "cmt-actions");
    actions.append(el("span", "vote-n", `▲ ${(k * 7) % 13}`), el("span", "vote-n", `▼ ${(k * 3) % 5}`));
    li.append(head, el("p", "cmt-text", LOREM[k]), actions);
    list.append(li);
  }
  return list;
}

// ------------------------------------------------------------------ comments
function ms(ts) {
  return ts && typeof ts.toMillis === "function" ? ts.toMillis() : Date.now();
}

function ago(t) {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return "most";
  if (s < 3600) return `${Math.floor(s / 60)} perce`;
  if (s < 86400) return `${Math.floor(s / 3600)} órája`;
  return new Date(t).toLocaleDateString("hu-HU", { month: "short", day: "numeric" });
}

let lastSent = 0;

function composer(key, parent, done) {
  const form = el("form", "composer");
  const ta = el("textarea", "field");
  ta.maxLength = MAX_COMMENT;
  ta.rows = parent ? 2 : 1;
  ta.placeholder = parent ? "> válasz…" : "> írj hozzászólást…";
  ta.setAttribute("aria-label", parent ? "Válasz" : "Hozzászólás");
  const counter = el("span", "composer-count", `0/${MAX_COMMENT}`);
  const msg = el("span", "composer-msg");
  msg.setAttribute("role", "status");
  const send = el("button", "btn small", parent ? "Válasz" : "Küldés");
  send.type = "submit";
  const bar = el("div", "composer-bar");
  bar.append(counter, msg, send);
  form.append(ta, bar);
  if (parent) form.classList.add("active");
  ta.addEventListener("focus", () => { form.classList.add("active"); ta.rows = 3; });
  ta.addEventListener("blur", () => { if (!ta.value && !parent) { form.classList.remove("active"); ta.rows = 1; msg.textContent = ""; } });
  const count = () => { counter.textContent = `${[...ta.value].length}/${MAX_COMMENT}`; };
  ta.addEventListener("input", count);
  ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) form.requestSubmit(); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = ta.value.trim();
    if (!text || !needAccount()) return;
    const wait = GAP - (Date.now() - lastSent);
    if (wait > 0) {  // known on this side; the server's refusal would not say why
      msg.className = "composer-msg bad";
      msg.textContent = `Várj még ${Math.ceil(wait / 1000)} másodpercet.`;
      return;
    }
    send.disabled = true;
    ta.readOnly = true;
    msg.className = "composer-msg";
    msg.textContent = "küldés…";
    try {
      await api("/comment", { target: key, text, ...(parent ? { parent } : {}) });
      lastSent = Date.now();
      ta.value = "";
      count();
      msg.textContent = "";
      if (done) done();
    } catch (err) {
      msg.className = "composer-msg bad";
      msg.textContent = err.message;
    } finally {
      send.disabled = false;
      ta.readOnly = false;
    }
  });
  return form;
}

function askThen(title, text, label, run) {
  const dlg = dialog(title, [el("p", "dlg-text", text)], [
    { label: "Mégse", onClick: () => dlg.close() },
    { label, primary: true, onClick: async () => {
      dlg.busy(true);
      try { await run(); dlg.close(); } catch (e) { dlg.error(e.message); dlg.busy(false); }
    } },
  ]);
}

function stateOf(c) {
  if (c.deleted) return "deleted";
  if (c.hidden) return "hidden";
  if (isBlocked(c.uid)) return "blocked";
  return "shown";
}
const GONE = { deleted: "törölt hozzászólás", hidden: "elrejtett hozzászólás", blocked: "letiltott felhasználó hozzászólása" };

function actionLink(label, onClick, disabled) {
  const b = el("button", "link-btn", label);
  b.type = "button";
  b.disabled = Boolean(disabled);
  b.addEventListener("click", onClick);
  return b;
}

// One comment's node: built once, its head, text and actions refilled when its state changes.
function commentNode(c, key) {
  const li = el("li", "cmt");
  li.id = `cmt-${c.id}`;
  li.dataset.depth = String(c.depth || 0);
  const head = el("div", "cmt-head");
  const text = el("p", "cmt-text");
  const actions = el("div", "cmt-actions");
  const replyBox = el("div", "cmt-reply");
  const replies = el("ol", "cmt-replies");
  li.append(head, text, actions, replyBox, replies);
  li.fill = (cur) => {
    const own = Boolean(account.user && cur.uid === account.user.uid);
    const state = stateOf(cur);
    const sig = `${state}|${own}|${account.flagged.has(cur.id)}`;
    if (li.sig === sig) return;
    li.sig = sig;
    li.classList.toggle("own", own && state === "shown");
    li.classList.toggle("gone", state !== "shown");
    head.replaceChildren();
    actions.replaceChildren();
    if (state !== "shown") {
      text.replaceChildren(el("span", "muted", `[ ${GONE[state]} ]`));
      replyBox.replaceChildren();
      return;
    }
    const t = ms(cur.createdAt);
    const time = el("time", "cmt-time", ago(t));
    time.dateTime = new Date(t).toISOString();
    time.title = new Date(t).toLocaleString("hu-HU");
    head.append(avatar(cur.photo, cur.nick, 22), userCard(el("span", "cmt-nick", cur.nick || "?"), cur.deleted ? null : cur.uid), time);
    text.replaceChildren(...linkify(String(cur.text || "")));
    actions.append(voteButtons(`m:${cur.id}`, "Egyetértek", "Nem értek egyet"));
    if ((cur.depth || 0) < MAX_DEPTH) {
      actions.append(actionLink("válasz", () => {
        if (!needAccount()) return;
        if (replyBox.firstChild) { replyBox.replaceChildren(); return; }
        const f = composer(key, cur.id, () => replyBox.replaceChildren());
        replyBox.append(f);
        f.querySelector("textarea").focus();
      }));
    }
    if (own) {
      actions.append(actionLink("törlés", () => askThen("Hozzászólás törlése",
        "Törlöd a hozzászólásodat? A szövege végleg eltűnik; a rá adott válaszok megmaradnak.", "Törlés",
        () => api("/comment/delete", { id: cur.id }))));
    } else {
      const flagged = account.flagged.has(cur.id);
      actions.append(actionLink(flagged ? "jelentve" : "jelentés", () => askThen("Hozzászólás jelentése",
        "Jelented ezt a hozzászólást? Ha többen jelentik, elrejtjük, amíg át nem nézzük.", "Jelentés",
        async () => { await api("/comment/flag", { id: cur.id }); account.flagged.add(cur.id); li.sig = null; li.fill(cur); }),
      flagged));
      actions.append(actionLink("letiltás", () => blockUser(cur.uid, cur.nick)));
    }
  };
  return li;
}

// Puts `items` into `box` in this order, moving a node only when it is out of place (an open reply box keeps focus).
function place(box, items) {
  items.forEach((n, i) => { if (box.children[i] !== n) box.insertBefore(n, box.children[i] || null); });
  while (box.children.length > items.length) box.lastElementChild.remove();
}

function threadView(root, key, session) {
  const t = { key, session, nodes: new Map(), expanded: false, sync, draw, fail };
  let list = null, more = null, empty = null;
  threads.add(t);

  function sync() {
    t.nodes.clear();
    list = more = empty = null;
    if (!account.registered) {
      const seed = [...key].reduce((a, ch) => a + ch.charCodeAt(0), 0);
      root.replaceChildren(locked(fakeComments(seed), account.user
        ? "Fejezd be a regisztrációt, és olvasd, írd a hozzászólásokat."
        : "Lépj be, és olvasd, írd a hozzászólásokat.", account.user ? "Regisztráció" : "Belépés"));
      return;
    }
    list = el("ol", "cmts");
    more = el("button", "link-btn more-cmts");
    more.type = "button";
    more.addEventListener("click", () => { t.expanded = !t.expanded; draw(); });
    empty = el("p", "empty", "még nincs hozzászólás");
    root.replaceChildren(composer(key, null), list, more, empty);
    watchComments(session);
    draw();
  }

  function draw() {
    if (!list) return;
    const all = comments.get(session)?.byTarget.get(key) || new Map();
    const kids = new Map();
    for (const c of all.values()) {
      const p = c.parent && all.has(c.parent) ? c.parent : (c.parent ? "?" : null);
      if (p === "?") continue;  // its parent is older than the sitting's newest PER_SESSION comments
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(c);
    }
    const keep = new Map();
    const kept = (c) => {
      if (!keep.has(c.id)) keep.set(c.id, stateOf(c) === "shown" || (kids.get(c.id) || []).some(kept));
      return keep.get(c.id);
    };
    const nodeOf = (c) => {
      let n = t.nodes.get(c.id);
      if (!n) { n = commentNode(c, key); t.nodes.set(c.id, n); }
      n.fill(c);
      const replies = (kids.get(c.id) || []).filter(kept).sort((a, b) => ms(a.createdAt) - ms(b.createdAt));
      place(n.querySelector(":scope > .cmt-replies"), replies.map(nodeOf));
      return n;
    };
    const top = (kids.get(null) || []).filter(kept).sort((a, b) => ms(b.createdAt) - ms(a.createdAt));  // newest first
    if (!focused && all.has(FOCUS)) t.expanded = true;  // the linked comment may be past the first few
    const shown = t.expanded ? top : top.slice(0, FIRST_SHOWN);
    place(list, shown.map(nodeOf));
    if (!focused && t.nodes.has(FOCUS) && t.nodes.get(FOCUS).isConnected) {
      focused = true;
      reveal(t.nodes.get(FOCUS));
    }
    const rest = top.length - FIRST_SHOWN;
    more.hidden = rest <= 0;
    more.textContent = t.expanded ? "− kevesebb" : `+ még ${rest} hozzászólás`;
    empty.hidden = top.length > 0;
  }

  function fail() {
    if (empty) { empty.textContent = "a hozzászólások most nem tölthetők be"; empty.hidden = false; }
  }

  sync();
  return t;
}

// The votes and the comments under one fact check.
export function factSocial(session, claimId) {
  const key = `c:${session}:${claimId}`;
  watchSession(session);
  const box = el("div", "social");
  const bar = el("div", "social-bar");
  const label = el("span", "talk");
  bar.append(voteButtons(key, "Egyetértek a minősítéssel", "Nem értek egyet a minősítéssel"), label);
  const thread = el("div", "thread");
  box.append(bar, thread);
  onKey(key, () => {
    const n = (counts.get(key) || {}).comments || 0;
    label.textContent = n ? `${n} hozzászólás` : "hozzászólások";
  });
  threadView(thread, key, session);
  return box;
}
