// A replay from YouTube behind the few <video> calls the replay page uses: currentTime (read and set), play(), and
// the timeupdate / seeked / pause events, through the IFrame Player API. The upload is our own archive file
// (pfc youtube), so its second t is the archive's second t and the facts' video_s need no mapping.
// youtube-nocookie.com: YouTube sets no cookies until the video plays.
//
//   youtubeMedia(box, id, startAt)   -> Promise of that object, the player put into box
//   "vr-playing" event               on window, detail true / false: it plays, or has paused or ended (as js/twitch.js)

import { withTimeout } from "./net.js?v=202611270600";

const API = "https://www.youtube.com/iframe_api";
const WAIT_MS = 20_000;  // the API, then the player: each fails after this long (watch.js offers Újrapróbálás)
let api = null;

function loadApi() {
  if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
  return (api ||= withTimeout(new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { if (prev) prev(); resolve(window.YT); };
    const s = document.createElement("script");
    s.src = API;
    s.onerror = () => { s.remove(); reject(new Error("YouTube API")); };
    document.head.append(s);
  }), WAIT_MS, "YouTube").catch((e) => { api = null; throw e; }));
}

export async function youtubeMedia(box, id, startAt = 0) {
  const YT = await loadApi();
  const holder = document.createElement("div");
  holder.id = "yt";
  box.prepend(holder);
  const listeners = new Map();
  const emit = (type) => (listeners.get(type) || []).forEach((fn) => { try { fn(); } catch (e) { console.warn(e); } });
  let timer = null;
  const player = await withTimeout(new Promise((resolve) => {
    const p = new YT.Player("yt", {
      host: "https://www.youtube-nocookie.com",
      videoId: id,
      width: "100%",
      height: "100%",
      playerVars: { start: Math.floor(startAt), playsinline: 1, rel: 0, origin: location.origin },
      events: {
        onReady: () => resolve(p),
        onStateChange: (e) => {
          if (e.data === YT.PlayerState.PLAYING) {
            if (!timer) timer = setInterval(() => emit("timeupdate"), 250);
            dispatchEvent(new CustomEvent("vr-playing", { detail: true }));
            return;
          }
          if (e.data === YT.PlayerState.PAUSED || e.data === YT.PlayerState.ENDED) {
            dispatchEvent(new CustomEvent("vr-playing", { detail: false }));
          }
          clearInterval(timer);
          timer = null;
          emit("timeupdate");
          if (e.data === YT.PlayerState.PAUSED) emit("pause");
        },
      },
    });
  }), WAIT_MS, "YouTube");
  return {
    get currentTime() { return player.getCurrentTime() || 0; },
    set currentTime(t) { player.seekTo(t, true); setTimeout(() => emit("seeked"), 300); },
    play() { player.playVideo(); return Promise.resolve(); },
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    player,
  };
}
