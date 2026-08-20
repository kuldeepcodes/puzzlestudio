# CONTRACT.md — how to write a PuzzleStudio engine

**This is the authoritative spec.** If this document and any other file disagree,
this document is wrong and `js/core/registry.js` is right — but tell someone, because
they are supposed to agree.

You are adding one of twenty puzzle engines to **PuzzleStudio — "The Long Way Out"**,
an endless branching survival game. Five sessions are writing engines at the same time.
The whole architecture exists so that you can do that **without ever editing a file
somebody else is editing**.

---

## 0. The one rule that makes this work

> **Your engine is exactly ONE new file: `js/games/eNN_your_engine.js`.**
> You create it. You do not touch anything else. Not `index.html`, not the CSS,
> not the core, not another engine, not `js/core/loader.js`.

`js/core/loader.js` **already** hardcodes all twenty filenames and injects a
`<script>` tag for each one, tolerating `onerror` silently. Your file does not exist
yet, so today it is skipped. The moment you commit it, it loads. That is the entire
integration step.

If you find yourself wanting to edit a shared file, you have misunderstood something —
re-read this document or ask, but do not edit it.

---

## 1. Non-negotiable environment constraints

The game must play when a person **double-clicks `index.html` from their filesystem**.
No server, no build, no npm, no bundler. That imposes hard rules:

| Rule | Why |
|---|---|
| **No `import` / `export`.** Classic scripts and the `PuzzleStudio` global only. | ES modules are CORS-blocked on `file://`. The page would simply not run. |
| **No `fetch()`, no `XMLHttpRequest`.** | Also CORS-blocked on `file://`. Dynamically injected `<script src=...>` *is* allowed and is what the loader uses. |
| **No external dependencies.** No CDN, no web fonts, no libraries, no analytics, no URLs. | The game is fully offline. |
| **DOM + CSS + emoji only.** No image files. `<canvas>` **only** inside the arena layer (see §8b). | Zero assets to ship or fail to load. |
| **Target current Chrome/Edge.** | ES5-flavoured JS is safest and is what the core uses. |

`tools/smoke-test.js` greps for every one of these and fails the build.

---

## 2. File skeleton

Create `js/games/eNN_your_engine.js`. Use exactly the filename assigned to you from the
frozen manifest in `js/core/loader.js`:

```
e01_escape_code.js        e02_grid_crawl.js         e03_knapsack.js
e04_constraint_crossing.js e05_circuit_rotation.js  e06_cipher_decode.js
e07_balance_scales.js     e08_logic_grid.js         e09_dependency_order.js
e10_allocation_triage.js  e11_barter_graph.js       e12_timing_bar.js
e13_adjacency_deduction.js e14_priority_sort.js     e15_measuring.js
e16_polyomino_packing.js  e17_triangulation.js      e18_sliding_block.js
e19_patrol_routing.js     e20_numeric_constraint.js
```

The file is one IIFE. Nothing leaks to the global scope except the registration:

```js
(function (root) {
  'use strict';
  var PS = root.PuzzleStudio;
  if (!PS || !PS.registry) { if (root.console) console.error('[eNN] core not loaded'); return; }

  // ... build / mount / unmount / css / skins ...

  PS.registry.register({ /* see below */ });

})(typeof window !== 'undefined' ? window : this);
```

That `typeof window !== 'undefined' ? window : this` tail is not decoration — the Node
smoke test runs your file in a `vm` sandbox where `window` is the sandbox global.

---

## 3. The registration contract

This is the complete shape. Everything not marked **required** has a default.

```js
PS.registry.register({
  // ---- identity -----------------------------------------------------------
  id:       'grid_crawl',        // REQUIRED. unique, snake_case, stable forever.
  name:     'Grid Crawl',        // default: prettified id
  icon:     '\uD83D\uDD6F\uFE0F',// default: skins[0].icon
  blurb:    'Cross a dark maze on a light budget.',   // default: ''

  // ---- how the Director reasons about you ---------------------------------
  favors:   { caution: 2, logic: 1 },   // playstyles this engine rewards. default {}
  provides: ['light_source', 'map'],    // needs you can satisfy.        default []
  tagHooks: ['has_lamp'],               // player tags that attract you.  default []
  requires: function (state) {          // hard gate. default: always true
    return state.stats.energy > 10;
  },

  // ---- presentation -------------------------------------------------------
  css: '.pz-crawl-cell{...}',           // your styles, as a string. default ''
  skins: [ /* REQUIRED: exactly 3, see §5 */ ],

  // ---- lifecycle ----------------------------------------------------------
  build:   function (state, rng, tier, skin) { return puzzleInstance; },  // REQUIRED
  mount:   function (el, state, api, puzzle, skin) { /* render + wire */ }, // REQUIRED
  unmount: function () { /* remove listeners and timers */ },  // default: no-op

  // ---- optional extras ----------------------------------------------------
  hint:      function (puzzle, state, skin) { return 'a sentence'; },
  autoSolve: function (puzzle, rng, state, tier, skin) { return resultObject; }
});
```

### What `registry.js` actually validates

Registration **fails with a `console.warn` and your engine is silently dropped** if:

- `id` is missing or not a string
- `id` is already registered (duplicate)
- `build` is not a function
- `mount` is not a function
- `skins` is not an array of **exactly 3**
- any skin is missing `id`, `title` or `biome`
- any skin's `biome` is not one of the 7 legal biomes
- any skin's `palette` is set but is not one of the 7 legal palettes

