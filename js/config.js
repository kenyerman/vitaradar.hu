// Public web config of the vitaradar.hu Firebase app. These values are not secrets: every Firebase website ships
// them. What protects the data is the Firestore security rules (kept with the backend): the public data is read-only.
export const firebaseConfig = {
  "apiKey": "AIzaSyBuAd6Zk3R_tiPEOHwfJhIvClEAMSgLIKw",
  "authDomain": "parlament-factcheck.firebaseapp.com",
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
