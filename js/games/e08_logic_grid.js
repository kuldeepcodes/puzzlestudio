/* ==========================================================================
   PuzzleStudio — js/games/e08_logic_grid.js            ENGINE 08 · Logic Grid
   --------------------------------------------------------------------------
   Self-contained: logic + 3 skins + its own CSS. No DOM access until mount().

   THE PUZZLE
     A real logic-grid deduction. N people, N things, N moments in time, and a
     list of statements that between them narrow the world to exactly one
     arrangement. You mark a two-part grid the way you would on paper — tick,
     cross, blank — and when both halves resolve to a clean one-to-one reading
     you commit to it.

   GENERATION — the part that matters
     1. Roll a solution (two independent permutations).
     2. Derive a large pool of statements that are TRUE of that solution:
        negatives, cross-category links, orderings, adjacency, endpoints.
     3. Shuffle the pool, then add clues one at a time until a constraint
        solver reports exactly one arrangement survives.
     4. Walk the chosen set backwards and delete every clue the solver says
        was redundant.
     The result is guaranteed unique and carries no dead weight. Direct
     give-away clues sit at the very end of the pool, so they are only ever
     used when the interesting statements ran out — which also guarantees
     step 3 always terminates.

   THE BRANCH
     Knowing who did it is not the same as deciding what to do about it.

   HOW YOU TOUCH IT
     The statements are not handed to you. They are a roster board, a sign-in
     sheet, a note somebody left on a desk — scattered across an office you
     have to walk, one clue each. The grid stays a grid, on a terminal you
     walk up to, because a logic grid genuinely is better as a grid and
     spatialising the deduction itself would only wreck it. Finding the
     statements is the search; crossing them off is still done sitting down.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio;
  if (!PS || !PS.registry) { if (root.console) console.error('[e08] core not loaded'); return; }

  /* ======================================================== SKIN CONTENT == */

  var CONTENT = {
    restricted_access: {
      peopleWord: 'badge', objWord: 'door', timeWord: 'time',
      objHead: 'Opened', timeHead: 'Badged in', target: 0,
      people: [
        { name: 'Vance',  note: 'night supervisor' },
        { name: 'Okoro',  note: 'contractor, no lanyard' },
        { name: 'Bell',   note: 'security, off shift' },
        { name: 'Ridley', note: 'lab tech' },
        { name: 'Sato',   note: 'cleaning crew' }
      ],
      objects: [
        { name: 'stairwell door', icon: '\uD83D\uDEAA' },
        { name: 'server room',    icon: '\uD83D\uDDA5\uFE0F' },
        { name: 'loading bay',    icon: '\uD83D\uDE9B' },
        { name: 'records office', icon: '\uD83D\uDDC4\uFE0F' },
        { name: 'roof hatch',     icon: '\uD83E\uDE9C' }
      ],
      slots: ['19:40', '20:05', '20:30', '20:55', '21:20'],
      V: {
        did: 'opened', didNot: 'did not open',
        at: 'badged in at', notAt: 'did not badge in at',
        before: 'badged in before', immBefore: 'badged in immediately before',
        first: 'was the first one in', last: 'was the last one in',
        objDone: 'was opened', objNotDone: 'was not opened',
        between: 'badge-ins', betweenOne: 'badge-in'
      },
      prize: 'You lift the badge off the hook it has been on since the evacuation order.',
      avatar: '\uD83E\uDDCD', deskIcon: '\uD83D\uDDA5\uFE0F', deskName: 'The duty terminal',
      roomNote: 'The floor has been left exactly as it was. Every statement you get is something you found on it \u2014 go and read them, then work the grid at the terminal.',
      sources: [
        { icon: '\uD83D\uDCCB', name: 'roster board' },
        { icon: '\u270D\uFE0F', name: 'sign-in sheet' },
        { icon: '\uD83D\uDCDD', name: 'supervisor\u2019s note' },
        { icon: '\uD83D\uDEAA', name: 'door log' },
        { icon: '\uD83D\uDCFC', name: 'camera still' },
        { icon: '\uD83D\uDCDF', name: 'radio log' },
        { icon: '\uD83D\uDCC7', name: 'lanyard tray' },
        { icon: '\uD83D\uDCD2', name: 'shift diary' },
        { icon: '\uD83D\uDCC4', name: 'incident form' },
        { icon: '\uD83D\uDCD3', name: 'visitor book' },
        { icon: '\uD83D\uDD22', name: 'keypad log' },
        { icon: '\uD83D\uDD16', name: 'locker tag' }
      ],
      branchA: { id: 'code', icon: '\uD83D\uDD22', title: 'Badge in at the terminal', desc: 'Quiet, legitimate, logged. Somebody will read that log eventually.' },
      branchB: { id: 'force_door', icon: '\uD83D\uDD28', title: 'Use it on the bay shutter', desc: 'One badge, one shutter, and a great deal of noise on the way out.' }
    },

    medkit_theft: {
      peopleWord: 'name', objWord: 'item', timeWord: 'hour',
      objHead: 'Took', timeHead: 'Went in at', target: 0,
      people: [
        { name: 'Ines',     note: 'keeps the log' },
        { name: 'Dov',      note: 'sleeps by the door' },
        { name: 'Marisol',  note: 'coughing since Tuesday' },
        { name: 'Terrence', note: 'volunteered for every watch' },
        { name: 'Yuki',     note: 'has not spoken since the road' }
      ],
      objects: [
        { name: 'medkit',    icon: '\uD83E\uDE79' },
        { name: 'water can', icon: '\uD83D\uDCA7' },
        { name: 'blankets',  icon: '\uD83E\uDDF6' },
        { name: 'radio',     icon: '\uD83D\uDCFB' },
        { name: 'lantern',   icon: '\uD83C\uDFEE' }
      ],
      slots: ['01:10', '02:00', '02:50', '03:40', '04:30'],
      V: {
        did: 'took', didNot: 'did not take',
        at: 'went into the store at', notAt: 'did not go into the store at',
        before: 'went in before', immBefore: 'went in immediately before',
        first: 'was the first one in there', last: 'was the last one in there',
        objDone: 'was taken', objNotDone: 'was not taken',
        between: 'trips', betweenOne: 'trip'
      },
      prize: 'They hand it over without meeting your eye, and the room decides very hard to look elsewhere.',
      avatar: '\uD83E\uDDCD', deskIcon: '\uD83D\uDD6F\uFE0F', deskName: 'The long table',
      roomNote: 'Everybody is asleep or pretending to be. What you know you will have to find lying around \u2014 collect it, then sit down at the table and work it out.',
      sources: [
        { icon: '\uD83D\uDCCB', name: 'watch rota' },
        { icon: '\u270D\uFE0F', name: 'store ledger' },
        { icon: '\uD83D\uDCDD', name: 'note on a bunk' },
        { icon: '\uD83C\uDF5E', name: 'ration board' },
        { icon: '\uD83D\uDECF\uFE0F', name: 'bunk chart' },
        { icon: '\uD83D\uDD6F\uFE0F', name: 'burnt-down candle' },
        { icon: '\uD83E\uDDF3', name: 'somebody\u2019s pack' },
        { icon: '\uD83D\uDCD2', name: 'the day book' },
        { icon: '\uD83E\uDDFA', name: 'the bin by the door' },
        { icon: '\uD83D\uDC5F', name: 'wet bootprints' },
        { icon: '\uD83D\uDD26', name: 'a torch left on' },
        { icon: '\uD83E\uDDE3', name: 'a scarf on a hook' }
      ],
      branchA: { id: 'trade', icon: '\uD83E\uDD1D', title: 'Ask for it back out loud', desc: 'In front of everyone, so it stays a thing that happened once.' },
      branchB: { id: 'rest', icon: '\uD83D\uDECF\uFE0F', title: 'Say nothing and sleep on it', desc: 'You know. They know you know. That is worth something in the morning.' }
    },

    crew_manifest: {
      peopleWord: 'crewman', objWord: 'station', timeWord: 'watch',
      objHead: 'Posted to', timeHead: 'Last seen', target: 3,
      people: [
        { name: 'Halvorsen', note: 'second engineer' },
        { name: 'Petit',     note: 'cook, and the only swimmer' },
        { name: 'Abasi',     note: 'deck hand' },
        { name: 'Nyquist',   note: 'mate, logged nothing' },
        { name: 'Rui',       note: 'apprentice, sixteen' }
      ],
      objects: [
        { name: 'engine room', icon: '\u2699\uFE0F' },
        { name: 'galley',      icon: '\uD83C\uDF72' },
        { name: 'bridge',      icon: '\uD83E\uDDED' },
        { name: 'bow locker',  icon: '\uD83E\uDDF0' },
        { name: 'aft hold',    icon: '\uD83D\uDCE6' }
      ],
      slots: ['two bells', 'three bells', 'four bells', 'five bells', 'six bells'],
      V: {
        did: 'was posted to', didNot: 'was not posted to',
        at: 'was last seen at', notAt: 'was not seen at',
        before: 'was seen before', immBefore: 'was seen immediately before',
        first: 'was the first one accounted for', last: 'was the last one accounted for',
        objDone: 'was manned', objNotDone: 'was not manned',
        between: 'sightings', betweenOne: 'sighting'
      },
      prize: 'The locker key is still on the manifest board, under a name you can now put a station to.',
      avatar: '\uD83E\uDDCD', deskIcon: '\uD83D\uDDFA\uFE0F', deskName: 'The chart room',
      roomNote: 'She is listing and nobody is aboard. Everything you learn is something you find on a bulkhead \u2014 gather it, then take it into the chart room.',
      sources: [
        { icon: '\uD83D\uDCCB', name: 'watch bill' },
        { icon: '\u270D\uFE0F', name: 'deck log' },
        { icon: '\uD83D\uDCDD', name: 'the mate\u2019s slate' },
        { icon: '\uD83E\uDDED', name: 'muster list' },
        { icon: '\uD83D\uDD14', name: 'bell book' },
        { icon: '\uD83D\uDCFB', name: 'the radio pad' },
        { icon: '\uD83E\uDDF7', name: 'a torn oilskin' },
        { icon: '\uD83D\uDCD2', name: 'engine log' },
        { icon: '\u2615', name: 'a cold mug' },
        { icon: '\uD83E\uDDF0', name: 'an open toolbox' },
        { icon: '\uD83D\uDEDF', name: 'the lifering rack' },
        { icon: '\uD83D\uDD26', name: 'a dropped lamp' }
      ],
      branchA: { id: 'descend', icon: '\uD83E\uDDD7', title: 'Go down to the flooded deck', desc: 'You know which hatch now, and roughly how long the air lasted.' },
      branchB: { id: 'signal', icon: '\uD83D\uDCE1', title: 'Raise the shore station', desc: 'Read the names out. Somebody on land has been waiting to hear them.' }
    }
  };

  /* ============================================================ SOLVER ==== */

  var PERM_CACHE = {};

  function permsOf(n) {
    if (PERM_CACHE[n]) return PERM_CACHE[n];
    var out = [], cur = [], used = [];
    (function rec() {
      if (cur.length === n) { out.push(cur.slice()); return; }
      for (var i = 0; i < n; i++) {
        if (used[i]) continue;
        used[i] = true; cur.push(i);
        rec();
        cur.pop(); used[i] = false;
      }
    })();
    PERM_CACHE[n] = out;
    return out;
  }

  function invert(perm) {
    var inv = new Array(perm.length);
    for (var i = 0; i < perm.length; i++) inv[perm[i]] = i;
    return inv;
  }

  /**
   * Count arrangements satisfying every clue, stopping at `limit`.
   * Clues are bucketed by what they read so the cheap ones prune first:
   *   'obj'  reads person->object only
   *   'time' reads person->time only   (pre-filtered once, outside the loop)
   *   'mix'  reads both
   * @returns {Array} up to `limit` solutions, each { objOf, timeOf }
   */
  function solve(n, clues, limit) {
    var perms = permsOf(n);
    var objC = [], timeC = [], mixC = [], i, c;

    for (i = 0; i < clues.length; i++) {
      c = clues[i];
      if (c.phase === 'obj') objC.push(c);
      else if (c.phase === 'time') timeC.push(c);
      else mixC.push(c);
    }

    var validTimes = [];
    for (i = 0; i < perms.length; i++) {
      if (passes(timeC, null, null, perms[i])) validTimes.push(perms[i]);
    }
    if (!validTimes.length) return [];

    var out = [];
    for (i = 0; i < perms.length; i++) {
      var objOf = perms[i];
      if (!passes(objC, objOf, null, null)) continue;
      var objInv = invert(objOf);
      for (var j = 0; j < validTimes.length; j++) {
        if (!passes(mixC, objOf, objInv, validTimes[j])) continue;
        out.push({ objOf: objOf, timeOf: validTimes[j] });
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  function passes(list, objOf, objInv, timeOf) {
    for (var i = 0; i < list.length; i++) {
      if (!list[i].t(objOf, objInv, timeOf)) return false;
    }
    return true;
  }

  /* ======================================================= CLUE FACTORY === */

  function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function clueSet(ctx) {
    var P = ctx.people, O = ctx.objects, S = ctx.slots, V = ctx.V;
    var name = function (p) { return P[p].name; };
    var obj  = function (o) { return 'the ' + O[o].name; };
    var slot = function (t) { return S[t]; };

    return {
      poNeg: function (p, o) {
        return { phase: 'obj', text: name(p) + ' ' + V.didNot + ' ' + obj(o) + '.',
          t: function (objOf) { return objOf[p] !== o; } };
      },
      poPos: function (p, o) {
        return { phase: 'obj', anchor: true, text: name(p) + ' ' + V.did + ' ' + obj(o) + '.',
          t: function (objOf) { return objOf[p] === o; } };
      },
      ptNeg: function (p, t0) {
        return { phase: 'time', text: name(p) + ' ' + V.notAt + ' ' + slot(t0) + '.',
          t: function (a, b, timeOf) { return timeOf[p] !== t0; } };
      },
      ptPos: function (p, t0) {
        return { phase: 'time', anchor: true, text: name(p) + ' ' + V.at + ' ' + slot(t0) + '.',
          t: function (a, b, timeOf) { return timeOf[p] === t0; } };
      },
      otPos: function (o, t0) {
        return { phase: 'mix', text: cap(obj(o)) + ' ' + V.objDone + ' at ' + slot(t0) + '.',
          t: function (objOf, objInv, timeOf) { return timeOf[objInv[o]] === t0; } };
      },
      otNeg: function (o, t0) {
        return { phase: 'mix', text: cap(obj(o)) + ' ' + V.objNotDone + ' at ' + slot(t0) + '.',
          t: function (objOf, objInv, timeOf) { return timeOf[objInv[o]] !== t0; } };
      },
      before: function (p, q) {
        return { phase: 'time', text: name(p) + ' ' + V.before + ' ' + name(q) + '.',
          t: function (a, b, timeOf) { return timeOf[p] < timeOf[q]; } };
      },
      immBefore: function (p, q) {
        return { phase: 'time', text: name(p) + ' ' + V.immBefore + ' ' + name(q) + '.',
          t: function (a, b, timeOf) { return timeOf[q] - timeOf[p] === 1; } };
      },
      gap: function (p, q, k) {
        return { phase: 'time',
          text: 'Exactly ' + numWord(k - 1) + ' ' + (k === 2 ? V.betweenOne : V.between) +
            ' fell between ' + name(p) + ' and ' + name(q) + '.',
          t: function (a, b, timeOf) { return Math.abs(timeOf[p] - timeOf[q]) === k; } };
      },
      edge: function (p, isFirst, n) {
        return { phase: 'time', text: name(p) + ' ' + (isFirst ? V.first : V.last) + '.',
          t: function (a, b, timeOf) { return timeOf[p] === (isFirst ? 0 : n - 1); } };
      },
      objBefore: function (o, r) {
        return { phase: 'mix', text: cap(obj(o)) + ' ' + V.objDone + ' before ' + obj(r) + '.',
          t: function (objOf, objInv, timeOf) { return timeOf[objInv[o]] < timeOf[objInv[r]]; } };
      },
      objImm: function (o, r) {
        return { phase: 'mix', text: cap(obj(o)) + ' ' + V.objDone + ' immediately before ' + obj(r) + '.',
          t: function (objOf, objInv, timeOf) { return timeOf[objInv[r]] - timeOf[objInv[o]] === 1; } };
      },
      crossBefore: function (o, q) {
        return { phase: 'mix',
          text: 'Whoever ' + V.did + ' ' + obj(o) + ' ' + V.before + ' ' + name(q) + '.',
          t: function (objOf, objInv, timeOf) { return timeOf[objInv[o]] < timeOf[q]; } };
      },
      objEdge: function (o, isFirst, n) {
        return { phase: 'mix',
          text: cap(obj(o)) + ' ' + V.objDone + ' ' + (isFirst ? 'first of all' : 'last of all') + '.',
          t: function (objOf, objInv, timeOf) { return timeOf[objInv[o]] === (isFirst ? 0 : n - 1); } };
      }
    };
  }

  function numWord(k) {
    return ['no', 'one', 'two', 'three', 'four'][k] || String(k);
  }

  /* ============================================================== BUILD === */

  function gridSize(tier) {
    return 3 + Math.min(2, Math.floor((Math.max(1, tier) - 1) / 2));   // 3,3,4,4,5,5...
  }

  /* =============================================================== OFFICE = */
  /* One clue, one place to find it. Desks sit on a lattice you can walk
     between and the terminal is against the near wall. Derived entirely from
     the clue count, so it needs no rng and always lays out the same. */

  function officePlan(clueCount) {
    var cols = Math.min(5, Math.max(2, Math.ceil(Math.sqrt(Math.max(1, clueCount)))));
    var rows = Math.ceil(Math.max(1, clueCount) / cols);

    var x0 = 5, y0 = 2;
    var W = x0 + cols * 2 + 1;
    var H = Math.max(9, y0 + rows * 2 + 2);

    var tiles = [], x, y, row;
    for (y = 0; y < H; y++) {
      row = [];
      for (x = 0; x < W; x++) row.push(x === 0 || y === 0 || x === W - 1 || y === H - 1 ? 1 : 0);
      tiles.push(row);
    }

    var spots = [];
    for (var i = 0; i < clueCount; i++) {
      spots.push({ x: x0 + (i % cols) * 2, y: y0 + Math.floor(i / cols) * 2 });
    }

    // Partitions in the gaps between desks: isolated tiles two apart, so the
    // floor is one connected piece by construction and nothing can be sealed in.
    for (var ri = 0; ri + 1 < rows; ri++) {
      for (var ci = 0; ci + 1 < cols; ci++) {
        if ((ri + ci) % 2) continue;
        var px = x0 + ci * 2 + 1, py = y0 + ri * 2 + 1;
        if (px > 0 && py > 0 && px < W - 1 && py < H - 1) tiles[py][px] = 1;
      }
    }

    return {
      tiles: tiles, w: W, h: H, spots: spots,
      spawn: { x: 2, y: H - 2 },
      desk: { x: 2, y: Math.max(1, Math.floor(H / 2)) }
    };
  }

  function buildPuzzle(n, rng, ctx) {
    var F = clueSet(ctx);
    var idx = [], i, j;
    for (i = 0; i < n; i++) idx.push(i);

    var objOf  = rng.shuffle(idx);     // person -> object
    var timeOf = rng.shuffle(idx);     // person -> slot
    var objInv = invert(objOf);

    /* ---- the pool: every statement below is TRUE of that solution -------- */
    var pool = [];

    for (i = 0; i < n; i++) {
      for (j = 0; j < n; j++) {
        if (objOf[i] !== j)  pool.push(F.poNeg(i, j));
        if (timeOf[i] !== j) pool.push(F.ptNeg(i, j));
        if (timeOf[objInv[j]] !== i) pool.push(F.otNeg(j, i));
        else pool.push(F.otPos(j, i));
      }
    }
    for (i = 0; i < n; i++) {
      for (j = 0; j < n; j++) {
        if (i === j) continue;
        if (timeOf[i] < timeOf[j]) {
          pool.push(F.before(i, j));
          pool.push(F.crossBefore(objOf[i], j));
          pool.push(F.objBefore(objOf[i], objOf[j]));
          if (timeOf[j] - timeOf[i] === 1) {
            pool.push(F.immBefore(i, j));
            pool.push(F.objImm(objOf[i], objOf[j]));
          }
        }
        var d = Math.abs(timeOf[i] - timeOf[j]);
        if (d >= 2) pool.push(F.gap(i, j, d));
      }
      if (timeOf[i] === 0)     { pool.push(F.edge(i, true, n));  pool.push(F.objEdge(objOf[i], true, n)); }
      if (timeOf[i] === n - 1) { pool.push(F.edge(i, false, n)); pool.push(F.objEdge(objOf[i], false, n)); }
    }

    // Give-aways go last so the greedy pass is guaranteed to terminate on a
    // unique set even for a pathological shuffle. Minimisation usually eats them.
    var anchors = [];
    for (i = 0; i < n; i++) { anchors.push(F.poPos(i, objOf[i])); anchors.push(F.ptPos(i, timeOf[i])); }

    var ordered = rng.shuffle(pool).concat(rng.shuffle(anchors));

    /* ---- greedy: add until exactly one arrangement survives -------------- */
    var chosen = [];
    for (i = 0; i < ordered.length; i++) {
      chosen.push(ordered[i]);
      if (solve(n, chosen, 2).length === 1) break;
    }
    if (solve(n, chosen, 2).length !== 1) return null;

    /* ---- minimise: drop every clue the solver does not need -------------- */
    for (i = chosen.length - 1; i >= 0; i--) {
      var trial = chosen.slice();
      trial.splice(i, 1);
      if (solve(n, trial, 2).length === 1) chosen = trial;
    }

    // Paranoia: the surviving arrangement must be the one we rolled.
    var only = solve(n, chosen, 2);
    if (only.length !== 1) return null;
    for (i = 0; i < n; i++) {
      if (only[0].objOf[i] !== objOf[i] || only[0].timeOf[i] !== timeOf[i]) return null;
    }

    return { objOf: objOf, timeOf: timeOf, clues: rng.shuffle(chosen) };
  }

  function build(state, rng, tier, skin) {
    var C = CONTENT[skin.id] || CONTENT.restricted_access;
    var t = Math.max(1, Math.min(8, tier));
    var n = gridSize(t);

    var ctx = {
      people:  C.people.slice(0, n),
      objects: C.objects.slice(0, n),
      slots:   C.slots.slice(0, n),
      V: C.V
    };

    var made = null;
    for (var guard = 0; guard < 6 && !made; guard++) made = buildPuzzle(n, rng, ctx);

    if (!made) {
      // Never ship an unsolvable scene: fall back to the fully-anchored set,
      // which is unique by construction.
      var F = clueSet(ctx), idx = [], i;
      for (i = 0; i < n; i++) idx.push(i);
      var objOf = rng.shuffle(idx), timeOf = rng.shuffle(idx), cl = [];
      for (i = 0; i < n; i++) { cl.push(F.poPos(i, objOf[i])); cl.push(F.ptPos(i, timeOf[i])); }
      made = { objOf: objOf, timeOf: timeOf, clues: rng.shuffle(cl) };
    }

    var markObj = [], markTime = [];
    for (var p = 0; p < n; p++) {
      var rowA = [], rowB = [];
      for (var q = 0; q < n; q++) { rowA.push(0); rowB.push(0); }
      markObj.push(rowA); markTime.push(rowB);
    }

    return {
      n: n,
      ctx: ctx,
      content: C,
      objOf: made.objOf,
      timeOf: made.timeOf,
      clues: made.clues,
      clueUsed: [],
      markObj: markObj,
      markTime: markTime,
      attempts: 3,
      wrong: 0,
      target: Math.min(C.target || 0, n - 1),   // the thing the player actually came for
      solved: false,
      tier: t
    };
  }

  /* ================================================================ CSS == */

  var CSS = [
    '.pz-lgrid{display:grid;grid-template-columns:minmax(0,1fr) minmax(250px,330px);gap:18px;align-items:start}',
    '@media (max-width:900px){.pz-lgrid{grid-template-columns:1fr}}',

    '.pz-lgrid-boards{display:flex;flex-wrap:wrap;gap:16px}',
    '.pz-lgrid-board{flex:1 1 260px;min-width:0}',
    '.pz-lgrid-board__cap{font-family:var(--font-mono);font-size:10px;letter-spacing:.16em;',
    '  text-transform:uppercase;color:var(--dim);margin-bottom:7px}',

    '.pz-lgrid-grid{display:grid;gap:3px}',
    '.pz-lgrid-hcorner{min-height:34px}',
    '.pz-lgrid-hcol{display:flex;align-items:flex-end;justify-content:center;gap:3px;padding:2px;',
    '  font-size:10px;line-height:1.15;text-align:center;color:var(--text-2);word-break:break-word}',
    '.pz-lgrid-hrow{display:flex;align-items:center;padding:0 7px 0 2px;font-size:11.5px;color:var(--text-2);',
    '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.pz-lgrid-cell{aspect-ratio:1/1;min-height:30px;display:grid;place-items:center;border-radius:5px;',
    '  font-size:15px;line-height:1;cursor:pointer;color:var(--dimmer);',
    '  background:#0c1119;border:1px solid var(--line-soft);',
    '  transition:background .15s var(--ease),border-color .15s var(--ease),transform .12s var(--ease)}',
    '.pz-lgrid-cell:hover{border-color:var(--acc);transform:scale(1.06)}',
    '.pz-lgrid-cell.is-yes{background:color-mix(in srgb,var(--acc) 20%,#0c1119);color:var(--acc-2);',
    '  border-color:color-mix(in srgb,var(--acc) 60%,transparent)}',
    '.pz-lgrid-cell.is-no{background:#090d13;color:#4a5364}',
    '.pz-lgrid-cell.is-locked{cursor:default}',
    '.pz-lgrid-cell.is-locked:hover{transform:none;border-color:var(--line-soft)}',
    '.pz-lgrid-cell.is-wrongcell{border-color:var(--bad);background:rgba(226,105,95,.14)}',

    '.pz-lgrid-clues{display:flex;flex-direction:column;gap:5px;max-height:320px;overflow:auto}',
    '.pz-lgrid-clue{display:flex;gap:8px;align-items:flex-start;text-align:left;padding:7px 9px;border-radius:7px;',
    '  font-size:12px;line-height:1.45;color:var(--text-2);cursor:pointer;',
    '  background:#0a0e15;border:1px solid var(--line-soft)}',
    '.pz-lgrid-clue:hover{border-color:var(--acc)}',
    '.pz-lgrid-clue.is-used{opacity:.36;text-decoration:line-through}',
    '.pz-lgrid-clue.is-broken{border-color:var(--bad);background:rgba(226,105,95,.1);opacity:1;text-decoration:none}',
    '.pz-lgrid-clue__n{font-family:var(--font-mono);font-size:10px;color:var(--dimmer);padding-top:2px}',

    '.pz-lgrid-read{display:flex;flex-direction:column;gap:4px;font-family:var(--font-mono);font-size:11px}',
    '.pz-lgrid-read__row{display:flex;gap:7px;color:var(--dim)}',
    '.pz-lgrid-read__row b{color:var(--acc-2);font-weight:600}',
    '.pz-lgrid-read__row.is-gap{color:var(--dimmer)}',

    '.pz-lgrid-meta{display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:11px;color:var(--dim)}',
    '.pz-lgrid-meta b{color:var(--acc-2)}',
    '.pz-lgrid-meta.is-hot b{color:var(--bad)}',

    '.pz-lgrid-warn{font-size:12px;line-height:1.5;color:var(--bad);padding:9px 11px;border-radius:7px;',
    '  background:rgba(226,105,95,.08);border:1px solid rgba(226,105,95,.28)}',

    '.pz-lgrid-shake{animation:pzLgridShake .42s var(--ease)}',
    '@keyframes pzLgridShake{0%,100%{transform:translateX(0)}25%{transform:translateX(-5px)}75%{transform:translateX(5px)}}',

    '.pz-lgrid-panel{display:flex;flex-direction:column;gap:14px}',
    '.pz-lgrid-clue.is-missing{opacity:.5;cursor:default;border-style:dashed;color:var(--dim)}',
    '.pz-lgrid-clue.is-missing:hover{border-color:var(--line-soft)}',
    '.pz-lgrid-clue.is-missing em{font-style:normal;color:var(--warn)}',
    '.pz-lgrid-redact{letter-spacing:.05em;color:var(--dimmer)}'
  ].join('\n');

  /* ================================================================ MOUNT = */

  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var n = puzzle.n;
    var ctx = puzzle.ctx;
    var C = puzzle.content;
    var finished = false;
    var brokenClue = -1;

    var arena = null;
    var found = {};                // clue index -> you have physically read it
    var sourceOf = [];             // clue index -> { icon, name }
    var deskStation = null;
    var hudClues = null, hudCommits = null, hudRead = null;

    /** No arena, no legwork: the whole file is already on the desk. */
    function hasClue(i) { return arena ? !!found[i] : true; }

    function clueCount() {
      var k = 0;
      for (var i = 0; i < puzzle.clues.length; i++) if (hasClue(i)) k++;
      return k;
    }

    var SOURCES = (C.sources && C.sources.length) ? C.sources : [{ icon: '\uD83D\uDCC4', name: 'a piece of paper' }];
    for (var s0 = 0; s0 < puzzle.clues.length; s0++) {
      var src = SOURCES[s0 % SOURCES.length];
      sourceOf.push({
        icon: src.icon,
        name: src.name + (s0 >= SOURCES.length ? ' (' + (Math.floor(s0 / SOURCES.length) + 1) + ')' : '')
      });
    }

    var objCells = [], timeCells = [];
    var boards = h('div', { class: 'pz-lgrid-boards' });
    var clueBox = h('div', { class: 'pz-lgrid-clues' });
    var readBox = h('div', { class: 'pz-lgrid-read' });
    var metaBox = h('div', { class: 'pz-col' });
    var warnBox = h('div', {});
    var endBox = h('div', { class: 'pz-col' });

    var submitBtn = h('button', { class: 'pz-btn pz-btn--primary', type: 'button', text: '\u2714 Commit to this reading' });
    var clearBtn = h('button', { class: 'pz-btn pz-btn--sm', type: 'button', text: '\u21BA Wipe the grid' });
    var walkBtn = h('button', { class: 'pz-btn pz-btn--danger pz-btn--sm', type: 'button', text: '\u21A9 Give up on it' });

    /* --------------------------------------------------------------- grid -- */

    function makeBoard(caption, colLabels, marks, cellStore) {
      var wrap = h('div', { class: 'pz-lgrid-board' });
      wrap.appendChild(h('div', { class: 'pz-lgrid-board__cap', text: caption }));

      var grid = h('div', {
        class: 'pz-lgrid-grid',
        style: { gridTemplateColumns: 'minmax(56px,1.25fr) repeat(' + n + ', minmax(0,1fr))' }
      });
      grid.appendChild(h('div', { class: 'pz-lgrid-hcorner' }));
      for (var c = 0; c < n; c++) grid.appendChild(h('div', { class: 'pz-lgrid-hcol', text: colLabels[c] }));

      for (var r = 0; r < n; r++) {
        grid.appendChild(h('div', { class: 'pz-lgrid-hrow', text: ctx.people[r].name }));
        cellStore.push([]);
        for (c = 0; c < n; c++) {
          (function (rr, cc) {
            var cell = h('div', { class: 'pz-lgrid-cell' });
            cell.addEventListener('click', function () { cycle(marks, cellStore, rr, cc); });
            cellStore[rr].push(cell);
            grid.appendChild(cell);
          })(r, c);
        }
      }
      wrap.appendChild(grid);
      return wrap;
    }

    function cycle(marks, store, r, c) {
      if (finished) return;
      var v = (marks[r][c] + 1) % 3;
      marks[r][c] = v;
      if (v === 1) {
        // Standard logic-grid courtesy: a tick rules out its own row and column.
        for (var k = 0; k < n; k++) {
          if (k !== c && marks[r][k] === 0) marks[r][k] = 2;
          if (k !== r && marks[k][c] === 0) marks[k][c] = 2;
        }
      }
      brokenClue = -1;
      paint();
    }

    function glyph(v) { return v === 1 ? '\u2714' : (v === 2 ? '\u2716' : ''); }

    function paintBoard(marks, store) {
      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) {
          var cell = store[r][c];
          var v = marks[r][c];
          cell.className = 'pz-lgrid-cell' + (v === 1 ? ' is-yes' : (v === 2 ? ' is-no' : '')) +
            (finished ? ' is-locked' : '');
          cell.textContent = glyph(v);
        }
      }
    }

    /** A grid reads cleanly only when the ticks form a one-to-one mapping. */
    function readGrid(marks) {
      var out = new Array(n), usedCol = {};
      for (var r = 0; r < n; r++) {
        var pickd = -1;
        for (var c = 0; c < n; c++) {
          if (marks[r][c] !== 1) continue;
          if (pickd >= 0) return null;
          pickd = c;
        }
        if (pickd < 0 || usedCol[pickd]) return null;
        usedCol[pickd] = true;
        out[r] = pickd;
      }
      return out;
    }

    /* -------------------------------------------------------------- paint -- */

    /* Walking away is irreversible, so it asks once and anything else you
       touch stands it back down. */
    var quitArmed = false;

    function disarmQuit() {
      if (!quitArmed) return;
      quitArmed = false;
      walkBtn.textContent = '\u21A9 Give up on it';
    }

    function paint() {
      disarmQuit();
      paintBoard(puzzle.markObj, objCells);
      paintBoard(puzzle.markTime, timeCells);

      var ro = readGrid(puzzle.markObj);
      var rt = readGrid(puzzle.markTime);
      submitBtn.disabled = finished || !ro || !rt;

      PS.ui.clear(readBox);
      for (var p = 0; p < n; p++) {
        var oName = ro ? ctx.objects[ro[p]].name : '\u2014';
        var tName = rt ? ctx.slots[rt[p]] : '\u2014';
        readBox.appendChild(h('div', { class: 'pz-lgrid-read__row' + ((ro && rt) ? '' : ' is-gap') }, [
          h('b', { text: ctx.people[p].name }),
          h('span', { text: '\u00B7 ' + oName + ' \u00B7 ' + tName })
        ]));
      }

      PS.ui.clear(metaBox);
      PS.ui.append(metaBox, [
        h('div', { class: 'pz-lgrid-meta' }, [h('span', { text: 'Grid' }), h('b', { text: n + ' \u00D7 ' + n + ' \u00D7 ' + n })]),
        h('div', { class: 'pz-lgrid-meta' + (arena && clueCount() < puzzle.clues.length ? ' is-hot' : '') },
          [h('span', { text: 'Statements' }), h('b', { text: clueCount() + ' of ' + puzzle.clues.length })]),
        h('div', { class: 'pz-lgrid-meta' + (puzzle.attempts <= 1 ? ' is-hot' : '') },
          [h('span', { text: 'Commits left' }), h('b', { text: String(puzzle.attempts) })])
      ]);

      PS.ui.clear(warnBox);
      if (!finished && puzzle.attempts <= 1) {
        warnBox.appendChild(h('div', { class: 'pz-lgrid-warn' },
          ['One commit left. Read the statements again before you touch that button.']));
      } else if (!finished && brokenClue >= 0) {
        warnBox.appendChild(h('div', { class: 'pz-lgrid-warn' },
          ['That reading contradicts statement ' + (brokenClue + 1) + '. Everything else may still be sound.']));
      } else if (!finished && arena && clueCount() < puzzle.clues.length) {
        warnBox.appendChild(h('div', { class: 'pz-lgrid-warn' },
          [(puzzle.clues.length - clueCount()) + ' statement' + (puzzle.clues.length - clueCount() === 1 ? ' is' : 's are') +
            ' still out there on the floor. Only the full set narrows this to one arrangement.']));
      }

      paintClues();
      paintHud();
    }

    function paintHud() {
      if (!arena) return;
      var got = clueCount();
      if (hudClues) hudClues.set(got + ' of ' + puzzle.clues.length, got < puzzle.clues.length ? 'warn' : 'good');
      if (hudCommits) hudCommits.set(String(puzzle.attempts), puzzle.attempts <= 1 ? 'bad' : null);
      if (hudRead) {
        var ok = readGrid(puzzle.markObj) && readGrid(puzzle.markTime);
        hudRead.set(ok ? 'clean' : 'incomplete', ok ? 'good' : null);
      }
    }

    function paintClues() {
      PS.ui.clear(clueBox);
      for (var i = 0; i < puzzle.clues.length; i++) {
        (function (k) {
          if (!hasClue(k)) {
            clueBox.appendChild(h('div', { class: 'pz-lgrid-clue is-missing' }, [
              h('span', { class: 'pz-lgrid-clue__n', text: String(k + 1) }),
              h('span', {}, [
                h('span', { class: 'pz-lgrid-redact', text: '\u2588\u2588\u2588\u2588 \u2588\u2588\u2588\u2588\u2588\u2588 \u2588\u2588\u2588 \u2588\u2588\u2588\u2588\u2588 ' }),
                h('em', { text: '\u2014 ' + sourceOf[k].icon + ' ' + sourceOf[k].name + ', not read yet' })
              ])
            ]));
            return;
          }
          var cls = 'pz-lgrid-clue' + (puzzle.clueUsed[k] ? ' is-used' : '') + (brokenClue === k ? ' is-broken' : '');
          var row = h('div', { class: cls }, [
            h('span', { class: 'pz-lgrid-clue__n', text: String(k + 1) }),
            h('span', { text: puzzle.clues[k].text })
          ]);
          row.addEventListener('click', function () {
            puzzle.clueUsed[k] = !puzzle.clueUsed[k];
            paintClues();
          });
          clueBox.appendChild(row);
        })(i);
      }
    }

    /* ------------------------------------------------------------- commit -- */

    function submit() {
      if (finished) return;
      var ro = readGrid(puzzle.markObj);
      var rt = readGrid(puzzle.markTime);
      if (!ro || !rt) return;

      var correct = true, p;
      for (p = 0; p < n; p++) {
        if (ro[p] !== puzzle.objOf[p] || rt[p] !== puzzle.timeOf[p]) { correct = false; break; }
      }

      if (correct) { puzzle.solved = true; finished = true; renderWin(); return; }

      // Name the first statement their reading actually breaks — preferring one
      // they have actually read, so the feedback points at something they hold.
      var inv = invert(ro);
      brokenClue = -1;
      var i;
      for (i = 0; i < puzzle.clues.length; i++) {
        if (!hasClue(i)) continue;
        if (!puzzle.clues[i].t(ro, inv, rt)) { brokenClue = i; break; }
      }
      if (brokenClue < 0) {
        for (i = 0; i < puzzle.clues.length; i++) {
          if (!puzzle.clues[i].t(ro, inv, rt)) { brokenClue = i; break; }
        }
      }

      puzzle.attempts--;
      puzzle.wrong++;
      api.tweak({ health: -(3 + puzzle.tier * 2), morale: -5, energy: -3 });
      boards.classList.remove('pz-lgrid-shake'); void boards.offsetWidth; boards.classList.add('pz-lgrid-shake');
      if (arena) { arena.hit('#e2695f'); arena.shake(6, 0.35); }
      api.toast(brokenClue >= 0
        ? 'Statement ' + (brokenClue + 1) + ' says otherwise.'
        : 'The names line up and the hours do not.', 'bad', 3800);

      if (puzzle.attempts <= 0) { finished = true; renderLoss(); return; }
      paint();
    }

    /* ------------------------------------------------------------ endings -- */

    function renderWin() {
      paint();
      PS.ui.clear(endBox);
      var who = ctx.people[invert(puzzle.objOf)[puzzle.target]];
      PS.ui.append(endBox, [
        h('div', { class: 'pz-intro', text:
          who.name + ' \u2014 ' + who.note + ' \u2014 and ' + ctx.objects[puzzle.target].name +
          ', at ' + ctx.slots[puzzle.timeOf[invert(puzzle.objOf)[puzzle.target]]] + '. ' + C.prize }),
        h('div', { class: 'pz-choices' }, [branch(C.branchA), branch(C.branchB)])
      ]);
      if (deskStation) deskStation.solve();
      api.flash();
    }

    function branch(spec) {
      var b = h('button', { class: 'pz-choice', type: 'button' }, [
        h('div', { class: 'pz-choice__i', text: spec.icon }),
        h('div', { class: 'pz-choice__t', text: spec.title }),
        h('div', { class: 'pz-choice__d', text: spec.desc })
      ]);
      b.addEventListener('click', function () { finishWin(spec.id); });
      return b;
    }

    function finishWin(choice) {
      var clean = puzzle.wrong === 0;
      api.finish({
        outcome: clean ? 'success' : 'partial',
        stats: clean ? { morale: 10, energy: -6 } : { morale: 3, energy: -9 },
        gain: ['keycard'],
        lose: [],
        tags: ['read_the_room'].concat(clean ? ['first_time_right'] : []),
        signals: { logic: clean ? 4 : 3, caution: 2, speed: clean ? 1 : 0 },
        choice: choice,
        summary: 'You pinned all ' + n + ' of them to a ' + C.objWord + ' and a ' + C.timeWord +
          (clean ? ' on the first reading.' : ', eventually.')
      });
    }

    function renderLoss() {
      paint();
      PS.ui.clear(endBox);
      var lines = [];
      for (var p = 0; p < n; p++) {
        lines.push(ctx.people[p].name + ' \u2014 ' + ctx.objects[puzzle.objOf[p]].name +
          ' \u2014 ' + ctx.slots[puzzle.timeOf[p]]);
      }
      var go = h('button', { class: 'pz-btn pz-btn--danger', type: 'button', text: '\u2192 Leave it' });
      go.addEventListener('click', function () {
        api.finish({
          outcome: 'fail',
          stats: { health: -3, morale: -12, energy: -8 },
          gain: [], lose: [],
          tags: ['guessed_wrong'],
          signals: { logic: 1, caution: 1 },
          choice: null,
          summary: 'You accused the wrong people three times and stopped being welcome.'
        });
      });
      PS.ui.append(endBox, [
        h('div', { class: 'pz-intro', text: 'It was this, and you will have time to think about it:' }),
        h('div', { class: 'pz-lgrid-read' }, lines.map(function (l) {
          return h('div', { class: 'pz-lgrid-read__row' }, [h('span', { text: l })]);
        })),
        go
      ]);
    }

    function giveUp() {
      if (finished) return;
      finished = true;
      api.finish({
        outcome: 'fail',
        stats: { energy: -7, morale: -8 },
        gain: [], lose: [],
        tags: ['left_it_unsolved'],
        signals: { caution: 2 },
        choice: null,
        summary: 'You left the grid half marked and told yourself it did not matter.'
      });
    }

    /* ============================================================== WORLD == */
    /* One clue, one place on the floor to find it. */

    function readSource(i) {
      if (finished || found[i]) return;
      found[i] = true;
      api.toast(sourceOf[i].icon + ' ' + cap(sourceOf[i].name) + ': ' + puzzle.clues[i].text, 'good', 5200);
      if (deskStation) deskStation.pulse();
      paint();
    }

    function buildWorld() {
      var plan = officePlan(puzzle.clues.length);

      arena = PS.arena.create(el, {
        map: { w: plan.w, h: plan.h, tiles: plan.tiles },
        spawn: plan.spawn,
        avatar: C.avatar || '\uD83E\uDDCD',
        light: state.stats.light
      });
      if (!arena) return false;
      teardownFns.push(function () { if (arena) { arena.destroy(); arena = null; } });

      hudClues = arena.chip('Statements', '\uD83D\uDCC4');
      hudRead = arena.chip('Grid', '\uD83E\uDEAA');
      hudCommits = arena.chip('Commits', '\u2714');

      for (var i = 0; i < puzzle.clues.length; i++) addSource(i, plan.spots[i]);

      deskStation = arena.station({
        x: plan.desk.x, y: plan.desk.y, icon: C.deskIcon, label: C.deskName,
        hint: 'work the grid here', radius: 1.45, emits: 2.2,
        onEnter: function (panelEl) { PS.ui.append(panelEl, panelStack); },
        onOpen: function () { paint(); }
      });

      arena.note(C.roomNote);
      arena.focus();
      return true;
    }

    function addSource(i, spot) {
      if (!spot) return;
      arena.prop({
        x: spot.x, y: spot.y, icon: sourceOf[i].icon,
        label: cap(sourceOf[i].name), hint: 'read it',
        emits: 0.95, tint: '#6fb3e0',
        onActivate: function () { readSource(i); }
      });
    }

    /* ------------------------------------------------------------- layout -- */

    submitBtn.addEventListener('click', submit);
    clearBtn.addEventListener('click', function () {
      if (finished) return;
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) { puzzle.markObj[r][c] = 0; puzzle.markTime[r][c] = 0; }
      brokenClue = -1;
      paint();
    });
    walkBtn.addEventListener('click', function () {
      if (finished) return;
      if (!quitArmed) {
        quitArmed = true;
        walkBtn.textContent = '\u21A9 Really give up on it?';
        api.toast('Press it again if you mean it.', 'bad', 2600);
        return;
      }
      giveUp();
    });

    var objLabels = [], timeLabels = [];
    for (var i = 0; i < n; i++) {
      objLabels.push(ctx.objects[i].icon + ' ' + ctx.objects[i].name);
      timeLabels.push(ctx.slots[i]);
    }
    boards.appendChild(makeBoard(C.objHead, objLabels, puzzle.markObj, objCells));
    boards.appendChild(makeBoard(C.timeHead, timeLabels, puzzle.markTime, timeCells));

    var whoList = [];
    for (i = 0; i < n; i++) {
      whoList.push(h('div', { class: 'pz-lgrid-read__row' }, [
        h('b', { text: ctx.people[i].name }), h('span', { text: '\u00B7 ' + ctx.people[i].note })
      ]));
    }

    var howNote = h('div', { class: 'pz-note' }, [
      'Click a square to cycle ', h('strong', { text: 'blank \u2192 tick \u2192 cross' }),
      '. A tick crosses out the rest of its row and column for you. ',
      'You need every ', C.peopleWord, ' matched to one ', C.objWord, ' and one ', C.timeWord, '.'
    ]);
    var readCard = h('div', { class: 'pz-card' }, [
      h('div', { class: 'pz-card__head', text: 'What you have so far' }), readBox
    ]);
    var buttonRow = h('div', { class: 'pz-row' }, [submitBtn, clearBtn]);
    var cluesCard = h('div', { class: 'pz-card' }, [
      h('div', { class: 'pz-card__head', text: 'Statements' }),
      clueBox,
      h('div', { class: 'pz-note', text: 'Click a statement to strike it once you have used it.' })
    ]);
    var whoCard = h('div', { class: 'pz-card' }, [
      h('div', { class: 'pz-card__head', text: 'Who you are dealing with' }),
      h('div', { class: 'pz-lgrid-read' }, whoList)
    ]);
    var caseCard = h('div', { class: 'pz-card' }, [
      h('div', { class: 'pz-card__head', text: 'The case' }), metaBox
    ]);

    /* Built once. The terminal hands these exact nodes back every time you walk
       up to it, so a half-marked grid survives going out for one more clue. */
    var panelStack = h('div', { class: 'pz-lgrid-panel' }, [
      boards, howNote, readCard, buttonRow, endBox, cluesCard, whoCard, caseCard, warnBox, walkBtn
    ]);

    var arenaOk = false;
    if (PS.arena && typeof PS.arena.create === 'function') {
      try { arenaOk = buildWorld(); }
      catch (e) { arenaOk = false; if (root.console) console.warn('[e08] arena failed, falling back', e); }
    }

    if (!arenaOk) {
      /* Degraded mode: the original two-column case file, all statements known. */
      arena = null;
      PS.ui.append(el, h('div', { class: 'pz-lgrid' }, [
        h('div', { class: 'pz-col' }, [boards, howNote, readCard, buttonRow, endBox]),
        h('div', { class: 'pz-col' }, [cluesCard, whoCard, caseCard, warnBox, walkBtn])
      ]));
    }

    paint();
  }

  function unmount() {
    while (teardownFns.length) {
      try { teardownFns.pop()(); } catch (e) { /* keep unwinding */ }
    }
  }

  /* ================================================================ HINT = */

  function hint(puzzle) {
    var ctx = puzzle.ctx;
    // Point at the cheapest unmarked truth: a person whose object cell is blank.
    for (var p = 0; p < puzzle.n; p++) {
      if (puzzle.markObj[p][puzzle.objOf[p]] !== 1) {
        return ctx.people[p].name + ' goes with ' + ctx.objects[puzzle.objOf[p]].name +
          '. Work outwards from that and the rest of the column falls over.';
      }
    }
    for (p = 0; p < puzzle.n; p++) {
      if (puzzle.markTime[p][puzzle.timeOf[p]] !== 1) {
        return ctx.people[p].name + ' belongs at ' + ctx.slots[puzzle.timeOf[p]] + '. Put the tick in and cross the row.';
      }
    }
    return 'Everything you have marked is correct. Commit it.';
  }

  /* ============================================================ AUTOSOLVE = */

  function autoSolve(puzzle, rng) {
    var C = puzzle.content;
    return {
      outcome: 'success',
      stats: { morale: 10, energy: -6 },
      gain: ['keycard'],
      lose: [],
      tags: ['read_the_room', 'first_time_right'],
      signals: { logic: 4, caution: 2, speed: 1 },
      choice: rng.chance(0.5) ? C.branchA.id : C.branchB.id,
      summary: 'Crossed off every square that could not be true until only one grid was left.'
    };
  }

  /* ============================================================ REGISTER = */

  PS.registry.register({
    id: 'logic_grid',
    name: 'Logic Grid',
    icon: '\uD83E\uDEAA',
    blurb: 'Names, things, hours. The statements are all true and only one arrangement survives them.',

    favors:   { logic: 4 },
    provides: ['intel', 'access'],
    tagHooks: [],
    requires: function (state) { return state.stats.morale > 8; },

    css: CSS,

    skins: [
      {
        id: 'restricted_access', biome: 'urban', title: 'Restricted Access',
        icon: '\uD83D\uDCB3', palette: 'steel',
        intro: 'The badge reader still works. The badge log does not \u2014 somebody fed it through the shredder on the way out, and what is left is a wall of half-remembered movements. One of these people opened the stairwell, and their badge is still hanging by the lockers.',
        nouns: { people: 'badge holders', thing: 'door', when: 'badge time' }
      },
      {
        id: 'medkit_theft', biome: 'shelter', title: 'Who Took the Medkit',
        icon: '\uD83E\uDE79', palette: 'bone',
        intro: 'Five people went into the store in the night and five things came out of it. Everyone remembers a piece of the order and nobody remembers all of it. Marisol has been coughing since Tuesday and the medkit is not on the shelf.',
        nouns: { people: 'the others', thing: 'item', when: 'hour' }
      },
      {
        id: 'crew_manifest', biome: 'water', title: 'Crew Manifest',
        icon: '\uD83E\uDDED', palette: 'ice',
        intro: 'The manifest board has five names on brass slides and no stations against them. The mate logged nothing for the whole watch. If you can put each of them where they were, you know which compartment to open and which one to leave shut.',
        nouns: { people: 'crew', thing: 'station', when: 'watch' }
      }
    ],

    build: build,
    mount: mount,
    unmount: unmount,
    hint: hint,
    autoSolve: autoSolve
  });

})(typeof window !== 'undefined' ? window : this);