It never throws. One broken engine must never take the game down for the other
nineteen. Run the smoke test — it turns those warnings into a hard failure so you
actually notice.

### What `registry.js` normalizes for you

`name`, `icon`, `favors`, `provides`, `tagHooks`, `css`, `blurb`, `requires` and
`unmount` are all filled in with safe defaults, and every skin gets `icon`, `palette`
(`'amber'`), `intro`, `nouns` and a back-reference `engineId`. So the Director never
has to null-check your registration, and you never have to write empty boilerplate.

---

## 4. The result shape — `api.finish(result)`

Calling `api.finish()` is **the only way** your scene ends. Every field is optional
except `outcome`. Extra calls after the first are ignored.

```js
api.finish({
  outcome: 'success',          // 'success' | 'partial' | 'fail'   REQUIRED

  stats:   { health: -10, energy: -15, light: -30, morale: +5 },
                               // DELTAS, not absolutes. All four optional.
                               // Core clamps the result into 0..100 for you.

  gain:    ['rope', 'flare'],  // item ids added to the pack
  lose:    ['battery'],        // item ids removed (silently ignored if absent)

  tags:    ['escaped_quietly'],// sticky flags other engines' tagHooks can key off

  signals: { logic: 2, brute: 0, caution: 1, speed: 0, scavenge: 1 },
                               // HOW it was solved. 0..5 each, clamped.
                               // This is what builds the playstyle profile.

  choice:  'descend',          // the explicit branch the player picked, or null

  summary: 'You slipped out before the guard came back.'
                               // one sentence, shown at the crossroad and in the log
});
```

### `outcome`

`'fail'` **never ends the run.** There is no Game Over screen. A lost puzzle costs
stats and items and reroutes the player down a harsher branch. Write failure as a
setback with texture, not a punishment.

### `signals` — the five playstyles

| signal | means | profile badge |
|---|---|---|
| `logic` | deduced it, planned it, solved before touching | Logician 🧩 |
| `brute` | forced it, broke it, went straight through | Brute 💪 |
| `caution` | quiet, careful, no trace, no risk taken | Cautious 🕵️ |
| `speed` | did it fast, efficiently, minimal moves | Speedrunner 💨 |
| `scavenge` | stripped the room, took the detour for loot | Scavenger 🎒 |

Report signals **honestly and proportionally** to what the player actually did. The
Director reads the accumulated profile to pick what comes next, so a lying engine
makes the whole game worse. Zero is a fine value.

### `choice`

The single most important field for branching. It should name the *decision*, not the
outcome — `'force_door'`, `'pick_lock'`, `'descend'`, `'climb'`, `'trade'`. Use `null`
if the player genuinely made no branching decision.

`js/core/director.js` has a `CHOICE_HINTS` table of well-known choice ids that map to a
destination biome and a set of `provides` tokens. Reusing an existing id gives you
sensible routing for free; a new id is not an error, it just contributes nothing.

### `tags`

Lowercase snake_case, sticky for the rest of the run. Some are derived automatically
from the inventory and you should **not** set them yourself: `has_lamp`, `has_medkit`,
`has_ally`, `has_tools`, `has_map`, `has_rations`.

---

## 5. Skins — exactly three, always

A skin is the same puzzle wearing a different disaster. Three per engine, each in a
**different biome** where you can manage it, because the Director picks skins by biome
adjacency and three skins in one biome makes your engine feel repetitive.

```js
{
  id:      'dark_tunnel',        // REQUIRED, unique within your engine
  biome:   'underground',        // REQUIRED, one of the 7 below
  title:   'The Dark Tunnel',    // REQUIRED, shown in the header and run log
  icon:    '\uD83D\uDD6F\uFE0F', // emoji
  palette: 'amber',              // one of the 7 below
  intro:   'The hatch clangs shut above you...',   // 1-2 sentences, sets the scene
  nouns:   { resource: 'torch fuel', exit: 'the shaft', hazard: 'flooded cut' }
}
```

### The 7 biomes

`indoor` · `underground` · `water` · `industrial` · `urban` · `wilderness` · `shelter`

They form a ring the Director walks around:

```
indoor → underground → water → industrial → urban → wilderness → shelter → indoor
```

Adjacent biomes are heavily weighted, two steps is medium, opposite is low but
**never zero**. Pick biomes that make the transitions feel like a journey.

### The 7 palettes (`css/skins.css`)

| palette | mood |
|---|---|
| `amber` | lamplight, warning lights, warmth in the dark |
| `moss` | overgrowth, wilderness, damp green quiet |
| `steel` | offices, machinery, cold fluorescent competence |
| `ice` | water, snow, glass, held breath |
| `rust` | industrial decay, blood, heat, alarm |
| `ash` | smoke, concrete, urban night, neutral dread |
| `bone` | paper, dust, bunkers, sterile safety |

**Do not add a palette.** `css/skins.css` is a shared file. Pick the closest of the seven.

### `nouns`

Free-form vocabulary your `mount()` can pull from so the same code reads as three
different scenarios. There is no fixed schema; use the keys your engine needs.

---

## 6. `provides`, `favors`, `tagHooks` — choosing them well

