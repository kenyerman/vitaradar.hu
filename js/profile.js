// vitaradar.hu profile page (profile.html?id=<uid>; without an id, your own): a registered user's public profile and
// their comments.
//
// The profile (nick, name, picture) and its stats (points, games won and lost, the likes and dislikes their comments
// got, their comment count) are stored on profiles/{uid}, kept up to date by the server as things happen, so the page
// listens to that one document. Their comments come newest first, a page at a time; deleted and hidden (flagged)
// ones never show. Each links to exactly where it was written: the replay at the fact's moment, else the MP page, else
// the live page, and that page scrolls to the comment and highlights it (?c=, js/social.js).
//
// The page is by uid, not by nick: a nick can change, a uid doesn't, and the nick list stays unreadable for browsers.
// Only registered users can read profiles and comments (Firestore rules); everyone else gets a prompt. Your own profile
// has the editor (js/account.js profileEditor: picture, name, nick, blocked users, sign-out).

import {
  doc, getDoc, onSnapshot, collection, query, where, orderBy, limit, startAfter, getDocs,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, el, badge, huDate, watchLiveBadge } from "./common.js?v=202611240845";
import {
  account, onAccount, onBlocks, isBlocked, avatar, profileEditor, mountAccount, signIn, openRegister, blockUser, api, toast,
} from "./account.js?v=202611240845";
import { linkify } from "./social.js?v=202611240845";
import { watchHref, profileHref, withComment } from "./links.js?v=202611240845";

watchLiveBadge();
mountAccount();

const PAGE = 20;  // comments per page
const box = document.getElementById("prof");
const wanted = new URLSearchParams(location.search).get("id") || "";
const num = (v) => Number(v || 0).toLocaleString("hu-HU");

// ------------------------------------------------------------------ states without a profile to show
function gate(title, text, button, onClick) {
  const card = el("section", "prof-gate panel");
  card.append(el("h1", "page-title", title), el("p", null, text));
  if (button) {
    const b = el("button", "btn", button);
    b.type = "button";
    b.addEventListener("click", onClick);
    card.append(b);
  }
  box.replaceChildren(card);
}

// ------------------------------------------------------------------ where a comment was written
const contexts = new Map();  // session -> Promise<{archive, claims: Map(claim id -> fact), live}>
let liveNow = null;          // Promise<the session on air now, or "">

function onAir() {
  if (!liveNow) {
    liveNow = getDoc(doc(db, "live", "current"))
      .then((s) => { const d = s.data() || {}; return d.active ? d.session || "" : ""; })
      .catch(() => "");
  }
  return liveNow;
}

function context(session) {
  if (!contexts.has(session)) {
    contexts.set(session, (async () => {
      const [a, sp, live] = await Promise.all([
        getDoc(doc(db, "archive", session)).then((s) => s.data() || null).catch(() => null),
        getDocs(query(collection(db, "speeches"), where("session", "==", session))).catch(() => null),
        onAir(),
      ]);
      const claims = new Map();
      for (const d of sp ? sp.docs : []) {
        const s = d.data();
        for (const c of s.claims || []) {
          claims.set(c.id, { ...c, speaker: s.name, mp_id: s.mp_id, date: s.date, replay_only: Boolean(s.replay_only) });
        }
      }
      return { archive: a && a.video ? a : null, claims, live: live === session };
    })());
  }
  return contexts.get(session);
}

// A fact of a sitting not (yet) in the MP history: the live session's own copy.
async function liveFact(session, claim) {
  try {
    const s = await getDoc(doc(db, "sessions", session, "claims", claim));
    return s.exists() ? s.data() : null;
  } catch { return null; }
}

// The link to the comment's place, best first: the replay at the fact's moment (the fact shows there from that second),
// the MP page (the fact sits in its speech), the live page while the sitting is on air.
function placeOf(c, ctx, fact) {
  if (ctx.archive && fact && fact.video_s != null) {
    return { href: withComment(watchHref(c.session, fact.video_s), c.id), label: "megnyitás a visszanézésben" };
  }
  if (fact && fact.mp_id && !fact.replay_only) {
    return { href: withComment(`mp.html?id=${encodeURIComponent(fact.mp_id)}`, c.id), label: "megnyitás a képviselő oldalán" };
  }
  if (ctx.live) return { href: withComment("./", c.id), label: "megnyitás az élő adásban" };
  return null;
}

