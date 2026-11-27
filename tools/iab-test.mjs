#!/usr/bin/env node
// Tests the install from Facebook's and Messenger's own browsers (js/pwa.js) on an Android emulator or phone, over adb:
// opens a Facebook post or a Messenger chat that holds a vitaradar.hu link, taps the link, waits for our install sheet
// in the app's browser and taps its Telepítés, answers Meta's "open in another app?" (and Android's app chooser), and
// checks that Chrome came up with the same page (path and query, the ?telepites mark already gone) and our "Még egy
// koppintás" sheet; with --install also its Telepítés, Chrome's own install dialog and the installed app (removed again
// unless --keep). Screenshots of each step and a result.json go to --out. Node 22+ (fetch, WebSocket), no packages.
//
// The apps' own interruptions ("Save your login info?") get the answer that changes nothing (Not now).
//
// One-time setup (an emulator with Google Play, or a phone with USB debugging):
//   1. Sign in to Google Play, install Facebook and Messenger, sign in to both; open Chrome once (its welcome screens).
//   2. Put a link where the test can open it: a Facebook post seen by "Only me" with https://vitaradar.hu/?iabtest=facebook,
//      and a message to yourself in Messenger with a vitaradar.hu link (the query tells the runs apart in Chrome; the
//      site ignores it).
// Run (emulator: ~/Library/Android/sdk/emulator/emulator -avd <name>):
//   node tools/iab-test.mjs --app facebook  --open fb://profile --scroll 5 --link iabtest=facebook [--install]
//   node tools/iab-test.mjs --app messenger --open app --chat "<your name>" --link vitaradar.hu [--install]
//   --open <URL> opens a post or chat by its link instead; --here tests from the screen as it is.
//   node tools/iab-test.mjs --dump   (the screen's elements, to see what the apps call things today)
// Exit code 0: Chrome came up with the page and the sheet (and with --install, the app got installed). Meta changes its apps every week: run it after their updates.
// Port 9341 on the Mac is forwarded to Chrome's DevTools on the device (--port to change it).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, x, i, all) => {
  if (x.startsWith("--")) a.push([x.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : true]);
  return a;
}, []));
const ADB = process.env.ADB || path.join(os.homedir(), "Library/Android/sdk/platform-tools/adb");
const SERIAL = args.serial ? ["-s", args.serial] : [];
const PKG = { facebook: "com.facebook.katana", messenger: "com.facebook.orca" };
const CHROME = "com.android.chrome";
const PORT = Number(args.port || 9341);  // on the Mac, forwarded to Chrome's DevTools on the device
const OUT = args.out || path.join(os.tmpdir(), `iab-test-${new Date().toISOString().replace(/[:.]/g, "-")}`);
// Meta's question before another app opens, and Android's chooser (English and Hungarian; --dump shows today's words)
const YES = /^(open|megnyitás|continue|folytatás|leave|kilépés|ok|open link|link megnyitása|just once|csak egyszer|always|mindig|chrome)$/i;
// our own sheet's buttons in the app's browser (js/pwa.js): Telepítés, and "Újra: megnyitás…" if the browser did not come
const OURS = /^(telepítés|újra: megnyitás .*)$/i;

const adb = (...a) => execFileSync(ADB, [...SERIAL, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const shell = (cmd) => adb("shell", cmd);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s]`, ...a);
const T0 = Date.now();

function focus() {
  const out = shell("dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'");
  const m = /mCurrentFocus=Window\{\S+ \S+ ([\w.]+)/.exec(out) || /mFocusedApp=.*? ([\w.]+)\//.exec(out);
  return m ? m[1] : "";
}

function screen() {
  shell("uiautomator dump /sdcard/iab-ui.xml >/dev/null 2>&1");
  const xml = adb("exec-out", "cat", "/sdcard/iab-ui.xml");
  const nodes = [];
  for (const m of xml.matchAll(/<node ([^>]*?)\/?>/g)) {
    const at = Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((x) => [x[1], x[2]]));
    const b = /\[(\d+),(\d+)\]\[(\d+),(\d+)\]/.exec(at.bounds || "");
    if (!b) continue;
    const label = (at.text || at["content-desc"] || "").replace(/&#10;|\s+/g, " ").trim();
    nodes.push({ label, id: at["resource-id"] || "", cls: at.class || "", pkg: at.package || "",
      x: (+b[1] + +b[3]) >> 1, y: (+b[2] + +b[4]) >> 1, w: b[3] - b[1], h: b[4] - b[2] });
  }
  return nodes;
}

const tap = (n) => shell(`input tap ${n.x} ${n.y}`);
// the apps' own interruptions (save the login, turn on contacts…): always the answer that changes nothing
async function notNow() {
  for (let i = 0; i < 3; i++) {
    const n = screen().find((x) => /^(not now|most nem|skip|kihagyás|no thanks|nem, köszönöm)$/i.test(x.label));
    if (!n) return;
    tap(n);
    await wait(1500);
  }
}
function shot(name) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${name}.png`), execFileSync(ADB, [...SERIAL, "exec-out", "screencap", "-p"]));
}

