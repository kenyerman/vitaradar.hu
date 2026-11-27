// vitaradar.hu profile page (profile.html?id=<uid>; without an id, your own): a registered user's public profile, their
// game history and their comments.
//
// The profile (nick, name, picture) and its stats (points, games won and lost, the likes and dislikes their comments
// got, their comment count) are stored on profiles/{uid}, kept up to date by the server as things happen, so the page
// listens to that one document. Their games (answered challenges, speech tips, vote predictions) and their comments
// come newest first, a page at a time, each with a link to where it happened: the replay at that moment, else the MP
// page, else the live page (a comment's page scrolls to it and highlights it, ?c=, js/social.js).
//
// Who sees what: the owner can hide sections from everyone else (the editor's switches, js/account.js; the server
// enforces them). A hidden name is not on the profile document at all; hidden stats make the document unreadable for
// others, who then get the rest from the API (/user); the games and someone else's comments always come from the API
// (/user/games, /user/comments), which refuses a hidden list. The owner sees everything, hidden parts marked.
//
// The page is by uid, not by nick: a nick can change, a uid doesn't, and the nick list stays unreadable for browsers.
// Only registered users can read profiles and comments (Firestore rules); everyone else gets a prompt. Your own profile
// has ✎ for the editor (js/account.js openProfileEditor: picture, name, nick, who sees what, blocked users, sign-out).

import {
  doc, onSnapshot, collection, query, where, orderBy, limit, startAfter,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, getDoc, getDocs, el, badge, huDate, watchLiveNav, mpHref } from "./common.js?v=202611270600";
import {
  account, onAccount, onBlocks, isBlocked, avatar, openProfileEditor, mountAccount, signIn, openRegister, blockUser, api, toast,
} from "./account.js?v=202611270600";
import { linkify } from "./social.js?v=202611270600";
import { watchHref, profileHref, withComment } from "./links.js?v=202611241021";

watchLiveNav();
mountAccount();

const PAGE = 20;  // comments per page (the API's pages are as long)
const box = document.getElementById("prof");
const wanted = new URLSearchParams(location.search).get("id") || "";
const num = (v) => Number(v || 0).toLocaleString("hu-HU");
const ONLY_YOU = "csak te látod";

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

// ------------------------------------------------------------------ a sitting: its replay, its facts, where it played
const contexts = new Map();  // session -> Promise<{archive, claims: Map(claim id -> fact), mps: Set, live, offset}>
let liveNow = null;          // Promise<the session on air now, or "">

function onAir() {
  if (!liveNow) {
    liveNow = getDoc(doc(db, "live", "current"))
      .then((s) => { const d = s.data() || {}; return d.active ? d.session || "" : ""; })
      .catch(() => "");
  }
  return liveNow;
}

// A live fact's id carries the id of the pipeline that found it ("a-c46"); the MP history's copy doesn't ("c46").
const bare = (id) => String(id || "").replace(/^[A-Za-z0-9]+-(?=[a-z]\d+$)/, "");
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

// The games are timed on the stream's clock (ms), the replay on its video's (s). The two differ by the stream's delay,
// the same throughout a sitting: measured on the sitting's games whose moment is known on the video too (a
// challenge's fact, a speech tip's start, which its id carries in source seconds: "t00853-…").
async function streamOffset(session, archive, claims) {
  if (!archive || !archive.started_at) return null;
  const [chs, tips] = await Promise.all([
    getDocs(collection(db, "games", session, "challenges")).catch(() => null),
    getDocs(collection(db, "games", session, "tips")).catch(() => null),
  ]);
  const since = (ms) => (ms - archive.started_at) / 1000;
  const d = [];
  for (const s of chs ? chs.docs : []) {
    const g = s.data();
    const f = claims.get(g.claim_id) || claims.get(bare(g.claim_id));
    if (g.opens_at && f && f.video_s != null) d.push(since(g.opens_at) - f.video_s);
  }
  for (const s of tips ? tips.docs : []) {
    const m = /(?:^|-)t(\d+)-/.exec(s.id);
    const g = s.data();
    if (m && g.opens_at) d.push(since(g.opens_at) - Number(m[1]));
  }
  return median(d.filter((x) => x >= 0 && x < 900));
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
      const mps = new Set();
      for (const d of sp ? sp.docs : []) {
        const s = d.data();
        if (!s.replay_only && s.mp_id) mps.add(s.mp_id);
        for (const c of s.claims || []) {
          claims.set(c.id, { ...c, speaker: s.name, mp_id: s.mp_id, date: s.date, replay_only: Boolean(s.replay_only) });
        }
      }
      const archive = a && a.video ? a : null;
      return { archive, claims, mps, live: live === session, offset: await streamOffset(session, archive, claims) };
    })());
  }
  return contexts.get(session);
}

