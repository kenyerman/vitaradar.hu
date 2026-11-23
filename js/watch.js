// vitaradar.hu replay: a past stream (watch.html?s=<session>&t=<seconds>) with its facts and speakers.
//
// The archive's video is the stream as it was broadcast, overlay included. Below it every fact of the run is listed
// at its moment in the video: a click jumps there, the fact being said is highlighted, those still to come are dimmed,
// and the speaker card follows the video. ?t= opens the video at that second (the MP page's fact links).

import { doc, getDoc, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, el, badge, sourceList, setPhoto, hms, huDate, mpHref, watchLiveBadge } from "./common.js?v=202611231830";
import { mountAccount } from "./account.js?v=202611231830";
import { factSocial } from "./social.js?v=202611231830";
import { watchHref } from "./links.js?v=202611232039";

watchLiveBadge();
mountAccount();
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const session = params.get("s") || "";
const startAt = Math.max(0, parseFloat(params.get("t") || "0") || 0);
const video = $("video");
let facts = [];      // {c, speech, li}, by time in the video
let speakers = [];   // archive doc's speeches: {mp_id, name, party, start_s, end_s}
const mps = new Map();  // mp id -> mps doc (photo, colour, role)
let follow = true;

function note(text) {
  $("player-note").hidden = !text;
  if (text) $("player-note").textContent = text;
}

function clock(ms) {
  return new Date(ms).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" });
}

function seek(t, play = true) {
  video.currentTime = t;
  if (play) video.play().catch(() => {});
}

function factItem(f) {
  const { c, speech } = f;
  const v = c.kind === "fallacy" ? "fallacy" : c.verdict || "pending";
  const li = el("li", "fact");
  li.dataset.verdict = v;
  const top = el("div", "fact-top");
  const at = el("button", "t-btn", c.video_s == null ? "nincs a videóban" : `▶ ${hms(c.video_s)}`);
  at.type = "button";
  at.disabled = c.video_s == null;
  at.title = c.video_s == null ? "ez az állítás a felvétel vége után hangzott el" : "ugrás ehhez a pillanathoz";
  at.addEventListener("click", () => seek(c.video_s));
  const who = el("span", "fact-who");
  const a = el("a", null, speech.name);
  a.href = mpHref(speech.mp_id);
  who.append(a);
  top.append(at, badge(v, c.kind), who);
  li.append(top, el("p", "fact-bullet", c.bullet || c.claim));
  if (c.claim && c.claim !== c.bullet) li.append(el("p", "fact-claim", c.claim));
  if (c.explanation) li.append(el("p", "fact-expl", c.explanation));
  li.append(sourceList(c.sources));
  if (c.id && v !== "pending") li.append(factSocial(session, c.id));  // votes and comments, as on the MP page
  return li;
}

function speakerAt(t) {
  return speakers.find((s) => s.start_s != null && s.start_s <= t && t < (s.end_s ?? Infinity)) || null;
}

let shownSpeaker;
function renderSpeaker(s) {
  const key = s ? s.speech_id : null;
  if (key === shownSpeaker) return;
  shownSpeaker = key;
  const m = s ? mps.get(s.mp_id) || {} : {};
  $("speaker").dataset.empty = String(!s);
  $("speaker-name").textContent = s ? s.name : "–";
  if (s) $("speaker-name").href = mpHref(s.mp_id); else $("speaker-name").removeAttribute("href");
  $("speaker-party").textContent = s ? s.party || "" : "";
  $("speaker-party").hidden = !$("speaker-party").textContent;
  $("speaker-role").textContent = m.role || "";
  $("speaker").style.setProperty("--party", m.color || "");
  setPhoto($("speaker-img"), $("speaker-initials"), m.photo, s ? s.name : "", { id: s && s.mp_id, color: m.color });
  document.querySelectorAll(".speaker-list li").forEach((li) => li.classList.toggle("now", li.dataset.id === key));
}

