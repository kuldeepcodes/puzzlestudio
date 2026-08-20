/* ==========================================================================
   PuzzleStudio — core/engine.js
   Boot + the run loop.

     title -> build -> mount -> api.finish(result) -> applyResult
           -> profile.absorb -> save -> crossroad -> director.next -> repeat

   tier = 1 + floor(depth / 6)
   Scene seed = hash(runSeed, engineId, skinId, depth) so the same engine at a
   different depth is a genuinely different puzzle.

   Loads with NO side effects beyond defining PuzzleStudio.engine.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio || (root.PuzzleStudio = {});

  var state = null;
  var profile = null;
  var scene = null;        // { engine, skin, puzzle, api, rng, tier, finished }
  var booted = false;
  var paused = false;      // true while the title overlay is up
  var listeners = [];      // dev/autoplay hooks

  function emit(evt, payload) {
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](evt, payload); } catch (e) { if (root.console) console.warn('[PuzzleStudio] hook threw:', e); }
    }
  }

  function on(fn) {
    listeners.push(fn);
    return function () { var i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  }

  /* =============================================================== BOOT == */

  function boot() {
    if (booted) return;
    booted = true;

    if (typeof document === 'undefined') return;   // headless: nothing to draw

    PS.ui.mount(document.getElementById('ps-root'));

    if (!PS.registry.count()) {
      PS.ui.setHeader({ icon: '\uD83E\uDDF1', title: 'No engines loaded', sub: 'js/games/ is empty' });
      PS.ui.transition(function (el) {
        var h = PS.ui.h;
        el.appendChild(h('div', { class: 'pz-scene' }, [
          h('div', { class: 'pz-intro' }, [
            'The loader found no puzzle engines in ', h('em', { text: 'js/games/' }), '. ',
            'Add an engine file (see CONTRACT.md) and reload.'
          ])
        ]));
      });
      emit('boot', { engines: 0 });
      return;
    }

    PS.ui.setHeader({ icon: '\uD83E\uDDED', title: 'The Long Way Out', sub: 'Choose a run' });
    openMenu();
    emit('boot', { engines: PS.registry.count() });

    if (PS.main && typeof PS.main.afterBoot === 'function') PS.main.afterBoot();
  }

  function openMenu() {
    paused = true;
    PS.ui.setHintEnabled(false);
    PS.ui.showTitle({});
  }

  /* ============================================================ RUN SETUP = */

  function newRun(seedText) {
    var label, seedNum;
    if (seedText) {
      label = String(seedText).slice(0, 40);
      seedNum = PS.rng.hash(label);
    } else {
      label = PS.rng.friendlySeed();
      seedNum = PS.rng.hash(label);
    }

    state = PS.state.create({ runSeed: seedNum, seedLabel: label });
    profile = PS.profile.create();
    paused = false;

    PS.ui.bind(state, profile);
    PS.save.save(state, profile);

    var pick = PS.director.first(state, profile);
    if (!pick) { PS.ui.toast('No engines are registered.', 'bad'); return; }
    emit('run', { seed: label });
    runScene(pick);
  }

  function continueRun() {
    var loaded = PS.save.load();
    if (!loaded) { newRun(null); return; }
    state = loaded.state;
    profile = loaded.profile;
    paused = false;

    PS.ui.bind(state, profile);
    var pick = PS.director.next(state, profile) || PS.director.first(state, profile);
    if (!pick) { PS.ui.toast('No engines are registered.', 'bad'); return; }
    emit('run', { seed: state.seedLabel, resumed: true });
    runScene(pick);
  }

  /* ============================================================== SCENE == */

  function runScene(pick) {
    if (!pick || !pick.engine) { PS.ui.toast('The Director came back empty.', 'bad'); return; }

    // tear down whatever was there
    teardown();

    var engine = pick.engine;
    var skin = pick.skin;
    var tier = state.tier();
    var seed = PS.rng.sceneSeed(state.runSeed, engine.id, skin.id, state.depth);
    var rng = PS.rng.create(seed);

    var puzzle;
    try {
      puzzle = engine.build(state, rng, tier, skin);
    } catch (err) {
      if (root.console) console.error('[PuzzleStudio] build() failed in "' + engine.id + '":', err);
      PS.ui.toast('That scenario could not be built. Moving on.', 'bad');
      // never dead-end on a broken engine: synthesise a neutral result
      finishResult({ outcome: 'partial', summary: 'You lost time to something that made no sense.', stats: { energy: -5 } },
        { engineId: engine.id, engineName: engine.name, skinId: skin.id, title: skin.title, icon: skin.icon, biome: skin.biome });
      return;
    }

    var api = makeApi(engine, skin, puzzle, rng, tier);
    scene = { engine: engine, skin: skin, puzzle: puzzle, api: api, rng: rng, tier: tier, finished: false, reason: pick.reason };

    PS.registry.ensureCss(engine.id);
    PS.ui.applySkin(skin);
    PS.ui.setHeader({
      icon: skin.icon,
      title: skin.title,
      sub: engine.name + ' \u00B7 ' + PS.state.prettify(skin.biome) + ' \u00B7 depth ' + state.depth + ' \u00B7 T' + tier
    });
    PS.ui.setHintHandler(typeof engine.hint === 'function' ? api.hint : null);

    PS.ui.transition(function (el) {
      var h = PS.ui.h;
      var wrap = h('div', { class: 'pz-scene' });
      if (skin.intro) wrap.appendChild(h('div', { class: 'pz-intro', text: skin.intro }));
      var host = h('div', { class: 'pz-engine', 'data-engine': engine.id });
      wrap.appendChild(host);
      el.appendChild(wrap);
      engine.mount(host, state, api, puzzle, skin);
    });

    emit('scene', { engineId: engine.id, skinId: skin.id, tier: tier, reason: pick.reason, depth: state.depth });
  }

  function makeApi(engine, skin, puzzle, rng, tier) {
    var api = {
      rng: rng,
      tier: tier,
      state: state,
      skin: skin,
      engineId: engine.id,

      /** The one way an engine ends its scene. Extra calls are ignored. */
      finish: function (result) {
        if (!scene || scene.finished || scene.engine !== engine) return;
        scene.finished = true;
        finishResult(result, {
          engineId: engine.id, engineName: engine.name, skinId: skin.id,
          title: skin.title, icon: skin.icon, biome: skin.biome
        });
      },

      /** Ask the engine for a nudge. Costs morale, gets cheaper with high morale. */
      hint: function () {
        if (!scene || scene.finished) return null;
        var text = null;
        if (typeof engine.hint === 'function') {
          try { text = engine.hint(puzzle, state, skin); }
          catch (e) { if (root.console) console.warn('[PuzzleStudio] hint() threw in "' + engine.id + '":', e); }
        }
        if (!text) text = 'Nothing here will help you. Try the thing you have been avoiding.';
        var cost = state.stats.morale > 60 ? -3 : -6;
        state.applyTweak({ morale: cost });
        PS.ui.toast(text, 'info', 5200);
        emit('hint', { engineId: engine.id, text: text });
        return text;
      },

      /** Small mid-scene feedback that does not end the scene. */
      toast: function (msg, kind) { PS.ui.toast(msg, kind); },
      flash: function () { PS.ui.flash(); },

      /** Mid-scene stat drift (a move that costs light, a fall that costs health). */
      tweak: function (deltas, gain, lose, tags) { return state.applyTweak(deltas, gain, lose, tags); },

      h: PS.ui.h
    };
    return api;
  }

  function teardown() {
    if (scene && scene.engine && typeof scene.engine.unmount === 'function') {
      try { scene.engine.unmount(); }
      catch (e) { if (root.console) console.warn('[PuzzleStudio] unmount() threw in "' + scene.engine.id + '":', e); }
    }
    // Safety net: an arena that outlived its scene would keep an rAF loop and a
    // keyboard listener alive on top of the next one. Never allow it.
    if (PS.arena && PS.arena.active()) {
      try { PS.arena.destroyActive(); }
      catch (e2) { if (root.console) console.warn('[PuzzleStudio] arena destroy threw:', e2); }
    }
    PS.ui.setHintHandler(null);
    scene = null;
  }

  /* ============================================================== FINISH = */

  function finishResult(result, sceneMeta) {
    teardown();
    result = result || { outcome: 'partial' };

    var report = state.applyResult(result, sceneMeta);
    profile.absorb(result.signals);
    PS.save.save(state, profile);
    emit('finish', { result: result, report: report, meta: sceneMeta });

    var crRng = PS.rng.create(PS.rng.hash(state.runSeed, 'crossroad', state.depth));

    var showCrossroad = function () {
      PS.ui.setHeader({
        icon: '\uD83E\uDDED',
        title: 'Crossroad',
        sub: PS.state.prettify(state.biome) + ' \u00B7 depth ' + state.depth + ' \u00B7 T' + state.tier()
      });
      PS.ui.transition(function (el) {
        PS.crossroad.render(el, state, report, crRng, function () {
          PS.save.save(state, profile);
          advance();
        });
      });
      emit('crossroad', { depth: state.depth });
    };

    if (report.blackout) {
      PS.ui.blackout(function () { PS.ui.toast('You black out.', 'bad', 3200); }, showCrossroad);
    } else {
      if (result.outcome === 'success') PS.ui.flash();
      showCrossroad();
    }
  }

  function advance() {
    var pick = PS.director.next(state, profile);
    if (!pick) {
      // Only reachable with an empty registry — the Director cannot dead-end otherwise.
      PS.ui.toast('Nowhere left to go. Add an engine.', 'bad');
      return;
    }
    runScene(pick);
  }

  /** Used by the crash screen and the autoplay bot's give-up path. */
  function skipScene() {
    if (!state) return;
    if (scene && !scene.finished) {
      scene.api.finish({
        outcome: 'fail',
        stats: { energy: -8, morale: -6 },
        signals: { caution: 1 },
        choice: null,
        summary: 'You gave up on it and took the long way instead.'
      });
      return;
    }
    advance();
  }

  PS.engine = {
    boot: boot,
    openMenu: openMenu,
    newRun: newRun,
    continueRun: continueRun,
    runScene: runScene,
    skipScene: skipScene,
    advance: advance,
    on: on,
    isPaused: function () { return paused; },
    currentScene: function () { return scene; },
    currentApi: function () { return scene ? scene.api : null; },
    getState: function () { return state; },
    getProfile: function () { return profile; }
  };

})(typeof window !== 'undefined' ? window : this);
