/* ==========================================================================
   PuzzleStudio — js/games/e14_priority_sort.js       ENGINE 14 · Priority Sort
   --------------------------------------------------------------------------
   Self-contained: logic + 3 skins + its own CSS. No DOM access until mount().

   THE PUZZLE
     A queue, and a wall of protocols that do not agree with each other. Most
     severe first. Never leave a child behind. Nearest first while the fuel
     lasts. Anyone who can walk goes last, because they can walk.

     Every protocol is reasonable. Together they are contradictory, so there is
     no ordering that satisfies all of them and the game is not "sort by one
     column". The game is precedence: which protocol you break, and where.

   HOW IT IS SCORED — and why a perfect score exists
     Every rule is expressed as a rule about PAIRS: given two people, which of
     them should be ahead. So the total penalty of an ordering is just the sum
     of the pair penalties over every pair in the order it is in. That makes
     the whole thing a weighted linear ordering problem, and a Held-Karp style
     subset DP solves it EXACTLY:

       dp[S] = the cheapest way to fill the first |S| slots with the set S
       dp[S | v] = min over v of dp[S] + (cost of putting v ahead of everyone
                   still waiting)

     n is capped at 9, so that is 512 subsets x 81 = trivial, and it runs on
     every build. The number it produces is the target on screen. It is always
     reachable, and reaching it takes real thought, because greedily sorting on
     any single column will not get you there.

   THE WARD (arena)
     You cannot triage a queue off a clipboard. Every casualty is somebody lying
     in a bay, and their vitals are blank on the board until you have walked
     over and assessed them in person. Ranking, though, genuinely is a list you
     drag — so the ordering itself stays a panel, and it opens at the board at
     the end of the corridor. Assess, then rank, then commit.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio;
  if (!PS || !PS.registry) { if (root.console) console.error('[e14] core not loaded'); return; }

  /* ======================================================== SKIN CONTENT == */

  var CONTENT = {
    triage_ward: {
      entryWord: 'patient', entryPlural: 'patients', queueWord: 'the treatment order',
      boardWord: 'Ward protocol', actionWord: 'Commit the order',
      severityWord: 'condition', waitWord: 'waiting', distanceWord: 'bed', mobileWord: 'ambulant',
      confirm: 'You clip the list to the board. The first name gets the next pair of hands.',
      names: [
        { icon: '\uD83E\uDD15', name: 'Crush injury, bay 2' },
        { icon: '\uD83E\uDEC0', name: 'Chest pain, chair 4' },
        { icon: '\uD83E\uDDD2', name: 'Boy, no adult with him' },
        { icon: '\uD83E\uDDD3', name: 'Elderly man, confused' },
        { icon: '\uD83E\uDE78', name: 'Arterial bleed, trolley' },
        { icon: '\uD83E\uDDB4', name: 'Open fracture, corridor' },
        { icon: '\uD83E\uDD30', name: 'Pregnant, contractions' },
        { icon: '\uD83D\uDE37', name: 'Smoke inhalation, x2' },
        { icon: '\uD83D\uDC1D', name: 'Anaphylaxis, resus' }
      ],
      done: 'The order stands. Somebody else works the list now.',
      stay:  { icon: '\uD83E\uDE7A', title: 'Stay and work the list', desc: 'You wrote it. You may as well be the one holding pressure while it runs.' },
      leave: { icon: '\uD83D\uDCE3', title: 'Go and find more hands', desc: 'The list is only as good as the people to run it. There are none here.' }
    },
    evac_queue: {
      entryWord: 'evacuee', entryPlural: 'evacuees', queueWord: 'the loading order',
      boardWord: 'Evac protocol', actionWord: 'Lock the manifest',
      severityWord: 'condition', waitWord: 'at the point', distanceWord: 'blocks out', mobileWord: 'walking',
      confirm: 'You call the first name and the crowd re-forms around the decision.',
      names: [
        { icon: '\uD83E\uDDD1\u200D\uD83E\uDDBD', name: 'Wheelchair, fourth floor' },
        { icon: '\uD83D\uDC76', name: 'Infant and one parent' },
        { icon: '\uD83E\uDDD3', name: 'Elderly couple, no bags' },
        { icon: '\uD83E\uDE79', name: 'Head wound, still talking' },
        { icon: '\uD83E\uDDD2', name: 'Two kids, no adult' },
        { icon: '\uD83D\uDC15', name: 'Woman refusing to leave the dog' },
        { icon: '\uD83E\uDDBD', name: 'Broken ankle, strapped' },
        { icon: '\uD83E\uDDCD', name: 'Man who has not spoken yet' },
        { icon: '\uD83E\uDD30', name: 'Heavily pregnant, on foot' }
      ],
      done: 'The truck fills in the order you set and pulls out.',
      stay:  { icon: '\uD83D\uDE9A', title: 'Ride out with the first load', desc: 'You made the call. Go with it and see it land.' },
      leave: { icon: '\uD83D\uDCE3', title: 'Stay for the second run', desc: 'Somebody has to hold the point until the truck comes back. It may as well be you.' }
    },
    distress_queue: {
      entryWord: 'call', entryPlural: 'calls', queueWord: 'the response order',
      boardWord: 'Dispatch protocol', actionWord: 'Dispatch in this order',
      severityWord: 'severity', waitWord: 'on the line', distanceWord: 'km out', mobileWord: 'self-rescuing',
      confirm: 'You key the mic and read the order out. Somewhere, four radios go quiet.',
      names: [
        { icon: '\uD83D\uDCFB', name: 'Roof, four adults, rising water' },
        { icon: '\uD83D\uDD0B', name: 'Weak signal, cutting out' },
        { icon: '\uD83E\uDDD2', name: 'Child alone, address unclear' },
        { icon: '\uD83D\uDEA8', name: 'Plant fire, nobody answering' },
        { icon: '\uD83E\uDDD3', name: 'Care home, no power, 9 residents' },
        { icon: '\uD83D\uDE97', name: 'Car in floodwater, one voice' },
        { icon: '\u26A1', name: 'Live line down across a road' },
        { icon: '\uD83C\uDFE5', name: 'Clinic, generator failing' },
        { icon: '\uD83D\uDCF1', name: 'Text only, no voice, moving' }
      ],
      done: 'The order goes out. The board clears one line at a time.',
      stay:  { icon: '\uD83C\uDF9B\uFE0F', title: 'Hold the desk', desc: 'Somebody has to keep talking to the ones still waiting, and they know your voice now.' },
      leave: { icon: '\uD83D\uDEB6', title: 'Take the top call yourself', desc: 'There is nobody left to send. You are the unit.' }
    }
  };

  /* ============================================================== RULES == */

  /**
   * A rule scores ORDERED PAIRS: cost(a, b) is what you pay for putting a
   * ahead of b. That decomposition is what makes an exact optimum computable —
   * and it is also just how these protocols read in real life ("X before Y").
   */
  var RULES = [
    {
      id: 'severity',
      title: 'Most severe first',
      body: 'The worst condition is seen first. That is the whole of it.',
      weight: 3,
      pair: function (a, b) { return b.severity > a.severity ? 1 : 0; }
    },
    {
      id: 'child',
      title: 'No child left behind',
      body: 'No child waits behind an adult. Not for any reason, not for triage.',
      weight: 3,
      pair: function (a, b) { return (!a.child && b.child) ? 1 : 0; }
    },
    {
      id: 'near',
      title: 'Nearest first \u2014 fuel is short',
      body: 'Fuel will not stretch to backtracking. Work outward, never inward.',
      weight: 2,
      pair: function (a, b) { return b.distance < a.distance ? 1 : 0; }
    },
    {
      id: 'waited',
      title: 'Longest wait first',
      body: 'Nobody who has waited longer goes behind somebody who just arrived.',
      weight: 2,
      pair: function (a, b) { return b.waited > a.waited ? 1 : 0; }
    },
    {
      id: 'walkers_last',
      title: 'Anyone who can move, moves last',
      body: 'If they can get themselves out, they are not spending our hands.',
      weight: 2,
      pair: function (a, b) { return (a.mobile && !b.mobile) ? 1 : 0; }
    },
    {
      id: 'elder',
      title: 'Elderly before able adults',
      body: 'An adult who can stand can wait behind one who cannot.',
      weight: 1,
      pair: function (a, b) { return (!a.elder && !a.child && b.elder) ? 1 : 0; }
    },
    {
      id: 'unstable_last',
      title: 'The unstable are moved last',
      body: 'A critical case that is moved too early is a critical case you lose in transit. Stabilise, then move.',
      weight: 2,
      pair: function (a, b) { return (a.severity >= 5 && b.severity < 5) ? 1 : 0; }
    }
  ];

  /* ============================================================== BUILD == */

  /** cost[i][j] = weighted penalty for placing entry i ahead of entry j. */
  function costMatrix(entries, rules) {
    var n = entries.length, m = [], i, j, r, c;
    for (i = 0; i < n; i++) {
      m.push([]);
      for (j = 0; j < n; j++) {
        if (i === j) { m[i].push(0); continue; }
        c = 0;
        for (r = 0; r < rules.length; r++) c += rules[r].weight * rules[r].pair(entries[i], entries[j]);
        m[i].push(c);
      }
    }
    return m;
  }

  function scoreOrder(order, cost) {
    var total = 0;
    for (var i = 0; i < order.length; i++) {
      for (var j = i + 1; j < order.length; j++) total += cost[order[i]][order[j]];
    }
    return total;
  }

  /** Per-rule violation counts for an ordering — what the board shows live. */
  function violationsByRule(order, entries, rules) {
    var out = [], r, i, j, c;
    for (r = 0; r < rules.length; r++) {
      c = 0;
      for (i = 0; i < order.length; i++) {
        for (j = i + 1; j < order.length; j++) {
          c += rules[r].pair(entries[order[i]], entries[order[j]]);
        }
      }
      out.push(c);
    }
    return out;
  }

  /**
   * Exact optimum via subset DP (Held-Karp for the linear ordering problem).
   * dp[S] is the cheapest cost of the pairs entirely inside S, having placed S
   * in the leading slots. Adding v to S pays for v being ahead of everything
   * NOT yet placed.
   *
   * Pass maximize=true and it returns the genuinely worst ordering instead,
   * which is what the on-screen scale needs — summing the worse half of each
   * pair is only an upper bound, because those choices need not be consistent
   * with any single ordering.
   *
   * n <= 9 -> 512 subsets, 9 candidates each, 9 remaining each. Nothing.
   */
  function solveExact(cost, n, maximize) {
    var size = 1 << n;
    var dp = new Array(size);
    var from = new Array(size);
    var worse = maximize ? -Infinity : Infinity;
    var i, S, v, u;
    for (i = 0; i < size; i++) { dp[i] = worse; from[i] = -1; }
    dp[0] = 0;

    for (S = 0; S < size; S++) {
      if (dp[S] === worse) continue;
      for (v = 0; v < n; v++) {
        var bit = 1 << v;
        if (S & bit) continue;
        var add = 0;
        for (u = 0; u < n; u++) {
          if (u === v || (S & (1 << u))) continue;   // u still waiting -> v is ahead of it
          add += cost[v][u];
        }
        var next = S | bit;
        var val = dp[S] + add;
        if (maximize ? val > dp[next] : val < dp[next]) { dp[next] = val; from[next] = v; }
      }
    }

    var order = [], cur = size - 1;
    while (cur) {
      var last = from[cur];
      order.unshift(last);
      cur ^= (1 << last);
    }
    return { total: dp[size - 1], order: order };
  }

  function build(state, rng, tier, skin) {
    var C = CONTENT[skin.id] || CONTENT.triage_ward;
    var t = Math.min(6, tier);

    var n = Math.min(9, 5 + Math.round(t * 0.7));                    // 6..9 entries
    var ruleCount = Math.min(RULES.length, 3 + Math.floor(t * 0.7)); // 3..7 protocols

    // Rules are drawn in a fixed order of consequence so the first three always
    // read like a real protocol sheet; the rest are the ones that start the
    // arguments, and they arrive as the run gets deeper.
    var pool = RULES.slice(0, 3).concat(rng.shuffle(RULES.slice(3)));
    var rules = pool.slice(0, ruleCount);

    var people = rng.shuffle(C.names);
    var best = null;

    for (var attempt = 1; attempt <= 14; attempt++) {
      var entries = [];
      for (var i = 0; i < n; i++) {
        var who = people[i % people.length];
        var child = rng.chance(0.22);
        var elder = !child && rng.chance(0.22);
        entries.push({
          id: i,
          icon: who.icon,
          name: who.name,
          severity: rng.int(1, 5),
          waited: rng.int(2, 70),
          distance: rng.int(1, 12),
          child: child,
          elder: elder,
          mobile: !child && rng.chance(0.42)
        });
      }

      var cost = costMatrix(entries, rules);
      var low = solveExact(cost, n, false);
      var high = solveExact(cost, n, true);
      var spread = high.total - low.total;

      // The queue is dealt in a deliberately mediocre order — never already
      // optimal, and never the worst case either.
      var deal = rng.shuffle(low.order.slice());
      var startCost = scoreOrder(deal, cost);
      var headroom = startCost - low.total;

      var cand = {
        entries: entries, cost: cost, deal: deal,
        best: low.total, bestOrder: low.order, worst: high.total,
        startCost: startCost, attempts: attempt,
        // A board is good when the protocols genuinely conflict (best > 0),
        // there is real distance between best and worst, and the deal is not
        // already close to solved.
        score: (low.total > 0 ? 1000 : 0) + Math.min(spread, 60) + Math.min(headroom, 40)
      };
      if (!best || cand.score > best.score) best = cand;

      if (low.total > 0 && spread >= 6 && headroom >= Math.max(3, Math.round(spread * 0.2))) break;
    }

    var order = best.deal.slice();

    return {
      entries: best.entries,
      rules: rules,
      cost: best.cost,
      order: order,
      best: best.best,
      bestOrder: best.bestOrder,
      worst: best.worst,
      startCost: best.startCost,
      current: scoreOrder(order, best.cost),
      attempts: best.attempts,
      moves: 0,
      submitted: false,
      done: false,
      tier: t,
      content: C
    };
  }

  /* ================================================================ CSS == */

  var CSS = [
    '.pz-prio{display:grid;grid-template-columns:minmax(0,1fr) minmax(250px,320px);gap:18px;align-items:start}',
    '@media (max-width:900px){.pz-prio{grid-template-columns:1fr}}',
    '.pz-prio.is-panel{display:flex;flex-direction:column;gap:12px}',
    '.pz-prio-stage{display:flex;flex-direction:column;gap:14px}',

    '.pz-prio-list{display:flex;flex-direction:column;gap:7px}',

    '.pz-prio-row{display:grid;grid-template-columns:26px 30px minmax(0,1fr) auto auto;gap:10px;align-items:center;',
    '  padding:9px 11px;border-radius:10px;border:1px solid var(--line);cursor:grab;',
    '  background:linear-gradient(180deg,var(--panel-2),var(--panel));box-shadow:var(--sh-1);',
    '  transition:border-color .18s var(--ease),transform .18s var(--ease),opacity .18s var(--ease)}',
    '.pz-prio.is-panel .pz-prio-row{grid-template-columns:18px 26px minmax(0,1fr) auto;gap:7px;padding:8px 9px}',
    '.pz-prio.is-panel .pz-prio-face{font-size:17px}',
    '.pz-prio-row:hover{border-color:color-mix(in srgb,var(--acc) 50%,var(--line));transform:translateX(2px)}',
    '.pz-prio-row.is-held{border-color:var(--acc);box-shadow:0 0 0 1px var(--acc) inset,0 10px 26px rgba(0,0,0,.5)}',
    '.pz-prio-row.is-drag{opacity:.4}',
    '.pz-prio-row.is-over{border-top:2px solid var(--acc)}',
    '.pz-prio-row.is-locked{cursor:default;opacity:.92}',
    '.pz-prio-row.is-locked:hover{transform:none}',
    '.pz-prio-row.is-blank{border-style:dashed;border-color:var(--line-soft)}',

    '.pz-prio-rank{font-family:var(--font-mono);font-size:13px;font-weight:700;color:var(--acc-2);text-align:center}',
    '.pz-prio-face{font-size:20px;line-height:1}',
    '.pz-prio-who{min-width:0}',
    '.pz-prio-who__n{font-size:13px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.pz-prio-who__a{display:flex;flex-wrap:wrap;gap:6px;margin-top:3px}',

    '.pz-prio-attr{font-family:var(--font-mono);font-size:10px;padding:1px 6px;border-radius:999px;',
    '  border:1px solid var(--line);background:rgba(0,0,0,.28);color:var(--dim);white-space:nowrap}',
    '.pz-prio-attr.is-sev5{color:#ffd9d5;border-color:#5c2b26;background:#3a1a17}',
    '.pz-prio-attr.is-sev4{color:#e2695f;border-color:#4a2320}',
    '.pz-prio-attr.is-child{color:#f6d08a;border-color:#5a4520;background:#2b1f0c}',
    '.pz-prio-attr.is-elder{color:#b48ce0;border-color:#3d2f52}',
    '.pz-prio-attr.is-mobile{color:#5fcf8d;border-color:#25422f}',
    '.pz-prio-attr.is-unknown{color:var(--dimmer);border-style:dashed}',

    '.pz-prio-nudge{display:flex;flex-direction:column;gap:3px}',
    '.pz-prio-nudge button{width:26px;height:19px;border-radius:5px;border:1px solid var(--line);',
    '  background:var(--panel-3);color:var(--text-2);font-size:9px;line-height:1;padding:0}',
    '.pz-prio-nudge button:hover:not(:disabled){border-color:var(--acc);color:var(--acc-2)}',
    '.pz-prio-nudge button:disabled{opacity:.22}',

    '.pz-prio-book{display:flex;flex-direction:column;gap:8px}',
    '.pz-prio-rule{padding:8px 10px;border-radius:9px;border:1px solid var(--line-soft);background:rgba(0,0,0,.22)}',
    '.pz-prio-rule.is-clean{border-color:color-mix(in srgb,var(--good) 45%,transparent)}',
    '.pz-prio-rule.is-broken{border-color:color-mix(in srgb,var(--bad) 45%,transparent)}',
    '.pz-prio-rule__h{display:flex;justify-content:space-between;gap:8px;align-items:baseline}',
    '.pz-prio-rule__t{font-size:12px;font-weight:700;color:var(--text)}',
    '.pz-prio-rule__w{font-family:var(--font-mono);font-size:10px;color:var(--dim);white-space:nowrap}',
    '.pz-prio-rule__b{font-size:11px;color:var(--dim);line-height:1.5;margin-top:3px}',
    '.pz-prio-rule__v{font-family:var(--font-mono);font-size:11px;margin-top:5px;color:var(--good)}',
    '.pz-prio-rule.is-broken .pz-prio-rule__v{color:var(--bad)}',

    '.pz-prio-score{display:flex;flex-direction:column;gap:7px}',
    '.pz-prio-score__n{display:flex;align-items:baseline;gap:8px}',
    '.pz-prio-score__big{font-family:var(--font-mono);font-size:27px;font-weight:800;color:var(--acc-2);line-height:1}',
    '.pz-prio-score__lab{font-size:11px;color:var(--dim)}',
    '.pz-prio-score__bar{position:relative;height:9px;border-radius:5px;overflow:hidden;background:#0a0e14;border:1px solid var(--line)}',
    '.pz-prio-score__fill{position:absolute;inset:0 auto 0 0;border-radius:5px;',
    '  background:linear-gradient(90deg,var(--good),var(--warn) 55%,var(--bad));transition:width .3s var(--ease)}',
    '.pz-prio-score__mark{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--acc-2);box-shadow:0 0 8px var(--acc-glow)}',
    '.pz-prio-score__row{display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:11px;color:var(--dim)}',
    '.pz-prio-score__row b{color:var(--acc-2)}',
    '.pz-prio-score.is-perfect .pz-prio-score__big{color:var(--good)}',

    '.pz-prio-hint{font-size:12px;line-height:1.55;color:var(--text-2);padding:9px 11px;border-radius:8px;',
    '  background:var(--acc-wash);border:1px solid color-mix(in srgb,var(--acc) 35%,transparent)}'
  ].join('\n');

  /* ================================================================ MOUNT = */

  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var C = puzzle.content;
    var finished = false;
    var held = -1;          // click-to-pick-up index (position, not entry id)
    var dragFrom = -1;
    var arena = null;
    var seenIds = {};       // entry id -> assessed in person
    var cSeen = null, cCost = null;
    var noteEl = null;

    var stage = h('div', { class: 'pz-prio-stage' });
    var mapHost = h('div', {});
    var endBox = h('div', {});
    var listBox = h('div', { class: 'pz-prio-list' });
    var bookBox = h('div', { class: 'pz-prio-book' });
    var scoreBox = h('div', { class: 'pz-prio-score' });
    var noteBox = h('div', {});
    var actionBox = h('div', { class: 'pz-col' });
    var panelRoot = h('div', { class: 'pz-prio' });
    var submitBtn = h('button', { class: 'pz-btn pz-btn--primary', type: 'button' }, ['\u2713 ' + C.actionWord]);

    function assessed(e) { return !!seenIds[e.id]; }

    function assessedCount() {
      var c = 0;
      for (var i = 0; i < puzzle.entries.length; i++) if (assessed(puzzle.entries[i])) c++;
      return c;
    }

    function allAssessed() { return assessedCount() >= puzzle.entries.length; }

    /* -------------------------------------------------------------- rows -- */

    function attrChips(e) {
      var out = [];
      if (!assessed(e)) {
        out.push(h('span', { class: 'pz-prio-attr is-unknown', text: 'not assessed' }));
        return out;
      }
      out.push(h('span', {
        class: 'pz-prio-attr' + (e.severity >= 5 ? ' is-sev5' : (e.severity === 4 ? ' is-sev4' : '')),
        text: C.severityWord + ' ' + e.severity + '/5'
      }));
      out.push(h('span', { class: 'pz-prio-attr', text: e.waited + ' min ' + C.waitWord }));
      out.push(h('span', { class: 'pz-prio-attr', text: e.distance + ' ' + C.distanceWord }));
      if (e.child) out.push(h('span', { class: 'pz-prio-attr is-child', text: 'child' }));
      if (e.elder) out.push(h('span', { class: 'pz-prio-attr is-elder', text: 'elderly' }));
      if (e.mobile) out.push(h('span', { class: 'pz-prio-attr is-mobile', text: C.mobileWord }));
      return out;
    }

    function row(pos) {
      var e = puzzle.entries[puzzle.order[pos]];
      var locked = finished || puzzle.submitted;

      var up = h('button', {
        type: 'button', title: 'Move up', disabled: locked || pos === 0,
        onclick: function (ev) { ev.stopPropagation(); move(pos, pos - 1); }
      }, ['\u25B2']);
      var down = h('button', {
        type: 'button', title: 'Move down', disabled: locked || pos === puzzle.order.length - 1,
        onclick: function (ev) { ev.stopPropagation(); move(pos, pos + 1); }
      }, ['\u25BC']);

      var r = h('div', {
        class: 'pz-prio-row' + (held === pos ? ' is-held' : '') + (locked ? ' is-locked' : '') +
          (assessed(e) ? '' : ' is-blank'),
        draggable: locked ? null : 'true',
        title: locked ? '' : 'Click to pick up, click again where you want it. Or drag.'
      }, [
        h('div', { class: 'pz-prio-rank', text: String(pos + 1) }),
        h('div', { class: 'pz-prio-face', text: e.icon }),
        h('div', { class: 'pz-prio-who' }, [
          h('div', { class: 'pz-prio-who__n', text: e.name }),
          h('div', { class: 'pz-prio-who__a' }, attrChips(e))
        ]),
        h('div', { class: 'pz-prio-nudge' }, [up, down])
      ]);

      if (!locked) {
        r.addEventListener('click', function () { tap(pos); });
        r.addEventListener('dragstart', function (ev) {
          dragFrom = pos;
          r.classList.add('is-drag');
          if (ev.dataTransfer) {
            ev.dataTransfer.effectAllowed = 'move';
            try { ev.dataTransfer.setData('text/plain', String(pos)); } catch (err) { /* IE-ism, ignore */ }
          }
        });
        r.addEventListener('dragend', function () { r.classList.remove('is-drag'); dragFrom = -1; });
        r.addEventListener('dragover', function (ev) { ev.preventDefault(); r.classList.add('is-over'); });
        r.addEventListener('dragleave', function () { r.classList.remove('is-over'); });
        r.addEventListener('drop', function (ev) {
          ev.preventDefault();
          r.classList.remove('is-over');
          if (dragFrom >= 0 && dragFrom !== pos) move(dragFrom, pos);
          dragFrom = -1;
        });
      }
      return r;
    }

    function paintList() {
      PS.ui.clear(listBox);
      for (var i = 0; i < puzzle.order.length; i++) listBox.appendChild(row(i));
    }

    /* ------------------------------------------------------- re-ordering -- */

    function move(from, to) {
      if (finished || puzzle.submitted) return;
      if (to < 0 || to >= puzzle.order.length || from === to) return;
      var item = puzzle.order.splice(from, 1)[0];
      puzzle.order.splice(to, 0, item);
      puzzle.moves++;
      held = -1;
      puzzle.current = scoreOrder(puzzle.order, puzzle.cost);
      repaint();
    }

    function tap(pos) {
      if (finished || puzzle.submitted) return;
      if (held < 0) { held = pos; paintList(); return; }
      if (held === pos) { held = -1; paintList(); return; }
      move(held, pos);
    }

    /* --------------------------------------------------------------- ward -- */
    /* Bays down both sides of a corridor with the board at the far end. The
       vitals are not on the board; they are on the person, and the only way to
       read them is to go and stand over them.                                */

    function wardMap(n) {
      var cols = Math.max(1, Math.ceil(n / 2));
      var w = cols * 3 + 5, hgt = 9;
      var tiles = [], spots = [], x, y;
      for (y = 0; y < hgt; y++) {
        var line = [];
        for (x = 0; x < w; x++) line.push((y === 0 || y === hgt - 1 || x === 0 || x === w - 1) ? 1 : 0);
        tiles.push(line);
      }
      for (var i = 0; i < n; i++) {
        var col = Math.floor(i / 2), top = (i % 2) === 0;
        var bx = 2 + col * 3;
        tiles[top ? 1 : hgt - 2][bx] = 1;                 // the trolley they are on
        spots.push({ x: bx, y: top ? 2 : hgt - 3 });
      }
      // a nook for the board, so the far end of the corridor is somewhere
      tiles[2][w - 3] = 1; tiles[3][w - 3] = 1;
      tiles[hgt - 3][w - 3] = 1; tiles[hgt - 4][w - 3] = 1;
      return { w: w, h: hgt, tiles: tiles, spots: spots, spawn: { x: 1, y: 4 }, desk: { x: w - 2, y: 4 } };
    }

    function buildWard() {
      if (!PS.arena || typeof PS.arena.create !== 'function') return false;

      var m = wardMap(puzzle.entries.length);
      arena = PS.arena.create(mapHost, {
        map: { w: m.w, h: m.h, tiles: m.tiles },
        spawn: m.spawn,
        avatar: '\uD83E\uDDCD',
        light: state.stats.light,
        lightCurve: function (v) { return 4.4 + Math.min(100, Math.max(0, v)) / 100 * 3.2; },
        darkness: 0.55,
        memory: 0.68
      });
      if (!arena) return false;
      teardownFns.push(function () { if (arena) { arena.destroy(); arena = null; } });

      cSeen = arena.chip('Assessed', '\uD83E\uDE7A');
      cCost = arena.chip('Cost', '\u2696\uFE0F');

      for (var i = 0; i < puzzle.entries.length; i++) {
        (function (idx) {
          var e = puzzle.entries[idx];
          var spot = m.spots[idx];
          if (!spot) return;
          arena.prop({
            x: spot.x, y: spot.y, icon: e.icon, label: e.name,
            hint: 'assess them', trigger: 'proximity', radius: 1.4,
            once: false, emits: 0.5,
            onActivate: function () { assess(idx); }
          });
        })(i);
      }

      arena.station({
        x: m.desk.x, y: m.desk.y, icon: '\uD83D\uDCCB', label: C.boardWord,
        hint: 'set the order', radius: 1.4, emits: 1.9,
        onEnter: function (panelEl) { PS.ui.append(panelEl, panelRoot); }
      });

      noteEl = arena.note('Go round the bays first \u2014 nothing on the board fills itself in. Then set ' +
        C.queueWord + ' at the board.');
      return true;
    }

    function assess(idx) {
      var e = puzzle.entries[idx];
      if (seenIds[e.id] || finished) return;
      seenIds[e.id] = true;

      var bits = [C.severityWord + ' ' + e.severity + ' of 5', e.waited + ' minutes ' + C.waitWord];
      if (e.child) bits.push('a child');
      else if (e.elder) bits.push('elderly');
      if (e.mobile) bits.push(C.mobileWord);
      api.toast(e.name + ' \u2014 ' + bits.join(', ') + '.', e.severity >= 4 ? 'bad' : 'info', 4200);
      repaint();
    }

    /* ------------------------------------------------------------- board -- */

    function paintBook() {
      var counts = violationsByRule(puzzle.order, puzzle.entries, puzzle.rules);
      var known = allAssessed() || puzzle.submitted;
      PS.ui.clear(bookBox);
      for (var r = 0; r < puzzle.rules.length; r++) {
        var rule = puzzle.rules[r];
        var v = counts[r];
        bookBox.appendChild(h('div', { class: 'pz-prio-rule ' + (known ? (v ? 'is-broken' : 'is-clean') : '') }, [
          h('div', { class: 'pz-prio-rule__h' }, [
            h('div', { class: 'pz-prio-rule__t', text: rule.title }),
            h('div', { class: 'pz-prio-rule__w', text: '\u00D7' + rule.weight })
          ]),
          h('div', { class: 'pz-prio-rule__b', text: rule.body }),
          h('div', { class: 'pz-prio-rule__v' },
            [known
              ? (v === 0 ? 'satisfied' : v + ' pair' + (v === 1 ? '' : 's') + ' out of order \u2014 ' + (v * rule.weight) + ' points')
              : 'cannot be checked until everyone has been assessed'])
        ]));
      }
    }

    function paintScore() {
      var cur = puzzle.current;
      var known = allAssessed() || puzzle.submitted;
      var perfect = known && cur <= puzzle.best;
      var span = Math.max(1, puzzle.worst - puzzle.best);
      var pct = Math.max(0, Math.min(100, ((cur - puzzle.best) / span) * 100));

      scoreBox.className = 'pz-prio-score' + (perfect ? ' is-perfect' : '');
      PS.ui.clear(scoreBox);

      var fill = h('div', { class: 'pz-prio-score__fill', style: { width: (known ? pct : 0) + '%' } });
      var mark = h('div', { class: 'pz-prio-score__mark', style: { left: '0%' } });

      PS.ui.append(scoreBox, [
        h('div', { class: 'pz-prio-score__n' }, [
          h('div', { class: 'pz-prio-score__big', text: known ? String(cur) : '\u2014' }),
          h('div', { class: 'pz-prio-score__lab', text: known ? 'violation points on the board' : 'the board cannot score people you have not seen' })
        ]),
        h('div', { class: 'pz-prio-score__bar' }, [fill, mark]),
        line('Assessed', assessedCount() + ' of ' + puzzle.entries.length),
        line('Best possible', String(puzzle.best)),
        line('Worst possible', String(puzzle.worst)),
        line('Changes made', String(puzzle.moves))
      ]);

      PS.ui.clear(noteBox);
      if (!puzzle.submitted) {
        noteBox.appendChild(h('div', { class: 'pz-prio-hint' }, [
          !known
            ? (puzzle.entries.length - assessedCount()) + ' of them you have not been to see. You can commit this order without going \u2014 you will simply be ranking names.'
            : (perfect
              ? 'That is the lowest total these protocols allow. Anything you change from here costs somebody.'
              : 'No order satisfies every protocol \u2014 they contradict each other on purpose. ' +
                'Aim for ' + puzzle.best + ', which is the least harm available, not zero.')
        ]));
      }

      if (cSeen) cSeen.set(assessedCount() + ' / ' + puzzle.entries.length, known ? null : 'warn');
      if (cCost) cCost.set(known ? cur + ' / ' + puzzle.best + ' best' : 'unknown');

      function line(k, v) {
        return h('div', { class: 'pz-prio-score__row' }, [h('span', { text: k }), h('b', { text: v })]);
      }
    }

    function repaint() {
      paintList();
      paintBook();
      paintScore();
      submitBtn.disabled = finished || puzzle.submitted;
    }

    /* ------------------------------------------------------------ endings -- */

    function submit() {
      if (finished || puzzle.submitted) return;
      puzzle.submitted = true;
      puzzle.current = scoreOrder(puzzle.order, puzzle.cost);
      api.toast(C.confirm, puzzle.current <= puzzle.best ? 'good' : 'info', 3000);
      repaint();
      renderEnd();
    }

    function renderEnd() {
      var over = puzzle.current - puzzle.best;
      var verdict = over <= 0
        ? 'You found the least-harm order. There was no better one to find.'
        : (over <= Math.max(2, Math.round((puzzle.worst - puzzle.best) * 0.15))
          ? 'Close to the best available. One or two people are behind where they should be.'
          : 'Defensible, but the protocols say you cost somebody their place.');

      var blind = puzzle.entries.length - assessedCount();
      if (arena) {
        arena.closePanel();
        if (noteEl) noteEl.textContent = C.done;
      }

      PS.ui.clear(actionBox);
      PS.ui.clear(endBox);
      PS.ui.append(endBox, [
        h('div', { class: 'pz-intro', text: C.done + ' ' + verdict + ' (' + puzzle.current + ' against a best possible ' + puzzle.best + '.)' }),
        blind > 0 ? h('div', { class: 'pz-prio-hint', text:
          'You ranked ' + blind + ' of them without ever going to look at them. The numbers were there to be read.' }) : null,
        h('div', { class: 'pz-choices' }, [
          choiceBtn(C.stay, 'shelter'),
          choiceBtn(C.leave, 'signal')
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

      var over = puzzle.current - puzzle.best;
      var span = Math.max(1, puzzle.worst - puzzle.best);
      var perfect = over <= 0;
      var close = over <= Math.max(2, Math.round(span * 0.15));

      api.finish({
        outcome: perfect ? 'success' : (close ? 'partial' : 'fail'),
        stats: {
          morale: perfect ? 9 : (close ? 2 : -8),
          energy: -(4 + Math.min(8, Math.floor(puzzle.moves / 3))),
          health: choice === 'shelter' ? 4 : 0
        },
        gain: perfect ? (choice === 'shelter' ? ['medkit'] : ['radio']) : [],
        lose: [],
        tags: ['ran_the_triage']
          .concat(perfect ? ['kept_the_protocol'] : [])
          .concat(!close ? ['broke_the_protocol'] : [])
          .concat(choice === 'shelter' ? ['stayed_with_them'] : ['went_for_help']),
        signals: {
          logic: perfect ? 3 : (close ? 2 : 1),
          caution: perfect ? 2 : 1,
          speed: puzzle.moves <= puzzle.entries.length ? 1 : 0,
          brute: !close ? 1 : 0
        },
        choice: choice,
        summary: perfect
          ? 'You untangled ' + puzzle.rules.length + ' contradictory protocols into the one order that cost the least.'
          : (close
            ? 'You got ' + C.queueWord + ' close to right, ' + over + ' points off the best line.'
            : 'You set ' + C.queueWord + ' and two of the protocols will be quoted back at you later.')
      });
    }

    function handOver() {
      if (finished || puzzle.submitted) return;
      finished = true;
      api.finish({
        outcome: 'fail',
        stats: { morale: -9, energy: -4 },
        gain: [], lose: [],
        tags: ['would_not_make_the_call'],
        signals: { caution: 2 },
        choice: null,
        summary: 'You could not choose between them, so you handed the list to somebody who could.'
      });
    }

    submitBtn.addEventListener('click', submit);

    /* ------------------------------------------------------------- layout -- */

    PS.ui.append(actionBox, [
      submitBtn,
      h('button', {
        class: 'pz-btn pz-btn--danger pz-btn--sm', type: 'button', onclick: handOver
      }, ['\u21A9 Hand the list to somebody else'])
    ]);

    PS.ui.append(panelRoot, [
      h('div', { class: 'pz-col' }, [
        listBox,
        h('div', { class: 'pz-note' }, [
          'Drag a row, use the arrows, or click one and click where you want it. ',
          h('strong', { text: 'The protocols contradict each other' }),
          ' \u2014 zero is not on the table. The target is the lowest total that exists.'
        ])
      ]),
      h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'Cost of this order' }),
          scoreBox
        ]),
        noteBox,
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: C.boardWord }),
          bookBox
        ]),
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'Options' }),
          actionBox
        ])
      ])
    ]);

    PS.ui.append(stage, [mapHost, endBox]);
    PS.ui.append(el, stage);

    if (buildWard()) {
      panelRoot.className = 'pz-prio is-panel';
    } else {
      // No arena layer: the whole ward is in front of you and nothing is hidden.
      for (var q = 0; q < puzzle.entries.length; q++) seenIds[puzzle.entries[q].id] = true;
      PS.ui.append(mapHost, panelRoot);
    }

    repaint();
    if (arena) arena.focus();
    teardownFns.push(function () { held = -1; dragFrom = -1; });
  }
  function unmount() {
    while (teardownFns.length) {
      try { teardownFns.pop()(); } catch (e) { /* keep unwinding */ }
    }
  }

  /* ================================================================ HINT = */

  function hint(puzzle) {
    if (puzzle.current <= puzzle.best) {
      return 'This is already the least-harm order. Every change from here makes it worse.';
    }

    // Name the single swap that buys the most, without handing over the answer.
    var order = puzzle.order, cost = puzzle.cost;
    var bestGain = 0, bi = -1, bj = -1, i, j;
    for (i = 0; i < order.length; i++) {
      for (j = i + 1; j < order.length; j++) {
        var gain = cost[order[i]][order[j]] - cost[order[j]][order[i]];
        if (gain > bestGain) { bestGain = gain; bi = i; bj = j; }
      }
    }
    if (bi < 0) {
      return 'No single swap improves this, which means the remaining cost is structural. ' +
        'Move somebody two or three places, not one.';
    }
    var a = puzzle.entries[order[bi]], b = puzzle.entries[order[bj]];
    return 'Look at position ' + (bi + 1) + ' and position ' + (bj + 1) + ' \u2014 ' +
      a.name.toLowerCase() + ' and ' + b.name.toLowerCase() + '. As they stand they cost you ' +
      bestGain + ' points more than the other way round.';
  }

  /* ============================================================ AUTOSOLVE = */
  /* Headless. A bot that sorts greedily by the heaviest rule, which is exactly
     the mistake the puzzle is built to punish — so it lands near, not on, the
     optimum. */

  function autoSolve(puzzle, rng) {
    var order = puzzle.order.slice();
    var cost = puzzle.cost;

    // Repeated best-improvement swaps: a decent local optimum, rarely the
    // global one, which is the whole point of the design.
    for (var pass = 0; pass < 3 * order.length; pass++) {
      var bestGain = 0, bi = -1, bj = -1, i, j;
      for (i = 0; i < order.length; i++) {
        for (j = i + 1; j < order.length; j++) {
          var gain = cost[order[i]][order[j]] - cost[order[j]][order[i]];
          if (gain > bestGain) { bestGain = gain; bi = i; bj = j; }
        }
      }
      if (bi < 0) break;
      var tmp = order[bi]; order[bi] = order[bj]; order[bj] = tmp;
    }

    var got = scoreOrder(order, cost);
    var span = Math.max(1, puzzle.worst - puzzle.best);
    var over = got - puzzle.best;
    var perfect = over <= 0;
    var close = over <= Math.max(2, Math.round(span * 0.15));
    var choice = rng.chance(0.5) ? 'shelter' : 'signal';

    return {
      outcome: perfect ? 'success' : (close ? 'partial' : 'fail'),
      stats: {
        morale: perfect ? 9 : (close ? 2 : -8),
        energy: -(4 + rng.int(0, 5)),
        health: choice === 'shelter' ? 4 : 0
      },
      gain: perfect ? (choice === 'shelter' ? ['medkit'] : ['radio']) : [],
      lose: [],
      tags: ['ran_the_triage'].concat(perfect ? ['kept_the_protocol'] : []),
      signals: { logic: perfect ? 3 : 2, caution: 2, speed: 1 },
      choice: choice,
      summary: perfect
        ? 'Found the one order that satisfied as much of the protocol as the protocol allows.'
        : 'Set an order ' + over + ' points off the best available and lived with it.'
    };
  }

  /* ============================================================ REGISTER = */

  PS.registry.register({
    id: 'priority_sort',
    name: 'Priority Sort',
    icon: '\uD83D\uDE91',
    blurb: 'Four protocols, one queue, and no ordering that keeps all four. Decide who goes first.',

    favors:   { logic: 3, caution: 2 },
    provides: ['triage', 'medical', 'shelter', 'information'],
    tagHooks: ['has_ally', 'has_medkit', 'kept_the_protocol'],
    requires: function (state) { return state.stats.morale > 8; },

    css: CSS,

    skins: [
      {
        id: 'triage_ward', biome: 'shelter', title: 'The Triage Ward',
        icon: '\uD83E\uDE7A', palette: 'bone',
        intro: 'Nine people, one pair of hands, and a laminated protocol sheet that was written by four different committees. Everything on that sheet is true. Not all of it can be true at once.',
        nouns: { entry: 'patient', queue: 'the treatment order', board: 'ward protocol' }
      },
      {
        id: 'evac_queue', biome: 'urban', title: 'The Evac Queue',
        icon: '\uD83D\uDE9A', palette: 'steel',
        intro: 'One truck, one run, and a crowd that has already worked out there is not room for everybody. The manifest you write in the next minute is the one they will remember you by.',
        nouns: { entry: 'evacuee', queue: 'the loading order', board: 'evac protocol' }
      },
      {
        id: 'distress_queue', biome: 'industrial', title: 'The Distress Board',
        icon: '\uD83D\uDCFB', palette: 'rust',
        intro: 'Nine open calls on the board and two units that still answer. Every line is somebody who thinks help is already coming, because that is what the last operator told them.',
        nouns: { entry: 'call', queue: 'the response order', board: 'dispatch protocol' }
      }
    ],

    build: build,
    mount: mount,
    unmount: unmount,
    hint: hint,
    autoSolve: autoSolve
  });

})(typeof window !== 'undefined' ? window : this);
