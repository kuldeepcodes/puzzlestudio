/* ==========================================================================
   PuzzleStudio — js/games/e13_adjacency_deduction.js
                                              ENGINE 13 · Adjacency Deduction
   --------------------------------------------------------------------------
   Self-contained: logic + 3 skins + its own CSS. No DOM access until mount().

   THE PUZZLE
     Minesweeper reasoning, but you are not clearing the board — you are
     CROSSING it. A grid where some cells will not hold you. Every cell you
     safely stand on tells you how many of its eight neighbours are bad. You
     need a connected line of your own footprints from the near edge to the
     far one, and nothing else. Two thirds of the board can stay a mystery.

   THE GUARANTEE
     A generated board is worthless if the crossing needs a guess. So every
     board is run through a solver that plays it the way an honest player
     would: propagate what the revealed counts force, step only onto cells
     that are PROVEN safe, and never guess. If that solver cannot get from the
     near edge to the far edge, the board is thrown away and regenerated.
     After enough failures a guaranteed-deducible corridor is carved instead,
     so a bad seed can never hand you an unsolvable crossing.

     The solver uses two rules, which is exactly the set a person uses:
       1. count minus known-bad neighbours == 0            -> the rest are safe
          count minus known-bad neighbours == unknown count -> the rest are bad
       2. the subset rule: if one cell's unknowns are contained in another's,
          the difference is forced by the difference of their counts.

   THE COST
     Standing on a bad cell hurts badly and never ends the run. You do not go
     through the floor and die; you go through the floor, and then you climb
     back out of the hole with less blood in you.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio;
  if (!PS || !PS.registry) { if (root.console) console.error('[e13] core not loaded'); return; }

  /* ======================================================== SKIN CONTENT == */

  var CONTENT = {
    unstable_floor: {
      hazardWord: 'soft board', hazardPlural: 'soft boards', hazardIcon: '\uD83D\uDD73\uFE0F',
      flagIcon: '\uD83D\uDEA9', playerIcon: '\uD83E\uDDCD', safeIcon: '\u00B7',
      farSide: 'the far doorway', nearSide: 'the landing',
      probeWord: 'test it with your weight', gridWord: 'floor',
      hit: ['The board goes and your leg goes with it, straight through to the joist.',
        'It gives all at once. You catch yourself on your ribs across the gap.',
        'Rotten. You go down to the hip and something below you keeps falling for a while.'],
      clear: 'You are across, on boards that will hold.',
      messy: 'You are across. The floor took its cut on the way.',
      onward: { icon: '\uD83D\uDEAA', title: 'Through the far door', desc: 'It is shut but not locked, and the floor beyond sounds solid.' },
      careful: { icon: '\uD83E\uDDF0', title: 'Lift the good boards', desc: 'You know exactly which ones will hold now. That is worth carrying out with you.' }
    },
    marked_minefield: {
      hazardWord: 'live charge', hazardPlural: 'live charges', hazardIcon: '\uD83D\uDCA5',
      flagIcon: '\uD83D\uDEA9', playerIcon: '\uD83E\uDDCD', safeIcon: '\u00B7',
      farSide: 'the treeline', nearSide: 'the fence line',
      probeWord: 'sound it with the probe', gridWord: 'ground',
      hit: ['The ground jumps and hits you in the chest before you hear it.',
        'It goes off short and low and fills your ear with a sound like a struck bell.',
        'A grey cough of dirt and you are on your back looking at sky.'],
      clear: 'You are at the treeline, on ground you can account for.',
      messy: 'You reach the trees. Two of them are supporting you.',
      onward: { icon: '\uD83C\uDF32', title: 'Into the treeline', desc: 'Cover, shade, and nothing under the leaf litter but leaf litter.' },
      careful: { icon: '\uD83D\uDCCD', title: 'Mark the lane behind you', desc: 'Somebody else will come through here. Leave them a line they can trust.' }
    },
    thin_ice: {
      hazardWord: 'rotten plate', hazardPlural: 'rotten plates', hazardIcon: '\uD83D\uDCA7',
      flagIcon: '\uD83D\uDEA9', playerIcon: '\uD83E\uDDCD', safeIcon: '\u00B7',
      farSide: 'the far bank', nearSide: 'the shingle',
      probeWord: 'tap it with the pole', gridWord: 'ice',
      hit: ['The plate tips and you are in to the chest, hands flat on ice that keeps breaking.',
        'It lets go with a crack that runs away from you in both directions.',
        'Black water, instantly, up to the shoulders. The cold arrives a second later.'],
      clear: 'You are on the far bank with dry sleeves.',
      messy: 'You reach the bank soaked through and shaking.',
      onward: { icon: '\uD83C\uDFD4\uFE0F', title: 'Up the far bank', desc: 'Rock and scrub and, for the first time in an hour, ground that is simply ground.' },
      careful: { icon: '\uD83E\uDEA2', title: 'Fix a line across', desc: 'You know where every good plate is. Rope it, and the crossing stays open behind you.' }
    }
  };

  /* ========================================================== GEOMETRY == */

  function neighbourTables(w, h) {
    var n4 = [], n8 = [], near = [], i, x, y, dx, dy, nx, ny;
    for (i = 0; i < w * h; i++) { n4.push([]); n8.push([]); near.push([]); }
    for (y = 0; y < h; y++) {
      for (x = 0; x < w; x++) {
        i = y * w + x;
        for (dy = -2; dy <= 2; dy++) {
          for (dx = -2; dx <= 2; dx++) {
            if (!dx && !dy) continue;
            nx = x + dx; ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
            var j = ny * w + nx;
            near[i].push(j);
            if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) n8[i].push(j);
            if (Math.abs(dx) + Math.abs(dy) === 1) n4[i].push(j);
          }
        }
      }
    }
    return { n4: n4, n8: n8, near: near };
  }

  function countsFor(w, h, n8, hazard) {
    var counts = [];
    for (var i = 0; i < w * h; i++) {
      var c = 0;
      for (var j = 0; j < n8[i].length; j++) if (hazard[n8[i][j]]) c++;
      counts.push(c);
    }
    return counts;
  }

  /* ============================================================ SOLVER == */

  /**
   * Constraint propagation over the revealed counts.
   * Mutates `safe` and `haz` (both idx -> true maps) in place.
   *
   * Rule 1 is the pair every player works out for themselves in ten seconds.
   * Rule 2 — the subset rule — is the one that turns a guess into a deduction,
   * and it is the reason a board can be dense and still be honest.
   */
  function propagate(n8, near, revealed, safe, haz) {
    var ids = [], k;
    for (k in revealed) if (Object.prototype.hasOwnProperty.call(revealed, k)) ids.push(+k);

    var changed = true, guard = 0;
    while (changed && guard++ < 80) {
      changed = false;
      var frames = {};       // idx -> { unk: [...], need: n }

      for (var a = 0; a < ids.length; a++) {
        var c = ids[a], unk = [], flagged = 0, nb = n8[c], j, m;
        for (j = 0; j < nb.length; j++) {
          m = nb[j];
          if (haz[m]) flagged++;
          else if (!safe[m]) unk.push(m);
        }
        if (!unk.length) continue;
        var need = revealed[c] - flagged;
        if (need <= 0) {
          for (j = 0; j < unk.length; j++) safe[unk[j]] = true;
          changed = true;
        } else if (need === unk.length) {
          for (j = 0; j < unk.length; j++) haz[unk[j]] = true;
          changed = true;
        } else {
          frames[c] = { unk: unk, need: need };
        }
      }
      if (changed) continue;

      // --- rule 2: subsets. Only worth the cost once rule 1 is exhausted. ---
      for (a = 0; a < ids.length; a++) {
        var A = frames[ids[a]];
        if (!A) continue;
        var pool = near[ids[a]];
        for (var b = 0; b < pool.length; b++) {
          var B = frames[pool[b]];
          if (!B || B === A || B.unk.length <= A.unk.length) continue;

          var contained = true;
          for (var u = 0; u < A.unk.length; u++) {
            if (B.unk.indexOf(A.unk[u]) < 0) { contained = false; break; }
          }
          if (!contained) continue;

          var diff = [];
          for (u = 0; u < B.unk.length; u++) if (A.unk.indexOf(B.unk[u]) < 0) diff.push(B.unk[u]);
          if (!diff.length) continue;

          var needDiff = B.need - A.need;
          if (needDiff === 0) {
            for (u = 0; u < diff.length; u++) safe[diff[u]] = true;
            changed = true;
          } else if (needDiff === diff.length) {
            for (u = 0; u < diff.length; u++) haz[diff[u]] = true;
            changed = true;
          }
        }
        if (changed) break;
      }
    }
  }

  /**
   * Play the board the way an honest player would: never step anywhere that is
   * not PROVEN safe. Returns whether the far edge is reachable that way.
   */
  function deduce(w, h, n4, n8, near, counts, start) {
    var revealed = {}, safe = {}, haz = {};
    safe[start] = true;
    revealed[start] = counts[start];

    var walked = [start], steps = 0, guard = 0;
    if (Math.floor(start / w) === h - 1) return { crossed: true, steps: 0, walked: walked };

    while (guard++ < w * h + 8) {
      propagate(n8, near, revealed, safe, haz);

      // Step onto the provably-safe unknown that gets us deepest.
      var next = -1, bestRow = -1;
      for (var i = 0; i < walked.length; i++) {
        var nb = n4[walked[i]];
        for (var j = 0; j < nb.length; j++) {
          var m = nb[j];
          if (revealed[m] !== undefined || haz[m] || !safe[m]) continue;
          var row = Math.floor(m / w);
          if (row > bestRow) { bestRow = row; next = m; }
        }
      }
      if (next < 0) return { crossed: false, steps: steps, walked: walked };

      revealed[next] = counts[next];
      walked.push(next);
      steps++;
      if (Math.floor(next / w) === h - 1) return { crossed: true, steps: steps, walked: walked };
    }
    return { crossed: false, steps: steps, walked: walked };
  }

  /** Shortest walk over safe ground from start to any far-edge cell. */
  function shortestSafe(w, h, n4, hazard, start) {
    var dist = {}, q = [start], head = 0;
    dist[start] = 0;
    while (head < q.length) {
      var c = q[head++];
      if (Math.floor(c / w) === h - 1) return dist[c];
      for (var i = 0; i < n4[c].length; i++) {
        var m = n4[c][i];
        if (hazard[m] || dist[m] !== undefined) continue;
        dist[m] = dist[c] + 1;
        q.push(m);
      }
    }
    return -1;
  }

  /* ============================================================== BUILD == */

  /** A wandering but downward-biased line of guaranteed-safe ground. */
  function carveRoute(w, h, rng) {
    var x = rng.int(1, w - 2), y = 0;
    var start = x;
    var route = {}, order = [];
    var guard = 0;

    function put(px, py) {
      var k = py * w + px;
      if (!route[k]) { route[k] = true; order.push(k); }
    }
    put(x, y);

    while (y < h - 1 && guard++ < w * h * 3) {
      var opts = [[x, y + 1], [x, y + 1], [x, y + 1]];      // heavily biased down
      if (x - 1 >= 0 && !route[y * w + x - 1]) opts.push([x - 1, y]);
      if (x + 1 < w && !route[y * w + x + 1]) opts.push([x + 1, y]);
      var p = rng.pick(opts);
      x = p[0]; y = p[1];
      put(x, y);
    }
    while (y < h - 1) { y++; put(x, y); }                   // guard tripped: go straight down

    return { cells: route, order: order, start: start };
  }

  function build(state, rng, tier, skin) {
    var C = CONTENT[skin.id] || CONTENT.unstable_floor;
    var t = Math.min(6, tier);

    var w = Math.min(9, 6 + Math.floor((t + 1) / 2));
    var h = Math.min(9, 6 + Math.floor(t / 2));
    var tbl = neighbourTables(w, h);
    var density = 0.11 + t * 0.028;

    // A board is only worth playing if there is something to deduce. Too few
    // hazards and it is a corridor; a crossing that never sees a number is not
    // a deduction puzzle, it is a walk.
    var minHaz = Math.max(3, Math.round(w * h * density * 0.55));
    var minInformative = 0.3;

    var best = null, i, k;

    for (var attempt = 1; attempt <= 16; attempt++) {
      var route = carveRoute(w, h, rng);
      var start = route.start;                              // index of the entry cell (row 0)

      var hazard = [];
      for (i = 0; i < w * h; i++) hazard.push(false);
      for (i = 0; i < w * h; i++) {
        if (route.cells[i] || i === start) continue;
        if (rng.chance(density)) hazard[i] = true;
      }
      // The first cell always reads zero, so there is always an opening move.
      // A crossing that begins with a coin flip is not a deduction puzzle.
      for (i = 0; i < tbl.n8[start].length; i++) hazard[tbl.n8[start][i]] = false;

      var counts = countsFor(w, h, tbl.n8, hazard);
      var solved = deduce(w, h, tbl.n4, tbl.n8, tbl.near, counts, start);

      var hazardCount = 0;
      for (i = 0; i < hazard.length; i++) if (hazard[i]) hazardCount++;

      var nonzero = 0;
      for (i = 0; i < solved.walked.length; i++) if (counts[solved.walked[i]] > 0) nonzero++;
      var informative = nonzero / Math.max(1, solved.walked.length);

      var cand = {
        hazard: hazard, counts: counts, start: start, route: route, solved: solved,
        hazardCount: hazardCount, informative: informative, attempts: attempt,
        score: (solved.crossed ? 1000 : 0) + Math.min(hazardCount, minHaz) * 10 + informative * 20
      };
      if (!best || cand.score > best.score) best = cand;

      if (solved.crossed && hazardCount >= minHaz && informative >= minInformative) break;
    }

    var fallback = false;
    if (!best.solved.crossed) {
      // Last resort: clear everything touching the route. Every route cell then
      // reads zero, which proves its neighbours safe, which means the crossing
      // is deducible by rule 1 alone. Dull, but never unsolvable.
      fallback = true;
      for (k = 0; k < best.route.order.length; k++) {
        var cell = best.route.order[k];
        best.hazard[cell] = false;
        for (i = 0; i < tbl.n8[cell].length; i++) best.hazard[tbl.n8[cell][i]] = false;
      }
      best.counts = countsFor(w, h, tbl.n8, best.hazard);
      best.solved = deduce(w, h, tbl.n4, tbl.n8, tbl.near, best.counts, best.start);
      best.hazardCount = 0;
      for (i = 0; i < best.hazard.length; i++) if (best.hazard[i]) best.hazardCount++;
    }

    var revealed = {};
    revealed[best.start] = best.counts[best.start];

    return {
      w: w, h: h,
      n4: tbl.n4, n8: tbl.n8, near: tbl.near,
      hazard: best.hazard,
      counts: best.counts,
      start: best.start,
      at: best.start,
      revealed: revealed,          // idx -> count, the cells you have stood on
      flags: {},                   // idx -> true, your own guesses
      triggered: {},               // idx -> true, the ones that got you
      hazardCount: best.hazardCount,
      informative: best.informative,
      minPath: Math.max(1, shortestSafe(w, h, tbl.n4, best.hazard, best.start)),
      solverSteps: best.solved.steps,
      attempts: best.attempts,
      fallback: fallback,
      steps: 0,
      hits: 0,
      damage: 9 + Math.round(t * 2.4),
      done: false,
      tier: t,
      content: C
    };
  }


  /* ================================================================ CSS == */
  /* The ground itself is the arena's canvas. This dresses the strip of
     briefing that sits under it. */

  var CSS = [
    '.pz-adj{display:flex;flex-direction:column;gap:12px}',

    '.pz-adj-tips{display:flex;flex-wrap:wrap;gap:14px;align-items:center;',
    '  font-size:12px;color:var(--dim);line-height:1.6}',
    '.pz-adj-tips strong{color:var(--text-2);font-weight:600}',
    '.pz-adj-cap{font-family:var(--font-mono);font-size:10.5px;padding:2px 7px;border-radius:5px;',
    '  background:#0c1016;border:1px solid var(--line);border-bottom-width:2px;color:var(--text-2)}',

    '.pz-adj-legend{display:flex;flex-wrap:wrap;gap:11px;font-size:11px;color:var(--dim)}',
    '.pz-adj-legend span{display:inline-flex;gap:5px;align-items:center}',
    '.pz-adj-legend b{color:var(--acc-2);font-weight:600;font-family:var(--font-mono)}',

    '.pz-adj-arrive{font-size:13px;line-height:1.65;color:var(--text-2);margin-bottom:12px}',
    '.pz-adj-arrive b{color:var(--acc-2)}'
  ].join('\n');

  /* ============================================================ THE FLOOR = */
  /* Every glyph the arena draws goes through fillText with whatever fill was
     last set, so a plain ASCII digit comes out in translucent black and
     vanishes. Keycap emoji carry their own colour. Numbers on this floor are
     the entire puzzle, so they are keycaps. */

  var KEYCAP = ['0\uFE0F\u20E3', '1\uFE0F\u20E3', '2\uFE0F\u20E3', '3\uFE0F\u20E3', '4\uFE0F\u20E3',
    '5\uFE0F\u20E3', '6\uFE0F\u20E3', '7\uFE0F\u20E3', '8\uFE0F\u20E3'];

  /* The grid sits inside a framed field: one wall row at the top and bottom,
     one wall column each side, and a walkable bank on either end of the
     crossing. Grid cell (gx, gy) is arena tile (gx + 1, gy + 2). */
  var PAD_X = 1;
  var PAD_Y = 2;

  function keycap(n) { return KEYCAP[n] || KEYCAP[8]; }

  /* ================================================================ MOUNT = */

  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var C = puzzle.content;
    var w = puzzle.w, gh = puzzle.h;
    var finished = false;
    var arena = null;
    var marks = {};             // grid idx -> flag prop handle
    var lastHint = -1;
    var hudT = 0;

    var stage = h('div', {});
    var wrap = h('div', { class: 'pz-adj' }, [stage]);
    PS.ui.append(el, wrap);

    var bankY = gh + PAD_Y;                 // the far bank, one row past the grid
    var exitX = Math.floor(w / 2) + PAD_X;

    function ax(gx) { return gx + PAD_X; }
    function ay(gy) { return gy + PAD_Y; }

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
        choiceBtn(C.careful, 'scavenge')
      ]);
    }

    function finishRun(choice) {
      if (finished) return;
      finished = true;

      var clean = puzzle.hits === 0;
      var efficient = puzzle.steps <= Math.ceil(puzzle.minPath * 1.6);
      var readALot = countKeys(puzzle.revealed) >= puzzle.minPath + 4;

      api.finish({
        outcome: clean ? 'success' : (puzzle.hits <= 2 ? 'partial' : 'fail'),
        stats: {
          morale: clean ? 8 : (puzzle.hits <= 2 ? -1 : -6),
          energy: -(2 + Math.floor(puzzle.steps / 3)),
          health: choice === 'scavenge' ? -1 : 0
        },
        gain: choice === 'scavenge' && clean ? ['rope'] : [],
        lose: [],
        tags: ['made_the_crossing']
          .concat(clean ? ['read_the_ground'] : [])
          .concat(puzzle.hits >= 3 ? ['went_through_the_floor'] : [])
          .concat(choice === 'scavenge' ? ['left_a_marked_lane'] : []),
        signals: {
          logic: clean ? 3 : (puzzle.hits <= 2 ? 2 : 1),
          caution: clean && readALot ? 3 : (clean ? 2 : 1),
          speed: efficient && clean ? 2 : 0,
          brute: puzzle.hits >= 3 ? 2 : 0,
          scavenge: choice === 'scavenge' ? 1 : 0
        },
        choice: choice,
        summary: clean
          ? 'You crossed the ' + C.gridWord + ' without putting a foot wrong \u2014 every step was a deduction.'
          : 'You got to ' + C.farSide + ', through ' + puzzle.hits + ' ' +
            (puzzle.hits === 1 ? C.hazardWord : C.hazardPlural) + ' on the way.'
      });
    }

    function turnBack() {
      if (finished || puzzle.done) return;
      finished = true;
      api.finish({
        outcome: 'fail',
        stats: { energy: -9, morale: -7 },
        gain: [], lose: [],
        tags: ['would_not_risk_the_crossing'],
        signals: { caution: 3, logic: 1 },
        choice: null,
        summary: 'You could not prove a safe line across and would not guess, so you went back to ' + C.nearSide + '.'
      });
    }

    function countKeys(o) {
      var n = 0;
      for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) n++;
      return n;
    }

    /* ------------------------------------------------------- degraded mode -- */

    if (!PS.arena || typeof PS.arena.create !== 'function') {
      PS.ui.append(stage, [
        h('div', { class: 'pz-intro', text: C.clear }),
        endChoices()
      ]);
      return;
    }

    /* --------------------------------------------------------- the ground -- */
    /* Nothing here is a wall except the frame. The danger is under the floor,
       which is exactly why walking is the act of committing to a deduction. */

    var MW = w + PAD_X * 2, MH = gh + PAD_Y + 2;
    var tiles = [], y, x, row;
    for (y = 0; y < MH; y++) {
      row = [];
      for (x = 0; x < MW; x++) {
        row.push((y === 0 || y === MH - 1 || x === 0 || x === MW - 1) ? 1 : 0);
      }
      tiles.push(row);
    }

    arena = PS.arena.create(stage, {
      map: { w: MW, h: MH, tiles: tiles },
      spawn: { x: ax(puzzle.start % w), y: ay(Math.floor(puzzle.start / w)) },
      avatar: C.playerIcon,
      light: state.stats.light,
      lightCurve: function (v) { return 2.4 + Math.max(0, Math.min(100, v)) / 100 * 2.4; },
      // Numbers you have already paid for must stay readable from anywhere;
      // a crossing you cannot re-read is a memory test, not a deduction.
      darkness: 0.62,
      memory: 0.92,
      onStep: onStep,
      onTick: onTick
    });
    if (!arena) {
      PS.ui.append(stage, [h('div', { class: 'pz-intro', text: C.clear }), endChoices()]);
      return;
    }
    teardownFns.push(function () { if (arena) { arena.destroy(); arena = null; } });
    arena.revealAll();

    /* --------------------------------------------------------- the far side */

    var arriveLine = null;
    var exitStation = arena.station({
      x: exitX, y: bankY,
      icon: C.onward.icon, label: C.farSide, hint: 'walk in, or press E',
      radius: 1.35, emits: 1.9,
      onEnter: function (panel) {
        arriveLine = h('div', { class: 'pz-adj-arrive' });
        paintArrive();
        PS.ui.append(panel, [arriveLine, endChoices()]);
      },
      onOpen: function () {
        paintArrive();
        if (!puzzle.done || finished) return;
        arena.ping(exitX, bankY);
      }
    });

    function paintArrive() {
      if (!arriveLine) return;
      var clean = puzzle.hits === 0;
      arriveLine.textContent = (puzzle.done ? (clean ? C.clear : C.messy) : 'You are not across yet.') +
        ' ' + puzzle.steps + ' cells committed to; the shortest line was ' + puzzle.minPath + '.';
    }

    /* ------------------------------------------------------------ markers -- */

    function addNumber(gx, gy, count) {
      arena.prop({
        x: ax(gx), y: ay(gy),
        icon: count > 0 ? keycap(count) : keycap(0),
        label: ' ', hint: ' ',
        trigger: 'press', radius: -1, glow: false, emits: 0,
        once: false, botSkip: true,
        onActivate: function () { /* a footprint, not a switch */ }
      });
    }

    /* The only props on this floor that the player did not put there are the
       holes they have already made, and the bot must never go and look for one
       on purpose — hence botSkip. Untriggered hazards are not props at all:
       a prop draws a shadow, and a shadow would give the whole board away. */
    function addHole(gx, gy) {
      arena.prop({
        x: ax(gx), y: ay(gy),
        icon: C.hazardIcon, label: C.hazardWord, hint: 'already gone',
        trigger: 'press', radius: -1, glow: false, emits: 0,
        tint: '#e2695f', once: false, botSkip: true,
        onActivate: function () { api.toast('There is a hole there now.', 'bad', 1200); }
      });
    }

    function facingCell() {
      var pl = arena.player();
      var cx = Math.cos(pl.facing), cy = Math.sin(pl.facing);
      var dx = 0, dy = 0;
      if (Math.abs(cx) >= Math.abs(cy)) dx = cx >= 0 ? 1 : -1;
      else dy = cy >= 0 ? 1 : -1;
      return { x: pl.tx + dx, y: pl.ty + dy };
    }

    /** Point at a cell with the mouse (or just face it) and press F. The mark
        stops nothing — it is a note to yourself, which is all it ever was. */
    function toggleMark() {
      if (finished || !arena) return;
      var c = facingCell();
      var gx = c.x - PAD_X, gy = c.y - PAD_Y;
      if (gx < 0 || gy < 0 || gx >= w || gy >= gh) {
        api.toast('Nothing to mark that way.', 'info', 1100);
        return;
      }
      var i = gy * w + gx;
      if (puzzle.revealed[i] !== undefined || puzzle.triggered[i]) return;

      if (puzzle.flags[i]) {
        delete puzzle.flags[i];
        if (marks[i]) { marks[i].remove(); delete marks[i]; }
      } else {
        puzzle.flags[i] = true;
        marks[i] = arena.prop({
          x: c.x, y: c.y, icon: C.flagIcon, label: ' ', hint: ' ',
          trigger: 'press', radius: -1, glow: false, emits: 0,
          once: false, botSkip: true, tint: '#e2695f',
          onActivate: function () { /* your own note */ }
        });
        arena.ping(c.x, c.y, '#e2695f');
      }
      paintHud();
    }

    /* -------------------------------------------------------------- steps -- */

    function onStep(tx, ty) {
      if (finished || !arena) return;
      var gx = tx - PAD_X, gy = ty - PAD_Y;
      if (gx < 0 || gy < 0 || gx >= w || gy >= gh) return;   // the banks are safe

      var i = gy * w + gx;
      puzzle.at = i;

      if (puzzle.hazard[i] && !puzzle.triggered[i] && !puzzle.done) {
        // Never fatal — expensive. You go through, and you climb back out.
        puzzle.triggered[i] = true;
        puzzle.hits++;
        delete puzzle.flags[i];
        if (marks[i]) { marks[i].remove(); delete marks[i]; }
        api.tweak({ health: -puzzle.damage, energy: -4, morale: -6 });
        api.toast(C.hit[puzzle.hits % C.hit.length], 'bad', 3000);
        arena.hit('#e2695f');
        arena.shake(12, 0.46);
        arena.dust(tx, ty, 16, '#e2695f');
        addHole(gx, gy);
        paintHud();
        return;
      }

      if (puzzle.revealed[i] === undefined && !puzzle.hazard[i]) {
        puzzle.revealed[i] = puzzle.counts[i];
        puzzle.steps++;
        api.tweak({ energy: -1 });
        addNumber(gx, gy, puzzle.counts[i]);
        if (puzzle.counts[i] === 0) arena.ping(tx, ty, '#5fcf8d');
      }

      if (gy === gh - 1 && !puzzle.done) {
        puzzle.done = true;
        api.flash();
        api.toast('You are on the last of it. ' + C.farSide + ' is one step further.', 'good', 2600);
        arena.ping(exitX, bankY);
        if (exitStation) exitStation.pulse();
      }
      paintHud();
    }

    function onTick(dt) {
      if (finished) return;
      hudT += dt;
      if (hudT >= 0.2) { hudT = 0; paintHud(); }
    }

    /* -------------------------------------------------------------- input -- */

    function onKey(ev) {
      if (finished) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key === 'f' || ev.key === 'F') { ev.preventDefault(); toggleMark(); }
    }
    document.addEventListener('keydown', onKey);
    teardownFns.push(function () { document.removeEventListener('keydown', onKey); });

    /* ---------------------------------------------------------------- HUD -- */

    var cRow   = arena.chip('Crossed', '\uD83E\uDDED');
    var cHere  = arena.chip('Under you', '\uD83D\uDC63');
    var cRead  = arena.chip('Read', '\uD83D\uDD22');
    var cMark  = arena.chip('Marked', '\uD83D\uDEA9');
    var cHits  = arena.chip('Through', '\uD83D\uDCA5');

    arena.note('A number counts the ' + C.hazardPlural + ' in the eight cells around it. Stand still and work it out \u2014 the ground is not going anywhere.');
    arena.button('\uD83D\uDEA9 Mark ahead (F)', toggleMark);
    arena.button('\u21A9 Go back to ' + C.nearSide, turnBack, 'pz-btn--danger');

    PS.ui.append(wrap, [
      h('div', { class: 'pz-adj-tips' }, [
        h('span', {}, [
          h('b', { class: 'pz-adj-cap', text: 'W A S D' }), ' / ',
          h('b', { class: 'pz-adj-cap', text: '\u2190\u2191\u2193\u2192' }),
          ' walk \u00B7 ', h('b', { class: 'pz-adj-cap', text: 'F' }),
          ' marks the cell you are facing \u00B7 you only need a line of your own footprints to ',
          h('strong', { text: C.farSide })
        ]),
        h('div', { class: 'pz-adj-legend' }, [
          h('span', {}, [C.playerIcon, ' you']),
          h('span', {}, [C.flagIcon, ' your mark']),
          h('span', {}, [C.hazardIcon, ' ' + C.hazardWord]),
          h('span', {}, ['shortest crossing ', h('b', { text: puzzle.minPath + ' cells' })])
        ])
      ])
    ]);

    /* -------------------------------------------------------- hint marker -- */
    /* core's api.hint() calls engine.hint() and THEN charges morale, which
       emits a state change. So by the time this listener runs, hint() has
       already recorded which cell it was talking about, and we can light that
       patch of ground up instead of making the player parse compass
       directions. */
    var offState = state.on(function () {
      if (finished || !arena) return;
      if (puzzle.hintCell !== undefined && puzzle.hintCell !== lastHint) {
        lastHint = puzzle.hintCell;
        var gx = lastHint % w, gy = Math.floor(lastHint / w);
        arena.ping(ax(gx), ay(gy), '#5fcf8d');
      }
      paintHud();
    });
    teardownFns.push(function () { if (offState) offState(); });

    function paintHud() {
      if (!arena || finished) return;
      var row = Math.floor(puzzle.at / w);
      // The number you are standing on is hidden under your own boots, and it
      // is the one you need most. Put it where you can read it.
      var pl = arena.player();
      var here = (pl.ty - PAD_Y) * w + (pl.tx - PAD_X);
      var onGrid = pl.tx - PAD_X >= 0 && pl.tx - PAD_X < w && pl.ty - PAD_Y >= 0 && pl.ty - PAD_Y < gh;
      cRow.set(row + ' / ' + (gh - 1), puzzle.done ? 'good' : null);
      cHere.set(!onGrid ? 'solid' : (puzzle.revealed[here] === undefined
        ? '\u2014'
        : puzzle.revealed[here] + ' near'), onGrid && puzzle.revealed[here] > 2 ? 'warn' : null);
      cRead.set(countKeys(puzzle.revealed) + ' cells');
      cMark.set(String(countKeys(puzzle.flags)));
      cHits.set(String(puzzle.hits), puzzle.hits ? 'bad' : null);
      paintArrive();
    }

    /* --------------------------------------------------- the opening move -- */
    /* The starting cell always reads zero, so the crossing always begins with
       something forced rather than a coin flip. Put that number on the ground
       before the player has taken a step. */
    addNumber(puzzle.start % w, Math.floor(puzzle.start / w), puzzle.counts[puzzle.start]);

    paintHud();
    arena.focus();
  }

  function unmount() {
    while (teardownFns.length) {
      try { teardownFns.pop()(); } catch (e) { /* keep unwinding */ }
    }
  }

  /* ================================================================ HINT = */

  function hint(puzzle) {
    var C = puzzle.content;
    var w = puzzle.w;
    var safe = {}, haz = {}, k;
    for (k in puzzle.revealed) if (Object.prototype.hasOwnProperty.call(puzzle.revealed, k)) safe[+k] = true;

    propagate(puzzle.n8, puzzle.near, puzzle.revealed, safe, haz);

    var nb = puzzle.n4[puzzle.at], i, m;
    var proven = -1, provenBad = -1;
    for (i = 0; i < nb.length; i++) {
      m = nb[i];
      if (puzzle.revealed[m] !== undefined || puzzle.triggered[m]) continue;
      if (safe[m] && !haz[m] && (proven < 0 || Math.floor(m / w) > Math.floor(proven / w))) proven = m;
      if (haz[m] && provenBad < 0) provenBad = m;
    }

    // mount() lights this cell up on the next state change, which is the morale
    // charge core applies immediately after this function returns.
    puzzle.hintCell = undefined;

    if (proven >= 0) {
      puzzle.hintCell = proven;
      return 'The numbers already force it: ' + compass(proven, puzzle.at, w) +
        ' is safe ground. Nothing about that step is a guess.';
    }
    if (provenBad >= 0) {
      puzzle.hintCell = provenBad;
      return 'Whatever you do, do not step on ' + compass(provenBad, puzzle.at, w) +
        ' \u2014 the counts around it only add up if that one is a ' + C.hazardWord + '.';
    }
    // Nothing forced from here: point at the cheapest place to gather more.
    var best = -1, bestOpen = -1;
    for (k in puzzle.revealed) {
      if (!Object.prototype.hasOwnProperty.call(puzzle.revealed, k)) continue;
      var c = +k, open = 0;
      for (i = 0; i < puzzle.n4[c].length; i++) {
        m = puzzle.n4[c][i];
        if (puzzle.revealed[m] === undefined && !haz[m] && safe[m]) open++;
      }
      if (open > bestOpen) { bestOpen = open; best = c; }
    }
    if (bestOpen > 0) {
      puzzle.hintCell = best;
      return 'Nothing next to you is forced yet. Go back to the cell reading ' + puzzle.revealed[best] +
        ' \u2014 the ground beside it is already proven, and it will open this side up.';
    }
    return 'Nothing here is forced. Read the low numbers first: a cell reading zero proves all eight around it, ' +
      'and one proven cell is usually enough to unlock the next three.';
  }

  function compass(to, from, w) {
    var d = to - from;
    if (d === -w) return 'the cell above you';
    if (d === w) return 'the cell below you';
    if (d === -1) return 'the cell to your left';
    if (d === 1) return 'the cell to your right';
    return 'that cell';
  }

  /* ============================================================ AUTOSOLVE = */
  /* Headless. Replays the same deduction the generator verified with. */

  function autoSolve(puzzle, rng) {
    var res = deduce(puzzle.w, puzzle.h, puzzle.n4, puzzle.n8, puzzle.near, puzzle.counts, puzzle.start);
    var slips = res.crossed ? (rng.chance(0.22) ? 1 : 0) : 1 + rng.int(0, 1);
    var steps = res.crossed ? res.steps : puzzle.minPath + rng.int(1, 4);
    var clean = slips === 0;
    var choice = rng.chance(0.5) ? 'sprint' : 'scavenge';

    return {
      outcome: clean ? 'success' : (slips <= 2 ? 'partial' : 'fail'),
      stats: {
        health: -(slips * puzzle.damage),
        energy: -(2 + Math.floor(steps / 3) + slips * 4),
        morale: clean ? 8 : -3
      },
      gain: choice === 'scavenge' && clean ? ['rope'] : [],
      lose: [],
      tags: ['made_the_crossing'].concat(clean ? ['read_the_ground'] : []),
      signals: { logic: clean ? 3 : 2, caution: clean ? 3 : 1, brute: slips >= 3 ? 2 : 0 },
      choice: choice,
      summary: clean
        ? 'Read the whole crossing off the numbers and never tested a bad cell.'
        : 'Crossed it, ' + slips + ' bad step' + (slips === 1 ? '' : 's') + ' short of clean.'
    };
  }

  /* ============================================================ REGISTER = */

  PS.registry.register({
    id: 'adjacency_deduction',
    name: 'Adjacency Deduction',
    icon: '\u2620\uFE0F',
    blurb: 'Every safe cell tells you how bad its neighbours are. You do not need the board \u2014 only a line across it.',

    favors:   { logic: 3, caution: 3 },
    provides: ['passage', 'crossing', 'map'],
    tagHooks: ['has_map', 'read_the_ground', 'has_tools'],
    requires: function (state) { return state.stats.health > 12; },

    css: CSS,

    skins: [
      {
        id: 'unstable_floor', biome: 'indoor', title: 'The Unstable Floor',
        icon: '\uD83E\uDEB5', palette: 'ash',
        intro: 'Something has been eating this floor from underneath for a long time. Most of the boards will hold you and some of them will not, and the only tell is how the ones you are already standing on sound.',
        nouns: { hazard: 'soft board', exit: 'the far door', ground: 'floor' }
      },
      {
        id: 'marked_minefield', biome: 'wilderness', title: 'The Marked Field',
        icon: '\u26A0\uFE0F', palette: 'moss',
        intro: 'Someone fenced this field and then stopped coming back. The markers have rotted off the wire, but the clearance crew logged every square before they left, and the log is written in the ground itself.',
        nouns: { hazard: 'live charge', exit: 'the treeline', ground: 'ground' }
      },
      {
        id: 'thin_ice', biome: 'water', title: 'Thin Ice',
        icon: '\uD83E\uDDCA', palette: 'ice',
        intro: 'The river froze fast, then something warm moved under it. Good plates ring. Rotten ones knock. You get one honest answer per step and forty metres of crossing to spend them on.',
        nouns: { hazard: 'rotten plate', exit: 'the far bank', ground: 'ice' }
      }
    ],

    build: build,
    mount: mount,
    unmount: unmount,
    hint: hint,
    autoSolve: autoSolve
  });

})(typeof window !== 'undefined' ? window : this);
