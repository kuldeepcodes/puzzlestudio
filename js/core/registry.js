/* ==========================================================================
   PuzzleStudio — core/registry.js
   Every engine file calls PuzzleStudio.registry.register({...}) exactly once
   at load time. The registry validates it, keeps it, and injects its self
   contained `css` string into a <style> tag the first time it is mounted.

   A malformed engine is WARNED about and skipped — never thrown — so one
   broken file from one parallel session can never take the game down.

   Loads with NO side effects beyond defining PuzzleStudio.registry.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio || (root.PuzzleStudio = {});

  var BIOMES   = ['indoor', 'underground', 'water', 'industrial', 'urban', 'wilderness', 'shelter'];
  var PALETTES = ['amber', 'moss', 'steel', 'ice', 'rust', 'ash', 'bone'];

  var engines   = [];   // registration order
  var byId      = {};
  var cssDone   = {};   // engineId -> true once its <style> is in the document
  var problems  = [];   // [{ id, why }] — surfaced by the smoke test

  function warn() {
    if (root.console && console.warn) console.warn.apply(console, arguments);
  }

  function isFn(v) { return typeof v === 'function'; }

  /** Validate a registration. Returns an array of human-readable problems. */
  function validate(e) {
    var errs = [];
    if (!e || typeof e !== 'object') return ['registration is not an object'];
    if (!e.id || typeof e.id !== 'string') errs.push('missing string id');
    if (byId[e.id]) errs.push('duplicate id "' + e.id + '" (already registered)');
    if (!isFn(e.build)) errs.push('missing build(state, rng, tier, skin)');
    if (!isFn(e.mount)) errs.push('missing mount(el, state, api, puzzle, skin)');
    if (!Array.isArray(e.skins) || e.skins.length !== 3) {
      errs.push('skins must be an array of exactly 3 (got ' + (e.skins ? e.skins.length : 'none') + ')');
    } else {
      for (var i = 0; i < e.skins.length; i++) {
        var s = e.skins[i], where = 'skins[' + i + ']';
        if (!s || !s.id)    errs.push(where + ' missing id');
        if (!s || !s.title) errs.push(where + ' missing title');
        if (!s || !s.biome) errs.push(where + ' missing biome');
        else if (BIOMES.indexOf(s.biome) < 0) errs.push(where + ' unknown biome "' + s.biome + '"');
        if (s && s.palette && PALETTES.indexOf(s.palette) < 0) errs.push(where + ' unknown palette "' + s.palette + '"');
      }
    }
    return errs;
  }

  /** Fill in every optional field so the Director never has to null-check. */
  function normalize(e) {
    e.name     = e.name || PS.state.prettify(e.id);
    e.icon     = e.icon || (e.skins && e.skins[0] && e.skins[0].icon) || '\u2753';
    e.favors   = e.favors   || {};
    e.provides = e.provides || [];
    e.tagHooks = e.tagHooks || [];
    e.css      = e.css || '';
    e.blurb    = e.blurb || '';
    if (typeof e.requires !== 'function') e.requires = function () { return true; };
    if (typeof e.unmount !== 'function')  e.unmount  = function () {};
    for (var i = 0; i < e.skins.length; i++) {
      var s = e.skins[i];
      s.icon    = s.icon    || e.icon;
      s.palette = s.palette || 'amber';
      s.intro   = s.intro   || '';
      s.nouns   = s.nouns   || {};
      s.engineId = e.id;
    }
    return e;
  }

  function register(engine) {
    var errs = validate(engine);
    if (errs.length) {
      var id = (engine && engine.id) || '(anonymous)';
      problems.push({ id: id, why: errs });
      warn('[PuzzleStudio] engine "' + id + '" was NOT registered:\n  - ' + errs.join('\n  - '));
      return false;
    }
    normalize(engine);
    engines.push(engine);
    byId[engine.id] = engine;
    return true;
  }

  function all()      { return engines.slice(); }
  function count()    { return engines.length; }
  function get(id)    { return byId[id] || null; }
  function has(id)    { return !!byId[id]; }

  function skin(engineId, skinId) {
    var e = byId[engineId];
    if (!e) return null;
    for (var i = 0; i < e.skins.length; i++) if (e.skins[i].id === skinId) return e.skins[i];
    return null;
  }

  function allSkins() {
    var out = [];
    for (var i = 0; i < engines.length; i++) {
      for (var j = 0; j < engines[i].skins.length; j++) {
        out.push({ engineId: engines[i].id, skinId: engines[i].skins[j].id, skin: engines[i].skins[j] });
      }
    }
    return out;
  }

  /** Every engine that lists `need` in its provides array. */
  function providing(need) {
    return engines.filter(function (e) { return e.provides.indexOf(need) >= 0; });
  }

  /**
   * Inject an engine's CSS once. Called by engine.js right before mount.
   * No-op in a non-DOM environment (the Node smoke test).
   */
  function ensureCss(engineId) {
    var e = byId[engineId];
    if (!e || !e.css || cssDone[engineId]) return;
    cssDone[engineId] = true;
    if (typeof document === 'undefined' || !document.head) return;
    var style = document.createElement('style');
    style.setAttribute('data-pz-engine', engineId);
    style.textContent = '/* engine:' + engineId + ' */\n' + e.css;
    document.head.appendChild(style);
  }

  PS.registry = {
    BIOMES: BIOMES,
    PALETTES: PALETTES,
    register: register,
    all: all,
    count: count,
    get: get,
    has: has,
    skin: skin,
    allSkins: allSkins,
    providing: providing,
    ensureCss: ensureCss,
    problems: function () { return problems.slice(); },
    /** test-only: wipe everything (used by tools/smoke-test.js) */
    _reset: function () { engines = []; byId = {}; cssDone = {}; problems = []; }
  };

})(typeof window !== 'undefined' ? window : this);
