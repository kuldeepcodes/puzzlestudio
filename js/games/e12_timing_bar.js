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

  var CSS = [
    '.pz-timing{display:flex;flex-direction:column;gap:16px;max-width:760px;margin:0 auto;width:100%}',

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

    '.pz-timing-bar{position:relative;height:82px;border-radius:14px;overflow:hidden;cursor:pointer;user-select:none;',
    '  background:linear-gradient(180deg,#0a0e14,#05070a);border:1px solid var(--line);',
    '  box-shadow:inset 0 0 46px rgba(0,0,0,.85)}',
    '.pz-timing-bar:focus-visible{outline:2px solid var(--acc);outline-offset:3px}',
    '.pz-timing-bar.is-dead{cursor:default;opacity:.62}',
    '.pz-timing-bar.is-shake{animation:pzTimingShake .34s var(--ease)}',
    '.pz-timing-bar.is-pop{animation:pzTimingPop .34s var(--ease)}',

    '.pz-timing-hatch{position:absolute;inset:0;opacity:.5;',
    '  background:repeating-linear-gradient(90deg,transparent 0 19px,rgba(255,255,255,.045) 19px 20px)}',

    '.pz-timing-zone{position:absolute;top:0;bottom:0;border-radius:8px;',
    '  background:linear-gradient(180deg,color-mix(in srgb,var(--acc) 34%,transparent),color-mix(in srgb,var(--acc) 12%,transparent));',
    '  border-left:2px solid var(--acc);border-right:2px solid var(--acc);',
    '  box-shadow:0 0 26px var(--acc-glow);transition:left .18s var(--ease),width .18s var(--ease)}',
    '.pz-timing-core{position:absolute;top:0;bottom:0;background:color-mix(in srgb,var(--acc-2) 30%,transparent)}',

    '.pz-timing-marker{position:absolute;top:0;bottom:0;width:4px;margin-left:-2px;border-radius:2px;',
    '  background:linear-gradient(180deg,#fff,var(--acc-2));box-shadow:0 0 18px rgba(255,255,255,.6)}',
    '.pz-timing-marker::after{content:"";position:absolute;left:50%;top:-1px;width:11px;height:11px;margin-left:-5.5px;',
    '  border-radius:50%;background:var(--acc-2);box-shadow:0 0 14px var(--acc-glow)}',

    '.pz-timing-ghost{position:absolute;top:0;bottom:0;width:3px;margin-left:-1.5px;border-radius:2px;opacity:.85}',
    '.pz-timing-ghost.is-good{background:var(--good)}',
    '.pz-timing-ghost.is-bad{background:var(--bad)}',

    '.pz-timing-face{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;',
    '  font-family:var(--font-mono);font-size:13px;letter-spacing:.16em;text-transform:uppercase;',
    '  color:var(--text-2);text-shadow:0 2px 10px #000;pointer-events:none}',
    '.pz-timing-face b{color:var(--acc-2);font-size:26px;letter-spacing:.04em;display:block;line-height:1.25}',

    '.pz-timing-acts{display:flex;gap:10px;flex-wrap:wrap;align-items:center}',
    '.pz-timing-go{flex:1 1 200px;min-height:52px;font-size:16px;font-weight:800;letter-spacing:.1em;text-transform:uppercase}',

    '.pz-timing-tell{display:flex;gap:14px;flex-wrap:wrap;font-family:var(--font-mono);font-size:11px;color:var(--dim)}',
    '.pz-timing-tell b{color:var(--acc-2)}',
    '.pz-timing-tell .is-bad{color:var(--bad)}',

    '.pz-timing-say{font-size:13px;line-height:1.6;color:var(--text-2);min-height:22px}',
    '.pz-timing-say.is-bad{color:var(--bad)}',
    '.pz-timing-say.is-good{color:var(--good)}',

    '@keyframes pzTimingShake{0%,100%{transform:translateX(0)}18%{transform:translateX(-9px)}38%{transform:translateX(8px)}',
    '  58%{transform:translateX(-5px)}78%{transform:translateX(3px)}}',
    '@keyframes pzTimingPop{0%{box-shadow:inset 0 0 46px rgba(0,0,0,.85)}35%{box-shadow:inset 0 0 60px rgba(95,207,141,.35)}',
    '  100%{box-shadow:inset 0 0 46px rgba(0,0,0,.85)}}'
  ].join('\n');

  /* ================================================================ MOUNT = */

  var live = null;   // the one active scene; unmount() kills whatever is in here

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var C = puzzle.content;

    var rafId = null;
    var timers = [];
    var running = false;      // marker is sweeping and input is armed
    var finished = false;
    var marker = puzzle.gaps[0] ? puzzle.gaps[0].startAt : 50;
    var dir = puzzle.gaps[0] ? puzzle.gaps[0].dir : 1;
    var lastTs = 0;

    /* --------------------------------------------------------------- dom -- */

    var zoneEl   = h('div', { class: 'pz-timing-zone' });
    var coreEl   = h('div', { class: 'pz-timing-core' });
    var markerEl = h('div', { class: 'pz-timing-marker' });
    var ghostEl  = h('div', { class: 'pz-timing-ghost', style: { display: 'none' } });
    var faceEl   = h('div', { class: 'pz-timing-face' });

    var barEl = h('div', {
      class: 'pz-timing-bar', tabindex: '0', role: 'button',
      'aria-label': 'Timing bar. Press space to commit.'
    }, [
      h('div', { class: 'pz-timing-hatch' }),
      zoneEl, coreEl, ghostEl, markerEl, faceEl
    ]);

    var pipsEl = h('div', { class: 'pz-timing-pips' });
    var tellEl = h('div', { class: 'pz-timing-tell' });
    var sayEl  = h('div', { class: 'pz-timing-say' });
    var goBtn  = h('button', { class: 'pz-btn pz-btn--primary pz-timing-go', type: 'button' }, ['\u23CE  Go']);
    var actsEl = h('div', { class: 'pz-timing-acts' }, [goBtn]);
    var endEl  = h('div', {});
    var counterEl = h('div', { class: 'pz-timing-head__c' });

    /* -------------------------------------------------------------- util -- */

    function after(ms, fn) {
      var id = root.setTimeout(function () {
        var i = timers.indexOf(id);
        if (i >= 0) timers.splice(i, 1);
        if (!finished) fn();
      }, ms);
      timers.push(id);
      return id;
    }

    function stopLoop() {
      if (rafId !== null) {
        if (root.cancelAnimationFrame) root.cancelAnimationFrame(rafId);
        else root.clearTimeout(rafId);
        rafId = null;
      }
    }

    function killTimers() {
      for (var i = 0; i < timers.length; i++) root.clearTimeout(timers[i]);
      timers.length = 0;
    }

    function gap() { return puzzle.gaps[puzzle.index]; }

    /* ------------------------------------------------------------ render -- */

    function paintZone() {
      var g = gap();
      if (!g) return;
      zoneEl.style.left = g.pos + '%';
      zoneEl.style.width = g.width + '%';
      var coreW = g.width * puzzle.perfectBand;
      coreEl.style.left = (g.pos + g.width / 2 - coreW / 2) + '%';
      coreEl.style.width = coreW + '%';
    }

    function paintMarker() {
      markerEl.style.left = marker + '%';
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
        h('span', {}, ['landing ', h('b', { text: g ? g.width.toFixed(1) + '%' : '\u2014' }), ' wide']),
        h('span', {}, ['sweep ', h('b', { text: g ? Math.round(g.speed) + '%/s' : '\u2014' })]),
        h('span', { class: lowEnergy ? 'is-bad' : '' }, ['costs ', h('b', { text: '\u26A1 ' + puzzle.energyPer }), ' a go']),
        h('span', {}, ['a miss ', h('b', { class: 'is-bad', text: '\u2764\uFE0F -' + puzzle.missDamage })]),
        h('span', {}, ['clean ', h('b', { text: puzzle.hits + '/' + puzzle.gaps.length })])
      ]);
    }

    function say(text, kind) {
      sayEl.className = 'pz-timing-say' + (kind ? ' is-' + kind : '');
      sayEl.textContent = text;
    }

    function face(big, small) {
      PS.ui.clear(faceEl);
      if (big) faceEl.appendChild(h('b', { text: big }));
      if (small) faceEl.appendChild(h('span', { text: small }));
    }

    /* --------------------------------------------------------- the sweep -- */

    function frame(ts) {
      if (!running || finished) return;
      if (!lastTs) lastTs = ts;
      var dt = Math.min(0.05, (ts - lastTs) / 1000);    // clamp: tab-switch safety
      lastTs = ts;

      var g = gap();
      marker += dir * g.speed * dt;
      if (marker >= 100) { marker = 100 - (marker - 100); dir = -1; }
      if (marker <= 0)   { marker = -marker; dir = 1; }
      paintMarker();
      schedule();
    }

    function schedule() {
      if (root.requestAnimationFrame) rafId = root.requestAnimationFrame(frame);
      else rafId = root.setTimeout(function () { frame(Date.now()); }, 16);
    }

    function armGap() {
      var g = gap();
      if (!g) return;
      marker = g.startAt;
      dir = g.dir;
      lastTs = 0;
      ghostEl.style.display = 'none';
      barEl.classList.remove('is-dead');
      paintZone();
      paintMarker();
      paintPips();
      paintTell();

      goBtn.disabled = true;
      goBtn.textContent = '\u2026';
      face('READY', g.readyLine);

      // A beat of dread before every gap. It is what makes it a twitch game
      // rather than a metronome you can zone out against.
      after(320, function () {
        face('SET', g.readyLine);
        after(340, function () {
          face('', '');
          running = true;
          goBtn.disabled = false;
          goBtn.textContent = C.verb.toUpperCase() + '  \u2014  space';
          barEl.focus();
          schedule();
        });
      });
    }

    /* ------------------------------------------------------------ commit -- */

    function commit() {
      if (!running || finished || puzzle.done) return;
      running = false;
      stopLoop();

      var g = gap();
      g.landedAt = marker;

      var left = g.pos, right = g.pos + g.width;
      var centre = g.pos + g.width / 2;
      var inside = marker >= left && marker <= right;
      var perfect = inside && Math.abs(marker - centre) <= (g.width / 2) * puzzle.perfectBand;

      ghostEl.style.left = marker + '%';
      ghostEl.style.display = '';
      ghostEl.className = 'pz-timing-ghost ' + (inside ? 'is-good' : 'is-bad');

      // Every attempt is paid for whether it lands or not.
      var tweak = { energy: -puzzle.energyPer };

      if (perfect) {
        g.result = 'perfect';
        puzzle.hits++; puzzle.perfects++;
        tweak.morale = 4;
        api.toast(pick(C.perfect), 'good', 1500);
        say(pick(C.perfect), 'good');
        bump('is-pop');
      } else if (inside) {
        g.result = 'hit';
        puzzle.hits++;
        tweak.morale = 2;
        say(pick(C.hit), 'good');
        bump('is-pop');
      } else {
        g.result = 'miss';
        puzzle.misses++;
        // A miss is a hard landing, never a death. The run always continues.
        tweak.health = -puzzle.missDamage;
        tweak.morale = -3;
        api.toast(pick(C.miss), 'bad', 1900);
        say(pick(C.miss), 'bad');
        bump('is-shake');
      }

      api.tweak(tweak);
      barEl.classList.add('is-dead');
      paintPips();
      paintTell();
      face(perfect ? 'PERFECT' : (inside ? 'CLEAR' : 'DOWN'), '');

      goBtn.disabled = true;
      goBtn.textContent = '\u2026';

      after(perfect || inside ? 620 : 900, function () {
        puzzle.index++;
        if (puzzle.index >= puzzle.gaps.length) { runOut(); return; }
        armGap();
      });
    }

    function bump(cls) {
      barEl.classList.remove('is-shake');
      barEl.classList.remove('is-pop');
      void barEl.offsetWidth;
      barEl.classList.add(cls);
    }

    function pick(arr) {
      // Flavour only, but it still has to come from the seeded rng: replaying a
      // seed must reproduce the run exactly, including what the scene said to you.
      return api.rng.pick(arr);
    }

    /* ------------------------------------------------------------ endings -- */

    function runOut() {
      puzzle.done = true;
      running = false;
      stopLoop();
      barEl.classList.add('is-dead');
      face(puzzle.misses === 0 ? 'CLEAN' : 'THROUGH', '');
      paintPips();

      var clean = puzzle.misses === 0;
      PS.ui.clear(actsEl);
      PS.ui.clear(endEl);
      PS.ui.append(endEl, [
        h('div', { class: 'pz-intro', text: (clean ? C.cleared : C.failedAll) + ' ' +
          puzzle.hits + ' of ' + puzzle.gaps.length + ' clean' +
          (puzzle.perfects ? ', ' + puzzle.perfects + ' of those dead centre' : '') + '.' }),
        h('div', { class: 'pz-choices' }, [
          choiceBtn(C.onward, 'sprint'),
          choiceBtn(C.breathe, 'rest')
        ])
      ]);
      api.flash();
    }

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

    function finishRun(choice) {
      if (finished) return;
      finished = true;
      stopLoop();
      killTimers();

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
      stopLoop();
      killTimers();
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

    /* ------------------------------------------------------------- input -- */

    function onKey(ev) {
      if (finished) return;
      if (ev.key === ' ' || ev.key === 'Spacebar' || ev.key === 'Enter' || ev.key === 'ArrowDown') {
        ev.preventDefault();
        if (running) commit();
      }
    }

    document.addEventListener('keydown', onKey);
    barEl.addEventListener('click', function () { if (running) commit(); });
    goBtn.addEventListener('click', function () { if (running) commit(); });

    /* ------------------------------------------------------------ layout -- */

    PS.ui.append(el, h('div', { class: 'pz-timing' }, [
      h('div', { class: 'pz-timing-head' }, [
        h('div', {}, [
          h('div', { class: 'pz-timing-head__t', text: C.barLabel }),
          h('div', { class: 'pz-timing-head__s' },
            ['Stop the marker inside the lit band. ',
              PS.ui.h('strong', { text: 'Space' }), ', ', PS.ui.h('strong', { text: 'Enter' }),
              ', or click the bar. Every ', C.unit, ' after this one is narrower and faster.'])
        ]),
        counterEl
      ]),
      pipsEl,
      barEl,
      sayEl,
      actsEl,
      tellEl,
      endEl,
      h('button', {
        class: 'pz-btn pz-btn--danger pz-btn--sm', type: 'button',
        onclick: bailOut
      }, ['\u21A9 Not worth it \u2014 go around'])
    ]));

    live = {
      stop: function () {
        finished = true;
        running = false;
        stopLoop();
        killTimers();
        document.removeEventListener('keydown', onKey);
      }
    };

    paintZone();
    paintMarker();
    paintPips();
    paintTell();
    say('Three, two, one.');
    armGap();
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
