// vitaradar.hu replay: a past stream (watch.html?s=<session>&t=<seconds>) with its facts and speakers.
//
// The archive's video is the stream as it was broadcast, overlay included. Below it the run's facts, newest first,
// like the live page: by default only those said up to the video's current moment, so new ones appear on top as it
// plays (and seeking back hides the later ones); "összes állítás" lists every fact, those still to come dimmed. A
// click on a fact's time jumps there, the latest fact said is highlighted, and the speaker card follows the video:
// whoever had the floor, the chair included (the archive's floor turns; runs archived before them have only the
// fact-checked speeches, so their card is empty while the chair speaks).
// ?t= opens the video at that second (the MP page's fact links).

import { doc, getDoc, onSnapshot, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, el, badge, sourceList, setPhoto, hms, huDate, mpHref, watchLiveNav } from "./common.js?v=202611250130";
import { mountAccount } from "./account.js?v=202611260300";
import { factSocial } from "./social.js?v=202611260300";
import { watchHref } from "./links.js?v=202611241021";
import { cdnReady, cdnUrl, cdnXhr } from "./cdn.js?v=202611241021";
import { scrollHint } from "./scrollhint.js?v=202611241021";
import { setPageMeta } from "./meta.js?v=202611241124";
import { youtubeMedia } from "./ytplayer.js?v=202611241433";

watchLiveNav();
mountAccount();
scrollHint(document.querySelector(".below"), document.querySelector(".player"));  // the facts, when the full-width player hides them
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const session = params.get("s") || "";
const startAt = Math.max(0, parseFloat(params.get("t") || "0") || 0);
const video = $("video");
let media = video;  // the <video>, or the YouTube player behind the same calls (ytplayer.js)
let facts = [];      // {c, speech, li}, newest first (those past the end of the video at the top)
let speakers = [];   // archive doc's speeches: {mp_id, name, party, start_s, end_s}
let turns = [];      // archive doc's floor turns: {speaker_id, name, party, role, color, photo, chair, start_s, end_s}
const mps = new Map();  // mp id -> mps doc (photo, colour, role)
let showAll = false;  // the "összes állítás" toggle

function note(text) {
  $("player-note").hidden = !text;
  if (text) $("player-note").textContent = text;
}

function clock(ms) {
  return new Date(ms).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" });
}

