// Waits with an end, for every page: nothing the site starts may wait forever. On an iPhone a request now and then
// gets no answer at all, neither data nor an error (a stalled mobile connection, a page back from the background), and
// a wait without a limit left a spinner up for good. These give each wait a limit, after which the caller shows an
// error with "Újrapróbálás" (or tries again itself) instead.

export class TimeoutError extends Error {
  constructor(what, ms) {
    super(`${what}: nem jött válasz ${Math.round(ms / 1000)} másodperc alatt`);
    this.name = "TimeoutError";
    this.code = "timeout";
  }
}

// The promise, or a TimeoutError once ms have passed (the work itself goes on; its late answer is ignored).
export function withTimeout(promise, ms, what = "kérés") {
  let timer = 0;
  return Promise.race([
    promise,
    new Promise((_, reject) => { timer = setTimeout(() => reject(new TimeoutError(what, ms)), ms); }),
  ]).finally(() => clearTimeout(timer));
}

// fetch() that gives up after ms: the request is cancelled and a TimeoutError thrown. ms counts until the answer's
// headers are in; a caller reading a large body bounds that itself.
export async function fetchT(url, options = {}, ms = 15000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctl.signal });
  } catch (e) {
    if (ctl.signal.aborted) throw new TimeoutError(String(url).replace(/^https?:\/\/([^/?#]+).*/, "$1"), ms);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A script from another site (hls.js, Twitch's and YouTube's players): resolves when it ran, rejects when it failed or
// did not load in ms. A failed one is taken out of the page, so a later call loads it anew.
export function loadScript(src, ms = 20000) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    const timer = setTimeout(() => fail(new TimeoutError(src.replace(/^https?:\/\/([^/?#]+).*/, "$1"), ms)), ms);
    function fail(e) { clearTimeout(timer); s.onload = s.onerror = null; s.remove(); reject(e); }
    s.src = src;
    s.onload = () => { clearTimeout(timer); resolve(); };
    s.onerror = () => fail(new Error(`${src}: nem töltődött be`));
    document.head.append(s);
  });
}