### `provides`
What *need* your engine can relieve. The Director raises your score sharply when the
matching stat is low, and some hard overrides look for these exact tokens.

**Only the tokens below do anything.** A token that is not in this table is accepted and
stored, but nothing reads it — it is a comment, not behaviour. Prefer a recognised token,
or add a recognised sibling alongside your descriptive one.

| token | effect |
|---|---|
| `light_source` | relieves **light** — and is the hard override target when light < 15 |
| `fire`, `power` | relieve **light** |
| `medical`, `triage` | relieve **health** — `triage` is the blackout override target |
| `shelter`, `rest` | relieve **health** and **energy** |
| `food` | relieves **energy** |
| `ally`, `comfort`, `information`, `intel`, `trade` | relieve **morale**; `ally`/`trade`/`triage` also get a large boost for as long as the player has an ally |
| `load_out` | routing — target of the `escape_code` + `force_door` override |
| `map` | routing — target of the `escape_code` + `pick_lock` override |
| `crossing` | routing — target of the fail-in-a-water-biome override |
| `salvage`, `vantage` | routing only — referenced by `CHOICE_HINTS` |

**Currently inert**, though several shipped engines declare them: `supplies`, `passage`,
`access`, `contact`. They read well and cost nothing, but they will not route the player
to you. If your engine hands back food or rations, say `food` as well as `supplies`; if it
opens a way through, say `crossing` as well as `passage`.

Claim only what your engine genuinely hands back. An engine that lists
`provides: ['light_source']` but never puts light in `stats` will be summoned every
time the player is in the dark and will never help them.

### `favors`
Which playstyles your engine *rewards*, using the same five keys as `signals`, weighted
roughly 1–3. A player whose profile matches gets sent to you more often. Two or three
keys is plenty.

### `tagHooks`
Tags that should pull the player toward you. `tagHooks: ['has_lamp']` means "this
encounter is more interesting if they have a light". Each matching tag is worth about
+1.6 score. Keep it to one or two.

### `requires(state)`
A **hard gate**, not a preference. Return `false` and you are removed from the candidate
pool entirely. Use it only for things that would make your puzzle nonsense
(`state.stats.energy > 10`), never for flavour — that is what scoring is for.

Note the safety net: if `requires` filters out *every* engine, the Director drops the
gate rather than dead-end. Never rely on that.

---

## 7. `build(state, rng, tier, skin)` — the puzzle instance

Returns a plain data object. Called **headlessly** — by the smoke test, at every tier,
a thousand times. So:

- **No DOM.** `build()` must not touch `document`.
- **All randomness from `rng`.** Never `Math.random()`. The run seed must reproduce the run.
- **Never throw.** If a generation step can fail, guard it and fall back to something
  simple but solvable. Look at `e02`'s "pathological seed" branch for the pattern.
- **Always solvable.** Verify it in `build()` if you can (`e02` BFSes its own maze and
  carves a corridor if there is no path).

### Seeding

The core hands you an `rng` already seeded with
`hash(runSeed, engineId, skinId, depth)` — so the same engine at a different depth is a
genuinely different puzzle, and the same seed replays exactly. Available helpers:

```js
rng.int(a, b)          // inclusive integer
rng.range(a, b)        // float
rng.chance(p)          // boolean, p in 0..1
rng.pick(arr)          // one element
rng.shuffle(arr)       // NEW array, never mutates
rng.sample(arr, n)     // n distinct elements
rng.weighted(arr, fn)  // weighted pick, fn(item, i) -> number
rng.jitter(amount)     // symmetric noise
rng.fork(label)        // an independent child rng
```

### Scaling by `tier`

`tier = 1 + floor(depth / 6)`, **plateauing at T12** (`state.tier()`), so an infinite
run stays playable. Scale three things, and clamp anything that scales a **cost** or a
**size**:

```js
function build(state, rng, tier, skin) {
  // The run is infinite; your difficulty curve must not be.
  var t = Math.min(6, tier);

  var gridSize   = Math.min(13, 7 + (t - 1) * 2);   // bigger board
  var clueCount  = 4 + Math.floor(t / 2);           // more to reason about
  var searchCost = 3 + t;                           // tighter budget
  ...
}
```

Both reference engines do exactly this. Copy it.

---

## 8. `mount(el, state, api, puzzle, skin)` — the only place DOM exists

```js
function mount(el, state, api, puzzle, skin) {
  var h = PS.ui.h;                       // or api.h
  el.appendChild(h('div', { class: 'pz-yours' }, [ /* ... */ ]));
}
```

- `el` is a fresh, empty container inside the stage. It is yours. Build whatever you like.
- The skin's `intro` is rendered **above** `el` by the core — do not repeat it.
- `PS.ui.h(tag, attrs, children)` is a tiny element builder. `attrs` supports `class`,
  `text`, `style` (object), `dataset` (object), `onclick`/`on*` handlers, and plain
  attributes. Text always goes through `textContent`, so nothing can inject HTML.
  You are not obliged to use it.

### The `api` object

