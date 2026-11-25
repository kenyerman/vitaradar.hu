// vitaradar.hu on phones (up to 860px, as js/menu.js). The player stays pinned under the header, so the video never
// scrolls away (Twitch pauses an embed that is off-screen or covered) and nothing is ever drawn over it; under it a
// compact strip shows the speaker and the sitting's tally. On wider screens every part goes back where the page has it.
//
// The parts are moved, not copied, so the scripts that fill them (app.js, chat.js, game.js, watch.js) keep working
// wherever they are: they find them by id. --m-hdr is the header's height (where the pinned block starts) and --m-top
// where it ends (menus and panels open below it, never over the video). The header and the menu are js/shell.js's.
//
// The page says what it is in its markup (index.html: body.m-live, watch.html: body.m-watch), so the css has it from
// the first paint. This script loads on its own, before the page's data scripts, and puts the parts in place as soon
// as the page is parsed; then .m-ready shows the page (css: until then a phone sees the header only, never the wide
// layout squeezed in).

const PHONE = matchMedia("(max-width: 860px)");

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

// Phones, live page: the page stays put under the pinned block and the open tab's panel scrolls (css); elsewhere the
// window does. What scrolls the facts, then.
function scroller(list) {
  const app = document.body.classList.contains("m-live") || document.body.classList.contains("m-watch");
  return (PHONE.matches && app && list.closest(".below")) || window;
}

function measure(header, top, video) {
  const set = () => {
    const h = header ? header.offsetHeight : 0;
    root.style.setProperty("--m-hdr", `${h}px`);
    // where the pinned block ends on screen (on the replay page it starts below the title and pins only later), and
    // where the video ends (the menu opens right below it)
    const end = PHONE.matches && top ? Math.max(h, Math.round(top.getBoundingClientRect().bottom)) : h;
    root.style.setProperty("--m-top", `${end}px`);
    const vid = PHONE.matches && video ? Math.max(h, Math.round(video.getBoundingClientRect().bottom)) : h;
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

// Phones, replay page: the fact playing now stays in view as the video goes on, unless the reader has just scrolled.
function followReplay(list) {
  if (!list) return;
  let touched = 0;
  for (const ev of ["wheel", "touchmove", "keydown"]) addEventListener(ev, () => { touched = Date.now(); }, { passive: true });
  new MutationObserver((records) => {
    if (!PHONE.matches || Date.now() - touched < 4000) return;
    for (const r of records) {
      const li = r.target;
      if (li.classList.contains("now") && !(r.oldValue || "").split(" ").includes("now")) {
        const b = li.getBoundingClientRect();
        const top = parseFloat(getComputedStyle(root).getPropertyValue("--m-top")) || 0;
        if (b.top < top || b.bottom > innerHeight) li.scrollIntoView({ block: "nearest" });
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
    li.tabIndex = PHONE.matches ? 0 : -1;
    li.setAttribute("aria-expanded", String(li.dataset.open === "true"));
  };
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  const motion = () => PHONE.matches && !calm.matches;
  const ease = "cubic-bezier(.22, 1, .36, 1)";
  const runs = new WeakMap();  // li -> its running open or close: { kind, a, fades }
  const stop = (li) => {
    const r = runs.get(li);
    if (!r) return;
    runs.delete(li);
    r.a.cancel();
    r.fades.forEach((f) => f.cancel());
    li.style.overflow = "";
  };
  const details = (li) => [...li.querySelectorAll(":scope > :is(.fact-claim, .fact-expl, .fact-sources, .social)")];
  // the row's height goes from what it is now to its height open or closed; the text stays where it is (no sliding)
  const resize = (li, open) => {
    const from = li.offsetHeight;
    stop(li);
    if (open) li.dataset.open = "true"; else delete li.dataset.open;
    li.setAttribute("aria-expanded", String(open));
    if (!motion()) return;
    const to = li.offsetHeight;
    if (!open) li.dataset.open = "true";  // closing: the details stay while they fade and the row folds
    li.style.overflow = "hidden";
    const a = li.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 340, easing: ease });
    const fades = details(li).map((d, i) => d.animate([{ opacity: open ? 0 : 1 }, { opacity: open ? 1 : 0 }],
      open ? { duration: 260, delay: 60 + i * 50, easing: "ease-out", fill: "backwards" }
        : { duration: 180, easing: "ease-out", fill: "forwards" }));
    runs.set(li, { kind: open ? "open" : "close", a, fades });
    a.finished.then(() => {
      if (runs.get(li)?.a !== a) return;
      runs.delete(li);
      fades.forEach((f) => f.cancel());
      li.style.overflow = "";
      if (!open) delete li.dataset.open;
    }, () => {});
  };
  const isOpen = (li) => li.dataset.open === "true" && runs.get(li)?.kind !== "close";
  // Opening a row closes the one open before; the row tapped stays where it is on screen while the one above it folds.
  const toggle = (li) => {
    if (isOpen(li)) { resize(li, false); return; }
    const top = li.getBoundingClientRect().top;
    const others = [...list.querySelectorAll("li.fact")].filter((o) => o !== li && isOpen(o));
    for (const o of others) resize(o, false);
    resize(li, true);
    const above = others.some((o) => o.compareDocumentPosition(li) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (!above) return;
    const until = performance.now() + 420;
    const hold = () => {
      const dy = li.getBoundingClientRect().top - top;
      if (Math.abs(dy) >= 1) scroller(list).scrollBy(0, dy);
      if (performance.now() < until) requestAnimationFrame(hold);
    };
    hold();
  };
  list.addEventListener("click", (e) => {
    if (!PHONE.matches) return;
    if (e.target.closest("a, button, input, textarea, select, label, form, .social")) return;
    const li = e.target.closest("li.fact");
    if (li && list.contains(li)) toggle(li);
  });
  list.addEventListener("keydown", (e) => {
    if (!PHONE.matches || (e.key !== "Enter" && e.key !== " ")) return;
    const li = e.target;
    if (!li.matches || !li.matches("li.fact")) return;
    e.preventDefault();
    toggle(li);
  });
  new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach(mark);
  }).observe(list, { childList: true });

  // a row shows how many comments it has (js/social.js writes "N hozzászólás" into the fact's .talk label), and on
  // phones the verdict badges drop their [ ] (js/common.js writes "[ IGAZ ]"; wider screens keep them)
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
      if (!v) continue;
      const t = v.textContent;
      if (PHONE.matches && t.startsWith("[ ") && t.endsWith(" ]")) v.textContent = t.slice(2, -2);
      else if (!PHONE.matches && !t.startsWith("[")) v.textContent = `[ ${t} ]`;
    }
  };
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(tidy); } };
  new MutationObserver(later).observe(list, { childList: true, subtree: true, characterData: true });
  PHONE.addEventListener("change", later);
  list.querySelectorAll("li.fact").forEach(mark);
  PHONE.addEventListener("change", () => list.querySelectorAll("li.fact").forEach(mark));
}

