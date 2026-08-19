#!/usr/bin/env node
/* ==========================================================================
   tools/review-engines.js — contract enforcement for incoming engines.

     node tools/review-engines.js              # review every engine
     node tools/review-engines.js e07 e08      # review only these files

   The smoke test proves the ROSTER composes. This proves each engine actually
   follows CONTRACT.md, including the things registry.js is too permissive to
   catch: tier clamping, self-injected <style>, leaked timers/listeners,
   dishonest `provides`, cross-batch id and CSS collisions, and the example
   engine from the docs being shipped by mistake.

   Exits non-zero if any engine fails. Warnings do not fail the build.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const only = process.argv.slice(2);

const C = process.stdout.isTTY
  ? { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[90m', b: '\x1b[1m', x: '\x1b[0m' }
  : { g: '', r: '', y: '', d: '', b: '', x: '' };

const errors = [];   // fail the run
const warns = [];    // reported, do not fail
function err(id, msg) { errors.push(`${id}: ${msg}`); }
function warn(id, msg) { warns.push(`${id}: ${msg}`); }

/* ------------------------------------------------------------- sandbox --- */

function makeEl() {
  const el = {
    style: {}, dataset: {}, className: '', textContent: '', value: '', disabled: false,
    children: [], nodeType: 1,
    setAttribute() {}, removeAttribute() {}, getAttribute() { return null; },
    appendChild(c) { this.children.push(c); return c; }, removeChild() {}, insertBefore(c) { return c; },
    addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    click() {}, focus() {}, blur() {}, closest() { return null; },
    getBoundingClientRect() { return { top: 0, left: 0, width: 100, height: 100 }; },
    get offsetWidth() { return 100; }, get offsetHeight() { return 100; },
    get firstChild() { return this.children[0] || null; }
  };
  return el;
}

