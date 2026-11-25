// vitaradar.hu on phones (up to 860px, as js/menu.js), on every page: the header keeps the name, a red "Élő" tag while
// the stream is live, the heart and the menu button; the menu (js/menu.js) takes what the header gives up: under the
// pages (with the impresszum added), the account, BETA and the online count, the support button and the contact
// links. On wider screens every part goes back to the header. --m-hdr is the header's height: the menu opens right
// below it (on the live and replay pages js/mobile.js opens it below the video instead).
//
// Each page loads this after its own script, so js/menu.js has built the menu by then.

const PHONE = matchMedia("(max-width: 860px)");
const root = document.documentElement;

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

// Moves nodes into the menu and back. Each node leaves a mark where it was; on a wide screen it returns there.
function mover() {
  const moves = [];
  return {
    add(node, into) {
      if (!node || !into) return;
      const mark = document.createComment(" phone ");
      node.before(mark);
      moves.push({ node, into, mark });
    },
    place() {
      for (const m of moves) {
        if (PHONE.matches) m.into.append(m.node);
        else m.mark.after(m.node);
      }
    },
  };
}

function onAir() {
  const live = document.querySelector(".nav-live");
  const box = document.querySelector(".site-header .brand-box");
  if (!live || !box) return;
  const tag = el("span", "m-onair", "Élő");
  tag.setAttribute("aria-hidden", "true");  // the menu button's label says it too
  box.after(tag);
  const sync = () => { tag.hidden = live.dataset.live !== "on"; };
  new MutationObserver(sync).observe(live, { attributes: true, attributeFilter: ["data-live"] });
  sync();
}

function menuParts(moves) {
  const panel = document.getElementById("menu");
  const nav = panel && (panel.querySelector(".nav") || document.querySelector(".site-header .nav"));
  if (!panel || !nav) return;
  if (!nav.querySelector(".nav-imp")) {
    const imp = el("a", "nav-imp", "Impresszum");
    imp.href = "impresszum.html";
    if (/impresszum\.html$/.test(location.pathname)) imp.setAttribute("aria-current", "page");
    nav.insertBefore(imp, nav.querySelector(".nav-support"));
  }
  moves.add(document.getElementById("acct"), panel);
  moves.add(document.querySelector(".site-header .brand-sub"), panel);
  moves.add(nav.querySelector(".nav-support"), panel);
  const foot = el("p", "m-menu-foot");
  const link = (href, text, ext) => {
    const a = el("a", null, text);
    a.href = href;
    if (ext) { a.target = "_blank"; a.rel = "noopener"; }
    return a;
  };
  foot.append(link("impresszum.html#tamogatas", "Mire megy a pénz?"), " · ", link("mailto:help@vitaradar.hu", "help@vitaradar.hu"),
    " · ", link("https://github.com/kenyerman/vitaradar.hu/issues", "hibakövető (GitHub)", true));
  panel.append(foot);
}

function headerHeight() {
  const header = document.querySelector(".site-header");
  if (!header) return;
  const set = () => root.style.setProperty("--m-hdr", `${header.offsetHeight}px`);
  new ResizeObserver(set).observe(header);
  set();
}

// Loading (css: the strip under the header and the grey blocks): until the page's data is in. It comes from
// Firestore after the scripts ran: the pages with a list are ready once its first entry is there; the others once
// the page starts changing and then stays still for a moment. At most a few seconds, and at once on a page that has
// nothing to fetch.
const READY = { "": "#facts > li", "index.html": "#facts > li", "watch.html": "#facts > li", "archive.html": "#days > *",
  "mps.html": "#mps > li" };

function loading() {
  const done = () => { root.dataset.loaded = "1"; mo.disconnect(); };
  const main = document.querySelector("main");
  const page = location.pathname.split("/").pop();
  const ready = READY[page];
  let quiet = 0;
  const mo = new MutationObserver(() => {
    if (ready) { if (main.querySelector(ready)) done(); return; }
    clearTimeout(quiet);
    quiet = setTimeout(done, 400);
  });
  if (!main || page === "impresszum.html" || (ready && main.querySelector(ready))) { done(); return; }
  mo.observe(main, { childList: true, subtree: true, characterData: true });
  setTimeout(done, 6000);
}

function mountShell() {
  if (document.body.classList.contains("m-site")) return;
  document.body.classList.add("m-site");
  const moves = mover();
  onAir();
  menuParts(moves);
  headerHeight();
  loading();
  PHONE.addEventListener("change", () => moves.place());
  moves.place();
}

mountShell();
