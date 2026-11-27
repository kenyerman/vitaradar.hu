// vitaradar.hu archive: the past streams, newest sitting day first, each run a card that opens the replay.
//
// Phones: the list of days, each run a compact row. Wider screens (css): the same rows in columns (the picture, the
// time and length, the speakers' photos and names, the claims, the verdicts) and beside them a sidebar: the month's
// calendar (each sitting day with the bar of its verdicts; a click goes to the day and shows its numbers under the
// calendar), a filter by MP name and by party, and the totals. The parts only the wider screens show are in the cards from the start, hidden on phones (css).

import { collection } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, getDocs, el, hms, huDate, initials, watchLiveNav, loadFailed } from "./common.js?v=202611272300";
import { mountAccount } from "./account.js?v=202611270341";
import { watchHref } from "./links.js?v=202611241021";
import { cdnReady, cdnUrl } from "./cdn.js?v=202611272300";

watchLiveNav();
mountAccount();
const days = document.getElementById("days"), empty = document.getElementById("arch-empty");
const side = document.getElementById("arch-side"), none = document.getElementById("arch-none");

function clock(ms) {
  return new Date(ms).toLocaleTimeString("hu-HU", { hour: "2-digit", minute: "2-digit" });
}

// "11:31–11:48" for a live run; a replay of a recording has no time of day
function timeRange(a) {
  if (a.replay || !a.started_at) return "felvételről";
  return `${clock(a.started_at)}–${clock(a.started_at + a.duration_s * 1000)}`;
}

const num = (n) => (n || 0).toLocaleString("hu-HU");
const WEEKDAYS = ["vasárnap", "hétfő", "kedd", "szerda", "csütörtök", "péntek", "szombat"];
const weekday = (iso) => WEEKDAYS[new Date(`${iso}T12:00:00`).getDay()];
// for the filter: "Rétvári" finds "retvari" and the other way round
const fold = (s) => (s || "").normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

// The verdicts, in the live page's tally order: the bar and the count list beside it. The first four always show;
// the extended ones only when there are any (older sittings have none).
const BAR = ["true", "partly_true", "misleading", "false", "opinion", "promise", "unverifiable", "fallacy"];
const BASE = new Set(["true", "false", "unverifiable", "fallacy"]);
const NAMES = { true: "igaz", partly_true: "részben igaz", misleading: "félrevezető", false: "hamis", opinion: "vélemény",
  promise: "ígéret", unverifiable: "nem ellenőrizhető", fallacy: "hibás érvelés" };
const listed = (t) => BAR.filter((k) => BASE.has(k) || t[k] > 0);
const MINI = [["true", "igaz"], ["false", "hamis"], ["fallacy", "hibás"]];  // the row's short count line (wider screens)

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

// The speakers' photos and party colours, from the runs' floor turns (newer runs have them): one MP's photo serves
// every run they spoke in, a party's colour every speaker of it. No photo: their initials on the party's colour.
const OFFICIAL = /\/kepviselo-kepek\/([A-Za-z0-9]+)$/;  // as js/common.js setPhoto: our cut-out of an official photo
const looks = new Map(), partyColor = new Map();
function learn(all) {
  for (const a of all) {
    for (const t of a.turns || []) {
      if (!t.speaker_id || t.speaker_id === "?") continue;
      const was = looks.get(t.speaker_id) || {};
      looks.set(t.speaker_id, { photo: was.photo || t.photo || null, color: was.color || t.color || null });
      if (t.party && t.color && !partyColor.has(t.party)) partyColor.set(t.party, t.color);
    }
  }
}

// Each speaker of a run once, in the order they first spoke, with their claims in the run
function speakers(a) {
  const by = new Map();
  for (const s of a.speakers || []) {
    const k = s.mp_id || s.name;
    if (!by.has(k)) by.set(k, { ...s, claims: 0 });
    by.get(k).claims += s.claims || 0;
  }
  return [...by.values()];
}

