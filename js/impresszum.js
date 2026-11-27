// vitaradar.hu impresszum: a static page; the header's live badge and account button, as on the other pages, and
// the table of contents: it marks the section being read (on phones its bar also scrolls the chip into view), with a
// marker that glides to it. The storage items are all open on wider screens, their names in a column beside them;
// phones fold them to their names, the first one open. Sections lower down come in as they are scrolled to (css,
// motion). Without this script every item is open, nothing is marked and nothing waits to come in.

import { watchLiveNav } from "./common.js?v=202611281400";
import { mountAccount } from "./account.js?v=202611281800";

watchLiveNav();
mountAccount();

const PHONE = matchMedia("(max-width: 860px)");
const CALM = matchMedia("(prefers-reduced-motion: reduce)");
const root = document.documentElement;

// ------------------------------------------------------------------ the table of contents
const aside = document.querySelector(".imp-aside");
const header = document.querySelector(".site-header");
const list = document.querySelector(".imp-toc ol");
const links = new Map([...document.querySelectorAll(".imp-toc a[href^='#']")].map((a) => [a.hash.slice(1), a]));
const sections = [...links.keys()].map((id) => document.getElementById(id)).filter(Boolean);
let current = null;

// the marker under the item being read: a bar on the contents' line on wider screens, a frame around the chip on
// phones (css draws it from these numbers and slides it between them)
function place() {
  const a = current && links.get(current);
  if (!list || !a) return;
  const li = a.parentElement;
  list.style.setProperty("--mk-x", `${li.offsetLeft}px`);
  list.style.setProperty("--mk-y", `${li.offsetTop}px`);
  list.style.setProperty("--mk-w", `${li.offsetWidth}px`);
  list.style.setProperty("--mk-h", `${li.offsetHeight}px`);
  list.dataset.marker = "on";
}

function mark(id) {
  if (!id || id === current) return;
  current = id;
  for (const [key, a] of links) {
    if (key === id) a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  }
  place();
  const a = links.get(id);
  if (!PHONE.matches || !list || !a) return;
  // the chip into view in its own bar (not scrollIntoView: that scrolls the page too)
  const li = a.parentElement;
  const left = li.offsetLeft - (list.clientWidth - li.offsetWidth) / 2;
  list.scrollTo({ left: Math.max(0, left), behavior: CALM.matches ? "auto" : "smooth" });
}

// the section in view: the last one whose top is above a line just under the sticky header (and the contents' bar on
// phones); at the very bottom of the page the last one, which may never reach that line
function spy() {
  if (!sections.length) return;
  const edge = (PHONE.matches && aside ? aside : header).getBoundingClientRect().bottom + 40;
  let id = sections[0].id;
  for (const s of sections) if (s.getBoundingClientRect().top <= edge) id = s.id;
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 2) id = sections[sections.length - 1].id;
  mark(id);
}

if (sections.length) {
  let queued = false;
  addEventListener("scroll", () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; spy(); });
  }, { passive: true });
  addEventListener("resize", () => { spy(); place(); });
  document.fonts?.ready.then(place);  // the labels' font changes the items' sizes
  for (const [id, a] of links) a.addEventListener("click", () => mark(id));
  spy();
}

// ------------------------------------------------------------------ sections coming in
// Each section, and each row in one, comes in on its own. While the page scrolls, once it is well on the screen (its
// top above a line 15% up from the bottom), so the reader sees it come: tied to its section, the lower rows of a tall
// one came in below the screen and were only seen standing. When the page stands (at load, or once a scroll stops),
// everything on the screen at all, so nothing in view is left as an empty gap at the foot of the screen. Rows that
// come in together follow one after another (--d); one that comes in alone does not wait.
const ROWS = ".imp-contact > div, .imp-people > .imp-me, .imp-steps > li, .imp-legend > li, .imp-pledge li, .imp-callout";
const LINE = 0.85;  // of the screen's height, from the top, while scrolling
const items = [...document.querySelectorAll(`.imp-sec, ${ROWS}`)];
const waiting = new Set();

function show(batch) {
  let n = 0;
  for (const el of batch) {
    if (!waiting.delete(el)) continue;
    if (!el.matches(".imp-sec")) el.style.setProperty("--d", `${Math.min(n++, 8) * 70}ms`);
    el.classList.add("imp-in");
  }
}

// everything waiting with any part on the screen, in page order
function inView() {
  return items.filter((el) => waiting.has(el) && el.getBoundingClientRect().top < innerHeight - 2);
}

if (items.length && "IntersectionObserver" in window && !CALM.matches) {
  for (const el of items) waiting.add(el);
  const seen = new IntersectionObserver((entries) => {
    const batch = entries.filter((e) => e.isIntersecting).map((e) => e.target);
    batch.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));  // page order
    for (const el of batch) seen.unobserve(el);
    show(batch);
  }, { rootMargin: `0px 0px -${Math.round((1 - LINE) * 100)}% 0px` });
  show(inView());  // the first screen comes up with the page
  for (const el of waiting) seen.observe(el);
  let still = 0;
  const settle = () => { clearTimeout(still); still = setTimeout(() => show(inView()), 160); };
  addEventListener("scroll", settle, { passive: true });
  addEventListener("resize", settle);
  document.fonts?.ready.then(() => show(inView()));  // the fonts can move rows up onto the screen
  // and so does the page's own entrance (it rises from 32px lower): once it is done
  const main = document.querySelector("main");
  main?.addEventListener("animationend", (e) => { if (e.target === main) show(inView()); });
  setTimeout(() => show(inView()), 1500);
  root.classList.add("imp-anim");
}

// ------------------------------------------------------------------ the storage items
const stores = [...document.querySelectorAll(".imp-store")];

function fold() {
  stores.forEach((d, i) => {
    d.open = !PHONE.matches || i === 0;
    d.querySelector("summary").tabIndex = PHONE.matches ? 0 : -1;  // a name there, not a button
  });
  place();
}

for (const d of stores) {
  d.querySelector("summary").addEventListener("click", (e) => { if (!PHONE.matches) e.preventDefault(); });
}
PHONE.addEventListener("change", fold);
fold();
