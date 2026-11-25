// vitaradar.hu MP page: one MP's fact-checked speeches, their overall scores, and a search over what they said.

import { doc, getDoc, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { searchUrl } from "./config.js?v=202611241021";
import { appCheckHeaders } from "./firebase.js?v=202611241021";
import { db, el, badge, sourceList, setPhoto, hms, huDate, watchLiveNav } from "./common.js?v=202611241206";
import { mountAccount } from "./account.js?v=202611241315";
import { factSocial } from "./social.js?v=202611241315";
import { calendar } from "./calendar.js?v=202611241021";
import { watchHref } from "./links.js?v=202611241021";
import { setPageMeta } from "./meta.js?v=202611241124";

watchLiveNav();
mountAccount();
const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get("id") || "";

function pct(n, total) {
  return total ? `${Math.round((100 * n) / total)}%` : "";
}

function bar(target, t) {
  target.replaceChildren();
  const total = t.true + t.unverifiable + t.false + t.fallacy;
  for (const k of ["true", "unverifiable", "false", "fallacy"]) {
    if (!t[k]) continue;
    const s = el("span", `b-${k}`);
    s.style.width = `${(100 * t[k]) / total}%`;
    target.append(s);
  }
}

const COUNTS = () => ({ true: 0, false: 0, unverifiable: 0, fallacy: 0 });
const weekday = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("hu-HU", { weekday: "long" });

function nums(t) {
  const n = el("span", "nums");
  n.append(el("span", "c-true", `${t.true} igaz`), el("span", "c-false", `${t.false} hamis`),
    el("span", "c-unverifiable", `${t.unverifiable} n.e.`), el("span", "c-fallacy", `${t.fallacy} h.é.`));
  return n;
}

// the fact's moment: a link into the archive's replay when the run's video has it, else its time in the sitting
function factTime(c, session) {
  if (session && c.video_s != null) {
    const a = el("a", "fact-time", `▶ ${hms(c.video_s)}`);
    a.href = watchHref(session, c.video_s);
    a.title = "visszanézés ettől a pillanattól";
    a.addEventListener("click", (e) => e.stopPropagation());  // follow the link, don't fold the fact
    return a;
  }
  return el("span", "fact-time", `T+${hms(c.at_s)}`);
}

// level 3: a fact. Collapsed it shows the verdict and the headline; open, the claim, the explanation and the sources.
function factItem(c, session) {
  const li = el("li", "fact");
  const v = c.kind === "fallacy" ? "fallacy" : c.verdict || "pending";
  li.dataset.verdict = v;
  const det = el("details", "fact-d");
  const sum = el("summary", "fact-sum");
  sum.append(badge(v, c.kind), el("span", "fact-bullet", c.bullet || c.claim), factTime(c, session));
  const body = el("div", "fact-body");
  if (c.claim && c.claim !== c.bullet) body.append(el("p", "fact-claim", c.claim));
  if (c.explanation) body.append(el("p", "fact-expl", c.explanation));
  body.append(sourceList(c.sources));
  if (session && c.id && v !== "pending") body.append(factSocial(session, c.id));  // votes and comments (social.js)
  det.append(sum, body);
  li.append(det);
  return li;
}

// Where a speech's replay starts: a second into it. The link's time is whole seconds, rounded down, and the replay
// names whoever has the floor at that moment, so a start like 1263.6 s opened on the previous speaker.
function replayAt(s) {
  return s.video_start_s == null ? null : Math.ceil(s.video_start_s) + 1;
}

// level 2: a speech, with its facts (and the transcript, where the run saved one)
function speechItem(s, open) {
  const t = { ...COUNTS(), ...(s.counts || {}) };
  const det = el("details", "speech");
  det.id = `speech-${s.id}`;
  det.open = open;
  const sum = el("summary", "speech-head");
  const b = el("div", "bar");
  bar(b, t);
  sum.append(el("span", "lvl-title", `T+${hms(s.start_s)} → T+${hms(s.end_s)}`),
    el("span", "meta", `${hms(s.duration_s)} perc · ${(s.claims || []).length} állítás`), nums(t), b);
  const body = el("div", "speech-body");
  if (s.video_start_s != null) {  // the whole speech in the archive's replay
    const w = el("a", "t-btn", `▶ visszanézés (${hms(s.video_start_s)})`);
    w.href = watchHref(s.session, replayAt(s));
    body.append(w);
  }
  const list = el("ol", "facts");
  (s.claims || []).slice().sort((a, b2) => a.at_s - b2.at_s).forEach((c) => list.append(factItem(c, s.session)));
  if (list.children.length) body.append(list);
  else body.append(el("p", "empty", "ebben a felszólalásban nem volt ellenőrizhető állítás"));
  if (s.has_transcript && s.text) {
    const tr = el("details", "transcript-d");
    tr.append(el("summary", null, `leirat (${s.words} szó)`), el("p", "transcript", s.text));
    body.append(tr);
  }
  det.append(sum, body);
  return det;
}

// level 1: a sitting day, with its speeches
function dayItem(date, speeches, open) {
  const t = COUNTS();
  let claims = 0;
  for (const s of speeches) {
    for (const k of Object.keys(t)) t[k] += (s.counts || {})[k] || 0;
    claims += (s.claims || []).length;
  }
  const det = el("details", "day panel");
  det.id = `day-${date}`;
  det.dataset.date = date;
  det.open = open;
  const sum = el("summary", "day-head");
  const b = el("div", "bar");
  bar(b, t);
  sum.append(el("span", "lvl-title", date ? `${huDate(date)}, ${weekday(date)}` : "ismeretlen nap"),
    el("span", "meta", `${speeches.length} felszólalás · ${claims} állítás`), nums(t), b);
  const body = el("div", "day-body");
  speeches.forEach((s, i) => body.append(speechItem(s, open && i === 0)));
  det.append(sum, body);
  return det;
}

// Phones (css): no facts or quotes, only the statistics and the sitting days, newest first, one card each: the day's
// counts, and when opened, its speeches in the order they were given, each opening its replay in the archive.
const COUNT_NAMES = [["true", "Igaz"], ["false", "Hamis"], ["unverifiable", "N. e."], ["fallacy", "H. é."]];

function countLine(t) {
  const line = el("span", "replay-counts");
  for (const [k, name] of COUNT_NAMES) {
    const c = el("span", null, name);
    c.append(el("b", `c-${k}`, String(t[k])));
    line.append(c);
  }
  return line;
}

function clockOf(ms) {
  return new Date(ms).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Budapest" });
}

// When a speech began, by the clock: its recording's start (archive/{session}.started_at) plus where it is in it.
// Recordings without a start time (replays of a file) fall back to their order on the day.
const starts = new Map();  // session -> started_at (ms) or null

function replays(speeches) {
  let list = document.getElementById("replays");
  if (!list) {
    list = el("ol", "replays");
    list.id = "replays";
    $("speeches").before(list);
  }
  // started_at is where the recording begins: the speech's place in the video (start_s counts from the run's start)
  const at = (s) => (starts.get(s.session) != null ? starts.get(s.session) + (s.video_start_s ?? s.start_s) * 1000 : null);
  const days = new Map();  // speeches come newest first: so do the days
  for (const s of speeches) {
    if (!days.has(s.date)) days.set(s.date, []);
    days.get(s.date).push(s);
  }
  const open = new Set([...list.querySelectorAll(".replay-day")].filter((d) => d.open).map((d) => d.dataset.date));
  list.replaceChildren(...[...days.entries()].map(([date, day]) => {
    day = day.slice().sort((x, y) => (at(x) ?? Infinity) - (at(y) ?? Infinity)
      || x.session.localeCompare(y.session) || x.start_s - y.start_s);
    const t = COUNTS();
    let claims = 0, secs = 0;
    for (const s of day) {
      for (const k of Object.keys(t)) t[k] += (s.counts || {})[k] || 0;
      claims += (s.claims || []).length;
      secs += s.duration_s || 0;
    }
    const li = el("li");
    const det = el("details", "replay-day");
    det.dataset.date = date || "";
    det.open = open.has(det.dataset.date);  // all closed at first, then as the reader left them
    const sum = el("summary", "replay-sum");
    const b = el("div", "bar");
    bar(b, t);
    sum.append(el("span", "replay-date", date ? huDate(date) : "ismeretlen nap"),
      el("span", "replay-meta", `${day.length} felszólalás · ${claims} állítás · ${hms(secs)} perc`),
      el("span", "replay-chev"), countLine(t), b);
    const rows = el("ol", "replay-list");
    day.forEach((s, n) => {
      const st = { ...COUNTS(), ...(s.counts || {}) };
      const from = at(s);
      const row = el("li");
      const a = el("a", "replay");
      a.href = watchHref(s.session, replayAt(s));
      a.append(el("span", "replay-title", from != null
        ? `${clockOf(from)}–${clockOf(from + (s.duration_s || 0) * 1000)}` : `${n + 1}. felszólalás`),
      el("span", "replay-meta", `${hms(s.duration_s)} perc · ${(s.claims || []).length} állítás`),
      el("span", "replay-go"), countLine(st));
      a.setAttribute("aria-label", `${a.querySelector(".replay-title").textContent} visszanézése`);
      row.append(a);
      rows.append(row);
    });
    det.append(sum, rows);
    li.append(det);
    return li;
  }));
  // the recordings' start times, once: then the rows again, in the order they were given, with their times
  const missing = [...new Set(speeches.map((s) => s.session))].filter((x) => !starts.has(x));
  if (!missing.length) return;
  missing.forEach((x) => starts.set(x, null));
  Promise.all(missing.map((x) => getDoc(doc(db, "archive", x)).then((snap) => {
    const a = snap.data() || {};
    starts.set(x, a.replay || !a.started_at ? null : a.started_at);
  }).catch(() => {}))).then(() => replays(speeches));
}

// ------------------------------------------------------------------ days: calendar filter, expand / collapse all
let cal = null;

function showDay(date) {  // null: all days
  for (const d of document.querySelectorAll("#speeches > .day")) {
    d.hidden = Boolean(date) && d.dataset.date !== date;
    if (date && d.dataset.date === date) d.open = true;
  }
  const line = $("day-filter");
  line.replaceChildren();
  if (date) {
    const all = el("button", "linkish", "[ összes nap ]");
    all.type = "button";
    all.addEventListener("click", () => { cal.select(null); showDay(null); });
    line.append(`// ${huDate(date)}, ${weekday(date)} `, all);
  } else {
    line.textContent = `// összes nap (${document.querySelectorAll("#speeches > .day").length})`;
  }
}

function setAll(open) {
  for (const d of document.querySelectorAll("#speeches > .day:not([hidden]), #speeches > .day:not([hidden]) details")) {
    if (!d.classList.contains("transcript-d")) d.open = open;
  }
}

// a link to a speech (#speech-…, e.g. from the search): show its day, open the levels above it, scroll to it
function openTarget() {
  const target = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
  if (!target) return;
  const day = target.closest(".day");
  if (day && day.hidden) { cal.select(null); showDay(null); }
  for (let d = target; d; d = d.parentElement && d.parentElement.closest("details")) d.open = true;
  target.scrollIntoView({ block: "start" });
  target.classList.remove("flash");
  void target.offsetWidth;
  target.classList.add("flash");
}
window.addEventListener("hashchange", openTarget);

async function load() {
  if (!id) { $("mp-name").textContent = "Ismeretlen képviselő"; return; }
  const [mpSnap, speechSnap] = await Promise.all([
    getDoc(doc(db, "mps", id)),
    getDocs(query(collection(db, "speeches"), where("mp_id", "==", id))),
  ]);
  const m = mpSnap.data();
  const speeches = speechSnap.docs.map((d) => d.data())
    .filter((s) => !s.replay_only)  // a second run over the same speeches: its facts are on its replay only
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.start_s - a.start_s);
  if (!m) {
    $("mp-name").textContent = "Nincs adat";
    $("speeches-empty").hidden = false;
    return;
  }
  $("mp-name").textContent = m.name;
  $("mp-meta").textContent = [m.party, m.role].filter(Boolean).join(" · ");
  setPhoto($("mp-img"), $("mp-initials"), m.photo, m.name, { id: m.id, color: m.color });
  const t = { true: 0, false: 0, unverifiable: 0, fallacy: 0, ...(m.totals || {}) };
  setPageMeta({
    title: `${m.name} ellenőrzött állításai – Vitaradar`,
    description: `${m.name}${m.party ? ` (${m.party})` : ""} ${m.claims || 0} ellenőrzött állítása ` +
      `${m.speeches || 0} országgyűlési felszólalásából: ${t.true} igaz, ${t.false} hamis, ` +
      `${t.unverifiable} nem ellenőrizhető, ${t.fallacy} hibás érvelés.`,
    path: `mp.html?id=${encodeURIComponent(id)}`,
  });
  const checked = t.true + t.false + t.unverifiable;
  for (const k of ["true", "false", "unverifiable"]) {
    const dd = $(`s-${k}`);
    dd.textContent = String(t[k]);
    dd.append(el("small", null, pct(t[k], checked)));
  }
  $("s-fallacy").textContent = String(t.fallacy);
  bar($("mp-bar"), t);
  $("mp-line").textContent = `// ${m.claims || 0} állítás ${m.speeches || 0} felszólalásban, összesen ${hms(m.seconds)} perc` +
    (m.last_date ? ` · utoljára: ${huDate(m.last_date)}` : "");

  // days > speeches > facts; the newest day and its first speech open
  const byDay = new Map();
  for (const s of speeches) {
    if (!byDay.has(s.date)) byDay.set(s.date, []);
    byDay.get(s.date).push(s);
  }
  for (const list of byDay.values()) list.sort((a, b) => a.start_s - b.start_s);  // in the order they were given
  const box = $("speeches");
  box.replaceChildren(...[...byDay.entries()].map(([date, list], i) => dayItem(date, list, i === 0)));
  replays(speeches);
  $("speech-count").textContent = speeches.length ? `[${String(speeches.length).padStart(2, "0")}]` : "";
  $("speeches-empty").hidden = speeches.length > 0;
  $("days-tools").hidden = speeches.length === 0;
  cal = calendar($("calendar"), {
    days: new Map([...byDay.entries()].filter(([d]) => d).map(([d, list]) => [d, list.length])),
    onSelect: (date) => showDay(date),
    label: "Ülésnapok, amikor felszólalt",
  });
  showDay(null);
  openTarget();
}

