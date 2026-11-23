// Firebase for the whole site, set up once: the app, App Check and Firestore. Every page imports from here.
//
// App Check (reCAPTCHA Enterprise, invisible and score-based) proves that requests come from this site and not from
// a script: the Firebase SDK attaches its token to Firestore requests by itself, and appCheckHeaders() adds it to
// calls to our own functions (the speech search, the user API). Sign-in is Google only (a popup).

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { initializeAppCheck, ReCaptchaEnterpriseProvider, getToken } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut as fbSignOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { firebaseConfig, recaptchaSiteKey } from "./config.js?v=202611231830";

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
export const auth = getAuth(app);
auth.languageCode = "hu";

export function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  return signInWithPopup(auth, provider);
}

export function signOut() {
  return fbSignOut(auth);
}