| member | what it does |
|---|---|
| `api.finish(result)` | end the scene (§4). The only exit. |
| `api.hint()` | wired to the HUD's Hint button; costs morale and toasts your `hint()` string |
| `api.rng` | the same seeded rng `build()` got |
| `api.tier` | the tier for this scene |
| `api.state` | the live run state (read it; mutate only through `api.tweak`) |
| `api.skin` | the active skin |
| `api.tweak(deltas, gain, lose, tags)` | **mid-scene** stat drift — a step that costs light, a fall that costs health. Animates the HUD live. Cannot black the player out. |
| `api.toast(msg, kind)` | transient feedback. `kind`: `'good'`, `'bad'`, `'info'` |
| `api.flash()` | screen flash for a big moment |
| `api.h` | the element builder |

`api.tweak()` during play plus `api.finish()` at the end is the intended rhythm: the HUD
should be visibly moving while the player works, not just jumping at the end.

### `unmount()`

Remove **every** listener you attached to `document` or `window`, and clear every timer
and interval. Anything you attached to `el` dies with `el` and needs no cleanup. Leaks
here are the one bug class that corrupts *other people's* engines, so be strict:

```js
var teardownFns = [];

function mount(el, state, api, puzzle, skin) {
  function onKey(ev) { /* ... */ }
  document.addEventListener('keydown', onKey);
  teardownFns.push(function () { document.removeEventListener('keydown', onKey); });
}

function unmount() {
  while (teardownFns.length) { try { teardownFns.pop()(); } catch (e) {} }
}
```

---

## 8b. `PuzzleStudio.arena` — the free-movement layer

An engine does not have to be a panel you click. `js/core/arena.js` gives you a
top-down explorable map: an avatar with real acceleration and friction that the
player drives with **WASD, arrow keys, hold-to-steer with the mouse, click-to-move
pathfinding, or touch drag**, colliding against a tile grid, lit by a radial mask
whose radius is driven by the run's **`light` stat**.

**Canvas 2D is allowed inside the arena and nowhere else.** This is a deliberate
revision of the DOM-only rule in §1 — smooth 60fps movement with a light mask is
not practical in DOM. Your **HUD, your panels and all of your puzzle UI stay DOM.**
Everything else in §1 still stands: no libraries, no CDN, no image assets, no ES
modules, no `fetch`, no `Math.random`.

### Spatialising an existing engine in ten lines

`arena.station()` is the whole point. Your engine keeps the DOM panel it already
has; that panel now only opens when the player has physically **walked to a console**.

```js
function mount(el, state, api, puzzle, skin) {
  var host = PS.ui.h('div', {});
  PS.ui.append(el, host);

  var a = PS.arena.create(host, {
    map:    { w: 21, h: 15, tiles: puzzle.grid },   // tiles[y][x], 1 = solid
    spawn:  { x: 1, y: 1 },
    light:  state.stats.light,
    avatar: '\uD83E\uDDCD',
    onStep: function (tx, ty) { /* charge the move, drain light, whatever */ }
  });
  teardownFns.push(function () { a.destroy(); });

  a.station({
    x: 6, y: 4, icon: '\uD83D\uDCDF', label: 'Relay console',
    onEnter:  function (panelEl) { renderMyExistingPanel(panelEl); },  // built once
    onSolved: function () { a.setTile(9, 4, false); a.ping(9, 4); }    // door opens
  });
}
```

`onEnter` runs **once**, the first time the player walks into range. Walking away
hides the panel; walking back re-attaches **the exact same DOM nodes**, so any
half-entered code, part-built stack or selected row survives untouched.

### `PS.arena.create(hostEl, opts)` — options

| option | default | meaning |
|---|---|---|
| `map` | — | `[[0,1..]]`, `{w,h,tiles}` or `{w,h,wallAt(x,y)}`. Truthy = solid. |
| `spawn` | first open tile | `{x,y}` in tile coords |
| `light` | `100` | the `light` stat; drives the light mask radius |
| `lightCurve` | built-in | `function (light) -> radius in tiles` |
| `darkness` | `.955` | how black the unlit world goes, `0..1` |
| `memory` | `.26` | how visible already-explored ground stays |
| `tileSize` | auto-fit | px per tile; omit and the arena fits the map |
| `avatar` | `🧍` | emoji drawn as the player |
| `onStep(tx,ty,a)` | — | fires once per **tile** entered (diagonals charge both) |
| `onTick(dt,a)` | — | per frame, seconds |
| `onDetect(patrol,a)` | — | a patrol's vision cone found you |
| `compact` | `false` | a shorter arena for scenes that are mostly panel |

### The instance

```
world      station(spec) prop(spec) patrol(spec)
           setTile(x,y,solid) isSolid(x,y) isSeen(x,y) walkable(x,y)
           reveal(x,y,r) revealAll() path(x,y)
light      setLight(v) light() lightRadius() setDarkness(v) setMemory(v)
avatar     player() teleport(x,y) goTo(x,y) stop() setAvatar(icon)
juice      shake(mag,dur) hit(color) dust(x,y,n,color) ping(x,y,color) retint()
DOM        el canvas hud foot panel panelBody
           chip(label,icon) meter(label,icon) button(label,fn,cls) note(text)
           closePanel()
control    pause(v) isPaused() focus() destroy()
bot        botTargets() botGoTo(idOrXY) botInteract()
```

- **`station(spec)`** → `{ id, x, y, solved, solve(), close(), openNow(), setLabel(), setIcon(), move(), pulse(), remove() }`.
  `spec`: `x y icon label hint radius emits onEnter(panelEl,a,handle) onOpen onExit onSolved`.
