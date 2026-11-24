// vitaradar.hu games: instant challenges and speech tips while the stream plays, and the player's points.
//
// The pipeline (live/game.py, private repo) picks the challenges among the facts it is sure of, publishes each
// question when it is about to appear on the stream (games/{session}/challenges) and settles it after the answer
// window, the moment the answers close: the right answer is in no document the browser can read before that.
// Everything here runs on the stream's clock (the date of the frame on screen), so a question pops up when this
// viewer's video shows the claim, whatever their delay. Answers and tips go through the user API; visitors play along,
// unscored, and are asked to sign in.

import { collection, doc, getDoc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, el } from "./common.js?v=202611240846";
import { account, onAccount, api, needAccount, toast } from "./account.js?v=202611240846";

const TRUTH = { true: "IGAZ", false: "HAMIS" };
const MASKED = "Hibás érvelés?";
const RESULT_MS = 9000;      // a challenge's result stays this long once it is known
const STALE_MS = 60000;      // a challenge whose result has not come this long after its lock is dropped
const SENT_MS = 1500;        // the tip card stays open this long after sending, to show it went through, then folds
const TIP_ERROR_MS = 6000;   // a tip that did not go through: its card shows why for this long
const TIP_RESULT_MS = 60000; // the tip's card stays this long once its result is known
const MAX_BEHIND_MS = 30000; // a delay behind the stream's clock beyond this (a wrong computer clock, a paused video)
                             // is not trusted for the server's close
const SEND_MS = 500;         // an answer given at the last moment needs this long to reach the server

const label = (ch, option) => (ch.kind === "truth" ? TRUTH[option] || option : option);
const secs = (ms) => Math.max(0, Math.ceil(ms / 1000));
const pct = (left, total) => `${Math.max(0, Math.min(100, (100 * left) / Math.max(1, total)))}%`;

// When answers end for this viewer, on the stream's clock: when their video reaches the lock, or when the server stops
// taking answers (`closes_wall`, wall-clock time, less the time an answer takes to get there) if that comes first,
// as it does for a viewer further behind than the server waits for. The result comes out at that close, so the
// countdown ends about when the result can be shown.
function lockOf(item, lock, now) {
  const behind = Date.now() - now;
  if (!item.closes_wall || behind < 0 || behind > MAX_BEHIND_MS) return lock;
  return Math.min(lock, item.closes_wall - SEND_MS - behind);
}

function scoreTip(tip, actual) {  // the server's rule (live/game.py score_tip): 10 exact, 4 off by one, +10 all exact
  let points = 0, exact = 0;
  for (const k of ["true", "false", "fallacy"]) {
    const miss = Math.abs((tip[k] || 0) - (actual[k] || 0));
    points += miss === 0 ? 10 : miss === 1 ? 4 : 0;
    exact += miss === 0 ? 1 : 0;
  }
  return points + (exact === 3 ? 10 : 0);
}

function upsell(text) {
  const box = el("div", "game-upsell");
  const b = el("button", "btn", account.user ? "Regisztráció" : "Belépés");
  b.type = "button";
  b.addEventListener("click", needAccount);
  box.append(el("span", null, text), b);
  return box;
}

function bar() {
  const b = el("div", "game-bar");
  b.append(el("span"));
  return b;
}

// ------------------------------------------------------------------ a challenge (in the dock)
class ChallengeView {
  constructor(host) {
    this.box = el("section", "game-pop panel");
    this.box.setAttribute("aria-live", "polite");
    this.box.hidden = true;
    host.append(this.box);
    this.ch = null;
    this.mine = new Map();  // challenge id -> {choice, sent, error}
  }

  hide() { this.box.hidden = true; this.ch = null; }

  show(session, ch, now) {
    const key = `${session}/${ch.id}`;  // built once per challenge: a brief hide must not swap the buttons under a click
    if (this.built !== key) { this.build(session, ch); this.built = key; }
    this.ch = ch;
    this.now = now;
    this.update();
    this.box.hidden = false;
  }

