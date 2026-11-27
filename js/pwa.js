// vitaradar.hu as an app on the phone (manifest.webmanifest, sw.js, offline.html). Every page loads this on its own,
// apart from the page's scripts: nothing here can stop them.
//
// The service worker (sw.js), registered once the page is in: it only shows offline.html when a page cannot load. Every
// page and file still comes from the network as before; sw.js says what it leaves alone and how it updates.
//
// The app is offered on phones in a browser tab (never in the installed app), in two places:
// - The install sheet from the bottom ("Az appban jobb"), on every page load: Böngésző – Folytatás, vitaradar –
//   Telepítés. Folytatás (or "Maradok itt" in an app's browser) is remembered (vr-install in localStorage): from then
//   on it never comes by itself, only from the menu. Closed any other way (beside it, Escape, the steps' Rendben) it
//   stays closed on that page only. An install is remembered too, and then nothing is offered.
// - "App telepítése" in the phone menu, any time: it brings the sheet back. Not in the header: the bar keeps the
//   name, the heart and ☰.
// Where the reader is decides what Telepítés does:
// - Android (Chrome, Samsung Internet, Edge): the browser's own install dialog (beforeinstallprompt). Without that event
//   (another browser, or the app is installed already) nothing is offered; once the dialog was used on a page, the
//   menu's item shows where Chrome's menu has the install.
// - iPhone: Safari has no install dialog, so it shows the steps (Megosztás → Hozzáadás a főképernyőhöz).
// - Apps' own browsers (Facebook, Messenger, Instagram, TikTok…): nothing can be installed in them, so the same sheet's
//   Telepítés opens the page in the real browser (Android: an intent: link, iOS: x-safari-https: or the app's own
//   link; the app asks "open in another app?" first) with ?install in its address. Nothing leaves by itself. When the
//   browser does not come, the sheet says how to open the page from the app's menu, with a button to copy its link.
// - Arriving with ?install (from an app's browser): the mark leaves the address, and the install comes straight away,
//   before the cookie bar: Android the sheet with the one Telepítés (the browser's dialog needs a tap), iPhone the steps.
// The sheet waits for a calm moment: not while a game card is open, the reader types or has just touched the screen,
// the menu or another dialog is open; in a browser also not while the cookie bar asks (it comes first there; in an
// app's browser the reader is on the way out, so the sheet comes first). A game that starts while it shows closes it
// (it comes back later on that page).
//
// In the installed app (html[data-app="standalone"]) links to other sites open outside it (a new tab: Safari's sheet on
// iPhone, a Chrome tab on Android), so the app itself never leaves vitaradar.hu.

const root = document.documentElement;
const UA = navigator.userAgent;
const IOS = /iPhone|iPod/.test(UA);  // iPads are not phones (and iPadOS's Safari says it is a Mac)
const ANDROID = /Android/.test(UA) && /Mobile/.test(UA);
const IOS_OTHER = /CriOS|FxiOS|EdgiOS|OPiOS/.test(UA);  // Chrome, Firefox, Edge on iPhone: their own Share button
const SAFARI = Number((/Version\/(\d+)/.exec(UA) || [])[1] || 0);  // Safari's version (26: Share is under •••)
const IOS_V = Number((/ OS (\d+)_/.exec(UA) || [])[1] || 0);  // iOS's version (x-safari-https: from 17)
const PHONE = matchMedia("(max-width: 860px) and (pointer: coarse)");
const APP = matchMedia("(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)");
const STILL = matchMedia("(prefers-reduced-motion: reduce)");
const FIELD = "input:not([type=checkbox], [type=radio], [type=button], [type=submit], [type=range]), textarea, select, [contenteditable=true]";

const KEY = "vr-install";  // {"v":1,"choice":"browser"|"installed","at":<ms>}: stays in the browser / installed
const MARK = "install";  // ?install: sent here from an app's browser to install
const FIRST_WAIT = 1500;   // after the page is in: its opening has played
const RETRY = 2000;        // not calm yet: look again
const QUIET = 1500;        // no touch, scroll or key for this long before it comes up (never under a finger)
const BACK = 15000;        // a game closed it: back after this long

const inApp = () => APP.matches || navigator.standalone === true;

