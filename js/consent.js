// The cookie and storage notice: a small bar fixed to the bottom of every page until the visitor chooses (no layout
// shift: it sits over the page, and the page gets room at its end while it shows). What the site stores and why is in
// impresszum.html#sutik. Two things wait for consent: the random id that lets the header's "N online" count a visitor
// once across pages and tabs (presence.js; without consent it lives in the page's memory only), and the session
// recordings and heatmaps (insights.js, PostHog EU: nothing of it loads without consent). The rest is strictly
// necessary: sign-in, the CDN cookie for the video, reCAPTCHA's bot check, and remembering these choices.
//
//   consented()           true once the visitor accepted
//   onConsentChange(fn)   fn(consented()) after every choice, and after "Döntésem módosítása" withdraws it
//
// Any [data-consent-reset] button on a page (the impresszum has one) withdraws the choice and shows the bar again.

const KEY = "vr-consent";  // {"v":2,"choice":"all"|"necessary","at":"YYYY-MM-DD"}
const VERSION = 2;         // raise it when what we ask about changes: everyone is asked again (2: the recordings)

const listeners = new Set();
let choice = read();
let bar = null, resize = null;

function read() {
  try {
    const c = JSON.parse(localStorage.getItem(KEY) || "null");
    return c && c.v === VERSION && (c.choice === "all" || c.choice === "necessary") ? c.choice : null;
  } catch { return null; }
}

export function consented() { return choice === "all"; }
export function onConsentChange(fn) { listeners.add(fn); }

function notify() {
  for (const fn of listeners) { try { fn(consented()); } catch (e) { console.warn("consent:", e); } }
}

function decide(c) {
  choice = c;
  try { localStorage.setItem(KEY, JSON.stringify({ v: VERSION, choice: c, at: new Date().toISOString().slice(0, 10) })); }
  catch { /* no storage: the choice holds for this page only */ }
  hide();
  notify();
}

function show() {
  if (bar) return;
  bar = document.createElement("section");
  bar.className = "consent";
  bar.setAttribute("aria-label", "Sütik és adattárolás");
  const text = document.createElement("p");
  text.className = "consent-text";
  text.textContent = "Engeded, hogy névtelen felvételt készítsünk arról, hogyan használod az oldalt (görgetés, kattintás; amit beírsz, a hozzászólások és a nevek nélkül), és azonosítót tároljunk az online számlálóhoz? Nélkülük is minden működik.";
  const actions = document.createElement("div");
  actions.className = "consent-actions";
  for (const [c, label] of [["all", "Elfogadom"], ["necessary", "Elutasítom"]]) {  // same weight: no nudging
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn small";
    b.textContent = label;
    b.addEventListener("click", () => decide(c));
    actions.append(b);
  }
  const more = document.createElement("a");
  more.href = "impresszum.html#sutik";
  more.textContent = "Részletek";
  actions.append(more);
  bar.append(text, actions);
  document.body.prepend(bar);  // first in the tab order; fixed, so it moves nothing
  const root = document.documentElement;
  const fit = () => root.style.setProperty("--consent-h", `${bar.offsetHeight}px`);
  fit();
  root.dataset.consent = "open";
  if ("ResizeObserver" in window) { resize = new ResizeObserver(fit); resize.observe(bar); }
}

function hide() {
  if (!bar) return;
  if (resize) { resize.disconnect(); resize = null; }
  bar.remove();
  bar = null;
  delete document.documentElement.dataset.consent;
  document.documentElement.style.removeProperty("--consent-h");
}

function wireResets() {
  for (const b of document.querySelectorAll("[data-consent-reset]")) {
    b.addEventListener("click", () => {
      choice = null;
      try { localStorage.removeItem(KEY); } catch { /* nothing stored */ }
      notify();  // consented() is false again: presence.js forgets its stored id
      show();
      bar.querySelector("button")?.focus();
    });
  }
}

function start() {
  wireResets();
  if (!choice) show();
}

if (document.body) start();
else document.addEventListener("DOMContentLoaded", start, { once: true });
