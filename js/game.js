// vitaradar.hu games: instant challenges and speech tips while the stream plays, and the player's points.
//
// The pipeline (live/game.py, private repo) picks the challenges among the facts it is sure of, publishes each
// question when it is about to appear on the stream (games/{session}/challenges) and settles it after the answer
// window: the right answer is in no document the browser can read before that. Everything here runs on the stream's
// clock (the date of the frame on screen), so a question pops up when this viewer's video shows the claim, whatever
// their delay. Answers and tips go through the user API; visitors play along, unscored, and are asked to sign in.

import { collection, doc, onSnapshot } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { db, el } from "./common.js?v=202611231830";
import { account, onAccount, api, needAccount, toast } from "./account.js?v=202611231830";

const TRUTH = { true: "IGAZ", false: "HAMIS" };
const MASKED = "Hibás érvelés?";
const RESULT_MS = 9000;      // a challenge's result stays this long once it is known
const STALE_MS = 60000;      // a challenge whose result has not come this long after its lock is dropped
const SENT_MS = 1500;        // the tip box stays this long after sending, to show it went through
const TIP_RESULT_MS = 60000; // the tip's result stays by the speaker this long

const label = (ch, option) => (ch.kind === "truth" ? TRUTH[option] || option : option);
const secs = (ms) => Math.max(0, Math.ceil(ms / 1000));
const pct = (left, total) => `${Math.max(0, Math.min(100, (100 * left) / Math.max(1, total)))}%`;

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

