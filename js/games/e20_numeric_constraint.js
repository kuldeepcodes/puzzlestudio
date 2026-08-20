/* ==========================================================================
   PuzzleStudio — js/games/e20_numeric_constraint.js  ENGINE 20 · The Ledger
   --------------------------------------------------------------------------
   Self-contained: logic + 3 skins + its own CSS. No DOM access until mount().

   THE PUZZLE
     A stock ledger that has to balance. Every row and every column has a
     counted total it must hit, no quantity repeats within a row or a column,
     and a handful of wedges between neighbouring cells tell you which of the
     two is larger. Kakuro's arithmetic, futoshiki's inequalities.

     It is framed as an audit because that is what it is. The totals are what
     is physically on the shelves. The manifest says something else. Fill the
     grid in and you can finally say what is missing and how much of it.

   GENERATION — DERIVED FROM AN ANSWER, THEN PROVED UNIQUE
     Never "scatter clues and hope". The order is:

       1. Fill a full grid by randomised backtracking, respecting the
          no-repeats rule. That grid is the answer, so an answer always exists.
       2. Read the row and column totals off it, and read the inequality
          wedges off it too — so no clue can ever contradict another.
       3. Remove a transversal (one cell per row AND per column) for free: a
          row with a single blank is pinned by its own total, so uniqueness is
          guaranteed by arithmetic without running the solver at all. That is
          the floor — even a build that runs out of time is a real puzzle.
       4. Keep removing givens one at a time, each time asking countSolutions
          whether the puzzle is still unique. A removal that would make the
          ledger ambiguous is put straight back.
       5. Finally prune any wedge the puzzle no longer needs, so the board is
          never cluttered with clues that carry no information.

   THE SOLVER
     countSolutions is a backtracker that ABORTS THE MOMENT IT FINDS A SECOND
     solution — it never enumerates, it only ever answers "one, or more than
     one". It prunes on rows, columns and wedges as it goes, and the sum bound
     is exact rather than crude: for the cells left in a line it precomputes
     the smallest and largest totals still reachable from the digits not yet
     used there, so an arithmetically doomed branch dies immediately. It is
     also node-capped, and a cap is read as "not proven unique", which keeps
     the given rather than shipping an ambiguous board.

   THE BRANCH
     You now know who has been stealing and exactly how much. Say so, or say
     nothing and take the same cut yourself.

   THE STORE (arena)
     The totals are not printed on the ledger. They are what is physically on
     the shelves and in the bins, so each one is a thing in the room you have
     to walk over and count: one shelf gives you one line total, one bin gives
     you one cage total, and until you have been to it the ledger just shows a
     question mark. Finding the totals is the audit. The desk in the corner is
     a station, and the grid you fill in there is exactly the grid it always
     was.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio;
  if (!PS || !PS.registry) { if (root.console) console.error('[e20] core not loaded'); return; }

  /* ======================================================== SKIN CONTENT == */

  var CONTENT = {
    ration_ledger: {
      unit: 'units', rowKind: 'line', colKind: 'cage',
      rows: ['Flour', 'Salt', 'Paraffin', 'Tinned meat', 'Dried milk', 'Sugar', 'Tea'],
      cols: ['Cage A', 'Cage B', 'Cage C', 'Cage D', 'Cage E'],
      ledger: 'ration book', keeper: 'the quartermaster',
      rowIcon: '\uD83E\uDDFA', colIcon: '\uD83D\uDDC4\uFE0F', deskIcon: '\uD83D\uDCD2',
      rowThing: 'shelves', colThing: 'cages',
      opening: 'Somebody has been eating better than everybody else.',
      solvedLine: 'The count closes. Every line balances except one.',
      failLine: 'The columns will not sit down. You are counting the same tins twice.',
      revealLead: 'Against the ration book, ',
      revealTail: ' is short. That is four days of somebody, taken quietly, off the top.',
      a: { icon: '\uD83D\uDCE3', title: 'Read it out at the door', desc: 'Names, numbers, in front of everyone. It will not make you friends.', choice: 'signal' },
      b: { icon: '\uD83E\uDD10', title: 'Say nothing, take the same', desc: 'The discrepancy already exists. One more will not be noticed.', choice: 'scavenge' }
    },
    payload_manifest: {
      unit: 'units', rowKind: 'part', colKind: 'crate',
      rows: ['Detonator caps', 'Copper wire', 'Cell packs', 'Fuse cord', 'Pressure seals', 'Bolt sets', 'Filters'],
      cols: ['Crate 1', 'Crate 2', 'Crate 3', 'Crate 4', 'Crate 5'],
      ledger: 'shipping manifest', keeper: 'the loadmaster',
      rowIcon: '\uD83E\uDDF0', colIcon: '\uD83D\uDCE6', deskIcon: '\uD83D\uDCCB',
      rowThing: 'pallets', colThing: 'crates',
      opening: 'This load was signed for twice and it did not weigh the same either time.',
      solvedLine: 'The manifest reconciles. One line does not.',
      failLine: 'The crate totals refuse to agree. Something is counted in two places.',
      revealLead: 'Against the signed manifest, ',
      revealTail: ' never made it onto the truck. That is not breakage. That is a decision.',
      a: { icon: '\uD83D\uDCFB', title: 'Put it on the radio', desc: 'Whoever is still listening deserves to know what is walking off the dock.', choice: 'signal' },
      b: { icon: '\uD83E\uDDF0', title: 'Take the difference yourself', desc: 'It is already written off. Written-off things are the easiest to carry.', choice: 'scavenge' }
    },
    seed_store_audit: {
      unit: 'measures', rowKind: 'crop', colKind: 'bin',
      rows: ['Barley', 'Rye', 'Field bean', 'Squash', 'Flax', 'Turnip', 'Clover'],
      cols: ['Bin I', 'Bin II', 'Bin III', 'Bin IV', 'Bin V'],
      ledger: 'sowing book', keeper: 'the seed warden',
      rowIcon: '\uD83C\uDF3E', colIcon: '\uD83E\uDEA3', deskIcon: '\uD83D\uDCD3',
      rowThing: 'sacks', colThing: 'bins',
      opening: 'Next spring is written down in this room, and the sums are wrong.',
      solvedLine: 'The bins reconcile. One crop does not.',
      failLine: 'The rows will not close. You have double-counted a bin.',
      revealLead: 'Against the sowing book, ',
      revealTail: ' is missing. Nobody eats seed corn unless they have stopped believing in spring.',
      a: { icon: '\uD83D\uDCE3', title: 'Tell the warden', desc: 'It will start an argument that has been waiting all winter.', choice: 'signal' },
      b: { icon: '\uD83C\uDF31', title: 'Pocket the same measure', desc: 'A handful of seed is a field, later, somewhere else.', choice: 'forage' }
    }
  };

  var TIERS = {
    1: { k: 3, V: 5, wedges: 1 },
    2: { k: 4, V: 6, wedges: 2 },
    3: { k: 4, V: 6, wedges: 3 },
    4: { k: 5, V: 7, wedges: 3 },
    5: { k: 5, V: 7, wedges: 4 },
    6: { k: 5, V: 7, wedges: 5 }
  };

  var SOLVE_CAP = 24000;   // backtracker nodes for a single uniqueness question
  var GEN_MS    = 55;      // hard wall-clock ceiling on the whole generation

  /* ============================================================== HELPERS = */

  function grid2d(k, fill) {
    var g = [], r, c;
    for (r = 0; r < k; r++) { g.push([]); for (c = 0; c < k; c++) g[r].push(fill); }
    return g;
  }

  function copy2d(g) {
    var o = [], r;
    for (r = 0; r < g.length; r++) o.push(g[r].slice());
    return o;
  }

  /**
   * For every set of already-used digits, the smallest and largest totals that
   * `t` more distinct unused digits could contribute. Lets the backtracker
   * reject an arithmetically impossible line before it has written anything.
   */
  function sumBounds(V) {
    var masks = 1 << (V + 1);
    var lo = [], hi = [], m, d, t;
    for (m = 0; m < masks; m++) {
      var free = [];
      for (d = 1; d <= V; d++) if (!(m & (1 << d))) free.push(d);
      var a = [0], b = [0], s = 0;
      for (t = 0; t < free.length; t++) { s += free[t]; a.push(s); }
      s = 0;
      for (t = free.length - 1; t >= 0; t--) { s += free[t]; b.push(s); }
      // Asking for more digits than remain is impossible: price it out of reach.
      for (t = free.length + 1; t <= V; t++) { a.push(1e9); b.push(-1e9); }
      lo.push(a); hi.push(b);
    }
    return { lo: lo, hi: hi };
  }

  /* ============================================================== SOLVER == */

  /**
   * How many ways can this ledger be completed — one, or more than one?
   * Stops dead on the second solution; never enumerates. Returns
   * { count, capped }, and `capped` must always be read as "unproven".
   */
  function countSolutions(k, V, given, rowT, colT, right, down, bounds, limit, cap) {
    var work = grid2d(k, 0);
    var rowUsed = [], colUsed = [], rowSum = [], colSum = [], i;
    for (i = 0; i < k; i++) { rowUsed.push(0); colUsed.push(0); rowSum.push(0); colSum.push(0); }

    var count = 0, nodes = 0, capped = false;
    var lo = bounds.lo, hi = bounds.hi;

    function rec(pos) {
      if (count >= limit || capped) return;
      if (pos === k * k) { count++; return; }
      if (++nodes > cap) { capped = true; return; }

      var c = pos % k;
      var r = (pos - c) / k;
      var fixed = given[r][c];

      for (var d = 1; d <= V; d++) {
        if (fixed && d !== fixed) continue;
        var bit = 1 << d;
        if (rowUsed[r] & bit) continue;
        if (colUsed[c] & bit) continue;

        // wedges against neighbours that are already written in
        if (c > 0 && right[r][c - 1]) {
          var lv = work[r][c - 1];
          if (right[r][c - 1] === 1 ? !(lv < d) : !(lv > d)) continue;
        }
        if (r > 0 && down[r - 1][c]) {
          var uv = work[r - 1][c];
          if (down[r - 1][c] === 1 ? !(uv < d) : !(uv > d)) continue;
        }

        var nrs = rowSum[r] + d, restR = k - 1 - c;
        if (restR === 0) { if (nrs !== rowT[r]) continue; }
        else {
          var mr = rowUsed[r] | bit;
          if (nrs + lo[mr][restR] > rowT[r]) continue;
          if (nrs + hi[mr][restR] < rowT[r]) continue;
        }

        var ncs = colSum[c] + d, restC = k - 1 - r;
        if (restC === 0) { if (ncs !== colT[c]) continue; }
        else {
          var mc = colUsed[c] | bit;
          if (ncs + lo[mc][restC] > colT[c]) continue;
          if (ncs + hi[mc][restC] < colT[c]) continue;
        }

        work[r][c] = d; rowUsed[r] |= bit; colUsed[c] |= bit; rowSum[r] = nrs; colSum[c] = ncs;
        rec(pos + 1);
        work[r][c] = 0; rowUsed[r] &= ~bit; colUsed[c] &= ~bit; rowSum[r] -= d; colSum[c] -= d;
        if (count >= limit || capped) return;
      }
    }

    rec(0);
    return { count: count, capped: capped };
  }

  function isUnique(k, V, given, rowT, colT, right, down, bounds) {
    var r = countSolutions(k, V, given, rowT, colT, right, down, bounds, 2, SOLVE_CAP);
    return !r.capped && r.count === 1;
  }

  /* ========================================================== GENERATION == */

  /** A full, legal grid. Randomised backtracking, so it is always an answer. */
  function fillGrid(k, V, rng) {
    var g = grid2d(k, 0);
    var rowUsed = [], colUsed = [], i;
    for (i = 0; i < k; i++) { rowUsed.push(0); colUsed.push(0); }

    var digits = [];
    for (i = 1; i <= V; i++) digits.push(i);

    var nodes = 0;

    function rec(pos) {
      if (pos === k * k) return true;
      if (++nodes > 40000) return false;
      var c = pos % k, r = (pos - c) / k;
      var order = rng.shuffle(digits);
      for (var j = 0; j < order.length; j++) {
        var d = order[j], bit = 1 << d;
        if (rowUsed[r] & bit) continue;
        if (colUsed[c] & bit) continue;
        g[r][c] = d; rowUsed[r] |= bit; colUsed[c] |= bit;
        if (rec(pos + 1)) return true;
        g[r][c] = 0; rowUsed[r] &= ~bit; colUsed[c] &= ~bit;
      }
      return false;
    }

    if (rec(0)) return g;

    // Unreachable for V >= k, but never return a broken grid: a cyclic Latin
    // square is always legal and always available.
    for (var r2 = 0; r2 < k; r2++) {
      for (var c2 = 0; c2 < k; c2++) g[r2][c2] = ((r2 + c2) % k) + 1;
    }
    return g;
  }

  /** One cell per row and per column — a random permutation. */
  function transversal(k, rng) {
    var cols = rng.shuffle((function () { var a = [], i; for (i = 0; i < k; i++) a.push(i); return a; })());
    var out = [], r;
    for (r = 0; r < k; r++) out.push([r, cols[r]]);
    return out;
  }

  function build(state, rng, tier, skin) {
    var C = CONTENT[skin.id] || CONTENT.ration_ledger;
    var t = Math.min(6, tier);                 // the run is infinite; the curve is not
    var cfg = TIERS[t];
    var k = cfg.k, V = cfg.V;
    var deadline = Date.now() + GEN_MS;
    var bounds = sumBounds(V);
    var r, c, i;

    /* 1. the answer ------------------------------------------------------- */
    var sol = fillGrid(k, V, rng);

    /* 2. totals and wedges read straight off it, so nothing can contradict - */
    var rowT = [], colT = [];
    for (r = 0; r < k; r++) { var s = 0; for (c = 0; c < k; c++) s += sol[r][c]; rowT.push(s); }
    for (c = 0; c < k; c++) { var s2 = 0; for (r = 0; r < k; r++) s2 += sol[r][c]; colT.push(s2); }

    var right = grid2d(k, 0), down = grid2d(k, 0);   // 1 means "<", 2 means ">"
    var pairs = [];
    for (r = 0; r < k; r++) {
      for (c = 0; c < k; c++) {
        if (c < k - 1) pairs.push(['r', r, c]);
        if (r < k - 1) pairs.push(['d', r, c]);
      }
    }
    var chosen = rng.sample(pairs, cfg.wedges);
    for (i = 0; i < chosen.length; i++) {
      var p = chosen[i];
      if (p[0] === 'r') right[p[1]][p[2]] = sol[p[1]][p[2]] < sol[p[1]][p[2] + 1] ? 1 : 2;
      else down[p[1]][p[2]] = sol[p[1]][p[2]] < sol[p[1] + 1][p[2]] ? 1 : 2;
    }

    /* 3. the free floor: one blank per row and per column is pinned by its
          own row total, so this needs no solver call and cannot fail ------- */
    var given = copy2d(sol);
    var free = transversal(k, rng);
    for (i = 0; i < free.length; i++) given[free[i][0]][free[i][1]] = 0;

    /* 4. keep removing while the ledger stays provably unique -------------- */
    var order = [];
    for (r = 0; r < k; r++) for (c = 0; c < k; c++) if (given[r][c]) order.push([r, c]);
    order = rng.shuffle(order);

    for (i = 0; i < order.length; i++) {
      if (Date.now() > deadline) break;
      var rr = order[i][0], cc = order[i][1];
      var keep = given[rr][cc];
      given[rr][cc] = 0;
      if (!isUnique(k, V, given, rowT, colT, right, down, bounds)) given[rr][cc] = keep;
    }

    /* 5. drop wedges the puzzle no longer needs ---------------------------- */
    for (i = 0; i < chosen.length; i++) {
      if (Date.now() > deadline) break;
      var q = chosen[i];
      var arr = q[0] === 'r' ? right : down;
      var was = arr[q[1]][q[2]];
      if (!was) continue;
      arr[q[1]][q[2]] = 0;
      if (!isUnique(k, V, given, rowT, colT, right, down, bounds)) arr[q[1]][q[2]] = was;
    }

    /* the audit reveal ---------------------------------------------------- */
    var shortRow = rng.int(0, k - 1);
    var shortBy = rng.int(3, 5 + t);

    var rowLabels = rng.shuffle(C.rows).slice(0, k);
    var colLabels = C.cols.slice(0, k);

    var blanks = 0;
    for (r = 0; r < k; r++) for (c = 0; c < k; c++) if (!given[r][c]) blanks++;

    return {
      k: k, V: V, tier: t, content: C,
      solution: sol,
      given: given,
      grid: copy2d(given),
      rowT: rowT, colT: colT,
      right: right, down: down,
      rowLabels: rowLabels, colLabels: colLabels,
      shortRow: shortRow, shortBy: shortBy,
      blanks: blanks,
      checks: 0,
      solved: false,
      signedOff: false
    };
  }

  /* ============================================================== RUNTIME = */

  /** Every complaint the current grid would draw, in reading order. */
  function faults(puzzle) {
    var k = puzzle.k, g = puzzle.grid, out = [], r, c, seen, d;

    for (r = 0; r < k; r++) {
      seen = {};
      var rs = 0, full = true;
      for (c = 0; c < k; c++) {
        d = g[r][c];
        if (!d) { full = false; continue; }
        rs += d;
        if (seen[d]) out.push({ kind: 'dupRow', r: r, v: d });
        seen[d] = 1;
      }
      if (full && rs !== puzzle.rowT[r]) out.push({ kind: 'rowSum', r: r, v: rs });
    }

    for (c = 0; c < k; c++) {
      seen = {};
      var cs = 0, cfull = true;
      for (r = 0; r < k; r++) {
        d = g[r][c];
        if (!d) { cfull = false; continue; }
        cs += d;
        if (seen[d]) out.push({ kind: 'dupCol', c: c, v: d });
        seen[d] = 1;
      }
      if (cfull && cs !== puzzle.colT[c]) out.push({ kind: 'colSum', c: c, v: cs });
    }

    for (r = 0; r < k; r++) {
      for (c = 0; c < k; c++) {
        if (c < k - 1 && puzzle.right[r][c] && g[r][c] && g[r][c + 1]) {
          var okR = puzzle.right[r][c] === 1 ? g[r][c] < g[r][c + 1] : g[r][c] > g[r][c + 1];
          if (!okR) out.push({ kind: 'wedge', r: r, c: c });
        }
        if (r < k - 1 && puzzle.down[r][c] && g[r][c] && g[r + 1][c]) {
          var okD = puzzle.down[r][c] === 1 ? g[r][c] < g[r + 1][c] : g[r][c] > g[r + 1][c];
          if (!okD) out.push({ kind: 'wedge', r: r, c: c });
        }
      }
    }
    return out;
  }

  function isComplete(puzzle) {
    for (var r = 0; r < puzzle.k; r++) {
      for (var c = 0; c < puzzle.k; c++) if (!puzzle.grid[r][c]) return false;
    }
    return true;
  }

  /** Digits that break no rule in the cell, given what is written now. */
  function candidates(puzzle, r, c) {
    var k = puzzle.k, g = puzzle.grid, out = [], d, i;
    for (d = 1; d <= puzzle.V; d++) {
      var ok = true;
      for (i = 0; i < k; i++) {
        if (i !== c && g[r][i] === d) { ok = false; break; }
        if (i !== r && g[i][c] === d) { ok = false; break; }
      }
      if (!ok) continue;
      if (c > 0 && puzzle.right[r][c - 1] && g[r][c - 1]) {
        if (puzzle.right[r][c - 1] === 1 ? !(g[r][c - 1] < d) : !(g[r][c - 1] > d)) continue;
      }
      if (c < k - 1 && puzzle.right[r][c] && g[r][c + 1]) {
        if (puzzle.right[r][c] === 1 ? !(d < g[r][c + 1]) : !(d > g[r][c + 1])) continue;
      }
      if (r > 0 && puzzle.down[r - 1][c] && g[r - 1][c]) {
        if (puzzle.down[r - 1][c] === 1 ? !(g[r - 1][c] < d) : !(g[r - 1][c] > d)) continue;
      }
      if (r < k - 1 && puzzle.down[r][c] && g[r + 1][c]) {
        if (puzzle.down[r][c] === 1 ? !(d < g[r + 1][c]) : !(d > g[r + 1][c])) continue;
      }
      var rs = d, rn = 1, cs = d, cn = 1;
      for (i = 0; i < k; i++) {
        if (i !== c && g[r][i]) { rs += g[r][i]; rn++; }
        if (i !== r && g[i][c]) { cs += g[i][c]; cn++; }
      }
      if (rn === k && rs !== puzzle.rowT[r]) continue;
      if (rs > puzzle.rowT[r]) continue;
      if (cn === k && cs !== puzzle.colT[c]) continue;
      if (cs > puzzle.colT[c]) continue;
      out.push(d);
    }
    return out;
  }

  /* ================================================================ CSS == */

  var CSS = [
    '.pz-ledger{display:grid;grid-template-columns:minmax(0,1fr) minmax(224px,278px);gap:18px;align-items:start}',
    '@media (max-width:880px){.pz-ledger{grid-template-columns:1fr}}',
    '.pz-ledger.is-panel{display:flex;flex-direction:column;gap:12px}',
    '.pz-ledger-stage{display:flex;flex-direction:column;gap:14px}',

    '.pz-ledger-sheet{display:grid;gap:4px;padding:13px;border-radius:12px;',
    '  background:linear-gradient(160deg,#0b0e14,#07090d);border:1px solid var(--line);',
    '  box-shadow:var(--sh-1);width:100%;max-width:520px;margin:0 auto;overflow-x:auto}',
    '.pz-ledger.is-panel .pz-ledger-sheet{padding:8px;gap:3px}',
    '.pz-ledger.is-panel .pz-ledger-cell{min-width:30px;font-size:14px}',
    '.pz-ledger.is-panel .pz-ledger-key{min-width:30px;padding:7px 0;font-size:13px}',

    '.pz-ledger-corner{display:grid;place-items:center;font-family:var(--font-mono);font-size:10px;',
    '  color:var(--dimmer);letter-spacing:.08em}',
    '.pz-ledger-head{display:flex;flex-direction:column;gap:2px;justify-content:flex-end;padding:3px 4px;',
    '  font-size:10px;line-height:1.25;color:var(--dim)}',
    '.pz-ledger-head--row{justify-content:center;text-align:right;padding-right:8px}',
    '.pz-ledger-head__n{font-weight:600;color:var(--text-2)}',
    '.pz-ledger-head__t{font-family:var(--font-mono);font-size:10px;color:var(--dimmer)}',
    '.pz-ledger-head__t b{color:var(--acc-2);font-weight:700}',
    '.pz-ledger-head.is-ok .pz-ledger-head__t b{color:var(--good)}',
    '.pz-ledger-head.is-over .pz-ledger-head__t b{color:var(--bad)}',
    '.pz-ledger-head.is-under .pz-ledger-head__t b{color:var(--warn)}',
    '.pz-ledger-head.is-uncounted{opacity:.55}',
    '.pz-ledger-head.is-uncounted .pz-ledger-head__t b{color:var(--dimmer)}',

    '.pz-ledger-cell{position:relative;aspect-ratio:1/1;min-width:38px;padding:0;border-radius:6px;',
    '  display:grid;place-items:center;font-family:var(--font-mono);font-size:clamp(13px,2.6vw,20px);',
    '  background:#0e131b;border:1px solid #1a212c;color:var(--text);',
    '  transition:background .15s var(--ease),border-color .15s var(--ease)}',
    '.pz-ledger-cell:hover:not(:disabled){border-color:var(--acc)}',
    '.pz-ledger-cell.is-given{background:#151b24;color:var(--dim);border-color:#1f2733}',
    '.pz-ledger-cell.is-sel{border-color:var(--acc);background:var(--acc-wash);',
    '  box-shadow:0 0 0 1px var(--acc),0 0 16px var(--acc-glow)}',
    '.pz-ledger-cell.is-fault{border-color:var(--bad);background:rgba(226,105,95,.14)}',
    '.pz-ledger-cell.is-peer{background:#121926}',

    '.pz-ledger-w{position:absolute;font-size:11px;line-height:1;color:var(--acc-2);',
    '  font-family:var(--font-ui);font-weight:700;pointer-events:none;z-index:3;',
    '  text-shadow:0 0 6px rgba(0,0,0,.9)}',
    '.pz-ledger-w--r{right:-5px;top:50%;transform:translateY(-50%)}',
    '.pz-ledger-w--d{bottom:-6px;left:50%;transform:translateX(-50%)}',

    '.pz-ledger-keys{display:flex;flex-wrap:wrap;gap:6px}',
    '.pz-ledger-key{min-width:38px;padding:9px 0;border-radius:8px;border:1px solid var(--line);',
    '  background:linear-gradient(180deg,var(--panel-3),var(--panel-2));color:var(--text);',
    '  font-family:var(--font-mono);font-size:14px}',
    '.pz-ledger-key:hover:not(:disabled){border-color:var(--acc);transform:translateY(-1px)}',
    '.pz-ledger-key.is-spent{opacity:.35}',
    '.pz-ledger-key--clear{color:var(--bad);font-size:12px;min-width:52px}',

    '.pz-ledger-read{display:flex;flex-direction:column;gap:6px}',
    '.pz-ledger-read__row{display:flex;justify-content:space-between;gap:10px;',
    '  font-family:var(--font-mono);font-size:11px;color:var(--dim)}',
    '.pz-ledger-read__row b{color:var(--acc-2);font-weight:700}',
    '.pz-ledger-read__row.is-bad b{color:var(--bad)}',
    '.pz-ledger-read__row.is-ok b{color:var(--good)}',

    '.pz-ledger-note{font-size:11px;line-height:1.55;color:var(--dim);padding:8px 10px;border-radius:7px;',
    '  background:var(--panel-2);border:1px solid var(--line-soft)}',
    '.pz-ledger-note b{color:var(--acc-2)}',

    '.pz-ledger-reveal{font-size:13px;line-height:1.6;color:var(--text-2);padding:12px 14px;border-radius:9px;',
    '  background:color-mix(in srgb,var(--acc) 9%,var(--panel-2));',
    '  border:1px solid color-mix(in srgb,var(--acc) 34%,var(--line))}',
    '.pz-ledger-reveal b{color:var(--acc-2)}'
  ].join('\n');

  /* =============================================================== MOUNT == */

  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var C = puzzle.content;
    var k = puzzle.k;
    var finished = false;
    var sel = null;
    var arena = null;

    var cellEls = grid2d(k, null);
    var rowHeads = [], colHeads = [];
    var rowKnown = [], colKnown = [];
    var rowHandles = [], colHandles = [];
    var cCounted = null, cLeft = null;
    var r00, c00;
    for (r00 = 0; r00 < k; r00++) { rowKnown.push(false); colKnown.push(false); }

    var stage = h('div', { class: 'pz-ledger-stage' });
    var mapHost = h('div', {});
    var endBox = h('div', {});
    var panelRoot = h('div', { class: 'pz-ledger' });

    var sheet = h('div', {
      class: 'pz-ledger-sheet',
      style: {
        gridTemplateColumns: 'minmax(76px,1.35fr) repeat(' + k + ',minmax(30px,1fr))',
        gridTemplateRows: 'auto repeat(' + k + ',auto)'
      }
    });

    sheet.appendChild(h('div', { class: 'pz-ledger-corner', text: PS.state.prettify(C.unit).toUpperCase() }));
    for (var c0 = 0; c0 < k; c0++) {
      (function (cc) {
        var head = h('div', { class: 'pz-ledger-head' }, [
          h('div', { class: 'pz-ledger-head__n', text: puzzle.colLabels[cc] }),
          h('div', { class: 'pz-ledger-head__t' })
        ]);
        colHeads.push(head);
        sheet.appendChild(head);
      })(c0);
    }

    for (var r0 = 0; r0 < k; r0++) {
      (function (rr) {
        var head = h('div', { class: 'pz-ledger-head pz-ledger-head--row' }, [
          h('div', { class: 'pz-ledger-head__n', text: puzzle.rowLabels[rr] }),
          h('div', { class: 'pz-ledger-head__t' })
        ]);
        rowHeads.push(head);
        sheet.appendChild(head);

        for (var cx = 0; cx < k; cx++) {
          (function (cc) {
            var kids = [];
            if (cc < k - 1 && puzzle.right[rr][cc]) {
              kids.push(h('span', {
                class: 'pz-ledger-w pz-ledger-w--r',
                text: puzzle.right[rr][cc] === 1 ? '\u2039' : '\u203A'
              }));
            }
            if (rr < k - 1 && puzzle.down[rr][cc]) {
              kids.push(h('span', {
                class: 'pz-ledger-w pz-ledger-w--d',
                text: puzzle.down[rr][cc] === 1 ? '\u2227' : '\u2228'
              }));
            }
            var btn = h('button', { type: 'button', class: 'pz-ledger-cell' }, kids);
            btn.addEventListener('click', function () { pick(rr, cc); });
            cellEls[rr][cc] = btn;
            sheet.appendChild(btn);
          })(cx);
        }
      })(r0);
    }

    var keysBox = h('div', { class: 'pz-ledger-keys' });
    var readBox = h('div', { class: 'pz-ledger-read' });
    var noteBox = h('div', {});
    var actions = h('div', { class: 'pz-col' });
    var keyBtns = [];

    function countedTotals() {
      var c = 0, i;
      for (i = 0; i < k; i++) { if (rowKnown[i]) c++; if (colKnown[i]) c++; }
      return c;
    }

    function allCounted() { return countedTotals() >= k * 2; }

    /* ------------------------------------------------------------- render -- */

    function lineState(cur, target, full, known) {
      if (!known) return 'is-uncounted';
      if (!full) return cur > target ? 'is-over' : '';
      return cur === target ? 'is-ok' : (cur > target ? 'is-over' : 'is-under');
    }

    function paint() {
      var f = faults(puzzle);
      var faulty = {};
      for (var i = 0; i < f.length; i++) {
        if (f[i].kind === 'dupRow' || f[i].kind === 'rowSum') {
          for (var a = 0; a < k; a++) faulty[f[i].r + ':' + a] = true;
        } else if (f[i].kind === 'dupCol' || f[i].kind === 'colSum') {
          for (var b = 0; b < k; b++) faulty[b + ':' + f[i].c] = true;
        } else {
          faulty[f[i].r + ':' + f[i].c] = true;
        }
      }

      var r, c;
      for (r = 0; r < k; r++) {
        for (c = 0; c < k; c++) {
          var v = puzzle.grid[r][c];
          var cls = 'pz-ledger-cell';
          if (puzzle.given[r][c]) cls += ' is-given';
          if (sel && sel[0] === r && sel[1] === c) cls += ' is-sel';
          else if (sel && (sel[0] === r || sel[1] === c)) cls += ' is-peer';
          if (faulty[r + ':' + c] && v) cls += ' is-fault';
          var e = cellEls[r][c];
          e.className = cls;
          e.disabled = finished;
          // The wedge marks are children, so only replace the text node.
          if (e.firstChild && e.firstChild.nodeType === 3) e.firstChild.nodeValue = v ? String(v) : '';
          else e.insertBefore(document.createTextNode(v ? String(v) : ''), e.firstChild || null);
        }
      }

      for (r = 0; r < k; r++) {
        var rs = 0, rfull = true;
        for (c = 0; c < k; c++) { if (puzzle.grid[r][c]) rs += puzzle.grid[r][c]; else rfull = false; }
        rowHeads[r].className = 'pz-ledger-head pz-ledger-head--row ' + lineState(rs, puzzle.rowT[r], rfull, rowKnown[r]);
        setTotal(rowHeads[r], rs, puzzle.rowT[r], rowKnown[r]);
      }
      for (c = 0; c < k; c++) {
        var cs = 0, cfull = true;
        for (r = 0; r < k; r++) { if (puzzle.grid[r][c]) cs += puzzle.grid[r][c]; else cfull = false; }
        colHeads[c].className = 'pz-ledger-head ' + lineState(cs, puzzle.colT[c], cfull, colKnown[c]);
        setTotal(colHeads[c], cs, puzzle.colT[c], colKnown[c]);
      }

      paintKeys();
      paintRead(f);
    }

    function setTotal(head, cur, target, known) {
      var box = head.lastChild;
      PS.ui.clear(box);
      if (!known) {
        PS.ui.append(box, [h('b', { text: String(cur) }), ' / ?']);
        return;
      }
      var diff = cur - target;
      PS.ui.append(box, [
        h('b', { text: String(cur) }),
        ' / ' + target + (diff === 0 ? '' : ' (' + (diff > 0 ? '+' : '') + diff + ')')
      ]);
    }

    function paintKeys() {
      for (var d = 1; d <= puzzle.V; d++) {
        var btn = keyBtns[d - 1];
        var spent = false;
        if (sel && allCounted()) {
          var cand = candidates(puzzle, sel[0], sel[1]);
          spent = cand.indexOf(d) < 0;
        }
        btn.className = 'pz-ledger-key' + (spent ? ' is-spent' : '');
        btn.disabled = finished || !sel || puzzle.given[sel[0]][sel[1]];
      }
      keyBtns[puzzle.V].disabled = finished || !sel || puzzle.given[sel[0]][sel[1]];
    }

    function paintRead(f) {
      var filled = 0, r, c;
      for (r = 0; r < k; r++) for (c = 0; c < k; c++) if (puzzle.grid[r][c]) filled++;
      var blanksLeft = k * k - filled;

      PS.ui.clear(readBox);
      PS.ui.append(readBox, [
        row('Totals counted', countedTotals() + ' / ' + (k * 2), allCounted() ? 'is-ok' : ''),
        row('Entries left', String(blanksLeft), blanksLeft === 0 ? 'is-ok' : ''),
        row('Lines in dispute', String(f.length), f.length ? 'is-bad' : 'is-ok'),
        row('Recounts', String(puzzle.checks), '')
      ]);

      if (cCounted) cCounted.set(countedTotals() + ' / ' + (k * 2), allCounted() ? null : 'warn');
      if (cLeft) cLeft.set(String(blanksLeft));

      PS.ui.clear(noteBox);
      if (!allCounted()) {
        noteBox.appendChild(h('div', { class: 'pz-ledger-note' }, [
          'The book cannot check itself. ',
          h('b', { text: String(k * 2 - countedTotals()) }),
          ' more totals are out there on the ' + (C.rowThing || 'shelves') + ' and in the ' +
          (C.colThing || 'bins') + ', and until you have counted them this sheet is guesswork.'
        ]));
      } else if (sel && !puzzle.given[sel[0]][sel[1]]) {
        var cand = candidates(puzzle, sel[0], sel[1]);
        noteBox.appendChild(h('div', { class: 'pz-ledger-note' }, [
          puzzle.rowLabels[sel[0]] + ' in ' + puzzle.colLabels[sel[1]] + ' \u2014 ',
          h('b', { text: cand.length ? cand.join(' or ') : 'nothing fits' }),
          cand.length === 1 ? ' is the only quantity that fits.' : '.'
        ]));
      }

      function row(a, b, cls) {
        return h('div', { class: 'pz-ledger-read__row ' + (cls || '') },
          [h('span', { text: a }), h('b', { text: b })]);
      }
    }

    /* -------------------------------------------------------------- store -- */
    /* Every total on the sheet is a thing standing in this room. The lines are
       shelves down the west wall; the cages are along the north. Counting one
       is walking to it.                                                      */

    function storeMap() {
      var w = 6 + k * 3, hgt = 4 + k * 2;
      var tiles = [], x, y;
      for (y = 0; y < hgt; y++) {
        var line = [];
        for (x = 0; x < w; x++) line.push((y === 0 || y === hgt - 1 || x === 0 || x === w - 1) ? 1 : 0);
        tiles.push(line);
      }
      var mid = Math.floor(hgt / 2);
      for (x = 4; x <= 6 && x < w - 1; x++) tiles[mid][x] = 1;
      for (x = w - 7; x <= w - 5; x++) if (x > 1) tiles[mid][x] = 1;

      var rowSpots = [], colSpots = [], i;
      for (i = 0; i < k; i++) rowSpots.push({ x: 1, y: 3 + i * 2 });
      for (i = 0; i < k; i++) colSpots.push({ x: 5 + i * 3, y: 1 });
      return {
        w: w, h: hgt, tiles: tiles,
        rowSpots: rowSpots, colSpots: colSpots,
        desk: { x: w - 2, y: hgt - 2 }, spawn: { x: w - 4, y: hgt - 2 }
      };
    }

    function buildStore() {
      if (!PS.arena || typeof PS.arena.create !== 'function') return false;

      var m = storeMap();
      arena = PS.arena.create(mapHost, {
        map: { w: m.w, h: m.h, tiles: m.tiles },
        spawn: m.spawn,
        avatar: '\uD83E\uDDCD',
        light: state.stats.light,
        lightCurve: function (v) { return 4.4 + Math.min(100, Math.max(0, v)) / 100 * 3; },
        darkness: 0.58,
        memory: 0.68
      });
      if (!arena) return false;
      teardownFns.push(function () { if (arena) { arena.destroy(); arena = null; } });

      cCounted = arena.chip('Counted', '\uD83D\uDD22');
      cLeft = arena.chip('Blanks', '\u270F\uFE0F');

      var i;
      for (i = 0; i < k; i++) {
        (function (idx) {
          rowHandles.push(arena.prop({
            x: m.rowSpots[idx].x, y: m.rowSpots[idx].y,
            icon: C.rowIcon || '\uD83E\uDDFA', label: puzzle.rowLabels[idx],
            hint: 'count it', trigger: 'proximity', radius: 1.15, once: false, emits: 0.7,
            onActivate: function () { countRow(idx); }
          }));
        })(i);
      }
      for (i = 0; i < k; i++) {
        (function (idx) {
          colHandles.push(arena.prop({
            x: m.colSpots[idx].x, y: m.colSpots[idx].y,
            icon: C.colIcon || '\uD83D\uDDC4\uFE0F', label: puzzle.colLabels[idx],
            hint: 'count it', trigger: 'proximity', radius: 1.15, once: false, emits: 0.7,
            onActivate: function () { countCol(idx); }
          }));
        })(i);
      }

      arena.station({
        x: m.desk.x, y: m.desk.y, icon: C.deskIcon || '\uD83D\uDCD2', label: 'The ' + C.ledger,
        hint: 'work the sheet', radius: 1.4, emits: 1.9,
        onEnter: function (panelEl) { PS.ui.append(panelEl, panelRoot); }
      });

      arena.note('Count the ' + (C.rowThing || 'shelves') + ' and the ' + (C.colThing || 'bins') +
        ' first \u2014 the totals are on them, not in the book. Then work the sheet at the desk.');
      return true;
    }

    function countRow(i) {
      if (finished) return;
      if (!rowKnown[i]) {
        rowKnown[i] = true;
        api.toast(puzzle.rowLabels[i] + ': ' + puzzle.rowT[i] + ' ' + C.unit + ' across the whole line.', 'info', 3200);
        if (rowHandles[i]) rowHandles[i].setLabel(puzzle.rowLabels[i] + ' \u2014 ' + puzzle.rowT[i]);
        paint();
      }
    }

    function countCol(i) {
      if (finished) return;
      if (!colKnown[i]) {
        colKnown[i] = true;
        api.toast(puzzle.colLabels[i] + ': ' + puzzle.colT[i] + ' ' + C.unit + ' in it, counted twice.', 'info', 3200);
        if (colHandles[i]) colHandles[i].setLabel(puzzle.colLabels[i] + ' \u2014 ' + puzzle.colT[i]);
        paint();
      }
    }

    /* -------------------------------------------------------------- input -- */

    function pick(r, c) {
      if (finished) return;
      sel = [r, c];
      paint();
    }

    function write(d) {
      if (finished || !sel) return;
      var r = sel[0], c = sel[1];
      if (puzzle.given[r][c]) { api.toast('That figure is already signed off.', 'info', 1400); return; }
      puzzle.grid[r][c] = d;
      paint();
      if (isComplete(puzzle) && !faults(puzzle).length) api.toast('Every line balances. Close the count.', 'good', 2400);
    }

    function onKey(ev) {
      if (finished) return;
      if (!sel) return;
      if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key === 'Backspace' || ev.key === 'Delete' || ev.key === '0') { ev.preventDefault(); write(0); return; }
      var n = parseInt(ev.key, 10);
      if (n >= 1 && n <= puzzle.V) { ev.preventDefault(); write(n); return; }
      // Arrow keys belong to the avatar while there is a room to walk around.
      if (arena) return;
      var move = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[ev.key];
      if (!move) return;
      ev.preventDefault();
      var rr = Math.max(0, Math.min(k - 1, sel[0] + move[0]));
      var cc = Math.max(0, Math.min(k - 1, sel[1] + move[1]));
      pick(rr, cc);
    }
    document.addEventListener('keydown', onKey);
    teardownFns.push(function () { document.removeEventListener('keydown', onKey); });

    for (var d0 = 1; d0 <= puzzle.V; d0++) {
      (function (d) {
        var b = h('button', { type: 'button', class: 'pz-ledger-key', text: String(d) });
        b.addEventListener('click', function () { write(d); });
        keyBtns.push(b);
        keysBox.appendChild(b);
      })(d0);
    }
    (function () {
      var b = h('button', { type: 'button', class: 'pz-ledger-key pz-ledger-key--clear', text: 'CLEAR' });
      b.addEventListener('click', function () { write(0); });
      keyBtns.push(b);
      keysBox.appendChild(b);
    })();

    /* ------------------------------------------------------------ endings -- */

    function closeCount() {
      if (finished) return;
      if (!isComplete(puzzle)) { api.toast('There are still blanks. You cannot sign an incomplete count.', 'bad', 2400); return; }
      var f = faults(puzzle);
      puzzle.checks++;
      if (f.length) {
        api.tweak({ energy: -3, morale: -2 });
        api.toast(C.failLine + ' ' + describe(f[0]), 'bad', 3400);
        paint();
        return;
      }
      puzzle.solved = true;
      api.toast(C.solvedLine, 'good', 2600);
      api.flash();
      renderReveal();
    }

    function describe(f) {
      if (f.kind === 'dupRow') return 'The ' + puzzle.rowLabels[f.r].toLowerCase() + ' line has two lots of ' + f.v + '.';
      if (f.kind === 'dupCol') return puzzle.colLabels[f.c] + ' has two lots of ' + f.v + '.';
      if (f.kind === 'rowSum') return 'The ' + puzzle.rowLabels[f.r].toLowerCase() + ' line comes to ' + f.v + ', not ' + puzzle.rowT[f.r] + '.';
      if (f.kind === 'colSum') return puzzle.colLabels[f.c] + ' comes to ' + f.v + ', not ' + puzzle.colT[f.c] + '.';
      return 'One of the wedge marks is the wrong way round.';
    }

    function renderReveal() {
      var name = puzzle.rowLabels[puzzle.shortRow].toLowerCase();
      if (arena) {
        arena.closePanel();
        arena.note(C.solvedLine);
      }
      PS.ui.clear(endBox);
      PS.ui.append(endBox, [
        h('div', { class: 'pz-ledger-reveal' }, [
          C.revealLead,
          h('b', { text: puzzle.shortBy + ' ' + C.unit + ' of ' + name }),
          C.revealTail
        ]),
        h('div', { class: 'pz-choices' }, [choiceBtn(C.a), choiceBtn(C.b)])
      ]);
    }

    function choiceBtn(spec) {
      return h('button', {
        class: 'pz-choice', type: 'button',
        onclick: function () { finishClean(spec.choice); }
      }, [
        h('div', { class: 'pz-choice__i', text: spec.icon }),
        h('div', { class: 'pz-choice__t', text: spec.title }),
        h('div', { class: 'pz-choice__d', text: spec.desc })
      ]);
    }

    function finishClean(choice) {
      if (finished) return;
      finished = true;
      var clean = puzzle.checks <= 1;
      var took = choice !== 'signal';

      api.finish({
        outcome: 'success',
        stats: { morale: clean ? 8 : 4, energy: -(3 + puzzle.tier) },
        gain: took ? ['ration', 'manual'] : ['manual'],
        lose: [],
        tags: ['balanced_the_books'].concat(took ? ['took_a_cut'] : ['named_the_thief']),
        signals: {
          logic: clean ? 5 : 4,
          caution: took ? 1 : 2,
          scavenge: took ? 3 : 0,
          speed: clean ? 1 : 0
        },
        choice: choice,
        summary: 'You balanced the ' + C.ledger + ' and found ' + puzzle.shortBy + ' ' + C.unit
          + ' of ' + puzzle.rowLabels[puzzle.shortRow].toLowerCase() + ' missing.'
      });
    }

    /** Sign it off wrong. The numbers do not care, but somebody will. */
    function signOff() {
      if (finished) return;
      finished = true;
      puzzle.signedOff = true;
      var right = 0, total = 0, r, c;
      for (r = 0; r < k; r++) {
        for (c = 0; c < k; c++) {
          if (puzzle.given[r][c]) continue;
          total++;
          if (puzzle.grid[r][c] === puzzle.solution[r][c]) right++;
        }
      }
      var part = total ? right / total : 0;

      api.finish({
        outcome: part >= 0.6 ? 'partial' : 'fail',
        stats: { morale: -8, energy: -6 },
        gain: [], lose: [],
        tags: ['signed_it_blind'],
        signals: { logic: Math.round(part * 2), caution: 0, speed: 2 },
        choice: null,
        summary: 'You signed the ' + C.ledger + ' off without making it balance. '
          + (part >= 0.6 ? 'Most of it was right, which is not the same as right.'
                         : 'Whatever is missing will stay missing.')
      });
    }

    /* ------------------------------------------------------------- layout -- */

    PS.ui.append(actions, [
      h('div', { class: 'pz-row' }, [
        h('button', { class: 'pz-btn pz-btn--primary pz-btn--sm', type: 'button', onclick: closeCount },
          ['\u2713 Close the count']),
        h('button', { class: 'pz-btn pz-btn--danger pz-btn--sm', type: 'button', onclick: signOff },
          ['\u270D Sign it off anyway'])
      ])
    ]);

    PS.ui.append(panelRoot, [
      h('div', { class: 'pz-col' }, [
        sheet,
        h('div', { class: 'pz-note' }, [
          C.opening + ' No quantity repeats within a ', h('strong', { text: 'line' }), ' or a ',
          h('strong', { text: PS.state.prettify(C.colKind).toLowerCase() }),
          ', and every wedge points at the smaller of the two figures beside it.'
        ])
      ]),
      h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-card' }, [h('div', { class: 'pz-card__head', text: 'Enter a figure' }), keysBox, noteBox]),
        h('div', { class: 'pz-card' }, [h('div', { class: 'pz-card__head', text: 'The count' }), readBox]),
        h('div', { class: 'pz-card' }, [h('div', { class: 'pz-card__head', text: 'Sign' }), actions])
      ])
    ]);

    PS.ui.append(stage, [mapHost, endBox]);
    PS.ui.append(el, stage);

    if (buildStore()) {
      panelRoot.className = 'pz-ledger is-panel';
    } else {
      // No arena layer: the totals are simply printed, as they always were.
      for (var q = 0; q < k; q++) { rowKnown[q] = true; colKnown[q] = true; }
      PS.ui.append(mapHost, panelRoot);
    }

    pick(firstBlank()[0], firstBlank()[1]);
    if (arena) arena.focus();

    function firstBlank() {
      for (var r = 0; r < k; r++) for (var c = 0; c < k; c++) if (!puzzle.given[r][c]) return [r, c];
      return [0, 0];
    }
  }
  function unmount() {
    while (teardownFns.length) {
      try { teardownFns.pop()(); } catch (e) { /* keep unwinding */ }
    }
  }

  /* ================================================================ HINT = */

  function hint(puzzle, state, skin) {
    var k = puzzle.k, r, c;

    // A wrong figure poisons everything downstream, so say so first.
    for (r = 0; r < k; r++) {
      for (c = 0; c < k; c++) {
        var v = puzzle.grid[r][c];
        if (v && !puzzle.given[r][c] && v !== puzzle.solution[r][c]) {
          return 'Something you have already written is wrong \u2014 the '
            + puzzle.rowLabels[r].toLowerCase() + ' figure in ' + puzzle.colLabels[c]
            + ' cannot be ' + v + '. Rub it out before you go further.';
        }
      }
    }

    // Otherwise point at the most constrained blank still open.
    var best = null;
    for (r = 0; r < k; r++) {
      for (c = 0; c < k; c++) {
        if (puzzle.grid[r][c]) continue;
        var cand = candidates(puzzle, r, c);
        if (!best || cand.length < best.n) best = { r: r, c: c, n: cand.length, list: cand };
      }
    }
    if (!best) return 'Every line is filled in. Close the count and see what it tells you.';

    var where = puzzle.rowLabels[best.r].toLowerCase() + ' in ' + puzzle.colLabels[best.c];
    if (best.n === 0) return 'Nothing legal fits the ' + where + ' any more. Something earlier is wrong.';
    if (best.n === 1) return 'The ' + where + ' can only be ' + best.list[0] + '. Start there.';
    return 'The ' + where + ' is the tightest square left \u2014 only ' + best.list.join(' or ') + ' will go in it.';
  }

  /* ============================================================ AUTOSOLVE = */
  /* Headless. The generator proved the answer unique, so filling it in is a
     legitimate solve rather than a cheat. */

  function autoSolve(puzzle, rng, state, tier, skin) {
    var C = puzzle.content;
    var wrong = 0, r, c;
    for (r = 0; r < puzzle.k; r++) {
      for (c = 0; c < puzzle.k; c++) {
        if (!puzzle.given[r][c] && puzzle.grid[r][c] && puzzle.grid[r][c] !== puzzle.solution[r][c]) wrong++;
      }
    }
    var clean = wrong === 0 && puzzle.checks === 0;
    var took = rng.chance(0.5);

    return {
      outcome: 'success',
      stats: { morale: clean ? 8 : 4, energy: -(3 + puzzle.tier) },
      gain: took ? ['ration', 'manual'] : ['manual'],
      lose: [],
      tags: ['balanced_the_books'].concat(took ? ['took_a_cut'] : ['named_the_thief']),
      signals: { logic: clean ? 5 : 4, caution: took ? 1 : 2, scavenge: took ? 3 : 0, speed: clean ? 1 : 0 },
      choice: took ? C.b.choice : 'signal',
      summary: 'You worked the ' + C.ledger + ' until it balanced and found ' + puzzle.shortBy + ' '
        + C.unit + ' of ' + puzzle.rowLabels[puzzle.shortRow].toLowerCase() + ' unaccounted for.'
    };
  }

  /* ============================================================ REGISTER = */

  PS.registry.register({
    id: 'numeric_constraint',
    name: 'Numeric Constraint',
    icon: '\uD83E\uDDEE',
    blurb: 'The totals do not match. Fill the ledger in and it will tell you why.',

    favors:   { logic: 4 },
    provides: ['intel', 'supplies', 'information', 'food'],
    tagHooks: ['balanced_the_books', 'took_a_cut'],
    requires: function (state) { return state.stats.morale > 12; },

    css: CSS,

    skins: [
      {
        id: 'ration_ledger', biome: 'shelter', title: 'Ration Ledger',
        icon: '\uD83D\uDCD2', palette: 'bone',
        intro: 'Everyone signed for what they took, in pencil, in a school exercise book. The cages have been counted twice tonight and neither count agrees with the book. Nobody wants to be the one who says it out loud.',
        nouns: { record: 'ration book', unit: 'units', keeper: 'the quartermaster', place: 'the store cage' }
      },
      {
        id: 'payload_manifest', biome: 'industrial', title: 'Payload Manifest',
        icon: '\uD83D\uDCE6', palette: 'steel',
        intro: 'Five crates, one manifest, and a weighbridge ticket that does not match either. The load went out under someone\u2019s signature and came back under someone else\u2019s, and the difference is sitting in this room somewhere.',
        nouns: { record: 'shipping manifest', unit: 'units', keeper: 'the loadmaster', place: 'the loading dock' }
      },
      {
        id: 'seed_store_audit', biome: 'wilderness', title: 'Seed Store Audit',
        icon: '\uD83C\uDF31', palette: 'moss',
        intro: 'The bins are cold and dry and exactly as full as they should be, except that they are not. Seed is the one thing here that is worth more unplanted than eaten, which is precisely why it goes missing.',
        nouns: { record: 'sowing book', unit: 'measures', keeper: 'the seed warden', place: 'the seed store' }
      }
    ],

    build: build,
    mount: mount,
    unmount: unmount,
    hint: hint,
    autoSolve: autoSolve
  });

})(typeof window !== 'undefined' ? window : this);