function face(s) {
  const look = looks.get(s.mp_id) || {};
  const f = el("span", "arch-face");
  f.title = s.name;
  const color = look.color || partyColor.get(s.party);
  if (color) f.style.setProperty("--party", color);
  f.append(el("span", "arch-face-ini", initials(s.name)));
  const m = look.photo && look.photo.match(OFFICIAL);
  const sources = [m && `img/mps/${m[1]}.webp`, look.photo && cdnUrl(look.photo)].filter(Boolean);
  if (sources.length) {
    const img = el("img");
    img.alt = "";
    img.loading = "lazy";
    let i = 0;
    img.onerror = () => { i += 1; if (i < sources.length) img.src = sources[i]; else img.remove(); };
    cdnReady().then(() => { img.src = sources[0]; });
    f.append(img);
  }
  return f;
}

// The photos of the ones with the most claims (in the order they spoke), and how many more spoke
function faces(sp, n = 7) {
  const box = el("span", "arch-faces");
  const shown = new Set([...sp].sort((x, y) => y.claims - x.claims).slice(0, n));
  box.append(...sp.filter((s) => shown.has(s)).map(face));
  if (sp.length > n) box.append(el("span", "arch-more", `+${sp.length - n}`));
  return box;
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
  // phones: the wrappers below are not boxes (display: contents), so the rows stay the time, the names and the bar
  const when = el("div", "arch-when");
  when.append(el("h3", null, timeRange(a)), el("span", "arch-dur", hms(a.duration_s)));
  const sp = speakers(a);
  const names = [...new Set(sp.map((s) => s.name))];
  const people = el("div", "arch-people");
  people.append(faces(sp), el("p", "arch-who", names.length
    ? names.slice(0, 4).join(", ") + (names.length > 4 ? ` +${names.length - 4}` : "") : "–"));
  const claims = el("span", "arch-n");
  claims.append(el("b", null, num(a.claims)), "állítás");
  const verdicts = el("div", "arch-verdicts");
  if (a.has_facts) {
    const mini = el("p", "arch-mini");
    for (const [k, label] of MINI) {
      const s = el("span");
      s.append(el("b", `c-${k}`, num(t[k])), ` ${label}`);
      mini.append(s);
    }
    verdicts.append(bar(t), mini);
    const stats = el("dl", "mp-stats");
    for (const [label, value, cls] of [...listed(t).map((k) => [NAMES[k], t[k] || 0, `c-${k}`]),
      ["állítás összesen", a.claims || 0, ""]]) {
      const row = el("div");
      row.append(el("dt", null, label), el("dd", cls, String(value)));
      stats.append(row);
    }
    verdicts.append(stats);
  } else {
    verdicts.append(el("p", "empty", "ehhez a részhez nincsenek ellenőrzött állítások"));
  }
  body.append(when, people, claims, verdicts);
  link.append(poster, body);
  li.append(link);
  li.searchable = sp.map((s) => ({ name: fold(s.name), party: s.party || "" }));  // for the filter
  return li;
}

// ------------------------------------------------------------------ the sidebar (wider screens)
const MONTHS = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember",
  "október", "november", "december"];
const todayIso = () => new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Budapest" });  // YYYY-MM-DD

