// vitaradar.hu's live and replay pages as an app, on phones (up to 860px, as js/menu.js) and on wider screens. The
// video never scrolls away (Twitch pauses an embed that is off-screen or covered) and nothing is ever drawn over it.
// Phones: the player pinned under the header, a compact strip under it (the speaker, their speech's counts), the tabs and
// the open tab's panel. Wider screens, all on one screen: the player and the strip on the left, a sidebar on the right
// with the sitting's tally, the tabs and the panels.
//
// The parts are moved, not copied, so the scripts that fill them (app.js, chat.js, game.js, watch.js) keep working
// wherever they are: they find them by id. --m-hdr is the header's height (where the pinned block starts) and --m-top
// where it ends (menus and panels open below it, never over the video). The header and the menu are js/shell.js's.
//
// The page says what it is in its markup (index.html: body.m-live, watch.html: body.m-watch), so the css has it from
// the first paint. This script loads on its own, before the page's data scripts, and puts the parts in place as soon
// as the page is parsed; then .m-ready shows the page (css: until then a phone sees the header only, never the wide
// layout squeezed in).

const PHONE = matchMedia("(max-width: 860px)");  // which of the two layouts

const root = document.documentElement;

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

// Moves nodes into the app layout: each has its place on phones and on wider screens ([parent, the node it goes
// before]); without one it stays where the page has it (a mark is left there).
function mover() {
  const moves = [];
  return {
    add(node, phone, desk = phone) {
      if (!node) return;
      const mark = document.createComment(" app ");
      node.before(mark);
      moves.push({ node, phone, desk, mark });
    },
    place() {
      for (const m of moves) {
        const to = PHONE.matches ? m.phone : m.desk;
        if (to && to[0]) to[0].insertBefore(m.node, to[1] || null);
        else m.mark.after(m.node);
      }
    },
  };
}

// The live and replay pages stay put and the open tab's panel scrolls (css); elsewhere the window does. What scrolls
// the facts, then.
function scroller(list) {
  const app = document.body.classList.contains("m-live") || document.body.classList.contains("m-watch");
  return (app && list.closest(".below")) || window;
}

// A row's height from `from` to `to` px (whole numbers), frame by frame in whole pixels, with the rows' own easing
// (cubic-bezier(.22, 1, .36, 1), "ease out quint"); then end(). For a row folding above one that keeps its place: the
// panel under them scrolls by whole pixels, a height animation steps by fractions of one, and the row kept in place
// shook by up to a pixel at every frame. Returns its stop; the height is left as it is, for the caller.
function pixelFold(li, from, to, duration, end) {
  const t0 = performance.now();
  let raf = 0;
  const step = (now) => {
    const p = Math.min(1, Math.max(0, (now - t0) / duration));
    li.style.height = `${from - Math.round((from - to) * (1 - (1 - p) ** 5))}px`;
    if (p < 1) raf = requestAnimationFrame(step);
    else end();
  };
  li.style.height = `${from}px`;
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

// Scrolls `box` (a panel, or the window) by dy pixels, as far as it can go, and only when that moves it: at the panel's
// top a row kept in place cannot be kept any more, and asking again at every frame changes nothing.
function nudge(box, dy) {
  const win = box === window, at = win ? scrollY : box.scrollTop;
  const max = win ? document.documentElement.scrollHeight - innerHeight : box.scrollHeight - box.clientHeight;
  const y = Math.max(0, Math.min(max, at + dy));
  if (Math.round(y) === Math.round(at)) return;
  if (win) scrollTo(scrollX, y); else box.scrollTop = y;
}

// Whether the reader touches the screen (or turns the wheel) from now on: a scroll that keeps a row in place stops
// then. Going on, it scrolled the panel back against their finger (it puts back whatever moved the row).
function touchWatch() {
  const w = { on: false, done() { removeEventListener("touchstart", hit); removeEventListener("wheel", hit); } };
  const hit = () => { w.on = true; };
  addEventListener("touchstart", hit, { passive: true });
  addEventListener("wheel", hit, { passive: true });
  return w;
}

function measure(header, top, video) {
  const set = () => {
    const h = header ? header.offsetHeight : 0;
    root.style.setProperty("--m-hdr", `${h}px`);
    // where the pinned block ends on screen (on the replay page it starts below the title and pins only later), and
    // where the video ends (the menu opens right below it)
    const end = PHONE.matches && top ? Math.max(h, Math.round(top.getBoundingClientRect().bottom)) : h;
    root.style.setProperty("--m-top", `${end}px`);
    // (pulled up, the video is under the panels: the menu opens below the header, pullUp)
    const shown = video && !document.body.classList.contains("m-pulled");
    const vid = PHONE.matches && shown ? Math.max(h, Math.round(video.getBoundingClientRect().bottom)) : h;
    root.style.setProperty("--m-menu", `${vid}px`);
  };
  const ro = new ResizeObserver(set);
  if (header) ro.observe(header);
  if (top) ro.observe(top);
  let queued = false;
  addEventListener("scroll", () => {
    if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; set(); }); }
  }, { passive: true });
  set();
  return set;
}

// The replay page: the fact playing now stays in view as the video goes on, unless the reader has just scrolled.
function followReplay(list) {
  if (!list) return;
  let touched = 0;
  for (const ev of ["wheel", "touchmove", "keydown"]) addEventListener(ev, () => { touched = Date.now(); }, { passive: true });
  new MutationObserver((records) => {
    if (Date.now() - touched < 4000) return;
    for (const r of records) {
      const li = r.target;
      if (li.classList.contains("now") && !(r.oldValue || "").split(" ").includes("now")) {
        // into view in its panel (not scrollIntoView: on iOS that also scrolls the page, and the header goes off the top)
        const box = scroller(list);
        if (box === window || !li.getClientRects().length) continue;  // not on screen (the Felszólalók tab is open)
        const b = li.getBoundingClientRect(), view = box.getBoundingClientRect();
        if (b.top < view.top) box.scrollTop += b.top - view.top;
        else if (b.bottom > view.bottom) box.scrollTop += Math.min(b.bottom - view.bottom, b.top - view.top);
      }
    }
  }).observe(list, { subtree: true, attributes: true, attributeFilter: ["class"], attributeOldValue: true });
}

