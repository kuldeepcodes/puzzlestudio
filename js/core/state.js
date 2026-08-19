/* ==========================================================================
   PuzzleStudio — core/state.js
   The run: four stats, a pack, a set of tags, a depth counter and a history.
   Engines never mutate state directly — they describe what happened through
   api.finish(result) and state.applyResult() is the single place that changes
   anything. That is what keeps 20 parallel engines from fighting each other.

   Loads with NO side effects beyond defining PuzzleStudio.state.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio || (root.PuzzleStudio = {});

  var STAT_KEYS = ['health', 'energy', 'light', 'morale'];

  var STAT_META = {
    health: { icon: '\u2764\uFE0F', name: 'Health', hint: 'Hits zero and you black out. You never die.' },
    energy: { icon: '\u26A1',      name: 'Energy', hint: 'Spent by searching, climbing, forcing things.' },
    light:  { icon: '\uD83D\uDD26', name: 'Light',  hint: 'How far you can see. Drains in the dark.' },
    morale: { icon: '\uD83E\uDDE0', name: 'Morale', hint: 'Composure. Low morale makes hints cost more.' }
  };

  /* ------------------------------------------------------------------------
     ITEM CATALOG
     Engines may gain/lose any id. Unknown ids still work (generic icon), but
     add well-known survival items here so the HUD reads nicely.
     ------------------------------------------------------------------------ */
  var ITEMS = {
    rope:      { icon: '\uD83E\uDEA2', name: 'Rope',        desc: 'Twelve metres of climbing line.' },
    flare:     { icon: '\uD83E\uDDE8', name: 'Flare',       desc: 'One burn. Blinding, brief, loud.' },
    battery:   { icon: '\uD83D\uDD0B', name: 'Battery',     desc: 'Half charge. Feeds a lamp or a panel.' },
    wire:      { icon: '\uD83E\uDDF5', name: 'Wire',        desc: 'Stiff copper. Good for locks.' },
    pin:       { icon: '\uD83D\uDCCC', name: 'Pin',         desc: 'A bent tension pin.' },
    lamp:      { icon: '\uD83C\uDFEE', name: 'Lamp',        desc: 'Steady light while it has fuel.' },
    torch:     { icon: '\uD83D\uDD25', name: 'Torch',       desc: 'Burns hot, burns fast.' },
    fuel:      { icon: '\u26FD',      name: 'Fuel',        desc: 'A slosh of something flammable.' },
    medkit:    { icon: '\uD83E\uDE79', name: 'Medkit',      desc: 'Closes what is open.' },
    bandage:   { icon: '\uD83E\uDE7A', name: 'Bandage',     desc: 'Buys time, not much else.' },
    ration:    { icon: '\uD83E\uDD6B', name: 'Ration',      desc: 'Cold, salty, welcome.' },
    water:     { icon: '\uD83D\uDCA7', name: 'Water',       desc: 'Two mouthfuls left.' },
    keycard:   { icon: '\uD83D\uDCB3', name: 'Keycard',     desc: 'Someone else\u2019s clearance.' },
    crowbar:   { icon: '\uD83D\uDD28', name: 'Crowbar',     desc: 'Answers most doors, loudly.' },
    map:       { icon: '\uD83D\uDDFA\uFE0F', name: 'Map',   desc: 'Out of date, better than nothing.' },
    radio:     { icon: '\uD83D\uDCFB', name: 'Radio',       desc: 'Static, and sometimes a voice.' },
    matches:   { icon: '\uD83E\uDDF9', name: 'Matches',     desc: 'Damp. Maybe three good ones.' },
    mask:      { icon: '\uD83D\uDE37', name: 'Mask',        desc: 'Filters the worst of it.' },
    knife:     { icon: '\uD83D\uDD2A', name: 'Knife',       desc: 'Cuts rope, cord, argument.' },
    tape:      { icon: '\uD83E\uDDF7', name: 'Tape',        desc: 'Holds anything for ten minutes.' },
    glowstick: { icon: '\uD83D\uDFE2', name: 'Glowstick',   desc: 'Cold green light, no heat.' },
    whistle:   { icon: '\uD83D\uDCE3', name: 'Whistle',     desc: 'Carries further than a shout.' },
    boots:     { icon: '\uD83E\uDD7E', name: 'Boots',       desc: 'Dry, for now.' },
    blanket:   { icon: '\uD83E\uDDF6', name: 'Blanket',     desc: 'Wool. Heavy when wet.' },
    coin:      { icon: '\uD83E\uDE99', name: 'Token',       desc: 'Buys a favour somewhere.' },
    ally:      { icon: '\uD83E\uDD1D', name: 'Ally',        desc: 'Someone else who wants out.' },
    magnet:    { icon: '\uD83E\uDDF2', name: 'Magnet',      desc: 'Fishes metal out of grates.' },
    gloves:    { icon: '\uD83E\uDDE4', name: 'Gloves',      desc: 'Glass and wire stop mattering.' },
    canister:  { icon: '\uD83D\uDEE2\uFE0F', name: 'Canister', desc: 'Pressurised. Handle gently.' },
    manual:    { icon: '\uD83D\uDCD8', name: 'Manual',      desc: 'Dense, dry, occasionally decisive.' }
  };

  function itemInfo(id) {
    return ITEMS[id] || { icon: '\uD83D\uDCE6', name: prettify(id), desc: 'Scavenged. Purpose unclear.' };
  }

  function prettify(id) {
    return String(id || '?').replace(/[_-]+/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); });
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  /* ------------------------------------------------------------------------
     Tags derived automatically from inventory, so engines that declare
     tagHooks: ['has_lamp'] work without every other engine remembering to
     set the tag. Derived tags are recomputed on every apply.
     ------------------------------------------------------------------------ */
  var DERIVED = [
    { tag: 'has_lamp',    any: ['lamp', 'torch', 'flare', 'glowstick'] },
    { tag: 'has_medkit',  any: ['medkit', 'bandage'] },
    { tag: 'has_ally',    any: ['ally'] },
    { tag: 'has_tools',   any: ['crowbar', 'knife', 'wire', 'pin', 'magnet'] },
    { tag: 'has_map',     any: ['map'] },
    { tag: 'has_rations', any: ['ration', 'water'] }
  ];

  function State(opts) {
    opts = opts || {};
    this.version   = 1;
    this.runSeed   = opts.runSeed !== undefined ? opts.runSeed : PS.rng.hash(String(Date.now()), String(Math.random()));
    this.seedLabel = opts.seedLabel || String(this.runSeed);
    this.depth     = opts.depth || 0;
    this.biome     = opts.biome || 'indoor';
    this.stats     = { health: 100, energy: 100, light: 100, morale: 100 };
    this.inventory = [];
    this.tags      = {};                  // Set-like: { tagName: true }
    this.history   = [];                  // [{ engineId, engineName, skinId, title, icon, outcome, depth, biome, summary, choice }]
    this.last      = null;                // last history entry (the Director reads this)
    this.crossroad = null;                // choice id taken at the last crossroad
    this.blackout  = false;               // set for exactly one Director pick after health hits 0
    this.blackouts = 0;
    this.startedAt = opts.startedAt || Date.now();
    this._listeners = [];
    this.deriveTags();
  }

  State.prototype.on = function (fn) {
    this._listeners.push(fn);
    var self = this;
    return function () {
      var i = self._listeners.indexOf(fn);
      if (i >= 0) self._listeners.splice(i, 1);
    };
  };

  State.prototype.emit = function (evt, payload) {
    for (var i = 0; i < this._listeners.length; i++) {
      try { this._listeners[i](evt, payload, this); }
      catch (e) { if (root.console) console.warn('[PuzzleStudio] state listener threw:', e); }
    }
  };

  /**
   * tier = 1 + floor(depth / 6), plateauing at T12.
   * The plateau matters: the run is infinite, so an uncapped curve would
   * eventually make every engine's costs absurd. Engines should still clamp
   * their own scaling on top of this (see CONTRACT.md).
   */
  State.prototype.tier = function () { return Math.min(12, 1 + Math.floor(this.depth / 6)); };

  State.prototype.has = function (id) { return this.inventory.indexOf(id) >= 0; };

  State.prototype.hasAny = function (ids) {
    for (var i = 0; i < (ids || []).length; i++) if (this.has(ids[i])) return true;
    return false;
  };

  State.prototype.hasTag = function (t) { return !!this.tags[t]; };

  State.prototype.addTag = function (t) { if (t) this.tags[t] = true; };

  State.prototype.tagList = function () {
    var out = [], k;
    for (k in this.tags) if (Object.prototype.hasOwnProperty.call(this.tags, k)) out.push(k);
    return out;
  };

  State.prototype.deriveTags = function () {
    for (var i = 0; i < DERIVED.length; i++) {
      var d = DERIVED[i];
      if (this.hasAny(d.any)) this.tags[d.tag] = true;
      else delete this.tags[d.tag];
    }
  };

  /**
   * Apply one engine result. THE single mutation point.
   * @returns {object} report { deltas, gained, lost, blackout, outcome }
   */
  State.prototype.applyResult = function (result, scene) {
    result = result || {};
    var report = { deltas: {}, gained: [], lost: [], blackout: false, outcome: result.outcome || 'partial' };
    var i, k;

    // --- stats -------------------------------------------------------------
    var deltas = result.stats || {};
    for (i = 0; i < STAT_KEYS.length; i++) {
      k = STAT_KEYS[i];
      var d = Number(deltas[k]);
      if (!d || !isFinite(d)) continue;
      var before = this.stats[k];
      this.stats[k] = clamp(Math.round(before + d), 0, 100);
      var actual = this.stats[k] - before;
      if (actual !== 0) report.deltas[k] = actual;
    }

    // --- items -------------------------------------------------------------
    var gain = result.gain || [];
    for (i = 0; i < gain.length; i++) {
      if (!gain[i]) continue;
      this.inventory.push(gain[i]);
      report.gained.push(gain[i]);
    }
    var lose = result.lose || [];
    for (i = 0; i < lose.length; i++) {
      var idx = this.inventory.indexOf(lose[i]);
      if (idx >= 0) { this.inventory.splice(idx, 1); report.lost.push(lose[i]); }
    }
    if (this.inventory.length > 24) this.inventory = this.inventory.slice(-24);

    // --- tags --------------------------------------------------------------
    var tags = result.tags || [];
    for (i = 0; i < tags.length; i++) this.addTag(tags[i]);

    // --- history -----------------------------------------------------------
    scene = scene || {};
    var entry = {
      engineId:   scene.engineId || 'unknown',
      engineName: scene.engineName || prettify(scene.engineId),
      skinId:     scene.skinId || 'unknown',
      title:      scene.title || 'Somewhere',
      icon:       scene.icon || '\u2753',
      biome:      scene.biome || this.biome,
      depth:      this.depth,
      outcome:    report.outcome,
      choice:     result.choice === undefined ? null : result.choice,
      summary:    result.summary || '',
      signals:    result.signals || {}
    };
    this.history.push(entry);
    if (this.history.length > 200) this.history = this.history.slice(-200);
    this.last  = entry;
    this.biome = entry.biome;
    this.depth += 1;

    this.deriveTags();

    // --- blackout ----------------------------------------------------------
    // Failure never ends the run. Zero health = you wake somewhere else with
    // nothing. The Director consumes state.blackout on the very next pick.
    if (this.stats.health <= 0) {
      report.blackout = true;
      this.blackout = true;
      this.blackouts += 1;
      this.inventory = [];
      this.stats.health = 30;
      this.stats.energy = Math.max(this.stats.energy, 25);
      this.stats.morale = Math.max(0, this.stats.morale - 10);
      this.addTag('blacked_out');
      this.deriveTags();
    }

    this.emit('change', report);
    return report;
  };

  /**
   * A small change that is NOT a scene: crossroad choices, ambient drift.
   * Does not touch depth or history. Same clamping and events as applyResult.
   */
  State.prototype.applyTweak = function (deltas, gain, lose, tags) {
    var report = { deltas: {}, gained: [], lost: [], blackout: false }, i, k;
    deltas = deltas || {};
    for (i = 0; i < STAT_KEYS.length; i++) {
      k = STAT_KEYS[i];
      var d = Number(deltas[k]);
      if (!d || !isFinite(d)) continue;
      var before = this.stats[k];
      this.stats[k] = clamp(Math.round(before + d), 0, 100);
      var actual = this.stats[k] - before;
      if (actual !== 0) report.deltas[k] = actual;
    }
    for (i = 0; i < (gain || []).length; i++) { this.inventory.push(gain[i]); report.gained.push(gain[i]); }
    for (i = 0; i < (lose || []).length; i++) {
      var idx = this.inventory.indexOf(lose[i]);
      if (idx >= 0) { this.inventory.splice(idx, 1); report.lost.push(lose[i]); }
    }
    for (i = 0; i < (tags || []).length; i++) this.addTag(tags[i]);
    // A tweak can never black you out — only a scene can.
    if (this.stats.health <= 0) this.stats.health = 1;
    this.deriveTags();
    this.emit('change', report);
    return report;
  };

  /** Bookkeeping the Director uses: how many scenes since engineId ran. */
  State.prototype.depthSince = function (engineId) {
    for (var i = this.history.length - 1; i >= 0; i--) {
      if (this.history[i].engineId === engineId) return this.history.length - i;
    }
    return 999;
  };

  State.prototype.recentEngines = function (n) {
    return this.history.slice(-Math.max(0, n)).map(function (h) { return h.engineId; });
  };

  State.prototype.seenSkins = function () {
    var m = {};
    for (var i = 0; i < this.history.length; i++) m[this.history[i].engineId + ':' + this.history[i].skinId] = true;
    return m;
  };

  /* -------------------------------------------------------------- persist -- */
  State.prototype.toJSON = function () {
    return {
      version: this.version, runSeed: this.runSeed, seedLabel: this.seedLabel,
      depth: this.depth, biome: this.biome, stats: this.stats,
      inventory: this.inventory, tags: this.tags, history: this.history.slice(-40),
      last: this.last, crossroad: this.crossroad, blackout: this.blackout,
      blackouts: this.blackouts, startedAt: this.startedAt
    };
  };

  function fromJSON(raw) {
    var s = new State({ runSeed: raw.runSeed, seedLabel: raw.seedLabel, startedAt: raw.startedAt });
    s.depth     = raw.depth || 0;
    s.biome     = raw.biome || 'indoor';
    s.stats     = { health: 100, energy: 100, light: 100, morale: 100 };
    for (var i = 0; i < STAT_KEYS.length; i++) {
      var k = STAT_KEYS[i];
      if (raw.stats && isFinite(raw.stats[k])) s.stats[k] = clamp(raw.stats[k], 0, 100);
    }
    s.inventory = (raw.inventory || []).slice();
    s.tags      = raw.tags || {};
    s.history   = raw.history || [];
    s.last      = raw.last || (s.history.length ? s.history[s.history.length - 1] : null);
    s.crossroad = raw.crossroad || null;
    s.blackout  = !!raw.blackout;
    s.blackouts = raw.blackouts || 0;
    s.deriveTags();
    return s;
  }

  PS.state = {
    STAT_KEYS: STAT_KEYS,
    STAT_META: STAT_META,
    ITEMS: ITEMS,
    itemInfo: itemInfo,
    prettify: prettify,
    clamp: clamp,
    create: function (opts) { return new State(opts); },
    fromJSON: fromJSON,
    State: State
  };

})(typeof window !== 'undefined' ? window : this);