// Phones, live page: the newest fact comes in at the top of the feed. Further down, the page keeps the reader's place
// (a fact coming in above doesn't push the text they are reading; the browser's own scroll anchoring is off, as Safari
// has none), and a button counts the new facts; a tap on it, or scrolling back up, brings them back to the newest.
function followFeed(list) {
  if (!list) return;
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  const pill = el("button", "m-new");
  pill.type = "button";
  pill.hidden = true;
  document.body.append(pill);
  const edge = () => parseFloat(getComputedStyle(root).getPropertyValue("--m-top")) || 0;
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
    pill.hidden = !PHONE.matches || top || !unseen || list.offsetParent === null;
    pill.textContent = `↑ ${unseen} új állítás`;
  };
  const onScroll = () => {
    if (!PHONE.matches) return;
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
    if (!PHONE.matches) return;
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
  top.append(bar, ai);

  const chatCol = document.getElementById("chat");
  const chatOpen = document.getElementById("chat-open");
  function select(id, focus = false) {
    document.body.dataset.mTab = id;
    for (const t of tabs) {
      const on = t.b.dataset.tab === id;
      t.b.setAttribute("aria-selected", String(on));
      t.b.tabIndex = on ? 0 : -1;
      if (on && focus) t.b.focus();
    }
    if (PHONE.matches) {  // on phones the Chat tab is the chat; wider screens keep the reader's own choice
      const closed = root.dataset.chat === "closed";
      if (id === "chat" && closed && chatOpen) chatOpen.click();
      if (id !== "chat" && !closed && chatCol) chatCol.querySelector(".chat-close")?.click();
    }
    if (id === "feed") feed.resume();
    else { feed.show(); scrollTo({ top: 0 }); }
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

  // a game open: the tab turns green and shows its countdown (js/game.js keeps it in .game-time)
  const dock = slots.game.querySelector(".game-dock") || document.querySelector(".game-dock");
  if (dock) {
    const live = () => {
      const card = dock.querySelector(':scope > :not([hidden])[data-state="open"]');
      const time = card ? (card.querySelector(".game-time") || {}).textContent || "" : "";
      if (card) gameTab.b.dataset.live = "true"; else delete gameTab.b.dataset.live;
      gameTab.n.textContent = time.trim();
      gameTab.n.hidden = !card || !time.trim();
    };
    new MutationObserver(live).observe(dock, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ["hidden", "data-state"] });
    live();
  }

  for (const t of tabs) t.b.setAttribute("aria-controls", t.b.dataset.tab === "feed" ? "facts" : t.b.dataset.tab === "chat" ? "chat" : "m-game");
  // phones start on the facts, so the chat starts closed (js/chat.js, mounting later, reads it; the reader's stored
  // choice stays as it is)
  if (PHONE.matches) root.dataset.chat = "closed";
  select("feed");
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
    if (first || !PHONE.matches) return;
    card.classList.remove("m-swap");
    void card.offsetWidth;  // restart the animation
    card.classList.add("m-swap");
  }).observe(name, { childList: true, characterData: true, subtree: true });
  card.addEventListener("animationend", (e) => { if (e.target === card) card.classList.remove("m-swap"); });
}