  build(session, ch) {
    this.session = session;
    const b = this.box;
    b.dataset.kind = ch.kind;
    const head = el("div", "game-head");
    head.append(el("span", "game-tag", ch.kind === "truth" ? "[ KIHÍVÁS ]" : "[ KIHÍVÁS · HIBÁS ÉRVELÉS ]"),
      el("span", "game-time"), el("span", "game-worth", `+${ch.points} pont`));
    // What is being judged comes first: the claim itself (true/false) or the argument as summarized (fallacy). The
    // words as transcribed are only context, two lines at most: a transcript runs long and wanders off the point.
    const statement = el("p", "game-statement", (ch.kind === "truth" ? ch.claim || ch.summary : ch.summary) || ch.quote || "");
    const who = el("p", "game-who", ch.speaker ? `— ${ch.speaker}` : "");
    const quote = el("p", "game-quote", ch.quote ? `Elhangzott: „${ch.quote}”` : "");
    quote.title = ch.quote || "";
    quote.hidden = !ch.quote || ch.quote === statement.textContent;
    const opts = el("div", "game-options");
    for (const o of ch.options || []) {
      const btn = el("button", "game-opt");
      btn.type = "button";
      btn.dataset.option = o;
      btn.append(el("span", "opt-label", label(ch, o)), el("span", "opt-count"));
      btn.addEventListener("click", () => this.choose(o));
      opts.append(btn);
    }
    b.replaceChildren(head, el("h3", "game-q", ch.question || ""), statement, who, quote, bar(), opts,
      el("p", "game-status"), el("div", "game-after"));
  }

  async choose(option) {
    const ch = this.ch;
    if (!ch || this.mine.has(ch.id) || ch.result || this.now >= lockOf(ch, ch.locks_at, this.now)) return;
    const pick = { choice: option, sent: false, error: null };
    this.mine.set(ch.id, pick);
    this.update();
    if (!account.registered) return;  // visitors play along, unscored
    try {
      await api("/answer", { session: this.session, challenge: ch.id, choice: option });
      pick.sent = true;
    } catch (e) {
      pick.error = e.code === "closed" ? "Lejárt az idő, ez a válasz nem számít." : e.message || "A válasz nem ment át.";
    }
    if (this.ch === ch) this.update();
  }

  update() {
    const ch = this.ch, now = this.now, b = this.box;
    const pick = this.mine.get(ch.id), r = ch.result, lock = lockOf(ch, ch.locks_at, now);
    const open = !r && now < lock;
    b.dataset.state = r ? "result" : open ? "open" : "locked";
    b.querySelector(".game-bar span").style.width = open ? pct(lock - now, ch.locks_at - ch.opens_at) : "0%";
    b.querySelector(".game-time").textContent = open ? `${secs(lock - now)} mp` : "";
    const total = r ? Math.max(1, r.total || 0) : 0;
    for (const btn of b.querySelectorAll(".game-opt")) {
      const o = btn.dataset.option;
      btn.disabled = !open || Boolean(pick);
      btn.classList.toggle("picked", Boolean(pick && pick.choice === o));
      btn.classList.toggle("right", Boolean(r && r.answer === o));
      btn.classList.toggle("wrong", Boolean(r && pick && pick.choice === o && r.answer !== o));
      const n = r ? (r.counts || {})[o] || 0 : null;
      btn.querySelector(".opt-count").textContent = r && r.total ? `${Math.round((100 * n) / total)}%` : "";
      btn.style.setProperty("--share", r && r.total ? `${(100 * n) / total}%` : "0%");
    }
    const status = b.querySelector(".game-status"), after = b.querySelector(".game-after");
    after.replaceChildren();
    delete status.dataset.right;
    if (!r) {
      if (pick && pick.error) status.textContent = pick.error;
      else if (open) status.textContent = pick ? "Válasz rögzítve. Várjuk a többieket…" : "Válassz, mielőtt lejár az idő!";
      else status.textContent = pick ? "Lezárva, jön az eredmény…" : "Lejárt az idő, jön az eredmény…";
      if (open && !account.registered) after.append(upsell("Vendégként játszol, pontot belépve kapsz."));
      return;
    }
    const right = Boolean(pick && pick.choice === r.answer);
    status.dataset.right = String(right);
    status.textContent = !pick ? `A helyes válasz: ${label(ch, r.answer)}.`
      : right ? "Eltaláltad!" : `Nem talált. A helyes válasz: ${label(ch, r.answer)}.`;
    if (pick) {
      const others = Math.max(0, (r.total || 0) - (pick.sent ? 1 : 0));
      const same = Math.max(0, ((r.counts || {})[pick.choice] || 0) - (pick.sent ? 1 : 0));
      after.append(el("p", "game-same", others
        ? `${others} másik játékosból ${same} választotta ugyanezt.`
        : "Rajtad kívül senki nem válaszolt."));
    } else if (r.total) {
      after.append(el("p", "game-same", `${r.total} játékos válaszolt.`));
    }
    if (right && pick.sent) after.append(el("p", "game-won", `+${ch.points} pont`));
    else if (!account.registered) {
      after.append(upsell(right ? `Belépve most +${ch.points} pontot kaptál volna.` : "Lépj be, és gyűjts pontokat!"));
    }
    if (r.explanation) after.append(el("p", "game-expl", r.explanation));
  }
}