async function tabs() {
  try {
    adb("forward", `tcp:${PORT}`, "localabstract:chrome_devtools_remote");
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`, { signal: AbortSignal.timeout(3000) });
    return (await r.json()).filter((t) => t.type === "page");
  } catch { return []; }
}

// Runs `expr` in a Chrome tab on the device (DevTools protocol)
function evaluate(tab, expr) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/devtools/page/${tab.id}`);
    const done = (v) => { try { ws.close(); } catch { /* closed */ } resolve(v); };
    ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate",
      params: { expression: expr, awaitPromise: true, returnByValue: true } }));
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id === 1) done(m.result?.result?.value ?? m.result ?? null); };
    ws.onerror = () => done(null);
    setTimeout(() => done(null), 8000);
  });
}

async function run() {
  if (args.dump) {
    console.log(`focus: ${focus()}`);
    for (const n of screen()) if (n.label) console.log(`${n.pkg}\t${n.cls.split(".").pop()}\t${n.x},${n.y}\t${n.label}`);
    return 0;
  }
  const app = args.app;
  if (!PKG[app] || !(args.open || args.here) || !args.link) {
    console.error("usage: node tools/iab-test.mjs --app facebook|messenger (--open <URL> | --open app | --here) [--chat <name>] [--scroll <n>] --link <text in the link> [--out dir] [--serial id] [--port n]");
    return 2;
  }
  const result = { app, open: args.open, link: args.link, out: OUT, steps: [] };
  const step = (s) => { result.steps.push(s); log(s); };
  const before = new Set((await tabs()).map((t) => t.id));

  if (args.here) {
    // a link opened earlier may still be in the app's browser: close it, back to the chat or the post
    const left = screen();
    const close = left.find((n) => /^(close|bezárás)$/i.test(n.label) && n.pkg === PKG[app]);
    if (close && left.some((n) => n.cls.endsWith("WebView"))) { tap(close); await wait(1500); step("closed the app's browser left open"); }
    step(`testing from the screen as it is (${focus()})`);
  } else {
    shell(`am force-stop ${PKG[app]}`);
    if (args.open === "app") shell(`monkey -p ${PKG[app]} -c android.intent.category.LAUNCHER 1`);
    else shell(`am start -a android.intent.action.VIEW -d '${args.open}' ${PKG[app]}`);
    step(`opened ${args.open} in ${app}`);
    await wait(4000);
  }
  await notNow();
  if (args.chat) {  // Messenger's chat list: the chat by its name
    let chat = null;
    for (let t = Date.now(); !chat && Date.now() - t < 20000; await wait(1000)) {
      chat = screen().find((n) => n.pkg === PKG[app] && n.label.startsWith(args.chat) && n.h > 60);
    }
    if (!chat) { shot("1-no-chat"); step(`no chat named "${args.chat}" on the list`); return finish(result, 1); }
    tap(chat);
    step(`opened the chat "${args.chat}"`);
    await wait(2500);
  }

  // the link: the newest one on the screen (lowest), a button rather than its text, never the "Forward link…" icon;
  // --scroll n: swipe up to n times to find it (a profile's posts)
  let link = null, scrolled = 0;
  const scrolls = Number(args.scroll || 0);
  for (let t = Date.now(); !link && Date.now() - t < 25000 + 4000 * scrolls; await wait(1200)) {
    if (Date.now() - t > 3000 && scrolled < scrolls) { shell("input swipe 540 1900 540 900 400"); scrolled++; await wait(800); }
    const hits = screen().filter((n) => n.pkg === PKG[app] && n.label.includes(args.link)
      && !/^(forward|továbbítás|share|megosztás)/i.test(n.label));
    const btn = (n) => (n.cls.endsWith("Button") ? 1 : 0);
    hits.sort((a, b) => (btn(b) - btn(a)) || (b.y - a.y));
    link = hits[0] || null;
  }
  shot("1-before-tap");
  if (!link) { step("the link was not found on the screen (see 1-before-tap.png, or --dump)"); return finish(result, 1); }
  step(`tapping "${link.label.slice(0, 80)}"`);
  tap(link);
  const tapped = Date.now();

  // in the app's browser: our sheet comes (js/pwa.js); its Telepítés asks Meta to open the browser; Meta asks; yes
  let ours = 0;
  for (;;) {
    const f = focus();
    if (f.startsWith(CHROME)) { step(`Chrome is in front after ${((Date.now() - tapped) / 1000).toFixed(1)} s`); break; }
    if (f.startsWith("org.chromium.webapk")) { step(`the installed app came up (${f}): the page opened in it, not in Chrome`); result.installedApp = f; return finish(result, 0); }
    if (Date.now() - tapped > 45000) { step(`no Chrome after 45 s (in front: ${f || "?"})`); shot("2-stuck"); return finish(result, 1); }
    const nodes = screen();
    const yes = nodes.find((n) => YES.test(n.label) && /Button|TextView/.test(n.cls));
    if (yes) {
      shot(`3-asked-${result.steps.length}`);
      step(`answering "${nodes.filter((n) => n.label && n.pkg === yes.pkg).map((n) => n.label).slice(0, 6).join(" | ")}" with ${yes.label}`);
      result.asked = (result.asked || []).concat(yes.label);
      tap(yes);
      await wait(1500);
      continue;
    }
    const mine = ours < 2 && nodes.find((n) => OURS.test(n.label) && n.cls.endsWith("Button"));
    if (mine) {
      ours++;
      shot(`2-our-sheet-${ours}`);
      step(`${((Date.now() - tapped) / 1000).toFixed(1)} s: our sheet in the app's browser, tapping "${mine.label}"`);
      if (ours === 1) result.sheetAfter = Math.round((Date.now() - tapped) / 100) / 10;
      tap(mine);
      await wait(2500);
      continue;
    }
    await wait(800);
  }
  result.tappedSheet = ours;

  // in Chrome: the same page, and straight to the install ("Még egy koppintás", before the cookie bar)
  let direct = null;
  for (let t = Date.now(); !direct && Date.now() - t < 15000; await wait(700)) {
    direct = screen().find((n) => n.pkg === CHROME && /^még egy koppintás$/i.test(n.label));
  }
  shot("4-chrome");
  const all = await tabs();
  const tab = all.find((t) => t.url.includes(args.link) && !before.has(t.id)) || all.find((t) => t.url.includes(args.link));
  if (!tab) { step(`Chrome has no tab with "${args.link}" (${all.map((t) => t.url).join(", ") || "DevTools not reachable"})`); return finish(result, 1); }
  result.url = tab.url;
  result.newTab = !before.has(tab.id);
  result.page = await evaluate(tab, `(() => {
    const d = document.querySelector(".install-sheet[open]"), b = document.querySelector(".hdr-install");
    return { url: location.href, marked: new URLSearchParams(location.search).has("telepites"),
      consentBar: document.documentElement.dataset.consent === "open", sheet: d ? d.dataset.view : null,
      headerButton: b ? !b.hidden : null, ua: navigator.userAgent };
  })()`);
  step(`Chrome tab ${result.newTab ? "(new)" : "(already open)"}: ${tab.url}`);
  step(`page: ${JSON.stringify(result.page)}`);
  if (!direct) { step("no \"Még egy koppintás\" sheet in Chrome"); return finish(result, 1); }

  // --install: its Telepítés, Chrome's own "Install app", and the app on the phone (removed again unless --keep)
  if (args.install) {
    const apks = () => new Set(shell("pm list packages").split(/\s+/).filter((x) => x.includes("webapk")));
    const had = apks();
    const go = screen().find((n) => n.pkg === CHROME && /^telepítés$/i.test(n.label) && n.cls.endsWith("Button"));
    if (!go) { step("no Telepítés on the sheet"); return finish(result, 1); }
    tap(go);
    let ok = null;
    for (let t = Date.now(); !ok && Date.now() - t < 10000; await wait(700)) {
      const nodes = screen();
      if (nodes.some((n) => /^még egy koppintás$/i.test(n.label))) continue;  // our sheet still closing
      ok = nodes.find((n) => n.pkg === CHROME && /^(install|telepítés)$/i.test(n.label) && n.cls.endsWith("Button"));
    }
    shot("5-install-dialog");
    if (!ok) { step("Chrome's install dialog did not come"); return finish(result, 1); }
    step("Chrome's install dialog: tapping " + ok.label);
    tap(ok);
    let added = [];
    for (let t = Date.now(); !added.length && Date.now() - t < 40000; await wait(2000)) added = [...apks()].filter((x) => !had.has(x));
    shot("6-installed");
    if (!added.length) { step("no app was installed in 40 s"); return finish(result, 1); }
    result.installed = added[0].replace(/^package:/, "");
    step(`installed: ${result.installed}`);
    if (!args.keep) { adb("uninstall", result.installed); step("removed it again (--keep keeps it)"); }
  }
  return finish(result, 0);
}

function finish(result, code) {
  result.ok = code === 0;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "result.json"), JSON.stringify(result, null, 2));
  log(`${result.ok ? "PASS" : "FAIL"}: ${OUT}`);
  return code;
}

run().then((c) => process.exit(c), (e) => { console.error(e); process.exit(1); });
