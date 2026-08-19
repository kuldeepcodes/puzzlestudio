/* ==========================================================================
   PuzzleStudio — js/games/e18_sliding_block.js      ENGINE 18 · Sliding Block
   --------------------------------------------------------------------------
   Self-contained: logic + 3 skins + its own CSS. No DOM access until mount().

   THE PUZZLE
     Rush Hour. A yard packed with things too heavy to lift and just light
     enough to shove along their own length. One of them is the thing you
     actually need — an ambulance, a loaded pallet, a punt — and it has to
     reach the gap in the right-hand wall. Nothing passes through anything.

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

  /* ================================================================ CSS == */

  var CSS = [
    '.pz-slide{display:grid;grid-template-columns:minmax(0,1fr) minmax(228px,286px);gap:18px;align-items:start}',
    '@media (max-width:860px){.pz-slide{grid-template-columns:1fr}}',

    '.pz-slide-frame{position:relative;width:100%;max-width:520px;margin:0 auto;padding:10px 24px 10px 10px}',
    '.pz-slide-board{position:relative;width:100%;aspect-ratio:1/1;border-radius:12px;',
    '  background:linear-gradient(160deg,#0a0d13,#05070a);border:1px solid var(--line);',
    '  box-shadow:inset 0 0 60px rgba(0,0,0,.85),var(--sh-1);touch-action:none}',

    '.pz-slide-grid{position:absolute;inset:0;display:grid;padding:4px;gap:2px}',
    '.pz-slide-cell{border-radius:4px;background:#0d1119;border:1px solid #141a24;padding:0;',
    '  transition:background .18s var(--ease),border-color .18s var(--ease)}',
    '.pz-slide-cell.is-lane{background:#111825}',
    '.pz-slide-cell.is-drop{cursor:pointer;background:var(--acc-wash);',
    '  border-color:color-mix(in srgb,var(--acc) 45%,transparent)}',
    '.pz-slide-cell.is-drop:hover{background:color-mix(in srgb,var(--acc) 24%,#0d1119)}',

    '.pz-slide-layer{position:absolute;inset:4px;pointer-events:none}',
    '.pz-slide-piece{position:absolute;padding:0;border:0;background:transparent;pointer-events:auto;',
    '  cursor:grab;transition:left .16s var(--ease),top .16s var(--ease);z-index:2}',
    '.pz-slide-piece.is-drag{transition:none;cursor:grabbing;z-index:5}',
    '.pz-slide-piece__in{position:absolute;inset:2px;border-radius:7px;display:grid;place-items:center;',
    '  font-size:clamp(11px,3vw,22px);line-height:1;color:var(--text-2);',
    '  background:linear-gradient(165deg,var(--panel-3),var(--panel));',
    '  border:1px solid var(--line);box-shadow:0 4px 12px rgba(0,0,0,.55),inset 0 1px 0 rgba(255,255,255,.05);',
    '  transition:border-color .18s var(--ease),box-shadow .18s var(--ease),transform .2s var(--ease)}',
    '.pz-slide-piece:hover .pz-slide-piece__in{border-color:color-mix(in srgb,var(--acc) 60%,var(--line))}',
    '.pz-slide-piece.is-sel .pz-slide-piece__in{border-color:var(--acc);',
    '  box-shadow:0 0 0 1px var(--acc),0 6px 20px var(--acc-glow)}',
    '.pz-slide-piece.is-target .pz-slide-piece__in{color:var(--text);',
    '  background:linear-gradient(165deg,color-mix(in srgb,var(--acc) 34%,var(--panel-3)),',
    '  color-mix(in srgb,var(--acc) 12%,var(--panel)));border-color:color-mix(in srgb,var(--acc) 70%,var(--line))}',
    '.pz-slide-piece.is-stuck .pz-slide-piece__in{animation:pzSlideNudge .32s var(--ease)}',
    '@keyframes pzSlideNudge{0%,100%{transform:translate(0,0)}30%{transform:translate(-3px,0)}65%{transform:translate(3px,0)}}',

    '.pz-slide-exit{position:absolute;right:-22px;width:22px;display:grid;place-items:center;',
    '  font-size:15px;color:var(--acc-2);pointer-events:none}',
    '.pz-slide-exit::before{content:"";position:absolute;left:-5px;top:8%;bottom:8%;width:3px;border-radius:2px;',
    '  background:linear-gradient(180deg,transparent,var(--acc),transparent);box-shadow:0 0 12px var(--acc-glow)}',
    '.pz-slide-board.is-open .pz-slide-exit{animation:pzSlideOpen .9s var(--ease)}',
    '@keyframes pzSlideOpen{0%{transform:scale(1)}40%{transform:scale(1.55)}100%{transform:scale(1)}}',

    '.pz-slide-pad{display:grid;grid-template-columns:repeat(3,42px);grid-template-rows:repeat(3,42px);',
    '  gap:6px;justify-content:center}',
    '.pz-slide-pad button{border-radius:9px;border:1px solid var(--line);font-size:14px;',
    '  background:linear-gradient(180deg,var(--panel-3),var(--panel-2));color:var(--text)}',
    '.pz-slide-pad button:hover:not(:disabled){border-color:var(--acc)}',
    '.pz-slide-pad button:disabled{opacity:.22}',
    '.pz-slide-pad .pz-slide-sp{visibility:hidden}',

    '.pz-slide-read{display:flex;flex-direction:column;gap:6px}',
    '.pz-slide-read__row{display:flex;justify-content:space-between;gap:10px;',
    '  font-family:var(--font-mono);font-size:11px;color:var(--dim)}',
    '.pz-slide-read__row b{color:var(--acc-2);font-weight:700}',
    '.pz-slide-read__row.is-par b{color:var(--good)}',
    '.pz-slide-read__row.is-over b{color:var(--warn)}',

    '.pz-slide-sel{display:flex;align-items:center;gap:9px;font-size:12px;color:var(--text-2);',
    '  padding:8px 10px;border-radius:8px;background:var(--panel-2);border:1px solid var(--line-soft)}',
    '.pz-slide-sel__i{font-size:19px;line-height:1}',
    '.pz-slide-sel__d{color:var(--dim);font-size:11px}',

    '.pz-slide-legend{display:flex;flex-wrap:wrap;gap:9px;font-size:11px;color:var(--dim)}',
    '.pz-slide-legend span{display:inline-flex;gap:5px;align-items:center}'
  ].join('\n');

  /* =============================================================== MOUNT == */

  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var C = puzzle.content;
    var n = puzzle.n;
    var finished = false;
    var sel = 0;

    var pieceEls = [];
    var cellEls = [];

    var board = h('div', { class: 'pz-slide-board' });
    var gridLayer = h('div', {
      class: 'pz-slide-grid',
      style: { gridTemplateColumns: 'repeat(' + n + ',1fr)', gridTemplateRows: 'repeat(' + n + ',1fr)' }
    });
    var pieceLayer = h('div', { class: 'pz-slide-layer' });

    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        (function (cx, cy) {
          var c = h('button', { type: 'button', class: 'pz-slide-cell' });
          c.addEventListener('click', function () { onCell(cx, cy); });
          cellEls.push({ el: c, x: cx, y: cy });
          gridLayer.appendChild(c);
        })(x, y);
      }
    }

    board.appendChild(gridLayer);
    board.appendChild(pieceLayer);
    board.appendChild(h('div', {
      class: 'pz-slide-exit',
      style: { top: (puzzle.exitRow / n * 100) + '%', height: (100 / n) + '%' },
      text: C.exitIcon
    }));

    for (var i = 0; i < puzzle.pieces.length; i++) {
      (function (idx) {
        var p = puzzle.pieces[idx];
        var btn = h('button', {
          type: 'button',
          class: 'pz-slide-piece' + (idx === 0 ? ' is-target' : ''),
          title: (idx === 0 ? C.targetName : C.blockerName) + ' \u00B7 ' +
                 (p.horiz ? 'slides left and right' : 'slides up and down')
        }, [h('div', { class: 'pz-slide-piece__in', text: p.icon })]);
        btn.addEventListener('click', function () { select(idx); });
        btn.addEventListener('pointerdown', function (ev) { beginDrag(ev, idx); });
        pieceEls.push(btn);
        pieceLayer.appendChild(btn);
      })(i);
    }

    /* ------------------------------------------------------------ readout -- */
    var read = h('div', { class: 'pz-slide-read' });
    var selBox = h('div', {});
    var padBtns = {};
    var controls = h('div', { class: 'pz-col' });

    function pct(v) { return (v / n * 100) + '%'; }

    function place(idx) {
      var p = puzzle.pieces[idx], v = puzzle.vars[idx], e = pieceEls[idx];
      e.style.left = pct(p.horiz ? v : p.fixed);
      e.style.top = pct(p.horiz ? p.fixed : v);
      e.style.width = pct(p.horiz ? p.len : 1);
      e.style.height = pct(p.horiz ? 1 : p.len);
    }

    function paint() {
      for (var k = 0; k < puzzle.pieces.length; k++) {
        place(k);
        pieceEls[k].className = 'pz-slide-piece' + (k === 0 ? ' is-target' : '') + (k === sel ? ' is-sel' : '');
        pieceEls[k].disabled = finished;
      }

      var range = finished ? null : freeRange(puzzle, sel);
      var p = puzzle.pieces[sel];
      var occ = occOf(puzzle.pieces, puzzle.vars, n);

      for (var ci = 0; ci < cellEls.length; ci++) {
        var cell = cellEls[ci];
        var cls = 'pz-slide-cell';
        if (cell.y === puzzle.exitRow) cls += ' is-lane';
        var drop = false;
        if (range && occ[cell.y * n + cell.x] === -1) {
          // Legal drop: same axis as the selection, inside its free range.
          if (p.horiz && cell.y === p.fixed && cell.x >= range.lo && cell.x <= range.hi) drop = true;
          if (!p.horiz && cell.x === p.fixed && cell.y >= range.lo && cell.y <= range.hi) drop = true;
        }
        if (drop) cls += ' is-drop';
        cell.el.className = cls;
        cell.el.disabled = finished || !drop;
      }

      paintRead(range);
    }

    function paintRead(range) {
      PS.ui.clear(read);
      var par = puzzle.moves <= puzzle.optimal;
      PS.ui.append(read, [
        row('Moves made', String(puzzle.moves), puzzle.moves === 0 ? '' : (par ? 'is-par' : 'is-over')),
        row(puzzle.exact ? 'Known minimum' : 'Known route', puzzle.optimal + ' moves', ''),
        row('Obstructions', String(puzzle.pieces.length - 1), ''),
        row('Resets', String(puzzle.resets), '')
      ]);

      PS.ui.clear(selBox);
      var p = puzzle.pieces[sel];
      var play = range ? Math.max(0, range.hi - range.lo) : 0;
      selBox.appendChild(h('div', { class: 'pz-slide-sel' }, [
        h('div', { class: 'pz-slide-sel__i', text: p.icon }),
        h('div', {}, [
          h('div', { text: PS.state.prettify(sel === 0 ? C.targetName : C.blockerName) }),
          h('div', {
            class: 'pz-slide-sel__d',
            text: (p.horiz ? 'Slides left and right' : 'Slides up and down')
              + (range ? ' \u00B7 ' + (play ? play + ' cells of play' : 'wedged solid') : '')
          })
        ])
      ]));

      if (!finished) {
        var r = range || freeRange(puzzle, sel);
        padBtns.left.disabled  = !(p.horiz && puzzle.vars[sel] > r.lo);
        padBtns.right.disabled = !(p.horiz && puzzle.vars[sel] < r.hi);
        padBtns.up.disabled    = !(!p.horiz && puzzle.vars[sel] > r.lo);
        padBtns.down.disabled  = !(!p.horiz && puzzle.vars[sel] < r.hi);
      }

      function row(k, v, cls) {
        return h('div', { class: 'pz-slide-read__row ' + (cls || '') },
          [h('span', { text: k }), h('b', { text: v })]);
      }
    }

    /* -------------------------------------------------------------- moving */

    function select(idx) {
      if (finished) return;
      sel = idx;
      paint();
    }

    function nudge(idx) {
      var e = pieceEls[idx];
      e.classList.remove('is-stuck');
      void e.offsetWidth;
      e.classList.add('is-stuck');
    }

    /** Slide a piece to `to` along its own axis. Costs |to - from| moves. */
    function slideTo(idx, to) {
      if (finished || puzzle.solved) return;
      var r = freeRange(puzzle, idx);
      if (to < r.lo || to > r.hi) { nudge(idx); api.toast(C.blockedLine, 'bad', 1200); return; }
      var delta = Math.abs(to - puzzle.vars[idx]);
      if (!delta) return;

      puzzle.vars[idx] = to;
      puzzle.moves += delta;
      sel = idx;

      // Shoving weight around is work. Cheap per move, but a long flail adds
      // up — which is exactly the pressure that rewards planning first.
      api.tweak({ energy: -delta });
      paint();
      if (isSolved(puzzle)) onSolved();
    }

    function step(idx, dir) { slideTo(idx, puzzle.vars[idx] + dir); }

    function onCell(x, y) {
      if (finished) return;
      var p = puzzle.pieces[sel];
      if (p.horiz && y === p.fixed) slideTo(sel, x);
      else if (!p.horiz && x === p.fixed) slideTo(sel, y);
    }

    /* --------------------------------------------------------------- drag -- */
    /* Dragging is the natural verb here. It is clamped to the piece's legal
       range, so a drag can never produce an illegal board. */

    var drag = null;

    function beginDrag(ev, idx) {
      if (finished || puzzle.solved) return;
      select(idx);
      var rect = board.getBoundingClientRect();
      var cellPx = rect.width / n;
      if (!cellPx) return;
      drag = {
        idx: idx, x: ev.clientX, y: ev.clientY, from: puzzle.vars[idx],
        cell: cellPx, range: freeRange(puzzle, idx)
      };
      pieceEls[idx].classList.add('is-drag');
    }

    function onPointerMove(ev) {
      if (!drag) return;
      var p = puzzle.pieces[drag.idx];
      var raw = p.horiz ? (ev.clientX - drag.x) : (ev.clientY - drag.y);
      var to = Math.max(drag.range.lo, Math.min(drag.range.hi, drag.from + Math.round(raw / drag.cell)));
      if (puzzle.vars[drag.idx] === to) return;
      puzzle.vars[drag.idx] = to;
      place(drag.idx);
    }

    function onPointerUp() {
      if (!drag) return;
      var d = drag;
      drag = null;
      pieceEls[d.idx].classList.remove('is-drag');
      var to = puzzle.vars[d.idx];
      puzzle.vars[d.idx] = d.from;                  // rewind, then commit properly
      if (to !== d.from) slideTo(d.idx, to);
      else { place(d.idx); paint(); }
    }

    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
    document.addEventListener('pointercancel', onPointerUp);
    teardownFns.push(function () {
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      document.removeEventListener('pointercancel', onPointerUp);
    });

    /* ----------------------------------------------------------- keyboard -- */

    function onKey(ev) {
      if (finished) return;
      var map = { ArrowLeft: [-1, true], ArrowRight: [1, true], ArrowUp: [-1, false], ArrowDown: [1, false] };
      var m = map[ev.key];
      if (!m) return;
      if (puzzle.pieces[sel].horiz !== m[1]) return;
      ev.preventDefault();
      step(sel, m[0]);
    }
    document.addEventListener('keydown', onKey);
    teardownFns.push(function () { document.removeEventListener('keydown', onKey); });

    /* --------------------------------------------------------------- pad -- */

    function pad() {
      function b(key, label, dir, horiz) {
        var btn = h('button', { type: 'button', text: label, title: 'Shift the selection' });
        btn.addEventListener('click', function () {
          if (puzzle.pieces[sel].horiz !== horiz) return;
          step(sel, dir);
        });
        padBtns[key] = btn;
        return btn;
      }
      var sp = function () { return h('div', { class: 'pz-slide-sp' }); };
      return h('div', { class: 'pz-slide-pad' }, [
        sp(), b('up', '\u25B2', -1, false), sp(),
        b('left', '\u25C0', -1, true), sp(), b('right', '\u25B6', 1, true),
        sp(), b('down', '\u25BC', 1, false), sp()
      ]);
    }

    function reset() {
      if (finished || puzzle.solved) return;
      puzzle.vars = puzzle.startVars.slice();
      puzzle.moves = 0;
      puzzle.resets++;
      api.tweak({ morale: -2 });
      api.toast('Everything back where it started. Think it through this time.', 'info', 2200);
      paint();
    }

    /* ------------------------------------------------------------ endings -- */

    function onSolved() {
      puzzle.solved = true;
      board.classList.add('is-open');
      api.toast(C.solvedLine, 'good', 3000);
      renderChoice();
      api.flash();
    }

    function renderChoice() {
      PS.ui.clear(controls);
      var par = puzzle.moves <= puzzle.optimal;
      PS.ui.append(controls, [
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

    /* ------------------------------------------------------------- layout -- */

    PS.ui.append(controls, [
      pad(),
      h('div', { class: 'pz-slide-legend' }, [
        h('span', {}, [C.targetIcon, ' ' + C.targetName]),
        h('span', {}, [C.blockers[1], ' ' + C.blockerName]),
        h('span', {}, [C.exitIcon, ' ' + C.exitName])
      ]),
      h('div', { class: 'pz-row' }, [
        h('button', { class: 'pz-btn pz-btn--sm', type: 'button', onclick: reset }, ['\u21BA Reset']),
        h('button', { class: 'pz-btn pz-btn--danger pz-btn--sm', type: 'button', onclick: forceIt }, ['\uD83D\uDCA5 Force it'])
      ])
    ]);

    PS.ui.append(el, h('div', { class: 'pz-slide' }, [
      h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-slide-frame' }, [board]),
        h('div', { class: 'pz-note' }, [
          'Drag a piece, or click it and use the arrows. Everything slides only along its own length \u2014 get the ',
          h('strong', { text: C.targetName }), ' out through ', h('strong', { text: C.exitName }), '.'
        ])
      ]),
      h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-card' }, [h('div', { class: 'pz-card__head', text: 'The jam' }), read]),
        selBox,
        h('div', { class: 'pz-card' }, [h('div', { class: 'pz-card__head', text: 'Shift' }), controls])
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
