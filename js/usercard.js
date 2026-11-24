// Profile cards: hovering, focusing or tapping a user's name in the chat or the comments shows their card: username,
// name, points, games won and lost, the likes and dislikes their comments got, and how many comments they wrote,
// with a link to their profile page (profile.html: the same, plus their comments).
//
// The numbers are stored on the public profile (profiles/{uid}) and kept up to date by the server as things happen
// (comments, votes on comments, settled games), so a card is one document read; each card is kept for a minute.
// Only registered users can read profiles (rules), and only they see real names in the chat and the comments.

import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, el } from "./common.js?v=202611241206";
import { avatar } from "./account.js?v=202611241206";
import { profileHref } from "./links.js?v=202611241021";

const KEEP_MS = 60_000;
const SHOW_MS = 250, HIDE_MS = 200;
const cache = new Map();  // uid -> {at, value: Promise<profile | null>}

function profile(uid) {
  const hit = cache.get(uid);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.value;
  const value = getDoc(doc(db, "profiles", uid)).then((s) => (s.exists() ? s.data() : null));
  value.catch(() => cache.delete(uid));
  cache.set(uid, { at: Date.now(), value });
  return value;
}

let card = null, anchor = null, showTimer = 0, hideTimer = 0, seq = 0, openedAt = 0;

function box() {
  if (card) return card;
  card = el("div", "ucard panel");
  card.id = "ucard";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Profil");
  card.hidden = true;
  card.addEventListener("mouseenter", () => clearTimeout(hideTimer));
  card.addEventListener("mouseleave", () => hideSoon());
  document.body.append(card);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") hide(); });
  document.addEventListener("pointerdown", (e) => {
    if (card && !card.hidden && !card.contains(e.target) && !(anchor && anchor.contains(e.target))) hide();
  });
  window.addEventListener("scroll", () => hide(), { passive: true, capture: true });
  return card;
}

const num = (v) => Number(v || 0).toLocaleString("hu-HU");

function render(p, fallbackNick, uid) {
  const c = box();
  c.replaceChildren();
  if (!p) {
    c.append(el("p", "ucard-empty", "Ez a profil nem érhető el."));
    return;
  }
  const head = el("div", "ucard-head");
  const who = el("div", "ucard-who");
  const nick = el("p", "ucard-nick", p.nick || fallbackNick || "?");
  const name = el("p", "ucard-name", p.name || "");
  nick.title = nick.textContent;  // cut to one line; the whole on hover
  name.title = name.textContent;
  who.append(nick, name);
  head.append(avatar(p.photo && p.photo["64"], p.nick, 44), who);
  const stats = el("dl", "ucard-stats");
  for (const [label, value, cls] of [
    ["pont", num(p.points), "c-true"],
    ["megnyert játék", num(p.won), ""],
    ["elvesztett játék", num(p.lost), ""],
    ["like / dislike", `${num(p.likes)} / ${num(p.dislikes)}`, ""],
    ["hozzászólás", num(p.comments), ""],
  ]) {
    const row = el("div");
    row.append(el("dt", null, label), el("dd", cls, value));
    stats.append(row);
  }
  const more = el("a", "ucard-link", "profil és hozzászólások →");
  more.href = profileHref(uid);
  c.append(head, stats, more);
}

function place() {
  if (!card || !anchor) return;
  const r = anchor.getBoundingClientRect();
  const w = card.offsetWidth, h = card.offsetHeight;
  const left = Math.max(8, Math.min(r.left, innerWidth - w - 8));
  const below = r.bottom + 6;
  const top = below + h > innerHeight - 8 ? Math.max(8, r.top - h - 6) : below;
  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
}

async function show(a) {
  clearTimeout(hideTimer);
  if (anchor !== a || !card || card.hidden) openedAt = Date.now();
  anchor = a;
  const mine = ++seq;
  const c = box();
  c.replaceChildren(el("p", "ucard-empty", "betöltés…"));
  c.hidden = false;
  a.setAttribute("aria-expanded", "true");
  place();
  let p = null;
  try { p = await profile(a.dataset.uid); } catch (e) { console.warn("profile card:", e); }
  if (mine !== seq || anchor !== a) return;  // the pointer moved on meanwhile
  render(p, a.textContent, a.dataset.uid);
  place();
}

function hide() {
  clearTimeout(showTimer);
  clearTimeout(hideTimer);
  if (anchor) anchor.setAttribute("aria-expanded", "false");
  anchor = null;
  seq++;
  if (card) card.hidden = true;
}

function hideSoon() {
  clearTimeout(showTimer);
  hideTimer = setTimeout(hide, HIDE_MS);
}

// Makes a name element open the user's card. `uid`: whose; without one (visitors' placeholder names) nothing happens.
export function userCard(nameEl, uid) {
  if (!uid) return nameEl;
  nameEl.dataset.uid = uid;
  nameEl.classList.add("ucard-trigger");
  nameEl.tabIndex = 0;
  nameEl.setAttribute("role", "button");
  nameEl.setAttribute("aria-haspopup", "dialog");
  nameEl.setAttribute("aria-expanded", "false");
  nameEl.addEventListener("mouseenter", () => {
    clearTimeout(hideTimer);
    if (anchor === nameEl && card && !card.hidden) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => show(nameEl), SHOW_MS);
  });
  nameEl.addEventListener("mouseleave", hideSoon);
  nameEl.addEventListener("focus", () => show(nameEl));
  nameEl.addEventListener("blur", hideSoon);
  nameEl.addEventListener("click", (e) => {  // touch screens have no hover: a tap toggles the card
    e.preventDefault();
    // a click focuses the name first (which opens the card): close only a card that was open before this click
    if (anchor === nameEl && card && !card.hidden && Date.now() - openedAt > 400) hide(); else show(nameEl);
  });
  nameEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(nameEl); }
  });
  return nameEl;
}