// Phones: each fact is a compact row (verdict, time, headline); a tap, or Enter, opens it to show the quote, the
// explanation, the sources, the votes and the comments. A tap on a link, a button or the comments area does not.
function compactFacts(list) {
  if (!list) return;
  const mark = (li) => {
    if (!li.classList || !li.classList.contains("fact")) return;
    li.tabIndex = 0;
    li.setAttribute("aria-expanded", String(li.dataset.open === "true"));
  };
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  const motion = () => !calm.matches;
  const ease = "cubic-bezier(.22, 1, .36, 1)", DURATION = 340;
  const runs = new WeakMap();  // li -> its running open or close: { kind, cancel }
  const stop = (li) => {
    const r = runs.get(li);
    if (!r) return;
    runs.delete(li);
    r.cancel();
  };
  const details = (li) => [...li.querySelectorAll(":scope > :is(.fact-claim, .fact-expl, .fact-fallacy, .fact-sources, .social)")];
  // the row's height goes from what it is now to its height open or closed; the text stays where it is (no sliding).
  // whole: in whole pixels (pixelFold), for a row folding above the one tapped, which keeps its place (toggle)
  const resize = (li, open, whole = false) => {
    const from = li.offsetHeight;
    stop(li);
    if (open) li.dataset.open = "true"; else delete li.dataset.open;
    li.setAttribute("aria-expanded", String(open));
    if (!motion()) return;
    const to = li.offsetHeight;
    if (!open) li.dataset.open = "true";  // closing: the details stay while they fade and the row folds
    li.style.overflow = "hidden";
    const fades = details(li).map((d, i) => d.animate([{ opacity: open ? 0 : 1 }, { opacity: open ? 1 : 0 }],
      open ? { duration: 260, delay: 60 + i * 50, easing: "ease-out", fill: "backwards" }
        : { duration: 180, easing: "ease-out", fill: "forwards" }));
    const run = { kind: open ? "open" : "close" };
    const end = () => {
      if (runs.get(li) !== run) return;
      runs.delete(li);
      if (!open) delete li.dataset.open;
      run.cancel();
    };
    if (whole) {
      const halt = pixelFold(li, from, to, DURATION, end);
      run.cancel = () => { halt(); fades.forEach((f) => f.cancel()); li.style.height = ""; li.style.overflow = ""; };
    } else {
      // fill: kept at its end height until it is done below, or a closed row showed its details for a frame
      const a = li.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: DURATION, easing: ease, fill: "forwards" });
      a.finished.then(end, () => {});
      run.cancel = () => { a.cancel(); fades.forEach((f) => f.cancel()); li.style.overflow = ""; };
    }
    runs.set(li, run);
  };
  const isOpen = (li) => li.dataset.open === "true" && runs.get(li)?.kind !== "close";
  // Opening a row closes the one open before; the row tapped stays where it is in its panel while one above it folds
  // (in whole pixels, and the panel scrolls by as much in the same frame): only while it folds, and not once the reader
  // touches the screen. In the panel's own terms: the panel itself slides in when a fact is opened from another tab
  // (the strip's latest rows, js/app.js), and held on screen the row ended that much lower.
  const toggle = (li) => {
    if (isOpen(li)) { resize(li, false); return; }
    const box = scroller(list);
    const at = () => li.getBoundingClientRect().top - (box === window ? 0 : box.getBoundingClientRect().top);
    const top = at();
    const others = [...list.querySelectorAll("li.fact")].filter((o) => o !== li && isOpen(o));
    const above = (o) => Boolean(o.compareDocumentPosition(li) & Node.DOCUMENT_POSITION_FOLLOWING);
    for (const o of others) resize(o, false, above(o));
    resize(li, true);
    const folding = others.filter(above);
    if (!folding.length) return;
    const hands = touchWatch();
    const hold = () => {
      if (hands.on) { hands.done(); return; }
      nudge(box, Math.round(at() - top));
      if (folding.some((o) => runs.get(o)?.kind === "close")) requestAnimationFrame(hold);
      else hands.done();
    };
    hold();
  };
  list.addEventListener("click", (e) => {
    if (e.target.closest("a, button, input, textarea, select, label, form, .social")) return;
    const li = e.target.closest("li.fact");
    if (li && list.contains(li)) toggle(li);
  });
  list.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const li = e.target;
    if (!li.matches || !li.matches("li.fact")) return;
    e.preventDefault();
    toggle(li);
  });
  new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach(mark);
  }).observe(list, { childList: true, subtree: true });  // subtree: a speech's facts, inside the speakers list

  // a row shows how many comments it has (js/social.js writes "N hozzászólás" into the fact's .talk label), and the
  // verdict badges drop their [ ] (js/common.js writes "[ IGAZ ]")
  let queued = false;
  const tidy = () => {
    queued = false;
    for (const li of list.querySelectorAll("li.fact")) {
      const m = /^(\d+)/.exec((li.querySelector(".social .talk") || {}).textContent || "");
      let talk = li.querySelector(":scope > .m-talk");
      if (m && m[1] !== "0") {
        if (!talk) { talk = el("span", "m-talk"); li.append(talk); }
        if (talk.textContent !== m[1]) talk.textContent = m[1];
        talk.setAttribute("aria-label", `${m[1]} hozzászólás`);
      } else if (talk) talk.remove();
      const v = li.querySelector(".verdict");
      // the [ ] are at the ends of the badge's first and last text (a pending badge has its loading sign between); the
      // phones' design has none at any width
      const a = v && v.firstChild, z = v && v.lastChild;
      if (!a || a.nodeType !== Node.TEXT_NODE || z.nodeType !== Node.TEXT_NODE) continue;
      if (a.data.startsWith("[ ") && z.data.endsWith(" ]")) { a.data = a.data.slice(2); z.data = z.data.slice(0, -2); }
    }
  };
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(tidy); } };
  new MutationObserver(later).observe(list, { childList: true, subtree: true, characterData: true });
  list.querySelectorAll("li.fact").forEach(mark);
}

