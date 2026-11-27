// Every page: says so when the data stops coming, with "Újrapróbálás", instead of a page that loads for ever.
//
// Firestore never tells a page that it cannot reach the server: its listeners just wait (on an iPhone, sometimes for
// good: a reCAPTCHA check that failed, a connection that died while the phone was locked). So the page watches one
// small document, live/current (the header's "Élő adás" listens to it anyway, so this costs no extra read): while its
// copy is not the server's (metadata.fromCache) for 12 seconds of the page being on screen, a bar under the header
// says the server cannot be reached; it goes when the server answers again. A refused listener (the rules or App
// Check) means the page's own listeners stopped too: then the bar stays, and Újrapróbálás loads the page again.
// After the page comes back from the background (or from the back-forward cache), a quick read from the server checks
// the connection, and a stuck one is started anew (js/firebase.js kick).

import { doc, onSnapshot, getDocFromServer } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, kick } from "./firebase.js?v=202611272300";
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
  console.warn("netwatch:", e);
  refused = e;
  update();
});

function state() {
  if (refused) return "refused";
  if (synced || document.hidden) return null;
  if (performance.now() - waitingSince < GRACE_MS) return null;
  return navigator.onLine === false ? "offline" : "unreachable";
}

const TEXT = {
  offline: ["Nincs internetkapcsolat", "Amint visszajön, az oldal magától folytatja."],
  unreachable: ["Nem érjük el a szervert", "Az adatok most nem töltődnek be. Várj egy kicsit, vagy próbáld újra."],
  refused: ["Megszakadt a kapcsolat a szerverrel", "A böngésződ ellenőrzése (reCAPTCHA) nem sikerült. Próbáld újra."],
};

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