- **`prop(spec)`** — anything you walk onto or press **E** at: caches, hazards, doors.
  `spec`: `x y icon label hint trigger:'step'|'press'|'proximity' emits glow tint once botSkip onActivate`.
  Set `botSkip: true` on things the autoplay bot should not deliberately walk into.
- **`patrol(spec)`** — `route:[[x,y]…] speed wait icon vision:{range,fov} onDetect`.
  Vision cones are drawn, line-of-sight checked, and patrols carry their own light.
- **`chip/meter/button/note`** give you the arena's HUD styling for free. Do **not**
  write CSS for `.ps-arena*` — the arena owns its look and two engines redefining
  the same class is a contract violation (`tools/review-engines.js` fails you).

### Lifecycle — this one is not optional

The arena owns one `requestAnimationFrame` loop and listeners on `document` and
`window`. **Call `a.destroy()` from your `unmount()`.** `js/core/engine.js` also
destroys any arena that outlives its scene as a safety net, but relying on the net
is how you leak a keyboard handler into somebody else's puzzle.

### Teaching the bot to play your arena

The `?dev=1` autoplay bot cannot press W. `botGoTo()` walks the real tile path
**instantly**, firing every step event a human walk would, so an arena scene plays
out identically and works with no animation frames at all. The bot already knows
to strip every `prop` and then use the `station`s — you get that for free, and
`autoSolve()` remains your headless fallback.

---

## 9. CSS — self-contained, prefixed, injected for you

Your styles are a **string** on the registration. `registry.ensureCss()` injects them
into a single `<style data-pz-engine="your_id">` tag exactly once, immediately before
your first mount.

- **Do not** create `<style>` tags yourself.
- **Do not** add a shared `css/games.css`. There isn't one and there must not be.
- **Do not** edit `css/base.css` or `css/skins.css`.

### Prefix everything

Every selector must be anchored by a class starting `pz-` or `ps-`, and the convention
is `pz-<short-engine-name>-`:

```css
.pz-crawl-board { ... }              /* good */
.pz-crawl-cell.is-lit { ... }        /* good — bare modifier on a prefixed class */
.pz-crawl-dpad button { ... }        /* good — scoped by a prefixed ancestor */
.board { ... }                       /* FAILS the smoke test */
button { ... }                       /* FAILS the smoke test */
```

Twenty engines inject into one document. An unprefixed selector will break somebody
else's engine and you will not be the one who notices.

### Use the theme tokens

Read the palette instead of hardcoding colour, and your engine retints itself per skin
for free:

```
--acc  --acc-2  --acc-ink  --acc-glow  --acc-wash
--bg --panel --panel-2 --panel-3 --line --line-soft
--text --text-2 --dim --dimmer
--good --warn --bad --info
--r-sm --r --r-lg --font-ui --font-mono --ease --sh-1 --sh-2
```

Reusable classes already in `css/base.css` that you are encouraged to use:
`pz-scene`, `pz-card`, `pz-card__head`, `pz-intro`, `pz-note`, `pz-row`, `pz-col`,
`pz-spread`, `pz-btn` (`--primary`, `--danger`, `--ghost`, `--sm`, `--lg`),
`pz-choices`, `pz-choice` (`__i`, `__t`, `__d`, `__tag`), `pz-gauge`, `pz-mono`.

---

## 10. `hint()` and `autoSolve()` — optional, both worth writing

### `hint(puzzle, state, skin) -> string`

Returns one sentence. The core deducts morale and toasts it. Give a genuine nudge that
respects the current puzzle state — say what to look at, not what the answer is.
If you omit `hint`, the HUD's Hint button is disabled for your scene.

### `autoSolve(puzzle, rng, state, tier, skin) -> result`

**Headless. Must not touch the DOM.** Returns a `finish`-shaped result object as if a
competent player had played it. Two consumers:

- `js/dev/autoplay.js` calls it when the bot runs out of patience on `?dev=1`
- `tools/smoke-test.js` calls it to generate realistic run state across 1000 transitions

Without it the bot forfeits your scene and the smoke test uses a random synthetic
result. Your engine still passes — but you get much better coverage with it. Write it.

---

## 11. The no-DOM-at-load-time rule

> **Your file must not touch `document` while it is being loaded.**
> Only inside `mount()` (and inside handlers `mount()` wired up).

`tools/smoke-test.js` loads every `js/games/*.js` into a `vm` sandbox where `document`
is a `Proxy` that **records every single property access**. Any contact at load time is
a hard test failure naming the property you touched.

This is not pedantry. It is what lets the smoke test call your real `build()` a thousand
times in Node with no browser, which is the only reason we can verify twenty engines
written by six people actually compose.

```js
// WRONG — runs at load time
var css = document.createElement('style');
var box = document.querySelector('#thing');

// RIGHT — runs when the scene mounts
function mount(el, state, api, puzzle, skin) {
  var box = el.querySelector('.pz-yours-thing');
}
```

Same rule for `window`, `localStorage`, timers and event listeners: set nothing up until
`mount()`.

---

## 12. Running the tests

```
node tools/smoke-test.js
```

Plain Node. No `npm install`. No dependencies. It must print **PASS** before you commit.

It checks, in order:

