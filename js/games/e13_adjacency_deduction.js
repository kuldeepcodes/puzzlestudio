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

  var CSS = [
    '.pz-adj{display:grid;grid-template-columns:minmax(0,1fr) minmax(228px,296px);gap:18px;align-items:start}',
    '@media (max-width:860px){.pz-adj{grid-template-columns:1fr}}',

    '.pz-adj-board{display:grid;gap:3px;padding:12px;border-radius:12px;background:#05070a;',
    '  border:1px solid var(--line);box-shadow:inset 0 0 60px rgba(0,0,0,.85);',
    '  width:100%;max-width:520px;margin:0 auto}',
    '.pz-adj-board.is-shake{animation:pzAdjShake .38s var(--ease)}',

    '.pz-adj-cell{position:relative;aspect-ratio:1/1;display:grid;place-items:center;border-radius:5px;',
    '  font-family:var(--font-mono);font-size:clamp(10px,2.3vw,17px);font-weight:700;line-height:1;',
    '  background:#131923;border:1px solid #1d2531;color:var(--dimmer);cursor:default;',
    '  transition:background .2s var(--ease),transform .12s var(--ease),border-color .2s var(--ease)}',
    '.pz-adj-cell.is-open{background:#0a0e14;border-color:#161c25;color:var(--text-2)}',
    '.pz-adj-cell.is-open.is-quiet{color:var(--dimmer)}',
    '.pz-adj-cell.is-step{cursor:pointer;border-color:color-mix(in srgb,var(--acc) 55%,transparent);',
    '  box-shadow:0 0 0 1px color-mix(in srgb,var(--acc) 18%,transparent) inset}',
    '.pz-adj-cell.is-step:hover{background:var(--acc-wash);transform:scale(1.07)}',
    '.pz-adj-cell.is-flag{background:#2a1a18;border-color:#5c2b26}',
    '.pz-adj-cell.is-blown{background:#3a1a17;border-color:var(--bad);color:#ffd9d5}',
    '.pz-adj-cell.is-me{background:radial-gradient(circle,var(--acc-wash),transparent 70%);',
    '  border-color:var(--acc);box-shadow:0 0 20px var(--acc-glow);z-index:2}',
    '.pz-adj-cell.is-walked::after{content:"";position:absolute;inset:auto 0 3px 0;height:2px;margin:0 26%;',
    '  border-radius:2px;background:color-mix(in srgb,var(--acc) 50%,transparent)}',
    '.pz-adj-cell.is-goal{border-bottom:2px solid color-mix(in srgb,var(--good) 60%,transparent)}',
    '.pz-adj-cell.is-hinted{box-shadow:0 0 0 2px var(--good) inset}',

    '.pz-adj-cell.n1{color:#7ec7f2}.pz-adj-cell.n2{color:#5fcf8d}.pz-adj-cell.n3{color:#e9c45c}',
    '.pz-adj-cell.n4{color:#e2695f}.pz-adj-cell.n5{color:#e08ad0}.pz-adj-cell.n6{color:#b48ce0}',
    '.pz-adj-cell.n7,.pz-adj-cell.n8{color:#fff}',

    '.pz-adj-edge{display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:10px;',
    '  letter-spacing:.14em;text-transform:uppercase;color:var(--dimmer);padding:0 4px}',

    '.pz-adj-meter{display:flex;flex-direction:column;gap:6px}',
    '.pz-adj-meter__row{display:flex;justify-content:space-between;gap:10px;font-family:var(--font-mono);',
    '  font-size:11px;color:var(--dim)}',
    '.pz-adj-meter__row b{color:var(--acc-2)}',
    '.pz-adj-meter__row.is-bad b{color:var(--bad)}',

    '.pz-adj-mode{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
    '.pz-adj-mode__on{font-size:11px;color:var(--dim);font-family:var(--font-mono)}',

    '.pz-adj-legend{display:flex;flex-wrap:wrap;gap:9px;font-size:11px;color:var(--dim)}',
    '.pz-adj-legend span{display:inline-flex;gap:5px;align-items:center}',

    '.pz-adj-warn{font-size:12px;line-height:1.55;color:var(--bad);padding:9px 11px;border-radius:8px;',
    '  background:rgba(226,105,95,.08);border:1px solid rgba(226,105,95,.28)}',

    '@keyframes pzAdjShake{0%,100%{transform:translate(0,0)}20%{transform:translate(-7px,2px)}',
    '  45%{transform:translate(6px,-2px)}70%{transform:translate(-4px,1px)}}'
  ].join('\n');

  /* ================================================================ MOUNT = */

  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var C = puzzle.content;
    var w = puzzle.w, gh = puzzle.h;
    var cells = [];
    var finished = false;
    var markMode = false;
    var hinted = -1;

    var board = h('div', {
      class: 'pz-adj-board',
      style: { gridTemplateColumns: 'repeat(' + w + ', 1fr)' }
    });

    var meter = h('div', { class: 'pz-adj-meter' });
    var warnBox = h('div', {});
    var actionBox = h('div', { class: 'pz-col' });
    var modeBtn = h('button', { class: 'pz-btn pz-btn--sm', type: 'button' }, ['\uD83D\uDEA9 Mark: off']);

    for (var i = 0; i < w * gh; i++) {
      (function (idx) {
        var c = h('div', { class: 'pz-adj-cell' });
        c.addEventListener('click', function (ev) {
          if (markMode || ev.shiftKey || ev.altKey) toggleFlag(idx);
          else tryStep(idx);
        });
        c.addEventListener('contextmenu', function (ev) { ev.preventDefault(); toggleFlag(idx); });
        cells.push(c);
        board.appendChild(c);
      })(i);
    }

    /* ------------------------------------------------------------- render -- */

    function adjacentToMe(idx) {
      var nb = puzzle.n4[puzzle.at];
      for (var j = 0; j < nb.length; j++) if (nb[j] === idx) return true;
      return false;
    }

    function paint() {
      for (var idx = 0; idx < cells.length; idx++) {
        var c = cells[idx];
        var cls = 'pz-adj-cell';
        var txt = '';

        var open = puzzle.revealed[idx] !== undefined;
        if (puzzle.triggered[idx]) {
          cls += ' is-blown';
          txt = C.hazardIcon;
        } else if (open) {
          cls += ' is-open is-walked';
          var n = puzzle.revealed[idx];
          if (n > 0) { cls += ' n' + n; txt = String(n); }
          else { cls += ' is-quiet'; txt = C.safeIcon; }
        } else if (puzzle.flags[idx]) {
          cls += ' is-flag';
          txt = C.flagIcon;
        }

        if (Math.floor(idx / w) === gh - 1) cls += ' is-goal';
        if (idx === puzzle.at) { cls += ' is-me'; txt = C.playerIcon; }
        else if (!finished && !puzzle.done && adjacentToMe(idx) && !puzzle.triggered[idx]) cls += ' is-step';
        if (idx === hinted && !open) cls += ' is-hinted';

        c.className = cls;
        c.textContent = txt;
      }
      paintMeter();
    }

    function paintMeter() {
      PS.ui.clear(meter);
      var row = Math.floor(puzzle.at / w);
      PS.ui.append(meter, [
        line('Rows crossed', row + ' of ' + (gh - 1)),
        line('Steps taken', String(puzzle.steps)),
        line('Shortest crossing', puzzle.minPath + ' steps'),
        line('Cells read', String(countKeys(puzzle.revealed))),
        line('Marked', String(countKeys(puzzle.flags))),
        line('Went through', String(puzzle.hits), puzzle.hits > 0)
      ]);

      PS.ui.clear(warnBox);
      if (!puzzle.done && puzzle.hits > 0) {
        warnBox.appendChild(h('div', { class: 'pz-adj-warn' },
          ['You have been through the ' + C.gridWord + ' ' + puzzle.hits + ' time' + (puzzle.hits === 1 ? '' : 's') +
            '. Every number on this board is free information. Use it before you commit weight.']));
      }

      function line(k, v, bad) {
        return h('div', { class: 'pz-adj-meter__row' + (bad ? ' is-bad' : '') },
          [h('span', { text: k }), h('b', { text: v })]);
      }
    }

    function countKeys(o) {
      var n = 0;
      for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) n++;
      return n;
    }

    /* ------------------------------------------------------------- moving -- */

    function toggleFlag(idx) {
      if (finished || puzzle.done) return;
      if (puzzle.revealed[idx] !== undefined || puzzle.triggered[idx]) return;
      if (puzzle.flags[idx]) delete puzzle.flags[idx];
      else puzzle.flags[idx] = true;
      hinted = -1;
      paint();
    }

    function tryStep(idx) {
      if (finished || puzzle.done) return;
      if (!adjacentToMe(idx)) return;
      if (puzzle.triggered[idx]) { api.toast('There is a hole there now.', 'bad', 1200); return; }
      if (puzzle.flags[idx]) {
        api.toast('You marked that one yourself. Unmark it first if you have changed your mind.', 'info', 2400);
        return;
      }
      hinted = -1;
      puzzle.hintCell = undefined;

      if (puzzle.hazard[idx]) {
        // Never fatal — expensive. You go through, and you climb back out.
        puzzle.triggered[idx] = true;
        puzzle.hits++;
        puzzle.flags[idx] = false;
        delete puzzle.flags[idx];
        api.tweak({ health: -puzzle.damage, energy: -4, morale: -6 });
        api.toast(C.hit[puzzle.hits % C.hit.length], 'bad', 3000);
        board.classList.remove('is-shake');
        void board.offsetWidth;
        board.classList.add('is-shake');
        paint();
        return;
      }

      puzzle.at = idx;
      puzzle.steps++;
      if (puzzle.revealed[idx] === undefined) {
        puzzle.revealed[idx] = puzzle.counts[idx];
        api.tweak({ energy: -1 });
      }

      if (Math.floor(idx / w) === gh - 1) {
        puzzle.done = true;
        paint();
        renderEnd();
        return;
      }
      paint();
    }

    function onKey(ev) {
      if (finished || puzzle.done) return;
      var map = {
        ArrowUp: -w, ArrowDown: w, ArrowLeft: -1, ArrowRight: 1,
        w: -w, s: w, a: -1, d: 1, W: -w, S: w, A: -1, D: 1
      };
      if (ev.key === 'f' || ev.key === 'F') {
        ev.preventDefault();
        setMark(!markMode);
        return;
      }
      var delta = map[ev.key];
      if (delta === undefined) return;
      ev.preventDefault();
      var to = puzzle.at + delta;
      // Guard the wrap: moving left off column 0 must not land on the row above.
      if ((delta === -1 && puzzle.at % w === 0) || (delta === 1 && puzzle.at % w === w - 1)) return;
      if (to < 0 || to >= w * gh) return;
      if (markMode) toggleFlag(to); else tryStep(to);
    }

    function setMark(on) {
      markMode = on;
      modeBtn.textContent = '\uD83D\uDEA9 Mark: ' + (on ? 'on' : 'off');
      modeBtn.className = 'pz-btn pz-btn--sm' + (on ? ' pz-btn--primary' : '');
    }

    document.addEventListener('keydown', onKey);
    teardownFns.push(function () { document.removeEventListener('keydown', onKey); });
    modeBtn.addEventListener('click', function () { setMark(!markMode); });

    /* ------------------------------------------------------------ endings -- */

    function renderEnd() {
      PS.ui.clear(actionBox);
      var clean = puzzle.hits === 0;
      PS.ui.append(actionBox, [
        h('div', { class: 'pz-intro', text: (clean ? C.clear : C.messy) + ' ' +
          puzzle.steps + ' steps across; the shortest line was ' + puzzle.minPath + '.' }),
        h('div', { class: 'pz-choices' }, [
          choiceBtn(C.onward, 'sprint'),
          choiceBtn(C.careful, 'scavenge')
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

    /* -------------------------------------------------------- hint marker -- */
    /* core's api.hint() calls engine.hint() and THEN charges morale, which
       emits a state change. So by the time this listener runs, hint() has
       already recorded which cell it was talking about, and we can light it
       up on the board instead of making the player parse compass directions. */
    var offState = state.on(function () {
      if (finished) return;
      if (puzzle.hintCell !== undefined && puzzle.hintCell !== hinted) hinted = puzzle.hintCell;
      paint();
    });
    teardownFns.push(function () { if (offState) offState(); });

    /* ------------------------------------------------------------- layout -- */

    PS.ui.append(actionBox, [
      h('div', { class: 'pz-adj-mode' }, [
        modeBtn,
        h('span', { class: 'pz-adj-mode__on', text: 'right-click or shift-click also marks' })
      ]),
      h('button', {
        class: 'pz-btn pz-btn--danger pz-btn--sm', type: 'button', onclick: turnBack
      }, ['\u21A9 Go back to ' + C.nearSide])
    ]);

    PS.ui.append(el, h('div', { class: 'pz-adj' }, [
      h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-adj-edge' }, [
          h('span', { text: C.nearSide + ' \u2014 you are here' }),
          h('span', { text: 'row ' + (gh - 1) + ' is ' + C.farSide })
        ]),
        board,
        h('div', { class: 'pz-note' }, [
          'A number is how many of that cell\u2019s ', h('strong', { text: 'eight' }),
          ' neighbours will not hold you. You only need a line of your own footprints to ',
          C.farSide, ' \u2014 the rest of the ', C.gridWord, ' can stay a mystery. ',
          'Arrows or WASD to move, ', h('strong', { text: 'F' }), ' to toggle marking.'
        ])
      ]),
      h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'The crossing' }),
          meter
        ]),
        warnBox,
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'Options' }),
          actionBox
        ]),
        h('div', { class: 'pz-adj-legend' }, [
          h('span', {}, [C.playerIcon, ' you']),
          h('span', {}, [C.flagIcon, ' your mark']),
          h('span', {}, [C.hazardIcon, ' ' + C.hazardWord]),
          h('span', {}, ['\u00B7 nothing adjacent'])
        ])
      ])
    ]));

    setMark(false);
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
