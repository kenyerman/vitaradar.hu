// vitaradar.hu MP list: everyone whose speeches were fact-checked, with their totals.
//
// Phones: one row per MP (the photo, the name, the party and the role, the bar of the verdicts, the number of facts),
// the search, the sort as a dropdown and the "only those with data" switch. Wider screens (css, 861px and up): the same
// rows as a table, every count in its own column and a click on a column's head sorts by it; above them the parties
// side by side, and chips that show one party's MPs only.

import { collection } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { dropdown } from "./dropdown.js?v=202611241021";
import { db, getDocs, el, setPhoto, mpHref, watchLiveNav, loadFailed } from "./common.js?v=202611272000";
import { mountAccount } from "./account.js?v=202611272000";

watchLiveNav();
mountAccount();
const WIDE = matchMedia("(min-width: 861px)");  // the table, the parties and the chips (as in the css)
const list = document.getElementById("mps"), empty = document.getElementById("mps-empty");
const filter = document.getElementById("filter");
const head = document.getElementById("mps-head"), chips = document.getElementById("party");
const strip = document.getElementById("mp-parties");
const sort = dropdown(document.getElementById("sort"), {
  label: "Rendezés", value: "claims", onChange: (v) => { by = v; dir = 1; render(); },
  options: [
    { value: "claims", label: "legtöbb állítás" }, { value: "false_share", label: "legmagasabb hamis arány" },
    { value: "true_share", label: "legmagasabb igaz arány" }, { value: "recent", label: "legutóbb felszólalt" },
    { value: "name", label: "név szerint" },
  ],
});
const onlyData = document.getElementById("only-data"), count = document.getElementById("mps-count");
let mps = [];
let by = "claims", dir = 1;  // the sort, and its direction: 1 as the column means it (most first, A to Z), -1 the other way
let party = null;            // wider screens: one party's MPs only ("" those without a party), or everyone
const hasData = (m) => m.has_data ?? (m.speeches || 0) > 0;

// The verdicts, in the live page's tally order: the bar and the count list beside it. The first four always show;
// the extended ones only when there are any (older sittings have none).
const BAR = ["true", "partly_true", "misleading", "false", "opinion", "promise", "unverifiable", "fallacy"];
const BASE = new Set(["true", "false", "unverifiable", "fallacy"]);
const NAMES = { true: "igaz", partly_true: "részben igaz", misleading: "félrevezető", false: "hamis", opinion: "vélemény",
  promise: "ígéret", unverifiable: "nem ellenőrizhető", fallacy: "hibás érvelés" };
const listed = (t) => BAR.filter((k) => BASE.has(k) || t[k] > 0);

const pct = (x) => x == null ? "–" : `${Math.round(x * 100)}%`;
const minutes = (s) => `${Math.round((s || 0) / 60)} p`;
const shortDate = (iso) => iso ? new Date(`${iso}T12:00:00`).toLocaleDateString("hu-HU", { month: "short", day: "numeric" }) : "–";

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

// 199 cards would fetch every picture at once: each card's picture loads when the card comes within 600px of the screen.
const near = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting) { near.unobserve(e.target); e.target.loadPhoto(); }
}, { rootMargin: "600px 0px" }) : null;

// The table's columns on wider screens (the head's buttons and each row's cells), after the name and the bar: the key
// they sort by, the head's label, what a screen reader says before the value, and the value
const COLS = [
  ["claims", "Állítás", "állítás", (m) => String(m.claims || 0)],
  ["true_share", "Igaz", "igaz arány", (m) => pct(m.true_share)],
  ["false_share", "Hamis", "hamis arány", (m) => pct(m.false_share)],
  ["fallacy", "Hibás érv.", "hibás érvelés", (m) => String((m.totals || {}).fallacy || 0)],
  ["speeches", "Felszólalás", "felszólalás", (m) => String(m.speeches || 0)],
  ["seconds", "Idő", "beszédidő", (m) => minutes(m.seconds)],
  ["recent", "Utoljára", "utoljára", (m) => shortDate(m.last_date)],
];
const TITLES = { true_share: "igaz arány", false_share: "hamis arány", fallacy: "hibás érvelés", seconds: "beszédidő",
  recent: "legutóbb felszólalt" };
