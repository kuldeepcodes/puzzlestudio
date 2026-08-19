/* ==========================================================================
   PuzzleStudio — js/games/e02_grid_crawl.js          ENGINE 02 · Grid Crawl
   --------------------------------------------------------------------------
   REFERENCE IMPLEMENTATION #2. Self-contained: logic + 3 skins + its own CSS.
   No DOM access until mount().

   THE PUZZLE
     A seeded maze. You can see a radius around you and nothing else, and the
     radius is a function of the run's LIGHT stat — which this engine drains
     on every single step. Fuel caches restore it, but they are deliberately
     placed off the shortest path, so every run is the same question:
     beeline and arrive blind, or detour and arrive late but able to see.

     Light at zero does not stop you. It costs blood instead.

   THE BRANCH
     Reaching the exit is not the end: the shaft splits. Descend or climb.
     That choice is what the Director reads next.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio;
  if (!PS || !PS.registry) { if (root.console) console.error('[e02] core not loaded'); return; }

  /* ======================================================== SKIN CONTENT == */

  var CONTENT = {
    dark_tunnel: {
      floor: '\u00B7', fuelIcon: '\uD83D\uDD6F\uFE0F', itemIcon: '\uD83C\uDF92',
      hazardIcon: '\uD83D\uDCA7', exitIcon: '\uD83E\uDE9C', playerIcon: '\uD83E\uDDCD',
      fuelName: 'torch fuel', hazardName: 'flooded cut',
      fuelLine: 'A capped tin of lamp oil, still half full.',
      hazardLine: 'You go in to the thigh in cold black water.',
      arrive: 'The shaft splits at the far end.',
      down: { icon: '\uD83D\uDD73\uFE0F', title: 'Take the lower drift', desc: 'It goes down and it goes on. Away from whatever came in behind you.' },
      up:   { icon: '\uD83E\uDDD7', title: 'Climb the ladder shaft', desc: 'Forty rungs of wet steel toward something that might be daylight.' }
    },
    smoke_corridor: {
      floor: '\u00B7', fuelIcon: '\uD83D\uDD26', itemIcon: '\uD83E\uDDF0',
      hazardIcon: '\uD83D\uDD25', exitIcon: '\uD83D\uDEAA', playerIcon: '\uD83E\uDDCD',
      fuelName: 'emergency lamp', hazardName: 'hot section',
      fuelLine: 'A wall lamp still on its charger. You take it.',
      hazardLine: 'The air here is hot enough to hurt going in.',
      arrive: 'The corridor ends at a stairwell door.',
      down: { icon: '\uD83D\uDD3D', title: 'Go down the stairwell', desc: 'The smoke is going up. Logically, you should not.' },
      up:   { icon: '\uD83D\uDD3C', title: 'Go up to the roof', desc: 'Above the smoke there is air, and people can see you.' }
    },
    whiteout_field: {
      floor: '\u00B7', fuelIcon: '\uD83E\uDDE8', itemIcon: '\uD83C\uDF92',
      hazardIcon: '\uD83D\uDD73\uFE0F', exitIcon: '\uD83C\uDFD4\uFE0F', playerIcon: '\uD83E\uDDCD',
      fuelName: 'marker flare', hazardName: 'drift hollow',
      fuelLine: 'A flare cache on a bamboo pole, exactly where the map said.',
      hazardLine: 'The crust gives and you go in to the waist.',
      arrive: 'The ground drops away ahead of you.',
      down: { icon: '\u26F0\uFE0F', title: 'Drop into the couloir', desc: 'Steep, sheltered, and it loses height fast.' },
      up:   { icon: '\uD83E\uDDD7', title: 'Traverse the ridge', desc: 'Exposed to the wind but you would see anything coming for miles.' }
    }
  };

  var LOOT = ['rope', 'battery', 'ration', 'blanket', 'matches', 'knife', 'map', 'whistle', 'gloves', 'water'];

  /* ============================================================== BUILD == */

  function key(x, y) { return x + ',' + y; }

  /** Randomised DFS carve on odd cells, then braid a few loops in. */
  function carveMaze(n, rng) {
    var g = [], x, y;
    for (y = 0; y < n; y++) { g.push([]); for (x = 0; x < n; x++) g[y].push(1); }

    var stack = [[1, 1]];
    g[1][1] = 0;
    var DIRS = [[0, -2], [2, 0], [0, 2], [-2, 0]];

    while (stack.length) {
      var cur = stack[stack.length - 1];
      var opts = [];
      for (var i = 0; i < DIRS.length; i++) {
        var nx = cur[0] + DIRS[i][0], ny = cur[1] + DIRS[i][1];
        if (nx > 0 && ny > 0 && nx < n - 1 && ny < n - 1 && g[ny][nx] === 1) opts.push([nx, ny, DIRS[i]]);
      }
      if (!opts.length) { stack.pop(); continue; }
      var pickd = rng.pick(opts);
      g[cur[1] + pickd[2][1] / 2][cur[0] + pickd[2][0] / 2] = 0;
      g[pickd[1]][pickd[0]] = 0;
      stack.push([pickd[0], pickd[1]]);
    }

    // Braiding: knock out interior walls to create loops. A perfect maze has
    // exactly one route, which kills the detour-vs-beeline decision entirely.
    var braids = Math.floor(n * n * 0.05) + 2;
    for (var b = 0; b < braids; b++) {
      for (var guard = 0; guard < 40; guard++) {
        x = rng.int(1, n - 2); y = rng.int(1, n - 2);
        if (g[y][x] !== 1) continue;
        var horiz = g[y][x - 1] === 0 && g[y][x + 1] === 0 && g[y - 1][x] === 1 && g[y + 1][x] === 1;
        var vert  = g[y - 1][x] === 0 && g[y + 1][x] === 0 && g[y][x - 1] === 1 && g[y][x + 1] === 1;
        if (horiz || vert) { g[y][x] = 0; break; }
      }
    }
    return g;
  }

  /** BFS. Returns { dist:{key:n}, path:[[x,y]...] } from start to goal. */
  function bfs(grid, n, sx, sy, gx, gy) {
    var dist = {}, prev = {}, q = [[sx, sy]], head = 0;
    dist[key(sx, sy)] = 0;
    var D = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    while (head < q.length) {
      var c = q[head++];
      if (c[0] === gx && c[1] === gy) break;
      for (var i = 0; i < 4; i++) {
        var nx = c[0] + D[i][0], ny = c[1] + D[i][1];
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
        if (grid[ny][nx] === 1) continue;
        var k = key(nx, ny);
        if (dist[k] !== undefined) continue;
        dist[k] = dist[key(c[0], c[1])] + 1;
        prev[k] = c;
        q.push([nx, ny]);
      }
    }
    var path = [];
    if (dist[key(gx, gy)] !== undefined) {
      var cur = [gx, gy];
      while (cur) { path.unshift(cur); cur = prev[key(cur[0], cur[1])]; }
    }
    return { dist: dist, path: path };
  }

  function build(state, rng, tier, skin) {
    var C = CONTENT[skin.id] || CONTENT.dark_tunnel;

    // Clamp everything that scales a cost or a size. Runs are infinite; a
    // 40x40 maze that drains 30 light a step is not a puzzle, it is a wall.
    var t = Math.min(6, tier);

    var n = Math.min(13, 7 + (t - 1) * 2);
    if (n % 2 === 0) n += 1;

    var grid, solved, guard = 0;
    do {
      grid = carveMaze(n, rng);
      grid[n - 2][n - 2] = 0;
      solved = bfs(grid, n, 1, 1, n - 2, n - 2);
      guard++;
    } while (!solved.path.length && guard < 8);

    if (!solved.path.length) {
      // Pathological seed: cut a guaranteed L-shaped corridor so the scene is
      // always winnable. Never leave the player in a maze with no exit.
      for (var i = 1; i < n - 1; i++) { grid[1][i] = 0; grid[i][n - 2] = 0; }
      solved = bfs(grid, n, 1, 1, n - 2, n - 2);
    }

    var onPath = {};
    for (i = 0; i < solved.path.length; i++) onPath[key(solved.path[i][0], solved.path[i][1])] = true;

    /* --- feature placement, biased OFF the shortest path ------------------ */
    var open = [];
    for (var y = 1; y < n - 1; y++) {
      for (var x = 1; x < n - 1; x++) {
        if (grid[y][x] !== 0) continue;
        if (x === 1 && y === 1) continue;
        if (x === n - 2 && y === n - 2) continue;
        open.push([x, y]);
      }
    }

    var features = {};
    var fuelCount   = Math.max(2, 5 - t);
    var itemCount   = Math.max(1, 3 - Math.floor(t / 2));
    var hazardCount = Math.min(open.length - fuelCount - itemCount, t + 1);

    function place(kind, count, payloadFn, preferOffPath) {
      for (var c = 0; c < count && open.length; c++) {
        var cell = rng.weighted(open, function (p) {
          var off = !onPath[key(p[0], p[1])];
          var far = Math.abs(p[0] - 1) + Math.abs(p[1] - 1);
          return (preferOffPath ? (off ? 5 : 1) : 1) * (1 + far * 0.08);
        });
        if (!cell) break;
        open.splice(open.indexOf(cell), 1);
        features[key(cell[0], cell[1])] = { kind: kind, payload: payloadFn(c), taken: false };
      }
    }

    var lootPool = rng.shuffle(LOOT);
    place('fuel', fuelCount, function () { return 16 + rng.int(0, 10); }, true);
    place('item', itemCount, function (c) { return lootPool[c % lootPool.length]; }, true);
    place('hazard', hazardCount, function () { return 3 + t * 2; }, false);

    return {
      n: n,
      grid: grid,
      features: features,
      x: 1, y: 1,
      exit: [n - 2, n - 2],
      seen: (function () { var s = {}; s[key(1, 1)] = true; return s; })(),
      moves: 0,
      optimal: Math.max(1, solved.path.length - 1),
      drain: 2 + t,
      blindCost: 2 + t,
      pickups: 0,
      itemsTaken: [],
      hazardsHit: 0,
      arrived: false,
      tier: t,
      content: C
    };
  }

  /* --------------------------------------------------------- light rules -- */

  function radiusFor(light) {
    if (light <= 0) return 0;
    if (light >= 70) return 3;
    if (light >= 38) return 2;
    return 1;
  }

  /* ================================================================ CSS == */

  var CSS = [
    '.pz-crawl{display:grid;grid-template-columns:minmax(0,1fr) minmax(232px,300px);gap:18px;align-items:start}',
    '@media (max-width:820px){.pz-crawl{grid-template-columns:1fr}}',

    '.pz-crawl-board{display:grid;gap:3px;padding:12px;border-radius:12px;background:#05070a;',
    '  border:1px solid var(--line);box-shadow:inset 0 0 70px rgba(0,0,0,.9);',
    '  width:100%;max-width:560px;aspect-ratio:1/1;margin:0 auto}',
    '.pz-crawl-cell{position:relative;display:grid;place-items:center;border-radius:4px;',
    '  font-size:clamp(9px,2.1vw,17px);line-height:1;background:#080b10;color:var(--dimmer);',
    '  border:1px solid transparent;transition:background .25s var(--ease),opacity .25s var(--ease),color .25s var(--ease)}',
    '.pz-crawl-cell.is-unknown{background:#04060a;color:transparent}',
    '.pz-crawl-cell.is-wall{background:#141922;border-color:#1c222c}',
    '.pz-crawl-cell.is-wall.is-unknown{background:#05070b;border-color:transparent}',
    '.pz-crawl-cell.is-mem{opacity:.42}',
    '.pz-crawl-cell.is-lit{background:#101722;color:var(--text-2);',
    '  box-shadow:0 0 12px color-mix(in srgb,var(--acc) 16%,transparent)}',
    '.pz-crawl-cell.is-lit.is-wall{background:#1b222d}',
    '.pz-crawl-cell.is-step{cursor:pointer;border-color:color-mix(in srgb,var(--acc) 55%,transparent)}',
    '.pz-crawl-cell.is-step:hover{background:var(--acc-wash);transform:scale(1.06)}',
    '.pz-crawl-cell.is-player{background:radial-gradient(circle,var(--acc-wash),transparent 72%);',
    '  color:var(--text);box-shadow:0 0 22px var(--acc-glow);z-index:2}',
    '.pz-crawl-cell.is-exit{color:var(--acc-2)}',
    '.pz-crawl-cell.is-exit.is-lit{background:color-mix(in srgb,var(--acc) 22%,#101722)}',

    '.pz-crawl-dpad{display:grid;grid-template-columns:repeat(3,44px);grid-template-rows:repeat(3,44px);',
    '  gap:6px;justify-content:center}',
    '.pz-crawl-dpad button{border-radius:9px;border:1px solid var(--line);font-size:15px;',
    '  background:linear-gradient(180deg,var(--panel-3),var(--panel-2));color:var(--text)}',
    '.pz-crawl-dpad button:hover:not(:disabled){border-color:var(--acc)}',
    '.pz-crawl-dpad button:disabled{opacity:.25}',
    '.pz-crawl-dpad .sp{visibility:hidden}',

    '.pz-crawl-meter{display:flex;flex-direction:column;gap:6px}',
    '.pz-crawl-meter__row{display:flex;justify-content:space-between;font-family:var(--font-mono);',
    '  font-size:11px;color:var(--dim)}',
    '.pz-crawl-meter__row b{color:var(--acc-2)}',

    '.pz-crawl-warn{font-size:12px;line-height:1.5;color:var(--bad);padding:9px 11px;border-radius:7px;',
    '  background:rgba(226,105,95,.08);border:1px solid rgba(226,105,95,.28)}',

    '.pz-crawl-legend{display:flex;flex-wrap:wrap;gap:8px;font-size:11px;color:var(--dim)}',
    '.pz-crawl-legend span{display:inline-flex;gap:5px;align-items:center}',

    '.pz-crawl-flash{animation:pzCrawlFlash .5s var(--ease)}',
    '@keyframes pzCrawlFlash{0%{box-shadow:inset 0 0 0 rgba(0,0,0,0)}30%{box-shadow:inset 0 0 90px var(--acc-glow)}100%{box-shadow:inset 0 0 70px rgba(0,0,0,.9)}}'
  ].join('\n');

  /* ================================================================ MOUNT = */

  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var C = puzzle.content;
    var n = puzzle.n;
    var cells = {};
    var finished = false;

    var board = h('div', {
      class: 'pz-crawl-board',
      style: { gridTemplateColumns: 'repeat(' + n + ', 1fr)', gridTemplateRows: 'repeat(' + n + ', 1fr)' }
    });

    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        (function (cx, cy) {
          var c = h('div', { class: 'pz-crawl-cell' });
          c.addEventListener('click', function () { tryStep(cx, cy); });
          cells[key(cx, cy)] = c;
          board.appendChild(c);
        })(x, y);
      }
    }

    /* ------------------------------------------------------------ readout -- */
    var meter = h('div', { class: 'pz-crawl-meter' });
    var warnBox = h('div', {});
    var controls = h('div', { class: 'pz-col' });

    function glyph(x, y) {
      if (puzzle.x === x && puzzle.y === y) return C.playerIcon;
      if (x === puzzle.exit[0] && y === puzzle.exit[1]) return C.exitIcon;
      if (puzzle.grid[y][x] === 1) return '';
      var f = puzzle.features[key(x, y)];
      if (f && !f.taken) {
        if (f.kind === 'fuel') return C.fuelIcon;
        if (f.kind === 'item') return C.itemIcon;
        if (f.kind === 'hazard') return C.hazardIcon;
      }
      return C.floor;
    }

    function paint() {
      var r = radiusFor(state.stats.light);
      for (var yy = 0; yy < n; yy++) {
        for (var xx = 0; xx < n; xx++) {
          var k = key(xx, yy);
          var c = cells[k];
          var d = Math.max(Math.abs(xx - puzzle.x), Math.abs(yy - puzzle.y));
          var lit = d <= r;
          var isPlayer = xx === puzzle.x && yy === puzzle.y;
          if (lit || isPlayer) puzzle.seen[k] = true;

          var known = !!puzzle.seen[k];
          var cls = 'pz-crawl-cell';
          if (puzzle.grid[yy][xx] === 1) cls += ' is-wall';
          if (!known) cls += ' is-unknown';
          else if (lit || isPlayer) cls += ' is-lit';
          else cls += ' is-mem';
          if (isPlayer) cls += ' is-player';
          if (xx === puzzle.exit[0] && yy === puzzle.exit[1]) cls += ' is-exit';

          var adjacent = (Math.abs(xx - puzzle.x) + Math.abs(yy - puzzle.y)) === 1;
          if (!finished && adjacent && puzzle.grid[yy][xx] === 0) cls += ' is-step';

          c.className = cls;
          c.textContent = known ? glyph(xx, yy) : '';
        }
      }
      paintMeter();
    }

    function paintMeter() {
      PS.ui.clear(meter);
      var r = radiusFor(state.stats.light);
      PS.ui.append(meter, [
        row('Light', state.stats.light + ' / 100'),
        row('Sight radius', r === 0 ? 'blind' : r + ' cell' + (r === 1 ? '' : 's')),
        row('Cost per step', state.stats.light > 0 ? '\uD83D\uDD26 ' + puzzle.drain : '\u2764\uFE0F ' + puzzle.blindCost),
        row('Steps taken', String(puzzle.moves)),
        row('Best possible', puzzle.optimal + ' steps'),
        row('Caches found', String(puzzle.pickups))
      ]);
      PS.ui.clear(warnBox);
      if (state.stats.light <= 0) {
        warnBox.appendChild(h('div', { class: 'pz-crawl-warn' },
          ['Your light is dead. You are feeling along the wall now, and every step costs blood.']));
      } else if (state.stats.light < puzzle.drain * 4) {
        warnBox.appendChild(h('div', { class: 'pz-crawl-warn' },
          ['Four steps of light left. Find a ' + C.fuelName + ' or commit to the dark.']));
      }
      function row(k, v) {
        return h('div', { class: 'pz-crawl-meter__row' }, [h('span', { text: k }), h('b', { text: v })]);
      }
    }

    /* ------------------------------------------------------------- moving -- */

    function tryStep(x, y) {
      if (finished || puzzle.arrived) return;
      if (Math.abs(x - puzzle.x) + Math.abs(y - puzzle.y) !== 1) return;
      if (x < 0 || y < 0 || x >= n || y >= n) return;
      if (puzzle.grid[y][x] === 1) { api.toast('Blocked.', 'bad', 1100); return; }
      step(x, y);
    }

    function step(x, y) {
      puzzle.x = x; puzzle.y = y; puzzle.moves++;

      if (state.stats.light > 0) api.tweak({ light: -puzzle.drain, energy: -1 });
      else api.tweak({ health: -puzzle.blindCost, energy: -1, morale: -1 });

      var f = puzzle.features[key(x, y)];
      if (f && !f.taken) {
        f.taken = true;
        if (f.kind === 'fuel') {
          puzzle.pickups++;
          api.tweak({ light: f.payload, morale: 3 });
          api.toast(C.fuelLine, 'good');
          board.classList.remove('pz-crawl-flash'); void board.offsetWidth; board.classList.add('pz-crawl-flash');
        } else if (f.kind === 'item') {
          puzzle.pickups++;
          puzzle.itemsTaken.push(f.payload);
          api.tweak(null, [f.payload]);
          api.toast('You take the ' + PS.state.itemInfo(f.payload).name.toLowerCase() + '.', 'good');
        } else if (f.kind === 'hazard') {
          puzzle.hazardsHit++;
          api.tweak({ health: -f.payload, energy: -3 });
          api.toast(C.hazardLine, 'bad');
        }
      }

      if (x === puzzle.exit[0] && y === puzzle.exit[1]) {
        puzzle.arrived = true;
        paint();
        renderExitChoice();
        return;
      }
      paint();
    }

    function onKey(ev) {
      var map = {
        ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
        w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
        W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0]
      };
      var m = map[ev.key];
      if (!m) return;
      ev.preventDefault();
      tryStep(puzzle.x + m[0], puzzle.y + m[1]);
    }
    document.addEventListener('keydown', onKey);
    teardownFns.push(function () { document.removeEventListener('keydown', onKey); });

    /* -------------------------------------------------------------- d-pad -- */
    var dpadBtns = {};
    function dpad() {
      function b(dx, dy, label) {
        var btn = h('button', { type: 'button', text: label });
        btn.addEventListener('click', function () { tryStep(puzzle.x + dx, puzzle.y + dy); });
        dpadBtns[dx + ':' + dy] = btn;
        return btn;
      }
      return h('div', { class: 'pz-crawl-dpad' }, [
        h('div', { class: 'sp' }), b(0, -1, '\u25B2'), h('div', { class: 'sp' }),
        b(-1, 0, '\u25C0'), h('div', { class: 'sp' }), b(1, 0, '\u25B6'),
        h('div', { class: 'sp' }), b(0, 1, '\u25BC'), h('div', { class: 'sp' })
      ]);
    }

    /* ------------------------------------------------------------ endings -- */

    function renderExitChoice() {
      PS.ui.clear(controls);
      PS.ui.append(controls, [
        h('div', { class: 'pz-intro', text: C.arrive + ' You made it in ' + puzzle.moves + ' steps; the shortest line was ' + puzzle.optimal + '.' }),
        h('div', { class: 'pz-choices' }, [
          choiceBtn(C.down, 'descend'),
          choiceBtn(C.up, 'climb')
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
      var blind = state.stats.light <= 0;
      var efficient = puzzle.moves <= Math.ceil(puzzle.optimal * 1.25);
      var thorough = puzzle.pickups >= 2;

      api.finish({
        outcome: blind ? 'partial' : 'success',
        stats: blind ? { morale: -4, health: -2 } : { morale: 7 },
        gain: [], lose: [],
        tags: ['crossed_the_dark'].concat(blind ? ['went_blind'] : []).concat(thorough ? ['stripped_the_route'] : []),
        signals: {
          caution: thorough ? 2 : 1,
          speed: efficient ? 3 : 0,
          scavenge: puzzle.pickups,
          logic: puzzle.hazardsHit === 0 ? 1 : 0
        },
        choice: choice,
        summary: (blind
          ? 'You came out of it blind, with both hands on the wall'
          : 'You found the far side with light to spare')
          + ' \u2014 ' + puzzle.moves + ' steps, ' + puzzle.pickups + ' cache' + (puzzle.pickups === 1 ? '' : 's') + '.'
      });
    }

    function giveUp() {
      if (finished) return;
      finished = true;
      api.finish({
        outcome: 'fail',
        stats: { energy: -10, morale: -9, health: -3 },
        gain: [], lose: [],
        tags: ['turned_back'],
        signals: { caution: 2, scavenge: puzzle.pickups },
        choice: null,
        summary: 'You turned back and took a longer way around in the dark.'
      });
    }

    /* ------------------------------------------------------------- layout -- */
    PS.ui.append(controls, [
      dpad(),
      h('div', { class: 'pz-crawl-legend' }, [
        h('span', {}, [C.fuelIcon, ' ' + C.fuelName]),
        h('span', {}, [C.itemIcon, ' supplies']),
        h('span', {}, [C.hazardIcon, ' ' + C.hazardName]),
        h('span', {}, [C.exitIcon, ' way out'])
      ]),
      h('button', {
        class: 'pz-btn pz-btn--danger pz-btn--sm', type: 'button',
        onclick: giveUp
      }, ['\u21A9 Turn back'])
    ]);

    PS.ui.append(el, h('div', { class: 'pz-crawl' }, [
      h('div', { class: 'pz-col' }, [
        board,
        h('div', { class: 'pz-note' }, [
          'Arrow keys, WASD, or click a neighbouring cell. Fuel caches sit ',
          h('strong', { text: 'off' }), ' the direct line \u2014 that is the whole decision.'
        ])
      ]),
      h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'Position' }),
          meter
        ]),
        warnBox,
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'Move' }),
          controls
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

  function hint(puzzle, state) {
    var sol = bfs(puzzle.grid, puzzle.n, puzzle.x, puzzle.y, puzzle.exit[0], puzzle.exit[1]);
    var left = sol.path.length ? sol.path.length - 1 : null;
    if (left === null) return 'There is no clean line from here. Backtrack.';

    var need = left * puzzle.drain;
    if (state.stats.light < need) {
      var fuels = [];
      for (var k in puzzle.features) {
        if (puzzle.features[k].kind === 'fuel' && !puzzle.features[k].taken) fuels.push(k);
      }
      if (fuels.length) {
        var best = null, bestD = 1e9;
        for (var i = 0; i < fuels.length; i++) {
          var p = fuels[i].split(',');
          var d = Math.abs(p[0] - puzzle.x) + Math.abs(p[1] - puzzle.y);
          if (d < bestD) { bestD = d; best = p; }
        }
        return 'The exit is ' + left + ' steps away and you only have light for ' +
          Math.floor(state.stats.light / puzzle.drain) + '. There is a ' + puzzle.content.fuelName +
          ' about ' + bestD + ' steps ' + compass(best[0] - puzzle.x, best[1] - puzzle.y) + '.';
      }
      return 'The exit is ' + left + ' steps away and you cannot light all of them. Commit or turn back.';
    }
    if (sol.path.length > 1) {
      var nx = sol.path[1];
      return 'Exit is ' + left + ' steps. Go ' + compass(nx[0] - puzzle.x, nx[1] - puzzle.y) + ' from here.';
    }
    return 'You are standing on it.';
  }

  function compass(dx, dy) {
    var v = dy < 0 ? 'north' : dy > 0 ? 'south' : '';
    var hh = dx < 0 ? 'west' : dx > 0 ? 'east' : '';
    return (v + (v && hh ? '-' : '') + hh) || 'nowhere';
  }

  /* ============================================================ AUTOSOLVE = */
  /* Headless. Simulates the beeline and reports what it would have cost. */

  function autoSolve(puzzle, rng, state) {
    var sol = bfs(puzzle.grid, puzzle.n, puzzle.x, puzzle.y, puzzle.exit[0], puzzle.exit[1]);
    var steps = sol.path.length ? sol.path.length - 1 : puzzle.optimal;
    var light = state ? state.stats.light : 100;
    var blind = (light - steps * puzzle.drain) <= 0;
    var choice = rng.chance(0.5) ? 'descend' : 'climb';

    return {
      outcome: blind ? 'partial' : 'success',
      stats: blind
        ? { light: -light, health: -(4 + puzzle.tier), energy: -steps, morale: -4 }
        : { light: -(steps * puzzle.drain), energy: -steps, morale: 7 },
      tags: ['crossed_the_dark'].concat(blind ? ['went_blind'] : []),
      signals: { caution: 1, speed: 3, scavenge: 0, logic: 1 },
      choice: choice,
      summary: 'Straight line to the far side in ' + steps + ' steps.'
    };
  }

  /* ============================================================ REGISTER = */

  PS.registry.register({
    id: 'grid_crawl',
    name: 'Grid Crawl',
    icon: '\uD83D\uDD6F\uFE0F',
    blurb: 'Cross a dark maze on a light budget. The fuel is never on your way.',

    favors:   { caution: 2, logic: 1, speed: 1, scavenge: 1 },
    provides: ['light_source', 'map', 'salvage', 'crossing'],
    tagHooks: ['has_lamp', 'has_map', 'went_down'],
    requires: function (state) { return state.stats.energy > 10; },

    css: CSS,

    skins: [
      {
        id: 'dark_tunnel', biome: 'underground', title: 'The Dark Tunnel',
        icon: '\uD83D\uDD6F\uFE0F', palette: 'amber',
        intro: 'The hatch clangs shut above you and the sound goes a very long way. Whatever is down here, the only light in it is yours.',
        nouns: { resource: 'torch fuel', exit: 'the shaft', hazard: 'flooded cut' }
      },
      {
        id: 'smoke_corridor', biome: 'indoor', title: 'Smoke-Filled Corridor',
        icon: '\uD83D\uDD25', palette: 'ash',
        intro: 'Visibility is about a metre and dropping. Stay low, count the doors, and do not open the warm ones.',
        nouns: { resource: 'emergency lamp', exit: 'the stairwell', hazard: 'hot section' }
      },
      {
        id: 'whiteout_field', biome: 'wilderness', title: 'Whiteout Snowfield',
        icon: '\u2744\uFE0F', palette: 'ice',
        intro: 'Ground and sky are the same colour. The marker poles are out there somewhere, and so is the edge.',
        nouns: { resource: 'marker flare', exit: 'the col', hazard: 'drift hollow' }
      }
    ],

    build: build,
    mount: mount,
    unmount: unmount,
    hint: hint,
    autoSolve: autoSolve
  });

})(typeof window !== 'undefined' ? window : this);