// A moment on the stream's clock (ms) as seconds into the sitting's replay; null without a replay or outside it.
function videoAt(ctx, ms) {
  if (!ctx.archive || ctx.offset == null || !ms) return null;
  const t = (ms - ctx.archive.started_at) / 1000 - ctx.offset;
  const end = Number(ctx.archive.duration_s || 0);
  return t >= -5 && (!end || t <= end + 5) ? Math.max(0, t) : null;
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
    return { href: withComment(mpHref(fact.mp_id), c.id), label: "megnyitás a képviselő oldalán" };
  }
  if (ctx.live) return { href: withComment("./", c.id), label: "megnyitás az élő adásban" };
  return null;
}

// Whether a speaker has an MP page (every MP has one; a minister who isn't an MP doesn't).
const mpPages = new Map();  // id -> Promise<boolean>
function hasMpPage(id) {
  if (!id) return Promise.resolve(false);
  if (!mpPages.has(id)) mpPages.set(id, getDoc(doc(db, "mps", id)).then((s) => s.exists()).catch(() => false));
  return mpPages.get(id);
}

// The same for a game: the replay where it was played, the live page while on air, the speaker's MP page.
async function gamePlace(g, ctx) {
  const t = videoAt(ctx, g.opens_at);
  if (t != null) return { href: watchHref(g.session, t), label: "megnyitás a visszanézésben" };
  if (ctx.live) return { href: "./", label: "megnyitás az élő adásban" };
  const fact = g.claim_id ? ctx.claims.get(g.claim_id) || ctx.claims.get(bare(g.claim_id)) : null;
  const mp = fact && fact.mp_id && !fact.replay_only ? fact.mp_id
    : ctx.mps.has(g.speaker_id) || await hasMpPage(g.speaker_id) ? g.speaker_id : "";
  if (mp) return { href: mpHref(mp), label: "megnyitás a képviselő oldalán" };
  return null;
}

function ms(ts) {
  if (typeof ts === "number") return ts;
  return ts && typeof ts.toMillis === "function" ? ts.toMillis() : 0;
}

