/* ==========================================================================
   PuzzleStudio — core/crossroad.js
   The beat between encounters. Shows what the last scene cost you, then asks
   a short thematic question. The answer is stored on state.crossroad and the
   Director reads its `provides` / `biome` / `favors` to steer what comes next.

   Choices are content, not mechanics: adding an option here changes flavour,
   never the contract. Engines never need to know this file exists.

   Loads with NO side effects beyond defining PuzzleStudio.crossroad.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio || (root.PuzzleStudio = {});

  /* ------------------------------------------------------------------------
     OPTION POOL
     id       — becomes state.crossroad.id, and matches director CHOICE_HINTS
     biome    — where this choice points
     provides — what the player is asking for; engines advertise the same tokens
     favors   — playstyle nudge
     cost     — stat deltas applied immediately (movement has a price)
     when     — optional gate
     ------------------------------------------------------------------------ */
  var POOL = [
    {
      id: 'descend', icon: '\uD83D\uDD73\uFE0F', title: 'Crawl deeper',
      desc: 'Down is away from whatever is up there. It is also darker.',
      biome: 'underground', provides: ['light_source', 'map'], favors: { caution: 1 },
      cost: { energy: -4, light: -3 }, tag: 'went_down',
      from: ['indoor', 'underground', 'industrial', 'shelter', 'water']
    },
    {
      id: 'climb', icon: '\uD83E\uDDD7', title: 'Climb toward the light',
      desc: 'Height buys you a view. It costs everything in your legs.',
      biome: 'urban', provides: ['map', 'vantage'], favors: { speed: 1 },
      cost: { energy: -8, morale: 3 }, tag: 'went_up',
      from: ['underground', 'indoor', 'industrial', 'urban', 'wilderness']
    },
    {
      id: 'wade', icon: '\uD83C\uDF0A', title: 'Take the flooded route',
      desc: 'Cold to the chest, but nobody follows you through water.',
      biome: 'water', provides: ['crossing'], favors: { caution: 1 },
      cost: { energy: -6, health: -2, light: -5 }, tag: 'went_wet',
      from: ['underground', 'water', 'industrial', 'indoor', 'wilderness']
    },
    {
      id: 'scavenge', icon: '\uD83D\uDD26', title: 'Strip the room first',
      desc: 'Five more minutes here might be worth an hour later.',
      biome: 'industrial', provides: ['salvage', 'load_out'], favors: { scavenge: 2 },
      cost: { energy: -5 }, tag: 'lingered',
      from: null
    },
    {
      id: 'sprint', icon: '\uD83D\uDCA8', title: 'Move now, think later',
      desc: 'Whatever is behind you is not getting slower.',
      biome: 'urban', provides: ['crossing'], favors: { speed: 2 },
      cost: { energy: -9, morale: 2 }, tag: 'ran',
      from: null
    },
    {
      id: 'shelter', icon: '\uD83C\uDFE0', title: 'Find somewhere to stop',
      desc: 'Twenty minutes with your back to a wall changes a lot.',
      biome: 'shelter', provides: ['rest', 'medical'], favors: { caution: 2 },
      cost: { energy: 24, health: 9, morale: 8, light: -6 }, tag: 'rested',
      when: function (s) { return s.stats.energy < 78 || s.stats.morale < 68 || s.stats.health < 72; },
      from: null
    },
    {
      id: 'forage', icon: '\uD83C\uDF3F', title: 'Push out into the open',
      desc: 'Air, weather, and nothing overhead to fall on you.',
      biome: 'wilderness', provides: ['food', 'salvage'], favors: { scavenge: 1 },
      cost: { energy: -7, morale: 4 }, tag: 'went_out',
      from: ['urban', 'wilderness', 'shelter', 'industrial']
    },
    {
      id: 'signal', icon: '\uD83D\uDCFB', title: 'Try to raise someone',
      desc: 'A voice on the other end would be worth the noise.',
      biome: 'urban', provides: ['ally', 'information'], favors: { logic: 1 },
      cost: { energy: -3, morale: 5 }, tag: 'called_out',
      when: function (s) { return s.has('radio') || s.has('whistle') || s.stats.morale < 55; },
      from: null
    },
    {
      id: 'crawl', icon: '\uD83E\uDEE7', title: 'Take the service gap',
      desc: 'Tight, filthy, and nobody looks there.',
      biome: 'indoor', provides: ['light_source', 'information'], favors: { caution: 2 },
      cost: { energy: -6, light: -4 }, tag: 'went_quiet',
      from: null
    },
    {
      id: 'trade', icon: '\uD83E\uDD1D', title: 'Deal with whoever is here',
      desc: 'They want something. So do you.',
      biome: 'urban', provides: ['trade', 'ally'], favors: { scavenge: 1 },
      cost: { morale: 4 }, tag: 'made_a_deal',
      when: function (s) { return s.hasTag('has_ally') || s.has('coin'); },
      from: null
    }
  ];

  var OUTCOME_LINE = {
    success: { icon: '\u2705', cls: 'ok',   word: 'You got out clean.' },
    partial: { icon: '\u26A0\uFE0F', cls: 'part', word: 'You got out. Barely.' },
    fail:    { icon: '\u274C', cls: 'bad',  word: 'That went badly.' }
  };

  function eligible(state) {
    return POOL.filter(function (o) {
      if (o.from && o.from.indexOf(state.biome) < 0) return false;
      if (o.when) { try { if (!o.when(state)) return false; } catch (e) { return false; } }
      return true;
    });
  }

  /** Pick 2–3 distinct options, biased toward biome-adjacent destinations. */
  function offer(state, rng) {
    var pool = eligible(state);
    if (pool.length < 2) pool = POOL.slice();

    var n = Math.min(pool.length, rng.chance(0.6) ? 3 : 2);
    var picked = [];
    var remaining = pool.slice();
    var lastId = state.last && state.last.choice;

    // A pressure valve the player can always reach for. Without a guaranteed
    // way to recover, an infinite run just grinds everyone to zero.
    if (state.stats.energy < 28 || state.stats.health < 34) {
      var rest = null;
      for (var i = 0; i < remaining.length; i++) if (remaining[i].id === 'shelter') rest = remaining[i];
      if (rest) { picked.push(rest); remaining.splice(remaining.indexOf(rest), 1); }
    }

    while (picked.length < n && remaining.length) {
      var chosen = rng.weighted(remaining, function (o) {
        var w = PS.director.ringWeight(state.biome, o.biome);
        if (o.id === lastId) w *= 0.4;                       // don't offer the same beat twice
        if (state.stats.light < 30 && o.provides.indexOf('light_source') >= 0) w *= 2.4;
        if (state.stats.health < 40 && o.provides.indexOf('medical') >= 0) w *= 2.4;
        if (state.stats.energy < 30 && o.provides.indexOf('rest') >= 0) w *= 2.6;
        return Math.max(0.2, w);
      });
      picked.push(chosen);
      remaining.splice(remaining.indexOf(chosen), 1);
    }
    return picked;
  }

  /* --------------------------------------------------------------- render -- */

  function deltaPills(h, report) {
    var out = [], k;
    for (k in report.deltas) {
      if (!Object.prototype.hasOwnProperty.call(report.deltas, k)) continue;
      var d = report.deltas[k];
      var meta = PS.state.STAT_META[k];
      out.push(h('span', { class: 'ps-delta ' + (d > 0 ? 'up' : 'down') },
        [meta.icon + ' ' + (d > 0 ? '+' : '') + d]));
    }
    for (var i = 0; i < report.gained.length; i++) {
      var g = PS.state.itemInfo(report.gained[i]);
      out.push(h('span', { class: 'ps-delta up' }, [g.icon + ' +' + g.name]));
    }
    for (var j = 0; j < report.lost.length; j++) {
      var l = PS.state.itemInfo(report.lost[j]);
      out.push(h('span', { class: 'ps-delta down' }, [l.icon + ' \u2212' + l.name]));
    }
    if (!out.length) out.push(h('span', { class: 'pz-note', text: 'Nothing changed. That is its own kind of luck.' }));
    return out;
  }

  /**
   * Render the interstitial into `el`.
   * @param {HTMLElement} el
   * @param {State} state
   * @param {object} report   from state.applyResult
   * @param {object} rng
   * @param {function(option)} onPick
   */
  function render(el, state, report, rng, onPick) {
    var h = PS.ui.h;
    var last = state.last || {};
    var o = OUTCOME_LINE[last.outcome] || OUTCOME_LINE.partial;
    var options = offer(state, rng);
    var locked = false;

    var scene = h('div', { class: 'pz-scene' }, [
      h('div', { class: 'pz-verdict ' + o.cls }, [
        h('div', { class: 'pz-verdict__i', text: last.icon || '\uD83E\uDDED' }),
        h('div', {}, [
          h('div', { class: 'pz-verdict__t', text: o.word }),
          h('div', { class: 'pz-note', text: last.summary || 'You keep moving.' })
        ])
      ]),

      h('div', { class: 'pz-card' }, [
        h('div', { class: 'pz-card__head', text: 'What it cost you' }),
        h('div', { class: 'pz-deltas' }, deltaPills(h, report))
      ]),

      report.blackout ? h('div', { class: 'pz-card' }, [
        h('div', { class: 'pz-card__head', text: 'You went down' }),
        h('div', { class: 'pz-note' }, [
          'You woke up somewhere else with your pack emptied and a headache ',
          'you will keep. ', h('strong', { text: 'The run does not end.' })
        ])
      ]) : null,

      h('div', { class: 'pz-intro' }, [
        'Depth ', h('em', { text: String(state.depth) }), ' \u00B7 tier ',
        h('em', { text: 'T' + state.tier() }), '. ', crossroadLine(state, rng)
      ]),

      h('div', { class: 'pz-choices' }, options.map(function (opt) {
        return h('button', {
          class: 'pz-choice', type: 'button',
          onclick: function () {
            if (locked) return;
            locked = true;
            var report2 = state.applyTweak(opt.cost, null, null, opt.tag ? [opt.tag] : null);
            state.crossroad = {
              id: opt.id, biome: opt.biome,
              provides: opt.provides.slice(), favors: opt.favors || {}
            };
            var changed = Object.keys(report2.deltas).length;
            if (changed) PS.ui.toast(opt.title, 'info');
            onPick(opt);
          }
        }, [
          h('div', { class: 'pz-choice__i', text: opt.icon }),
          h('div', { class: 'pz-choice__t', text: opt.title }),
          h('div', { class: 'pz-choice__d', text: opt.desc }),
          h('div', { class: 'pz-choice__tag', text: costLabel(opt.cost) })
        ]);
      }))
    ]);

    el.appendChild(scene);
  }

  function costLabel(cost) {
    var bits = [], k;
    for (k in cost || {}) {
      if (!Object.prototype.hasOwnProperty.call(cost, k)) continue;
      var meta = PS.state.STAT_META[k];
      if (!meta || !cost[k]) continue;
      bits.push(meta.icon + (cost[k] > 0 ? '+' : '') + cost[k]);
    }
    return bits.length ? bits.join('  ') : 'no cost';
  }

  var LINES = {
    indoor:      ['Corridors in both directions and no signage left.', 'The building is still making noises it should not make.'],
    underground: ['The tunnel branches. Neither branch smells better.', 'Somewhere below you, water is moving.'],
    water:       ['The floor is gone under a foot of cold.', 'Whatever floats past you, do not look at it.'],
    industrial:  ['Machines that stopped mid-cycle. Something still has power.', 'Grease, rust, and a draft from somewhere.'],
    urban:       ['Street level. Empty in a way streets are not supposed to be.', 'Glass everywhere and nobody sweeping it.'],
    wilderness:  ['Open ground, weather coming in sideways.', 'No walls. That is better and much worse.'],
    shelter:     ['Four walls and a door that shuts. For now.', 'Someone stocked this place and then left in a hurry.']
  };

  function crossroadLine(state, rng) {
    var pool = LINES[state.biome] || LINES.indoor;
    if (state.stats.light < 20) return 'You are almost out of light. Choose fast.';
    if (state.stats.health < 25) return 'You are leaving a trail. Choose carefully.';
    if (state.stats.energy < 20) return 'Your legs are done arguing. Choose something short.';
    return rng.pick(pool);
  }

  /** Headless helper the autoplay bot and smoke test use. */
  function autoPick(state, rng) {
    var options = offer(state, rng);
    return rng.pick(options);
  }

  PS.crossroad = {
    POOL: POOL,
    offer: offer,
    render: render,
    autoPick: autoPick
  };

})(typeof window !== 'undefined' ? window : this);