// ------------------------------------------------------------------ search: what did they say about …?
$("search").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const q = $("q").value.trim();
  const note = $("search-note"), hits = $("hits");
  hits.replaceChildren();
  if (q.length < 2) return;
  note.hidden = false;
  note.textContent = "keresés…";
  try {
    const r = await fetch(`${searchUrl}?mp=${encodeURIComponent(id)}&q=${encodeURIComponent(q)}`,
      { headers: await appCheckHeaders() });  // only the site may search: App Check (reCAPTCHA Enterprise)
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    note.textContent = data.hits.length ? `${data.hits.length} találat, a legközelebbi jelentésűek elöl` : "nincs találat";
    for (const h of data.hits) {
      const li = el("li", "hit panel");
      const top = el("div", "hit-top");
      const a = el("a", null, `${huDate(h.date)} · T+${hms(h.at_s)}`);
      a.href = `#speech-${h.speech_id}`;
      top.append(el("span", "hit-score", `${Math.round(h.score * 100)}% egyezés`), a);
      const at = h.video_s ?? h.at_s;  // the passage's moment in the archive's video
      if (h.session && at != null) {
        const w = el("a", "fact-time", `▶ ${hms(at)}`);
        w.href = watchHref(h.session, at);
        w.title = "visszanézés ettől a pillanattól";
        top.append(w);
      }
      li.append(top, el("p", null, h.text));
      hits.append(li);
    }
  } catch (e) {
    note.textContent = "a keresés most nem érhető el";
    console.warn("search:", e);
  }
});

$("expand-all").addEventListener("click", () => setAll(true));
$("collapse-all").addEventListener("click", () => setAll(false));

load().catch((e) => { $("mp-name").textContent = "Az adatok most nem tölthetők be"; console.warn(e); });
