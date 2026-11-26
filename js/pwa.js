// vitaradar.hu as an app on the phone (manifest.webmanifest, sw.js, offline.html). Every page loads this on its own,
// apart from the page's scripts: nothing here can stop them.
//
// The service worker (sw.js), registered once the page is in: it only shows offline.html when a page cannot load. Every
// page and file still comes from the network as before; sw.js says what it leaves alone and how it updates.
//
// The install sheet, on phones in a browser tab (never in the installed app): the familiar "where to go on" sheet from
// the bottom, two rows: Böngésző – Folytatás (closes it), vitaradar – Telepítés.
// - Android (Chrome, Samsung Internet, Edge): Telepítés opens the browser's own install dialog (beforeinstallprompt).
//   Without that event (another browser, or the app is installed already) the sheet does not show.
// - iPhone: Safari has no install dialog, so Telepítés shows the steps (Megosztás → Hozzáadás a főképernyőhöz) with a
//   small picture of them. Not in apps' own browsers (Facebook, Instagram, Google…): they cannot add to the home screen.
// It waits for a calm moment, a few seconds after the page is in: not while the cookie bar asks, a game card is open,
// the reader types or has just touched the screen, the menu or another dialog is open. A game that starts while it shows
// closes it (it comes back later). After Folytatás (or Escape, or a tap beside it) it stays away for 30 days, after the
// iPhone steps for 60, once installed for good: vr-install in localStorage. Without storage it never shows (it could
// not remember a no).
//
// In the installed app (html[data-app="standalone"]) links to other sites open outside it (a new tab: Safari's sheet on
// iPhone, a Chrome tab on Android), so the app itself never leaves vitaradar.hu.

const root = document.documentElement;
const UA = navigator.userAgent;
const IOS = /iPhone|iPod/.test(UA);  // iPads are not phones (and iPadOS's Safari says it is a Mac)
const ANDROID = /Android/.test(UA) && /Mobile/.test(UA);
const IN_APP = /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Twitter|TikTok|musical_ly|Snapchat|Pinterest|Line\/|GSA\//.test(UA);
const IOS_OTHER = /CriOS|FxiOS|EdgiOS|OPiOS/.test(UA);  // Chrome, Firefox, Edge on iPhone: their own Share button
const SAFARI = Number((/Version\/(\d+)/.exec(UA) || [])[1] || 0);  // Safari's version (26: Share is under •••)
const PHONE = matchMedia("(max-width: 860px) and (pointer: coarse)");
const APP = matchMedia("(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui)");
const STILL = matchMedia("(prefers-reduced-motion: reduce)");
const FIELD = "input:not([type=checkbox], [type=radio], [type=button], [type=submit], [type=range]), textarea, select, [contenteditable=true]";

const KEY = "vr-install";  // {"v":1,"choice":"browser"|"steps"|"installed","at":<ms>}
const DAY = 864e5;
const AWAY = { browser: 30 * DAY, steps: 60 * DAY, installed: Infinity };
const FIRST_WAIT = 6000;  // after the page is in: its opening has played, the reader has seen it
const RETRY = 3000;       // not calm yet: look again
const QUIET = 2500;       // no touch, scroll or key for this long before it comes up (never under a finger)

const inApp = () => APP.matches || navigator.standalone === true;

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

// ------------------------------------------------------------------ what the reader said before
function writable() {
  try { localStorage.setItem("vr-install-test", "1"); localStorage.removeItem("vr-install-test"); return true; }
  catch { return false; }
}

function away() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || "null");
    return Boolean(s && s.v === 1 && Date.now() - s.at < (AWAY[s.choice] || AWAY.browser));
  } catch { return true; }
}

function remember(choice) {
  try { localStorage.setItem(KEY, JSON.stringify({ v: 1, choice, at: Date.now() })); } catch { /* checked before */ }
}

// ------------------------------------------------------------------ when
let bip = null;  // Android's install dialog, kept for Telepítés (beforeinstallprompt)
let sheet = null, shown = false, timer = 0, since = 0, lastTouch = 0, started = 0;

addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();  // not the browser's own bar as well: the sheet asks (or, after a no, nothing does)
  bip = e;
});
addEventListener("appinstalled", () => { remember("installed"); bip = null; });

for (const type of ["pointerdown", "keydown", "scroll", "wheel"]) {
  document.addEventListener(type, () => { lastTouch = Date.now(); }, { capture: true, passive: true });
}

const gameOpen = () => Boolean(document.querySelector('.game-dock > :not([hidden])[data-state="open"]'));

function wanted() {
  return !shown && PHONE.matches && !inApp() && (IOS ? !IN_APP : ANDROID) && writable() && !away();
}

function calm() {
  const focus = document.activeElement;
  return document.visibilityState === "visible"
    && root.dataset.consent !== "open"  // the cookie bar first (js/consent.js): never two sheets at once
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
    if (!wanted()) return;
    if (!IOS && !bip && Date.now() - started > 180000) return;  // Android: no install dialog came (not offered here)
    if ((IOS || bip) && calm()) open(); else later(RETRY);
  }, ms);
}

if ((IOS || ANDROID) && typeof HTMLDialogElement === "function" && "showModal" in HTMLDialogElement.prototype) {
  const start = () => { started = Date.now(); later(FIRST_WAIT); };
  if (document.readyState === "complete") start(); else addEventListener("load", start, { once: true });
}