function when(t) {
  return t ? new Date(t).toLocaleString("hu-HU", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}

function timeEl(t) {
  const time = el("time", null, when(t));
  if (t) time.dateTime = new Date(t).toISOString();
  return time;
}

function placeLink(place, meta) {
  if (place) {
    const a = el("a", "pc-open", `${place.label} →`);
    a.href = place.href;
    meta.append(a);
  } else {
    meta.append(el("span", "muted", "a helye már nem érhető el"));
  }
}

// ------------------------------------------------------------------ a list, newest first, a page at a time
// `fetchPage(cursor)` -> {items, next}; `render(item)` -> Promise<li>. Returns {el, reset}.
function pagedList({ title, more: moreLabel, empty, failed, fetchPage, render, note }) {
  const sec = el("section", "prof-list");
  const head = el("div", "section-head");
  head.append(el("h2", null, title));
  if (note) head.append(note);
  const list = el("ol", "pc-list");
  const msg = el("p", "empty");
  msg.hidden = true;
  const more = el("button", "btn ghost small pc-more", moreLabel);
  more.type = "button";
  more.hidden = true;
  sec.append(head, list, msg, more);

  let cursor = null, busy = false, gen = 0;
  async function next() {
    if (busy) return;
    busy = true;
    more.disabled = true;
    const mine = gen;
    try {
      const page = await fetchPage(cursor);
      const items = await Promise.all(page.items.map(render));
      if (mine !== gen) return;
      list.append(...items);
      cursor = page.next;
      more.textContent = moreLabel;
      more.hidden = !page.next;
      msg.hidden = list.children.length > 0;
      msg.textContent = empty;
    } catch (e) {
      console.warn(`profile ${title}:`, e);
      if (mine !== gen) return;
      msg.hidden = false;
      msg.textContent = failed;
      more.textContent = "Újrapróbálás";  // the same page again
      more.hidden = false;
    } finally {
      busy = false;
      more.disabled = false;
    }
  }
  more.addEventListener("click", next);
  return {
    el: sec, head, next,
    message(text) { gen++; list.replaceChildren(); cursor = null; more.hidden = true; msg.hidden = false; msg.textContent = text; },
    reset() { gen++; busy = false; list.replaceChildren(); cursor = null; msg.hidden = true; next(); },
  };
}

// A section its owner hides from everyone else: what others see instead.
function hiddenSection(title, text) {
  const sec = el("section", "prof-list");
  const head = el("div", "section-head");
  head.append(el("h2", null, title));
  sec.append(head, el("p", "empty", text));
  return { el: sec };
}

const onlyYou = () => el("span", "prof-private", ONLY_YOU);

// ------------------------------------------------------------------ comments
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
  meta.append(timeEl(ms(c.createdAt)));
  if (c.parent) meta.append(el("span", null, "válasz"));
  meta.append(el("span", "c-true", `▲ ${num(c.up)}`), el("span", "c-false", `▼ ${num(c.down)}`));
  // no reply count: `replies` also counts the replies deleted since (the API never lowers it)
  placeLink(placeOf(c, ctx, fact), meta);
  li.append(where, text, meta);
  return li;
}

// Your own comments straight from Firestore (the rules let you list them); someone else's through the API, which
// leaves them out when they are hidden.
function commentPages(uid, own) {
  if (!own) return (before) => api("/user/comments", { uid, ...(before ? { before } : {}) });
  return async (last) => {
    const parts = [collection(db, "comments"), where("uid", "==", uid), where("deleted", "==", false),
      where("hidden", "==", false), orderBy("createdAt", "desc")];
    if (last) parts.push(startAfter(last));
    parts.push(limit(PAGE));
    const snap = await getDocs(query(...parts));
    return { items: snap.docs.map((d) => ({ id: d.id, ...d.data() })),
      next: snap.docs.length === PAGE ? snap.docs[snap.docs.length - 1] : null };
  };
}

function commentsView(uid, own) {
  const view = pagedList({
    title: own ? "Hozzászólásaim" : "Hozzászólások", more: "+ korábbi hozzászólások",
    empty: own ? "még nem írtál hozzászólást" : "még nincs hozzászólása",
    failed: "a hozzászólások most nem tölthetők be", fetchPage: commentPages(uid, own), render: commentItem,
    note: own ? onlyYou() : null,
  });
  view.draw = () => {  // a blocked user's comments stay hidden for the user who blocked them, as everywhere else
    if (!own && isBlocked(uid)) view.message("letiltottad ezt a felhasználót, ezért nem látod a hozzászólásait");
    else view.reset();
  };
  return view;
}

// ------------------------------------------------------------------ games
const TRUTH = { true: "IGAZ", false: "HAMIS" };
const TAG = { truth: "igaz vagy hamis?", fallacy: "melyik hibás érvelés?", tip: "beszédtipp", vote: "szavazás" };
const tipText = (t) => `${num(t.true)} igaz · ${num(t.false)} hamis · ${num(t.fallacy)} hibás érv`;

function answerRow(dl, label, value, cls) {
  const row = el("div");
  row.append(el("dt", null, label), el("dd", cls || null, value));
  dl.append(row);
}

