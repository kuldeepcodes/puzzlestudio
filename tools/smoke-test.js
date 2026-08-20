#!/usr/bin/env node
/* ==========================================================================
   PuzzleStudio — tools/smoke-test.js

     node tools/smoke-test.js

   No npm install. No dependencies. Plain Node.

   WHAT IT DOES
     1. Loads every core module and EVERY js/games/*.js into one vm sandbox
        with a deliberately hostile document shim, proving no engine file
        touches the DOM at load time.
     2. Drives the Director through 1000 transitions, calling each engine's
        real build() headlessly and its autoSolve() when it has one.
     3. Asserts: no dead ends, no repeat-lock, stats stay inside 0..100,
        every registered engine and every registered skin is reachable,
        and nothing throws.
     4. Greps the source for file:// killers (import/export/fetch/XHR).

   Prints a PASS/FAIL summary plus a coverage table. Exits non-zero on failure.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const TRANSITIONS = Number(process.env.PZ_TRANSITIONS || 1000);
const SEED = process.env.PZ_SEED || 'SMOKE-TEST';

/* ----------------------------------------------------------------- output - */
const C = process.stdout.isTTY
  ? { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[90m', b: '\x1b[1m', x: '\x1b[0m' }
  : { g: '', r: '', y: '', d: '', b: '', x: '' };

const failures = [];
const notes = [];
let checks = 0;

function ok(cond, label, detail) {
  checks++;
  if (cond) { console.log(`  ${C.g}PASS${C.x}  ${label}`); return true; }
  failures.push(label + (detail ? ` — ${detail}` : ''));
  console.log(`  ${C.r}FAIL${C.x}  ${label}${detail ? `\n        ${C.d}${detail}${C.x}` : ''}`);
  return false;
}
function head(t) { console.log(`\n${C.b}${t}${C.x}`); }
function note(t) { notes.push(t); console.log(`  ${C.d}·     ${t}${C.x}`); }

/* ------------------------------------------------------------ the sandbox - */

function makeElementShim() {
  const el = {
    style: {}, dataset: {}, className: '', textContent: '', children: [],
    setAttribute() {}, removeAttribute() {}, appendChild(c) { this.children.push(c); return c; },
    removeChild() {}, addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, contains() { return false; } },
    click() {}, focus() {}, get offsetWidth() { return 0; }
  };
  return el;
}

function makeDocumentShim() {
  const head = makeElementShim();
  const body = makeElementShim();
  return {
    readyState: 'complete',
    head, body,
    createElement: () => makeElementShim(),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t) }),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}
  };
}

function makeLocalStorageShim() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear()
  };
}

/** A document that screams if anything touches it. Used while loading engines. */
function makeTrapDocument(onTouch) {
  return new Proxy({}, {
    get(_t, prop) {
      if (prop === Symbol.toPrimitive || prop === 'toString' || prop === Symbol.toStringTag) return undefined;
      onTouch(String(prop));
      return undefined;
    },
    set(_t, prop) { onTouch(String(prop)); return true; }
  });
}

