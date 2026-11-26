// vitaradar.hu archive: the past streams, newest sitting day first, each run a card that opens the replay.

import { collection } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, getDocs, el, hms, huDate, watchLiveNav } from "./common.js?v=202611262130";
import { mountAccount } from "./account.js?v=202611262130";
import { watchHref } from "./links.js?v=202611241021";
import { cdnReady, cdnUrl } from "./cdn.js?v=202611260345";

watchLiveNav();
mountAccount();
const days = document.getElementById("days"), empty = document.getElementById("arch-empty");

function clock(ms) {
  return new Date(ms).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" });
}

// "11:31–11:48" for a live run; a replay of a recording has no time of day
function timeRange(a) {
  if (a.replay || !a.started_at) return "felvételről";
  return `${clock(a.started_at)}–${clock(a.started_at + a.duration_s * 1000)}`;
}

// The verdicts, in the live page's tally order: the bar and the count list beside it. The first four always show;
// the extended ones only when there are any (older sittings have none).
const BAR = ["true", "partly_true", "misleading", "false", "opinion", "promise", "unverifiable", "fallacy"];
const BASE = new Set(["true", "false", "unverifiable", "fallacy"]);
const NAMES = { true: "igaz", partly_true: "részben igaz", misleading: "félrevezető", false: "hamis", opinion: "vélemény",
  promise: "ígéret", unverifiable: "nem ellenőrizhető", fallacy: "hibás érvelés" };
const listed = (t) => BAR.filter((k) => BASE.has(k) || t[k] > 0);

function bar(t) {
  const b = el("div", "bar");
  const total = BAR.reduce((n, k) => n + (t[k] || 0), 0);
  for (const k of BAR) {
    if (!t[k]) continue;
    const s = el("span", `b-${k}`);
    s.style.width = `${(100 * t[k]) / total}%`;
    b.append(s);
  }
  return b;
}

function card(a, i) {  // i: its place in the list (runs.map)
  const t = { true: 0, false: 0, unverifiable: 0, fallacy: 0, ...(a.counts || {}) };
  const li = el("li");
  const link = el("a", "arch-card panel");
  link.href = watchHref(a.session);
  const poster = el("div", "arch-poster");
  if (a.poster) {
    const img = el("img");
    if (i < 2) img.fetchPriority = i === 0 ? "high" : "auto";  // the first posters are on screen at once: no lazy loading
    else img.loading = "lazy";
    img.alt = "";
    img.onerror = () => img.remove();
    cdnReady().then(() => { img.src = cdnUrl(a.poster); });  // cdn.vitaradar.hu, after its cookie
    poster.append(img);
  }
  poster.append(el("span", "arch-len", hms(a.duration_s)));
  if (!a.youtube) poster.append(el("span", "arch-wait", "feltöltés alatt"));  // replays play from YouTube (watch.js)
  const body = el("div", "arch-body");
  body.append(el("h3", null, timeRange(a)));
  const names = [...new Set((a.speakers || []).map((s) => s.name))];
  body.append(el("p", "arch-who", names.length ? names.slice(0, 4).join(", ") + (names.length > 4 ? ` +${names.length - 4}` : "")
    : "–"));
  if (a.has_facts) {
    body.append(bar(t));
    const stats = el("dl", "mp-stats");
    for (const [label, value, cls] of [...listed(t).map((k) => [NAMES[k], t[k] || 0, `c-${k}`]),
      ["állítás összesen", a.claims || 0, ""]]) {
      const row = el("div");
      row.append(el("dt", null, label), el("dd", cls, String(value)));
      stats.append(row);
    }
    body.append(stats);
  } else {
    body.append(el("p", "empty", "ehhez a részhez nincsenek ellenőrzött állítások"));
  }
  link.append(poster, body);
  li.append(link);
  return li;
}

getDocs(collection(db, "archive")).then((snap) => {
  const all = snap.docs.map((d) => d.data()).filter((a) => a.video);
  const byDay = new Map();
  for (const a of all) {
    if (!byDay.has(a.date)) byDay.set(a.date, []);
    byDay.get(a.date).push(a);
  }
  const dates = [...byDay.keys()].sort().reverse();
  days.replaceChildren(...dates.map((d) => {
    const sec = el("section", "arch-day");
    const runs = byDay.get(d).sort((x, y) => (x.started_at || 0) - (y.started_at || 0));
    const date = el("h2", "arch-date");
    date.append(el("span", "arch-slashes", "// "), huDate(d));  // phones leave the slashes out (css)
    sec.append(date,
      el("p", "count-line", `${runs.length} rész · összesen ${hms(runs.reduce((n, a) => n + (a.duration_s || 0), 0))}`));
    const grid = el("ol", "arch-grid");
    grid.append(...runs.map(card));
    sec.append(grid);
    return sec;
  }));
  empty.hidden = all.length > 0;
}).catch((e) => { empty.hidden = false; empty.textContent = "az archívum most nem tölthető be"; console.warn(e); });
