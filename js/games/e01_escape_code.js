/* ==========================================================================
   PuzzleStudio — js/games/e01_escape_code.js        ENGINE 01 · Escape Code
   --------------------------------------------------------------------------
   REFERENCE IMPLEMENTATION. Read CONTRACT.md, then read this file.

   Everything this engine needs lives in this one file: logic, three skins,
   and its own CSS. It edits no shared file, and it touches no DOM until
   mount() is called.

   THE PUZZLE
     A locked room. Objects can be searched (costs energy). Four of them hide
     a clue that pins down one digit of the door code. Clues get indirect as
     the tier rises: direct -> arithmetic -> relations to another digit ->
     counting things that are actually in the room.

   THE THREE REAL BRANCHES
     code        enter the right number. Clean, quiet, rewards logic.
     pick_lock   needs wire or a pin. Quiet, slow, rewards caution + scavenging.
     force_door  always available. Costs health, tags you 'escaped_loud'.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio;
  if (!PS || !PS.registry) { if (root.console) console.error('[e01] core not loaded'); return; }

  /* ======================================================== SKIN CONTENT == */

  var CONTENT = {
    office_lockdown: {
      objects: [
        { name: 'Desk drawer',     icon: '\uD83D\uDDC4\uFE0F' },
        { name: 'Filing cabinet',  icon: '\uD83D\uDCC1' },
        { name: 'Dead monitor',    icon: '\uD83D\uDDA5\uFE0F' },
        { name: 'Coat on a hook',  icon: '\uD83E\uDDE5' },
        { name: 'Whiteboard',      icon: '\uD83D\uDCCB' },
        { name: 'Server rack',     icon: '\uD83D\uDDC3\uFE0F' },
        { name: 'Vending machine', icon: '\uD83E\uDD64' },
        { name: 'Fire panel',      icon: '\uD83D\uDEA8' },
        { name: 'Potted fern',     icon: '\uD83E\uDEB4' },
        { name: 'Ceiling tile',    icon: '\u2B1C' },
        { name: 'Recycling bin',   icon: '\uD83D\uDDD1\uFE0F' }
      ],
      decor: [
        { one: 'swivel chair', many: 'swivel chairs' },
        { one: 'ceiling light still on', many: 'ceiling lights still on' },
        { one: 'phone off its hook', many: 'phones off their hooks' },
        { one: 'coffee cup', many: 'coffee cups' }
      ],
      nothing: [
        'Somebody\u2019s expenses, three months late.',
        'A birthday card signed by eleven people.',
        'Dust and a dead wasp.',
        'A lanyard with the photo scratched off.'
      ],
      hazard: [
        'The drawer front comes away and takes skin with it.',
        'Something live arcs against your knuckles.',
        'The shelf tips. You catch it with your shin.'
      ]
    },

    ship_cabin: {
      objects: [
        { name: 'Bunk locker',    icon: '\uD83D\uDECF\uFE0F' },
        { name: 'Chart table',    icon: '\uD83D\uDDFA\uFE0F' },
        { name: 'Life jacket box',icon: '\uD83E\uDDBA' },
        { name: 'Porthole seal',  icon: '\uD83D\uDD35' },
        { name: 'Radio set',      icon: '\uD83D\uDCFB' },
        { name: 'Bilge hatch',    icon: '\uD83D\uDD73\uFE0F' },
        { name: 'Galley cupboard',icon: '\uD83E\uDD6B' },
        { name: 'Tool clip rail', icon: '\uD83D\uDD27' },
        { name: 'Logbook shelf',  icon: '\uD83D\uDCD8' },
        { name: 'Fire blanket',   icon: '\uD83E\uDDEF' },
        { name: 'Wet oilskin',    icon: '\uD83E\uDDE5' }
      ],
      decor: [
        { one: 'rivet weeping water', many: 'rivets weeping water' },
        { one: 'bunk still made', many: 'bunks still made' },
        { one: 'gauge in the red', many: 'gauges in the red' },
        { one: 'life ring', many: 'life rings' }
      ],
      nothing: [
        'Wet paper that used to be a chart.',
        'A photograph of a dog, curling at the corners.',
        'Salt, rust, and a smell you will remember.',
        'Somebody\u2019s tobacco tin, empty.'
      ],
      hazard: [
        'The hatch drops on your fingers.',
        'A cold slop of bilgewater goes down your collar.',
        'You put a hand on a pipe that is much hotter than it looks.'
      ]
    },

    bunker_airlock: {
      objects: [
        { name: 'Ration crate',     icon: '\uD83D\uDCE6' },
        { name: 'Decon shower',     icon: '\uD83D\uDEBF' },
        { name: 'Manifest board',   icon: '\uD83D\uDCCB' },
        { name: 'Suit rack',        icon: '\uD83E\uDDD1\u200D\uD83D\uDE80' },
        { name: 'Filter housing',   icon: '\uD83C\uDF00' },
        { name: 'Battery bank',     icon: '\uD83D\uDD0B' },
        { name: 'First aid station',icon: '\uD83E\uDE79' },
        { name: 'Sealed footlocker',icon: '\uD83E\uDDF3' },
        { name: 'Pressure gauge',   icon: '\uD83D\uDCC9' },
        { name: 'Emergency stores', icon: '\uD83E\uDD6B' },
        { name: 'Cable conduit',    icon: '\uD83E\uDDF5' }
      ],
      decor: [
        { one: 'bunk in the bay', many: 'bunks in the bay' },
        { one: 'sealed water drum', many: 'sealed water drums' },
        { one: 'warning decal', many: 'warning decals' },
        { one: 'spare filter', many: 'spare filters' }
      ],
      nothing: [
        'A duty roster with every name struck through.',
        'Chalk marks counting days. They stop at forty-one.',
        'Packing foam and nothing in it.',
        'A child\u2019s drawing taped to the inside of the lid.'
      ],
      hazard: [
        'The seal releases and the pressure slaps you into the frame.',
        'Something inside is colder than it has any right to be.',
        'You catch your forearm on a burr of cut steel.'
      ]
    }
  };

  var LOOT = ['wire', 'pin', 'battery', 'flare', 'rope', 'keycard', 'tape', 'matches', 'glowstick', 'gloves'];

  /* ============================================================== BUILD == */

  function makeClue(pos, digits, resolved, rng, tier, decor) {
    var d = digits[pos];
    var types = ['direct'];
    if (tier >= 2) types.push('arith', 'count');
    if (tier >= 2 && resolved.length) types.push('relation');
    if (tier >= 3) types.push('arith', 'relation', 'count');   // weight them up
    var type = rng.pick(types);

    if (type === 'relation' && !resolved.length) type = 'direct';
    if (type === 'count' && !decor.length) type = 'direct';

    var nth = ordinal(pos + 1);

    if (type === 'arith') {
      var a, b, form = rng.chance(0.5) ? '+' : '\u00D7';
      for (var guard = 0; guard < 60; guard++) {
        a = rng.int(3, 19); b = rng.int(3, 9);
        if (((form === '+' ? a + b : a * b) % 10) === d) break;
        a = null;
      }
      if (a === null || a === undefined) return makeDirect(pos, d, nth, rng);
      return {
        pos: pos, type: 'arith',
        text: 'The ' + nth + ' digit is the last digit of ' + a + ' ' + form + ' ' + b + '.'
      };
    }

    if (type === 'relation') {
      var k = rng.pick(resolved);
      var m = (d - digits[k] + 10) % 10;
      var kth = ordinal(k + 1);
      var phrase = m === 0
        ? 'the same as the ' + kth + ' digit'
        : m + ' more than the ' + kth + ' digit (wrap past 9 back to 0)';
      return { pos: pos, type: 'relation', ref: k, text: 'The ' + nth + ' digit is ' + phrase + '.' };
    }

    if (type === 'count') {
      var noun = rng.pick(decor);
      return {
        pos: pos, type: 'count', decorId: noun.id,
        text: 'The ' + nth + ' digit is how many ' + noun.many + ' there are in this room.'
      };
    }

    return makeDirect(pos, d, nth, rng);
  }

  function makeDirect(pos, d, nth, rng) {
    var wording = rng.pick([
      'Scratched into the metal: the ' + nth + ' digit is ' + d + '.',
      'A sticky note, half peeled: "' + nth + ' \u2192 ' + d + '".',
      'Written in marker on the underside: ' + nth + ' digit = ' + d + '.',
      'Someone punched the number ' + d + ' into the surface. Above it, "' + nth + '".'
    ]);
    return { pos: pos, type: 'direct', text: wording };
  }

  function ordinal(n) { return ['0th', '1st', '2nd', '3rd', '4th'][n] || (n + 'th'); }

  function build(state, rng, tier, skin) {
    var C = CONTENT[skin.id] || CONTENT.office_lockdown;

    // The run is infinite; tier is not. Clamp anything that scales a COST or a
    // SIZE so a very deep run stays playable instead of instantly lethal.
    var t = Math.min(6, tier);

    /* --- the code -------------------------------------------------------- */
    var digits = [rng.int(0, 9), rng.int(0, 9), rng.int(0, 9), rng.int(0, 9)];

    /* --- decor the count clues can reference ----------------------------- */
    var decorPool = rng.shuffle(C.decor);
    var decor = [];
    for (var i = 0; i < Math.min(3, decorPool.length); i++) {
      decor.push({
        id: 'd' + i,
        one: decorPool[i].one,
        many: decorPool[i].many,
        count: rng.int(0, 9)
      });
    }
    // Guarantee at least one decor count matches a digit so `count` clues are honest.
    var forced = rng.int(0, 3);
    decor[0].count = digits[forced];

    /* --- clues in a solvable order --------------------------------------- */
    var order = rng.shuffle([0, 1, 2, 3]);
    var resolved = [];
    var clues = [];
    for (i = 0; i < order.length; i++) {
      var pos = order[i];
      var usable = decor.filter(function (dd) { return dd.count === digits[pos]; });
      var clue = makeClue(pos, digits, resolved, rng, t, usable);
      clues.push(clue);
      resolved.push(pos);
    }

    /* --- the room -------------------------------------------------------- */
    var objectCount = Math.min(C.objects.length, 6 + t);
    var names = rng.sample(C.objects, objectCount);
    var slots = rng.shuffle(names.map(function (_, idx) { return idx; }));

    var objects = names.map(function (n, idx) {
      return { idx: idx, name: n.name, icon: n.icon, searched: false, kind: 'nothing', payload: null };
    });

    // four clue slots
    for (i = 0; i < 4; i++) {
      var o = objects[slots[i]];
      o.kind = 'clue';
      o.payload = clues[i];
    }
    // loot slots
    var lootCount = Math.max(1, Math.min(3, objectCount - 4 - Math.max(0, t - 1)));
    var lootPool = rng.shuffle(LOOT);
    for (i = 0; i < lootCount && (4 + i) < slots.length; i++) {
      objects[slots[4 + i]].kind = 'item';
      objects[slots[4 + i]].payload = lootPool[i % lootPool.length];
    }
    // hazards fill in from the back as tier climbs
    var hazardCount = Math.max(0, Math.min(2, t - 1));
    for (i = 0; i < hazardCount; i++) {
      var si = slots.length - 1 - i;
      if (si > 4 + lootCount - 1 && objects[slots[si]].kind === 'nothing') {
        objects[slots[si]].kind = 'hazard';
        objects[slots[si]].payload = rng.pick(C.hazard);
      }
    }
    // flavour text for the empties
    for (i = 0; i < objects.length; i++) {
      if (objects[i].kind === 'nothing') objects[i].payload = rng.pick(C.nothing);
    }

    return {
      code: digits.join(''),
      digits: digits,
      clues: clues,
      decor: decor,
      objects: objects,
      searchCost: 3 + t,
      maxAttempts: 3,
      attempts: 0,
      entry: [],
      keypadLocked: false,
      found: [],                       // clue objects the player has actually seen
      picked: [],                      // item ids picked up this scene
      searches: 0,
      pickChance: Math.max(0.34, 0.9 - t * 0.1),
      forceDamage: 7 + t * 2,
      tier: t
    };
  }

  /* ================================================================ CSS == */

  var CSS = [
    '.pz-esc{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(268px,.9fr);gap:18px;align-items:start}',
    '@media (max-width:820px){.pz-esc{grid-template-columns:1fr}}',

    '.pz-esc-room{display:grid;grid-template-columns:repeat(auto-fill,minmax(126px,1fr));gap:10px}',
    '.pz-esc-obj{position:relative;display:flex;flex-direction:column;gap:6px;align-items:flex-start;',
    '  padding:12px 12px 11px;text-align:left;border-radius:10px;border:1px solid var(--line);',
    '  background:linear-gradient(180deg,var(--panel-2),#0d1117);color:var(--text);',
    '  transition:transform .16s var(--ease),border-color .16s var(--ease),box-shadow .16s var(--ease)}',
    '.pz-esc-obj:hover:not(:disabled){transform:translateY(-3px);border-color:var(--acc);box-shadow:0 12px 26px rgba(0,0,0,.45)}',
    '.pz-esc-obj:disabled{cursor:default}',
    '.pz-esc-obj__i{font-size:22px;line-height:1}',
    '.pz-esc-obj__n{font-size:12px;font-weight:600}',
    '.pz-esc-obj__r{font-size:11px;line-height:1.45;color:var(--dim)}',
    '.pz-esc-obj.is-clue{border-color:var(--acc);background:linear-gradient(180deg,var(--acc-wash),#0d1117)}',
    '.pz-esc-obj.is-clue .pz-esc-obj__r{color:var(--acc-2)}',
    '.pz-esc-obj.is-item{border-color:#3f7d5c}',
    '.pz-esc-obj.is-item .pz-esc-obj__r{color:var(--good)}',
    '.pz-esc-obj.is-hazard{border-color:#7d3f3f}',
    '.pz-esc-obj.is-hazard .pz-esc-obj__r{color:var(--bad)}',
    '.pz-esc-obj.is-empty{opacity:.55}',
    '.pz-esc-obj__cost{position:absolute;top:9px;right:10px;font-family:var(--font-mono);font-size:10px;color:var(--dimmer)}',

    '.pz-esc-decor{display:flex;flex-wrap:wrap;gap:8px}',
    '.pz-esc-decor__i{font-family:var(--font-mono);font-size:11px;padding:4px 9px;border-radius:99px;',
    '  color:var(--text-2);background:#0c1016;border:1px solid var(--line-soft)}',
    '.pz-esc-decor__i b{color:var(--acc-2)}',

    '.pz-esc-pad{display:flex;flex-direction:column;gap:12px}',
    '.pz-esc-slots{display:flex;gap:8px;justify-content:center}',
    '.pz-esc-slot{width:46px;height:58px;display:grid;place-items:center;font-family:var(--font-mono);',
    '  font-size:26px;font-weight:700;color:var(--acc-2);border-radius:8px;background:#080b10;',
    '  border:1px solid var(--line);box-shadow:inset 0 2px 12px rgba(0,0,0,.6)}',
    '.pz-esc-slot.is-set{border-color:var(--acc);box-shadow:inset 0 2px 12px rgba(0,0,0,.6),0 0 14px var(--acc-glow)}',
    '.pz-esc-keys{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}',
    '.pz-esc-key{padding:12px 0;font-family:var(--font-mono);font-size:17px;font-weight:700;border-radius:8px;',
    '  border:1px solid var(--line);background:linear-gradient(180deg,var(--panel-3),var(--panel-2));color:var(--text);',
    '  transition:transform .1s var(--ease),border-color .1s var(--ease)}',
    '.pz-esc-key:hover:not(:disabled){border-color:var(--acc);transform:translateY(-1px)}',
    '.pz-esc-key:active:not(:disabled){transform:scale(.95)}',
    '.pz-esc-key--wide{grid-column:span 1}',

    '.pz-esc-notes{display:flex;flex-direction:column;gap:7px;max-height:250px;overflow:auto}',
    '.pz-esc-note{font-size:12px;line-height:1.5;color:var(--text-2);padding:8px 10px;border-radius:7px;',
    '  background:#0c1016;border:1px solid var(--line-soft);border-left:2px solid var(--acc)}',
    '.pz-esc-note--none{border-left-color:var(--line);color:var(--dimmer);font-style:italic}',

    '.pz-esc-alarm{display:flex;gap:5px;align-items:center;font-family:var(--font-mono);font-size:11px;color:var(--dim)}',
    '.pz-esc-alarm i{width:9px;height:9px;border-radius:99px;background:#22282f;display:inline-block;font-style:normal}',
    '.pz-esc-alarm i.on{background:var(--bad);box-shadow:0 0 9px var(--bad)}',

    '.pz-esc-shake{animation:pzEscShake .42s var(--ease)}',
    '@keyframes pzEscShake{0%,100%{transform:none}20%{transform:translateX(-8px)}40%{transform:translateX(7px)}60%{transform:translateX(-4px)}80%{transform:translateX(3px)}}',

    '.pz-esc-exits{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(210px,1fr))}'
  ].join('\n');

  /* ================================================================ MOUNT = */

  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var refs = {};

    /* ---------------------------------------------------------- the room -- */
    var room = h('div', { class: 'pz-esc-room' });

    function paint(obj, node) {
      node.className = 'pz-esc-obj' + (obj.searched
        ? (obj.kind === 'clue' ? ' is-clue' : obj.kind === 'item' ? ' is-item'
          : obj.kind === 'hazard' ? ' is-hazard' : ' is-empty')
        : '');
      PS.ui.clear(node);
      PS.ui.append(node, [
        h('div', { class: 'pz-esc-obj__i', text: obj.icon }),
        h('div', { class: 'pz-esc-obj__n', text: obj.name }),
        obj.searched
          ? h('div', { class: 'pz-esc-obj__r', text: resultText(obj) })
          : h('div', { class: 'pz-esc-obj__r', text: 'Unsearched.' }),
        obj.searched ? null : h('div', { class: 'pz-esc-obj__cost', text: '\u26A1' + puzzle.searchCost })
      ]);
      node.disabled = obj.searched;
    }

    function resultText(obj) {
      if (obj.kind === 'clue') return obj.payload.text;
      if (obj.kind === 'item') return 'You pocket the ' + PS.state.itemInfo(obj.payload).name.toLowerCase() + '.';
      if (obj.kind === 'hazard') return obj.payload;
      return obj.payload;
    }

    puzzle.objects.forEach(function (obj) {
      var node = h('button', { class: 'pz-esc-obj', type: 'button' });
      node.addEventListener('click', function () { search(obj, node); });
      paint(obj, node);
      room.appendChild(node);
    });

    function search(obj, node) {
      if (obj.searched) return;
      obj.searched = true;
      puzzle.searches++;

      // Searching costs energy; when you have none it starts costing you blood.
      if (state.stats.energy >= puzzle.searchCost) api.tweak({ energy: -puzzle.searchCost });
      else api.tweak({ energy: -state.stats.energy, health: -Math.ceil(puzzle.searchCost / 2) });

      if (obj.kind === 'clue') {
        puzzle.found.push(obj.payload);
        api.toast('Found something: ' + ordinal(obj.payload.pos + 1) + ' digit.', 'good');
      } else if (obj.kind === 'item') {
        puzzle.picked.push(obj.payload);
        api.tweak(null, [obj.payload]);
        api.toast('Picked up ' + PS.state.itemInfo(obj.payload).name + '.', 'good');
      } else if (obj.kind === 'hazard') {
        api.tweak({ health: -(3 + puzzle.tier), morale: -2 });
        api.toast('That hurt.', 'bad');
      }

      paint(obj, node);
      renderNotes();
      refreshExits();
    }

    /* ------------------------------------------------------------- decor -- */
    var decorRow = h('div', { class: 'pz-esc-decor' }, puzzle.decor.map(function (d) {
      return h('span', { class: 'pz-esc-decor__i' }, [
        h('b', { text: String(d.count) }), ' ', d.count === 1 ? d.one : d.many
      ]);
    }));

    /* ------------------------------------------------------------ keypad -- */
    var slots = [0, 1, 2, 3].map(function () { return h('div', { class: 'pz-esc-slot', text: '\u2013' }); });
    var slotRow = h('div', { class: 'pz-esc-slots' }, slots);

    var alarmDots = [0, 1, 2].map(function () { return h('i', {}); });
    var alarmRow = h('div', { class: 'pz-esc-alarm' }, [h('span', { text: 'ALARM' })].concat(alarmDots));

    function paintSlots() {
      for (var i = 0; i < 4; i++) {
        var v = puzzle.entry[i];
        slots[i].textContent = (v === undefined ? '\u2013' : String(v));
        slots[i].className = 'pz-esc-slot' + (v === undefined ? '' : ' is-set');
      }
      for (i = 0; i < 3; i++) alarmDots[i].className = i < puzzle.attempts ? 'on' : '';
      refs.submit.disabled = puzzle.keypadLocked || puzzle.entry.length < 4;
      for (i = 0; i < refs.keys.length; i++) refs.keys[i].disabled = puzzle.keypadLocked;
      refs.back.disabled = puzzle.keypadLocked || !puzzle.entry.length;
    }

    function pressDigit(d) {
      if (puzzle.keypadLocked || puzzle.entry.length >= 4) return;
      puzzle.entry.push(d);
      paintSlots();
    }
    function pressBack() {
      if (puzzle.keypadLocked) return;
      puzzle.entry.pop();
      paintSlots();
    }
    function submit() {
      if (puzzle.keypadLocked || puzzle.entry.length < 4) return;
      var guess = puzzle.entry.join('');
      if (guess === puzzle.code) return escapeByCode();

      puzzle.attempts++;
      puzzle.entry = [];
      api.tweak({ morale: -4 });
      refs.pad.classList.remove('pz-esc-shake');
      void refs.pad.offsetWidth;
      refs.pad.classList.add('pz-esc-shake');

      if (puzzle.attempts >= puzzle.maxAttempts) {
        puzzle.keypadLocked = true;
        api.toast('The panel locks itself out. No more guesses.', 'bad', 4200);
      } else {
        api.toast('Wrong. ' + (puzzle.maxAttempts - puzzle.attempts) + ' left before it locks.', 'bad');
      }
      paintSlots();
      refreshExits();
    }

    refs.keys = [];
    var keyGrid = h('div', { class: 'pz-esc-keys' });
    [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(function (d) {
      var b = h('button', { class: 'pz-esc-key', type: 'button', text: String(d) });
      b.addEventListener('click', function () { pressDigit(d); });
      refs.keys.push(b);
      keyGrid.appendChild(b);
    });
    refs.back = h('button', { class: 'pz-esc-key', type: 'button', text: '\u232B' });
    refs.back.addEventListener('click', pressBack);
    var zero = h('button', { class: 'pz-esc-key', type: 'button', text: '0' });
    zero.addEventListener('click', function () { pressDigit(0); });
    refs.keys.push(zero);
    refs.submit = h('button', { class: 'pz-esc-key', type: 'button', text: '\u21B5' });
    refs.submit.addEventListener('click', submit);
    PS.ui.append(keyGrid, [refs.back, zero, refs.submit]);

    function onKey(ev) {
      if (ev.key >= '0' && ev.key <= '9') { pressDigit(Number(ev.key)); ev.preventDefault(); }
      else if (ev.key === 'Backspace') { pressBack(); ev.preventDefault(); }
      else if (ev.key === 'Enter') { submit(); ev.preventDefault(); }
    }
    document.addEventListener('keydown', onKey);
    teardownFns.push(function () { document.removeEventListener('keydown', onKey); });

    refs.pad = h('div', { class: 'pz-esc-pad' }, [slotRow, keyGrid, alarmRow]);

    /* ------------------------------------------------------------- notes -- */
    var notes = h('div', { class: 'pz-esc-notes' });
    function renderNotes() {
      PS.ui.clear(notes);
      if (!puzzle.found.length) {
        notes.appendChild(h('div', { class: 'pz-esc-note pz-esc-note--none', text: 'Nothing written down yet. Search the room.' }));
        return;
      }
      var sorted = puzzle.found.slice().sort(function (a, b) { return a.pos - b.pos; });
      sorted.forEach(function (c) { notes.appendChild(h('div', { class: 'pz-esc-note', text: c.text })); });
    }
    renderNotes();

    /* ------------------------------------------------------------- exits -- */
    var exits = h('div', { class: 'pz-esc-exits' });

    function pickTool() {
      if (state.has('wire')) return 'wire';
      if (state.has('pin')) return 'pin';
      return null;
    }

    function refreshExits() {
      PS.ui.clear(exits);
      var tool = pickTool();

      exits.appendChild(h('button', {
        class: 'pz-choice', type: 'button', disabled: !tool,
        onclick: function () { escapeByPick(tool); }
      }, [
        h('div', { class: 'pz-choice__i', text: '\uD83E\uDDF7' }),
        h('div', { class: 'pz-choice__t', text: 'Pick the lock' }),
        h('div', {
          class: 'pz-choice__d',
          text: tool
            ? 'Slow and silent. Bends your ' + PS.state.itemInfo(tool).name.toLowerCase() + ' out of shape for good.'
            : 'You need a wire or a pin. There is neither in your hands.'
        }),
        h('div', { class: 'pz-choice__tag', text: tool ? '\u26A1-' + (6 + puzzle.tier * 2) + '  quiet' : 'unavailable' })
      ]));

      exits.appendChild(h('button', {
        class: 'pz-choice', type: 'button',
        onclick: escapeByForce
      }, [
        h('div', { class: 'pz-choice__i', text: '\uD83D\uDCA5' }),
        h('div', { class: 'pz-choice__t', text: 'Force the door' }),
        h('div', { class: 'pz-choice__d', text: 'Always an option. It will hear you do it, and so will everything else.' }),
        h('div', { class: 'pz-choice__tag', text: '\u2764\uFE0F-' + puzzle.forceDamage + '  loud' })
      ]));
    }
    refreshExits();

    /* ------------------------------------------------------------ finish -- */

    function escapeByCode() {
      var thorough = puzzle.searches >= puzzle.objects.length - 1;
      api.flash();
      api.finish({
        outcome: 'success',
        stats: { morale: 10, energy: -2 },
        gain: [], lose: [],
        tags: ['escaped_clean'].concat(thorough ? ['thorough'] : []),
        signals: { logic: 3, caution: 1, scavenge: puzzle.picked.length ? 1 : 0 },
        choice: 'code',
        summary: 'The lock clicked on the first try. Nobody heard a thing.'
      });
    }

    function escapeByPick(tool) {
      if (!tool) return;
      var ok = api.rng.chance(puzzle.pickChance) || state.hasTag('has_tools');
      api.finish({
        outcome: ok ? 'success' : 'partial',
        stats: ok ? { energy: -(6 + puzzle.tier * 2), morale: 4 }
                  : { energy: -(9 + puzzle.tier * 2), health: -4, morale: -3 },
        gain: [], lose: [tool],
        tags: ['escaped_quietly'],
        signals: { caution: 3, scavenge: 1, logic: puzzle.found.length >= 2 ? 1 : 0 },
        choice: 'pick_lock',
        summary: ok
          ? 'The ' + PS.state.itemInfo(tool).name.toLowerCase() + ' held long enough. The door opened without a sound.'
          : 'It took four tries and the ' + PS.state.itemInfo(tool).name.toLowerCase() + ' snapped in the barrel, but the door opened.'
      });
    }

    function escapeByForce() {
      api.flash();
      api.finish({
        outcome: 'partial',
        stats: { health: -puzzle.forceDamage, energy: -12, morale: -2 },
        gain: [], lose: [],
        tags: ['escaped_loud'],
        signals: { brute: 3, speed: 2 },
        choice: 'force_door',
        summary: 'The frame gave before the lock did. Everything within two floors knows where you are.'
      });
    }

    /* ------------------------------------------------------------ layout -- */
    PS.ui.append(el, h('div', { class: 'pz-esc' }, [
      h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'The room' }),
          decorRow
        ]),
        room,
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'Other ways out' }),
          exits
        ])
      ]),
      h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'Door keypad \u00B7 4 digits' }),
          refs.pad
        ]),
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'What you have written down' }),
          notes
        ]),
        h('div', { class: 'pz-note' }, [
          'Searching costs ', h('strong', { text: '\u26A1' + puzzle.searchCost }),
          '. Three wrong codes and the panel locks for good.'
        ])
      ])
    ]));

    paintSlots();
  }

  function unmount() {
    while (teardownFns.length) {
      try { teardownFns.pop()(); } catch (e) { /* nothing we can do, keep unwinding */ }
    }
  }

  /* ================================================================ HINT = */

  function hint(puzzle, state) {
    var missing = [0, 1, 2, 3].filter(function (p) {
      return !puzzle.found.some(function (c) { return c.pos === p; });
    });
    if (missing.length) {
      var unsearched = puzzle.objects.filter(function (o) { return !o.searched; });
      var holding = unsearched.filter(function (o) { return o.kind === 'clue'; });
      if (holding.length) return 'The ' + holding[0].name.toLowerCase() + ' is hiding one of the digits.';
      return 'You have searched everything that matters. The ' + ordinal(missing[0] + 1) + ' digit is ' + puzzle.digits[missing[0]] + '.';
    }
    var relation = puzzle.found.filter(function (c) { return c.type === 'relation' || c.type === 'count'; });
    if (relation.length) return 'Work the plain digits out first, then the ones that point at other digits.';
    if (state.has('wire') || state.has('pin')) return 'You have everything for the code. If your nerve goes, you can still pick it.';
    return 'You have all four clues. Read them in order.';
  }

  /* ============================================================ AUTOSOLVE = */
  /* Headless. Must not touch the DOM. Returns a finish-shaped result. */

  function autoSolve(puzzle, rng, state) {
    var mode = rng.chance(0.62) ? 'code' : (state && (state.has('wire') || state.has('pin')) && rng.chance(0.6) ? 'pick_lock' : 'force_door');

    if (mode === 'code') {
      return {
        outcome: 'success',
        stats: { morale: 10, energy: -(2 + puzzle.searchCost * Math.min(puzzle.objects.length, 6)) },
        tags: ['escaped_clean'],
        signals: { logic: 3, caution: 1, scavenge: 1 },
        choice: 'code',
        summary: 'The lock clicked on the first try. Nobody heard a thing.'
      };
    }
    if (mode === 'pick_lock') {
      var tool = state.has('wire') ? 'wire' : 'pin';
      var ok = rng.chance(puzzle.pickChance);
      return {
        outcome: ok ? 'success' : 'partial',
        stats: ok ? { energy: -(6 + puzzle.tier * 2), morale: 4 } : { energy: -(9 + puzzle.tier * 2), health: -4, morale: -3 },
        lose: [tool],
        tags: ['escaped_quietly'],
        signals: { caution: 3, scavenge: 1 },
        choice: 'pick_lock',
        summary: 'The door opened without a sound.'
      };
    }
    return {
      outcome: 'partial',
      stats: { health: -puzzle.forceDamage, energy: -12, morale: -2 },
      tags: ['escaped_loud'],
      signals: { brute: 3, speed: 2 },
      choice: 'force_door',
      summary: 'The frame gave before the lock did.'
    };
  }

  /* ============================================================ REGISTER = */

  PS.registry.register({
    id: 'escape_code',
    name: 'Escape Code',
    icon: '\uD83D\uDEAA',
    blurb: 'Search a locked room for four digits, or leave the hard way.',

    favors:   { logic: 3, caution: 1, brute: 1 },
    provides: ['information', 'load_out', 'salvage'],
    tagHooks: ['has_tools', 'escaped_loud'],
    requires: function (state) { return state.stats.energy > 8; },

    css: CSS,

    skins: [
      {
        id: 'office_lockdown', biome: 'indoor', title: 'Office Lockdown',
        icon: '\uD83C\uDFE2', palette: 'steel',
        intro: 'The shutters came down at 04:12 and the fire door answers to a keypad nobody briefed you on. Somewhere above you a floor polisher is still running.',
        nouns: { resource: 'stationery', exit: 'the fire door', hazard: 'the live rack' }
      },
      {
        id: 'ship_cabin', biome: 'water', title: 'Ship Cabin',
        icon: '\uD83D\uDEA2', palette: 'ice',
        intro: 'She is listing eleven degrees and the cabin door has swollen into its frame. The water is at the sill and has been for four minutes.',
        nouns: { resource: 'ship\u2019s stores', exit: 'the cabin door', hazard: 'the bilge' }
      },
      {
        id: 'bunker_airlock', biome: 'shelter', title: 'Bunker Airlock',
        icon: '\uD83D\uDEE1\uFE0F', palette: 'rust',
        intro: 'The inner door sealed behind you. The outer one wants six digits of clearance and will only accept four. Someone before you left notes.',
        nouns: { resource: 'emergency stores', exit: 'the outer hatch', hazard: 'the decon shower' }
      }
    ],

    build: build,
    mount: mount,
    unmount: unmount,
    hint: hint,
    autoSolve: autoSolve
  });

})(typeof window !== 'undefined' ? window : this);