const sandbox = {
  console: {
    log: () => {},
    info: () => {},
    warn: (...a) => { note('core warn: ' + a.map(String).join(' ')); },
    error: (...a) => { note('core error: ' + a.map(String).join(' ')); }
  },
  setTimeout, clearTimeout, setInterval, clearInterval,
  Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, isFinite, isNaN, Proxy
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
sandbox.self = sandbox;
sandbox.localStorage = makeLocalStorageShim();
sandbox.document = makeDocumentShim();

vm.createContext(sandbox);

function runFile(rel) {
  const abs = path.join(ROOT, rel);
  const src = fs.readFileSync(abs, 'utf8');
  vm.runInContext(src, sandbox, { filename: rel });
}

/* ================================================================ LOAD ==== */

head('1. Loading core');

const CORE = [
  'js/core/rng.js',
  'js/core/state.js',
  'js/core/profile.js',
  'js/core/registry.js',
  'js/core/director.js',
  'js/core/save.js',
  'js/core/ui.js',
  'js/core/arena.js',
  'js/core/crossroad.js',
  'js/core/engine.js',
  'js/main.js'
];

let coreLoadError = null;
try {
  for (const f of CORE) runFile(f);
} catch (e) {
  coreLoadError = e;
}
ok(!coreLoadError, 'core modules load headlessly', coreLoadError && (coreLoadError.stack || coreLoadError.message));
if (coreLoadError) finish();

const PS = sandbox.PuzzleStudio;
ok(!!(PS && PS.rng && PS.state && PS.registry && PS.director && PS.crossroad),
  'PuzzleStudio namespace is complete');

// loader.js is intentionally NOT executed here: in a browser it injects the
// game <script> tags, which has no meaning in Node. We read its manifest as
// data instead, and load the files ourselves.
head('2. Loading engines (with a DOM that throws on contact)');

const manifestSrc = fs.readFileSync(path.join(ROOT, 'js/core/loader.js'), 'utf8');
const manifestMatch = manifestSrc.match(/var MANIFEST = \[([\s\S]*?)\];/);
const MANIFEST = manifestMatch
  ? manifestMatch[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(s => /\.js$/.test(s))
  : [];
ok(MANIFEST.length === 20, `loader manifest lists all 20 engine filenames`, `found ${MANIFEST.length}`);

const gamesDir = path.join(ROOT, 'js/games');
const present = fs.existsSync(gamesDir)
  ? fs.readdirSync(gamesDir).filter(f => f.endsWith('.js')).sort()
  : [];

const orphans = present.filter(f => MANIFEST.indexOf(f) < 0);
ok(orphans.length === 0, 'every js/games file is in the loader manifest',
  orphans.length ? `not in MANIFEST (they will never load in the browser): ${orphans.join(', ')}` : '');

const realDocument = sandbox.document;
const domTouches = [];
sandbox.document = makeTrapDocument(prop => domTouches.push(prop));

const loadErrors = [];
for (const f of present) {
  try { runFile('js/games/' + f); }
  catch (e) { loadErrors.push(`${f}: ${e.message}`); }
}
sandbox.document = realDocument;

ok(loadErrors.length === 0, 'all engine files execute without throwing', loadErrors.join('; '));
ok(domTouches.length === 0, 'no engine touches document at load time',
  domTouches.length ? `document.${[...new Set(domTouches)].join(', document.')}` : '');

const engines = PS.registry.all();
const regProblems = PS.registry.problems();
ok(regProblems.length === 0, 'every engine passed registration validation',
  regProblems.map(p => `${p.id}: ${p.why.join('; ')}`).join(' | '));
ok(engines.length >= 2, 'at least two engines registered', `got ${engines.length}`);
note(`registered: ${engines.map(e => e.id).join(', ')}`);

if (!engines.length) finish();

/* ================================================= 3. CONTRACT CONFORMANCE */

head('3. Engine contract conformance');

let contractBad = [];
for (const e of engines) {
  if (typeof e.build !== 'function') contractBad.push(`${e.id}: no build()`);
  if (typeof e.mount !== 'function') contractBad.push(`${e.id}: no mount()`);
  if (typeof e.unmount !== 'function') contractBad.push(`${e.id}: no unmount()`);
  if (!Array.isArray(e.skins) || e.skins.length !== 3) contractBad.push(`${e.id}: needs exactly 3 skins`);
  if (typeof e.css !== 'string') contractBad.push(`${e.id}: css must be a string`);
  const ids = new Set();
  for (const s of e.skins || []) {
    if (ids.has(s.id)) contractBad.push(`${e.id}: duplicate skin id "${s.id}"`);
    ids.add(s.id);
    if (PS.registry.BIOMES.indexOf(s.biome) < 0) contractBad.push(`${e.id}/${s.id}: bad biome`);
    if (PS.registry.PALETTES.indexOf(s.palette) < 0) contractBad.push(`${e.id}/${s.id}: bad palette`);
  }
}
ok(contractBad.length === 0, 'engines conform to the registration contract', contractBad.join(' | '));

// CSS prefixing: engine styles must be namespaced or they will collide once
// twenty engines have injected their <style> tags into the same document.
// Only SELECTORS are checked — declaration values (colours, decimals) are not.
function selectorsOf(css) {
  const out = [];
  let i = 0, buf = '';
  const skipBlock = () => {                 // consume a balanced { ... }
    let depth = 0;
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') { depth--; if (depth === 0) { i++; return; } }
    }
  };
  const scan = (endAtBrace) => {
    for (; i < css.length;) {
      const ch = css[i];
      if (ch === '{') {
        const prelude = buf.trim(); buf = '';
        if (/^@(keyframes|font-face|counter-style|property)/i.test(prelude)) { skipBlock(); continue; }
        if (/^@(media|supports|layer|container)/i.test(prelude)) { i++; scan(true); continue; }
        out.push(prelude);
        skipBlock();
        continue;
      }
      if (ch === '}') { i++; buf = ''; if (endAtBrace) return; continue; }
      buf += ch; i++;
    }
  };
  scan(false);
  return out;
}

const unprefixed = [];
for (const e of engines) {
  for (const sel of selectorsOf(e.css || '')) {
    // Each comma-separated selector must be anchored by at least one pz-/ps-
    // class or id somewhere in it. Bare modifiers like `.is-open` are fine as
    // long as they hang off a prefixed ancestor (`.pz-x .is-open`); a global
    // selector like `button {}` or `.grid {}` is not.
    for (const one of sel.split(',')) {
      const s = one.trim();
      if (!s) continue;
      if (!/[.#](pz|ps)-/.test(s)) unprefixed.push(`${e.id}: "${s}"`);
    }
  }
}
ok(unprefixed.length === 0, 'every engine CSS selector is anchored by a pz-/ps- class',
  [...new Set(unprefixed)].slice(0, 8).join(', '));

/* ======================================================= 4. THE LONG RUN == */

head(`4. Driving the Director through ${TRANSITIONS} transitions`);

const rng = PS.rng.create(PS.rng.hash(SEED, 'harness'));
const state = PS.state.create({ runSeed: PS.rng.hash(SEED), seedLabel: SEED });
const profile = PS.profile.create();

const engineHits = {};
const skinHits = {};
const outcomeHits = { success: 0, partial: 0, fail: 0 };
const reasonHits = {};
for (const e of engines) {
  engineHits[e.id] = 0;
  for (const s of e.skins) skinHits[e.id + ':' + s.id] = 0;
}

let deadEnds = 0;
let statViolations = [];
let thrown = [];
let buildFailures = [];
let maxConsecutive = 0;
let consecutive = 0;
let lastEngineId = null;
let blackouts = 0;
let crossroadPicks = 0;

let pick;
try {
  pick = PS.director.first(state, profile, rng);
} catch (e) {
  thrown.push('director.first: ' + e.stack);
}

function synthResult(r, tier) {
  const outcome = r.chance(0.55) ? 'success' : (r.chance(0.6) ? 'partial' : 'fail');
  return {
    outcome,
    stats: { health: -r.int(0, 6 + tier), energy: -r.int(2, 12), light: -r.int(0, 14), morale: r.int(-6, 8) },
    gain: r.chance(0.3) ? [r.pick(['rope', 'wire', 'battery', 'ration'])] : [],
    lose: [],
    tags: [],
    signals: { logic: r.int(0, 3), brute: r.int(0, 3), caution: r.int(0, 3), speed: r.int(0, 2), scavenge: r.int(0, 2) },
    choice: r.chance(0.5) ? r.pick(['descend', 'climb', 'force_door', 'pick_lock', 'code', 'sprint']) : null,
    summary: 'Synthesised transition.'
  };
}

for (let i = 0; i < TRANSITIONS; i++) {
  if (!pick || !pick.engine) { deadEnds++; break; }

  const engine = pick.engine;
  const skin = pick.skin;
  engineHits[engine.id] = (engineHits[engine.id] || 0) + 1;
  skinHits[engine.id + ':' + skin.id] = (skinHits[engine.id + ':' + skin.id] || 0) + 1;
  reasonHits[pick.reason] = (reasonHits[pick.reason] || 0) + 1;

  consecutive = engine.id === lastEngineId ? consecutive + 1 : 1;
  if (consecutive > maxConsecutive) maxConsecutive = consecutive;
  lastEngineId = engine.id;

  const tier = state.tier();
  const sceneRng = PS.rng.create(PS.rng.sceneSeed(state.runSeed, engine.id, skin.id, state.depth));

  // --- exercise the engine's real build(), headless ------------------------
  let puzzle = null;
  try {
    puzzle = engine.build(state, sceneRng, tier, skin);
    if (!puzzle || typeof puzzle !== 'object') buildFailures.push(`${engine.id}@T${tier}: build returned ${typeof puzzle}`);
  } catch (e) {
    buildFailures.push(`${engine.id}@T${tier}: ${e.message}`);
  }

  // --- a result: usually the engine's own autoSolve, sometimes synthetic so
  //     the harness also exercises fails and branches autoSolve never emits.
  let result = null;
  if (puzzle && typeof engine.autoSolve === 'function' && sceneRng.chance(0.7)) {
    try { result = engine.autoSolve(puzzle, sceneRng, state, tier, skin); }
    catch (e) { thrown.push(`${engine.id}.autoSolve: ${e.message}`); }
  }
  if (!result) result = synthResult(sceneRng, tier);
  outcomeHits[result.outcome] = (outcomeHits[result.outcome] || 0) + 1;

  // --- apply -------------------------------------------------------------
  let report;
  try {
    report = state.applyResult(result, {
      engineId: engine.id, engineName: engine.name, skinId: skin.id,
      title: skin.title, icon: skin.icon, biome: skin.biome
    });
    profile.absorb(result.signals);
    if (report.blackout) blackouts++;
  } catch (e) {
    thrown.push(`state.applyResult @${i}: ${e.stack}`);
    break;
  }

  // --- stat invariants ---------------------------------------------------
  for (const k of PS.state.STAT_KEYS) {
    const v = state.stats[k];
    if (!(typeof v === 'number' && isFinite(v) && v >= 0 && v <= 100)) {
      statViolations.push(`transition ${i}: ${k}=${v} after ${engine.id}`);
    }
  }
  if (state.stats.health <= 0) statViolations.push(`transition ${i}: health hit 0 without a blackout reset`);

  // --- crossroad ---------------------------------------------------------
  try {
    const crRng = PS.rng.create(PS.rng.hash(state.runSeed, 'crossroad', state.depth));
    const opt = PS.crossroad.autoPick(state, crRng);
    if (opt) {
      crossroadPicks++;
      state.applyTweak(opt.cost, null, null, opt.tag ? [opt.tag] : null);
      state.crossroad = { id: opt.id, biome: opt.biome, provides: opt.provides.slice(), favors: opt.favors || {} };
    }
  } catch (e) {
    thrown.push(`crossroad @${i}: ${e.message}`);
  }

  // --- next --------------------------------------------------------------
  try {
    pick = PS.director.next(state, profile, rng);
  } catch (e) {
    thrown.push(`director.next @${i}: ${e.stack}`);
    pick = null;
  }
}

const totalTransitions = Object.values(engineHits).reduce((a, b) => a + b, 0);

ok(thrown.length === 0, 'nothing threw across the whole run', thrown.slice(0, 4).join(' | '));
ok(buildFailures.length === 0, 'every engine built cleanly at every tier reached',
  [...new Set(buildFailures)].slice(0, 5).join(' | '));
ok(deadEnds === 0, 'the Director never dead-ended', deadEnds ? `${deadEnds} null picks` : '');
ok(totalTransitions === TRANSITIONS, `all ${TRANSITIONS} transitions completed`, `completed ${totalTransitions}`);
ok(statViolations.length === 0, 'stats stayed inside 0..100 the entire run',
  statViolations.slice(0, 4).join(' | '));

const unreachedEngines = engines.filter(e => !engineHits[e.id]).map(e => e.id);
ok(unreachedEngines.length === 0, 'every registered engine was reachable', unreachedEngines.join(', '));

const unreachedSkins = Object.keys(skinHits).filter(k => !skinHits[k]);
ok(unreachedSkins.length === 0, 'every registered skin was reachable', unreachedSkins.join(', '));

const share = Math.max(...Object.values(engineHits)) / Math.max(1, totalTransitions);
const shareCap = engines.length === 1 ? 1.01 : (1 / engines.length) + 0.35;
ok(share <= shareCap, 'no engine monopolised the run',
  `top share ${(share * 100).toFixed(1)}% vs cap ${(shareCap * 100).toFixed(1)}%`);
ok(maxConsecutive <= 4, 'never repeat-locked on a single engine',
  `longest same-engine streak was ${maxConsecutive}`);

note(`outcomes: ${Object.entries(outcomeHits).map(([k, v]) => `${k} ${v}`).join(', ')}`);
note(`blackouts: ${blackouts} · crossroads: ${crossroadPicks} · final depth ${state.depth} · tier T${state.tier()}`);
note(`director reasons: ${Object.entries(reasonHits).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(', ')}`);

/* ------------------------------------------------------- blackout recovery */

// "Failure never ends the run" is a core design promise: at health 0 the
// player blacks out, wakes with their pack gone and some health back, and the
// Director routes them to a triage/allocation scene. Random incidence used to
// exercise this, but once crossroad.autoPick started playing sensibly the bot
// stopped dying altogether — so this drives the path directly rather than
// hoping a long run stumbles into it.
head('5. Blackout recovery (failure never ends the run)');

{
  const bs = PS.state.create({ runSeed: PS.rng.hash('blackout'), seedLabel: 'blackout' });
  const bp = PS.profile.create();
  const brng = PS.rng.create(PS.rng.hash('blackout', 'director'));

  bs.inventory = ['rope', 'battery', 'ration'];
  const opener = PS.director.first(bs, bp, brng);

  let report = null;
  try {
    report = bs.applyResult(
      { outcome: 'fail', stats: { health: -999 }, gain: [], lose: [], tags: [],
        signals: { logic: 0, brute: 1, caution: 0, speed: 0, scavenge: 0 },
        choice: null, summary: 'Driven to zero on purpose.' },
      { engineId: opener.engine.id, engineName: opener.engine.name, skinId: opener.skin.id,
        title: opener.skin.title, icon: opener.skin.icon, biome: opener.skin.biome }
    );
  } catch (e) {
    thrown.push('blackout applyResult: ' + e.message);
  }

  ok(!!(report && report.blackout), 'health reaching 0 triggers a blackout, not a game over');
  ok(bs.stats.health > 0, 'the player wakes with health restored', `health=${bs.stats.health}`);
  ok(bs.inventory.length === 0, 'the pack is lost in the blackout', `still holding ${bs.inventory.join(', ')}`);

  let after = null;
  try { after = PS.director.next(bs, bp, brng); } catch (e) { thrown.push('blackout next: ' + e.message); }
  ok(!!(after && after.engine), 'the Director still has somewhere to send the player');
  if (after) {
    const routed = after.engine.provides.indexOf('triage') >= 0 ||
                   after.engine.provides.indexOf('medical') >= 0 ||
                   after.reason === 'override:blackout';
    ok(routed, 'a blackout routes toward triage/medical care',
      `went to ${after.engine.id} (${after.reason}), provides: ${after.engine.provides.join(', ') || 'nothing'}`);
  }
}

/* -------------------------------------------------- Director hard overrides */

// The override paths are the game's signature transitions, but in a random run
// they fire only a handful of times each (forced-door 5, picked-lock 3 per
// 1000 in a recent run) and NOTHING asserted on them — the reason counts were
// printed and never checked. Coverage that depends on random incidence can
// evaporate from an unrelated change without a single test going red, which is
// exactly how the blackout path silently lost coverage when the crossroad
// player model was fixed. So each override is now driven deliberately.
head('6. Director hard overrides');

{
  function stateWithLast(seedLabel, scene, result, tweak) {
    const st = PS.state.create({ runSeed: PS.rng.hash(seedLabel), seedLabel: seedLabel });
    st.applyResult(result, scene);
    if (tweak) tweak(st);
    return st;
  }

  const baseResult = (over) => Object.assign({
    outcome: 'success', stats: {}, gain: [], lose: [], tags: [],
    signals: { logic: 1, brute: 0, caution: 1, speed: 0, scavenge: 0 },
    choice: null, summary: 'Set up for an override test.'
  }, over || {});

  const scene = (engineId, biome) => ({
    engineId: engineId, engineName: engineId, skinId: 'x',
    title: 'x', icon: '?', biome: biome
  });

  function overrideReason(st) {
    const p = PS.director.next(st, PS.profile.create(), PS.rng.create(PS.rng.hash('ovr')));
    return p ? { reason: p.reason, id: p.engine.id } : null;
  }

  // light < 15 -> something that actually makes light
  {
    const st = stateWithLast('ovr-light', scene('balance_scales', 'wilderness'), baseResult(),
      (s) => { s.stats.light = 4; });
    const got = overrideReason(st);
    ok(got && got.reason === 'override:light-critical',
      'light below 15 forces a light-provider',
      got ? `got ${got.reason} -> ${got.id}` : 'no pick');
    if (got) {
      const e = PS.registry.get(got.id);
      ok(!!e && (e.provides.indexOf('light_source') >= 0 || e.provides.indexOf('fire') >= 0),
        'the light override lands on an engine that provides light',
        `${got.id} provides: ${e ? e.provides.join(', ') : '?'}`);
    }
  }

  // failing in water -> the crossing you should have solved first
  {
    const st = stateWithLast('ovr-water', scene('measuring', 'water'),
      baseResult({ outcome: 'fail' }), (s) => { s.stats.light = 90; });
    const got = overrideReason(st);
    ok(got && got.reason === 'override:water-fail',
      'failing in a water biome forces the crossing',
      got ? `got ${got.reason} -> ${got.id}` : 'no pick');
  }

  // escape_code + force_door -> knapsack
  {
    const st = stateWithLast('ovr-force', scene('escape_code', 'indoor'),
      baseResult({ choice: 'force_door' }), (s) => { s.stats.light = 90; });
    const got = overrideReason(st);
    ok(got && got.reason === 'override:forced-door',
      'forcing the door routes to the salvage you now need',
      got ? `got ${got.reason} -> ${got.id}` : 'no pick');
  }

  // escape_code + pick_lock -> grid_crawl
  {
    const st = stateWithLast('ovr-pick', scene('escape_code', 'indoor'),
      baseResult({ choice: 'pick_lock' }), (s) => { s.stats.light = 90; });
    const got = overrideReason(st);
    ok(got && got.reason === 'override:picked-lock',
      'picking the lock routes to the quiet way out',
      got ? `got ${got.reason} -> ${got.id}` : 'no pick');
  }
}

/* ------------------------------------------------ save / restore round trip */

head('7. Save round-trip');
let restored = null;
try {
  PS.save.save(state, profile);
  restored = PS.save.load();
} catch (e) {
  thrown.push('save: ' + e.message);
}
ok(!!restored, 'a run saves and reloads from the storage shim');
if (restored) {
  ok(restored.state.depth === state.depth && restored.state.seedLabel === state.seedLabel,
    'restored run matches the saved one',
    `depth ${restored.state.depth} vs ${state.depth}`);
}

/* ------------------------------------------------------ file:// guardrails */

head('8. file:// guardrails');

function walk(dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.name === 'node_modules' || f.name.startsWith('.')) continue;
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, out);
    else if (/\.(js|html)$/.test(f.name)) out.push(p);
  }
  return out;
}

