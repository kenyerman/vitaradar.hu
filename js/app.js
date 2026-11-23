// vitaradar.ai: the parliament's live stream with its fact-checks. Plain JavaScript, no build step.
//
// The stream runs a broadcast delay behind the live sitting, and every viewer's player sits a little behind the
// stream's newest piece. So a fact must not appear when the server publishes it (that can be a minute early) but
// when this viewer's video reaches the moment the speaker said it. The server times everything on the stream's own
// clock (EXT-X-PROGRAM-DATE-TIME in the playlist), and the page compares that with the date of the frame on screen.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getFirestore, doc, collection, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig, defaultStream } from "./config.js";

const db = getFirestore(initializeApp(firebaseConfig));

const $ = (id) => document.getElementById(id);
const video = $("video");
const els = {
  facts: $("facts"), empty: $("facts-empty"), count: $("fact-count"), note: $("player-note"),
  badge: $("live-badge"), badgeText: $("live-text"), speaker: $("speaker"), img: $("speaker-img"),
  initials: $("speaker-initials"), name: $("speaker-name"), party: $("speaker-party"), role: $("speaker-role"),
};
$("year").textContent = String(new Date().getFullYear());

const LABEL = { true: "Igaz", false: "Hamis", unverifiable: "Nem ellenőrizhető", pending: "Ellenőrzés…", fallacy: "Hibás érvelés" };
const MAX_SHOWN = 200;

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
  setBadge();
  if (d.session && d.session !== live.session) follow(d.session);
  const url = d.hls_url || defaultStream;
  if (url !== live.url || (live.active && failed)) loadStream(url);  // a new stream, or the broadcast (re)started
}, (err) => console.warn("live feed:", err));

function follow(session) {
  unsub.forEach((u) => u());
  live.session = session;
  claims = new Map();
  turns = [];
  els.facts.replaceChildren();
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
function loadStream(url) {
  live.url = url;
  failed = false;
  if (hls) { hls.destroy(); hls = null; }
  note("Várakozás az adásra…");
  if (window.Hls && Hls.isSupported()) {
    hls = new Hls({ liveSyncDurationCount: 3, manifestLoadingMaxRetry: 6, levelLoadingMaxRetry: 6 });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => { note(null); video.play().catch(() => {}); });
    hls.on(Hls.Events.ERROR, (_, e) => {
      if (!e.fatal) return;
      if (e.type === Hls.ErrorTypes.MEDIA_ERROR) { hls.recoverMediaError(); return; }
      failed = true;
      note(live.active ? "Az adás pillanatnyilag nem érhető el, újrapróbálkozás…" : "Most nincs élő adás.");
      // retry only while a broadcast runs; otherwise the live feed reloads the stream when one starts
      setTimeout(() => { if (live.url === url && live.active && failed) loadStream(url); }, 8000);
    });
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {  // Safari plays HLS itself
    video.src = url;
    video.addEventListener("loadedmetadata", () => { note(null); video.play().catch(() => {}); }, { once: true });
    video.addEventListener("error", () => { failed = true; note(live.active ? "Az adás pillanatnyilag nem érhető el." : "Most nincs élő adás."); }, { once: true });
  } else {
    note("Ez a böngésző nem tudja lejátszani az adást.");
  }
}

function note(text) {
  els.note.hidden = !text;
  if (text) els.note.textContent = text;
}

function setBadge() {
  els.badge.dataset.state = live.active ? "on" : "off";
  els.badgeText.textContent = live.active ? "élő · késleltetve" : "nincs adás";
}

// The date (ms) of the frame on screen, on the stream's clock; null when it is unknown.
function streamNow() {
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

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function buildFact(c) {
  const li = el("li", "fact");
  li.dataset.kind = c.kind || "claim";
  const top = el("div", "fact-top");
  const badge = el("span", "verdict");
  top.append(badge, el("span", "fact-who", c.speaker || ""), el("time", "fact-time", clock(c.show_at)));
  li.append(top, el("p", "fact-bullet", c.bullet || c.claim));
  if (c.claim && c.claim !== c.bullet) li.append(el("p", "fact-claim", c.claim));
  li.append(el("p", "fact-expl"), el("ul", "fact-sources"));
  return li;
}

function fillVerdict(li, c, v) {
  li.dataset.verdict = v;
  const badge = li.querySelector(".verdict");
  badge.dataset.v = v;
  badge.textContent = c.kind === "conclusion" && v !== "pending" ? `Következtetés: ${LABEL[v] || v}` : (LABEL[v] || v);
  const expl = li.querySelector(".fact-expl");
  expl.textContent = v === "pending" ? "" : (c.explanation || "");
  expl.hidden = !expl.textContent;
  const list = li.querySelector(".fact-sources");
  list.replaceChildren();
  if (v !== "pending") {
    for (const s of c.sources || []) {
      if (!/^https?:\/\//.test(s.url || "")) continue;
      const a = el("a", null, s.title || new URL(s.url).hostname);
      a.href = s.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      const item = el("li");
      item.append(a);
      list.append(item);
    }
  }
  list.hidden = !list.children.length;
}

function render() {
  const now = streamNow();
  const visible = [...claims.values()]
    .filter((c) => now == null || c.show_at <= now)
    .sort((a, b) => b.show_at - a.show_at)
    .slice(0, MAX_SHOWN);

  const keep = new Set(visible.map((c) => c.id));
  for (const [id, s] of shown) if (!keep.has(id)) { s.li.remove(); shown.delete(id); }

  let prev = null;
  const tally = { true: 0, false: 0, unverifiable: 0, fallacy: 0 };
  for (const c of visible) {
    const v = verdictOf(c, now);
    if (v in tally) tally[v] += 1;
    let s = shown.get(c.id);
    if (!s) {
      s = { li: buildFact(c), verdict: null };
      shown.set(c.id, s);
    }
    if (s.verdict !== v) {
      if (s.verdict) { s.li.classList.remove("flash"); void s.li.offsetWidth; s.li.classList.add("flash"); }
      fillVerdict(s.li, c, v);
      s.verdict = v;
    }
    const want = prev ? prev.nextSibling : els.facts.firstChild;
    if (want !== s.li) els.facts.insertBefore(s.li, want);
    prev = s.li;
  }
  els.empty.hidden = visible.length > 0;
  els.count.textContent = visible.length ? `${visible.length} db` : "";
  for (const k of Object.keys(tally)) $(`n-${k}`).textContent = String(tally[k]);

  renderSpeaker(now);
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
  els.party.textContent = t ? (t.party || "") : "";
  els.role.textContent = t ? (t.role || "") : "";
  els.speaker.style.setProperty("--party", t && t.color ? t.color : "");
  const initials = t && t.name ? t.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("") : "";
  els.initials.textContent = initials;
  if (t && t.photo) {
    els.img.onload = () => { els.img.hidden = false; els.initials.hidden = true; };
    els.img.onerror = () => { els.img.hidden = true; els.initials.hidden = false; };
    els.img.alt = t.name || "";
    els.img.src = t.photo;
  } else {
    els.img.hidden = true;
    els.img.removeAttribute("src");
    els.initials.hidden = false;
  }
}

setBadge();
setInterval(render, 250);
