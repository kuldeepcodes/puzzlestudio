/* ==========================================================================
   PuzzleStudio — js/games/e16_polyomino_packing.js  ENGINE 16 · Packing
   --------------------------------------------------------------------------
   Self-contained: logic + 3 skins + its own CSS. No DOM access until mount().

   THE PUZZLE
     A fixed bay and a pile of awkward shapes. Select a piece, turn it until
     it looks right, and drop it in. Nothing may overlap and nothing may hang
     over the edge.

   WHY IT IS ALWAYS SOLVABLE
     The bay is generated BACKWARDS. It starts completely full, gets cut into
     connected polyominoes, and only then are the pieces rotated at random and
     shuffled into the tray. A perfect packing therefore exists by
     construction — and an exact-cover search re-proves it before the puzzle
     is ever served, which also gives the hint something real to say.

   THE CHOICE THAT MATTERS
     From tier 3 the tray holds one or two MORE pieces than the bay can take.
     Everything you get out is everything you packed, so the puzzle stops
     being "can you fit it" and becomes "what are you willing to leave".

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

  /* ================================================================ CSS == */

  var CSS = [
    '.pz-pack{display:grid;grid-template-columns:minmax(0,1fr) minmax(236px,300px);gap:18px;align-items:start}',
    '@media (max-width:900px){.pz-pack{grid-template-columns:1fr}}',

    '.pz-pack-baywrap{padding:14px;border-radius:12px;border:1px solid var(--line);',
    '  background:repeating-linear-gradient(45deg,#0a0d13,#0a0d13 9px,#0c1017 9px,#0c1017 18px)}',
    '.pz-pack-bay{display:grid;gap:3px;width:100%;max-width:470px;margin:0 auto}',
    '.pz-pack-cell{position:relative;aspect-ratio:1/1;border-radius:5px;display:grid;place-items:center;',
    '  font-size:clamp(11px,2.6vw,19px);line-height:1;cursor:pointer;',
    '  background:#0e131b;border:1px solid #1e2531;color:transparent;',
    '  transition:background .18s var(--ease),border-color .18s var(--ease),transform .12s var(--ease)}',
    '.pz-pack-cell:hover{border-color:var(--acc)}',
    '.pz-pack-cell.is-fill{color:rgba(0,0,0,.75);border-color:rgba(0,0,0,.4);',
    '  box-shadow:inset 0 1px 0 rgba(255,255,255,.22),inset 0 -2px 5px rgba(0,0,0,.35)}',
    '.pz-pack-cell.is-ghost-ok{background:rgba(95,207,141,.34);border-color:var(--good)}',
    '.pz-pack-cell.is-ghost-bad{background:rgba(226,105,95,.28);border-color:var(--bad)}',
    '.pz-pack-cell.is-lift{outline:2px solid var(--acc);outline-offset:-2px}',
    '.pz-pack-cell.is-locked{cursor:default}',
    '.pz-pack-cell.is-locked:hover{border-color:#1e2531}',

    '.pz-pack-cell.is-c0{background:#b5763a}.pz-pack-cell.is-c1{background:#4f7f6a}',
    '.pz-pack-cell.is-c2{background:#5b7fa6}.pz-pack-cell.is-c3{background:#8a6aa8}',
    '.pz-pack-cell.is-c4{background:#a85f56}.pz-pack-cell.is-c5{background:#7f8a4f}',
    '.pz-pack-cell.is-c6{background:#4f8a8a}.pz-pack-cell.is-c7{background:#a08a4f}',

    '.pz-pack-tray{display:flex;flex-direction:column;gap:7px;max-height:390px;overflow:auto;padding-right:2px}',
    '.pz-pack-item{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;text-align:left;',
    '  padding:7px 9px;border-radius:9px;cursor:pointer;color:var(--text-2);font-family:var(--font-ui);',
    '  background:linear-gradient(180deg,var(--panel-2),var(--panel));border:1px solid var(--line);',
    '  transition:border-color .18s var(--ease),transform .12s var(--ease),opacity .18s var(--ease)}',
    '.pz-pack-item:hover{border-color:var(--acc);transform:translateX(2px)}',
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

    '.pz-pack-name{font-size:12px;line-height:1.35;min-width:0}',
    '.pz-pack-name b{display:block;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.pz-pack-name span{font-family:var(--font-mono);font-size:10px;color:var(--dimmer)}',
    '.pz-pack-badge{font-size:15px}',

    '.pz-pack-rows{display:flex;flex-direction:column;gap:6px}',
    '.pz-pack-row{display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:11px;color:var(--dim)}',
    '.pz-pack-row b{color:var(--acc-2)}',
    '.pz-pack-row.is-good b{color:var(--good)}',

    '.pz-pack-meterbar{height:7px;border-radius:99px;background:#12171f;overflow:hidden;border:1px solid var(--line-soft)}',
    '.pz-pack-meterbar div{height:100%;width:0;border-radius:99px;transition:width .35s var(--ease);',
    '  background:linear-gradient(90deg,var(--acc),var(--acc-2))}',

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
    var sel = null;                 // selected piece id
    var ghost = [];                 // cell indexes currently previewed

    var cellEls = [];
    var bay = h('div', { class: 'pz-pack-bay', style: { gridTemplateColumns: 'repeat(' + W + ', 1fr)' } });
    var tray = h('div', { class: 'pz-pack-tray' });
    var rows = h('div', { class: 'pz-pack-rows' });
    var barFill = h('div', {});
    var noteBox = h('div', {});
    var controls = h('div', { class: 'pz-col' });

    /* ---------------------------------------------------------------- bay -- */

    for (var k = 0; k < W * H; k++) {
      (function (idx) {
        var r = (idx / W) | 0, c = idx % W;
        var cell = h('div', { class: 'pz-pack-cell', 'data-act': 'cell:' + r + ',' + c });
        cell.addEventListener('click', function () { tapCell(r, c); });
        cell.addEventListener('mouseover', function () { preview(r, c); });
        cell.addEventListener('mouseout', function () { clearGhost(); });
        cellEls.push(cell);
        bay.appendChild(cell);
      })(k);
    }

    function selected() { return sel === null ? null : pieceById(puzzle, sel); }

    function tapCell(r, c) {
      if (finished || puzzle.committed) return;
      var idx = r * W + c;
      var occupant = puzzle.grid[idx];

      if (occupant >= 0) {                       // pull that one back out
        var p = pieceById(puzzle, occupant);
        lift(puzzle, p);
        sel = p.id;
        puzzle.actions++;
        clearGhost();
        paint();
        return;
      }

      var cur = selected();
      if (!cur) { api.toast('Pick something out of the tray first.', 'bad'); return; }
      if (cur.placed) lift(puzzle, cur);

      if (!place(puzzle, cur, r, c)) {
        api.toast('It will not go in there \u2014 turn it, or try another corner.', 'bad');
        return;
      }
      puzzle.actions++;
      sel = nextLoose(cur.id);
      clearGhost();
      paint();
      if (puzzle.filled === puzzle.cells) packedOut();
    }

    function nextLoose(afterId) {
      var ord = puzzle.order;
      var start = ord.indexOf(afterId);
      for (var i = 1; i <= ord.length; i++) {
        var p = pieceById(puzzle, ord[(start + i) % ord.length]);
        if (p && !p.placed) return p.id;
      }
      return null;
    }

    function preview(r, c) {
      if (finished || puzzle.committed) return;
      clearGhost();
      var idx = r * W + c;
      if (puzzle.grid[idx] >= 0) {
        var occ = pieceById(puzzle, puzzle.grid[idx]);
        for (var i = 0; i < occ.placed.cells.length; i++) {
          cellEls[occ.placed.cells[i]].classList.add('is-lift');
          ghost.push(occ.placed.cells[i]);
        }
        return;
      }
      var cur = selected();
      if (!cur || cur.placed) return;
      var ok = canPlace(puzzle, cur, r, c);
      if (ok) {
        for (var j = 0; j < ok.length; j++) { cellEls[ok[j]].classList.add('is-ghost-ok'); ghost.push(ok[j]); }
      } else {
        cellEls[idx].classList.add('is-ghost-bad'); ghost.push(idx);
      }
    }

    function clearGhost() {
      for (var i = 0; i < ghost.length; i++) {
        cellEls[ghost[i]].classList.remove('is-ghost-ok', 'is-ghost-bad', 'is-lift');
      }
      ghost = [];
    }

    /* -------------------------------------------------------------- tray -- */

    function miniOf(piece) {
      var sh = shapeOf(piece);
      var mini = h('div', {
        class: 'pz-pack-mini',
        style: { gridTemplateColumns: 'repeat(' + sh.w + ', 9px)' }
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

    function paintTray() {
      PS.ui.clear(tray);
      for (var i = 0; i < puzzle.order.length; i++) {
        (function (piece) {
          var cls = 'pz-pack-item';
          if (piece.id === sel) cls += ' is-sel';
          if (piece.placed) cls += ' is-stowed';
          var btn = h('button', {
            class: cls, type: 'button', 'data-act': 'piece:' + piece.id,
            title: piece.label + ' \u2014 ' + piece.size + ' squares',
            onclick: function () { tapPiece(piece.id); }
          }, [
            miniOf(piece),
            h('div', { class: 'pz-pack-name' }, [
              h('b', { text: piece.label }),
              h('span', { text: piece.size + ' sq' + (piece.placed ? ' \u00B7 stowed' : '') })
            ]),
            h('div', { class: 'pz-pack-badge', text: piece.placed ? '\u2713' : piece.icon })
          ]);
          tray.appendChild(btn);
        })(pieceById(puzzle, puzzle.order[i]));
      }
    }

    function tapPiece(id) {
      if (finished || puzzle.committed) return;
      var p = pieceById(puzzle, id);
      // Always select. A toggle here reads as "nothing happened" the moment
      // the tray auto-advances onto the piece you were about to click.
      if (p.placed) { lift(puzzle, p); puzzle.actions++; }
      sel = id;
      clearGhost();
      paint();
    }

    function rotate() {
      if (finished || puzzle.committed) return;
      var cur = selected();
      if (!cur) { api.toast('Nothing in your hands to turn.', 'bad'); return; }
      if (cur.placed) lift(puzzle, cur);
      cur.rot = (cur.rot + 1) % cur.rots.length;
      puzzle.actions++;
      clearGhost();
      paint();
    }

    function clearBay() {
      if (finished || puzzle.committed) return;
      for (var i = 0; i < puzzle.pieces.length; i++) lift(puzzle, puzzle.pieces[i]);
      puzzle.actions++;
      clearGhost();
      paint();
    }

    /* -------------------------------------------------------------- paint -- */

    function paint() {
      var lock = finished || puzzle.committed;
      for (var i = 0; i < cellEls.length; i++) {
        var owner = puzzle.grid[i];
        var cls = 'pz-pack-cell';
        if (lock) cls += ' is-locked';
        if (owner >= 0) {
          var p = pieceById(puzzle, owner);
          cls += ' is-fill is-c' + p.colour;
          cellEls[i].textContent = (p.placed && p.placed.cells[0] === i) ? p.icon : '';
        } else {
          cellEls[i].textContent = '';
        }
        cellEls[i].className = cls;
      }
      paintTray();
      paintRows();
      paintNote();
    }

    function row(k, v, good) {
      return h('div', { class: 'pz-pack-row' + (good ? ' is-good' : '') }, [
        h('span', { text: k }), h('b', { text: v })
      ]);
    }

    function paintRows() {
      PS.ui.clear(rows);
      var loose = puzzle.pieces.filter(function (p) { return !p.placed; }).length;
      var pct = Math.round((puzzle.filled / puzzle.cells) * 100);
      PS.ui.append(rows, [
        row('Bay', W + ' \u00D7 ' + H + ' squares'),
        row('Packed', puzzle.filled + ' / ' + puzzle.cells + ' (' + pct + '%)', puzzle.filled === puzzle.cells),
        row('Stowed', String(puzzle.pieces.length - loose) + ' ' + C.unitPlural),
        row('Still ' + C.loose, String(loose)),
        row('Handling', String(puzzle.actions))
      ]);
      barFill.style.width = pct + '%';
    }

    function paintNote() {
      PS.ui.clear(noteBox);
      if (finished || puzzle.committed) return;
      if (puzzle.filled === puzzle.cells) {
        noteBox.appendChild(h('div', { class: 'pz-pack-note is-good', text: C.full }));
        return;
      }
      if (puzzle.extras > 0 && puzzle.filled === 0) {
        noteBox.appendChild(h('div', { class: 'pz-pack-note', text:
          'There are more ' + C.unitPlural + ' here than the ' + C.bay + ' will hold. Some of this is not coming.' }));
        return;
      }
      var cur = selected();
      if (cur) {
        noteBox.appendChild(h('div', { class: 'pz-pack-note', text:
          'Holding the ' + cur.label.toLowerCase() + '. The square you click is the square its top-left corner lands on.' }));
      }
    }

    /* ------------------------------------------------------------ endings -- */

    function packedOut() {
      puzzle.committed = true;
      paint();
      PS.ui.clear(controls);
      PS.ui.append(controls, [
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
      if (finished || puzzle.committed) return;
      if (puzzle.filled === puzzle.cells) { packedOut(); return; }
      if (puzzle.filled === 0) { api.toast('You cannot leave with nothing. Put something in.', 'bad'); return; }
      puzzle.committed = true;
      paint();
      PS.ui.clear(controls);
      PS.ui.append(controls, [
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

    /* ------------------------------------------------------------ keyboard */

    function onKey(ev) {
      if (finished || puzzle.committed) return;
      if (ev.key === 'r' || ev.key === 'R') { ev.preventDefault(); rotate(); return; }
      if (ev.key === 'Escape') { sel = null; clearGhost(); paint(); }
    }
    document.addEventListener('keydown', onKey);
    teardownFns.push(function () { document.removeEventListener('keydown', onKey); });

    /* ------------------------------------------------------------- layout -- */

    PS.ui.append(controls, [
      h('div', { class: 'pz-row' }, [
        h('button', { class: 'pz-btn pz-btn--sm', type: 'button', 'data-act': 'rotate', onclick: rotate },
          ['\u21BB Turn it (R)']),
        h('button', { class: 'pz-btn pz-btn--sm', type: 'button', 'data-act': 'clear', onclick: clearBay },
          ['\u2715 Empty the ' + C.bay])
      ]),
      h('button', { class: 'pz-btn pz-btn--primary', type: 'button', 'data-act': 'commit', onclick: commitPartial },
        [C.commit]),
      h('button', { class: 'pz-btn pz-btn--danger pz-btn--sm', type: 'button', 'data-act': 'giveup', onclick: abandon },
        ['\u21A9 Leave the lot'])
    ]);

    PS.ui.append(el, h('div', { class: 'pz-pack' }, [
      h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-intro', text: C.goal }),
        h('div', { class: 'pz-pack-baywrap' }, [bay]),
        h('div', { class: 'pz-note' }, [
          'Pick a ', h('strong', { text: C.unitName }), ', turn it with ',
          h('strong', { text: 'R' }), ', then click the square where its top-left corner should sit. ',
          'Click anything already stowed to pull it back out.'
        ])
      ]),
      h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: PS.state.prettify(C.bay) }),
          rows,
          h('div', { class: 'pz-pack-meterbar' }, [barFill])
        ]),
        noteBox,
        h('div', { class: 'pz-card' }, [h('div', { class: 'pz-card__head', text: 'To go' }), tray]),
        h('div', { class: 'pz-card' }, [h('div', { class: 'pz-card__head', text: 'Handling' }), controls])
      ])
    ]));

    sel = puzzle.order.length ? puzzle.order[0] : null;
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
