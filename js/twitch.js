// The live stream from twitch.tv/vitaradar: the site's main player. Our own CDN stream (cdn.js, hls.js) is the
// opt-in for supporters (?player=cdn until supporter access exists).
//
// The player loads with the page (the owner's choice); Twitch's own cookies come with it (impresszum.html#sutik).
//
// The iframe hides its frames and their EXT-X-PROGRAM-DATE-TIME, and its getCurrentTime() counts from when playback
// started. But a relay sends our own HLS pieces to Twitch unchanged (no re-encode) and hands each first piece after a
// (re)start to ffmpeg exactly 4 s after its PDT, so the frame on screen is a fixed distance behind the stream clock:
// that lead plus this viewer's Twitch latency. Measured on 2026-11-24 against the timer burnt into the video: PDT on
// screen = viewer clock - 6.3 s - reported latency, steady to ±25 ms. The player's reported latency jumps around
// (1.0-1.9 s at a steady delay), so it is only used averaged, to follow a viewer who falls further behind.
//
//   useTwitch()              Twitch is the player here (anything but ?player=cdn)
//   mountTwitch(box)         the player into box, once
//   twitchNow()              the date (ms) of the frame on screen, on the stream's clock; null before playback
//
// ?tw_lead=<ms> overrides the relay's lead, ?debug=1 shows the estimate over the player's corner.

const EMBED_JS = "https://player.twitch.tv/js/embed/v1.js";
const CHANNEL = "vitaradar";
const params = new URLSearchParams(location.search);
const LEAD_MS = Number(params.get("tw_lead") || -6295);  // measured with the relay's 4 s hand-over delay
const DEBUG = params.has("debug");

let player = null;
let mounting = null;
let playing = false;
let latency = null;  // seconds, averaged

export function useTwitch() {
  return params.get("player") !== "cdn";
}

function loadEmbed() {
  if (window.Twitch && window.Twitch.Player) return Promise.resolve(window.Twitch);
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = EMBED_JS;
    s.onload = () => resolve(window.Twitch);
    s.onerror = reject;
    document.head.append(s);
  });
}

export function mountTwitch(box) {
  return (mounting ||= embed(box));
}

async function embed(box) {
  const Twitch = await loadEmbed();
  const holder = document.createElement("div");
  holder.id = "twitch";
  box.prepend(holder);
  player = new Twitch.Player("twitch", {
    channel: CHANNEL, width: "100%", height: "100%", muted: true, autoplay: true,
    parent: [location.hostname],
  });
  const P = Twitch.Player;
  player.addEventListener(P.PLAYING, () => { playing = true; });
  for (const ev of [P.PAUSE, P.OFFLINE, P.ENDED]) player.addEventListener(ev, () => { playing = false; });
  setInterval(sample, 1000);
  if (DEBUG) { showDebug(box); window.__twitch = player; }
  return player;
}

function sample() {
  if (!player || !playing) return;
  let l = null;
  try { l = player.getPlaybackStats().hlsLatencyBroadcaster; } catch { return; }
  if (!(l > 0) || l > 60) return;  // 0 during ads and start-up
  latency = latency == null ? l : latency + (l - latency) / 20;  // ~20 s average
}

export function twitchNow() {
  if (!playing || latency == null) return null;
  return Date.now() + LEAD_MS - latency * 1000;
}

function showDebug(box) {
  const d = document.createElement("div");
  d.style.cssText = "position:absolute;right:0;bottom:0;z-index:5;font:12px monospace;background:#000c;color:#ff0;" +
    "padding:2px 6px;pointer-events:none";
  box.append(d);
  const tick = () => {
    const t = twitchNow();
    d.textContent = t == null ? "twitch: waiting" :
      `pdt ${new Date(t).toISOString().slice(11, 23)} lat ${latency.toFixed(2)}s now ${Date.now()}`;
    requestAnimationFrame(tick);
  };
  tick();
}
