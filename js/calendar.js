// A month calendar for picking a day, in the site's style. Only the days that have data can be chosen.
//
//   const cal = calendar(root, { days: new Map([["2026-11-23", 3], ...]), onSelect: (iso | null) => ... });
//   cal.select("2026-11-23")   // or null for all days
//
// Keyboard (grid): the chosen day (or the first day with data in the month) is the one tab stop; ← → move a day,
// ↑ ↓ a week, PageUp / PageDown a month, Enter / Space choose. Moving onto a day without data skips to the next one
// that has data in that direction.

const MONTHS = ["január", "február", "március", "április", "május", "június", "július", "augusztus", "szeptember",
  "október", "november", "december"];
const WEEKDAYS = ["H", "K", "Sze", "Cs", "P", "Szo", "V"];  // Monday first, as in Hungary

const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const fmt = (date) => iso(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (key, n) => { const d = parse(key); return fmt(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)); };

export function calendar(root, { days, onSelect, label = "Napok" }) {
  root.classList.add("cal");
  const sorted = [...days.keys()].sort();
  let selected = null;
  let shown = sorted.length ? parse(sorted[sorted.length - 1]) : new Date();  // the month of the latest day
  let focusDay = sorted.length ? sorted[sorted.length - 1] : null;

  const head = document.createElement("div");
  head.className = "cal-head";
  const prev = button("cal-nav", "‹", "Előző hónap");
  const next = button("cal-nav", "›", "Következő hónap");
  const title = document.createElement("span");
  title.className = "cal-title";
  title.setAttribute("aria-live", "polite");
  head.append(prev, title, next);

  const grid = document.createElement("table");
  grid.className = "cal-grid";
  grid.setAttribute("role", "grid");
  grid.setAttribute("aria-label", label);
  root.replaceChildren(head, grid);

  function button(cls, text, aria) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = cls;
    b.textContent = text;
    if (aria) b.setAttribute("aria-label", aria);
    return b;
  }

  function render() {
    const y = shown.getFullYear(), m = shown.getMonth();
    const prefix = iso(y, m, 1).slice(0, 8);  // "2026-11-"
    title.textContent = `${y}. ${MONTHS[m]}`;
    prev.disabled = !sorted.length || sorted[0] >= iso(y, m, 1);  // no data before this month
    next.disabled = !sorted.length || sorted[sorted.length - 1] < fmt(new Date(y, m + 1, 1));  // none after it
    const inMonth = sorted.filter((d) => d.startsWith(prefix));
    if (!focusDay || !focusDay.startsWith(prefix)) focusDay = selected && selected.startsWith(prefix) ? selected : inMonth[0] || null;

    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    for (const w of WEEKDAYS) { const th = document.createElement("th"); th.scope = "col"; th.textContent = w; hr.append(th); }
    thead.append(hr);
    const tbody = document.createElement("tbody");
    const first = new Date(y, m, 1);
    const lead = (first.getDay() + 6) % 7;  // Monday = 0
    const total = new Date(y, m + 1, 0).getDate();
    let tr = document.createElement("tr");
    for (let i = 0; i < lead; i++) tr.append(document.createElement("td"));
    for (let d = 1; d <= total; d++) {
      const key = iso(y, m, d);
      const td = document.createElement("td");
      td.setAttribute("role", "gridcell");
      const b = button("cal-day", String(d));
      b.dataset.day = key;
      const n = days.get(key);
      if (n) {
        b.classList.add("has");
        b.setAttribute("aria-label", `${y}. ${MONTHS[m]} ${d}., ${n} felszólalás`);
        b.addEventListener("click", () => choose(key));
      } else {
        b.disabled = true;
        b.setAttribute("aria-label", `${y}. ${MONTHS[m]} ${d}., nincs adat`);
      }
      if (key === selected) { b.classList.add("selected"); b.setAttribute("aria-pressed", "true"); }
      else if (n) b.setAttribute("aria-pressed", "false");
      if (key === fmt(new Date())) b.classList.add("today");
      b.tabIndex = key === focusDay ? 0 : -1;
      td.append(b);
      tr.append(td);
      if ((lead + d) % 7 === 0) { tbody.append(tr); tr = document.createElement("tr"); }
    }
    if (tr.children.length) { while (tr.children.length < 7) tr.append(document.createElement("td")); tbody.append(tr); }
    grid.replaceChildren(thead, tbody);
  }

  function choose(key) {
    selected = selected === key ? null : key;  // a second click on the chosen day shows all days again
    focusDay = key;
    render();
    grid.querySelector(`[data-day="${key}"]`)?.focus();
    onSelect && onSelect(selected);
  }

  function moveMonth(delta) {
    shown = new Date(shown.getFullYear(), shown.getMonth() + delta, 1);
    focusDay = null;
    render();
  }

  // the nearest day with data after `from` in the direction of `step` (+1 / -1)
  function nearest(from, step) {
    return step > 0 ? sorted.find((d) => d > from) || null : [...sorted].reverse().find((d) => d < from) || null;
  }

  grid.addEventListener("keydown", (e) => {
    const cur = e.target.dataset && e.target.dataset.day;
    if (!cur) return;
    const steps = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let to = null;
    if (e.key in steps) {
      const t = addDays(cur, steps[e.key]);
      to = days.has(t) ? t : nearest(cur, Math.sign(steps[e.key]));
    } else if (e.key === "PageUp") to = nearest(iso(shown.getFullYear(), shown.getMonth(), 1), -1);
    else if (e.key === "PageDown") to = nearest(fmt(new Date(shown.getFullYear(), shown.getMonth() + 1, 0)), 1);
    else if (e.key === "Home") to = sorted[0];
    else if (e.key === "End") to = sorted[sorted.length - 1];
    else return;
    e.preventDefault();
    if (!to) return;
    focusDay = to;
    shown = new Date(parse(to).getFullYear(), parse(to).getMonth(), 1);
    render();
    grid.querySelector(`[data-day="${to}"]`)?.focus();
  });
  prev.addEventListener("click", () => moveMonth(-1));
  next.addEventListener("click", () => moveMonth(1));

  render();
  return {
    select(key) {
      selected = key && days.has(key) ? key : null;
      if (selected) { shown = new Date(parse(selected).getFullYear(), parse(selected).getMonth(), 1); focusDay = selected; }
      render();
    },
    get selected() { return selected; },
  };
}
