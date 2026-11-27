// vitaradar.hu live page: the parliament's stream with its fact-checks. Plain JavaScript, no build step.
//
// The stream runs a broadcast delay behind the live sitting, and every viewer's player sits a little behind the
// stream's newest piece. So a fact must not appear when the server publishes it (that can be a minute early) but
// when this viewer's video reaches the moment the speaker said it. The server times everything on the stream's own
// clock (EXT-X-PROGRAM-DATE-TIME in the playlist), and the page compares that with the date of the frame on screen.
// The video is Twitch's player (twitch.tv/vitaradar), which hides that date: js/twitch.js estimates it.

import { doc, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, el, factBadge, LABEL, sourceList, setPhoto, mpHref, setLiveNav, loadFailed } from "./common.js?v=202611270600";
import { mountAccount } from "./account.js?v=202611270600";
import { factSocial } from "./social.js?v=202611270600";
import { mountChat } from "./chat.js?v=202611270600";
import { scrollHint } from "./scrollhint.js?v=202611241021";
import { mountGame } from "./game.js?v=202611270600";
import { mountTwitch, twitchNow } from "./twitch.js?v=202611271700";

const $ = (id) => document.getElementById(id);
const els = {
  facts: $("facts"), empty: $("facts-empty"), count: $("fact-count"), note: $("player-note"),
  speaker: $("speaker"), img: $("speaker-img"),
  initials: $("speaker-initials"), name: $("speaker-name"), party: $("speaker-party"), role: $("speaker-role"),
  more: $("speaker-more"),
  sum: $("speech-sum"), sumTally: $("speech-tally"), latest: $("latest"), latestRows: $("latest-rows"),
};
const MAX_SHOWN = 200;

mountAccount();
mountChat($("stage"));
scrollHint(document.querySelector(".below"), document.querySelector(".player"));  // the facts, when the full-width player hides them
const game = mountGame({ now: streamNow });  // challenges and speech tips

let live = { session: null, active: false, player: false };  // player: Twitch's player is in the page
let claims = new Map();  // id -> fact document
let turns = [];          // speaker turns, by start_at
let unsub = [];

// ------------------------------------------------------------------ live feed (Firestore)
onSnapshot(doc(db, "live", "current"), (snap) => {
  // Not the server's answer and nothing known yet (Firestore gave up waiting, js/netwatch.js says so): that is not
  // "no broadcast", so the page keeps waiting instead of saying there is none.
  if (snap.metadata.fromCache && !snap.exists()) { if (!live.player) note("kapcsolódás a szerverhez…"); return; }
  const d = snap.data() || {};
  live.active = Boolean(d.active);
  setLiveNav(live.active);  // the header's "Élő adás" link (it stays plain until this first answer)
  if (d.session && d.session !== live.session) follow(d.session);
  // Nothing on air: the page says so, and Twitch's player comes with the next broadcast. A viewer who was watching
  // when the broadcast ended keeps the player, which plays its last minute (the delay) to the end.
  if (!live.active) {
    if (!live.player) note("most nincs élő adás");
    return;
  }
  if (!live.player) showPlayer();
}, (err) => {  // refused (App Check, the rules): the page gets nothing more; js/netwatch.js offers Újrapróbálás
  console.warn("live feed:", err);
  if (!live.player) note("nincs kapcsolat a szerverrel");
});

function follow(session) {
  unsub.forEach((u) => u());
  live.session = session;
  claims = new Map();
  turns = [];
  shown.clear();
  seps.clear();
  els.facts.replaceChildren();
  game.follow(session);
  unsub = [
    onSnapshot(collection(db, "sessions", session, "claims"), (snap) => {
      snap.docChanges().forEach((ch) => {
        if (ch.type === "removed") claims.delete(ch.doc.id);
        else claims.set(ch.doc.id, ch.doc.data());
      });
    }),
    onSnapshot(doc(db, "sessions", session, "state", "floor"), (snap) => {
      turns = ((snap.data() || {}).turns || []).slice().sort((a, b) => a.start_at - b.start_at);
    }),
  ];
}

