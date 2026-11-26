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
// Autoplay (measured in Chrome, 26 Nov 2026): Twitch starts the player by itself only while nothing on the page is
// drawn over its iframe, and pauses a playback it started itself as soon as something is (a viewer's own click plays
// whatever covers it). Even the panel's 12 px corner marks count, so the Twitch player has none (css/style.css), and
// ?debug=1 shows its line off the video. The closed chat's button, the first visit's scroll arrow, a game card or the
// cookie bar over the video still hold autoplay until they go.
//
// Recovery: some playback errors stop Twitch's player for good until the viewer clicks "Click Here to Reload
// Player" (26 Nov 2026: "Your browser encountered an error while decoding the video. (Error #3000)" in a viewer's
// Chrome, while our pieces, the relay's feed and Twitch's own recording of those minutes were clean; one corrupt
// piece gives the same). Neither play() nor setChannel() brings it back. The embed then reports a PAUSE,
// isPaused(), and a 0x0 picture (a network error, #2000, too, also before it ever played), where a viewer's pause
// (or Twitch's own, above) keeps the picture's size and a player waiting for its first click is not paused. So a
// watchdog builds a new player when it is in that state for DEAD_MS, or when it played and its time has not moved
// for STALL_MS without a pause, while Twitch says the channel is live and the tab is visible. Rebuilds back off
// (BACKOFF_MS) and keep the viewer's mute. The new player starts by itself where nothing covers it (above);
// otherwise it waits with Twitch's play button instead of the error.
//
//   useTwitch()              Twitch is the player here (anything but ?player=cdn)
//   mountTwitch(box)         the player into box, once
//   twitchNow()              the date (ms) of the frame on screen, on the stream's clock; null before playback
//
// ?tw_lead=<ms> overrides the relay's lead, ?debug=1 shows the estimate (and any rebuilds) at the window's top left.

const EMBED_JS = "https://player.twitch.tv/js/embed/v1.js";
const CHANNEL = "vitaradar";
const params = new URLSearchParams(location.search);
const LEAD_MS = Number(params.get("tw_lead") || -6295);  // measured with the relay's 4 s hand-over delay
const DEBUG = params.has("debug");
const DEAD_MS = 3000;       // an errored player is rebuilt after this long
const STALL_MS = 20000;     // an unpaused player whose time stands still this long is rebuilt
const BACKOFF_MS = [0, 15000, 30000, 60000, 120000, 300000];  // the wait before the 1st, 2nd... rebuild
const HEALTHY_MS = 120000;  // this long playing again resets the backoff

let player = null;
let holder = null;
let mounting = null;
let playing = false;
let latency = null;  // seconds, averaged
let online = null;   // Twitch's ONLINE / OFFLINE (ENDED), null before either
let ready = false;   // this player's READY came
let played = false;  // this player has played
let rebuilds = 0, lastRebuild = 0, playingSince = 0;
let lastTime = null, lastMove = 0, deadSince = 0;

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
  await loadEmbed();
  holder = document.createElement("div");
  holder.id = "twitch";
  box.prepend(holder);
  create(true);
  setInterval(sample, 1000);
  setInterval(watch, 1000);
  document.addEventListener("visibilitychange", () => { lastMove = Date.now(); deadSince = 0; });
  if (DEBUG) showDebug();
  return player;
}

// A player in the holder: the first one, or a new one in place of a dead one.
function create(muted) {
  const P = window.Twitch.Player;
  holder.replaceChildren();
  playing = played = ready = false;
  lastTime = null;
  lastMove = Date.now();
  deadSince = 0;
  const p = player = new P(holder.id, {
    channel: CHANNEL, width: "100%", height: "100%", muted, autoplay: true, parent: [location.hostname],
  });
  const on = (ev, f) => p.addEventListener(ev, () => { if (p === player) f(); });  // not a replaced player's
  on(P.READY, () => { ready = true; });
  on(P.PLAYING, () => { playing = played = true; playingSince = lastMove = Date.now(); });
  on(P.PAUSE, () => { playing = false; });
  on(P.ENDED, () => { playing = false; online = false; });
  on(P.OFFLINE, () => { playing = false; online = false; });
  on(P.ONLINE, () => { online = true; });
  // Unmuted, the new player may not be let to start by itself (the viewer clicked the old one): muted it may.
  on(P.PLAYBACK_BLOCKED, () => { p.setMuted(true); p.play(); });
  if (DEBUG) window.__twitch = p;
}

// Once a second: a new player for one that errored or stalled (see the top).
function watch() {
  if (!player || document.hidden || online === false || !ready) return;
  const now = Date.now();
  let paused, t, size;
  try {
    paused = player.isPaused();
    t = player.getCurrentTime();
    size = player.getPlaybackStats().videoResolution;
  } catch { return; }
  if (t !== lastTime) { lastTime = t; lastMove = now; }
  const dead = paused && (!size || size === "0x0");
  deadSince = dead ? deadSince || now : 0;
  const stalled = played && !paused && lastTime > 0 && now - lastMove > STALL_MS;  // > 0: once the stream moved
  if (playing && now - playingSince > HEALTHY_MS) rebuilds = 0;
  if (!(dead && now - deadSince >= DEAD_MS) && !stalled) return;
  if (now - lastRebuild < BACKOFF_MS[Math.min(rebuilds, BACKOFF_MS.length - 1)]) return;
  rebuilds++;
  lastRebuild = now;
  let muted = true;
  try { muted = player.getMuted(); } catch { /* keep it muted */ }
  console.info(`twitch: a new player (${dead ? "error" : "stalled"}), #${rebuilds}`);
  create(muted);
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

function showDebug() {
  const d = document.createElement("div");  // fixed at the window's corner: over the video it would stop autoplay
  d.style.cssText = "position:fixed;left:0;top:0;z-index:100;font:12px monospace;background:#000c;color:#ff0;" +
    "padding:2px 6px;pointer-events:none";
  document.body.append(d);
  const tick = () => {
    const t = twitchNow();
    d.textContent = (t == null ? "twitch: waiting" :
      `pdt ${new Date(t).toISOString().slice(11, 23)} lat ${latency.toFixed(2)}s now ${Date.now()}`) +
      (rebuilds ? ` · new player ×${rebuilds}` : "");
    requestAnimationFrame(tick);
  };
  tick();
}
