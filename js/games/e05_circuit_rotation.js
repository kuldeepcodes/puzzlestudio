/* ==========================================================================
   PuzzleStudio — js/games/e05_circuit_rotation.js
                                                ENGINE 05 · Circuit Rotation
   --------------------------------------------------------------------------
   Self-contained: logic + 3 skins + its own CSS. No DOM access until mount().

   THE PUZZLE
     A floor of conduit sections between a live source and a dead load. Every
     section is the right section; every section is pointing the wrong way.
     You walk the substation, stand at a junction and press E to turn it a
     quarter turn. Get a continuous run from the source to the load and the
     thing at the end of it wakes up. Restoring power is a physical circuit
     of the room, and the run lights itself section by section as it takes.

   ALWAYS SOLVABLE
     The network is built first — a self-avoiding run from source to load,
     plus a few spurs to secondary fittings — and only then are the tiles
     spun. The solved orientation is therefore known by construction, which
     also gives an exact reference for the fewest turns needed. Source, load
     and spur fittings are bolted down and cannot be turned, so no amount of
     clicking can make the puzzle worse.

   THIS IS THE LIGHT RESTORE
     The Director force-routes here whenever light drops under 15, so it asks
     for nothing: no items, no stats, no reading in the dark. Success is the
     biggest single light swing in the game. Which means it has to be fully
     playable with the mask almost shut, so the floor plan is known from the
     start, the source burns whatever happens, and every section you energise
     lights itself. Near-darkness is the mood here, never the obstacle.

   THE BRANCH
     Power restored, you decide where it goes: everything into the beacon,
     which is bright and loud and can be seen from a long way off — or a cell
     and a bulb pulled off the rack into your hand, which is dimmer, portable
     and nobody's business but yours.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio;
  if (!PS || !PS.registry) { if (root.console) console.error('[e05] core not loaded'); return; }

  /* ======================================================== SKIN CONTENT == */

  var CONTENT = {
    dead_substation: {
      sourceName: 'Live feeder', loadName: 'Yard floodlights', spurName: 'Cabinet lamp',
      sourceIcon: '\u26A1', loadIcon: '\uD83D\uDCA1', spurIcon: '\uD83D\uDD26',
      unit: 'busbar section',
      live: 'The feeder is still hot. Everything downstream of it is not.',
      done: 'Contactors slam in down the whole row and the yard goes white.',
      beacon: 'Everything into the yard lights',
      beaconDesc: 'Twelve kilowatts of sodium. Anyone within four miles will see this, and everyone within four miles is not a comforting thought.',
      hand: 'Pull a cell and a bulb off the rack',
      handDesc: 'Less light, but it comes with you and it does not announce you to the neighbourhood.'
    },
    coolant_pipes: {
      sourceName: 'Header tank', loadName: 'Exchanger', spurName: 'Standpipe',
      sourceIcon: '\uD83D\uDEBF', loadIcon: '\uD83C\uDF21\uFE0F', spurIcon: '\uD83D\uDCA7',
      unit: 'pipe run',
      live: 'The header is still full. Everything below it is running dry and hot.',
      done: 'The line thumps once, fills, and the temperature needles start to fall.',
      beacon: 'Open every valve on the ring',
      beaconDesc: 'Flood the whole gallery. The lighting circuits come back with the pumps and the noise goes right through the building.',
      hand: 'Bleed a hand lantern off the standpipe',
      handDesc: 'One lamp, filled and lit, and the rest of the ring left shut. Quiet, small, yours.'
    },
    irrigation_channels: {
      sourceName: 'Sluice head', loadName: 'Pump house', spurName: 'Field gate',
      sourceIcon: '\uD83C\uDF0A', loadIcon: '\uD83C\uDFED', spurIcon: '\uD83C\uDF31',
      unit: 'channel gate',
      live: 'The head race is running. Every channel off it is dry cracked mud.',
      done: 'Water finds the wheel, the wheel finds the belt, and the pump house lights come up.',
      beacon: 'Send it all to the pump house',
      beaconDesc: 'Full head on the wheel. The yard lamps come up and the generator can be heard from the road.',
      hand: 'Fill a lamp and shut the gates behind you',
      handDesc: 'Enough oil pressure for one lantern, and the channels closed so nothing shows from the road.'
    }
  };

  /* ======================================================= TILE GEOMETRY ==
     Bit 0 = north, 1 = east, 2 = south, 3 = west. A tile's true mask is the
     set of sides it connects when correctly oriented; `rot` is how many
     quarter turns clockwise it is currently sitting at. */

  var DX = [0, 1, 0, -1];
  var DY = [-1, 0, 1, 0];

  function rotateMask(mask, turns) {
    var out = 0;
    for (var b = 0; b < 4; b++) {
      if (mask & (1 << b)) out |= 1 << ((b + turns) & 3);
    }
    return out;
  }

  function liveMask(tile) { return rotateMask(tile.mask, tile.rot); }

  /** Fewest clicks that would bring this tile back to its solved orientation. */
  function turnsToSolve(tile) {
    for (var r = 0; r < 4; r++) {
      if (rotateMask(tile.mask, (tile.rot + r) & 3) === tile.mask) return r;
    }
    return 0;
  }

  function shapeOf(mask) {
    var n = 0, b;
    for (b = 0; b < 4; b++) if (mask & (1 << b)) n++;
    if (n === 1) return 'end';
    if (n === 4) return 'cross';
    if (n === 3) return 'tee';
    // two sides: opposite pair is a straight, otherwise a bend
    if (mask === 0x5 || mask === 0xA) return 'line';
    return 'bend';
  }

  /* ============================================================== BUILD == */

  function key(x, y) { return x + ',' + y; }

  /**
   * Carve a self-avoiding run from (sx,sy) to (gx,gy) with a randomised
   * depth-first walk. Backtracking guarantees it finds one on any grid where
   * the two ends are distinct, so the scene is solvable by construction.
   */
  function carveRun(n, sx, sy, gx, gy, rng) {
    var seen = {}, path = [];
    var stack = [[sx, sy, null]];

    while (stack.length) {
      var top = stack[stack.length - 1];
      var x = top[0], y = top[1];

      if (top[2] === null) {
        if (seen[key(x, y)]) { stack.pop(); continue; }
        seen[key(x, y)] = true;
        path.push([x, y]);
        if (x === gx && y === gy) return path;

        // Shuffle, but lean towards the goal. A purely random walk on a 6x6
        // will happily snake through every cell in the grid, which turns a
        // puzzle into an afternoon of clicking.
        var here = Math.abs(x - gx) + Math.abs(y - gy);
        var ranked = [];
        for (var q2 = 0; q2 < 4; q2++) {
          var tx = x + DX[q2], ty = y + DY[q2];
          var closer = (Math.abs(tx - gx) + Math.abs(ty - gy)) < here;
          ranked.push({ d: q2, s: (closer ? 0.55 : 0) + rng.float() });
        }
        ranked.sort(function (p, r) { return p.s - r.s; });
        top[2] = ranked.map(function (o) { return o.d; });   // popped from the end
      }

      if (!top[2].length) {
        seen[key(x, y)] = false;
        path.pop();
        stack.pop();
        continue;
      }

      var d = top[2].pop();
      var nx = x + DX[d], ny = y + DY[d];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      if (seen[key(nx, ny)]) continue;
      stack.push([nx, ny, null]);
    }
    return null;
  }

  function build(state, rng, tier, skin) {
    var C = CONTENT[skin.id] || CONTENT.dead_substation;
    var t = Math.min(6, tier);
    var n = Math.min(6, 4 + Math.floor((t - 1) / 2));       // 4 at T1-2 up to 6 at T5-6
    var x, y, i, d;

    var cells = {};   // "x,y" -> { x, y, mask, rot, fixed, role }

    function at(cx, cy) { return cells[key(cx, cy)] || null; }
    function touch(cx, cy) {
      var c = at(cx, cy);
      if (!c) { c = { x: cx, y: cy, mask: 0, rot: 0, fixed: false, role: null }; cells[key(cx, cy)] = c; }
      return c;
    }
    function link(ax, ay, d2) {
      var a = touch(ax, ay);
      var b = touch(ax + DX[d2], ay + DY[d2]);
      a.mask |= 1 << d2;
      b.mask |= 1 << ((d2 + 2) & 3);
    }

    /* --- the trunk run: left edge to right edge -------------------------- */
    var sy = rng.int(0, n - 1);
    var gy = rng.int(0, n - 1);

    // Carve a few candidate runs and keep the one closest to a target length.
    // Too short and there is nothing to turn; too long and it is an afternoon
    // of clicking rather than a puzzle.
    var target = n + 2 + t;
    var run = null, best = 1e9;
    for (i = 0; i < 5; i++) {
      var cand = carveRun(n, 0, sy, n - 1, gy, rng);
      if (!cand || cand.length < 2) continue;
      var score = Math.abs(cand.length - target) + (cand.length < n + 1 ? 6 : 0);
      if (score < best) { best = score; run = cand; }
    }

    if (!run) {
      // Impossible in practice, but a dead scene is unacceptable: lay a
      // straight row instead.
      run = [];
      for (x = 0; x < n; x++) run.push([x, sy]);
      gy = sy;
    }
    for (i = 0; i + 1 < run.length; i++) {
      var dx = run[i + 1][0] - run[i][0], dy = run[i + 1][1] - run[i][1];
      for (d = 0; d < 4; d++) if (DX[d] === dx && DY[d] === dy) link(run[i][0], run[i][1], d);
    }

    var onRun = {};
    for (i = 0; i < run.length; i++) onRun[key(run[i][0], run[i][1])] = true;

    /* --- spurs: short branches off the trunk ending at a secondary fitting */
    var bonus = [];
    var spurCount = Math.min(2, Math.max(1, t - 1));
    for (var s = 0; s < spurCount; s++) {
      var anchors = rng.shuffle(run.slice(1, run.length - 1));
      var placed = false;
      for (var a = 0; a < anchors.length && !placed; a++) {
        var ax = anchors[a][0], ay = anchors[a][1];
        var dirs = rng.shuffle([0, 1, 2, 3]);
        for (var q = 0; q < dirs.length && !placed; q++) {
          d = dirs[q];
          var bx = ax + DX[d], by = ay + DY[d];
          if (bx < 0 || by < 0 || bx >= n || by >= n) continue;
          if (at(bx, by)) continue;                 // never overwrite the run
          link(ax, ay, d);
          var node = touch(bx, by);
          node.role = 'spur';
          node.fixed = true;
          bonus.push({ x: bx, y: by });
          placed = true;
        }
      }
    }

    /* --- roles + scramble ------------------------------------------------ */
    var src = at(0, sy), dst = at(n - 1, gy);
    src.role = 'source'; src.fixed = true;
    dst.role = 'load';   dst.fixed = true;

    var list = [];
    for (y = 0; y < n; y++) {
      for (x = 0; x < n; x++) {
        var c = at(x, y);
        if (!c) continue;
        c.shape = shapeOf(c.mask);
        list.push(c);
      }
    }

    var probe = { cells: cells, source: { x: 0, y: sy }, load: { x: n - 1, y: gy } };
    var minMoves = 0, attempt;

    // Spin every free section out of true, then confirm the load really did
    // go dark. A scramble can occasionally leave an accidental second route
    // standing, and a board that arrives already solved is not a puzzle.
    for (attempt = 0; attempt < 16; attempt++) {
      minMoves = 0;
      for (i = 0; i < list.length; i++) {
        if (list[i].fixed) continue;
        var opts = [];
        for (var r = 1; r < 4; r++) if (rotateMask(list[i].mask, r) !== list[i].mask) opts.push(r);
        list[i].rot = opts.length ? rng.pick(opts) : 0;
        minMoves += turnsToSolve(list[i]);
      }
      if (minMoves > 0 && !energised(probe)[key(n - 1, gy)]) break;
    }

    // Belt and braces: if sixteen scrambles could not break the run (only
    // possible on a degenerate board of rotation-symmetric tiles), nudge one
    // section by hand so there is always at least one turn to make.
    if (minMoves === 0) {
      for (i = 0; i < list.length; i++) {
        if (list[i].fixed) continue;
        var alt = [];
        for (var rr = 1; rr < 4; rr++) if (rotateMask(list[i].mask, rr) !== list[i].mask) alt.push(rr);
        if (!alt.length) continue;
        list[i].rot = alt[0];
        minMoves = turnsToSolve(list[i]);
        break;
      }
    }

    return {
      tier: t,
      n: n,
      cells: cells,
      order: list,
      source: { x: 0, y: sy },
      load: { x: n - 1, y: gy },
      bonus: bonus,
      minMoves: minMoves,
      moves: 0,
      solved: false,
      content: C
    };
  }

  /* ------------------------------------------------------------ power flow */

  /** Flood from the source through matched connections. Returns a live set. */
  function energised(puzzle) {
    var live = {};
    var start = key(puzzle.source.x, puzzle.source.y);
    if (!puzzle.cells[start]) return live;
    var q = [puzzle.cells[start]], head = 0;
    live[start] = true;

    while (head < q.length) {
      var c = q[head++];
      var m = liveMask(c);
      for (var d = 0; d < 4; d++) {
        if (!(m & (1 << d))) continue;
        var nb = puzzle.cells[key(c.x + DX[d], c.y + DY[d])];
        if (!nb) continue;
        if (!(liveMask(nb) & (1 << ((d + 2) & 3)))) continue;   // must face back
        var k = key(nb.x, nb.y);
        if (live[k]) continue;
        live[k] = true;
        q.push(nb);
      }
    }
    return live;
  }

  function bonusLit(puzzle, live) {
    var n = 0;
    for (var i = 0; i < puzzle.bonus.length; i++) {
      if (live[key(puzzle.bonus[i].x, puzzle.bonus[i].y)]) n++;
    }
    return n;
  }

  /* ====================================================== ARENA GEOMETRY ==
     The substation stops being a grid you click and becomes a floor you walk.
     One junction every two tiles, plant lattice in between, so restoring the
     run is a physical circuit of the room. Cell (cx,cy) -> tile (2+2cx,2+2cy). */

  var SPAN = 2;
  function tileX(cx) { return 2 + cx * SPAN; }
  function tileY(cy) { return 2 + cy * SPAN; }

  function floorPlan(n) {
    var w = n * SPAN + 3, tiles = [], x, y;
    for (y = 0; y < w; y++) {
      tiles.push([]);
      for (x = 0; x < w; x++) {
        var edge = x === 0 || y === 0 || x === w - 1 || y === w - 1;
        // Standing plant between every four junctions. Corridors run along
        // every even row and column, so everything stays reachable.
        var pillar = (x & 1) === 1 && (y & 1) === 1 && x >= 3 && y >= 3 && x <= w - 4 && y <= w - 4;
        tiles[y].push(edge || pillar ? 1 : 0);
      }
    }
    return { w: w, h: w, tiles: tiles };
  }

  /* Orientation is the whole puzzle, so a junction is drawn as the sides it
     currently connects. Light strokes are dead metal; heavy strokes carry. */

  var THIN = {
    0: '\u00B7', 1: '\u2575', 2: '\u2576', 4: '\u2577', 8: '\u2574',
    5: '\u2502', 10: '\u2500', 3: '\u2514', 6: '\u250C', 12: '\u2510', 9: '\u2518',
    7: '\u251C', 14: '\u252C', 13: '\u2524', 11: '\u2534', 15: '\u253C'
  };
  var BOLD = {
    0: '\u00B7', 1: '\u2579', 2: '\u257A', 4: '\u257B', 8: '\u2578',
    5: '\u2503', 10: '\u2501', 3: '\u2517', 6: '\u250F', 12: '\u2513', 9: '\u251B',
    7: '\u2523', 14: '\u2533', 13: '\u252B', 11: '\u253B', 15: '\u254B'
  };

  var DEAD_TINT = '#39424f';

  /**
   * The light mask radius. This engine is the Director's light restore — it is
   * force-routed here whenever light drops under 15 — so the floor is legible
   * at zero light by construction. What the dark takes is reach, not the
   * puzzle: every section you energise lights itself and the room with it.
   */
  function arenaRadius(light) {
    var l = light < 0 ? 0 : (light > 100 ? 100 : light);
    return 2.05 + (l / 100) * 2.75;
  }

  /* ================================================================ CSS == */

  var CSS = [
    '.pz-circ{display:flex;flex-direction:column;gap:12px}',

    '.pz-circ-tips{display:flex;flex-wrap:wrap;gap:14px;align-items:center;font-size:12px;color:var(--dim);line-height:1.6}',
    '.pz-circ-tips strong{color:var(--text-2);font-weight:600}',
    '.pz-circ-cap{font-family:var(--font-mono);font-size:10.5px;padding:2px 7px;border-radius:5px;',
    '  background:#0c1016;border:1px solid var(--line);border-bottom-width:2px;color:var(--text-2)}',

    '.pz-circ-key{display:flex;flex-wrap:wrap;gap:11px;font-size:11px;color:var(--dim)}',
    '.pz-circ-key span{display:inline-flex;gap:5px;align-items:center}',

    '.pz-circ-mimic{display:grid;gap:3px;padding:8px;border-radius:9px;background:#05070a;',
    '  border:1px solid var(--line);box-shadow:inset 0 0 40px rgba(0,0,0,.8);margin-bottom:11px}',
    '.pz-circ-dot{min-height:14px;aspect-ratio:1/1;border-radius:3px;background:#0b1017;border:1px solid #161d28;',
    '  display:grid;place-items:center;font-size:9px;color:var(--dimmer);',
    '  transition:background .22s var(--ease),box-shadow .22s var(--ease)}',
    '.pz-circ-dot.is-void{opacity:.14}',
    '.pz-circ-dot.is-live{background:var(--acc-wash);border-color:var(--acc);color:var(--acc-2);',
    '  box-shadow:0 0 9px var(--acc-glow)}',

    '.pz-circ-read{display:flex;flex-direction:column;gap:6px}',
    '.pz-circ-read__r{display:flex;justify-content:space-between;gap:12px;',
    '  font-family:var(--font-mono);font-size:11px;color:var(--dim)}',
    '.pz-circ-read__r b{color:var(--acc-2)}',
    '.pz-circ-read__r.is-bad b{color:var(--bad)}',

    '.pz-circ-dark{font-size:12px;line-height:1.55;color:var(--warn);padding:9px 11px;border-radius:7px;',
    '  background:rgba(230,180,85,.08);border:1px solid rgba(230,180,85,.3);margin-bottom:11px}',

    '.pz-circ-arrive{font-size:13px;line-height:1.6;color:var(--text-2);margin:2px 0 11px}',
    '.pz-circ-arrive b{color:var(--acc-2)}'
  ].join('\n');

  /* ================================================================ MOUNT = */

  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var C = puzzle.content;
    var n = puzzle.n;
    var finished = false;
    var arena = null;

    var junc = {};          // "x,y" -> handle for every network cell
    var segs = [];          // decorative conduit between adjacent cells
    var loadStation = null;
    var panel = null;       // built the first time you walk to the load
    var lastLive = -1;

    var wrap = h('div', { class: 'pz-circ' });
    var stage = h('div', {});
    var tips = h('div', { class: 'pz-circ-tips' }, [
      h('span', {}, [
        h('b', { class: 'pz-circ-cap', text: 'W A S D' }), ' / ',
        h('b', { class: 'pz-circ-cap', text: '\u2190\u2191\u2193\u2192' }),
        ' walk \u00B7 hold or click the ', h('strong', { text: 'mouse' }), ' to go there \u00B7 ',
        h('b', { class: 'pz-circ-cap', text: 'E' }), ' turns the section you are standing at'
      ]),
      h('div', { class: 'pz-circ-key' }, [
        h('span', {}, [C.sourceIcon, ' ' + C.sourceName + ' \u2014 always live']),
        h('span', {}, [C.loadIcon, ' ' + C.loadName + ' \u2014 walk here to draw the power']),
        h('span', {}, [C.spurIcon, ' ' + C.spurName + ' \u2014 optional, worth extra light'])
      ])
    ]);
    PS.ui.append(wrap, [stage, tips]);
    PS.ui.append(el, wrap);

    /* ------------------------------------------------------- degraded mode --
       arena.js is core and always present, but a missing layer must never
       strand the player in a scene they cannot leave.                        */
    if (!PS.arena || typeof PS.arena.create !== 'function') {
      PS.ui.append(stage, [
        h('div', { class: 'pz-intro', text: C.live }),
        h('div', { class: 'pz-choices' }, [
          branchBtn('\uD83D\uDCE1', C.beacon, C.beaconDesc, 'signal'),
          branchBtn('\uD83C\uDFEE', C.hand, C.handDesc, 'crawl')
        ])
      ]);
      return;
    }

    /* -------------------------------------------------------------- arena -- */

    arena = PS.arena.create(stage, {
      map: floorPlan(n),
      spawn: { x: 1, y: tileY(puzzle.source.y) },
      avatar: '\uD83E\uDDCD',
      light: state.stats.light,
      lightCurve: arenaRadius,
      darkness: 0.93,
      memory: 0.36
    });
    if (!arena) return;
    teardownFns.push(function () { if (arena) { arena.destroy(); arena = null; } });

    // You have the plan of this building in your head whether the lamp works
    // or not. The dark takes the detail, and every section you connect gives
    // a little of it back.
    arena.revealAll();

    /* --------------------------------------------------------------- HUD --- */

    var mPower = arena.meter('Run', '\u26A1');
    var cLoad = arena.chip(C.loadName, C.loadIcon);
    var cTurns = arena.chip('Turns', '\uD83D\uDD27');
    var cSpur = arena.chip(C.spurName + 's', C.spurIcon);

    arena.note('Walk to a ' + C.unit + ' and press E to turn it. Power spreads from the ' +
      C.sourceName.toLowerCase() + ' \u2014 and lights the room as it goes.');
    arena.button('\u21A9 Leave it dead', walkAway, 'pz-btn--danger');

    /* ------------------------------------------------------------ the room - */

    for (var i = 0; i < puzzle.order.length; i++) addCell(puzzle.order[i]);
    addSegments();

    function addCell(c) {
      var tx = tileX(c.x), ty = tileY(c.y);

      if (c.role === 'load') {
        loadStation = arena.station({
          x: tx, y: ty, icon: C.loadIcon, label: C.loadName,
          hint: 'the draw panel', radius: 1.3, emits: 0,
          onEnter: buildPanel
        });
        junc[key(c.x, c.y)] = loadStation;
        return;
      }

      var fixed = !!c.fixed;
      junc[key(c.x, c.y)] = arena.prop({
        x: tx, y: ty,
        icon: fixed ? (c.role === 'source' ? C.sourceIcon : C.spurIcon) : (THIN[liveMask(c)] || '\u00B7'),
        label: fixed ? (c.role === 'source' ? C.sourceName : C.spurName) : C.unit,
        hint: fixed ? 'bolted down' : 'E \u00B7 quarter turn',
        trigger: 'press', once: false, botSkip: fixed,
        radius: 0.9, glow: false, emits: 0, tint: DEAD_TINT,
        onActivate: function () { if (fixed) bolted(c); else turn(c); }
      });
    }

    /** A coupling on the floor between two neighbouring sections. Decorative:
        radius is too small to ever become the nearest thing, so it never
        steals the E prompt from the junction you are standing at. */
    function addSegments() {
      for (var s = 0; s < puzzle.order.length; s++) {
        var c = puzzle.order[s];
        for (var q = 0; q < 2; q++) {
          var d = q === 0 ? 1 : 2;                       // east and south only
          var nb = puzzle.cells[key(c.x + DX[d], c.y + DY[d])];
          if (!nb) continue;
          segs.push({
            a: c, b: nb, d: d,
            raw: arena.prop({
              x: tileX(c.x) + DX[d], y: tileY(c.y) + DY[d],
              icon: '', trigger: 'press', once: false, botSkip: true,
              radius: 0.001, glow: false, emits: 0, tint: DEAD_TINT
            }).raw
          });
        }
      }
    }

    /* ------------------------------------------------------------- actions - */

    function turn(c) {
      if (finished || puzzle.solved || c.fixed) return;
      c.rot = (c.rot + 1) & 3;
      puzzle.moves++;
      arena.dust(tileX(c.x), tileY(c.y), 5, '#f6d08a');
      paint();
    }

    function bolted(c) {
      if (finished) return;
      api.toast(c.role === 'source'
        ? C.live
        : 'The ' + C.spurName.toLowerCase() + ' is bolted down. Feed it and it comes up on its own.', 'info', 2600);
    }

    /* ------------------------------------------------------------- render -- */

    function paint() {
      if (!arena || finished) return;

      var live = energised(puzzle);
      var liveCount = 0, i, c, hnd, isLive;

      for (i = 0; i < puzzle.order.length; i++) {
        c = puzzle.order[i];
        hnd = junc[key(c.x, c.y)];
        if (!hnd) continue;
        isLive = !!live[key(c.x, c.y)];
        if (isLive) liveCount++;

        if (!c.fixed) hnd.setIcon((isLive ? BOLD : THIN)[liveMask(c)] || '\u00B7');
        hnd.raw.tint = isLive ? null : DEAD_TINT;     // null falls back to the skin accent
        hnd.raw.glow = isLive;
        hnd.raw.emits = isLive
          ? (c.role === 'source' ? 2.5 : (c.role === 'load' ? 3.6 : 1.65))
          : 0;
      }

      for (i = 0; i < segs.length; i++) {
        var sg = segs[i];
        var joined = !!(liveMask(sg.a) & (1 << sg.d)) && !!(liveMask(sg.b) & (1 << ((sg.d + 2) & 3)));
        var hot = joined && !!live[key(sg.a.x, sg.a.y)] && !!live[key(sg.b.x, sg.b.y)];
        sg.raw.icon = joined
          ? (sg.d === 1 ? (hot ? '\u2501' : '\u2500') : (hot ? '\u2503' : '\u2502'))
          : '';
        sg.raw.tint = hot ? null : DEAD_TINT;
        sg.raw.emits = hot ? 0.85 : 0;
      }

      var powered = !!live[key(puzzle.load.x, puzzle.load.y)];
      var lit = bonusLit(puzzle, live);
      var total = puzzle.order.length;

      mPower.set(Math.round(liveCount / total * 100), liveCount + ' / ' + total + ' live',
        powered ? 'good' : (liveCount > 1 ? null : 'bad'));
      cLoad.set(powered ? 'live' : 'dead', powered ? 'good' : 'bad');
      cTurns.set(puzzle.moves + ' / ' + puzzle.minMoves + ' ref');
      cSpur.set(lit + ' / ' + puzzle.bonus.length);

      // Presentation only. The run's own light stat is not touched until
      // finish() pays out — this is the room brightening, not the player.
      arena.setLight(Math.min(100, state.stats.light + liveCount * 7));

      if (liveCount > lastLive && lastLive >= 0 && !powered) {
        arena.ping(tileX(puzzle.source.x), tileY(puzzle.source.y));
      }
      lastLive = liveCount;

      paintPanel(live, powered, lit);

      if (powered && !puzzle.solved) {
        puzzle.solved = true;
        api.flash();
        api.toast(C.done, 'good', 3400);
        arena.shake(5, 0.42);
        arena.ping(tileX(puzzle.load.x), tileY(puzzle.load.y));
        arena.dust(tileX(puzzle.load.x), tileY(puzzle.load.y), 14, '#f6d08a');
        if (loadStation) loadStation.solve();
      }
    }

    /* -------------------------------------------------- the load's panel --- */

    function buildPanel(panelEl) {
      panel = { note: h('div', {}), dots: {}, read: h('div', { class: 'pz-circ-read' }), draw: h('div', { class: 'pz-col' }) };
      var mimic = h('div', {
        class: 'pz-circ-mimic',
        style: { gridTemplateColumns: 'repeat(' + n + ', 1fr)' }
      });

      for (var y = 0; y < n; y++) {
        for (var x = 0; x < n; x++) {
          var c = puzzle.cells[key(x, y)];
          var dot = h('div', { class: 'pz-circ-dot' + (c ? '' : ' is-void'), text: c ? roleIcon(c) : '' });
          panel.dots[key(x, y)] = dot;
          mimic.appendChild(dot);
        }
      }

      PS.ui.append(panelEl, [panel.note, mimic, panel.read, panel.draw]);
      paint();
    }

    function roleIcon(c) {
      if (c.role === 'source') return C.sourceIcon;
      if (c.role === 'load') return C.loadIcon;
      if (c.role === 'spur') return C.spurIcon;
      return '';
    }

    function paintPanel(live, powered, lit) {
      if (!panel) return;
      var x, y, k;

      for (y = 0; y < n; y++) {
        for (x = 0; x < n; x++) {
          k = key(x, y);
          if (!panel.dots[k]) continue;
          panel.dots[k].className = 'pz-circ-dot' +
            (puzzle.cells[k] ? (live[k] ? ' is-live' : '') : ' is-void');
        }
      }

      PS.ui.clear(panel.note);
      if (!powered && state.stats.light < 15) {
        panel.note.appendChild(h('div', { class: 'pz-circ-dark' }, [
          'You are doing this by feel and by the glow off the live side. It still works: the ',
          C.sourceName.toLowerCase(), ' is the only thing lit, and the light spreads as you connect it.'
        ]));
      }

      PS.ui.clear(panel.read);
      PS.ui.append(panel.read, [
        row(C.loadName, powered ? 'live' : 'dead', !powered),
        row(C.spurName + 's', lit + ' of ' + puzzle.bonus.length, false),
        row('Quarter turns made', String(puzzle.moves), false),
        row('Reference solution', puzzle.minMoves + ' turns', false)
      ]);

      PS.ui.clear(panel.draw);
      if (!powered) {
        PS.ui.append(panel.draw, h('div', { class: 'pz-note' }, [
          'Nothing to draw yet. Walk the run back toward the ', C.sourceName.toLowerCase(),
          ' and turn whatever is out of true.'
        ]));
        return;
      }

      PS.ui.append(panel.draw, [
        h('div', { class: 'pz-circ-arrive' }, [
          C.done + ' ',
          h('b', { text: String(puzzle.moves) }), ' turns against a reference of ',
          h('b', { text: String(puzzle.minMoves) }),
          lit ? ', and ' + lit + ' ' + C.spurName.toLowerCase() + (lit === 1 ? '' : 's') + ' came up with it.' : '.'
        ]),
        h('div', { class: 'pz-choices' }, [
          branchBtn('\uD83D\uDCE1', C.beacon, C.beaconDesc, 'signal'),
          branchBtn('\uD83C\uDFEE', C.hand, C.handDesc, 'crawl')
        ])
      ]);

      function row(k2, v, bad) {
        return h('div', { class: 'pz-circ-read__r' + (bad ? ' is-bad' : '') },
          [h('span', { text: k2 }), h('b', { text: v })]);
      }
    }

    /* ------------------------------------------------------------ endings -- */

    function branchBtn(ic, title, desc, id) {
      return h('button', { class: 'pz-choice', type: 'button', onclick: function () { finishRun(id); } }, [
        h('div', { class: 'pz-choice__i', text: ic }),
        h('div', { class: 'pz-choice__t', text: title }),
        h('div', { class: 'pz-choice__d', text: desc })
      ]);
    }

    function finishRun(mode) {
      if (finished) return;
      finished = true;

      var live = energised(puzzle);
      var lit = bonusLit(puzzle, live);
      var clean = puzzle.moves <= Math.ceil(puzzle.minMoves * 1.5);

      // The single biggest light swing in the game. The beacon is brighter;
      // the hand lamp is portable and comes with you as a real item.
      var lightGain = (mode === 'signal' ? 62 : 44) + lit * 7;

      api.finish({
        outcome: clean ? 'success' : 'partial',
        stats: {
          light: lightGain,
          energy: -(4 + Math.round(puzzle.moves / 4)),
          morale: mode === 'signal' ? 12 : 8,
          health: 0
        },
        gain: mode === 'crawl' ? ['lamp'] : ['battery'],
        lose: [],
        tags: ['power_restored'].concat(mode === 'signal' ? ['lit_the_beacon', 'made_a_signal'] : ['kept_it_dark']),
        signals: {
          logic: clean ? 4 : 2,
          speed: puzzle.moves <= puzzle.minMoves ? 3 : 0,
          caution: mode === 'crawl' ? 3 : 0,
          scavenge: mode === 'crawl' ? 1 : 0
        },
        choice: mode,
        summary: (mode === 'signal'
          ? 'You put the whole load into the ' + C.loadName.toLowerCase() + ' and lit up half the district'
          : 'You took the light with you in one hand and left the rest of it dark') +
          ' \u2014 ' + puzzle.moves + ' turns.'
      });
    }

    function walkAway() {
      if (finished) return;
      finished = true;
      api.finish({
        outcome: 'fail',
        stats: { light: -6, energy: -8, morale: -10 },
        gain: [], lose: [], tags: ['left_it_dead'],
        signals: { caution: 1 },
        choice: null,
        summary: 'You left the ' + C.loadName.toLowerCase() + ' dead and felt your way onward.'
      });
    }

    paint();
    arena.focus();
  }

  function unmount() {
    while (teardownFns.length) {
      try { teardownFns.pop()(); } catch (e) { /* keep unwinding */ }
    }
  }

  /* ================================================================ HINT = */

  function hint(puzzle) {
    var live = energised(puzzle);
    var C = puzzle.content;

    // The most useful nudge is the first tile on the live frontier that is
    // still pointing the wrong way.
    var best = null;
    for (var i = 0; i < puzzle.order.length; i++) {
      var c = puzzle.order[i];
      if (c.fixed) continue;
      var need = turnsToSolve(c);
      if (!need) continue;
      var adjacentToLive = false;
      for (var d = 0; d < 4; d++) {
        if (live[key(c.x + DX[d], c.y + DY[d])]) adjacentToLive = true;
      }
      if (adjacentToLive) { best = c; break; }
      if (!best) best = c;
    }
    if (!best) {
      return live[key(puzzle.load.x, puzzle.load.y)]
        ? 'It is already live. Decide what to do with it.'
        : 'Every section is in true. Follow the run from the ' + C.sourceName.toLowerCase() + ' and look for a gap.';
    }
    var turns = turnsToSolve(best);
    var shape = best.shape === 'end' ? 'stub' : best.shape;
    return 'Row ' + (best.y + 1) + ', column ' + (best.x + 1) + ' is out of true by ' + turns +
      ' quarter turn' + (turns === 1 ? '' : 's') + '. It is a ' + shape + '.';
  }

  /* ============================================================ AUTOSOLVE = */
  /* Headless: the solved orientation is known by construction, so the bot
     simply reports the reference solution and picks a branch. */

  function autoSolve(puzzle, rng) {
    var mode = rng.chance(0.5) ? 'signal' : 'crawl';
    var lit = puzzle.bonus.length;
    var lightGain = (mode === 'signal' ? 62 : 44) + lit * 7;

    return {
      outcome: 'success',
      stats: {
        light: lightGain,
        energy: -(4 + Math.round(puzzle.minMoves / 4)),
        morale: mode === 'signal' ? 12 : 8
      },
      gain: mode === 'crawl' ? ['lamp'] : ['battery'],
      lose: [],
      tags: ['power_restored'].concat(mode === 'signal' ? ['lit_the_beacon', 'made_a_signal'] : ['kept_it_dark']),
      signals: { logic: 4, speed: 3, caution: mode === 'crawl' ? 3 : 0 },
      choice: mode,
      summary: 'Turned every section into true in ' + puzzle.minMoves + ' and the load came up.'
    };
  }

  /* ============================================================ REGISTER = */

  PS.registry.register({
    id: 'circuit_rotation',
    name: 'Circuit Rotation',
    icon: '\u26A1',
    blurb: 'Every section is the right section and every section is pointing the wrong way.',

    favors:   { logic: 3, speed: 1 },
    provides: ['light_source', 'power', 'fire'],
    tagHooks: ['power_restored', 'has_lamp'],
    requires: function () { return true; },

    css: CSS,

    skins: [
      {
        id: 'dead_substation', biome: 'industrial', title: 'The Dead Substation',
        icon: '\u26A1', palette: 'rust',
        intro: 'Everything in here hums except the part that matters. The incoming feeder is still live \u2014 you can hear it, a low note under the floor \u2014 but somebody has pulled the busbar sections and left them lying at whatever angle they landed. The yard beyond the fence has been dark for a long time.',
        nouns: { source: 'the feeder', load: 'the floodlights', unit: 'busbar section' }
      },
      {
        id: 'coolant_pipes', biome: 'industrial', title: 'Coolant Gallery',
        icon: '\uD83C\uDF21\uFE0F', palette: 'steel',
        intro: 'The gallery is forty degrees and climbing, and the reason is written on every gauge you pass. The header tank is full. The exchanger below it is not getting a drop, because two shifts ago somebody dismantled the ring main and never came back to put it together.',
        nouns: { source: 'the header', load: 'the exchanger', unit: 'pipe run' }
      },
      {
        id: 'irrigation_channels', biome: 'wilderness', title: 'The Dry Channels',
        icon: '\uD83C\uDF31', palette: 'moss',
        intro: 'The head race is running full and loud and going nowhere, because every gate in the field system is standing at whatever angle the last flood left it. Down at the end of it is a pump house with a generator in it, and a generator is a light you can see from the road.',
        nouns: { source: 'the sluice', load: 'the pump house', unit: 'channel gate' }
      }
    ],

    build: build,
    mount: mount,
    unmount: unmount,
    hint: hint,
    autoSolve: autoSolve
  });

})(typeof window !== 'undefined' ? window : this);