// The live page's feed, on phones and in the sidebar alike: the newest fact comes in at the top. Further down, the
// panel keeps the reader's place (a fact coming in above doesn't push the text they are reading; the browser's own
// scroll anchoring is off, as Safari has none), and a button counts the new facts; a tap on it, or scrolling back up,
// brings them back to the newest.
function followFeed(list) {
  if (!list) return;
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  const pill = el("button", "m-new");
  pill.type = "button";
  pill.hidden = true;
  document.body.append(pill);
  // where the panel's visible part begins: under the pinned block (phones), or at the top of the sidebar's panel
  const edge = () => {
    if (PHONE.matches) return parseFloat(getComputedStyle(root).getPropertyValue("--m-top")) || 0;
    const box = scroller(list);
    return box === window ? 0 : box.getBoundingClientRect().top;
  };
  const atTop = () => list.getBoundingClientRect().top >= edge() - 60;
  let top = true, unseen = 0, anchor = null, anchorY = 0;
  const known = new WeakSet();
  const remember = () => {  // the first row in view, and where it is
    const e = edge();
    anchor = null;
    for (const li of list.children) {
      const b = li.getBoundingClientRect();
      if (b.bottom > e) { anchor = li; anchorY = b.top; break; }
    }
  };
  const show = () => {
    pill.hidden = top || !unseen || list.offsetParent === null;
    pill.textContent = `↑ ${unseen} új állítás`;
    pill.style.top = PHONE.matches || pill.hidden ? "" : `${Math.round(edge() + 10)}px`;  // wider screens: the sidebar's top
  };
  const onScroll = () => {
    top = atTop();
    if (top) unseen = 0;
    remember();
    show();
  };
  addEventListener("scroll", onScroll, { passive: true });
  list.closest(".below")?.addEventListener("scroll", onScroll, { passive: true });
  pill.addEventListener("click", () => {
    unseen = 0;
    top = true;
    show();
    const box = scroller(list), behavior = calm.matches ? "auto" : "smooth";
    if (box === window) scrollTo({ top: scrollY + list.getBoundingClientRect().top - edge() - 8, behavior });
    else box.scrollTo({ top: 0, behavior });
  });
  let settled = 0;  // the first facts (the backlog) come in without motion; only the ones that arrive later slide in
  new MutationObserver((records) => {
    const added = [];
    for (const r of records) r.addedNodes.forEach((n) => {
      if (n.classList && n.classList.contains("fact") && !known.has(n)) { known.add(n); added.push(n); }
    });
    const fresh = added.length;
    if (fresh && !settled) {
      settled = performance.now() + 2500;
      added.slice(0, 10).forEach((n, i) => {  // the first screenful rises in, one after the other
        n.style.setProperty("--i", String(i));
        n.classList.add("m-intro");
        n.addEventListener("animationend", () => n.classList.remove("m-intro"), { once: true });
      });
    } else if (fresh && fresh <= 3 && performance.now() > settled) {
      for (const n of added) {
        n.classList.add("m-in");
        const end = (e) => {  // the last of its animations (the slide, then the slab)
          if (e.target !== n || e.animationName !== "m-slab") return;
          n.classList.remove("m-in");
          n.removeEventListener("animationend", end);
        };
        n.addEventListener("animationend", end);
      }
    }
    if (!top && anchor && anchor.isConnected) {  // keep the row being read where it was
      const dy = anchor.getBoundingClientRect().top - anchorY;
      if (dy) scroller(list).scrollBy(0, dy);
      unseen += fresh;
    }
    remember();
    show();
  }).observe(list, { childList: true });
  PHONE.addEventListener("change", show);
  return { show, resume() { show(); } };
}

// Phones, live page: three tabs under the pinned block. Állítások: the facts (with the AI notice above them); Chat:
// the chat, opened while its tab is on and closed otherwise, so its count of missed messages keeps working; Játék:
// the games, moved out of the dock that popped up over the page. The Játék tab turns green, with the countdown, while
// a game is open.
function liveTabs(top, slots, feed) {
  const bar = el("div", "m-tabs");
  bar.setAttribute("role", "tablist");
  bar.setAttribute("aria-label", "Nézet");
  const tab = (id, label) => {
    const b = el("button", "m-tab");
    b.type = "button";
    b.id = `m-tab-${id}`;
    b.setAttribute("role", "tab");
    b.dataset.tab = id;
    const name = el("span");
    name.textContent = label;
    const n = el("span", "m-tab-n");
    n.hidden = true;
    b.append(name, n);
    bar.append(b);
    return { b, n };
  };
  const tabs = [tab("feed", "Állítások"), tab("chat", "Chat"), tab("game", "Játék")];
  const [, chatTab, gameTab] = tabs;
  const ai = el("p", "m-ai");
  const note = el("span");
  note.textContent = "// automatikus (AI) ellenőrzés — tévedhet";
  ai.append(note, viewers());
  top.append(bar, ai);  // phones: in the pinned block; wider screens: the sidebar (mountApp)

  const chatCol = document.getElementById("chat");
  const chatOpen = document.getElementById("chat-open");
  let gameNote = () => {};  // set below, once the games are there
  function select(id, focus = false) {
    document.body.dataset.mTab = id;
    for (const t of tabs) {
      const on = t.b.dataset.tab === id;
      t.b.setAttribute("aria-selected", String(on));
      t.b.tabIndex = on ? 0 : -1;
      if (on && focus) t.b.focus();
    }
    const closed = root.dataset.chat === "closed";  // the Chat tab is the chat: open while its tab is on
    if (id === "chat" && closed && chatOpen) chatOpen.click();
    if (id !== "chat" && !closed && chatCol) chatCol.querySelector(".chat-close")?.click();
    if (id === "feed") feed.resume();
    else { feed.show(); scrollTo({ top: 0 }); }
    if (id === "chat") chatToEnd();  // it was hidden while its messages came: open on the newest
    gameNote();
  }
  bar.addEventListener("click", (e) => {
    const b = e.target.closest(".m-tab");
    if (b) select(b.dataset.tab);
  });
  bar.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const i = tabs.findIndex((t) => t.b.getAttribute("aria-selected") === "true");
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    select(next.b.dataset.tab, true);
  });

  // the chat's missed messages, on its tab
  const missed = chatOpen && chatOpen.querySelector(".chat-missed");
  if (missed) {
    const copy = () => { chatTab.n.textContent = missed.textContent; chatTab.n.hidden = missed.hidden || !missed.textContent; };
    new MutationObserver(copy).observe(missed, { childList: true, characterData: true, subtree: true, attributes: true });
    copy();
  }

  // a game open: the tab turns green and shows its countdown (js/game.js keeps it in .game-time), and while the facts
  // are shown a note at the foot of the screen says which game and how long it is open, "KIHÍVÁS · 9 MP ›": a tap on
  // it opens Játék. Not on the Chat tab, where the foot is the message field.
  const dock = slots.game.querySelector(".game-dock") || document.querySelector(".game-dock");
  if (dock) {
    const note = el("button", "m-game-note");
    note.type = "button";
    note.hidden = true;
    note.addEventListener("click", () => select("game"));
    document.body.append(note);
    const live = () => {
      const card = dock.querySelector(':scope > :not([hidden])[data-state="open"]');
      const time = card ? ((card.querySelector(".game-time") || {}).textContent || "").trim() : "";
      if (card) gameTab.b.dataset.live = "true"; else delete gameTab.b.dataset.live;
      gameTab.n.textContent = time;
      gameTab.n.hidden = !card || !time;
      const show = Boolean(card) && PHONE.matches && document.body.dataset.mTab === "feed";
      if (show) {
        // its tag, "[ KIHÍVÁS · HIBÁS ÉRVELÉS ]" (bare on phones): its first word
        const kind = ((card.querySelector(".game-tag") || {}).textContent || "Játék").replace(/[[\]]/g, "").split("·")[0].trim();
        const text = `${kind}${time ? ` · ${time}` : ""} ›`;
        if (note.textContent !== text) note.textContent = text;
        note.setAttribute("aria-label", `${kind} fut${time ? `, még ${time}` : ""}: a Játék fülre`);
      }
      if (note.hidden === show) note.hidden = !show;
    };
    gameNote = live;
    PHONE.addEventListener("change", live);
    new MutationObserver(live).observe(dock, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ["hidden", "data-state"] });
    live();
  }

  for (const t of tabs) t.b.setAttribute("aria-controls", t.b.dataset.tab === "feed" ? "facts" : t.b.dataset.tab === "chat" ? "chat" : "m-game");
  // the page starts on the facts, so the chat starts closed (js/chat.js, mounting later, reads it; the reader's stored
  // choice stays as it is)
  root.dataset.chat = "closed";
  select("feed");
  return { bar, ai };
}

