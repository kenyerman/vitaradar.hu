// vitaradar.hu MP page: one MP's fact-checked speeches, their overall scores, and a search over what they said.

import { doc, getDoc, collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { searchUrl } from "./config.js";
import { db, el, badge, sourceList, setPhoto, hms, huDate, watchLiveBadge } from "./common.js?v=202611231606";

watchLiveBadge();
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

function factCard(c) {
  const li = el("li", "fact");
  const v = c.kind === "fallacy" ? "fallacy" : c.verdict || "pending";
  li.dataset.verdict = v;
  const top = el("div", "fact-top");
  top.append(badge(v, c.kind), el("span", "fact-time", `T+${hms(c.at_s)}`));
  li.append(top, el("p", "fact-bullet", c.bullet || c.claim));
  if (c.claim && c.claim !== c.bullet) li.append(el("p", "fact-claim", c.claim));
  if (c.explanation) li.append(el("p", "fact-expl", c.explanation));
  li.append(sourceList(c.sources));
  return li;
}

function speechCard(s) {
  const t = { true: 0, false: 0, unverifiable: 0, fallacy: 0, ...(s.counts || {}) };
  const card = el("article", "speech panel");
  card.id = `speech-${s.id}`;
  const head = el("div", "speech-head");
  head.append(el("h3", null, `T+${hms(s.start_s)} → T+${hms(s.end_s)}`),
    el("span", "meta", `${hms(s.duration_s)} perc · T+ = a közvetítés kezdetétől`));
  const nums = el("span", "nums");
  nums.append(el("span", "c-true", `${t.true} igaz`), el("span", "c-false", `${t.false} hamis`),
    el("span", "c-unverifiable", `${t.unverifiable} n.e.`), el("span", "c-fallacy", `${t.fallacy} h.é.`));
  head.append(nums);
  const b = el("div", "bar");
  bar(b, t);
  const list = el("ol", "facts");
  (s.claims || []).slice().sort((a, b2) => a.at_s - b2.at_s).forEach((c) => list.append(factCard(c)));
  card.append(head, b, list);
  if (!(s.claims || []).length) card.append(el("p", "empty", "ebben a felszólalásban nem volt ellenőrizhető állítás"));
  if (s.has_transcript && s.text) {
    const det = el("details");
    det.append(el("summary", null, `> leirat (${s.words} szó)`), el("p", "transcript", s.text));
    card.append(det);
  }
  return card;
}

async function load() {
  if (!id) { $("mp-name").textContent = "Ismeretlen képviselő"; return; }
  const [mpSnap, speechSnap] = await Promise.all([
    getDoc(doc(db, "mps", id)),
    getDocs(query(collection(db, "speeches"), where("mp_id", "==", id))),
  ]);
  const m = mpSnap.data();
  const speeches = speechSnap.docs.map((d) => d.data())
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.start_s - a.start_s);
  if (!m) {
    $("mp-name").textContent = "Nincs adat";
    $("speeches-empty").hidden = false;
    return;
  }
  document.title = `${m.name} – Vitaradar`;
  $("mp-name").textContent = m.name;
  $("mp-meta").textContent = [m.party, m.role].filter(Boolean).join(" · ");
  setPhoto($("mp-img"), $("mp-initials"), m.photo, m.name);
  const t = { true: 0, false: 0, unverifiable: 0, fallacy: 0, ...(m.totals || {}) };
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

  // speeches grouped by sitting day
  const box = $("speeches");
  box.replaceChildren();
  let day = null;
  for (const s of speeches) {
    if (s.date !== day) {
      day = s.date;
      box.append(el("h3", "page-sub", `// ${huDate(day) || "ismeretlen nap"}`));
    }
    box.append(speechCard(s));
  }
  $("speech-count").textContent = speeches.length ? `[${String(speeches.length).padStart(2, "0")}]` : "";
  $("speeches-empty").hidden = speeches.length > 0;
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
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
    const r = await fetch(`${searchUrl}?mp=${encodeURIComponent(id)}&q=${encodeURIComponent(q)}`);
    if (!r.ok) throw new Error(String(r.status));
    const data = await r.json();
    note.textContent = data.hits.length ? `${data.hits.length} találat, a legközelebbi jelentésűek elöl` : "nincs találat";
    for (const h of data.hits) {
      const li = el("li", "hit panel");
      const top = el("div", "hit-top");
      const a = el("a", null, `${huDate(h.date)} · T+${hms(h.at_s)}`);
      a.href = `#speech-${h.speech_id}`;
      top.append(el("span", "hit-score", `${Math.round(h.score * 100)}% egyezés`), a);
      li.append(top, el("p", null, h.text));
      hits.append(li);
    }
  } catch (e) {
    note.textContent = "a keresés most nem érhető el";
    console.warn("search:", e);
  }
});

load().catch((e) => { $("mp-name").textContent = "Az adatok most nem tölthetők be"; console.warn(e); });
