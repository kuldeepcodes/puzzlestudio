/* ==========================================================================
   PuzzleStudio — js/games/e07_balance_scales.js     ENGINE 07 · Balance Scales
   --------------------------------------------------------------------------
   Self-contained: logic + 3 skins + its own CSS. No DOM access until mount().

   THE PUZZLE
     A two-pan balance and a batch of identical-looking things. Exactly one of
     them is off-weight. You have a hard budget of weighings — never enough to
     brute force it — and the balance only ever answers with three words:
     left, right, or nothing.

     Low tiers tell you whether the bad one is heavy or light. From tier 3 on
     they do not, which doubles the hypothesis space and turns a comfortable
     three-weighing problem into the classic hard version.

     You may name your suspect at any moment. Being wrong hurts, twice.

   THE BRANCH
     Finding the bad one is not the end. You are standing over a batch you now
     trust, and what you do with it is what the Director reads next.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio;
  if (!PS || !PS.registry) { if (root.console) console.error('[e07] core not loaded'); return; }

  /* ======================================================== SKIN CONTENT == */

  var CONTENT = {
    contaminated_canisters: {
      unit: 'canister', units: 'canisters', itemIcon: '\uD83E\uDEA3', prefix: 'C',
      lineHeavy: 'Silt settles heavier than water. The bad one will sit low.',
      lineLight: 'Whatever ate the seal took volume with it. The bad one will ride high.',
      lineBlind: 'Nobody knows which way it went wrong. It could be swollen or it could be half empty.',
      rig: 'field balance',
      rigLine: 'A stick, a length of cord and two mess tins. It is not a laboratory, but it does not lie.',
      good: 'water',
      goodGain: ['water', 'water'],
      caughtIt: 'You set it aside in the moss, cap down, and do not think about it again.',
      wrongIt: 'You drink from the wrong one. It goes down warm and wrong and you know immediately.',
      branchA: { id: 'forage', icon: '\uD83C\uDF3F', title: 'Refill from the runoff', desc: 'You have clean containers now and the meltwater is running hard an hour downhill.' },
      branchB: { id: 'shelter', icon: '\u26FA', title: 'Camp early and boil the lot', desc: 'Lose the afternoon, gain a batch you would hand to a child.' }
    },
    counterfeit_tokens: {
      unit: 'token', units: 'tokens', itemIcon: '\uD83E\uDE99', prefix: 'T',
      lineHeavy: 'Whoever pressed the fake used the wrong alloy. It will run heavy.',
      lineLight: 'The fake is struck on a thinner blank. It will run light.',
      lineBlind: 'The forger is good. It could be over or under and nobody will tell you which.',
      rig: 'jeweller\u2019s balance',
      rigLine: 'Brass arms, agate bearing, still true after everything. The one honest thing on this street.',
      good: 'fare',
      goodGain: ['coin', 'coin'],
      caughtIt: 'You bite it, and the bite tells you the same thing the balance did.',
      wrongIt: 'You hand over the bad one. The teller does not even look up before calling someone.',
      branchA: { id: 'trade', icon: '\uD83E\uDD1D', title: 'Take the good ones to the row', desc: 'Somebody down there sells respirator filters and does not ask questions.' },
      branchB: { id: 'signal', icon: '\uD83D\uDCE3', title: 'Name the forger', desc: 'It buys you nothing you can eat. It might buy you someone who owes you.' }
    },
    oxygen_cylinders: {
      unit: 'cylinder', units: 'cylinders', itemIcon: '\uD83E\uDDEF', prefix: 'O',
      lineHeavy: 'The faulty bottle never vented. It is still carrying its full charge and then some.',
      lineLight: 'One of them has been bleeding off all week. It will come up short.',
      lineBlind: 'Overcharged or empty, the gauge on all of them reads the same lie.',
      rig: 'load beam',
      rigLine: 'A calibration beam bolted to the rack wall, meant for exactly this and used for it maybe twice a year.',
      good: 'air',
      goodGain: ['canister', 'mask'],
      caughtIt: 'You chalk a cross on the collar and roll it away from the others.',
      wrongIt: 'You clip on the bad bottle. Four breaths in, the world starts to grey at the edges.',
      branchA: { id: 'descend', icon: '\uD83D\uDD73\uFE0F', title: 'Take the good bottles down', desc: 'The lower level is where the air stopped being air. Now you can go there.' },
      branchB: { id: 'force_door', icon: '\uD83D\uDD28', title: 'Vent the bad one at the bulkhead', desc: 'A controlled scream of gas against a door that has not moved in years.' }
    }
  };

  /* ==============================================================  BUILD == */
  /* n items, w weighings, and whether the direction of the fault is stated.
     Every row is information-theoretically solvable: 3^w >= n (known) or
     3^w >= 2n (blind). 12-in-3 blind and 30-in-4 blind are the tight ones. */

  var TIERS = [
    { n: 8,  w: 3, known: true  },
    { n: 12, w: 3, known: true  },
    { n: 12, w: 3, known: false },
    { n: 18, w: 4, known: false },
    { n: 27, w: 4, known: false },
    { n: 30, w: 4, known: false }
  ];

  function pad2(n) { return n < 10 ? '0' + n : String(n); }

  function build(state, rng, tier, skin) {
    var C = CONTENT[skin.id] || CONTENT.contaminated_canisters;
    var t = Math.min(TIERS.length, Math.max(1, tier));
    var spec = TIERS[t - 1];

    var codes = [];
    for (var i = 0; i < spec.n; i++) codes.push(C.prefix + pad2(i + 1));

    // Shuffle which physical slot holds the bad one so the code on the chip
    // carries no information — the player is reading the balance, not the label.
    var odd = rng.int(0, spec.n - 1);
    var heavy = rng.chance(0.5);

    return {
      n: spec.n,
      budget: spec.w,
      known: spec.known,
      odd: odd,
      heavy: heavy,
      codes: codes,
      log: [],                 // [{ left:[i], right:[i], result:'left'|'right'|'even' }]
      left: [],
      right: [],
      wrongGuesses: 0,
      maxWrong: 2,
      solved: false,
      declaredDir: null,
      tier: t,
      content: C
    };
  }

  /* ------------------------------------------------------- balance maths -- */

  /** The physical answer for a proposed weighing. Pans are always equal size. */
  function resultOf(oddIdx, oddHeavy, left, right) {
    var lw = left.length, rw = right.length;
    if (left.indexOf(oddIdx) >= 0)  lw += oddHeavy ? 1 : -1;
    if (right.indexOf(oddIdx) >= 0) rw += oddHeavy ? 1 : -1;
    return lw > rw ? 'left' : (lw < rw ? 'right' : 'even');
  }

  /** Is the hypothesis "item i is odd, and it is heavy/light" still alive? */
  function consistent(puzzle, i, isHeavy) {
    for (var k = 0; k < puzzle.log.length; k++) {
      var w = puzzle.log[k];
      if (resultOf(i, isHeavy, w.left, w.right) !== w.result) return false;
    }
    return true;
  }

  /** Every hypothesis still standing after the weighings so far. */
  function candidates(puzzle) {
    var out = [];
    for (var i = 0; i < puzzle.n; i++) {
      if (puzzle.known) {
        if (consistent(puzzle, i, puzzle.heavy)) out.push({ i: i, heavy: puzzle.heavy });
      } else {
        if (consistent(puzzle, i, true))  out.push({ i: i, heavy: true });
        if (consistent(puzzle, i, false)) out.push({ i: i, heavy: false });
      }
    }
    return out;
  }

  /** Distinct items still under suspicion (a blind run can suspect one twice). */
  function suspectItems(puzzle) {
    var seen = {}, out = [], c = candidates(puzzle);
    for (var k = 0; k < c.length; k++) {
      if (seen[c[k].i]) continue;
      seen[c[k].i] = true;
      out.push(c[k].i);
    }
    return out;
  }

  /** Fewest weighings that could ever separate this many hypotheses. */
  function optimalWeighings(puzzle) {
    var space = puzzle.known ? puzzle.n : puzzle.n * 2;
    var w = 1;
    while (Math.pow(3, w) < space) w++;
    return w;
  }

  /* ================================================================ CSS == */

  var CSS = [
    '.pz-scale{display:grid;grid-template-columns:minmax(0,1fr) minmax(238px,308px);gap:18px;align-items:start}',
    '@media (max-width:860px){.pz-scale{grid-template-columns:1fr}}',

    '.pz-scale-rig{position:relative;padding:14px 12px 16px;border-radius:14px;',
    '  background:linear-gradient(180deg,#0a0e14,#070a0f);border:1px solid var(--line);box-shadow:var(--sh-1)}',
    '.pz-scale-beam{position:relative;height:6px;margin:6px 34px 0;border-radius:4px;',
    '  background:linear-gradient(90deg,var(--line),var(--panel-3),var(--line));',
    '  transform-origin:50% 50%;transition:transform .5s var(--ease)}',
    '.pz-scale-beam::after{content:"";position:absolute;left:50%;top:-9px;width:12px;height:12px;',
    '  margin-left:-6px;border-radius:50%;background:var(--acc);box-shadow:0 0 14px var(--acc-glow)}',
    '.pz-scale-rig.is-left .pz-scale-beam{transform:rotate(-4.5deg)}',
    '.pz-scale-rig.is-right .pz-scale-beam{transform:rotate(4.5deg)}',

    '.pz-scale-pans{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:12px}',
    '.pz-scale-pan{min-height:104px;padding:9px;border-radius:11px;background:#0c1119;',
    '  border:1px dashed var(--line);display:flex;flex-wrap:wrap;gap:5px;align-content:flex-start;',
    '  transition:transform .5s var(--ease),border-color .25s var(--ease),background .25s var(--ease)}',
    '.pz-scale-pan.is-over{border-color:var(--acc);background:var(--acc-wash)}',
    '.pz-scale-rig.is-left .pz-scale-pan--l{transform:translateY(9px)}',
    '.pz-scale-rig.is-left .pz-scale-pan--r{transform:translateY(-9px)}',
    '.pz-scale-rig.is-right .pz-scale-pan--l{transform:translateY(-9px)}',
    '.pz-scale-rig.is-right .pz-scale-pan--r{transform:translateY(9px)}',
    '.pz-scale-pan__lab{width:100%;font-family:var(--font-mono);font-size:10px;letter-spacing:.16em;',
    '  text-transform:uppercase;color:var(--dimmer);margin-bottom:2px}',

    '.pz-scale-tray{display:flex;flex-wrap:wrap;gap:5px;padding:10px;border-radius:11px;',
    '  background:#080b11;border:1px solid var(--line-soft);min-height:60px}',

    '.pz-scale-chip{display:inline-flex;align-items:center;gap:4px;padding:5px 8px;border-radius:8px;',
    '  font-family:var(--font-mono);font-size:11px;line-height:1;color:var(--text-2);cursor:pointer;',
    '  background:linear-gradient(180deg,var(--panel-3),var(--panel-2));border:1px solid var(--line);',
    '  transition:transform .16s var(--ease),border-color .16s var(--ease),opacity .2s var(--ease)}',
    '.pz-scale-chip:hover{transform:translateY(-2px);border-color:var(--acc);color:var(--text)}',
    '.pz-scale-chip.is-cleared{opacity:.34}',
    '.pz-scale-chip.is-suspect{border-color:color-mix(in srgb,var(--acc) 60%,transparent)}',
    '.pz-scale-chip.is-named{border-color:var(--bad);background:rgba(226,105,95,.16);color:#ffd9d5}',
    '.pz-scale-chip.is-dead{opacity:.28;cursor:default;text-decoration:line-through}',
    '.pz-scale-chip.is-dead:hover{transform:none;border-color:var(--line);color:var(--text-2)}',
    '.pz-scale.is-declaring .pz-scale-chip{border-color:rgba(226,105,95,.4)}',

    '.pz-scale-verdict{margin-top:11px;text-align:center;font-family:var(--font-mono);font-size:12px;',
    '  letter-spacing:.1em;text-transform:uppercase;color:var(--dim);min-height:16px}',
    '.pz-scale-verdict b{color:var(--acc-2)}',

    '.pz-scale-log{display:flex;flex-direction:column;gap:5px;max-height:214px;overflow:auto}',
    '.pz-scale-log__row{display:flex;gap:8px;align-items:baseline;font-family:var(--font-mono);',
    '  font-size:10.5px;color:var(--dim);padding:5px 7px;border-radius:6px;background:#0a0e15}',
    '.pz-scale-log__n{color:var(--dimmer)}',
    '.pz-scale-log__r{margin-left:auto;color:var(--acc-2);white-space:nowrap}',
    '.pz-scale-log__empty{font-size:12px;color:var(--dimmer);line-height:1.5}',

    '.pz-scale-meter{display:flex;flex-direction:column;gap:6px}',
    '.pz-scale-meter__row{display:flex;justify-content:space-between;font-family:var(--font-mono);',
    '  font-size:11px;color:var(--dim)}',
    '.pz-scale-meter__row b{color:var(--acc-2)}',
    '.pz-scale-meter__row.is-hot b{color:var(--bad)}',

    '.pz-scale-warn{font-size:12px;line-height:1.5;color:var(--bad);padding:9px 11px;border-radius:7px;',
    '  background:rgba(226,105,95,.08);border:1px solid rgba(226,105,95,.28)}',

    '.pz-scale-tip{animation:pzScaleTip .55s var(--ease)}',
    '@keyframes pzScaleTip{0%{filter:brightness(1)}35%{filter:brightness(1.5)}100%{filter:brightness(1)}}'
  ].join('\n');

  /* ================================================================ MOUNT = */

  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var C = puzzle.content;
    var finished = false;
    var declaring = false;
    var named = null;              // index the player is pointing at, pre-commit

    var rig = h('div', { class: 'pz-scale-rig' });
    var panL = h('div', { class: 'pz-scale-pan pz-scale-pan--l' });
    var panR = h('div', { class: 'pz-scale-pan pz-scale-pan--r' });
    var tray = h('div', { class: 'pz-scale-tray' });
    var verdict = h('div', { class: 'pz-scale-verdict' });
    var logBox = h('div', { class: 'pz-scale-log' });
    var meter = h('div', { class: 'pz-scale-meter' });
    var warnBox = h('div', {});
    var declareBox = h('div', { class: 'pz-col' });
    var shell = h('div', { class: 'pz-scale' });

    var weighBtn = h('button', { class: 'pz-btn pz-btn--primary', type: 'button', text: '\u2696\uFE0F Weigh' });
    var clearBtn = h('button', { class: 'pz-btn pz-btn--sm', type: 'button', text: '\u21BA Clear pans' });
    var declareBtn = h('button', { class: 'pz-btn pz-btn--sm', type: 'button', text: '\uD83D\uDC46 Name one' });
    var walkBtn = h('button', { class: 'pz-btn pz-btn--danger pz-btn--sm', type: 'button', text: '\u21A9 Take the batch untested' });

    /* --------------------------------------------------------- pan moving -- */

    function where(i) {
      if (puzzle.left.indexOf(i) >= 0) return 'left';
      if (puzzle.right.indexOf(i) >= 0) return 'right';
      return 'tray';
    }

    function drop(arr, i) { var k = arr.indexOf(i); if (k >= 0) arr.splice(k, 1); }

    function cycle(i) {
      if (finished) return;
      if (declaring) { named = (named === i ? null : i); paint(); return; }
      var w = where(i);
      drop(puzzle.left, i); drop(puzzle.right, i);
      if (w === 'tray') puzzle.left.push(i);
      else if (w === 'left') puzzle.right.push(i);
      paint();
    }

    /* -------------------------------------------------------------- paint -- */

    function chip(i, cls) {
      var alive = suspects.indexOf(i) >= 0;
      var c = 'pz-scale-chip' + (cls ? ' ' + cls : '');
      if (!alive) c += ' is-dead';
      else if (suspects.length > 1 && suspects.length <= 3) c += ' is-suspect';
      if (named === i) c += ' is-named';
      var b = h('button', { class: c, type: 'button' }, [
        h('span', { text: C.itemIcon }),
        h('span', { text: puzzle.codes[i] })
      ]);
      b.addEventListener('click', function () { cycle(i); });
      return b;
    }

    var suspects = [];

    function paint() {
      suspects = suspectItems(puzzle);

      PS.ui.clear(panL); PS.ui.clear(panR); PS.ui.clear(tray);
      panL.appendChild(h('div', { class: 'pz-scale-pan__lab', text: 'Left pan \u00B7 ' + puzzle.left.length }));
      panR.appendChild(h('div', { class: 'pz-scale-pan__lab', text: 'Right pan \u00B7 ' + puzzle.right.length }));

      var i;
      for (i = 0; i < puzzle.left.length; i++) panL.appendChild(chip(puzzle.left[i]));
      for (i = 0; i < puzzle.right.length; i++) panR.appendChild(chip(puzzle.right[i]));
      for (i = 0; i < puzzle.n; i++) if (where(i) === 'tray') tray.appendChild(chip(i));

      panL.className = 'pz-scale-pan pz-scale-pan--l' + (puzzle.left.length ? ' is-over' : '');
      panR.className = 'pz-scale-pan pz-scale-pan--r' + (puzzle.right.length ? ' is-over' : '');
      shell.className = 'pz-scale' + (declaring ? ' is-declaring' : '');

      var balanced = puzzle.left.length === puzzle.right.length && puzzle.left.length > 0;
      weighBtn.disabled = finished || declaring || !balanced || puzzle.log.length >= puzzle.budget;

      paintMeter();
      paintLog();
      paintDeclare();
    }

    function paintMeter() {
      PS.ui.clear(meter);
      var left = puzzle.budget - puzzle.log.length;
      PS.ui.append(meter, [
        row('Batch', puzzle.n + ' ' + C.units),
        row('Weighings left', left + ' of ' + puzzle.budget, left <= 1),
        row('Fault direction', puzzle.known ? (puzzle.heavy ? 'runs heavy' : 'runs light') : 'unstated', !puzzle.known),
        row('Still suspect', suspects.length + ' of ' + puzzle.n),
        row('Bad calls', puzzle.wrongGuesses + ' of ' + puzzle.maxWrong, puzzle.wrongGuesses > 0)
      ]);

      PS.ui.clear(warnBox);
      if (puzzle.wrongGuesses >= puzzle.maxWrong - 1 && puzzle.wrongGuesses > 0) {
        warnBox.appendChild(h('div', { class: 'pz-scale-warn' },
          ['One more wrong call and you walk out of here carrying whatever you happen to be holding.']));
      } else if (left === 0 && !finished) {
        warnBox.appendChild(h('div', { class: 'pz-scale-warn' },
          ['The balance has nothing left to tell you. Whatever you know now is all you get.']));
      }

      function row(k, v, hot) {
        return h('div', { class: 'pz-scale-meter__row' + (hot ? ' is-hot' : '') },
          [h('span', { text: k }), h('b', { text: v })]);
      }
    }

    function sideWord(r) {
      if (r === 'even') return 'level';
      return r === 'left' ? 'left drops' : 'right drops';
    }

    function paintLog() {
      PS.ui.clear(logBox);
      if (!puzzle.log.length) {
        logBox.appendChild(h('div', { class: 'pz-scale-log__empty', text: C.rigLine }));
        return;
      }
      for (var k = 0; k < puzzle.log.length; k++) {
        var w = puzzle.log[k];
        logBox.appendChild(h('div', { class: 'pz-scale-log__row' }, [
          h('span', { class: 'pz-scale-log__n', text: '#' + (k + 1) }),
          h('span', { text: codeList(w.left) + '  v  ' + codeList(w.right) }),
          h('span', { class: 'pz-scale-log__r', text: sideWord(w.result) })
        ]));
      }
    }

    function codeList(arr) {
      var out = [];
      for (var i = 0; i < arr.length; i++) out.push(puzzle.codes[arr[i]]);
      return out.join(' ');
    }

    function paintDeclare() {
      PS.ui.clear(declareBox);
      declareBtn.textContent = declaring ? '\u2716 Back to weighing' : '\uD83D\uDC46 Name one';
      if (!declaring || finished) return;

      if (named === null) {
        declareBox.appendChild(h('div', { class: 'pz-note', text:
          'Pick the ' + C.unit + ' you believe is the bad one. Anything the balance has already cleared is struck out.' }));
        return;
      }

      declareBox.appendChild(h('div', { class: 'pz-note' }, [
        'You are pointing at ', h('strong', { text: puzzle.codes[named] }), '. '
      ]));

      if (puzzle.known) {
        declareBox.appendChild(btn('That is the one', function () { commit(named, puzzle.heavy); }));
      } else {
        declareBox.appendChild(h('div', { class: 'pz-row' }, [
          btn('\u2B07 It runs heavy', function () { commit(named, true); }),
          btn('\u2B06 It runs light', function () { commit(named, false); })
        ]));
      }

      function btn(label, fn) {
        var b = h('button', { class: 'pz-btn pz-btn--primary pz-btn--sm', type: 'button', text: label });
        b.addEventListener('click', fn);
        return b;
      }
    }

    /* ------------------------------------------------------------ weighing */

    function doWeigh() {
      if (finished || declaring) return;
      if (puzzle.log.length >= puzzle.budget) { api.toast('No weighings left.', 'bad'); return; }
      if (!puzzle.left.length || puzzle.left.length !== puzzle.right.length) {
        api.toast('Equal counts on both pans, or the beam tells you nothing you did not already know.', 'bad', 3600);
        return;
      }

      var r = resultOf(puzzle.odd, puzzle.heavy, puzzle.left, puzzle.right);
      puzzle.log.push({ left: puzzle.left.slice(), right: puzzle.right.slice(), result: r });

      rig.className = 'pz-scale-rig is-' + (r === 'even' ? 'even' : r);
      rig.classList.remove('pz-scale-tip'); void rig.offsetWidth; rig.classList.add('pz-scale-tip');
      verdict.textContent = '';
      verdict.appendChild(h('span', { text: 'Beam \u2014 ' }));
      verdict.appendChild(h('b', { text: sideWord(r) }));

      api.tweak({ energy: -2 });
      puzzle.left = []; puzzle.right = [];
      paint();

      if (suspects.length === 1 && puzzle.log.length < puzzle.budget) {
        api.toast('Only one candidate is left standing.', 'info', 3200);
      }
    }

    /* ---------------------------------------------------------- declaring -- */

    function commit(i, isHeavy) {
      if (finished) return;
      var right = (i === puzzle.odd) && (isHeavy === puzzle.heavy);

      if (right) {
        puzzle.solved = true;
        puzzle.declaredDir = isHeavy;
        finished = true;
        renderWin();
        return;
      }

      puzzle.wrongGuesses++;
      named = null;
      api.tweak({ health: -(5 + puzzle.tier * 2), morale: -6, energy: -3 });
      api.toast(C.wrongIt, 'bad', 4200);

      if (puzzle.wrongGuesses >= puzzle.maxWrong) { finished = true; renderLoss(); return; }
      declaring = false;
      paint();
    }

    /* ------------------------------------------------------------ endings -- */

    function renderWin() {
      declaring = false;
      paint();
      PS.ui.clear(declareBox);
      var used = puzzle.log.length;
      var clean = puzzle.wrongGuesses === 0;
      var tight = clean && used <= optimalWeighings(puzzle);

      PS.ui.append(declareBox, [
        h('div', { class: 'pz-intro', text:
          puzzle.codes[puzzle.odd] + ' was the bad one, and it ran ' + (puzzle.heavy ? 'heavy' : 'light') + '. ' +
          C.caughtIt + ' ' + used + ' weighing' + (used === 1 ? '' : 's') + ' of ' + puzzle.budget + '.' }),
        h('div', { class: 'pz-choices' }, [
          branchBtn(C.branchA, tight),
          branchBtn(C.branchB, tight)
        ])
      ]);
      api.flash();
    }

    function branchBtn(spec, tight) {
      var b = h('button', { class: 'pz-choice', type: 'button' }, [
        h('div', { class: 'pz-choice__i', text: spec.icon }),
        h('div', { class: 'pz-choice__t', text: spec.title }),
        h('div', { class: 'pz-choice__d', text: spec.desc })
      ]);
      b.addEventListener('click', function () { finishWin(spec.id, tight); });
      return b;
    }

    function finishWin(choice, tight) {
      var clean = puzzle.wrongGuesses === 0;
      api.finish({
        outcome: clean ? 'success' : 'partial',
        stats: clean ? { morale: 9, energy: -3 } : { morale: 2, energy: -5 },
        gain: clean ? C.goodGain.slice() : C.goodGain.slice(0, 1),
        lose: [],
        tags: ['weighed_it_out'].concat(tight ? ['read_the_beam'] : []).concat(puzzle.known ? [] : ['solved_blind']),
        signals: {
          logic: clean ? (puzzle.known ? 3 : 4) : 2,
          caution: clean ? 2 : 1,
          speed: puzzle.log.length < puzzle.budget ? 1 : 0,
          scavenge: 1
        },
        choice: choice,
        summary: 'You found the bad ' + C.unit + ' in ' + puzzle.log.length + ' weighing' +
          (puzzle.log.length === 1 ? '' : 's') + (clean ? ' without a single bad call.' : ', but not before getting it wrong.')
      });
    }

    function renderLoss() {
      declaring = false;
      paint();
      PS.ui.clear(declareBox);
      var go = h('button', { class: 'pz-btn pz-btn--danger', type: 'button', text: '\u2192 Carry on anyway' });
      go.addEventListener('click', function () {
        api.finish({
          outcome: 'fail',
          stats: { health: -4, morale: -10, energy: -6 },
          gain: [], lose: [],
          tags: ['took_a_bad_batch'],
          signals: { logic: 1, brute: 1 },
          choice: null,
          summary: 'You called it wrong twice and paid for both.'
        });
      });
      PS.ui.append(declareBox, [
        h('div', { class: 'pz-intro', text:
          'It was ' + puzzle.codes[puzzle.odd] + ', and it ran ' + (puzzle.heavy ? 'heavy' : 'light') + '. ' +
          'You know that now because of what it did to you, not because of the beam.' }),
        go
      ]);
    }

    function walkAway() {
      if (finished) return;
      finished = true;
      var lucky = suspects.length <= 2 ? 1 : 0;
      api.finish({
        outcome: 'partial',
        stats: { health: -(2 + puzzle.tier), morale: -6, energy: -2 },
        gain: C.goodGain.slice(0, 1),
        lose: [],
        tags: ['took_a_bad_batch'],
        signals: { speed: 2, scavenge: 2, caution: lucky },
        choice: null,
        summary: 'You took the whole batch untested and carried the bad ' + C.unit + ' out with the rest.'
      });
    }

    /* ------------------------------------------------------------- layout -- */

    weighBtn.addEventListener('click', doWeigh);
    clearBtn.addEventListener('click', function () {
      if (finished) return;
      puzzle.left = []; puzzle.right = []; paint();
    });
    declareBtn.addEventListener('click', function () {
      if (finished) return;
      declaring = !declaring;
      if (!declaring) named = null;
      paint();
    });
    walkBtn.addEventListener('click', walkAway);

    PS.ui.append(rig, [
      h('div', { class: 'pz-scale-beam' }),
      h('div', { class: 'pz-scale-pans' }, [panL, panR]),
      verdict
    ]);

    PS.ui.append(shell, [
      h('div', { class: 'pz-col' }, [
        rig,
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'The batch' }),
          tray
        ]),
        h('div', { class: 'pz-note' }, [
          'Click a ', C.unit, ' to send it left, again for right, again to put it back. ',
          h('strong', { text: 'Both pans must hold the same number' }),
          ' \u2014 an uneven beam proves nothing.'
        ]),
        h('div', { class: 'pz-row' }, [weighBtn, clearBtn, declareBtn])
      ]),
      h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'The ' + C.rig }),
          meter
        ]),
        warnBox,
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'Weighings' }),
          logBox
        ]),
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'Call it' }),
          declareBox
        ]),
        walkBtn
      ])
    ]);

    PS.ui.append(el, shell);

    verdict.textContent = puzzle.known ? (puzzle.heavy ? C.lineHeavy : C.lineLight) : C.lineBlind;
    paint();
  }

  function unmount() {
    while (teardownFns.length) {
      try { teardownFns.pop()(); } catch (e) { /* keep unwinding */ }
    }
  }

  /* ================================================================ HINT = */

  function hint(puzzle) {
    var C = puzzle.content;
    var cands = candidates(puzzle);
    var items = suspectItems(puzzle);
    var left = puzzle.budget - puzzle.log.length;

    if (cands.length === 1) {
      return 'Nothing else survives the weighings you already have: it is ' +
        puzzle.codes[cands[0].i] + ', running ' + (cands[0].heavy ? 'heavy' : 'light') + '. Name it.';
    }
    if (left <= 0) {
      return items.length + ' ' + C.units + ' are still possible and the beam is spent. Pick the one you would bet on.';
    }
    // Optimal play splits the surviving hypotheses into three near-equal groups.
    var perPan = Math.max(1, Math.round(items.length / 3));
    return cands.length + ' possibilities are still alive across ' + items.length + ' ' + C.units +
      '. With ' + left + ' weighing' + (left === 1 ? '' : 's') + ' left you want to cut that by a third each time: ' +
      'put ' + perPan + ' suspect' + (perPan === 1 ? '' : 's') + ' on each pan and leave the rest off the beam.';
  }

  /* ============================================================ AUTOSOLVE = */
  /* Headless. Plays the information-optimal number of weighings and names it. */

  function autoSolve(puzzle, rng) {
    var C = puzzle.content;
    var need = optimalWeighings(puzzle);
    var used = Math.min(puzzle.budget, need);
    var clean = need <= puzzle.budget;
    var choice = rng.chance(0.5) ? C.branchA.id : C.branchB.id;

    return {
      outcome: clean ? 'success' : 'partial',
      stats: { morale: clean ? 9 : 2, energy: -(2 * used + 3) },
      gain: clean ? C.goodGain.slice() : C.goodGain.slice(0, 1),
      lose: [],
      tags: ['weighed_it_out'].concat(puzzle.known ? [] : ['solved_blind']),
      signals: { logic: puzzle.known ? 3 : 4, caution: 2, speed: 1, scavenge: 1 },
      choice: choice,
      summary: 'Three-way split every time \u2014 the bad ' + C.unit + ' fell out in ' + used + '.'
    };
  }

  /* ============================================================ REGISTER = */

  PS.registry.register({
    id: 'balance_scales',
    name: 'Balance Scales',
    icon: '\u2696\uFE0F',
    blurb: 'One of them is wrong. The beam will answer three times, and then you decide.',

    favors:   { logic: 3, caution: 1 },
    provides: ['supplies', 'salvage'],
    tagHooks: [],
    requires: function () { return true; },

    css: CSS,

    skins: [
      {
        id: 'contaminated_canisters', biome: 'wilderness', title: 'Contaminated Canisters',
        icon: '\uD83E\uDEA3', palette: 'moss',
        intro: 'The cache was still sealed, which is the good news. One of the canisters was breached at some point in the last four years, which is the rest of it. You rig a beam from a stick and two mess tins, because the alternative is drinking and finding out.',
        nouns: { unit: 'canister', batch: 'the cache', rig: 'field balance' }
      },
      {
        id: 'counterfeit_tokens', biome: 'urban', title: 'Counterfeit Tokens',
        icon: '\uD83E\uDE99', palette: 'steel',
        intro: 'The transit tokens still buy things, which makes them better than money. One in this handful was struck by someone in a basement, and the machine at the gate can tell. So can a jeweller\u2019s balance, if you are careful with it.',
        nouns: { unit: 'token', batch: 'the handful', rig: 'jeweller\u2019s balance' }
      },
      {
        id: 'oxygen_cylinders', biome: 'industrial', title: 'Faulty Oxygen Cylinders',
        icon: '\uD83E\uDDEF', palette: 'rust',
        intro: 'The rack is full and every gauge reads the same comfortable number, which is exactly the problem \u2014 the gauges have been lying since the fire. Down there you get one bottle and no second opinion. The calibration beam on the wall still works.',
        nouns: { unit: 'cylinder', batch: 'the rack', rig: 'load beam' }
      }
    ],

    build: build,
    mount: mount,
    unmount: unmount,
    hint: hint,
    autoSolve: autoSolve
  });

})(typeof window !== 'undefined' ? window : this);