// How many watch the stream, while it is on: js/presence.js puts the figure in the online badge's label ("… N nézi
// az élő adást."), every 30 s or so.
function viewers() {
  const out = el("span", "m-viewers");
  out.hidden = true;
  const live = document.querySelector(".nav-live");
  const online = document.getElementById("online");
  if (!live || !online) return out;
  const sync = () => {
    const m = /(\d+) nézi az élő adást/.exec(online.title);
    const n = m ? Number(m[1]) : 0;
    out.hidden = live.dataset.live !== "on" || !n;
    out.textContent = `${n} nézi`;
    out.title = `${n} nézi most az élő adást`;
  };
  new MutationObserver(sync).observe(live, { attributes: true, attributeFilter: ["data-live"] });
  new MutationObserver(sync).observe(online, { attributes: true, attributeFilter: ["title"] });
  sync();
  return out;
}

// A new speaker's card fades in (css .m-swap), so the change is seen without anything moving over the video.
function speakerSwap(card) {
  const name = card && card.querySelector("#speaker-name");
  if (!name) return;
  let last = name.textContent;
  new MutationObserver(() => {
    const now = name.textContent;
    if (now === last) return;
    const first = last === "–" || !last;  // the page's placeholder: the first speaker just appears
    last = now;
    if (first) return;
    card.classList.remove("m-swap");
    void card.offsetWidth;  // restart the animation
    card.classList.add("m-swap");
  }).observe(name, { childList: true, characterData: true, subtree: true });
  card.addEventListener("animationend", (e) => { if (e.target === card) card.classList.remove("m-swap"); });
}

// The counts' figures tick (css .m-bump) when they grow, once the first counts are in (a new speech starts at 0: no tick).
function tallyBump(tally) {
  if (!tally) return;
  const start = performance.now();
  for (const dd of tally.querySelectorAll("dd")) {
    let last = dd.textContent;
    new MutationObserver(() => {
      const now = dd.textContent;
      const grew = Number(now) > Number(last);
      last = now;
      if (!grew || performance.now() - start < 4000) return;
      dd.classList.remove("m-bump");
      void dd.offsetWidth;
      dd.classList.add("m-bump");
    }).observe(dd, { childList: true, characterData: true, subtree: true });
    dd.addEventListener("animationend", () => dd.classList.remove("m-bump"));
  }
}

// The game cards' tags ("[ KIHÍVÁS ]", js/game.js) drop their [ ], as the verdicts do.
function gameTags(box) {
  let queued = false;
  const tidy = () => {
    queued = false;
    for (const t of document.querySelectorAll(".game-dock .game-tag")) {
      const text = t.textContent;
      const bare = text.replace(/^\[[\s\u00a0]*/, "").replace(/[\s\u00a0]*\]$/, "");
      if (bare !== text) { t.dataset.full = text; t.textContent = bare; }
    }
  };
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(tidy); } };
  const dock = document.querySelector(".game-dock") || box;
  new MutationObserver(later).observe(dock, { childList: true, subtree: true });
  later();
}

// Phones, replay page: a tap on a speech (or Enter / Space on it) opens its facts under it (js/watch.js puts them there,
// the same cards as in the facts list), one speech at a time, and closes them again. Its time button plays it from its
// start, as on wider screens, and opens its facts too. As the facts rows do (compactFacts), a speech grows or folds
// smoothly, its facts fading in or out; the speech tapped keeps its place while one open above it folds, and moves up
// in the same motion just enough to show its facts (its own row never off the top). No motion: at once.
function openingSpeeches(list) {
  if (!list) return;
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  const motion = () => !calm.matches;
  const ease = "cubic-bezier(.22, 1, .36, 1)", DURATION = 380;
  const runs = new WeakMap();  // li -> its running open or close: { kind, cancel }
  const mark = (li) => {
    li.tabIndex = 0;
    li.setAttribute("aria-expanded", String(li.classList.contains("open") && runs.get(li)?.kind !== "close"));
  };
  const stop = (li) => {
    const r = runs.get(li);
    if (!r) return;
    runs.delete(li);
    r.cancel();
  };
  const isOpen = (li) => li.classList.contains("open") && runs.get(li)?.kind !== "close";
  // the speech's height goes from what it is now to its height open or closed; returns that height. whole: in whole
  // pixels (pixelFold), for a speech folding above the one tapped, which the panel keeps in place (follow)
  const resize = (li, open, whole = false) => {
    const from = li.offsetHeight;
    stop(li);
    if (open) {
      li.dispatchEvent(new CustomEvent("speech-open", { bubbles: true }));  // js/watch.js fills it the first time
      li.classList.add("open");
    } else li.classList.remove("open");
    const to = li.offsetHeight;
    if (motion() && from !== to) {
      if (!open) li.classList.add("open");  // closing: the facts stay while they fade and the speech folds
      li.style.overflow = "hidden";
      const facts = li.querySelector(":scope > .speech-facts");
      const fade = facts?.animate([{ opacity: open ? 0 : 1 }, { opacity: open ? 1 : 0 }],
        open ? { duration: 300, delay: 60, easing: "ease-out", fill: "backwards" } : { duration: 200, easing: "ease-out", fill: "forwards" });
      const run = { kind: open ? "open" : "close" };
      const end = () => {
        if (runs.get(li) !== run) return;
        runs.delete(li);
        if (!open) li.classList.remove("open");
        run.cancel();
        mark(li);
      };
      if (whole) {
        const halt = pixelFold(li, from, to, DURATION, end);
        run.cancel = () => { halt(); fade?.cancel(); li.style.height = ""; li.style.overflow = ""; };
      } else {
        // fill: kept at its end height until it is done below, or a folded speech showed all its facts for a frame
        const a = li.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: DURATION, easing: ease, fill: "forwards" });
        a.finished.then(end, () => {});
        run.cancel = () => { a.cancel(); fade?.cancel(); li.style.overflow = ""; };
      }
      runs.set(li, run);
    }
    mark(li);
    return to;
  };
  // the speech in its panel: from where it was (top, from the panel's top) up by just enough to show it `height` tall,
  // while the speeches around it change. In the panel's own terms: the panel itself moves when the speaker strip above
  // it fills in. Not scrollIntoView, which on iOS also scrolls the page and takes the header off the top. In whole
  // pixels, as the panel scrolls (and a speech folding above it folds), and only until the reader touches the screen.
  const follow = (li, top, height) => {
    const box = li.closest(".below");
    if (!box) return;
    const room = box.clientHeight, bottom = top + height;
    const by = top < 0 ? top : bottom > room ? Math.min(bottom - room, top) : 0;
    const at = () => li.getBoundingClientRect().top - box.getBoundingClientRect().top;
    const place = (k) => nudge(box, Math.round(at() - (top - Math.round(by * k))));
    if (!motion()) { place(1); return; }
    place(0);  // this frame too: where it was
    const t0 = performance.now(), hands = touchWatch();
    const step = (now) => {
      if (hands.on) { hands.done(); return; }
      const p = Math.min(1, Math.max(0, (now - t0) / DURATION));
      place(1 - (1 - p) ** 5);  // the heights' own easing
      if (p < 1) requestAnimationFrame(step);
      else hands.done();
    };
    requestAnimationFrame(step);
  };
  // The speech tapped opens before the one open folds: measuring the fold shortens the list for a moment, and with
  // nothing open below the panel then scrolled back to its top, and the speech tapped jumped down for a frame.
  const toggle = (li, keep = false) => {
    const open = keep || !isOpen(li);
    const box = li.closest(".below");
    const top = li.getBoundingClientRect().top - (box ? box.getBoundingClientRect().top : 0);
    const height = !open ? 0 : isOpen(li) ? li.offsetHeight : resize(li, true);
    for (const o of list.querySelectorAll(":scope > li.open")) {
      if (o !== li && isOpen(o)) resize(o, false, Boolean(o.compareDocumentPosition(li) & Node.DOCUMENT_POSITION_FOLLOWING));
    }
    if (!open) { resize(li, false); return; }
    follow(li, top, height);
  };
  list.addEventListener("click", (e) => {
    if (e.target.closest(".speech-facts")) return;
    const li = e.target.closest("#speakers > li");
    if (li) toggle(li, !!e.target.closest(".t-btn"));  // the time button plays it (js/watch.js) and leaves it open
  });
  list.addEventListener("keydown", (e) => {
    if ((e.key !== "Enter" && e.key !== " ") || !e.target.matches("#speakers > li")) return;
    e.preventDefault();
    toggle(e.target);
  });
  const all = () => list.querySelectorAll(":scope > li").forEach(mark);
  new MutationObserver(all).observe(list, { childList: true });
  PHONE.addEventListener("change", all);
}

