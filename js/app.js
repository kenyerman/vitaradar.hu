// vitaradar.hu live page: the parliament's stream with its fact-checks. Plain JavaScript, no build step.
//
// The stream runs a broadcast delay behind the live sitting, and every viewer's player sits a little behind the
// stream's newest piece. So a fact must not appear when the server publishes it (that can be a minute early) but
// when this viewer's video reaches the moment the speaker said it. The server times everything on the stream's own
// clock (EXT-X-PROGRAM-DATE-TIME in the playlist), and the page compares that with the date of the frame on screen.

import { doc, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { defaultStream } from "./config.js?v=202611241021";
import { db, el, badge, sourceList, setPhoto, mpHref, setLiveNav } from "./common.js?v=202611241206";
import { mountAccount } from "./account.js?v=202611241315";
import { factSocial } from "./social.js?v=202611241315";
import { mountChat } from "./chat.js?v=202611241315";
import { scrollHint } from "./scrollhint.js?v=202611241021";
import { mountGame } from "./game.js?v=202611241317";
import { cdnReady, cdnUrl, cdnXhr } from "./cdn.js?v=202611241021";
import { useTwitch, mountTwitch, twitchNow } from "./twitch.js?v=202611241408";
import { mountPhone, PHONE } from "./mobile.js?v=202611250620";

const TWITCH = useTwitch();  // the stream from twitch.tv/vitaradar; ?player=cdn: our own CDN (supporters)
if (!TWITCH) cdnReady();  // the stream is on cdn.vitaradar.hu, which needs its cookie: get it before the player asks

const $ = (id) => document.getElementById(id);
const video = $("video");
const els = {
  facts: $("facts"), empty: $("facts-empty"), count: $("fact-count"), note: $("player-note"),
  speaker: $("speaker"), img: $("speaker-img"),
  initials: $("speaker-initials"), name: $("speaker-name"), party: $("speaker-party"), role: $("speaker-role"),
  more: $("speaker-more"),
};
const MAX_SHOWN = 200;

mountAccount();
mountChat($("stage"));
scrollHint(document.querySelector(".below"), document.querySelector(".player"));  // the facts, when the full-width player hides them
const game = mountGame({ now: streamNow });  // challenges and speech tips
mountPhone({ page: "live" });  // phones: the player pinned under the header, the speaker strip under it

let live = { session: null, active: false, url: null };
let claims = new Map();  // id -> fact document
let turns = [];          // speaker turns, by start_at
let unsub = [];
let hls = null;
let failed = false;  // the stream could not be loaded (not live yet, or not reachable)

// ------------------------------------------------------------------ live feed (Firestore)
onSnapshot(doc(db, "live", "current"), (snap) => {
  const d = snap.data() || {};
  live.active = Boolean(d.active);
  setLiveNav(live.active);  // the header's "Élő adás" link (it stays plain until this first answer)
  if (d.session && d.session !== live.session) follow(d.session);
  const url = d.hls_url || defaultStream;
  // Nothing on air: the bucket still holds the last broadcast's playlist, which must not play as if it were live.
  // A viewer who was watching when the broadcast ended keeps playing its last minute (the delay) to the end.
  if (!live.active) {
    if (!live.url) note("most nincs élő adás");
    return;
  }
  if (url !== live.url || failed) loadStream(url);  // a new stream, or the broadcast (re)started
}, (err) => console.warn("live feed:", err));

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
// hls.js (about 100 KB) plays the stream where the browser can't; it loads only once there is a broadcast to play.
const HLS_JS = "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js";
let hlsLib = null;
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  return hlsLib ||= new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = HLS_JS;
    s.onload = () => resolve(window.Hls || null);
    s.onerror = () => { hlsLib = null; s.remove(); resolve(null); };  // Safari can still play it itself
    document.head.append(s);
  });
}
let loads = 0;