let current = null;
function tick() {
  const t = video.currentTime;
  let now = null;
  for (const f of facts) {
    const future = f.c.video_s == null || f.c.video_s > t + 0.5;
    f.li.classList.toggle("future", future);
    if (!future) now = f;
  }
  if (now !== current) {
    if (current) current.li.classList.remove("now");
    current = now;
    if (current) {
      current.li.classList.add("now");
      if (follow && !video.paused) current.li.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }
  renderSpeaker(speakerAt(t));
}

function shareUrl() {
  return new URL(watchHref(session, video.currentTime), location.href).href;
}

async function load() {
  if (!session) { $("w-title").textContent = "Ismeretlen adás"; note("nincs ilyen adás"); return; }
  const [aSnap, spSnap] = await Promise.all([
    getDoc(doc(db, "archive", session)),
    getDocs(query(collection(db, "speeches"), where("session", "==", session))),
  ]);
  const a = aSnap.data();
  if (!a) { $("w-title").textContent = "Nincs ilyen adás"; note("ez az adás nincs az archívumban"); return; }
  document.title = `${huDate(a.date)} – Visszanézés – Vitaradar`;
  $("w-title").textContent = `// ${huDate(a.date)}`;
  $("w-sub").textContent = (a.replay || !a.started_at ? "felvételről" : `${clock(a.started_at)}–${clock(a.started_at + a.duration_s * 1000)}`) +
    ` · ${hms(a.duration_s)} · ${a.claims || 0} ellenőrzött állítás`;
  speakers = (a.speakers || []).filter((s) => s.start_s != null);

  // the speeches list: who spoke when, a click jumps there
  $("speakers").replaceChildren(...speakers.map((s) => {
    const li = el("li");
    li.dataset.id = s.speech_id;
    const b = el("button", "t-btn", `▶ ${hms(s.start_s)}`);
    b.type = "button";
    b.addEventListener("click", () => seek(s.start_s));
    li.append(b, el("span", null, s.name), el("span", "count", `${s.claims} állítás`));
    return li;
  }));

  // the facts, by their moment in the video (those past the end of the video last)
  const speeches = spSnap.docs.map((d) => d.data());
  facts = speeches.flatMap((sp) => (sp.claims || []).map((c) => ({ c, speech: sp })))
    .sort((x, y) => (x.c.video_s ?? Infinity) - (y.c.video_s ?? Infinity));
  for (const f of facts) f.li = factItem(f);
  $("facts").replaceChildren(...facts.map((f) => f.li));
  $("facts-empty").hidden = facts.length > 0;
  $("fact-count").textContent = facts.length ? `[${String(facts.length).padStart(2, "0")}]` : "";

  // the MPs' photos and roles for the speaker card
  await Promise.all([...new Set(speakers.map((s) => s.mp_id))].map(async (id) => {
    try { mps.set(id, (await getDoc(doc(db, "mps", id))).data() || {}); } catch { /* the card shows initials */ }
  }));

  play(a.video);
}

function play(url) {
  const start = () => { if (startAt) video.currentTime = startAt; tick(); };
  if (window.Hls && Hls.isSupported()) {
    const hls = new Hls({ startPosition: startAt || -1 });
    hls.loadSource(url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => { note(null); start(); if (startAt) video.play().catch(() => {}); });
    hls.on(Hls.Events.ERROR, (_, e) => { if (e.fatal) note("a felvétel most nem érhető el"); });
  } else if (video.canPlayType("application/vnd.apple.mpegurl")) {  // Safari plays HLS itself
    video.src = url;
    video.addEventListener("loadedmetadata", () => { note(null); start(); }, { once: true });
    video.addEventListener("error", () => note("a felvétel most nem érhető el"), { once: true });
  } else {
    note("ez a böngésző nem tudja lejátszani a felvételt");
  }
}

video.addEventListener("timeupdate", tick);
video.addEventListener("seeked", tick);
video.addEventListener("pause", () => history.replaceState(null, "", watchHref(session, video.currentTime)));
$("copy-link").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(shareUrl()); } catch { prompt("A link:", shareUrl()); return; }
  $("copied").hidden = false;
  setTimeout(() => { $("copied").hidden = true; }, 1800);
});
$("to-now").addEventListener("click", () => {
  follow = !follow;
  $("to-now").setAttribute("aria-pressed", String(follow));
  if (follow && current) current.li.scrollIntoView({ block: "nearest", behavior: "smooth" });
});

load().catch((e) => { note("az adás most nem tölthető be"); console.warn(e); });
