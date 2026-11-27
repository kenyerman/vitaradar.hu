// Sharing a fact check, and the link that opens one.
//
// The share button on every fact card (js/social.js puts it in the votes row) opens the device's own share menu
// (Web Share API) with the verdict, the speaker and what they said, and a link to the fact. Where there is no share
// menu (desktop Firefox, Android apps' in-app browsers, some desktops) or it refuses, the link is copied instead, and
// a short note says so ("Link másolva").
//
// The link is fact.html?s=<session>&f=<claim id>: a page with share tags of its own (an "ellenőrzött állítás" card in
// Messenger, Facebook, Reddit; crawlers don't run scripts, so a fact can't have its own) that sends the reader on at
// once: to the replay (watch.html), or with &l=1 (shared from the live page) to the live page. Either page also sends
// the reader to the other one when the fact is there: the live page to the replay once the sitting is archived, the
// replay to the live page while the sitting has no archive yet. There the fact is opened, brought into view and
// framed (revealFact).

const SHARE_ICON = {  // Feather icons (MIT): share (Apple's box and arrow), share-2 (the three dots everyone else uses)
  apple: "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8M16 6l-4-4-4 4M12 2v13",
  other: "M21 5a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM9 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 19a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM8.59 13.51l6.83 3.98M15.41 6.51l-6.82 3.98",
};
const APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent);
const MAX_QUOTE = 240;  // characters of what was said, in the shared text

// The fact a link opened (?f=, with its sitting ?s=), or null.
const params = new URLSearchParams(location.search);
export const FOCUS = params.get("f") ? { session: params.get("s") || "", claim: params.get("f") } : null;

// The address that opens a fact (fact.html says where it goes); live: shared from the live page.
export function factUrl(session, claim, live = false) {
  const q = new URLSearchParams({ s: session, f: claim });
  if (live) q.set("l", "1");
  return new URL(`fact.html?${q}`, location.href).href;
}

// Where a fact is, in one of the two pages (without fact.html's detour).
export function replayUrl(session, claim) {
  return `watch.html?${new URLSearchParams({ s: session, f: claim })}`;
}
export function liveUrl(session, claim) {
  return `./?${new URLSearchParams({ s: session, f: claim })}`;
}

function icon(path) {
  const NS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", path);
  svg.append(p);
  return svg;
}

function clean(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function shorten(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max * 0.6)).replace(/[\s,;:–-]+$/, "")}…`;
}

// What the share menu gets, read from the card as the reader sees it: its verdict badge ("[ HAMIS ]", or the fallacy's
// "[ HIBÁS ÉRVELÉS: SZALMABÁB ]"), what was said (the quote, else the headline), and the speaker.
function shareData(li, url, speaker) {
  const verdict = clean((li.querySelector(".verdict") || {}).textContent).replace(/^\[\s*|\s*\]$/g, "");
  const said = clean((li.querySelector(".fact-claim") || li.querySelector(".fact-bullet") || {}).textContent);
  const who = clean((typeof speaker === "function" ? speaker() : speaker) || (li.querySelector(".fact-who") || {}).textContent);
  const quote = said ? `„${shorten(said, MAX_QUOTE)}”` : "";
  const text = [verdict && `[ ${verdict} ]`, [who, quote].filter(Boolean).join(": ")].filter(Boolean).join(" ");
  return { title: `${who ? `${who} állítása` : "Ellenőrzött állítás"} – Vitaradar`, text, url };
}

// A short note at the bottom of the screen, in the place of js/account.js's notes (the same box and look).
function note(text) {
  let box = document.getElementById("toasts");
  if (!box) {
    box = document.createElement("div");
    box.className = "toasts";
    box.id = "toasts";
    box.setAttribute("role", "status");
    document.body.append(box);
  }
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  box.append(t);
  setTimeout(() => t.remove(), 2500);
}

// The clipboard; where it is refused (no secure context, some in-app browsers), the old way through a selection.
async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.readOnly = true;  // no keyboard on phones
    ta.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;";
    document.body.append(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* no clipboard at all */ }
    ta.remove();
    return ok;
  }
}

let busy = false;  // a share menu open (a second call would fail while it is)

async function share(data) {
  if (busy) return;
  if (navigator.share && (!navigator.canShare || navigator.canShare(data))) {
    busy = true;
    try {
      await navigator.share(data);
      return;
    } catch (e) {
      if (e && e.name === "AbortError") return;  // the reader closed the menu
      console.warn("share:", e);  // refused (an in-app browser, a policy): the link is copied instead
    } finally {
      busy = false;
    }
  }
  if (await copy(data.url)) note("Link másolva");
  else prompt("A link:", data.url);  // eslint-disable-line no-alert
}

// The share button of one fact (its card is the li.fact around it). speaker: the speaker's name (or a function that
// gives it) where the card doesn't say it (an MP's own page); live: the card is on the live page.
export function shareButton(session, claim, { speaker, live } = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "share-btn";
  b.title = "Megosztás";
  b.setAttribute("aria-label", "Az állítás megosztása");
  b.append(icon(SHARE_ICON[APPLE ? "apple" : "other"]));
  b.addEventListener("click", () => {
    const li = b.closest("li.fact") || b.closest(".fact") || document.body;
    share(shareData(li, factUrl(session, claim, live), speaker));
  });
  return b;
}

// The share button in a fact's votes row (js/social.js factSocial's box), at its end; the box, for chaining.
export function addShare(box, session, claim, opts) {
  (box.querySelector(".social-bar") || box).append(shareButton(session, claim, opts));
  return box;
}

function scrollParent(node) {
  for (let p = node.parentElement; p && p !== document.body; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if ((y === "auto" || y === "scroll") && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

// The fact a link opened: the facts' tab (phones), the card opened (js/mobile.js opens a row on a click; an MP page's
// <details> opens), brought to the top of its panel (not scrollIntoView there, which can move the whole page on
// iPhones, as js/app.js says) or to the middle of the window, and framed (.fact-focus). The page is still settling
// then (web fonts, the rows above taking their sizes, comment counts), so the card is kept there while the list
// changes size, for a few seconds or until the reader touches or scrolls.
const HOLD_MS = 3000;
const HANDS = ["wheel", "touchstart", "keydown", "mousedown"];  // the reader moves the page: it is theirs again
export function revealFact(li) {
  if (!li || li.classList.contains("fact-focus")) return;
  document.getElementById("m-tab-feed")?.click();
  li.classList.add("fact-focus");
  requestAnimationFrame(() => {
    if (li.getAttribute("aria-expanded") === "false") li.click();
    const d = li.querySelector(":scope > details");
    if (d) d.open = true;
    // 8 px below the panel's top edge (the row's scroll-margin-top is the page's pinned top, which the panel is under)
    const place = () => {
      const box = scrollParent(li);
      if (box) box.scrollTop += li.getBoundingClientRect().top - box.getBoundingClientRect().top - 8;
      else li.scrollIntoView({ block: "center" });
    };
    place();
    const until = performance.now() + HOLD_MS;
    const ro = new ResizeObserver(() => { if (performance.now() < until) place(); else stop(); });
    const stop = () => {
      ro.disconnect();
      for (const ev of HANDS) removeEventListener(ev, stop, true);
    };
    for (const ev of HANDS) addEventListener(ev, stop, { capture: true, passive: true });
    ro.observe(li.parentElement);
    setTimeout(stop, HOLD_MS);
  });
}