/** Records everything an engine does to the document, so we can audit it. */
function makeDoc(log) {
  const head = makeEl(), body = makeEl();
  return {
    readyState: 'complete', head, body, documentElement: makeEl(),
    createElement(tag) { log.created.push(String(tag).toLowerCase()); return makeEl(); },
    createTextNode(t) { return { nodeType: 3, textContent: String(t) }; },
    createDocumentFragment() { return makeEl(); },
    getElementById() { return null; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    addEventListener(type) { log.docListeners.push(String(type)); },
    removeEventListener(type) { log.docUnlisteners.push(String(type)); }
  };
}

function loadRoster(files) {
  const log = {
    created: [], docListeners: [], docUnlisteners: [],
    winListeners: [], winUnlisteners: [],
    timers: new Set(), intervals: new Set(), rafs: new Set(),
    clearedTimers: new Set(), clearedIntervals: new Set(), clearedRafs: new Set(),
    loadTimeTouches: []
  };

  const sandbox = {
    console: { log() {}, info() {}, warn(...a) { warn('core', a.map(String).join(' ')); }, error(...a) { warn('core', a.map(String).join(' ')); } },
    Date, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, isFinite, isNaN, Proxy, Set, Map,
    parseInt, parseFloat, encodeURIComponent, decodeURIComponent
  };
  let nextId = 1;
  sandbox.setTimeout = (fn, ms) => { const id = nextId++; log.timers.add(id); return id; };
  sandbox.clearTimeout = (id) => { log.clearedTimers.add(id); };
  sandbox.setInterval = (fn, ms) => { const id = nextId++; log.intervals.add(id); return id; };
  sandbox.clearInterval = (id) => { log.clearedIntervals.add(id); };
  sandbox.requestAnimationFrame = (fn) => { const id = nextId++; log.rafs.add(id); return id; };
  sandbox.cancelAnimationFrame = (id) => { log.clearedRafs.add(id); };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  sandbox.addEventListener = (type) => { log.winListeners.push(String(type)); };
  sandbox.removeEventListener = (type) => { log.winUnlisteners.push(String(type)); };
  sandbox.performance = { now: () => Date.now() };
  sandbox.document = makeDoc(log);

  vm.createContext(sandbox);

  for (const f of ['js/core/rng.js', 'js/core/state.js', 'js/core/profile.js', 'js/core/registry.js',
                   'js/core/director.js', 'js/core/save.js', 'js/core/ui.js', 'js/core/crossroad.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  }

  // Engines load under a document that records every single access. Any contact
  // at load time is a contract violation.
  const realDoc = sandbox.document;
  sandbox.document = new Proxy({}, {
    get(_t, p) { if (typeof p === 'string') log.loadTimeTouches.push(p); return undefined; },
    set(_t, p) { if (typeof p === 'string') log.loadTimeTouches.push(p); return true; }
  });

  const perFile = {};
  for (const f of files) {
    const before = sandbox.PuzzleStudio.registry.all().map(e => e.id);
    const touchesBefore = log.loadTimeTouches.length;
    try {
      vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8'), sandbox, { filename: f });
    } catch (e) {
      err(f, `threw at load: ${e.message}`);
    }
    const after = sandbox.PuzzleStudio.registry.all().map(e => e.id);
    perFile[f] = {
      registered: after.filter(id => !before.includes(id)),
      loadTouches: log.loadTimeTouches.slice(touchesBefore)
    };
  }
  sandbox.document = realDoc;

  return { PS: sandbox.PuzzleStudio, log, perFile, sandbox, realDoc };
}

/* ------------------------------------------------------- static analysis - */

function staticChecks(file, src) {
  const id = file;
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'\\])\/\/[^\n]*/g, '$1');

  if (/(^|[^\w.$])import\s*[({'"]/m.test(stripped)) err(id, 'uses ES module import');
  if (/(^|[^\w.$])export\s+(default|const|let|var|function|class|\{)/m.test(stripped)) err(id, 'uses ES module export');
  if (/(^|[^\w.$])fetch\s*\(/m.test(stripped)) err(id, 'uses fetch() — CORS-blocked on file://');
  if (/XMLHttpRequest/m.test(stripped)) err(id, 'uses XMLHttpRequest — CORS-blocked on file://');
  if (/["'(]\s*https?:\/\//m.test(stripped)) err(id, 'references an external URL');

  // Self-injected styles: registry.ensureCss() owns this.
  if (/createElement\s*\(\s*['"]style['"]\s*\)/i.test(stripped)) err(id, "creates its own <style> — registry.ensureCss() already injects the css: string");
  if (/\.innerHTML\s*=/.test(stripped)) warn(id, 'assigns innerHTML (prefer textContent / PS.ui.h)');
  if (/Math\.random\s*\(/.test(stripped)) err(id, 'uses Math.random() — must seed everything from rng so runs replay');

  // Tier clamping, per CONTRACT.md §7. Accept any Math.min() that bounds tier,
  // including the Math.min(N, Math.max(1, tier)) idiom and TIERS.length lookups.
  const build = stripped.match(/function build\s*\([^)]*\)\s*\{([\s\S]*?)\n  \}/);
  const buildBody = build ? build[1] : stripped;
  const clamps = /Math\.min\s*\([^)]*\btier\b[^)]*\)|Math\.min\s*\([^,]+,\s*Math\.max\s*\([^)]*\btier\b/.test(buildBody)
    || /\btier\b[^;\n]*\bTIERS\s*\[/.test(buildBody)
    || /Math\.min\s*\([\s\S]{0,80}?\btier\b/.test(buildBody);
  if (!clamps) {
    warn(id, 'build() may not clamp tier (expected Math.min(N, tier)) — deep runs get absurd');
  }

  // Teardown discipline.
  const addsDoc = (stripped.match(/document\.addEventListener/g) || []).length;
  const remsDoc = (stripped.match(/document\.removeEventListener/g) || []).length;
  if (addsDoc > remsDoc) err(id, `${addsDoc} document.addEventListener vs ${remsDoc} removeEventListener — leaks into later scenes`);

  const addsWin = (stripped.match(/window\.addEventListener/g) || []).length;
  const remsWin = (stripped.match(/window\.removeEventListener/g) || []).length;
  if (addsWin > remsWin) err(id, `${addsWin} window.addEventListener vs ${remsWin} removeEventListener — leaks into later scenes`);

  const setsInterval = (stripped.match(/setInterval\s*\(/g) || []).length;
  const clearsInterval = (stripped.match(/clearInterval\s*\(/g) || []).length;
  if (setsInterval > clearsInterval) err(id, `${setsInterval} setInterval vs ${clearsInterval} clearInterval — a live timer will corrupt later scenes`);

  const rafs = (stripped.match(/requestAnimationFrame\s*\(/g) || []).length;
  const cancels = (stripped.match(/cancelAnimationFrame\s*\(/g) || []).length;
  if (rafs > 0 && cancels === 0) err(id, `${rafs} requestAnimationFrame and no cancelAnimationFrame — the loop keeps running after unmount`);

  if (rafs > 0 || setsInterval > 0) {
    if (!/function unmount|unmount\s*[:=]\s*function/.test(stripped)) err(id, 'is real-time but defines no unmount()');
  }
  return { rafs, setsInterval, addsDoc, addsWin };
}

/* ------------------------------------------------------- CSS extraction -- */

function selectorsOf(css) {
  const out = [];
  let i = 0, buf = '';
  const skipBlock = () => {
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
        out.push(prelude); skipBlock(); continue;
      }
      if (ch === '}') { i++; buf = ''; if (endAtBrace) return; continue; }
      buf += ch; i++;
    }
  };
  scan(false);
  return out;
}

function ownClassesOf(css) {
  const own = new Set();
  for (const sel of selectorsOf(css)) {
    for (const cls of sel.match(/\.[A-Za-z_][A-Za-z0-9_-]*/g) || []) {
      if (/^\.(pz|ps)-/.test(cls)) own.add(cls);
    }
  }
  return own;
}

function keyframesOf(css) {
  const out = new Set();
  for (const m of css.matchAll(/@keyframes\s+([A-Za-z_][A-Za-z0-9_-]*)/g)) out.add(m[1]);
  return out;
}

/* ============================================================== RUN ====== */

const allFiles = fs.readdirSync(path.join(ROOT, 'js/games')).filter(f => f.endsWith('.js')).sort();
const files = only.length ? allFiles.filter(f => only.some(o => f.startsWith(o))) : allFiles;

if (!files.length) { console.log('no engine files matched'); process.exit(0); }

console.log(`${C.b}Reviewing ${files.length} engine file(s) against CONTRACT.md${C.x}\n`);

const staticInfo = {};
for (const f of files) staticInfo[f] = staticChecks(f, fs.readFileSync(path.join(ROOT, 'js/games', f), 'utf8'));

const { PS, log, perFile } = loadRoster(files);

// Shared CSS namespace: base.css owns these, an engine redefining them is a collision.
const baseCss = fs.readFileSync(path.join(ROOT, 'css/base.css'), 'utf8') + fs.readFileSync(path.join(ROOT, 'css/skins.css'), 'utf8');
const baseClasses = ownClassesOf(baseCss);
const baseKeyframes = keyframesOf(baseCss);

const seenClass = new Map();      // class -> engine id
const seenKeyframe = new Map();
const seenId = new Map();

for (const f of files) {
  const reg = perFile[f].registered;

  if (perFile[f].loadTouches.length) {
    err(f, `touches document at load time: document.${[...new Set(perFile[f].loadTouches)].join(', document.')}`);
  }
  if (!reg.length) { err(f, 'registered nothing (registry rejected it — see warnings above)'); continue; }
  if (reg.length > 1) warn(f, `registered ${reg.length} engines (${reg.join(', ')}) — one file should be one engine`);

  for (const id of reg) {
    const e = PS.registry.get(id);
    const where = `${f} [${id}]`;

    if (id === 'example_scales') err(where, 'this is the EXAMPLE engine from CONTRACT.md §14 — it must not be shipped');
    if (seenId.has(id)) err(where, `duplicate engine id, already registered by ${seenId.get(id)}`);
    seenId.set(id, f);

    const expected = f.replace(/^e\d\d_/, '').replace(/\.js$/, '');
    if (id !== expected) warn(where, `id "${id}" does not match filename stem "${expected}"`);

    // ---- skins -----------------------------------------------------------
    if (!Array.isArray(e.skins) || e.skins.length !== 3) err(where, `has ${e.skins ? e.skins.length : 0} skins, needs exactly 3`);
    else {
      const sids = new Set(), biomes = [];
      for (const s of e.skins) {
        if (sids.has(s.id)) err(where, `duplicate skin id "${s.id}"`);
        sids.add(s.id);
        if (PS.registry.BIOMES.indexOf(s.biome) < 0) err(where, `skin "${s.id}" has illegal biome "${s.biome}"`);
        if (PS.registry.PALETTES.indexOf(s.palette) < 0) err(where, `skin "${s.id}" has illegal palette "${s.palette}"`);
        if (!s.intro) warn(where, `skin "${s.id}" has no intro line`);
        biomes.push(s.biome);
      }
      if (new Set(biomes).size === 1) warn(where, `all 3 skins share the biome "${biomes[0]}" — the Director's ring can't vary it`);
    }

    // ---- css -------------------------------------------------------------
    if (typeof e.css !== 'string') err(where, 'css must be a string');
    else if (e.css.trim()) {
      for (const sel of selectorsOf(e.css)) {
        for (const one of sel.split(',')) {
          const s = one.trim();
          if (s && !/[.#](pz|ps)-/.test(s)) err(where, `CSS selector not anchored by a pz-/ps- class: "${s}"`);
        }
      }
      for (const cls of ownClassesOf(e.css)) {
        if (baseClasses.has(cls)) {
          // Reusing a base class as a *scoping ancestor* is fine; redefining it is not.
          const redefines = selectorsOf(e.css).some(sel => sel.split(',').some(p => p.trim() === cls));
          if (redefines) err(where, `redefines shared base.css class ${cls}`);
        }
        if (seenClass.has(cls) && seenClass.get(cls) !== id) err(where, `CSS class ${cls} collides with engine "${seenClass.get(cls)}"`);
        seenClass.set(cls, id);
      }
      for (const kf of keyframesOf(e.css)) {
        if (baseKeyframes.has(kf)) err(where, `@keyframes ${kf} collides with base.css`);
        if (seenKeyframe.has(kf) && seenKeyframe.get(kf) !== id) err(where, `@keyframes ${kf} collides with engine "${seenKeyframe.get(kf)}"`);
        seenKeyframe.set(kf, id);
      }
    }

    // ---- build() across the whole tier range -----------------------------
    const state = PS.state.create({ runSeed: 1234, seedLabel: 'REVIEW' });
    let builtOk = 0;
    for (let tier = 1; tier <= 12; tier++) {
      for (const skin of e.skins || []) {
        const rng = PS.rng.create(PS.rng.sceneSeed(1234, id, skin.id, tier * 6));
        let puzzle;
        try { puzzle = e.build(state, rng, tier, skin); }
        catch (ex) { err(where, `build() threw at T${tier}/${skin.id}: ${ex.message}`); continue; }
        if (!puzzle || typeof puzzle !== 'object') { err(where, `build() returned ${typeof puzzle} at T${tier}/${skin.id}`); continue; }
        builtOk++;

        if (typeof e.autoSolve === 'function') {
          try {
            const r = e.autoSolve(puzzle, rng, state, tier, skin);
            if (!r) err(where, `autoSolve returned nothing at T${tier}`);
            else {
              if (!['success', 'partial', 'fail'].includes(r.outcome)) err(where, `autoSolve bad outcome "${r.outcome}"`);
              if (r.stats) for (const k of Object.keys(r.stats)) {
                if (!PS.state.STAT_KEYS.includes(k)) err(where, `autoSolve reports unknown stat "${k}"`);
                if (Math.abs(Number(r.stats[k])) > 100) warn(where, `autoSolve stat ${k}=${r.stats[k]} is beyond the 0..100 scale`);
              }
              if (r.signals) for (const k of Object.keys(r.signals)) {
                if (!PS.profile.SIGNALS.includes(k)) err(where, `autoSolve reports unknown signal "${k}"`);
              }
            }
          } catch (ex) { err(where, `autoSolve threw at T${tier}: ${ex.message}`); }
        }
        if (typeof e.hint === 'function') {
          try { e.hint(puzzle, state, skin); }
          catch (ex) { err(where, `hint() threw at T${tier}: ${ex.message}`); }
        }
      }
    }
    if (!builtOk) err(where, 'build() never succeeded');

    if (typeof e.autoSolve !== 'function') warn(where, 'no autoSolve() — the bot will forfeit and the smoke test loses coverage');
    if (typeof e.hint !== 'function') warn(where, 'no hint() — the HUD hint button is dead for this scene');

    // ---- declared metadata sanity ---------------------------------------
    for (const k of Object.keys(e.favors || {})) {
      if (!PS.profile.SIGNALS.includes(k)) err(where, `favors has unknown signal "${k}"`);
    }
    if (!Object.keys(e.favors || {}).length) warn(where, 'declares no favors — the Director cannot match it to a playstyle');
    if (!(e.provides || []).length) warn(where, 'declares no provides — it can never relieve a need');
  }
}

/* ---------------------------------- Director expectations (cross-batch) --- */

const DIRECTOR_EXPECTS = [
  { id: 'knapsack', why: 'escape_code + force_door override routes here', provides: 'load_out' },
  { id: 'grid_crawl', why: 'escape_code + pick_lock override routes here', provides: 'map' },
  { id: 'constraint_crossing', why: 'fail-in-water override routes here', provides: 'crossing' },
  { id: 'allocation_triage', why: 'blackout override routes here', provides: 'triage' }
];

console.log(`${C.b}Director override targets${C.x}`);
for (const t of DIRECTOR_EXPECTS) {
  const e = PS.registry.get(t.id);
  if (!e) { console.log(`  ${C.d}—     ${t.id} not registered yet (override degrades to scoring)${C.x}`); continue; }
  const has = (e.provides || []).includes(t.provides);
  console.log(`  ${has ? C.g + 'ok' + C.x : C.r + 'BAD' + C.x}    ${t.id} provides '${t.provides}' — ${t.why}`);
  if (!has) err(t.id, `must declare provides:['${t.provides}'] — ${t.why}`);
}

const lightGivers = PS.registry.providing('light_source').map(e => e.id);
console.log(`  ${lightGivers.length ? C.g + 'ok' + C.x : C.r + 'BAD' + C.x}    light_source providers: ${lightGivers.join(', ') || 'NONE'}`);
if (!lightGivers.length) errors.push("no engine provides 'light_source' — the light<15 override has no target");

/* --------------------------------------------------------------- report -- */

console.log('');
if (warns.length) {
  console.log(`${C.y}${C.b}${warns.length} warning(s)${C.x}`);
  for (const w of warns) console.log(`  ${C.y}!${C.x} ${w}`);
  console.log('');
}
if (errors.length) {
  console.log(`${C.r}${C.b}FAIL — ${errors.length} contract violation(s)${C.x}`);
  for (const e of errors) console.log(`  ${C.r}\u2716${C.x} ${e}`);
  console.log('');
  process.exit(1);
}
console.log(`${C.g}${C.b}PASS${C.x}  ${files.length} file(s), ${seenId.size} engine(s), ${seenId.size * 3} skin(s) — all conform to CONTRACT.md\n`);
process.exit(0);
