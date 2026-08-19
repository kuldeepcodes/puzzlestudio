/* ==========================================================================
   PuzzleStudio — js/games/e04_constraint_crossing.js
                                              ENGINE 04 · Constraint Crossing
   --------------------------------------------------------------------------
   Self-contained: logic + 3 skins + its own CSS. No DOM access until mount().

   THE PUZZLE
     The oldest one there is, wearing a different coat. A carrier that takes
     you and one thing (two at the top tiers), a load of cargo that has to
     get across, and pairs that cannot be left on a bank without you standing
     between them. Fuel can and lantern. Dog and rations. You know the shape.

   ALWAYS SOLVABLE, NEVER STUCK
     Generation is verified by a BFS over the whole state space (2^n banks x
     2 carrier positions) and thrown away and regenerated if it is unsolvable
     or too easy. Illegal trips are refused rather than punished, and every
     legal trip is reversible, so the reachable graph is undirected: you can
     always get back to the start and therefore always to the far bank.

   THE DECISION
     You are scored on trips against the true optimum, and you can always cut
     the knot by abandoning a piece of cargo — instantly easier, permanently
     poorer. Patience against pragmatism, with a number attached.

   THE BRANCH
     On the far bank you decide what happens to the crossing behind you: cut
     it loose so nothing follows, or leave it tied for whoever comes next.

   The Director force-routes here after a failure in a water biome, so this
   engine gates on nothing and needs nothing in the pack.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio;
  if (!PS || !PS.registry) { if (root.console) console.error('[e04] core not loaded'); return; }

  /* ======================================================== SKIN CONTENT ==
     Every skin brings its own cargo and, crucially, its own reasons two
     things cannot be left alone. The reasons are the flavour AND the rules. */

  var CONTENT = {
    flooded_crossing: {
      carrier: 'the raft', carrierIcon: '\uD83D\uDEF6',
      near: 'This side', far: 'The far side',
      cast: 'Pole across',
      arrive: 'You stand dripping on the far bank with everything that made it.',
      cargo: [
        { key: 'fuelcan', n: 'Fuel can',     i: '\u26FD',            item: 'fuel' },
        { key: 'lantern', n: 'Storm lantern', i: '\uD83C\uDFEE',      item: 'lamp' },
        { key: 'dog',     n: 'The dog',      i: '\uD83D\uDC15',      item: 'ally' },
        { key: 'rations', n: 'Sack of rations', i: '\uD83E\uDD6B',   item: 'ration' },
        { key: 'medbox',  n: 'Medical box',  i: '\uD83E\uDE79',      item: 'medkit' },
        { key: 'radio',   n: 'Field radio',  i: '\uD83D\uDCFB',      item: 'radio' },
        { key: 'battery', n: 'Wet cell battery', i: '\uD83D\uDD0B',  item: 'battery' }
      ],
      conflicts: [
        { a: 'fuelcan', b: 'lantern', why: 'A lit lantern and an open can of fuel do not share a bank.' },
        { a: 'dog',     b: 'rations', why: 'The dog has been looking at that sack since you found it.' },
        { a: 'battery', b: 'medbox',  why: 'The cell is weeping acid straight through the dressings.' },
        { a: 'radio',   b: 'fuelcan', why: 'The set arcs when it is wet, and fuel does not need much.' },
        { a: 'dog',     b: 'medbox',  why: 'Leave the dog with anything that smells of blood and you lose both.' },
        { a: 'lantern', b: 'rations', why: 'A lantern left burning against dry sacking is a fire waiting on you.' },
        { a: 'battery', b: 'radio',   why: 'Connected unattended, the set drains the cell flat in minutes.' }
      ]
    },

    rope_bridge_ferry: {
      carrier: 'the cradle', carrierIcon: '\uD83E\uDE9D',
      near: 'The near ledge', far: 'The far ledge',
      cast: 'Haul across',
      arrive: 'The cradle bumps the far ledge and you get your weight onto rock.',
      cargo: [
        { key: 'fuelcan', n: 'Stove fuel',     i: '\u26FD',          item: 'fuel' },
        { key: 'lantern', n: 'Hurricane lamp', i: '\uD83C\uDFEE',    item: 'lamp' },
        { key: 'dog',     n: 'The hound',      i: '\uD83D\uDC15',    item: 'ally' },
        { key: 'rations', n: 'Food bag',       i: '\uD83E\uDD6B',    item: 'ration' },
        { key: 'medbox',  n: 'Casualty bag',   i: '\uD83E\uDE79',    item: 'medkit' },
        { key: 'radio',   n: 'Beacon set',     i: '\uD83D\uDCFB',    item: 'radio' },
        { key: 'battery', n: 'Spare cell',     i: '\uD83D\uDD0B',    item: 'battery' }
      ],
      conflicts: [
        { a: 'fuelcan', b: 'lantern', why: 'Naked flame beside a leaking stove bottle. On a ledge. No.' },
        { a: 'dog',     b: 'rations', why: 'She will have the bag open before you are halfway back.' },
        { a: 'battery', b: 'medbox',  why: 'The cell leaks and the dressings soak up whatever is going.' },
        { a: 'radio',   b: 'fuelcan', why: 'The beacon runs hot. Fuel vapour finds hot things.' },
        { a: 'dog',     b: 'medbox',  why: 'She chews anything that smells like the inside of a person.' },
        { a: 'lantern', b: 'rations', why: 'Lamp against a paper sack, wind coming up the gorge. Pick one.' },
        { a: 'battery', b: 'radio',   why: 'Left connected the beacon will flatten the spare and you need both.' }
      ]
    },

    elevator_weight: {
      carrier: 'the car', carrierIcon: '\uD83D\uDEC2',
      near: 'Sub-level', far: 'Street level',
      cast: 'Send the car',
      arrive: 'The doors open on street level and something like air comes in.',
      cargo: [
        { key: 'fuelcan', n: 'Generator can', i: '\u26FD',           item: 'fuel' },
        { key: 'lantern', n: 'Work lamp',     i: '\uD83C\uDFEE',     item: 'lamp' },
        { key: 'dog',     n: 'Site dog',      i: '\uD83D\uDC15',     item: 'ally' },
        { key: 'rations', n: 'Canteen crate', i: '\uD83E\uDD6B',     item: 'ration' },
        { key: 'medbox',  n: 'Wall medkit',   i: '\uD83E\uDE79',     item: 'medkit' },
        { key: 'radio',   n: 'Site radio',    i: '\uD83D\uDCFB',     item: 'radio' },
        { key: 'battery', n: 'Trolley battery', i: '\uD83D\uDD0B',   item: 'battery' }
      ],
      conflicts: [
        { a: 'fuelcan', b: 'lantern', why: 'The lamp ballast sparks on start-up. The can is not sealed.' },
        { a: 'dog',     b: 'rations', why: 'He has had nothing for two days and that crate is not locked.' },
        { a: 'battery', b: 'medbox',  why: 'Acid and gauze in an unventilated lobby. Not unattended.' },
        { a: 'radio',   b: 'fuelcan', why: 'Transmit next to open fuel in a sealed shaft and see what happens.' },
        { a: 'dog',     b: 'medbox',  why: 'He goes straight through the bag for the tape and the gloves.' },
        { a: 'lantern', b: 'rations', why: 'The lamp housing runs hot enough to take the crate with it.' },
        { a: 'battery', b: 'radio',   why: 'They stay linked and the set drinks the trolley flat.' }
      ]
    }
  };

  /* ============================================================== SOLVER ==
     State = (mask of cargo on the FAR bank, side of the carrier).
     0 = near, 1 = far. Legality: the bank you are NOT standing on must not
     hold both halves of any conflicting pair. */

  function bankHasConflict(mask, onFar, conflicts, idx) {
    // The unattended bank: if you are on the far side, the near bank is the
    // one nobody is watching.
    var unattended = onFar ? (~mask) : mask;
    for (var i = 0; i < conflicts.length; i++) {
      var a = 1 << idx[conflicts[i].a];
      var b = 1 << idx[conflicts[i].b];
      if ((unattended & a) && (unattended & b)) return conflicts[i];
    }
    return null;
  }

  /**
   * Every subset of `pool` (a bitmask) holding at most `cap` pieces, empty
   * run included. Standard submask enumeration — the whole state space for
   * seven pieces is 3^7 pairs, so this stays cheap enough to run inside a
   * generate-and-verify loop.
   */
  function subsetsOf(pool, cap) {
    var out = [0];
    for (var s = pool; s; s = (s - 1) & pool) {
      if (popcount(s) <= cap) out.push(s);
    }
    return out;
  }

  function popcount(m) {
    var n = 0;
    while (m) { m &= m - 1; n++; }
    return n;
  }

  function stateKey(mask, side) { return mask * 2 + side; }

  /**
   * BFS across the legal state space.
   * @returns {object} { dist: {key:trips}, prev: {key:[fromKey, moveMask]} }
   */
  function explore(n, conflicts, idx, cap, start) {
    var full = (1 << n) - 1;
    var dist = {}, prev = {};
    var q = [start], headI = 0;
    dist[stateKey(start.mask, start.side)] = 0;

    while (headI < q.length) {
      var cur = q[headI++];
      var here = cur.side ? cur.mask : (full & ~cur.mask);   // cargo on YOUR bank
      var moves = subsetsOf(here, cap);
      for (var i = 0; i < moves.length; i++) {
        var mv = moves[i];
        var nextMask = cur.side ? (cur.mask & ~mv) : (cur.mask | mv);
        var nextSide = cur.side ? 0 : 1;
        if (bankHasConflict(nextMask, !!nextSide, conflicts, idx)) continue;
        var k = stateKey(nextMask, nextSide);
        if (dist[k] !== undefined) continue;
        dist[k] = dist[stateKey(cur.mask, cur.side)] + 1;
        prev[k] = [stateKey(cur.mask, cur.side), mv];
        q.push({ mask: nextMask, side: nextSide });
      }
    }
    return { dist: dist, prev: prev };
  }

  /** Shortest sequence of load-masks from the current state to everything across. */
  function solutionFrom(n, conflicts, idx, cap, mask, side) {
    var full = (1 << n) - 1;
    if (n === 0) return [];
    var res = explore(n, conflicts, idx, cap, { mask: mask, side: side });
    var goal = stateKey(full, 1);
    if (res.dist[goal] === undefined) return null;
    var path = [], k = goal;
    while (res.prev[k]) { path.unshift(res.prev[k][1]); k = res.prev[k][0]; }
    return path;
  }

  /* ============================================================== BUILD ==
     Generate, verify, keep the best. The conflict graph is a ring, so the
     number of rules a given cargo set can actually support varies wildly:
     with a one-piece carrier anything past two rules is provably unsolvable,
     while a two-piece carrier needs three or four before the crossing stops
     being a straight sweep. Rather than guess, we sample the whole parameter
     space and keep the hardest arrangement that a BFS says is solvable. */

  function build(state, rng, tier, skin) {
    var C = CONTENT[skin.id] || CONTENT.flooded_crossing;
    var t = Math.min(6, tier);

    var n = Math.min(C.cargo.length, 3 + Math.ceil(t / 1.5));   // 4 at T1 up to 7 at T6
    var cap = t >= 3 ? 2 : 1;
    var floorTrips = Math.max(1, Math.ceil(n / cap) * 2 - 1);
    var maxRules = Math.min(5, C.conflicts.length);

    var best = null, loose = null, hits = 0, guard;

    for (guard = 0; guard < 40 && hits < 4; guard++) {
      var cargo = rng.sample(C.cargo, n);
      var idx = {}, i;
      for (i = 0; i < cargo.length; i++) idx[cargo[i].key] = i;

      var eligible = C.conflicts.filter(function (c) {
        return idx[c.a] !== undefined && idx[c.b] !== undefined;
      });
      if (eligible.length < 2) continue;

      var conflicts = rng.sample(eligible, rng.int(2, Math.min(maxRules, eligible.length)));
      var sol = solutionFrom(cargo.length, conflicts, idx, cap, 0, 0);
      if (!sol) continue;

      var candidate = { cargo: cargo, idx: idx, conflicts: conflicts, optimal: sol.length };

      // Solvable but a straight sweep across is not a puzzle — hold it in
      // reserve in case nothing better turns up, and keep looking.
      if (sol.length <= floorTrips) {
        if (!loose || sol.length > loose.optimal) loose = candidate;
        continue;
      }

      hits++;
      var score = sol.length * 10 + conflicts.length;
      if (!best || score > best.score) { candidate.score = score; best = candidate; }
    }

    var chosen = best || loose;

    if (!chosen) {
      // Pathological seed: fall back to the canonical four-piece crossing on
      // a one-piece carrier, which is solvable by construction. The scene
      // must never be dead.
      var base = [], wanted = ['dog', 'rations', 'fuelcan', 'lantern'], w, c2;
      for (w = 0; w < wanted.length; w++) {
        for (c2 = 0; c2 < C.cargo.length; c2++) {
          if (C.cargo[c2].key === wanted[w]) base.push(C.cargo[c2]);
        }
      }
      var bidx = {};
      for (var b = 0; b < base.length; b++) bidx[base[b].key] = b;
      var bconf = C.conflicts.filter(function (cc) {
        return bidx[cc.a] !== undefined && bidx[cc.b] !== undefined;
      }).slice(0, 2);
      cap = 1;
      chosen = {
        cargo: base, idx: bidx, conflicts: bconf,
        optimal: (solutionFrom(base.length, bconf, bidx, 1, 0, 0) || []).length || 9
      };
    }

    return {
      tier: t,
      cap: cap,
      cargo: chosen.cargo,
      idx: chosen.idx,
      conflicts: chosen.conflicts,
      optimal: chosen.optimal,
      mask: 0,               // bitmask of cargo currently on the far bank
      side: 0,               // 0 near, 1 far
      loaded: 0,             // bitmask currently in the carrier
      abandoned: [],         // keys given up on
      trips: 0,
      refused: 0,
      arrived: false,
      content: C
    };
  }

  function fullMask(puzzle) { return (1 << puzzle.cargo.length) - 1; }

  /* ================================================================ CSS == */

  var CSS = [
    '.pz-xing{display:flex;flex-direction:column;gap:16px}',

    '.pz-xing-water{display:grid;grid-template-columns:minmax(0,1fr) minmax(150px,auto) minmax(0,1fr);gap:12px;align-items:stretch}',
    '@media (max-width:820px){.pz-xing-water{grid-template-columns:1fr}}',

    '.pz-xing-bank{display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:12px;',
    '  border:1px solid var(--line);background:linear-gradient(180deg,var(--panel-2),var(--panel));min-height:150px;',
    '  transition:border-color .25s var(--ease),box-shadow .25s var(--ease)}',
    '.pz-xing-bank.is-here{border-color:var(--acc);box-shadow:0 0 26px var(--acc-glow) inset}',
    '.pz-xing-bank.is-risk{border-color:var(--bad)}',
    '.pz-xing-bank__h{display:flex;justify-content:space-between;align-items:center;',
    '  font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--dim)}',
    '.pz-xing-bank__h b{color:var(--acc-2);letter-spacing:0;text-transform:none;font-size:12px}',
    '.pz-xing-bank__list{display:flex;flex-wrap:wrap;gap:7px}',

    '.pz-xing-item{display:inline-flex;gap:6px;align-items:center;padding:6px 10px;border-radius:9px;',
    '  border:1px solid var(--line);background:var(--panel-3);color:var(--text);font-size:12px;cursor:pointer;',
    '  transition:transform .15s var(--ease),border-color .15s var(--ease),opacity .15s var(--ease)}',
    '.pz-xing-item:hover:not(:disabled){transform:translateY(-2px);border-color:var(--acc)}',
    '.pz-xing-item:disabled{cursor:default;opacity:.4}',
    '.pz-xing-item.is-loaded{border-color:var(--acc-2);background:var(--acc-wash)}',
    '.pz-xing-item.is-gone{opacity:.25;text-decoration:line-through}',
    '.pz-xing-item__i{font-size:16px}',

    '.pz-xing-boat{display:flex;flex-direction:column;gap:9px;align-items:center;justify-content:center;',
    '  padding:12px;border-radius:12px;border:1px dashed var(--acc);background:color-mix(in srgb,var(--acc) 8%,var(--panel))}',
    '.pz-xing-boat__i{font-size:30px;line-height:1}',
    '.pz-xing-boat__s{font-family:var(--font-mono);font-size:11px;color:var(--dim);text-align:center;line-height:1.5}',
    '.pz-xing-boat__hold{display:flex;flex-wrap:wrap;gap:5px;justify-content:center;min-height:22px}',
    '.pz-xing-boat.is-far{border-color:var(--acc-2)}',

    '.pz-xing-rules{display:flex;flex-direction:column;gap:6px}',
    '.pz-xing-rule{display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;align-items:baseline;',
    '  font-size:12px;color:var(--text-2);line-height:1.45}',
    '.pz-xing-rule__p{font-family:var(--font-mono);font-size:11px;color:var(--acc-2);white-space:nowrap}',
    '.pz-xing-rule.is-live{color:var(--bad)}',
    '.pz-xing-rule.is-dead{opacity:.35;text-decoration:line-through}',

    '.pz-xing-count{display:flex;gap:16px;flex-wrap:wrap;font-family:var(--font-mono);font-size:12px;color:var(--dim)}',
    '.pz-xing-count b{color:var(--acc-2)}',
    '.pz-xing-count .over{color:var(--bad)}',

    '.pz-xing-warn{font-size:12px;line-height:1.5;color:var(--bad);padding:8px 10px;border-radius:7px;',
    '  background:rgba(226,105,95,.08);border:1px solid rgba(226,105,95,.28)}',

    '.pz-xing-go{animation:pzXingBob 3.2s var(--ease) infinite}',
    '@keyframes pzXingBob{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}'
  ].join('\n');

  /* ================================================================ MOUNT = */

  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var C = puzzle.content;
    var finished = false;

    var nearBank = h('div', { class: 'pz-xing-bank' });
    var farBank  = h('div', { class: 'pz-xing-bank' });
    var boatBox  = h('div', { class: 'pz-xing-boat' });
    var rulesBox = h('div', { class: 'pz-xing-rules' });
    var countBox = h('div', { class: 'pz-xing-count' });
    var warnBox  = h('div', {});
    var actions  = h('div', { class: 'pz-row' });

    function isAbandoned(key) { return puzzle.abandoned.indexOf(key) >= 0; }
    function bitOf(key) { return 1 << puzzle.idx[key]; }
    function onFarBank(c) { return !!(puzzle.mask & bitOf(c.key)); }
    function isLoaded(c) { return !!(puzzle.loaded & bitOf(c.key)); }

    /** Conflicts that still have both halves in play. */
    function liveConflicts() {
      return puzzle.conflicts.filter(function (c) {
        return !isAbandoned(c.a) && !isAbandoned(c.b);
      });
    }

    /** What the unattended bank would look like after casting off right now. */
    function previewConflict() {
      var nextMask = puzzle.side ? (puzzle.mask & ~puzzle.loaded) : (puzzle.mask | puzzle.loaded);
      var nextSide = puzzle.side ? 0 : 1;
      return conflictOn(nextMask, nextSide);
    }

    function conflictOn(mask, side) {
      var live = liveConflicts();
      var unattended = side ? (fullMask(puzzle) & ~mask) : mask;
      for (var i = 0; i < live.length; i++) {
        var a = bitOf(live[i].a), b = bitOf(live[i].b);
        if ((unattended & a) && (unattended & b)) return live[i];
      }
      return null;
    }

    /* ------------------------------------------------------------- render */

    function chip(c) {
      var loaded = isLoaded(c);
      var gone = isAbandoned(c.key);
      var reachable = !gone && !loaded && (onFarBank(c) === !!puzzle.side);
      var btn = h('button', {
        type: 'button',
        class: 'pz-xing-item' + (loaded ? ' is-loaded' : '') + (gone ? ' is-gone' : ''),
        disabled: finished || gone || !reachable,
        title: gone ? 'Left behind.' : (reachable ? 'Put it in ' + C.carrier : 'Not on your side.')
      }, [
        h('span', { class: 'pz-xing-item__i', text: c.i }),
        h('span', { text: c.n })
      ]);
      btn.addEventListener('click', function () { load(c); });
      return btn;
    }

    function paintBanks() {
      var i, c;

      PS.ui.clear(nearBank);
      PS.ui.clear(farBank);

      var nearList = h('div', { class: 'pz-xing-bank__list' });
      var farList  = h('div', { class: 'pz-xing-bank__list' });
      var nearN = 0, farN = 0;

      for (i = 0; i < puzzle.cargo.length; i++) {
        c = puzzle.cargo[i];
        if (isLoaded(c)) continue;
        if (isAbandoned(c.key)) {
          (onFarBank(c) ? farList : nearList).appendChild(chip(c));
          continue;
        }
        if (onFarBank(c)) { farList.appendChild(chip(c)); farN++; }
        else { nearList.appendChild(chip(c)); nearN++; }
      }
      if (!nearN) nearList.appendChild(h('span', { class: 'pz-note', text: 'Clear.' }));
      if (!farN) farList.appendChild(h('span', { class: 'pz-note', text: 'Nothing across yet.' }));

      var nearRisk = conflictOn(puzzle.mask, 1);
      var farRisk  = conflictOn(puzzle.mask, 0);

      nearBank.className = 'pz-xing-bank' + (puzzle.side === 0 ? ' is-here' : (nearRisk ? ' is-risk' : ''));
      farBank.className  = 'pz-xing-bank' + (puzzle.side === 1 ? ' is-here' : (farRisk ? ' is-risk' : ''));

      PS.ui.append(nearBank, [
        h('div', { class: 'pz-xing-bank__h' }, [
          h('span', { text: C.near }),
          h('b', { text: puzzle.side === 0 ? 'you are here' : nearN + ' left' })
        ]),
        nearList
      ]);
      PS.ui.append(farBank, [
        h('div', { class: 'pz-xing-bank__h' }, [
          h('span', { text: C.far }),
          h('b', { text: puzzle.side === 1 ? 'you are here' : farN + ' across' })
        ]),
        farList
      ]);
    }

    function paintBoat() {
      PS.ui.clear(boatBox);
      boatBox.className = 'pz-xing-boat' + (puzzle.side ? ' is-far' : '');

      var hold = h('div', { class: 'pz-xing-boat__hold' });
      var carried = 0, i;
      for (i = 0; i < puzzle.cargo.length; i++) {
        if (!isLoaded(puzzle.cargo[i])) continue;
        carried++;
        (function (c) {
          var b = h('button', { type: 'button', class: 'pz-xing-item is-loaded', disabled: finished }, [
            h('span', { class: 'pz-xing-item__i', text: c.i }),
            h('span', { text: c.n })
          ]);
          b.addEventListener('click', function () { unload(c); });
          hold.appendChild(b);
        })(puzzle.cargo[i]);
      }
      if (!carried) hold.appendChild(h('span', { class: 'pz-note', text: 'empty' }));

      PS.ui.append(boatBox, [
        h('div', { class: 'pz-xing-boat__i' + (finished ? '' : ' pz-xing-go'), text: C.carrierIcon }),
        h('div', { class: 'pz-xing-boat__s', text: PS.state.prettify(C.carrier) }),
        h('div', { class: 'pz-xing-boat__s', text: puzzle.side ? 'tied up at ' + C.far.toLowerCase() : 'tied up at ' + C.near.toLowerCase() }),
        hold,
        h('div', { class: 'pz-xing-boat__s', text: carried + ' of ' + puzzle.cap + ' slot' + (puzzle.cap === 1 ? '' : 's') + ' used' })
      ]);
    }

    function paintRules() {
      PS.ui.clear(rulesBox);
      var risk = previewConflict();
      for (var i = 0; i < puzzle.conflicts.length; i++) {
        var c = puzzle.conflicts[i];
        var dead = isAbandoned(c.a) || isAbandoned(c.b);
        var an = nameOf(c.a), bn = nameOf(c.b);
        rulesBox.appendChild(h('div', {
          class: 'pz-xing-rule' + (dead ? ' is-dead' : (risk === c ? ' is-live' : ''))
        }, [
          h('span', { class: 'pz-xing-rule__p', text: an + ' \u2715 ' + bn }),
          h('span', { text: c.why })
        ]));
      }
    }

    function nameOf(key) {
      for (var i = 0; i < puzzle.cargo.length; i++) if (puzzle.cargo[i].key === key) return puzzle.cargo[i].n;
      return PS.state.prettify(key);
    }

    function paintCount() {
      PS.ui.clear(countBox);
      var over = puzzle.trips > puzzle.optimal;
      PS.ui.append(countBox, [
        h('span', {}, ['Trips: ', h('b', { class: over ? 'over' : '', text: String(puzzle.trips) })]),
        h('span', {}, ['Best possible: ', h('b', { text: String(puzzle.optimal) })]),
        h('span', {}, ['Left behind: ', h('b', { text: String(puzzle.abandoned.length) })])
      ]);

      PS.ui.clear(warnBox);
      if (finished) return;
      var risk = previewConflict();
      if (risk) {
        warnBox.appendChild(h('div', { class: 'pz-xing-warn', text: 'Cast off like that and you leave it behind you: ' + risk.why }));
      } else if (puzzle.refused > 2 && !puzzle.arrived) {
        warnBox.appendChild(h('div', { class: 'pz-note', text: 'If a piece of this is not worth the trips, you can always leave it.' }));
      }
    }

    function paintAll() { paintBanks(); paintBoat(); paintRules(); paintCount(); paintActions(); }

    /* ------------------------------------------------------------ actions */

    function load(c) {
      if (finished || puzzle.arrived) return;
      if (isAbandoned(c.key)) return;
      if (onFarBank(c) !== !!puzzle.side) return;
      var carried = popcount(puzzle.loaded);
      if (carried >= puzzle.cap) { api.toast(PS.state.prettify(C.carrier) + ' will not take any more.', 'bad', 1500); return; }
      puzzle.loaded |= bitOf(c.key);
      paintAll();
    }

    function unload(c) {
      if (finished) return;
      puzzle.loaded &= ~bitOf(c.key);
      paintAll();
    }

    function cast() {
      if (finished || puzzle.arrived) return;
      var risk = previewConflict();
      if (risk) {
        puzzle.refused++;
        api.toast(risk.why, 'bad', 3200);
        return;
      }
      puzzle.mask = puzzle.side ? (puzzle.mask & ~puzzle.loaded) : (puzzle.mask | puzzle.loaded);
      puzzle.side = puzzle.side ? 0 : 1;
      puzzle.loaded = 0;
      puzzle.trips++;
      api.tweak({ energy: -1 });
      paintAll();
      checkDone();
    }

    function abandonSelected() {
      if (finished || puzzle.arrived) return;
      var candidates = [];
      for (var i = 0; i < puzzle.cargo.length; i++) {
        var c = puzzle.cargo[i];
        if (isAbandoned(c.key)) continue;
        if (isLoaded(c) || onFarBank(c) === !!puzzle.side) candidates.push(c);
      }
      if (!candidates.length) { api.toast('Nothing on this side to leave.', 'bad', 1500); return; }
      PS.ui.clear(actions);
      PS.ui.append(actions, [h('span', { class: 'pz-note', text: 'Leave which one?' })]);
      for (var j = 0; j < candidates.length; j++) {
        (function (c) {
          var b = h('button', { class: 'pz-btn pz-btn--sm pz-btn--danger', type: 'button' }, [c.i + ' ' + c.n]);
          b.addEventListener('click', function () { doAbandon(c); });
          actions.appendChild(b);
        })(candidates[j]);
      }
      var cancel = h('button', { class: 'pz-btn pz-btn--sm pz-btn--ghost', type: 'button' }, ['Keep them all']);
      cancel.addEventListener('click', function () { paintActions(); });
      actions.appendChild(cancel);
    }

    function doAbandon(c) {
      puzzle.abandoned.push(c.key);
      puzzle.loaded &= ~bitOf(c.key);
      api.tweak({ morale: -4 });
      api.toast('You leave the ' + c.n.toLowerCase() + ' where it stands.', 'bad');
      paintAll();
      checkDone();
    }

    function remainingNear() {
      var n = 0;
      for (var i = 0; i < puzzle.cargo.length; i++) {
        var c = puzzle.cargo[i];
        if (isAbandoned(c.key)) continue;
        if (!onFarBank(c) || isLoaded(c)) n++;
      }
      return n;
    }

    function checkDone() {
      if (puzzle.arrived || finished) return;
      if (puzzle.side !== 1) return;
      if (remainingNear() > 0) return;
      puzzle.arrived = true;
      renderArrival();
    }

    function paintActions() {
      if (finished || puzzle.arrived) return;
      PS.ui.clear(actions);
      var risk = previewConflict();
      PS.ui.append(actions, [
        h('button', {
          class: 'pz-btn pz-btn--primary', type: 'button', onclick: cast,
          title: risk ? risk.why : 'Cross with what is loaded'
        }, [C.carrierIcon + ' ' + C.cast]),
        h('button', { class: 'pz-btn pz-btn--sm', type: 'button', onclick: abandonSelected }, ['\u2716 Leave something']),
        h('button', { class: 'pz-btn pz-btn--sm pz-btn--danger', type: 'button', onclick: giveUp }, ['\u21A9 Go round the long way'])
      ]);
    }

    /* ----------------------------------------------------------- the exit */

    function renderArrival() {
      paintBanks(); paintBoat(); paintRules(); paintCount();
      PS.ui.clear(actions);
      var over = puzzle.trips - puzzle.optimal;
      PS.ui.append(actions, [
        h('div', { class: 'pz-intro', text: C.arrive + ' ' + puzzle.trips + ' trip' + (puzzle.trips === 1 ? '' : 's') +
          (over > 0 ? ', ' + over + ' more than you needed.' : ', which is as clean as it gets.') }),
        h('div', { class: 'pz-choices' }, [
          branch('\u2702\uFE0F', 'Cut it loose behind you', 'Push ' + C.carrier + ' out and let it go. Nothing crosses after you, including anything that was following.', 'wade'),
          branch('\uD83E\uDEA2', 'Leave it tied off', 'Make it fast on this side and leave the line where it can be seen. Somebody else is going to need it.', 'signal')
        ])
      ]);
      api.flash();
    }

    function branch(ic, title, desc, id) {
      return h('button', { class: 'pz-choice', type: 'button', onclick: function () { finishRun(id); } }, [
        h('div', { class: 'pz-choice__i', text: ic }),
        h('div', { class: 'pz-choice__t', text: title }),
        h('div', { class: 'pz-choice__d', text: desc })
      ]);
    }

    function finishRun(mode) {
      if (finished) return;
      finished = true;

      var lost = puzzle.abandoned.length;
      var clean = puzzle.trips <= puzzle.optimal;
      var tidy = puzzle.trips <= Math.ceil(puzzle.optimal * 1.4);

      var outcome = (lost === 0 && tidy) ? 'success' : (lost <= 1 ? 'partial' : 'fail');

      var gain = [], i;
      for (i = 0; i < puzzle.cargo.length; i++) {
        var c = puzzle.cargo[i];
        if (isAbandoned(c.key)) continue;
        gain.push(c.item);
      }

      var tags = ['made_the_crossing'];
      if (clean) tags.push('crossed_clean');
      if (lost) tags.push('left_cargo');
      tags.push(mode === 'wade' ? 'burned_the_crossing' : 'left_the_way_open');

      api.finish({
        outcome: outcome,
        stats: {
          energy: -(3 + puzzle.trips),
          morale: (clean ? 9 : tidy ? 3 : -4) - lost * 3 + (mode === 'signal' ? 3 : 0),
          health: mode === 'wade' ? -1 : 0
        },
        gain: gain.slice(0, 8),
        lose: [],
        tags: tags,
        signals: {
          logic: clean ? 4 : (tidy ? 2 : 1),
          caution: mode === 'wade' ? 3 : 1,
          speed: puzzle.trips <= puzzle.optimal ? 2 : 0,
          scavenge: lost === 0 ? 2 : 0
        },
        choice: mode,
        summary: 'Everything but ' + (lost ? lost + ' piece' + (lost === 1 ? '' : 's') : 'nothing') +
          ' got across in ' + puzzle.trips + ' trip' + (puzzle.trips === 1 ? '' : 's') +
          ' against a best of ' + puzzle.optimal + '.'
      });
    }

    function giveUp() {
      if (finished) return;
      finished = true;
      api.finish({
        outcome: 'fail',
        stats: { energy: -14, morale: -8, health: -3 },
        gain: [], lose: [], tags: ['turned_back'],
        signals: { caution: 2 },
        choice: null,
        summary: 'You left the whole load on the bank and went round, which took hours you did not have.'
      });
    }

    /* ------------------------------------------------------------- layout */

    PS.ui.append(el, h('div', { class: 'pz-xing' }, [
      h('div', { class: 'pz-note' }, [
        PS.state.prettify(C.carrier) + ' takes you and ',
        h('strong', { text: puzzle.cap === 1 ? 'one thing' : puzzle.cap + ' things' }),
        '. Whatever you are not standing beside is on its own \u2014 and some of it cannot be trusted together.'
      ]),
      h('div', { class: 'pz-xing-water' }, [nearBank, boatBox, farBank]),
      warnBox,
      h('div', { class: 'pz-card' }, [
        h('div', { class: 'pz-card__head', text: 'What cannot be left alone' }),
        rulesBox
      ]),
      countBox,
      actions
    ]));

    paintAll();
  }

  function unmount() {
    while (teardownFns.length) {
      try { teardownFns.pop()(); } catch (e) { /* keep unwinding */ }
    }
  }

  /* ================================================================ HINT = */

  function hint(puzzle, state) {
    var live = puzzle.conflicts.filter(function (c) {
      return puzzle.abandoned.indexOf(c.a) < 0 && puzzle.abandoned.indexOf(c.b) < 0;
    });
    var idx = {}, cargo = [], i;
    for (i = 0; i < puzzle.cargo.length; i++) {
      if (puzzle.abandoned.indexOf(puzzle.cargo[i].key) >= 0) continue;
      idx[puzzle.cargo[i].key] = cargo.length;
      cargo.push(puzzle.cargo[i]);
    }
    // Re-index the current position onto the reduced (non-abandoned) set.
    var mask = 0;
    for (i = 0; i < cargo.length; i++) {
      var bit = 1 << puzzle.idx[cargo[i].key];
      if (puzzle.mask & bit) mask |= (1 << i);
    }
    var sol = solutionFrom(cargo.length, live, idx, puzzle.cap, mask, puzzle.side);
    if (!sol) return 'From here there is no clean way through. Something has to stay behind.';
    if (!sol.length) return 'It is done. Everything is across.';

    var mv = sol[0];
    var names = [];
    for (i = 0; i < cargo.length; i++) if (mv & (1 << i)) names.push(cargo[i].n.toLowerCase());
    var dir = puzzle.side ? 'back' : 'across';
    return (names.length ? 'Take the ' + names.join(' and the ') + ' ' + dir : 'Go ' + dir + ' with nothing') +
      '. ' + sol.length + ' trip' + (sol.length === 1 ? '' : 's') + ' left if you do not waste one.';
  }

  /* ============================================================ AUTOSOLVE = */

  function autoSolve(puzzle, rng) {
    var sol = solutionFrom(puzzle.cargo.length, puzzle.conflicts, puzzle.idx, puzzle.cap, puzzle.mask, puzzle.side);
    var trips = sol ? puzzle.trips + sol.length : puzzle.optimal;
    var mode = rng.chance(0.5) ? 'wade' : 'signal';
    var gain = [], i;
    for (i = 0; i < puzzle.cargo.length; i++) {
      if (puzzle.abandoned.indexOf(puzzle.cargo[i].key) >= 0) continue;
      gain.push(puzzle.cargo[i].item);
    }

    return {
      outcome: sol ? 'success' : 'partial',
      stats: { energy: -(3 + trips), morale: sol ? 9 : -2 },
      gain: gain.slice(0, 8),
      lose: [],
      tags: ['made_the_crossing', 'crossed_clean',
        mode === 'wade' ? 'burned_the_crossing' : 'left_the_way_open'],
      signals: { logic: 4, caution: mode === 'wade' ? 3 : 1, speed: 2, scavenge: 2 },
      choice: mode,
      summary: 'Worked the crossing out on paper first and did it in ' + trips + ' trips.'
    };
  }

  /* ============================================================ REGISTER = */

  PS.registry.register({
    id: 'constraint_crossing',
    name: 'Constraint Crossing',
    icon: '\uD83D\uDEF6',
    blurb: 'A carrier that takes two, cargo that cannot be trusted alone together, and a trip count that is watching.',

    favors:   { logic: 3, caution: 2 },
    provides: ['crossing', 'passage'],
    tagHooks: ['made_the_crossing', 'left_cargo'],
    requires: function () { return true; },

    css: CSS,

    skins: [
      {
        id: 'flooded_crossing', biome: 'water', title: 'The Flooded Crossing',
        icon: '\uD83D\uDEF6', palette: 'ice',
        intro: 'The road went under some time in the night and what is left of it is a brown river with fence posts in it. Somebody has left a raft tied to the sign, and the raft has opinions about weight. So does everything you are carrying, about everything else you are carrying.',
        nouns: { carrier: 'the raft', near: 'this bank', far: 'the far bank', water: 'the flood' }
      },
      {
        id: 'rope_bridge_ferry', biome: 'wilderness', title: 'Rope Bridge Ferry',
        icon: '\uD83E\uDE9D', palette: 'moss',
        intro: 'The bridge is gone but the cable is not, and somebody has slung a cradle off it that will hold you and about one other thing. Below is fifty metres of nothing and a river doing something loud. You will be doing this more than once.',
        nouns: { carrier: 'the cradle', near: 'the near ledge', far: 'the far ledge', water: 'the gorge' }
      },
      {
        id: 'elevator_weight', biome: 'urban', title: 'The Weight Limit',
        icon: '\uD83D\uDEC2', palette: 'steel',
        intro: 'The service car still runs on the emergency loop, which means it runs slowly, once, and then needs a minute. The overload alarm is not negotiable and neither is the stairwell, which is full of water. Everything gets up one load at a time.',
        nouns: { carrier: 'the car', near: 'sub-level', far: 'street level', water: 'the shaft' }
      }
    ],

    build: build,
    mount: mount,
    unmount: unmount,
    hint: hint,
    autoSolve: autoSolve
  });

})(typeof window !== 'undefined' ? window : this);