async function gameItem(g, own) {
  const li = el("li", "pc pg panel");
  const ctx = await context(g.session);
  const kind = g.type === "challenge" ? g.kind : g.type;
  li.dataset.kind = kind;
  const what = el("div", "pc-fact");
  const tag = el("span", "pg-tag", TAG[kind] || "játék");  // "[ … ]" around it on wider screens (css)
  let text = "", who = "";
  if (g.type === "challenge") {
    text = (g.kind === "truth" ? g.claim || g.summary : g.summary) || "";
    who = g.speaker || "";
  } else if (g.type === "tip") {
    text = `${g.speaker || "?"} felszólalása: hány igaz, hamis és hibás érvelés lesz benne?`;
    who = g.party || "";
  } else {
    text = [g.question, g.item].filter(Boolean).join(" · ");
  }
  const date = ctx.archive ? huDate(ctx.archive.date) : "";
  what.append(tag, el("span", "pc-bullet", text));
  const whoLine = [who, date].filter(Boolean).join(" · ");
  if (whoLine) what.append(el("span", "pc-who", whoLine));

  const dl = el("dl", "pg-ans");
  const mine = own ? "tipped" : "tippje";
  const ok = g.settled ? (g.correct || g.points > 0 ? "c-true" : "c-false") : "";
  if (g.type === "challenge") {
    const label = (o) => (g.kind === "truth" ? TRUTH[o] || o : o) || "–";
    answerRow(dl, mine, label(g.choice), ok);
    if (g.settled) answerRow(dl, "helyes", label(g.answer), "c-true");
  } else if (g.type === "tip") {
    answerRow(dl, mine, tipText(g.tip || {}), ok);
    if (g.settled) answerRow(dl, "valójában", tipText(g.actual || {}));
  } else {
    const band = g.band != null && (g.bands || [])[g.band] ? ` · ${g.bands[g.band].label} igen` : "";
    answerRow(dl, mine, `${(g.labels || {})[g.choice] || g.choice || "–"}${band}`, ok);
    if (g.settled) {
      answerRow(dl, "eredmény", `${(g.past || {})[g.outcome] || g.outcome} · ${num(g.yes)} igen, ${num(g.no)} nem`, "c-true");
    }
  }

  const meta = el("div", "pc-meta");
  meta.append(timeEl(g.at));
  if (!g.settled) meta.append(el("span", "muted", "még nincs eredménye"));
  else if (g.points > 0) meta.append(el("span", "pg-points c-true", `+${num(g.points)} pont`));
  else meta.append(el("span", "pg-points", "0 pont"));
  placeLink(await gamePlace(g, ctx), meta);
  li.append(what, dl, meta);
  return li;
}

function gamesView(uid, own) {
  return pagedList({
    title: own ? "Játékaim" : "Játékok", more: "+ korábbi játékok",
    empty: own ? "még nem játszottál: élő adás alatt jönnek a kihívások" : "még nem játszott",
    failed: "a játékok most nem tölthetők be",
    fetchPage: (before) => api("/user/games", { uid, ...(before ? { before } : {}) }), render: (g) => gameItem(g, own),
    note: own ? onlyYou() : null,
  });
}

// ------------------------------------------------------------------ the profile
// The profile as this page shows it, from the document (owner, or nothing hidden that matters) or the API's view.
function fromDoc(p, own) {
  const hide = Array.isArray(p.hide) ? p.hide : [];
  return {
    nick: p.nick, photo: p.photo, createdAt: ms(p.createdAt), hide,
    name: own ? (account.profile && account.profile.name) || p.name : p.name,
    stats: own || !hide.includes("stats") ? p : null,
  };
}

// The counts: a table on wider screens, three tiles on phones (css): the points, the games won, the likes.
function stats(p) {
  const games = Number(p.won || 0) + Number(p.lost || 0);
  const rate = games ? `${Math.round((100 * Number(p.won || 0)) / games)}%` : "–";
  const dl = el("dl", "mp-stats prof-stats");
  for (const [label, value, cls] of [
    ["pont", num(p.points), "c-true"],
    ["megnyert játék", num(p.won), ""],
    ["elvesztett játék", num(p.lost), ""],
    ["nyerési arány", rate, ""],
    ["kapott like", num(p.likes), "c-true"],
    ["kapott dislike", num(p.dislikes), "c-false"],
    ["hozzászólás", num(p.comments), ""],
  ]) {
    const row = el("div");
    row.append(el("dt", null, label), el("dd", cls, value));
    dl.append(row);
  }
  const tile = (label, value, sub, cls) => {
    const t = el("div", "prof-tile");
    t.append(el("span", "prof-tile-label", label), el("b", cls, value), el("span", "prof-tile-sub", sub));
    return t;
  };
  const tiles = el("div", "prof-tiles");
  tiles.append(tile("Pont", num(p.points), "", "c-true"),
    tile("Nyerés", rate, games ? `${num(p.won)} / ${num(games)}` : "még nincs játék"),
    tile("Like", num(p.likes), `${num(p.dislikes)} dislike`));
  const box = el("div", "prof-numbers");
  box.append(dl, tiles);
  return box;
}