async function loadStream(url) {
  live.url = url;
  failed = false;
  if (TWITCH) {  // Twitch shows its own offline screen; the player stays once it is there
    video.hidden = true;
    note(null);
    mountTwitch(video.parentElement).catch(() => note("a Twitch lejátszó nem töltődött be"));
    return;
  }
  if (hls) { hls.destroy(); hls = null; }
  note("várakozás az adásra…");
  const load = ++loads;
  const [Hls] = await Promise.all([loadHls(), cdnReady()]);  // the CDN serves the stream only with its cookie
  if (load !== loads) return;  // a newer stream came in meanwhile
  if (Hls && Hls.isSupported()) {
    hls = new Hls({ liveSyncDurationCount: 3, manifestLoadingMaxRetry: 6, levelLoadingMaxRetry: 6, xhrSetup: cdnXhr });
    hls.loadSource(cdnUrl(url));
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => { note(null); video.play().catch(() => {}); });
    hls.on(Hls.Events.ERROR, (_, e) => {
      if (!e.fatal) return;
      if (e.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
      failed = true;
      note(live.active ? "az adás pillanatnyilag nem érhető el, újrapróbálkozás…" : "most nincs élő adás");
      // retry only while a broadcast runs; otherwise the live feed reloads the stream when one starts
      setTimeout(() => { if (live.url === url && live.active && failed) loadStream(url); }, 8000);
    });
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {  // Safari plays HLS itself
    video.src = cdnUrl(url);
    video.addEventListener("loadedmetadata", () => { note(null); video.play().catch(() => {}); }, { once: true });
    video.addEventListener("error", () => {
      failed = true;
      note(live.active ? "az adás pillanatnyilag nem érhető el" : "most nincs élő adás");
    }, { once: true });
  } else {
    note("ez a böngésző nem tudja lejátszani az adást");
  }
}

function note(text) {
  els.note.hidden = !text;
  if (text) els.note.textContent = text;
}

// The date (ms) of the frame on screen, on the stream's clock; null when it is unknown.
function streamNow() {
  if (TWITCH) return twitchNow();
  if (hls && hls.playingDate) return hls.playingDate.getTime();
  if (typeof video.getStartDate === "function") {  // Safari's own HLS player
    const start = video.getStartDate().getTime();
    if (start > 0) return start + video.currentTime * 1000;
  }
  return null;
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
  li.append(el("p", "fact-expl"), el("ul", "fact-sources"));
  const social = factSocial(live.session, c.id);  // votes and comments, once the verdict is in
  social.hidden = true;
  li.append(social);
  return li;
}

function fillVerdict(li, c, v) {
  li.dataset.verdict = v;
  li.querySelector(".verdict").replaceWith(badge(v === "fallacy" ? "fallacy" : v, c.kind === "fallacy" ? "fallacy" : c.kind));
  const expl = li.querySelector(".fact-expl");
  expl.textContent = v === "pending" ? "" : (c.explanation || "");
  expl.hidden = !expl.textContent;
  li.querySelector(".fact-sources").replaceWith(sourceList(v === "pending" ? [] : c.sources));
  li.querySelector(".social").hidden = v === "pending";
}

function render() {
  const now = streamNow();
  const visible = [...claims.values()]
    .filter((c) => now == null || c.show_at <= now)
    .map((c) => game.mask(c, now))  // a challenge's fact stays "being checked" until the game is over
    .sort((a, b) => b.show_at - a.show_at)
    .slice(0, MAX_SHOWN);
  const phone = PHONE.matches;

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
  const tally = { true: 0, false: 0, unverifiable: 0, fallacy: 0 };
  for (const c of visible) {
    if (phone) {  // phones: a divider above each speaker's facts (newest first, as everywhere)
      const t = turnAt(c.show_at);
      const key = t ? `${t.speaker_id}|${t.start_at}` : null;
      if (key && key !== turnKey) { place(separator(key, t)); usedSeps.add(key); }
      turnKey = key;
    }
    const v = verdictOf(c, now);
    if (v in tally) tally[v] += 1;
    let s = shown.get(c.id);
    if (!s) {
      s = { li: buildFact(c), verdict: null };
      shown.set(c.id, s);
    }
    const text = c.bullet || c.claim;
    if (s.verdict !== v || s.text !== text) {
      if (s.verdict) { s.li.classList.remove("flash"); void s.li.offsetWidth; s.li.classList.add("flash"); }
      if (s.text != null && s.text !== text) s.li.querySelector(".fact-bullet").textContent = text;  // a fallacy named
      fillVerdict(s.li, c, v);
      s.verdict = v;
      s.text = text;
    }
    place(s.li);
  }
  for (const [key, li] of seps) if (!usedSeps.has(key)) { li.remove(); if (!phone) seps.delete(key); }
  els.empty.hidden = visible.length > 0;
  els.count.textContent = visible.length ? `[${String(visible.length).padStart(2, "0")}]` : "";
  for (const k of Object.keys(tally)) $(`n-${k}`).textContent = String(tally[k]);

  renderSpeaker(now);
}

// the speaker turn under way at ms (stream clock), and the divider that opens it in the phone feed
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