// Sent from an app's browser by its Telepítés (?install): remembered, and gone from the address (a reload or a shared
// link does not bring it back). The page's own scripts have read their address by now: this file runs last.
const ARRIVED = (() => {
  let u;
  try { u = new URL(location.href); } catch { return false; }
  if (!u.searchParams.has(MARK)) return false;
  u.searchParams.delete(MARK);
  try { history.replaceState(history.state, "", u.pathname + u.search + u.hash); } catch { /* the mark stays: harmless */ }
  return true;
})();

// ------------------------------------------------------------------ the service worker
function register() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" })
    .catch((e) => console.warn("sw:", e));
}
if (document.readyState === "complete") register();
else addEventListener("load", register, { once: true });

// ------------------------------------------------------------------ in the installed app
if (inApp()) {
  root.dataset.app = "standalone";
  document.addEventListener("click", (e) => {
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!a || a.target) return;
    let u;
    try { u = new URL(a.href, location.href); } catch { return; }
    if ((u.protocol === "http:" || u.protocol === "https:") && u.origin !== location.origin) {
      a.target = "_blank";
      if (!/\bnoopener\b/.test(a.rel)) a.rel = `${a.rel} noopener`.trim();
    }
  }, true);
}

// ------------------------------------------------------------------ apps' own browsers
// Each names itself in its user agent (Messenger before Facebook: it says FB too; newer Messengers say only FB, and
// then the text names both). `art`: the Hungarian article before the name. How each lets a page out to the browser,
// per platform (`a` Android, `i` iOS), as tested by others in 2025–2026 (github.com/shalanah/inapp-debugger,
// github.com/Livshitz/iab-escape, plugwith.me): an app changes this with its updates, so there is always the sheet
// with its menu's steps and the link to copy as well.
// - "intent": an intent: link to the default browser (the app asks "open in another app?" first). Meta's apps.
// - "probe": the same intent: link from a hidden frame, so an app that does not pass it on shows its error page only in
//   that frame, never instead of the page. The rest of Android's in-app browsers (marked "wv").
// - "open": window.open of x-safari-https: (Facebook and Messenger take it only this way since March 2026).
// - "ig" / "threads": the app's own extbrowser link (Instagram and Threads dropped x-safari-https).
// - "safari": a plain x-safari-https: link (iOS 15 and 17 and later; 16 does not know it).
// Only ever from a tap (Telepítés): Meta's apps would let a page do it as it loads, but readers did not ask to leave.
const APPS = [
  { id: "messenger", name: "Messenger", art: "A", re: /MessengerForiOS|Orca-Android|FB_IAB\/(?:Orca|MESSENGER)/, a: "intent", i: "open" },
  { id: "instagram", name: "Instagram", art: "Az", re: /\bInstagram/, a: "intent", i: "ig" },
  { id: "threads", name: "Threads", art: "A", re: /\bBarcelona/, a: "intent", i: "threads" },
  { id: "facebook", name: "Facebook és a Messenger", art: "A", re: /\bFB[\w_]+\/|FBAN|FBAV/, a: "intent", i: "open" },
  { id: "tiktok", name: "TikTok", art: "A", re: /musical_ly|Bytedance|TikTok/i, a: "probe", i: null },
  { id: "snapchat", name: "Snapchat", art: "A", re: /Snapchat/i, a: "probe", i: null },
  { id: "reddit", name: "Reddit", art: "A", re: /\bReddit\//i, a: "probe", i: "safari" },
  { id: "linkedin", name: "LinkedIn", art: "A", re: /LinkedInApp/i, a: "probe", i: "safari" },
  { id: "whatsapp", name: "WhatsApp", art: "A", re: /\b(?:WAiOS|WA4A)\//, a: "probe", i: "safari" },
  { id: "telegram", name: "Telegram", art: "A", test: () => "TelegramWebviewProxy" in window || "TelegramWebview" in window, a: "intent", i: "safari" },
  { id: "pinterest", name: "Pinterest", art: "A", re: /Pinterest/i, a: "probe", i: "safari" },
  { id: "x", name: "X", art: "Az", re: /\bTwitter/i, a: "probe", i: "safari" },
  { id: "line", name: "LINE", art: "A", re: /\bLine\//i, a: "intent", i: "safari" },
  { id: "google", name: "Google", art: "A", re: /\bGSA\//, a: "probe", i: "safari" },
];
// Android marks its WebView "wv"; on iOS an app's own browser leaves "Safari/" out (the installed app too: not here then)
const OTHER = { id: "other", name: "", art: "", a: "probe", i: "safari" };
const IAB = (IOS || ANDROID) && (APPS.find((x) => (x.test ? x.test() : x.re.test(UA)))
  || ((ANDROID && /; wv\)/.test(UA)) || (IOS && !/Safari\//.test(UA) && navigator.standalone !== true) ? OTHER : null));
const XSAFARI = IOS_V === 15 || IOS_V >= 17;
const WAY = !IAB ? null : ANDROID ? IAB.a : IAB.i && (IAB.i !== "safari" && IAB.i !== "open" || XSAFARI) ? IAB.i : null;
// iPhone, Safari 26.4 or later without its `browser` object: most likely an app's Safari view (Reddit's links open in
// one), which has a Safari button but no Add to Home Screen. Only the steps' wording follows it (it may be wrong).
const VIEW = IOS && !IAB && !IOS_OTHER && SAFARI >= 26 && Number((/Version\/26\.(\d+)/.exec(UA) || [])[1] || 99) >= 4
  && !window.browser;

function escapeUrl(way) {
  const u = new URL(location.href);
  u.searchParams.set(MARK, "1");  // the browser goes straight to the install
  const here = u.href;
  if (way === "ig") return `instagram://extbrowser/?url=${encodeURIComponent(here)}`;
  if (way === "threads") return `barcelona://extbrowser/?url=${encodeURIComponent(here)}`;
  if (IOS) return `x-safari-${here}`;  // x-safari-https://vitaradar.hu/…
  // the page's path and query (an intent: link has no room for its #part)
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.slice(0, -1)};end`;
}

// Sends the reader to the browser; resolves true when the page went to the background (the browser came up), false
// when it stayed. Apps ask first ("You're leaving our app…"), a native dialog over the page. Where the page loses its
// focus meanwhile, the answer is waited for (up to 30 s), and the focus coming back with the page still in front means
// "no" (Go back). Messenger's browser keeps the focus (seen on Android 16), so Meta's apps, which always ask, get 12 s
// for an answer; the others 4 s for anything to happen. An answer after that still counts: the sheet goes when the page
// goes to the background (see below).
let lastTry = 0;
const PATIENCE = IAB && ["facebook", "messenger", "instagram", "threads"].includes(IAB.id) ? 12000 : 4000;
function leave() {
  lastTry = Date.now();
  return new Promise((done) => {
    const t0 = Date.now();
    let asked = false, over = false, tick = 0;
    const finish = (gone) => {
      if (over) return;
      over = true;
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onShow);
      removeEventListener("blur", onBlur);
      removeEventListener("focus", onFocus);
      done(gone);
    };
    const onShow = () => { if (document.visibilityState === "hidden") finish(true); };
    const onBlur = () => { asked = true; };
    const onFocus = () => {  // the question went: a yes takes the page to the background in a moment, a no leaves it here
      if (asked) setTimeout(() => { if (document.visibilityState === "visible") finish(false); }, 1200);
    };
    document.addEventListener("visibilitychange", onShow);
    addEventListener("blur", onBlur);
    addEventListener("focus", onFocus);
    tick = setInterval(() => {
      if (!document.hasFocus()) asked = true;
      const t = Date.now() - t0;
      if ((!asked && t > PATIENCE) || t > 30000) finish(false);
    }, 250);
    const url = escapeUrl(WAY);
    try {
      if (WAY === "open") window.open(url, "_blank");
      else if (WAY === "probe") {
        const f = document.createElement("iframe");
        f.hidden = true;
        f.src = url;
        document.body.append(f);
        setTimeout(() => f.remove(), 3000);
      } else location.href = url;
    } catch { /* the app refused it: the steps */ }
  });
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "hidden" || !lastTry || Date.now() - lastTry > 30000) return;
  dismissed = true;  // the browser came up: back in the app, the page is left alone
  if (sheet) close("final");
});

// ------------------------------------------------------------------ what can be offered now
let bip = null;     // Android's install dialog, kept for Telepítés (beforeinstallprompt)
let seen = false;   // it came on this page (the app can be installed here), even if it was used since

function choice() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    if (s && s.v === 1 && (s.choice === "browser" || s.choice === "installed")) return s.choice;
    if (s) localStorage.removeItem(KEY);  // an earlier version's "steps": not kept now
  } catch { /* no storage: nothing remembered */ }
  return null;
}
const installed = () => choice() === "installed";
const stays = () => choice() === "browser";  // chose the browser: the sheet only from the menu

function remember(c) {
  try { localStorage.setItem(KEY, JSON.stringify({ v: 1, choice: c, at: Date.now() })); } catch { /* fine */ }
}

// "inapp", "ios" (the steps), "prompt" (Android's dialog), "android" (Chrome's menu), or null: nothing to offer
function offer() {
  if (!PHONE.matches || inApp() || installed()) return null;
  if (IAB) return "inapp";
  if (IOS) return "ios";
  if (ANDROID) return bip ? "prompt" : seen ? "android" : null;
  return null;
}

addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();  // not the browser's own bar as well: the sheet and the menu's item ask
  bip = e;
  seen = true;
  if (installed()) try { localStorage.removeItem(KEY); } catch { /* the browser offers it: not installed (any more) */ }
  sync();
});
addEventListener("appinstalled", () => { remember("installed"); bip = null; sync(); if (sheet) close("final"); });

// ------------------------------------------------------------------ when the sheet comes
let sheet = null, dismissed = false, timer = 0, since = 0, lastTouch = 0, started = 0;

for (const type of ["pointerdown", "keydown", "scroll", "wheel"]) {
  document.addEventListener(type, () => { lastTouch = Date.now(); }, { capture: true, passive: true });
}

const gameOpen = () => Boolean(document.querySelector('.game-dock > :not([hidden])[data-state="open"]'));

function calm() {
  const focus = document.activeElement;
  return document.visibilityState === "visible"
    && (IAB || root.dataset.consent !== "open")  // in a browser the cookie bar first (js/consent.js)
    && !root.classList.contains("menu-open")
    && !document.querySelector("dialog[open]")
    && !gameOpen()
    && !document.body.classList.contains("m-typing")
    && !(focus && focus.matches && focus.matches(FIELD))
    && Date.now() - lastTouch > QUIET;
}

function later(ms) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    if (sheet || dismissed || stays()) return;
    const o = offer();
    if (!o) {  // Android: the install dialog may still come (for three minutes)
      if (ANDROID && !IAB && Date.now() - started < 180000) later(RETRY);
      return;
    }
    if (calm()) open(o); else later(RETRY);
  }, ms);
}

const DIALOG = typeof HTMLDialogElement === "function" && "showModal" in HTMLDialogElement.prototype;

function start() {
  started = Date.now();
  if (!(IOS || ANDROID) || inApp() || !DIALOG) return;
  later(FIRST_WAIT);
}

// Here from an app's browser to install: no question of where, no waiting for the cookie bar. iPhone: the steps.
// Android: the browser's install dialog needs a tap of its own, so the sheet with just Telepítés, once the browser has
// offered the install (or, without the offer in 8 s, its menu's steps).
function arrive() {
  started = Date.now();
  if (IOS) { setTimeout(() => { if (!sheet && offer()) open("steps"); }, 600); return; }
  const t0 = Date.now();
  // a stored install does not stop it (the app may have been removed since: then the browser offers it again); only
  // with no offer in 8 s and an install remembered nothing comes
  const look = () => {
    if (sheet || dismissed || !PHONE.matches) return;
    if (bip) open("direct");
    else if (Date.now() - t0 > 8000) { if (!installed()) open("android"); }
    else setTimeout(look, 300);
  };
  setTimeout(look, 400);
}

// ------------------------------------------------------------------ the phone menu's item
let item = null;

function mountItem() {
  if (inApp()) return;
  const nav = document.querySelector("#menu .nav") || document.querySelector(".site-header .nav");
  if (!nav) return;
  item = el("a", "nav-install", "App telepítése");
  item.href = "#app";
  item.setAttribute("role", "button");
  item.hidden = true;
  item.addEventListener("click", (e) => { e.preventDefault(); setTimeout(go, 50); });  // the menu closes first
  nav.append(item);
  PHONE.addEventListener("change", sync);
  APP.addEventListener("change", sync);
  sync();
}

function sync() {
  if (item) item.hidden = !offer();
}

// The menu's "App telepítése": the sheet again, the same as on page load (Android after its dialog was used: Chrome's
// menu steps). Without <dialog> support straight to what Telepítés does.
function go() {
  const o = offer();
  if (!o) return;
  if (!DIALOG) { if (o === "prompt") ask(); else if (o === "inapp" && WAY) leave(); return; }
  if (sheet) close("final");
  clearTimeout(timer);
  open(o, true);
}

// ------------------------------------------------------------------ the sheet
const ICON = {
  browser: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5S9.7 5.9 12 3.5z"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 14.5V3M8 7l4-4 4 4M8.5 10H6.5v10.5h11V10h-2"/></svg>',
  add: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/></svg>',
  more: '<svg class="is-fill" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="6" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18" cy="12" r="1.7"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 9.5l6 6 6-6"/></svg>',
  out: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M13.5 4.5h6v6M19.5 4.5L11 13M17.5 14v5.5h-13v-13H10"/></svg>',
  compass: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5l-2.2 4.8-4.8 2.2 2.2-4.8z"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
};
const APP_ICON = '<img class="is-app" src="img/app/maskable-192.png" alt="" width="44" height="44">';

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;  // only the fixed markup of this file, never anything a reader wrote
  return e;
}

// The iPhone steps. Safari 26 (iOS 26) gets the guide: its five taps one by one, each with a small picture of that
// screen playing in turn (the step it shows lit in the list; with less motion only on a tap), and a green arrow at the
// bottom right pointing at the real ••• below the sheet. The labels are iOS 26.5's own Hungarian ones (MobileSafari's
// and the share sheet's strings): ••• → Megosztás → Továbbiak megtekintése (the round ⌄ ending the second row) →
// Főképernyőhöz adás → Hozzáadás (top right). Older Safari and the other iPhone browsers keep Share in their bar.
function steps() {
  if (SAFARI >= 26 && !IOS_OTHER) return guide();
  const first = IOS_OTHER
    ? `Koppints a böngésző <b>Megosztás</b> gombjára <i class="is-i">${ICON.share}</i>.`
    : `Koppints alul a <b>Megosztás</b> <i class="is-i">${ICON.share}</i> gombra.`;
  const tiles = [ICON.share, ICON.add]
    .map((svg) => `<span class="is-tile">${svg}</span>`).join('<span class="is-arrow">›</span>');
  return `<h2 class="is-title" id="is-view-title" tabindex="-1">Telepítés</h2>
    <div class="is-pic" aria-hidden="true">${tiles}<span class="is-arrow">›</span><span class="is-tile is-home">${APP_ICON}</span></div>
    <ol class="is-list">
      ${VIEW ? `<li>Ha alul egy Safari <i class="is-i">${ICON.compass}</i> gomb van (egy app böngészője, például a Reddité), előbb arra koppints: a lap megnyílik a Safariban.</li>` : ""}
      <li>${first}</li>
      <li>Válaszd: <b>Főképernyőhöz adás</b> <i class="is-i">${ICON.add}</i>. Ha nem látod, görgess lejjebb.</li>
      <li>Koppints a <b>Hozzáadás</b> gombra. Az app a főképernyőn vár.</li>
    </ol>
    <button type="button" class="btn is-done" data-act="done">Rendben</button>`;
}

function guide() {
  const say = [
    "Koppints alul jobbra a <b>•••</b> gombra.",
    `<b>Megosztás</b> <i class="is-i">${ICON.share}</i>`,
    `A második sor végén: <b>Továbbiak megtekintése</b> <i class="is-i">${ICON.down}</i>`,
    `<b>Főképernyőhöz adás</b> <i class="is-i">${ICON.add}</i>`,
    "Jobb fent: <b>Hozzáadás</b>. Kész!",
  ];
  return `<h2 class="is-title" id="is-view-title" tabindex="-1">Telepítés</h2>
    ${VIEW ? `<p class="is-note">Ha alul egy Safari <i class="is-i">${ICON.compass}</i> gomb van (egy app böngészője, például a Reddité), előbb arra koppints: a lap megnyílik a Safariban.</p>` : ""}
    <div class="ig">
      <div class="ig-screen" data-step="1" aria-hidden="true">
        <div class="ig-f ig-f1"><span class="ig-bar"><span class="ig-c">‹</span><span class="ig-url">vitaradar.hu</span><span class="ig-c ig-hit">•••</span></span></div>
        <div class="ig-f ig-f2"><span class="ig-pop"><span class="ig-row ig-hit">${ICON.share}<span>Megosztás</span></span><span class="ig-row ig-ghost"></span><span class="ig-row ig-ghost"></span></span><span class="ig-bar"><span class="ig-c">‹</span><span class="ig-url">vitaradar.hu</span><span class="ig-c">•••</span></span></div>
        <div class="ig-f ig-f3"><span class="ig-sheet"><span class="ig-apps"><i></i><i></i><i></i></span><span class="ig-acts"><i></i><i></i><i></i><i class="ig-hit">${ICON.down}</i></span></span></div>
        <div class="ig-f ig-f4"><span class="ig-sheet"><span class="ig-row ig-ghost"></span><span class="ig-row ig-ghost"></span><span class="ig-row ig-hit">${ICON.add}<span>Főképernyőhöz adás</span></span></span></div>
        <div class="ig-f ig-f5"><span class="ig-add"><span class="ig-head"><span class="ig-c">✕</span><span class="ig-ok ig-hit">Hozzáadás</span></span><span class="ig-app">${APP_ICON}<span>vitaradar</span></span></span></div>
      </div>
      <ol class="is-list ig-steps">${say.map((x, i) => `<li data-n="${i + 1}">${x}</li>`).join("")}</ol>
    </div>
    <button type="button" class="btn is-done" data-act="done">Rendben</button>
    <span class="ig-point" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false"><path d="M12 3.5v16M5.5 13.5l6.5 6.5 6.5-6.5"/></svg></span>`;
}

// The guide's pictures, one after the other; a tap on a step shows its picture (and holds it a while).
let cycle = 0;
function play() {
  clearInterval(cycle);
  const box = sheet && sheet.querySelector(".ig-screen");
  if (!box) return;
  const items = [...sheet.querySelectorAll(".ig-steps li")];
  let n = 1, held = 0;
  const show = (k) => {
    n = k;
    box.dataset.step = String(k);
    items.forEach((li, i) => li.classList.toggle("is-on", i + 1 === k));
  };
  items.forEach((li, i) => li.addEventListener("click", () => { show(i + 1); held = Date.now(); }));
  show(1);
  if (!STILL.matches) cycle = setInterval(() => { if (Date.now() - held > 6000) show((n % items.length) + 1); }, 1900);
}

// Android, once its dialog was used on this page (it comes once per page): Chrome's menu has the install too.
function androidSteps() {
  return `<h2 class="is-title" id="is-view-title" tabindex="-1">Így telepítheted</h2>
    <ol class="is-list">
      <li>Koppints a böngésző jobb felső sarkában a <b>⋮</b> gombra.</li>
      <li>Válaszd: <b>Alkalmazás telepítése</b> (vagy <b>Hozzáadás a kezdőképernyőhöz</b>).</li>
      <li>Koppints a <b>Telepítés</b> gombra. Az app a kezdőképernyőn vár.</li>
    </ol>
    <button type="button" class="btn is-done" data-act="done">Rendben</button>`;
}

// Where each app keeps "open in the browser" (its menu, then the item), for the steps when the page stays in the app.
// The apps' Hungarian labels vary by version: the English one follows.
function iabMenu() {
  const id = IAB ? IAB.id : "";
  const dots = ANDROID ? "<b>⋮</b>" : "<b>•••</b>";
  const item = (hu, en) => `Válaszd: <b>${hu}</b> <span class="is-en">(${en})</span>.`;
  if (["facebook", "messenger", "instagram", "threads"].includes(id)) {
    return [`Koppints ${ANDROID ? "jobb fent" : "jobb fent vagy lent"} a ${dots} gombra.`,
      item("Megnyitás böngészőben", ANDROID ? "Open in external browser / Open in Chrome" : "Open in external browser / Open in Safari")];
  }
  if (id === "reddit" || id === "tiktok") {
    return [`Koppints jobb fent a ${dots} gombra.`, item("Megnyitás böngészőben", "Open in browser")];
  }
  if (id === "x" && IOS) return [`Koppints alul a Safari <i class="is-i">${ICON.compass}</i> gombra.`];
  if (id === "google") {
    return [`Koppints a ${dots} vagy a <b>Megosztás</b> <i class="is-i">${ICON.share}</i> gombra.`,
      item(ANDROID ? "Megnyitás a Chrome-ban" : "Megnyitás a Safariban", ANDROID ? "Open in Chrome" : "Open in Safari")];
  }
  return [`Keresd az app menüjét: ${dots} (jobb fent vagy lent), ${IOS ? `vagy a Safari <i class="is-i">${ICON.compass}</i> gombot` : "vagy a földgömb ikont"}.`,
    item("Megnyitás böngészőben", ANDROID ? "Open in browser" : "Open in Safari")];
}

function inappView() {
  const where = ANDROID ? "a böngészőben" : "a Safariban";
  const who = IAB && IAB.name ? `${IAB.art} ${IAB.name}` : "Ennek az appnak a";
  const own = IAB && IAB.name ? "saját böngészőjéből" : "böngészőjéből";
  const last = `${ANDROID ? "A böngészőben" : "A Safariban"} koppints a <b>Telepítés</b> gombra: a többit a lap megmutatja.`;
  const list = [...iabMenu(), last].map((x) => `<li>${x}</li>`).join("");
  return `<h2 class="is-title" id="is-view-title" tabindex="-1">Nyisd meg ${where}</h2>
    <p class="is-note">${who} ${own} nem lehet appot telepíteni${WAY ? ", és most nem nyílt meg magától" : ""}. ${ANDROID ? "A böngészőben" : "A Safariban"} pár koppintás az egész.</p>
    ${WAY ? `<button type="button" class="btn is-wide" data-act="leave">${ICON.out}Újra: megnyitás ${where}</button>
    <p class="is-or">Vagy az app menüjéből:</p>` : ""}
    <ol class="is-list">${list}</ol>
    <div class="is-pair">
      <button type="button" class="btn ghost" data-act="copy">${ICON.link}<span>Link másolása</span></button>
      <button type="button" class="btn ghost" data-act="browser">Maradok itt</button>
    </div>
    <p class="is-copied" role="status" aria-live="polite"></p>`;
}

// Arrived from an app's browser (Android): the browser's dialog wants a tap of its own
function directView() {
  return `<h2 class="is-title" id="is-view-title">Még egy koppintás</h2>
      <ul class="is-rows">
        <li class="is-row"><span class="is-ico">${APP_ICON}</span><span class="is-name is-brand">vitaradar<small>app a telefonodon</small></span><button type="button" class="btn is-btn" data-act="install" autofocus>Telepítés</button></li>
      </ul>`;
}

function mainView() {
  const app = IAB ? `a ${ANDROID ? "böngésződ" : "Safari"} nyílik meg hozzá` : "app a telefonodon";
  return `<section class="is-main">
      <h2 class="is-title" id="is-view-title">Az appban jobb</h2>
      <ul class="is-rows">
        <li class="is-row"><span class="is-ico">${ICON.browser}</span><span class="is-name">Böngésző<small>ebben a lapban</small></span><button type="button" class="btn ghost is-btn" data-act="browser" autofocus>Folytatás</button></li>
        <li class="is-row"><span class="is-ico">${APP_ICON}</span><span class="is-name is-brand">vitaradar<small>${app}</small></span><button type="button" class="btn is-btn" data-act="install">Telepítés</button></li>
      </ul>
    </section>`;
}

function viewHtml(view) {
  if (view === "steps") return `<section class="is-steps">${steps()}</section>`;
  if (view === "android") return `<section class="is-steps">${androidSteps()}</section>`;
  if (view === "out") return `<section class="is-steps is-iab">${inappView()}</section>`;
  if (view === "direct") return `<section class="is-main">${directView()}</section>`;
  return mainView();
}

let guard = 0, back = null;

// `view`: "prompt" (Android with its dialog), "ios" and "inapp" open on the two rows; "steps", "android", "out" (how to
// open the page from an app's menu), "direct" (just Telepítés) on their own.
function open(view, asked = false) {
  back = document.activeElement;
  const v = view === "prompt" || view === "ios" || view === "inapp" ? "main" : view;
  const d = sheet = el("dialog", "install-sheet");
  d.setAttribute("aria-labelledby", "is-view-title");
  d.dataset.view = v;
  d.append(el("div", "is-body", `<span class="is-grab" aria-hidden="true"></span>${viewHtml(v)}`));
  document.body.append(d);
  d.addEventListener("click", onClick);
  d.addEventListener("cancel", (e) => { e.preventDefault(); if (sheet === d) close("dismiss"); });
  d.showModal();
  if (v !== "main") { const t = d.querySelector(".is-title"); if (t) t.focus({ preventScroll: true }); }
  play();
  since = asked ? 0 : Date.now();
  guard = setInterval(() => { if (gameOpen()) close(asked ? "final" : "game"); }, 1000);  // a game started: it goes
}

function onClick(e) {
  if (!sheet || sheet !== e.currentTarget) return;  // closing already
  if (e.target === sheet) { close("dismiss"); return; }  // the dim part beside it
  const b = e.target instanceof Element ? e.target.closest("button[data-act]") : null;
  if (!b || Date.now() - since < 500) return;  // a tap meant for the page, landing as it came up
  const act = b.dataset.act;
  if (act === "browser") { remember("browser"); close("dismiss"); }  // Folytatás, Maradok itt: not by itself again
  else if (act === "done") close("dismiss");
  else if (act === "install") install();
  else if (act === "leave") away();
  else if (act === "copy") copy(b);
}

function install() {
  if (IAB) {  // to the browser, with the mark; the app's menu steps when it does not come
    if (!WAY) { swap("out"); return; }
    const d = sheet, b = d.querySelector('[data-act="install"]');
    if (b) { b.disabled = true; b.textContent = "Nyílik…"; }
    leave().then((gone) => {
      if (sheet !== d) return;
      if (gone) close("final");
      else swap("out");
    });
    return;
  }
  if (IOS) { swap("steps"); return; }
  ask();
}

function swap(view) {
  const old = sheet.querySelector(".is-main, .is-steps");
  const next = el("div", null, viewHtml(view)).firstElementChild;
  old.replaceWith(next);
  sheet.dataset.view = view;
  next.querySelector(".is-title").focus({ preventScroll: true });
  play();
}

// Android's install dialog (straight from a tap: browsers want that). It comes once per page; after a no the menu's
// item shows Chrome's menu instead.
function ask() {
  const p = bip;
  bip = null;
  if (!p) { if (sheet) swap("android"); else if (DIALOG) open("android", true); sync(); return; }
  let asked;
  try { asked = p.prompt(); } catch { sync(); if (sheet) swap("android"); return; }
  if (sheet) close("final");
  dismissed = true;
  sync();
  Promise.resolve(asked).then(() => p.userChoice)
    .then((r) => { if (r && r.outcome === "accepted") { remember("installed"); sync(); } })
    .catch(() => { /* asked: nothing to keep */ });
}

// To the browser from a tap; the sheet stays for when it does not open (and closes when it did).
function away() {
  leave().then((gone) => { if (gone && sheet) close("final"); });
}

// The old way first, still inside the tap (apps' browsers often refuse the clipboard API, and after waiting for it the
// tap no longer counts); the clipboard API when that did not copy.
async function copy(b) {
  const url = location.href;
  let ok = false;
  if (sheet) {
    const t = el("textarea", "is-hidden-copy");
    t.value = url;
    t.setAttribute("readonly", "");
    sheet.append(t);  // in the dialog: the page behind it is inert
    t.select();
    t.setSelectionRange(0, url.length);
    try { ok = document.execCommand("copy"); } catch { ok = false; }
    t.remove();
    b.focus({ preventScroll: true });
  }
  if (!ok) {
    try { await navigator.clipboard.writeText(url); ok = true; } catch { /* the link is shown to copy by hand */ }
  }
  const note = sheet && sheet.querySelector(".is-copied");
  if (note) {
    note.textContent = ok ? `Kimásolva. Illeszd be ${ANDROID ? "a böngésző" : "a Safari"} címsorába.` : `A link: ${url}`;
    note.classList.toggle("is-raw", !ok);
  }
  const label = b.querySelector("span");
  if (ok && label) label.textContent = "Kimásolva";
}

// `why`: "dismiss" (the reader closed it: not again on this page), "final" (done: not again), "game" (back later).
function close(why) {
  const d = sheet;
  if (!d || d.dataset.closing != null) return;
  clearInterval(guard);
  clearInterval(cycle);
  sheet = null;
  if (why !== "game") dismissed = true;
  let done = false;
  const end = () => {
    if (done) return;
    done = true;
    d.close();
    d.remove();
    if (back && back.isConnected && back !== document.body && typeof back.focus === "function") back.focus({ preventScroll: true });
  };
  if (STILL.matches) end();
  else {
    d.dataset.closing = "";
    d.addEventListener("animationend", (e) => { if (e.target === d) end(); });
    setTimeout(end, 400);
  }
  if (why === "game") later(BACK);
}

// ------------------------------------------------------------------ go (the page is parsed: modules run after it)
mountItem();
if (ARRIVED && !IAB && (IOS || ANDROID) && !inApp() && DIALOG) arrive();  // no waiting for the whole page to load
else if (document.readyState === "complete") start();
else addEventListener("load", start, { once: true });
