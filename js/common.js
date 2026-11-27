// Shared by every page: Firebase, the digital rain behind the page, and small helpers.

import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, getDoc, getDocs } from "./firebase.js?v=202611270600";
import "./consent.js?v=202611241021";   // the cookie and storage bar at the bottom, on every page
import "./presence.js?v=202611270600";  // the header's "N online" (visitors included), on every page
import "./menu.js?v=202611241206";      // the hamburger menu on phones, on every page
import "./netwatch.js?v=202611270600";  // a bar with "Újrapróbálás" when the server cannot be reached, on every page
import { CDN, cdnReady, cdnUrl } from "./cdn.js?v=202611270600";

export { db };  // set up once, with App Check, in firebase.js
export { getDoc, getDocs };  // reads that wait for the server, not Firestore's own (firebase.js says why)

// A load that failed or got no answer in time (js/net.js): what failed, and "Újrapróbálás", which loads the page again
// (a new connection and a new reCAPTCHA check, what a stuck page needs; in the iPhone app there is no reload button).
export function loadFailed(box, text) {
  const b = el("button", "btn ghost", "Újrapróbálás");
  b.type = "button";
  b.addEventListener("click", () => { b.disabled = true; location.reload(); });
  box.classList.add("load-failed");
  box.replaceChildren(el("span", null, text), b);
  box.hidden = false;
}

export const LABEL = {
  true: "IGAZ", partly_true: "RÉSZBEN IGAZ", misleading: "FÉLREVEZETŐ", false: "HAMIS", opinion: "VÉLEMÉNY",
  promise: "ÍGÉRET", unverifiable: "NEM ELLENŐRIZHETŐ", pending: "ELLENŐRZÉS", fallacy: "HIBÁS ÉRVELÉS",
};

// Verdicts that decide a stated fact (the others label an opinion, a promise, or what no evidence settles).
export const FACT_VERDICTS = new Set(["true", "partly_true", "misleading", "false"]);

// A conclusion check judges only the step from the speaker's stated facts to their conclusion, not a fact, so it has
// the stream's words for its verdict: "[ KÖVETKEZTETÉS: MEGALAPOZATLAN ]", in orange (css), because unfounded is not
// false. The pages don't count conclusions with the facts (js/app.js).
export const CONCLUSION_LABEL = { true: "MEGALAPOZOTT", false: "MEGALAPOZATLAN", unverifiable: "NEM ELDÖNTHETŐ" };

export function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

export function initials(name) {  // without titles: "Dr. Ruzsa Diána" -> "RD"
  return (name || "").split(/\s+/).filter((w) => w && !/^(dr|prof|ifj|id)\.?$/i.test(w))
    .map((w) => w[0]).slice(0, 2).join("");
}

export function mpHref(id) {
  return `mp.html?id=${encodeURIComponent(id)}`;
}

export function hms(seconds) {
  const s = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? `${h}:${String(m).padStart(2, "0")}` : String(m)) + `:${String(r).padStart(2, "0")}`;
}

export function huDate(iso) {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString("hu-HU", { year: "numeric", month: "long", day: "numeric" });
}

// A verdict badge like the stream's: [ IGAZ ]. While the check runs, the stream's loading sign sits inside the
// brackets, "[ ELLENŐRZÉS ▒ ]" (the sign is CSS on an empty span, .v-sign), and a conclusion check keeps its title,
// "[ KÖVETKEZTETÉS ▒ ]", then "[ KÖVETKEZTETÉS: MEGALAPOZOTT ]" (CONCLUSION_LABEL; data-kind gives it its colour).
// js/mobile.js drops the [ ] on phones from the text at either end.
export function badge(verdict, kind) {
  const v = kind === "fallacy" ? "fallacy" : verdict || "pending";
  const conclusion = kind === "conclusion";
  const b = el("span", "verdict");
  b.dataset.v = v;
  if (conclusion) b.dataset.kind = "conclusion";
  if (v === "pending") {
    const sign = el("span", "v-sign");
    sign.setAttribute("aria-hidden", "true");
    b.append(`[ ${conclusion ? "KÖVETKEZTETÉS" : LABEL.pending} `, sign, " ]");
    return b;
  }
  b.textContent = conclusion ? `[ KÖVETKEZTETÉS: ${CONCLUSION_LABEL[v] || LABEL[v] || v} ]` : `[ ${LABEL[v] || v} ]`;
  return b;
}

