/* ==========================================================================
   PuzzleStudio — js/games/e11_barter_graph.js        ENGINE 11 · Barter Graph
   --------------------------------------------------------------------------
   Self-contained: logic + 3 skins + its own CSS. No DOM access until mount().

   THE PUZZLE
     Nobody here wants money. Everybody here wants a specific thing, and will
     give you a specific other thing for a fixed number of it. Three coils of
     rope buys a lamp. Two lamps buy a medkit. You are holding rope.

     The graph is generated as a layered chain so the target is ALWAYS
     reachable, then decoy offers are braided in — sinks that eat your goods,
     and shortcuts that only pay off if you set them up first. A breadth-first
     search over holdings states gives the true minimum trade count, and that
     is the number you are scored against.

   THE ALLY RULE
     The Director throws you at this engine hard when you are carrying an ally
     (see director.js: isAllyMagnet). So an ally earns its keep here: they know
     one of these traders and talk a rate down by one unit. That brokered offer
     is folded into the graph BEFORE the BFS runs, so the optimum you are
     scored against is the optimum you actually have.

   THE BRANCH
     Trade done, you either stay in the market and keep working it, or take
     what you came for and walk. The Director reads that.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio;
  if (!PS || !PS.registry) { if (root.console) console.error('[e11] core not loaded'); return; }

  /* ======================================================== SKIN CONTENT == */

  var CONTENT = {
    underpass_market: {
      traderWord: 'stallholder', traderWordPlural: 'stallholders',
      marketWord: 'the underpass', tableWord: 'stall',
      holdWord: 'On you', targetLead: 'You came down here for one thing',
      traders: [
        { icon: '\uD83E\uDDE5', name: 'The Coat', line: 'Sells out of six inside pockets and never blinks.' },
        { icon: '\uD83E\uDDF3', name: 'Sleeper Two', line: 'Sitting on a suitcase that has not been opened all week.' },
        { icon: '\uD83D\uDD26', name: 'Lamp Girl', line: 'Runs the only lit table down here, and charges for it.' },
        { icon: '\uD83E\uDDCD', name: 'The Quiet Man', line: 'Says a number once. Does not say it twice.' },
        { icon: '\uD83D\uDC15', name: 'Dog Handler', line: 'The dog decides who gets to haggle.' },
        { icon: '\uD83E\uDDF0', name: 'Toolcase', line: 'Everything laid out on a towel in strict rows.' },
        { icon: '\uD83C\uDF9F\uFE0F', name: 'Turnstile', line: 'Trades from the dead ticket booth. Never comes out.' }
      ],
      brokerLine: 'Your ally leans in, says a name, and the price drops.',
      done: 'You have it. The tunnel keeps moving around you either way.',
      stay: { icon: '\uD83E\uDD1D', title: 'Work the tables', desc: 'There is more down here than you came for, and the rates are still warm.' },
      go:   { icon: '\uD83E\uDEA7', title: 'Take it and go', desc: 'You have what you needed. Standing still in a market is how you get noticed.' }
    },
    camp_trade_circle: {
      traderWord: 'neighbour', traderWordPlural: 'neighbours',
      marketWord: 'the circle', tableWord: 'mat',
      holdWord: 'In your pack', targetLead: 'One thing in this camp is worth walking over for',
      traders: [
        { icon: '\uD83D\uDD25', name: 'Fire Keeper', line: 'Holds the middle of the circle and therefore the terms.' },
        { icon: '\uD83E\uDDF6', name: 'Blanket Row', line: 'Three families, one tarp, one very firm opinion on value.' },
        { icon: '\uD83E\uDD5B', name: 'The Nurse', line: 'Trades for what she needs on a shift, never for herself.' },
        { icon: '\uD83E\uDE93', name: 'Woodcutter', line: 'Counts in armfuls and thinks in winters.' },
        { icon: '\uD83D\uDC76', name: 'Two Kids', line: 'Sharp, cheerful, and better at this than you are.' },
        { icon: '\uD83D\uDCFB', name: 'Radio Tent', line: 'Listens all night and pays for anything that runs.' },
        { icon: '\uD83D\uDC10', name: 'Goat Man', line: 'The goat is not for trade. Everything else is.' }
      ],
      brokerLine: 'Your ally is known here. The circle shifts one notch in your favour.',
      done: 'The circle closes back over the gap you made in it.',
      stay: { icon: '\uD83D\uDD25', title: 'Sit at the fire', desc: 'They are still trading. Warmth is worth something, and so is being remembered.' },
      go:   { icon: '\uD83C\uDF32', title: 'Shoulder it and walk', desc: 'You have what you came for. The treeline is a long way and the light is not waiting.' }
    },
    dockside_fence: {
      traderWord: 'runner', traderWordPlural: 'runners',
      marketWord: 'the wet quay', tableWord: 'crate',
      holdWord: 'Held', targetLead: 'There is one item on this quay you cannot leave without',
      traders: [
        { icon: '\u2693', name: 'Bollard', line: 'Never stands up. Everything comes to the bollard.' },
        { icon: '\uD83E\uDDCA', name: 'Ice House', line: 'Trades out of a freezer room with the door wedged open.' },
        { icon: '\uD83D\uDEA2', name: 'Ferry Hand', line: 'Has ten minutes between crossings and prices like it.' },
        { icon: '\uD83E\uDDF5', name: 'Net Mender', line: 'Hands never stop. Neither does the arithmetic.' },
        { icon: '\uD83D\uDD26', name: 'Harbour Watch', line: 'Off duty, allegedly, and selling off-duty things.' },
        { icon: '\uD83D\uDC1F', name: 'Gutting Table', line: 'Talks while working. Do not look at the table.' },
        { icon: '\uD83D\uDEE2\uFE0F', name: 'Drum Man', line: 'Rolls his stock along the quay one barrel at a time.' }
      ],
      brokerLine: 'Your ally knows this one from before the water came up. The rate softens.',
      done: 'The tide is still coming in. You have what you needed out of it.',
      stay: { icon: '\uD83E\uDD1D', title: 'Keep working the quay', desc: 'The runners are still out and the water has not reached the crates yet.' },
      go:   { icon: '\uD83D\uDEA4', title: 'Get off the water', desc: 'You have it. Every minute on this quay is a minute the tide gets a vote.' }
    }
  };

  /* Goods pool. Every id is in the core item catalog, so the HUD reads well
     when the target lands in the pack. Ordered roughly low -> high value. */
  var GOODS = [
    'rope', 'wire', 'tape', 'coin', 'battery', 'matches', 'water', 'ration',
    'gloves', 'glowstick', 'lamp', 'radio', 'keycard', 'crowbar', 'medkit'
  ];

  /* ============================================================== BUILD == */

  /** Canonical key for a holdings vector so BFS can memoise states. */
  function hkey(hold) {
    var parts = [], i;
    for (i = 0; i < hold.length; i++) parts.push(hold[i]);
    return parts.join('.');
  }

  function canAfford(hold, offer) {
    for (var i = 0; i < offer.give.length; i++) {
      if (hold[offer.give[i].g] < offer.give[i].n) return false;
    }
    return true;
  }

  function applyOffer(hold, offer, cap) {
    var next = hold.slice(), i;
    for (i = 0; i < offer.give.length; i++) next[offer.give[i].g] -= offer.give[i].n;
    next[offer.get.g] = Math.min(cap, next[offer.get.g] + offer.get.n);
    return next;
  }

  /**
   * Breadth-first search over holdings states.
   * Returns { steps, path } — the fewest trades to hold >= 1 of `target`, or
   * steps === -1 when the target cannot be reached from `hold` at all.
   *
   * Bounded on three axes (node cap, depth cap, per-good cap) because this
   * runs inside build(), which the smoke test calls a thousand times.
   */
  function bfs(hold, offers, target, cap, maxDepth, nodeCap) {
    if (hold[target] > 0) return { steps: 0, path: [] };

    var seen = {}, queue = [{ h: hold, d: 0, via: null, from: null }], head = 0;
    seen[hkey(hold)] = true;

    while (head < queue.length && head < nodeCap) {
      var cur = queue[head++];
      if (cur.d >= maxDepth) continue;

      for (var i = 0; i < offers.length; i++) {
        if (!canAfford(cur.h, offers[i])) continue;
        var nh = applyOffer(cur.h, offers[i], cap);
        var k = hkey(nh);
        if (seen[k]) continue;
        seen[k] = true;

        var node = { h: nh, d: cur.d + 1, via: i, from: cur };
        if (nh[target] > 0) {
          var path = [], walk = node;
          while (walk && walk.via !== null) { path.unshift(walk.via); walk = walk.from; }
          return { steps: node.d, path: path };
        }
        queue.push(node);
      }
    }
    return { steps: -1, path: [] };
  }

  /**
   * Generate a layered exchange graph.
   *
   * Layer 0 goods are what you start holding. Every later layer is bought with
   * the layer below it, so a chain to the target provably exists before a
   * single decoy is added. Decoys are then braided in: sinks that convert a
   * useful good into a useless one, and a shortcut that skips a layer but
   * costs more of the layer below.
   */
  function makeGraph(rng, t, brokered) {
    var pool = rng.shuffle(GOODS);
    var layers = 2 + Math.min(3, Math.floor((t + 1) / 2));    // 3..5 rungs
    var baseCount = t >= 4 ? 2 : 1;                            // distinct starting goods

    var chain = [];          // chain[l] = array of good indices at layer l
    var names = [];          // index -> good id
    var used = 0;

    function take() { var g = pool[used % pool.length]; used++; names.push(g); return names.length - 1; }

    var l, i;
    var first = [];
    for (i = 0; i < baseCount; i++) first.push(take());
    chain.push(first);

    for (l = 1; l < layers; l++) {
      var row = [take()];
      // A middle layer occasionally forks so the graph is a web, not a line.
      if (l > 0 && l < layers - 1 && rng.chance(0.45)) row.push(take());
      chain.push(row);
    }

    var offers = [];
    var producer = {};       // goodIndex -> index of the spine offer that makes it

    function addOffer(give, get, kind) {
      offers.push({ give: give, get: get, kind: kind, brokered: false });
      return offers.length - 1;
    }

    /* --- the guaranteed spine ------------------------------------------- */
    /* Rates get shallower further up the chain on purpose. A five-rung chain
       where every rung costs three of the rung below needs eighty-one coils of
       rope and forty trades, which is not a puzzle, it is a job. */
    for (l = 1; l < layers; l++) {
      var below = chain[l - 1];
      var here = chain[l];
      for (i = 0; i < here.length; i++) {
        var src = below[i % below.length];
        var steep = (l === 1) || rng.chance(0.4);
        var give = [{ g: src, n: steep ? 2 + (rng.chance(0.3) ? 1 : 0) : 1 }];

        // Some rungs want two different goods at once — that is what turns
        // "grind the chain" into something you have to sequence.
        if (below.length > 1 && rng.chance(0.55)) {
          var other = below[(i + 1) % below.length];
          if (other !== src) give.push({ g: other, n: 1 });
        }
        producer[here[i]] = addOffer(give, { g: here[i], n: 1 }, 'spine');
      }
    }

    var target = chain[layers - 1][0];

    /* --- the ally's brokered rate ---------------------------------------- */
    /* Applied BEFORE costing and before the BFS, so the optimum you are scored
       against is the optimum you actually have. */
    if (brokered) {
      var spineIdx = [];
      for (i = 0; i < offers.length; i++) if (offers[i].kind === 'spine') spineIdx.push(i);
      if (spineIdx.length) {
        var o = offers[rng.pick(spineIdx)];
        var biggest = 0;
        for (i = 1; i < o.give.length; i++) if (o.give[i].n > o.give[biggest].n) biggest = i;
        if (o.give[biggest].n > 1) { o.give[biggest].n -= 1; o.brokered = true; }
        else { o.get.n += 1; o.brokered = true; }
      }
    }

    /* --- what one target unit actually costs ----------------------------- */
    /* Walking the spine backwards gives both the base-good bill and the number
       of trades it takes, without running a search. The bill decides how much
       to stock the player with; the trade count decides whether this graph is
       worth keeping at all. */
    var costMemo = {};
    function costOf(g) {
      if (costMemo[g]) return costMemo[g];
      var out, k, b;
      if (producer[g] === undefined) {
        out = { base: {}, trades: 0 };
        out.base[g] = 1;
      } else {
        var off = offers[producer[g]];
        out = { base: {}, trades: 1 };
        for (k = 0; k < off.give.length; k++) {
          var sub = costOf(off.give[k].g);
          var mult = Math.ceil(off.give[k].n / off.get.n);
          out.trades += mult * sub.trades;
          for (b in sub.base) {
            if (!Object.prototype.hasOwnProperty.call(sub.base, b)) continue;
            out.base[b] = (out.base[b] || 0) + mult * sub.base[b];
          }
        }
      }
      costMemo[g] = out;
      return out;
    }
    var bill = costOf(target);

    /* --- decoys ---------------------------------------------------------- */
    var decoys = Math.min(4, 1 + Math.floor(t / 2));
    for (i = 0; i < decoys; i++) {
      var junk = take();
      var kind = rng.int(0, 2);
      if (kind === 0) {
        // Sink: eats a mid-chain good and hands back something with no buyer.
        var midL = rng.int(0, Math.max(0, layers - 2));
        addOffer([{ g: rng.pick(chain[midL]), n: 1 }], { g: junk, n: 2 }, 'sink');
      } else if (kind === 1) {
        // Reverse: breaks a high good back down into low ones. Sometimes the
        // only way out of a corner you traded yourself into.
        var hiL = rng.int(1, layers - 1);
        addOffer([{ g: rng.pick(chain[hiL]), n: 1 }], { g: rng.pick(chain[hiL - 1]), n: 2 }, 'reverse');
      } else if (layers >= 3) {
        // Shortcut: skips a rung, at a price that usually is not worth it.
        var sl = rng.int(0, layers - 3);
        addOffer([{ g: rng.pick(chain[sl]), n: 4 + rng.int(0, 2) }],
          { g: rng.pick(chain[sl + 2]), n: 1 }, 'shortcut');
      } else {
        addOffer([{ g: rng.pick(chain[0]), n: 2 }], { g: junk, n: 1 }, 'sink');
      }
    }

    return {
      names: names, chain: chain, offers: offers, target: target,
      layers: layers, bill: bill.base, predicted: bill.trades
    };
  }

  /** Deal the offers out onto trader cards, 1-2 offers each. */
  function dealTraders(offers, rng, C) {
    var order = [];
    for (var i = 0; i < offers.length; i++) order.push(i);
    order = rng.shuffle(order);

    var people = rng.shuffle(C.traders);
    var traders = [];
    var at = 0, p = 0;
    while (at < order.length) {
      var take = (order.length - at >= 4 && rng.chance(0.55)) ? 2 : 1;
      var who = people[p % people.length]; p++;
      traders.push({ icon: who.icon, name: who.name, line: who.line, offers: order.slice(at, at + take) });
      at += take;
    }
    return traders;
  }

  function build(state, rng, tier, skin) {
    var C = CONTENT[skin.id] || CONTENT.underpass_market;
    var t = Math.min(6, tier);

    var brokered = !!(state && state.hasTag && state.hasTag('has_ally'));
    var CAP = 14;                                  // per-good ceiling, keeps BFS finite
    var NODE_CAP = 20000;

    // The band a good scene lands in. Below it the market is a formality;
    // above it the player is not thinking, just clicking.
    var lo = 2 + Math.floor(t / 2);
    var hi = lo + 3;
    var MAX_DEPTH = Math.min(13, hi + 4);

    var g, hold, solved = { steps: -1, path: [] }, i, guard;

    // Pass 1 — shape the graph until the SPINE costs a sensible number of
    // trades. Pure arithmetic, no search, so it can iterate freely.
    var candidates = [];
    for (guard = 0; guard < 20; guard++) {
      g = makeGraph(rng, t, brokered);
      candidates.push(g);
      if (g.predicted >= lo && g.predicted <= hi) break;
    }
    if (!(g.predicted >= lo && g.predicted <= hi)) {
      // Nothing landed in the band: keep whichever came closest to the middle.
      var want = (lo + hi) / 2, bestI = 0;
      for (i = 1; i < candidates.length; i++) {
        if (Math.abs(candidates[i].predicted - want) < Math.abs(candidates[bestI].predicted - want)) bestI = i;
      }
      g = candidates[bestI];
    }

    // Pass 2 — stock the pack from the bill, then confirm with a real BFS that
    // the target is reachable AND still worth walking to. Slack exists so a
    // wasted trade is recoverable rather than fatal.
    var slackTries = [2 + rng.int(0, 2), 4, 7];
    for (guard = 0; guard < slackTries.length; guard++) {
      hold = [];
      for (i = 0; i < g.names.length; i++) hold.push(0);
      for (i = 0; i < g.chain[0].length; i++) {
        var b = g.chain[0][i];
        hold[b] = Math.min(CAP, (g.bill[b] || 0) + slackTries[guard]);
      }
      solved = bfs(hold, g.offers, g.target, CAP, MAX_DEPTH, NODE_CAP);
      if (solved.steps >= lo) break;
      if (solved.steps >= 0) break;    // reachable but cheap: still a real scene
    }

    if (solved.steps < 0) {
      // Pathological seed. Hand the player a direct offer for the target so the
      // scene is always winnable — never dead-end a run on a bad roll.
      g.offers.push({ give: [{ g: g.chain[0][0], n: 2 }], get: { g: g.target, n: 1 }, kind: 'spine', brokered: false });
      hold[g.chain[0][0]] = Math.max(hold[g.chain[0][0]], 4);
      solved = bfs(hold, g.offers, g.target, CAP, MAX_DEPTH, NODE_CAP);
      if (solved.steps < 0) solved = { steps: 1, path: [g.offers.length - 1] };
    }

    var traders = dealTraders(g.offers, rng, C);

    return {
      names: g.names,
      offers: g.offers,
      traders: traders,
      target: g.target,
      hold: hold,
      start: hold.slice(),
      optimal: solved.steps,
      optimalPath: solved.path,
      brokered: brokered,
      cap: CAP,
      maxDepth: MAX_DEPTH,
      nodeCap: NODE_CAP,
      trades: 0,
      backtracks: 0,
      log: [],
      done: false,
      tier: t,
      content: C
    };
  }

  /* ================================================================ CSS == */

  var CSS = [
    '.pz-barter{display:grid;grid-template-columns:minmax(0,1fr) minmax(230px,300px);gap:18px;align-items:start}',
    '@media (max-width:880px){.pz-barter{grid-template-columns:1fr}}',

    '.pz-barter-tables{display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(228px,1fr))}',
    '.pz-barter-node{position:relative;display:flex;flex-direction:column;gap:9px;padding:12px 13px;',
    '  border-radius:12px;border:1px solid var(--line);background:linear-gradient(180deg,var(--panel-2),var(--panel));',
    '  box-shadow:var(--sh-1);transition:border-color .2s var(--ease),transform .2s var(--ease)}',
    '.pz-barter-node:hover{border-color:color-mix(in srgb,var(--acc) 45%,var(--line))}',
    '.pz-barter-node.is-live{border-color:color-mix(in srgb,var(--acc) 60%,var(--line))}',

    '.pz-barter-who{display:flex;gap:9px;align-items:flex-start}',
    '.pz-barter-who__i{font-size:22px;line-height:1.1}',
    '.pz-barter-who__n{font-size:13px;font-weight:700;color:var(--text)}',
    '.pz-barter-who__l{font-size:11px;color:var(--dim);line-height:1.5}',

    '.pz-barter-offer{display:flex;align-items:center;gap:9px;padding:7px 9px;border-radius:9px;',
    '  border:1px solid var(--line-soft);background:rgba(0,0,0,.24);cursor:pointer;width:100%;text-align:left;',
    '  color:var(--text);font-family:var(--font-ui);font-size:12px;transition:background .18s var(--ease),border-color .18s var(--ease),transform .12s var(--ease)}',
    '.pz-barter-offer:hover:not(:disabled){background:var(--acc-wash);border-color:var(--acc);transform:translateX(2px)}',
    '.pz-barter-offer:disabled{opacity:.34;cursor:default}',
    '.pz-barter-offer:focus-visible{outline:2px solid var(--acc);outline-offset:2px}',
    '.pz-barter-offer__side{display:inline-flex;align-items:center;gap:4px;font-family:var(--font-mono);white-space:nowrap}',
    '.pz-barter-offer__arrow{color:var(--acc);font-size:14px;flex:0 0 auto}',
    '.pz-barter-offer__n{color:var(--acc-2);font-weight:700}',

    '.pz-barter-flag{position:absolute;top:-8px;right:10px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;',
    '  padding:2px 7px;border-radius:999px;background:#2b1f0c;color:var(--acc-2);border:1px solid var(--acc)}',

    '.pz-barter-hold{display:flex;flex-wrap:wrap;gap:7px}',
    '.pz-barter-good{display:inline-flex;align-items:center;gap:5px;padding:4px 9px;border-radius:999px;',
    '  border:1px solid var(--line);background:var(--panel-3);font-size:12px;color:var(--text-2);',
    '  font-family:var(--font-mono);transition:transform .22s var(--ease),border-color .22s var(--ease)}',
    '.pz-barter-good b{color:var(--acc-2)}',
    '.pz-barter-good.is-zero{opacity:.32}',
    '.pz-barter-good.is-target{border-color:var(--acc);box-shadow:0 0 14px var(--acc-glow)}',
    '.pz-barter-good.is-bump{transform:translateY(-3px) scale(1.06);border-color:var(--acc)}',

    '.pz-barter-goal{display:flex;align-items:center;gap:11px;padding:11px 13px;border-radius:11px;',
    '  border:1px solid var(--acc);background:linear-gradient(180deg,var(--acc-wash),transparent)}',
    '.pz-barter-goal__i{font-size:26px}',
    '.pz-barter-goal__t{font-size:13px;font-weight:700;color:var(--acc-2)}',
    '.pz-barter-goal__d{font-size:11px;color:var(--dim);line-height:1.5}',

    '.pz-barter-meter{display:flex;flex-direction:column;gap:6px}',
    '.pz-barter-meter__row{display:flex;justify-content:space-between;gap:10px;font-family:var(--font-mono);font-size:11px;color:var(--dim)}',
    '.pz-barter-meter__row b{color:var(--acc-2)}',
    '.pz-barter-meter__row.is-warn b{color:var(--bad)}',

    '.pz-barter-log{display:flex;flex-direction:column;gap:4px;max-height:186px;overflow:auto;',
    '  font-family:var(--font-mono);font-size:11px;color:var(--dim);line-height:1.6}',
    '.pz-barter-log span{border-left:2px solid var(--line);padding-left:8px}',
    '.pz-barter-log span.is-back{border-left-color:var(--bad);color:var(--bad)}',

    '.pz-barter-stuck{font-size:12px;line-height:1.55;color:var(--bad);padding:9px 11px;border-radius:8px;',
    '  background:rgba(226,105,95,.08);border:1px solid rgba(226,105,95,.28)}'
  ].join('\n');

  /* ================================================================ MOUNT = */

  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var C = puzzle.content;
    var finished = false;
    var lastTouched = -1;

    var holdBox   = h('div', { class: 'pz-barter-hold' });
    var tablesBox = h('div', { class: 'pz-barter-tables' });
    var meterBox  = h('div', { class: 'pz-barter-meter' });
    var logBox    = h('div', { class: 'pz-barter-log' });
    var warnBox   = h('div', {});
    var actionBox = h('div', { class: 'pz-col' });
    var offerBtns = {};

    function goodName(i) { return PS.state.itemInfo(puzzle.names[i]).name; }
    function goodIcon(i) { return PS.state.itemInfo(puzzle.names[i]).icon; }

    /* ------------------------------------------------------------- render -- */

    function paintHold() {
      PS.ui.clear(holdBox);
      var shown = 0;
      for (var i = 0; i < puzzle.names.length; i++) {
        var n = puzzle.hold[i];
        var isTarget = i === puzzle.target;
        if (n > 0) everHeld[i] = true;
        if (!n && !isTarget && !everHeld[i]) continue;
        shown++;
        var cls = 'pz-barter-good' + (n === 0 ? ' is-zero' : '') + (isTarget ? ' is-target' : '') +
          (i === lastTouched ? ' is-bump' : '');
        holdBox.appendChild(h('span', { class: cls }, [
          goodIcon(i), h('b', { text: String(n) }), ' ' + goodName(i)
        ]));
      }
      if (!shown) holdBox.appendChild(h('span', { class: 'pz-note', text: 'Empty-handed.' }));
      lastTouched = -1;
    }

    /* Goods only appear in the pack row once they have passed through your
       hands (plus the target, always, so you never lose sight of the point).
       Listing every good in the graph would be a wall of zeroes. */
    var everHeld = {};
    for (var ei = 0; ei < puzzle.hold.length; ei++) if (puzzle.hold[ei] > 0) everHeld[ei] = true;

    function offerRow(idx) {
      var o = puzzle.offers[idx];
      var give = [];
      for (var i = 0; i < o.give.length; i++) {
        if (i) give.push(h('span', { class: 'pz-barter-offer__arrow', text: '+' }));
        give.push(h('span', { class: 'pz-barter-offer__side' }, [
          h('span', { class: 'pz-barter-offer__n', text: String(o.give[i].n) }),
          goodIcon(o.give[i].g), goodName(o.give[i].g)
        ]));
      }

      var btn = h('button', {
        class: 'pz-barter-offer', type: 'button',
        title: 'Trade with this ' + C.traderWord,
        onclick: function () { doTrade(idx); }
      }, [
        give,
        h('span', { class: 'pz-barter-offer__arrow', text: '\u2192' }),
        h('span', { class: 'pz-barter-offer__side' }, [
          h('span', { class: 'pz-barter-offer__n', text: String(o.get.n) }),
          goodIcon(o.get.g), goodName(o.get.g)
        ])
      ]);
      offerBtns[idx] = btn;
      return btn;
    }

    function paintTables() {
      PS.ui.clear(tablesBox);
      for (var i = 0; i < puzzle.traders.length; i++) {
        var tr = puzzle.traders[i];
        var rows = [];
        var live = false;
        for (var j = 0; j < tr.offers.length; j++) {
          rows.push(offerRow(tr.offers[j]));
          if (canAfford(puzzle.hold, puzzle.offers[tr.offers[j]])) live = true;
        }
        var brokeredHere = false;
        for (j = 0; j < tr.offers.length; j++) if (puzzle.offers[tr.offers[j]].brokered) brokeredHere = true;

        var card = h('div', { class: 'pz-barter-node' + (live ? ' is-live' : '') }, [
          brokeredHere ? h('div', { class: 'pz-barter-flag', text: 'brokered' }) : null,
          h('div', { class: 'pz-barter-who' }, [
            h('div', { class: 'pz-barter-who__i', text: tr.icon }),
            h('div', {}, [
              h('div', { class: 'pz-barter-who__n', text: tr.name }),
              h('div', { class: 'pz-barter-who__l', text: tr.line })
            ])
          ]),
          rows
        ]);
        tablesBox.appendChild(card);
      }
      refreshButtons();
    }

    function refreshButtons() {
      for (var idx in offerBtns) {
        if (!Object.prototype.hasOwnProperty.call(offerBtns, idx)) continue;
        offerBtns[idx].disabled = finished || !canAfford(puzzle.hold, puzzle.offers[idx]);
      }
    }

    function remaining() {
      return bfs(puzzle.hold, puzzle.offers, puzzle.target, puzzle.cap, puzzle.maxDepth, puzzle.nodeCap);
    }

    function paintMeter() {
      var left = remaining();
      PS.ui.clear(meterBox);
      PS.ui.append(meterBox, [
        row('Trades made', String(puzzle.trades)),
        row('Best possible', puzzle.optimal + ' trade' + (puzzle.optimal === 1 ? '' : 's')),
        row('From here', left.steps < 0 ? 'no route left' : left.steps + ' more', left.steps < 0),
        row('Walked back', String(puzzle.backtracks))
      ]);

      PS.ui.clear(warnBox);
      if (left.steps < 0 && !puzzle.done) {
        warnBox.appendChild(h('div', { class: 'pz-barter-stuck' },
          ['You have traded yourself into a corner \u2014 nothing on these ' + C.tableWord +
            's turns what you are holding into what you need. Walk a trade back.']));
      }

      function row(k, v, warn) {
        return h('div', { class: 'pz-barter-meter__row' + (warn ? ' is-warn' : '') },
          [h('span', { text: k }), h('b', { text: v })]);
      }
    }

    function paintLog() {
      PS.ui.clear(logBox);
      if (!puzzle.log.length) {
        logBox.appendChild(h('span', { text: 'Nothing traded yet.' }));
        return;
      }
      for (var i = Math.max(0, puzzle.log.length - 12); i < puzzle.log.length; i++) {
        logBox.appendChild(h('span', {
          class: puzzle.log[i].back ? 'is-back' : '',
          text: puzzle.log[i].text
        }));
      }
      logBox.scrollTop = logBox.scrollHeight;
    }

    function repaint() {
      paintHold();
      refreshButtons();
      paintMeter();
      paintLog();
    }

    /* ------------------------------------------------------------ trading -- */

    var history = [];

    function describe(o) {
      var parts = [];
      for (var i = 0; i < o.give.length; i++) parts.push(o.give[i].n + '\u00D7' + goodName(o.give[i].g));
      return parts.join(' + ') + ' \u2192 ' + o.get.n + '\u00D7' + goodName(o.get.g);
    }

    function doTrade(idx) {
      if (finished || puzzle.done) return;
      var o = puzzle.offers[idx];
      if (!canAfford(puzzle.hold, o)) { api.toast('You are not holding enough for that.', 'bad', 1400); return; }

      history.push({ hold: puzzle.hold.slice(), idx: idx });
      puzzle.hold = applyOffer(puzzle.hold, o, puzzle.cap);
      puzzle.trades++;
      lastTouched = o.get.g;
      puzzle.log.push({ text: puzzle.trades + '. ' + describe(o), back: false });

      // Haggling is work. Not much, but it is not free either.
      api.tweak({ energy: -1 });
      if (o.brokered) api.toast(C.brokerLine, 'good', 2600);

      if (puzzle.hold[puzzle.target] > 0) {
        puzzle.done = true;
        paintTables();
        repaint();
        renderEnd();
        return;
      }
      paintTables();
      repaint();
    }

    function undo() {
      if (finished || puzzle.done || !history.length) return;
      var prev = history.pop();
      puzzle.hold = prev.hold;
      puzzle.trades = Math.max(0, puzzle.trades - 1);
      puzzle.backtracks++;
      puzzle.log.push({ text: '\u21A9 took back: ' + describe(puzzle.offers[prev.idx]), back: true });
      api.tweak({ morale: -1 });
      paintTables();
      repaint();
    }

    /* ------------------------------------------------------------ endings -- */

    function renderEnd() {
      PS.ui.clear(actionBox);
      var over = puzzle.trades - puzzle.optimal;
      var verdict = over <= 0
        ? 'You did it in the fewest moves the ' + C.marketWord + ' allows.'
        : (over <= 2
          ? 'Two or three units lighter than you had to be, but you got it.'
          : 'It cost you a lot more than it should have.');

      PS.ui.append(actionBox, [
        h('div', { class: 'pz-intro', text: C.done + ' ' + verdict + ' (' + puzzle.trades + ' trades, best possible ' + puzzle.optimal + '.)' }),
        h('div', { class: 'pz-choices' }, [
          choiceBtn(C.stay, 'trade'),
          choiceBtn(C.go, 'scavenge')
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
      refreshButtons();

      var over = puzzle.trades - puzzle.optimal;
      var clean = over <= 0;
      var tidy = over <= 2;
      var targetId = puzzle.names[puzzle.target];

      var extras = [];
      // Anything still in hand that the core catalog knows about comes with you.
      for (var i = 0; i < puzzle.names.length; i++) {
        if (i === puzzle.target || !puzzle.hold[i]) continue;
        if (PS.state.ITEMS[puzzle.names[i]] && puzzle.hold[i] >= 3 && extras.length < 2) extras.push(puzzle.names[i]);
      }

      api.finish({
        outcome: tidy ? 'success' : 'partial',
        stats: {
          morale: clean ? 8 : (tidy ? 3 : -3),
          energy: -(2 + Math.min(6, puzzle.trades)),
          health: 0
        },
        gain: [targetId].concat(choice === 'trade' ? extras : extras.slice(0, 1)),
        lose: [],
        tags: ['worked_a_market']
          .concat(clean ? ['sharp_trader'] : [])
          .concat(puzzle.brokered ? ['used_an_ally'] : [])
          .concat(choice === 'trade' ? ['known_in_the_market'] : []),
        signals: {
          scavenge: clean ? 3 : 2,
          logic: clean ? 3 : (tidy ? 2 : 1),
          caution: puzzle.backtracks > 0 ? 1 : 0,
          speed: puzzle.trades <= puzzle.optimal ? 1 : 0
        },
        choice: choice,
        summary: 'You turned ' + goodName(indexOfMax(puzzle.start)).toLowerCase() +
          ' into a ' + PS.state.itemInfo(targetId).name.toLowerCase() +
          ' in ' + puzzle.trades + ' trade' + (puzzle.trades === 1 ? '' : 's') +
          (clean ? ' \u2014 nobody in ' + C.marketWord + ' got the better of you.' : '.')
      });
    }

    function indexOfMax(arr) {
      var best = 0;
      for (var i = 1; i < arr.length; i++) if (arr[i] > arr[best]) best = i;
      return best;
    }

    function walkAway() {
      if (finished || puzzle.done) return;
      finished = true;
      refreshButtons();
      api.finish({
        outcome: 'fail',
        stats: { morale: -8, energy: -6 },
        gain: [], lose: [],
        tags: ['left_the_market_empty'],
        signals: { caution: 2, scavenge: 1 },
        choice: null,
        summary: 'You could not make the numbers work and left ' + C.marketWord + ' with what you walked in holding.'
      });
    }

    /* ------------------------------------------------------------- layout -- */

    var targetInfo = PS.state.itemInfo(puzzle.names[puzzle.target]);

    PS.ui.append(actionBox, [
      h('button', {
        class: 'pz-btn pz-btn--sm', type: 'button', onclick: undo
      }, ['\u21A9 Take that back']),
      h('button', {
        class: 'pz-btn pz-btn--danger pz-btn--sm', type: 'button', onclick: walkAway
      }, ['\uD83D\uDEB6 Walk away'])
    ]);

    PS.ui.append(el, h('div', { class: 'pz-barter' }, [
      h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-barter-goal' }, [
          h('div', { class: 'pz-barter-goal__i', text: targetInfo.icon }),
          h('div', {}, [
            h('div', { class: 'pz-barter-goal__t', text: C.targetLead + ': ' + targetInfo.name }),
            h('div', { class: 'pz-barter-goal__d', text: targetInfo.desc + ' Nobody here sells it for anything you are carrying \u2014 not directly.' })
          ])
        ]),
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: C.holdWord }),
          holdBox
        ]),
        tablesBox,
        h('div', { class: 'pz-note' }, [
          'Every ', h('strong', { text: C.traderWord }), ' takes one thing and gives another, at a rate that does not move. ',
          'Chain them. Greyed-out offers are ones you cannot pay for yet.'
        ])
      ]),
      h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'Ledger' }),
          meterBox
        ]),
        warnBox,
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'Deals struck' }),
          logBox
        ]),
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'Options' }),
          actionBox
        ])
      ])
    ]));

    paintTables();
    repaint();

    teardownFns.push(function () { offerBtns = {}; history.length = 0; });
  }

  function unmount() {
    while (teardownFns.length) {
      try { teardownFns.pop()(); } catch (e) { /* keep unwinding */ }
    }
  }

  /* ================================================================ HINT = */

  function hint(puzzle) {
    var C = puzzle.content;
    var left = bfs(puzzle.hold, puzzle.offers, puzzle.target, puzzle.cap, puzzle.maxDepth, puzzle.nodeCap);
    if (left.steps < 0) {
      return 'Nothing you are holding turns into a ' +
        PS.state.itemInfo(puzzle.names[puzzle.target]).name.toLowerCase() +
        ' any more. Take a trade back.';
    }
    if (left.steps === 0) return 'You are already holding it. Close the deal.';
    var next = puzzle.offers[left.path[0]];
    var give = [];
    for (var i = 0; i < next.give.length; i++) {
      give.push(next.give[i].n + ' ' + PS.state.itemInfo(puzzle.names[next.give[i].g]).name.toLowerCase());
    }
    return left.steps + ' more trade' + (left.steps === 1 ? '' : 's') + ' from here. Start by giving up ' +
      give.join(' and ') + ' \u2014 somebody on these ' + C.tableWord + 's wants exactly that.';
  }

  /* ============================================================ AUTOSOLVE = */
  /* Headless. Walks the BFS-optimal chain and reports what it cost. */

  function autoSolve(puzzle, rng) {
    var sol = bfs(puzzle.start, puzzle.offers, puzzle.target, puzzle.cap, puzzle.maxDepth, puzzle.nodeCap);
    var steps = sol.steps < 0 ? puzzle.optimal : sol.steps;
    var sloppy = rng.chance(0.3);
    var trades = steps + (sloppy ? rng.int(1, 3) : 0);
    var choice = rng.chance(0.5) ? 'trade' : 'scavenge';
    var targetId = puzzle.names[puzzle.target];

    return {
      outcome: sloppy ? 'partial' : 'success',
      stats: { morale: sloppy ? 2 : 8, energy: -(2 + Math.min(6, trades)) },
      gain: [targetId],
      lose: [],
      tags: ['worked_a_market'].concat(sloppy ? [] : ['sharp_trader']),
      signals: { scavenge: 3, logic: sloppy ? 1 : 3, speed: sloppy ? 0 : 1 },
      choice: choice,
      summary: 'Traded up to a ' + PS.state.itemInfo(targetId).name.toLowerCase() + ' in ' + trades + ' moves.'
    };
  }

  /* ============================================================ REGISTER = */

  PS.registry.register({
    id: 'barter_graph',
    name: 'Barter Graph',
    icon: '\uD83E\uDE99',
    blurb: 'Nobody takes money. Chain the exchanges until you are holding the thing you came for.',

    favors:   { scavenge: 3, logic: 2 },
    provides: ['supplies', 'trade', 'salvage', 'load_out'],
    tagHooks: ['has_ally', 'has_tools', 'known_in_the_market'],
    requires: function (state) { return state.stats.morale > 5; },

    css: CSS,

    skins: [
      {
        id: 'underpass_market', biome: 'urban', title: 'The Underpass Market',
        icon: '\uD83D\uDD26', palette: 'steel',
        intro: 'Two hundred metres of pedestrian tunnel, and every third alcove is somebody selling. No till, no prices, no money \u2014 just people who each want one specific thing. Whatever you are carrying, somebody down here wants it more than what they are holding.',
        nouns: { trader: 'stallholder', venue: 'the underpass', unit: 'a stall' }
      },
      {
        id: 'camp_trade_circle', biome: 'wilderness', title: 'The Trade Circle',
        icon: '\uD83D\uDD25', palette: 'moss',
        intro: 'The camp lays its goods out on tarps in a loose ring around the fire and lets the rates settle themselves. Nothing is written down. Everybody remembers everything.',
        nouns: { trader: 'neighbour', venue: 'the circle', unit: 'a mat' }
      },
      {
        id: 'dockside_fence', biome: 'water', title: 'The Dockside Fence',
        icon: '\u2693', palette: 'ice',
        intro: 'The quay floods at high water, so the whole market runs at a jog. Crates come off the boats, change hands four times in an hour, and go back on. Ask a straight question and you get a rate, once.',
        nouns: { trader: 'runner', venue: 'the quay', unit: 'a crate' }
      }
    ],

    build: build,
    mount: mount,
    unmount: unmount,
    hint: hint,
    autoSolve: autoSolve
  });

})(typeof window !== 'undefined' ? window : this);
