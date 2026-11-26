// vitaradar.hu's service worker (registered by js/pwa.js on every page). It does one thing: when the phone has no
// connection, a page load shows offline.html instead of the browser's error. Nothing else changes.
//
// What it handles: page loads on this site (navigations), network first, always: the page comes from the network as it
// would without a worker (navigation preload starts that request while the worker wakes up), and only when that fails
// does the stored offline page answer. Pages are never stored, so a page is never older than what the site serves.
//
// What it never handles: everything else goes to the network untouched, as if there were no worker (no respondWith):
// this site's scripts, styles and pictures (their ?v= keys and the browser's own cache work as before), Firestore,
// sign-in (auth.vitaradar.hu, Google), App Check and reCAPTCHA, the live video (cdn.vitaradar.hu: live.m3u8, the .ts
// pieces), the archive's video, Twitch, YouTube, the fonts, our API and search.
//
// Updates: the browser checks this file on every page load (js/pwa.js registers it with updateViaCache "none", so the
// HTTP cache never answers for it) and installs a changed one at once (skipWaiting, clients.claim): safe, because the
// worker holds no part of the site, only the offline page. A deploy of the site itself needs nothing here. When
// offline.html changes, raise VERSION: the new worker stores the new page and deletes the old one.
// To take the worker away for good: replace this file with one that deletes its caches and calls
// self.registration.unregister() (and stop registering it in js/pwa.js); every browser drops it on its next visit.

const VERSION = "1";
const CACHE = `vr-offline-${VERSION}`;
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.add(new Request(OFFLINE, { cache: "reload" }));  // from the server, not the HTTP cache
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable(); } catch { /* the page waits for the worker instead */ }
    }
    for (const key of await caches.keys()) if (key.startsWith("vr-offline-") && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.mode !== "navigate" || req.method !== "GET") return;  // not a page load: the network, untouched
  event.respondWith((async () => {
    try {
      const early = await event.preloadResponse;  // navigation preload: the same request, started earlier
      return early || await fetch(req);
    } catch {
      return (await caches.match(OFFLINE, { cacheName: CACHE })) || Response.error();
    }
  })());
});