function sidebar(dayList, sections) {
  const byDate = new Map(dayList.map((d) => [d.date, d]));
  const months = [...new Set(dayList.map((d) => d.date.slice(0, 7)))].sort();  // the months with sittings
  // selected: the day shown under the calendar (the newest at first); matching: the dates the filter leaves
  let month = months[months.length - 1], selected = dayList[0].date, matching = null;

  // the calendar: the month's days, Monday first; a sitting day a button with the bar of its verdicts; under it the
  // day picked: its parts, length, claims and bar
  const cal = el("section", "arch-box arch-cal");
  const head = el("div", "arch-cal-head");
  const prev = el("button", "cal-nav", "‹"), next = el("button", "cal-nav", "›");
  prev.type = next.type = "button";
  prev.setAttribute("aria-label", "Előző hónap");
  next.setAttribute("aria-label", "Következő hónap");
  const title = el("h2", "arch-cal-title");
  head.append(prev, title, next);
  const grid = el("div", "arch-cal-grid");
  const pick = el("div", "arch-cal-pick");
  pick.setAttribute("aria-live", "polite");
  cal.append(head, grid, pick);

  function drawPick() {
    const day = byDate.get(selected);
    const h = el("p", "arch-cal-pick-h",
      `${new Date(`${selected}T12:00:00`).toLocaleDateString("hu-HU", { month: "short", day: "numeric" })} · ${weekday(selected)}`);
    pick.replaceChildren(h, el("p", "arch-cal-pick-meta",
      `${day.runs.length} rész · ${hms(day.dur)} · ${num(day.claims)} állítás`), bar(day.counts));
  }

  function drawMonth() {
    const [y, m] = month.split("-").map(Number);
    title.textContent = `${y}. ${MONTHS[m - 1]}`;
    const at = months.indexOf(month);
    prev.disabled = at <= 0;
    next.disabled = at >= months.length - 1;
    const cells = ["H", "K", "SZ", "CS", "P", "SZ", "V"].map((w) => el("span", "arch-cal-wd", w));
    const first = new Date(y, m - 1, 1);
    for (let i = 0; i < (first.getDay() + 6) % 7; i++) cells.push(el("span"));
    const today = todayIso();
    for (let d = 1; d <= new Date(y, m, 0).getDate(); d++) {
      const iso = `${month}-${String(d).padStart(2, "0")}`;
      const day = byDate.get(iso);
      if (!day) {
        cells.push(el("span", `arch-cal-day${iso === today ? " today" : ""}`, String(d)));
        continue;
      }
      const b = el("button", "arch-cal-day has");
      b.type = "button";
      b.append(el("span", null, String(d)), bar(day.counts));
      b.setAttribute("aria-pressed", String(iso === selected));
      if (matching && !matching.has(iso)) b.classList.add("off");
      b.setAttribute("aria-label", `${huDate(iso)}: ${day.runs.length} rész, ${num(day.claims)} állítás`);
      b.dataset.iso = iso;
      b.addEventListener("click", () => {
        selected = iso;
        drawMonth();
        drawPick();
        grid.querySelector(`[data-iso="${iso}"]`)?.focus({ preventScroll: true });  // the day redrawn: the focus stays on it
        sections.get(iso)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      });
      cells.push(b);
    }
    grid.replaceChildren(...cells);
  }
  prev.addEventListener("click", () => { month = months[months.indexOf(month) - 1]; drawMonth(); });
  next.addEventListener("click", () => { month = months[months.indexOf(month) + 1]; drawMonth(); });

  // the filter: an MP's name (any part of it, accents or not), and the parties (any of the ones pressed)
  const filter = el("section", "arch-box arch-filter");
  const field = el("input", "field");
  field.type = "search";
  field.placeholder = "Képviselő neve…";
  field.setAttribute("aria-label", "Szűrés képviselő nevére");
  const chips = el("div", "arch-chips");
  const parties = new Map();
  for (const d of dayList) for (const li of d.items) for (const p of new Set(li.searchable.map((s) => s.party).filter(Boolean))) {
    parties.set(p, (parties.get(p) || 0) + 1);
  }
  const pressed = new Set();
  for (const [p, n] of [...parties].sort((x, y) => y[1] - x[1])) {
    const b = el("button", "arch-chip");
    b.type = "button";
    b.setAttribute("aria-pressed", "false");
    if (partyColor.has(p)) b.style.setProperty("--party", partyColor.get(p));
    b.append(p, el("small", null, String(n)));
    b.title = `${n} részben szólalt fel`;
    b.addEventListener("click", () => {
      if (pressed.has(p)) pressed.delete(p); else pressed.add(p);
      b.setAttribute("aria-pressed", String(pressed.has(p)));
      apply();
    });
    chips.append(b);
  }
  filter.append(el("h2", "arch-h", "Szűrés"), field, chips);
  field.addEventListener("input", apply);

  // the totals: everything, or what the filter leaves
  const totals = el("section", "arch-box arch-totals");
  const totH = el("h2", "arch-h"), totL = el("ul");
  totals.append(totH, totL);
  function count(items) {
    const shownDays = dayList.filter((d) => d.items.some((li) => items.has(li)));
    const runs = shownDays.flatMap((d) => d.runs.filter((_, k) => items.has(d.items[k])));
    const line = (...parts) => { const li = el("li"); li.append(...parts); return li; };
    totL.replaceChildren(
      line(el("b", null, String(shownDays.length)), " ülésnap · ", el("b", null, String(runs.length)), " rész"),
      line(el("b", null, hms(runs.reduce((n, a) => n + (a.duration_s || 0), 0))), " felvétel"),
      line(el("b", null, num(runs.reduce((n, a) => n + (a.claims || 0), 0))), " ellenőrzött állítás"));
  }

  function apply() {
    const q = fold(field.value.trim());
    const active = Boolean(q || pressed.size);
    const items = new Set();
    matching = active ? new Set() : null;
    for (const d of dayList) {
      let any = false;
      for (const li of d.items) {
        const ok = !active || li.searchable.some((s) => (!q || s.name.includes(q)) && (!pressed.size || pressed.has(s.party)));
        li.hidden = !ok;
        if (ok) { items.add(li); any = true; }
      }
      sections.get(d.date).hidden = !any;
      if (any && matching) matching.add(d.date);
    }
    none.hidden = items.size > 0;
    totH.textContent = active ? "Találatok" : "Összesen";
    count(items);
    drawMonth();
  }

  drawPick();
  apply();
  side.replaceChildren(cal, filter, totals);
  side.hidden = false;
}