// ------------------------------------------------------------------ a speech tip: a card at the bottom left, from the
// start of a speech until a while after its result. It is open while the 20 s window runs; once the tip is in, it folds
// by itself into a bar (the speaker, the tip, later its points) that the player can open and close again.
class TipView {
  constructor(host) {
    this.box = el("section", "tip-box panel");
    this.box.hidden = true;
    host.append(this.box);
    this.mine = new Map();    // tip id -> {true, false, fallacy, sent, error, at}
    this.choice = new Map();  // tip id -> folded or not, as the player set it (otherwise it folds once the tip is in)
    this.seen = new Map();    // tip id -> stream time its result was first shown
    this.toasted = new Set();
    this.tip = null;
  }

  hide() { this.box.hidden = true; this.tip = null; }

  show(session, tip, now) {
    const key = `${session}/${tip.id}`;  // built once per tip, so the chosen counts survive a brief hide
    if (this.built !== key) { this.build(session, tip); this.built = key; }
    this.tip = tip;
    this.now = now;
    this.update();
    this.box.hidden = false;
  }

  // Its card is wanted while the window is open, and for a player who tipped until a while after the result.
  wanted(tip, now) {
    const entry = this.mine.get(tip.id);
    if (!entry) return now < lockOf(tip, tip.tip_until, now);
    if (entry.error) return now - entry.at < TIP_ERROR_MS;
    const first = this.seen.get(tip.id);
    return first == null || now - first < TIP_RESULT_MS;
  }

  folded() {
    const tip = this.tip, entry = this.mine.get(tip.id);
    if (this.choice.has(tip.id)) return this.choice.get(tip.id);
    return Boolean(entry && !entry.error && this.now - entry.at >= SENT_MS);
  }

  build(session, tip) {
    this.session = session;
    const entry = this.mine.get(tip.id);
    this.toggle = el("button", "tip-toggle");
    this.toggle.type = "button";
    this.toggle.addEventListener("click", () => {
      if (!this.tip) return;
      this.choice.set(this.tip.id, !this.folded());
      this.update();
    });
    const head = el("div", "game-head");
    head.append(el("span", "game-tag", "[ TIPP ]"), el("span", "tip-title", tip.speaker || "felszólalás"),
      el("span", "game-time"), el("span", "game-worth"), this.toggle);
    const grid = el("div", "tip-grid");
    this.vals = {};
    this.sums = {};
    const sum = el("p", "tip-sum");
    for (const [k, name, cls] of [["true", "igaz", "c-true"], ["false", "hamis", "c-false"], ["fallacy", "hibás érv", "c-fallacy"]]) {
      const minus = el("button", "tip-step", "−"), plus = el("button", "tip-step", "+");
      minus.type = plus.type = "button";
      minus.setAttribute("aria-label", `kevesebb ${name}`);
      plus.setAttribute("aria-label", `több ${name}`);
      const val = el("output", `tip-val ${cls}`, String(entry ? entry[k] || 0 : 0));
      this.vals[k] = val;
      minus.addEventListener("click", () => this.step(k, -1));
      plus.addEventListener("click", () => this.step(k, 1));
      const row = el("div", "tip-row");
      row.append(el("span", "tip-name", k === "fallacy" ? "hibás érvelés" : name), minus, val, plus);
      grid.append(row);
      this.sums[k] = el("b", cls);
      const item = el("span", "tip-sum-item");
      item.append(this.sums[k], ` ${name}`);
      sum.append(item);
    }
    this.send = el("button", "btn tip-send", "Tippelek");
    this.send.type = "button";
    this.send.addEventListener("click", () => this.submit());
    const body = el("div", "tip-body");
    body.append(el("p", "tip-q", `Mi lesz ${tip.speaker || "a felszólaló"} felszólalásának mérlege?`), grid, bar(), this.send,
      el("p", "game-status"), el("div", "game-after"));
    this.box.replaceChildren(head, sum, body);
  }

