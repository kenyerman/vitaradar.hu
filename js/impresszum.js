// vitaradar.hu impresszum: a static page; the header's live badge and account button, as on the other pages, and
// the table of contents: it marks the section being read (on phones its bar also scrolls the chip into view). The
// storage items are all open on wider screens, their names in a column beside them; phones fold them to their names,
// the first one open. Without this script every item is open and nothing is marked.

import { watchLiveNav } from "./common.js?v=202611272300";
import { mountAccount } from "./account.js?v=202611280100";

watchLiveNav();
mountAccount();

const PHONE = matchMedia("(max-width: 860px)");
const CALM = matchMedia("(prefers-reduced-motion: reduce)");

// ------------------------------------------------------------------ the table of contents
const aside = document.querySelector(".imp-aside");
const header = document.querySelector(".site-header");
const links = new Map([...document.querySelectorAll(".imp-toc a[href^='#']")].map((a) => [a.hash.slice(1), a]));
const sections = [...links.keys()].map((id) => document.getElementById(id)).filter(Boolean);
let current = null;

function mark(id) {
  if (!id || id === current) return;
  current = id;
  for (const [key, a] of links) {
    if (key === id) a.setAttribute("aria-current", "true");
    else a.removeAttribute("aria-current");
  }
  const a = links.get(id);
  const bar = a && a.closest("ol");
  if (!PHONE.matches || !bar) return;
  // the chip into view in its own bar (not scrollIntoView: that scrolls the page too)
  const li = a.parentElement;
  const left = li.offsetLeft - (bar.clientWidth - li.offsetWidth) / 2;
  bar.scrollTo({ left: Math.max(0, left), behavior: CALM.matches ? "auto" : "smooth" });
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
  addEventListener("resize", spy);
  for (const [id, a] of links) a.addEventListener("click", () => mark(id));
  spy();
}

// ------------------------------------------------------------------ the storage items
const stores = [...document.querySelectorAll(".imp-store")];

function fold() {
  stores.forEach((d, i) => {
    d.open = !PHONE.matches || i === 0;
    d.querySelector("summary").tabIndex = PHONE.matches ? 0 : -1;  // a name there, not a button
  });
}

for (const d of stores) {
  d.querySelector("summary").addEventListener("click", (e) => { if (!PHONE.matches) e.preventDefault(); });
}
PHONE.addEventListener("change", fold);
fold();
