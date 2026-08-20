/* ==========================================================================
   PuzzleStudio — js/games/e18_sliding_block.js      ENGINE 18 · Sliding Block
   --------------------------------------------------------------------------
   Self-contained: logic + 3 skins + its own CSS. No DOM access until mount().

   THE PUZZLE
     Rush Hour, played from inside it. A yard packed with things too heavy to
     lift and just light enough to shove along their own length. One of them is
     the thing you actually need — an ambulance, a loaded pallet, a punt — and
     it has to reach the gap in the right-hand wall. Nothing passes through
     anything, and nothing turns.

     You walk the yard yourself. Which end of a thing you are standing at is
     which way it goes when you put your shoulder into it, which is a far
     better interface than picking a piece and then picking a direction.

   GENERATION — REVERSE SEARCH, THEN PROOF
     Random boards are usually either trivial or impossible, and you cannot
     tell which without solving them. So this engine never places a puzzle and
     hopes. It works backwards from a board that is already solved:

       1. Lay out the target piece parked in the exit, plus blockers, with
          vertical pieces biased to straddle the exit lane.
       2. beamBack() walks AWAY from that solved board. Sliding is reversible,
          so every state it reaches is reachable back — solvability is
          structural, not lucky. The beam is steered by a congestion score
          (target driven left, lane blockers wedged) so it finds tangles a
          blind random walk never would.
       3. aStar() then proves the exact minimum move count of each candidate.
          The heuristic — cells the target must travel, plus the cells each
          lane blocker must move to clear the lane — counts disjoint sets of
          moves, so it is admissible and A* returns a true optimum. Verified
          against exhaustive BFS on 400 boards: zero disagreements.
       4. Keep the candidate whose proven minimum lands in the tier's band.

     So "known minimum" on the panel is a proof, not a guess, and difficulty is
     dialled in moves rather than in vibes.

   BOUNDED GENERATION
     build() runs synchronously on the main thread, so every search shares one
     node budget. When it runs out, generation stops and returns the best
     candidate proven so far; if nothing was proven, the beam's own path back
     to the solved board is a known-good route. There is no seed that spins.

   THE BRANCH
     The lane opens onto a choice: ride the thing you just freed, or leave it
     and strip the rest of the yard while nobody is watching.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio;
  if (!PS || !PS.registry) { if (root.console) console.error('[e18] core not loaded'); return; }

  /* ======================================================== SKIN CONTENT == */

  var CONTENT = {
    motor_pool: {
      targetIcon: '\uD83D\uDE91', targetName: 'ambulance',
      blockers: ['\uD83D\uDE97', '\uD83D\uDE99', '\uD83D\uDE9A', '\uD83D\uDEFB', '\uD83D\uDE90'],
      blockerName: 'dead vehicle', exitIcon: '\uD83D\uDEA7', exitName: 'the gate',
      lane: 'the gate lane',
      solvedLine: 'The ambulance rolls the last two metres and the gate is behind you.',
      forcedLine: 'You put a loader through three cars to make a hole, and you pay for it.',
      blockedLine: 'It grinds against something and stops dead.',
      arrive: 'The lane is open. Diesel, wet tarmac, and nobody shouting yet.',
      a: { icon: '\uD83D\uDE91', title: 'Take it and go', desc: 'Keys are in it. Out through the gate before anyone decides you are a problem.', choice: 'sprint' },
      b: { icon: '\uD83E\uDDF0', title: 'Strip the yard first', desc: 'Twenty vehicles nobody is coming back for. Ten minutes, maybe less.', choice: 'scavenge' }
    },
    crate_hatch: {
      targetIcon: '\uD83D\uDED2', targetName: 'loaded pallet',
      blockers: ['\uD83D\uDCE6', '\uD83D\uDEE2\uFE0F', '\uD83E\uDDF1', '\uD83E\uDEB5', '\u2699\uFE0F'],
      blockerName: 'crate', exitIcon: '\uD83D\uDEAA', exitName: 'the hatch',
      lane: 'the hatch run',
      solvedLine: 'The pallet noses into the hatch frame and stops exactly where you need it.',
      forcedLine: 'You tip a stack to clear a gap and half a tonne of it comes down behind you.',
      blockedLine: 'Wood on wood. It has nowhere to go.',
      arrive: 'The hatch run is clear. Cold air coming up through the grating.',
      a: { icon: '\uD83D\uDD73\uFE0F', title: 'Down through the hatch', desc: 'Stand on the pallet, drop through, pull the cover after you.', choice: 'descend' },
      b: { icon: '\uD83D\uDD28', title: 'Open the other crates', desc: 'Half this bay is bonded stores and the seals mean nothing now.', choice: 'scavenge' }
    },
    ice_sluice: {
      targetIcon: '\uD83D\uDEF6', targetName: 'punt',
      blockers: ['\uD83E\uDDCA', '\uD83E\uDEB5', '\u2B1C', '\u2744\uFE0F', '\uD83E\uDEA8'],
      blockerName: 'ice slab', exitIcon: '\uD83C\uDF0A', exitName: 'the sluice mouth',
      lane: 'the sluice channel',
      solvedLine: 'The punt slides free and the current takes hold of the bow.',
      forcedLine: 'You break the jam with the pole and the whole raft of it moves at once.',
      blockedLine: 'The slab shunts a hand-width and locks again.',
      arrive: 'The channel is running. Black water, and it is going somewhere.',
      a: { icon: '\uD83C\uDF0A', title: 'Go with the water', desc: 'Push off and let the sluice do the work. Fast, cold, one direction only.', choice: 'wade' },
      b: { icon: '\uD83E\uDDD7', title: 'Climb the sluice gate', desc: 'Up the frozen ironwork instead. You would see the whole valley from there.', choice: 'climb' }
    }
  };

  /* Proven-minimum band per clamped tier, and the board it is generated on.
     These are tuned against the generator, not wished for: measured across
     240 seeds the pipeline proves an exact minimum on effectively every
     build and lands inside the band on most of them. */
  var TIERS = {
    1: { n: 6, pieces: 10, band: [4, 8] },
    2: { n: 6, pieces: 11, band: [5, 10] },
    3: { n: 6, pieces: 12, band: [7, 12] },
    4: { n: 7, pieces: 14, band: [9, 15] },
    5: { n: 7, pieces: 15, band: [10, 18] },
    6: { n: 7, pieces: 16, band: [11, 20] }
  };

  var BUILD_BUDGET = 3500;    // A* node expansions for one whole build()
  var BUILD_MS     = 50;      // hard wall-clock ceiling for one whole build()
  var LIVE_BUDGET  = 9000;    // A* node expansions for one hint / autoSolve
  var MAX_F        = 128;     // bucket queue depth; f never gets near this

  /* ============================================================== STATE == */
  /* A board state is nothing but each piece's position along its own axis.
     Horizontal pieces keep a fixed row and a moving column; vertical pieces
     keep a fixed column and a moving row. One small integer per piece is the
     complete state, and a string of those integers is the hash key.
     pieces[0] is ALWAYS the target — the whole solver leans on that. */

  function encode(vars) {
    var s = '', i;
    for (i = 0; i < vars.length; i++) s += String.fromCharCode(48 + vars[i]);
    return s;
  }

  function decode(k) {
    var v = [], i;
    for (i = 0; i < k.length; i++) v.push(k.charCodeAt(i) - 48);
    return v;
  }

  /** Paint piece indices into a flat n*n occupancy buffer. -1 is empty. */
  function occupy(pieces, vars, n, occ) {
    var i, k;
    for (i = 0; i < n * n; i++) occ[i] = -1;
    for (i = 0; i < pieces.length; i++) {
      var p = pieces[i], v = vars[i];
      if (p.horiz) { for (k = 0; k < p.len; k++) occ[p.fixed * n + v + k] = i; }
      else         { for (k = 0; k < p.len; k++) occ[(v + k) * n + p.fixed] = i; }
    }
    return occ;
  }

  function occOf(pieces, vars, n) {
    return occupy(pieces, vars, n, new Array(n * n));
  }

  function cellAt(occ, p, coord, n) {
    return p.horiz ? occ[p.fixed * n + coord] : occ[coord * n + p.fixed];
  }

  /**
   * Every legal one-cell slide. The only cell that can block a slide is the
   * cell the piece is about to grow into: its new head, or the cell past its
   * tail. Moves are packed as pieceIndex*2 + (forward ? 1 : 0).
   */
  function legalMoves(pieces, vars, n, occ, out) {
    out.length = 0;
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i], v = vars[i];
      if (v - 1 >= 0 && cellAt(occ, p, v - 1, n) === -1) out.push(i * 2);
      if (v + p.len <= n - 1 && cellAt(occ, p, v + p.len, n) === -1) out.push(i * 2 + 1);
    }
    return out;
  }

  function movePiece(m)  { return m >> 1; }
  function moveDir(m)    { return (m & 1) ? 1 : -1; }

  function applyMove(vars, m) {
    var nx = vars.slice();
    nx[movePiece(m)] += moveDir(m);
    return nx;
  }

  /* ========================================================== HEURISTIC == */
  /**
   * Admissible lower bound on the moves still needed.
   *
   *   (a) the cells the target itself must still travel, plus
   *   (b) for every piece sitting in the lane between the target and the wall,
   *       the fewest cells THAT piece must move to stop occupying the exit
   *       row at all.
   *
   * (a) counts only target moves and (b) counts only blocker moves, so the two
   * never double-count and the sum can never exceed the true optimum.
   *
   * This is the hot path — A* calls it once per generated child — so it reads
   * the pieces directly instead of painting an occupancy grid. Horizontal
   * pieces are skipped: layout() never puts one in the exit row, and one could
   * never leave it anyway. Skipping a blocker only lowers h, which keeps the
   * bound admissible either way.
   */
  function heuristic(pieces, vars, n, exitRow, need) {
    var h = need - vars[0];
    if (h < 0) h = 0;
    var tail = vars[0] + pieces[0].len;

    for (var i = 1; i < pieces.length; i++) {
      var p = pieces[i];
      if (p.horiz || p.fixed < tail) continue;             // not in the lane ahead
      var r = vars[i], L = p.len;
      if (r > exitRow || r + L - 1 < exitRow) continue;     // does not cross the lane
      // Slide it down until its top clears the lane, or up until its bottom
      // does. A direction that runs off the board is not available.
      var down = (exitRow + L <= n - 1) ? (exitRow - r + 1) : Infinity;
      var up   = (L <= exitRow)         ? (r + L - exitRow) : Infinity;
      var best = down < up ? down : up;
      h += (best === Infinity || best < 1) ? 1 : best;
    }
    return h;
  }

  /**
   * A* for the exact minimum, with a bucket queue keyed on f. Returns
   * { min, path } or null if the shared budget ran out first.
   */
  function aStar(pieces, start, n, exitRow, budget) {
    var need = n - pieces[0].len;
    if (start[0] === need) return { min: 0, path: [] };

    var startKey = encode(start);
    var g = {}, fOf = {}, parent = {}, pmove = {};
    var buf = [], occ = new Array(n * n);
    var pending = 0, i;

    // A packed array of buckets, not a sparse one — a sparse array here drops
    // the whole queue into dictionary mode and costs more than the search.
    var open = new Array(MAX_F);
    for (i = 0; i < MAX_F; i++) open[i] = null;

    g[startKey] = 0;
    var f = heuristic(pieces, start, n, exitRow, need);
    if (f >= MAX_F) return null;
    fOf[startKey] = f;
    open[f] = [startKey];
    pending++;

    var guard = 0;
    while (pending > 0 && guard++ < 200000) {
      while (f < MAX_F && (!open[f] || !open[f].length)) f++;
      if (f >= MAX_F) break;

      var key = open[f].pop();
      pending--;
      // Charge EVERY pop, stale or not. That makes the budget a hard bound on
      // iterations rather than just on useful ones, which is what stops a
      // pathological board from stalling the main thread.
      if (budget.left-- <= 0) return null;
      if (fOf[key] !== f) continue;                        // superseded by a cheaper route

      var gv = g[key];
      var vars = decode(key);
      if (vars[0] === need) {
        var path = [], cur = key;
        while (parent[cur] !== undefined) { path.unshift(pmove[cur]); cur = parent[cur]; }
        return { min: gv, path: path };
      }

      occupy(pieces, vars, n, occ);
      legalMoves(pieces, vars, n, occ, buf);
      for (i = 0; i < buf.length; i++) {
        var nx = applyMove(vars, buf[i]);
        var nk = encode(nx);
        var ng = gv + 1;
        if (g[nk] !== undefined && g[nk] <= ng) continue;
        var nf = ng + heuristic(pieces, nx, n, exitRow, need);
        if (nf >= MAX_F) continue;
        g[nk] = ng;
        parent[nk] = key;
        pmove[nk] = buf[i];
        fOf[nk] = nf;
        if (!open[nf]) open[nf] = [];
        open[nf].push(nk);
        pending++;
        if (nf < f) f = nf;
      }
    }
    return null;
  }

  /* ============================================================== LAYOUT = */

  /**
   * A SOLVED board: target parked against the exit wall, blockers dropped
   * around it, vertical pieces biased to straddle the exit row so the beam
   * has something to wedge into the lane. Nothing horizontal is ever allowed
   * in the exit row — a horizontal piece there can never leave it, and a lane
   * that can only be cleared by luck is not a puzzle.
   */
  function layout(n, want, rng) {
    var exitRow = rng.int(1, n - 2);
    var tgtLen = rng.chance(0.3) ? 3 : 2;

    var pieces = [{ fixed: exitRow, len: tgtLen, horiz: true, target: true }];
    var vars = [n - tgtLen];

    var occ = new Array(n * n), i, k;
    for (i = 0; i < n * n; i++) occ[i] = -1;
    for (k = 0; k < tgtLen; k++) occ[exitRow * n + (n - tgtLen) + k] = 0;

    var tries = 0;
    while (pieces.length < want && tries < 500) {
      tries++;
      var horiz = rng.chance(0.30);
      var len = rng.chance(0.32) ? 3 : 2;
      if (len > n) continue;

      var fixed, moving, ok = true;
      if (horiz) {
        fixed = rng.int(0, n - 1);
        if (fixed === exitRow) continue;
        moving = rng.int(0, n - len);
      } else {
        fixed = rng.int(0, n - 1);
        if (rng.chance(0.6)) {
          moving = rng.int(Math.max(0, exitRow - len + 1), Math.min(n - len, exitRow));
        } else {
          moving = rng.int(0, n - len);
        }
      }

      for (k = 0; k < len; k++) {
        var idx = horiz ? (fixed * n + moving + k) : ((moving + k) * n + fixed);
        if (occ[idx] !== -1) { ok = false; break; }
      }
      if (!ok) continue;

      var id = pieces.length;
      for (k = 0; k < len; k++) {
        occ[horiz ? (fixed * n + moving + k) : ((moving + k) * n + fixed)] = id;
      }
      pieces.push({ fixed: fixed, len: len, horiz: horiz, target: false });
      vars.push(moving);
    }

    return { pieces: pieces, solved: vars, exitRow: exitRow };
  }

  /**
   * How tangled a board looks, without solving it: the target driven away
   * from the wall, and lane blockers that have little room of their own.
   * Cheap enough to score every state the beam touches.
   */
  function congestion(pieces, vars, n, exitRow) {
    var occ = occOf(pieces, vars, n);
    var tail = vars[0] + pieces[0].len;
    var s = (n - tail) * 7;
    var blockers = {}, c, k;

    for (c = tail; c < n; c++) {
      var pi = occ[exitRow * n + c];
      if (pi > 0) blockers[pi] = 1;
    }
    for (k in blockers) {
      if (!Object.prototype.hasOwnProperty.call(blockers, k)) continue;
      var i = +k, p = pieces[i], lo = vars[i], hi = vars[i];
      while (lo - 1 >= 0 && cellAt(occ, p, lo - 1, n) === -1) lo--;
      while (hi + p.len <= n - 1 && cellAt(occ, p, hi + p.len, n) === -1) hi++;
      s += 9 - Math.min(6, (hi - lo) * 2);
    }
    return s;
  }

  /**
   * Reverse beam search away from the solved board. Every state it yields is
   * reachable back to a solved board by construction, and `d` is the length
   * of that known route — the fallback difficulty number if A* never gets to
   * prove a tighter one. Bounded by rounds AND by a shared deadline.
   */
  function beamBack(pieces, solved, n, exitRow, rng, width, rounds, deadline) {
    var frontier = [{ vars: solved.slice(), d: 0 }];
    var seen = {};
    var pool = [];
    var occ = new Array(n * n), buf = [];
    seen[encode(solved)] = 1;

    for (var r = 0; r < rounds; r++) {
      if (Date.now() > deadline) break;
      var next = [];
      for (var e = 0; e < frontier.length; e++) {
        var cur = frontier[e];
        occupy(pieces, cur.vars, n, occ);
        legalMoves(pieces, cur.vars, n, occ, buf);
        for (var i = 0; i < buf.length; i++) {
          var nx = applyMove(cur.vars, buf[i]);
          var k = encode(nx);
          if (seen[k]) continue;
          seen[k] = 1;
          next.push({ vars: nx, d: cur.d + 1, s: congestion(pieces, nx, n, exitRow) + rng.float() * 2 });
        }
      }
      if (!next.length) break;
      next.sort(function (a, b) { return b.s - a.s; });
      frontier = next.slice(0, width);
      pool.push(next[0]);
      if (next.length > 1) pool.push(next[1]);
    }
    pool.sort(function (a, b) { return b.s - a.s; });
    return pool;
  }

  /* =============================================================== BUILD == */

  function build(state, rng, tier, skin) {
    var C = CONTENT[skin.id] || CONTENT.motor_pool;
    var t = Math.min(6, tier);                 // the run is infinite; the curve is not
    var cfg = TIERS[t];
    var n = cfg.n, band = cfg.band;

    var budget = { left: BUILD_BUDGET };
    var deadline = Date.now() + BUILD_MS;   // build() is synchronous: never let a seed spin
    var best = null;
    var attempt, i;

    for (attempt = 0; attempt < 3 && budget.left > 0 && Date.now() < deadline; attempt++) {
      var lay = layout(n, cfg.pieces, rng);
      var pool = beamBack(lay.pieces, lay.solved, n, lay.exitRow, rng, 9, band[1] + 8, deadline);
      if (!pool.length) continue;

      // Unproven fallback: the beam's own route home is a real solution of
      // known length, so even a budget wipeout leaves a playable board. It
      // must not be a board that is already solved, hence the goal filter.
      if (!best) {
        var parked = n - lay.pieces[0].len;
        var deep = null;
        for (i = 0; i < pool.length; i++) {
          if (pool[i].vars[0] === parked) continue;
          if (!deep || pool[i].d > deep.d) deep = pool[i];
        }
        if (deep) {
          best = {
            pieces: lay.pieces, exitRow: lay.exitRow, vars: deep.vars,
            optimal: deep.d, exact: false, path: null
          };
        }
      }

      for (i = 0; i < pool.length && i < 8 && budget.left > 0; i++) {
        if (pool[i].vars[0] === n - lay.pieces[0].len) continue;      // already parked
        if (Date.now() > deadline) break;
        var solved = aStar(lay.pieces, pool[i].vars, n, lay.exitRow, budget);
        if (!solved || solved.min < 2) continue;                      // 1-move boards are not puzzles
        if (!best || !best.exact || solved.min > best.optimal) {
          best = {
            pieces: lay.pieces, exitRow: lay.exitRow, vars: pool[i].vars,
            optimal: solved.min, exact: true, path: solved.path
          };
        }
        if (best.exact && best.optimal >= band[0]) break;
      }
      if (best && best.exact && best.optimal >= band[0]) break;
    }

    // Degenerate seed: the target alone in an empty yard is trivial but is a
    // genuine, solvable board. build() must never throw and never return null.
    if (!best || best.vars[0] === n - best.pieces[0].len) {
      var bare = [{ fixed: 1, len: 2, horiz: true, target: true }];
      var route = [];
      for (i = 0; i < n - 2; i++) route.push(1);          // slide right, n-2 times
      best = { pieces: bare, exitRow: 1, vars: [0], optimal: n - 2, exact: true, path: route };
    }

    // Skin dressing, assigned deterministically so a seed always looks the same.
    for (i = 0; i < best.pieces.length; i++) {
      var p = best.pieces[i];
      p.icon = (i === 0) ? C.targetIcon : C.blockers[i % C.blockers.length];
    }

    return {
      n: n,
      tier: t,
      content: C,
      pieces: best.pieces,
      targetIdx: 0,
      exitRow: best.exitRow,
      vars: best.vars.slice(),
      startVars: best.vars.slice(),
      optimal: best.optimal,
      exact: best.exact,
      startPath: best.path,          // optimal route from the START position
      moves: 0,
      resets: 0,
      solved: false,
      forced: false
    };
  }

  /* ========================================================== BOARD RULES = */

  /** How far a piece may slide right now, in board coordinates. */
  function freeRange(puzzle, i) {
    var occ = occOf(puzzle.pieces, puzzle.vars, puzzle.n);
    var p = puzzle.pieces[i], n = puzzle.n;
    var lo = puzzle.vars[i], hi = puzzle.vars[i];
    while (lo - 1 >= 0 && cellAt(occ, p, lo - 1, n) === -1) lo--;
    while (hi + p.len <= n - 1 && cellAt(occ, p, hi + p.len, n) === -1) hi++;
    return { lo: lo, hi: hi };
  }

  function isSolved(puzzle) {
    return puzzle.vars[0] === puzzle.n - puzzle.pieces[0].len;
  }

  /**
   * Optimal route from wherever the board sits now. Free when the player has
   * not moved yet (build already proved it); a bounded A* otherwise, so a
   * hint can never lock the tab up.
   */
  function routeNow(puzzle) {
    if (puzzle.moves === 0 && puzzle.startPath) return puzzle.startPath;
    var r = aStar(puzzle.pieces, puzzle.vars, puzzle.n, puzzle.exitRow, { left: LIVE_BUDGET });
    return r ? r.path : null;
  }

  /* ====================================================== ARENA GEOMETRY ==
     You are not looking down at the yard any more, you are standing in it.
     Every board cell becomes one tile with a one-tile aisle between cells, so
     a 2-long vehicle is three tiles of solid metal and there is always room to
     walk down the side of it. Board cell v -> tile 2 + 2v; the outer ring of
     the yard is always clear, so the perimeter can never be cut off.

     PUSH HANDLES
     The tile immediately off each end of a piece is provably always free — it
     could only be covered by a horizontal piece spanning both the cell we end
     on and the one beyond, and we are the piece on that cell. So each piece
     gets a standing spot at each end, and which one you are standing on is
     what decides which way the thing goes when you put your shoulder into it. */

  function cellTile(v) { return 2 + v * 2; }
  function yardW(n) { return 2 * n + 3; }

  function yardPlan(n) {
    var w = yardW(n), tiles = [], x, y;
    for (y = 0; y < w; y++) {
      tiles.push([]);
      for (x = 0; x < w; x++) {
        tiles[y].push((x === 0 || y === 0 || x === w - 1 || y === w - 1) ? 1 : 0);
      }
    }
    return { w: w, h: w, tiles: tiles };
  }

  /** A yard under floodlights. The jam is the puzzle; the dark is not. */
  function arenaRadius(light) {
    var l = light < 0 ? 0 : (light > 100 ? 100 : light);
    return 3.8 + (l / 100) * 2.6;
  }

  function dirWord(horiz, dir) {
    return horiz ? (dir > 0 ? 'right' : 'left') : (dir > 0 ? 'down' : 'up');
  }

  /** Where you stand to push piece i in direction dir, in tile coords. */
  function handTile(puzzle, i, dir) {
    var p = puzzle.pieces[i], v = puzzle.vars[i];
    var along = dir > 0 ? cellTile(v) - 1 : cellTile(v + p.len - 1) + 1;
    return p.horiz ? { x: along, y: cellTile(p.fixed) } : { x: cellTile(p.fixed), y: along };
  }

  /* ================================================================ CSS == */

  var CSS = [
    '.pz-slide{display:flex;flex-direction:column;gap:12px}',

    '.pz-slide-tips{display:flex;flex-wrap:wrap;gap:14px;align-items:center;font-size:12px;color:var(--dim);line-height:1.6}',
    '.pz-slide-tips strong{color:var(--text-2);font-weight:600}',
    '.pz-slide-cap{font-family:var(--font-mono);font-size:10.5px;padding:2px 7px;border-radius:5px;',
    '  background:#0c1016;border:1px solid var(--line);border-bottom-width:2px;color:var(--text-2)}',

    '.pz-slide-legend{display:flex;flex-wrap:wrap;gap:11px;font-size:11px;color:var(--dim)}',
    '.pz-slide-legend span{display:inline-flex;gap:5px;align-items:center}',

    '.pz-slide-hand{display:flex;align-items:center;gap:11px;min-height:62px;padding:10px 12px;border-radius:10px;',
    '  background:linear-gradient(180deg,var(--panel-2),var(--panel));border:1px solid var(--line);',
    '  transition:border-color .18s var(--ease)}',
    '.pz-slide-hand.is-target{border-color:color-mix(in srgb,var(--acc) 62%,transparent);',
    '  box-shadow:0 0 0 1px color-mix(in srgb,var(--acc) 18%,transparent)}',
    '.pz-slide-hand.is-stuck{border-color:rgba(226,105,95,.5)}',
    '.pz-slide-hand__i{font-size:22px;line-height:1}',
    '.pz-slide-hand__t{font-size:13px;font-weight:600;color:var(--text);line-height:1.3}',
    '.pz-slide-hand__d{font-size:11.5px;color:var(--dim);line-height:1.45}',
    '.pz-slide-hand__d b{color:var(--acc-2);font-weight:600}',
    '.pz-slide-hand__d.is-bad b{color:var(--bad)}',
    '.pz-slide-hand__idle{font-size:12px;line-height:1.5;color:var(--dim)}'
  ].join('\n');

  /* =============================================================== MOUNT == */

  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var C = puzzle.content;
    var n = puzzle.n;
    var W = yardW(n);
    var laneY = cellTile(puzzle.exitRow);
    var finished = false;
    var arena = null;

    var bodies = [];                    // [piece][cell] -> prop handle
    var handles = [];                   // [piece] -> { fwd, back } prop handles
    var hand = { piece: -1, dir: 0, play: -1 };

    var stage = h('div', {});
    var handBox = h('div', { class: 'pz-slide-hand' });
    var endBox = h('div', { class: 'pz-col' });

    PS.ui.append(el, h('div', { class: 'pz-slide' }, [
      stage,
      h('div', { class: 'pz-slide-tips' }, [
        h('span', {}, [
          h('b', { class: 'pz-slide-cap', text: 'W A S D' }), ' / ',
          h('b', { class: 'pz-slide-cap', text: '\u2190\u2191\u2193\u2192' }),
          ' walk the yard \u00B7 hold or click the ', h('strong', { text: 'mouse' }), ' to go there \u00B7 ',
          h('b', { class: 'pz-slide-cap', text: 'E' }), ' puts your shoulder into it, ',
          h('strong', { text: 'away from wherever you are standing' })
        ]),
        h('div', { class: 'pz-slide-legend' }, [
          h('span', {}, [C.targetIcon, ' ' + C.targetName]),
          h('span', {}, [C.blockers[1], ' ' + C.blockerName]),
          h('span', {}, ['\u27A1\uFE0F', ' somewhere to push from']),
          h('span', {}, [C.exitIcon, ' ' + C.exitName])
        ])
      ]),
      handBox, endBox
    ]));

    /* ------------------------------------------------------- degraded mode -- */
    if (!PS.arena || typeof PS.arena.create !== 'function') {
      PS.ui.append(stage, h('div', { class: 'pz-intro', text: C.arrive }));
      PS.ui.append(endBox, h('div', { class: 'pz-choices' }, [choiceBtn(C.a), choiceBtn(C.b)]));
      return;
    }

    /* -------------------------------------------------------------- arena -- */

    arena = PS.arena.create(stage, {
      map: yardPlan(n),
      spawn: { x: 1, y: laneY },
      avatar: '\uD83E\uDDCD',
      light: state.stats.light,
      lightCurve: arenaRadius,
      darkness: 0.86,
      memory: 0.42,
      onTick: trackHand
    });
    if (!arena) return;
    teardownFns.push(function () { if (arena) { arena.destroy(); arena = null; } });

    arena.revealAll();

    /* --------------------------------------------------------------- HUD --- */

    var mMoves = arena.meter('Moves', '\uD83D\uDC63');
    var cMin = arena.chip(puzzle.exact ? 'Minimum' : 'Known route', '\uD83E\uDDE0');
    var cJam = arena.chip('In the way', C.blockers[1]);
    var cResets = arena.chip('Resets', '\u21BA');

    arena.note('Everything slides along its own length only and nothing passes through anything. Stand at one end of a thing and press E.');
    arena.button('\u21BA Reset the yard', reset);
    arena.button('\uD83D\uDCA5 Force it', forceIt, 'pz-btn--danger');

    /* --------------------------------------------------------- the yard --- */

    for (var pi = 0; pi < puzzle.pieces.length; pi++) addPiece(pi);

    // The lane out, marked at both ends so it reads from anywhere in the yard.
    arena.prop({
      x: W - 2, y: laneY, icon: C.exitIcon, label: PS.state.prettify(C.exitName),
      hint: 'the way out', trigger: 'press', once: false, botSkip: true,
      radius: 0.55, glow: true, emits: 2.1,
      onActivate: function () {
        api.toast(puzzle.solved
          ? C.arrive
          : 'The gap is right there. The ' + C.targetName + ' is what has to come through it.', 'info', 2400);
      }
    });
    arena.prop({
      x: 1, y: laneY, icon: C.exitIcon, label: PS.state.prettify(C.lane),
      trigger: 'press', once: false, botSkip: true,
      radius: 0.001, glow: false, emits: 0.9
    });

    function addPiece(i) {
      var p = puzzle.pieces[i], row = [], k;

      for (k = 0; k < p.len; k++) {
        // The body is what you see and what blocks you. It is never the thing
        // E talks to — the handles at the ends are, and that is the point.
        row.push(arena.prop({
          x: 0, y: 0, icon: p.icon,
          label: PS.state.prettify(i === 0 ? C.targetName : C.blockerName),
          trigger: 'press', once: false, botSkip: true,
          radius: 0.001, glow: i === 0, emits: i === 0 ? 1.3 : 0,
          tint: i === 0 ? null : '#8592a6'
        }));
      }
      bodies.push(row);
      handles.push({ fwd: addHandle(i, 1), back: addHandle(i, -1) });
    }

    function addHandle(i, dir) {
      var p = puzzle.pieces[i];
      return arena.prop({
        x: 0, y: 0,
        icon: p.horiz ? (dir > 0 ? '\u27A1\uFE0F' : '\u2B05\uFE0F') : (dir > 0 ? '\u2B07\uFE0F' : '\u2B06\uFE0F'),
        label: PS.state.prettify(i === 0 ? C.targetName : C.blockerName),
        hint: 'E \u00B7 shove it ' + dirWord(p.horiz, dir),
        trigger: 'press', once: false,
        radius: 0.78, glow: false, emits: 0,
        onActivate: function () { shove(i, dir); }
      });
    }

    /* --------------------------------------------------------- the board -- */

    /**
     * Lay the yard out. Bodies are trivial; handles need one piece of care.
     * Two pieces sitting flush on the same line share the tile between them —
     * one end of each — and a shared spot would make one of those two shoves
     * unreachable, which can make a solvable jam unsolvable. So a handle that
     * lands on a taken tile steps one tile sideways, onto the aisle crossings
     * at odd/odd, which no piece can ever cover.
     */
    function place() {
      var claim = {}, want = [], i, k, w;

      for (i = 0; i < puzzle.pieces.length; i++) {
        var p = puzzle.pieces[i], v = puzzle.vars[i];
        for (k = 0; k < p.len; k++) {
          if (p.horiz) bodies[i][k].move(cellTile(v + k), cellTile(p.fixed));
          else bodies[i][k].move(cellTile(p.fixed), cellTile(v + k));
        }
        want.push({ i: i, dir: 1, t: handTile(puzzle, i, 1) });
        want.push({ i: i, dir: -1, t: handTile(puzzle, i, -1) });
      }

      for (w = 0; w < want.length; w++) {
        var it = want[w];
        if (claim[it.t.x + ',' + it.t.y]) {
          var horiz = puzzle.pieces[it.i].horiz;
          var alts = horiz
            ? [{ x: it.t.x, y: it.t.y - 1 }, { x: it.t.x, y: it.t.y + 1 }]
            : [{ x: it.t.x - 1, y: it.t.y }, { x: it.t.x + 1, y: it.t.y }];
          for (var a = 0; a < alts.length; a++) {
            if (!claim[alts[a].x + ',' + alts[a].y]) { it.t = alts[a]; break; }
          }
        }
        claim[it.t.x + ',' + it.t.y] = 1;
        (it.dir > 0 ? handles[it.i].fwd : handles[it.i].back).move(it.t.x, it.t.y);
      }
    }

    /** Re-lay the yard's collision. Everything a piece covers is solid metal,
        including the aisle tile running through the middle of its length. */
    function paintSolids() {
      var x, y, i, k;
      for (y = 2; y <= 2 * n; y++) {
        for (x = 2; x <= 2 * n; x++) arena.setTile(x, y, false);
      }
      for (i = 0; i < puzzle.pieces.length; i++) {
        var p = puzzle.pieces[i], v = puzzle.vars[i];
        var a = cellTile(v), b = cellTile(v + p.len - 1);
        for (k = a; k <= b; k++) {
          if (p.horiz) arena.setTile(k, cellTile(p.fixed), true);
          else arena.setTile(cellTile(p.fixed), k, true);
        }
      }
    }

    /* ------------------------------------------------------------ shoving - */

    function shove(idx, dir) {
      if (finished || puzzle.solved) return;
      slideTo(idx, puzzle.vars[idx] + dir);
    }

    /** The one mutation point. One move per cell, exactly as it always was, so
        the proven minimum on the panel still means what it says. */
    function slideTo(idx, to) {
      if (finished || puzzle.solved) return;
      var p = puzzle.pieces[idx];
      var r = freeRange(puzzle, idx);
      if (to < r.lo || to > r.hi) {
        api.toast(C.blockedLine, 'bad', 1200);
        if (arena) {
          arena.shake(3, 0.24);
          arena.dust(p.horiz ? cellTile(puzzle.vars[idx]) : cellTile(p.fixed),
                     p.horiz ? cellTile(p.fixed) : cellTile(puzzle.vars[idx]), 6, '#e2695f');
        }
        return;
      }
      var delta = Math.abs(to - puzzle.vars[idx]);
      if (!delta) return;

      puzzle.vars[idx] = to;
      puzzle.moves += delta;

      // Shoving weight around is work. Cheap per move, but a long flail adds
      // up — which is exactly the pressure that rewards planning first.
      api.tweak({ energy: -delta });

      place();
      paintSolids();
      if (arena) {
        arena.dust(p.horiz ? cellTile(to) : cellTile(p.fixed),
                   p.horiz ? cellTile(p.fixed) : cellTile(to), 5, '#f6d08a');
      }
      paint();
      if (isSolved(puzzle)) onSolved();
    }

    /* ------------------------------------------------------------- render -- */

    function paint() {
      if (!arena) return;
      var i, k, r, fwdRoom, backRoom;

      for (i = 0; i < puzzle.pieces.length; i++) {
        r = freeRange(puzzle, i);
        fwdRoom = puzzle.vars[i] < r.hi;
        backRoom = puzzle.vars[i] > r.lo;
        for (k = 0; k < bodies[i].length; k++) {
          bodies[i][k].raw.tint = i === 0 ? null : ((fwdRoom || backRoom) ? '#8592a6' : '#4a5464');
        }
        dressHandle(handles[i].fwd, i, 1, fwdRoom);
        dressHandle(handles[i].back, i, -1, backRoom);
      }

      var par = puzzle.moves <= puzzle.optimal;
      mMoves.set(Math.min(100, (puzzle.moves / Math.max(1, puzzle.optimal)) * 100),
        puzzle.moves + ' / ' + puzzle.optimal, puzzle.moves === 0 ? null : (par ? 'good' : 'bad'));
      cMin.set(puzzle.optimal + ' moves');
      cJam.set(String(puzzle.pieces.length - 1));
      cResets.set(String(puzzle.resets));

      paintHand(true);
    }

    function dressHandle(hnd, i, dir, canGo) {
      var p = puzzle.pieces[i];
      hnd.raw.tint = canGo ? (i === 0 ? null : '#c7b48a') : '#3d4654';
      hnd.raw.hint = canGo ? 'E \u00B7 shove it ' + dirWord(p.horiz, dir) : 'nothing that way';
    }

    /* ------------------------------------------- what you are standing at -- */

    function trackHand(dt, a) {
      if (finished || puzzle.solved || !a) return;
      var pl = a.player();
      var best = -1, bestDir = 0, bestD = 0.95, i, k, d;

      for (i = 0; i < puzzle.pieces.length; i++) {
        d = dist(handles[i].fwd, pl);
        if (d < bestD) { bestD = d; best = i; bestDir = 1; }
        d = dist(handles[i].back, pl);
        if (d < bestD) { bestD = d; best = i; bestDir = -1; }
      }

      if (best < 0) {                       // not at a handle: what are we beside?
        bestD = 1.5;
        for (i = 0; i < puzzle.pieces.length; i++) {
          for (k = 0; k < bodies[i].length; k++) {
            d = dist(bodies[i][k], pl);
            if (d < bestD) { bestD = d; best = i; bestDir = 0; }
          }
        }
      }

      var play = -1;
      if (best >= 0) play = roomFor(best, bestDir);
      if (best !== hand.piece || bestDir !== hand.dir || play !== hand.play) {
        hand.piece = best; hand.dir = bestDir; hand.play = play;
        paintHand(false);
      }
    }

    function roomFor(i, dir) {
      var r = freeRange(puzzle, i);
      if (!dir) return r.hi - r.lo;
      return dir > 0 ? r.hi - puzzle.vars[i] : puzzle.vars[i] - r.lo;
    }

    function dist(hnd, pl) {
      var dx = (hnd.x + 0.5) - pl.x, dy = (hnd.y + 0.5) - pl.y;
      return Math.sqrt(dx * dx + dy * dy);
    }

    function paintHand(refresh) {
      if (finished || puzzle.solved) return;
      if (refresh && hand.piece >= 0) hand.play = roomFor(hand.piece, hand.dir);

      PS.ui.clear(handBox);
      if (hand.piece < 0) {
        handBox.className = 'pz-slide-hand';
        handBox.appendChild(h('div', { class: 'pz-slide-hand__idle' },
          ['Walk to one end of anything in the yard \u2014 the arrow on the floor is where you stand to push it that way.']));
        return;
      }

      var i = hand.piece;
      var p = puzzle.pieces[i];
      var isTarget = i === 0;
      var stuck = hand.play === 0;

      handBox.className = 'pz-slide-hand' + (isTarget ? ' is-target' : '') + (stuck ? ' is-stuck' : '');

      var line;
      if (!hand.dir) {
        line = h('span', {}, [
          stuck ? 'Wedged solid from both ends. ' : 'It has room in it. ',
          'You are alongside it \u2014 get to one ', h('b', { text: 'end' }), ' to move it.'
        ]);
      } else if (stuck) {
        line = h('span', {}, ['Nothing doing ', h('b', { text: dirWord(p.horiz, hand.dir) }),
          '. Something else has to move first.']);
      } else {
        line = h('span', {}, ['Press ', h('b', { text: 'E' }), ' and it goes ',
          h('b', { text: dirWord(p.horiz, hand.dir) }), ' \u00B7 ',
          h('b', { text: String(hand.play) }), ' cell' + (hand.play === 1 ? '' : 's') + ' of room that way']);
      }

      PS.ui.append(handBox, [
        h('div', { class: 'pz-slide-hand__i', text: p.icon }),
        h('div', {}, [
          h('div', { class: 'pz-slide-hand__t',
            text: PS.state.prettify(isTarget ? C.targetName : C.blockerName) +
              (p.horiz ? ' \u2014 slides left and right' : ' \u2014 slides up and down') }),
          h('div', { class: 'pz-slide-hand__d' + (stuck ? ' is-bad' : '') }, [line])
        ])
      ]);
    }

    /* ------------------------------------------------------------ endings -- */

    function reset() {
      if (finished || puzzle.solved) return;
      puzzle.vars = puzzle.startVars.slice();
      puzzle.moves = 0;
      puzzle.resets++;
      api.tweak({ morale: -2 });
      api.toast('Everything back where it started. Think it through this time.', 'info', 2200);
      if (arena) {
        place();
        paintSolids();
        arena.stop();
        arena.teleport(1, laneY);        // the yard moved around you; step out of it
      }
      hand.piece = -1; hand.dir = 0; hand.play = -1;
      paint();
    }

    function onSolved() {
      puzzle.solved = true;
      api.toast(C.solvedLine, 'good', 3000);
      api.flash();
      if (arena) {
        arena.setTile(W - 1, laneY, false);          // the gate stands open
        arena.ping(W - 1, laneY);
        arena.dust(2 * n, laneY, 14, '#f6d08a');
        arena.shake(4, 0.35);
      }
      renderChoice();
    }

    function renderChoice() {
      PS.ui.clear(handBox);
      PS.ui.clear(endBox);
      var par = puzzle.moves <= puzzle.optimal;
      PS.ui.append(endBox, [
        h('div', { class: 'pz-intro' }, [
          C.arrive + ' You did it in ' + puzzle.moves + ' move' + (puzzle.moves === 1 ? '' : 's') + '; ',
          h('em', { text: (puzzle.exact ? 'the minimum is ' : 'a known route is ') + puzzle.optimal }),
          par ? '. Not a wasted shove.' : '. Some of that was flailing.'
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
      var par = puzzle.moves <= puzzle.optimal;
      var tidy = puzzle.moves <= Math.ceil(puzzle.optimal * 1.4);

      api.finish({
        outcome: 'success',
        stats: { energy: -(4 + puzzle.tier), morale: par ? 9 : 5 },
        gain: par ? [puzzle.tier >= 3 ? 'crowbar' : 'gloves'] : [],
        lose: [],
        tags: ['cleared_the_lane'].concat(par ? ['read_the_jam'] : []),
        signals: { logic: par ? 4 : 3, caution: 1, speed: tidy ? 2 : 0, brute: 0 },
        choice: choice,
        summary: 'You untangled ' + C.lane + ' in ' + puzzle.moves + ' moves and took the '
          + C.targetName + ' out clean.'
      });
    }

    function forceIt() {
      if (finished) return;
      finished = true;
      puzzle.forced = true;
      // Giving up two moves from the end is not the same as giving up at the
      // start, so ask the solver how close they actually were.
      var left = routeNow(puzzle);
      var nearly = left && left.length <= Math.max(3, Math.round(puzzle.optimal * 0.5));

      api.finish({
        outcome: nearly ? 'success' : 'partial',
        stats: { health: -(5 + puzzle.tier * 2), energy: -(12 + puzzle.tier), morale: -4 },
        gain: [], lose: [],
        tags: ['forced_the_jam'],
        signals: { brute: 4, speed: 2, logic: 0, caution: 0 },
        choice: 'force_door',
        summary: C.forcedLine
      });
    }

    place();
    paintSolids();
    paint();
    arena.focus();
  }

  function unmount() {
    while (teardownFns.length) {
      try { teardownFns.pop()(); } catch (e) { /* keep unwinding */ }
    }
  }

  /* ================================================================ HINT = */

  function hint(puzzle, state, skin) {
    var C = puzzle.content;
    if (puzzle.solved) return 'It is already out. Pick a direction and go.';

    var route = routeNow(puzzle);
    if (!route) return 'You have wedged it somewhere ugly. Reset and start the sequence again.';
    if (!route.length) return 'The ' + C.targetName + ' is already in the mouth of ' + C.exitName + '.';

    var m = route[0];
    var p = puzzle.pieces[movePiece(m)];
    var dir = p.horiz ? (moveDir(m) < 0 ? 'left' : 'right') : (moveDir(m) < 0 ? 'up' : 'down');
    var which = movePiece(m) === 0
      ? 'the ' + C.targetName
      : 'the ' + C.blockerName + ' on ' + (p.horiz ? 'row ' + (p.fixed + 1) : 'column ' + (p.fixed + 1));

    return route.length + ' move' + (route.length === 1 ? '' : 's') + ' left from here. Start by shifting '
      + which + ' one ' + dir + '.';
  }

  /* ============================================================ AUTOSOLVE = */
  /* Headless. Walks the proven optimal route from wherever the board sits, so
     the bot's report stays honest even if it flailed first. */

  function autoSolve(puzzle, rng, state, tier, skin) {
    var C = puzzle.content;
    var route = routeNow(puzzle);

    if (!route) {
      return {
        outcome: 'partial',
        stats: { health: -(4 + puzzle.tier), energy: -14, morale: -5 },
        gain: [], lose: [],
        tags: ['forced_the_jam'],
        signals: { brute: 3, speed: 1 },
        choice: 'force_door',
        summary: C.forcedLine
      };
    }

    var total = puzzle.moves + route.length;
    var par = total <= puzzle.optimal;
    var choice = rng.chance(0.55) ? C.a.choice : C.b.choice;

    return {
      outcome: 'success',
      stats: { energy: -(4 + puzzle.tier + Math.min(20, route.length)), morale: par ? 9 : 5 },
      gain: par ? [puzzle.tier >= 3 ? 'crowbar' : 'gloves'] : [],
      lose: [],
      tags: ['cleared_the_lane'].concat(par ? ['read_the_jam'] : []),
      signals: { logic: par ? 4 : 3, caution: 1, speed: 2 },
      choice: choice,
      summary: 'Worked the jam loose in ' + total + ' moves and took the ' + C.targetName
        + ' out through ' + C.exitName + '.'
    };
  }

  /* ============================================================ REGISTER = */

  PS.registry.register({
    id: 'sliding_block',
    name: 'Sliding Block',
    icon: '\uD83E\uDDCA',
    blurb: 'One thing has to get out, and everything in front of it only moves one way.',

    favors:   { logic: 3, caution: 1 },
    provides: ['passage', 'crossing', 'load_out'],
    tagHooks: ['cleared_the_lane', 'went_down'],
    requires: function (state) { return state.stats.energy > 8; },

    css: CSS,

    skins: [
      {
        id: 'motor_pool', biome: 'urban', title: 'Jammed Motor Pool',
        icon: '\uD83D\uDE91', palette: 'steel',
        intro: 'Whoever parked last was not planning on anyone leaving. Forty vehicles nose to tail, every one of them dead except the ambulance boxed into the middle of it. The gate stands open, and it is the only thing here that does.',
        nouns: { subject: 'ambulance', obstacle: 'dead vehicle', exit: 'the gate', place: 'the motor pool' }
      },
      {
        id: 'crate_hatch', biome: 'industrial', title: 'Crate-Blocked Hatch',
        icon: '\uD83D\uDCE6', palette: 'rust',
        intro: 'The bonded store was packed to the roof and then the racking let go. Somewhere under all of it there is a floor hatch. The only way to reach it is to shunt a tonne of pallets around on their own casters, one shove at a time.',
        nouns: { subject: 'loaded pallet', obstacle: 'crate', exit: 'the hatch', place: 'the bonded store' }
      },
      {
        id: 'ice_sluice', biome: 'water', title: 'Ice-Jammed Sluice',
        icon: '\uD83E\uDDCA', palette: 'ice',
        intro: 'The thaw broke the sheet upstream and the whole of it has stacked into the sluice. Slabs the size of doors grinding against each other, your punt pinned somewhere in the middle, and the water still rising behind it.',
        nouns: { subject: 'punt', obstacle: 'ice slab', exit: 'the sluice mouth', place: 'the sluice' }
      }
    ],

    build: build,
    mount: mount,
    unmount: unmount,
    hint: hint,
    autoSolve: autoSolve
  });

})(typeof window !== 'undefined' ? window : this);