// Phones, replay page (as the live page): a compact row on top of the pinned block (back to the archive, the date
// and the time, the link to this moment as an icon), the video and the speaker strip, two tabs (the speakers, open
// first, and the facts) and the AI notice with the "all facts" switch. The tab names show how many there are.
function replayParts(top, moves, side) {
  const head = el("div", "m-whead");
  const text = el("div", "m-whead-text");
  head.append(text);
  top.prepend(head);
  moves.add(head, null, [side]);  // wider screens: the sidebar's first row
  const back = document.querySelector("main .crumbs a");
  if (back) back.setAttribute("aria-label", "Vissza az archívumba");
  moves.add(back, [head, text]);
  moves.add(document.getElementById("w-title"), [text]);
  moves.add(document.getElementById("w-sub"), [text]);
  moves.add(document.getElementById("copy-link"), [head]);
  moves.add(document.getElementById("copied"), [head]);
  const copy = document.getElementById("copy-link");
  if (copy) { copy.setAttribute("aria-label", "Link ehhez a pillanathoz"); copy.title = "Link ehhez a pillanathoz"; }

  const bar = el("div", "m-tabs m-tabs-2");
  bar.setAttribute("role", "tablist");
  bar.setAttribute("aria-label", "A visszanézés részei");
  const tab = (id, label) => {
    const b = el("button", "m-tab");
    b.type = "button";
    b.id = `m-tab-${id}`;
    b.setAttribute("role", "tab");
    b.dataset.tab = id;
    const name = el("span");
    name.textContent = label;
    const n = el("span", "m-tab-count");
    b.append(name, n);
    bar.append(b);
    return { b, n };
  };
  const facts = tab("feed", "Állítások"), speakers = tab("speakers", "Felszólalók");
  openingSpeeches(document.getElementById("speakers"));
  facts.b.setAttribute("aria-controls", "facts");
  speakers.b.setAttribute("aria-controls", "speakers");
  const ai = el("p", "m-ai");
  const note = el("span");
  note.textContent = "// automatikus (AI) ellenőrzés — tévedhet";
  ai.append(note);
  top.append(bar, ai);
  moves.add(bar, null, [side]);
  moves.add(ai, null, [side]);
  moves.add(document.getElementById("show-all"), [ai]);

  const select = (id) => {
    document.body.dataset.mTab = id;
    for (const t of [facts, speakers]) t.b.setAttribute("aria-selected", String(t.b.dataset.tab === id));
    const box = document.querySelector(".m-watch .below");
    if (box) box.scrollTop = 0;
  };
  for (const t of [facts, speakers]) t.b.addEventListener("click", () => select(t.b.dataset.tab));
  bar.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const next = document.body.dataset.mTab === "feed" ? speakers : facts;
    select(next.b.dataset.tab);
    next.b.focus();
  });
  select("speakers");

  // the counts: "[118/272]" (js/watch.js) as "118/272", the speeches' number; the date without its "// "
  const count = document.getElementById("fact-count"), list = document.getElementById("speakers");
  const title = document.getElementById("w-title");
  const sync = () => {
    facts.n.textContent = (count?.textContent || "").replace(/[[\]]/g, "").replace(/\b0+(\d)/g, "$1");  // "[05/30]": "5/30"
    speakers.n.textContent = list && list.children.length ? String(list.children.length) : "";
    if (!title) return;
    const t = title.textContent;
    if (t.startsWith("// ")) { title.dataset.full = t; title.textContent = t.slice(3); }
  };
  for (const node of [count, list, title]) if (node) new MutationObserver(sync).observe(node, { childList: true, characterData: true, subtree: true });
  PHONE.addEventListener("change", sync);
  sync();
}

// Phones, live and replay pages: while a field has the keyboard up, the page is exactly as tall as the screen above it
// (body.m-typing, --m-kb-h; css). Otherwise iOS moved the whole page to show the field, and a swipe moved the page,
// not the chat. The header and the pinned block (the video too) step aside until the keyboard closes, and the open
// panel (the chat, or the facts with a comment box) has the screen above the keyboard.
const FIELD = "input:not([type=checkbox], [type=radio], [type=button], [type=submit], [type=range]), textarea, [contenteditable=true]";

// the chat's newest messages into view (its list scrolls; js/chat.js keeps it there as messages come)
function chatToEnd() {
  const list = document.querySelector(".m-chat-slot .chat-list");
  if (list) requestAnimationFrame(() => { list.scrollTop = list.scrollHeight; });
}

