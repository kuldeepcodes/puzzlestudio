/* ==========================================================================
   PuzzleStudio — core/rng.js
   Deterministic, seedable randomness. Everything the player sees in a scene
   must come from here so a run seed reproduces the run exactly.

   Loads with NO side effects beyond defining PuzzleStudio.rng.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio || (root.PuzzleStudio = {});

  /**
   * FNV-1a style string hash -> unsigned 32-bit int.
   * Accepts any number of arguments of any type; they are stringified and
   * joined, so hash(runSeed, engineId, skinId, depth) is stable and unique.
   */
  function hash() {
    var s = Array.prototype.slice.call(arguments).join('\u241F');
    var h = 2166136261 >>> 0;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    // final avalanche so near-identical inputs diverge hard
    h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0;
    h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0;
    h ^= h >>> 16;
    return h >>> 0;
  }

  /** mulberry32 — tiny, fast, good enough distribution for a puzzle game. */
  function mulberry32(a) {
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * Create an RNG instance.
   * @param {number|string} seed
   * @returns {object} rng
   */
  function create(seed) {
    var numeric = (typeof seed === 'number' && isFinite(seed)) ? (seed >>> 0) : hash(String(seed));
    var next = mulberry32(numeric);

    var api = {
      seed: numeric,

      /** float in [0,1) */
      next: next,
      float: next,

      /** integer in [a,b] inclusive. int(n) == int(0,n). */
      int: function (a, b) {
        if (b === undefined) { b = a; a = 0; }
        a = Math.ceil(a); b = Math.floor(b);
        if (b < a) { var t = a; a = b; b = t; }
        return a + Math.floor(next() * (b - a + 1));
      },

      /** float in [a,b) */
      range: function (a, b) {
        if (b === undefined) { b = a; a = 0; }
        return a + next() * (b - a);
      },

      /** true with probability p (0..1) */
      chance: function (p) { return next() < p; },

      /** random element of arr (undefined for empty arrays) */
      pick: function (arr) {
        if (!arr || !arr.length) return undefined;
        return arr[Math.floor(next() * arr.length)];
      },

      /** returns a NEW array, Fisher-Yates shuffled. Never mutates input. */
      shuffle: function (arr) {
        var a = (arr || []).slice();
        for (var i = a.length - 1; i > 0; i--) {
          var j = Math.floor(next() * (i + 1));
          var t = a[i]; a[i] = a[j]; a[j] = t;
        }
        return a;
      },

      /** n distinct elements from arr (fewer if arr is shorter) */
      sample: function (arr, n) { return api.shuffle(arr).slice(0, Math.max(0, n)); },

      /**
       * Weighted pick.
       * @param {Array} items
       * @param {function(item,index):number} weightFn — negatives treated as 0
       */
      weighted: function (items, weightFn) {
        if (!items || !items.length) return undefined;
        var total = 0, w = [], i;
        for (i = 0; i < items.length; i++) {
          var v = Math.max(0, Number(weightFn(items[i], i)) || 0);
          w.push(v); total += v;
        }
        if (total <= 0) return items[Math.floor(next() * items.length)];
        var r = next() * total;
        for (i = 0; i < items.length; i++) {
          r -= w[i];
          if (r <= 0) return items[i];
        }
        return items[items.length - 1];
      },

      /** small symmetric noise, e.g. jitter(1.2) -> [-0.6, 0.6) */
      jitter: function (amount) {
        var a = (amount === undefined) ? 1 : amount;
        return (next() - 0.5) * a;
      },

      /** a fresh, independent rng derived from this one (for sub-systems) */
      fork: function (label) { return create(hash(numeric, label === undefined ? 'fork' : label, api.int(1e9))); }
    };

    return api;
  }

  /** Human-readable seed like "ASH-4712-VEIL" for the title screen. */
  function friendlySeed(n) {
    var A = ['ASH', 'RUST', 'MOSS', 'BONE', 'ICE', 'STEEL', 'EMBER', 'HOLLOW', 'DRIFT', 'SALT'];
    var B = ['VEIL', 'GATE', 'SHAFT', 'CROSS', 'WAKE', 'HOLD', 'REACH', 'MIRE', 'SPAN', 'VAULT'];
    var r = create(n === undefined ? hash(String(Date.now()), String(Math.random())) : n);
    return r.pick(A) + '-' + String(r.int(1000, 9999)) + '-' + r.pick(B);
  }

  PS.rng = {
    create: create,
    hash: hash,
    mulberry32: mulberry32,
    friendlySeed: friendlySeed,

    /**
     * THE canonical per-scene seed. Same engine at a different depth is a
     * genuinely different puzzle because depth is part of the hash.
     */
    sceneSeed: function (runSeed, engineId, skinId, depth) {
      return hash(runSeed, engineId, skinId, depth);
    }
  };

})(typeof window !== 'undefined' ? window : this);