  step(k, d) {
    if (this.mine.has(this.tip.id)) return;
    this.vals[k].textContent = String(Math.max(0, Math.min(50, Number(this.vals[k].textContent) + d)));
    this.update();
  }

  async submit() {
    const tip = this.tip;
    if (!tip || this.mine.has(tip.id) || this.now >= lockOf(tip, tip.tip_until, this.now)) return;
    const counts = Object.fromEntries(Object.entries(this.vals).map(([k, v]) => [k, Number(v.textContent)]));
    const entry = { ...counts, sent: false, error: null, at: this.now };
    this.mine.set(tip.id, entry);
    this.update();
    if (!account.registered) return;
    try {
      await api("/tip", { session: this.session, tip: tip.id, ...counts });
      entry.sent = true;
    } catch (e) {
      entry.error = e.code === "closed" ? "Lejárt az idő, ez a tipp nem számít." : e.message || "A tipp nem ment át.";
      entry.at = this.now;
    }
    if (this.tip === tip) this.update();
  }

  // A tip sent before a reload: the player's entry is theirs to read.
  restore(tip, saved) {
    if (this.mine.has(tip.id) || !saved) return;
    this.mine.set(tip.id, { true: saved.true || 0, false: saved.false || 0, fallacy: saved.fallacy || 0,
      sent: true, error: null, at: -Infinity });
    if (this.built === `${this.session}/${tip.id}`) this.built = null;  // rebuilt with its counts
  }

  // the result of every tip the player sent, also one whose card has given way to a newer speech's
  announce(tip) {
    const entry = this.mine.get(tip.id);
    if (!tip.result || !entry || !entry.sent || this.toasted.has(tip.id)) return;
    this.toasted.add(tip.id);
    const pts = scoreTip(entry, tip.result.actual || {});
    toast(`Tipped eredménye (${tip.speaker || "felszólalás"}): ${pts ? `+${pts} pont` : "0 pont"}`);
  }

  update() {
    const tip = this.tip, now = this.now, b = this.box, entry = this.mine.get(tip.id), r = tip.result;
    const lock = lockOf(tip, tip.tip_until, now), running = now < lock, open = running && !entry;
    if (r && !this.seen.has(tip.id)) this.seen.set(tip.id, now);
    const folded = this.folded();
    b.dataset.state = open ? "open" : r ? "result" : "sent";
    b.dataset.folded = String(folded);
    this.toggle.textContent = folded ? "▴" : "▾";
    this.toggle.setAttribute("aria-expanded", String(!folded));
    this.toggle.setAttribute("aria-label", folded ? "A tipp kinyitása" : "A tipp becsukása");
    b.querySelector(".game-bar span").style.width = running ? pct(lock - now, tip.tip_until - tip.opens_at) : "0%";
    b.querySelector(".game-time").textContent = open ? `${secs(lock - now)} mp` : "";
    b.querySelectorAll(".tip-step").forEach((s) => { s.disabled = !open; });
    this.send.disabled = !open;
    for (const k of Object.keys(this.vals)) this.sums[k].textContent = this.vals[k].textContent;

    const pts = r && entry ? scoreTip(entry, r.actual || {}) : null;
    const worth = b.querySelector(".game-worth");
    worth.textContent = open ? "max +40 pont" : pts != null && entry.sent ? (pts ? `+${pts} pont` : "0 pont") : "";
    worth.classList.toggle("tip-points", pts != null && entry.sent);
    const status = b.querySelector(".game-status"), after = b.querySelector(".game-after");
    const key = `${tip.id}|${open}|${Boolean(r)}|${entry ? `${entry.sent}|${entry.error}` : "-"}|${account.registered}`;
    if (key === this.bodyKey) return;  // the rest changes only with these
    this.bodyKey = key;
    after.replaceChildren();
    if (open) {
      status.textContent = "Hány igaz, hamis állítás és hibás érvelés lesz benne?";
      if (!account.registered) after.append(upsell("Vendégként tippelsz, pontot belépve kapsz."));
      return;
    }
    if (!entry) { status.textContent = "Lejárt az idő."; return; }
    if (entry.error) { status.textContent = entry.error; return; }
    if (!r) { status.textContent = "Tipp rögzítve! A felszólalás végén kiderül."; return; }
    const a = r.actual || {};
    status.textContent = `Valójában: ${a.true || 0} igaz · ${a.false || 0} hamis · ${a.fallacy || 0} hibás érvelés.`;
    if (entry.sent) after.append(el("p", "game-won", pts ? `+${pts} pont` : "ezúttal 0 pont"));
    else if (!account.registered) after.append(upsell(pts ? `Belépve +${pts} pontot kaptál volna.` : "Lépj be, és gyűjts pontokat!"));
  }
}

