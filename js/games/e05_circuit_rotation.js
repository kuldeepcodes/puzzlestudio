/* ==========================================================================
   PuzzleStudio — js/games/e05_circuit_rotation.js
                                                ENGINE 05 · Circuit Rotation
   --------------------------------------------------------------------------
   Self-contained: logic + 3 skins + its own CSS. No DOM access until mount().

   THE PUZZLE
     A grid of conduit sections between a live source and a dead load. Every
     section is the right section; every section is pointing the wrong way.
     Click one to turn it a quarter turn. Get a continuous run from the
     source to the load and the thing at the end of it wakes up.

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
     biggest single light swing in the game.

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

  /* ================================================================ CSS == */

  var CSS = [
    '.pz-circ{display:grid;grid-template-columns:minmax(0,1fr) minmax(232px,300px);gap:18px;align-items:start}',
    '@media (max-width:860px){.pz-circ{grid-template-columns:1fr}}',

    '.pz-circ-board{display:grid;gap:4px;padding:12px;border-radius:12px;background:#05070a;',
    '  border:1px solid var(--line);box-shadow:inset 0 0 60px rgba(0,0,0,.85);',
    '  width:100%;max-width:520px;aspect-ratio:1/1;margin:0 auto}',
    '.pz-circ-cell{position:relative;border-radius:6px;background:#0a0e14;border:1px solid #141a24;',
    '  padding:0;cursor:default;overflow:hidden}',
    '.pz-circ-cell.is-live{background:#0d141d;border-color:color-mix(in srgb,var(--acc) 42%,#141a24)}',
    '.pz-circ-cell.is-turnable{cursor:pointer}',
    '.pz-circ-cell.is-turnable:hover{border-color:var(--acc);background:#121a24}',
    '.pz-circ-cell.is-fixed{background:#0d1119;border-color:#1e2634}',
    '.pz-circ-cell:disabled{cursor:default}',

    '.pz-circ-pipe{position:absolute;background:#3a4353;border-radius:3px;',
    '  transition:background .22s var(--ease),box-shadow .22s var(--ease)}',
    '.pz-circ-cell.is-live .pz-circ-pipe{background:var(--acc);box-shadow:0 0 10px var(--acc-glow)}',
    '.pz-circ-pipe.hub{left:38%;top:38%;width:24%;height:24%;border-radius:50%}',
    '.pz-circ-pipe.n{left:43%;top:0;width:14%;height:54%}',
    '.pz-circ-pipe.s{left:43%;top:46%;width:14%;height:54%}',
    '.pz-circ-pipe.w{left:0;top:43%;width:54%;height:14%}',
    '.pz-circ-pipe.e{left:46%;top:43%;width:54%;height:14%}',

    '.pz-circ-node{position:absolute;inset:0;display:grid;place-items:center;font-size:clamp(11px,2.4vw,19px);',
    '  z-index:2;color:var(--dimmer);transition:color .22s var(--ease),text-shadow .22s var(--ease)}',
    '.pz-circ-cell.is-live .pz-circ-node{color:var(--acc-2);text-shadow:0 0 12px var(--acc-glow)}',

    '.pz-circ-board.is-dim{filter:saturate(.55) brightness(.86)}',
    '.pz-circ-board.is-done{box-shadow:inset 0 0 70px var(--acc-glow);animation:pzCircWake .7s var(--ease)}',
    '@keyframes pzCircWake{0%{box-shadow:inset 0 0 0 rgba(0,0,0,0)}45%{box-shadow:inset 0 0 130px var(--acc-glow)}100%{box-shadow:inset 0 0 70px var(--acc-glow)}}',

    '.pz-circ-read{display:flex;flex-direction:column;gap:6px}',
    '.pz-circ-read__r{display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:11px;color:var(--dim)}',
    '.pz-circ-read__r b{color:var(--acc-2)}',
    '.pz-circ-read__r.is-bad b{color:var(--bad)}',

    '.pz-circ-key{display:flex;flex-direction:column;gap:6px;font-size:11px;color:var(--dim);line-height:1.5}',
    '.pz-circ-key span{display:inline-flex;gap:6px;align-items:center}',

    '.pz-circ-dark{font-size:12px;line-height:1.55;color:var(--warn);padding:9px 11px;border-radius:7px;',
    '  background:rgba(230,180,85,.08);border:1px solid rgba(230,180,85,.3)}'
  ].join('\n');

  /* ================================================================ MOUNT = */

  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var C = puzzle.content;
    var n = puzzle.n;
    var finished = false;
    var nodes = {};

    var board = h('div', {
      class: 'pz-circ-board',
      style: { gridTemplateColumns: 'repeat(' + n + ', 1fr)', gridTemplateRows: 'repeat(' + n + ', 1fr)' }
    });

    var readout = h('div', { class: 'pz-circ-read' });
    var darkBox = h('div', {});
    var actions = h('div', { class: 'pz-col' });

    /* --------------------------------------------------------- build grid */
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        (function (cx, cy) {
          var c = puzzle.cells[key(cx, cy)];
          var cell = h('button', {
            type: 'button',
            class: 'pz-circ-cell' + (c ? (c.fixed ? ' is-fixed' : ' is-turnable') : ''),
            disabled: !c || c.fixed,
            title: c ? (c.fixed ? 'Bolted down.' : 'Turn this ' + C.unit) : 'Empty casing.'
          });
          if (c) cell.addEventListener('click', function () { turn(c); });
          nodes[key(cx, cy)] = cell;
          board.appendChild(cell);
        })(x, y);
      }
    }

    /* ------------------------------------------------------------- render */

    function paintCell(c, cell, live) {
      PS.ui.clear(cell);
      if (!c) { cell.className = 'pz-circ-cell'; return; }
      var m = liveMask(c);
      var isLive = !!live[key(c.x, c.y)];

      cell.className = 'pz-circ-cell' +
        (isLive ? ' is-live' : '') +
        (c.fixed ? ' is-fixed' : ' is-turnable');

      cell.appendChild(h('span', { class: 'pz-circ-pipe hub' }));
      if (m & 1) cell.appendChild(h('span', { class: 'pz-circ-pipe n' }));
      if (m & 2) cell.appendChild(h('span', { class: 'pz-circ-pipe e' }));
      if (m & 4) cell.appendChild(h('span', { class: 'pz-circ-pipe s' }));
      if (m & 8) cell.appendChild(h('span', { class: 'pz-circ-pipe w' }));

      if (c.role === 'source') cell.appendChild(h('span', { class: 'pz-circ-node', text: C.sourceIcon }));
      else if (c.role === 'load') cell.appendChild(h('span', { class: 'pz-circ-node', text: C.loadIcon }));
      else if (c.role === 'spur') cell.appendChild(h('span', { class: 'pz-circ-node', text: C.spurIcon }));
    }

    function paint() {
      var live = energised(puzzle);
      for (var yy = 0; yy < n; yy++) {
        for (var xx = 0; xx < n; xx++) {
          paintCell(puzzle.cells[key(xx, yy)], nodes[key(xx, yy)], live);
        }
      }

      var powered = !!live[key(puzzle.load.x, puzzle.load.y)];
      var lit = bonusLit(puzzle, live);

      PS.ui.clear(readout);
      PS.ui.append(readout, [
        row(C.loadName, powered ? 'live' : 'dead', !powered),
        row(C.spurName + 's', lit + ' of ' + puzzle.bonus.length, false),
        row('Quarter turns made', String(puzzle.moves), false),
        row('Reference solution', puzzle.minMoves + ' turns', false)
      ]);

      board.classList.toggle('is-dim', state.stats.light < 15 && !powered);
      board.classList.toggle('is-done', powered);

      PS.ui.clear(darkBox);
      if (!powered && state.stats.light < 15) {
        darkBox.appendChild(h('div', { class: 'pz-circ-dark' },
          ['You are doing this by feel and by the glow off the live side. ',
           'It still works: the ', C.sourceName.toLowerCase(), ' is the only thing lit, and light spreads as you connect it.']));
      }

      if (powered && !puzzle.solved) {
        puzzle.solved = true;
        api.flash();
        api.toast(C.done, 'good', 3400);
        renderBranch(lit);
      }

      function row(k, v, bad) {
        return h('div', { class: 'pz-circ-read__r' + (bad ? ' is-bad' : '') },
          [h('span', { text: k }), h('b', { text: v })]);
      }
    }

    /* ------------------------------------------------------------ actions */

    function turn(c) {
      if (finished || puzzle.solved || c.fixed) return;
      c.rot = (c.rot + 1) & 3;
      puzzle.moves++;
      paint();
    }

    function renderBranch(lit) {
      PS.ui.clear(actions);
      PS.ui.append(actions, [
        h('div', { class: 'pz-intro', text: C.done + ' ' + puzzle.moves + ' turns against a reference of ' +
          puzzle.minMoves + (lit ? ', and ' + lit + ' ' + C.spurName.toLowerCase() + (lit === 1 ? '' : 's') + ' came up with it.' : '.') }),
        h('div', { class: 'pz-choices' }, [
          branchBtn('\uD83D\uDCE1', C.beacon, C.beaconDesc, 'signal'),
          branchBtn('\uD83C\uDFEE', C.hand, C.handDesc, 'crawl')
        ])
      ]);
    }

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

    /* ------------------------------------------------------------- layout */

    PS.ui.append(actions, [
      h('button', { class: 'pz-btn pz-btn--danger pz-btn--sm', type: 'button', onclick: walkAway },
        ['\u21A9 Leave it dead'])
    ]);

    PS.ui.append(el, h('div', { class: 'pz-circ' }, [
      h('div', { class: 'pz-col' }, [
        board,
        h('div', { class: 'pz-note' }, [
          'Click any section to turn it a quarter turn. ',
          h('strong', { text: C.sourceName + ' and ' + C.loadName.toLowerCase() + ' are bolted down' }),
          ' \u2014 everything between them is not.'
        ])
      ]),
      h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'Panel' }),
          readout
        ]),
        darkBox,
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'Legend' }),
          h('div', { class: 'pz-circ-key' }, [
            h('span', {}, [C.sourceIcon, ' ' + C.sourceName + ' \u2014 always live']),
            h('span', {}, [C.loadIcon, ' ' + C.loadName + ' \u2014 what you are trying to wake']),
            h('span', {}, [C.spurIcon, ' ' + C.spurName + ' \u2014 optional, worth extra light'])
          ])
        ]),
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'Draw' }),
          actions
        ])
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
