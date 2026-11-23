// Shared by every page: Firebase, the digital rain behind the page, and small helpers.

import { doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db } from "./firebase.js?v=202611231830";

export { db };  // set up once, with App Check, in firebase.js

export const LABEL = {
  true: "IGAZ", false: "HAMIS", unverifiable: "NEM ELLENŐRIZHETŐ", pending: "ELLENŐRZÉS", fallacy: "HIBÁS ÉRVELÉS",
};

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

// A verdict badge like the stream's: [ IGAZ ]
export function badge(verdict, kind) {
  const v = kind === "fallacy" ? "fallacy" : verdict || "pending";
  const b = el("span", "verdict");
  b.dataset.v = v;
  b.textContent = `[ ${kind === "conclusion" && v !== "pending" ? "KÖVETKEZTETÉS: " : ""}${LABEL[v] || v} ]`;
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
  if (url) sources.push(url);
  img.hidden = true;
  fallback.hidden = false;
  if (!sources.length) { img.removeAttribute("src"); return; }
  let i = 0;
  img.onload = () => { img.hidden = false; fallback.hidden = true; root.classList.toggle("cutout", i === 0 && Boolean(m)); };
  img.onerror = () => { i += 1; if (i < sources.length) img.src = sources[i]; else { img.hidden = true; fallback.hidden = false; } };
  img.alt = name || "";
  img.src = sources[0];
}

// ------------------------------------------------------------------ digital rain (like the stream's overlay)
const GLYPHS = "0123456789ÁÉÍÓÖŐÚÜŰABCDEFGHIJKLMNOPRSTUVZ%§$#=+<>≠∑∆¿?!*/";

export function startRain(canvas) {
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

// The header's live badge on pages other than the live page.
export function watchLiveBadge() {
  const badgeEl = document.getElementById("live-badge"), text = document.getElementById("live-text");
  if (!badgeEl) return;
  onSnapshot(doc(db, "live", "current"), (snap) => {
    const on = Boolean((snap.data() || {}).active);
    badgeEl.dataset.state = on ? "on" : "off";
    text.textContent = on ? "élő · késleltetve" : "nincs adás";
  });
}