const VALUE = {
  claims: (m) => m.claims || 0, true_share: (m) => m.true_share ?? -1, false_share: (m) => m.false_share ?? -1,
  fallacy: (m) => (m.totals || {}).fallacy || 0, speeches: (m) => m.speeches || 0, seconds: (m) => m.seconds || 0,
};

function card(m, rank) {
  const t = { true: 0, false: 0, unverifiable: 0, fallacy: 0, ...(m.totals || {}) };
  const li = el("li");
  const a = el("a", hasData(m) ? "mp-card panel" : "mp-card panel no-data");
  a.href = mpHref(m.id);
  if (m.color) a.style.setProperty("--party", m.color);  // phones: a square of it before the party (css)
  const no = el("span", "mp-rank", rank ? String(rank) : "");  // wider screens: the place in the table
  no.setAttribute("aria-hidden", "true");
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
    ...listed(t).map((k) => [NAMES[k], t[k] || 0, `c-${k}`]),
    ["állítás összesen", m.claims || 0, ""], ["felszólalás", m.speeches || 0, ""],
  ]) {
    const row = el("div");
    row.append(el("dt", null, label), el("dd", cls, String(value)));
    stats.append(row);
  }
  body.append(stats);
  // wider screens: the table's cells (phones: none of them; the number of facts is .mp-total there)
  const cells = el("div", "mp-cols");
  for (const [key, , said, value] of COLS) {
    const c = el("span", `mp-col mp-col-${key}`);
    c.append(el("span", "sr", `${said}: `), hasData(m) ? value(m) : "–");
    cells.append(c);
  }
  const total = el("p", "mp-total");  // phones: the number of facts on the right (the table is for wider screens)
  total.append(el("b", null, String(m.claims || 0)), el("span", null, "állítás"));
  a.append(no, thumb, body, cells, total);
  li.append(a);
  return li;
}

function render() {
  const q = filter.value.trim().toLowerCase();
  const only = onlyData.getAttribute("aria-pressed") === "true";
  const one = WIDE.matches ? party : null;  // the chips are for wider screens only
  const shown = mps
    .filter((m) => !q || `${m.name} ${m.party} ${m.faction} ${m.role}`.toLowerCase().includes(q))
    .filter((m) => !only || hasData(m))
    .filter((m) => one == null || (m.party || "") === one)
    .sort((a, b) => {
      if (hasData(a) !== hasData(b)) return hasData(a) ? -1 : 1;  // those we have data on first
      if (by === "name") return dir * a.name.localeCompare(b.name, "hu");
      if (by === "recent") return dir * (b.last_date || "").localeCompare(a.last_date || "");
      const v = VALUE[by] || VALUE.claims, x = v(a), y = v(b);
      if ((x < 0) !== (y < 0)) return x < 0 ? 1 : -1;  // no share yet (no fact counted): last either way
      return dir * (y - x);
    });
  if (near) near.disconnect();  // the old cards go
  const rows = [];
  let n = 0;
  for (const m of shown) {
    if (!hasData(m) && n === rows.length) {  // wider screens: a line before those we have no data on yet (css)
      const sep = el("li", "mp-sep", `// ${shown.length - n} képviselőről még nincs ellenőrzött felszólalás`);
      sep.setAttribute("aria-hidden", "true");
      if (n) rows.push(sep);
    }
    rows.push(card(m, hasData(m) ? ++n : 0));
  }
  list.replaceChildren(...rows);
  empty.hidden = shown.length > 0;
  empty.textContent = mps.length ? "nincs találat" : "még nincs adat";  // the search or the switch left no one
  const withData = mps.filter(hasData).length;
  count.textContent = `// ${shown.length} képviselő látszik · ${mps.length}-ből ${withData} felszólalásait ellenőriztük`;
  marks();
}

// Wider screens: the columns' head. A click sorts by the column (the most first, names A to Z), a second click the
// other way; the phones' dropdown follows where it has the same sort.
function heads() {
  const button = (key, label) => {
    const b = el("button", "mp-th", label);
    b.type = "button";
    b.dataset.sort = key;
    b.title = `rendezés: ${TITLES[key] || label.toLowerCase()}`;
    b.addEventListener("click", () => {
      dir = by === key ? -dir : 1;
      by = key;
      sort.value = key;  // unknown to the dropdown (fallacy, speeches, seconds): it keeps its own
      render();
    });
    return b;
  };
  const rank = el("span", "mp-th-rank", "#");
  const who = el("div", "mp-th-who");
  who.append(button("name", "Képviselő"), el("span", "mp-th-label", "Minősítések"));
  head.replaceChildren(rank, who, ...COLS.map(([key, label]) => button(key, label)));
}
function marks() {
  for (const b of head.querySelectorAll(".mp-th")) {
    const on = b.dataset.sort === by;
    b.setAttribute("aria-pressed", String(on));
    b.dataset.dir = on ? (dir === 1 ? "first" : "last") : "";
  }
  for (const b of document.querySelectorAll("[data-party]")) b.setAttribute("aria-pressed", String(b.dataset.party === (party ?? "*")));
}

