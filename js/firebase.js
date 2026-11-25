// Firebase for the whole site, set up once: the app, App Check and Firestore. Every page imports from here.
//
// App Check (reCAPTCHA Enterprise, invisible and score-based) proves that requests come from this site and not from
// a script: the Firebase SDK attaches its token to Firestore requests by itself, and appCheckHeaders() adds it to
// calls to our own functions (the speech search, the user API). Sign-in is Google only (a popup).

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
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
// getAuth()'s own setup. With the sign-in helper (an iframe from auth.vitaradar.hu, about 95 KB) given here, Firebase
// loads it at page start on phones and in Safari: those open the Google window only straight from a tap, and loaded
// on the tap the helper came too late, so the first tap on "Belépés" opened nothing. Other browsers load it on the tap.
export const auth = initializeAuth(app, {
  persistence: [indexedDBLocalPersistence, browserLocalPersistence, browserSessionPersistence],
  popupRedirectResolver: browserPopupRedirectResolver,
});
auth.languageCode = "hu";

export function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(auth, provider, browserPopupRedirectResolver);
}

export function signOut() {
  return fbSignOut(auth);
}
