/* ==========================================================================
   PuzzleStudio — core/loader.js
   THE ZERO-CONFLICT MECHANISM.

   This file hardcodes the filename of all 20 engines. It injects a <script>
   tag for each one and TOLERATES onerror SILENTLY, so a file that does not
   exist yet is simply skipped. When all 20 have settled (loaded or failed) it
   calls PuzzleStudio.engine.boot().

   Why not just list them in index.html?
     Because five sessions are adding engines in parallel. If engines were
     listed in index.html, every session would edit the same file and every
     session would conflict. They are listed HERE, already, all 20 of them —
     so adding an engine means adding exactly ONE new file and editing
     NOTHING. Do not add or remove entries in MANIFEST.

   Why <script> injection instead of fetch()?
     fetch()/XHR against file:// is CORS-blocked. Script tag injection is not.
     This is the only local-file loading mechanism that works by double-click.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio || (root.PuzzleStudio = {});

  var DIR = 'js/games/';

  // ---- THE 20. Frozen. Do not edit. -----------------------------------------
  var MANIFEST = [
    'e01_escape_code.js',
    'e02_grid_crawl.js',
    'e03_knapsack.js',
    'e04_constraint_crossing.js',
    'e05_circuit_rotation.js',
    'e06_cipher_decode.js',
    'e07_balance_scales.js',
    'e08_logic_grid.js',
    'e09_dependency_order.js',
    'e10_allocation_triage.js',
    'e11_barter_graph.js',
    'e12_timing_bar.js',
    'e13_adjacency_deduction.js',
    'e14_priority_sort.js',
    'e15_measuring.js',
    'e16_polyomino_packing.js',
    'e17_triangulation.js',
    'e18_sliding_block.js',
    'e19_patrol_routing.js',
    'e20_numeric_constraint.js'
  ];

  var report = { requested: MANIFEST.length, loaded: [], missing: [], startedAt: 0, ms: 0 };
  var started = false;

  function boot() {
    report.ms = Date.now() - report.startedAt;
    if (root.console && console.info) {
      console.info(
        '[PuzzleStudio] engines: ' + PS.registry.count() + ' registered from ' +
        report.loaded.length + '/' + report.requested + ' files (' + report.ms + 'ms).' +
        (report.missing.length ? ' Not present yet: ' + report.missing.join(', ') : '')
      );
    }
    if (!PS.engine || typeof PS.engine.boot !== 'function') {
      if (root.console) console.error('[PuzzleStudio] engine.js did not load — cannot boot.');
      return;
    }
    PS.engine.boot();
  }

  function start() {
    if (started) return;
    started = true;
    report.startedAt = Date.now();

    if (typeof document === 'undefined') { boot(); return; }

    var pending = MANIFEST.length;
    if (!pending) { boot(); return; }

    // Load sequentially-tolerant but in parallel: order of registration does
    // not matter to the Director, and parallel keeps the title screen instant.
    var settle = function (file, ok) {
      if (ok) report.loaded.push(file); else report.missing.push(file);
      if (--pending === 0) boot();
    };

    for (var i = 0; i < MANIFEST.length; i++) {
      (function (file) {
        var s = document.createElement('script');
        s.src = DIR + file;
        s.async = false;                       // preserve execution order
        s.setAttribute('data-pz-game', file);
        s.onload  = function () { settle(file, true); };
        s.onerror = function () { settle(file, false); };  // not an error: file just isn't written yet
        document.head.appendChild(s);
      })(MANIFEST[i]);
    }
  }

  PS.loader = {
    MANIFEST: MANIFEST,
    DIR: DIR,
    start: start,
    report: function () { return report; }
  };

  // Self-start in a browser. In Node (the smoke test) nothing happens: the
  // smoke test loads the engine files itself with vm.runInContext.
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }

})(typeof window !== 'undefined' ? window : this);
