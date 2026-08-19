/* ==========================================================================
   PuzzleStudio — js/games/e19_patrol_routing.js    ENGINE 19 · Patrol Routing
   --------------------------------------------------------------------------
   Self-contained: logic + 3 skins + its own CSS. No DOM access until mount().

   THE PUZZLE
     Stealth as a planning problem, not a reflex test. Nothing here is hidden
     and nothing here is random. Every watchman walks a fixed loop, every beam
     sweeps a fixed span, and all of it is drawn on the board before you move.
     The world advances exactly one tick per action, and waiting in place is an
     action — so the puzzle is not "can you react", it is "can you read the
     cycles and step into the gap they leave".

   GENERATION — SOLVED IN (PLACE, TIME), NOT IN PLACE
     A route that is safe cell-by-cell can still be a death trap, because the
     danger moves. So this engine never reasons about the grid alone: it
     reasons about (x, y, tick mod period).

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

  var CSS = [
    '.pz-patrol{display:grid;grid-template-columns:minmax(0,1fr) minmax(236px,300px);gap:18px;align-items:start}',
    '@media (max-width:880px){.pz-patrol{grid-template-columns:1fr}}',

    '.pz-patrol-board{display:grid;gap:3px;padding:11px;border-radius:12px;background:#06080c;',
    '  border:1px solid var(--line);box-shadow:inset 0 0 60px rgba(0,0,0,.85);',
    '  width:100%;max-width:520px;aspect-ratio:1/1;margin:0 auto}',
    '.pz-patrol-cell{position:relative;display:grid;place-items:center;border-radius:5px;padding:0;',
    '  font-size:clamp(10px,2.4vw,19px);line-height:1;background:#0c1017;border:1px solid #151b25;',
    '  color:var(--text-2);transition:background .18s var(--ease),border-color .18s var(--ease)}',
    '.pz-patrol-cell.is-wall{background:#1a2029;border-color:#232b37;color:var(--dimmer)}',
    '.pz-patrol-cell.is-route{background:#111a24;border-color:#1e2c3a}',
    '.pz-patrol-cell.is-soon::after{content:"";position:absolute;inset:3px;border-radius:3px;',
    '  background:repeating-linear-gradient(45deg,transparent 0 3px,rgba(230,180,85,.30) 3px 6px);',
    '  pointer-events:none}',
    '.pz-patrol-cell.is-watch{background:rgba(226,105,95,.20);border-color:rgba(226,105,95,.55)}',
    '.pz-patrol-cell.is-exit{color:var(--acc-2);border-color:color-mix(in srgb,var(--acc) 45%,transparent)}',
    '.pz-patrol-cell.is-step{cursor:pointer}',
    '.pz-patrol-cell.is-safe{border-color:var(--good);box-shadow:0 0 0 1px color-mix(in srgb,var(--good) 55%,transparent)}',
    '.pz-patrol-cell.is-safe:hover{background:rgba(95,207,141,.16)}',
    '.pz-patrol-cell.is-risk{border-color:var(--bad);box-shadow:0 0 0 1px color-mix(in srgb,var(--bad) 55%,transparent)}',
    '.pz-patrol-cell.is-risk:hover{background:rgba(226,105,95,.20)}',
    '.pz-patrol-cell.is-me{background:radial-gradient(circle,var(--acc-wash),transparent 70%);',
    '  color:var(--text);box-shadow:0 0 20px var(--acc-glow);z-index:2}',
    '.pz-patrol-cell.is-hit{animation:pzPatrolHit .55s var(--ease)}',
    '@keyframes pzPatrolHit{0%,100%{background:#0c1017}35%{background:rgba(226,105,95,.65)}}',

    '.pz-patrol-tick{display:flex;align-items:baseline;gap:10px;font-family:var(--font-mono);font-size:12px;color:var(--dim)}',
    '.pz-patrol-tick b{font-size:20px;color:var(--acc-2)}',
    '.pz-patrol-tick i{font-style:normal;color:var(--dimmer)}',

    '.pz-patrol-list{display:flex;flex-direction:column;gap:6px}',
    '.pz-patrol-row{display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:8px;',
    '  border:1px solid var(--line-soft);background:var(--panel-2);color:var(--text-2);',
    '  font-size:12px;text-align:left;width:100%}',
    '.pz-patrol-row:hover{border-color:var(--acc)}',
    '.pz-patrol-row.is-on{border-color:var(--acc);background:var(--acc-wash)}',
    '.pz-patrol-row__i{font-size:17px;line-height:1}',
    '.pz-patrol-row__d{font-family:var(--font-mono);font-size:10px;color:var(--dim)}',
    '.pz-patrol-row__d b{color:var(--acc-2);font-weight:700}',

    '.pz-patrol-pad{display:grid;grid-template-columns:repeat(3,44px);grid-template-rows:repeat(3,44px);',
    '  gap:6px;justify-content:center}',
    '.pz-patrol-pad button{border-radius:9px;border:1px solid var(--line);font-size:14px;',
    '  background:linear-gradient(180deg,var(--panel-3),var(--panel-2));color:var(--text)}',
    '.pz-patrol-pad button:hover:not(:disabled){border-color:var(--acc)}',
    '.pz-patrol-pad button:disabled{opacity:.22}',
    '.pz-patrol-pad .pz-patrol-wait{font-size:11px;color:var(--acc-2)}',

    '.pz-patrol-read{display:flex;flex-direction:column;gap:6px}',
    '.pz-patrol-read__row{display:flex;justify-content:space-between;gap:10px;',
    '  font-family:var(--font-mono);font-size:11px;color:var(--dim)}',
    '.pz-patrol-read__row b{color:var(--acc-2);font-weight:700}',
    '.pz-patrol-read__row.is-bad b{color:var(--bad)}',

    '.pz-patrol-key{display:flex;flex-wrap:wrap;gap:9px;font-size:11px;color:var(--dim)}',
    '.pz-patrol-key span{display:inline-flex;gap:5px;align-items:center}',
    '.pz-patrol-key i{width:11px;height:11px;border-radius:3px;display:inline-block;font-style:normal}',
    '.pz-patrol-key .pz-patrol-sw-now{background:rgba(226,105,95,.55)}',
    '.pz-patrol-key .pz-patrol-sw-next{background:repeating-linear-gradient(45deg,transparent 0 2px,rgba(230,180,85,.75) 2px 4px)}'
  ].join('\n');

  /* =============================================================== MOUNT == */

  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var C = puzzle.content;
    var n = puzzle.n;
    var finished = false;
    var showRoute = -1;             // index of the patrol whose beat is drawn

    var cells = [];
    var board = h('div', {
      class: 'pz-patrol-board',
      style: { gridTemplateColumns: 'repeat(' + n + ',1fr)', gridTemplateRows: 'repeat(' + n + ',1fr)' }
    });

    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        (function (cx, cy) {
          var c = h('button', { type: 'button', class: 'pz-patrol-cell', title: label(cx, cy) });
          c.addEventListener('click', function () { tryStep(cx, cy); });
          cells[idx(cx, cy, n)] = c;
          board.appendChild(c);
        })(x, y);
      }
    }

    var tickBox = h('div', { class: 'pz-patrol-tick' });
    var listBox = h('div', { class: 'pz-patrol-list' });
    var readBox = h('div', { class: 'pz-patrol-read' });
    var controls = h('div', { class: 'pz-col' });
    var padBtns = {};

    /* ------------------------------------------------------------- render -- */

    function routeCells() {
      var mark = {};
      if (showRoute < 0 || !puzzle.patrols[showRoute]) return mark;
      var p = puzzle.patrols[showRoute];
      if (p.kind === 'walk') {
        for (var i = 0; i < p.route.length; i++) mark[idx(p.route[i][0], p.route[i][1], n)] = true;
      } else {
        for (var j = 0; j < p.line.length; j++) {
          for (var q = 0; q < n; q++) mark[p.vertical ? idx(p.line[j], q, n) : idx(q, p.line[j], n)] = true;
        }
      }
      return mark;
    }

    function glyph(x, y) {
      if (puzzle.x === x && puzzle.y === y) return C.playerIcon;
      if (x === puzzle.exit[0] && y === puzzle.exit[1]) return C.exitIcon;
      if (puzzle.walls[idx(x, y, n)]) return C.wallIcon;
      for (var i = 0; i < puzzle.patrols.length; i++) {
        var p = puzzle.patrols[i];
        if (p.kind !== 'walk') continue;
        var at = patrolAt(p, puzzle.tick);
        if (at[0] === x && at[1] === y) return p.icon;
      }
      return '';
    }

    function paint() {
      var trail = routeCells();
      var now = puzzle.watched[puzzle.tick % puzzle.period];
      var next = puzzle.watched[(puzzle.tick + 1) % puzzle.period];

      for (var yy = 0; yy < n; yy++) {
        for (var xx = 0; xx < n; xx++) {
          var k = idx(xx, yy, n);
          var c = cells[k];
          var cls = 'pz-patrol-cell';
          var wall = puzzle.walls[k];

          if (wall) cls += ' is-wall';
          if (trail[k] && !wall) cls += ' is-route';
          if (now[k] && !wall) cls += ' is-watch';
          if (next[k] && !wall) cls += ' is-soon';
          if (xx === puzzle.exit[0] && yy === puzzle.exit[1]) cls += ' is-exit';

          var d = Math.abs(xx - puzzle.x) + Math.abs(yy - puzzle.y);
          var steppable = !finished && !puzzle.arrived && !wall && d === 1;
          if (steppable) cls += next[k] ? ' is-step is-risk' : ' is-step is-safe';

          if (xx === puzzle.x && yy === puzzle.y) cls += ' is-me';

          c.className = cls;
          c.textContent = glyph(xx, yy);
          c.disabled = finished || (!steppable && !(xx === puzzle.x && yy === puzzle.y));
        }
      }
      paintSide();
    }

    function paintSide() {
      var next = puzzle.watched[(puzzle.tick + 1) % puzzle.period];

      PS.ui.clear(tickBox);
      PS.ui.append(tickBox, [
        h('span', { text: 'TICK' }),
        h('b', { text: String(puzzle.tick) }),
        h('i', { text: 'cycle repeats every ' + puzzle.period })
      ]);

      PS.ui.clear(listBox);
      if (!puzzle.patrols.length) {
        listBox.appendChild(h('div', { class: 'pz-note', text: 'Nothing is watching this ground. Walk it.' }));
      }
      for (var i = 0; i < puzzle.patrols.length; i++) {
        (function (pi) {
          var p = puzzle.patrols[pi];
          var here = patrolAt(p, puzzle.tick);
          var soon = patrolAt(p, puzzle.tick + 1);
          var where, going;
          if (p.kind === 'walk') {
            where = label(here[0], here[1]);
            going = label(soon[0], soon[1]);
          } else {
            where = (p.vertical ? 'col ' + String.fromCharCode(65 + here) : 'row ' + (here + 1));
            going = (p.vertical ? String.fromCharCode(65 + soon) : String(soon + 1));
          }
          var btn = h('button', {
            type: 'button',
            class: 'pz-patrol-row' + (showRoute === pi ? ' is-on' : ''),
            title: 'Show this beat on the board'
          }, [
            h('span', { class: 'pz-patrol-row__i', text: p.icon }),
            h('span', {}, [
              h('div', { text: p.name }),
              h('div', { class: 'pz-patrol-row__d' }, [
                'loop ' + p.len + ' \u00B7 at ' + where + ' \u00B7 next ',
                h('b', { text: going })
              ])
            ])
          ]);
          btn.addEventListener('click', function () {
            showRoute = (showRoute === pi) ? -1 : pi;
            paint();
          });
          listBox.appendChild(btn);
        })(i);
      }

      PS.ui.clear(readBox);
      PS.ui.append(readBox, [
        row('Standing at', label(puzzle.x, puzzle.y), ''),
        row('Steps taken', String(puzzle.moves) + (puzzle.waits ? ' (' + puzzle.waits + ' held)' : ''), ''),
        row('Shortest clean line', puzzle.bestLen + ' ticks', ''),
        row('Times seen', String(puzzle.strikes), puzzle.strikes ? 'is-bad' : '')
      ]);

      if (!finished && !puzzle.arrived) {
        var dirs = [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]];
        for (var d = 0; d < dirs.length; d++) {
          var nx = puzzle.x + dirs[d][1], ny = puzzle.y + dirs[d][2];
          var okc = nx >= 0 && ny >= 0 && nx < n && ny < n && !puzzle.walls[idx(nx, ny, n)];
          padBtns[dirs[d][0]].disabled = !okc;
        }
        padBtns.wait.disabled = false;
        padBtns.wait.textContent = next[idx(puzzle.x, puzzle.y, n)] ? 'HOLD \u26A0' : 'HOLD';
      }

      function row(k, v, cls) {
        return h('div', { class: 'pz-patrol-read__row ' + (cls || '') },
          [h('span', { text: k }), h('b', { text: v })]);
      }
    }

    /* -------------------------------------------------------------- moving */

    function tryStep(x, y) {
      if (finished || puzzle.arrived) return;
      if (x < 0 || y < 0 || x >= n || y >= n) return;
      var d = Math.abs(x - puzzle.x) + Math.abs(y - puzzle.y);
      if (d === 0) { advance(puzzle.x, puzzle.y, true); return; }
      if (d !== 1) return;
      if (puzzle.walls[idx(x, y, n)]) { api.toast('Blocked.', 'bad', 900); return; }
      advance(x, y, false);
    }

    /** One action = one tick. The world moves whether you do or not. */
    function advance(x, y, held) {
      puzzle.x = x;
      puzzle.y = y;
      puzzle.tick++;
      if (held) puzzle.waits++; else puzzle.moves++;

      api.tweak({ energy: held ? -1 : -2 });

      if (isWatched(puzzle, x, y, puzzle.tick)) {
        puzzle.strikes++;
        api.tweak({ health: -(3 + puzzle.tier), morale: -4 });
        api.toast(C.spotted, 'bad', 2400);
        var c = cells[idx(x, y, n)];
        c.classList.remove('is-hit');
        void c.offsetWidth;
        c.classList.add('is-hit');
      }

      if (x === puzzle.exit[0] && y === puzzle.exit[1]) {
        puzzle.arrived = true;
        paint();
        renderChoice();
        api.flash();
        return;
      }
      paint();
    }

    function onKey(ev) {
      if (finished || puzzle.arrived) return;
      var map = {
        ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
        w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
        W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0]
      };
      if (ev.key === ' ' || ev.key === '.') { ev.preventDefault(); advance(puzzle.x, puzzle.y, true); return; }
      var m = map[ev.key];
      if (!m) return;
      ev.preventDefault();
      tryStep(puzzle.x + m[0], puzzle.y + m[1]);
    }
    document.addEventListener('keydown', onKey);
    teardownFns.push(function () { document.removeEventListener('keydown', onKey); });

    function pad() {
      function b(key, lbl, dx, dy, cls) {
        var btn = h('button', { type: 'button', text: lbl, class: cls || null });
        btn.addEventListener('click', function () { tryStep(puzzle.x + dx, puzzle.y + dy); });
        padBtns[key] = btn;
        return btn;
      }
      var sp = function () { return h('div', {}); };
      return h('div', { class: 'pz-patrol-pad' }, [
        sp(), b('up', '\u25B2', 0, -1), sp(),
        b('left', '\u25C0', -1, 0), b('wait', 'HOLD', 0, 0, 'pz-patrol-wait'), b('right', '\u25B6', 1, 0),
        sp(), b('down', '\u25BC', 0, 1), sp()
      ]);
    }

    /* ------------------------------------------------------------ endings -- */

    function renderChoice() {
      PS.ui.clear(controls);
      PS.ui.append(controls, [
        h('div', { class: 'pz-intro' }, [
          C.arrive + ' ',
          h('em', {
            text: puzzle.strikes === 0
              ? 'Nobody saw you once.'
              : 'They saw you ' + puzzle.strikes + ' time' + (puzzle.strikes === 1 ? '' : 's') + '.'
          })
        ]),
        h('div', { class: 'pz-choices' }, [choiceBtn(C.a), choiceBtn(C.b)])
      ]);
    }

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

    /* ------------------------------------------------------------- layout -- */

    PS.ui.append(controls, [
      pad(),
      h('div', { class: 'pz-patrol-key' }, [
        h('span', {}, [h('i', { class: 'pz-patrol-sw-now' }), ' watched now']),
        h('span', {}, [h('i', { class: 'pz-patrol-sw-next' }), ' watched next tick']),
        h('span', {}, [C.exitIcon, ' ' + C.exitName])
      ]),
      h('button', { class: 'pz-btn pz-btn--danger pz-btn--sm', type: 'button', onclick: bolt },
        ['\uD83C\uDFC3 Break cover and run'])
    ]);

    PS.ui.append(el, h('div', { class: 'pz-patrol' }, [
      h('div', { class: 'pz-col' }, [
        board,
        h('div', { class: 'pz-note' }, [
          'Every action costs one tick, including ', h('strong', { text: 'holding still' }),
          ' \u2014 so the hatched cells are where you must not be standing when you next stop moving.'
        ])
      ]),
      h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-card' }, [h('div', { class: 'pz-card__head', text: 'The clock' }), tickBox, readBox]),
        h('div', { class: 'pz-card' }, [h('div', { class: 'pz-card__head', text: 'Who is looking' }), listBox]),
        h('div', { class: 'pz-card' }, [h('div', { class: 'pz-card__head', text: 'Move' }), controls])
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
