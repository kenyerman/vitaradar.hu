// vitaradar.hu on phones (up to 860px, as js/menu.js). The player stays pinned under the header, so the video never
// scrolls away (Twitch pauses an embed that is off-screen or covered) and nothing is ever drawn over it; under it a
// compact strip shows the speaker and the sitting's tally. On wider screens every part goes back where the page has it.
//
// The parts are moved, not copied, so the scripts that fill them (app.js, chat.js, watch.js) keep working wherever
// they are. --m-hdr is the header's height (where the pinned block starts) and --m-top where it ends (menus and panels
// open below it, never over the video).

export const PHONE = matchMedia("(max-width: 860px)");

const root = document.documentElement;

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

// Moves nodes into the phone layout and back. Each node leaves a mark where it was; on a wide screen it returns there.
function mover() {
  const moves = [];
  return {
    add(node, into, before = null) {
      if (!node || !into) return;
      const mark = document.createComment(" phone ");
      node.before(mark);
      moves.push({ node, into, before, mark });
    },
    place() {
      for (const m of moves) {
        if (PHONE.matches) m.into.insertBefore(m.node, m.before);
        else m.mark.after(m.node);
      }
    },
  };
}

function measure(header, top) {
  const set = () => {
    const h = header ? header.offsetHeight : 0;
    root.style.setProperty("--m-hdr", `${h}px`);
    root.style.setProperty("--m-top", `${h + (PHONE.matches && top ? top.offsetHeight : 0)}px`);
  };
  const ro = new ResizeObserver(set);
  if (header) ro.observe(header);
  if (top) ro.observe(top);
  set();
  return set;
}

// page: "live" (index.html) or "watch" (watch.html)
export function mountPhone({ page }) {
  const main = document.querySelector("main");
  const player = document.querySelector(page === "live" ? "#stage" : "main > .player");
  if (!main || !player) return null;
  document.body.classList.add(`m-${page}`);

  const top = el("div", "m-top");
  const strip = el("div", "m-strip");
  top.append(strip);
  player.before(top);

  const moves = mover();
  moves.add(player, top, strip);
  moves.add(document.getElementById("speaker"), strip);
  moves.add(document.querySelector(".speaker-col .tally"), strip);
  if (page === "live") {
    // the chat: its closed state's button moves off the video into the strip, the open chat under the pinned block
    const slot = el("div", "m-chat-slot");
    top.after(slot);
    moves.add(document.getElementById("chat-open"), strip);
    moves.add(document.getElementById("chat"), slot);
  }

  const remeasure = measure(document.querySelector(".site-header"), top);
  const place = () => { moves.place(); remeasure(); };
  PHONE.addEventListener("change", place);
  place();
  return { top, strip };
}
