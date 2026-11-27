// Every page: says so when the data stops coming, with "Újrapróbálás", instead of a page that loads for ever.
//
// Firestore never tells a page that it cannot reach the server: its listeners just wait (on an iPhone, sometimes for
// good: a reCAPTCHA check that failed, a connection that died while the phone was locked). So the page watches one
// small document, live/current (the header's "Élő adás" listens to it anyway, so this costs no extra read): while its
// copy is not the server's (metadata.fromCache) for 12 seconds of the page being on screen, a bar under the header
// says the server cannot be reached; it goes when the server answers again. A refused listener means the page's own
// listeners stopped too: then the bar stays, and Újrapróbálás loads the page again. Its words come from the error:
// live/current is public, so "permission-denied" there is App Check (the site check, reCAPTCHA Enterprise) and nothing
// else; any other error code (a server error, "resource-exhausted") gets plain words, without blaming reCAPTCHA.
// After a refusal by the site check, the page loads itself again once the check passes (recoverOnPass below).
// After the page comes back from the background (or from the back-forward cache), a quick read from the server checks
// the connection, and a stuck one is started anew (js/firebase.js kick).

import { doc, onSnapshot, getDocFromServer } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, kick, siteCheckFailure, onSiteCheckPassed } from "./firebase.js?v=202611281400";
import { withTimeout } from "./net.js?v=202611270600";

const GRACE_MS = 12_000;   // on screen this long without the server's answer: the bar
const AWAY_MS = 20_000;    // hidden at least this long: check the connection on return
const PROBE_MS = 6_000;

const ref = doc(db, "live", "current");
let synced = false;        // the last snapshot was the server's
let refused = null;        // the listener's error: the page's listeners are gone too
let waitingSince = performance.now();  // on screen and without the server since then
let hiddenAt = document.hidden ? performance.now() : 0;
let bar = null;

onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
  const was = synced;
  synced = !snap.metadata.fromCache;
  if (!synced && was) waitingSince = performance.now();
  update();
}, (e) => {
  const failed = siteCheckFailure();
  console.warn("netwatch:", e, failed ? `(site check failed ${Math.round((Date.now() - failed.at) / 1000)} s ago: ${failed.why})` : "");
  refused = e;
  update();
  if (e?.code === "permission-denied" && failed) recoverOnPass();
});

function state() {
  if (refused) {
    if (refused.code !== "permission-denied") return "failed";
    return siteCheckFailure()?.why === "timeout" ? "checkSlow" : "refused";
  }
  if (synced || document.hidden) return null;
  if (performance.now() - waitingSince < GRACE_MS) return null;
  return navigator.onLine === false ? "offline" : "unreachable";
}

const TEXT = {
  offline: ["Nincs internetkapcsolat", "Amint visszajön, az oldal magától folytatja."],
  unreachable: ["Nem érjük el a szervert", "Az adatok most nem töltődnek be. Várj egy kicsit, vagy próbáld újra."],
  refused: ["Megszakadt a kapcsolat a szerverrel", "A böngésződ ellenőrzése (reCAPTCHA) nem sikerült. Próbáld újra."],
  checkSlow: ["Megszakadt a kapcsolat a szerverrel", "A böngésződ ellenőrzése (reCAPTCHA) nem fejeződött be időben. Próbáld újra."],
  failed: ["Megszakadt a kapcsolat a szerverrel", "A szerver hibával válaszolt. Próbáld újra."],
};

// The site check failed, so this listener and the page's own went out without a valid token, and stay refused even
// when the check passes later (SiteCheck tries again after its hold; the header's heartbeat and Firebase's token
// refresh ask it to). Once it passes, the page is loaded again: what Újrapróbálás does, without the tap, and quick,
// because Firebase keeps the new token for the reloaded page (no new reCAPTCHA round). At most once in 5 minutes:
// history.state survives the reload, so a check that passes and then is refused again does not reload in a loop.
const RELOAD_GAP_MS = 5 * 60_000;
let recovering = false;
function recoverOnPass() {
  if (recovering) return;
  const last = Number(history.state?.vrCheckReload) || 0;
  if (Date.now() - last < RELOAD_GAP_MS) return;
  recovering = true;
  onSiteCheckPassed(() => {
    console.warn("netwatch: the site check passed again, reloading the page");
    try { history.replaceState({ ...(history.state || {}), vrCheckReload: Date.now() }, ""); } catch { /* no state */ }
    location.reload();
  });
}

function update() {
  const s = state();
  if (!s) { bar?.remove(); bar = null; return; }
  if (bar?.dataset.state === s) return;
  bar?.remove();
  bar = document.createElement("div");
  bar.className = "net-alert";
  bar.dataset.state = s;
  bar.setAttribute("role", "alert");  // read out as it appears
  const text = document.createElement("div");
  const title = document.createElement("strong");
  title.textContent = TEXT[s][0];
  const detail = document.createElement("span");
  detail.textContent = TEXT[s][1];
  text.append(title, detail);
  const retry = document.createElement("button");
  retry.type = "button";
  retry.className = "btn";
  retry.textContent = "Újrapróbálás";
  retry.addEventListener("click", () => { retry.disabled = true; location.reload(); });
  bar.append(text, retry);
  document.body.append(bar);
}

setInterval(update, 1000);
addEventListener("online", update);
addEventListener("offline", update);

// Back on screen: the time hidden does not count, and after a while away the connection is checked.
function back() {
  const away = hiddenAt ? performance.now() - hiddenAt : 0;
  hiddenAt = 0;
  if (!synced) waitingSince = performance.now();
  update();
  if (away >= AWAY_MS && !refused) {
    withTimeout(getDocFromServer(ref), PROBE_MS, "adatbázis").catch(() => kick("no answer after the page came back"));
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) hiddenAt = performance.now();
  else back();
});
addEventListener("pageshow", (e) => { if (e.persisted) { hiddenAt = hiddenAt || performance.now() - AWAY_MS; back(); } });
addEventListener("pagehide", () => { hiddenAt = performance.now(); });
