/* ==========================================================================
   PuzzleStudio — core/ui.js
   The frame all 20 engines sit inside: persistent survivor panel on the left,
   scene stage on the right, plus the title screen, toasts and transitions.

   Engines get `el` (their stage container) and are free to build whatever DOM
   they like inside it. They may also use PuzzleStudio.ui.h() as a convenience
   element builder — see CONTRACT.md.

   Loads with NO side effects beyond defining PuzzleStudio.ui.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio || (root.PuzzleStudio = {});

  var dom = {};             // cached nodes
  var bound = null;         // { state, profile }
  var unbind = null;
  var prevStats = null;
  var prevInv = [];
  var hintHandler = null;
  var mounted = false;

  var OUTCOME = {
    success: { icon: '\u2705', cls: 'ok',   word: 'Clear' },
    partial: { icon: '\u26A0\uFE0F', cls: 'part', word: 'Messy' },
    fail:    { icon: '\u274C', cls: 'bad',  word: 'Lost' }
  };

  /* ------------------------------------------------------------- helpers -- */

  /**
   * Tiny element builder. h('div', {class:'x', onclick:fn, dataset:{k:'v'}}, [children])
   * Children may be nodes, strings, numbers, or nested arrays. Null/undefined skipped.
   * Text is always set via textContent — nothing here can inject HTML.
   */
  function h(tag, attrs, children) {
    var e = document.createElement(tag);
    attrs = attrs || {};
    for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class' || k === 'className') e.className = v;
      else if (k === 'text') e.textContent = String(v);
      else if (k === 'style' && typeof v === 'object') { for (var s in v) e.style[s] = v[s]; }
      else if (k === 'dataset' && typeof v === 'object') { for (var d in v) e.dataset[d] = v[d]; }
      else if (k.indexOf('on') === 0 && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : String(v));
    }
    append(e, children);
    return e;
  }

  function append(parent, kids) {
    if (kids === null || kids === undefined || kids === false) return parent;
    if (Array.isArray(kids)) {
      for (var i = 0; i < kids.length; i++) append(parent, kids[i]);
      return parent;
    }
    parent.appendChild(kids.nodeType ? kids : document.createTextNode(String(kids)));
    return parent;
  }

  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }

  function signed(n) { return (n > 0 ? '+' : '') + n; }

  /* ============================================================== SHELL == */

  function mount(rootEl) {
    if (mounted) return dom;
    dom.root = rootEl || document.getElementById('ps-root') || document.body;
    clear(dom.root);
    dom.root.className = 'ps-root pal-amber';
    dom.root.setAttribute('data-biome', 'indoor');

    /* ---- left: the survivor panel ---- */
    dom.stats = h('div', { class: 'ps-block' });
    dom.chips = h('div', { class: 'ps-chips' });
    dom.meta = h('div', { class: 'ps-meta' });
    dom.badges = h('div', { class: 'ps-badges' });
    dom.tags = h('div', { class: 'ps-tags' });
    dom.log = h('div', { class: 'ps-log' });

    dom.side = h('aside', { class: 'ps-side ps-panel' }, [
      h('div', { class: 'ps-brand' }, [
        h('div', { class: 'ps-brand__mark', text: '\uD83E\uDDED' }),
        h('div', {}, [
          h('div', { class: 'ps-brand__name', text: 'PuzzleStudio' }),
          h('div', { class: 'ps-brand__sub', text: 'The Long Way Out' })
        ])
      ]),
      h('div', { class: 'ps-block' }, [
        h('div', { class: 'ps-block__head' }, [h('span', { text: 'Condition' })]),
        dom.stats
      ]),
      h('div', { class: 'ps-block' }, [
        h('div', { class: 'ps-block__head' }, [
          h('span', { text: 'Pack' }),
          h('span', { class: 'ps-pack-count', text: '' })
        ]),
        dom.chips
      ]),
      h('div', { class: 'ps-block' }, [
        h('div', { class: 'ps-block__head' }, [h('span', { text: 'Bearings' })]),
        dom.meta
      ]),
      h('div', { class: 'ps-block' }, [
        h('div', { class: 'ps-block__head' }, [h('span', { text: 'Playstyle' })]),
        dom.badges,
        dom.tags
      ]),
      h('div', { class: 'ps-block' }, [
        h('div', { class: 'ps-block__head' }, [h('span', { text: 'Run log' })]),
        dom.log
      ])
    ]);
    dom.packCount = dom.side.querySelector('.ps-pack-count');

    // build the four stat rows once, then only mutate their values
    dom.statRows = {};
    for (var i = 0; i < PS.state.STAT_KEYS.length; i++) {
      var key = PS.state.STAT_KEYS[i];
      var meta = PS.state.STAT_META[key];
      var fill = h('div', { class: 'ps-bar__fill' });
      var num = h('div', { class: 'ps-stat__num', text: '100' });
      var row = h('div', { class: 'ps-stat ps-tip', 'data-k': key, 'data-tip': meta.name + ' \u2014 ' + meta.hint }, [
        h('div', { class: 'ps-stat__icon', text: meta.icon }),
        h('div', { class: 'ps-bar' }, [fill]),
        num
      ]);
      dom.statRows[key] = { row: row, fill: fill, num: num };
      dom.stats.appendChild(row);
    }

    /* ---- right: header + stage ---- */
    dom.topIcon = h('div', { class: 'ps-top__icon', text: '\uD83E\uDDED' });
    dom.topTitle = h('div', { class: 'ps-top__title', text: 'PuzzleStudio' });
    dom.topSub = h('div', { class: 'ps-top__sub', text: 'Awaiting run' });
    dom.hintBtn = h('button', {
      class: 'pz-btn pz-btn--sm', type: 'button', title: 'Ask for a nudge (costs morale)',
      onclick: function () { if (hintHandler) hintHandler(); }
    }, ['\uD83D\uDCA1 Hint']);
    dom.menuBtn = h('button', {
      class: 'pz-btn pz-btn--sm pz-btn--ghost', type: 'button', title: 'Back to the title screen',
      onclick: function () { PS.engine.openMenu(); }
    }, ['\u23F8 Menu']);

    dom.top = h('header', { class: 'ps-top ps-panel' }, [
      dom.topIcon,
      h('div', { class: 'ps-top__txt' }, [dom.topTitle, dom.topSub]),
      h('div', { class: 'ps-top__acts' }, [dom.hintBtn, dom.menuBtn])
    ]);

    dom.stageInner = h('div', { class: 'ps-stage__inner' });
    dom.stage = h('section', { class: 'ps-stage ps-panel' }, [
      h('div', { class: 'ps-stage__sweep' }),
      dom.stageInner
    ]);
    dom.main = h('main', { class: 'ps-main' }, [dom.top, dom.stage]);

    /* ---- floating layers ---- */
    dom.overlay = h('div', { class: 'ps-overlay' });
    dom.toasts = h('div', { class: 'ps-toasts' });
    dom.flash = h('div', { class: 'ps-flash' });
    dom.black = h('div', { class: 'ps-blackout' });

    append(dom.root, [dom.side, dom.main]);
    append(document.body, [dom.overlay, dom.toasts, dom.flash, dom.black]);

    setHintEnabled(false);
    mounted = true;
    return dom;
  }

  /* ------------------------------------------------------------- binding -- */

  function bind(state, profile) {
    if (unbind) { unbind(); unbind = null; }
    bound = { state: state, profile: profile };
    prevStats = null;
    prevInv = [];
    unbind = state.on(function () { refresh(); });
    refresh(true);
  }

  function refresh(silent) {
    if (!mounted || !bound) return;
    var st = bound.state;
    var i, k;

    /* stats */
    for (i = 0; i < PS.state.STAT_KEYS.length; i++) {
      k = PS.state.STAT_KEYS[i];
      var v = st.stats[k];
      var r = dom.statRows[k];
      r.fill.style.width = v + '%';
      r.num.textContent = String(v);
      r.row.setAttribute('data-level', v <= 0 ? 'crit' : v < 18 ? 'crit' : v < 38 ? 'low' : v >= 96 ? 'full' : 'ok');
      if (!silent && prevStats && prevStats[k] !== undefined && prevStats[k] !== v) {
        var d = v - prevStats[k];
        flashStat(r.row, d);
      }
    }
    prevStats = { health: st.stats.health, energy: st.stats.energy, light: st.stats.light, morale: st.stats.morale };

    /* inventory */
    clear(dom.chips);
    if (!st.inventory.length) {
      dom.chips.appendChild(h('div', { class: 'ps-empty', text: 'Nothing but your hands.' }));
    } else {
      var counted = {};
      for (i = 0; i < st.inventory.length; i++) counted[st.inventory[i]] = (counted[st.inventory[i]] || 0) + 1;
      for (k in counted) {
        if (!Object.prototype.hasOwnProperty.call(counted, k)) continue;
        var info = PS.state.itemInfo(k);
        var isNew = !silent && prevInv.indexOf(k) < 0;
        dom.chips.appendChild(h('span', {
          class: 'ps-chip ps-tip' + (isNew ? ' is-new' : ''),
          'data-tip': info.name + ' \u2014 ' + info.desc
        }, [
          h('span', { class: 'ps-chip__i', text: info.icon }),
          h('span', { text: info.name + (counted[k] > 1 ? ' \u00D7' + counted[k] : '') })
        ]));
      }
    }
    prevInv = st.inventory.slice();
    dom.packCount.textContent = st.inventory.length ? String(st.inventory.length) : '';

    /* bearings */
    clear(dom.meta);
    append(dom.meta, [
      metaCell('Depth', String(st.depth)),
      metaCell('Tier', 'T' + st.tier()),
      metaCell('Biome', PS.state.prettify(st.biome)),
      metaCell('Scenes', String(st.history.length)),
      h('div', { class: 'ps-meta__cell ps-meta__cell--wide ps-tip', 'data-tip': 'Run seed \u2014 same seed, same run. Share it.' }, [
        h('div', { class: 'ps-meta__k', text: 'Run seed' }),
        h('div', { class: 'ps-meta__v ps-meta__v--seed', text: st.seedLabel })
      ])
    ]);

    /* playstyle */
    clear(dom.badges);
    var badges = bound.profile ? bound.profile.badges() : [];
    if (!badges.length) {
      dom.badges.appendChild(h('div', { class: 'ps-empty', text: 'Undecided. Solve something.' }));
    } else {
      for (i = 0; i < badges.length; i++) {
        var b = badges[i];
        dom.badges.appendChild(h('span', { class: 'ps-badge ps-tip', 'data-tip': b.blurb }, [
          h('span', { text: b.icon }),
          h('span', { text: b.name }),
          h('span', { class: 'ps-badge__pct', text: b.pct + '%' })
        ]));
      }
    }

    clear(dom.tags);
    var tl = st.tagList().slice(-8);
    for (i = 0; i < tl.length; i++) dom.tags.appendChild(h('span', { class: 'ps-tag', text: tl[i] }));

    /* run log — last 8, newest first */
    clear(dom.log);
    var hist = st.history.slice(-8).reverse();
    if (!hist.length) {
      dom.log.appendChild(h('div', { class: 'ps-empty', text: 'No ground covered yet.' }));
    } else {
      for (i = 0; i < hist.length; i++) {
        var e = hist[i];
        var o = OUTCOME[e.outcome] || OUTCOME.partial;
        dom.log.appendChild(h('div', {
          class: 'ps-log__row ' + o.cls, 'data-tip': (e.summary || o.word)
        }, [
          h('span', { text: e.icon }),
          h('span', { class: 'ps-log__name', text: e.title }),
          h('span', { class: 'ps-log__d', text: o.icon + ' ' + e.depth })
        ]));
      }
    }
  }

  function metaCell(k, v) {
    return h('div', { class: 'ps-meta__cell' }, [
      h('div', { class: 'ps-meta__k', text: k }),
      h('div', { class: 'ps-meta__v', text: v })
    ]);
  }

  function flashStat(row, d) {
    row.classList.remove('is-up', 'is-down');
    void row.offsetWidth;                       // restart the animation
    row.classList.add(d > 0 ? 'is-up' : 'is-down');
    // Arena scenes can drain a stat several times a second — replace the
    // floating pill rather than stacking a dozen of them on top of each other.
    var old = row.querySelector('.ps-delta');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var pill = h('span', { class: 'ps-delta ' + (d > 0 ? 'up' : 'down'), text: signed(d) });
    row.appendChild(pill);
    setTimeout(function () { if (pill.parentNode) pill.parentNode.removeChild(pill); }, 1500);
  }

  /* ------------------------------------------------------------- chrome --- */

  function setHeader(opts) {
    if (!mounted) return;
    opts = opts || {};
    dom.topIcon.textContent = opts.icon || '\uD83E\uDDED';
    dom.topTitle.textContent = opts.title || 'PuzzleStudio';
    dom.topSub.textContent = opts.sub || '';
  }

  function applySkin(skin) {
    if (!mounted || !skin) return;
    var pal = skin.palette || 'amber';
    dom.root.className = 'ps-root pal-' + pal;
    dom.root.setAttribute('data-biome', skin.biome || 'indoor');
  }

  function setHintEnabled(on) {
    if (!mounted) return;
    dom.hintBtn.disabled = !on;
  }

  function setHintHandler(fn) {
    hintHandler = fn;
    setHintEnabled(!!fn);
  }

  function stage() { return dom.stageInner; }

  /**
   * Swap the stage contents with the scene transition.
   * @param {function(HTMLElement)} render — receives the emptied stage
   * @param {function} [done]
   */
  function transition(render, done) {
    if (!mounted) return;
    dom.stage.classList.remove('is-in');
    dom.stage.classList.add('is-out');
    setTimeout(function () {
      clear(dom.stageInner);
      dom.stage.classList.remove('is-out');
      dom.stage.classList.add('is-in');
      try { render(dom.stageInner); }
      catch (err) {
        if (root.console) console.error('[PuzzleStudio] scene render failed:', err);
        renderCrash(err);
      }
      dom.stage.scrollTop = 0;
      if (root.scrollTo) root.scrollTo({ top: 0, behavior: 'smooth' });
      if (done) done();
    }, 320);
  }

  function renderCrash(err) {
    clear(dom.stageInner);
    append(dom.stageInner, h('div', { class: 'pz-scene' }, [
      h('div', { class: 'pz-verdict bad' }, [
        h('div', { class: 'pz-verdict__i', text: '\uD83E\uDDF0' }),
        h('div', {}, [
          h('div', { class: 'pz-verdict__t', text: 'That scene fell apart.' }),
          h('div', { class: 'pz-note', text: String(err && err.message ? err.message : err) })
        ])
      ]),
      h('button', {
        class: 'pz-btn pz-btn--primary', type: 'button',
        onclick: function () { PS.engine.skipScene(); }
      }, ['\u27A1 Move on'])
    ]));
  }

  /* ------------------------------------------------------------- toasts --- */

  function toast(msg, kind, ms) {
    if (!mounted) return;
    var t = h('div', { class: 'ps-toast ' + (kind || '') }, [
      h('span', { text: kind === 'good' ? '\u2728' : kind === 'bad' ? '\u26A0\uFE0F' : '\u25B8' }),
      h('span', { text: msg })
    ]);
    dom.toasts.appendChild(t);
    setTimeout(function () {
      t.classList.add('out');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 340);
    }, ms || 2600);
  }

  function flash() {
    if (!mounted) return;
    dom.flash.classList.remove('go');
    void dom.flash.offsetWidth;
    dom.flash.classList.add('go');
  }

  /** Full black-out sting used when health hits zero. Calls back at peak. */
  function blackout(atPeak, done) {
    if (!mounted) { if (atPeak) atPeak(); if (done) done(); return; }
    dom.black.classList.remove('go');
    void dom.black.offsetWidth;
    dom.black.classList.add('go');
    setTimeout(function () { if (atPeak) atPeak(); }, 420);
    setTimeout(function () { dom.black.classList.remove('go'); if (done) done(); }, 1520);
  }

  /* -------------------------------------------------------- title screen -- */

  function showTitle(opts) {
    if (!mounted) return;
    opts = opts || {};
    clear(dom.overlay);

    var saved = PS.save.summary();
    var seedInput = h('input', {
      class: 'ps-input', type: 'text', maxlength: '40',
      placeholder: 'seed (optional)', value: opts.seed || '',
      'aria-label': 'Run seed'
    });

    function begin() {
      var v = (seedInput.value || '').trim();
      hideTitle();
      PS.engine.newRun(v || null);
    }

    seedInput.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') begin(); });

    var acts = [
      h('button', { class: 'pz-btn pz-btn--primary pz-btn--lg', type: 'button', onclick: begin }, ['\u25B6 New run'])
    ];
    if (saved) {
      acts.unshift(h('button', {
        class: 'pz-btn pz-btn--lg', type: 'button',
        onclick: function () { hideTitle(); PS.engine.continueRun(); }
      }, ['\u21BA Continue \u2014 depth ' + saved.depth + (saved.where ? ' \u00B7 ' + saved.where : '')]));
    }

    var engines = PS.registry.count();
    var skins = PS.registry.allSkins().length;

    dom.overlay.appendChild(h('div', { class: 'ps-title ps-panel' }, [
      h('div', { class: 'ps-title__mark', text: '\uD83E\uDDED' }),
      h('div', { class: 'ps-title__h', text: 'PuzzleStudio' }),
      h('div', { class: 'ps-title__sub', text: 'The Long Way Out' }),
      h('p', { class: 'ps-title__blurb' }, [
        'You are out of one room and into the next, forever. Every puzzle you ',
        'solve reports ', h('em', { text: 'how' }), ' you solved it, and the ',
        'Director picks the next disaster to suit. Losing never ends the run \u2014 ',
        'it just sends you somewhere worse.'
      ]),
      h('div', { class: 'ps-title__acts' }, acts),
      h('div', { class: 'ps-title__seed' }, [
        seedInput,
        h('button', {
          class: 'pz-btn', type: 'button', title: 'Roll a random seed',
          onclick: function () { seedInput.value = PS.rng.friendlySeed(); }
        }, ['\uD83C\uDFB2'])
      ]),
      h('div', { class: 'ps-title__hint' }, [
        engines + ' engine' + (engines === 1 ? '' : 's') + ' \u00B7 ' + skins + ' scenario' + (skins === 1 ? '' : 's') + ' loaded.',
        h('br'),
        'Same seed, same run. Add ?dev=1 to the URL to watch the bot play.'
      ]),
      saved ? h('div', { class: 'ps-title__hint' }, [
        h('button', {
          class: 'pz-btn pz-btn--sm pz-btn--ghost', type: 'button',
          onclick: function (ev) {
            PS.save.clear();
            ev.target.textContent = 'Saved run deleted';
            ev.target.disabled = true;
          }
        }, ['\uD83D\uDDD1 Delete saved run'])
      ]) : null
    ]));

    dom.overlay.classList.add('is-on');
  }

  function hideTitle() {
    if (!mounted) return;
    dom.overlay.classList.remove('is-on');
    clear(dom.overlay);
  }

  /* ------------------------------------------------------------ dev badge -- */
  function devBadge(text) {
    if (!mounted) return null;
    var existing = document.querySelector('.ps-dev');
    if (existing) { existing.lastChild.textContent = text; return existing; }
    var b = h('div', { class: 'ps-dev' }, [h('span', { class: 'ps-dev__dot' }), h('span', { text: text })]);
    document.body.appendChild(b);
    return b;
  }

  PS.ui = {
    h: h,
    append: append,
    clear: clear,
    mount: mount,
    bind: bind,
    refresh: refresh,
    setHeader: setHeader,
    applySkin: applySkin,
    setHintHandler: setHintHandler,
    setHintEnabled: setHintEnabled,
    stage: stage,
    transition: transition,
    toast: toast,
    flash: flash,
    blackout: blackout,
    showTitle: showTitle,
    hideTitle: hideTitle,
    devBadge: devBadge,
    OUTCOME: OUTCOME,
    dom: function () { return dom; }
  };

})(typeof window !== 'undefined' ? window : this);
