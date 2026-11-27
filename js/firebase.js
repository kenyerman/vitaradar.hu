// Firebase for the whole site, set up once: the app, App Check and Firestore. Every page imports from here.
//
// App Check (reCAPTCHA Enterprise, invisible and score-based) proves that requests come from this site and not from
// a script: the Firebase SDK attaches its token to Firestore requests by itself, and appCheckHeaders() adds it to
// calls to our own functions (the speech search, the user API). Sign-in is Google only: a popup, or in the iPhone app
// the page goes to Google and comes back (below, at "sign-in").

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken, onTokenChanged } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js";
import { getFirestore, onSnapshot, disableNetwork, enableNetwork } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence,
  browserPopupRedirectResolver, GoogleAuthProvider, signInWithPopup, reauthenticateWithPopup, signOut as fbSignOut,
  signInWithRedirect, reauthenticateWithRedirect, getRedirectResult,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { firebaseConfig, recaptchaSiteKey } from "./config.js?v=202611241021";
import { withTimeout, sleep } from "./net.js?v=202611270600";

// The iPhone app (the site added to the home screen, js/pwa.js) signs in by leaving the page; its sign-in helper is on
// vitaradar.hu itself (the "sign-in" part below says why).
export const signInLeavesPage = navigator.standalone === true;
const SITE_AUTH_DOMAIN = "vitaradar.hu";  // __/auth/ of this site (tools/auth-helper.sh)

export const app = initializeApp(signInLeavesPage ? { ...firebaseConfig, authDomain: SITE_AUTH_DOMAIN } : firebaseConfig);

// ------------------------------------------------------------------ App Check that recovers
// Firebase's own reCAPTCHA Enterprise provider (10.14.1, pinned above), with what it lacks. Firestore, sign-in and our
// API all wait for its token, so when it is stuck the whole page is: lists that never fill, "– online" for good, and
// a live page saying there is no broadcast. It got stuck in three ways, all seen from iPhones (26 Nov: 29 refused
// exchanges and 15 broken reCAPTCHA tokens out of ~600; one iPhone tab had no token for a whole day):
//   1. reCAPTCHA rated the visitor under the 0.5 the project asks for, the exchange answered 403, and the SDK then
//      refused to try again for 24 hours (its setBackoff): every request of that page went out with an invalid token.
//   2. Google's reCAPTCHA script did not load (a blocked or dropped request): the SDK's loader has no error handler,
//      so its token waits forever, and Firestore with it.
//   3. reCAPTCHA or the exchange never answered: the same endless wait, shared by every later call.
// This one tries up to three times per call, each try at most 10 s, each with a new reCAPTCHA token (which may score
// higher); after a failed call it holds back 15 s, 30 s, 1 min, 2 min, then 5 min (not a day), so a stuck page does
// not ask reCAPTCHA in a loop. A reCAPTCHA script that failed to load is loaded again. Firestore waits for these tries
// as it waited for the SDK's; js/netwatch.js tells the reader when the data does not come.
const TRY_MS = 10_000;
const TRY_AFTER = [0, 1500, 4000];
const HOLD_MS = [15_000, 30_000, 60_000, 120_000, 300_000];
const RECAPTCHA_JS = "https://www.google.com/recaptcha/enterprise.js";  // what the SDK loads (initializeEnterprise)

class SiteCheck extends ReCaptchaEnterpriseProvider {
  constructor(key) {
    super(key);
    this.failedCalls = 0;
    this.lastFailure = null;  // { at, why } of the last call that got no token (siteCheckFailure below)
  }

  initialize(app) {
    super.initialize(app);  // adds Google's script, unless the page has grecaptcha already
    reloadRecaptchaOnError();
  }

  async getToken() {
    const held = this._throttleData;  // ours only (httpStatus 0): the SDK's own, set by a 403, would last a day
    if (held && held.httpStatus === 0 && Date.now() < held.allowRequestsAfter) return super.getToken();  // "throttled"
    let error = null;
    for (const wait of TRY_AFTER) {
      if (wait) await sleep(wait);
      this._throttleData = null;
      try {
        const token = await withTimeout(super.getToken(), TRY_MS, "App Check");
        this.failedCalls = 0;
        return token;
      } catch (e) {
        error = e;
      }
    }
    const hold = HOLD_MS[Math.min(this.failedCalls, HOLD_MS.length - 1)];
    this.failedCalls += 1;
    this._throttleData = { backoffCount: this.failedCalls, allowRequestsAfter: Date.now() + hold, httpStatus: 0 };
    this.lastFailure = { at: Date.now(), why: failureKind(error) };
    console.warn(`app check: no token after ${TRY_AFTER.length} tries (${this.lastFailure.why}), next try in ${hold / 1000} s:`, error);
    throw error;
  }
}