1. the core loads headlessly
2. every `js/games/*.js` is in the loader manifest, executes, and **never touches the DOM at load**
3. every engine passes registration validation and the contract (3 unique skins, legal biomes and palettes, `build`/`mount`/`unmount`, `css` a string)
4. every engine CSS selector is anchored by a `pz-`/`ps-` class
5. the Director survives **1000 transitions**: no dead ends, no repeat-lock, stats stay inside 0..100, every engine and every skin reachable, nothing thrown, every `build()` succeeds at every tier reached
6. a run saves and reloads
7. no ES modules, no `fetch`, no `XMLHttpRequest`, no `type="module"`, no external URLs

Then it prints a coverage table showing how often each engine and each skin was hit.

Useful knobs:

```
PZ_TRANSITIONS=5000 node tools/smoke-test.js     # longer soak
PZ_SEED=whatever    node tools/smoke-test.js     # different run
```

### Playing it

Double-click `index.html`. Add `?dev=1` to the URL to let the bot play the whole chain
so you can watch your engine in context; `?dev=1&speed=3` to hurry it up; `?seed=X` to
deep-link a specific run.

---

## 13. Checklist before you commit

- [ ] Exactly one new file, `js/games/eNN_*.js`, matching your assigned manifest name
- [ ] No other file changed. None. Check `git status`.
- [ ] No `import`, `export`, `fetch`, `XMLHttpRequest`, or external URL
- [ ] Exactly 3 skins, distinct ids, legal biomes, legal palettes, ideally 3 different biomes
- [ ] `build()` is headless, seeded from `rng` only, never throws, always solvable
- [ ] Difficulty scales with `tier` and **clamps**
- [ ] `mount()` is the only place that touches `document`
- [ ] `unmount()` removes every document/window listener and timer
- [ ] Every CSS selector prefixed `pz-<engine>-`
- [ ] `api.finish()` is called on every path, exactly once, with honest `signals`
- [ ] `outcome: 'fail'` is written as a setback, not an ending
- [ ] `autoSolve()` and `hint()` written
- [ ] `node tools/smoke-test.js` prints PASS

### If you add a guard, test it degenerate

Five real bugs on this project came from guards that read as correct and carried
nothing. Every one was written to catch a failure that had *already happened*, so it
was shaped around the case in front of its author — and the intended case is precisely
the one you have in mind while writing, so the boundary is by definition the one you
don't. That asymmetry doesn't go away with care.

So after writing a guard, don't ask whether it catches the failure you meant. Ask what
it does when the thing it measures is **degenerate rather than wrong**:

| the guard | the degenerate case | what actually happened |
|---|---|---|
| a weight of `0.05` on "give up" | a pool with **one** element | weighted choice ignores weight; the bot surrendered every time |
| a `RELIEF` key named `'information'` | a name matching **nothing** | engines declare `'intel'`; the rule could never fire |
| an override branch | a count of **zero** | `picked-lock` ran 3 times per 1000 and nothing asserted on it |
| a solver seeded `safe = {}` | an input set that is **empty** | already-safe cells read as unknown, disabling a deduction rule entirely |
| a liveness assertion | a sample **too small to contain the event** | short runs failed with nothing wrong |
| grepping for a marker string | the file **also talks about** the marker | searching for `"FAULT INJECTION"` matched a *comment* about fault injection and reported broken code that was already fixed |
| a differential harness | **both arms are the same code** | comparing a fixed function against itself reported `0.0% lost`, which reads as a clean result |

**If you write a differential, confirm the control reproduces the bug first.** That last
row is the one with a detector cheap enough to always apply: if your "before" arm does
not show the defect, you do not have a before — you have one arm run twice, and it will
report no difference very convincingly. One assertion catches it, and it generalises to
every A/B, benchmark and regression harness in this repo. It matters more than the
others because it *cannot* fail loudly: a differential with identical arms fails
flatteringly, and flattering results get believed and shipped.

A guard that cannot verify something should say so, not pass quietly and not fail
loudly. The liveness check is the worked example: below its floor it prints what it
did not see and does not assert. **Degrade honestly.**

**Add your row when you find one.** The table is what does the work here, not the
principle above it — "test it degenerate" reads as advice and advice in a checklist
gets ticked without being done, whereas *a pool of one* and *a name matching nothing*
are things you can actually go and check in five minutes. The list is meant to grow.

One caution learned from writing it: the solver row originally carried a specific
figure for how much detection was lost. Three independent measurements of that single
bug produced **83%, 10.5% and 15.6%** — and all three were correctly computed. The
disagreement was never arithmetic. It came from two free parameters that a percentage
hides:

- **The denominator.** "Of all deductions on the board" counts cells nobody would ever
  step on; "of the falls where the answer was genuinely *yes*" is what the classifier
  actually operates on. Only the second matches the question the code asks.
- **The state you sample from.** Walking a route reveals little, so few hazards are
  provable at all; flooding the reachable area reveals almost everything, so most are.
  That single choice moved "how many hazards were provable" from 15% to 78%, which
  dominates the ratio regardless of which denominator you pick.

So: **state the mechanism, which reproduces exactly; be careful quoting a headline
number that might not.** A ratio with the wrong denominator — or the right denominator
over the wrong state distribution — is a proxy that has drifted from its property, in
exactly the way the grep row describes. It just drifts quietly, because it still looks
like a measurement of the thing. That is the same *degrade honestly* rule applied to
documentation rather than to code: the corrected row claims what reproduces and
declines to claim what doesn't.