// The tally's figures tick (css .m-bump) when they grow, once the sitting's first count is in.
function tallyBump(tally) {
  if (!tally) return;
  const start = performance.now();
  for (const dd of tally.querySelectorAll("dd")) {
    let last = dd.textContent;
    new MutationObserver(() => {
      const now = dd.textContent;
      const grew = Number(now) > Number(last);
      last = now;
      if (!grew || performance.now() - start < 4000 || !PHONE.matches) return;
      dd.classList.remove("m-bump");
      void dd.offsetWidth;
      dd.classList.add("m-bump");
    }).observe(dd, { childList: true, characterData: true, subtree: true });
    dd.addEventListener("animationend", () => dd.classList.remove("m-bump"));
  }
}

// The game cards' tags ("[ KIHÍVÁS ]", js/game.js) drop their [ ] on phones, as the verdicts do; wider screens keep them.
function gameTags(box) {
  let queued = false;
  const tidy = () => {
    queued = false;
    for (const t of document.querySelectorAll(".game-dock .game-tag")) {
      const text = t.textContent;
      const bare = text.replace(/^\[[\s\u00a0]*/, "").replace(/[\s\u00a0]*\]$/, "");
      if (PHONE.matches && bare !== text) { t.dataset.full = text; t.textContent = bare; }
      else if (!PHONE.matches && t.dataset.full) { t.textContent = t.dataset.full; delete t.dataset.full; }
    }
  };
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(tidy); } };
  const dock = document.querySelector(".game-dock") || box;
  new MutationObserver(later).observe(dock, { childList: true, subtree: true });
  PHONE.addEventListener("change", later);
  later();
}

// Phones, replay page (as the live page): a compact row on top of the pinned block (back to the archive, the date
// and the time, the link to this moment as an icon), the video and the speaker strip, two tabs (the facts, the
// speakers) and the AI notice with the "all facts" switch. The tab names show how many there are.
function replayParts(top, moves) {
  const head = el("div", "m-whead");
  const text = el("div", "m-whead-text");
  head.append(text);
  top.prepend(head);
  const back = document.querySelector("main .crumbs a");
  if (back) back.setAttribute("aria-label", "Vissza az archívumba");
  moves.add(back, head, text);
  moves.add(document.getElementById("w-title"), text);
  moves.add(document.getElementById("w-sub"), text);
  moves.add(document.getElementById("copy-link"), head);
  moves.add(document.getElementById("copied"), head);
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
  facts.b.setAttribute("aria-controls", "facts");
  speakers.b.setAttribute("aria-controls", "speakers");
  const ai = el("p", "m-ai");
  const note = el("span");
  note.textContent = "// automatikus (AI) ellenőrzés — tévedhet";
  ai.append(note);
  top.append(bar, ai);
  moves.add(document.getElementById("show-all"), ai);

  const select = (id) => {
    document.body.dataset.mTab = id;
    for (const t of [facts, speakers]) t.b.setAttribute("aria-selected", String(t.b.dataset.tab === id));
    const box = document.querySelector(".m-watch .below");
    if (box && PHONE.matches) box.scrollTop = 0;
  };
  for (const t of [facts, speakers]) t.b.addEventListener("click", () => select(t.b.dataset.tab));
  bar.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const next = document.body.dataset.mTab === "feed" ? speakers : facts;
    select(next.b.dataset.tab);
    next.b.focus();
  });
  select("feed");

  // the counts: "[118/272]" (js/watch.js) as "118/272", the speeches' number; the date without its "// "
  const count = document.getElementById("fact-count"), list = document.getElementById("speakers");
  const title = document.getElementById("w-title");
  const sync = () => {
    facts.n.textContent = (count?.textContent || "").replace(/[[\]]/g, "");
    speakers.n.textContent = list && list.children.length ? String(list.children.length) : "";
    if (!title) return;
    const t = title.textContent;
    if (PHONE.matches && t.startsWith("// ")) { title.dataset.full = t; title.textContent = t.slice(3); }
    else if (!PHONE.matches && title.dataset.full) { title.textContent = title.dataset.full; delete title.dataset.full; }
  };
  for (const node of [count, list, title]) if (node) new MutationObserver(sync).observe(node, { childList: true, characterData: true, subtree: true });
  PHONE.addEventListener("change", sync);
  sync();
}

