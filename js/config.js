// Public web config of the vitaradar.hu Firebase app. These values are not secrets: every Firebase website ships
// them. What protects the data is the Firestore security rules (kept with the backend): the public data is read-only.
// authDomain is our own subdomain (Firebase Hosting serves the sign-in helper there), so Google's account chooser
// names auth.vitaradar.hu instead of parlament-factcheck.firebaseapp.com.
export const firebaseConfig = {
  "apiKey": "AIzaSyBuAd6Zk3R_tiPEOHwfJhIvClEAMSgLIKw",
  "authDomain": "auth.vitaradar.hu",
  "projectId": "parlament-factcheck",
  "appId": "1:347862343261:web:55323d17521fda9c9337b4",
  "messagingSenderId": "347862343261",
  "storageBucket": "parlament-factcheck.firebasestorage.app"
};

// Used until the live feed names the stream itself (live/current.hls_url).
export const defaultStream = "https://storage.googleapis.com/parlament-factcheck-live/live/live.m3u8";

// reCAPTCHA Enterprise site key for App Check (public by design; it only works on this site's domains).
export const recaptchaSiteKey = "6LedwC4uAAAAAHMtCo5sAB-qFvfLRedBJBZqIrIS";

// The speech search, a Cloud Run function in the same project (its code is with the backend, in a private repo).
export const searchUrl = "https://europe-west4-parlament-factcheck.cloudfunctions.net/vitaradar-search";

// The user API (accounts, votes, comments) and the profile-picture upload; their code is with the backend.
export const apiUrl = "https://europe-west4-parlament-factcheck.cloudfunctions.net/vitaradar-api";
export const avatarUrl = "https://vitaradar-avatar-347862343261.europe-west4.run.app";
// Profile pictures are served only from here (the server writes these addresses).
export const photoPrefix = "https://firebasestorage.googleapis.com/";