What does reproduce, across every independent attempt, is the **shape**: the impact
scales with how often the player steps on ground that was not *proven* safe when they
stepped there. Sweeping exactly that parameter and holding everything else fixed gives
a monotonic curve. It is smallest for a disciplined deducer — who barely needs the
classifier — and largest for one who guesses or slides a tile past the intended target,
which is precisely the player the misread/overshoot split exists to judge. **The defect
was concentrated in the population the feature is for, and absent in the one it isn't.**
That is why no single percentage could have been honest without also naming the player
it was measured on.

And the last row is worth reading twice, because it is the general case of the other
five. A marker is a **proxy** for the property you care about, and a proxy drifts from
its property the moment anyone writes about it — the grep asked "does this string appear
in the file", which stopped meaning "is this code broken" as soon as a comment mentioned
it. Checking `destroy()`'s actual first statements cannot drift, because it asks the real
question.

Note also that these failures are not biased toward false alarms. One check here
reported a catastrophe that did not exist; another reported breakage that had already
been fixed. A measurement that isn't asking the question it appears to ask is simply
**uncorrelated** with the truth, and which direction it lands is luck. That is the
argument for fault injection over reasoning about a check: injecting the failure pins
the measurement to the property in both directions at once.

---

## 14. A complete minimal engine, heavily commented

This is a real, working, registerable engine. Copy it and replace the puzzle.

> **It is an illustration, not a deliverable.** Do not commit it as-is — the id
> `example_scales` and the filename below are deliberately not on the manifest, so
> nothing you copy from here can collide with a real engine.

