// Anonymous counts for the site's makers: which kind of page loads (in the installed app, a browser or an app's own
// browser such as Facebook's; on iPhone, Android or a computer), how many visits begin, and what the app's install
// sheet did (js/pwa.js loads this module and says what happened). The user API's /stats adds them up per day.
//
// Nothing is stored in the browser for it and no id is sent: a request carries only those words, and the page's kind
// (live, mps…). From the address and browser name that every request brings anyway, the server tells about how many
// different readers came that day, through a hash with a key of that day that it throws away the next day; it keeps
// only the totals. What the backend keeps is in its functions/api/stats.py.
//
// Counting never holds the page up: events wait a second to go together, and a failed send is simply not counted.

import { appCheckHeaders } from "./firebase.js?v=202611281400";
import { fetchT } from "./net.js?v=202611270600";
import { apiUrl } from "./config.js?v=202611241021";

const WAIT = 1000;  // events of the same moment go in one request
const MAX = 20;     // per request (the API looks at no more)

let queue = [], ctx = null, timer = 0;

// `context`: {mode: "app"|"browser"|"inapp", platform: "ios"|"android"|"desktop"|"other"}; `page` only with "view"
export function count(event, context, page) {
  if (queue.length >= MAX) return;
  if (ctx && (ctx.mode !== context.mode || ctx.platform !== context.platform)) send();  // one context per request
  ctx = context;
  queue.push(page ? { e: event, p: page } : { e: event });
  if (!timer) timer = setTimeout(send, WAIT);
}

async function send() {
  clearTimeout(timer);
  timer = 0;
  const events = queue, context = ctx;
  queue = [];
  if (!events.length || !context) return;
  try {
    const check = await appCheckHeaders();
    if (!check["X-Firebase-AppCheck"]) return;  // the API answers nothing without it
    await fetchT(`${apiUrl}/stats`, {
      method: "POST",
      headers: { ...check, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: context.mode, platform: context.platform, events }),
    }, 15000);
  } catch { /* not counted */ }
}

// leaving the page (or the app going to the background): what is waiting goes now
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden" && queue.length) send(); });
