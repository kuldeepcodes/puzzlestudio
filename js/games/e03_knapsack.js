/* ==========================================================================
   PuzzleStudio — js/games/e03_knapsack.js             ENGINE 03 · Knapsack
   --------------------------------------------------------------------------
   Self-contained: logic + 3 skins + its own CSS. No DOM access until mount().

   THE PUZZLE
     A pile of things and a back that will only take so much. Every object has
     a weight in kilos and a worth you can read off it in pips. You carry what
     you carry; the rest stays here forever.

   THE DEPTH
     Three pairs in the pile want to be one thing. Rope wants a hook. Cloth
     wants fuel. A cell wants a bulb. Lashed together they weigh LESS than
     their parts and are worth far more — so the optimum is never the obvious
     greedy pick, and finding the pairs is the actual game. Nothing tells you
     they exist. Put both halves in the pack and the option appears.

   WHY IT MATTERS
     Everything you shoulder is passed out through `gain`, so the pack you
     build here is the pack you are still carrying six scenes from now. A
     lamp taken here is a lamp in the dark later.

   THE BRANCH
     Committed and still standing, you decide how you leave: one more sweep
     of the shelves for the best thing you left (scavenge, costly, greedy),
     or out of the door while you still have legs (sprint).
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio;
  if (!PS || !PS.registry) { if (root.console) console.error('[e03] core not loaded'); return; }

  /* ======================================================== PUZZLE PARTS ==
     Mechanics live on the key. Skins only rename and re-icon them, so the
     same seeded pile reads as a looted shop, a packed rucksack or a locker.
     `item` is the id handed to the run inventory when this is carried out. */

  var PARTS = [
    { key: 'rope',    w: 4, v: 7,  item: 'rope',    use: 'Twelve metres. Gets you down things you cannot climb.' },
    { key: 'hook',    w: 2, v: 3,  item: 'wire',    use: 'Bent steel with a bite. Not much use on its own.' },
    { key: 'cloth',   w: 2, v: 3,  item: 'blanket', use: 'Heavy weave. Warmth, or a bandage, or a wick.' },
    { key: 'fuel',    w: 3, v: 4,  item: 'fuel',    use: 'A slosh of something that wants to burn.' },
    { key: 'battery', w: 2, v: 4,  item: 'battery', use: 'Charged. No idea what it fits.' },
    { key: 'bulb',    w: 1, v: 2,  item: 'wire',    use: 'Glass, filament, no power behind it.' },
    { key: 'water',   w: 3, v: 8,  item: 'water',   use: 'Heavy for what it is. You will want it anyway.' },
    { key: 'food',    w: 3, v: 7,  item: 'ration',  use: 'Dense, salty, keeps for years.' },
    { key: 'medkit',  w: 3, v: 9,  item: 'medkit',  use: 'Closes what opens. Nothing else here does.' },
    { key: 'blade',   w: 2, v: 5,  item: 'knife',   use: 'Cuts rope, cord, webbing, argument.' },
    { key: 'pry',     w: 6, v: 8,  item: 'crowbar', use: 'Opens most things. Weighs like it means it.' },
    { key: 'chart',   w: 1, v: 4,  item: 'map',     use: 'Out of date. Still better than guessing.' },
    { key: 'horn',    w: 1, v: 3,  item: 'whistle', use: 'Carries a lot further than a shout.' }
  ];

  var COMBOS = [
    { a: 'rope',    b: 'hook', key: 'grapple', w: 5, v: 18, item: 'rope',
      use: 'Whipped onto the line. Now it goes up as well as down.' },
    { a: 'cloth',   b: 'fuel', key: 'torch',   w: 4, v: 16, item: 'torch',
      use: 'Wound tight and soaked through. Two hours of light, maybe three.' },
    { a: 'battery', b: 'bulb', key: 'lamp',    w: 3, v: 17, item: 'lamp',
      use: 'Taped contact to contact. Steady, cold, and it does not go out.' }
  ];

  var PART_BY_KEY = {};
  (function () {
    for (var i = 0; i < PARTS.length; i++) PART_BY_KEY[PARTS[i].key] = PARTS[i];
    for (var j = 0; j < COMBOS.length; j++) PART_BY_KEY[COMBOS[j].key] = COMBOS[j];
  })();

  /* ======================================================== SKIN CONTENT == */

  var CONTENT = {
    collapsed_store: {
      lash: 'You lash them together with what is on the shelf.',
      overweight: 'Your knees say no. Something has to come out.',
      sweepGood: 'One more pass down the dark aisle. You come back with something.',
      sweepBad: 'The racking shifts while you are under it.',
      leave: 'You walk out under the shutter without looking back.',
      names: {
        rope:    { n: 'Washing line',      i: '\uD83E\uDEA2' },
        hook:    { n: 'Butcher hook',      i: '\uD83E\uDE9D' },
        cloth:   { n: 'Bundle of tea towels', i: '\uD83E\uDDE3' },
        fuel:    { n: 'Barbecue fluid',    i: '\uD83E\uDDF4' },
        battery: { n: 'Till batteries',    i: '\uD83D\uDD0B' },
        bulb:    { n: 'Torch bulb',        i: '\uD83D\uDCA1' },
        water:   { n: 'Bottled water',     i: '\uD83D\uDCA7' },
        food:    { n: 'Tinned stew',       i: '\uD83E\uDD6B' },
        medkit:  { n: 'First aid box',     i: '\uD83E\uDE79' },
        blade:   { n: 'Box cutter',        i: '\uD83D\uDD2A' },
        pry:     { n: 'Shelf bracket bar', i: '\uD83D\uDD28' },
        chart:   { n: 'Fire escape plan',  i: '\uD83D\uDDFA\uFE0F' },
        horn:    { n: 'Sports whistle',    i: '\uD83D\uDCE3' },
        grapple: { n: 'Hook and line',     i: '\uD83E\uDE9D' },
        torch:   { n: 'Rag torch',         i: '\uD83D\uDD25' },
        lamp:    { n: 'Shelf lamp',        i: '\uD83C\uDFEE' }
      }
    },

    evac_backpack: {
      lash: 'You rig them together on the kitchen floor.',
      overweight: 'The seams creak. You are not carrying that down nine flights.',
      sweepGood: 'You go back up the stairs one last time. Stupid. Worth it.',
      sweepBad: 'You come back down through smoke that was not there before.',
      leave: 'You take the stairs while they are still stairs.',
      names: {
        rope:    { n: 'Paracord hank',     i: '\uD83E\uDEA2' },
        hook:    { n: 'Steel carabiner',   i: '\uD83E\uDE9D' },
        cloth:   { n: 'Wool jumper',       i: '\uD83E\uDDE3' },
        fuel:    { n: 'Lighter fluid',     i: '\uD83E\uDDF4' },
        battery: { n: 'Power cell',        i: '\uD83D\uDD0B' },
        bulb:    { n: 'LED module',        i: '\uD83D\uDCA1' },
        water:   { n: 'Filter bottle',     i: '\uD83D\uDCA7' },
        food:    { n: 'Box of energy bars', i: '\uD83E\uDD6B' },
        medkit:  { n: 'Trauma kit',        i: '\uD83E\uDE79' },
        blade:   { n: 'Multi-tool',        i: '\uD83D\uDD2A' },
        pry:     { n: 'Wrecking bar',      i: '\uD83D\uDD28' },
        chart:   { n: 'City street map',   i: '\uD83D\uDDFA\uFE0F' },
        horn:    { n: 'Rescue whistle',    i: '\uD83D\uDCE3' },
        grapple: { n: 'Rigged climb line', i: '\uD83E\uDE9D' },
        torch:   { n: 'Wick torch',        i: '\uD83D\uDD25' },
        lamp:    { n: 'Head lamp',         i: '\uD83C\uDFEE' }
      }
    },

    lifeboat_locker: {
      lash: 'You seize them together with a turn of spun yarn.',
      overweight: 'The boat has a freeboard and you are eating it.',
      sweepGood: 'You go back down the ladder into water that is higher now.',
      sweepBad: 'A sea comes over the rail while you are below.',
      leave: 'You cut the falls and let her drop.',
      names: {
        rope:    { n: 'Painter line',      i: '\uD83E\uDEA2' },
        hook:    { n: 'Boat hook head',    i: '\uD83E\uDE9D' },
        cloth:   { n: 'Storm canvas',      i: '\uD83E\uDDE3' },
        fuel:    { n: 'Stove paraffin',    i: '\uD83E\uDDF4' },
        battery: { n: 'Dry cell',          i: '\uD83D\uDD0B' },
        bulb:    { n: 'Signal bulb',       i: '\uD83D\uDCA1' },
        water:   { n: 'Water breaker',     i: '\uD83D\uDCA7' },
        food:    { n: 'Tin of biscuit',    i: '\uD83E\uDD6B' },
        medkit:  { n: 'Casualty pouch',    i: '\uD83E\uDE79' },
        blade:   { n: 'Rigging knife',     i: '\uD83D\uDD2A' },
        pry:     { n: 'Oarlock bar',       i: '\uD83D\uDD28' },
        chart:   { n: 'Coastal chart',     i: '\uD83D\uDDFA\uFE0F' },
        horn:    { n: 'Fog horn',          i: '\uD83D\uDCE3' },
        grapple: { n: 'Made-up boat hook', i: '\uD83E\uDE9D' },
        torch:   { n: 'Oil-soaked torch',  i: '\uD83D\uDD25' },
        lamp:    { n: 'Bulkhead lamp',     i: '\uD83C\uDFEE' }
      }
    }
  };

  /* ============================================================== BUILD ==
     A pile is: every half of 2-3 combo pairs (so the depth is always there
     to be found) plus filler drawn from the rest, then a cap tight enough
     that you cannot take it all. Tighter every tier. */

  function pips(v) { return Math.max(1, Math.min(5, Math.round(v / 3.6))); }

  function build(state, rng, tier, skin) {
    var C = CONTENT[skin.id] || CONTENT.collapsed_store;
    var t = Math.min(6, tier);
    var i;

    // How many of the three pairs are actually seeded into this pile.
    var pairCount = t <= 1 ? 2 : 3;
    var pairs = rng.sample(COMBOS, pairCount);

    var keys = [];
    for (i = 0; i < pairs.length; i++) { keys.push(pairs[i].a); keys.push(pairs[i].b); }

    var fillerPool = [];
    for (i = 0; i < PARTS.length; i++) {
      if (keys.indexOf(PARTS[i].key) < 0) fillerPool.push(PARTS[i].key);
    }
    var target = Math.min(PARTS.length, 7 + t);          // 8 at T1 up to 13 at T6
    var filler = rng.sample(fillerPool, Math.max(0, target - keys.length));
    keys = rng.shuffle(keys.concat(filler));

    var items = [];
    for (i = 0; i < keys.length; i++) {
      var p = PART_BY_KEY[keys[i]];
      items.push({
        uid: 'p' + i,
        key: p.key,
        w: p.w,
        v: p.v,
        item: p.item,
        combo: false,
        parts: null
      });
    }

    var totalW = 0;
    for (i = 0; i < items.length; i++) totalW += items[i].w;

    // Tighter budget every tier, but never so tight that the heaviest single
    // object cannot be lifted at all — an unopenable puzzle is not a puzzle.
    var frac = 0.54 - t * 0.028;
    var heaviest = 0;
    for (i = 0; i < items.length; i++) heaviest = Math.max(heaviest, items[i].w);
    var cap = Math.max(heaviest + 2, Math.round(totalW * frac));

    // Which combos are actually completable inside this pile.
    var live = [];
    for (i = 0; i < COMBOS.length; i++) {
      if (keys.indexOf(COMBOS[i].a) >= 0 && keys.indexOf(COMBOS[i].b) >= 0) live.push(COMBOS[i]);
    }

    var puzzle = {
      tier: t,
      cap: cap,
      items: items,          // every object that exists this scene
      pack: [],              // uids currently shouldered
      combos: live,
      found: {},             // combo key -> true once the player has made it
      made: 0,
      committed: false,
      content: C,
      names: C.names
    };
    puzzle.optimal = solveOptimal(puzzle);
    return puzzle;
  }

  /* ------------------------------------------------------------- solver --
     Exact. Combos never share a component, so we can enumerate the (at most
     eight) subsets of combos to apply, collapse each into a flat item list,
     and run a plain 0/1 knapsack DP over integer kilos. The best of those is
     the true optimum — which is what the player's score is measured against. */

  function packListFor(puzzle, comboMask) {
    var used = {}, list = [], i, c;
    for (i = 0; i < puzzle.combos.length; i++) {
      if (!(comboMask & (1 << i))) continue;
      c = puzzle.combos[i];
      var ua = findFree(puzzle.items, c.a, used);
      var ub = findFree(puzzle.items, c.b, used);
      if (ua === null || ub === null) return null;
      used[ua] = true; used[ub] = true;
      list.push({ w: c.w, v: c.v });
    }
    for (i = 0; i < puzzle.items.length; i++) {
      if (used[puzzle.items[i].uid]) continue;
      list.push({ w: puzzle.items[i].w, v: puzzle.items[i].v });
    }
    return list;
  }

  function findFree(items, key, used) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].key === key && !used[items[i].uid]) return items[i].uid;
    }
    return null;
  }

  function knapsack(list, cap) {
    var dp = [], i, w;
    for (w = 0; w <= cap; w++) dp.push(0);
    for (i = 0; i < list.length; i++) {
      for (w = cap; w >= list[i].w; w--) {
        var alt = dp[w - list[i].w] + list[i].v;
        if (alt > dp[w]) dp[w] = alt;
      }
    }
    return dp[cap];
  }

  function solveOptimal(puzzle) {
    var best = 0;
    var masks = 1 << puzzle.combos.length;
    for (var m = 0; m < masks; m++) {
      var list = packListFor(puzzle, m);
      if (!list) continue;
      var got = knapsack(list, puzzle.cap);
      if (got > best) best = got;
    }
    return Math.max(1, best);
  }

  /* --------------------------------------------------------- pack helpers */

  function byUid(puzzle, uid) {
    for (var i = 0; i < puzzle.items.length; i++) if (puzzle.items[i].uid === uid) return puzzle.items[i];
    return null;
  }

  function carried(puzzle) {
    var out = [];
    for (var i = 0; i < puzzle.pack.length; i++) {
      var it = byUid(puzzle, puzzle.pack[i]);
      if (it) out.push(it);
    }
    return out;
  }

  function loadOf(puzzle) {
    var w = 0, c = carried(puzzle);
    for (var i = 0; i < c.length; i++) w += c[i].w;
    return w;
  }

  function valueOf(puzzle) {
    var v = 0, c = carried(puzzle);
    for (var i = 0; i < c.length; i++) v += c[i].v;
    return v;
  }

  function inPack(puzzle, uid) { return puzzle.pack.indexOf(uid) >= 0; }

  /** Combos whose BOTH halves are currently shouldered — the discovery moment. */
  function readyCombos(puzzle) {
    var out = [], i;
    var have = {};
    var c = carried(puzzle);
    for (i = 0; i < c.length; i++) if (!c[i].combo) have[c[i].key] = c[i].uid;
    for (i = 0; i < puzzle.combos.length; i++) {
      var k = puzzle.combos[i];
      if (have[k.a] !== undefined && have[k.b] !== undefined) {
        out.push({ combo: k, a: have[k.a], b: have[k.b] });
      }
    }
    return out;
  }

  /* ================================================================ CSS == */

  var CSS = [
    '.pz-knap{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(260px,1fr);gap:18px;align-items:start}',
    '@media (max-width:880px){.pz-knap{grid-template-columns:1fr}}',

    '.pz-knap-grid{display:grid;gap:9px;grid-template-columns:repeat(auto-fill,minmax(168px,1fr))}',
    '.pz-knap-obj{display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;align-items:start;text-align:left;',
    '  padding:10px 11px;border-radius:10px;border:1px solid var(--line);color:var(--text);',
    '  background:linear-gradient(180deg,var(--panel-2),var(--panel));cursor:pointer;',
    '  transition:transform .16s var(--ease),border-color .16s var(--ease),opacity .16s var(--ease)}',
    '.pz-knap-obj:hover:not(:disabled){transform:translateY(-2px);border-color:var(--acc)}',
    '.pz-knap-obj:disabled{cursor:default;opacity:.34}',
    '.pz-knap-obj.is-packed{border-color:var(--acc);background:linear-gradient(180deg,var(--acc-wash),var(--panel))}',
    '.pz-knap-obj.is-combo{border-style:dashed;border-color:var(--acc-2)}',
    '.pz-knap-obj__i{font-size:22px;line-height:1.1}',
    '.pz-knap-obj__n{font-size:13px;font-weight:700;line-height:1.25}',
    '.pz-knap-obj__u{font-size:11px;color:var(--dim);line-height:1.45;margin-top:3px}',
    '.pz-knap-obj__m{display:flex;gap:9px;align-items:center;margin-top:5px;',
    '  font-family:var(--font-mono);font-size:11px;color:var(--text-2)}',

    '.pz-knap-pips{display:inline-flex;gap:2px}',
    '.pz-knap-pip{width:7px;height:7px;border-radius:50%;background:var(--line);display:inline-block}',
    '.pz-knap-pip.on{background:var(--acc-2);box-shadow:0 0 6px var(--acc-glow)}',

    '.pz-knap-scale{display:flex;flex-direction:column;gap:6px}',
    '.pz-knap-scale__t{display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:11px;color:var(--dim)}',
    '.pz-knap-scale__t b{color:var(--acc-2)}',
    '.pz-knap-bar{height:12px;border-radius:7px;background:#0a0d13;border:1px solid var(--line);overflow:hidden}',
    '.pz-knap-bar__f{height:100%;width:0%;border-radius:6px;background:linear-gradient(90deg,var(--acc),var(--acc-2));',
    '  transition:width .3s var(--ease)}',
    '.pz-knap-bar.is-full .pz-knap-bar__f{background:linear-gradient(90deg,#e6b455,#e2695f)}',

    '.pz-knap-pack{display:flex;flex-wrap:wrap;gap:6px;min-height:34px}',
    '.pz-knap-tag{display:inline-flex;gap:5px;align-items:center;padding:4px 8px;border-radius:999px;',
    '  border:1px solid var(--line);background:var(--panel-2);font-size:11px;color:var(--text-2)}',
    '.pz-knap-tag.is-combo{border-color:var(--acc-2);color:var(--acc-2)}',

    '.pz-knap-lash{display:flex;flex-direction:column;gap:8px}',
    '.pz-knap-lash__b{display:grid;grid-template-columns:auto minmax(0,1fr);gap:9px;align-items:center;text-align:left;',
    '  padding:9px 11px;border-radius:10px;color:var(--text);cursor:pointer;',
    '  border:1px dashed var(--acc);background:color-mix(in srgb,var(--acc) 12%,var(--panel));',
    '  animation:pzKnapNudge 2.6s var(--ease) infinite}',
    '.pz-knap-lash__b:hover{filter:brightness(1.12)}',
    '.pz-knap-lash__i{font-size:20px}',
    '.pz-knap-lash__t{font-size:12px;font-weight:700}',
    '.pz-knap-lash__d{font-size:11px;color:var(--dim);margin-top:2px;line-height:1.45}',
    '@keyframes pzKnapNudge{0%,100%{box-shadow:0 0 0 rgba(0,0,0,0)}50%{box-shadow:0 0 18px var(--acc-glow)}}',

    '.pz-knap-known{display:flex;flex-direction:column;gap:5px;font-size:11px;color:var(--dim);line-height:1.5}',
    '.pz-knap-known b{color:var(--acc-2);font-weight:600}',

    '.pz-knap-warn{font-size:12px;line-height:1.5;color:var(--bad);padding:8px 10px;border-radius:7px;',
    '  background:rgba(226,105,95,.08);border:1px solid rgba(226,105,95,.28)}'
  ].join('\n');

  /* ================================================================ MOUNT = */

  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var C = puzzle.content;
    var N = puzzle.names;
    var finished = false;

    var grid    = h('div', { class: 'pz-knap-grid' });
    var packBox = h('div', { class: 'pz-knap-pack' });
    var lashBox = h('div', { class: 'pz-knap-lash' });
    var knownBox = h('div', { class: 'pz-knap-known' });
    var warnBox = h('div', {});
    var barFill = h('div', { class: 'pz-knap-bar__f' });
    var bar     = h('div', { class: 'pz-knap-bar' }, [barFill]);
    var scaleTxt = h('div', { class: 'pz-knap-scale__t' });
    var actions = h('div', { class: 'pz-col' });

    function label(it) { return (N[it.key] && N[it.key].n) || PS.state.prettify(it.key); }
    function icon(it)  { return (N[it.key] && N[it.key].i) || '\uD83D\uDCE6'; }
    function useLine(it) { return PART_BY_KEY[it.key].use; }

    function pipRow(v) {
      var kids = [], on = pips(v);
      for (var i = 0; i < 5; i++) kids.push(h('span', { class: 'pz-knap-pip' + (i < on ? ' on' : '') }));
      return h('span', { class: 'pz-knap-pips' }, kids);
    }

    /* ------------------------------------------------------------- render */

    function paintGrid() {
      PS.ui.clear(grid);
      for (var i = 0; i < puzzle.items.length; i++) {
        (function (it) {
          var packed = inPack(puzzle, it.uid);
          var wouldFit = packed || (loadOf(puzzle) + it.w) <= puzzle.cap;
          var btn = h('button', {
            type: 'button',
            class: 'pz-knap-obj' + (packed ? ' is-packed' : '') + (it.combo ? ' is-combo' : ''),
            disabled: finished || (!packed && !wouldFit)
          }, [
            h('div', { class: 'pz-knap-obj__i', text: icon(it) }),
            h('div', {}, [
              h('div', { class: 'pz-knap-obj__n', text: label(it) }),
              h('div', { class: 'pz-knap-obj__u', text: useLine(it) }),
              h('div', { class: 'pz-knap-obj__m' }, [
                h('span', { text: it.w + ' kg' }),
                pipRow(it.v),
                packed ? h('span', { text: '\u2713 packed' }) : null
              ])
            ])
          ]);
          btn.addEventListener('click', function () { toggle(it.uid); });
          grid.appendChild(btn);
        })(puzzle.items[i]);
      }
    }

    function paintPack() {
      PS.ui.clear(packBox);
      var c = carried(puzzle);
      if (!c.length) {
        packBox.appendChild(h('span', { class: 'pz-note', text: 'Empty. You are going out of here with your hands.' }));
      }
      for (var i = 0; i < c.length; i++) {
        packBox.appendChild(h('span', { class: 'pz-knap-tag' + (c[i].combo ? ' is-combo' : '') }, [
          h('span', { text: icon(c[i]) }),
          h('span', { text: label(c[i]) })
        ]));
      }

      var load = loadOf(puzzle);
      barFill.style.width = Math.min(100, Math.round((load / puzzle.cap) * 100)) + '%';
      if (load >= puzzle.cap) bar.classList.add('is-full'); else bar.classList.remove('is-full');

      PS.ui.clear(scaleTxt);
      PS.ui.append(scaleTxt, [
        h('span', { text: 'Shouldered' }),
        h('b', { text: load + ' / ' + puzzle.cap + ' kg' })
      ]);

      PS.ui.clear(warnBox);
      if (!finished && load === 0) {
        warnBox.appendChild(h('div', { class: 'pz-knap-warn', text: 'Nothing in the pack. Whatever is behind you, you will meet it empty-handed.' }));
      } else if (!finished && puzzle.cap - load >= 4) {
        warnBox.appendChild(h('div', { class: 'pz-note', text: (puzzle.cap - load) + ' kg of back still going spare.' }));
      }
    }

    function paintLash() {
      PS.ui.clear(lashBox);
      if (finished) return;
      var ready = readyCombos(puzzle);
      for (var i = 0; i < ready.length; i++) {
        (function (r) {
          var c = r.combo;
          var an = (N[c.a] && N[c.a].n) || c.a;
          var bn = (N[c.b] && N[c.b].n) || c.b;
          var cn = (N[c.key] && N[c.key].n) || c.key;
          var saved = (PART_BY_KEY[c.a].w + PART_BY_KEY[c.b].w) - c.w;
          var btn = h('button', { type: 'button', class: 'pz-knap-lash__b' }, [
            h('div', { class: 'pz-knap-lash__i', text: (N[c.key] && N[c.key].i) || '\uD83D\uDD17' }),
            h('div', {}, [
              h('div', { class: 'pz-knap-lash__t', text: 'Lash the ' + an.toLowerCase() + ' to the ' + bn.toLowerCase() }),
              h('div', { class: 'pz-knap-lash__d', text: 'Makes a ' + cn.toLowerCase() + ' \u2014 ' + c.w + ' kg, ' + saved + ' kg lighter than the parts, worth far more.' })
            ])
          ]);
          btn.addEventListener('click', function () { lash(r); });
          lashBox.appendChild(btn);
        })(ready[i]);
      }
      // Anything already built can be pulled apart again — the pairs are a
      // discovery, not a trap.
      var c2 = carried(puzzle);
      for (var j = 0; j < c2.length; j++) {
        (function (it) {
          if (!it.combo) return;
          var btn = h('button', { type: 'button', class: 'pz-btn pz-btn--sm pz-btn--ghost' },
            ['\u2702 Take the ' + label(it).toLowerCase() + ' apart']);
          btn.addEventListener('click', function () { unlash(it); });
          lashBox.appendChild(btn);
        })(c2[j]);
      }
    }

    function paintKnown() {
      PS.ui.clear(knownBox);
      var any = false, i;
      for (i = 0; i < COMBOS.length; i++) {
        if (!puzzle.found[COMBOS[i].key]) continue;
        any = true;
        var c = COMBOS[i];
        knownBox.appendChild(h('div', {}, [
          ((N[c.a] && N[c.a].n) || c.a) + ' + ' + ((N[c.b] && N[c.b].n) || c.b) + ' = ',
          h('b', { text: (N[c.key] && N[c.key].n) || c.key })
        ]));
      }
      if (!any) {
        knownBox.appendChild(h('div', { text: 'Some of this was made to go together. You have not worked out what yet.' }));
      }
    }

    function paintAll() { paintGrid(); paintPack(); paintLash(); paintKnown(); }

    /* ------------------------------------------------------------ actions */

    function toggle(uid) {
      if (finished) return;
      var it = byUid(puzzle, uid);
      if (!it) return;
      var at = puzzle.pack.indexOf(uid);
      if (at >= 0) {
        puzzle.pack.splice(at, 1);
      } else {
        if (loadOf(puzzle) + it.w > puzzle.cap) { api.toast(C.overweight, 'bad', 1600); return; }
        puzzle.pack.push(uid);
      }
      paintAll();
    }

    function lash(r) {
      if (finished) return;
      var c = r.combo;
      var a = byUid(puzzle, r.a), b = byUid(puzzle, r.b);
      if (!a || !b) return;

      // Parts leave the world, the made thing enters it and goes straight on
      // your back. Weight always drops, so this can never overload you.
      dropItem(a); dropItem(b);
      var made = {
        uid: 'c' + (puzzle.made++) + '_' + c.key,
        key: c.key, w: c.w, v: c.v, item: c.item,
        combo: true, parts: [a.key, b.key]
      };
      puzzle.items.push(made);
      puzzle.pack.push(made.uid);

      if (!puzzle.found[c.key]) {
        puzzle.found[c.key] = true;
        api.tweak({ morale: 4 });
        api.flash();
      }
      api.toast(C.lash + ' ' + ((N[c.key] && N[c.key].n) || c.key) + '.', 'good');
      paintAll();
    }

    function unlash(it) {
      if (finished || !it.combo) return;
      dropItem(it);
      for (var i = 0; i < it.parts.length; i++) {
        var p = PART_BY_KEY[it.parts[i]];
        var back = {
          uid: 'r' + (puzzle.made++) + '_' + p.key,
          key: p.key, w: p.w, v: p.v, item: p.item, combo: false, parts: null
        };
        puzzle.items.push(back);
        if (loadOf(puzzle) + back.w <= puzzle.cap) puzzle.pack.push(back.uid);
      }
      paintAll();
    }

    function dropItem(it) {
      var at = puzzle.pack.indexOf(it.uid);
      if (at >= 0) puzzle.pack.splice(at, 1);
      var ix = puzzle.items.indexOf(it);
      if (ix >= 0) puzzle.items.splice(ix, 1);
    }

    /* ----------------------------------------------------------- the exit */

    function commit() {
      if (finished || puzzle.committed) return;
      puzzle.committed = true;
      paintAll();
      PS.ui.clear(actions);

      var val = valueOf(puzzle);
      var pct = Math.round((val / puzzle.optimal) * 100);

      PS.ui.append(actions, [
        h('div', { class: 'pz-intro', text: 'Pack is on. ' + loadOf(puzzle) + ' kg of the ' + puzzle.cap +
          ' you can carry, and about ' + pct + '% of the best load anyone could have made out of that pile.' }),
        h('div', { class: 'pz-choices' }, [
          choice('\uD83D\uDD26', 'One more sweep', C.sweepGood.replace(/\s+$/, '') +
            ' Costs you time and legs, and there is a reason nobody goes back.', 'scavenge'),
          choice('\uD83D\uDCA8', 'Out, now', C.leave + ' Nothing else. You keep what you have and your wind with it.', 'sprint')
        ])
      ]);
      api.flash();
    }

    function choice(ic, title, desc, id) {
      return h('button', { class: 'pz-choice', type: 'button', onclick: function () { finishRun(id); } }, [
        h('div', { class: 'pz-choice__i', text: ic }),
        h('div', { class: 'pz-choice__t', text: title }),
        h('div', { class: 'pz-choice__d', text: desc })
      ]);
    }

    function finishRun(mode) {
      if (finished) return;
      finished = true;

      var got = carried(puzzle);
      var gain = [], i;
      for (i = 0; i < got.length; i++) gain.push(got[i].item);

      var val = valueOf(puzzle);
      var extraLine = '';
      var hurt = 0;

      if (mode === 'scavenge') {
        // The best thing you walked past, and a real chance of paying for it.
        var left = puzzle.items.filter(function (it) { return !inPack(puzzle, it.uid); });
        left.sort(function (a, b) { return b.v - a.v; });
        if (left.length) {
          gain.push(left[0].item);
          val += Math.round(left[0].v * 0.6);
          extraLine = ' You went back for the ' + label(left[0]).toLowerCase() + '.';
        }
        if (api.rng.chance(0.45)) { hurt = 6 + puzzle.tier * 2; extraLine += ' ' + C.sweepBad; }
      }

      var ratio = val / puzzle.optimal;
      var outcome = ratio >= 0.85 ? 'success' : (ratio >= 0.5 ? 'partial' : 'fail');
      var comboCount = 0;
      for (i = 0; i < COMBOS.length; i++) if (puzzle.found[COMBOS[i].key]) comboCount++;

      var tags = ['has_pack'];
      if (comboCount) tags.push('field_rigged');
      if (!got.length) tags.push('travelling_light');
      if (mode === 'scavenge') tags.push('stripped_the_room');

      api.finish({
        outcome: outcome,
        stats: {
          energy: -(4 + Math.round(loadOf(puzzle) / 3) + (mode === 'scavenge' ? 8 : 0)),
          health: -hurt,
          morale: outcome === 'success' ? 8 : (outcome === 'partial' ? 2 : -6) + (mode === 'sprint' ? 3 : 0)
        },
        gain: gain.slice(0, 8),
        lose: [],
        tags: tags,
        signals: {
          scavenge: Math.min(5, 1 + got.length + (mode === 'scavenge' ? 2 : 0)),
          logic: Math.min(4, comboCount + (ratio >= 0.85 ? 1 : 0)),
          speed: mode === 'sprint' ? 2 : 0,
          caution: got.length && loadOf(puzzle) < puzzle.cap * 0.75 ? 1 : 0
        },
        choice: mode,
        summary: (got.length
          ? 'You came out carrying ' + got.length + ' thing' + (got.length === 1 ? '' : 's') +
            ' and ' + Math.round(ratio * 100) + '% of what that pile was worth'
          : 'You came out of there with nothing on your back') + '.' + extraLine
      });
    }

    function abandon() {
      if (finished) return;
      finished = true;
      api.finish({
        outcome: 'fail',
        stats: { energy: -6, morale: -8 },
        gain: [], lose: [], tags: ['left_it_all'],
        signals: { caution: 2, speed: 1 },
        choice: null,
        summary: 'You left the whole pile where it lay and went out with empty hands.'
      });
    }

    /* ------------------------------------------------------------- layout */

    PS.ui.append(actions, [
      h('button', { class: 'pz-btn pz-btn--primary', type: 'button', onclick: commit }, ['\uD83C\uDF92 Shoulder the pack']),
      h('button', { class: 'pz-btn pz-btn--danger pz-btn--sm', type: 'button', onclick: abandon }, ['\u21A9 Leave it all'])
    ]);

    PS.ui.append(el, h('div', { class: 'pz-knap' }, [
      h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-note' }, [
          'Click to pack and unpack. Everything you carry out ',
          h('strong', { text: 'stays with you' }), ' \u2014 this is the pack you have in the next room.'
        ]),
        grid
      ]),
      h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'What your back will take' }),
          h('div', { class: 'pz-knap-scale' }, [scaleTxt, bar]),
          packBox,
          warnBox
        ]),
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'Field rigging' }),
          lashBox,
          knownBox
        ]),
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'Go' }),
          actions
        ])
      ])
    ]));

    paintAll();
  }

  function unmount() {
    while (teardownFns.length) {
      try { teardownFns.pop()(); } catch (e) { /* keep unwinding */ }
    }
  }

  /* ================================================================ HINT = */

  function hint(puzzle, state, skin) {
    var C = CONTENT[skin && skin.id] || CONTENT.collapsed_store;
    var i;
    for (i = 0; i < puzzle.combos.length; i++) {
      var c = puzzle.combos[i];
      if (puzzle.found[c.key]) continue;
      return 'The ' + ((C.names[c.a] && C.names[c.a].n) || c.a).toLowerCase() + ' is half of something. Put it in the pack next to the ' +
        ((C.names[c.b] && C.names[c.b].n) || c.b).toLowerCase() + ' and look again.';
    }
    var val = valueOf(puzzle);
    if (val >= puzzle.optimal) return 'That is the best load in the room. Shoulder it and go.';
    var spare = puzzle.cap - loadOf(puzzle);
    if (spare >= 3) return 'You have ' + spare + ' kg spare and you are leaving worth on the floor.';
    return 'You are within ' + Math.max(1, puzzle.optimal - val) + ' of the best possible load. Swap weight for pips, not the other way round.';
  }

  /* ============================================================ AUTOSOLVE = */
  /* Headless: rebuilds the exact optimum with the same DP the scorer uses. */

  function autoSolve(puzzle, rng) {
    var best = null, bestVal = -1;
    var masks = 1 << puzzle.combos.length;
    for (var m = 0; m < masks; m++) {
      var picked = greedyExact(puzzle, m);
      if (picked && picked.value > bestVal) { bestVal = picked.value; best = picked; }
    }
    if (!best) best = { value: 0, items: [], weight: 0, combos: 0 };

    var gain = [];
    for (var i = 0; i < best.items.length && i < 8; i++) gain.push(best.items[i].item);
    var mode = rng.chance(0.4) ? 'scavenge' : 'sprint';

    return {
      outcome: bestVal >= puzzle.optimal * 0.85 ? 'success' : 'partial',
      stats: {
        energy: -(4 + Math.round(best.weight / 3) + (mode === 'scavenge' ? 8 : 0)),
        morale: 6
      },
      gain: gain,
      lose: [],
      tags: ['has_pack'].concat(best.combos ? ['field_rigged'] : []),
      signals: { scavenge: Math.min(5, 1 + gain.length), logic: Math.min(4, best.combos + 1), speed: mode === 'sprint' ? 2 : 0 },
      choice: mode,
      summary: 'Packed ' + gain.length + ' thing' + (gain.length === 1 ? '' : 's') + ' at ' + best.weight + ' kg and walked.'
    };
  }

  /** DP with reconstruction, for one fixed choice of which combos to build. */
  function greedyExact(puzzle, comboMask) {
    var used = {}, list = [], i, c;
    for (i = 0; i < puzzle.combos.length; i++) {
      if (!(comboMask & (1 << i))) continue;
      c = puzzle.combos[i];
      var ua = findFree(puzzle.items, c.a, used);
      var ub = findFree(puzzle.items, c.b, used);
      if (ua === null || ub === null) return null;
      used[ua] = true; used[ub] = true;
      list.push({ w: c.w, v: c.v, item: c.item, combo: true });
    }
    for (i = 0; i < puzzle.items.length; i++) {
      if (used[puzzle.items[i].uid]) continue;
      list.push({ w: puzzle.items[i].w, v: puzzle.items[i].v, item: puzzle.items[i].item, combo: false });
    }

    var cap = puzzle.cap;
    var dp = [], keep = [], w;
    for (w = 0; w <= cap; w++) { dp.push(0); keep.push([]); }
    for (i = 0; i < list.length; i++) {
      for (w = cap; w >= list[i].w; w--) {
        var alt = dp[w - list[i].w] + list[i].v;
        if (alt > dp[w]) { dp[w] = alt; keep[w] = keep[w - list[i].w].concat([i]); }
      }
    }
    var chosen = keep[cap], items = [], weight = 0, combos = 0;
    for (i = 0; i < chosen.length; i++) {
      items.push(list[chosen[i]]);
      weight += list[chosen[i]].w;
      if (list[chosen[i]].combo) combos++;
    }
    return { value: dp[cap], items: items, weight: weight, combos: combos };
  }

  /* ============================================================ REGISTER = */

  PS.registry.register({
    id: 'knapsack',
    name: 'Knapsack',
    icon: '\uD83C\uDF92',
    blurb: 'One back, a hard limit, and two things in the pile that want to be one thing.',

    favors:   { scavenge: 3, logic: 1 },
    provides: ['load_out', 'supplies'],
    tagHooks: ['has_pack'],
    requires: function (state) { return state.stats.energy > 8; },

    css: CSS,

    skins: [
      {
        id: 'collapsed_store', biome: 'underground', title: 'The Collapsed Store',
        icon: '\uD83C\uDFEC', palette: 'amber',
        intro: 'The floor above came down across aisle four and took the daylight with it. Everything still on the shelves is yours, which is a generous way of saying nobody else is coming. You have one back and about nine metres of standing roof.',
        nouns: { pile: 'the shelves', pack: 'your pack', carrier: 'your back', place: 'the store' }
      },
      {
        id: 'evac_backpack', biome: 'urban', title: 'Evacuation Pack',
        icon: '\uD83C\uDF92', palette: 'steel',
        intro: 'Sirens have been going for nine minutes and the corridor smells like a car park on fire. Everything you own is on the kitchen table and the lift is not an option. Pack for nine flights of stairs and whatever is at the bottom of them.',
        nouns: { pile: 'the table', pack: 'the rucksack', carrier: 'your back', place: 'the flat' }
      },
      {
        id: 'lifeboat_locker', biome: 'water', title: 'Lifeboat Locker',
        icon: '\uD83D\uDEDF', palette: 'ice',
        intro: 'She is down by the head and the list is getting harder to stand on. The locker is open, the boat is swung out, and the boat has a limit that the sea enforces personally. Take what floats you and leave the rest to go down with her.',
        nouns: { pile: 'the locker', pack: 'the boat', carrier: 'the boat', place: 'the ship' }
      }
    ],

    build: build,
    mount: mount,
    unmount: unmount,
    hint: hint,
    autoSolve: autoSolve
  });

})(typeof window !== 'undefined' ? window : this);