// A fact's badge once the fallacy said in the same sentence shows on its card (pfc publish.link_docs): the card is
// the fallacy's, whatever the fact's verdict, "[ HIBÁS ÉRVELÉS: SZEMÉLYESKEDÉS ]" (the fact's explanation stays on
// it as context), and the pair counts once, as a fallacy. "[ IGAZ · SZALMABÁB ]" read as a contradiction. Without
// one it is the plain badge.
export function factBadge(c, v, fallacyShown) {
  if (!fallacyShown || !c.fallacy || v === "pending" || (c.kind && c.kind !== "claim")) return badge(v, c.kind);
  const b = el("span", "verdict");
  b.dataset.v = "fallacy";
  b.textContent = `[ ${LABEL.fallacy}: ${(c.fallacy.name || "").toUpperCase()} ]`;
  return b;
}

// Sources of a fact, as links (http(s) only).
export function sourceList(sources) {
  const list = el("ul", "fact-sources");
  for (const s of sources || []) {
    if (!/^https?:\/\//.test(s.url || "")) continue;
    let host = "";
    try { host = new URL(s.url).hostname.replace(/^www\./, ""); } catch { continue; }
    const a = el("a", null, s.title ? `${s.title} (${host})` : host);
    a.href = s.url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    const li = el("li");
    li.append(a);
    list.append(li);
  }
  list.hidden = !list.children.length;
  return list;
}

// ------------------------------------------------------------------ portraits
// A person's portrait: their cut-out (background removed, img/mps/<parliament id>.webp) in front of an animated
// green background drawn by CSS (.portrait in style.css): a radar sweeping around the portrait's centre, behind static
// scanlines. Its look varies per person: the sweep's speed and direction, the hue and the ring spacing come from a
// hash of their id. Fallbacks: the official photo, then the initials. The party's colour shows at the bottom; without
// a party, nothing does.

const OFFICIAL = /\/kepviselo-kepek\/([A-Za-z0-9]+)$/;

function hash(s) {  // FNV-1a, 32 bits
  let h = 0x811c9dc5;
  for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 0x01000193) >>> 0;
  return h;
}

function portraitLook(root, id) {
  const h = hash(id || "?");
  const pick = (shift, lo, hi) => lo + (((h >>> shift) & 0xff) / 255) * (hi - lo);
  const vars = {
    "--sweep-t": `${pick(16, 4, 9).toFixed(1)}s`, "--sweep-dir": (h & 0x1000000) ? "reverse" : "normal",
    "--sweep-delay": `-${pick(0, 0, 9).toFixed(1)}s`,  // not all in step
    "--hue": pick(24, 122, 150).toFixed(0), "--rings": `${pick(4, 9, 20).toFixed(0)}px`,
  };
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
}

// portraits animate unless they are known to be off screen (then they pause, to spare the CPU)
const seen = "IntersectionObserver" in window
  ? new IntersectionObserver((entries) => entries.forEach((e) => e.target.classList.toggle("off", !e.isIntersecting)))
  : null;

function layer(root, cls) {
  let e = root.querySelector(`:scope > .${cls}`);
  if (!e) { e = el("span", cls); e.setAttribute("aria-hidden", "true"); root.append(e); }
  return e;
}

// setPhoto(img, initialsEl, photoUrl, name, {id, color}): img and initialsEl sit in the portrait's box.
export function setPhoto(img, fallback, url, name, { id, color } = {}) {
  const root = img.parentElement;
  root.classList.add("portrait");
  portraitLook(root, id || name);
  root.prepend(layer(root, "pt-sweep"));
  root.querySelector(":scope > .pt-band")?.remove();  // the moving scanline band is gone
  for (const cls of ["pt-party", "pt-lines"]) layer(root, cls);
  if (color) { root.style.setProperty("--party", color); root.dataset.party = "1"; }
  else { root.style.removeProperty("--party"); delete root.dataset.party; }
  if (seen) seen.observe(root);

  fallback.textContent = initials(name);
  const sources = [];
  const m = url && url.match(OFFICIAL);
  if (m) sources.push(`img/mps/${m[1]}.webp`);  // our cut-out first, the official photo as it is next
  if (url) sources.push(cdnUrl(url));  // our copies (non-MPs) are on cdn.vitaradar.hu
  img.hidden = true;
  fallback.hidden = false;
  const token = (img.dataset.photo = String(Number(img.dataset.photo || 0) + 1));  // a newer setPhoto wins
  if (!sources.length) { img.removeAttribute("src"); return; }
  let i = 0;
  img.onload = () => { img.hidden = false; fallback.hidden = true; root.classList.toggle("cutout", i === 0 && Boolean(m)); };
  img.onerror = () => { i += 1; if (i < sources.length) img.src = sources[i]; else { img.hidden = true; fallback.hidden = false; } };
  img.alt = name || "";
  const start = () => { if (img.dataset.photo === token) img.src = sources[0]; };
  if (sources.some((s) => s.startsWith(CDN))) cdnReady().then(start); else start();  // the CDN needs its cookie
}

