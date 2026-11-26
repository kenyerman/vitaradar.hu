// Firebase for the whole site, set up once: the app, App Check and Firestore. Every page imports from here.
//
// App Check (reCAPTCHA Enterprise, invisible and score-based) proves that requests come from this site and not from
// a script: the Firebase SDK attaches its token to Firestore requests by itself, and appCheckHeaders() adds it to
// calls to our own functions (the speech search, the user API). Sign-in is Google only (a popup).

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js";
import { getFirestore, onSnapshot, disableNetwork, enableNetwork } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence,
  browserPopupRedirectResolver, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { firebaseConfig, recaptchaSiteKey } from "./config.js?v=202611241021";

export const app = initializeApp(firebaseConfig);

export const appCheck = initializeAppCheck(app, {
  provider: new ReCaptchaEnterpriseProvider(recaptchaSiteKey),
  isTokenAutoRefreshEnabled: true,
});

export const db = getFirestore(app);

// One read of a document or a query, as the server has it: the pages' getDoc and getDocs (js/common.js passes them
// on). Firestore's own settle for the local cache once the server has not answered for 10 seconds; on a fresh page
// that cache is empty, so a slow first connection (Safari on iPhone, now and then) left a list empty, or said "no
// replays yet", and the page never came back to it. A listener keeps trying and answers when the server does; it
// stops after that one answer. A refused read (the rules) fails as before.
// Now and then Safari's connection to Firestore stalls and does not come back by itself (seen on iPhone: the page's
// own requests worked, the reads never got an answer). A read with no answer after 8 seconds starts the connection
// anew; at most once in 15 seconds for the whole page, however many reads wait.
const STALL_MS = 8000;
let lastKick = 0;
function kick() {
  if (Date.now() - lastKick < 15000) return;
  lastKick = Date.now();
  console.warn("firestore: no answer in 8 s, reconnecting");
  disableNetwork(db).then(() => enableNetwork(db)).catch((e) => console.warn("firestore reconnect:", e));
}

function fromServer(ref) {
  return new Promise((resolve, reject) => {
    let stop = null, done = false, timer = 0;
    const end = () => { done = true; clearInterval(timer); stop?.(); };
    stop = onSnapshot(ref, { includeMetadataChanges: true },
      (snap) => { if (!done && !snap.metadata.fromCache) { end(); resolve(snap); } },
      (e) => { if (!done) { end(); reject(e); } });
    if (done) stop();  // it answered before onSnapshot returned
    else timer = setInterval(kick, STALL_MS);
  });
}
export { fromServer as getDoc, fromServer as getDocs };

// Headers proving this request comes from the site, for our own functions. Empty when no token can be had (the
// function then answers 401 and the page says the search is unavailable).
export async function appCheckHeaders() {
  try {
    const { token } = await getToken(appCheck, false);
    return { "X-Firebase-AppCheck": token };
  } catch (e) {
    console.warn("app check:", e);
    return {};
  }
}

// ------------------------------------------------------------------ sign-in (Google only)
// getAuth()'s own setup, with the sign-in helper (an iframe from auth.vitaradar.hu, about 95 KB) ready before the
// first tap on "Belépés" on phones and in Safari: those open the Google window only straight from a tap, and loaded
// on the tap the helper came too late, so the first tap opened nothing. Firebase would load it at page start there,
// but then it holds sign-in back until the iframe is in, and Firestore waits for sign-in: on a slow connection the
// lists stayed empty for up to half a minute. So Firebase does not load it itself (_shouldInitProactively), and
// warmSignIn() loads it once the page is in, for a visitor who is signed out. _shouldInitProactively and
// _initialize are what Firebase itself uses for this (firebase-auth 10.14.1, pinned above).
class Resolver extends browserPopupRedirectResolver {
  get _shouldInitProactively() { return false; }
  get _early() { return super._shouldInitProactively; }  // phones and Safari
}

export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
  popupRedirectResolver: Resolver,
});
auth.languageCode = "hu";

function warmSignIn() {
  auth.authStateReady().then(() => {
    const r = auth._popupRedirectResolver;
    if (!auth.currentUser && r?._early) r._initialize(auth).catch(() => {});  // failed: the tap loads it again
  });
}
if (document.readyState === "complete") setTimeout(warmSignIn, 1000);
else addEventListener("load", () => setTimeout(warmSignIn, 1000), { once: true });

export function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(auth, provider, Resolver);  // the same helper as auth's (one per class)
}

export function signOut() {
  return fbSignOut(auth);
}