```js
/* ==========================================================================
   PuzzleStudio — js/games/eNN_example.js         EXAMPLE ENGINE (not shipped)
   Self-contained: logic + 3 skins + CSS. Touches no shared file.
   ========================================================================== */
(function (root) {
  'use strict';

  // Grab the namespace. Bail loudly but harmlessly if the core is missing —
  // never throw at load time, it would take the whole game down.
  var PS = root.PuzzleStudio;
  if (!PS || !PS.registry) { if (root.console) console.error('[example] core not loaded'); return; }

  /* ---------------------------------------------------------------- BUILD --
     Headless. No document. All randomness from rng. Never throws.
     Returns a plain data object describing this specific puzzle instance. */
  function build(state, rng, tier, skin) {
    // Clamp anything that scales a COST or a SIZE — the run is infinite.
    var t = Math.min(6, tier);

    var count  = 3 + t;                      // more weights as the tier climbs
    var target = 0;
    var weights = [];
    for (var i = 0; i < count; i++) {
      var w = rng.int(1, 9);                 // seeded, so the run replays exactly
      weights.push({ id: 'w' + i, mass: w, onPan: false });
    }

    // Guarantee solvability by choosing the target FROM a real subset,
    // rather than picking a number and hoping one exists.
    var subset = rng.sample(weights, rng.int(2, Math.max(2, count - 1)));
    for (i = 0; i < subset.length; i++) target += subset[i].mass;

    return {
      weights: weights,
      target: target,
      solution: subset.map(function (w) { return w.id; }),
      tries: 0,
      maxTries: 3,
      cost: 2 + t,                           // energy per attempt
      tier: t
    };
  }

  /* ------------------------------------------------------------------ CSS --
     A string. registry.ensureCss() injects it once, before first mount.
     EVERY selector is anchored by a pz- class. */
  var CSS = [
    '.pz-scale{display:flex;flex-direction:column;gap:14px}',
    '.pz-scale-row{display:flex;flex-wrap:wrap;gap:8px}',
    '.pz-scale-w{padding:10px 14px;border-radius:9px;border:1px solid var(--line);',
    '  background:linear-gradient(180deg,var(--panel-3),var(--panel-2));color:var(--text);',
    '  font-family:var(--font-mono);font-size:14px;transition:transform .14s var(--ease)}',
    '.pz-scale-w:hover:not(:disabled){border-color:var(--acc);transform:translateY(-2px)}',
    '.pz-scale-w.is-on{background:var(--acc-wash);border-color:var(--acc);color:var(--acc-2)}',
    '.pz-scale-read{font-family:var(--font-mono);font-size:22px;color:var(--acc-2)}'
  ].join('\n');

  /* ---------------------------------------------------------------- MOUNT --
     The ONLY place that touches the DOM. */
  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;                         // tiny element builder (optional)
    var readout = h('div', { class: 'pz-scale-read', text: '0 / ' + puzzle.target });
    var row = h('div', { class: 'pz-scale-row' });

    function total() {
      return puzzle.weights.reduce(function (s, w) { return s + (w.onPan ? w.mass : 0); }, 0);
    }

    puzzle.weights.forEach(function (w) {
      var btn = h('button', { class: 'pz-scale-w', type: 'button', text: String(w.mass) });
      btn.addEventListener('click', function () {
        w.onPan = !w.onPan;
        btn.className = 'pz-scale-w' + (w.onPan ? ' is-on' : '');
        readout.textContent = total() + ' / ' + puzzle.target;
      });
      row.appendChild(btn);
    });

    function weigh() {
      var sum = total();
      if (sum === puzzle.target) return win();
      puzzle.tries++;
      // Mid-scene drift: the HUD animates live instead of jumping at the end.
      api.tweak({ energy: -puzzle.cost, morale: -2 });
      if (puzzle.tries >= puzzle.maxTries) return giveIn();
      api.toast(sum > puzzle.target ? 'Too heavy.' : 'Too light.', 'bad');
    }

    function win() {
      api.flash();
      api.finish({
        outcome: 'success',
        stats: { morale: 8, energy: -puzzle.cost },
        gain: ['ration'],
        tags: ['measured_it_out'],
        // Honest signals: this puzzle is solved by reasoning, carefully.
        signals: { logic: 3, caution: 1 },
        choice: 'measured',
        summary: 'You matched the load exactly and the scale settled.'
      });
    }

    function giveIn() {
      api.finish({
        outcome: 'fail',                    // a setback, NEVER an ending
        stats: { energy: -8, morale: -6 },
        lose: ['ration'],
        tags: ['guessed_wrong'],
        signals: { brute: 1 },
        choice: 'eyeballed',
        summary: 'You gave up counting and shoved the whole lot on. It did not balance.'
      });
    }

    // Keyboard: attached to document, so it MUST be torn down in unmount().
    function onKey(ev) { if (ev.key === 'Enter') { ev.preventDefault(); weigh(); } }
    document.addEventListener('keydown', onKey);
    teardownFns.push(function () { document.removeEventListener('keydown', onKey); });

    PS.ui.append(el, h('div', { class: 'pz-scale' }, [
      h('div', { class: 'pz-card' }, [
        h('div', { class: 'pz-card__head', text: 'On the pan' }),
        readout
      ]),
      row,
      h('button', { class: 'pz-btn pz-btn--primary', type: 'button', onclick: weigh }, ['Weigh it']),
      h('div', { class: 'pz-note', text: 'Three attempts. Each one costs you.' })
    ]));
  }

  /* -------------------------------------------------------------- UNMOUNT --
     Remove every document/window listener and every timer. Anything inside
     `el` dies with el and needs no cleanup. */
  function unmount() {
    while (teardownFns.length) { try { teardownFns.pop()(); } catch (e) {} }
  }

  /* ----------------------------------------------------------------- HINT --
     One sentence. Nudge, do not answer. */
  function hint(puzzle) {
    return 'You need ' + puzzle.target + ' exactly. Start from the heaviest piece that still fits.';
  }

  /* ------------------------------------------------------------ AUTOSOLVE --
     Headless, no DOM. Used by the ?dev=1 bot and the smoke test. */
  function autoSolve(puzzle, rng) {
    var win = rng.chance(0.75);
    return win
      ? { outcome: 'success', stats: { morale: 8, energy: -puzzle.cost }, gain: ['ration'],
          tags: ['measured_it_out'], signals: { logic: 3, caution: 1 },
          choice: 'measured', summary: 'You matched the load exactly.' }
      : { outcome: 'fail', stats: { energy: -8, morale: -6 },
          tags: ['guessed_wrong'], signals: { brute: 1 },
          choice: 'eyeballed', summary: 'It did not balance.' };
  }

  /* ------------------------------------------------------------- REGISTER --
     One call. This is the whole integration step. */
  PS.registry.register({
    id: 'example_scales',
    name: 'Balance Scales',
    icon: '\u2696\uFE0F',
    blurb: 'Hit an exact load with the pieces you have.',

    favors:   { logic: 3, caution: 1 },     // rewards planners
    provides: ['food', 'trade'],            // relieves energy and morale pressure
    tagHooks: ['has_ally'],                 // more interesting with someone to bargain with
    requires: function (state) { return state.stats.energy > 6; },

    css: CSS,

    // Exactly 3, in 3 different biomes, using legal palettes.
    skins: [
      { id: 'ration_store', biome: 'shelter', title: 'The Ration Store',
        icon: '\uD83E\uDD6B', palette: 'bone',
        intro: 'The quartermaster is gone and the scale is the only thing anyone still trusts.',
        nouns: { resource: 'rations', exit: 'the store door', hazard: 'the queue' } },

      { id: 'cargo_hold', biome: 'water', title: 'The Cargo Hold',
        icon: '\u2693', palette: 'ice',
        intro: 'She will float if the load sits right, and she will not if it does not.',
        nouns: { resource: 'ballast', exit: 'the hold ladder', hazard: 'the list' } },

      { id: 'scrap_yard', biome: 'industrial', title: 'The Scrap Yard',
        icon: '\uD83C\uDFED', palette: 'rust',
        intro: 'They pay by exact weight and they have been cheating everyone all week.',
        nouns: { resource: 'scrap', exit: 'the weighbridge', hazard: 'the crusher' } }
    ],

    build: build,
    mount: mount,
    unmount: unmount,
    hint: hint,
    autoSolve: autoSolve
  });

})(typeof window !== 'undefined' ? window : this);
```

---

## 15. Read the two reference engines

They are the template, and they are fully commented:

- **`js/games/e01_escape_code.js`** — clue hunting, tier-scaled clue *types*, three
  genuinely different exits, live `api.tweak` while searching, keyboard input, and a
  `hint()` that reads the actual puzzle state.
- **`js/games/e02_grid_crawl.js`** — seeded maze generation with a guaranteed-solvable
  fallback, a real resource tension (light drains per step, fuel sits off the optimal
  path), BFS both for validation and for hints, and an explicit branch at the exit.

When in doubt, do what they do.
