/* ==========================================================================
   PuzzleStudio — js/games/e09_dependency_order.js  ENGINE 09 · Dependency Order
   --------------------------------------------------------------------------
   Self-contained: logic + 3 skins + its own CSS. No DOM access until mount().

   THE PUZZLE
     A rack of valves, breakers or gates. Every one of them wants two things
     before you touch it: the ones it depends on must already be open, and the
     system must have room for what it adds. There is a ceiling, and it is set
     exactly where a careful run of the sequence tops out — so there is no
     headroom for a careless one.

     Some of them relieve instead of load. Those are the ones you have to reach
     before the ceiling stops you, and they are always behind something else.

     A clock runs the whole time. Getting it wrong trips the system, costs you,
     and costs you the seconds as well.

   GENERATION
     A random topological order is rolled first, prerequisites are drawn only
     from earlier positions, and the ceiling is measured off that order. A valid
     sequence therefore always exists by construction — and is then re-proved
     at build time by a bitmask DP over the whole state space, which is also
     what powers the hint and the autoplay bot.

   THE BRANCH
     A system that is finally doing what it was built to do opens two doors.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio;
  if (!PS || !PS.registry) { if (root.console) console.error('[e09] core not loaded'); return; }

  /* ======================================================== SKIN CONTENT == */

  var CONTENT = {
    pressure_valves: {
      unit: 'bar', gauge: 'Header pressure', system: 'the header',
      stepNoun: 'valve', stepNounPl: 'valves', verb: 'Crack',
      openIcon: '\uD83D\uDD27', reliefIcon: '\uD83D\uDCA8',
      interlock: 'The interlock will not let go. Something upstream of it is still shut.',
      spike: 'The needle slams into the red and the whole header screams at you.',
      timeout: 'The relief disc lets go somewhere above you and the decision stops being yours.',
      names: ['Header bleed', 'Ring main', 'Jacket return', 'Condensate trap', 'Feed isolator',
              'Relief bypass', 'Drum vent', 'Riser tap', 'Cross-tie', 'Purge line', 'Blowdown', 'Standpipe'],
      win: 'The header settles to a number you could live next to.',
      gain: ['canister'], winStats: { morale: 8, energy: -8 },
      branchA: { id: 'descend', icon: '\uD83D\uDD73\uFE0F', title: 'Go down into the plant', desc: 'With the header dead you can finally walk the lower gallery without cooking.' },
      branchB: { id: 'scavenge', icon: '\uD83E\uDDF0', title: 'Strip the pump house', desc: 'Nothing in there is bolted down any more and nothing in there is yours.' }
    },

    reactor_startup: {
      unit: 'MW', gauge: 'Bus load', system: 'the bus',
      stepNoun: 'breaker', stepNounPl: 'breakers', verb: 'Close',
      openIcon: '\uD83D\uDD0C', reliefIcon: '\uD83D\uDD0B',
      interlock: 'The breaker refuses to latch. Its permissive is not made up.',
      spike: 'The bus sags, the lights brown out, and a protection relay drops the lot.',
      timeout: 'The startup window closes and the sequence has to be abandoned where it stands.',
      names: ['Station service', 'Coolant pump A', 'Coolant pump B', 'Control rods', 'Turbine gland',
              'Feedwater', 'Excitation', 'Grid tie', 'Instrument bus', 'Emergency lube', 'Condenser vacuum', 'Bus tie'],
      win: 'Somewhere three floors down a machine that has been cold for months takes its own weight.',
      gain: ['battery'], winStats: { morale: 9, energy: -8, light: 22 },
      branchA: { id: 'signal', icon: '\uD83D\uDCE1', title: 'Put the mast back on air', desc: 'There is power for the transmitter now. There may even be somebody listening.' },
      branchB: { id: 'descend', icon: '\uD83D\uDEDC', title: 'Take the lift to the lower gallery', desc: 'It works. That is the first time that sentence has been true in a while.' }
    },

    dam_sluice: {
      unit: 'm', gauge: 'Head on the crest', system: 'the pond',
      stepNoun: 'gate', stepNounPl: 'gates', verb: 'Wind open',
      openIcon: '\uD83D\uDEA7', reliefIcon: '\uD83C\uDF0A',
      interlock: 'The rack will not turn. Its pair upstream is still down.',
      spike: 'Water goes over the crest instead of through it and the whole walkway shudders.',
      timeout: 'The pond takes the decision away from you and finds its own way over the top.',
      names: ['Fish ladder', 'Scour gate', 'Spillway one', 'Spillway two', 'Draft tube',
              'Intake screen', 'Bywash', 'Log sluice', 'Tailrace', 'Crest gate', 'Siphon break', 'Wasteway'],
      win: 'The pond drops and keeps dropping, and a line of wet stone comes up out of it.',
      gain: ['rope'], winStats: { morale: 8, energy: -9 },
      branchA: { id: 'wade', icon: '\uD83E\uDEE7', title: 'Cross the drained channel', desc: 'Knee deep and falling. It will not be this shallow again today.' },
      branchB: { id: 'climb', icon: '\uD83E\uDDD7', title: 'Take the crest walkway', desc: 'Dry, exposed, and it looks out over everything that is coming.' }
    }
  };

  /* ============================================================== BUILD === */

  function build(state, rng, tier, skin) {
    var C = CONTENT[skin.id] || CONTENT.pressure_valves;
    var t = Math.min(6, Math.max(1, tier));
    var n = 5 + t;                                  // 6 .. 11 steps
    var slack = Math.max(0, 3 - t);                 // headroom, gone by tier 3
    var seconds = Math.max(46, 96 - t * 8);

    var ids = [], i;
    for (i = 0; i < n; i++) ids.push(i);

    var intended = rng.shuffle(ids);                // a valid topological order
    var prereqs = [], prereqMask = [];
    for (i = 0; i < n; i++) { prereqs.push([]); prereqMask.push(0); }

    for (var k = 1; k < n; k++) {
      var node = intended[k];
      // Draw only from earlier positions — that is what makes the DAG acyclic
      // and the rolled order valid without any checking.
      var pool = intended.slice(Math.max(0, k - 4), k);
      var want = k === 1 ? 1 : rng.weighted([0, 1, 2], function (v) { return v === 1 ? 5 : (v === 2 ? 3 : 2); });
      var picks = rng.sample(pool, Math.min(want, pool.length));
      for (i = 0; i < picks.length; i++) {
        prereqs[node].push(picks[i]);
        prereqMask[node] |= (1 << picks[i]);
      }
    }

    /* ---- loads: about a third relieve the system instead of loading it ---- */
    var load = [];
    for (i = 0; i < n; i++) load.push(rng.chance(0.33) ? -rng.int(3, 7) : rng.int(3, 9));
    load[intended[0]] = Math.abs(load[intended[0]]) || 4;   // nothing relieves before anything loads

    // Walk the intended order, keep the system above zero, and read the ceiling
    // off the highest point it reaches. Tight by construction.
    var base = 8 + rng.int(0, 6);
    var p = base, peak = base;
    for (k = 0; k < n; k++) {
      var idx = intended[k];
      p += load[idx];
      if (p < 0) { load[idx] -= p; p = 0; }
      if (p > peak) peak = p;
    }
    var cap = peak + slack;

    var puzzle = {
      n: n, load: load, prereqs: prereqs, prereqMask: prereqMask,
      base: base, cap: cap, intended: intended,
      names: C.names.slice(0, n),
      codes: [], display: [],
      open: [], openCount: 0, pressure: base,
      mistakes: 0, interlocks: 0, spikes: 0,
      limitMs: seconds * 1000, seconds: seconds,
      tier: t, content: C, solvedOrder: null
    };
    for (i = 0; i < n; i++) { puzzle.open.push(false); puzzle.codes.push(C.stepNoun.charAt(0).toUpperCase() + '-' + (i < 9 ? '0' : '') + (i + 1)); }

    // Re-prove solvability from scratch, and keep the proof: the hint and the
    // bot both read it. A puzzle that cannot be finished never ships.
    puzzle.solvedOrder = solveFrom(puzzle, 0, base);
    if (!puzzle.solvedOrder) {
      puzzle.cap = peak + Math.max(2, slack);
      puzzle.solvedOrder = solveFrom(puzzle, 0, base) || intended.slice();
    }

    /* ---- lay them out so that clicking left-to-right trips the system ----- */
    var best = rng.shuffle(ids);
    for (var attempt = 0; attempt < 14; attempt++) {
      var cand = rng.shuffle(ids);
      if (carelessTrips(puzzle, cand)) { best = cand; break; }
      best = cand;
    }
    puzzle.display = best;

    return puzzle;
  }

  /**
   * Pressure is a pure function of which steps are open, so the whole state
   * space is just a bitmask — 2^11 at the very worst. Memoised DFS returns a
   * complete legal order, or null if none exists.
   */
  function solveFrom(puzzle, startMask, startPressure) {
    var n = puzzle.n, full = (1 << n) - 1, memo = {};

    function rec(mask, p) {
      if (mask === full) return [];
      if (memo[mask] !== undefined) return memo[mask];
      var found = null;
      for (var i = 0; i < n && !found; i++) {
        var bit = 1 << i;
        if (mask & bit) continue;
        if ((puzzle.prereqMask[i] & mask) !== puzzle.prereqMask[i]) continue;
        var np = p + puzzle.load[i];
        if (np > puzzle.cap) continue;
        var rest = rec(mask | bit, np);
        if (rest) found = [i].concat(rest);
      }
      memo[mask] = found;
      return found;
    }
    return rec(startMask, startPressure);
  }

  /** Would a player clicking whatever is available, left to right, trip it? */
  function carelessTrips(puzzle, display) {
    var mask = 0, p = puzzle.base, full = (1 << puzzle.n) - 1, guard = 0;
    while (mask !== full && guard++ < 64) {
      var chosen = -1;
      for (var d = 0; d < display.length; d++) {
        var i = display[d], bit = 1 << i;
        if (mask & bit) continue;
        if ((puzzle.prereqMask[i] & mask) !== puzzle.prereqMask[i]) continue;
        chosen = i; break;
      }
      if (chosen < 0) return true;                 // careless play dead-ends
      p += puzzle.load[chosen];
      if (p > puzzle.cap) return true;             // careless play trips it
      mask |= (1 << chosen);
    }
    return mask !== full;
  }

  function maskOf(puzzle) {
    var m = 0;
    for (var i = 0; i < puzzle.n; i++) if (puzzle.open[i]) m |= (1 << i);
    return m;
  }

  function ready(puzzle, i) {
    if (puzzle.open[i]) return false;
    return (puzzle.prereqMask[i] & maskOf(puzzle)) === puzzle.prereqMask[i];
  }

  /* ================================================================ CSS == */

  var CSS = [
    '.pz-dep{display:grid;grid-template-columns:minmax(0,1fr) minmax(238px,300px);gap:18px;align-items:start}',
    '@media (max-width:880px){.pz-dep{grid-template-columns:1fr}}',

    '.pz-dep-rack{display:grid;grid-template-columns:repeat(auto-fill,minmax(158px,1fr));gap:9px}',
    '.pz-dep-step{position:relative;text-align:left;padding:10px 11px;border-radius:10px;cursor:pointer;',
    '  background:linear-gradient(180deg,var(--panel-2),var(--panel));border:1px solid var(--line);',
    '  display:flex;flex-direction:column;gap:5px;color:var(--text-2);',
    '  transition:transform .14s var(--ease),border-color .18s var(--ease),opacity .2s var(--ease)}',
    '.pz-dep-step:hover{transform:translateY(-2px)}',
    '.pz-dep-step.is-locked{opacity:.5;cursor:not-allowed}',
    '.pz-dep-step.is-locked:hover{transform:none}',
    '.pz-dep-step.is-ready{border-color:color-mix(in srgb,var(--acc) 62%,transparent);',
    '  box-shadow:0 0 0 1px color-mix(in srgb,var(--acc) 18%,transparent)}',
    '.pz-dep-step.is-risky{border-color:rgba(226,105,95,.55)}',
    '.pz-dep-step.is-open{opacity:.62;border-color:var(--good);background:rgba(95,207,141,.07);cursor:default}',
    '.pz-dep-step.is-open:hover{transform:none}',
    '.pz-dep-step__top{display:flex;align-items:center;gap:7px}',
    '.pz-dep-step__ico{font-size:16px;line-height:1}',
    '.pz-dep-step__name{font-size:12.5px;font-weight:600;color:var(--text);line-height:1.25}',
    '.pz-dep-step__code{margin-left:auto;font-family:var(--font-mono);font-size:9.5px;color:var(--dimmer)}',
    '.pz-dep-step__load{font-family:var(--font-mono);font-size:11px;color:var(--warn)}',
    '.pz-dep-step__load.is-relief{color:var(--good)}',
    '.pz-dep-step__proj{font-family:var(--font-mono);font-size:10px;color:var(--dim)}',
    '.pz-dep-step__proj.is-over{color:var(--bad)}',
    '.pz-dep-reqs{display:flex;flex-wrap:wrap;gap:4px}',
    '.pz-dep-req{font-family:var(--font-mono);font-size:9px;padding:2px 5px;border-radius:4px;',
    '  background:#0a0e15;border:1px solid var(--line-soft);color:var(--dimmer)}',
    '.pz-dep-req.is-met{color:var(--good);border-color:rgba(95,207,141,.35)}',

    '.pz-dep-gauge{position:relative;height:20px;border-radius:6px;overflow:hidden;',
    '  background:#0a0e15;border:1px solid var(--line)}',
    '.pz-dep-gauge__fill{height:100%;width:0;background:linear-gradient(90deg,var(--acc),var(--warn));',
    '  transition:width .35s var(--ease)}',
    '.pz-dep-gauge__fill.is-hot{background:linear-gradient(90deg,var(--warn),var(--bad))}',
    '.pz-dep-gauge__txt{position:absolute;inset:0;display:grid;place-items:center;',
    '  font-family:var(--font-mono);font-size:10.5px;color:var(--text);text-shadow:0 1px 3px #000}',

    '.pz-dep-clock{position:relative;height:6px;border-radius:4px;overflow:hidden;background:#0a0e15;border:1px solid var(--line-soft)}',
    '.pz-dep-clock__fill{height:100%;width:100%;background:var(--acc);transition:width .2s linear}',
    '.pz-dep-clock__fill.is-hot{background:var(--bad)}',

    '.pz-dep-meter{display:flex;flex-direction:column;gap:6px}',
    '.pz-dep-meter__row{display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:11px;color:var(--dim)}',
    '.pz-dep-meter__row b{color:var(--acc-2)}',
    '.pz-dep-meter__row.is-hot b{color:var(--bad)}',

    '.pz-dep-warn{font-size:12px;line-height:1.5;color:var(--bad);padding:9px 11px;border-radius:7px;',
    '  background:rgba(226,105,95,.08);border:1px solid rgba(226,105,95,.28)}',

    '.pz-dep-shock{animation:pzDepShock .45s var(--ease)}',
    '@keyframes pzDepShock{0%,100%{transform:translateX(0)}20%{transform:translateX(-6px)}60%{transform:translateX(6px)}}'
  ].join('\n');

  /* ================================================================ MOUNT = */

  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var C = puzzle.content;
    var finished = false;
    var remaining = puzzle.limitMs;
    var timer = null;

    var rack = h('div', { class: 'pz-dep-rack' });
    var gaugeFill = h('div', { class: 'pz-dep-gauge__fill' });
    var gaugeTxt = h('div', { class: 'pz-dep-gauge__txt' });
    var gauge = h('div', { class: 'pz-dep-gauge' }, [gaugeFill, gaugeTxt]);
    var clockFill = h('div', { class: 'pz-dep-clock__fill' });
    var clock = h('div', { class: 'pz-dep-clock' }, [clockFill]);
    var meter = h('div', { class: 'pz-dep-meter' });
    var warnBox = h('div', {});
    var endBox = h('div', { class: 'pz-col' });
    var cards = {};

    var walkBtn = h('button', { class: 'pz-btn pz-btn--danger pz-btn--sm', type: 'button', text: '\u21A9 Back out of the sequence' });

    /* -------------------------------------------------------------- cards -- */

    function makeCard(i) {
      var card = h('div', { class: 'pz-dep-step' });
      card.addEventListener('click', function () { attempt(i); });
      cards[i] = card;
      return card;
    }

    function paintCard(i) {
      var card = cards[i];
      PS.ui.clear(card);

      var isOpen = puzzle.open[i];
      var isReady = ready(puzzle, i);
      var relief = puzzle.load[i] < 0;
      var proj = puzzle.pressure + puzzle.load[i];
      var over = proj > puzzle.cap;

      var cls = 'pz-dep-step';
      if (isOpen) cls += ' is-open';
      else if (!isReady) cls += ' is-locked';
      else { cls += ' is-ready'; if (over) cls += ' is-risky'; }
      card.className = cls;

      var reqs = h('div', { class: 'pz-dep-reqs' });
      if (!puzzle.prereqs[i].length) {
        reqs.appendChild(h('div', { class: 'pz-dep-req is-met', text: 'no interlock' }));
      } else {
        for (var k = 0; k < puzzle.prereqs[i].length; k++) {
          var r = puzzle.prereqs[i][k];
          reqs.appendChild(h('div', { class: 'pz-dep-req' + (puzzle.open[r] ? ' is-met' : ''),
            text: (puzzle.open[r] ? '\u2714 ' : '\u26A0 ') + puzzle.names[r] }));
        }
      }

      PS.ui.append(card, [
        h('div', { class: 'pz-dep-step__top' }, [
          h('span', { class: 'pz-dep-step__ico', text: isOpen ? '\u2714' : (relief ? C.reliefIcon : C.openIcon) }),
          h('span', { class: 'pz-dep-step__name', text: puzzle.names[i] }),
          h('span', { class: 'pz-dep-step__code', text: puzzle.codes[i] })
        ]),
        h('div', { class: 'pz-dep-step__load' + (relief ? ' is-relief' : '') ,
          text: (relief ? '' : '+') + puzzle.load[i] + ' ' + C.unit }),
        (isOpen || !isReady) ? null
          : h('div', { class: 'pz-dep-step__proj' + (over ? ' is-over' : ''),
              text: (over ? 'would trip at ' : 'takes it to ') + proj + ' / ' + puzzle.cap }),
        reqs
      ]);
    }

    function paint() {
      for (var d = 0; d < puzzle.display.length; d++) paintCard(puzzle.display[d]);

      var pct = Math.max(0, Math.min(100, (puzzle.pressure / Math.max(1, puzzle.cap)) * 100));
      gaugeFill.style.width = pct + '%';
      gaugeFill.className = 'pz-dep-gauge__fill' + (pct > 78 ? ' is-hot' : '');
      gaugeTxt.textContent = puzzle.pressure + ' / ' + puzzle.cap + ' ' + C.unit;

      PS.ui.clear(meter);
      PS.ui.append(meter, [
        row(C.stepNounPl.charAt(0).toUpperCase() + C.stepNounPl.slice(1) + ' open',
            puzzle.openCount + ' of ' + puzzle.n),
        row('Ceiling', puzzle.cap + ' ' + C.unit),
        row('Headroom', (puzzle.cap - puzzle.pressure) + ' ' + C.unit, puzzle.cap - puzzle.pressure <= 2),
        row('Trips', String(puzzle.mistakes), puzzle.mistakes > 0),
        row('Seconds left', String(Math.ceil(remaining / 1000)), remaining < 15000)
      ]);

      PS.ui.clear(warnBox);
      var stuck = !finished && !solveFrom(puzzle, maskOf(puzzle), puzzle.pressure);
      if (stuck && puzzle.openCount < puzzle.n) {
        warnBox.appendChild(h('div', { class: 'pz-dep-warn' },
          ['Nothing left in the rack can be opened without going over. The sequence is dead from here \u2014 back out before the clock takes the choice off you.']));
      } else if (!finished && remaining < 15000) {
        warnBox.appendChild(h('div', { class: 'pz-dep-warn' },
          ['Under fifteen seconds. Stop reading and start turning.']));
      }

      function row(k, v, hot) {
        return h('div', { class: 'pz-dep-meter__row' + (hot ? ' is-hot' : '') },
          [h('span', { text: k }), h('b', { text: v })]);
      }
    }

    /* ------------------------------------------------------------ clicking */

    function attempt(i) {
      if (finished || puzzle.open[i]) return;

      if ((puzzle.prereqMask[i] & maskOf(puzzle)) !== puzzle.prereqMask[i]) {
        trip(C.interlock, 2, 2500);
        return;
      }
      var proj = puzzle.pressure + puzzle.load[i];
      if (proj > puzzle.cap) {
        puzzle.spikes++;
        trip(C.spike, 4 + puzzle.tier, 4000);
        return;
      }

      puzzle.open[i] = true;
      puzzle.openCount++;
      puzzle.pressure = proj;
      api.tweak({ energy: -1 });
      paint();

      if (puzzle.openCount === puzzle.n) { win(); }
    }

    function trip(msg, damage, penaltyMs) {
      puzzle.mistakes++;
      if (msg === C.interlock) puzzle.interlocks++;
      remaining = Math.max(0, remaining - penaltyMs);
      api.tweak({ health: -damage, morale: -2 });
      api.toast(msg, 'bad', 3000);
      rack.classList.remove('pz-dep-shock'); void rack.offsetWidth; rack.classList.add('pz-dep-shock');
      paint();
      if (remaining <= 0) timeOut();
    }

    /* -------------------------------------------------------------- clock -- */

    function stopClock() { if (timer) { clearInterval(timer); timer = null; } }
    teardownFns.push(stopClock);

    timer = setInterval(function () {
      if (finished) { stopClock(); return; }
      remaining -= 200;
      if (remaining <= 0) { remaining = 0; timeOut(); return; }
      var pct = (remaining / puzzle.limitMs) * 100;
      clockFill.style.width = pct + '%';
      clockFill.className = 'pz-dep-clock__fill' + (pct < 25 ? ' is-hot' : '');
      if (remaining % 1000 < 200) paint();
    }, 200);

    /* ------------------------------------------------------------ endings -- */

    function win() {
      if (finished) return;
      finished = true;
      stopClock();
      paint();
      var clean = puzzle.mistakes === 0;
      var fast = remaining > puzzle.limitMs * 0.4;

      PS.ui.clear(endBox);
      PS.ui.append(endBox, [
        h('div', { class: 'pz-intro', text: C.win + ' ' + puzzle.n + ' ' + C.stepNounPl + ', ' +
          (clean ? 'not one trip' : puzzle.mistakes + ' trip' + (puzzle.mistakes === 1 ? '' : 's')) +
          ', ' + Math.ceil(remaining / 1000) + ' seconds still on the clock.' }),
        h('div', { class: 'pz-choices' }, [branch(C.branchA, clean, fast), branch(C.branchB, clean, fast)])
      ]);
      api.flash();
    }

    function branch(spec, clean, fast) {
      var b = h('button', { class: 'pz-choice', type: 'button' }, [
        h('div', { class: 'pz-choice__i', text: spec.icon }),
        h('div', { class: 'pz-choice__t', text: spec.title }),
        h('div', { class: 'pz-choice__d', text: spec.desc })
      ]);
      b.addEventListener('click', function () { finishWin(spec.id, clean, fast); });
      return b;
    }

    function finishWin(choice, clean, fast) {
      var stats = {};
      for (var k in C.winStats) if (Object.prototype.hasOwnProperty.call(C.winStats, k)) stats[k] = C.winStats[k];
      if (!clean) { stats.morale = Math.round((stats.morale || 0) * 0.4); }

      api.finish({
        outcome: clean ? 'success' : 'partial',
        stats: stats,
        gain: clean ? C.gain.slice() : [],
        lose: [],
        tags: ['ran_the_sequence'].concat(clean ? ['no_trips'] : []).concat(fast ? ['beat_the_clock'] : []),
        signals: {
          logic: clean ? 3 : 2,
          speed: fast ? 3 : 1,
          caution: puzzle.spikes === 0 ? 2 : 0,
          brute: 0
        },
        choice: choice,
        summary: 'You brought all ' + puzzle.n + ' ' + C.stepNounPl + ' up in order' +
          (clean ? ' without once putting ' + C.system + ' over.' : ', tripping ' + C.system + ' ' + puzzle.mistakes + ' times on the way.')
      });
    }

    function timeOut() {
      if (finished) return;
      finished = true;
      stopClock();
      paint();
      var got = puzzle.openCount;
      var partial = got >= Math.ceil(puzzle.n * 0.6);

      PS.ui.clear(endBox);
      var go = h('button', { class: 'pz-btn pz-btn--danger', type: 'button', text: '\u2192 Get clear of it' });
      go.addEventListener('click', function () {
        api.finish({
          outcome: partial ? 'partial' : 'fail',
          stats: { health: -(4 + puzzle.tier), energy: -10, morale: partial ? -5 : -11 },
          gain: [], lose: [],
          tags: ['ran_out_of_time'],
          signals: { speed: 1, logic: partial ? 1 : 0, caution: 1 },
          choice: null,
          summary: 'The clock beat you with ' + got + ' of ' + puzzle.n + ' ' + C.stepNounPl + ' open.'
        });
      });
      PS.ui.append(endBox, [h('div', { class: 'pz-intro', text: C.timeout }), go]);
    }

    function backOut() {
      if (finished) return;
      finished = true;
      stopClock();
      api.finish({
        outcome: 'fail',
        stats: { energy: -6, morale: -7 },
        gain: [], lose: [],
        tags: ['left_it_shut'],
        signals: { caution: 3 },
        choice: null,
        summary: 'You left ' + C.system + ' exactly as you found it and went the long way instead.'
      });
    }

    /* ------------------------------------------------------------- layout -- */

    walkBtn.addEventListener('click', backOut);
    for (var d = 0; d < puzzle.display.length; d++) rack.appendChild(makeCard(puzzle.display[d]));

    PS.ui.append(el, h('div', { class: 'pz-dep' }, [
      h('div', { class: 'pz-col' }, [
        rack,
        h('div', { class: 'pz-note' }, [
          'Each one needs its interlocks open ', h('strong', { text: 'and' }), ' enough headroom to take its load. ',
          'The ones that read green give headroom back \u2014 and every one of them sits behind something else.'
        ]),
        endBox
      ]),
      h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: C.gauge }),
          gauge,
          clock,
          meter
        ]),
        warnBox,
        walkBtn
      ])
    ]));

    paint();
  }

  function unmount() {
    while (teardownFns.length) {
      try { teardownFns.pop()(); } catch (e) { /* keep unwinding */ }
    }
  }

  /* ================================================================ HINT = */

  function hint(puzzle) {
    var C = puzzle.content;
    var rest = solveFrom(puzzle, maskOf(puzzle), puzzle.pressure);
    if (!rest) {
      return 'There is no order left that stays under ' + puzzle.cap + '. Nothing you do from here finishes the sequence.';
    }
    if (!rest.length) return 'Everything is open. Walk away from it.';
    var next = rest[0];
    var after = puzzle.pressure + puzzle.load[next];
    return puzzle.names[next] + ' next \u2014 that takes ' + C.system + ' to ' + after +
      ' of ' + puzzle.cap + ', and leaves ' + (rest.length - 1) + ' behind it.';
  }

  /* ============================================================ AUTOSOLVE = */
  /* Headless. Runs the proved order and reports what a clean sequence costs. */

  function autoSolve(puzzle, rng) {
    var C = puzzle.content;
    var order = puzzle.solvedOrder || solveFrom(puzzle, 0, puzzle.base);
    if (!order) {
      return {
        outcome: 'fail',
        stats: { health: -4, energy: -10, morale: -9 },
        gain: [], lose: [], tags: ['ran_out_of_time'],
        signals: { speed: 1, caution: 1 }, choice: null,
        summary: 'The sequence would not go, whichever way it was tried.'
      };
    }
    var stats = {};
    for (var k in C.winStats) if (Object.prototype.hasOwnProperty.call(C.winStats, k)) stats[k] = C.winStats[k];
    stats.energy = (stats.energy || 0) - puzzle.n;

    return {
      outcome: 'success',
      stats: stats,
      gain: C.gain.slice(),
      lose: [],
      tags: ['ran_the_sequence', 'no_trips', 'beat_the_clock'],
      signals: { logic: 3, speed: 3, caution: 2 },
      choice: rng.chance(0.5) ? C.branchA.id : C.branchB.id,
      summary: 'Straight down the only order that fits under ' + puzzle.cap + ' ' + C.unit + '.'
    };
  }

  /* ============================================================ REGISTER = */

  PS.registry.register({
    id: 'dependency_order',
    name: 'Dependency Order',
    icon: '\uD83D\uDD27',
    blurb: 'Everything depends on something else and the ceiling has no give in it. Clock running.',

    favors:   { logic: 2, speed: 2 },
    provides: ['power', 'passage'],
    tagHooks: ['has_tools'],
    requires: function (state) { return state.stats.energy > 8; },

    css: CSS,

    skins: [
      {
        id: 'pressure_valves', biome: 'industrial', title: 'Pressure Release Valves',
        icon: '\uD83D\uDD27', palette: 'rust',
        intro: 'The header has been building since the pumps failed and the relief disc above you is rated for a number it passed an hour ago. Twelve wheels on the manifold, every one of them interlocked to another, and a gauge that has stopped pretending to be calm.',
        nouns: { unit: 'valve', system: 'the header', gauge: 'pressure' }
      },
      {
        id: 'reactor_startup', biome: 'industrial', title: 'Reactor Startup',
        icon: '\uD83D\uDD0C', palette: 'steel',
        intro: 'The startup card is laminated and bolted to the panel, and half of it is illegible under the soot. What is left is a rack of breakers, a bus that will drop the whole lot if you overload it, and the fact that nothing else in this building works until this does.',
        nouns: { unit: 'breaker', system: 'the bus', gauge: 'load' }
      },
      {
        id: 'dam_sluice', biome: 'water', title: 'Dam Sluice Gates',
        icon: '\uD83D\uDEA7', palette: 'ice',
        intro: 'The pond is a metre off the crest and rising, and the only way down the valley runs along the tailrace. Wind the gates in the wrong order and the head goes over the top instead of through it, with you on the walkway.',
        nouns: { unit: 'gate', system: 'the pond', gauge: 'head' }
      }
    ],

    build: build,
    mount: mount,
    unmount: unmount,
    hint: hint,
    autoSolve: autoSolve
  });

})(typeof window !== 'undefined' ? window : this);
