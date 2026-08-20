#!/usr/bin/env node
/* ==========================================================================
   tools/browser-check.js — the things a headless Node harness cannot see.

   tools/smoke-test.js proves the Director, the engines and the save round-trip
   in a `vm` sandbox. What it structurally cannot prove is anything about the
   browser: whether the arena tears its animation frame down, whether listeners
   accumulate, whether the page throws.

   That matters most for ONE failure: a leaked requestAnimationFrame loop. The
   arena owns a frame loop per scene, so a scene that fails to call destroy()
   leaves its loop running forever, and every subsequent scene then shares the
   machine with a corpse. Nothing else in the project fails this quietly.

   THE MEASUREMENT THAT DISCRIMINATES
   The obvious check — "are frames still firing after I leave a scene?" — is
   worthless now that all 20 engines are arena-based, because the scene you
   moved to is legitimately rendering at 60fps. Parking on another engine as a
   "static control" measures the live arena and reports the leak of the dead
   one. It does not come back inconclusive; it comes back as a confident
   catastrophe.
     (That false positive really happened, during review, and looked like a
      12-of-12 disaster.)

   A leak is ACCUMULATION, not presence. One live arena renders forever by
   design; a leak means each visit leaves its loop behind, so N visits should
   cost ~N x 60fps. Visiting more scenes and watching the rate stay FLAT is the
   measurement that separates the two explanations.

   Zero dependencies: Node built-ins plus any Chromium-based browser already on
   the machine. If none is found it SKIPS rather than fails, so it can never
   block someone who just wants to run the tests.

     node tools/browser-check.js [visits]
   ========================================================================== */

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const VISITS = Math.max(1, Number(process.argv[2] || 6));
const PORT = 9200 + Math.floor(Math.random() * 600);
const SAMPLE_MS = 1000;

const CANDIDATES = [
  process.env.PUZZLESTUDIO_BROWSER,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
].filter(Boolean);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let fails = 0;
function ok(cond, label, detail) {
  console.log('  ' + (cond ? 'PASS' : 'FAIL') + '  ' + label);
  if (!cond) { fails++; if (detail) console.log('        ' + detail); }
}

const browser = CANDIDATES.find(p => { try { return fs.existsSync(p); } catch (_) { return false; } });
if (!browser) {
  console.log('\nSKIP  no Chromium-based browser found.');
  console.log('      Set PUZZLESTUDIO_BROWSER to one to run this check.');
  console.log('      (Skipping, not failing — node tools/smoke-test.js is the required suite.)\n');
  process.exit(0);
}

const profile = path.join(require('os').tmpdir(), 'pz-browser-check-' + process.pid);
const base = 'file:///' + ROOT.replace(/\\/g, '/').replace(/ /g, '%20') + '/index.html';
// Load idle FIRST. With ?dev=1 the bot starts a run the moment the page boots,
// so there is no quiet moment to measure and "is anything animating before a
// run?" would sample a legitimately-running arena and report a phantom loop.
const idleUrl = base;
const runUrl = base + '?dev=1&speed=4&seed=browsercheck';

const proc = spawn(browser, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--no-first-run', '--no-default-browser-check', '--disable-sync',
  '--disable-features=msEdgeIdentityFre,msImplicitSignin,FirstRunExperience',
  '--remote-debugging-port=' + PORT,
  '--user-data-dir=' + profile,
  '--window-size=1280,860',
  idleUrl
], { stdio: 'ignore' });

let ws = null;
function cleanup() {
  try { if (ws) ws.close(); } catch (_) {}
  try { proc.kill(); } catch (_) {}
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
}

