/* ==========================================================================
   PuzzleStudio — core/director.js

   Decides what happens next. Reads the run state + the playstyle profile and
   returns { engineId, skinId, engine, skin, reason }.

   Contract with engines: the Director only ever looks at declarative metadata
   (favors / provides / tagHooks / requires / skins[].biome) plus the last
   result. It never calls into engine logic. That is what lets 20 engines
   written by different sessions slot in without any of them knowing about
   each other.

   GUARANTEES
     * never returns null while at least one engine is registered
     * never repeat-locks: the no-repeat window auto-relaxes for small rosters
     * every override degrades gracefully when its target isn't registered yet

   Loads with NO side effects beyond defining PuzzleStudio.director.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio || (root.PuzzleStudio = {});

  /* --------------------------------------------------------- biome ring -- */
  // indoor -> underground -> water -> industrial -> urban -> wilderness -> shelter -> indoor
  var RING = ['indoor', 'underground', 'water', 'industrial', 'urban', 'wilderness', 'shelter'];
  var RING_W = { 0: 2.0, 1: 6.0, 2: 3.0, 3: 1.2 };   // same / adjacent / two steps / opposite

  function ringDist(a, b) {
    var i = RING.indexOf(a), j = RING.indexOf(b);
    if (i < 0 || j < 0) return 2;
    var d = Math.abs(i - j);
    return Math.min(d, RING.length - d);
  }
  function ringWeight(from, to) { return RING_W[ringDist(from, to)] || 1; }

  /* ------------------------------------------------- choice-id semantics -- */
  // Loose, human-authored hints for choice ids engines and crossroads commonly
  // report. Unknown ids simply contribute nothing — never an error.
  var CHOICE_HINTS = {
    descend:     { biome: 'underground', provides: ['light_source', 'map'],   favors: { caution: 1 } },
    climb:       { biome: 'urban',       provides: ['map', 'vantage'],        favors: { speed: 1 } },
    surface:     { biome: 'urban',       provides: ['vantage'],               favors: { speed: 1 } },
    wade:        { biome: 'water',       provides: ['crossing'],              favors: { caution: 1 } },
    force_door:  { biome: 'industrial',  provides: ['load_out', 'salvage'],   favors: { brute: 2 } },
    pick_lock:   { biome: 'underground', provides: ['light_source', 'map'],   favors: { caution: 2 } },
    code:        { biome: 'indoor',      provides: ['information'],           favors: { logic: 2 } },
    sprint:      { biome: 'urban',       provides: ['crossing'],              favors: { speed: 2 } },
    scavenge:    { biome: 'industrial',  provides: ['salvage', 'load_out'],   favors: { scavenge: 2 } },
    forage:      { biome: 'wilderness',  provides: ['food', 'salvage'],       favors: { scavenge: 2 } },
    shelter:     { biome: 'shelter',     provides: ['rest', 'medical'],       favors: { caution: 1 } },
    rest:        { biome: 'shelter',     provides: ['rest', 'medical'],       favors: { caution: 1 } },
    crawl:       { biome: 'underground', provides: ['light_source'],          favors: { caution: 2 } },
    signal:      { biome: 'urban',       provides: ['ally', 'information'],   favors: { logic: 1 } },
    trade:       { biome: 'urban',       provides: ['trade', 'ally'],         favors: { scavenge: 1 } }
  };

  /* ------------------------------------------------------ need -> supply -- */
  // Which `provides` tokens relieve which failing stat.
  var RELIEF = {
    light:  ['light_source', 'fire', 'power'],
    health: ['medical', 'triage', 'shelter', 'rest'],
    energy: ['food', 'rest', 'shelter'],
    morale: ['ally', 'comfort', 'information', 'trade']
  };

  var ALLY_MAGNETS = ['allocation', 'triage', 'barter', 'trade', 'ally'];

  function isAllyMagnet(e) {
    if (e.provides.indexOf('trade') >= 0 || e.provides.indexOf('ally') >= 0 || e.provides.indexOf('triage') >= 0) return true;
    for (var i = 0; i < ALLY_MAGNETS.length; i++) if (e.id.indexOf(ALLY_MAGNETS[i]) >= 0) return true;
    return false;
  }

  function overlap(a, b) {
    var n = 0;
    for (var i = 0; i < (a || []).length; i++) if ((b || []).indexOf(a[i]) >= 0) n++;
    return n;
  }

  function safeRequires(e, state) {
    try { return e.requires(state) !== false; }
    catch (err) {
      if (root.console) console.warn('[PuzzleStudio] requires() threw in engine "' + e.id + '":', err);
      return true;   // a broken gate must never remove an engine from the game
    }
  }

  function engineBiomes(e) {
    return e.skins.map(function (s) { return s.biome; });
  }

  /* ==========================================================================
     SCORING
     ========================================================================== */

  function choiceAffinity(e, ctx) {
    var s = 0;

    // 1. the crossroad choice the player just made (strongest signal)
    var cr = ctx.state.crossroad;
    if (cr) {
      s += Math.min(2.5, overlap(cr.provides, e.provides) * 1.5);
      if (cr.biome && engineBiomes(e).indexOf(cr.biome) >= 0) s += 0.9;
      s += favorMatch(cr.favors, e.favors) * 1.0;
    }

    // 2. the branch the player took inside the last puzzle
    var last = ctx.state.last;
    var hint = last && last.choice ? CHOICE_HINTS[last.choice] : null;
    if (hint) {
      s += Math.min(1.8, overlap(hint.provides, e.provides) * 1.05);
      if (hint.biome && engineBiomes(e).indexOf(hint.biome) >= 0) s += 0.6;
      s += favorMatch(hint.favors, e.favors) * 0.7;
    }
    return s;
  }

  function favorMatch(a, b) {
    if (!a || !b) return 0;
    var s = 0, k;
    for (k in a) {
      if (!Object.prototype.hasOwnProperty.call(a, k)) continue;
      if (b[k]) s += Math.min(1, (Number(a[k]) || 0) * (Number(b[k]) || 0) / 4);
    }
    return Math.min(1.5, s);
  }

  function tagAffinity(e, ctx) {
    var s = 0, i;
    for (i = 0; i < e.tagHooks.length; i++) {
      if (ctx.state.hasTag(e.tagHooks[i])) s += 1.6;
    }
    s = Math.min(3.2, s);
    // OVERRIDE RULE: an ally in the pack pulls hard toward allocation/barter.
    if (ctx.state.hasTag('has_ally') && isAllyMagnet(e)) s += 4;
    return s;
  }

  function needPressure(e, ctx) {
    var st = ctx.state.stats, s = 0, k;
    for (k in RELIEF) {
      if (!Object.prototype.hasOwnProperty.call(RELIEF, k)) continue;
      var v = st[k];
      if (v >= 45) continue;
      if (overlap(RELIEF[k], e.provides) > 0) s += (45 - v) / 9;   // up to +5 at zero
    }
    return s;
  }

  function freshness(e, ctx) {
    var d = ctx.state.depthSince(e.id);
    if (d >= 999) return 2.5;                       // never played
    return Math.min(2.0, Math.max(0, (d - 1) * 0.4));
  }

  function scoreEngine(e, ctx) {
    var parts = {
      choice:  choiceAffinity(e, ctx),
      tag:     tagAffinity(e, ctx),
      profile: ctx.profile ? ctx.profile.affinity(e.favors) : 0,
      need:    needPressure(e, ctx),
      fresh:   freshness(e, ctx),
      jitter:  ctx.rng.jitter(1.4)
    };
    var total = 0;
    for (var k in parts) if (Object.prototype.hasOwnProperty.call(parts, k)) total += parts[k];
    return { engine: e, score: total, parts: parts };
  }

  /* ==========================================================================
     CANDIDATE POOLS — progressive relaxation so we can never dead-end
     ========================================================================== */

  /**
   * How many recent engines to exclude. With a tiny roster this MUST shrink or
   * the game locks up; with only 2 engines it becomes 0 and we merely avoid an
   * immediate repeat.
   */
  function noRepeatWindow(total) {
    if (total <= 2) return 0;
    return Math.max(0, Math.min(4, total - 2));
  }

  function poolFor(ctx, opts) {
    var all = PS.registry.all();
    if (!all.length) return [];
    var recent = opts.window > 0 ? ctx.state.recentEngines(opts.window) : [];
    var currentId = ctx.state.last ? ctx.state.last.engineId : null;

    return all.filter(function (e) {
      if (opts.excludeCurrent && all.length > 1 && e.id === currentId) return false;
      if (recent.indexOf(e.id) >= 0) return false;
      if (opts.applyRequires && !safeRequires(e, ctx.state)) return false;
      return true;
    });
  }

  /** Ordered relaxation ladder. Returns { pool, relaxed } — pool is never empty
   *  unless the registry itself is empty. */
  function candidates(ctx) {
    var total = PS.registry.count();
    var win = noRepeatWindow(total);
    var steps = [
      { window: win, excludeCurrent: true,  applyRequires: true,  relaxed: 'none' },
      { window: 0,   excludeCurrent: true,  applyRequires: true,  relaxed: 'no-repeat-window-dropped' },
      { window: win, excludeCurrent: true,  applyRequires: false, relaxed: 'requires-dropped' },
      { window: 0,   excludeCurrent: true,  applyRequires: false, relaxed: 'window-and-requires-dropped' },
      { window: 0,   excludeCurrent: false, applyRequires: false, relaxed: 'replaying-freshest' }
    ];
    for (var i = 0; i < steps.length; i++) {
      var pool = poolFor(ctx, steps[i]);
      if (pool.length) return { pool: pool, relaxed: steps[i].relaxed };
    }
    return { pool: [], relaxed: 'empty-registry' };
  }

  /* ==========================================================================
     HARD OVERRIDES — these beat scoring outright.
     Precedence (highest first):
       1. blackout           -> allocation / triage
       2. light < 15         -> anything that provides light_source
       3. failed in water    -> constraint crossing
       4. escape_code branch -> force_door: knapsack | pick_lock: grid crawl
     Every one degrades to normal scoring when its target isn't registered.
     ========================================================================== */

  function firstUsable(list, ctx) {
    var currentId = ctx.state.last ? ctx.state.last.engineId : null;
    var solo = PS.registry.count() <= 1;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e) continue;
      if (!solo && e.id === currentId) continue;         // don't override into a repeat
      if (!safeRequires(e, ctx.state)) continue;
      return e;
    }
    return null;
  }

  function byIdOrProvides(id, need, ctx) {
    var list = [];
    var direct = PS.registry.get(id);
    if (direct) list.push(direct);
    if (need) list = list.concat(PS.registry.providing(need));
    return firstUsable(list, ctx);
  }

  function checkOverrides(ctx) {
    var st = ctx.state;
    var last = st.last;

    // 1. blackout — you wake up on someone's floor being triaged.
    if (st.blackout || st.stats.health <= 0) {
      var triage = byIdOrProvides('allocation_triage', 'triage', ctx) ||
                   byIdOrProvides('allocation_triage', 'medical', ctx);
      if (triage) return { engine: triage, reason: 'override:blackout' };
    }

    // 2. running out of light beats everything else you might have wanted.
    if (st.stats.light < 15) {
      var lit = firstUsable(PS.registry.providing('light_source'), ctx) ||
                firstUsable(PS.registry.providing('fire'), ctx);
      if (lit) return { engine: lit, reason: 'override:light-critical' };
    }

    if (last) {
      // 3. drowned attempt -> the crossing problem you should have solved first.
      if (last.outcome === 'fail' && last.biome === 'water') {
        var cross = byIdOrProvides('constraint_crossing', 'crossing', ctx);
        if (cross) return { engine: cross, reason: 'override:water-fail' };
      }

      // 4. how you left the last room decides the next room.
      if (last.engineId === 'escape_code') {
        if (last.choice === 'force_door') {
          var knap = byIdOrProvides('knapsack', 'load_out', ctx);
          if (knap) return { engine: knap, reason: 'override:forced-door' };
        }
        if (last.choice === 'pick_lock') {
          var crawl = byIdOrProvides('grid_crawl', 'map', ctx);
          if (crawl) return { engine: crawl, reason: 'override:picked-lock' };
        }
      }
    }
    return null;
  }

  /* ==========================================================================
     SKIN SELECTION — weighted by biome adjacency from where the player is now
     ========================================================================== */

  function pickSkin(engine, ctx) {
    var from = ctx.state.biome || 'indoor';
    var seen = ctx.state.seenSkins();
    return ctx.rng.weighted(engine.skins, function (s) {
      var w = ringWeight(from, s.biome);
      if (!seen[engine.id + ':' + s.id]) w *= 2.2;        // show off unseen content
      else if (ctx.state.last && ctx.state.last.skinId === s.id) w *= 0.35;
      // a crossroad that pointed at a biome nudges the skin too
      if (ctx.state.crossroad && ctx.state.crossroad.biome === s.biome) w *= 1.8;
      return Math.max(0.15, w);                            // never zero
    }) || engine.skins[0];
  }

  /* ==========================================================================
     PUBLIC API
     ========================================================================== */

  function makeCtx(state, profile, rng) {
    return {
      state: state,
      profile: profile || PS.profile.create(),
      rng: rng || PS.rng.create(PS.rng.hash(state.runSeed, 'director', state.depth))
    };
  }

  function finish(engine, ctx, reason, debug) {
    var skin = pickSkin(engine, ctx);
    // consume the one-shot signals so they don't influence the pick after next
    ctx.state.blackout = false;
    ctx.state.crossroad = null;
    return {
      engineId: engine.id,
      skinId: skin.id,
      engine: engine,
      skin: skin,
      reason: reason,
      debug: debug || null
    };
  }

  /**
   * Pick the next encounter.
   * @param {State} state
   * @param {Profile} profile
   * @param {object} [rng] — pass one for reproducible tests
   * @returns {object|null} null only when nothing at all is registered
   */
  function next(state, profile, rng) {
    var ctx = makeCtx(state, profile, rng);
    if (!PS.registry.count()) return null;

    var forced = checkOverrides(ctx);
    if (forced) return finish(forced.engine, ctx, forced.reason);

    var c = candidates(ctx);
    if (!c.pool.length) return null;

    var scored = c.pool.map(function (e) { return scoreEngine(e, ctx); });
    scored.sort(function (a, b) { return b.score - a.score; });

    var top = scored.slice(0, 4);
    var floor = top[top.length - 1].score;
    var chosen = ctx.rng.weighted(top, function (s) { return (s.score - floor) + 0.35; }) || top[0];

    return finish(chosen.engine, ctx, 'score' + (c.relaxed === 'none' ? '' : ':' + c.relaxed), {
      relaxed: c.relaxed,
      considered: scored.length,
      top: top.map(function (s) { return { id: s.engine.id, score: Math.round(s.score * 100) / 100, parts: s.parts }; })
    });
  }

  /** The opening scene. Prefers escape_code — it is the game's thesis statement. */
  function first(state, profile, rng) {
    var ctx = makeCtx(state, profile, rng);
    if (!PS.registry.count()) return null;
    var opener = PS.registry.get('escape_code');
    if (opener && safeRequires(opener, state)) return finish(opener, ctx, 'opening');
    var pool = PS.registry.all().filter(function (e) { return safeRequires(e, state); });
    if (!pool.length) pool = PS.registry.all();
    return finish(ctx.rng.pick(pool), ctx, 'opening:fallback');
  }

  PS.director = {
    RING: RING,
    CHOICE_HINTS: CHOICE_HINTS,
    RELIEF: RELIEF,
    ringDist: ringDist,
    ringWeight: ringWeight,
    noRepeatWindow: noRepeatWindow,
    next: next,
    first: first,
    /** exposed for the dev overlay + smoke test diagnostics */
    _score: function (engine, state, profile, rng) { return scoreEngine(engine, makeCtx(state, profile, rng)); }
  };

})(typeof window !== 'undefined' ? window : this);
