// vitaradar.hu MP list: everyone whose speeches were fact-checked, with their totals.

import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { dropdown } from "./dropdown.js?v=202611240125";
import { db, el, setPhoto, mpHref, watchLiveBadge } from "./common.js?v=202611240125";
import { mountAccount } from "./account.js?v=202611240125";

watchLiveBadge();
mountAccount();
const list = document.getElementById("mps"), empty = document.getElementById("mps-empty");
const filter = document.getElementById("filter");
const sort = dropdown(document.getElementById("sort"), {
  label: "Rendezés", value: "claims", onChange: () => render(),
  options: [
    { value: "claims", label: "legtöbb állítás" }, { value: "false", label: "legtöbb hamis" },
    { value: "true_share", label: "legmagasabb igaz arány" }, { value: "recent", label: "legutóbb felszólalt" },
    { value: "name", label: "név szerint" },
  ],
});
const onlyData = document.getElementById("only-data"), count = document.getElementById("mps-count");
let mps = [];
const hasData = (m) => m.has_data ?? (m.speeches || 0) > 0;

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

// 199 cards would fetch every picture at once: each card's picture loads when the card comes within 600px of the screen.
const near = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { near.unobserve(e.target); e.target.loadPhoto(); }
}, { rootMargin: "600px 0px" }) : null;

function card(m) {
  const t = { true: 0, false: 0, unverifiable: 0, fallacy: 0, ...(m.totals || {}) };
  const li = el("li");
  const a = el("a", hasData(m) ? "mp-card panel" : "mp-card panel no-data");
  a.href = mpHref(m.id);
  const thumb = el("div", "mp-thumb");
  const img = el("img"); img.hidden = true;
  const ini = el("span", "initials");
  thumb.append(img, ini);
  // the picture loads once its card nears the screen (see `near`); until then the initials show
  setPhoto(img, ini, near ? null : m.photo, m.name, { id: m.id, color: m.color });
  if (near && m.photo) {
    thumb.loadPhoto = () => setPhoto(img, ini, m.photo, m.name, { id: m.id, color: m.color });
    near.observe(thumb);
  }
  // one line per item: name, party, role, the verdict bar, then each count on its own row
  const body = el("div", "mp-body");
  const party = el("p", "mp-party", m.party || "–"), role = el("p", "mp-role", m.role || "–");
  party.title = m.party || "";
  role.title = m.role || "";  // cut to one line with "…"; the full text on hover
  body.append(el("h2", null, m.name), party, role, bar(t));  // h2: the page's h1 is right above
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
  const only = onlyData.getAttribute("aria-pressed") === "true";
  const shown = mps
    .filter((m) => !q || `${m.name} ${m.party} ${m.faction} ${m.role}`.toLowerCase().includes(q))
    .filter((m) => !only || hasData(m))
    .sort((a, b) => {
      if (hasData(a) !== hasData(b)) return hasData(a) ? -1 : 1;  // those we have data on first
      if (by === "name") return a.name.localeCompare(b.name, "hu");
      if (by === "recent") return (b.last_date || "").localeCompare(a.last_date || "");
      if (by === "false") return ((b.totals || {}).false || 0) - ((a.totals || {}).false || 0);
      if (by === "true_share") return (b.true_share ?? -1) - (a.true_share ?? -1);
      return (b.claims || 0) - (a.claims || 0);
    });
  if (near) near.disconnect();  // the old cards go
  list.replaceChildren(...shown.map(card));
  empty.hidden = shown.length > 0;
  const withData = mps.filter(hasData).length;
  count.textContent = `// ${shown.length} képviselő látszik · ${mps.length}-ből ${withData} felszólalásait ellenőriztük`;
}

filter.addEventListener("input", render);
onlyData.addEventListener("click", () => {
  onlyData.setAttribute("aria-pressed", String(onlyData.getAttribute("aria-pressed") !== "true"));
  render();
});
getDocs(collection(db, "mps")).then((snap) => {
  mps = snap.docs.map((d) => d.data());
  render();
}).catch((e) => { empty.hidden = false; empty.textContent = "az adatok most nem tölthetők be"; console.warn(e); });