(async () => {
  console.log('\nBrowser check — ' + path.basename(browser) + ', ' + VISITS + ' arena visits\n');
  await sleep(3500);

  const targets = await (await fetch('http://127.0.0.1:' + PORT + '/json/list')).json();
  const page = targets.find(t => t.type === 'page' && t.url.indexOf('file:///') === 0);
  if (!page) throw new Error('the game never opened a tab');

  ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0; const pending = new Map();
  let consoleErrors = 0;

  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      consoleErrors++;
      console.log('        console error: ' + (m.params.args || []).map(a => String(a.value)).join(' '));
    }
    if (m.method === 'Runtime.exceptionThrown') {
      consoleErrors++;
      const d = m.params.exceptionDetails || {};
      console.log('        uncaught: ' + ((d.exception && d.exception.description) || d.text));
    }
  });
  const send = (method, params) => new Promise((res, rej) => {
    const i = ++id; pending.set(i, { res, rej });
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });

  await new Promise(r => ws.addEventListener('open', r));
  await send('Page.enable');
  await send('Runtime.enable');
  const evaluate = async (expression) => (await send('Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true })).result.value;

  // Count every animation frame the page actually services. One arena means
  // roughly one display refresh worth; two live loops means twice that.
  const hookRaf = () => evaluate(
    "(function(){window.__raf=0;var o=window.requestAnimationFrame.bind(window);" +
    "window.requestAnimationFrame=function(cb){return o(function(t){window.__raf++;return cb(t);});};" +
    "return 'hooked';})()");
  await hookRaf();

  const rafRate = async () => {
    const before = await evaluate('window.__raf');
    await sleep(SAMPLE_MS);
    const after = await evaluate('window.__raf');
    return Math.round((after - before) * 1000 / SAMPLE_MS);
  };

  // Idle, on the title screen with no run started: nothing should animate.
  const idle = await rafRate();
  ok(idle < 15, 'nothing animates before a run starts', `${idle} frames/s while idle on the title screen`);

  // Now start the bot. Navigating re-creates the page, so re-hook.
  await send('Page.navigate', { url: runUrl });
  await sleep(3500);
  await hookRaf();

  // Let the bot walk the game, sampling as the arena count grows. A leak shows
  // up as the rate climbing with the number of scenes visited.
  const samples = [];
  for (let i = 1; i <= VISITS; i++) {
    await sleep(4000);
    const state = await evaluate(
      "JSON.stringify({depth:PuzzleStudio.engine.getState().depth," +
      "canvases:document.querySelectorAll('canvas').length})");
    const s = JSON.parse(state);
    const rate = await rafRate();
    samples.push({ depth: s.depth, canvases: s.canvases, rate });
    console.log(`        after ${String(s.depth).padStart(2)} scenes: ${String(rate).padStart(3)} frames/s, ${s.canvases} canvas`);
  }

  const rates = samples.map(s => s.rate);
  const first = rates[0], last = rates[rates.length - 1];
  const maxCanvas = Math.max.apply(null, samples.map(s => s.canvases));
  const depthGrew = samples[samples.length - 1].depth > samples[0].depth;

  ok(depthGrew, 'the bot actually played through several scenes',
    `depth went ${samples[0].depth} -> ${samples[samples.length - 1].depth}`);

  // *** THIS IS THE LOAD-BEARING ASSERTION. ***
  // Flat, not zero — one live arena is correct. Fault injection (destroy()
  // made a no-op) produces a clean 60 -> 120 -> 183 -> 240, exactly N x 60,
  // and fails here.
  //
  // Nothing else in this file catches that leak. In particular the canvas
  // check below PASSED throughout the injected failure: the canvas gets
  // replaced while the orphaned loop keeps rendering, so canvas count is
  // blind to it. If this assertion ever looks flaky, do not relax it and take
  // comfort from the others — they are not covering for it.
  ok(last <= Math.max(90, first * 1.6), 'animation frames do not accumulate across scenes',
    `${first} frames/s early vs ${last} late — a leak would scale with scenes visited`);

  // Cheap sanity, NOT leak detection — see above.
  ok(maxCanvas <= 1, 'at most one arena canvas is alive at a time',
    `saw ${maxCanvas} canvases in the document`);

  ok(consoleErrors === 0, 'no console errors or uncaught exceptions',
    `${consoleErrors} seen`);

  console.log('\n' + (fails ? `FAIL  ${fails} check(s) failed\n` : 'PASS  arena tears down cleanly; no leaked frames\n'));
  cleanup();
  await sleep(200);
  process.exit(fails ? 1 : 0);
})().catch(async (e) => {
  console.log('\nERROR  ' + e.message + '\n');
  cleanup();
  await sleep(200);
  process.exit(1);
});
