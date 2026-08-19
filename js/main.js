/* ==========================================================================
   PuzzleStudio — main.js
   Bootstrap glue. engine.boot() calls PuzzleStudio.main.afterBoot() once the
   shell is up; that is where optional dev tooling gets pulled in.

   ?dev=1   loads js/dev/autoplay.js and lets a bot play the whole chain.
   ?seed=X  pre-fills / auto-starts a run with that seed.
   ?auto=1  same as dev=1 but starts immediately.

   Loads with NO side effects beyond defining PuzzleStudio.main.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio || (root.PuzzleStudio = {});

  function params() {
    var out = {};
    if (typeof location === 'undefined' || !location.search) return out;
    var q = location.search.replace(/^\?/, '').split('&');
    for (var i = 0; i < q.length; i++) {
      if (!q[i]) continue;
      var kv = q[i].split('=');
      out[decodeURIComponent(kv[0])] = kv.length > 1 ? decodeURIComponent(kv[1].replace(/\+/g, ' ')) : '1';
    }
    return out;
  }

  function injectScript(src, onDone) {
    if (typeof document === 'undefined') { if (onDone) onDone(false); return; }
    var s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = function () { if (onDone) onDone(true); };
    s.onerror = function () {
      if (root.console) console.warn('[PuzzleStudio] optional script not found: ' + src);
      if (onDone) onDone(false);
    };
    document.head.appendChild(s);
  }

  function afterBoot() {
    var p = params();
    PS.main.params = p;

    var wantDev = p.dev === '1' || p.auto === '1';

    if (p.seed && !wantDev) {
      // deep-link straight into a seeded run
      PS.ui.hideTitle();
      PS.engine.newRun(p.seed);
    }

    if (wantDev) {
      injectScript('js/dev/autoplay.js', function (ok) {
        if (!ok || !PS.autoplay) return;
        PS.autoplay.start({ seed: p.seed || null, speed: Number(p.speed) || 1 });
      });
    }
  }

  PS.main = {
    params: {},
    afterBoot: afterBoot,
    injectScript: injectScript
  };

})(typeof window !== 'undefined' ? window : this);
