// cdn.vitaradar.hu: the site's video, the archive and the avatars, served by Cloud CDN from private buckets.
//
// The CDN serves a request only when it carries a signed cookie (Cloud-CDN-Cookie). Our API hands that cookie out
// at /cdn, to the site only: like every API call, it needs an App Check token (reCAPTCHA Enterprise). The page
// stores the cookie for .vitaradar.hu, so the browser sends it with the player's requests (withCredentials) and
// with the images, and renews it before the hour is up. Elsewhere (localhost) the addresses are left as they were.

import { apiUrl } from "./config.js?v=202611241021";
import { appCheckHeaders } from "./firebase.js?v=202611251640";

export const CDN = "https://cdn.vitaradar.hu/";
const ENABLED = true;
const ON_SITE = ENABLED && /(^|\.)vitaradar\.hu$/.test(location.hostname);
const EXP = "vr-cdn-exp";  // when our cookie runs out (unix s): document.cookie can't tell
const RENEW_S = 600;       // renew this long before

function expires() {
  try { return Number(localStorage.getItem(EXP)) || 0; } catch { return 0; }
}

function fresh() {
  return expires() - Date.now() / 1000 > RENEW_S && document.cookie.includes("Cloud-CDN-Cookie=");
}

let pending = null;
let timer = 0;

async function fetchCookie() {
  const r = await fetch(apiUrl + "/cdn", {
    method: "POST", headers: { ...(await appCheckHeaders()), "Content-Type": "application/json" }, body: "{}",
  });
  if (!r.ok) throw new Error(`cdn cookie: ${r.status}`);
  const { name, value, expires: exp } = await r.json();
  document.cookie = `${name}=${value}; Domain=vitaradar.hu; Path=/; Expires=${new Date(exp * 1000).toUTCString()}; `
    + "Secure; SameSite=Lax";
  try { localStorage.setItem(EXP, String(exp)); } catch { /* private mode: renewed per page load */ }
  clearTimeout(timer);
  timer = setTimeout(() => { pending = null; cdnReady(); }, Math.max(60, exp - Date.now() / 1000 - RENEW_S) * 1000);
}

// Resolves once the cookie is in place (true), or at once off the site (false). Never rejects: a failure leaves the
// media to fail visibly (the player's own error handling, the avatars' initials).
export function cdnReady() {
  if (!ON_SITE) return Promise.resolve(false);
  if (fresh()) return Promise.resolve(true);
  pending ??= fetchCookie().then(() => true, (e) => { console.warn(e); pending = null; return false; });
  return pending;
}

// The CDN address of a bucket file (the addresses the pipeline and the avatar service store); others unchanged.
const BUCKETS = [
  [/^https:\/\/storage\.googleapis\.com\/parlament-factcheck-live\//, CDN],
  [/^https:\/\/storage\.googleapis\.com\/parlament-factcheck-archive\//, CDN + "archive/"],
];
const AVATAR = /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/parlament-factcheck-avatars\/o\/([^?#]+)/;

export function cdnUrl(url) {
  if (!ON_SITE || typeof url !== "string") return url;
  for (const [re, to] of BUCKETS) if (re.test(url)) return url.replace(re, to);
  const m = url.match(AVATAR);
  return m ? CDN + decodeURIComponent(m[1]) : url;  // avatars/{uid}/{version}/{size}.webp
}

// hls.js: send the cookie with every request to the CDN (playlists and pieces).
export function cdnXhr(xhr, url) {
  if (url.startsWith(CDN)) xhr.withCredentials = true;
}