// Phones: the two lists as tabs (css shows the chosen one, .prof[data-tab]), each with how many there are; wider
// screens show both lists and no tabs.
function listTabs(sectionBox, own) {
  const bar = el("div", "prof-tabs");
  bar.setAttribute("role", "tablist");
  bar.setAttribute("aria-label", "Listák");
  const tabs = [["games", own ? "Játékaim" : "Játékok"], ["comments", own ? "Hozzászólásaim" : "Hozzászólások"]].map(([k, label]) => {
    const b = el("button", "prof-tab");
    b.type = "button";
    b.setAttribute("role", "tab");
    b.dataset.tab = k;
    b.append(el("span", null, label), el("span", "prof-tab-n"));
    b.addEventListener("click", () => select(k));
    bar.append(b);
    return b;
  });
  function select(k) {
    sectionBox.dataset.tab = k;
    for (const b of tabs) b.setAttribute("aria-selected", String(b.dataset.tab === k));
  }
  select("games");
  return {
    el: bar,
    counts(p) {  // from the stats, when they are shown: the games with a result, the comments
      const n = p ? { games: Number(p.won || 0) + Number(p.lost || 0), comments: Number(p.comments || 0) } : {};
      for (const b of tabs) b.querySelector(".prof-tab-n").textContent = n[b.dataset.tab] == null ? "" : num(n[b.dataset.tab]);
    },
  };
}

let shown = null;  // {uid, own, stop, sections, editor, sig}
let blockedSig = "";  // the blocked users when the profile was drawn: a change redraws someone else's profile

function close() {
  if (!shown) return;
  shown.stop();
  shown = null;
}

// The lists under the head. Someone else's hidden list is not asked for; yours show with "csak te látod".
function drawSections(v) {
  const sig = JSON.stringify(v.hide);
  const { uid, own } = shown;
  if (shown.sig === sig) return;
  shown.sig = sig;
  const hidden = (k) => v.hide.includes(k);
  if (own) {
    if (!shown.sections) {
      shown.sections = { games: gamesView(uid, true), comments: commentsView(uid, true) };
      shown.sections.games.el.dataset.kind = "games";  // phones show one at a time (listTabs)
      shown.sections.comments.el.dataset.kind = "comments";
      shown.sectionBox.replaceChildren(shown.sections.games.el, shown.sections.comments.el);
      shown.sections.games.next();
      shown.sections.comments.draw();
    }
    for (const k of ["games", "comments"]) shown.sections[k].head.querySelector(".prof-private").hidden = !hidden(k);
    return;
  }
  const games = hidden("games") ? hiddenSection("Játékok", "A játékait nem teszi közzé.") : gamesView(uid, false);
  const comments = hidden("comments") ? hiddenSection("Hozzászólások", "A hozzászólásai listáját nem teszi közzé.")
    : commentsView(uid, false);
  games.el.dataset.kind = "games";
  comments.el.dataset.kind = "comments";
  shown.sections = { games, comments };
  shown.sectionBox.replaceChildren(games.el, comments.el);
  if (games.next) games.next();
  if (comments.draw) comments.draw();
}

