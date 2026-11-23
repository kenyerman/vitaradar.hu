// vitaradar.ai MP list: everyone whose speeches were fact-checked, with their totals.

import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, el, setPhoto, mpHref, watchLiveBadge } from "./common.js";

watchLiveBadge();
const list = document.getElementById("mps"), empty = document.getElementById("mps-empty");
const filter = document.getElementById("filter"), sort = document.getElementById("sort");
let mps = [];

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

function card(m) {
  const t = { true: 0, false: 0, unverifiable: 0, fallacy: 0, ...(m.totals || {}) };
  const li = el("li");
  const a = el("a", "mp-card panel");
  a.href = mpHref(m.id);
  const thumb = el("div", "mp-thumb");
  const img = el("img"); img.hidden = true;
  const ini = el("span", "initials");
  thumb.append(img, ini);
  setPhoto(img, ini, m.photo, m.name);
  // one line per item: name, party, role, the verdict bar, then each count on its own row
  const body = el("div", "mp-body");
  const party = el("p", "mp-party", m.party || "–"), role = el("p", "mp-role", m.role || "–");
  party.title = m.party || "";
  role.title = m.role || "";  // cut to one line with "…"; the full text on hover
  body.append(el("h3", null, m.name), party, role, bar(t));
  const stats = el("dl", "mp-stats");
  for (const [label, value, cls] of [
    ["igaz", t.true, "c-true"], ["nem ellenőrizhető", t.unverifiable, "c-unverifiable"], ["hamis", t.false, "c-false"],
    ["hibás érvelés", t.fallacy, "c-fallacy"], ["állítás összesen", m.claims || 0, ""], ["felszólalás", m.speeches || 0, ""],
  ]) {
    const row = el("div");
    row.append(el("dt", null, label), el("dd", cls, String(value)));
    stats.append(row);
  }
  body.append(stats);
  a.append(thumb, body);
  li.append(a);
  return li;
}

function render() {
  const q = filter.value.trim().toLowerCase();
  const by = sort.value;
  const shown = mps
    .filter((m) => !q || `${m.name} ${m.party} ${m.faction}`.toLowerCase().includes(q))
    .sort((a, b) => {
      if (by === "name") return a.name.localeCompare(b.name, "hu");
      if (by === "recent") return (b.last_date || "").localeCompare(a.last_date || "");
      if (by === "false") return ((b.totals || {}).false || 0) - ((a.totals || {}).false || 0);
      if (by === "true_share") return (b.true_share ?? -1) - (a.true_share ?? -1);
      return (b.claims || 0) - (a.claims || 0);
    });
  list.replaceChildren(...shown.map(card));
  empty.hidden = shown.length > 0;
}

filter.addEventListener("input", render);
sort.addEventListener("change", render);
getDocs(collection(db, "mps")).then((snap) => {
  mps = snap.docs.map((d) => d.data());
  render();
}).catch((e) => { empty.hidden = false; empty.textContent = "az adatok most nem tölthetők be"; console.warn(e); });