// ------------------------------------------------------------------ digital rain (like the stream's overlay)
const GLYPHS = "0123456789ÁÉÍÓÖŐÚÜŰABCDEFGHIJKLMNOPRSTUVZ%§$#=+<>≠∑∆¿?!*/";

export function startRain(canvas) {
  if (!canvas || getComputedStyle(canvas).display === "none") return;  // the new look has none (css)
  const ctx = canvas.getContext("2d");
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const size = 16;
  let cols = [], w = 0, h = 0;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
    cols = Array.from({ length: Math.ceil(w / size) }, () => ({
      y: Math.random() * -h, speed: 0.4 + Math.random() * 0.9, glyphs: [],
    }));
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, w, h);
  }

  function frame() {
    ctx.fillStyle = "rgba(0, 0, 0, 0.12)";  // fade the trails
    ctx.fillRect(0, 0, w, h);
    ctx.font = `${size}px "JetBrains Mono", ui-monospace, monospace`;
    cols.forEach((c, i) => {
      const ch = GLYPHS[(Math.random() * GLYPHS.length) | 0];
      const x = i * size, y = c.y * size;
      ctx.fillStyle = "#d8ffe3";  // the head
      ctx.fillText(ch, x, y);
      ctx.fillStyle = "#00ff41";
      ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], x, y - size);
      c.y += c.speed;
      if (y > h + size * 4 && Math.random() > 0.975) c.y = Math.random() * -20;
    });
  }

  resize();
  window.addEventListener("resize", resize);
  if (still) { for (let i = 0; i < 120; i++) frame(); return; }  // one still image, no motion
  let last = 0;
  (function loop(t) {
    if (t - last > 50 && !document.hidden) { frame(); last = t; }  // ~20 frames a second
    requestAnimationFrame(loop);
  })(0);
}

startRain(document.getElementById("rain"));
const year = document.getElementById("year");
if (year) year.textContent = String(new Date().getFullYear());

// The header's "Élő adás" link tells whether a broadcast is on: it glows red with a blinking dot while live and reads
// "nincs adás" otherwise. Both labels are in the page from the start, stacked in one grid cell (css .live-stack), so the
// link keeps the width of the longer one; until the state is known (data-live="loading") it reads what the last page
// knew (html[data-live], set in each page's head from localStorage), else "nincs adás".
// The phone menu's hamburger follows its data-live (js/menu.js).
export function setLiveNav(on) {
  // remembered for the next page: it shows the same label from its first paint (each page's head, css), so a page
  // change does not flip "Élő adás" to "nincs adás" while the state loads
  try { localStorage.setItem("vr-live", on ? "on" : "off"); } catch { /* private mode: the loading label stays */ }
  document.documentElement.dataset.live = on ? "on" : "off";
  for (const a of document.querySelectorAll(".nav-live")) {
    a.dataset.live = on ? "on" : "off";
    // the state in the accessible name (the visible label alone reads "nincs adás", or "Élő adás" either way)
    a.setAttribute("aria-label", on ? "Élő adás (most adásban)" : "Élő adás (most nincs adás)");
  }
}

// The same on pages other than the live page, which follows live/current itself (js/app.js).
export function watchLiveNav() {
  if (!document.querySelector(".nav-live")) return;
  onSnapshot(doc(db, "live", "current"), (snap) => setLiveNav(Boolean((snap.data() || {}).active)));
}
