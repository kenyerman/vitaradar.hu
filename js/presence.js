// Who is on the site right now, visitors included: a heartbeat to the user API (/presence) about every 30 s, answered
// with the counts. The header shows "N online", and its tooltip says how many are signed in and how many watch the
// live stream. Each heartbeat carries a random id; App Check still guards the call, and the ID token, when someone is
// signed in, only marks them as signed in. Only with the visitor's consent (consent.js) does the browser keep that id,
// so that several pages and tabs count once; without it the id lives in this page's memory and nothing is stored.

import { auth, appCheckHeaders } from "./firebase.js?v=202611240845";
import { apiUrl } from "./config.js?v=202611240845";
import { consented, onConsentChange } from "./consent.js?v=202611240845";

const EVERY_MS = 30_000;
const KEY = "vr-presence-id";

function browserId() {
  const fresh = () => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  if (!consented()) {
    try { localStorage.removeItem(KEY); } catch { /* nothing stored */ }  // one kept before the consent bar existed
    return fresh();
  }
  try {
    let id = localStorage.getItem(KEY);
    if (!id || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) { id = fresh(); localStorage.setItem(KEY, id); }
    return id;
  } catch {
    return fresh();  // no storage (private window): this tab counts on its own
  }
}

function pageName() {
  const p = location.pathname.split("/").pop() || "index.html";
  return { "index.html": "live", "mps.html": "mps", "mp.html": "mp", "archive.html": "archive", "watch.html": "watch" }[p]
    || "other";
}

// The badge is in the page from the start ("– online", data-state="loading"), under the logo next to BETA, so the
// header doesn't move when the first count arrives; pages without it get one there (or by the live badge).
function badge() {
  let b = document.getElementById("online");
  if (b) return b;
  const sub = document.querySelector(".brand-sub"), live = document.getElementById("live-badge");
  if (!sub && !live) return null;
  b = document.createElement("span");
  b.id = "online";
  b.className = "online-badge";
  b.dataset.state = "loading";
  b.setAttribute("role", "status");
  const dot = document.createElement("span");
  dot.className = "dot";
  dot.setAttribute("aria-hidden", "true");
  const n = document.createElement("span");
  n.className = "online-n";
  n.textContent = "– online";
  b.append(dot, n);
  if (sub) sub.append(b); else live.after(b);
  return b;
}

function show(c) {
  const b = badge();
  if (!b) return;
  b.querySelector(".online-n").textContent = `${c.online} online`;
  b.title = `${c.online} látogató van most az oldalon: ${c.signed_in} bejelentkezve, `
    + `${c.online - c.signed_in} vendég; ${c.live} nézi az élő adást.`;
  b.setAttribute("aria-label", b.title);
  b.dataset.state = "on";
}

function unknown() {  // no figure rather than a wrong one; the badge keeps its place
  const b = badge();
  if (!b) return;
  b.querySelector(".online-n").textContent = "– online";
  b.title = "Most nem tudjuk, hányan vannak az oldalon.";
  b.setAttribute("aria-label", b.title);
  b.dataset.state = "unknown";
}

const id = browserId();
const page = pageName();
onConsentChange((ok) => {  // keep this page's id once allowed, drop it when the consent is withdrawn
  try { if (ok) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* no storage */ }
});
let busy = false;

async function beat() {
  if (busy) return;
  busy = true;
  try {
    const headers = { ...(await appCheckHeaders()), "Content-Type": "application/json" };
    const user = auth.currentUser;
    if (user) {
      try { headers.Authorization = `Bearer ${await user.getIdToken()}`; } catch { /* counted as a visitor */ }
    }
    const r = await fetch(`${apiUrl}/presence`, { method: "POST", headers, body: JSON.stringify({ id, page }) });
    if (!r.ok) throw new Error(String(r.status));
    show(await r.json());
  } catch (e) {
    unknown();
    console.warn("presence:", e);
  } finally {
    busy = false;
  }
}

beat();
setInterval(beat, EVERY_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) beat(); });
auth.onAuthStateChanged(() => beat());  // signing in or out changes the signed-in count