function drawHead(v) {
  const { uid, own, headBox } = shown;
  document.title = `${v.nick || "Profil"} – Vitaradar`;
  const who = el("div", "prof-who");
  who.append(el("h1", "prof-nick", v.nick || "?"));
  if (own) who.append(el("p", "prof-you", "// ez a te profilod"));
  if (v.name) {
    const name = el("p", "prof-name", v.name);
    if (own && v.hide.includes("name")) name.append(" ", onlyYou());
    who.append(name);
  }
  if (v.createdAt) {
    who.append(el("p", "prof-since", `tag ${new Date(v.createdAt).toLocaleDateString("hu-HU", { year: "numeric", month: "long", day: "numeric" })} óta`));
  }
  if (own) {  // wider screens: a button under the name (phones: ✎ in the corner, below)
    const b = el("button", "btn ghost small prof-edit-text", "✎ Profil szerkesztése");
    b.type = "button";
    b.addEventListener("click", () => openProfileEditor());
    who.append(b);
  }
  if (!own) {
    const blocked = isBlocked(uid);
    const b = el("button", "btn ghost small", blocked ? "letiltás feloldása" : "letiltás");
    b.type = "button";
    b.addEventListener("click", async () => {
      if (!isBlocked(uid)) { blockUser(uid, v.nick); return; }
      b.disabled = true;
      try { await api("/block", { uid, block: false }); } catch (e) { toast(e.message); b.disabled = false; }
    });
    who.append(b);
  }
  let side;
  if (v.stats) {
    side = stats(v.stats);
    if (own && v.hide.includes("stats")) {
      const wrap = el("div", "prof-side");
      wrap.append(el("p", "prof-side-note", `// ${ONLY_YOU}`), side);
      side = wrap;
    }
  } else {
    side = el("p", "prof-side prof-side-note", "A pontjait és a statisztikáit nem teszi közzé.");
  }
  const parts = [avatar(v.photo && v.photo["256"], v.nick, 96), who, side];
  if (own) {  // phones: ✎ in the corner of the head opens the editor
    const edit = el("button", "prof-edit-btn");
    edit.type = "button";
    edit.title = "Profil szerkesztése";
    edit.setAttribute("aria-label", edit.title);
    edit.addEventListener("click", () => openProfileEditor());
    parts.push(edit);
  }
  headBox.replaceChildren(...parts);
}

function draw(v) {
  if (!shown) return;
  drawHead(v);
  drawSections(v);
  shown.tabs.counts(v.stats);
  shown.sectionBox.hidden = shown.tabs.el.hidden = false;  // shown with the head, so nothing moves (CLS)
}

function show(uid, own) {
  if (shown && shown.uid === uid && shown.own === own) return;
  close();
  blockedSig = JSON.stringify(account.blocked);
  const me = document.querySelector(".nav-profile");
  if (me) { if (own) me.setAttribute("aria-current", "page"); else me.removeAttribute("aria-current"); }
  const headBox = el("section", "prof-head panel");
  const sectionBox = el("div", "prof");
  const tabs = listTabs(sectionBox, own);
  sectionBox.hidden = tabs.el.hidden = true;
  box.replaceChildren(headBox, tabs.el, sectionBox);
  shown = { uid, own, headBox, sectionBox, tabs, sections: null, sig: null, last: null, stop: () => {} };

  const unavailable = () => { close(); gate("Profil", "Ez a profil nem érhető el."); };
  const mine = shown;
  shown.stop = onSnapshot(doc(db, "profiles", uid), (snap) => {
    if (!snap.exists()) { unavailable(); return; }
    shown.last = snap.data();
    draw(fromDoc(shown.last, own));
  }, async (e) => {
    // someone else's profile with hidden stats is theirs only (rules): the rest comes from the API
    if (own || e.code !== "permission-denied") { console.warn("profile:", e); unavailable(); return; }
    try {
      const r = await api("/user", { uid });
      if (shown === mine) draw({ ...r.profile, hide: r.profile.hide || [], stats: r.profile.stats || null });
    } catch (err) {
      console.warn("profile:", err);
      if (shown === mine) unavailable();
    }
  });
}

// Your own profile follows the account too: a hidden name changes only on the private account, not on the profile.
onAccount(() => { if (shown && shown.own && shown.last) draw(fromDoc(shown.last, true)); });

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
      : "Lépj be, és itt látod a profilodat, a játékaidat és a hozzászólásaidat.", "Belépés", signIn);
    return;
  }
  if (a.failed) {  // signed in, but the account did not load (js/account.js)
    close();
    gate("Profil", "A fiókodat most nem sikerült betölteni.", "Újrapróbálás", () => location.reload());
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