// What the last try of a failed call ran into, for the page's words (js/netwatch.js) and the console:
//   "timeout"   reCAPTCHA or the exchange did not answer in TRY_MS (a slow or stalled connection, a script not loaded);
//   "score"     the exchange answered 403: reCAPTCHA rated the visitor under the project's minimum score;
//   "token"     the exchange answered 401: reCAPTCHA gave a broken token (its "browser_error": it could not run);
//   "recaptcha" Google's script failed while making the token;
//   "other"     anything else (another HTTP status, an error of the SDK).
// Rate limits would show as "other" with HTTP 429: none seen (27 Nov 2026: the exchange answered 200, 401 and 403 only).
function failureKind(e) {
  if (e?.code === "timeout") return "timeout";
  const status = Number(e?.customData?.httpStatus);
  if (status === 403) return "score";
  if (status === 401) return "token";
  if (e?.code === "appCheck/recaptcha-error") return "recaptcha";
  return status ? `other (HTTP ${status})` : `other (${e?.code || e?.message || e})`;
}

// The SDK's script tag runs the SDK's setup from its onload, and has no onerror. When it fails, the same onload goes
// on a new tag (up to 4 times, 2 s to 20 s apart, or when the connection is back); it runs once, whichever loads.
function reloadRecaptchaOnError() {
  const first = [...document.querySelectorAll("script")].find((s) => s.src === RECAPTCHA_JS);
  if (!first || typeof first.onload !== "function") return;
  const setup = first.onload;
  let ran = false, tries = 0;
  const onload = (e) => { if (!ran) { ran = true; setup(e); } };
  const watch = (s) => {
    s.onload = onload;
    s.addEventListener("error", () => {
      if (ran || tries >= 4) return;
      const again = () => {
        if (ran) return;
        const n = document.createElement("script");
        n.src = RECAPTCHA_JS;
        watch(n);
        s.remove();
        document.head.append(n);
      };
      const wait = [2000, 5000, 10000, 20000][tries++];
      setTimeout(() => (navigator.onLine === false ? addEventListener("online", again, { once: true }) : again()), wait);
    }, { once: true });
  };
  watch(first);
}

const siteCheck = new SiteCheck(recaptchaSiteKey);
export const appCheck = initializeAppCheck(app, {
  provider: siteCheck,
  isTokenAutoRefreshEnabled: true,
});

// The last failed site check of this page ({ at, why }, why as in failureKind), or null when none failed. A refused
// Firestore read of a public document (permission-denied) after one means the read went out without a valid token.
export function siteCheckFailure() {
  return siteCheck.lastFailure;
}

// fn() once App Check has a valid token: at once if it has one now, otherwise when the next check passes (SiteCheck's
// next round, which the header's heartbeat and Firebase's token refresh start). Returns the function that stops waiting.
export function onSiteCheckPassed(fn) {
  let stop = null, done = false;
  stop = onTokenChanged(appCheck, () => {
    if (done) return;
    done = true;
    stop?.();
    fn();
  });
  if (done) stop();
  return () => { done = true; stop?.(); };
}

export const db = getFirestore(app);

// One read of a document or a query, as the server has it: the pages' getDoc and getDocs (js/common.js passes them
// on). Firestore's own settle for the local cache once the server has not answered for 10 seconds; on a fresh page
// that cache is empty, so a slow first connection (Safari on iPhone, now and then) left a list empty, or said "no
// replays yet", and the page never came back to it. A listener keeps trying and answers when the server does; it
// stops after that one answer. A refused read (the rules) fails as before.
// Now and then Safari's connection to Firestore stalls and does not come back by itself (seen on iPhone: the page's
// own requests worked, the reads never got an answer). A read with no answer after 8 seconds starts the connection
// anew; at most once in 15 seconds for the whole page, however many reads wait.
// A read still without an answer after 25 seconds fails (a TimeoutError, js/net.js), so the page says so and offers
// "Újrapróbálás" instead of loading for ever; the kicks above have had two goes by then.
const STALL_MS = 8000;
const READ_MS = 25_000;
let lastKick = 0;
export function kick(why = "no answer in 8 s") {
  if (Date.now() - lastKick < 15000) return;
  lastKick = Date.now();
  console.warn(`firestore: ${why}, reconnecting`);
  disableNetwork(db).then(() => enableNetwork(db)).catch((e) => console.warn("firestore reconnect:", e));
}

