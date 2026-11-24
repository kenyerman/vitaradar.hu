// The first arrival's hint that the page goes on: on the live and replay pages the full-width player can fill the
// screen, hiding the facts below it. While the page is still at its top, the player reaches the bottom of the screen and
// the facts are (nearly) out of sight, a down arrow waits at the bottom centre: in the strip under the player if it fits
// there, otherwise over the picture just above the player's own controls, and always above the cookie bar. A click
// scrolls to the facts; any scroll removes it for this visit. It is fixed, so nothing moves; CSS hides it while a game
// card is up.

const TOP = 24;      // px scrolled: the reader has found the scrolling
const PEEK = 96;     // px of the target in view count as "seen"
const SIZE = 42;     // the button (css .scroll-hint)
const CONTROLS = 64; // px at the bottom of the player taken by the browser's video controls

function consentHeight() {
  const root = document.documentElement;
  return root.dataset.consent === "open" ? parseFloat(getComputedStyle(root).getPropertyValue("--consent-h")) || 0 : 0;
}

// target: what the arrow leads to; player: the video's box.
export function scrollHint(target, player) {
  if (!target || !player) return;
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "scroll-hint";
  button.title = "Lejjebb: az állítások";
  button.setAttribute("aria-label", button.title);
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9l7 7 7-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square"/></svg>';
  button.hidden = true;
  document.body.append(button);

  let done = false;
  const resize = "ResizeObserver" in window ? new ResizeObserver(update) : null;
  const consent = new MutationObserver(update);  // the cookie bar opens or goes

  function update() {
    if (done) return;
    const vh = window.innerHeight, cb = consentHeight();
    const bottom = player.getBoundingClientRect().bottom;
    button.hidden = !(window.scrollY < TOP && target.getBoundingClientRect().top > vh - PEEK && bottom > vh - cb - 140);
    if (button.hidden) return;
    const gap = vh - cb - bottom;  // the strip between the player and the cookie bar (or the screen's edge)
    const at = gap >= SIZE + 12 ? cb + (gap - SIZE) / 2 : Math.max(cb + 12, vh - bottom + CONTROLS);
    button.style.bottom = `${Math.round(at)}px`;
  }

  function finish() {
    if (done) return;
    done = true;
    window.removeEventListener("scroll", onScroll);
    window.removeEventListener("resize", update);
    resize?.disconnect();
    consent.disconnect();
    if (button.hidden) { button.remove(); return; }
    button.dataset.gone = "";
    setTimeout(() => button.remove(), 300);
  }

  function onScroll() { if (window.scrollY >= TOP) finish(); }

  button.addEventListener("click", (e) => {
    const header = document.querySelector(".site-header");
    const top = target.getBoundingClientRect().top + window.scrollY - (header ? header.offsetHeight : 0) - 16;
    window.scrollTo({ top, behavior: still ? "auto" : "smooth" });
    if (e.detail === 0) {  // from the keyboard: take the focus along
      if (!target.hasAttribute("tabindex")) target.tabIndex = -1;
      target.focus({ preventScroll: true });
    }
    finish();
  });

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", update);
  resize?.observe(document.body);
  consent.observe(document.documentElement, { attributes: true, attributeFilter: ["data-consent", "style"] });
  setTimeout(update, 400);  // once the first layout has settled
}
