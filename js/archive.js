// vitaradar.hu archive: the past streams, newest sitting day first, each run a card that opens the replay.

import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, el, hms, huDate, watchLiveBadge } from "./common.js?v=202611241300";
import { mountAccount } from "./account.js?v=202611241300";
import { watchHref } from "./links.js?v=202611241300";

watchLiveBadge();
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

function bar(t) {
  const b = el("div", "bar");
  const total = t.true + t.unverifiable + t.false + t.fallacy;
  for (const k of ["true", "unverifiable", "false", "fallacy"]) {
    if (!t[k]) continue;
    const s = el("span", `b-${k}`);
    s.style.width = `${(100 * t[k]) / total}%`;
    b.append(s);
  }
  return b;
}

function card(a) {
  const t = { true: 0, false: 0, unverifiable: 0, fallacy: 0, ...(a.counts || {}) };
  const li = el("li");
  const link = el("a", "arch-card panel");
  link.href = watchHref(a.session);
  const poster = el("div", "arch-poster");
  if (a.poster) {
    const img = el("img");
    img.loading = "lazy";
    img.alt = "";
    img.onerror = () => img.remove();
    img.src = a.poster;
    poster.append(img);
  }
  poster.append(el("span", "arch-len", hms(a.duration_s)));
  const body = el("div", "arch-body");
  body.append(el("h3", null, timeRange(a)));
  const names = [...new Set((a.speakers || []).map((s) => s.name))];
  body.append(el("p", "arch-who", names.length ? names.slice(0, 4).join(", ") + (names.length > 4 ? ` +${names.length - 4}` : "")
    : "–"));
  if (a.has_facts) {
    body.append(bar(t));
    const stats = el("dl", "mp-stats");
    for (const [label, value, cls] of [["igaz", t.true, "c-true"], ["nem ellenőrizhető", t.unverifiable, "c-unverifiable"],
      ["hamis", t.false, "c-false"], ["hibás érvelés", t.fallacy, "c-fallacy"], ["állítás összesen", a.claims || 0, ""]]) {
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
    sec.append(el("h2", "arch-date", `// ${huDate(d)}`),
      el("p", "count-line", `${runs.length} rész · összesen ${hms(runs.reduce((n, a) => n + (a.duration_s || 0), 0))}`));
    const grid = el("ol", "arch-grid");
    grid.append(...runs.map(card));
    sec.append(grid);
    return sec;
  }));
  empty.hidden = all.length > 0;
}).catch((e) => { empty.hidden = false; empty.textContent = "az archívum most nem tölthető be"; console.warn(e); });