// ------------------------------------------------------------------ the sheet
const ICON = {
  browser: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.3 2.4 3.5 5.2 3.5 8.5s-1.2 6.1-3.5 8.5c-2.3-2.4-3.5-5.2-3.5-8.5S9.7 5.9 12 3.5z"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 14.5V3M8 7l4-4 4 4M8.5 10H6.5v10.5h11V10h-2"/></svg>',
  add: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="M12 8.5v7M8.5 12h7"/></svg>',
  more: '<svg class="is-fill" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="6" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18" cy="12" r="1.7"/></svg>',
  down: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 9.5l6 6 6-6"/></svg>',
};
const APP_ICON = '<img class="is-app" src="img/app/maskable-192.png" alt="" width="44" height="44">';

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;  // only the fixed markup of this file, never anything a reader wrote
  return e;
}

// The iPhone steps: where Share is depends on the browser (Safari 26 keeps it under •••, the others in their bar), and
// Safari 26's Share sheet keeps "Add to Home Screen" behind its ⌄ (View More) button (seen in iOS 26.5).
function steps() {
  const s26 = SAFARI >= 26 && !IOS_OTHER;
  const first = IOS_OTHER
    ? `Koppints a böngésző <b>Megosztás</b> gombjára <i class="is-i">${ICON.share}</i>.`
    : s26
      ? `Koppints alul a <b>•••</b> gombra, majd a <b>Megosztás</b> <i class="is-i">${ICON.share}</i> gombra.`
      : `Koppints alul a <b>Megosztás</b> <i class="is-i">${ICON.share}</i> gombra.`;
  const more = s26
    ? `Ha nincs ott, előbb koppints a sor végén a <i class="is-i">${ICON.down}</i> gombra.`
    : "Ha nem látod, görgess lejjebb.";
  const tiles = [...(s26 ? [ICON.more] : []), ICON.share, ICON.add]
    .map((svg) => `<span class="is-tile">${svg}</span>`).join('<span class="is-arrow">›</span>');
  return `<h2 class="is-title" id="is-steps-title" tabindex="-1">Így kerül a főképernyőre</h2>
    <div class="is-pic" aria-hidden="true">${tiles}<span class="is-arrow">›</span><span class="is-tile is-home">${APP_ICON}</span></div>
    <ol class="is-list">
      <li>${first}</li>
      <li>Válaszd: <b>Hozzáadás a főképernyőhöz</b> <i class="is-i">${ICON.add}</i>. ${more}</li>
      <li>Koppints a <b>Hozzáadás</b> gombra. Az app a főképernyőn vár.</li>
    </ol>
    <button type="button" class="btn is-done" data-act="done">Rendben</button>`;
}

function build() {
  const d = el("dialog", "install-sheet");
  d.setAttribute("aria-labelledby", "is-title");
  const body = el("div", "is-body", `<span class="is-grab" aria-hidden="true"></span>
    <section class="is-main">
      <h2 class="is-title" id="is-title">Hol folytatod?</h2>
      <ul class="is-rows">
        <li class="is-row"><span class="is-ico">${ICON.browser}</span><span class="is-name">Böngésző<small>ebben a lapban</small></span><button type="button" class="btn ghost is-btn" data-act="browser" autofocus>Folytatás</button></li>
        <li class="is-row"><span class="is-ico">${APP_ICON}</span><span class="is-name is-brand">vitaradar<small>app a telefonodon</small></span><button type="button" class="btn is-btn" data-act="install">Telepítés</button></li>
      </ul>
    </section>`);
  d.append(body);
  return d;
}

let opened = 0, guard = 0, back = null;

function open() {
  shown = true;
  back = document.activeElement;
  const d = sheet = build();
  document.body.append(d);
  d.addEventListener("click", onClick);
  d.addEventListener("cancel", (e) => { e.preventDefault(); if (sheet === d) close(d.dataset.view === "steps" ? "steps" : "browser"); });
  d.showModal();
  since = Date.now();
  guard = setInterval(() => { if (gameOpen()) close(null); }, 1000);  // a game started: it goes, and comes back later
}

function onClick(e) {
  if (!sheet || sheet !== e.currentTarget) return;  // closing already
  if (e.target === sheet) { close(sheet.dataset.view === "steps" ? "steps" : "browser"); return; }  // the dim part beside it
  const b = e.target instanceof Element ? e.target.closest("button[data-act]") : null;
  if (!b || Date.now() - since < 500) return;  // a tap meant for the page, landing as it came up
  const act = b.dataset.act;
  if (act === "browser") close("browser");
  else if (act === "done") close("steps");
  else if (act === "install") install();
}

function install() {
  if (IOS) {
    const main = sheet.querySelector(".is-main");
    const view = el("section", "is-steps", steps());
    main.replaceWith(view);
    sheet.dataset.view = "steps";
    sheet.setAttribute("aria-labelledby", "is-steps-title");
    view.querySelector(".is-title").focus({ preventScroll: true });
    return;
  }
  const p = bip;
  bip = null;
  if (!p) { close("browser"); return; }
  let asked;
  try { asked = p.prompt(); } catch { close("browser"); return; }  // straight from the tap: browsers want that
  close(null, true);
  Promise.resolve(asked).then(() => p.userChoice)
    .then((r) => remember(r && r.outcome === "accepted" ? "installed" : "browser"))
    .catch(() => remember("browser"));
}

// `choice`: what to remember (null: nothing, it may come back later on this page). `final`: it does not come back.
function close(choice, final = false) {
  const d = sheet;
  if (!d || d.dataset.closing != null) return;
  clearInterval(guard);
  if (choice) remember(choice);
  sheet = null;
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
  if (!choice && !final) { shown = false; later(15000); }
}
