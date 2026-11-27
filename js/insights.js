// Session recordings and heatmaps (PostHog, EU cloud: data in Frankfurt), only for readers who accepted the cookie bar
// (js/consent.js "Elfogadom"). Before that nothing of PostHog loads; when the choice is withdrawn ("Döntésem
// módosítása") recording stops on the spot and what PostHog kept in this browser is removed.
//
// What a recording holds: the page's layout, scrolling, clicks and taps, so that we see where the site is hard to use.
// What it does not: anything typed (every field is masked), chat messages, comments, names, nicks and pictures of
// users (masked or blocked below), the live and replay videos (other sites' frames are never recorded), network
// requests and their headers. Nobody is identified: PostHog gets no account, uid or e-mail, only a random id it keeps in
// this browser (localStorage and sessionStorage keys ph_<key>_…; no cookies). The profile page is never recorded.
// Recordings expire after 30 days (PostHog's free plan); the client IP is discarded in the project's settings.
//
// The library is pinned (POSTHOG) and comes from jsDelivr; the recorder it loads on its own comes from PostHog's EU
// assets host at the same version.

import { consented, onConsentChange } from "./consent.js?v=202611291700";

const KEY = "phc_mKCAjNbiNTeNQAzBmVdsghRFZc4v48pDf3E5xSPfKayX";  // the PostHog project's public API key (phc_…); empty: nothing loads
const POSTHOG = "1.447.15";
const SRC = `https://cdn.jsdelivr.net/npm/posthog-js@${POSTHOG}/dist/module.js`;

// what people write, and who they are: text masked (shown as ****), pictures blocked (an empty box)
const MASK = [
  ".chat-list", ".msg", ".cmts", ".cmt", ".thread", ".composer",  // live chat and comments
  ".ucard", "#acct", ".acct", ".acct-me",                          // user cards, the header's account
  ".dlg", ".prof-sheet", ".sheet-mine", ".toast",                   // account dialogs, the profile editor, notices
].join(", ");
const BLOCK = [".avatar", ".ucard img", ".sheet-pic"].join(", ");

const page = (location.pathname.split("/").pop() || "index").replace(/\.html$/, "");

let ph = null, loading = null;

function load() {
  if (!KEY || ph || loading) return;
  loading = import(SRC).then(({ default: posthog }) => {
    if (!consented()) return;  // withdrawn while it loaded
    posthog.init(KEY, {
      api_host: "https://eu.i.posthog.com",
      ui_host: "https://eu.posthog.com",
      persistence: "localStorage",       // no cookies
      person_profiles: "identified_only",  // and nobody is ever identified: no person profiles
      respect_dnt: true,
      autocapture: true,                 // clicks, for the click maps
      mask_all_text: true,               // without the clicked element's text
      mask_all_element_attributes: true,
      enable_heatmaps: true,
      capture_dead_clicks: true,         // taps on things that do nothing: the UX problems we look for
      capture_pageview: true,
      capture_pageleave: true,
      capture_performance: false,        // no network requests in the recordings
      capture_exceptions: false,
      disable_surveys: true,
      disable_web_experiments: true,
      disable_session_recording: page === "profile",
      session_recording: {
        maskAllInputs: true,
        maskTextSelector: MASK,
        blockSelector: BLOCK,
        recordHeaders: false,
        recordBody: false,
        recordCrossOriginIframes: false,
      },
    });
    ph = posthog;
  }).catch((e) => console.warn("insights:", e)).finally(() => { loading = null; });
}

function sweep() {
  for (const store of [localStorage, sessionStorage]) {
    try {
      for (const k of Object.keys(store)) if (/^(__)?ph_/.test(k)) store.removeItem(k);
    } catch { /* no storage */ }
  }
}

// PostHog saves its state again a moment after a change (and as the page goes), so it is told to keep nothing first,
// and the sweep runs once more after it.
function forget() {
  if (ph) {
    try { ph.stopSessionRecording(); } catch { /* not recording */ }
    try { ph.opt_out_capturing(); } catch { /* fine */ }
    try { ph.reset(); } catch { /* fine */ }
    try { ph.set_config({ disable_persistence: true }); } catch { /* fine */ }
  }
  sweep();
  setTimeout(sweep, 1000);
}

if (consented()) load();
onConsentChange((ok) => {
  if (ok) {
    if (!ph) { load(); return; }
    try {
      ph.set_config({ disable_persistence: false });
      ph.opt_in_capturing();
      if (page !== "profile") ph.startSessionRecording();
    } catch { /* fine */ }
  } else forget();
});