getDocs(collection(db, "archive")).then((snap) => {
  const all = snap.docs.map((d) => d.data()).filter((a) => a.video);
  learn(all);
  const byDay = new Map();
  for (const a of all) {
    if (!byDay.has(a.date)) byDay.set(a.date, []);
    byDay.get(a.date).push(a);
  }
  const dates = [...byDay.keys()].sort().reverse();
  const dayList = [], sections = new Map();
  days.replaceChildren(...dates.map((d) => {
    const sec = el("section", "arch-day");
    const runs = byDay.get(d).sort((x, y) => (x.started_at || 0) - (y.started_at || 0));
    const claims = runs.reduce((n, a) => n + (a.claims || 0), 0);
    const dur = runs.reduce((n, a) => n + (a.duration_s || 0), 0);
    const counts = Object.fromEntries(BAR.map((k) => [k, runs.reduce((n, a) => n + ((a.counts || {})[k] || 0), 0)]));
    const date = el("h2", "arch-date");
    date.append(el("span", "arch-slashes", "// "), huDate(d), el("span", "arch-wd", weekday(d)));  // phones leave the slashes and the weekday out (css)
    const line = el("p", "count-line", `${runs.length} rész · összesen ${hms(dur)}`);
    line.append(el("span", "arch-claims", ` · ${num(claims)} állítás`));  // wider screens
    sec.append(date, line);
    const grid = el("ol", "arch-grid");
    const items = runs.map(card);
    grid.append(...items);
    sec.append(grid);
    dayList.push({ date: d, runs, items, claims, dur, counts });
    sections.set(d, sec);
    return sec;
  }));
  empty.hidden = all.length > 0;
  if (all.length) sidebar(dayList, sections);
}).catch((e) => { loadFailed(empty, "az archívum most nem tölthető be"); console.warn(e); });
