/* ==========================================================================
   PuzzleStudio — core/profile.js
   Turns the raw `signals` every engine reports into a playstyle. The Director
   uses the normalised profile to pick encounters that lean into (or against)
   how the player actually solves things.

   signals reported by engines:  logic  brute  caution  speed  scavenge
   playstyle exposed here:       logician brute cautious speedrunner scavenger

   Loads with NO side effects beyond defining PuzzleStudio.profile.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio || (root.PuzzleStudio = {});

  var SIGNALS = ['logic', 'brute', 'caution', 'speed', 'scavenge'];

  var STYLE = {
    logic:    { key: 'logician',    icon: '\uD83E\uDDE9', name: 'Logician',    blurb: 'You solve it before you touch it.' },
    brute:    { key: 'brute',       icon: '\uD83D\uDCAA', name: 'Brute',       blurb: 'Doors are suggestions.' },
    caution:  { key: 'cautious',    icon: '\uD83D\uDD76\uFE0F', name: 'Cautious', blurb: 'You leave no sound behind.' },
    speed:    { key: 'speedrunner', icon: '\uD83D\uDCA8', name: 'Speedrunner', blurb: 'Out before the dust settles.' },
    scavenge: { key: 'scavenger',   icon: '\uD83C\uDF92', name: 'Scavenger',   blurb: 'You leave rooms emptier than you found them.' }
  };

  function Profile(raw) {
    this.totals = {};
    for (var i = 0; i < SIGNALS.length; i++) this.totals[SIGNALS[i]] = 0;
    this.count = 0;
    if (raw) this.load(raw);
  }

  /** Fold one result's signals in. Ignores unknown keys and bad numbers. */
  Profile.prototype.absorb = function (signals) {
    if (!signals) return this;
    var any = false;
    for (var i = 0; i < SIGNALS.length; i++) {
      var k = SIGNALS[i];
      var v = Number(signals[k]);
      if (!v || !isFinite(v)) continue;
      // clamp per-scene contribution so one wild engine can't dominate a run
      this.totals[k] += Math.max(0, Math.min(5, v));
      any = true;
    }
    if (any) this.count += 1;
    return this;
  };

  Profile.prototype.sum = function () {
    var t = 0;
    for (var i = 0; i < SIGNALS.length; i++) t += this.totals[SIGNALS[i]];
    return t;
  };

  /**
   * Normalised 0..1 weights keyed by SIGNAL name (logic, brute, ...).
   * With no data at all every style sits at an even 0.2 so scoring is neutral.
   */
  Profile.prototype.weights = function () {
    var total = this.sum(), out = {}, i, k;
    for (i = 0; i < SIGNALS.length; i++) {
      k = SIGNALS[i];
      out[k] = total > 0 ? this.totals[k] / total : 1 / SIGNALS.length;
    }
    return out;
  };

  /** Sorted [{ signal, key, icon, name, blurb, pct }], strongest first. */
  Profile.prototype.ranked = function () {
    var w = this.weights(), out = [], i;
    for (i = 0; i < SIGNALS.length; i++) {
      var k = SIGNALS[i];
      out.push({
        signal: k, key: STYLE[k].key, icon: STYLE[k].icon,
        name: STYLE[k].name, blurb: STYLE[k].blurb,
        pct: Math.round(w[k] * 100), raw: this.totals[k]
      });
    }
    out.sort(function (a, b) { return b.raw - a.raw || b.pct - a.pct || a.name.localeCompare(b.name); });
    return out;
  };

  /** Top two badges for the HUD. Returns [] until the player has done anything. */
  Profile.prototype.badges = function () {
    if (this.sum() <= 0) return [];
    return this.ranked().slice(0, 2).filter(function (b) { return b.raw > 0; });
  };

  Profile.prototype.dominant = function () {
    var r = this.ranked();
    return (r.length && r[0].raw > 0) ? r[0].signal : null;
  };

  /**
   * How well an engine's `favors` matches this player, in roughly 0..3.
   * favors is a plain map like { caution: 2, logic: 1 }.
   */
  Profile.prototype.affinity = function (favors) {
    if (!favors) return 0;
    var w = this.weights(), score = 0, norm = 0, k;
    for (k in favors) {
      if (!Object.prototype.hasOwnProperty.call(favors, k)) continue;
      var f = Math.max(0, Number(favors[k]) || 0);
      if (!f || w[k] === undefined) continue;
      score += f * w[k];
      norm  += f;
    }
    if (norm <= 0) return 0;
    // w[k] averages 0.2, so score/norm sits around 0.2 for a neutral match.
    // Scale so a perfectly-matched engine lands near 3 and a mismatch near 0.
    return (score / norm) * 6;
  };

  Profile.prototype.toJSON = function () { return { totals: this.totals, count: this.count }; };

  Profile.prototype.load = function (raw) {
    if (!raw) return this;
    for (var i = 0; i < SIGNALS.length; i++) {
      var k = SIGNALS[i];
      var v = Number(raw.totals && raw.totals[k]);
      this.totals[k] = isFinite(v) ? v : 0;
    }
    this.count = Number(raw.count) || 0;
    return this;
  };

  Profile.prototype.reset = function () {
    for (var i = 0; i < SIGNALS.length; i++) this.totals[SIGNALS[i]] = 0;
    this.count = 0;
    return this;
  };

  PS.profile = {
    SIGNALS: SIGNALS,
    STYLE: STYLE,
    create: function (raw) { return new Profile(raw); },
    Profile: Profile
  };

})(typeof window !== 'undefined' ? window : this);
