/* ==========================================================================
   PuzzleStudio — js/games/e12_timing_bar.js          ENGINE 12 · Timing Bar
   --------------------------------------------------------------------------
   THE ONE TWITCH GAME. Self-contained: logic + 3 skins + its own CSS.
   No DOM access until mount().

   THE PUZZLE
     A marker sweeps back and forth across a bar. Somewhere on that bar is a
     safe band. Hit space, enter, or click, and wherever the marker is when you
     do is where you land. Then the next gap: narrower band, faster sweep.

     That is the whole game and it is deliberately the whole game. Nineteen of
     these engines are things you sit and think about. This one exists to make
     you stop thinking for forty seconds, and it should feel like being out of
     breath. Short, tense, physical.

   THE RULES THAT MATTER
     Every attempt costs ENERGY, so it gates on having some.
     A miss costs HEALTH and never ends the run. You do not fall to your death
     here; you land badly, get up, and go again with less in the tank.
     Tier makes the band narrower, the sweep faster, and adds gaps.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio;
  if (!PS || !PS.registry) { if (root.console) console.error('[e12] core not loaded'); return; }

  /* ======================================================== SKIN CONTENT == */

  var CONTENT = {
    rooftop_gap: {
      unit: 'gap', unitPlural: 'gaps', verb: 'Jump', runner: '\uD83C\uDFC3',
      markerIcon: '\uD83C\uDFC3', zoneIcon: '\uD83E\uDDF1', barLabel: 'The gap',
      sweepIcon: '\uD83D\uDCA8', plateIcon: '\uD83E\uDE9C',
      ready: ['Line it up.', 'Wind is crossing.', 'Do not look down.', 'Shorter run-up this time.', 'Gravel underfoot.'],
      hit:   ['You land rolling.', 'Both feet, clean.', 'Gravel skids, you keep it.', 'Straight through.'],
      perfect: ['Dead centre. You barely feel it.', 'Perfect. You are already running again.'],
      miss:  ['You come down short and slam into the parapet.', 'Your foot catches the lip and you go down hard.', 'You clip the edge. Something in your knee complains.'],
      cleared: 'You are across the last of the roofs.',
      failedAll: 'You are on the far side, but nothing about that was clean.',
      onward: { icon: '\uD83C\uDFC3', title: 'Keep running the roofline', desc: 'You have the rhythm and the roofs keep going. Do not stop while you have it.' },
      breathe: { icon: '\uD83E\uDEC1', title: 'Drop into the stairwell', desc: 'Get off the skyline, get your breath back, take the inside route.' }
    },
    conveyor_jump: {
      unit: 'belt', unitPlural: 'belts', verb: 'Step', runner: '\uD83D\uDC5F',
      markerIcon: '\uD83D\uDC5F', zoneIcon: '\uD83D\uDFE8', barLabel: 'The belt',
      sweepIcon: '\u2699\uFE0F', plateIcon: '\uD83D\uDFE8',
      ready: ['The belt is up to speed.', 'Wait for the gap in the load.', 'Rollers, then plate, then rollers.', 'It does not stop for you.', 'Count it in.'],
      hit:   ['You ride the plate across.', 'On, and off, and moving.', 'You catch the flat section.', 'Clean transfer.'],
      perfect: ['Middle of the plate. Textbook.', 'You barely break stride.'],
      miss:  ['Your boot goes into the rollers and the belt takes it for a metre.', 'You land on the seam and it throws you into the guard rail.', 'The plate is gone. You go down onto moving steel.'],
      cleared: 'The line runs on without you. You are past it.',
      failedAll: 'You made it off the line. The line got its share.',
      onward: { icon: '\u26A1', title: 'Follow the line out', desc: 'The conveyor goes somewhere and somewhere is better than here.' },
      breathe: { icon: '\uD83D\uDEE0\uFE0F', title: 'Kill it at the panel', desc: 'Stop the belt, sit down on it, and let your hands stop shaking.' }
    },
    rockfall_dash: {
      unit: 'run', unitPlural: 'runs', verb: 'Break', runner: '\uD83E\uDDCD',
      markerIcon: '\uD83E\uDDCD', zoneIcon: '\uD83D\uDFE7', barLabel: 'The lull',
      sweepIcon: '\uD83E\uDEA8', plateIcon: '\uD83D\uDFE7',
      ready: ['Listen for the lull.', 'It comes in waves. Wait for the trough.', 'Dust first, then stone.', 'The roof is talking.', 'Count between falls.'],
      hit:   ['You make the next pillar.', 'Stone lands where you were.', 'Through, and pressed against rock.', 'You get under the overhang.'],
      perfect: ['You move in the dead silence between falls.', 'Not a pebble touches you.'],
      miss:  ['A fist of rock catches your shoulder and puts you on the floor.', 'The roof lets go early and half of it finds you.', 'You mistime it and take the fall across your back.'],
      cleared: 'The drift opens out and the noise stops.',
      failedAll: 'You are through. You are also bleeding in several places.',
      onward: { icon: '\uD83E\uDD3F', title: 'Push on down the drift', desc: 'The rock is quiet here and quiet does not last. Use it.' },
      breathe: { icon: '\uD83E\uDEA8', title: 'Get under the overhang', desc: 'Solid rock over your head and a minute to work out what is broken.' }
    }
  };

  /* ============================================================== BUILD == */

  /**
   * A gap: where the safe band sits, how wide it is, and how fast the marker
   * crosses the bar. Everything in percent of bar width so the CSS is trivial
   * and the maths is resolution-independent.
   *
   * The number that actually decides whether a gap is fair is DWELL — how long
   * the marker spends inside the band, i.e. width / speed. The curve below runs
   * from about 480ms at tier 1 down to about 120ms on the last gap of tier 6.
   * Below roughly 100ms a gap stops being a reflex test and starts being a coin
   * toss, so the clamps exist to keep it on the honest side of that line.
   */
  function build(state, rng, tier, skin) {
    var C = CONTENT[skin.id] || CONTENT.rooftop_gap;
    var t = Math.min(6, tier);

    var count = Math.min(6, 3 + Math.floor(t / 2));      // 3..6 gaps
    var gaps = [];

    for (var i = 0; i < count; i++) {
      // Each gap is narrower AND faster than the last, and tier shifts both.
      var width = 28 - i * 1.1 - t * 1.1 + rng.range(-0.8, 0.8);
      width = Math.max(12, Math.min(30, width));

      var speed = 48 + i * 7.5 + t * 7.5 + rng.range(-4, 4);   // percent of bar per second
      speed = Math.max(42, Math.min(145, speed));

      // Never centre the band — a band that always sits in the middle is a band
      // you can hit with your eyes shut.
      var lo = 8, hi = 92 - width;
      var pos = rng.range(lo, hi);
      var mid = 50 - width / 2;
      if (Math.abs(pos - mid) < 9) pos += (pos < mid ? -9 : 9);
      pos = Math.max(lo, Math.min(hi, pos));

      gaps.push({
        pos: pos,
        width: width,
        speed: speed,
        startAt: rng.range(0, 100),
        dir: rng.chance(0.5) ? 1 : -1,
        result: null,          // 'perfect' | 'hit' | 'miss'
        landedAt: null,
        readyLine: C.ready[i % C.ready.length]
      });
    }

    return {
      gaps: gaps,
      index: 0,
      hits: 0,
      perfects: 0,
      misses: 0,
      energyPer: 2 + Math.floor(t / 2),
      missDamage: 4 + Math.round(t * 1.3),
      perfectBand: 0.34,      // fraction of the band's half-width that counts as perfect
      done: false,
      tier: t,
      content: C
    };
  }


  /* ================================================================ CSS == */
  /* The course is the arena's canvas now. What is left here is the readout
     strip that lives under it: which gap you are on, how each one went, and
     the two numbers that decide whether a gap is fair. */

  var CSS = [
    '.pz-timing{display:flex;flex-direction:column;gap:12px;width:100%}',

    '.pz-timing-head{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap}',
    '.pz-timing-head__t{font-size:15px;font-weight:700;color:var(--text)}',
    '.pz-timing-head__s{font-size:12px;color:var(--dim);line-height:1.5}',
    '.pz-timing-head__c{font-family:var(--font-mono);font-size:12px;color:var(--acc-2);white-space:nowrap}',

    '.pz-timing-pips{display:flex;gap:6px;flex-wrap:wrap}',
    '.pz-timing-pip{width:26px;height:6px;border-radius:3px;background:var(--panel-3);border:1px solid var(--line);',
    '  transition:background .3s var(--ease),box-shadow .3s var(--ease)}',
    '.pz-timing-pip.is-now{background:var(--acc);box-shadow:0 0 12px var(--acc-glow)}',
    '.pz-timing-pip.is-hit{background:var(--good);border-color:var(--good)}',
    '.pz-timing-pip.is-perfect{background:var(--good);border-color:var(--good);box-shadow:0 0 12px rgba(95,207,141,.55)}',
    '.pz-timing-pip.is-miss{background:var(--bad);border-color:var(--bad)}',

    '.pz-timing-tell{display:flex;gap:14px;flex-wrap:wrap;font-family:var(--font-mono);font-size:11px;color:var(--dim)}',
    '.pz-timing-tell b{color:var(--acc-2)}',
    '.pz-timing-tell .is-bad{color:var(--bad)}',

    '.pz-timing-say{font-size:13px;line-height:1.6;color:var(--text-2);min-height:22px}',
    '.pz-timing-say.is-bad{color:var(--bad)}',
    '.pz-timing-say.is-good{color:var(--good)}',

    '.pz-timing-cap{font-family:var(--font-mono);font-size:10.5px;padding:2px 7px;border-radius:5px;',
    '  background:#0c1016;border:1px solid var(--line);border-bottom-width:2px;color:var(--text-2)}',

    '.pz-timing-arrive{font-size:13px;line-height:1.65;color:var(--text-2);margin-bottom:12px}',
    '.pz-timing-arrive b{color:var(--acc-2)}'
  ].join('\n');

  /* ============================================================ THE COURSE */
  /*
   * The abstract bar becomes a corridor you run down: ledge, chasm, ledge,
   * chasm. Nothing about the numbers changed — the marker still sweeps at
   * `speed` percent of the span per second, the landing is still `width`
   * percent wide, and the window you have to commit in is still
   * width / speed seconds, from about 490ms at tier 1 to about 120ms on the
   * last gap of tier 6. What changed is where that window lives: it is now
   * the moment the bridge is actually across the gap, and you spend it by
   * arriving at the edge with your body rather than by pressing a key.
   *
   * Committing is judged and then RESOLVED — you are thrown across or you are
   * thrown back. The player never stands in the gap, so there is no way to
   * dawdle in mid-air and no way to get wedged in a tile that just went solid.
   */

  var LANE  = 9;      // playable rows; the marker sweeps the length of these
  var RUN   = 4;      // ledge columns between gaps — the run-up
  var GAPW  = 3;      // chasm columns
  var PLATE_OFF = ' ';    // the arena substitutes a star for a falsy icon, so
                          // "no bridge" has to be a space, not an empty string
  var PRESS_IN  = 0.63;   // how flush against the lip counts as "committed"
  var PRESS_OUT = 0.44;   // and how far back you must come to line up again
  var JUDGE_COOL = 0.3;   // seconds, so one shove at the lip is one attempt
  var KNOCKBACK = 2;      // tiles you are thrown back by a bad landing

  function courseWidth(count) { return 2 + RUN + count * (GAPW + RUN); }
  function chasmX(i) { return 1 + RUN + i * (GAPW + RUN); }
  function launchX(i) { return chasmX(i) - 1; }
  function landX(i) { return chasmX(i) + GAPW; }

  function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

  /* ================================================================ MOUNT = */

  var live = null;   // the one active scene; unmount() kills whatever is in here

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var C = puzzle.content;
    var count = puzzle.gaps.length;

    var finished = false;
    var arena = null;
    var plates = [];        // per gap: array of prop handles across the chasm
    var pads = [];          // per gap: the "press E to go" marker on the lip
    var lastOpen = null;
    var pressed = false;
    var cool = 0;
    var hudT = 0;

    /* --------------------------------------------------------------- dom -- */

    var pipsEl = h('div', { class: 'pz-timing-pips' });
    var tellEl = h('div', { class: 'pz-timing-tell' });
    var sayEl  = h('div', { class: 'pz-timing-say' });
    var counterEl = h('div', { class: 'pz-timing-head__c' });
    var stage = h('div', {});
    var endEl = h('div', {});

    var wrap = h('div', { class: 'pz-timing' }, [
      h('div', { class: 'pz-timing-head' }, [
        h('div', {}, [
          h('div', { class: 'pz-timing-head__t', text: C.barLabel }),
          h('div', { class: 'pz-timing-head__s' }, [
            'Run at the edge \u2014 or stand on the mark and hit ',
            h('b', { class: 'pz-timing-cap', text: 'SPACE' }),
            '. You go when the crossing is there and not a moment after. Every ',
            C.unit, ' after this one is narrower and faster.'
          ])
        ]),
        counterEl
      ]),
      pipsEl,
      stage,
      sayEl,
      tellEl,
      endEl
    ]);
    PS.ui.append(el, wrap);

    /* -------------------------------------------------------------- util -- */

    function gap() { return puzzle.gaps[puzzle.index]; }

    function pick(arr) {
      // Flavour only, but it still has to come from the seeded rng: replaying a
      // seed must reproduce the run exactly, including what the scene said to you.
      return api.rng.pick(arr);
    }

    function say(text, kind) {
      sayEl.className = 'pz-timing-say' + (kind ? ' is-' + kind : '');
      sayEl.textContent = text;
    }

    function paintPips() {
      PS.ui.clear(pipsEl);
      for (var i = 0; i < puzzle.gaps.length; i++) {
        var g = puzzle.gaps[i];
        var cls = 'pz-timing-pip';
        if (g.result === 'perfect') cls += ' is-perfect';
        else if (g.result === 'hit') cls += ' is-hit';
        else if (g.result === 'miss') cls += ' is-miss';
        else if (i === puzzle.index && !puzzle.done) cls += ' is-now';
        pipsEl.appendChild(h('div', { class: cls }));
      }
      counterEl.textContent = puzzle.done
        ? 'done'
        : (C.unit + ' ' + Math.min(puzzle.index + 1, puzzle.gaps.length) + ' of ' + puzzle.gaps.length);
    }

    function paintTell() {
      var g = gap();
      PS.ui.clear(tellEl);
      var lowEnergy = state.stats.energy < puzzle.energyPer * 2;
      PS.ui.append(tellEl, [
        h('span', {}, ['crossing ', h('b', { text: g ? g.width.toFixed(1) + '%' : '\u2014' }), ' wide']),
        h('span', {}, ['sweep ', h('b', { text: g ? Math.round(g.speed) + '%/s' : '\u2014' })]),
        h('span', {}, ['window ', h('b', { text: g ? Math.round(g.width / g.speed * 1000) + 'ms' : '\u2014' })]),
        h('span', { class: lowEnergy ? 'is-bad' : '' }, ['costs ', h('b', { text: '\u26A1 ' + puzzle.energyPer }), ' a go']),
        h('span', {}, ['a miss ', h('b', { class: 'is-bad', text: '\u2764\uFE0F -' + puzzle.missDamage })]),
        h('span', {}, ['clean ', h('b', { text: puzzle.hits + '/' + puzzle.gaps.length })])
      ]);
    }

    /* ------------------------------------------------------------ endings -- */

    function choiceBtn(spec, id) {
      return h('button', {
        class: 'pz-choice', type: 'button',
        onclick: function () { finishRun(id); }
      }, [
        h('div', { class: 'pz-choice__i', text: spec.icon }),
        h('div', { class: 'pz-choice__t', text: spec.title }),
        h('div', { class: 'pz-choice__d', text: spec.desc })
      ]);
    }

    function endChoices() {
      return h('div', { class: 'pz-choices' }, [
        choiceBtn(C.onward, 'sprint'),
        choiceBtn(C.breathe, 'rest')
      ]);
    }

    function endLine() {
      var clean = puzzle.misses === 0;
      return (clean ? C.cleared : C.failedAll) + ' ' +
        puzzle.hits + ' of ' + puzzle.gaps.length + ' clean' +
        (puzzle.perfects ? ', ' + puzzle.perfects + ' of those dead centre' : '') + '.';
    }

    function finishRun(choice) {
      if (finished) return;
      finished = true;

      var clean = puzzle.misses === 0;
      var mostly = puzzle.hits >= Math.ceil(puzzle.gaps.length * 0.6);
      var tags = ['crossed_the_gaps'];
      if (clean) tags.push('never_missed_a_step');
      if (puzzle.perfects >= 2) tags.push('quick_feet');
      if (puzzle.misses >= 3) tags.push('took_a_fall');

      api.finish({
        outcome: clean ? 'success' : (mostly ? 'partial' : 'fail'),
        stats: {
          morale: clean ? 9 : (mostly ? 1 : -7),
          energy: choice === 'rest' ? 6 : -4,
          health: choice === 'rest' ? 2 : 0
        },
        gain: [], lose: [],
        tags: tags,
        signals: {
          speed: clean ? 3 : (mostly ? 2 : 1),
          brute: 2,
          caution: choice === 'rest' ? 2 : 0,
          logic: puzzle.perfects >= 2 ? 1 : 0
        },
        choice: choice,
        summary: clean
          ? 'You took every ' + C.unit + ' clean and never broke stride.'
          : (mostly
            ? 'You made it across, ' + puzzle.misses + ' hard landing' + (puzzle.misses === 1 ? '' : 's') + ' on the way.'
            : 'You went down more often than you stayed up, and got there anyway.')
      });
    }

    function bailOut() {
      if (finished || puzzle.done) return;
      finished = true;
      api.finish({
        outcome: 'fail',
        stats: { energy: -10, morale: -8 },
        gain: [], lose: [],
        tags: ['backed_off_the_edge'],
        signals: { caution: 3 },
        choice: null,
        summary: 'You stood on the edge, did the arithmetic, and went the long way round instead.'
      });
    }

    /* ------------------------------------------------------- degraded mode -- */

    if (!PS.arena || typeof PS.arena.create !== 'function') {
      PS.ui.append(endEl, [h('div', { class: 'pz-intro', text: endLine() }), endChoices()]);
      paintPips();
      paintTell();
      return;
    }

    /* ------------------------------------------------------------- course -- */

    var MW = courseWidth(count), MH = LANE + 2;
    var tiles = [], y, x, row, i;
    for (y = 0; y < MH; y++) {
      row = [];
      for (x = 0; x < MW; x++) row.push((y === 0 || y === MH - 1 || x === 0 || x === MW - 1) ? 1 : 0);
      tiles.push(row);
    }
    // The chasms are solid all the way through. You cannot walk a gap; the only
    // way past one is to be thrown across it, which is the whole engine.
    for (i = 0; i < count; i++) {
      for (x = chasmX(i); x < chasmX(i) + GAPW; x++) {
        for (y = 1; y < MH - 1; y++) tiles[y][x] = 1;
      }
    }

    var midRow = Math.round((LANE + 1) / 2);
    var exitAt = landX(count - 1) + 2;

    arena = PS.arena.create(stage, {
      map: { w: MW, h: MH, tiles: tiles },
      spawn: { x: 2, y: midRow },
      avatar: C.runner,
      light: state.stats.light,
      lightCurve: function (v) { return 3.0 + Math.max(0, Math.min(100, v)) / 100 * 2.2; },
      tileSize: 42,
      darkness: 0.8,
      memory: 0.7,
      onTick: onTick
    });
    if (!arena) {
      PS.ui.append(endEl, [h('div', { class: 'pz-intro', text: endLine() }), endChoices()]);
      paintPips();
      paintTell();
      return;
    }

    live = {
      stop: function () {
        // The most timing-sensitive scene in the game owns exactly one thing —
        // the arena — and it owns no timers and no frame loop of its own, so
        // there is precisely one thing to kill and this kills it.
        finished = true;
        if (arena) { arena.destroy(); arena = null; }
        plates.length = 0;
        pads.length = 0;
      }
    };
    arena.revealAll();

    /* ------------------------------------------------------- the sweep ---- */
    /* One marker per gap, running the length of the lane. It covers the lane in
       100 / speed seconds and comes back in the same, so the bridge is up for
       width / speed out of every 200 / speed — the dwell curve, untouched, now
       measured in bridge rather than in bar. */

    for (i = 0; i < count; i++) {
      (function (gi) {
        var g = puzzle.gaps[gi];
        var cx = chasmX(gi) + 1;                       // the middle of the chasm
        var handle = arena.patrol({
          route: [[cx, 1], [cx, LANE]],
          speed: (LANE - 1) * g.speed / 100,
          wait: 0,
          icon: C.sweepIcon,
          label: C.barLabel,
          vision: false
        });
        g._raw = handle && handle.raw;
        phase(g);
        plates.push(null);
        pads.push(null);
      })(i);
    }

    /** The bridge for one gap: a plate on every tile of the chasm, present or
        absent together. Only the gap in front of you has them — a chasm you
        have already crossed is just a hole in the roofline again. */
    function makePlates(gi) {
      clearPlates(gi);
      if (gi >= count) return;
      var pl = [];
      for (var px = chasmX(gi); px < chasmX(gi) + GAPW; px++) {
        for (var py = 1; py <= LANE; py++) {
          pl.push(arena.prop({
            x: px, y: py, icon: PLATE_OFF, label: ' ', hint: ' ',
            trigger: 'press', radius: -1, glow: false, emits: 0,
            once: false, botSkip: true,
            onActivate: function () { /* scenery */ }
          }));
        }
      }
      plates[gi] = pl;
    }

    function clearPlates(gi) {
      var pl = plates[gi];
      if (!pl) return;
      for (var k = 0; k < pl.length; k++) pl[k].remove();
      plates[gi] = null;
    }

    /** Put the marker where build() said it starts, going the way it said. */
    function phase(g) {
      var raw = g._raw;
      if (!raw || !raw.route || raw.route.length < 2) return;
      var f = clamp01((g.startAt || 0) / 100);
      var leg = g.dir < 0 ? 1 : 0;
      var t = g.dir < 0 ? (1 - f) : f;
      raw.leg = leg;
      raw.t = Math.min(0.999, Math.max(0, t));
      var a = raw.route[leg], b = raw.route[(leg + 1) % raw.route.length];
      raw.x = a[0] + (b[0] - a[0]) * raw.t;
      raw.y = a[1] + (b[1] - a[1]) * raw.t;
      raw.dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
    }

    /** Where the marker is, on the same 0..100 scale build() reasoned in. */
    function markerPct(g) {
      if (!g || !g._raw) return 50;
      return clamp01((g._raw.y - 1.5) / (LANE - 1)) * 100;
    }

    function isOpen(g) {
      var m = markerPct(g);
      return m >= g.pos && m <= g.pos + g.width;
    }

    function setPlates(gi, icon) {
      var pl = plates[gi];
      if (!pl) return;
      for (var k = 0; k < pl.length; k++) pl[k].setIcon(icon);
    }

    /* ---------------------------------------------------------- the ledge -- */

    function makePad(gi) {
      if (pads[gi]) { pads[gi].remove(); pads[gi] = null; }
      if (gi >= count) return;
      pads[gi] = arena.prop({
        x: launchX(gi), y: midRow,
        icon: '\u2757', label: C.verb + ' ' + C.barLabel.toLowerCase(), hint: 'press E when it is there',
        trigger: 'press', radius: 2.2, glow: true, emits: 0.9, tint: '#e2a84e',
        once: false, botSkip: false,
        onActivate: function () { judge(); }
      });
    }

    /**
     * The arena marks a prop used the moment it fires, which is right for a
     * cache and wrong for a starting line you are meant to come back to. Clear
     * it after every attempt so the mark stays live — and so the autoplay bot,
     * which only ever walks to things it has not used, can keep trying.
     */
    function refreshPad() {
      var p = pads[puzzle.index];
      if (p && p.raw) p.raw.done = false;
    }

    var exitStation = arena.station({
      x: exitAt, y: midRow,
      icon: C.onward.icon, label: 'The far side', hint: 'walk in, or press E',
      radius: 1.3, emits: 1.9,
      onEnter: function (panel) {
        PS.ui.append(panel, [
          h('div', { class: 'pz-timing-arrive', text: endLine() }),
          endChoices()
        ]);
      }
    });

    /* ------------------------------------------------------------- commit -- */

    function armGap() {
      var g = gap();
      lastOpen = null;
      if (!g) return;
      makePlates(puzzle.index);
      makePad(puzzle.index);
      say(g.readyLine);
      paintPips();
      paintTell();
      arena.ping(launchX(puzzle.index), midRow);
    }

    /**
     * One attempt. Whatever the marker reads at this instant is where you come
     * down — exactly the old bar, judged at the moment your shoulder hits the
     * lip instead of at the moment you hit the key.
     */
    function judge() {
      if (finished || puzzle.done) return;
      if (cool > 0) { refreshPad(); return; }
      var g = gap();
      if (!g || !arena) return;

      cool = JUDGE_COOL;
      var pl = arena.player();
      var m = markerPct(g);
      g.landedAt = m;

      var left = g.pos, right = g.pos + g.width;
      var centre = g.pos + g.width / 2;
      var inside = m >= left && m <= right;
      var perfect = inside && Math.abs(m - centre) <= (g.width / 2) * puzzle.perfectBand;

      // Every attempt is paid for whether it lands or not.
      var tweak = { energy: -puzzle.energyPer };

      if (perfect) {
        g.result = 'perfect';
        puzzle.hits++; puzzle.perfects++;
        tweak.morale = 4;
        api.toast(pick(C.perfect), 'good', 1500);
        say(pick(C.perfect), 'good');
      } else if (inside) {
        g.result = 'hit';
        puzzle.hits++;
        tweak.morale = 2;
        say(pick(C.hit), 'good');
      } else {
        g.result = 'miss';
        puzzle.misses++;
        // A miss is a hard landing, never a death. The run always continues.
        tweak.health = -puzzle.missDamage;
        tweak.morale = -3;
        api.toast(pick(C.miss), 'bad', 1900);
        say(pick(C.miss), 'bad');
      }

      api.tweak(tweak);

      if (inside) {
        var lx = landX(puzzle.index);
        arena.dust(launchX(puzzle.index), pl.ty, 10, '#f8d493');
        arena.teleport(lx, pl.ty);
        arena.ping(lx, pl.ty, perfect ? '#5fcf8d' : null);
        if (perfect) arena.shake(4, 0.18);
        setPlates(puzzle.index, PLATE_OFF);
        clearPlates(puzzle.index);
        if (pads[puzzle.index]) { pads[puzzle.index].remove(); pads[puzzle.index] = null; }
        puzzle.index++;
        if (puzzle.index >= puzzle.gaps.length) runOut();
        else armGap();
      } else {
        arena.hit('#e2695f');
        arena.shake(11, 0.4);
        arena.dust(launchX(puzzle.index), pl.ty, 14, '#e2695f');
        arena.teleport(Math.max(1, launchX(puzzle.index) - KNOCKBACK), pl.ty);
        refreshPad();                    // the mark stays live; go again
        paintPips();
        paintTell();
      }
      paintHud();
    }

    function runOut() {
      puzzle.done = true;
      lastOpen = null;
      paintPips();
      paintTell();
      say(endLine(), puzzle.misses === 0 ? 'good' : null);
      api.flash();
      if (arena) arena.ping(exitAt, midRow);
      if (exitStation) exitStation.pulse();
    }

    /* --------------------------------------------------------------- tick -- */

    function onTick(dt) {
      if (finished || !arena) return;
      if (cool > 0) cool -= dt;
      hudT += dt;

      var g = gap();
      if (g && !puzzle.done) {
        var open = isOpen(g);
        if (open !== lastOpen) {
          lastOpen = open;
          setPlates(puzzle.index, open ? C.plateIcon : PLATE_OFF);
        }

        // Arriving at the lip IS the commit. You have to come off it and line
        // up again before you get another go, which is what makes it a run-up
        // rather than a button you can lean on.
        var pl = arena.player();
        var lx = launchX(puzzle.index);
        if (!pressed) {
          if (pl.tx === lx && pl.x >= lx + PRESS_IN) { pressed = true; judge(); }
        } else if (pl.tx !== lx || pl.x < lx + PRESS_OUT) {
          pressed = false;
        }
      }

      if (hudT >= 0.1) { hudT = 0; paintHud(); }
    }

    /* ---------------------------------------------------------------- HUD -- */

    var cGap  = arena.chip(C.unit, '\uD83D\uDD73\uFE0F');
    var cRun  = arena.chip('Clean', '\u2705');
    var mWin  = arena.meter('Crossing', '\u23F1\uFE0F');

    arena.note('The crossing is only there for a moment at a time. Watch the mark, back off, line it up, and go on the beat.');
    arena.button('\u21A9 Not worth it \u2014 go around', bailOut, 'pz-btn--danger');

    function paintHud() {
      if (!arena || finished) return;
      var g = gap();
      if (puzzle.done || !g) {
        cGap.set('done', 'good');
        cRun.set(puzzle.hits + '/' + puzzle.gaps.length, puzzle.misses ? 'warn' : null);
        mWin.set(0, 'across');
        return;
      }
      var m = markerPct(g);
      var open = isOpen(g);
      var away = open ? 0 : Math.min(Math.abs(m - g.pos), Math.abs(m - (g.pos + g.width)));
      cGap.set((puzzle.index + 1) + ' of ' + puzzle.gaps.length);
      cRun.set(puzzle.hits + '/' + puzzle.gaps.length, puzzle.misses ? 'warn' : null);
      mWin.set(open ? 100 : Math.max(0, 100 - away * 3.2), open ? 'GO' : 'wait', open ? null : 'warn');
    }

    /* -------------------------------------------------------------- start -- */

    paintPips();
    paintTell();
    say('Three, two, one.');
    armGap();
    paintHud();
    arena.focus();
  }

  function unmount() {
    if (live) { try { live.stop(); } catch (e) { /* nothing left to save */ } }
    live = null;
  }

  /* ================================================================ HINT = */

  function hint(puzzle) {
    var g = puzzle.gaps[puzzle.index];
    if (!g) return 'It is behind you. Stop looking at it.';
    var side = g.pos + g.width / 2 < 50 ? 'left of centre' : 'right of centre';
    var beat = (100 / g.speed).toFixed(1);
    return 'The landing is ' + side + ', ' + g.width.toFixed(0) + '% wide. The marker crosses the whole bar in about ' +
      beat + ' seconds \u2014 commit a hair early, not late.';
  }

  /* ============================================================ AUTOSOLVE = */
  /* Headless. A bot with human-ish reflexes: the narrower and faster the band,
     the more often it eats concrete. */

  function autoSolve(puzzle, rng) {
    var hits = 0, perfects = 0, misses = 0;
    for (var i = 0; i < puzzle.gaps.length; i++) {
      var g = puzzle.gaps[i];
      // Reaction jitter of roughly 90ms translates into bar-percent by speed.
      var slop = g.speed * 0.09;
      var chance = Math.max(0.12, Math.min(0.96, (g.width / 2) / Math.max(0.6, slop)));
      if (rng.chance(chance)) {
        hits++;
        if (rng.chance(0.3)) perfects++;
      } else {
        misses++;
      }
    }
    var clean = misses === 0;
    var mostly = hits >= Math.ceil(puzzle.gaps.length * 0.6);
    var choice = rng.chance(0.55) ? 'sprint' : 'rest';

    return {
      outcome: clean ? 'success' : (mostly ? 'partial' : 'fail'),
      stats: {
        health: -(misses * puzzle.missDamage),
        energy: -(puzzle.gaps.length * puzzle.energyPer) + (choice === 'rest' ? 6 : -4),
        morale: clean ? 9 : (mostly ? 1 : -7)
      },
      gain: [], lose: [],
      tags: ['crossed_the_gaps'].concat(clean ? ['never_missed_a_step'] : [])
        .concat(misses >= 3 ? ['took_a_fall'] : []),
      signals: { speed: clean ? 3 : 2, brute: 2, caution: choice === 'rest' ? 2 : 0 },
      choice: choice,
      summary: clean
        ? 'Every ' + puzzle.content.unit + ' taken clean, at speed.'
        : misses + ' hard landing' + (misses === 1 ? '' : 's') + ' and still moving.'
    };
  }

  /* ============================================================ REGISTER = */

  PS.registry.register({
    id: 'timing_bar',
    name: 'Timing Bar',
    icon: '\uD83C\uDFC3',
    blurb: 'No thinking. A sweeping marker, a shrinking landing, and your reflexes.',

    favors:   { speed: 3, brute: 2 },
    provides: ['crossing', 'vantage'],
    tagHooks: ['quick_feet', 'never_missed_a_step', 'has_rations'],
    // Costs energy per attempt, so it refuses to run on an empty tank.
    requires: function (state) { return state.stats.energy > 15; },

    css: CSS,

    skins: [
      {
        id: 'rooftop_gap', biome: 'urban', title: 'The Rooftop Gap',
        icon: '\uD83C\uDFD9\uFE0F', palette: 'steel',
        intro: 'Six storeys of nothing between this parapet and the next. The stairwells are all blocked below you and the roofline runs four buildings east. There is no clever way to do this part.',
        nouns: { unit: 'gap', surface: 'gravel roofing', land: 'the far parapet' }
      },
      {
        id: 'conveyor_jump', biome: 'industrial', title: 'The Conveyor Line',
        icon: '\u2699\uFE0F', palette: 'rust',
        intro: 'The belt never stopped when the power failed \u2014 it just kept feeding the dark. Rollers, steel plate, rollers, all of it moving. You cross on the plates or you cross on the rollers.',
        nouns: { unit: 'belt', surface: 'moving steel', land: 'the far walkway' }
      },
      {
        id: 'rockfall_dash', biome: 'underground', title: 'The Rockfall Drift',
        icon: '\uD83E\uDEA8', palette: 'amber',
        intro: 'The roof of the drift comes down in waves, and between the waves there is a lull just long enough to move a person. Everything depends on hearing it start.',
        nouns: { unit: 'run', surface: 'loose scree', land: 'the next pillar' }
      }
    ],

    build: build,
    mount: mount,
    unmount: unmount,
    hint: hint,
    autoSolve: autoSolve
  });

})(typeof window !== 'undefined' ? window : this);
