// The phone menu. On narrow screens (up to 860px) the header keeps the logo (the online count stays under it), the
// support link where it fits, the account button and a hamburger button; the pages (and "Profilom" for registered
// users) move into a panel that slides in from the right. The hamburger shows a red dot while the stream is live (as
// the "Élő adás" link does in the nav, js/common.js setLiveNav). On wider screens the nav goes back into the header.
//
// The panel is a modal dialog: the focus moves into it and stays there, Escape, the ✕, a tap outside it or a link
// closes it, and the focus returns to the hamburger. The nav is moved, not copied, so its "Élő adás" link keeps
// updating wherever it is.

const PHONE = matchMedia("(max-width: 860px)");
const DURATION_MS = 280;  // the slide (css/style.css .menu-panel)

function mountMenu() {
  const row = document.querySelector(".site-header .header-row");
  const nav = row && row.querySelector(".nav");
  if (!nav) return;
  const live = nav.querySelector(".nav-live");

  // the page has the button already (so the header is laid out right from the first paint); older copies get one here
  let button = row.querySelector(":scope > .menu-btn");
  if (!button) {
    button = document.createElement("button");
    button.type = "button";
    button.className = "menu-btn";
    button.setAttribute("aria-haspopup", "dialog");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = '<span class="menu-bars" aria-hidden="true"><span></span><span></span><span></span></span>';
    row.append(button);
  }
  button.setAttribute("aria-controls", "menu");

  const backdrop = document.createElement("div");
  backdrop.className = "menu-backdrop";
  const panel = document.createElement("div");
  panel.id = "menu";
  panel.className = "menu-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Menü");
  panel.inert = true;
  const head = document.createElement("div");
  head.className = "menu-head";
  const title = document.createElement("span");
  title.className = "menu-title";
  title.textContent = "// menü";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "menu-close";
  close.setAttribute("aria-label", "Menü bezárása");
  close.textContent = "✕";
  head.append(title, close);
  panel.append(head);
  document.body.append(backdrop, panel);

  // one's own profile, for registered users (css: html[data-acct="in"]), in the phone menu only: on a wide screen the
  // header's avatar leads there
  if (!nav.querySelector(".nav-profile")) {
    const me = document.createElement("a");
    me.className = "nav-profile";
    me.href = "profile.html";
    me.textContent = "Profilom";
    nav.insertBefore(me, nav.querySelector(".nav-support"));
  }

  // where the nav goes back to on a wide screen (the online count stays in the header, under the logo, at every width)
  const navMark = document.createComment(" nav ");
  nav.before(navMark);

  function place() {
    if (PHONE.matches) {
      head.after(nav);
    } else {
      shut(false);
      navMark.after(nav);
    }
  }

  const label = () => {  // the stream's state on the button, since its link is in the panel
    const on = live && live.dataset.live === "on";
    button.dataset.live = on ? "on" : "off";
    button.setAttribute("aria-label", on ? "Menü (élő adás most)" : "Menü");
  };
  if (live) new MutationObserver(label).observe(live, { attributes: true, attributeFilter: ["data-live"] });
  label();

  let open = false, timer = 0;
  function show() {
    if (open || !PHONE.matches) return;
    open = true;
    clearTimeout(timer);
    panel.inert = false;
    document.documentElement.classList.add("menu-open");
    button.setAttribute("aria-expanded", "true");
    void panel.offsetWidth;  // start the slide from off-screen
    panel.dataset.open = backdrop.dataset.open = "true";
    (nav.querySelector('[aria-current="page"]') || close).focus({ preventScroll: true });
  }
  function shut(focusButton = true) {
    if (!open) return;
    open = false;
    delete panel.dataset.open;
    delete backdrop.dataset.open;
    button.setAttribute("aria-expanded", "false");
    document.documentElement.classList.remove("menu-open");
    timer = setTimeout(() => { panel.inert = true; }, DURATION_MS);
    if (focusButton) button.focus({ preventScroll: true });
  }

  button.addEventListener("click", () => (open ? shut() : show()));
  close.addEventListener("click", () => shut());
  backdrop.addEventListener("click", () => shut());
  nav.addEventListener("click", (e) => { if (open && e.target.closest("a")) shut(false); });
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { e.preventDefault(); shut(); return; }
    if (e.key !== "Tab") return;
    const items = [...panel.querySelectorAll("a[href], button, [tabindex]:not([tabindex='-1'])")]
      .filter((x) => x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
  PHONE.addEventListener("change", place);
  place();
}

mountMenu();
