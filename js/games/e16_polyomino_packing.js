/* ==========================================================================
   PuzzleStudio — js/games/e16_polyomino_packing.js  ENGINE 16 · Packing
   --------------------------------------------------------------------------
   Self-contained: logic + 3 skins + its own CSS. No DOM access until mount().

   THE PUZZLE
     A fixed bay and a pile of awkward shapes lying around it on the dock. You
     walk out to a piece, pick it up, turn it in your hands until it looks
     right, then carry it in and stand on the square its corner goes in.
     Nothing may overlap and nothing may hang over the edge.

   WHY IT IS ALWAYS SOLVABLE
     The bay is generated BACKWARDS. It starts completely full, gets cut into
     connected polyominoes, and only then are the pieces rotated at random and
     shuffled into the tray. A perfect packing therefore exists by
     construction — and an exact-cover search re-proves it before the puzzle
     is ever served, which also gives the hint something real to say.

   THE CHOICE THAT MATTERS
     From tier 3 the dock holds one or two MORE pieces than the bay can take.
     Everything you get out is everything you packed, so the puzzle stops
     being "can you fit it" and becomes "what are you willing to leave" — and
     now you have to physically walk past what you are leaving behind.

   THE BRANCH
     Loaded, you either move the load yourself or hand it over to be moved.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio;
  if (!PS || !PS.registry) { if (root.console) console.error('[e16] core not loaded'); return; }

  /* ======================================================== SKIN CONTENT == */

  var CONTENT = {
    cargo_hold: {
      bay: 'load bed', unitName: 'crate', unitPlural: 'crates',
      loose: 'still on the dock',
      commit: 'Drop the tailgate',
      goal: 'Whatever is not on the bed when it pulls out stays here.',
      full: 'The bed is packed square, corner to corner. Not a hand-width wasted.',
      partial: 'It will travel, but there is daylight in the load and things will shift.',
      badLine: 'Half of it is still on the dock and the driver will not wait.',
      items: ['battery', 'crowbar', 'tape', 'radio', 'gloves', 'manual', 'rope', 'canister', 'mask', 'wire'],
      haul: { icon: '\uD83D\uDE9A', title: 'Drive it out yourself', desc: 'Through the service barrier if it comes to that. Nobody signs anything.' },
      hand: { icon: '\uD83E\uDD1D', title: 'Hand the manifest over', desc: 'They move it, they take a cut, and they owe you a name at the far end.' }
    },
    lifeboat: {
      bay: 'stern locker', unitName: 'kit', unitPlural: 'kits',
      loose: 'on the deck',
      commit: 'Cast off',
      goal: 'The locker is the boat. What does not go in it does not come.',
      full: 'Every kit stowed flush. The boat sits level and the lid shuts.',
      partial: 'The lid will not sit down properly and the trim is off, but she floats.',
      badLine: 'You cast off with the locker half empty and the deck awash.',
      items: ['water', 'ration', 'blanket', 'flare', 'whistle', 'medkit', 'boots', 'rope', 'knife', 'radio'],
      haul: { icon: '\uD83D\uDEA3', title: 'Pull for the light yourself', desc: 'Four hours on the oars, but you choose the heading and you choose the speed.' },
      hand: { icon: '\uD83E\uDD1D', title: 'Raft up with the other boat', desc: 'Share the load, share the water, and share whatever they decide.' }
    },
    mine_cart: {
      bay: 'cart bed', unitName: 'load', unitPlural: 'loads',
      loose: 'left at the face',
      commit: 'Send the cart up',
      goal: 'One cart, one trip. The winch will not come back down for you.',
      full: 'Packed tight to the boards. Nothing will shift on the incline.',
      partial: 'It is loaded loose. Some of it will be on the floor by the top.',
      badLine: 'The cart goes up nearly empty and the good stuff stays at the face.',
      items: ['lamp', 'fuel', 'matches', 'rope', 'knife', 'magnet', 'canister', 'battery', 'gloves', 'pin'],
      haul: { icon: '\uD83D\uDCAA', title: 'Walk the incline behind it', desc: 'Nine hundred metres of wet timber, and you keep your hand on the load.' },
      hand: { icon: '\uD83E\uDD1D', title: 'Send it up and shout for the cage', desc: 'Someone at the top takes delivery. You have to trust that there is someone at the top.' }
    }
  };

  /* ============================================================== SHAPES == */

  function normalize(cells) {
    var minR = Infinity, minC = Infinity, i;
    for (i = 0; i < cells.length; i++) {
      if (cells[i][0] < minR) minR = cells[i][0];
      if (cells[i][1] < minC) minC = cells[i][1];
    }
    var out = [];
    for (i = 0; i < cells.length; i++) out.push([cells[i][0] - minR, cells[i][1] - minC]);
    out.sort(function (a, b) { return (a[0] - b[0]) || (a[1] - b[1]); });
    return out;
  }

  function shapeKey(cells) {
    var s = [];
    for (var i = 0; i < cells.length; i++) s.push(cells[i][0] + '.' + cells[i][1]);
    return s.join('|');
  }

  function rotateCells(cells) {
    var maxR = 0, i;
    for (i = 0; i < cells.length; i++) if (cells[i][0] > maxR) maxR = cells[i][0];
    var out = [];
    for (i = 0; i < cells.length; i++) out.push([cells[i][1], maxR - cells[i][0]]);
    return normalize(out);
  }

  /** A shape plus everything the placer needs: bounds and the row-major-first
   *  cell, which is the cell the player's click is anchored to. */
  function makeVariant(cells) {
    var h = 0, w = 0, i;
    for (i = 0; i < cells.length; i++) {
      if (cells[i][0] + 1 > h) h = cells[i][0] + 1;
      if (cells[i][1] + 1 > w) w = cells[i][1] + 1;
    }
    return { cells: cells, w: w, h: h, anchorCol: cells[0][1] };
  }

  function variantsFor(cells) {
    var seen = {}, out = [], cur = normalize(cells);
    for (var i = 0; i < 4; i++) {
      var k = shapeKey(cur);
      if (!seen[k]) { seen[k] = true; out.push(makeVariant(cur)); }
      cur = rotateCells(cur);
    }
    return out;
  }

  /* ============================================================== SOLVER == */
  /**
   * Exact cover by backtracking. The first empty cell in row-major order must
   * be covered by SOME piece's row-major-first cell, which collapses the
   * branching factor enormously and makes this fast enough to run inside
   * build() a thousand times.
   *
   * @returns {Array|null} [{ pieceId, rot, row, col }] or null
   */
  function solvePack(W, H, occupied, pieces, budget) {
    var grid = occupied.slice();
    var used = {};
    var out = [];
    var nodes = 0;

    function firstEmpty() {
      for (var k = 0; k < grid.length; k++) if (grid[k] < 0) return k;
      return -1;
    }

    function rec() {
      if (++nodes > budget) return false;
      var k = firstEmpty();
      if (k < 0) return true;
      var r = (k / W) | 0, c = k % W;

      for (var pi = 0; pi < pieces.length; pi++) {
        var p = pieces[pi];
        if (used[p.id]) continue;
        for (var v = 0; v < p.rots.length; v++) {
          var sh = p.rots[v];
          var oc = c - sh.anchorCol;
          if (oc < 0 || r + sh.h > H || oc + sh.w > W) continue;

          var ok = true, idxs = [], ci;
          for (ci = 0; ci < sh.cells.length; ci++) {
            var kk = (r + sh.cells[ci][0]) * W + (oc + sh.cells[ci][1]);
            if (grid[kk] >= 0) { ok = false; break; }
            idxs.push(kk);
          }
          if (!ok) continue;

          for (ci = 0; ci < idxs.length; ci++) grid[idxs[ci]] = p.id;
          used[p.id] = true;
          out.push({ pieceId: p.id, rot: v, row: r, col: oc });
          if (rec()) return true;
          out.pop();
          used[p.id] = false;
          for (ci = 0; ci < idxs.length; ci++) grid[idxs[ci]] = -1;
        }
      }
      return false;
    }

    return rec() ? out.slice() : null;
  }

  /* =============================================================== BUILD == */

  function tierSpec(t) {
    if (t <= 1) return { w: 4, h: 4, sizes: [3, 4], extras: 0 };
    if (t === 2) return { w: 5, h: 4, sizes: [3, 4, 5], extras: 0 };
    if (t === 3) return { w: 5, h: 5, sizes: [3, 4, 5], extras: 1 };
    if (t === 4) return { w: 6, h: 5, sizes: [4, 5], extras: 2 };
    if (t === 5) return { w: 6, h: 6, sizes: [3, 4, 5], extras: 2 };
    return { w: 6, h: 6, sizes: [4, 5], extras: 2 };
  }

  function neighbours(k, W, H) {
    var r = (k / W) | 0, c = k % W, out = [];
    if (r > 0) out.push(k - W);
    if (r < H - 1) out.push(k + W);
    if (c > 0) out.push(k - 1);
    if (c < W - 1) out.push(k + 1);
    return out;
  }

  /** Cut a full bay into connected blobs. This is the "backwards" half. */
  function carveBay(W, H, sizes, rng) {
    var owner = [], k;
    for (k = 0; k < W * H; k++) owner.push(-1);
    var regions = [];

    while (true) {
      var seed = -1;
      for (k = 0; k < owner.length; k++) if (owner[k] < 0) { seed = k; break; }
      if (seed < 0) break;

      var pid = regions.length;
      var want = rng.pick(sizes);
      var region = [seed];
      owner[seed] = pid;
      var frontier = neighbours(seed, W, H).filter(function (n) { return owner[n] < 0; });

      while (region.length < want && frontier.length) {
        var pi = rng.int(0, frontier.length - 1);
        var cell = frontier.splice(pi, 1)[0];
        if (owner[cell] >= 0) continue;
        owner[cell] = pid;
        region.push(cell);
        var nb = neighbours(cell, W, H);
        for (var q = 0; q < nb.length; q++) if (owner[nb[q]] < 0) frontier.push(nb[q]);
      }
      regions.push(region);
    }

    // Single-cell scraps are boring. Fold them into a neighbour when the
    // result is still a sane piece.
    var maxSize = Math.max.apply(null, sizes) + 1;
    for (var pass = 0; pass < 3; pass++) {
      for (var i = 0; i < regions.length; i++) {
        if (regions[i].length !== 1) continue;
        var cellK = regions[i][0];
        var nbs = neighbours(cellK, W, H);
        var target = -1;
        for (var n = 0; n < nbs.length; n++) {
          var o = owner[nbs[n]];
          if (o === i || o < 0) continue;
          if (regions[o].length + 1 <= maxSize) { target = o; break; }
        }
        if (target < 0) continue;
        regions[target].push(cellK);
        owner[cellK] = target;
        regions[i] = [];
      }
    }

    return regions.filter(function (r) { return r.length > 0; });
  }

  function randomPoly(size, rng, maxW, maxH) {
    for (var attempt = 0; attempt < 24; attempt++) {
      var cells = [[0, 0]];
      var seen = { '0,0': true };
      var guard = 0;
      while (cells.length < size && guard++ < 200) {
        var base = cells[rng.int(0, cells.length - 1)];
        var d = rng.pick([[0, 1], [1, 0], [0, -1], [-1, 0]]);
        var nc = [base[0] + d[0], base[1] + d[1]];
        var key = nc[0] + ',' + nc[1];
        if (seen[key]) continue;
        seen[key] = true;
        cells.push(nc);
      }
      var norm = normalize(cells);
      var v = makeVariant(norm);
      if (v.w <= maxW && v.h <= maxH && norm.length === size) return norm;
    }
    return normalize([[0, 0], [0, 1], [1, 0]]);
  }

  /** Fallback partition that cannot fail: horizontal runs, row by row. */
  function stripBay(W, H, rng) {
    var regions = [];
    for (var r = 0; r < H; r++) {
      var c = 0;
      while (c < W) {
        var len = Math.min(W - c, rng.int(2, 4));
        if (W - (c + len) === 1) len = Math.min(W - c, len + 1);
        var reg = [];
        for (var i = 0; i < len; i++) reg.push(r * W + c + i);
        regions.push(reg);
        c += len;
      }
    }
    return regions;
  }

  function build(state, rng, tier, skin) {
    var C = CONTENT[skin.id] || CONTENT.cargo_hold;
    var t = Math.min(6, Math.max(1, tier));
    var spec = tierSpec(t);
    var W = spec.w, H = spec.h;

    var pieces = null, solution = null;

    for (var attempt = 0; attempt < 6 && !solution; attempt++) {
      var regions = attempt < 5 ? carveBay(W, H, spec.sizes, rng) : stripBay(W, H, rng);
      var candidate = [];
      for (var i = 0; i < regions.length; i++) {
        var cells = normalize(regions[i].map(function (k) { return [(k / W) | 0, k % W]; }));
        candidate.push({
          id: i,
          size: cells.length,
          rots: variantsFor(cells),
          rot: 0,
          placed: null,
          decoy: false
        });
      }
      var blank = [];
      for (var b = 0; b < W * H; b++) blank.push(-1);
      solution = solvePack(W, H, blank, candidate, 400000);
      if (solution) pieces = candidate;
    }

    // The strip fallback is always solvable, so this is unreachable in
    // practice — but an engine that can throw is an engine that can kill a run.
    if (!solution) {
      pieces = [];
      solution = [];
      for (var rr = 0; rr < H; rr++) {
        for (var cc = 0; cc < W; cc++) {
          pieces.push({ id: pieces.length, size: 1, rots: variantsFor([[0, 0]]), rot: 0, placed: null, decoy: false });
          solution.push({ pieceId: pieces.length - 1, rot: 0, row: rr, col: cc });
        }
      }
    }

    var realCount = pieces.length;

    // --- decoys: more than the bay can take, so something gets left ---------
    for (var e = 0; e < spec.extras; e++) {
      var sz = rng.pick(spec.sizes);
      pieces.push({
        id: pieces.length,
        size: sz,
        rots: variantsFor(randomPoly(sz, rng, Math.min(W, 4), Math.min(H, 4))),
        rot: 0,
        placed: null,
        decoy: true
      });
    }

    // --- dress every piece as actual cargo ---------------------------------
    var pool = rng.shuffle(C.items);
    for (var p = 0; p < pieces.length; p++) {
      var item = pool[p % pool.length];
      var info = PS.state.itemInfo(item);
      pieces[p].item = item;
      pieces[p].label = info.name;
      pieces[p].icon = info.icon;
      pieces[p].colour = p % 8;
      pieces[p].rot = rng.int(0, pieces[p].rots.length - 1);   // scramble
    }

    var order = rng.shuffle(pieces.map(function (x) { return x.id; }));

    return {
      tier: t,
      content: C,
      w: W, h: H,
      cells: W * H,
      pieces: pieces,
      order: order,
      realCount: realCount,
      extras: spec.extras,
      grid: (function () { var g = []; for (var k = 0; k < W * H; k++) g.push(-1); return g; })(),
      solution: solution,
      filled: 0,
      actions: 0,
      committed: false
    };
  }

  /* ------------------------------------------------------------ mechanics -- */

  function shapeOf(piece) { return piece.rots[piece.rot % piece.rots.length]; }

  function cellsAt(puzzle, piece, row, col) {
    var sh = shapeOf(piece), out = [];
    for (var i = 0; i < sh.cells.length; i++) {
      var r = row + sh.cells[i][0], c = col + sh.cells[i][1];
      if (r < 0 || c < 0 || r >= puzzle.h || c >= puzzle.w) return null;
      out.push(r * puzzle.w + c);
    }
    return out;
  }

  /** Where the piece lands if the player clicks (row, col). */
  function originFor(puzzle, piece, row, col) {
    var sh = shapeOf(piece);
    return { row: row, col: col - sh.anchorCol };
  }

  function canPlace(puzzle, piece, row, col) {
    var o = originFor(puzzle, piece, row, col);
    var idx = cellsAt(puzzle, piece, o.row, o.col);
    if (!idx) return null;
    for (var i = 0; i < idx.length; i++) if (puzzle.grid[idx[i]] >= 0) return null;
    return idx;
  }

  function place(puzzle, piece, row, col) {
    var idx = canPlace(puzzle, piece, row, col);
    if (!idx) return false;
    var o = originFor(puzzle, piece, row, col);
    for (var i = 0; i < idx.length; i++) puzzle.grid[idx[i]] = piece.id;
    piece.placed = { row: o.row, col: o.col, cells: idx };
    puzzle.filled += idx.length;
    return true;
  }

  function lift(puzzle, piece) {
    if (!piece.placed) return false;
    for (var i = 0; i < piece.placed.cells.length; i++) puzzle.grid[piece.placed.cells[i]] = -1;
    puzzle.filled -= piece.placed.cells.length;
    piece.placed = null;
    return true;
  }

  function pieceById(puzzle, id) {
    for (var i = 0; i < puzzle.pieces.length; i++) if (puzzle.pieces[i].id === id) return puzzle.pieces[i];
    return null;
  }

  function placedPieces(puzzle) {
    return puzzle.pieces.filter(function (p) { return !!p.placed; });
  }

  /** Re-prove completability from wherever the board is RIGHT NOW. */
  function solveFromHere(puzzle, budget) {
    var loose = puzzle.pieces.filter(function (p) { return !p.placed; });
    return solvePack(puzzle.w, puzzle.h, puzzle.grid, loose, budget || 150000);
  }

  /* ====================================================== ARENA GEOMETRY ==
     The bay stops being a grid you click and becomes a floor you stand on.
     One board cell is one tile, the loose pieces lie around it on the dock,
     and the only way anything gets stowed is that you walk over, pick it up,
     carry it in and stand on the square its corner goes in. */

  var COLOURS = ['#b5763a', '#4f7f6a', '#5b7fa6', '#8a6aa8', '#a85f56', '#7f8a4f', '#4f8a8a', '#a08a4f'];
  var DOCK_PAD = 4;
  var AVATAR = '\uD83E\uDDCD';

  function dockPlan(W, H) {
    var w = W + DOCK_PAD * 2, hgt = H + DOCK_PAD * 2, tiles = [], x, y;
    for (y = 0; y < hgt; y++) {
      tiles.push([]);
      for (x = 0; x < w; x++) {
        tiles[y].push((x === 0 || y === 0 || x === w - 1 || y === hgt - 1) ? 1 : 0);
      }
    }
    return { w: w, h: hgt, tiles: tiles };
  }

  /** Standing spots for the loose pieces: a ring two tiles off the bay. */
  function dockSpots(W, H, want) {
    var x0 = DOCK_PAD - 2, y0 = DOCK_PAD - 2;
    var x1 = DOCK_PAD + W + 1, y1 = DOCK_PAD + H + 1;
    var ring = [], x, y;
    for (x = x0; x <= x1; x++) ring.push({ x: x, y: y0 });
    for (y = y0 + 1; y <= y1; y++) ring.push({ x: x1, y: y });
    for (x = x1 - 1; x >= x0; x--) ring.push({ x: x, y: y1 });
    for (y = y1 - 1; y > y0; y--) ring.push({ x: x0, y: y });

    var out = [], step;
    for (step = 2; step >= 1; step--) {
      out = [];
      for (var i = 0; i < ring.length && out.length < want; i += step) out.push(ring[i]);
      if (out.length >= want) break;
    }
    while (out.length < want) out.push(ring[out.length % ring.length]);
    return out;
  }

  /** A loading dock has lights. What is hard here is the packing, not seeing. */
  function arenaRadius(light) {
    var l = light < 0 ? 0 : (light > 100 ? 100 : light);
    return 5.2 + (l / 100) * 3.4;
  }

  /* ================================================================ CSS == */

  var CSS = [
    '.pz-pack{display:flex;flex-direction:column;gap:12px}',

    '.pz-pack-tips{display:flex;flex-wrap:wrap;gap:14px;align-items:center;font-size:12px;color:var(--dim);line-height:1.6}',
    '.pz-pack-tips strong{color:var(--text-2);font-weight:600}',
    '.pz-pack-cap{font-family:var(--font-mono);font-size:10.5px;padding:2px 7px;border-radius:5px;',
    '  background:#0c1016;border:1px solid var(--line);border-bottom-width:2px;color:var(--text-2)}',

    '.pz-pack-hand{display:flex;align-items:center;gap:12px;min-height:62px;padding:10px 12px;border-radius:10px;',
    '  background:linear-gradient(180deg,var(--panel-2),var(--panel));border:1px solid var(--line)}',
    '.pz-pack-hand.is-holding{border-color:color-mix(in srgb,var(--acc) 62%,transparent);',
    '  box-shadow:0 0 0 1px color-mix(in srgb,var(--acc) 18%,transparent)}',
    '.pz-pack-hand__t{font-size:13px;font-weight:600;color:var(--text);line-height:1.3}',
    '.pz-pack-hand__d{font-size:11.5px;color:var(--dim);line-height:1.45}',
    '.pz-pack-hand__d b{color:var(--acc-2);font-weight:600}',

    '.pz-pack-tray{display:flex;flex-wrap:wrap;gap:7px}',
    '.pz-pack-item{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;text-align:left;',
    '  padding:7px 9px;border-radius:9px;cursor:pointer;color:var(--text-2);font-family:var(--font-ui);min-width:158px;',
    '  background:linear-gradient(180deg,var(--panel-2),var(--panel));border:1px solid var(--line);',
    '  transition:border-color .18s var(--ease),transform .12s var(--ease),opacity .18s var(--ease)}',
    '.pz-pack-item:hover{border-color:var(--acc);transform:translateY(-2px)}',
    '.pz-pack-item.is-sel{border-color:var(--acc);background:var(--acc-wash);color:var(--text)}',
    '.pz-pack-item.is-stowed{opacity:.5}',
    '.pz-pack-item.is-stowed .pz-pack-mini i{opacity:.55}',

    '.pz-pack-mini{display:grid;gap:2px}',
    '.pz-pack-mini i{width:9px;height:9px;border-radius:2px;background:transparent}',
    '.pz-pack-mini i.on{box-shadow:inset 0 1px 0 rgba(255,255,255,.25)}',
    '.pz-pack-mini i.on.is-c0{background:#b5763a}.pz-pack-mini i.on.is-c1{background:#4f7f6a}',
    '.pz-pack-mini i.on.is-c2{background:#5b7fa6}.pz-pack-mini i.on.is-c3{background:#8a6aa8}',
    '.pz-pack-mini i.on.is-c4{background:#a85f56}.pz-pack-mini i.on.is-c5{background:#7f8a4f}',
    '.pz-pack-mini i.on.is-c6{background:#4f8a8a}.pz-pack-mini i.on.is-c7{background:#a08a4f}',
    '.pz-pack-mini.is-big i{width:13px;height:13px;border-radius:3px}',

    '.pz-pack-name{font-size:12px;line-height:1.35;min-width:0}',
    '.pz-pack-name b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.pz-pack-name span{font-family:var(--font-mono);font-size:10px;color:var(--dimmer)}',
    '.pz-pack-badge{font-size:15px}',

    '.pz-pack-note{font-size:12px;line-height:1.5;color:var(--warn);padding:9px 11px;border-radius:7px;',
    '  background:rgba(230,180,85,.08);border:1px solid rgba(230,180,85,.26)}',
    '.pz-pack-note.is-good{color:var(--good);background:rgba(95,207,141,.08);border-color:rgba(95,207,141,.26)}'
  ].join('\n');

  /* ================================================================ MOUNT = */

  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var C = puzzle.content;
    var W = puzzle.w, H = puzzle.h;
    var finished = false;
    var arena = null;

    var carried = null;              // the piece in your hands, by id
    var bayProps = [];               // one per bay square
    var propOf = {};                 // piece id -> its prop out on the dock
    var spots = {};                  // piece id -> its spot on the dock
    var ghost = { at: -1, rot: -1, cells: null, ok: false };

    var stage = h('div', {});
    var handBox = h('div', { class: 'pz-pack-hand' });
    var noteBox = h('div', {});
    var tray = h('div', { class: 'pz-pack-tray' });
    var endBox = h('div', { class: 'pz-col' });

    PS.ui.append(el, h('div', { class: 'pz-pack' }, [
      h('div', { class: 'pz-intro', text: C.goal }),
      stage,
      h('div', { class: 'pz-pack-tips' }, [
        h('span', {}, [
          h('b', { class: 'pz-pack-cap', text: 'W A S D' }), ' / ',
          h('b', { class: 'pz-pack-cap', text: '\u2190\u2191\u2193\u2192' }), ' walk \u00B7 ',
          h('b', { class: 'pz-pack-cap', text: 'E' }), ' picks up and puts down \u00B7 ',
          h('b', { class: 'pz-pack-cap', text: 'R' }), ' or the ', h('strong', { text: 'wheel' }), ' turns what you are carrying'
        ])
      ]),
      handBox, noteBox, tray, endBox
    ]));

    /* ------------------------------------------------------- degraded mode -- */
    if (!PS.arena || typeof PS.arena.create !== 'function') {
      PS.ui.append(endBox, [
        h('div', { class: 'pz-intro', text: C.partial }),
        h('div', { class: 'pz-choices' }, [choiceBtn(C.haul, 'force_door'), choiceBtn(C.hand, 'trade')])
      ]);
      return;
    }

    /* -------------------------------------------------------------- arena -- */

    arena = PS.arena.create(stage, {
      map: dockPlan(W, H),
      spawn: { x: 1, y: 1 },
      avatar: AVATAR,
      light: state.stats.light,
      lightCurve: arenaRadius,
      darkness: 0.78,
      memory: 0.5,
      onTick: trackGhost
    });
    if (!arena) return;
    teardownFns.push(function () { if (arena) { arena.destroy(); arena = null; } });

    arena.revealAll();

    /* --------------------------------------------------------------- HUD --- */

    var mFill = arena.meter('Packed', '\uD83D\uDCE6');
    var cHand = arena.chip('In hand', '\uD83E\uDD32');
    var cLoose = arena.chip('Still ' + C.loose, '\uD83D\uDCCD');
    var cActs = arena.chip('Handling', '\uD83D\uDD04');

    arena.note('Walk to a ' + C.unitName + ' and press E to pick it up. Then stand on the square in the ' +
      C.bay + ' where its top-left corner goes and press E again.');
    arena.button('\u21BB Turn it (R)', rotate);
    arena.button('\u2715 Empty the ' + C.bay, clearBay);
    arena.button(C.commit, commitPartial, 'pz-btn--primary');
    arena.button('\u21A9 Leave the lot', abandon, 'pz-btn--danger');

    /* ---------------------------------------------------------- the floor -- */

    for (var k = 0; k < W * H; k++) addBaySquare(k);

    var ring = dockSpots(W, H, puzzle.order.length);
    for (var o = 0; o < puzzle.order.length; o++) {
      var pc = pieceById(puzzle, puzzle.order[o]);
      spots[pc.id] = ring[o];
      addLoose(pc);
    }

    function addBaySquare(idx) {
      var r = (idx / W) | 0, c = idx % W;
      bayProps.push(arena.prop({
        x: DOCK_PAD + c, y: DOCK_PAD + r,
        icon: '\u00B7', label: PS.state.prettify(C.bay),
        hint: 'E \u00B7 put it down here',
        trigger: 'press', once: false, radius: 0.55,
        glow: false, emits: 0, tint: '#2f3846',
        onActivate: function () { tapCell(r, c); }
      }));
    }

    function addLoose(piece) {
      propOf[piece.id] = arena.prop({
        x: spots[piece.id].x, y: spots[piece.id].y,
        icon: piece.icon, label: piece.label,
        hint: 'E \u00B7 pick it up \u00B7 ' + piece.size + ' squares',
        trigger: 'press', once: false, radius: 0.85,
        glow: true, emits: 0.75, tint: COLOURS[piece.colour % 8],
        onActivate: function () { pickUp(piece.id); }
      });
    }

    function locked() { return finished || puzzle.committed; }

    /* ------------------------------------------------------------ handling */

    function held() { return carried === null ? null : pieceById(puzzle, carried); }

    function stow(piece) {                       // back onto the dock it goes
      if (!piece || !propOf[piece.id]) return;
      propOf[piece.id].raw.gone = false;
      propOf[piece.id].move(spots[piece.id].x, spots[piece.id].y);
    }

    function intoHands(piece) {
      var was = held();
      if (was && was !== piece) stow(was);
      carried = piece.id;
      propOf[piece.id].raw.gone = true;          // it is in your arms now
      arena.setAvatar(piece.icon);
      ghost.at = -1;
    }

    function emptyHands() {
      var was = held();
      carried = null;
      if (was) stow(was);
      arena.setAvatar(AVATAR);
      ghost.at = -1;
    }

    function pickUp(id) {
      if (locked()) return;
      var p = pieceById(puzzle, id);
      if (!p) return;
      if (p.placed) { lift(puzzle, p); puzzle.actions++; }
      intoHands(p);
      paint();
    }

    function tapCell(r, c) {
      if (locked()) return;
      var idx = r * W + c;
      var occupant = puzzle.grid[idx];

      if (occupant >= 0) {                       // pull that one back out
        var p = pieceById(puzzle, occupant);
        lift(puzzle, p);
        puzzle.actions++;
        intoHands(p);
        arena.dust(DOCK_PAD + c, DOCK_PAD + r, 5, COLOURS[p.colour % 8]);
        paint();
        return;
      }

      var cur = held();
      if (!cur) {
        api.toast('Nothing in your hands. Walk to a ' + C.unitName + ' on the dock and press E.', 'bad');
        return;
      }
      if (cur.placed) lift(puzzle, cur);

      if (!place(puzzle, cur, r, c)) {
        api.toast('It will not go in there \u2014 turn it, or try another corner.', 'bad');
        if (arena) arena.shake(2, 0.2);
        return;
      }
      puzzle.actions++;
      emptyHands();
      if (arena) {
        arena.dust(DOCK_PAD + c, DOCK_PAD + r, 6, COLOURS[cur.colour % 8]);
        arena.ping(DOCK_PAD + c, DOCK_PAD + r, COLOURS[cur.colour % 8]);
      }
      paint();
      if (puzzle.filled === puzzle.cells) packedOut();
    }

    function rotate() {
      if (locked()) return;
      var cur = held();
      if (!cur) { api.toast('Nothing in your hands to turn.', 'bad'); return; }
      if (cur.placed) lift(puzzle, cur);
      cur.rot = (cur.rot + 1) % cur.rots.length;
      puzzle.actions++;
      ghost.at = -1;
      paint();
    }

    function clearBay() {
      if (locked()) return;
      for (var i = 0; i < puzzle.pieces.length; i++) {
        if (puzzle.pieces[i].placed) lift(puzzle, puzzle.pieces[i]);
      }
      puzzle.actions++;
      ghost.at = -1;
      paint();
    }

    /* ----------------------------------------------------------- the ghost */
    /* What you are carrying, previewed on the floor you are standing on. */

    function trackGhost(dt, a) {
      if (locked() || !a) return;
      var pl = a.player();
      var r = pl.ty - DOCK_PAD, c = pl.tx - DOCK_PAD;
      var cur = held();
      var at = (cur && r >= 0 && c >= 0 && r < H && c < W) ? (r * W + c) : -1;
      var rot = cur ? cur.rot : -1;
      if (at === ghost.at && rot === ghost.rot) return;

      ghost.at = at; ghost.rot = rot; ghost.cells = null; ghost.ok = false;
      if (at >= 0) {
        var fit = canPlace(puzzle, cur, r, c);
        ghost.ok = !!fit;
        ghost.cells = fit || [at];
      }
      paintBay();
    }

    /* -------------------------------------------------------------- paint -- */

    function paintBay() {
      var lit = {};
      if (ghost.cells) for (var g = 0; g < ghost.cells.length; g++) lit[ghost.cells[g]] = 1;

      for (var i = 0; i < bayProps.length; i++) {
        var raw = bayProps[i].raw;
        var owner = puzzle.grid[i];
        if (owner >= 0) {
          var p = pieceById(puzzle, owner);
          raw.icon = (p.placed && p.placed.cells[0] === i) ? p.icon : '\u25A0';
          raw.tint = COLOURS[p.colour % 8];
          raw.hint = locked() ? '' : 'E \u00B7 lift it back out';
        } else if (lit[i]) {
          raw.icon = ghost.ok ? '\u25A1' : '\u2715';
          raw.tint = ghost.ok ? '#5fcf8d' : '#e2695f';
          raw.hint = ghost.ok ? 'E \u00B7 put it down here' : 'it will not go here';
        } else {
          raw.icon = '\u00B7';
          raw.tint = '#2f3846';
          raw.hint = locked() ? '' : 'E \u00B7 put it down here';
        }
      }
    }

    function paint() {
      if (!arena) return;
      paintBay();

      for (var i = 0; i < puzzle.pieces.length; i++) {
        var p = puzzle.pieces[i];
        if (!propOf[p.id]) continue;
        var loose = !p.placed && carried !== p.id;
        propOf[p.id].raw.gone = !loose;
        propOf[p.id].raw.hint = 'E \u00B7 pick it up \u00B7 ' + p.size + ' squares';
      }

      var looseCount = puzzle.pieces.filter(function (q) { return !q.placed; }).length;
      var pct = Math.round((puzzle.filled / puzzle.cells) * 100);
      var cur = held();

      mFill.set(pct, puzzle.filled + ' / ' + puzzle.cells + ' sq',
        puzzle.filled === puzzle.cells ? 'good' : null);
      cHand.set(cur ? cur.label : 'empty', cur ? 'good' : null);
      cLoose.set(String(looseCount));
      cActs.set(String(puzzle.actions));

      paintHand();
      paintTray();
      paintNote();
    }

    function miniOf(piece, big) {
      var sh = shapeOf(piece);
      var mini = h('div', {
        class: 'pz-pack-mini' + (big ? ' is-big' : ''),
        style: { gridTemplateColumns: 'repeat(' + sh.w + ', ' + (big ? 13 : 9) + 'px)' }
      });
      var on = {};
      for (var i = 0; i < sh.cells.length; i++) on[sh.cells[i][0] + ',' + sh.cells[i][1]] = true;
      for (var r = 0; r < sh.h; r++) {
        for (var c = 0; c < sh.w; c++) {
          mini.appendChild(h('i', { class: on[r + ',' + c] ? 'on is-c' + piece.colour : '' }));
        }
      }
      return mini;
    }

    function paintHand() {
      PS.ui.clear(handBox);
      var cur = held();
      if (!cur) {
        handBox.className = 'pz-pack-hand';
        PS.ui.append(handBox, h('div', { class: 'pz-pack-hand__d' }, [
          'Empty handed. Walk to a ', h('b', { text: C.unitName }),
          ' out on the dock and press E to lift it.'
        ]));
        return;
      }
      handBox.className = 'pz-pack-hand is-holding';
      PS.ui.append(handBox, [
        miniOf(cur, true),
        h('div', {}, [
          h('div', { class: 'pz-pack-hand__t', text: cur.label + ' \u00B7 ' + cur.size + ' squares' }),
          h('div', { class: 'pz-pack-hand__d' }, [
            'Turn ', h('b', { text: (cur.rot % cur.rots.length) + 1 + ' of ' + cur.rots.length }),
            ' \u00B7 stand on the square its ', h('b', { text: 'top-left corner' }), ' goes in and press E.'
          ])
        ])
      ]);
    }

    function paintTray() {
      PS.ui.clear(tray);
      for (var i = 0; i < puzzle.order.length; i++) {
        (function (piece) {
          var cls = 'pz-pack-item';
          if (piece.id === carried) cls += ' is-sel';
          if (piece.placed) cls += ' is-stowed';
          tray.appendChild(h('button', {
            class: cls, type: 'button', 'data-act': 'piece:' + piece.id,
            title: piece.label + ' \u2014 ' + piece.size + ' squares. Click to walk over to it.',
            onclick: function () { walkTo(piece.id); }
          }, [
            miniOf(piece),
            h('div', { class: 'pz-pack-name' }, [
              h('b', { text: piece.label }),
              h('span', { text: piece.size + ' sq' + (piece.placed ? ' \u00B7 stowed' : (piece.id === carried ? ' \u00B7 in hand' : '')) })
            ]),
            h('div', { class: 'pz-pack-badge', text: piece.placed ? '\u2713' : piece.icon })
          ]));
        })(pieceById(puzzle, puzzle.order[i]));
      }
    }

    /** The list is a map, not a substitute for walking: it sends you there. */
    function walkTo(id) {
      if (locked() || !arena) return;
      var p = pieceById(puzzle, id);
      if (!p) return;
      if (p.placed) arena.goTo(DOCK_PAD + (p.placed.cells[0] % W), DOCK_PAD + ((p.placed.cells[0] / W) | 0));
      else if (id !== carried) arena.goTo(spots[id].x, spots[id].y);
    }

    function paintNote() {
      PS.ui.clear(noteBox);
      if (locked()) return;
      if (puzzle.filled === puzzle.cells) {
        noteBox.appendChild(h('div', { class: 'pz-pack-note is-good', text: C.full }));
        return;
      }
      if (puzzle.extras > 0 && puzzle.filled === 0) {
        noteBox.appendChild(h('div', { class: 'pz-pack-note', text:
          'There are more ' + C.unitPlural + ' out here than the ' + C.bay + ' will hold. Some of this is not coming.' }));
      }
    }

    /* ------------------------------------------------------------ endings -- */

    function packedOut() {
      puzzle.committed = true;
      emptyHands();
      paint();
      PS.ui.clear(endBox);
      PS.ui.append(endBox, [
        h('div', { class: 'pz-intro', text: C.full + ' ' + placedPieces(puzzle).length + ' ' + C.unitPlural + ' aboard.' }),
        h('div', { class: 'pz-choices' }, [choiceBtn(C.haul, 'force_door'), choiceBtn(C.hand, 'trade')])
      ]);
      api.flash();
    }

    function choiceBtn(spec, id) {
      return h('button', {
        class: 'pz-choice', type: 'button', 'data-act': 'choice:' + id,
        onclick: function () { finishRun(id); }
      }, [
        h('div', { class: 'pz-choice__i', text: spec.icon }),
        h('div', { class: 'pz-choice__t', text: spec.title }),
        h('div', { class: 'pz-choice__d', text: spec.desc })
      ]);
    }

    function haul() {
      var got = placedPieces(puzzle);
      return got.slice(0, 8).map(function (p) { return p.item; });
    }

    function finishRun(choice) {
      if (finished) return;
      finished = true;
      var got = placedPieces(puzzle);
      var perfect = puzzle.filled === puzzle.cells;
      var tidy = puzzle.actions <= puzzle.pieces.length * 2 + 2;
      var pct = puzzle.filled / puzzle.cells;

      api.finish({
        outcome: perfect ? 'success' : (pct >= 0.65 ? 'partial' : 'fail'),
        stats: perfect
          ? { energy: -6 - puzzle.tier, morale: 7 }
          : (pct >= 0.65 ? { energy: -9 - puzzle.tier, morale: -1 } : { energy: -11 - puzzle.tier, morale: -7 }),
        gain: haul(),
        lose: [],
        tags: ['packed_a_load'].concat(perfect ? ['loaded_up'] : []).concat(
          choice === 'force_door' ? ['moved_it_alone'] : ['shared_the_load']),
        signals: {
          logic: perfect ? 2 : 1,
          scavenge: Math.min(3, got.length - 1),
          speed: tidy ? 2 : 0,
          caution: perfect ? 1 : 0,
          brute: choice === 'force_door' ? 2 : 0
        },
        choice: choice,
        summary: perfect
          ? 'You packed the ' + C.bay + ' square \u2014 ' + got.length + ' ' + C.unitPlural + ', not a gap anywhere.'
          : 'You got ' + got.length + ' ' + C.unitPlural + ' in and ' + Math.round(pct * 100) + '% of the ' + C.bay + ' covered.'
      });
    }

    function commitPartial() {
      if (locked()) return;
      if (puzzle.filled === puzzle.cells) { packedOut(); return; }
      if (puzzle.filled === 0) { api.toast('You cannot leave with nothing. Put something in.', 'bad'); return; }
      puzzle.committed = true;
      emptyHands();
      paint();
      PS.ui.clear(endBox);
      PS.ui.append(endBox, [
        h('div', { class: 'pz-intro', text: C.partial }),
        h('div', { class: 'pz-choices' }, [choiceBtn(C.haul, 'force_door'), choiceBtn(C.hand, 'trade')])
      ]);
    }

    function abandon() {
      if (finished) return;
      finished = true;
      puzzle.committed = true;
      paint();
      api.finish({
        outcome: 'fail',
        stats: { energy: -8, morale: -8 },
        gain: [], lose: [],
        tags: ['left_it_behind'],
        signals: { caution: 1, scavenge: 0 },
        choice: null,
        summary: C.badLine
      });
    }

    /* --------------------------------------------------------- turning it - */

    function onKey(ev) {
      if (locked() || ev.ctrlKey || ev.metaKey || ev.altKey) return;
      if (ev.key === 'r' || ev.key === 'R') { ev.preventDefault(); rotate(); }
    }
    document.addEventListener('keydown', onKey);
    teardownFns.push(function () { document.removeEventListener('keydown', onKey); });

    function onWheel(ev) {
      if (locked() || carried === null) return;
      ev.preventDefault();
      rotate();
    }
    arena.canvas.addEventListener('wheel', onWheel, { passive: false });
    teardownFns.push(function () {
      if (arena) arena.canvas.removeEventListener('wheel', onWheel);
    });

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
    if (puzzle.filled === puzzle.cells) return 'It is packed. Decide who is moving it.';

    var rest = solveFromHere(puzzle, 150000);
    if (!rest) {
      return 'What is in the ' + C.bay + ' now cannot be finished \u2014 there is no arrangement of the rest that closes it. ' +
        'Pull something back out and start from the corner again.';
    }
    if (!rest.length) return 'Nothing left that fits. Take the load as it stands.';

    var step = rest[0];
    var piece = pieceById(puzzle, step.pieceId);
    var turned = (step.rot !== (piece.rot % piece.rots.length));
    var sh = piece.rots[step.rot];
    var r = step.row + 1, c = step.col + sh.anchorCol + 1;
    return 'The ' + piece.label.toLowerCase() + ' goes in the first gap' +
      (turned ? ', turned from how it is sitting now' : ', exactly as it is sitting now') +
      ' \u2014 row ' + r + ', column ' + c + '. ' + rest.length + ' ' + C.unitPlural + ' still fit after that.';
  }

  /* ============================================================ AUTOSOLVE = */
  /* Headless. Uses the packing proved at build time, so the bot always
     achieves a perfect fit and the placements are directly replayable. */

  function autoSolve(puzzle, rng, state, tier, skin) {
    var C = puzzle.content;
    var plan = solveFromHere(puzzle, 200000) || puzzle.solution || [];
    var carried = [];
    for (var i = 0; i < plan.length && carried.length < 8; i++) {
      var p = pieceById(puzzle, plan[i].pieceId);
      if (p) carried.push(p.item);
    }
    var alone = rng.chance(0.5);

    return {
      outcome: 'success',
      stats: { energy: -6 - puzzle.tier, morale: 7 },
      gain: carried,
      lose: [],
      tags: ['packed_a_load', 'loaded_up'].concat(alone ? ['moved_it_alone'] : ['shared_the_load']),
      signals: { logic: 2, scavenge: Math.min(3, plan.length - 1), speed: 2, caution: 1, brute: alone ? 2 : 0 },
      choice: alone ? 'force_door' : 'trade',
      summary: 'Packed the ' + C.bay + ' square with ' + plan.length + ' ' + C.unitPlural + ' and left the rest.',
      placements: plan
    };
  }

  /* ============================================================ REGISTER = */

  PS.registry.register({
    id: 'polyomino_packing',
    name: 'Polyomino Packing',
    icon: '\uD83D\uDCE6',
    blurb: 'Fit awkward shapes into a fixed bay. What does not fit does not come.',

    favors:   { logic: 2, scavenge: 2 },
    provides: ['load_out', 'supplies', 'salvage'],
    tagHooks: ['has_tools', 'loaded_up'],
    requires: function (state) { return state.stats.energy > 12; },

    css: CSS,

    skins: [
      {
        id: 'cargo_hold', biome: 'urban', title: 'Cargo Loading', icon: '\uD83D\uDE9A', palette: 'steel',
        intro: 'The last truck out of the depot is idling with its bed empty and its driver counting. Everything on the dock is in a crate and no two crates are the same shape. What is on the bed when the tailgate comes up is what leaves the city.',
        nouns: { bay: 'load bed', unit: 'crate', verb: 'stow' }
      },
      {
        id: 'lifeboat', biome: 'water', title: 'Lifeboat Stowage', icon: '\uD83D\uDEDF', palette: 'ice',
        intro: 'The stern locker is the only dry space in the boat and it is a stupid shape. Kits are stacked on the deck in the order somebody threw them down. You have until the swell decides for you.',
        nouns: { bay: 'stern locker', unit: 'kit', verb: 'stow' }
      },
      {
        id: 'mine_cart', biome: 'underground', title: 'Mine Cart Packing', icon: '\uD83D\uDE83', palette: 'amber',
        intro: 'One cart on the rope and the winch crew will not send it down twice. The loads at the face are bound in whatever shape the timber allowed. Pack it tight or watch half of it come off on the incline.',
        nouns: { bay: 'cart bed', unit: 'load', verb: 'pack' }
      }
    ],

    build: build,
    mount: mount,
    unmount: unmount,
    hint: hint,
    autoSolve: autoSolve
  });

})(typeof window !== 'undefined' ? window : this);
