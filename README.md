# PuzzleStudio — *The Long Way Out*

An endless, branching survival puzzle game that runs by **double-clicking a file**.

No server. No build step. No npm. No bundler. No CDN, no web fonts, no libraries, no
analytics, no image assets.

---

## Play it online

**→ [kuldeepcodes.github.io/puzzlestudio](https://kuldeepcodes.github.io/puzzlestudio/)**

## Or play it offline — the same game, no server

Download the repo and double-click `index.html`. That is the entire install.

```
git clone https://github.com/kuldeepcodes/puzzlestudio
cd puzzlestudio
# now double-click index.html
```

Both modes run **identical code**. There is no build output, no hosted-only path, and
no "dev vs production" split — the hosted version is these exact files served over
HTTP, and the local version is these exact files opened over `file://`.

That dual-mode support is deliberate, and it is the constraint the whole architecture
is built around. `file://` blocks ES modules and `fetch()` under CORS, so the game uses
classic `<script>` tags, a single `PuzzleStudio` global, dynamically injected script
tags for the engine files, and CSS carried as strings on each engine registration.
Every path in the project is relative, so it works from a domain root, a sub-path, or a
folder on your desktop. Nothing here needs the network once you have the files —
put it on a USB stick and it still plays.

---

## What it is

You are a survivor working your way out of one emergency and straight into the next.
Every scenario is a self-contained mini-puzzle — a keypad you have to derive, a dark
maze you have to cross on a shrinking light budget — and when you finish one, it reports
back not just *whether* you got out but **how**.

A Director engine reads that and picks what happens next. Forced a door instead of
cracking the code? Something heavy is waiting. Ran your lamp dry? The next room is about
light. Solved everything quietly and carefully for six scenes running? The game notices
and starts leaning into it.

**It never ends, and you never lose.** Failing a puzzle costs you stats and gear and
sends you down a harsher branch. Health reaching zero means you black out and wake up
somewhere else with an empty pack and thirty health. There is no Game Over screen.

---

## Playing

Double-click `index.html`, pick **New run**, and go. Optionally type a seed first — the
same seed always produces the same run, so seeds are shareable.

| URL parameter | effect |
|---|---|
| `?dev=1` | loads the autoplay bot and lets it play the whole chain hands-free |
| `?dev=1&speed=3` | same, faster |
| `?seed=ASH-4712-VEIL` | deep-link straight into a seeded run |

Progress saves to `localStorage` after every scene, so **Continue** picks up where you
left off. If storage is unavailable — private browsing, quota, a locked-down browser —
the game says so once and keeps playing; it just will not remember.

### The four stats

| | stat | what drains it | what it does |
|---|---|---|---|
| ❤️ | **Health** | forcing doors, hazards, moving in the dark | at 0 you black out, lose your pack, and wake at 30 |
| ⚡ | **Energy** | searching, climbing, every step | gates which scenarios you are offered at all |
| 🔦 | **Light** | every move in a dark scenario | sets how far you can see; below 15 the Director drops everything and sends you toward a light source |
| 🧠 | **Morale** | wrong guesses, hints, bad outcomes | hints cost more when it is low |

Stats are clamped to 0–100 and animate in the left-hand panel as they change.

### The pack

Items are picked up in scenarios and matter mechanically, not decoratively. A **wire**
or a **pin** unlocks the quiet lockpicking branch of Escape Code. A **lamp** or **torch**
gives you the `has_lamp` tag, which makes light-hungry scenarios more likely to find
you. An **ally** pulls the whole run toward trading and triage.

### Crossroads

Between scenarios you get a short interstitial: what the last scene cost you, then two
or three thematic choices — *crawl deeper*, *climb toward the light*, *strip the room
first*, *find somewhere to stop*. Each has a real price and each one tells the Director
where you want to go. When you are nearly spent, a recovery option is guaranteed to be
on the table.

---

## How the Director picks the next scenario

This is the heart of the game. `js/core/director.js`:

1. **Candidates** = every registered engine, minus the current one, minus the last few
   played. The no-repeat window shrinks automatically for a small roster, so the game
   works correctly with as few as two engines registered.
2. **Filter** out anything whose `requires(state)` gate is false.
3. **Score** each survivor:
   `choice affinity + tag affinity + playstyle affinity + need pressure + freshness + jitter`
4. **Pick** weighted-random from the top four — so it is directed, not deterministic.
5. **Pick a skin** weighted by biome adjacency around a ring:
   `indoor → underground → water → industrial → urban → wilderness → shelter → indoor`.
   Adjacent is heavily favoured, two steps is medium, opposite is low but never zero.

### Hard overrides

Some situations beat scoring outright, highest priority first:

| when | what happens |
|---|---|
| you blacked out | routed to an allocation/triage scenario |
| light below 15 | routed to something that `provides: ['light_source']` |
| you failed in a water biome | routed to a constraint-crossing scenario |
| you forced the door in Escape Code | routed to a knapsack scenario |
| you picked the lock in Escape Code | routed to a grid crawl |
| you have an ally | allocation and barter scenarios weighted far higher |

Every override **degrades gracefully**: if its target engine is not registered yet, it
falls through to normal scoring rather than breaking.

### It cannot dead-end

If every candidate is filtered out, the Director relaxes progressively — drop the
no-repeat window, then drop the `requires` gates, and as a last resort replay the
freshest engine. `tools/smoke-test.js` proves this over 1000 consecutive transitions.

### Playstyle

Every result reports five signals — `logic`, `brute`, `caution`, `speed`, `scavenge` —
which accumulate into a normalised profile. Your top two show as badges in the HUD:
**Logician 🧩 · Brute 💪 · Cautious 🕵️ · Speedrunner 💨 · Scavenger 🎒**. The Director
scores engines partly on how well their declared `favors` match that profile.

---

## What is in the box

```
index.html              the whole game. classic <script> tags, no modules
CONTRACT.md             the authoritative engine-authoring spec
.nojekyll               tells GitHub Pages to serve the tree verbatim
css/base.css            theme tokens, app shell, HUD, stage, transitions
css/skins.css           the 7 palettes: amber moss steel ice rust ash bone
js/core/rng.js          seeded mulberry32 + string hash
js/core/state.js        stats, pack, tags, depth, history, blackout rule
js/core/profile.js      signals -> playstyle
js/core/registry.js     engine registration, validation, CSS injection
js/core/director.js     scoring, biome ring, overrides, no-dead-end ladder
js/core/crossroad.js    the beat between encounters
js/core/ui.js           HUD, stage, transitions, toasts, title screen
js/core/save.js         localStorage, degrading gracefully
js/core/engine.js       boot and the scene lifecycle
js/core/loader.js       injects all 20 engine files, tolerating missing ones
js/games/*.js           one self-contained file per puzzle engine
js/dev/autoplay.js      the ?dev=1 bot
js/main.js              bootstrap
tools/smoke-test.js     node tools/smoke-test.js
```

### The scenarios

**20 puzzle engines × 3 re-themed skins each = 60 distinct encounters.**

An *engine* is the mechanic and all the code. A *skin* is pure data that re-themes it — new
biome, title, story, palette and noun labels. The same balance-scale engine is
*Contaminated Canisters* in the wilderness and *Counterfeit Tokens* in a city market. That
is also how narrative continuity works: the Director picks the **engine** by playstyle and
need, then picks the **skin** by biome adjacency, so almost any puzzle can appear anywhere
without the story lurching.

| # | Engine | The three scenarios it appears as |
|---|---|---|
| 1 | 🚪 **Escape Code** | Office Lockdown *(indoor)* · Ship Cabin *(water)* · Bunker Airlock *(shelter)* |
| 2 | 🕯️ **Grid Crawl** | The Dark Tunnel *(underground)* · Smoke-Filled Corridor *(indoor)* · Whiteout Snowfield *(wilderness)* |
| 3 | 🎒 **Knapsack** | The Collapsed Store *(underground)* · Evacuation Pack *(urban)* · Lifeboat Locker *(water)* |
| 4 | 🛶 **Constraint Crossing** | The Flooded Crossing *(water)* · Rope Bridge Ferry *(wilderness)* · The Weight Limit *(urban)* |
| 5 | ⚡ **Circuit Rotation** | The Dead Substation *(industrial)* · Coolant Gallery *(industrial)* · The Dry Channels *(wilderness)* |
| 6 | 📻 **Cipher Decode** | The Relay Tower *(industrial)* · The Scratched Journal *(indoor)* · The Buoy Light *(water)* |
| 7 | ⚖️ **Balance Scales** | Contaminated Canisters *(wilderness)* · Counterfeit Tokens *(urban)* · Faulty Oxygen Cylinders *(industrial)* |
| 8 | 🪪 **Logic Grid** | Restricted Access *(urban)* · Who Took the Medkit *(shelter)* · Crew Manifest *(water)* |
| 9 | 🔧 **Dependency Order** | Pressure Release Valves *(industrial)* · Reactor Startup *(industrial)* · Dam Sluice Gates *(water)* |
| 10 | 🥫 **Allocation Triage** | Storm Shelter Rations *(shelter)* · Medicine Convoy *(urban)* · Fuel Split *(wilderness)* |
| 11 | 🪙 **Barter Graph** | The Underpass Market *(urban)* · The Trade Circle *(wilderness)* · The Dockside Fence *(water)* |
| 12 | 🏃 **Timing Bar** | The Rooftop Gap *(urban)* · The Conveyor Line *(industrial)* · The Rockfall Drift *(underground)* |
| 13 | ☠️ **Adjacency Deduction** | The Unstable Floor *(indoor)* · The Marked Field *(wilderness)* · Thin Ice *(water)* |
| 14 | 🚑 **Priority Sort** | The Triage Ward *(shelter)* · The Evac Queue *(urban)* · The Distress Board *(industrial)* |
| 15 | 🪣 **Measuring** | Fuel Mixing *(industrial)* · Antidote Dilution *(shelter)* · Water Ration Split *(wilderness)* |
| 16 | 📦 **Polyomino Packing** | Cargo Loading *(urban)* · Lifeboat Stowage *(water)* · Mine Cart Packing *(underground)* |
| 17 | 📡 **Triangulation** | Beacon Hunt *(wilderness)* · Cell Tower Trace *(urban)* · Sonar Ping *(water)* |
| 18 | 🧊 **Sliding Block** | Jammed Motor Pool *(urban)* · Crate-Blocked Hatch *(industrial)* · Ice-Jammed Sluice *(water)* |
| 19 | 👁️ **Patrol Routing** | Night Watch *(urban)* · Searchlight Yard *(industrial)* · Predator Range *(wilderness)* |
| 20 | 🧮 **Numeric Constraint** | Ration Ledger *(shelter)* · Payload Manifest *(industrial)* · Seed Store Audit *(wilderness)* |

A run the Director can genuinely produce:

`Office Lockdown` *(you force the door — loud)* → `The Collapsed Store` *(grab rope and a
flare)* → `The Dark Tunnel` *(the rope opens the shaft shortcut)* → *light critical* →
`The Dead Substation` → `The Relay Tower` *(you answer the call — you have an ally now)* →
`Storm Shelter Rations` *(your ally is one of the survivors)* → `Thin Ice` → `Sonar Ping` →
… and onward, forever.

---

## Testing

```
node tools/smoke-test.js
```

Plain Node, no `npm install`, no dependencies. It loads the core and every engine into a
`vm` sandbox whose `document` throws on contact — proving no engine touches the DOM at
load time — then drives the Director through **1000 transitions**, calling each engine's
real `build()` at every tier reached.

It asserts: no dead ends, no repeat-lock, stats stay inside 0–100, every registered
engine and every registered skin is reachable, nothing throws, engine CSS is properly
namespaced, and nowhere in the source is there an ES module, a `fetch`, an
`XMLHttpRequest` or an external URL. Then it prints a coverage table and exits non-zero
on failure.

```
PZ_TRANSITIONS=5000 node tools/smoke-test.js     # longer soak
PZ_SEED=whatever    node tools/smoke-test.js     # a different run
```

---

## How to add engine #21

**Read [`CONTRACT.md`](CONTRACT.md).** It is the real answer. The short version:

1. Add its filename to the `MANIFEST` array in `js/core/loader.js`. *(This is the only
   time that file is ever edited, and only because you are going past the frozen twenty.
   Engines 1–20 are already listed — if you are writing one of those, you edit nothing.)*
2. Create `js/games/e21_your_engine.js` as a single IIFE that calls
   `PuzzleStudio.registry.register({...})` at load time.
3. Put **everything** in that one file — puzzle logic, exactly three skins, and your CSS
   as a `css:` string the registry injects for you. No shared CSS file, no `<script>` tag
   in `index.html`, no edits to anyone else's code.
4. `build(state, rng, tier, skin)` must be headless, seeded only from `rng`, solvable,
   and must clamp its own difficulty scaling — the run is infinite.
5. `mount(el, state, api, puzzle, skin)` is the **only** place that may touch `document`.
   `unmount()` must remove every listener and timer it created.
6. End the scene with `api.finish({ outcome, stats, gain, lose, tags, signals, choice,
   summary })`, reporting honest signals — that is what steers the whole game.
7. Prefix every CSS selector `pz-<engine>-`. Twenty engines share one document.
8. Run `node tools/smoke-test.js` until it prints PASS.

### Why it works this way

The loader hardcoding twenty filenames and injecting them with `onerror` tolerated looks
odd until you know why: **it means adding an engine is adding one file and editing
nothing.** Six people can write engines simultaneously with zero merge conflicts, because
no two of them ever have a reason to open the same file.

Everything else follows from the same constraint. `<script>` injection instead of
`fetch()` because `fetch()` is CORS-blocked on `file://`. CSS as a string on the
registration instead of a shared stylesheet, for the same reason. The no-DOM-at-load-time
rule so the whole roster can be tested headlessly in Node with no browser at all.
