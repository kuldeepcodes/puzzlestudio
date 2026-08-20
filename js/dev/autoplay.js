/* ==========================================================================
   PuzzleStudio — js/dev/autoplay.js
   Loaded ONLY when the URL carries ?dev=1 (see js/main.js).

   A bot that plays the real UI so you can watch the whole chain — engine,
   crossroad, Director, next engine — without touching the keyboard.

   How it plays:
     1. Clicks a random legal control in the stage every tick. That is enough
        to drive any engine that renders buttons, including ones that do not
        exist yet.
     2. If a scene is still unfinished after its budget, it falls back to the
        engine's optional autoSolve(puzzle, rng, state, tier, skin) and calls
        api.finish() with the result.
     3. If there is no autoSolve, it forfeits. The run continues either way.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio;
  if (!PS) return;

  var timer = null;
  var running = false;
  var speed = 1;
  var badge = null;

  var sceneClicks = 0;
  var sceneStart = 0;
  var sceneCount = 0;
  var arenaMoves = 0;
  var CLICK_BUDGET = 60;
  var TIME_BUDGET = 26000;
  var ARENA_BUDGET = 40;

  // Controls the bot will click. Deliberately generic so future engines work
  // with no changes: anything enabled and clickable inside the stage.
  var SELECTOR = [
    '.ps-stage__inner button:not(:disabled)'
  ].join(',');

  function rngFor(salt) {
    var st = PS.engine.getState();
    return PS.rng.create(PS.rng.hash(st ? st.runSeed : 1, 'autoplay', salt, sceneClicks, Date.now() >> 8));
  }

  function weightOf(node) {
    var cls = node.className || '';
    if (typeof cls !== 'string') cls = '';
    if (cls.indexOf('pz-btn--danger') >= 0) return 0.05;    // "turn back" — rarely
    if (cls.indexOf('pz-btn--ghost') >= 0) return 0.02;     // menu — basically never
    if (cls.indexOf('pz-choice') >= 0) return 3;            // real branches are the point
    if (cls.indexOf('pz-esc-obj') >= 0) return 2.2;
    if (cls.indexOf('pz-esc-key') >= 0) return 1.1;
    return 1;
  }

  function isDanger(node) {
    var cls = node.className || '';
    return typeof cls === 'string' && cls.indexOf('pz-btn--danger') >= 0;
  }

  /**
   * Down-weighting danger to 0.05 only helps while something else is on offer.
   * In an arena scene the give-up button sits on the foot and stays enabled
   * with the panel shut, so once the walking is done it is frequently the ONLY
   * candidate — and a weighted pick from a pool of one takes it every time,
   * whatever its weight. The bot was forfeiting scenes it could solve.
   *
   * So danger controls are off the table until the bot has actually spent its
   * scene trying. Late on they come back, because several of them are real
   * branches ("force it", "break cover and run") rather than surrenders, and
   * the bot should still cover those.
   */
  function desperate() {
    return sceneClicks > CLICK_BUDGET * 0.6 ||
           (Date.now() - sceneStart) > TIME_BUDGET * 0.6;
  }

  /* --------------------------------------------------------------- arena -- */
  /* A bot cannot press W. arena.botGoTo() walks the real tile path instantly,
     firing every step event a human walk would, so an arena scene plays out
     exactly the same way — and works with no frames at all.                  */

  function driveArena() {
    var ar = PS.arena && PS.arena.active();
    if (!ar) return false;
    if (arenaMoves > ARENA_BUDGET) return false;

    var targets = ar.botTargets();
    if (!targets.length) return false;

    var here = ar.player();
    var props = [], stations = [];
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (t.done || t.skip || !t.reachable) continue;
      (t.kind === 'station' ? stations : props).push(t);
    }

    // Strip the room first, then go and use the console. That is what a
    // scavenger would do, and it exercises far more of each engine.
    var pool = props.length ? props : stations;
    if (!pool.length) return false;

    var best = null, bestD = 1e9;
    for (var j = 0; j < pool.length; j++) {
      var d = Math.abs(pool[j].x - here.tx) + Math.abs(pool[j].y - here.ty);
      if (d < bestD) { bestD = d; best = pool[j]; }
    }
    if (!best) return false;

    arenaMoves++;
    if (!ar.botGoTo(best.id)) return false;
    ar.botInteract();
    return true;
  }

  function clickSomething() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll(SELECTOR));
    if (!nodes.length) return false;
    if (!desperate()) {
      var safe = [];
      for (var i = 0; i < nodes.length; i++) if (!isDanger(nodes[i])) safe.push(nodes[i]);
      // Nothing constructive left. Say so rather than reaching for the exit —
      // the caller falls back to autoSolve(), which is a real solve.
      if (!safe.length) return false;
      nodes = safe;
    }
    var rng = rngFor('click');
    var node = rng.weighted(nodes, weightOf);
    if (!node) return false;
    node.click();
    sceneClicks++;
    return true;
  }

  function giveUpOnScene() {
    var scene = PS.engine.currentScene();
    if (!scene || scene.finished) return;
    var engine = scene.engine;

    if (typeof engine.autoSolve === 'function') {
      var result;
      try {
        result = engine.autoSolve(scene.puzzle, rngFor('solve'), PS.engine.getState(), scene.tier, scene.skin);
      } catch (e) {
        if (root.console) console.warn('[autoplay] autoSolve threw in "' + engine.id + '":', e);
      }
      if (result) {
        PS.ui.toast('bot: solved ' + engine.id + ' the quiet way', 'info', 1800);
        scene.api.finish(result);
        return;
      }
    }
    PS.ui.toast('bot: forfeits ' + engine.id, 'bad', 1800);
    PS.engine.skipScene();
  }

  function tick() {
    if (!running) return;

    // Title screen up? Start a run.
    if (PS.engine.isPaused()) {
      PS.ui.hideTitle();
      PS.engine.newRun(PS.autoplay.seed || null);
      return;
    }

    var scene = PS.engine.currentScene();

    if (scene && !scene.finished) {
      var overClicks = sceneClicks > CLICK_BUDGET;
      var overTime = (Date.now() - sceneStart) > TIME_BUDGET;
      if (overClicks || overTime) { giveUpOnScene(); return; }
    }

    // An arena scene is walked, not clicked. Walk first; whatever panel that
    // opens is ordinary DOM the click path already knows how to drive.
    if (driveArena()) { updateBadge(); return; }

    // Walked out of things to do and nothing constructive left to press: take
    // the engine's own solution rather than idling until the budget expires.
    if (!clickSomething() && scene && !scene.finished) giveUpOnScene();
    updateBadge();
  }

  function updateBadge() {
    var st = PS.engine.getState();
    var scene = PS.engine.currentScene();
    badge = PS.ui.devBadge(
      'BOT \u00B7 ' + (scene ? scene.engine.id : 'crossroad') +
      (PS.arena && PS.arena.active() ? ' \u00B7 walking' : '') +
      ' \u00B7 depth ' + (st ? st.depth : 0) +
      ' \u00B7 scenes ' + sceneCount
    );
  }

  function start(opts) {
    opts = opts || {};
    if (running) return;
    running = true;
    speed = Math.max(0.25, Math.min(8, opts.speed || 1));
    PS.autoplay.seed = opts.seed || null;

    PS.engine.on(function (evt) {
      if (evt === 'scene') { sceneClicks = 0; arenaMoves = 0; sceneStart = Date.now(); sceneCount++; }
    });

    if (root.console) console.info('[autoplay] running. ?speed=2 to go faster, ?dev=0 to stop.');
    timer = setInterval(tick, Math.round(620 / speed));
    updateBadge();
  }

  function stop() {
    running = false;
    if (timer) { clearInterval(timer); timer = null; }
    if (badge && badge.parentNode) badge.parentNode.removeChild(badge);
    badge = null;
  }

  PS.autoplay = { start: start, stop: stop, seed: null, isRunning: function () { return running; } };

})(typeof window !== 'undefined' ? window : this);
