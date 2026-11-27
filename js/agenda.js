// vitaradar.hu: the sitting's agenda and where the sitting is in it. Plain JavaScript, no build step.
//
// live/agenda is the week's accepted agenda, as parlament.hu publishes it (pfc agenda: the "Napirend" PDF, the planned
// questions and the speeches before the agenda). It holds every sitting day of the week; the page shows today's, else
// the next one, else the last one. live/agenda_progress is where the sitting is: the publisher's marks, each an item
// (and a question) with the moment it began on the stream's clock (`at`, ms), written once the page's clock has reached
// it. A viewer behind the stream sees an item begin when their video gets there, as the facts do.
//
// mountAgenda(box, { now, live, onState }) fills `box` and keeps it current; `now()` is the frame on screen's date (the
// stream's clock), null when unknown; `live()` whether the broadcast is on. onState({ live, n, total, next }) tells
// the page what to show elsewhere: the tab's live dot, the note when nothing is on air.

import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, el } from "./common.js?v=202611291700";

const TZ = "Europe/Budapest";
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());  // 2026-11-30
const dayName = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("hu-HU", { timeZone: TZ, weekday: "long" });
const dayDate = (date) => new Date(`${date}T12:00:00Z`).toLocaleDateString("hu-HU", { timeZone: TZ, month: "long", day: "numeric" });
const hm = (ms) => new Date(ms).toLocaleTimeString("hu-HU", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

// what the parlament.hu agenda calls its sections, shorter
const GROUPS = {
  "Napirend előtt": "Napirend előtt",
  "Döntések, határozathozatalok": "Döntések, határozathozatalok",
  "Napirendi pontok tárgyalási sorrendje": "Napirendi pontok",
  "A határozathozatalokat követően": "A határozathozatalok után",
  "Az általános viták a lezárásig": "Általános viták",
  "A bizottsági jelentések és az összegző módosító javaslatok vitái": "Bizottsági jelentések vitái",
  "Vita a Törvényalkotási Bizottság jelentéséről és módosító javaslatáról": "A TAB jelentésének vitája",
  "Napirend után": "Napirend után",
};
const FLAG_TEXT = { two_thirds: "kétharmados", eu: "uniós", nationality: "nemzetiségi", quorum: "határozatképesség kell" };

// the day to show: today's, else the next sitting day, else the last one; with what it is to today. Today's counts
// until half an hour after its start, and after that while the broadcast is on: a sitting day whose broadcast is over
// (or never came) gives way to the next one.
const GRACE_MS = 30 * 60 * 1000;
export function pickDay(agenda, { live = false, at = Date.now(), date = today() } = {}) {
  const days = (agenda && agenda.days) || [];
  const on = (x) => x.date === date && (live || !x.start_at || at < x.start_at + GRACE_MS);
  const d = days.find(on) || days.find((x) => x.date > date) || days[days.length - 1];
  if (!d) return null;
  return { day: d, when: d.date === date ? "today" : d.date > date ? "next" : "past" };
}

// the items' states from the marks seen by `now`: the current item (and question), and those visited before it
export function progressOf(day, progress, now) {
  const out = { current: null, sub: null, since: null, visited: new Set(), started: {} };
  if (!day || !progress || progress.date !== day.date) return out;
  const marks = (progress.marks || []).filter((m) => now == null || m.at <= now).sort((a, b) => a.at - b.at);
  for (const m of marks) {
    if (m.item !== out.current) {  // the next item (or back to an earlier one)
      if (out.current) out.visited.add(out.current);
      out.current = m.item;
      out.since = m.at;
      out.sub = null;
    }
    if (!(m.item in out.started)) out.started[m.item] = m.at;
    if (m.sub) out.sub = m.sub;  // a question within it
  }
  if (progress.ended && marks.length) { out.visited.add(out.current); out.current = null; }
  return out;
}

export function mountAgenda(box, { now = () => null, live = () => false, onState = () => {} } = {}) {
  let agenda = null, progress = null, key = null;
  const root = el("div", "ag");
  box.append(root);
  root.append(el("p", "ag-empty", "a napirend betöltése…"));

  onSnapshot(doc(db, "live", "agenda"), (snap) => { agenda = snap.data() || null; render(true); },
    (err) => {
      console.warn("agenda:", err);
      if (!agenda) root.replaceChildren(el("p", "ag-empty", "a napirend most nem érhető el"));
    });
  onSnapshot(doc(db, "live", "agenda_progress"), (snap) => { progress = snap.data() || null; render(true); },
    (err) => console.warn("agenda progress:", err));

  function render(force = false) {
    const k = drawKey(agenda, progress, { live: live(), at: now() ?? Date.now() });
    if (!force && k === key) return;
    key = k;
    onState(draw(root, agenda, progress, { live: live(), at: now() ?? Date.now() }));
  }
  setInterval(() => render(false), 1000);
  return { render };
}

function drawKey(agenda, progress, { live, at }) {
  const picked = pickDay(agenda, { live, at });
  if (!picked) return `none|${Boolean(agenda)}`;
  const p = progressOf(picked.day, progress, at);
  return `${picked.day.date}|${picked.when}|${p.current}|${p.sub}|${[...p.visited].join(",")}|${(agenda.source || {}).checked_at}`;
}

// The agenda into `root` (its .ag box): the day picked, where the sitting is at `at`; returns the state for the page.
export function draw(root, agenda, progress, { live = false, at = Date.now(), date = today() } = {}) {
  const picked = pickDay(agenda, { live, at, date });
  if (!picked) {
    root.replaceChildren(el("p", "ag-empty", agenda ? "nincs ismert ülésnap" : "a napirend betöltése…"));
    return { live: false, n: 0, total: 0, next: null };
  }
  const { day, when } = picked;
  const p = progressOf(day, progress, at);
  const items = day.items || [];
  const idx = items.findIndex((it) => it.id === p.current);
  root.replaceChildren(head(day, when, p, idx, items.length), bar(items, p), list(day, items, p), source(agenda));
  return { live: when === "today" && idx >= 0, n: idx + 1, total: items.length,
    next: when === "past" ? null : { date: day.date, start: day.start, today: when === "today" } };
}

function head(day, when, p, idx, total) {
  const h = el("div", "ag-head");
  const kicker = el("p", "ag-kicker");
  const what = when === "today" ? "Mai ülésnap" : when === "next" ? "Következő ülésnap" : "Legutóbbi ülésnap";
  kicker.append(el("span", null, what), el("span", "ag-date", `${dayName(day.date)}, ${dayDate(day.date)}`));
  h.append(kicker);
  let state;
  if (idx >= 0) {
    state = el("p", "ag-state ag-state-live");
    state.append(el("span", "ag-dot"), el("span", null, `Most: ${idx + 1}/${total}`),
      el("span", "ag-since", p.since ? `${hm(p.since)} óta` : ""));
  } else {
    const parts = [];
    if (day.start) parts.push(`kezdés ${day.start}`);
    const end = /kb\.\s*\d{1,2}[:.]\d{2}/.exec(day.end || "");  // "kb. 18:00 óra, illetve a napirendi pontok …"
    if (end) parts.push(`vége ${end[0]}`);
    state = el("p", "ag-state", parts.join(" · "));
  }
  h.append(state);
  return h;
}

// the timeline: one segment per item, those done filled, the current one lit
function bar(items, p) {
  const ol = el("ol", "ag-bar");
  ol.setAttribute("aria-hidden", "true");
  for (const it of items) {
    const li = el("li");
    li.dataset.state = stateOf(it, p);
    li.title = it.title;
    ol.append(li);
  }
  return ol;
}

function stateOf(it, p) {
  if (it.id === p.current) return "now";
  return p.visited.has(it.id) ? "done" : "next";
}

function list(day, items, p) {
  const ol = el("ol", "ag-list");
  let group = null;
  items.forEach((it, i) => {
    const g = GROUPS[it.group] || it.group || "";
    if (g && g !== group) {
      const sep = el("li", "ag-group", g);
      sep.setAttribute("role", "presentation");
      ol.append(sep);
    }
    group = g;
    ol.append(item(day, it, i, p));
  });
  return ol;
}

function item(day, it, i, p) {
  const st = stateOf(it, p);
  const li = el("li", "ag-item");
  li.dataset.state = st;
  li.dataset.kind = it.kind;
  if (st === "now") li.setAttribute("aria-current", "step");

  const time = el("div", "ag-time");
  const started = p.started[it.id];
  if (started != null) time.append(el("span", "ag-real", hm(started)));
  const planned = it.from ? `${it.from}–${it.to || ""}` : i === 0 && day.start ? day.start : "";
  if (planned) {
    const t = el("span", "ag-plan", planned);
    t.title = "tervezett időpont";
    time.append(t);
  }

  const body = el("div", "ag-body");
  const title = el("p", "ag-title");
  if (it.doc && it.doc !== "S/...") title.append(el("span", "ag-doc", it.doc));
  title.append(document.createTextNode(it.title));
  body.append(title);
  if (it.subtitle && it.kind !== "agenda") body.append(el("p", "ag-sub", it.subtitle));
  const meta = [it.stage, it.submitter].filter(Boolean);
  const flags = (it.flags || []).map((f) => FLAG_TEXT[f]).filter(Boolean);
  if (meta.length || flags.length) {
    const m = el("p", "ag-meta", meta.join(" · "));
    for (const f of flags) m.append(el("span", "ag-flag", f));
    body.append(m);
  }
  if (it.parts && it.parts.length > 1) {
    const ul = el("ul", "ag-parts");
    for (const part of it.parts.slice(1)) ul.append(el("li", null, [part.doc, part.title].filter((x) => x && x !== "S/...").join(" ")));
    body.append(ul);
  }
  const more = details(it, st, p);
  if (more) body.append(more);
  li.append(time, body);
  return li;
}

// the questions (who asks whom) and the named speakers, folded; the current item's open
function details(it, st, p) {
  const qs = it.questions || [];
  const sp = (it.speakers || []).filter((s) => s.name);
  if (!qs.length && !sp.length) return null;
  const d = el("details", "ag-more");
  if (st === "now") d.open = true;
  const ol = el("ol", "ag-people");
  if (qs.length) {
    d.append(el("summary", null, `${qs.length} kérdés`));
    for (const q of qs) {
      const li = el("li");
      if (st === "now" && p.sub && p.sub === q.doc) { li.dataset.state = "now"; li.setAttribute("aria-current", "step"); }
      const who = el("p", "ag-who");
      who.append(el("span", "ag-name", q.asker), el("span", "ag-party", q.party));
      if (q.to) who.append(el("span", "ag-to", `→ ${q.to}`));
      li.append(who, el("p", "ag-q", q.title));
      ol.append(li);
    }
  } else {
    const named = it.kind === "item" ? "várható előadó" : "felszólaló";
    d.append(el("summary", null, `${sp.length} ${named}`));
    for (const s of sp) {
      const li = el("li");
      if (st === "now" && p.sub && (p.sub === s.parlament_id || p.sub === s.name)) {  // the one speaking now
        li.dataset.state = "now";
        li.setAttribute("aria-current", "step");
      }
      const who = el("p", "ag-who");
      who.append(el("span", "ag-name", s.name));
      if (s.party) who.append(el("span", "ag-party", s.party));
      if (s.role && !s.title) who.append(el("span", "ag-to", s.role));
      li.append(who);
      if (s.title) li.append(el("p", "ag-q", s.title));
      ol.append(li);
    }
  }
  d.append(ol);
  return d;
}

function source(agenda) {
  const s = (agenda && agenda.source) || {};
  const p = el("p", "ag-source");
  p.append(document.createTextNode("Forrás: "));
  const a = el("a", null, "parlament.hu, elfogadott napirend");
  a.href = s.pdf || "https://www.parlament.hu/web/guest/plenaris-ules";
  a.target = "_blank";
  a.rel = "noopener";
  p.append(a);
  if (s.as_of) p.append(document.createTextNode(` (${s.as_of}-i állapot)`));
  p.append(document.createTextNode(". A tervezett időpontok tájékoztató jellegűek; hogy hol tart az ülés, a közvetítésből követjük."));
  return p;
}

// "hétfő 13:00": the next sitting day, for the note when nothing is on air
export function nextSittingText(next) {
  if (!next) return "";
  const day = next.today ? "ma" : `${dayName(next.date)}, ${dayDate(next.date)}`;
  return `következő ülésnap: ${day}${next.start ? ` ${next.start}` : ""}`;
}
