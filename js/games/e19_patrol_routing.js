/* ==========================================================================
   PuzzleStudio — js/games/e19_patrol_routing.js    ENGINE 19 · Patrol Routing
   --------------------------------------------------------------------------
   Self-contained: logic + 3 skins + its own CSS. No DOM access until mount().

   THE PUZZLE
     Stealth in real time, but not a reflex test. Nothing here is hidden and
     nothing here is random. Every watchman walks a fixed loop, every lamp
     sweeps a fixed lane, and all of it is drawn in front of you — cones and
     all — before you take a step. You cross the yard on your own two feet,
     so the puzzle is not "can you react", it is "can you read the cycles and
     move into the gap they leave". Standing still and watching is a move.

   GENERATION — SOLVED IN (PLACE, TIME), NOT IN PLACE
     A route that is safe cell-by-cell can still be a death trap, because the
     danger moves. So this engine never reasons about the grid alone: it
     reasons about (x, y, tick mod period). That proof is what makes the yard
     crossable, and the yard is tuned around it: you top out at five tiles a
     second and the fastest thing watching you does 2.6, so the route the
     solver proves exists is comfortably walkable with time to spare.

       1. Every patrol's cycle length is drawn from {4,6,8,12}, so the least
          common multiple — the tick at which the entire yard repeats — is
          never worse than 24. The whole world therefore has at most
          width x height x 24 distinct situations.
       2. watchedAt[phase] is precomputed once per phase: every cell any patrol
          can see at that point in the loop.
       3. BFS over (x, y, phase) with five actions (four steps and wait) finds
          the shortest genuinely safe route, or proves there is none.
       4. No route? Re-roll the patrol phase offsets and search again. Still
          none? Drop a patrol and search again. Since the board is checked for
          wall connectivity first, that ladder always terminates in a solvable
          puzzle — and the search is small enough to run the whole ladder in
          about a millisecond.

     The BFS also hands back the shortest safe route, which is what the panel
     quotes, what hint() reads, and what autoSolve() walks.

   FAILURE IS EXPENSIVE, NOT FINAL
     Being seen costs blood and composure and nothing else. You can walk
     straight across in front of everyone if you are willing to pay for it,
     and that is a real option rather than a mistake.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio;
  if (!PS || !PS.registry) { if (root.console) console.error('[e19] core not loaded'); return; }

  /* ======================================================== SKIN CONTENT == */

  var CONTENT = {
    night_watch: {
      walkIcon: '\uD83D\uDC6E', walkName: 'watchman', walkPlural: 'watchmen',
      beamIcon: '\uD83D\uDD26', beamName: 'torch sweep', beamPlural: 'torch sweeps',
      playerIcon: '\uD83E\uDDCD', exitIcon: '\uD83D\uDEAA', wallIcon: '\uD83E\uDDF1',
      exitName: 'the side door', place: 'the courtyard',
      spotted: 'A torch swings onto you and somebody starts shouting.',
      clean: 'You reach the door and nobody ever knew you were in the yard.',
      messy: 'You get to the door, but they have your description now.',
      brokeCover: 'You give up on quiet and run it in the open.',
      arrive: 'The door is unlocked. Behind you the yard carries on exactly as it was.',
      a: { icon: '\uD83E\uDD2B', title: 'Slip out the way you came', desc: 'Nobody knows you were here. Keep it that way and take the long road.', choice: 'pick_lock' },
      b: { icon: '\uD83D\uDCE3', title: 'Wake the block on the way', desc: 'Hammer every door as you go. Cruel, loud, and it gets people moving.', choice: 'signal' }
    },
    searchlight_yard: {
      walkIcon: '\uD83D\uDC77', walkName: 'yard hand', walkPlural: 'yard hands',
      beamIcon: '\uD83D\uDD26', beamName: 'searchlight', beamPlural: 'searchlights',
      playerIcon: '\uD83E\uDDCD', exitIcon: '\uD83D\uDEAA', wallIcon: '\uD83D\uDEE2\uFE0F',
      exitName: 'the loading gate', place: 'the yard',
      spotted: 'The light pins you against the drums and holds there.',
      clean: 'You make the gate between two sweeps and the yard never breaks rhythm.',
      messy: 'You make the gate, but the light found you twice on the way.',
      brokeCover: 'You stop counting the sweeps and just run at the gate.',
      arrive: 'The gate is chained but the chain is long enough. Sodium light, and rain starting.',
      a: { icon: '\uD83E\uDDF0', title: 'Break into the store first', desc: 'You know the light pattern now. That buys enough time for one door.', choice: 'scavenge' },
      b: { icon: '\uD83D\uDCA8', title: 'Straight out and keep going', desc: 'You have the gate and a head start. Do not spend either.', choice: 'sprint' }
    },
    predator_range: {
      walkIcon: '\uD83D\uDC3A', walkName: 'wolf', walkPlural: 'wolves',
      beamIcon: '\uD83C\uDF15', beamName: 'moonlit lane', beamPlural: 'moonlit lanes',
      playerIcon: '\uD83E\uDDCD', exitIcon: '\uD83E\uDEA8', wallIcon: '\uD83E\uDEA8',
      exitName: 'the rock shelf', place: 'the open range',
      spotted: 'Something breaks into a run behind you and does not stop.',
      clean: 'You reach the shelf in cloud shadow and nothing on the range ever turns its head.',
      messy: 'You reach the shelf, bleeding, and something is still out there watching.',
      brokeCover: 'You stop reading the ground and simply run for the rock.',
      arrive: 'Stone under your hands at last. Below you the grass moves, and keeps moving.',
      a: { icon: '\u26F0\uFE0F', title: 'Climb while the cloud holds', desc: 'Height is the only thing out here that anything respects.', choice: 'climb' },
      b: { icon: '\uD83D\uDD25', title: 'Build a fire on the shelf', desc: 'Warm, visible for miles, and nothing with four legs will come near it.', choice: 'shelter' }
    }
  };

  /* Cycle lengths are drawn from this set only, so lcm(all of them) <= 24 and
     the (place, time) search space stays tiny no matter how many patrols. */
  var CYCLES = [4, 6, 8, 12];
  var MAX_PERIOD = 24;

  var TIERS = {
    1: { n: 6, patrols: 2, walls: 2, slack: 1 },
    2: { n: 6, patrols: 3, walls: 3, slack: 2 },
    3: { n: 7, patrols: 4, walls: 4, slack: 2 },
    4: { n: 7, patrols: 5, walls: 5, slack: 3 },
    5: { n: 8, patrols: 6, walls: 6, slack: 3 },
    6: { n: 8, patrols: 7, walls: 7, slack: 4 }
  };

  var GEN_MS = 40;      // hard wall-clock ceiling on the whole generation ladder

  /* ============================================================== HELPERS = */

  function gcd(a, b) { while (b) { var t = a % b; a = b; b = t; } return a; }
  function lcm(a, b) { return a / gcd(a, b) * b; }
  function idx(x, y, n) { return y * n + x; }
  function label(x, y) { return String.fromCharCode(65 + x) + (y + 1); }

  var STEPS = [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]];   // wait, N, E, S, W

  /* ============================================================ GENERATION */

  /** Walls, start and exit, guaranteed connected ignoring patrols. */
  function terrain(n, wallCount, rng) {
    var walls = [], i;
    for (i = 0; i < n * n; i++) walls.push(false);

    var start = [0, rng.int(0, n - 1)];
    var exit  = [n - 1, rng.int(0, n - 1)];

    for (var guard = 0; guard < 24; guard++) {
      for (i = 0; i < n * n; i++) walls[i] = false;
      var placed = 0, tries = 0;
      while (placed < wallCount && tries < 80) {
        tries++;
        var wx = rng.int(1, n - 2), wy = rng.int(0, n - 1);
        var k = idx(wx, wy, n);
        if (walls[k]) continue;
        if (wx === start[0] && wy === start[1]) continue;
        if (wx === exit[0] && wy === exit[1]) continue;
        walls[k] = true;
        placed++;
      }
      if (reachable(walls, n, start, exit)) return { walls: walls, start: start, exit: exit };
    }
    // Pathological: no walls at all is always connected.
    for (i = 0; i < n * n; i++) walls[i] = false;
    return { walls: walls, start: start, exit: exit };
  }

  /** Plain flood fill, patrols ignored — only asks whether the ground allows it. */
  function reachable(walls, n, start, exit) {
    var seen = {}, q = [start], head = 0;
    seen[idx(start[0], start[1], n)] = 1;
    while (head < q.length) {
      var c = q[head++];
      if (c[0] === exit[0] && c[1] === exit[1]) return true;
      for (var i = 1; i < STEPS.length; i++) {
        var nx = c[0] + STEPS[i][0], ny = c[1] + STEPS[i][1];
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        var k = idx(nx, ny, n);
        if (walls[k] || seen[k]) continue;
        seen[k] = 1;
        q.push([nx, ny]);
      }
    }
    return false;
  }

  /**
   * One patrol. A walker paces a corridor and turns round at each end; a beam
   * sweeps a band of columns or rows and sweeps back. Both are pure functions
   * of the tick, which is the whole point.
   *
   * The cycle length is chosen from CYCLES and then HONOURED EXACTLY — a
   * corridor is only accepted if it fits the board at full length. Clamping a
   * route to fit would silently produce a cycle outside the set, the least
   * common multiple would stop being 24, and the precomputed danger table
   * would drift out of step with the patrols it describes.
   */
  function makePatrol(n, walls, rng, wantBeam) {
    var usable = [], i;
    for (i = 0; i < CYCLES.length; i++) if (CYCLES[i] / 2 <= n - 1) usable.push(CYCLES[i]);
    if (!usable.length) return null;

    if (wantBeam) {
      var cycle = rng.pick(usable);
      var span = cycle / 2;
      var vertical = rng.chance(0.6);
      var from = rng.int(0, n - 1 - span);
      var line = [];
      for (i = 0; i <= span; i++) line.push(from + i);
      for (i = span - 1; i >= 1; i--) line.push(from + i);
      return {
        kind: 'beam', vertical: vertical, line: line,
        len: line.length, offset: rng.int(0, line.length - 1)
      };
    }

    // Walker: the corridor must be clear at full length or the cycle changes.
    for (var attempt = 0; attempt < 30; attempt++) {
      var c2 = rng.pick(usable);
      var run = c2 / 2;
      var horiz = rng.chance(0.5);
      var sx = horiz ? rng.int(0, n - 1 - run) : rng.int(0, n - 1);
      var sy = horiz ? rng.int(0, n - 1) : rng.int(0, n - 1 - run);
      var path = [], ok = true, j;
      for (j = 0; j <= run; j++) {
        var px = horiz ? sx + j : sx;
        var py = horiz ? sy : sy + j;
        if (walls[idx(px, py, n)]) { ok = false; break; }
        path.push([px, py]);
      }
      if (!ok) continue;
      var route = path.slice();
      for (j = path.length - 2; j >= 1; j--) route.push(path[j]);
      return { kind: 'walk', route: route, len: route.length, offset: rng.int(0, route.length - 1) };
    }
    return null;
  }

  /** Copy the mutable part of a patrol set so a saved candidate cannot be
      corrupted when the generator re-phases the live one. Routes are never
      mutated, so sharing those arrays is safe. */
  function snapshot(list) {
    var out = [], i;
    for (i = 0; i < list.length; i++) {
      var p = list[i];
      out.push({
        kind: p.kind, route: p.route, line: p.line, vertical: p.vertical,
        len: p.len, offset: p.offset
      });
    }
    return out;
  }

  /** Where a patrol is, and what it can see, at a given tick. */
  function patrolAt(p, tick) {
    var i = (tick + p.offset) % p.len;
    return p.kind === 'walk' ? p.route[i] : p.line[i];
  }

  /**
   * watchedAt[phase][cell] — every cell anything can see at that phase.
   * A walker covers its own cell and the four beside it: a plus, not a block.
   * Nine-cell vision seals a small yard shut far too often, and a plus also
   * reads better on the board — you can slip past a shoulder, not through a
   * face. A beam lights a whole column or row, which is brutal but completely
   * predictable, which is the trade.
   */
  function buildWatched(patrols, n, period) {
    var out = [], phase, i, j;
    for (phase = 0; phase < period; phase++) {
      var w = [];
      for (i = 0; i < n * n; i++) w.push(false);
      for (i = 0; i < patrols.length; i++) {
        var p = patrols[i];
        if (p.kind === 'walk') {
          var pos = patrolAt(p, phase);
          for (j = 0; j < STEPS.length; j++) {
            var x = pos[0] + STEPS[j][0], y = pos[1] + STEPS[j][1];
            if (x < 0 || y < 0 || x >= n || y >= n) continue;
            w[idx(x, y, n)] = true;
          }
        } else {
          var at = patrolAt(p, phase);
          for (var q = 0; q < n; q++) {
            w[p.vertical ? idx(at, q, n) : idx(q, at, n)] = true;
          }
        }
      }
      out.push(w);
    }
    return out;
  }

  /**
   * Shortest safe route through (x, y, phase) space. Five actions per tick,
   * and a cell is only enterable if nothing is watching it on the tick you
   * arrive. Returns { len, path } or null if the yard is genuinely sealed.
   */
  function solveRoute(walls, watched, n, period, from, tick, exit) {
    var startPhase = ((tick % period) + period) % period;
    var total = n * n * period;
    var dist = new Array(total), prev = new Array(total), i;
    for (i = 0; i < total; i++) { dist[i] = -1; prev[i] = -1; }

    var s = idx(from[0], from[1], n) * period + startPhase;
    dist[s] = 0;
    var q = [s], head = 0, goal = -1;

    while (head < q.length) {
      var cur = q[head++];
      var phase = cur % period;
      var cell = (cur - phase) / period;
      var cx = cell % n, cy = (cell - cx) / n;
      if (cx === exit[0] && cy === exit[1]) { goal = cur; break; }

      var np = (phase + 1) % period;
      for (i = 0; i < STEPS.length; i++) {
        var nx = cx + STEPS[i][0], ny = cy + STEPS[i][1];
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        var nk = idx(nx, ny, n);
        if (walls[nk]) continue;
        if (watched[np][nk]) continue;                 // seen on arrival
        var ns = nk * period + np;
        if (dist[ns] >= 0) continue;
        dist[ns] = dist[cur] + 1;
        prev[ns] = cur;
        q.push(ns);
      }
    }

    if (goal < 0) return null;

    var path = [], node = goal;
    while (node >= 0) {
      var ph = node % period;
      var cl = (node - ph) / period;
      var ax = cl % n;
      path.unshift([ax, (cl - ax) / n]);
      node = prev[node];
    }
    return { len: dist[goal], path: path };
  }

  /* =============================================================== BUILD == */

  function build(state, rng, tier, skin) {
    var C = CONTENT[skin.id] || CONTENT.night_watch;
    var t = Math.min(6, tier);                 // the run is infinite; the curve is not
    var cfg = TIERS[t];
    var n = cfg.n;
    var deadline = Date.now() + GEN_MS;

    var ground = terrain(n, cfg.walls, rng);
    var manhattan = Math.abs(ground.exit[0] - ground.start[0]) + Math.abs(ground.exit[1] - ground.start[1]);

    // Build the full patrol set, then relax it until a safe route exists.
    // Beams light a whole column or row, so a yard full of them is a wall
    // rather than a puzzle — they stay a minority of the watch.
    var patrols = [];
    for (var i = 0; i < cfg.patrols; i++) {
      var p = makePatrol(n, ground.walls, rng, i % 4 === 3);
      if (p) patrols.push(p);
    }

    var period, watched, sol = null, best = null;
    var target = manhattan + Math.min(cfg.slack, 4);
    var sinceDrop = 0, i2;

    /* The ladder: re-phase, then thin out, then give up gracefully. Each rung
       is a fresh BFS over at most n*n*24 states, so the whole ladder costs
       well under a millisecond in the normal case.

       Candidates are SCORED rather than simply overwritten. A thinned-out yard
       will nearly always yield a route, so taking the last success would quietly
       throw away the good crowded board found three rungs earlier. */
    for (var rung = 0; rung < 48; rung++) {
      if (Date.now() > deadline) break;

      period = 1;
      for (i2 = 0; i2 < patrols.length; i2++) period = lcm(period, patrols[i2].len);
      // CYCLES makes this unreachable; if it ever fires, thin out rather than
      // truncate the period, which would desynchronise the danger table.
      while (period > MAX_PERIOD && patrols.length) {
        patrols = patrols.slice(0, patrols.length - 1);
        period = 1;
        for (i2 = 0; i2 < patrols.length; i2++) period = lcm(period, patrols[i2].len);
      }

      watched = buildWatched(patrols, n, period);

      // Never open the scene with the player already lit up.
      if (!watched[0][idx(ground.start[0], ground.start[1], n)]) {
        sol = solveRoute(ground.walls, watched, n, period, ground.start, 0, ground.exit);
        if (sol) {
          // Prefer a busy yard, prefer a route that forces some waiting, and
          // do not reward a slog that is merely long.
          var score = patrols.length * 20
            + (sol.len >= target ? 200 : sol.len * 6)
            - Math.max(0, sol.len - (target + 10)) * 4;
          if (!best || score > best.score) {
            best = { patrols: snapshot(patrols), period: period, watched: watched, sol: sol, score: score };
          }
          if (sol.len >= target && patrols.length >= cfg.patrols) break;
        }
      }

      sinceDrop++;
      if (sinceDrop >= 8 && patrols.length > 0) {
        patrols = patrols.slice(0, patrols.length - 1);   // thin the yard out
        sinceDrop = 0;
      } else {
        for (i2 = 0; i2 < patrols.length; i2++) {         // re-phase and try again
          patrols[i2].offset = rng.int(0, patrols[i2].len - 1);
        }
      }
    }

    // Guaranteed floor: an empty yard is always crossable, so this always works.
    if (!best) {
      period = 1;
      watched = buildWatched([], n, period);
      sol = solveRoute(ground.walls, watched, n, period, ground.start, 0, ground.exit);
      best = { patrols: [], period: 1, watched: watched, sol: sol || { len: manhattan, path: [ground.start, ground.exit] } };
    }

    // Skin dressing and stable display names.
    var walkNo = 0, beamNo = 0;
    for (i = 0; i < best.patrols.length; i++) {
      var q = best.patrols[i];
      if (q.kind === 'walk') { walkNo++; q.icon = C.walkIcon; q.name = PS.state.prettify(C.walkName) + ' ' + walkNo; }
      else { beamNo++; q.icon = C.beamIcon; q.name = PS.state.prettify(C.beamName) + ' ' + beamNo; }
    }

    return {
      n: n,
      tier: t,
      content: C,
      walls: ground.walls,
      start: ground.start,
      exit: ground.exit,
      patrols: best.patrols,
      period: best.period,
      watched: best.watched,
      bestLen: best.sol.len,
      bestPath: best.sol.path,
      x: ground.start[0],
      y: ground.start[1],
      tick: 0,
      moves: 0,
      waits: 0,
      strikes: 0,
      arrived: false,
      bolted: false
    };
  }

  /* ============================================================== RUNTIME = */

  function isWatched(puzzle, x, y, tick) {
    return puzzle.watched[((tick % puzzle.period) + puzzle.period) % puzzle.period][idx(x, y, puzzle.n)];
  }

  function routeNow(puzzle) {
    return solveRoute(puzzle.walls, puzzle.watched, puzzle.n, puzzle.period,
      [puzzle.x, puzzle.y], puzzle.tick, puzzle.exit);
  }

  /* ================================================================ CSS == */
  /* The yard itself is the arena's canvas. All this dresses is the strip of
     briefing that sits under it. */

  var CSS = [
    '.pz-patrol{display:flex;flex-direction:column;gap:12px}',

    '.pz-patrol-tips{display:flex;flex-wrap:wrap;gap:14px;align-items:center;',
    '  font-size:12px;color:var(--dim);line-height:1.6}',
    '.pz-patrol-tips strong{color:var(--text-2);font-weight:600}',
    '.pz-patrol-cap{font-family:var(--font-mono);font-size:10.5px;padding:2px 7px;border-radius:5px;',
    '  background:#0c1016;border:1px solid var(--line);border-bottom-width:2px;color:var(--text-2)}',

    '.pz-patrol-key{display:flex;flex-wrap:wrap;gap:11px;font-size:11px;color:var(--dim)}',
    '.pz-patrol-key span{display:inline-flex;gap:5px;align-items:center}',
    '.pz-patrol-key b{color:var(--acc-2);font-weight:600;font-family:var(--font-mono)}',

    '.pz-patrol-arrive{font-size:13px;line-height:1.65;color:var(--text-2);margin-bottom:12px}',
    '.pz-patrol-arrive b{color:var(--acc-2)}',
    '.pz-patrol-arrive em{font-style:normal;color:var(--bad)}'
  ].join('\n');

  /* ============================================================ REAL TIME = */
  /* The generator proves a route through (place, time) exists. Down in the
     yard that same route has to be WALKABLE, so every number below is set
     against one fact: the player tops out at 5 tiles a second and the fastest
     thing watching them does 2.6. A three-to-one speed advantage is what turns
     a proof into something you can actually do with your hands.

     LOAD-BEARING. That margin is not tuning, it is what carries the solver's
     tick-space guarantee into continuous time: a tile costs the player ~0.2s
     and the guard ~0.65s, so every gap the BFS found has slack measured in
     seconds. The 5.0 is `MAX_SPEED` in js/core/arena.js and is NOT declared
     here — raising a speed below, lowering MAX_SPEED, or adding a patrol that
     sprints breaks the proof silently. The board would still claim to be
     crossable and would no longer be. Re-verify against the generator if you
     touch any of it.

     Two further slacks run the same way, and both are deliberate: a cone does
     not see behind itself where the old turn-based vision did, and detection
     is line-of-sight checked against walls where the old model ignored them.
     Both only ever ADD room, which is the safe direction for a guarantee. */

  var WALK_SPEED = 1.55;      // tiles/s — a bored man pacing a corridor
  var WALK_WAIT  = 0.5;       // beat at each end of the beat, so you can read it
  var BEAM_SPEED = 2.6;       // tiles/s — a lamp running the length of a lane
  var BEAM_WAIT  = 0.2;
  var TICK_BEAT  = 1.1;       // seconds of yard time per tick of the old clock
  var SPOT_COOL  = 1.15;      // seconds between sightings, however many eyes

  function angleDelta(a, b) {
    var d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  /** Cone reach, thinned as the yard fills up. Seven overlapping cones on an
      eight-wide board is a wall, not a watch. */
  function coneRange(count) {
    var r = 3.6 - count * 0.12;
    return r < 2.4 ? 2.4 : (r > 3.6 ? 3.6 : r);
  }

  /**
   * A walker's stored route is a corridor walked out and back, so every cell
   * between the ends is redundant here — the arena lerps along the legs itself.
   * Two waypoints give the same motion AND let `wait` read as a turn at the end
   * of the beat instead of a stutter on every single tile.
   */
  function walkerRoute(p) {
    var a = p.route[0], b = p.route[p.len / 2] || p.route[p.route.length - 1];
    return [[a[0], a[1]], [b[0], b[1]]];
  }

  /**
   * A beam lit a whole column at a time on the board. In the yard it is a lamp
   * that runs the length of that column with a long narrow cone, then shifts
   * one lane over and runs back — a serpentine that lights the same ground in
   * the same order, and that you can duck out of because the arena checks line
   * of sight against the walls.
   */
  function beamRoute(p, n) {
    var route = [], i, c, down;
    for (i = 0; i < p.line.length; i++) {
      c = p.line[i];
      down = (i % 2 === 0);
      if (p.vertical) {
        route.push([c, down ? 0 : n - 1]);
        route.push([c, down ? n - 1 : 0]);
      } else {
        route.push([down ? 0 : n - 1, c]);
        route.push([down ? n - 1 : 0, c]);
      }
    }
    return route;
  }

  /* =============================================================== MOUNT == */

  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var C = puzzle.content;
    var n = puzzle.n;
    var finished = false;
    var arena = null;
    var exitStation = null;
    var eyes = [];              // raw patrol objects, read for the exposure meter
    var clock = 0, beat = 0, hudT = 0;
    var lastSpot = -99;
    var movedThisBeat = false;
    var arriveLine = null;

    var stage = h('div', {});
    var wrap = h('div', { class: 'pz-patrol' }, [stage]);
    PS.ui.append(el, wrap);

    /* ------------------------------------------------------------ endings -- */

    function choiceBtn(spec) {
      return h('button', {
        class: 'pz-choice', type: 'button',
        onclick: function () { finishRun(spec.choice); }
      }, [
        h('div', { class: 'pz-choice__i', text: spec.icon }),
        h('div', { class: 'pz-choice__t', text: spec.title }),
        h('div', { class: 'pz-choice__d', text: spec.desc })
      ]);
    }

    function finishRun(choice) {
      if (finished) return;
      finished = true;
      var clean = puzzle.strikes === 0;
      var tight = puzzle.moves + puzzle.waits <= Math.ceil(puzzle.bestLen * 1.35);

      api.finish({
        outcome: puzzle.strikes >= 3 ? 'partial' : 'success',
        stats: clean ? { morale: 10, energy: -4 } : { morale: 2, energy: -6 },
        gain: clean && puzzle.tier >= 2 ? ['keycard'] : [],
        lose: [],
        tags: ['crossed_the_watch'].concat(clean ? ['moved_unseen'] : ['was_seen']),
        signals: {
          caution: clean ? 5 : (puzzle.strikes < 3 ? 3 : 1),
          logic: tight ? 3 : 2,
          speed: tight ? 2 : 0,
          brute: puzzle.strikes >= 3 ? 2 : 0
        },
        choice: choice,
        summary: clean
          ? C.clean
          : C.messy + ' ' + puzzle.strikes + ' sighting' + (puzzle.strikes === 1 ? '' : 's') + ' in '
            + (puzzle.moves + puzzle.waits) + ' ticks.'
      });
    }

    /** Straight line, everything else be damned. A real option with a real bill. */
    function bolt() {
      if (finished) return;
      finished = true;
      puzzle.bolted = true;

      var lit = 0;
      var cx = puzzle.x, cy = puzzle.y, tk = puzzle.tick, guard = 0;
      while ((cx !== puzzle.exit[0] || cy !== puzzle.exit[1]) && guard++ < 200) {
        if (cx !== puzzle.exit[0]) cx += cx < puzzle.exit[0] ? 1 : -1;
        else if (cy !== puzzle.exit[1]) cy += cy < puzzle.exit[1] ? 1 : -1;
        tk++;
        if (!puzzle.walls[idx(cx, cy, n)] && isWatched(puzzle, cx, cy, tk)) lit++;
      }
      var hurt = 4 + lit * (2 + puzzle.tier);

      api.finish({
        outcome: lit > 2 ? 'fail' : 'partial',
        stats: { health: -hurt, energy: -14, morale: -7 },
        gain: [], lose: [],
        tags: ['crossed_the_watch', 'was_seen', 'broke_cover'],
        signals: { brute: 4, speed: 4, caution: 0, logic: 0 },
        choice: 'sprint',
        summary: C.brokeCover + ' You come out the far side of ' + C.place + ' with '
          + lit + ' pair' + (lit === 1 ? '' : 's') + ' of eyes on you.'
      });
    }

    function endChoices() {
      return h('div', { class: 'pz-choices' }, [choiceBtn(C.a), choiceBtn(C.b)]);
    }

    /* ------------------------------------------------------- degraded mode -- */
    /* arena.js is core and always present, but never let a missing layer strand
       the player in a scene they cannot leave.                                */

    if (!PS.arena || typeof PS.arena.create !== 'function') {
      PS.ui.append(stage, [
        h('div', { class: 'pz-intro', text: C.arrive }),
        endChoices()
      ]);
      return;
    }

    /* --------------------------------------------------------------- yard -- */

    var tiles = [], ty, tx, row;
    for (ty = 0; ty < n; ty++) {
      row = [];
      for (tx = 0; tx < n; tx++) row.push(puzzle.walls[idx(tx, ty, n)] ? 1 : 0);
      tiles.push(row);
    }

    arena = PS.arena.create(stage, {
      map: { w: n, h: n, tiles: tiles },
      spawn: { x: puzzle.start[0], y: puzzle.start[1] },
      avatar: C.playerIcon,
      light: state.stats.light,
      // Nothing here is hidden — that was always the deal. The yard stays
      // legible end to end; your own light only decides how sharp the ground
      // immediately under you looks.
      lightCurve: function (v) { return 2.2 + Math.max(0, Math.min(100, v)) / 100 * 2.6; },
      darkness: 0.7,
      memory: 0.88,
      onStep: onStep,
      onTick: onTick,
      onDetect: onDetect
    });
    if (!arena) {
      PS.ui.append(stage, [h('div', { class: 'pz-intro', text: C.arrive }), endChoices()]);
      return;
    }
    teardownFns.push(function () { if (arena) { arena.destroy(); arena = null; } });
    arena.revealAll();

    /* ------------------------------------------------------------ the watch */

    function phase(handle, p) {
      // The generator gave every patrol a starting offset in its own cycle and
      // that offset is half of what makes a yard readable. Put it back.
      var raw = handle && handle.raw;
      if (!raw || !raw.route || raw.route.length < 2 || !p.len) return;
      var legs = raw.route.length;
      var pos = ((p.offset % p.len) / p.len) * legs;
      var leg = Math.floor(pos) % legs;
      raw.leg = leg;
      raw.t = Math.min(0.999, pos - Math.floor(pos));
      var a = raw.route[leg], b = raw.route[(leg + 1) % legs];
      raw.x = a[0] + (b[0] - a[0]) * raw.t;
      raw.y = a[1] + (b[1] - a[1]) * raw.t;
      raw.dir = Math.atan2(b[1] - a[1], b[0] - a[0]);
      eyes.push(raw);
    }

    var reach = coneRange(puzzle.patrols.length);
    for (var pi = 0; pi < puzzle.patrols.length; pi++) {
      (function (p) {
        var walker = p.kind === 'walk';
        phase(arena.patrol({
          route: walker ? walkerRoute(p) : beamRoute(p, n),
          speed: walker ? WALK_SPEED : BEAM_SPEED,
          wait: walker ? WALK_WAIT : BEAM_WAIT,
          icon: p.icon,
          label: p.name,
          vision: walker
            ? { range: reach, fov: 1.15 }
            : { range: n, fov: 0.42 }
          // detection is handled once, at the arena level, so a yard full of
          // overlapping cones still only bills you for one sighting.
        }), p);
      })(puzzle.patrols[pi]);
    }

    /* ------------------------------------------------------- the way out --- */

    exitStation = arena.station({
      x: puzzle.exit[0], y: puzzle.exit[1],
      icon: C.exitIcon, label: C.exitName, hint: 'walk in, or press E',
      radius: 1.2, emits: 1.9,
      onEnter: function (panel) {
        arriveLine = h('div', { class: 'pz-patrol-arrive' });
        paintArrive();
        PS.ui.append(panel, [arriveLine, endChoices()]);
      },
      onOpen: function () {
        paintArrive();
        if (puzzle.arrived || finished) return;
        puzzle.arrived = true;
        api.flash();
        arena.ping(puzzle.exit[0], puzzle.exit[1]);
      }
    });

    function paintArrive() {
      if (!arriveLine) return;
      PS.ui.clear(arriveLine);
      PS.ui.append(arriveLine, [
        C.arrive + ' ',
        h('em', {
          text: puzzle.strikes === 0
            ? 'Nobody saw you once.'
            : 'They saw you ' + puzzle.strikes + ' time' + (puzzle.strikes === 1 ? '' : 's') + '.'
        })
      ]);
    }

    /* ---------------------------------------------------------------- HUD -- */

    var cWhere = arena.chip('At', '\uD83D\uDCCD');
    var cSteps = arena.chip('Steps', '\uD83D\uDC63');
    var cSeen  = arena.chip('Spotted', '\uD83D\uDC41\uFE0F');
    var mExpo  = arena.meter('Exposure', '\uD83D\uDD26');

    arena.note('Every cone is drawn and every loop repeats. Stand still and read them before you cross.');
    arena.button('\uD83C\uDFC3 Break cover and run', bolt, 'pz-btn--danger');

    PS.ui.append(wrap, [
      h('div', { class: 'pz-patrol-tips' }, [
        h('span', {}, [
          h('b', { class: 'pz-patrol-cap', text: 'W A S D' }), ' / ',
          h('b', { class: 'pz-patrol-cap', text: '\u2190\u2191\u2193\u2192' }),
          ' move \u00B7 hold or click the ', h('strong', { text: 'mouse' }), ' to go there'
        ]),
        h('div', { class: 'pz-patrol-key' }, [
          h('span', {}, [C.walkIcon, ' ' + C.walkPlural]),
          h('span', {}, [C.beamIcon, ' ' + C.beamPlural]),
          h('span', {}, [C.exitIcon, ' ' + C.exitName]),
          h('span', {}, ['clean line ', h('b', { text: puzzle.bestLen + ' ticks' })])
        ])
      ])
    ]);

    /* ------------------------------------------------------------- living -- */

    function onStep(x, y) {
      if (finished) return;
      puzzle.x = x;
      puzzle.y = y;
      puzzle.moves++;
      movedThisBeat = true;
      // Half a point of energy a tile, charged on the even ones. Free movement
      // means more ground covered than the old five-actions-a-tick board did.
      if (puzzle.moves % 2 === 0) api.tweak({ energy: -1 });
      paintHud();
    }

    function onTick(dt) {
      if (finished) return;
      clock += dt;
      beat += dt;
      hudT += dt;
      if (beat >= TICK_BEAT) {
        beat -= TICK_BEAT;
        puzzle.tick++;
        if (!movedThisBeat) puzzle.waits++;
        movedThisBeat = false;
      }
      if (hudT >= 0.14) { hudT = 0; paintHud(); }
    }

    function onDetect() { spotted(); }

    /** Being seen costs blood and composure. It has never ended the run and it
        does not start now — you can walk across in front of everyone if you are
        willing to pay for it. */
    function spotted() {
      if (finished || !arena) return;
      if (clock - lastSpot < SPOT_COOL) return;
      lastSpot = clock;
      puzzle.strikes++;
      api.tweak({ health: -(3 + puzzle.tier), morale: -4 });
      api.toast(C.spotted, 'bad', 2400);
      var pl = arena.player();
      arena.hit('#e2695f');
      arena.shake(9, 0.34);
      arena.dust(pl.tx, pl.ty, 9, '#e2695f');
      paintArrive();
      paintHud();
    }

    function exposureNow() {
      if (!arena || !eyes.length) return 0;
      var pl = arena.player(), best = 0, i;
      for (i = 0; i < eyes.length; i++) {
        var e = eyes[i];
        if (!e || !e.vision) continue;
        var dx = pl.x - e.x, dy = pl.y - e.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > e.vision.range) continue;
        var off = Math.abs(angleDelta(e.dir, Math.atan2(dy, dx)));
        var half = e.vision.fov / 2;
        var cone = off <= half ? 1 : Math.max(0, 1 - (off - half) / 0.85);
        if (cone <= 0) continue;
        var v = cone * (0.34 + (1 - d / e.vision.range) * 0.66);
        if (v > best) best = v;
      }
      return Math.round(best * 100);
    }

    function paintHud() {
      if (!arena || finished) return;
      var pl = arena.player();
      var ex = exposureNow();
      var tone = ex >= 75 ? 'bad' : (ex >= 40 ? 'warn' : null);

      cWhere.set(label(pl.tx, pl.ty));
      cSteps.set(puzzle.moves + ' \u00B7 tick ' + puzzle.tick);
      cSeen.set(String(puzzle.strikes), puzzle.strikes ? 'bad' : null);
      mExpo.set(ex, ex >= 75 ? 'in the light' : (ex >= 40 ? 'edge of it' : 'dark'), tone);
    }

    paintHud();
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
    if (puzzle.arrived) return 'You are already at ' + C.exitName + '. Pick your exit.';

    var sol = routeNow(puzzle);
    if (!sol) return 'Every line from here is covered on the tick you would arrive. Hold still and let the loop turn.';
    if (sol.len === 0) return 'You are standing on it.';

    var nxt = sol.path[1];
    if (!nxt) return 'One more step and you are out.';

    var word;
    if (nxt[0] === puzzle.x && nxt[1] === puzzle.y) word = 'hold where you are for a tick';
    else if (nxt[1] < puzzle.y) word = 'go north';
    else if (nxt[1] > puzzle.y) word = 'go south';
    else if (nxt[0] < puzzle.x) word = 'go west';
    else word = 'go east';

    return sol.len + ' clean ticks to ' + C.exitName + ' from here \u2014 ' + word + ' first.';
  }

  /* ============================================================ AUTOSOLVE = */
  /* Headless. Walks the shortest safe route the BFS proved exists. */

  function autoSolve(puzzle, rng, state, tier, skin) {
    var C = puzzle.content;
    var sol = routeNow(puzzle);

    if (!sol) {
      return {
        outcome: 'partial',
        stats: { health: -(6 + puzzle.tier * 2), energy: -14, morale: -7 },
        gain: [], lose: [],
        tags: ['crossed_the_watch', 'was_seen', 'broke_cover'],
        signals: { brute: 4, speed: 4, caution: 0 },
        choice: 'sprint',
        summary: C.brokeCover + ' There was no quiet line left through ' + C.place + '.'
      };
    }

    var ticks = puzzle.moves + puzzle.waits + sol.len;
    var clean = puzzle.strikes === 0;
    var choice = rng.chance(0.5) ? C.a.choice : C.b.choice;

    return {
      outcome: puzzle.strikes >= 3 ? 'partial' : 'success',
      stats: clean ? { morale: 10, energy: -(4 + Math.min(20, sol.len)) }
                   : { morale: 2, energy: -(6 + Math.min(20, sol.len)) },
      gain: clean && puzzle.tier >= 2 ? ['keycard'] : [],
      lose: [],
      tags: ['crossed_the_watch'].concat(clean ? ['moved_unseen'] : ['was_seen']),
      signals: { caution: clean ? 5 : 3, logic: 3, speed: 2, brute: 0 },
      choice: choice,
      summary: clean
        ? C.clean + ' ' + ticks + ' ticks, every one of them counted.'
        : C.messy
    };
  }

  /* ============================================================ REGISTER = */

  PS.registry.register({
    id: 'patrol_routing',
    name: 'Patrol Routing',
    icon: '\uD83D\uDC41\uFE0F',
    blurb: 'Nothing is hidden. Everything is on a loop. Step into the gaps.',

    favors:   { caution: 3, logic: 2 },
    provides: ['passage', 'crossing', 'vantage'],
    tagHooks: ['moved_unseen', 'was_seen'],
    requires: function (state) { return state.stats.energy > 10; },

    css: CSS,

    skins: [
      {
        id: 'night_watch', biome: 'urban', title: 'Night Watch',
        icon: '\uD83D\uDC6E', palette: 'ash',
        intro: 'They walk it the same way every night, and they have walked it so long they no longer look at anything. From the top of the wall you can see the whole pattern of it. Down in the yard you will only get one chance to use it.',
        nouns: { threat: 'watchman', sweep: 'torch sweep', exit: 'the side door', place: 'the courtyard' }
      },
      {
        id: 'searchlight_yard', biome: 'industrial', title: 'Searchlight Yard',
        icon: '\uD83D\uDD26', palette: 'rust',
        intro: 'Two lamps on gantries, sweeping the yard on motors that have not been adjusted since they were installed. Between the sweeps there is darkness you could park a lorry in, and it comes back at exactly the same moment every time.',
        nouns: { threat: 'yard hand', sweep: 'searchlight', exit: 'the loading gate', place: 'the yard' }
      },
      {
        id: 'predator_range', biome: 'wilderness', title: 'Predator Range',
        icon: '\uD83D\uDC3A', palette: 'moss',
        intro: 'They quarter the grass in long slow lines, working upwind, and the cloud keeps tearing open to lay bare strips of moonlight across the range. Both things are regular. Neither of them is forgiving.',
        nouns: { threat: 'wolf', sweep: 'moonlit lane', exit: 'the rock shelf', place: 'the open range' }
      }
    ],

    build: build,
    mount: mount,
    unmount: unmount,
    hint: hint,
    autoSolve: autoSolve
  });

})(typeof window !== 'undefined' ? window : this);