// While the keyboard is up, a swipe moves only what can scroll that way: the chat's messages, the facts, a long comment
// in its box. Otherwise iOS moved the page itself, to show what is behind the keyboard (in the empty chat, at the end of
// the messages, on the field's row), keyboardFit put it back every frame, and the screen shook. On only while typing:
// a listener that may stop a swipe makes iOS wait for the page before every scroll.
function swipeLock() {
  let start = null, stop = null;  // where the touch began; once it moves, whether its swipe is stopped
  const scrolls = (node, dx, dy) => {  // from the touched element up: something that can still scroll the finger's way
    for (; node instanceof Element && node !== document.body; node = node.parentElement) {
      const cs = getComputedStyle(node);
      if (dy && (/auto|scroll/.test(cs.overflowY) || node.tagName === "TEXTAREA")
        && (dy > 0 ? node.scrollTop > 0 : node.scrollTop < node.scrollHeight - node.clientHeight - 1)) return true;
      if (dx && /auto|scroll/.test(cs.overflowX)
        && (dx > 0 ? node.scrollLeft > 0 : node.scrollLeft < node.scrollWidth - node.clientWidth - 1)) return true;
    }
    return false;
  };
  const down = (e) => {
    start = e.touches.length === 1 ? { x: e.touches[0].clientX, y: e.touches[0].clientY, at: e.target } : null;
    stop = null;
  };
  const move = (e) => {
    if (!start || e.touches.length !== 1) return;  // two fingers: zoom as usual
    if (stop === null) {  // the first move decides, along its main direction
      const dx = e.touches[0].clientX - start.x, dy = e.touches[0].clientY - start.y;
      if (!dx && !dy) return;
      stop = Math.abs(dy) >= Math.abs(dx) ? !scrolls(start.at, 0, dy) : !scrolls(start.at, dx, 0);
    }
    if (stop && e.cancelable) e.preventDefault();
  };
  return (on) => {
    start = null;
    if (on) {
      addEventListener("touchstart", down, { passive: true });
      addEventListener("touchmove", move, { passive: false });
    } else {
      removeEventListener("touchstart", down);
      removeEventListener("touchmove", move);
    }
  };
}

function keyboardFit() {
  const vv = window.visualViewport;
  if (!vv) return;
  const lock = swipeLock();
  let full = vv.height;  // the screen without the keyboard
  let fingers = 0, settle = 0;  // touches on the screen; the wait for the page to stop after them
  // The row a tap opened while the keyboard was up (a fact under the comment box, a speech) is brought into view when
  // the keyboard goes: the header and the video come back over its panel, and it was left below the panel's foot. Once
  // the row above it has folded (compactFacts keeps the row in place until then).
  let tapped = null, tappedAt = 0;
  addEventListener("click", (e) => { tapped = e.target; tappedAt = performance.now(); }, true);
  const keepTapped = () => {
    const row = performance.now() - tappedAt < 1000 && tapped?.closest?.("li.fact, #speakers > li");
    const box = row && row.closest(".below");
    if (!box) return;
    setTimeout(() => {
      if (!row.isConnected || fingers) return;  // the reader has moved on
      const r = row.getBoundingClientRect(), b = box.getBoundingClientRect();
      if (r.top > b.bottom - 48) box.scrollTop += Math.round(r.top - b.top);  // only a row pushed below the foot
    }, 450);
  };
  const later = () => { clearTimeout(settle); settle = setTimeout(() => { settle = 0; fit(); }, 150); };
  // only the phone layout of the live and replay pages keeps the window still (the panels scroll); a wide screen, and
  // a page that scrolls as a whole, are left alone: putting their scroll back sent every click to the page's top
  const pinned = document.body.classList.contains("m-live") || document.body.classList.contains("m-watch");
  const fit = () => {
    const active = PHONE.matches && pinned;
    const field = active && document.activeElement?.matches?.(FIELD);
    if (!field) full = vv.height;
    const on = Boolean(field) && vv.height < full - 100;
    if (on) root.style.setProperty("--m-kb-h", `${Math.round(vv.height)}px`);
    if (on !== document.body.classList.contains("m-typing")) {
      const chat = document.querySelector(".m-chat-slot .chat-list");
      const atEnd = chat && chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40;
      document.body.classList.toggle("m-typing", on);
      lock(on);
      if (!on) { root.style.removeProperty("--m-kb-h"); keepTapped(); }
      // writing in the chat: its newest messages over the field; after it, they stay if they were in view
      if (on && document.activeElement.closest(".m-chat-slot")) chatToEnd();
      else if (atEnd) chat.scrollTop = chat.scrollHeight;
    }
    // what iOS scrolled to show the field, back. Not under a finger, nor while the page still glides from one (each
    // frame put back against it shook the screen): once it has stood still.
    if (active && scrollY && (on || !field)) {
      if (fingers || settle) later();
      else scrollTo(0, 0);
    }
  };
  for (const type of ["touchstart", "touchend", "touchcancel"]) {
    addEventListener(type, (e) => {
      fingers = e.touches.length;
      if (!fingers && scrollY) later();
    }, { passive: true });
  }
  vv.addEventListener("resize", fit);
  vv.addEventListener("scroll", fit);
  // The focus leaving a field: looked at once the tap that moved it is done (its press, release and click come in one
  // go), wherever it went. A fact's row can take the focus: a tap on a button in it (a comment's Küldés) moved the focus
  // there on the press, the header and the video came back at once, the release landed on them, and the button got no
  // click. It sent only on a second tap.
  addEventListener("focusin", (e) => { if (e.target.matches?.(FIELD)) fit(); });
  addEventListener("focusout", () => setTimeout(fit, 0));
}