// ------------------------------------------------------------------ points balance (header)
function mountPoints() {
  const row = document.querySelector(".site-header .header-row");
  if (!row) return;
  const chip = el("button", "points-chip");
  chip.type = "button";
  chip.hidden = true;
  chip.title = "Pontjaid: a kihívásokban és a tippekben gyűjtöd őket";
  chip.addEventListener("click", () => {
    if (needAccount()) toast("Pontot az élő adás kihívásaiért és a felszólalásokra adott tippekért kapsz.");
  });
  row.insertBefore(chip, row.querySelector(".acct"));
  let stop = null;
  onAccount((a) => {
    if (stop) { stop(); stop = null; }
    chip.hidden = !a.registered;
    if (!a.registered) return;
    chip.textContent = "◆ … pont";
    stop = onSnapshot(doc(db, "users", a.user.uid), (snap) => {
      const p = Number((snap.data() || {}).points || 0);
      if (chip.dataset.points && Number(chip.dataset.points) < p) {
        chip.classList.remove("bump"); void chip.offsetWidth; chip.classList.add("bump");
      }
      chip.dataset.points = String(p);
      chip.textContent = `◆ ${p.toLocaleString("hu-HU")} pont`;
    }, (e) => console.warn("points:", e));
  });
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
    if (!this.ch || this.ch.id !== ch.id) this.build(session, ch);
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
    const quote = el("blockquote", "game-quote", `„${ch.quote || ch.claim || ""}”`);
    const who = el("p", "game-who", ch.speaker ? `— ${ch.speaker}` : "");
    const summary = el("p", "game-summary", ch.summary || "");
    summary.hidden = !ch.summary;
    const opts = el("div", "game-options");
    for (const o of ch.options || []) {
      const btn = el("button", "game-opt");
      btn.type = "button";
      btn.dataset.option = o;
      btn.append(el("span", "opt-label", label(ch, o)), el("span", "opt-count"));
      btn.addEventListener("click", () => this.choose(o));
      opts.append(btn);
    }
    b.replaceChildren(head, el("h3", "game-q", ch.question || ""), quote, who, summary, bar(), opts,
      el("p", "game-status"), el("div", "game-after"));
  }

  async choose(option) {
    const ch = this.ch;
    if (!ch || this.mine.has(ch.id) || ch.result || this.now >= ch.locks_at) return;
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
    const pick = this.mine.get(ch.id), r = ch.result;
    const open = !r && now < ch.locks_at;
    b.dataset.state = r ? "result" : open ? "open" : "locked";
    b.querySelector(".game-bar span").style.width = open ? pct(ch.locks_at - now, ch.locks_at - ch.opens_at) : "0%";
    b.querySelector(".game-time").textContent = open ? `${secs(ch.locks_at - now)} mp` : "";
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
      else status.textContent = pick ? "Lezárva, kiderül…" : "Lejárt az idő. Kiderül…";
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

// ------------------------------------------------------------------ a speech tip: the 20 s window in the dock,
// then the player's tip and its result by the speaker
class TipView {
  constructor(host, aside) {
    this.box = el("section", "tip-box panel");
    this.box.hidden = true;
    host.append(this.box);
    this.line = el("div", "tip-line panel");
    this.line.hidden = true;
    if (aside) aside.append(this.line);
    this.mine = new Map();  // tip id -> {true, false, fallacy, sent, error, at, tip}
    this.seen = new Map();  // tip id -> stream time its result was first shown
    this.toasted = new Set();
    this.tip = null;
  }

  hide() { this.box.hidden = true; this.tip = null; }

  show(session, tip, now) {
    if (!this.tip || this.tip.id !== tip.id) this.build(session, tip);
    this.tip = tip;
    this.now = now;
    this.update();
    this.box.hidden = false;
  }

  build(session, tip) {
    this.session = session;
    const head = el("div", "game-head");
    head.append(el("span", "game-tag", "[ TIPPELJ ]"), el("span", "game-time"), el("span", "game-worth", "max +40 pont"));
    const q = el("p", "tip-q", `Mi lesz ${tip.speaker || "a felszólaló"} felszólalásának mérlege?`);
    const grid = el("div", "tip-grid");
    this.vals = {};
    for (const [k, name, cls] of [["true", "igaz", "c-true"], ["false", "hamis", "c-false"], ["fallacy", "hibás érvelés", "c-fallacy"]]) {
      const minus = el("button", "tip-step", "−"), plus = el("button", "tip-step", "+");
      minus.type = plus.type = "button";
      minus.setAttribute("aria-label", `kevesebb ${name}`);
      plus.setAttribute("aria-label", `több ${name}`);
      const val = el("output", `tip-val ${cls}`, "0");
      this.vals[k] = val;
      minus.addEventListener("click", () => this.step(k, -1));
      plus.addEventListener("click", () => this.step(k, 1));
      const row = el("div", "tip-row");
      row.append(el("span", "tip-name", name), minus, val, plus);
      grid.append(row);
    }
    this.send = el("button", "btn tip-send", "Tippelek");
    this.send.type = "button";
    this.send.addEventListener("click", () => this.submit());
    this.box.replaceChildren(head, q, grid, bar(), this.send, el("p", "game-status"), el("div", "game-after"));
  }

  step(k, d) {
    if (this.mine.has(this.tip.id)) return;
    this.vals[k].textContent = String(Math.max(0, Math.min(50, Number(this.vals[k].textContent) + d)));
  }

  async submit() {
    const tip = this.tip;
    if (!tip || this.mine.has(tip.id) || this.now >= tip.tip_until) return;
    const counts = Object.fromEntries(Object.entries(this.vals).map(([k, v]) => [k, Number(v.textContent)]));
    const entry = { ...counts, sent: false, error: null, at: this.now, tip };
    this.mine.set(tip.id, entry);
    this.update();
    if (!account.registered) return;
    try {
      await api("/tip", { session: this.session, tip: tip.id, ...counts });
      entry.sent = true;
    } catch (e) {
      entry.error = e.code === "closed" ? "Lejárt az idő, ez a tipp nem számít." : e.message || "A tipp nem ment át.";
    }
    if (this.tip === tip) this.update();
  }

  // the dock's box is shown while the window is open (and a moment after sending)
  wanted(tip, now) {
    const entry = this.mine.get(tip.id);
    if (entry) return now - entry.at < SENT_MS || Boolean(entry.error && now < tip.tip_until);
    return now < tip.tip_until;
  }

  update() {
    const tip = this.tip, now = this.now, b = this.box, entry = this.mine.get(tip.id);
    const open = now < tip.tip_until && !entry;
    b.dataset.state = open ? "open" : "sent";
    b.querySelector(".game-bar span").style.width = now < tip.tip_until ? pct(tip.tip_until - now, tip.tip_until - tip.opens_at) : "0%";
    b.querySelector(".game-time").textContent = now < tip.tip_until ? `${secs(tip.tip_until - now)} mp` : "";
    b.querySelectorAll(".tip-step").forEach((s) => { s.disabled = !open; });
    this.send.disabled = !open;
    const status = b.querySelector(".game-status"), after = b.querySelector(".game-after");
    after.replaceChildren();
    if (open) {
      status.textContent = "Hány igaz, hamis állítás és hibás érvelés lesz benne?";
      if (!account.registered) after.append(upsell("Vendégként tippelsz, pontot belépve kapsz."));
    } else {
      status.textContent = entry && entry.error ? entry.error : "Tipp rögzítve! A felszólalás végén kiderül.";
    }
  }

  // the line by the speaker: the player's latest tip, then its result
  renderLine(tips, now) {
    let entry = null;
    for (const e of this.mine.values()) if (!entry || e.at > entry.at) entry = e;
    const tip = entry && (tips.get(entry.tip.id) || entry.tip);
    const r = tip && tip.result;
    if (r && !this.seen.has(tip.id)) this.seen.set(tip.id, now);
    if (!entry || now - entry.at < SENT_MS || (r && now - this.seen.get(tip.id) > TIP_RESULT_MS)) {
      this.line.hidden = true;
      return;
    }
    this.line.hidden = false;
    const key = `${tip.id}|${Boolean(r)}|${entry.sent}|${entry.error}|${account.registered}`;
    if (key === this.lineKey) return;
    this.lineKey = key;
    const rows = [el("p", "tip-line-head", `> tipped: ${tip.speaker || "felszólalás"}`),
      el("p", "tip-line-mine", `${entry.true} igaz · ${entry.false} hamis · ${entry.fallacy} hibás érv`)];
    if (entry.error) rows.push(el("p", "muted", entry.error));
    if (!r) rows.push(el("p", "muted", "a felszólalás végén kiderül"));
    else {
      const a = r.actual || {}, pts = scoreTip(entry, a);
      rows.push(el("p", "tip-line-actual", `valójában: ${a.true || 0} igaz · ${a.false || 0} hamis · ${a.fallacy || 0} hibás érv`));
      if (entry.sent) rows.push(el("p", "game-won", pts ? `+${pts} pont` : "ezúttal 0 pont"));
      else if (!account.registered) rows.push(upsell(pts ? `Belépve +${pts} pontot kaptál volna.` : "Lépj be, és gyűjts pontokat!"));
      if (entry.sent && !this.toasted.has(tip.id)) {
        this.toasted.add(tip.id);
        toast(`Tipped eredménye (${tip.speaker || "felszólalás"}): ${pts ? `+${pts} pont` : "0 pont"}`);
      }
    }
    this.line.replaceChildren(...rows);
  }
}

// ------------------------------------------------------------------ the games of the live session
// mountGame({now, aside}): now() is the date (ms) of the frame on screen, aside the speaker's column.
export function mountGame({ now: streamNow, aside }) {
  mountPoints();
  const dock = el("div", "game-dock");
  document.body.append(dock);
  const pop = new ChallengeView(dock);
  const tipView = new TipView(dock, aside);
  let session = null, unsub = [];
  const challenges = new Map(), tips = new Map(), seen = new Map();

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
    if (now == null || !session) { pop.hide(); tipView.hide(); tipView.line.hidden = true; return; }
    // the challenge on screen: from its opening until its result has been shown for a while
    let current = null;
    for (const ch of challenges.values()) {
      if (now < ch.opens_at || now - ch.locks_at > STALE_MS) continue;
      if (ch.result && !seen.has(ch.id)) seen.set(ch.id, now);
      if (ch.result && now - seen.get(ch.id) > RESULT_MS) continue;
      if (!current || ch.opens_at > current.opens_at) current = ch;
    }
    if (current) pop.show(session, current, now); else pop.hide();
    // the speech tip whose window is open
    let open = null;
    for (const t of tips.values()) {
      if (now < t.opens_at || !tipView.wanted(t, now)) continue;
      if (!open || t.opens_at > open.opens_at) open = t;
    }
    if (open) tipView.show(session, open, now); else tipView.hide();
    tipView.renderLine(tips, now);
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