function seek(t, play = true) {
  media.currentTime = t;
  if (play) media.play().catch(() => {});
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

// who the card shows at t: the floor holder (the last turn started by then), else the speech playing
function cardAt(t) {
  if (turns.length) {
    let x = null;
    for (const u of turns) { if (u.start_s <= t) x = u; else break; }
    return x && { key: `${x.speaker_id}|${x.start_s}`, id: x.speaker_id, name: x.name || "Ismeretlen felszólaló",
      party: x.party, role: x.role, color: x.color, photo: x.photo };
  }
  const s = speakerAt(t);
  if (!s) return null;
  const m = mps.get(s.mp_id) || {};
  return { key: s.speech_id, id: s.mp_id, name: s.name, party: s.party, role: m.role, color: m.color, photo: m.photo };
}

let shownCard, shownSpeech;
function renderSpeaker(t) {
  const c = cardAt(t);
  const key = c ? c.key : null;
  if (key !== shownCard) {
    shownCard = key;
    $("speaker").dataset.empty = String(!c);
    $("speaker-name").textContent = c ? c.name : "–";
    const mp = Boolean(c && c.id && c.id !== "?" && !c.id.startsWith("cap_"));  // captioned guests have no MP page
    if (mp) $("speaker-name").href = mpHref(c.id); else $("speaker-name").removeAttribute("href");
    $("speaker-party").textContent = c ? c.party || "" : "";
    $("speaker-party").hidden = !$("speaker-party").textContent;
    $("speaker-role").textContent = c ? c.role || "" : "";
    $("speaker").style.setProperty("--party", c && c.color ? c.color : "");
    setPhoto($("speaker-img"), $("speaker-initials"), c && c.photo, c ? c.name : "", { id: c && c.id, color: c && c.color });
  }
  const s = speakerAt(t);  // the speeches list marks the speech playing
  const sk = s ? s.speech_id : null;
  if (sk === shownSpeech) return;
  shownSpeech = sk;
  document.querySelectorAll(".speaker-list li").forEach((li) => li.classList.toggle("now", li.dataset.id === sk));
}

let current = null;
function renderFacts(t) {
  let now = null, shown = 0;
  for (const f of facts) {  // newest first: the first one already said is the latest
    const said = f.c.video_s != null && f.c.video_s <= t + 0.5;
    f.li.classList.toggle("future", !said);
    f.li.hidden = !said && !showAll;
    if (!f.li.hidden) shown += 1;
    if (said && !now) now = f;
  }
  if (now !== current) {
    if (current) current.li.classList.remove("now");
    current = now;
    if (current) current.li.classList.add("now");
  }
  $("fact-count").textContent = facts.length
    ? `[${String(shown).padStart(2, "0")}${shown < facts.length ? `/${String(facts.length).padStart(2, "0")}` : ""}]` : "";
  $("facts-empty").hidden = shown > 0;
  $("facts-empty").textContent = facts.length
    ? "a felvétel ezen pontjáig még nem hangzott el ellenőrzött állítás" : "ehhez a részhez nincsenek ellenőrzött állítások";
}

function tick() {
  const t = media.currentTime;
  renderFacts(t);
  renderSpeaker(t);
}

function shareUrl() {
  return new URL(watchHref(session, media.currentTime), location.href).href;
}

async function load() {
  if (!session) { $("w-title").textContent = "Ismeretlen adás"; note("nincs ilyen adás"); return; }
  const [aSnap, spSnap] = await Promise.all([
    getDoc(doc(db, "archive", session)),
    getDocs(query(collection(db, "speeches"), where("session", "==", session))),
  ]);
  const a = aSnap.data();
  if (!a) { $("w-title").textContent = "Nincs ilyen adás"; note("ez az adás nincs az archívumban"); return; }
  setPageMeta({
    title: `Ülés visszanézése: ${huDate(a.date)} – Vitaradar`,
    description: `Az Országgyűlés ülésének felvétele (${huDate(a.date)}) ${a.claims || 0} ellenőrzött állítással: ` +
      "mindegyik akkor jelenik meg, amikor a videóban elhangzik.",
    path: `watch.html?s=${encodeURIComponent(session)}`,
  });
  $("w-title").textContent = `// ${huDate(a.date)}`;
  $("w-sub").textContent = (a.replay || !a.started_at ? "felvételről" : `${clock(a.started_at)}–${clock(a.started_at + a.duration_s * 1000)}`) +
    ` · ${hms(a.duration_s)} · ${a.claims || 0} ellenőrzött állítás`;
  speakers = (a.speakers || []).filter((s) => s.start_s != null);
  turns = (a.turns || []).filter((u) => u.start_s != null).sort((x, y) => x.start_s - y.start_s);

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

  // the facts, newest first (those said after the end of the video at the very top)
  const speeches = spSnap.docs.map((d) => d.data());
  const at = (f) => f.c.video_s ?? Number.MAX_SAFE_INTEGER;
  facts = speeches.flatMap((sp) => (sp.claims || []).map((c) => ({ c, speech: sp })))
    .sort((x, y) => at(y) - at(x));
  for (const f of facts) f.li = factItem(f);
  $("facts").replaceChildren(...facts.map((f) => f.li));
  renderFacts(startAt);  // the speaker card waits for the MPs' photos (play() ticks)

  // the MPs' photos and roles for the speaker card
  await Promise.all([...new Set(speakers.map((s) => s.mp_id))].map(async (id) => {
    try { mps.set(id, (await getDoc(doc(db, "mps", id))).data() || {}); } catch { /* the card shows initials */ }
  }));

  // The recording plays from YouTube (pfc uploads every archived run there). Until it is up, the poster and every
  // fact; the player comes as soon as the upload lands. ?yt=<id> plays a given YouTube video (testing); ?player=cdn
  // our own archive on cdn.vitaradar.hu (which serves only images for now).
  const yt = params.get("yt") || (params.get("player") === "cdn" ? null : a.youtube);
  if (yt) {
    await mountYoutube(yt);
    return;
  }
  if (params.get("player") !== "cdn") {
    waitForUpload(a);
    return;
  }
  wire(video);
  await Promise.all([loadHls(), cdnReady()]);  // the recording is on cdn.vitaradar.hu, which needs its cookie
  play(cdnUrl(a.video));
}

async function mountYoutube(id) {
  video.hidden = true;
  media = await youtubeMedia(video.parentElement, id, startAt);
  wire(media);
  note(null);
  $("player-note").classList.remove("over-poster");
  tick();
}

// Not on YouTube yet: the poster, every fact listed (none is "said" before the video plays), and the player once the
// upload lands (archive/{session}.youtube is written when YouTube has processed the video).
function waitForUpload(a) {
  video.controls = false;
  if (a.poster) cdnReady().then(() => { video.poster = cdnUrl(a.poster); }).catch(() => {});
  note("a felvétel feltöltése folyamatban, hamarosan itt visszanézhető");
  $("player-note").classList.add("over-poster");
  renderFacts(Number.MAX_SAFE_INTEGER);
  if (current) current.li.classList.remove("now");
  current = null;
  const stop = onSnapshot(doc(db, "archive", session), (snap) => {
    const id = (snap.data() || {}).youtube;
    if (!id) return;
    stop();
    mountYoutube(id);
  }, () => {});
}

// hls.js (about 100 KB) only for ?player=cdn; Safari plays HLS itself
const HLS_JS = "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js";
function loadHls() {
  if (window.Hls) return Promise.resolve();
  return new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = HLS_JS;
    s.onload = s.onerror = () => resolve();
    document.head.append(s);
  });
}

function wire(m) {
  m.addEventListener("timeupdate", tick);
  m.addEventListener("seeked", tick);
  m.addEventListener("pause", () => history.replaceState(null, "", watchHref(session, media.currentTime)));
}

function play(url) {
  const start = () => { if (startAt) video.currentTime = startAt; tick(); };
  if (window.Hls && Hls.isSupported()) {
    const hls = new Hls({ startPosition: startAt || -1, xhrSetup: cdnXhr });
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

$("copy-link").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(shareUrl()); } catch { prompt("A link:", shareUrl()); return; }
  $("copied").hidden = false;
  setTimeout(() => { $("copied").hidden = true; }, 1800);
});
$("show-all").addEventListener("click", () => {
  showAll = !showAll;
  $("show-all").setAttribute("aria-pressed", String(showAll));
  renderFacts(media.currentTime);
});

load().catch((e) => { note("az adás most nem tölthető be"); console.warn(e); });