function fromServer(ref) {
  return withTimeout(new Promise((resolve, reject) => {
    let stop = null, done = false, timer = 0;
    const end = () => { done = true; clearInterval(timer); stop?.(); };
    stop = onSnapshot(ref, { includeMetadataChanges: true },
      (snap) => { if (!done && !snap.metadata.fromCache) { end(); resolve(snap); } },
      (e) => { if (!done) { end(); reject(e); } });
    if (done) stop();  // it answered before onSnapshot returned
    else {
      timer = setInterval(kick, STALL_MS);
      setTimeout(() => { if (!done) end(); }, READ_MS);  // given up (below): stop listening
    }
  }), READ_MS, "adatbázis");
}
export { fromServer as getDoc, fromServer as getDocs };

// Headers proving this request comes from the site, for our own functions. Empty when no token can be had in time
// (the function then answers 401, and the caller says what failed). SiteCheck bounds its own tries; this bounds the
// wait for them, so a call to our API is never held for long by the check.
const HEADERS_MS = 12_000;
export async function appCheckHeaders() {
  try {
    const { token } = await withTimeout(getToken(appCheck, false), HEADERS_MS, "App Check");
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
//
// In the iPhone app the page itself goes to Google and comes back (a redirect): Firebase finishes it as the page loads
// again, and js/account.js sees the user as after a popup. Google's answer comes to the helper's page, which keeps it in
// its own storage for the helper's iframe on our page to pick up. Through auth.vitaradar.hu that cannot arrive: Safari
// gives an iframe from another address (even our own subdomain) storage of its own, apart from the same address opened
// as a page (a test page in the iOS 26.5 Simulator's home-screen app showed it, 27 Nov 2026; Firebase's "Best practices
// for using signInWithRedirect on browsers that block third-party storage access"), so the app came back signed out. So
// there the helper is served from vitaradar.hu itself (__/auth/: Firebase's own files, kept current by
// tools/auth-helper.sh and its weekly workflow), the page's own address and storage. Everywhere else (the browser, and
// Android's app, where the popup comes back) the popup through auth.vitaradar.hu, as before.

// Apps' own browsers (Facebook, Instagram, Messenger, TikTok…): Google signs no one in there ("disallowed_useragent":
// Android's WebView, and iPhone apps' web views, which leave "Safari/" out of their name, unlike Safari's own views
// and the home-screen app). The tap tells the reader to open the page in the browser instead (js/account.js).
const UA = navigator.userAgent;
export const signInRefused = (/Android/.test(UA) && /; wv\)/.test(UA))
  || (/iPhone|iPod|iPad/.test(UA) && !/Safari\//.test(UA) && navigator.standalone !== true);

class Resolver extends browserPopupRedirectResolver {
  get _shouldInitProactively() { return false; }
  get _early() { return super._shouldInitProactively; }  // phones and Safari
}

export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
  popupRedirectResolver: Resolver,
});
auth.languageCode = "hu";

// The helper, now, where it is needed before the tap (phones and Safari): for a visitor who is signed out, and for a
// user who will have to sign in again (deleting the account, js/account.js).
export function readySignIn() {
  if (signInLeavesPage) return;  // no popup there: the helper loads when the page comes back from Google
  const r = auth._popupRedirectResolver;
  if (r?._early) r._initialize(auth).catch(() => {});  // failed: the tap loads it again
}

function warmSignIn() {
  auth.authStateReady().then(() => { if (!auth.currentUser) readySignIn(); });
}
if (document.readyState === "complete") setTimeout(warmSignIn, 1000);
else addEventListener("load", () => setTimeout(warmSignIn, 1000), { once: true });

export function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  if (signInLeavesPage) return signInWithRedirect(auth, provider, Resolver);
  return signInWithPopup(auth, provider, Resolver);  // the same helper as auth's (one per class)
}

// Google's sign-in window again, for the signed-in user (deleting the account wants a recent sign-in): through the
// same helper, not a second one that would load only on the tap. In the iPhone app the page goes and comes back, signed
// in anew: the deletion is then started again (js/account.js says so before).
export function signInAgain(user) {
  const provider = new GoogleAuthProvider();
  if (user.email) provider.setCustomParameters({ login_hint: user.email });
  if (signInLeavesPage) return reauthenticateWithRedirect(user, provider, Resolver);
  return reauthenticateWithPopup(user, provider, Resolver);
}

// How the last redirect sign-in ended, in the iPhone app: null, or the error to show (Firebase finished it at start).
export function redirectError() {
  if (!signInLeavesPage) return Promise.resolve(null);
  return getRedirectResult(auth, Resolver).then(() => null, (e) => e);
}

export function signOut() {
  return fbSignOut(auth);
}