// Wider screens: the parties side by side, everything their MPs said added up, and the chips. The true and false
// shares are the MPs' own (true_share, false_share: true or false facts per the facts they count), taken together:
// each MP's count over that base, which their share gives back (an MP whose shares are both 0 adds nothing to it).
function parties() {
  const groups = new Map();
  for (const m of mps) {
    const key = m.party || "";
    if (!groups.has(key)) groups.set(key, { name: m.party, color: m.color, all: [] });
    groups.get(key).all.push(m);
  }
  const named = [...groups.values()].filter((g) => g.name).sort((a, b) => b.all.length - a.all.length);
  const pick = (key) => { party = party === key ? null : key; render(); };

  strip.replaceChildren(el("p", "mp-parties-h", "// pártok"));
  const grid = el("div", "mp-parties-grid");
  for (const g of named) {
    const has = g.all.filter(hasData);
    const t = Object.fromEntries(BAR.map((k) => [k, has.reduce((n, m) => n + ((m.totals || {})[k] || 0), 0)]));
    let base = 0;
    for (const m of has) {
      const mt = m.totals || {};
      if (m.true_share > 0) base += (mt.true || 0) / m.true_share;
      else if (m.false_share > 0) base += (mt.false || 0) / m.false_share;
    }
    const b = el("button", "mp-party-card");
    b.type = "button";
    b.dataset.party = g.name;
    if (g.color) b.style.setProperty("--party", g.color);
    const top = el("span", "mp-party-top");
    top.append(el("b", null, g.name), el("span", null, `${has.length} / ${g.all.length} képviselő`));
    const nums = el("span", "mp-party-nums");
    for (const [v, label, cls] of [
      [String(has.reduce((n, m) => n + (m.claims || 0), 0)), "állítás", ""],
      [base ? pct(t.true / base) : "–", "igaz arány", "c-true"],
      [base ? pct(t.false / base) : "–", "hamis arány", "c-false"],
      [String(t.fallacy), "hibás érvelés", "c-fallacy"],
    ]) {
      const s = el("span", cls);
      s.append(el("b", null, v), el("small", null, label));
      nums.append(s);
    }
    b.append(top, bar(t), nums);
    b.title = `csak a(z) ${g.name} képviselői`;
    b.addEventListener("click", () => pick(g.name));
    grid.append(b);
  }
  strip.append(grid);

  const chip = (key, label, color, n) => {
    const b = el("button", "mp-chip");
    b.type = "button";
    b.dataset.party = key ?? "*";
    if (color) b.style.setProperty("--party", color);
    b.append(label, el("span", "mp-chip-n", String(n)));
    b.addEventListener("click", () => { party = key; render(); });
    return b;
  };
  chips.replaceChildren(chip(null, "összes", null, mps.length),
    ...named.map((g) => chip(g.name, g.name, g.color, g.all.length)),
    ...(groups.has("") ? [chip("", "párton kívül", null, groups.get("").all.length)] : []));
  strip.hidden = chips.hidden = head.hidden = false;
}

heads();
filter.addEventListener("input", render);
onlyData.addEventListener("click", () => {
  onlyData.setAttribute("aria-pressed", String(onlyData.getAttribute("aria-pressed") !== "true"));
  render();
});
// the chips' choice holds on wider screens only; on a phone the sort is the dropdown's (it has no direction, nor the
// table's other columns)
WIDE.addEventListener("change", () => {
  if (!WIDE.matches) { by = sort.value; dir = 1; }
  render();
});
getDocs(collection(db, "mps")).then((snap) => {
  mps = snap.docs.map((d) => d.data());
  parties();
  render();
}).catch((e) => { loadFailed(empty, "az adatok most nem tölthetők be"); console.warn(e); });
