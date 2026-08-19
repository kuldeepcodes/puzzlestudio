/* ==========================================================================
   PuzzleStudio — js/games/e17_triangulation.js    ENGINE 17 · Triangulation
   --------------------------------------------------------------------------
   Self-contained: logic + 3 skins + its own CSS. No DOM access until mount().

   THE PUZZLE
     Something is out there and only its DISTANCE from a handful of known
     positions is known. Light a station's ring and every cell at that
     distance glows. Light a second and the rings cross. Where they all cross
     is the answer, and the grid does that arithmetic for you the moment you
     ask it to.

   THE ESCALATION
     T1-T2  Three stations, exact readings. Generation brute-forces the whole
            grid and only serves a layout where EXACTLY ONE cell satisfies
            every reading. It is always deducible with certainty.
     T3     The readings drift. Rings no longer meet at a point, they overlap
            in a smear, and the answer is the cell that misses every reading
            by the least. Verified to be the unique best fit before serving.
     T4+    Two stations only. The problem is genuinely under-determined and
            no amount of staring will fix it — you have to spend energy and
            put your own sensor down. Generation proves at least one
            placement collapses the answer to a single cell.

   THE BRANCH
     Knowing where it is, you either go straight to it or mark it and call it.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio;
  if (!PS || !PS.registry) { if (root.console) console.error('[e17] core not loaded'); return; }

  /* Columns skip I and O, the way real grid references do, so nobody
     misreads them as 1 and 0. */
  var COLS = 'ABCDEFGHJKLMNPQR';

  /* ======================================================== SKIN CONTENT == */

  var CONTENT = {
    beacon: {
      unit: 'km', gridName: 'search grid',
      stationName: 'relay', stationPlural: 'relays', stationIcon: '\uD83D\uDCE1',
      sensorName: 'repeater', sensorIcon: '\uD83D\uDCCD',
      targetName: 'the beacon', targetIcon: '\uD83D\uDD34',
      goal: 'The beacon is transmitting and every relay on the ridge can hear it. None of them can say which way.',
      deployLine: 'You climb, plant the repeater, and wait for it to lock.',
      hitFirst: 'Dead on. The beacon is exactly where the numbers said it was.',
      hitSecond: 'Second time. Close enough that you can walk to it before dark.',
      missLine: 'Nothing there but wet heather. The beacon is somewhere else entirely.',
      go:   { icon: '\uD83E\uDDED', title: 'Walk the bearing yourself', desc: 'Straight line, four hours, and you find out who is transmitting.' },
      call: { icon: '\uD83D\uDCFB', title: 'Put the fix on the air', desc: 'Give the grid reference to anyone listening and let them come to it.' }
    },
    cell_tower: {
      unit: 'blocks', gridName: 'street grid',
      stationName: 'mast', stationPlural: 'masts', stationIcon: '\uD83D\uDCF6',
      sensorName: 'scanner', sensorIcon: '\uD83D\uDCCD',
      targetName: 'the handset', targetIcon: '\uD83D\uDCF1',
      goal: 'The handset is still registering. Each mast knows how far, not which way.',
      deployLine: 'You set the scanner on a parapet and let it take its own reading.',
      hitFirst: 'First guess. The handset is in that building and it is still on.',
      hitSecond: 'Second block along. It cost you time you did not have.',
      missLine: 'Empty stairwell, dead air, and the trace has moved on.',
      go:   { icon: '\uD83C\uDFC3', title: 'Cross to the block yourself', desc: 'Six streets at street level, and nobody knows you are coming.' },
      call: { icon: '\uD83D\uDCFB', title: 'Pass the trace up the net', desc: 'Somebody with a vehicle is closer than you are. Give them the reference.' }
    },
    sonar: {
      unit: 'cables', gridName: 'plot',
      stationName: 'hydrophone', stationPlural: 'hydrophones', stationIcon: '\uD83C\uDF0A',
      sensorName: 'drop buoy', sensorIcon: '\uD83D\uDCCD',
      targetName: 'the pinger', targetIcon: '\uD83D\uDD0A',
      goal: 'The pinger is running on its last battery. Every hydrophone gets a range and none of them get a bearing.',
      deployLine: 'The buoy goes over the side and starts returning its own range.',
      hitFirst: 'Straight onto it. The plot was right the first time.',
      hitSecond: 'Second plot. The battery has that long in it, just about.',
      missLine: 'Black water and no return. The plot was wrong and the ping is fading.',
      go:   { icon: '\uD83D\uDEA4', title: 'Run to the mark yourself', desc: 'Bow into the swell and you are over it in twenty minutes.' },
      call: { icon: '\uD83D\uDCFB', title: 'Signal the position across', desc: 'The other boat has the fuel and the light. Give them the fix.' }
    }
  };

  /* ============================================================= GEOMETRY == */

  function dist(r1, c1, r2, c2) {
    var dr = r1 - r2, dc = c1 - c2;
    return Math.sqrt(dr * dr + dc * dc);
  }

  function round2(v) { return Math.round(v * 100) / 100; }

  function within(reading, r, c) {
    return Math.abs(dist(r, c, reading.row, reading.col) - reading.value) <= reading.tol;
  }

  /** Every cell that satisfies all of `readings`. */
  function matching(H, W, readings) {
    var out = [];
    for (var r = 0; r < H; r++) {
      for (var c = 0; c < W; c++) {
        var ok = true;
        for (var i = 0; i < readings.length; i++) {
          if (!within(readings[i], r, c)) { ok = false; break; }
        }
        if (ok) out.push([r, c]);
      }
    }
    return out;
  }

  function residual(readings, r, c) {
    var s = 0;
    for (var i = 0; i < readings.length; i++) {
      var e = dist(r, c, readings[i].row, readings[i].col) - readings[i].value;
      s += e * e;
    }
    return s;
  }

  /**
   * Find a cell where dropping an exact-reading sensor collapses `cands` to
   * exactly one. Returns [row, col] or null. This is what makes the
   * under-determined tiers fair: the puzzle is never unsolvable, it just
   * cannot be solved for free.
   */
  function resolverFor(H, W, cands, target, taken) {
    for (var r = 0; r < H; r++) {
      for (var c = 0; c < W; c++) {
        if (taken[r + ',' + c]) continue;
        var dt = round2(dist(r, c, target[0], target[1]));
        var survivors = 0;
        for (var i = 0; i < cands.length; i++) {
          if (Math.abs(dist(r, c, cands[i][0], cands[i][1]) - dt) <= 0.005 + 1e-9) survivors++;
        }
        if (survivors === 1) return [r, c];
      }
    }
    return null;
  }

  /* =============================================================== BUILD == */

  function tierSpec(t) {
    if (t <= 1) return { w: 9,  h: 9,  stations: 3, noise: 0,    sensors: 0, mode: 'exact' };
    if (t === 2) return { w: 11, h: 11, stations: 3, noise: 0,    sensors: 0, mode: 'exact' };
    if (t === 3) return { w: 11, h: 11, stations: 3, noise: 0.55, sensors: 1, mode: 'noisy' };
    if (t === 4) return { w: 11, h: 11, stations: 2, noise: 0,    sensors: 1, mode: 'sparse' };
    if (t === 5) return { w: 13, h: 13, stations: 2, noise: 0.45, sensors: 2, mode: 'sparse' };
    return { w: 13, h: 13, stations: 2, noise: 0.6, sensors: 2, mode: 'sparse' };
  }

  function makeReading(row, col, trueDist, noise, rng, kind) {
    var v = trueDist;
    if (noise > 0) v += rng.jitter(noise * 2);
    if (v < 0) v = 0;
    return {
      row: row, col: col,
      value: round2(v),
      tol: (noise > 0 ? noise : 0) + 0.005 + 1e-9,
      noisy: noise > 0,
      kind: kind || 'station'
    };
  }

  /** One generation attempt. Returns a verified layout or null. */
  function attempt(spec, rng) {
    var W = spec.w, H = spec.h;

    // Keep the target off the very edge: a target in a corner is deducible
    // from almost nothing and reads as a bug rather than a break.
    var target = [rng.int(1, H - 2), rng.int(1, W - 2)];
    var taken = {};
    taken[target[0] + ',' + target[1]] = true;

    var stations = [];
    for (var s = 0; s < spec.stations; s++) {
      var cell = null;
      for (var tryN = 0; tryN < 90 && !cell; tryN++) {
        var r = rng.int(0, H - 1), c = rng.int(0, W - 1);
        if (taken[r + ',' + c]) continue;
        if (dist(r, c, target[0], target[1]) < 2.5) continue;         // too close is no puzzle
        var far = true;
        for (var q = 0; q < stations.length; q++) {
          if (dist(r, c, stations[q][0], stations[q][1]) < 3) { far = false; break; }
        }
        if (!far) continue;
        cell = [r, c];
      }
      if (!cell) return null;
      taken[cell[0] + ',' + cell[1]] = true;
      stations.push(cell);
    }

    var readings = [];
    for (s = 0; s < stations.length; s++) {
      readings.push(makeReading(stations[s][0], stations[s][1],
        dist(stations[s][0], stations[s][1], target[0], target[1]), spec.noise, rng, 'station'));
    }

    var cands = matching(H, W, readings);
    var onList = false;
    for (var i = 0; i < cands.length; i++) if (cands[i][0] === target[0] && cands[i][1] === target[1]) onList = true;
    if (!onList) return null;               // noise pushed the truth outside its own band

    var resolver = null;

    if (spec.mode === 'exact') {
      if (cands.length !== 1) return null;                 // must be certain
    } else if (spec.mode === 'noisy') {
      if (cands.length < 2 || cands.length > 14) return null;
      // The truth must be the strict best fit, or "reason about it" is a lie.
      var best = residual(readings, target[0], target[1]);
      for (i = 0; i < cands.length; i++) {
        if (cands[i][0] === target[0] && cands[i][1] === target[1]) continue;
        if (residual(readings, cands[i][0], cands[i][1]) <= best + 1e-9) return null;
      }
    } else {                                                // sparse
      if (cands.length < 2 || cands.length > 30) return null;
      resolver = resolverFor(H, W, cands, target, taken);
      if (!resolver) return null;                           // must be fixable
    }

    return {
      w: W, h: H, target: target, stations: stations, readings: readings,
      candidates: cands, resolver: resolver, mode: spec.mode
    };
  }

  function build(state, rng, tier, skin) {
    var C = CONTENT[skin.id] || CONTENT.beacon;
    var t = Math.min(6, Math.max(1, tier));
    var spec = tierSpec(t);

    var layout = null;
    for (var i = 0; i < 90 && !layout; i++) layout = attempt(spec, rng);

    // Degrade rather than die: exact readings from three stations on a small
    // grid are effectively always unique, so this floor cannot fail.
    if (!layout) {
      var easy = { w: 9, h: 9, stations: 3, noise: 0, sensors: spec.sensors, mode: 'exact' };
      for (i = 0; i < 200 && !layout; i++) layout = attempt(easy, rng);
    }
    if (!layout) {
      layout = {
        w: 9, h: 9, target: [4, 4], stations: [[0, 0], [0, 8], [8, 0]],
        readings: [
          makeReading(0, 0, dist(0, 0, 4, 4), 0, rng, 'station'),
          makeReading(0, 8, dist(0, 8, 4, 4), 0, rng, 'station'),
          makeReading(8, 0, dist(8, 0, 4, 4), 0, rng, 'station')
        ],
        candidates: [[4, 4]], resolver: null, mode: 'exact'
      };
    }

    var lit = {};
    for (i = 0; i < layout.readings.length; i++) lit[i] = true;

    return {
      tier: t,
      content: C,
      w: layout.w, h: layout.h,
      target: layout.target,
      readings: layout.readings,
      stationCount: layout.stations.length,
      mode: layout.mode,
      noise: spec.noise,
      resolver: layout.resolver,
      sensorsLeft: spec.sensors,
      sensorsUsed: 0,
      guessesLeft: 2,
      guesses: [],
      lit: lit,
      pick: null,
      revealed: false,
      done: false
    };
  }

  /* ------------------------------------------------------------ mechanics -- */

  function litReadings(p) {
    var out = [];
    for (var i = 0; i < p.readings.length; i++) if (p.lit[i]) out.push(p.readings[i]);
    return out;
  }

  function liveCandidates(p) { return matching(p.h, p.w, p.readings); }

  function occupied(p) {
    var m = {};
    for (var i = 0; i < p.readings.length; i++) m[p.readings[i].row + ',' + p.readings[i].col] = true;
    return m;
  }

  function isTarget(p, r, c) { return p.target[0] === r && p.target[1] === c; }

  function ref(p, r, c) { return COLS.charAt(c) + (r + 1); }

  /* ================================================================ CSS == */

  var CSS = [
    '.pz-tri{display:grid;grid-template-columns:minmax(0,1fr) minmax(238px,300px);gap:18px;align-items:start}',
    '@media (max-width:900px){.pz-tri{grid-template-columns:1fr}}',

    '.pz-tri-plot{padding:12px;border-radius:12px;border:1px solid var(--line);',
    '  background:radial-gradient(130% 100% at 50% 0%,rgba(110,150,190,.07),transparent 65%),#070a0f}',
    '.pz-tri-grid{display:grid;gap:2px;width:100%;max-width:520px;margin:0 auto}',

    '.pz-tri-lab{display:grid;place-items:center;font-family:var(--font-mono);font-size:9.5px;',
    '  color:var(--dimmer);user-select:none}',

    '.pz-tri-cell{position:relative;aspect-ratio:1/1;display:grid;place-items:center;border-radius:3px;',
    '  font-size:clamp(8px,1.9vw,14px);line-height:1;cursor:pointer;background:#0b0f16;',
    '  border:2px solid transparent;box-shadow:inset 0 0 0 1px #151b25;',
    '  transition:background .18s var(--ease),box-shadow .18s var(--ease)}',
    '.pz-tri-cell:hover{background:#141c27}',
    '.pz-tri-cell.is-band{background:#101927}',
    '.pz-tri-cell.is-cand{background:#16283a}',
    '.pz-tri-cell.is-warm{background:#1c3550}',
    '.pz-tri-cell.is-hot{background:#26496e;box-shadow:inset 0 0 0 1px #4d80b5,0 0 14px rgba(90,150,215,.35)}',

    '.pz-tri-cell.is-b0{border-top-color:#e2a84e}',
    '.pz-tri-cell.is-b1{border-right-color:#5fcf8d}',
    '.pz-tri-cell.is-b2{border-bottom-color:#6fb3e0}',
    '.pz-tri-cell.is-b3{border-left-color:#c98ae0}',

    '.pz-tri-cell.is-station{background:#1a2130;box-shadow:inset 0 0 0 1px #38455c;cursor:default}',
    '.pz-tri-cell.is-sensor{background:#2a2318;box-shadow:inset 0 0 0 1px #6a5730}',
    '.pz-tri-cell.is-pick{box-shadow:inset 0 0 0 2px var(--acc),0 0 16px var(--acc-glow);background:var(--acc-wash)}',
    '.pz-tri-cell.is-miss{background:rgba(226,105,95,.22);box-shadow:inset 0 0 0 1px var(--bad)}',
    '.pz-tri-cell.is-found{background:rgba(95,207,141,.3);box-shadow:inset 0 0 0 2px var(--good),0 0 22px rgba(95,207,141,.5)}',
    '.pz-tri-cell.is-armed{cursor:crosshair}',
    '.pz-tri-cell.is-dead{cursor:default}',

    '.pz-tri-list{display:flex;flex-direction:column;gap:6px}',
    '.pz-tri-station{display:grid;grid-template-columns:auto 1fr auto;gap:9px;align-items:center;text-align:left;',
    '  padding:7px 9px;border-radius:9px;cursor:pointer;font-family:var(--font-ui);color:var(--text-2);',
    '  background:linear-gradient(180deg,var(--panel-2),var(--panel));border:1px solid var(--line);',
    '  transition:border-color .18s var(--ease),opacity .18s var(--ease)}',
    '.pz-tri-station:hover{border-color:var(--acc)}',
    '.pz-tri-station.is-off{opacity:.42}',
    '.pz-tri-station b{display:block;font-size:12px;font-weight:600}',
    '.pz-tri-station span{font-family:var(--font-mono);font-size:10px;color:var(--dimmer)}',
    '.pz-tri-swatch{width:11px;height:11px;border-radius:3px}',
    '.pz-tri-swatch.is-b0{background:#e2a84e}.pz-tri-swatch.is-b1{background:#5fcf8d}',
    '.pz-tri-swatch.is-b2{background:#6fb3e0}.pz-tri-swatch.is-b3{background:#c98ae0}',
    '.pz-tri-read{font-family:var(--font-mono);font-size:13px;color:var(--acc-2);font-variant-numeric:tabular-nums}',

    '.pz-tri-rows{display:flex;flex-direction:column;gap:6px}',
    '.pz-tri-row{display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:11px;color:var(--dim)}',
    '.pz-tri-row b{color:var(--acc-2)}',
    '.pz-tri-row.is-solo b{color:var(--good)}',
    '.pz-tri-row.is-many b{color:var(--warn)}',

    '.pz-tri-note{font-size:12px;line-height:1.5;color:var(--info);padding:9px 11px;border-radius:7px;',
    '  background:rgba(111,179,224,.08);border:1px solid rgba(111,179,224,.26)}',
    '.pz-tri-note.is-warn{color:var(--warn);background:rgba(230,180,85,.08);border-color:rgba(230,180,85,.26)}',
    '.pz-tri-note.is-bad{color:var(--bad);background:rgba(226,105,95,.08);border-color:rgba(226,105,95,.28)}',

    '.pz-tri-legend{display:flex;flex-wrap:wrap;gap:9px;font-size:11px;color:var(--dim)}',
    '.pz-tri-legend span{display:inline-flex;gap:5px;align-items:center}'
  ].join('\n');

  /* ================================================================ MOUNT = */

  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var C = puzzle.content;
    var W = puzzle.w, H = puzzle.h;
    var finished = false;
    var armed = false;

    var cellEls = [];
    var grid = h('div', {
      class: 'pz-tri-grid',
      style: { gridTemplateColumns: '20px repeat(' + W + ', minmax(0,1fr))' }
    });
    var list = h('div', { class: 'pz-tri-list' });
    var rows = h('div', { class: 'pz-tri-rows' });
    var noteBox = h('div', {});
    var controls = h('div', { class: 'pz-col' });

    /* ---------------------------------------------------------------- grid */

    grid.appendChild(h('div', { class: 'pz-tri-lab' }));
    for (var c0 = 0; c0 < W; c0++) grid.appendChild(h('div', { class: 'pz-tri-lab', text: COLS.charAt(c0) }));

    for (var r0 = 0; r0 < H; r0++) {
      grid.appendChild(h('div', { class: 'pz-tri-lab', text: String(r0 + 1) }));
      for (var c1 = 0; c1 < W; c1++) {
        (function (r, c) {
          var cell = h('div', { class: 'pz-tri-cell', 'data-act': 'cell:' + r + ',' + c });
          cell.addEventListener('click', function () { tapCell(r, c); });
          cellEls[r * W + c] = cell;
          grid.appendChild(cell);
        })(r0, c1);
      }
    }

    function tapCell(r, c) {
      if (finished || puzzle.done) return;
      var occ = occupied(puzzle);

      if (armed) {
        if (occ[r + ',' + c]) { api.toast('There is already a set on that square.', 'bad'); return; }
        deploy(r, c);
        return;
      }
      if (occ[r + ',' + c]) {
        api.toast('That is one of your own sets. The reading came from there.', 'info');
        return;
      }
      puzzle.pick = [r, c];
      paint();
    }

    function deploy(r, c) {
      armed = false;
      puzzle.sensorsLeft--;
      puzzle.sensorsUsed++;
      puzzle.readings.push(makeReading(r, c, dist(r, c, puzzle.target[0], puzzle.target[1]), 0, api.rng, 'sensor'));
      puzzle.lit[puzzle.readings.length - 1] = true;
      api.tweak({ energy: -5 });
      api.toast(C.deployLine, 'good');
      paint();
    }

    function armSensor() {
      if (finished || puzzle.done) return;
      if (puzzle.sensorsLeft <= 0) { api.toast('You have no sets left to put out.', 'bad'); return; }
      armed = !armed;
      paint();
    }

    function toggleRing(i) {
      if (finished) return;
      puzzle.lit[i] = !puzzle.lit[i];
      paint();
    }

    /* -------------------------------------------------------------- paint -- */

    function paint() {
      var lits = [];
      for (var i = 0; i < puzzle.readings.length; i++) if (puzzle.lit[i]) lits.push(i);

      // Which cells sit inside every lit ring, and how badly each one misses.
      var cand = {}, lo = Infinity, hi = -Infinity, k;
      for (var r = 0; r < H; r++) {
        for (var c = 0; c < W; c++) {
          if (!lits.length) continue;
          var all = true;
          for (k = 0; k < lits.length; k++) {
            if (!within(puzzle.readings[lits[k]], r, c)) { all = false; break; }
          }
          if (!all) continue;
          var res = 0;
          for (k = 0; k < lits.length; k++) {
            var e = dist(r, c, puzzle.readings[lits[k]].row, puzzle.readings[lits[k]].col) - puzzle.readings[lits[k]].value;
            res += e * e;
          }
          cand[r + ',' + c] = res;
          if (res < lo) lo = res;
          if (res > hi) hi = res;
        }
      }
      var span = hi - lo;

      var occ = {};
      for (i = 0; i < puzzle.readings.length; i++) {
        occ[puzzle.readings[i].row + ',' + puzzle.readings[i].col] = i;
      }
      var missed = {};
      for (i = 0; i < puzzle.guesses.length; i++) missed[puzzle.guesses[i][0] + ',' + puzzle.guesses[i][1]] = true;

      for (r = 0; r < H; r++) {
        for (c = 0; c < W; c++) {
          var key = r + ',' + c;
          var cell = cellEls[r * W + c];
          var cls = 'pz-tri-cell';
          var glyph = '';

          if (Object.prototype.hasOwnProperty.call(cand, key)) {
            if (span < 1e-9) cls += ' is-hot';
            else {
              var norm = (cand[key] - lo) / span;
              cls += norm <= 0.34 ? ' is-hot' : (norm <= 0.67 ? ' is-warm' : ' is-cand');
            }
          } else if (lits.length > 1) {
            for (k = 0; k < lits.length; k++) {
              if (within(puzzle.readings[lits[k]], r, c)) { cls += ' is-band'; break; }
            }
          }

          for (k = 0; k < lits.length; k++) {
            if (within(puzzle.readings[lits[k]], r, c)) cls += ' is-b' + (lits[k] % 4);
          }

          if (Object.prototype.hasOwnProperty.call(occ, key)) {
            var rd = puzzle.readings[occ[key]];
            cls += rd.kind === 'sensor' ? ' is-sensor' : ' is-station';
            glyph = rd.kind === 'sensor' ? C.sensorIcon : C.stationIcon;
          }
          if (missed[key]) { cls += ' is-miss'; glyph = '\u2715'; }
          if (puzzle.pick && puzzle.pick[0] === r && puzzle.pick[1] === c && !puzzle.revealed) {
            cls += ' is-pick';
            if (!glyph) glyph = '\u2316';
          }
          if (puzzle.revealed && isTarget(puzzle, r, c)) { cls += ' is-found'; glyph = C.targetIcon; }
          if (finished || puzzle.done) cls += ' is-dead';
          else if (armed) cls += ' is-armed';

          cell.className = cls;
          cell.textContent = glyph;
        }
      }

      paintList();
      paintRows();
      paintNote();
    }

    function paintList() {
      PS.ui.clear(list);
      for (var i = 0; i < puzzle.readings.length; i++) {
        (function (idx) {
          var rd = puzzle.readings[idx];
          var name = (rd.kind === 'sensor' ? C.sensorName : C.stationName) + ' ' + ref(puzzle, rd.row, rd.col);
          var btn = h('button', {
            class: 'pz-tri-station' + (puzzle.lit[idx] ? '' : ' is-off'),
            type: 'button', 'data-act': 'ring:' + idx,
            title: 'Show or hide this ring',
            onclick: function () { toggleRing(idx); }
          }, [
            h('div', { class: 'pz-tri-swatch is-b' + (idx % 4) }),
            h('div', {}, [
              h('b', { text: PS.state.prettify(name) }),
              h('span', { text: rd.noisy ? 'drifting \u00B1' + puzzle.noise.toFixed(2) : 'calibrated' })
            ]),
            h('div', { class: 'pz-tri-read', text: rd.value.toFixed(2) })
          ]);
          list.appendChild(btn);
        })(i);
      }
    }

    function paintRows() {
      PS.ui.clear(rows);
      var live = liveCandidates(puzzle).length;
      PS.ui.append(rows, [
        rowOf('Grid', W + ' \u00D7 ' + H + ' ' + C.unit),
        rowOf('Readings', String(puzzle.readings.length)),
        rowOf('Cells that fit', String(live), live === 1 ? 'solo' : (live > 1 ? 'many' : '')),
        rowOf('Sets in hand', String(puzzle.sensorsLeft)),
        rowOf('Plots left', String(puzzle.guessesLeft)),
        rowOf('Marked', puzzle.pick ? ref(puzzle, puzzle.pick[0], puzzle.pick[1]) : '\u2014')
      ]);
    }

    function rowOf(k, v, mod) {
      return h('div', { class: 'pz-tri-row' + (mod ? ' is-' + mod : '') }, [
        h('span', { text: k }), h('b', { text: v })
      ]);
    }

    function paintNote() {
      PS.ui.clear(noteBox);
      if (finished || puzzle.done) return;
      if (armed) {
        noteBox.appendChild(h('div', { class: 'pz-tri-note is-warn', text:
          'Pick a square for the ' + C.sensorName + '. Put it somewhere the cells that still fit are all different distances away, or it tells you nothing.' }));
        return;
      }
      var live = liveCandidates(puzzle).length;
      if (live === 1) {
        noteBox.appendChild(h('div', { class: 'pz-tri-note', text:
          'Exactly one square satisfies every reading. Mark it and commit.' }));
      } else if (puzzle.sensorsLeft > 0) {
        noteBox.appendChild(h('div', { class: 'pz-tri-note is-warn', text:
          live + ' squares fit every reading. Two ranges cannot separate them \u2014 you need a third from somewhere you choose.' }));
      } else {
        noteBox.appendChild(h('div', { class: 'pz-tri-note is-warn', text:
          live + ' squares fit, and the readings are drifting. The one you want is the one that misses every range by the least \u2014 it is the brightest square on the plot.' }));
      }
    }

    /* ------------------------------------------------------------ endings -- */

    function commit() {
      if (finished || puzzle.done) return;
      if (armed) { api.toast('Put the ' + C.sensorName + ' down first, or stand it down.', 'bad'); return; }
      if (!puzzle.pick) { api.toast('Mark a square on the plot first.', 'bad'); return; }

      var r = puzzle.pick[0], c = puzzle.pick[1];
      puzzle.guessesLeft--;

      if (isTarget(puzzle, r, c)) {
        puzzle.done = true;
        puzzle.revealed = true;
        var first = puzzle.guessesLeft === 1;
        paint();
        PS.ui.clear(controls);
        PS.ui.append(controls, [
          h('div', { class: 'pz-intro', text: (first ? C.hitFirst : C.hitSecond) + ' ' +
            PS.state.prettify(C.targetName) + ' is at ' + ref(puzzle, r, c) + '.' }),
          h('div', { class: 'pz-choices' }, [choiceBtn(C.go, 'sprint'), choiceBtn(C.call, 'signal')])
        ]);
        api.flash();
        return;
      }

      puzzle.guesses.push([r, c]);
      puzzle.pick = null;
      var off = dist(r, c, puzzle.target[0], puzzle.target[1]);
      if (puzzle.guessesLeft > 0) {
        api.tweak({ energy: -4, morale: -3 });
        api.toast('Nothing at ' + ref(puzzle, r, c) + '. You were ' + off.toFixed(2) + ' ' + C.unit + ' out.', 'bad');
        paint();
        return;
      }
      wrong(off);
    }

    function choiceBtn(spec, id) {
      return h('button', {
        class: 'pz-choice', type: 'button', 'data-act': 'choice:' + id,
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
      var first = puzzle.guesses.length === 0;
      var unaided = puzzle.sensorsUsed === 0;

      api.finish({
        outcome: first ? 'success' : 'partial',
        stats: first
          ? { morale: 9, energy: -4 - puzzle.tier, light: 0 }
          : { morale: 3, energy: -8 - puzzle.tier },
        gain: first ? ['map'] : ['map'],
        lose: [],
        tags: ['took_a_fix'].concat(unaided ? ['read_it_cold'] : ['deployed_a_set'])
          .concat(choice === 'signal' ? ['put_it_on_the_air'] : []),
        signals: {
          logic: first ? 3 : 2,
          caution: 1 + (unaided ? 0 : 1),
          speed: first && unaided ? 2 : 0,
          scavenge: 0
        },
        choice: choice,
        summary: 'You crossed ' + puzzle.readings.length + ' ranges and put ' + C.targetName +
          ' at ' + ref(puzzle, puzzle.target[0], puzzle.target[1]) +
          (first ? ' first time.' : ' on the second plot.')
      });
    }

    function wrong(off) {
      if (finished) return;
      finished = true;
      puzzle.done = true;
      puzzle.revealed = true;
      paint();
      PS.ui.clear(controls);
      controls.appendChild(h('div', { class: 'pz-intro', text:
        C.missLine + ' It was at ' + ref(puzzle, puzzle.target[0], puzzle.target[1]) + ' the whole time.' }));
      api.finish({
        outcome: 'fail',
        stats: { morale: -10, energy: -10 },
        gain: [], lose: [],
        tags: ['lost_the_fix'],
        signals: { logic: 0, caution: 1, speed: 0 },
        choice: null,
        summary: 'You put ' + C.targetName + ' ' + off.toFixed(1) + ' ' + C.unit +
          ' from where it actually was and walked to the wrong square.'
      });
    }

    function abandon() {
      if (finished || puzzle.done) return;
      finished = true;
      puzzle.done = true;
      puzzle.revealed = true;
      paint();
      api.finish({
        outcome: 'fail',
        stats: { morale: -6, energy: -4 },
        gain: [], lose: [],
        tags: ['left_the_fix'],
        signals: { caution: 2 },
        choice: null,
        summary: 'You left ' + C.targetName + ' unplotted and moved on without it.'
      });
    }

    function allRings(on) {
      for (var i = 0; i < puzzle.readings.length; i++) puzzle.lit[i] = on;
      paint();
    }

    /* ------------------------------------------------------------ keyboard */

    function onKey(ev) {
      if (finished || puzzle.done) return;
      if (ev.key === 'Enter') { ev.preventDefault(); commit(); return; }
      if (ev.key === 'Escape') { armed = false; puzzle.pick = null; paint(); }
    }
    document.addEventListener('keydown', onKey);
    teardownFns.push(function () { document.removeEventListener('keydown', onKey); });

    /* ------------------------------------------------------------- layout -- */

    PS.ui.append(controls, [
      h('div', { class: 'pz-row' }, [
        h('button', { class: 'pz-btn pz-btn--sm', type: 'button', 'data-act': 'all-on',
          onclick: function () { allRings(true); } }, ['All rings']),
        h('button', { class: 'pz-btn pz-btn--sm', type: 'button', 'data-act': 'all-off',
          onclick: function () { allRings(false); } }, ['Clear plot'])
      ]),
      h('button', { class: 'pz-btn pz-btn--sm', type: 'button', 'data-act': 'deploy', onclick: armSensor },
        ['\uD83D\uDCCD Put out a ' + C.sensorName]),
      h('button', { class: 'pz-btn pz-btn--primary', type: 'button', 'data-act': 'commit', onclick: commit },
        ['Commit the fix']),
      h('button', { class: 'pz-btn pz-btn--danger pz-btn--sm', type: 'button', 'data-act': 'giveup', onclick: abandon },
        ['\u21A9 Leave it unplotted'])
    ]);

    PS.ui.append(el, h('div', { class: 'pz-tri' }, [
      h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-intro', text: C.goal }),
        h('div', { class: 'pz-tri-plot' }, [grid]),
        h('div', { class: 'pz-tri-legend' }, [
          h('span', {}, [C.stationIcon, ' ' + C.stationName]),
          h('span', {}, [C.sensorIcon, ' ' + C.sensorName]),
          h('span', {}, ['\u2316 your mark']),
          h('span', {}, [C.targetIcon, ' ' + C.targetName])
        ]),
        h('div', { class: 'pz-note' }, [
          'Every lit ring paints the squares at that exact range. Squares inside ',
          h('strong', { text: 'all' }),
          ' of them are lit brightest. Click a square to mark it, then commit \u2014 you get two plots.'
        ])
      ]),
      h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-card' }, [h('div', { class: 'pz-card__head', text: 'Plot' }), rows]),
        noteBox,
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: PS.state.prettify(C.stationPlural) }), list
        ]),
        h('div', { class: 'pz-card' }, [h('div', { class: 'pz-card__head', text: 'Set' }), controls])
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

  function hint(puzzle, state, skin) {
    var C = puzzle.content;
    if (puzzle.done) return 'It is plotted. Decide how you are getting there.';

    var cands = liveCandidates(puzzle);
    if (cands.length === 1) {
      return 'One square satisfies every range you have: ' + ref(puzzle, cands[0][0], cands[0][1]) + '. Mark it.';
    }
    if (!cands.length) {
      return 'Nothing fits all of them, which means a range is drifting. Take the widest one out of the plot and work with the rest.';
    }
    if (puzzle.sensorsLeft > 0) {
      var spot = resolverFor(puzzle.h, puzzle.w, cands, puzzle.target, occupied(puzzle));
      if (spot) {
        return cands.length + ' squares still fit. Put a ' + C.sensorName + ' on ' + ref(puzzle, spot[0], spot[1]) +
          ' \u2014 from there every one of those squares is a different range, so its reading can only mean one of them.';
      }
    }
    var best = cands[0], bestRes = residual(puzzle.readings, cands[0][0], cands[0][1]);
    for (var i = 1; i < cands.length; i++) {
      var res = residual(puzzle.readings, cands[i][0], cands[i][1]);
      if (res < bestRes) { bestRes = res; best = cands[i]; }
    }
    return cands.length + ' squares fit inside the drift. The one that misses every range by the least is ' +
      ref(puzzle, best[0], best[1]) + ', and with readings this loose that is the best anyone could do.';
  }

  /* ============================================================ AUTOSOLVE = */
  /* Headless. Deploys a set only when the plot is genuinely ambiguous, then
     reports the fix it deduced. `answer` and `sensors` let a driver replay it. */

  function autoSolve(puzzle, rng, state, tier, skin) {
    var C = puzzle.content;
    var cands = liveCandidates(puzzle);
    var sensors = [];

    if (cands.length > 1 && puzzle.sensorsLeft > 0) {
      var spot = resolverFor(puzzle.h, puzzle.w, cands, puzzle.target, occupied(puzzle));
      if (spot) sensors.push(spot);
    }

    var unaided = sensors.length === 0;
    var direct = rng.chance(0.5);

    return {
      outcome: 'success',
      stats: { morale: 9, energy: -4 - puzzle.tier - sensors.length * 5 },
      gain: ['map'],
      lose: [],
      tags: ['took_a_fix'].concat(unaided ? ['read_it_cold'] : ['deployed_a_set'])
        .concat(direct ? [] : ['put_it_on_the_air']),
      signals: { logic: 3, caution: unaided ? 1 : 2, speed: unaided ? 2 : 0, scavenge: 0 },
      choice: direct ? 'sprint' : 'signal',
      summary: 'Crossed the ranges and put ' + C.targetName + ' at ' +
        ref(puzzle, puzzle.target[0], puzzle.target[1]) + ' first time.',
      answer: puzzle.target.slice(),
      sensors: sensors
    };
  }

  /* ============================================================ REGISTER = */

  PS.registry.register({
    id: 'triangulation',
    name: 'Triangulation',
    icon: '\uD83D\uDCE1',
    blurb: 'Three ranges and no bearings. Cross the rings and find the one square they agree on.',

    favors:   { logic: 3, caution: 1 },
    provides: ['intel', 'map', 'information', 'vantage'],
    tagHooks: ['has_map', 'has_radio', 'took_a_fix'],
    requires: function (state) { return state.stats.energy > 8; },

    css: CSS,

    skins: [
      {
        id: 'beacon', biome: 'wilderness', title: 'Beacon Hunt', icon: '\uD83D\uDCE1', palette: 'moss',
        intro: 'Somewhere out in the bog a locator beacon has been going for eleven hours. Three relay masts on the ridgeline can all hear it and not one of them can tell you which direction it is in. All you get is how far.',
        nouns: { target: 'the beacon', station: 'relay', unit: 'kilometre' }
      },
      {
        id: 'cell_tower', biome: 'urban', title: 'Cell Tower Trace', icon: '\uD83D\uDCF6', palette: 'steel',
        intro: 'The handset is still registering with the network from somewhere in fifty blocks of dark city. Each mast reports a range and nothing else. Whoever is holding it has a few hours of battery and no idea anyone is looking.',
        nouns: { target: 'the handset', station: 'mast', unit: 'block' }
      },
      {
        id: 'sonar', biome: 'water', title: 'Sonar Ping', icon: '\uD83D\uDD0A', palette: 'ice',
        intro: 'The pinger under the hull has been going since it went down and it is getting quieter. The hydrophones give you range rings and the sea gives you nothing. Cross them before the battery does what batteries do.',
        nouns: { target: 'the pinger', station: 'hydrophone', unit: 'cable' }
      }
    ],

    build: build,
    mount: mount,
    unmount: unmount,
    hint: hint,
    autoSolve: autoSolve
  });

})(typeof window !== 'undefined' ? window : this);