// ------------------------------------------------------------------ the games of the live session
// mountGame({now}): now() is the date (ms) of the frame on screen. The dock spans the bottom of the window: the speech
// tip on the left, the challenge on the right (on a phone, one above the other).
export function mountGame({ now: streamNow }) {
  const dock = el("div", "game-dock");
  document.body.append(dock);
  const pop = new ChallengeView(dock);
  const tipView = new TipView(dock);
  let session = null, unsub = [];
  const challenges = new Map(), tips = new Map(), seen = new Map(), looked = new Set();

  function follow(s) {
    if (s === session) return;
    unsub.forEach((u) => u());
    unsub = [];
    session = s;
    challenges.clear(); tips.clear(); seen.clear();
    pop.hide(); tipView.hide();
    if (!s) return;
    const watch = (name, into) => onSnapshot(collection(db, "games", s, name), (snap) => {
      snap.docChanges().forEach((c) => (c.type === "removed" ? into.delete(c.doc.id) : into.set(c.doc.id, { ...c.doc.data(), id: c.doc.id })));
    }, (e) => console.warn(`${name}:`, e));
    unsub = [watch("challenges", challenges), watch("tips", tips)];
  }

  function tick() {
    const now = streamNow();
    if (now == null || !session) { pop.hide(); tipView.hide(); return; }
    // the challenge on screen: from its opening until its result has been shown for a while
    let current = null;
    for (const ch of challenges.values()) {
      if (now < ch.opens_at || now - ch.locks_at > STALE_MS) continue;
      if (ch.result && !seen.has(ch.id)) seen.set(ch.id, now);
      if (ch.result && now - seen.get(ch.id) > RESULT_MS) continue;
      if (!current || ch.opens_at > current.opens_at) current = ch;
    }
    if (current) pop.show(session, current, now); else pop.hide();
    // the speech tip: the newest whose window is open or that the player tipped (until a while after its result)
    let card = null;
    for (const t of tips.values()) {
      tipView.announce(t);
      if (now < t.opens_at || !tipView.wanted(t, now)) continue;
      if (!card || t.opens_at > card.opens_at) card = t;
    }
    if (card) tipView.show(session, card, now); else tipView.hide();
    restore(now);
  }

  // After a reload: the player's own tips of the two newest speeches still running, which they may have sent before.
  function restore(now) {
    const uid = account.registered && account.user && account.user.uid;
    if (!uid) return;
    const recent = [...tips.values()].filter((t) => t.opens_at <= now && !t.result)
      .sort((a, b) => b.opens_at - a.opens_at).slice(0, 2);
    for (const t of recent) {
      const key = `${session}/${t.id}/${uid}`;
      if (looked.has(key)) continue;
      looked.add(key);
      const s = session;
      getDoc(doc(db, "games", s, "tips", t.id, "entries", uid))
        .then((snap) => { if (s === session && snap.exists()) tipView.restore(t, snap.data()); })
        .catch((e) => console.warn("tip entry:", e));
    }
  }
  setInterval(tick, 200);

  // A fact that is part of a challenge shows as still being checked (a fallacy without its name) until its reveal.
  function mask(c, now) {
    const at = c.challenge && c.challenge.reveal_at;
    if (!at || (now != null && now >= at)) return c;
    const fallacy = c.kind === "fallacy";
    return { ...c, kind: fallacy ? "claim" : c.kind, bullet: fallacy ? MASKED : c.bullet,
      verdict: "pending", verdict_at: null, explanation: "", sources: [] };
  }

  return { follow, mask };
}