// Phones, live page, the games (js/game.js builds them in the dock), in the chosen compact designs. On top the time left
// as a bar, then what is asked: a challenge's statement and who said it, a tip's question and its three counts with −
// and +, a vote's question, what is voted on and the optional band of yes votes. At the foot the game's label and the
// seconds, the points and the ✕ (a tip's fold toggle), then the answers, Tippelek, or the vote's two buttons (css),
// kept in view while the game is open. Only moved and relabelled here, each time js/game.js builds a card: it finds
// its parts by class (or keeps them) wherever they are.
function gameCards(dock) {
  if (!dock) return;
  // each part moved and where it came from (a comment left in its place)
  const moves = new WeakMap();  // box -> [[node, mark]]
  const take = (box, ...nodes) => nodes.filter(Boolean).map((node) => {
    const mark = document.createComment(" m ");
    node.before(mark);
    moves.get(box).push([node, mark]);
    return node;
  });
  // "+10 pont" reads "+10" in the small badge; its full words stay its name. A tip's js/game.js writes anew as it goes.
  const watchedWorth = new WeakSet();
  const shorten = (worth) => {
    const t = worth.textContent;
    if (!/\spont$/.test(t)) return;
    worth.dataset.full = t;
    worth.setAttribute("aria-label", t);
    worth.textContent = t.replace(/\s*pont$/, "");
  };
  const dress = (box) => {
    if (box.querySelector(":scope > .m-ch-card")) return;
    const part = (cls, from = box) => from.querySelector(`:scope > ${cls}`);
    const head = part(".game-head");
    if (!head) return;  // not built yet
    const isTip = box.classList.contains("tip-box"), isVote = box.classList.contains("vote-pop");
    const body = isTip ? part(".tip-body") : null;
    if (isTip ? !body : !part(isVote ? ".game-q" : ".game-statement")) return;
    moves.set(box, []);
    const time = head.querySelector(".game-time"), worth = head.querySelector(".game-worth");
    const card = el("div", "m-ch-card"), act = el("div", "m-ch-act"), line = el("div", "m-ch-ask"), q = el("span", "m-ch-q");
    line.append(q);
    if (isTip) {
      // the tip: its body folds away once the tip is in; what folds goes out of it, the foot stays with the counts
      card.append(...take(box, part(".game-bar", body), part(".tip-q", body), part(".tip-grid", body)));
      q.append("Tipp", ...take(box, time));
      line.append(...take(box, head.querySelector(".tip-title"), worth, head.querySelector(".tip-toggle")));
      act.append(line, ...take(box, part(".tip-send", body)));
      head.after(card, act);
      act.after(...take(box, part(".tip-sum"), part(".game-status", body), part(".game-after", body)));
    } else if (isVote) {
      card.append(...take(box, part(".game-bar"), part(".game-q"), ...box.querySelectorAll(":scope > :is(.vote-item, .vote-mode)"),
        part(".vote-band-q"), part(".vote-bands")));
      q.append("Szavazás", ...take(box, time));
      line.append(...take(box, worth, head.querySelector(".game-close")));
      act.append(line, ...take(box, part(".game-options")));
      head.after(card, act);
    } else {
      // a challenge: "Melyik hibás érvelés ez?" reads "Melyik hibás érvelés?"; a true-or-false one has no question of its own
      card.append(...take(box, part(".game-bar"), part(".game-statement"), part(".game-who"), part(".game-quote")));
      q.textContent = (part(".game-q")?.textContent || "").trim().replace(/\s+ez\?$/i, "?") || "Igaz vagy hamis?";
      q.append(...take(box, time));
      line.append(...take(box, worth, head.querySelector(".game-close")));
      act.append(line, ...take(box, part(".game-options")));
      head.after(card, act);
    }
    if (worth) {
      shorten(worth);
      if (!watchedWorth.has(worth)) {
        watchedWorth.add(worth);
        new MutationObserver(() => { if (moves.has(box)) shorten(worth); })
          .observe(worth, { childList: true, characterData: true, subtree: true });
      }
    }
  };
  const boxes = () => dock.querySelectorAll(":scope > :is(.game-pop, .tip-box)");
  const watched = new WeakSet();
  const watch = () => {
    for (const box of boxes()) {
      if (watched.has(box)) continue;
      watched.add(box);
      new MutationObserver(() => dress(box)).observe(box, { childList: true });  // js/game.js builds it anew
      dress(box);
    }
  };
  new MutationObserver(watch).observe(dock, { childList: true });
  watch();
}

// Phones: a comment box grows when tapped (js/social.js), and its counter and send button came to sit behind the
// keyboard. Once the keyboard is up the whole box comes into view. scrollIntoView may move the page here: with the
// keyboard open iOS scrolls it anyway, and closed, the app page has nothing to scroll.
function composerInView() {
  document.addEventListener("focusin", (e) => {
    const box = PHONE.matches && e.target.matches(".composer textarea") && e.target.closest(".composer");
    if (!box) return;
    const show = () => box.scrollIntoView({ block: "nearest" });
    const vv = window.visualViewport;
    vv?.addEventListener("resize", show);  // the keyboard is up
    setTimeout(show, 350);                 // or it was already (another field), or there is none
    setTimeout(() => vv?.removeEventListener("resize", show), 1000);
  });
}

// page: "live" (index.html) or "watch" (watch.html)
// Phones, live and replay pages: the panels pulled up for more room, the video playing on under them, heard and not
// seen. A drag up on the strip or the tabs, or a tap on the pull button on the line between them, hides the video and
// the speaker strip: the tabs and the open panel move up to where the video starts (the header and the replay's top
// row stay), and a line there says the video plays on behind them. A drag down, a tap on that line or the button, or
// the open panel pulled down from its very top brings them back. The player is never moved in the page (that reloads
// its iframe and stops it): css takes it out of the flow, in the same place, under the panels. A playback the viewer
// started plays on under them (js/twitch.js); the line says when it has stopped (the players' "vr-playing" events),
// e.g. a Twitch player rebuilt after an error, which waits for a click while it is covered.
function pullUp(top, player, remeasure) {
  const tabs = top.querySelector(":scope > .m-tabs");
  const strip = top.querySelector(":scope > .m-strip");
  if (!tabs || !strip || !player) return;
  const pull = el("button", "m-pull");  // made once, with the page: nothing clickable appears under a finger (iOS)
  pull.type = "button";
  tabs.prepend(pull);
  const line = el("button", "m-audio");
  line.type = "button";
  line.setAttribute("aria-label", "A videó vissza");
  const text = el("span", "m-audio-text"), hint = el("span", "m-audio-hint");
  hint.textContent = "húzd le";
  line.append(el("span", "m-audio-dot"), text, hint);
  strip.before(line);
  let playing = false;
  const say = () => {
    line.dataset.playing = String(playing);
    text.textContent = playing ? "A videó szól a háttérben" : "A videó áll";
  };
  addEventListener("vr-playing", (e) => { playing = Boolean(e.detail); say(); });
  // our own stream's <video> (?player=cdn): its own events
  top.addEventListener("playing", () => { playing = true; say(); }, true);
  top.addEventListener("pause", () => { playing = false; say(); }, true);
  say();

  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  const isUp = () => document.body.classList.contains("m-pulled");
  const label = () => pull.setAttribute("aria-label",
    isUp() ? "A videó vissza" : "A panelek fel: a videó nem látszik, a hangja szól tovább");
  const panels = () => [...document.querySelectorAll("main > .below, main > .m-chat-slot, main > .m-game-slot")];
  const set = (up) => {
    if ((up && !PHONE.matches) || up === isUp()) return;
    const parts = [...top.children, ...panels()].filter((p) => p.getClientRects().length);
    const was = new Map(parts.map((p) => [p, p.getBoundingClientRect().top]));
    top.style.setProperty("--m-vtop", `${player.offsetTop}px`);
    document.body.classList.toggle("m-pulled", up);
    label();
    if (!calm.matches) {
      for (const p of parts) {  // each part slides from where it was: transforms only, nothing moves in the page
        if (!p.getClientRects().length) continue;
        const dy = was.get(p) - p.getBoundingClientRect().top;
        if (Math.abs(dy) >= 1) p.animate([{ transform: `translateY(${dy}px)` }, { transform: "none" }],
          { duration: 340, easing: "cubic-bezier(.22, 1, .36, 1)" });
      }
    }
    remeasure();
  };
  label();
  pull.addEventListener("click", () => set(!isUp()));
  line.addEventListener("click", () => set(false));
  PHONE.addEventListener("change", () => { if (!PHONE.matches) set(false); });

  // a vertical drag on the parts under the video (not the video: its iframe has its own touches)
  let start = null;
  top.addEventListener("touchstart", (e) => {
    const t = e.touches[0];
    start = e.touches.length === 1 && PHONE.matches && e.target.closest?.(".m-strip, .m-tabs, .m-ai, .m-audio")
      ? { x: t.clientX, y: t.clientY } : null;
  }, { passive: true });
  top.addEventListener("touchmove", (e) => {
    if (!start || document.body.classList.contains("m-typing")) return;
    const dx = e.touches[0].clientX - start.x, dy = e.touches[0].clientY - start.y;
    if (Math.abs(dy) < 24 || Math.abs(dy) < Math.abs(dx) * 1.5) return;
    start = null;
    set(dy < 0);
  }, { passive: true });
  // pulled up: the open panel pulled down from its very top brings the video back (scrolled down, it scrolls as ever)
  let from = null;
  addEventListener("touchstart", (e) => {
    const box = isUp() && e.touches.length === 1
      && e.target.closest?.("main > .below, .m-chat-slot .chat-list, main > .m-game-slot");
    from = box && box.scrollTop <= 0 ? { box, y: e.touches[0].clientY } : null;
  }, { passive: true });
  addEventListener("touchmove", (e) => {
    if (!from) return;
    if (from.box.scrollTop > 0) { from = null; return; }
    if (e.touches[0].clientY - from.y > 70) { from = null; set(false); }
  }, { passive: true });
}

