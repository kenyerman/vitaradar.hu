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
  moves.add(nav.querySelector(".nav-support"), panel);
  // what the footer says (phones have no footer): the contact links, the maker's pages, the copyright, the source
  const foot = el("div", "m-menu-foot");
  const line = (...parts) => {
    const p = el("p");
    parts.forEach((x, i) => { if (i) p.append(" · "); p.append(x); });
    foot.append(p);
  };
  const link = (href, text, ext) => {
    const a = el("a", null, text);
    a.href = href;
    if (ext) { a.target = "_blank"; a.rel = "noopener"; }
    return a;
  };
  const copy = (a) => { const c = a.cloneNode(true); c.removeAttribute("id"); return c; };
  line(link("impresszum.html#tamogatas", "Mire megy a pénz?"), link("mailto:help@vitaradar.hu", "help@vitaradar.hu"),
    link("https://github.com/kenyerman/vitaradar.hu/issues", "hibakövető (GitHub)", true));
  const maker = [...document.querySelectorAll('.site-footer nav[aria-label="A készítő máshol"] a')].map(copy);
  if (maker.length) {
    const label = el("span", "m-menu-foot-h", "A készítő:");
    const p = el("p");
    p.append(label, " ");
    maker.forEach((a, i) => { if (i) p.append(" · "); p.append(a); });
    foot.append(p);
  }
  const year = document.getElementById("year")?.textContent || String(new Date().getFullYear());
  const source = document.querySelector('.site-footer .footer-row a[href*="github.com"]');
  line(`© ${year} vitaradar.hu`, "Felvétel: Országgyűlés", ...(source ? [link(source.href, "forráskód a GitHubon", true)] : []));
  panel.append(foot);
}

// Closing the menu: js/menu.js drops [data-open] at once; .m-closing keeps the sheet drawn while it goes back down
// (css, phones, motion only), then it is gone.
function menuClosing() {
  const panel = document.getElementById("menu");
  if (!panel) return;
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  let wasOpen = panel.hasAttribute("data-open"), timer = 0;
  const end = () => { clearTimeout(timer); panel.classList.remove("m-closing"); };
  new MutationObserver(() => {
    const open = panel.hasAttribute("data-open");
    if (open) end();
    else if (wasOpen && PHONE.matches && !calm.matches) {
      panel.classList.add("m-closing");
      timer = setTimeout(end, 400);  // in case the animation never runs
    }
    wasOpen = open;
  }).observe(panel, { attributes: true, attributeFilter: ["data-open"] });
  panel.addEventListener("animationend", (e) => { if (e.target === panel && e.animationName === "m-down") end(); });
}

function headerHeight() {
  const header = document.querySelector(".site-header");
  if (!header) return;
  const set = () => root.style.setProperty("--m-hdr", `${header.offsetHeight}px`);
  new ResizeObserver(set).observe(header);
  set();
}

// Loading (css: the strip under the header and the grey blocks): until the page's data is in. It comes from
// Firestore after the scripts ran: the pages with a list are ready once its first entry is there (Archívum and
// Képviselők also once they say there is nothing); the others once the page starts changing and then stays still for
// a moment. At most a few seconds, and at once on a page that has nothing to fetch. Archívum and Képviselők wait
// longer: their data waits for the server (js/firebase.js getDocs), and an empty page looked like "nothing here".
const READY = { "": "#facts > li", "index.html": "#facts > li", "watch.html": "#facts > li",
  "archive.html": "#days > *, #arch-empty:not([hidden])", "mps.html": "#mps > li, #mps-empty:not([hidden])" };
const PATIENT = new Set(["archive.html", "mps.html"]);

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
  mo.observe(main, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["hidden"] });
  setTimeout(done, PATIENT.has(page) ? 30000 : 6000);
}

function mountShell() {  // body.m-site is in each page's markup, so the css has it from the first paint
  const moves = mover();
  onAir();
  menuParts(moves);
  menuClosing();
  headerHeight();
  loading();
  PHONE.addEventListener("change", () => moves.place());
  moves.place();
}

mountShell();
