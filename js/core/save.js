/* ==========================================================================
   PuzzleStudio — core/save.js
   localStorage persistence. Every failure mode (private browsing, quota,
   disabled storage, corrupt JSON, file:// oddities) degrades to "the game
   still plays, it just won't remember". Never throws.

   Loads with NO side effects beyond defining PuzzleStudio.save.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio || (root.PuzzleStudio = {});

  var KEY = 'puzzlestudio.run.v1';
  var available = null;      // lazily probed, never at load time
  var warned = false;
  var memory = null;         // in-memory fallback so a session still "continues"

  function store() {
    try { return root.localStorage || null; }
    catch (e) { return null; }
  }

  function probe() {
    if (available !== null) return available;
    var ls = store();
    if (!ls) { available = false; return available; }
    try {
      var probeKey = KEY + '.probe';
      ls.setItem(probeKey, '1');
      ls.removeItem(probeKey);
      available = true;
    } catch (e) {
      available = false;
    }
    return available;
  }

  function softWarn(e) {
    if (warned) return;
    warned = true;
    if (root.console) console.warn('[PuzzleStudio] progress will not persist (' + (e && e.name ? e.name : 'storage unavailable') + '). The game still plays fine.');
  }

  /** @returns {boolean} true if it actually hit disk */
  function save(state, profile) {
    var payload;
    try {
      payload = {
        v: 1,
        savedAt: Date.now(),
        state: state.toJSON(),
        profile: profile ? profile.toJSON() : null
      };
    } catch (e) {
      if (root.console) console.warn('[PuzzleStudio] could not serialise run:', e);
      return false;
    }

    memory = payload;
    if (!probe()) { softWarn(); return false; }
    try {
      store().setItem(KEY, JSON.stringify(payload));
      return true;
    } catch (e) {
      softWarn(e);
      available = false;   // stop retrying every scene once quota is hit
      return false;
    }
  }

  function raw() {
    if (probe()) {
      try {
        var s = store().getItem(KEY);
        if (s) return JSON.parse(s);
      } catch (e) { softWarn(e); }
    }
    return memory;
  }

  function exists() {
    var r = raw();
    return !!(r && r.state);
  }

  /** @returns {{state, profile, savedAt}|null} */
  function load() {
    var r = raw();
    if (!r || !r.state) return null;
    try {
      return {
        state: PS.state.fromJSON(r.state),
        profile: PS.profile.create(r.profile),
        savedAt: r.savedAt || 0
      };
    } catch (e) {
      if (root.console) console.warn('[PuzzleStudio] saved run was corrupt, discarding it:', e);
      clear();
      return null;
    }
  }

  function clear() {
    memory = null;
    if (!probe()) return;
    try { store().removeItem(KEY); } catch (e) { softWarn(e); }
  }

  /** Small human summary for the title screen's Continue button. */
  function summary() {
    var r = raw();
    if (!r || !r.state) return null;
    var s = r.state;
    return {
      depth: s.depth || 0,
      seedLabel: s.seedLabel || String(s.runSeed),
      biome: s.biome || 'indoor',
      health: (s.stats && s.stats.health) || 0,
      where: (s.last && s.last.title) || null,
      savedAt: r.savedAt || 0
    };
  }

  PS.save = {
    KEY: KEY,
    save: save,
    load: load,
    exists: exists,
    clear: clear,
    summary: summary,
    isAvailable: probe
  };

})(typeof window !== 'undefined' ? window : this);