function mountApp(page) {
  const main = document.querySelector("main");
  const player = document.querySelector(page === "live" ? "#stage" : "main > .player");
  if (!main || !player) return;

  const top = el("div", "m-top");
  const strip = el("div", "m-strip");
  top.append(strip);
  player.before(top);
  // wider screens: the sidebar on the right (empty on phones, where its parts are in the page)
  const side = el("aside", "d-side");
  side.setAttribute("aria-label", page === "live" ? "Állítások, chat és játék" : "Állítások és felszólalók");
  top.after(side);

  const moves = mover();
  let slots = null;
  moves.add(player, [top, strip]);
  moves.add(document.getElementById("speaker"), [strip]);
  // the sitting's tally: the sidebar's head on wider screens (phones show the speech under way instead, below)
  moves.add(document.querySelector(".speaker-col .tally:not(.m-speech-tally)"), null, [side]);
  moves.add(document.querySelector(".speaker-col .m-speech-tally"), [strip], null);  // phones: the speech under way
  // wider screens: this speech's balance and the latest false claim and fallacy, in the strip (js/app.js fills them)
  for (const id of ["speech-sum", "latest"]) moves.add(document.getElementById(id), null, [strip]);
  if (page === "live") {
    // the chat: its closed state's button moves off the video into the strip, the open chat under the pinned block
    const slot = el("div", "m-chat-slot");
    top.after(slot);
    moves.add(document.getElementById("chat-open"), [strip]);
    moves.add(document.getElementById("chat"), [slot]);
    // the games: out of the dock over the page, into the Játék tab
    const game = el("div", "m-game-slot");
    game.id = "m-game";
    // no game running (the chosen "standby" design): a radar, the state, that the reader will be told (the note on the
    // other tabs, liveTabs); under it, in any state, how many games this broadcast has had
    const line = (cls, text) => { const e = el("p", cls); e.textContent = text; return e; };
    const icon = (paths) => {  // outline icons, as the design's; aria-hidden: the words say it
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 24 24");
      svg.setAttribute("aria-hidden", "true");
      for (const d of paths) {
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("d", d);
        svg.append(path);
      }
      return svg;
    };
    const empty = el("div", "m-game-empty");
    const radar = icon(["M11 12a1 1 0 1 0 2 0a1 1 0 1 0 -2 0", "M15.51 15.56a5 5 0 1 0 -3.51 1.44",
      "M18.83 17.86a9 9 0 1 0 -6.83 3.14", "M12 12v9"]);
    radar.classList.add("m-game-radar");
    empty.append(radar, line("m-game-status", "Nincs futó játék"), line("m-game-info", "Szólunk, amikor indul a következő."));
    const how = el("div", "m-game-how");
    const played = line("m-game-played", "");
    played.hidden = true;
    how.append(played);
    // js/game.js keeps the counts on the dock: "challenges tips votes" opened so far in this broadcast
    const dockNow = document.querySelector(".game-dock");
    const count = () => {
      const [c, t, v] = (dockNow?.dataset.played || "").split(" ").map(Number);
      const parts = [[c, "kihívás"], [t, "tipp"], [v, "szavazás"]].filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}`);
      played.textContent = parts.length ? `Ebben az adásban · ${parts.join(" · ")}` : "";
      played.hidden = !parts.length;
    };
    if (dockNow) new MutationObserver(count).observe(dockNow, { attributes: true, attributeFilter: ["data-played"] });
    count();
    game.append(empty, how);
    slot.after(game);
    moves.add(document.querySelector(".game-dock"), [game, how]);
    gameCards(document.querySelector(".game-dock"));
    gameTags(game);
    slots = { chat: slot, game };
  }

  compactFacts(document.getElementById("facts"));
  if (page === "live") {
    const { bar, ai } = liveTabs(top, slots, followFeed(document.getElementById("facts")));
    for (const node of [bar, ai, document.querySelector("main > .below"), slots.chat, slots.game]) moves.add(node, null, [side]);
  }
  if (page === "watch") {
    replayParts(top, moves, side);
    moves.add(document.querySelector("main > .below"), null, [side]);
    compactFacts(document.getElementById("speakers"));  // a speech's facts open as the facts list's do
    followReplay(document.getElementById("facts"));
  }

  keyboardFit();
  composerInView();
  speakerSwap(document.getElementById("speaker"));
  tallyBump(document.querySelector(".speaker-col .tally:not(.m-speech-tally)"));  // the sitting's (wider screens)
  tallyBump(document.querySelector(".speaker-col .m-speech-tally"));  // the speech's (phones)
  // a verdict lands (js/app.js marks the fact .flash): once the stamp is over the mark goes, so moving the row
  // around later does not replay it
  document.getElementById("facts")?.addEventListener("animationend", (e) => {
    if (e.animationName === "m-frame") e.target.classList.remove("flash");
  });

  const remeasure = measure(document.querySelector(".site-header"), top,
    page === "live" ? player.querySelector(".player") : player);
  pullUp(top, player, remeasure);
  const place = () => { moves.place(); remeasure(); };
  PHONE.addEventListener("change", place);
  place();
}

const page = document.body.classList.contains("m-live") ? "live" : document.body.classList.contains("m-watch") ? "watch" : null;
try {
  if (page) mountApp(page);
} finally {
  document.body.classList.add("m-ready");
}
