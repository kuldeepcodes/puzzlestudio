/* ==========================================================================
   PuzzleStudio — js/games/e10_allocation_triage.js  ENGINE 10 · Allocation Triage
   --------------------------------------------------------------------------
   Self-contained: logic + 3 skins + its own CSS. No DOM access until mount().

   THE SCENE
     Not a puzzle with an answer. There is less in the crate than the people
     around it need, and the shortfall is deliberate: whatever you do, somebody
     goes without. Every one of them tells you what they need. Every one of them
     is also holding something back, and you do not find out what until the
     morning after you have already decided.

     There is a row on the sheet for you. You have not eaten either.

   THE ROOM (arena)
     They are not rows in a table. They are people standing around a room, and
     you have to walk over to each one before you know a single thing about
     them: what they say, what they ask for, and the one detail they are not
     saying out loud. Hurry, and you allocate blind — the sheet at the store
     shows a question mark next to everybody you did not go and see.

     The store itself is a station. The allocation sheet only opens when you
     are standing at the crate, and it keeps its state while you walk away to
     go and look at somebody again.

   WHY THIS ENGINE IS DIFFERENT
     The Director routes here when the player's health hits zero — they wake up
     on somebody's floor. So this scene must work with an empty pack, floored
     stats and no items whatsoever. `requires` is unconditional, nothing is
     gated on inventory, sitting down here always returns a little health and
     energy no matter how the split goes — and the room is lit by other
     people's lamps, so a player who arrives with a dead light can still see
     every face in it.

   WHAT IT LEAVES BEHIND
     `has_ally` (via an ally in the pack) or `has_enemy` — tags the Director
     keeps reading for a long time afterwards — and a morale swing in either
     direction that dwarfs anything else in the game.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio;
  if (!PS || !PS.registry) { if (root.console) console.error('[e10] core not loaded'); return; }

  /* ============================================================ RESOURCES = */

  var RES_ORDER = ['food', 'water', 'meds', 'fuel'];

  var RES_ICON = { food: '\uD83E\uDD6B', water: '\uD83D\uDCA7', meds: '\uD83E\uDE79', fuel: '\u26FD' };

  // What one unit does for YOU if you keep it. This is the whole temptation.
  var RES_SELF = {
    food:  { energy: 7 },
    water: { energy: 4, health: 2 },
    meds:  { health: 9 },
    fuel:  { light: 12 }
  };

  var RES_GAIN = { food: 'ration', water: 'water', meds: 'bandage', fuel: 'fuel' };

  /* ======================================================== SKIN CONTENT == */

  var CONTENT = {
    storm_shelter: {
      crate: 'the shelter store', place: 'the shelter',
      labels: { food: 'rations', water: 'water', meds: 'medicine', fuel: 'lamp oil' },
      lead: 'Nobody appointed you. You were just the one standing nearest the crate when it was opened.',
      leftover: 'What you did not hand out sits in the crate in front of everybody, which is its own kind of answer.',
      people: [
        { name: 'Aurelia', icon: '\uD83E\uDDD3', watch: true, truths: ['watching', 'proud'],
          says: 'Four days I have been up here. I am not asking for more than my share.' },
        { name: 'Tomas',   icon: '\uD83E\uDDD4', truths: ['generous', 'proud'],
          says: 'Give mine to the others first. I can go another night, I have done it before.' },
        { name: 'Beata',   icon: '\uD83D\uDC69', truths: ['understated', 'critical'],
          says: 'My daughter is behind the partition. She has not eaten since the sirens.' },
        { name: 'Reyes',   icon: '\uD83E\uDDD1', watch: true, truths: ['watching', 'thief'],
          says: 'I carried half of what is in that crate up eleven flights. That has to count for something.' },
        { name: 'Odile',   icon: '\uD83D\uDC75', truths: ['understated', 'critical'],
          says: 'I do not want to be a problem. I really do not want to be a problem.' }
      ],
      branchA: { id: 'shelter', icon: '\uD83D\uDECF\uFE0F', title: 'Stay the night here', desc: 'Four walls, other people breathing, and whatever they decide you are by morning.' },
      branchB: { id: 'forage', icon: '\uD83C\uDF3F', title: 'Go out for more before light', desc: 'You know what the crate did not cover. Somebody has to go and it is going to be you.' }
    },

    medicine_convoy: {
      crate: 'the convoy pallet', place: 'the depot',
      labels: { food: 'field rations', water: 'clean water', meds: 'antibiotics', fuel: 'diesel' },
      lead: 'The manifest says twice this. The manifest was written before the second truck did not arrive.',
      leftover: 'You keep some back on the pallet. Everyone watches you do it and nobody says a word.',
      people: [
        { name: 'Sgt. Nadel', icon: '\uD83E\uDE96', watch: true, truths: ['watching', 'proud'],
          says: 'Field rules. Worst first, me last. I will take what is left and I will remember who did not.' },
        { name: 'Ivo',        icon: '\uD83E\uDDD1\u200D\uD83D\uDD27', truths: ['overstated', 'thief'],
          says: 'The truck runs on what you put in it. Nothing else here moves without me.' },
        { name: 'Halima',     icon: '\uD83D\uDC69\u200D\u2695\uFE0F', truths: ['understated', 'critical'],
          says: 'Two of mine are septic. Split it evenly and you are choosing which one, you just do not have to watch.' },
        { name: 'Cass',       icon: '\uD83E\uDDD1\u200D\uD83C\uDFA4', watch: true, truths: ['watching', 'overstated'],
          says: 'I helped load this. I am not saying that entitles me. I am saying I helped load it.' },
        { name: 'Petra',      icon: '\uD83D\uDC69\u200D\uD83E\uDDB3', truths: ['proud', 'critical'],
          says: 'Whatever is left over. I have had worse weeks than this one and I am still here.' }
      ],
      branchA: { id: 'trade', icon: '\uD83E\uDD1D', title: 'Work the depot for the rest', desc: 'Somebody in this yard has what the pallet was short of, and a price you can probably pay.' },
      branchB: { id: 'sprint', icon: '\uD83C\uDFC3', title: 'Take the truck and go now', desc: 'Diesel in the tank and a road that is still open for maybe another hour.' }
    },

    fuel_split: {
      crate: 'the last of the stove fuel', place: 'the col',
      labels: { food: 'trail food', water: 'water', meds: 'first aid', fuel: 'stove fuel' },
      lead: 'Everyone has done the arithmetic already. They are waiting to see whether you have.',
      leftover: 'You keep a reserve back. In this cold that is not caution, and everybody knows it.',
      people: [
        { name: 'Jorun', icon: '\uD83E\uDDD7', watch: true, truths: ['watching', 'generous'],
          says: 'We burn it together or we freeze separately. Genuinely, your call.' },
        { name: 'Miko',  icon: '\uD83E\uDDD1\u200D\uD83C\uDF3E', truths: ['overstated', 'generous'],
          says: 'There is a cache two ridges on. Give me enough to reach it and I come back for you.' },
        { name: 'Sana',  icon: '\uD83D\uDC69\u200D\uD83E\uDDB0', truths: ['critical', 'understated'],
          says: 'My hands stopped working about an hour ago. I am not being dramatic with you.' },
        { name: 'Erv',   icon: '\uD83E\uDDD3', truths: ['proud', 'understated'],
          says: 'I have sat out worse than this. Put me on half and do not think about it again.' },
        { name: 'Wren',  icon: '\uD83E\uDDD2', watch: true, truths: ['watching', 'understated'],
          says: 'I can carry more than you think I can. Ask anybody who came up with me.' }
      ],
      branchA: { id: 'forage', icon: '\uD83C\uDF32', title: 'Work down into the treeline', desc: 'Wet wood burns badly but it burns, and it is two hours below you.' },
      branchB: { id: 'climb', icon: '\u26F0\uFE0F', title: 'Push over the col tonight', desc: 'Everything you did not give away is on your back. So is everything you did.' }
    }
  };

  /* ========================================================== THE TRUTHS == */
  /* Exactly one per person, hidden until the resolution. `factor` bends what
     they actually needed away from what they said they needed. */

  var TRUTHS = [
    { id: 'overstated', factor: 0.55,
      reveal: function (n) { return n + ' asked high and knew it. Half of what you handed over is still wrapped in the morning.'; } },
    { id: 'understated', factor: 1.35,
      reveal: function (n) { return n + ' asked for less than they needed. You find out exactly why when they cannot get up.'; } },
    { id: 'critical', factor: 1.1,
      reveal: function (n) { return n + ' was much further gone than they let anyone see. What you put in their hands was the whole question.'; } },
    { id: 'generous', factor: 0.9,
      reveal: function (n) { return n + ' quietly passed half of what you gave them to whoever got least, and did not mention it.'; } },
    { id: 'thief', factor: 1.0,
      reveal: function (n) { return n + ' went back to the pile in the night and helped themselves out of everybody else\u2019s.'; } },
    { id: 'watching', factor: 0.9,
      reveal: function (n) { return n + ' spent the whole time working out what sort of person you are. They have their answer now.'; } },
    { id: 'proud', factor: 0.75,
      reveal: function (n) { return n + ' would not take one unit more than they asked for, and would not be argued with about it.'; } }
  ];

  function truthById(id) {
    for (var i = 0; i < TRUTHS.length; i++) if (TRUTHS[i].id === id) return TRUTHS[i];
    return TRUTHS[0];
  }

  /* =============================================================== TELLS == */
  /* What you can see about somebody, but only from close up. One per truth,
     deliberately written as an observation rather than a label: it is the
     reward for walking over, not the answer key. Nothing here changes a single
     number in resolve() — it only changes what you knew when you decided. */

  var TELLS = {
    overstated:  'There is a second bag behind them that they did not mention and did not mean you to see.',
    understated: 'They steady themselves on the wall between sentences and pretend that is normal.',
    critical:    'Their lips have gone the colour of the floor and they have stopped shivering.',
    generous:    'They keep counting the others. They never once count themselves.',
    thief:       'They know exactly how much is in there. They have already counted it twice.',
    watching:    'They are not looking at the crate at all. They are looking at you.',
    proud:       'They asked once, flatly, and have decided they are not going to ask again.'
  };

  /* ================================================================ ROOM == */
  /* Hand-drawn so the walk is short and legible: five places people stand, a
     store in the middle of it, and no corridor anybody has to trudge down.
       #  wall   .  floor   1-5 where somebody is standing
       D  the store          @  where you come in                            */

  var ROOM = [
    '###################',
    '#..1....###....2..#',
    '#.......#.#.......#',
    '#..##...#.#...##..#',
    '#..##....D....##..#',
    '#.................#',
    '#..##.........##..#',
    '#..##....5....##..#',
    '#..3.........4....#',
    '#.................#',
    '#@................#',
    '###################'
  ];

  /** Rows of characters -> { w, h, tiles, spots } with 1 = solid. */
  function readRoom(rows) {
    var tiles = [], spots = {}, y, x, ch;
    for (y = 0; y < rows.length; y++) {
      var line = [];
      for (x = 0; x < rows[y].length; x++) {
        ch = rows[y].charAt(x);
        line.push(ch === '#' ? 1 : 0);
        if (ch !== '#' && ch !== '.') spots[ch] = { x: x, y: y };
      }
      tiles.push(line);
    }
    return { w: rows[0].length, h: rows.length, tiles: tiles, spots: spots };
  }

  /* ============================================================== BUILD === */

  function build(state, rng, tier, skin) {
    var C = CONTENT[skin.id] || CONTENT.storm_shelter;
    var t = Math.min(6, Math.max(1, tier));

    var count = t <= 2 ? 3 : (t <= 4 ? 4 : 5);
    var resList = t <= 2 ? ['food', 'water', 'meds'] : RES_ORDER.slice();

    /* ---- who is here, and what each of them is actually holding back ----- */
    // Every truth is drawn from the two that person's own words could support,
    // so listening to them is worth something. One `watching` is always in the
    // room, which is what keeps an ally reachable however bleak the numbers are.
    var watchers = C.people.filter(function (p) { return p.watch; });
    var watcher = rng.pick(watchers) || C.people[0];
    var rest = C.people.filter(function (p) { return p !== watcher; });
    var picked = rng.shuffle([watcher].concat(rng.sample(rest, count - 1)));

    var usedOnce = {}, people = [], r, s;
    for (s = 0; s < picked.length; s++) {
      var who = picked[s], truth;
      if (who === watcher) {
        truth = 'watching';
      } else {
        var opts = [];
        for (var o = 0; o < who.truths.length; o++) {
          if (who.truths[o] !== 'watching') opts.push(who.truths[o]);
        }
        truth = rng.pick(opts) || 'proud';
        // At most one thief and at most one giver in any room.
        if ((truth === 'thief' || truth === 'generous') && usedOnce[truth]) {
          for (var o2 = 0; o2 < opts.length; o2++) if (opts[o2] !== truth) truth = opts[o2];
        }
        usedOnce[truth] = true;
      }

      var stated = {};
      for (r = 0; r < resList.length; r++) {
        var key = resList[r];
        // Everybody wants something of nearly everything; meds skew low and spiky.
        stated[key] = key === 'meds' ? (rng.chance(0.5) ? rng.int(1, 3) : 0) : rng.int(1, 3);
      }
      // Nobody asks for nothing — that would make them free to ignore.
      var any = false;
      for (r = 0; r < resList.length; r++) if (stated[resList[r]] > 0) any = true;
      if (!any) stated[resList[0]] = rng.int(1, 2);

      people.push({ name: who.name, icon: who.icon, says: who.says, stated: stated, truth: truth });
    }

    /* ---- the shortfall. This is the point of the whole engine. ----------- */
    var pool = {}, statedTotal = {};
    var squeeze = 0.68 - t * 0.028;             // 0.652 .. 0.512 of what was asked
    for (r = 0; r < resList.length; r++) {
      var k = resList[r], sum = 0;
      for (s = 0; s < count; s++) sum += people[s].stated[k];
      statedTotal[k] = sum;
      pool[k] = sum > 0 ? Math.max(1, Math.round(sum * squeeze)) : 0;
    }

    var alloc = [], mine = {};
    for (s = 0; s < count; s++) {
      var row = {};
      for (r = 0; r < resList.length; r++) row[resList[r]] = 0;
      alloc.push(row);
    }
    for (r = 0; r < resList.length; r++) mine[resList[r]] = 0;

    return {
      content: C,
      resList: resList,
      labels: C.labels,
      people: people,
      pool: pool,
      statedTotal: statedTotal,
      alloc: alloc,
      mine: mine,
      handedOut: false,
      tier: t
    };
  }

  /* ========================================================== RESOLUTION == */
  /* Pure function of the puzzle plus the allocation. No DOM, no rng — the
     autoplay bot and the live scene run the exact same code path. */

  function resolve(puzzle) {
    var res = puzzle.resList, people = puzzle.people;
    var n = people.length, s, r, k;

    // 1. what they actually needed, once the truth is out
    var real = [];
    for (s = 0; s < n; s++) {
      var f = truthById(people[s].truth).factor, row = {};
      for (r = 0; r < res.length; r++) {
        k = res[r];
        row[k] = people[s].stated[k] > 0 ? Math.max(1, Math.round(people[s].stated[k] * f)) : 0;
      }
      real.push(row);
    }

    // 2. what they actually ended up holding
    var got = [];
    for (s = 0; s < n; s++) {
      var g = {};
      for (r = 0; r < res.length; r++) g[res[r]] = puzzle.alloc[s][res[r]];
      got.push(g);
    }

    // 2a. the thief works the pile overnight — one unit off whoever can spare it
    var thief = -1;
    for (s = 0; s < n; s++) if (people[s].truth === 'thief') thief = s;
    if (thief >= 0) {
      for (var v = 0; v < n; v++) {
        if (v === thief) continue;
        var totalHeld = 0, fattest = null;
        for (r = 0; r < res.length; r++) {
          k = res[r];
          totalHeld += got[v][k];
          if (fattest === null || got[v][k] > got[v][fattest]) fattest = k;
        }
        if (totalHeld >= 3 && fattest && got[v][fattest] > 0) {
          got[v][fattest] -= 1; got[thief][fattest] += 1;
        }
      }
    }

    // 2b. the generous one hands their surplus to whoever is worst off
    var giver = -1;
    for (s = 0; s < n; s++) if (people[s].truth === 'generous') giver = s;
    if (giver >= 0) {
      var worst = -1, worstFill = 2;
      for (s = 0; s < n; s++) {
        if (s === giver) continue;
        var f2 = fillOf(got[s], real[s], res);
        if (f2 < worstFill) { worstFill = f2; worst = s; }
      }
      if (worst >= 0) {
        for (r = 0; r < res.length; r++) {
          k = res[r];
          var spare = got[giver][k] - real[giver][k];
          if (spare > 0) {
            var pass = Math.ceil(spare / 2);
            got[giver][k] -= pass; got[worst][k] += pass;
          }
        }
      }
    }

    // 3. how each of them came out of it
    var fates = [], kept = 0, short = 0, cut = 0, crises = 0;
    var ally = null, enemies = [];
    for (s = 0; s < n; s++) {
      var fill = fillOf(got[s], real[s], res);
      var band = fill >= 0.7 ? 'kept' : (fill >= 0.35 ? 'short' : 'cut');
      var crisis = people[s].truth === 'critical' && fill < 0.4;
      if (crisis) crises++;
      if (band === 'kept') kept++; else if (band === 'short') short++; else cut++;

      if (people[s].truth === 'watching' && band === 'kept') ally = people[s].name;
      // Enemies are made by genuine neglect, not by being short with everyone.
      if (fill < 0.25 || (band === 'cut' && (people[s].truth === 'proud' || people[s].truth === 'watching'))) {
        enemies.push(people[s].name);
      }

      fates.push({
        name: people[s].name, icon: people[s].icon, truth: people[s].truth,
        fill: fill, band: band, crisis: crisis,
        got: got[s], real: real[s], stated: people[s].stated
      });
    }

    // 4. what you kept, and what it bought you
    var selfStats = { health: 0, energy: 0, light: 0, morale: 0 };
    var selfUnits = 0, selfGain = [];
    for (r = 0; r < res.length; r++) {
      k = res[r];
      var u = puzzle.mine[k];
      if (!u) continue;
      selfUnits += u;
      var eff = RES_SELF[k];
      for (var sk in eff) if (Object.prototype.hasOwnProperty.call(eff, sk)) {
        selfStats[sk] = (selfStats[sk] || 0) + eff[sk] * u;
      }
      if (u >= 2 && selfGain.length < 2) selfGain.push(RES_GAIN[k]);
    }

    // 5. leftovers, which read as hoarding whether you meant it that way or not
    var leftover = 0;
    for (r = 0; r < res.length; r++) {
      k = res[r];
      var used = puzzle.mine[k];
      for (s = 0; s < n; s++) used += puzzle.alloc[s][k];
      leftover += Math.max(0, puzzle.pool[k] - used);
    }

    return {
      fates: fates, kept: kept, short: short, cut: cut, crises: crises,
      ally: ally, enemies: enemies,
      selfStats: selfStats, selfUnits: selfUnits, selfGain: selfGain,
      leftover: leftover
    };
  }

  function fillOf(got, real, res) {
    var need = 0, met = 0;
    for (var r = 0; r < res.length; r++) {
      var k = res[r];
      if (real[k] <= 0) continue;
      need += real[k];
      met += Math.min(real[k], got[k]);
    }
    return need <= 0 ? 1 : met / need;
  }

  /** Turn a resolution into an api.finish() payload. Shared with autoSolve. */
  function grade(puzzle, out, state, rng) {
    var C = puzzle.content;
    var n = puzzle.people.length;

    // Sitting down at all is worth something. This scene is a rescue.
    var stats = { health: 4, energy: 8, light: 0, morale: 0 };
    var k;
    for (k in out.selfStats) if (Object.prototype.hasOwnProperty.call(out.selfStats, k)) {
      stats[k] = (stats[k] || 0) + out.selfStats[k];
    }

    stats.morale += out.kept * 5 - out.short * 1 - out.cut * 8;
    stats.morale -= out.crises * 14;
    stats.health -= out.crises * 3;
    if (out.ally) stats.morale += 15;
    stats.morale -= out.enemies.length * 9;
    if (out.leftover > 0 && out.cut > 0) stats.morale -= Math.min(10, out.leftover * 2);
    if (out.selfUnits > 2 && out.cut > 0) stats.morale -= Math.min(9, (out.selfUnits - 2) * 3);

    // This scene is where the Director sends a player who just blacked out. It
    // is never allowed to be the thing that blacks them out again — the cost of
    // getting this wrong is carried entirely by morale.
    if (stats.health < 1) stats.health = 1;

    var tags = ['made_the_split'];
    if (out.ally) tags.push('kept_someone_alive');
    if (out.enemies.length) tags.push('has_enemy');
    if (out.crises) tags.push('lost_someone');
    if (out.cut === 0) tags.push('nobody_left_out');
    if (out.selfUnits === 0) tags.push('took_nothing');

    var gain = out.selfGain.slice();
    if (out.ally) gain.push('ally');                 // this is what derives has_ally

    // An enemy walks off with something of yours — but only if you have anything.
    var lose = [];
    if (out.enemies.length && state && state.inventory && state.inventory.length) {
      lose.push(rng && rng.pick ? rng.pick(state.inventory) : state.inventory[0]);
    }

    var outcome;
    if (out.crises > 0 || out.cut >= Math.max(2, Math.ceil(n / 2)) || out.enemies.length >= 2) outcome = 'fail';
    else if (out.cut === 0 && out.kept >= Math.ceil(n / 2)) outcome = 'success';
    else outcome = 'partial';

    var signals = {
      caution: 2 + (out.cut === 0 ? 1 : 0),
      logic: out.leftover === 0 ? 2 : 0,
      scavenge: Math.min(3, out.selfUnits),
      speed: 0,
      brute: out.enemies.length ? 1 : 0
    };

    var summary;
    if (out.crises) summary = 'You split ' + C.crate + ' and somebody did not come through the night.';
    else if (out.ally) summary = 'You split ' + C.crate + ' and ' + out.ally + ' decided to come with you.';
    else if (out.enemies.length) summary = 'You split ' + C.crate + ' and ' + out.enemies[0] + ' will not forget how.';
    else if (out.cut === 0) summary = 'Everyone at ' + C.place + ' got enough, which meant you did not.';
    else summary = 'You split ' + C.crate + ' as fairly as it could be split, which was not fairly enough.';

    return { outcome: outcome, stats: stats, gain: gain, lose: lose, tags: tags, signals: signals, summary: summary };
  }

  /* ================================================================ CSS == */

  var CSS = [
    '.pz-triage-panel{display:flex;flex-direction:column;gap:12px}',
    '.pz-triage-morning{display:flex;flex-direction:column;gap:14px;max-width:780px;margin:0 auto}',
    '.pz-triage-fallback{display:grid;grid-template-columns:minmax(0,1fr) minmax(228px,300px);gap:18px;align-items:start}',
    '@media (max-width:900px){.pz-triage-fallback{grid-template-columns:1fr}}',

    '.pz-triage-sheet{display:flex;flex-direction:column;gap:8px}',
    '.pz-triage-row{display:flex;flex-direction:column;gap:7px;padding:10px 11px;border-radius:10px;',
    '  background:linear-gradient(180deg,var(--panel-2),var(--panel));border:1px solid var(--line)}',
    '.pz-triage-row.is-mine{border-color:color-mix(in srgb,var(--acc) 55%,transparent);',
    '  background:linear-gradient(180deg,var(--acc-wash),var(--panel))}',
    '.pz-triage-row.is-unmet{border-style:dashed;border-color:var(--line-soft)}',

    '.pz-triage-who__top{display:flex;align-items:center;gap:7px}',
    '.pz-triage-who__ico{font-size:17px;line-height:1}',
    '.pz-triage-who__name{font-size:13px;font-weight:700;color:var(--text)}',
    '.pz-triage-who__far{margin-left:auto;font-family:var(--font-mono);font-size:9px;letter-spacing:.12em;',
    '  text-transform:uppercase;color:var(--dimmer);white-space:nowrap}',
    '.pz-triage-who__says{font-size:11.5px;line-height:1.45;color:var(--dim);font-style:italic}',
    '.pz-triage-who__asks{font-family:var(--font-mono);font-size:10px;color:var(--dimmer)}',
    '.pz-triage-tell{font-size:11.5px;line-height:1.45;color:var(--acc-2);padding-left:8px;',
    '  border-left:2px solid color-mix(in srgb,var(--acc) 55%,transparent)}',

    '.pz-triage-cells{display:flex;flex-wrap:wrap;gap:6px}',
    '.pz-triage-cell{display:flex;flex-direction:column;align-items:center;gap:2px;min-width:72px;flex:1 1 72px;',
    '  padding:5px 4px;border-radius:8px;background:rgba(0,0,0,.26);border:1px solid var(--line-soft)}',
    '.pz-triage-cell__hd{font-size:14px;line-height:1}',
    '.pz-triage-cell__lb{font-family:var(--font-mono);font-size:9px;color:var(--dimmer);text-align:center;line-height:1.2}',
    '.pz-triage-cell__lb b{color:var(--acc-2);font-weight:700}',
    '.pz-triage-cell__lb.is-empty b{color:var(--bad)}',
    '.pz-triage-step{display:flex;align-items:center;gap:3px}',
    '.pz-triage-step button{width:22px;height:22px;border-radius:6px;padding:0;font-size:13px;line-height:1;',
    '  background:var(--panel-3);border:1px solid var(--line);color:var(--text-2);cursor:pointer}',
    '.pz-triage-step button:hover:not(:disabled){border-color:var(--acc);color:var(--text)}',
    '.pz-triage-step button:disabled{opacity:.25;cursor:default}',
    '.pz-triage-step__n{min-width:20px;text-align:center;font-family:var(--font-mono);font-size:13px;color:var(--text)}',
    '.pz-triage-step__n.is-short{color:var(--warn)}',
    '.pz-triage-step__n.is-none{color:var(--dimmer)}',

    '.pz-triage-pools{display:flex;flex-wrap:wrap;gap:7px}',
    '.pz-triage-pool{display:inline-flex;align-items:center;gap:5px;padding:5px 9px;border-radius:8px;',
    '  font-family:var(--font-mono);font-size:11px;color:var(--text-2);',
    '  background:#0a0e15;border:1px solid var(--line)}',
    '.pz-triage-pool b{color:var(--acc-2)}',
    '.pz-triage-pool.is-spent b{color:var(--dimmer)}',

    '.pz-triage-fate{display:flex;gap:10px;padding:10px 12px;border-radius:10px;',
    '  background:#0a0e15;border:1px solid var(--line-soft)}',
    '.pz-triage-fate.is-kept{border-color:rgba(95,207,141,.4)}',
    '.pz-triage-fate.is-short{border-color:rgba(230,180,85,.4)}',
    '.pz-triage-fate.is-cut{border-color:rgba(226,105,95,.5);background:rgba(226,105,95,.07)}',
    '.pz-triage-fate__ico{font-size:20px;line-height:1.2}',
    '.pz-triage-fate__b{font-size:12.5px;line-height:1.55;color:var(--text-2)}',
    '.pz-triage-fate__b strong{color:var(--text)}',
    '.pz-triage-fate__truth{display:block;margin-top:5px;font-size:11.5px;color:var(--dim);font-style:italic}',

    '.pz-triage-warn{font-size:12px;line-height:1.5;color:var(--warn);padding:9px 11px;border-radius:7px;',
    '  background:rgba(230,180,85,.08);border:1px solid rgba(230,180,85,.28)}',
    '.pz-triage-warn.is-bad{color:var(--bad);background:rgba(226,105,95,.08);border-color:rgba(226,105,95,.28)}',

    '.pz-triage-tally{display:flex;flex-direction:column;gap:6px}',
    '.pz-triage-tally__row{display:flex;justify-content:space-between;gap:10px;font-family:var(--font-mono);',
    '  font-size:11px;color:var(--dim)}',
    '.pz-triage-tally__row b{color:var(--acc-2)}'
  ].join('\n');

  /* ================================================================ MOUNT = */

  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var C = puzzle.content;
    var res = puzzle.resList;
    var n = puzzle.people.length;
    var finished = false;
    var arena = null;
    var met = [];
    var s0;
    for (s0 = 0; s0 < n; s0++) met.push(false);

    var sheet = h('div', { class: 'pz-triage-sheet' });
    var pools = h('div', { class: 'pz-triage-pools' });
    var tally = h('div', { class: 'pz-triage-tally' });
    var warnBox = h('div', {});
    var stage = h('div', {});                       // the room lives here, then the morning does
    var panelRoot = h('div', { class: 'pz-triage-panel' });

    var handBtn = h('button', { class: 'pz-btn pz-btn--primary', type: 'button', text: '\uD83E\uDD1D Hand it out' });
    var evenBtn = h('button', { class: 'pz-btn pz-btn--sm', type: 'button', text: '\u2696\uFE0F Even split' });
    var needBtn = h('button', { class: 'pz-btn pz-btn--sm', type: 'button', text: '\uD83D\uDCCB As asked' });
    var clearBtn = h('button', { class: 'pz-btn pz-btn--sm', type: 'button', text: '\u21BA Start again' });
    var walkBtn = h('button', { class: 'pz-btn pz-btn--danger pz-btn--sm', type: 'button', text: '\u21A9 Walk away from it' });

    var cMet = null, cLeft = null, cKept = null;

    PS.ui.append(el, stage);

    /* ------------------------------------------------------------- pools -- */

    function left(k) {
      var used = puzzle.mine[k];
      for (var s = 0; s < n; s++) used += puzzle.alloc[s][k];
      return puzzle.pool[k] - used;
    }

    function adjust(sIdx, k, d) {
      if (finished) return;
      var cur = sIdx < 0 ? puzzle.mine[k] : puzzle.alloc[sIdx][k];
      var next = cur + d;
      if (next < 0) return;
      if (d > 0 && left(k) <= 0) return;
      if (sIdx < 0) puzzle.mine[k] = next; else puzzle.alloc[sIdx][k] = next;
      paint();
    }

    /* --------------------------------------------------------------- room -- */
    /* Everything the sheet knows about a person, it knows because you walked
       over there. Meeting somebody is the only way in.                       */

    function meet(idx) {
      if (met[idx] || finished) return;
      met[idx] = true;
      var p = puzzle.people[idx];
      api.toast(p.name + ': \u201C' + p.says + '\u201D', 'info', 5200);
      var tell = TELLS[p.truth];
      if (tell) api.toast(tell, 'bad', 5600);
      paint();
    }

    function metCount() {
      var c = 0;
      for (var s = 0; s < n; s++) if (met[s]) c++;
      return c;
    }

    function buildRoom() {
      if (!PS.arena || typeof PS.arena.create !== 'function') return false;

      var room = readRoom(ROOM);
      var spawn = room.spots['@'] || { x: 1, y: 1 };

      arena = PS.arena.create(stage, {
        map: { w: room.w, h: room.h, tiles: room.tiles },
        spawn: spawn,
        avatar: '\uD83E\uDDCD',
        light: state.stats.light,
        // Other people's lamps light this room, not yours. A player the
        // Director sent here at zero light must still see every face in it.
        lightCurve: function (v) { return 5.2 + Math.min(100, Math.max(0, v)) / 100 * 3; },
        darkness: 0.5,
        memory: 0.72
      });
      if (!arena) return false;

      teardownFns.push(function () { if (arena) { arena.destroy(); arena = null; } });
      arena.revealAll();

      cMet = arena.chip('Spoken to', '\uD83D\uDDE3\uFE0F');
      cLeft = arena.chip('Undealt', '\uD83D\uDCE6');
      cKept = arena.chip('Kept back', '\uD83E\uDDCD');

      for (var s = 0; s < n; s++) {
        (function (idx) {
          var spot = room.spots[String(idx + 1)];
          if (!spot) return;
          var p = puzzle.people[idx];
          arena.prop({
            x: spot.x, y: spot.y, icon: p.icon, label: p.name,
            hint: 'go and listen', trigger: 'proximity', radius: 1.5,
            once: false, emits: 0.55,
            onActivate: function () { meet(idx); }
          });
        })(s);
      }

      var crate = room.spots.D || { x: 1, y: 1 };
      arena.station({
        x: crate.x, y: crate.y, icon: '\uD83D\uDCE6', label: C.crate,
        hint: 'open it in front of them', radius: 1.5, emits: 2.1,
        onEnter: function (panelEl) { PS.ui.append(panelEl, panelRoot); }
      });

      arena.note('Walk over to every one of them before you open ' + C.crate +
        ' \u2014 the sheet only knows what you have gone and found out.');
      return true;
    }

    /* -------------------------------------------------------------- cards -- */

    function stepper(sIdx, k) {
      var cur = sIdx < 0 ? puzzle.mine[k] : puzzle.alloc[sIdx][k];
      var known = sIdx < 0 || met[sIdx];
      var asked = sIdx < 0 ? 0 : puzzle.people[sIdx].stated[k];
      var cls = 'pz-triage-step__n';
      if (known && sIdx >= 0 && asked > 0 && cur < asked) cls += ' is-short';
      if (cur === 0) cls += ' is-none';

      var minus = h('button', { type: 'button', text: '\u2212' });
      var plus = h('button', { type: 'button', text: '+' });
      minus.disabled = finished || cur <= 0;
      plus.disabled = finished || left(k) <= 0;
      minus.addEventListener('click', function () { adjust(sIdx, k, -1); });
      plus.addEventListener('click', function () { adjust(sIdx, k, 1); });

      var label;
      if (sIdx < 0) label = [h('b', { text: puzzle.labels[k] })];
      else if (!known) label = [h('b', { text: 'asked ?' })];
      else label = [h('b', { text: 'asked ' + asked })];

      return h('div', { class: 'pz-triage-cell' }, [
        h('div', { class: 'pz-triage-cell__hd', text: RES_ICON[k] }),
        h('div', { class: 'pz-triage-step' }, [minus, h('div', { class: cls, text: String(cur) }), plus]),
        h('div', { class: 'pz-triage-cell__lb' + (known && sIdx >= 0 && asked > 0 && cur === 0 ? ' is-empty' : '') }, label)
      ]);
    }

    function personCard(idx) {
      var p = puzzle.people[idx];
      var known = met[idx];
      var bits = [];

      var top = h('div', { class: 'pz-triage-who__top' }, [
        h('span', { class: 'pz-triage-who__ico', text: p.icon }),
        h('span', { class: 'pz-triage-who__name', text: p.name }),
        known ? null : h('span', { class: 'pz-triage-who__far', text: 'not spoken to' })
      ]);
      bits.push(top);

      if (known) {
        bits.push(h('div', { class: 'pz-triage-who__says', text: '\u201C' + p.says + '\u201D' }));
        if (TELLS[p.truth]) bits.push(h('div', { class: 'pz-triage-tell', text: TELLS[p.truth] }));
        var asksBits = [];
        for (var q = 0; q < res.length; q++) {
          if (p.stated[res[q]] > 0) asksBits.push(RES_ICON[res[q]] + p.stated[res[q]]);
        }
        bits.push(h('div', { class: 'pz-triage-who__asks', text: 'asks for  ' + asksBits.join('   ') }));
      } else {
        bits.push(h('div', { class: 'pz-triage-who__says',
          text: 'You have not been over to them. Whatever they need, you would be guessing at it.' }));
      }

      var cells = h('div', { class: 'pz-triage-cells' });
      for (var r = 0; r < res.length; r++) cells.appendChild(stepper(idx, res[r]));
      bits.push(cells);

      return h('div', { class: 'pz-triage-row' + (known ? '' : ' is-unmet') }, bits);
    }

    function paintSheet() {
      PS.ui.clear(sheet);
      for (var s = 0; s < n; s++) sheet.appendChild(personCard(s));

      var mineCells = h('div', { class: 'pz-triage-cells' });
      for (var r = 0; r < res.length; r++) mineCells.appendChild(stepper(-1, res[r]));
      sheet.appendChild(h('div', { class: 'pz-triage-row is-mine' }, [
        h('div', { class: 'pz-triage-who__top' }, [
          h('span', { class: 'pz-triage-who__ico', text: '\uD83E\uDDCD' }),
          h('span', { class: 'pz-triage-who__name', text: 'You' })
        ]),
        h('div', { class: 'pz-triage-who__says', text: youLine() }),
        mineCells
      ]));
    }

    function youLine() {
      var st = state.stats;
      if (st.health <= 35) return 'You are not going to be upright much longer without some of this and everybody can see it.';
      if (st.energy <= 30) return 'You have not eaten today either. Nobody has asked.';
      return 'Nobody put you on the list. There is nothing stopping you putting yourself on it.';
    }

    function paint() {
      if (finished) return;
      paintSheet();

      PS.ui.clear(pools);
      var anyLeft = 0;
      for (var r = 0; r < res.length; r++) {
        var k = res[r], l = left(k);
        anyLeft += l;
        pools.appendChild(h('div', { class: 'pz-triage-pool' + (l <= 0 ? ' is-spent' : '') }, [
          h('span', { text: RES_ICON[k] }),
          h('span', { text: puzzle.labels[k] }),
          h('b', { text: l + ' / ' + puzzle.pool[k] })
        ]));
      }

      PS.ui.clear(tally);
      var askedTotal = 0, poolTotal = 0, minePicked = 0;
      for (r = 0; r < res.length; r++) {
        askedTotal += puzzle.statedTotal[res[r]];
        poolTotal += puzzle.pool[res[r]];
        minePicked += puzzle.mine[res[r]];
      }
      PS.ui.append(tally, [
        trow('In the crate', String(poolTotal) + ' units'),
        trow('Spoken to', metCount() + ' of ' + n),
        trow('Kept back for you', String(minePicked)),
        trow('Still undealt', String(anyLeft))
      ]);

      needBtn.disabled = finished || metCount() === 0;

      PS.ui.clear(warnBox);
      if (metCount() < n) {
        warnBox.appendChild(h('div', { class: 'pz-triage-warn' },
          [(n - metCount()) + ' of them you have not been over to. You can still write a number against their name; you will just be inventing it.']));
      } else if (anyLeft > 0) {
        warnBox.appendChild(h('div', { class: 'pz-triage-warn' },
          [anyLeft + ' unit' + (anyLeft === 1 ? '' : 's') + ' still in the crate. ' + C.leftover]));
      } else {
        warnBox.appendChild(h('div', { class: 'pz-triage-warn is-bad' },
          ['Everything is spoken for. There is no arrangement of this that covers everybody \u2014 there was never going to be.']));
      }

      if (cMet) cMet.set(metCount() + ' / ' + n, metCount() < n ? 'warn' : null);
      if (cLeft) cLeft.set(String(anyLeft));
      if (cKept) cKept.set(String(minePicked));

      function trow(a, b) {
        return h('div', { class: 'pz-triage-tally__row' }, [h('span', { text: a }), h('b', { text: b })]);
      }
    }

    /* ------------------------------------------------------- quick fills -- */

    function clearAll() {
      for (var s = 0; s < n; s++) for (var r = 0; r < res.length; r++) puzzle.alloc[s][res[r]] = 0;
      for (r = 0; r < res.length; r++) puzzle.mine[res[r]] = 0;
    }

    evenBtn.addEventListener('click', function () {
      if (finished) return;
      clearAll();
      for (var r = 0; r < res.length; r++) {
        var k = res[r], each = Math.floor(puzzle.pool[k] / n), rem = puzzle.pool[k] - each * n;
        for (var s = 0; s < n; s++) puzzle.alloc[s][k] = each + (s < rem ? 1 : 0);
      }
      paint();
    });

    // Only fills the rows of people you have actually stood in front of —
    // otherwise the shortcut would hand you every figure in the room for free.
    needBtn.addEventListener('click', function () {
      if (finished) return;
      clearAll();
      for (var r = 0; r < res.length; r++) {
        var k = res[r], remain = puzzle.pool[k];
        for (var s = 0; s < n && remain > 0; s++) {
          if (!met[s]) continue;
          var take = Math.min(remain, puzzle.people[s].stated[k]);
          puzzle.alloc[s][k] = take;
          remain -= take;
        }
      }
      paint();
    });

    clearBtn.addEventListener('click', function () { if (!finished) { clearAll(); paint(); } });

    /* --------------------------------------------------------- resolution -- */

    handBtn.addEventListener('click', function () {
      if (finished) return;
      var out = resolve(puzzle);
      finished = true;
      puzzle.handedOut = true;
      if (arena) { arena.destroy(); arena = null; }
      cMet = cLeft = cKept = null;
      renderFates(out);
    });

    function renderFates(out) {
      PS.ui.clear(stage);

      var cards = [];
      for (var i = 0; i < out.fates.length; i++) {
        var f = out.fates[i];
        var line;
        if (f.crisis) line = f.name + ' does not get up in the morning. Somebody else has to tell you.';
        else if (f.band === 'kept') line = f.name + ' has enough. They sleep, and that turns out to be the whole of it.';
        else if (f.band === 'short') line = f.name + ' gets through the night on less than they asked for, and does not complain anywhere you can hear it.';
        else line = f.name + ' got almost nothing out of it, and stops speaking to you somewhere around midnight.';

        cards.push(h('div', { class: 'pz-triage-fate is-' + (f.crisis ? 'cut' : f.band) }, [
          h('div', { class: 'pz-triage-fate__ico', text: f.icon }),
          h('div', { class: 'pz-triage-fate__b' }, [
            h('strong', { text: line }),
            h('span', { class: 'pz-triage-fate__truth', text: truthById(f.truth).reveal(f.name) })
          ])
        ]));
      }

      if (out.ally) {
        cards.push(h('div', { class: 'pz-triage-fate is-kept' }, [
          h('div', { class: 'pz-triage-fate__ico', text: '\uD83E\uDD1D' }),
          h('div', { class: 'pz-triage-fate__b' }, [
            h('strong', { text: out.ally + ' is up before you are, packed, and waiting by the door.' }),
            h('span', { class: 'pz-triage-fate__truth', text: 'They are coming with you. You did not ask and they did not offer \u2014 it is simply decided.' })
          ])
        ]));
      }
      if (out.enemies.length) {
        cards.push(h('div', { class: 'pz-triage-fate is-cut' }, [
          h('div', { class: 'pz-triage-fate__ico', text: '\uD83D\uDD25' }),
          h('div', { class: 'pz-triage-fate__b' }, [
            h('strong', { text: out.enemies.join(' and ') + ' will be telling this story for a long time, and you are not the one who comes out of it well.' }),
            h('span', { class: 'pz-triage-fate__truth', text: 'People downstream of here are going to have heard your description before they ever meet you.' })
          ])
        ]));
      }

      var missed = n - metCount();
      PS.ui.append(stage, h('div', { class: 'pz-triage-morning' }, [
        h('div', { class: 'pz-intro', text: out.cut === 0
          ? 'Nobody at ' + C.place + ' went without. It came out of you and everybody knows exactly where it came from.'
          : 'It is done, and it is morning, and now you find out what everyone was not telling you.' }),
        missed > 0 ? h('div', { class: 'pz-triage-warn is-bad', text:
          'You never went over to ' + missed + ' of them. You find out what they needed at the same time as everybody else does.' }) : null,
        h('div', { class: 'pz-col' }, cards),
        h('div', { class: 'pz-choices' }, [branch(C.branchA, out), branch(C.branchB, out)])
      ]));

      if (out.crises || out.enemies.length) api.toast('Some of that is going to follow you.', 'bad', 4200);
      else if (out.ally) api.flash();
    }

    function branch(spec, out) {
      var b = h('button', { class: 'pz-choice', type: 'button' }, [
        h('div', { class: 'pz-choice__i', text: spec.icon }),
        h('div', { class: 'pz-choice__t', text: spec.title }),
        h('div', { class: 'pz-choice__d', text: spec.desc })
      ]);
      b.addEventListener('click', function () {
        var result = grade(puzzle, out, state, api.rng);
        result.choice = spec.id;
        api.finish(result);
      });
      return b;
    }

    walkBtn.addEventListener('click', function () {
      if (finished) return;
      finished = true;
      if (arena) { arena.destroy(); arena = null; }
      api.finish({
        outcome: 'fail',
        stats: { health: 2, energy: 4, morale: -18 },
        gain: [], lose: [],
        tags: ['walked_past', 'has_enemy'],
        signals: { speed: 2, caution: 1, logic: 0 },
        choice: null,
        summary: 'You put the crate down in front of them and left without opening it.'
      });
    });

    /* ------------------------------------------------------------- layout -- */

    PS.ui.append(panelRoot, [
      h('div', { class: 'pz-note', text: C.lead }),
      pools,
      sheet,
      h('div', { class: 'pz-row' }, [handBtn, evenBtn, needBtn, clearBtn]),
      tally,
      warnBox,
      h('div', { class: 'pz-note', text: 'What you keep goes into you. Nobody will stop you. That is the difficulty.' }),
      walkBtn
    ]);

    if (!buildRoom()) {
      // No arena layer: nothing is hidden, because nothing can be walked to.
      for (s0 = 0; s0 < n; s0++) met[s0] = true;
      PS.ui.append(stage, h('div', { class: 'pz-triage-fallback' }, [panelRoot]));
    }

    paint();
    if (arena) arena.focus();
  }

  function unmount() {
    while (teardownFns.length) {
      try { teardownFns.pop()(); } catch (e) { /* keep unwinding */ }
    }
  }

  /* ================================================================ HINT = */

  function hint(puzzle, state) {
    var res = puzzle.resList;
    var loud = null, quiet = null;
    for (var s = 0; s < puzzle.people.length; s++) {
      var p = puzzle.people[s];
      if (p.truth === 'overstated' && !loud) loud = p.name;
      if ((p.truth === 'understated' || p.truth === 'critical') && !quiet) quiet = p.name;
    }
    if (state && state.stats.health <= 35) {
      return 'You are the one bleeding. Whatever you decide about them, the row with your name on it is not a moral question tonight.';
    }
    if (quiet) return 'Watch ' + quiet + '. What they asked for and what they need are not the same number, and they are not going to say so.';
    if (loud) return 'Somebody here has padded their figure, and it is the one who sounded most reasonable about it.';
    return 'There is not enough. Decide who you can look at in the morning and work backwards from that.';
  }

  /* ============================================================ AUTOSOLVE = */
  /* Headless. Allocates the way a decent, tired person would: needs first in a
     random order, one unit held back, then runs the real resolution. */

  function autoSolve(puzzle, rng, state) {
    var res = puzzle.resList, n = puzzle.people.length, r, s, k, i;

    for (s = 0; s < n; s++) for (r = 0; r < res.length; r++) puzzle.alloc[s][res[r]] = 0;
    for (r = 0; r < res.length; r++) puzzle.mine[res[r]] = 0;

    // Hurt people keep a little back, and they take the thing that stops the
    // bleeding first. That is the whole temptation, so the bot should feel it.
    var selfish = state && state.stats && state.stats.health < 45;
    for (r = 0; r < res.length; r++) {
      k = res[r];
      var worthIt = (k === 'meds' && puzzle.pool[k] >= 2) || (k === 'food' && puzzle.pool[k] >= 3);
      puzzle.mine[k] = (selfish && worthIt) ? 1 : 0;
    }

    // Three defensible ways to read the room, none of them right.
    //   even     — split it in proportion to what was asked and refuse to judge
    //   balanced — everyone gets a survivable floor, then top up the cheap ones
    //   decisive — a thin floor and real favourites, which is how people die
    var mode = rng.pick(['even', 'balanced', 'decisive']);
    var floorPct = mode === 'balanced' ? 0.5 : 0.3;

    // Serve the modest askers first: it is what anybody actually does, and it
    // is also what makes the loud ones the last to find out.
    var order = [], totals = [];
    for (s = 0; s < n; s++) {
      var tot = 0;
      for (r = 0; r < res.length; r++) tot += puzzle.people[s].stated[res[r]];
      totals.push(tot); order.push(s);
    }
    order.sort(function (a, b) { return totals[a] - totals[b]; });

    for (r = 0; r < res.length; r++) {
      k = res[r];
      var remain = puzzle.pool[k] - puzzle.mine[k];
      if (remain <= 0) continue;
      var asked = puzzle.statedTotal[k];

      if (mode === 'even' && asked > 0) {
        // Largest remainder, so a one-unit asker is never rounded to nothing.
        var fracs = [], base = remain;
        for (s = 0; s < n; s++) {
          var q = puzzle.people[s].stated[k] * base / asked;
          var whole = Math.min(remain, Math.floor(q));
          puzzle.alloc[s][k] = whole;
          remain -= whole;
          fracs.push({ s: s, f: q - Math.floor(q) });
        }
        fracs.sort(function (a, b) { return b.f - a.f; });
        for (i = 0; i < fracs.length && remain > 0; i++) {
          if (puzzle.people[fracs[i].s].stated[k] <= 0) continue;
          puzzle.alloc[fracs[i].s][k] += 1; remain -= 1;
        }
      } else {
        for (i = 0; i < order.length && remain > 0; i++) {          // survivable floor
          s = order[i];
          if (puzzle.people[s].stated[k] <= 0) continue;
          var fl = Math.min(remain, Math.max(1, Math.round(puzzle.people[s].stated[k] * floorPct)));
          puzzle.alloc[s][k] += fl; remain -= fl;
        }
        for (i = 0; i < order.length && remain > 0; i++) {          // then top up
          s = order[i];
          var up = Math.min(remain, puzzle.people[s].stated[k] - puzzle.alloc[s][k]);
          if (up > 0) { puzzle.alloc[s][k] += up; remain -= up; }
        }
      }

      // Nothing is left sitting in the crate — that reads as hoarding, and it
      // is not what anybody standing there would actually do.
      var guard = 0;
      while (remain > 0 && guard++ < 40) {
        var best = -1, bestGap = -2;
        for (s = 0; s < n; s++) {
          var gap = puzzle.people[s].stated[k] - puzzle.alloc[s][k];
          if (gap > bestGap) { bestGap = gap; best = s; }
        }
        if (best < 0) break;
        puzzle.alloc[best][k] += 1;
        remain -= 1;
      }
    }

    var out = resolve(puzzle);
    var result = grade(puzzle, out, state, rng);
    result.choice = rng.chance(0.5) ? puzzle.content.branchA.id : puzzle.content.branchB.id;
    return result;
  }

  /* ============================================================ REGISTER = */

  PS.registry.register({
    id: 'allocation_triage',
    name: 'Allocation Triage',
    icon: '\uD83E\uDD6B',
    blurb: 'There is less than they need. Everyone is telling you the truth about something else.',

    favors:   { caution: 2 },
    provides: ['triage', 'medical', 'supplies'],
    tagHooks: ['has_ally'],

    // Unconditional, and it must stay that way: this is where the Director
    // sends the player after a blackout, with an empty pack and nothing left.
    requires: function () { return true; },

    css: CSS,

    skins: [
      {
        id: 'storm_shelter', biome: 'shelter', title: 'Storm Shelter Rations',
        icon: '\uD83C\uDF2A\uFE0F', palette: 'bone',
        intro: 'The wind has been doing the same thing to the same window for nine hours. There are more people in here than the sign on the door allows and considerably less in the store than the sign on the store says. Somebody has to open it in front of everyone.',
        nouns: { crate: 'the shelter store', people: 'the others', place: 'the shelter' }
      },
      {
        id: 'medicine_convoy', biome: 'urban', title: 'Medicine Convoy',
        icon: '\uD83D\uDE91', palette: 'steel',
        intro: 'One truck out of two made it to the depot, which means the pallet in front of you is a plan for twice this many people. They are standing in a rough line that everybody is pretending is not a line.',
        nouns: { crate: 'the pallet', people: 'the queue', place: 'the depot' }
      },
      {
        id: 'fuel_split', biome: 'wilderness', title: 'Fuel Split',
        icon: '\u26FD', palette: 'moss',
        intro: 'Four bottles, one stove, and a night that is going to take the temperature down another twelve degrees. Everybody around this circle has already worked out how far their share gets them. They are waiting to see whether you have.',
        nouns: { crate: 'the fuel', people: 'the party', place: 'the col' }
      }
    ],

    build: build,
    mount: mount,
    unmount: unmount,
    hint: hint,
    autoSolve: autoSolve
  });

})(typeof window !== 'undefined' ? window : this);