const sources = walk(path.join(ROOT, 'js')).concat([path.join(ROOT, 'index.html')]);
const BANNED = [
  { re: /(^|[^\w.$])import\s*[({'"]/m, why: 'ES module import (CORS-blocked on file://)' },
  { re: /(^|[^\w.$])export\s+(default|const|let|var|function|class|\{)/m, why: 'ES module export' },
  { re: /(^|[^\w.$])fetch\s*\(/m, why: 'fetch() (CORS-blocked on file://)' },
  { re: /XMLHttpRequest/m, why: 'XMLHttpRequest (CORS-blocked on file://)' },
  { re: /type\s*=\s*["']module["']/m, why: 'type="module" script tag' },
  { re: /["'(]\s*https?:\/\//m, why: 'external URL (must be fully offline)' }
];

/** Comments explain the rules; they must not trip them. */
function stripComments(src, isHtml) {
  if (isHtml) src = src.replace(/<!--[\s\S]*?-->/g, '');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1');
}

const violations = [];
for (const file of sources) {
  const isHtml = file.endsWith('.html');
  const src = stripComments(fs.readFileSync(file, 'utf8'), isHtml);
  for (const b of BANNED) {
    if (b.re.test(src)) violations.push(`${path.relative(ROOT, file)}: ${b.why}`);
  }
}
ok(violations.length === 0, 'no ES modules, no fetch, no external URLs anywhere', violations.join(' | '));

/* ------------------------------------------------------------- coverage -- */

head('Coverage');
const pad = (s, n) => String(s).padEnd(n);
const padl = (s, n) => String(s).padStart(n);
console.log(`  ${C.d}${pad('ENGINE', 20)}${pad('SKIN', 22)}${padl('HITS', 6)}  ${padl('SHARE', 7)}${C.x}`);
for (const e of engines) {
  const total = engineHits[e.id] || 0;
  console.log(`  ${C.b}${pad(e.id, 20)}${C.x}${pad('', 22)}${padl(total, 6)}  ${padl(((total / Math.max(1, totalTransitions)) * 100).toFixed(1) + '%', 7)}`);
  for (const s of e.skins) {
    const hits = skinHits[e.id + ':' + s.id] || 0;
    const bar = '\u2588'.repeat(Math.min(24, Math.round((hits / Math.max(1, total)) * 24)));
    console.log(`  ${pad('', 20)}${pad(s.id, 22)}${padl(hits, 6)}  ${C.d}${bar}${C.x}`);
  }
}

/* ----------------------------------------------------------------- finish - */

function finish() {
  head('Summary');
  const passed = checks - failures.length;
  if (failures.length) {
    console.log(`  ${C.r}${C.b}FAIL${C.x}  ${passed}/${checks} checks passed\n`);
    failures.forEach(f => console.log(`    ${C.r}\u2716${C.x} ${f}`));
    console.log('');
    process.exit(1);
  }
  console.log(`  ${C.g}${C.b}PASS${C.x}  ${passed}/${checks} checks passed`);
  console.log(`  ${C.d}${engines.length} engine(s), ${engines.length * 3} skin(s), ${totalTransitions} transitions, 0 dead ends.${C.x}\n`);
  process.exit(0);
}

finish();