// ------------------------------------------------------------------ video
// Twitch's player, once there is a broadcast; it stays once it is there (Twitch shows its own offline screen).
function showPlayer() {
  live.player = true;
  note(null);
  mountTwitch(document.querySelector("#stage .player"))
    .catch((e) => { console.warn(e); loadFailed(els.note, "a Twitch lejátszó nem töltődött be"); });
}

function note(text) {
  els.note.hidden = !text;
  if (text) els.note.textContent = text;
}

// The date (ms) of the frame on screen, on the stream's clock; null when it is unknown.
function streamNow() {
  return twitchNow();
}

// ------------------------------------------------------------------ rendering
const shown = new Map();  // id -> {li, verdict}

function verdictOf(c, now) {
  if (c.kind === "fallacy") return "fallacy";
  const ready = c.verdict_at != null && (now == null || c.verdict_at <= now);
  return ready ? (c.verdict || "pending") : "pending";
}

function clock(ms) {
  return new Date(ms).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function buildFact(c) {
  const li = el("li", "fact");
  const top = el("div", "fact-top");
  const who = el("span", "fact-who");
  if (c.speaker_id && c.speaker) {
    const a = el("a", null, c.speaker);
    a.href = mpHref(c.speaker_id);
    who.append(a);
  } else {
    who.textContent = c.speaker || "";
  }
  top.append(el("span", "verdict"), who, el("time", "fact-time", clock(c.show_at)));
  li.append(top, el("p", "fact-bullet", c.bullet || c.claim));
  if (c.claim && c.claim !== c.bullet) li.append(el("p", "fact-claim", c.claim));
  const fal = el("p", "fact-fallacy");  // the fallacy said in the same sentence, once it shows
  fal.hidden = true;
  li.append(el("p", "fact-expl"), fal, el("ul", "fact-sources"));
  const social = factSocial(live.session, c.id);  // votes and comments, once the verdict is in
  social.hidden = true;
  li.append(social);
  return li;
}

// The fallacy said in the same sentence shows on this card from its own moment on the stream clock.
function fallacyShown(c, now) {
  return Boolean(c.fallacy && (now == null || c.fallacy.at == null || c.fallacy.at <= now));
}

function fillVerdict(li, c, v, now) {
  const withFallacy = v !== "pending" && fallacyShown(c, now);
  li.dataset.verdict = withFallacy ? "fallacy" : v;  // the fallacy said with it: the card is the fallacy's
  li.querySelector(".verdict").replaceWith(factBadge(c, v, withFallacy));
  const expl = li.querySelector(".fact-expl");
  expl.textContent = v === "pending" ? "" : (c.explanation || "");
  expl.hidden = !expl.textContent;
  const fal = li.querySelector(".fact-fallacy");
  fal.textContent = withFallacy ? `» ${LABEL.fallacy.toLowerCase()} (${c.fallacy.name}): ${c.fallacy.explanation || ""}` : "";
  fal.hidden = !withFallacy;
  li.querySelector(".fact-sources").replaceWith(sourceList(v === "pending" ? [] : c.sources));
  li.querySelector(".social").hidden = v === "pending";
}

function render() {
  const now = streamNow();
  const visible = [...claims.values()]
    .filter((c) => !c.merged_into)  // a fallacy shown on the card of the claim said in the same sentence
    .filter((c) => now == null || c.show_at <= now)
    .map((c) => game.mask(c, now))  // a challenge's fact stays "being checked" until the game is over
    .sort((a, b) => b.show_at - a.show_at)
    .slice(0, MAX_SHOWN);

  const keep = new Set(visible.map((c) => c.id));
  for (const [id, s] of shown) if (!keep.has(id)) { s.li.remove(); shown.delete(id); }

  let prev = null;
  const place = (node) => {
    const want = prev ? prev.nextSibling : els.facts.firstChild;
    if (want !== node) els.facts.insertBefore(node, want);
    prev = node;
  };
  const usedSeps = new Set();
  let turnKey = null;
  const tally = { true: 0, partly_true: 0, misleading: 0, false: 0, opinion: 0, promise: 0, unverifiable: 0, fallacy: 0 };
  const speech = Object.fromEntries(Object.keys(tally).map((k) => [k, 0]));  // the speech under way: its own balance (the
  // strip under the player on wider screens, the row under the speaker on phones)
  const cur = turnAt(now ?? Infinity);
  let lastFalse = null, lastFallacy = null;  // the newest of each, for the strip
  for (const c of visible) {
    const turn = turnAt(c.show_at);  // a divider above each speaker's facts
    const tk = turn ? `${turn.speaker_id}|${turn.start_at}` : null;
    if (tk && tk !== turnKey) { place(separator(tk, turn)); usedSeps.add(tk); }
    turnKey = tk;
    const v = verdictOf(c, now);
    // a claim with its sentence's fallacy is the fallacy's card: one fallacy, in the tallies and the strip's latest rows.
    // A conclusion check is not a fact (MEGALAPOZATLAN is not HAMIS, js/common.js): its card shows, it is not counted,
    // as on the stream's overlay and in the speech tips (pfc counts only claims there).
    const k = v !== "pending" && fallacyShown(c, now) ? "fallacy" : v;
    if (c.kind !== "conclusion") {
      if (k in tally) tally[k] += 1;
      if (cur && turn === cur && k in speech) speech[k] += 1;
      if (k === "false" && (!lastFalse || c.show_at > lastFalse.show_at)) lastFalse = c;
      if (k === "fallacy" && (!lastFallacy || c.show_at > lastFallacy.show_at)) lastFallacy = c;
    }
    let s = shown.get(c.id);
    if (!s) {
      s = { li: buildFact(c), verdict: null };
      shown.set(c.id, s);
    }
    const text = c.bullet || c.claim;
    const key = `${v}|${v !== "pending" && fallacyShown(c, now)}`;  // the card changes in place when its fallacy shows
    if (s.verdict !== key || s.text !== text) {
      if (s.verdict) { s.li.classList.remove("flash"); void s.li.offsetWidth; s.li.classList.add("flash"); }
      if (s.text != null && s.text !== text) s.li.querySelector(".fact-bullet").textContent = text;  // a fallacy named
      fillVerdict(s.li, c, v, now);
      s.verdict = key;
      s.text = text;
    }
    place(s.li);
  }
  for (const [key, li] of seps) if (!usedSeps.has(key)) li.remove();
  els.empty.hidden = visible.length > 0;
  els.count.textContent = visible.length ? `[${String(visible.length).padStart(2, "0")}]` : "";
  for (const k of Object.keys(tally)) $(`n-${k}`).textContent = String(tally[k]);
  renderStrip(cur ? speech : null, [lastFalse, lastFallacy], now);
  for (const k of Object.keys(speech)) $(`s-${k}`).textContent = String(speech[k]);  // phones: under the speaker

  renderSpeaker(now);
}

// Wider screens, the strip under the player (js/mobile.js puts it there): the speech under way, counted from the
// facts since its speaker began (every verdict, as the sitting's tally), and the latest false
// claim and fallacy of the sitting, each a click away in the facts. Written only when something changed.
const STRIP_ORDER = ["true", "partly_true", "misleading", "false", "opinion", "promise", "unverifiable", "fallacy"];
const STRIP_NAMES = { true: "Igaz", partly_true: "Részben igaz", misleading: "Félrevezető", false: "Hamis",
  opinion: "Vélemény", promise: "Ígéret", unverifiable: "Nem ellenőrizhető", fallacy: "Hibás érvelés" };
const STRIP_SHORT = { unverifiable: "N. e.", fallacy: "H. é." };  // a narrow strip's labels (css), as the MP pages'
let stripSum = null, stripLatest = null;
function renderStrip(speech, latest, now) {
  if (!els.sum || !els.latest) return;
  const sum = speech ? STRIP_ORDER.map((k) => `${k}:${speech[k]}`).join(" ") : "";  // every verdict, 0s too
  if (sum !== stripSum) {
    stripSum = sum;
    els.sum.hidden = !speech;
    els.sumTally.replaceChildren(...(speech ? STRIP_ORDER : []).map((k) => {
      const d = el("div");
      const dt = el("dt", null);
      dt.append(el("span", "st-full", STRIP_NAMES[k]));
      if (STRIP_SHORT[k]) { dt.append(el("span", "st-short", STRIP_SHORT[k])); dt.title = STRIP_NAMES[k]; }
      d.append(dt, el("dd", `c-${k}`, String(speech[k])));  // the term first (a <dl>); css shows the figure first
      return d;
    }));
  }
  const rows = latest.filter(Boolean);
  const key = rows.map((c) => `${c.id}|${c.bullet || c.claim}`).join(" ");
  if (key === stripLatest) return;
  stripLatest = key;
  els.latest.hidden = !rows.length;
  els.latestRows.replaceChildren(...rows.map((c, i) => {
    const b = el("button", "latest-row");
    b.type = "button";
    b.dataset.id = c.id;
    const v = i === 0 && c === latest[0] ? "false" : "fallacy";
    const tag = el("span", "verdict", LABEL[v]);
    tag.dataset.v = v;
    b.append(tag, el("time", null, clock(c.show_at)), el("span", "latest-text", c.bullet || c.claim));
    b.setAttribute("aria-label", `${LABEL[v].toLowerCase()}, ${clock(c.show_at)}: ${c.bullet || c.claim}`);
    return b;
  }));
}
// a click on one of them: the facts' tab, and that fact at the top of its panel, then opened there (js/mobile.js opens
// it and keeps it in place while one open above it folds). Scrolled to only after opening, it showed just its first
// line at the panel's foot, or, with a fact above it open, stayed off the panel until clicked again.
els.latestRows?.addEventListener("click", (e) => {
  const b = e.target.closest(".latest-row");
  const s = b && shown.get(b.dataset.id);
  if (!s) return;
  $("m-tab-feed")?.click();
  const box = s.li.closest(".below");  // not scrollIntoView, which can move the page too
  if (box) {
    const gap = parseFloat(getComputedStyle(s.li).scrollMarginTop) || 0;
    box.scrollTop += s.li.getBoundingClientRect().top - box.getBoundingClientRect().top - gap;
  }
  // aria-expanded: open or opening (data-open stays on a closing fact until it has folded)
  if (s.li.getAttribute("aria-expanded") !== "true") s.li.click();  // js/mobile.js opens it
});

// the speaker turn under way at ms (stream clock), and the divider that opens it in the feed
function turnAt(ms) {
  let t = null;
  for (const x of turns) if (x.start_at <= ms) t = x; else break;
  return t;
}
const seps = new Map();  // turn key -> li
function separator(key, t) {
  let li = seps.get(key);
  if (!li) {
    li = el("li", "m-sep");
    li.append(el("span", "m-sep-name", t.name || "Ismeretlen felszólaló"));
    const meta = [t.party, clock(t.start_at)].filter(Boolean).join(" · ");
    li.append(el("span", "m-sep-meta", meta));
    if (t.color) li.style.setProperty("--party", t.color);
    seps.set(key, li);
  }
  return li;
}

let speakerKey = null;
function renderSpeaker(now) {
  let t = null;
  for (const x of turns) if (now == null || x.start_at <= now) t = x;
  const key = t ? `${t.speaker_id}|${t.name}` : null;
  if (key === speakerKey) return;
  speakerKey = key;
  els.speaker.dataset.empty = String(!t);
  els.name.textContent = t ? (t.name || "Ismeretlen felszólaló") : "–";
  const known = Boolean(t && t.speaker_id && t.speaker_id !== "?");
  if (known) { els.name.href = mpHref(t.speaker_id); els.more.href = mpHref(t.speaker_id); }
  else { els.name.removeAttribute("href"); }
  els.more.hidden = !known;
  els.party.textContent = t ? (t.party || "") : "";
  els.party.hidden = !els.party.textContent;
  els.role.textContent = t ? (t.role || "") : "";
  els.speaker.style.setProperty("--party", t && t.color ? t.color : "");
  setPhoto(els.img, els.initials, t && t.photo, t && t.name, { id: t && t.speaker_id, color: t && t.color });
}

setInterval(render, 250);
