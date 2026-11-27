// vitaradar.hu impresszum: a static page; the header's live badge and account button, as on the other pages, and
// the table of contents: it marks the section being read (on phones its bar also scrolls the chip into view), with a
// marker that glides to it. The storage items are all open on wider screens, their names in a column beside them;
// phones fold them to their names, the first one open. Sections lower down come in as they are scrolled to (css,
// motion). Without this script every item is open, nothing is marked and nothing waits to come in.

import { watchLiveNav } from "./common.js?v=202611272300";
import { mountAccount } from "./account.js?v=202611280100";

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
// The sections below the first screen wait out of sight and come in as they are scrolled to; the ones on the first
// screen are marked in at once, so they come up with the page. Their rows come one after another (--i).
const groups = [".imp-contact > div", ".imp-people > .imp-me", ".imp-steps > li", ".imp-legend > li", ".imp-pledge li"];
for (const g of groups) document.querySelectorAll(g).forEach((el, i) => el.style.setProperty("--i", i));

const all = [...document.querySelectorAll(".imp-sec")];
if (all.length && "IntersectionObserver" in window && !CALM.matches) {
  const seen = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("imp-in");
      seen.unobserve(e.target);
    }
  }, { rootMargin: "0px 0px -8% 0px" });
  for (const s of all) {
    if (s.getBoundingClientRect().top < innerHeight) s.classList.add("imp-in");
    else seen.observe(s);
  }
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