function ms(ts) {
  return ts && typeof ts.toMillis === "function" ? ts.toMillis() : 0;
}

function when(t) {
  return t ? new Date(t).toLocaleString("hu-HU", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}

async function commentItem(c) {
  const li = el("li", "pc panel");
  const ctx = await context(c.session);
  const fact = ctx.claims.get(c.claim) || await liveFact(c.session, c.claim);
  const where = el("div", "pc-fact");
  if (fact) {
    const v = fact.kind === "fallacy" ? "fallacy" : fact.verdict || "pending";
    where.append(badge(v, fact.kind), el("span", "pc-bullet", fact.bullet || fact.claim || ""));
    const who = [fact.speaker, fact.date ? huDate(fact.date) : ctx.archive ? huDate(ctx.archive.date) : ""].filter(Boolean).join(" · ");
    if (who) where.append(el("span", "pc-who", who));
  } else {
    where.append(el("span", "pc-bullet muted", "egy tényellenőrzéshez"));
  }
  const text = el("p", "pc-text");
  text.append(...linkify(String(c.text || "")));
  const meta = el("div", "pc-meta");
  const t = ms(c.createdAt);
  const time = el("time", null, when(t));
  if (t) time.dateTime = new Date(t).toISOString();
  meta.append(time);
  if (c.parent) meta.append(el("span", null, "válasz"));
  meta.append(el("span", "c-true", `▲ ${num(c.up)}`), el("span", "c-false", `▼ ${num(c.down)}`));
  // no reply count: `replies` also counts the replies deleted since (the API never lowers it)
  const place = placeOf(c, ctx, fact);
  if (place) {
    const a = el("a", "pc-open", `${place.label} →`);
    a.href = place.href;
    meta.append(a);
  } else {
    meta.append(el("span", "muted", "a helye már nem érhető el"));
  }
  li.append(where, text, meta);
  return li;
}

// ------------------------------------------------------------------ the comments, newest first, a page at a time
function commentsView(uid, own) {
  const sec = el("section", "prof-cmts");
  const head = el("div", "section-head");
  head.append(el("h2", null, own ? "Hozzászólásaim" : "Hozzászólások"));
  const list = el("ol", "pc-list");
  const note = el("p", "empty");
  note.hidden = true;
  const more = el("button", "btn ghost small pc-more", "+ korábbi hozzászólások");
  more.type = "button";
  more.hidden = true;
  sec.append(head, list, note, more);

  let last = null, busy = false;
  async function next() {
    if (busy) return;
    busy = true;
    more.disabled = true;
    try {
      const parts = [collection(db, "comments"), where("uid", "==", uid), where("deleted", "==", false),
        where("hidden", "==", false), orderBy("createdAt", "desc")];
      if (last) parts.push(startAfter(last));
      parts.push(limit(PAGE));
      const snap = await getDocs(query(...parts));
      const items = await Promise.all(snap.docs.map((d) => commentItem({ id: d.id, ...d.data() })));
      list.append(...items);
      last = snap.docs[snap.docs.length - 1] || last;
      more.hidden = snap.docs.length < PAGE;
      note.hidden = list.children.length > 0;
      note.textContent = own ? "még nem írtál hozzászólást" : "még nincs hozzászólása";
    } catch (e) {
      console.warn("profile comments:", e);
      note.hidden = false;
      note.textContent = "a hozzászólások most nem tölthetők be";
    } finally {
      busy = false;
      more.disabled = false;
    }
  }
  more.addEventListener("click", next);

  function draw() {  // a blocked user's comments stay hidden for the user who blocked them, as everywhere else
    if (!own && isBlocked(uid)) {
      list.replaceChildren();
      last = null;
      more.hidden = true;
      note.hidden = false;
      note.textContent = "letiltottad ezt a felhasználót, ezért nem látod a hozzászólásait";
      return;
    }
    if (!list.children.length && !busy) next();
  }
  draw();
  return { el: sec };
}

// ------------------------------------------------------------------ the profile
function stats(p) {
  const games = Number(p.won || 0) + Number(p.lost || 0);
  const dl = el("dl", "mp-stats prof-stats");
  for (const [label, value, cls] of [
    ["pont", num(p.points), "c-true"],
    ["megnyert játék", num(p.won), ""],
    ["elvesztett játék", num(p.lost), ""],
    ["nyerési arány", games ? `${Math.round((100 * Number(p.won || 0)) / games)}%` : "–", ""],
    ["kapott like", num(p.likes), "c-true"],
    ["kapott dislike", num(p.dislikes), "c-false"],
    ["hozzászólás", num(p.comments), ""],
  ]) {
    const row = el("div");
    row.append(el("dt", null, label), el("dd", cls, value));
    dl.append(row);
  }
  return dl;
}

let shown = null;  // {uid, own, stop, cmts, editor}
let blockedSig = "";  // the blocked users when the profile was drawn: a change redraws someone else's profile

function close() {
  if (!shown) return;
  shown.stop();
  if (shown.editor) shown.editor.destroy();
  shown = null;
}

function show(uid, own) {
  if (shown && shown.uid === uid && shown.own === own) return;
  close();
  blockedSig = JSON.stringify(account.blocked);
  const me = document.querySelector(".nav-profile");
  if (me) { if (own) me.setAttribute("aria-current", "page"); else me.removeAttribute("aria-current"); }
  const headBox = el("section", "prof-head panel");
  const cmts = commentsView(uid, own);
  const editBox = el("div");
  editBox.hidden = cmts.el.hidden = true;  // shown with the head, so the head filling in moves nothing (CLS)
  box.replaceChildren(headBox, editBox, cmts.el);
  shown = { uid, own, cmts, editor: null, stop: () => {} };

  if (own) {  // the editor, folded until opened
    const det = el("details", "prof-edit panel");
    det.append(el("summary", null, "Profil szerkesztése"));
    const ed = profileEditor();
    det.append(ed.el);
    editBox.append(det);
    shown.editor = ed;
  }

  shown.stop = onSnapshot(doc(db, "profiles", uid), (snap) => {
    if (!snap.exists()) {
      close();
      gate("Profil", "Ez a profil nem érhető el.");
      return;
    }
    const p = snap.data();
    document.title = `${p.nick || "Profil"} – Vitaradar`;
    const who = el("div", "prof-who");
    const nick = el("h1", "prof-nick", p.nick || "?");
    who.append(nick);
    if (own) who.append(el("p", "prof-you", "// ez a te profilod"));
    if (p.name) who.append(el("p", "prof-name", p.name));
    const since = ms(p.createdAt);
    if (since) who.append(el("p", "prof-since", `tag ${new Date(since).toLocaleDateString("hu-HU", { year: "numeric", month: "long", day: "numeric" })} óta`));
    if (!own) {
      const blocked = isBlocked(uid);
      const b = el("button", "btn ghost small", blocked ? "letiltás feloldása" : "letiltás");
      b.type = "button";
      b.addEventListener("click", async () => {
        if (!isBlocked(uid)) { blockUser(uid, p.nick); return; }
        b.disabled = true;
        try { await api("/block", { uid, block: false }); } catch (e) { toast(e.message); b.disabled = false; }
      });
      who.append(b);
    }
    headBox.replaceChildren(avatar(p.photo && p.photo["256"], p.nick, 96), who, stats(p));
    editBox.hidden = cmts.el.hidden = false;
  }, (e) => {
    console.warn("profile:", e);
    close();
    gate("Profil", "Ez a profil nem érhető el.");
  });
}

// ------------------------------------------------------------------ who may see what
onBlocks(() => {
  const sig = JSON.stringify(account.blocked);
  if (sig === blockedSig || !shown) return;
  blockedSig = sig;
  if (!shown.own) { const { uid } = shown; close(); show(uid, false); }  // the block button and the comments
});

onAccount((a) => {
  if (!a.user) {
    close();
    gate("Profil", wanted ? "Ez a profil nem érhető el. Lépj be, és megnézheted a felhasználók profilját."
      : "Lépj be, és itt látod a profilodat és a hozzászólásaidat.", "Belépés", signIn);
    return;
  }
  if (!a.registered) {
    close();
    gate("Profil", "Fejezd be a regisztrációt, és megnézheted a profilokat.", "Regisztráció", () => openRegister({}));
    return;
  }
  const uid = wanted || a.user.uid;
  if (!wanted) history.replaceState(null, "", profileHref(uid));  // a link to share, like everyone else's
  show(uid, uid === a.user.uid);
});