// page: "live" (index.html) or "watch" (watch.html)
function mountPhone(page) {
  const main = document.querySelector("main");
  const player = document.querySelector(page === "live" ? "#stage" : "main > .player");
  if (!main || !player) return;

  const top = el("div", "m-top");
  const strip = el("div", "m-strip");
  top.append(strip);
  player.before(top);

  const moves = mover();
  let slots = null;
  moves.add(player, top, strip);
  moves.add(document.getElementById("speaker"), strip);
  moves.add(document.querySelector(".speaker-col .tally"), strip);
  if (page === "live") {
    // the chat: its closed state's button moves off the video into the strip, the open chat under the pinned block
    const slot = el("div", "m-chat-slot");
    top.after(slot);
    moves.add(document.getElementById("chat-open"), strip);
    moves.add(document.getElementById("chat"), slot);
    // the games: out of the dock over the page, into the Játék tab
    const game = el("div", "m-game-slot");
    game.id = "m-game";
    // no game running: the card's empty state, as in the design (its tag, a status line, what to expect)
    const empty = el("div", "m-game-empty");
    const line = (cls, text) => { const e = el("p", cls); e.textContent = text; return e; };
    empty.append(line("m-game-tag", "Játék"), line("m-game-status", "Nincs futó kihívás"),
      line("m-game-info", "Kihívás akkor ugrik fel, amikor egy biztos állítás elhangzik; a felszólalások elején a mérlegre tippelhetsz."));
    // how the games work, under the card in any state
    const how = el("div", "m-game-how");
    const item = (name, text) => { const p = el("p"); const b = el("b"); b.textContent = name; p.append(b, ` ${text}`); return p; };
    how.append(line("m-game-how-h", "Hogyan működik?"),
      item("Kihívás:", "egy biztos állításnál 10 mp (igaz vagy hamis?) vagy 15 mp (melyik hibás érvelés?)."),
      item("Tipp:", "a felszólalás elején 20 mp, hány igaz, hamis állítás és hibás érvelés lesz benne."),
      item("Szavazás:", "tippeld meg, mit dönt az Országgyűlés."));
    game.append(empty, how);
    slot.after(game);
    moves.add(document.querySelector(".game-dock"), game, how);
    gameTags(game);
    slots = { chat: slot, game };
  }

  compactFacts(document.getElementById("facts"));
  if (page === "live") liveTabs(top, slots, followFeed(document.getElementById("facts")));
  if (page === "watch") { replayParts(top, moves); followReplay(document.getElementById("facts")); }

  speakerSwap(document.getElementById("speaker"));
  tallyBump(document.querySelector(".speaker-col .tally"));
  // a verdict lands (js/app.js marks the fact .flash): once the stamp is over the mark goes, so moving the row
  // around later does not replay it
  document.getElementById("facts")?.addEventListener("animationend", (e) => {
    if (e.animationName === "m-frame") e.target.classList.remove("flash");
  });

  const remeasure = measure(document.querySelector(".site-header"), top,
    page === "live" ? player.querySelector(".player") : player);
  const place = () => { moves.place(); remeasure(); };
  PHONE.addEventListener("change", place);
  place();
}

const page = document.body.classList.contains("m-live") ? "live" : document.body.classList.contains("m-watch") ? "watch" : null;
try {
  if (page) mountPhone(page);
} finally {
  document.body.classList.add("m-ready");
}
