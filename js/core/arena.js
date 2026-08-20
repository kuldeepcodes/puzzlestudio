/* ==========================================================================
   PuzzleStudio — core/arena.js
   The free-movement action layer. A top-down explorable arena that any of the
   twenty puzzle engines can sit inside.

   WHY THIS EXISTS
     Every engine used to be a DOM panel you clicked. This layer lets an engine
     keep that panel and only open it when the player has physically walked to
     a console in the world — so the game is something you play, not a form you
     fill in. See arena.station() below: that one call spatialises an engine.

   THE ONE RULE REVISION
     Canvas 2D is allowed HERE and only here. Smooth 60fps movement with a
     light mask is not practical in DOM. HUD, panels and every puzzle UI are
     still DOM. Everything else stands: no libraries, no CDN, no image assets,
     no ES modules, no fetch, no Math.random.

   Loads with NO side effects beyond defining PuzzleStudio.arena. Nothing here
   touches document until create() is called.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio || (root.PuzzleStudio = {});

  /* ------------------------------------------------------------ constants -- */

  var EMOJI_FONT = '"Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",system-ui,sans-serif';
  var UI_FONT = '"Segoe UI",system-ui,-apple-system,Roboto,Helvetica,Arial,sans-serif';

  /* Movement feel. These four numbers are the whole game. */
  var ACCEL = 44;          // tiles/s^2 while a direction is held
  var MAX_SPEED = 5.0;     // tiles/s
  var DECEL = 30;          // tiles/s^2 once input stops — a short, weighty slide
  var TURN_BOOST = 2.4;    // extra accel when steering against current velocity

  var RADIUS = 0.32;       // avatar half-width in tiles
  var CORNER_SLOP = 0.34;  // how far past a corner we still forgive you
  var CORNER_NUDGE = 4.2;  // tiles/s of automatic sidestep around that corner

  var CAM_DEAD = 1.15;     // tiles of dead-zone before the camera reacts
  var CAM_LERP = 0.0035;   // remaining fraction after one second (smaller = tighter)

  var active = null;       // the one live arena, so a leak is impossible

  /* -------------------------------------------------------------- helpers -- */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function len(x, y) { return Math.sqrt(x * x + y * y); }

  function angleDelta(a, b) {
    var d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return d;
  }

  /** #rgb / #rrggbb / rgb() / rgba() -> [r,g,b]. Falls back to a mid slate. */
  function parseColor(str) {
    str = String(str || '').trim();
    var m;
    if (str.charAt(0) === '#') {
      var hex = str.slice(1);
      if (hex.length === 3) hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) + hex.charAt(2) + hex.charAt(2);
      if (hex.length >= 6) {
        return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
      }
    }
    m = str.match(/rgba?\(([^)]+)\)/);
    if (m) {
      var p = m[1].split(',');
      return [parseInt(p[0], 10) || 0, parseInt(p[1], 10) || 0, parseInt(p[2], 10) || 0];
    }
    return [140, 152, 176];
  }

  function rgba(c, a) { return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; }

  function mix(a, b, t) {
    return [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];
  }

  function shade(c, t) {
    return t < 0 ? mix(c, [0, 0, 0], -t) : mix(c, [255, 255, 255], t);
  }

  /** Deterministic 0..1 from any inputs. Never Math.random — replays matter. */
  function noise() {
    return (PS.rng.hash.apply(null, arguments) >>> 0) / 4294967296;
  }

  /* ------------------------------------------------------------ map shims -- */

  /**
   * Accepts:
   *   [[0,1,...],[...]]                   row-major, 1 = solid
   *   { w, h, tiles: [[...]] }
   *   { w, h, wallAt: function (x,y) {} }
   */
  function normalizeMap(map) {
    if (!map) return { w: 1, h: 1, solid: function () { return false; }, set: null };

    if (Object.prototype.toString.call(map) === '[object Array]') {
      map = { w: (map[0] || []).length, h: map.length, tiles: map };
    }

    var w = map.w || (map.tiles && map.tiles[0] ? map.tiles[0].length : 1);
    var h = map.h || (map.tiles ? map.tiles.length : 1);

    if (map.tiles) {
      var t = map.tiles;
      return {
        w: w, h: h,
        solid: function (x, y) {
          if (x < 0 || y < 0 || x >= w || y >= h) return true;
          var row = t[y];
          return !row || !!row[x];
        },
        set: function (x, y, v) {
          if (x < 0 || y < 0 || x >= w || y >= h) return;
          if (t[y]) t[y][x] = v ? 1 : 0;
        }
      };
    }

    var fn = map.wallAt || function () { return false; };
    var overrides = {};
    return {
      w: w, h: h,
      solid: function (x, y) {
        if (x < 0 || y < 0 || x >= w || y >= h) return true;
        var k = x + ',' + y;
        if (overrides[k] !== undefined) return !!overrides[k];
        return !!fn(x, y);
      },
      set: function (x, y, v) { overrides[x + ',' + y] = v ? 1 : 0; }
    };
  }

  /* ========================================================== THE ARENA === */

  function create(host, opts) {
    if (typeof document === 'undefined' || !host) return null;
    if (active) { try { active.destroy(); } catch (e) { /* keep going */ } }

    opts = opts || {};
    var h = PS.ui.h;

    var map = normalizeMap(opts.map);
    var W = map.w, H = map.h;

    /* ------------------------------------------------------------- DOM --- */

    var canvas = h('canvas', { class: 'ps-arena__cv' });
    var hudEl = h('div', { class: 'ps-arena__hud' });
    var footEl = h('div', { class: 'ps-arena__foot' });
    var panelBody = h('div', { class: 'ps-arena__body' });
    var panelIcon = h('span', { class: 'ps-arena__phead-i', text: '' });
    var panelLabel = h('span', { class: 'ps-arena__phead-t', text: '' });
    var panelClose = h('button', {
      class: 'ps-arena__pclose', type: 'button', title: 'Step back (or just walk away)',
      'aria-label': 'Close console'
    }, ['\u00D7']);
    var panelEl = h('div', { class: 'ps-arena__panel' }, [
      h('div', { class: 'ps-arena__phead' }, [panelIcon, panelLabel, panelClose]),
      panelBody
    ]);
    var el = h('div', { class: 'ps-arena' + (opts.compact ? ' is-compact' : '') }, [
      canvas, hudEl, panelEl, footEl,
      h('div', { class: 'ps-arena__vig' })
    ]);
    host.appendChild(el);

    var ctx = canvas.getContext ? canvas.getContext('2d') : null;
    if (!ctx) { host.removeChild(el); return null; }

    var maskCv = document.createElement('canvas');
    var maskCtx = maskCv.getContext('2d');

    /* ---------------------------------------------------------- palette -- */

    var pal = {};
    function retint() {
      var cs = root.getComputedStyle ? root.getComputedStyle(el) : null;
      function tok(name, fallback) {
        var v = cs ? cs.getPropertyValue(name) : '';
        v = (v || '').trim();
        return parseColor(v || fallback);
      }
      var acc = tok('--acc', '#e2a84e');
      var acc2 = tok('--acc-2', '#f8d493');
      pal.acc = acc;
      pal.acc2 = acc2;
      // Floors sit LIGHTER than walls on purpose: in a top-down view the thing
      // you can walk on has to be the thing that reads as open.
      pal.floorA = mix([34, 42, 55], acc, 0.11);
      pal.floorB = mix([23, 29, 40], acc, 0.07);
      pal.wallTop = mix([13, 17, 24], acc, 0.05);
      pal.wallLip = mix([58, 70, 89], acc, 0.16);
      pal.wallSide = mix([4, 6, 9], acc, 0.02);
      pal.grid = mix([9, 12, 17], acc, 0.03);
      pal.ink = [232, 238, 247];
    }
    retint();

    /* ------------------------------------------------------------ state -- */

    var view = { w: 0, h: 0, dpr: 1 };
    var tile = 40;
    var cam = { x: 0, y: 0 };

    var spawn = opts.spawn || firstOpen();
    var p = {
      x: spawn.x + 0.5, y: spawn.y + 0.5,
      vx: 0, vy: 0,
      tx: spawn.x, ty: spawn.y,
      facing: -Math.PI / 2,
      icon: opts.avatar || '\uD83E\uDDCD',
      bob: 0
    };

    var lightStat = opts.light === undefined ? 100 : Number(opts.light);
    var darkness = opts.darkness === undefined ? 0.955 : opts.darkness;
    var memory = opts.memory === undefined ? 0.26 : opts.memory;
    var lightCurve = typeof opts.lightCurve === 'function' ? opts.lightCurve : defaultLightCurve;
    var litRadius = lightCurve(lightStat);
    var litShown = litRadius;

    var seen = new Array(W * H);
    var shadeOf = new Array(W * H);
    for (var si = 0; si < W * H; si++) {
      seen[si] = 0;
      shadeOf[si] = noise('arena-tile', si, W, H);
    }

    var things = [];        // stations + props, in draw order
    var patrols = [];
    var particles = [];
    var rings = [];
    var nextId = 1;

    var keys = {};
    var mouse = { x: 0, y: 0, inside: false, held: false, downAt: 0, downX: 0, downY: 0, moved: 0 };
    var touchHold = false;
    var pathQ = null;       // click-to-move waypoints
    var running = true;
    var paused = false;
    var destroyed = false;
    var raf = 0;
    var last = 0;
    var clock = 0;
    var stepTimer = 0;
    var shakeMag = 0, shakeT = 0;
    var flashT = 0, flashCol = [226, 105, 95];
    var nearest = null;
    var openStation = null;
    var reduceMotion = !!opts.reduceMotion;
    if (!reduceMotion && root.matchMedia) {
      try { reduceMotion = root.matchMedia('(prefers-reduced-motion: reduce)').matches; }
      catch (e) { reduceMotion = false; }
    }

    var arena;              // forward reference, assigned at the bottom

    function firstOpen() {
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) if (!map.solid(x, y)) return { x: x, y: y };
      return { x: 0, y: 0 };
    }

    function defaultLightCurve(v) {
      // 0 -> feeling along the wall. 100 -> you can see the room.
      if (v <= 0) return 1.05;
      return 1.6 + (clamp(v, 0, 100) / 100) * 5.2;
    }

    /* ============================================================ GEOMETRY */

    function solidAt(x, y) { return map.solid(x | 0, y | 0); }

    /** AABB-vs-tiles test for the avatar box centred on (px,py). */
    function blocked(px, py, r) {
      r = r === undefined ? RADIUS : r;
      var x0 = Math.floor(px - r), x1 = Math.floor(px + r);
      var y0 = Math.floor(py - r), y1 = Math.floor(py + r);
      for (var y = y0; y <= y1; y++) {
        for (var x = x0; x <= x1; x++) {
          if (map.solid(x, y)) return true;
        }
      }
      return false;
    }

    function walkable(x, y) { return !map.solid(x | 0, y | 0); }

    /** Straight-line walkability, used to smooth pathfinder output. */
    function clearLine(ax, ay, bx, by) {
      var dx = bx - ax, dy = by - ay;
      var d = len(dx, dy);
      var steps = Math.max(2, Math.ceil(d / 0.2));
      for (var i = 1; i <= steps; i++) {
        var t = i / steps;
        if (blocked(ax + dx * t, ay + dy * t)) return false;
      }
      return true;
    }

    /** BFS on the tile grid. Returns an array of tile coords, or null. */
    function findPath(sx, sy, gx, gy) {
      sx |= 0; sy |= 0; gx |= 0; gy |= 0;
      if (sx === gx && sy === gy) return [];
      if (map.solid(gx, gy)) return null;
      var prev = new Array(W * H), seenB = new Array(W * H);
      var q = [sy * W + sx], head = 0;
      seenB[sy * W + sx] = 1;
      var D = [1, 0, -1, 0, 0, 1, 0, -1];
      var goal = gy * W + gx, found = false;
      while (head < q.length) {
        var cur = q[head++];
        if (cur === goal) { found = true; break; }
        var cx = cur % W, cy = (cur / W) | 0;
        for (var i = 0; i < 4; i++) {
          var nx = cx + D[i * 2], ny = cy + D[i * 2 + 1];
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (map.solid(nx, ny)) continue;
          var ni = ny * W + nx;
          if (seenB[ni]) continue;
          seenB[ni] = 1; prev[ni] = cur; q.push(ni);
        }
      }
      if (!found) return null;
      var out = [], c = goal;
      while (c !== undefined && c !== sy * W + sx) { out.unshift([c % W, (c / W) | 0]); c = prev[c]; }
      return out;
    }

    /** Drop waypoints we can already see past — turns staircases into lines. */
    function smoothPath(pts) {
      if (!pts || pts.length < 2) return pts || [];
      var out = [], cx = p.x, cy = p.y, i = 0;
      while (i < pts.length) {
        var j = pts.length - 1;
        for (; j > i; j--) {
          if (clearLine(cx, cy, pts[j][0] + 0.5, pts[j][1] + 0.5)) break;
        }
        out.push(pts[j]);
        cx = pts[j][0] + 0.5; cy = pts[j][1] + 0.5;
        i = j + 1;
      }
      return out;
    }

    /* ============================================================ LIGHTING */

    function markSeen(cx, cy, r) {
      var x0 = Math.max(0, Math.floor(cx - r - 1)), x1 = Math.min(W - 1, Math.ceil(cx + r + 1));
      var y0 = Math.max(0, Math.floor(cy - r - 1)), y1 = Math.min(H - 1, Math.ceil(cy + r + 1));
      for (var y = y0; y <= y1; y++) {
        for (var x = x0; x <= x1; x++) {
          var dx = (x + 0.5) - cx, dy = (y + 0.5) - cy;
          if (dx * dx + dy * dy <= (r + 0.75) * (r + 0.75)) seen[y * W + x] = 1;
        }
      }
    }

    function setLight(v) {
      lightStat = Number(v) || 0;
      litRadius = lightCurve(lightStat);
    }

    /* ============================================================== THINGS */

    function addThing(spec, kind) {
      spec = spec || {};
      var t = {
        id: spec.id || (kind + '-' + (nextId++)),
        kind: kind,
        x: (spec.x || 0) + 0.5,
        y: (spec.y || 0) + 0.5,
        tx: spec.x | 0,
        ty: spec.y | 0,
        icon: spec.icon || (kind === 'station' ? '\uD83D\uDCDF' : '\u2B50'),
        label: spec.label || '',
        hint: spec.hint || (kind === 'station' ? 'Walk up to use' : 'Take it'),
        radius: spec.radius || (kind === 'station' ? 1.35 : 0.62),
        trigger: spec.trigger || (kind === 'station' ? 'proximity' : 'step'),
        tint: spec.tint || null,
        glow: spec.glow === undefined ? true : !!spec.glow,
        emits: spec.emits === undefined ? (kind === 'station' ? 1.6 : 0) : spec.emits,
        once: spec.once === undefined ? (kind !== 'station') : !!spec.once,
        botSkip: !!spec.botSkip,
        solved: !!spec.solved,
        done: false,
        gone: false,
        inRange: false,
        suppressed: false,
        built: false,
        pulse: 0,
        spec: spec
      };
      things.push(t);
      return t;
    }

    function handleFor(t) {
      return {
        id: t.id,
        get x() { return t.tx; },
        get y() { return t.ty; },
        get solved() { return t.solved; },
        get open() { return openStation === t; },
        el: null,                              // filled in on first open
        setLabel: function (s) { t.label = s; if (openStation === t) panelLabel.textContent = s; return this; },
        setIcon: function (s) { t.icon = s; if (openStation === t) panelIcon.textContent = s; return this; },
        move: function (x, y) { t.tx = x | 0; t.ty = y | 0; t.x = t.tx + 0.5; t.y = t.ty + 0.5; return this; },
        pulse: function () { ring(t.x, t.y, pal.acc2); t.pulse = 1; return this; },
        solve: function () {
          if (t.solved) return this;
          t.solved = true;
          t.pulse = 1;
          ring(t.x, t.y, pal.acc2);
          if (typeof t.spec.onSolved === 'function') t.spec.onSolved(arena, this);
          return this;
        },
        close: function () { if (openStation === t) { t.suppressed = true; closePanel(); } return this; },
        openNow: function () { openPanel(t); return this; },
        remove: function () { t.gone = true; if (openStation === t) closePanel(); return this; },
        raw: t
      };
    }

    /* ------------------------------------------------------- the panel --- */

    function openPanel(t) {
      if (openStation === t || t.gone) return;
      if (openStation) closePanel();
      openStation = t;
      panelIcon.textContent = t.icon;
      panelLabel.textContent = t.label || 'Console';
      if (!t.built) {
        t.built = true;
        t.handle.el = panelBody;
        if (typeof t.spec.onEnter === 'function') {
          try { t.spec.onEnter(panelBody, arena, t.handle); }
          catch (e) { if (root.console) console.warn('[arena] station onEnter threw:', e); }
        }
        t.dom = [];
        for (var i = 0; i < panelBody.childNodes.length; i++) t.dom.push(panelBody.childNodes[i]);
      } else {
        // Re-entry: put the exact same nodes back, with all their state intact.
        for (var j = 0; j < t.dom.length; j++) panelBody.appendChild(t.dom[j]);
      }
      el.classList.add('has-panel');
      panelEl.classList.add('is-on');
      if (typeof t.spec.onOpen === 'function') {
        try { t.spec.onOpen(arena, t.handle); } catch (e2) { /* engine's problem */ }
      }
    }

    function closePanel() {
      if (!openStation) return;
      var t = openStation;
      openStation = null;
      panelEl.classList.remove('is-on');
      el.classList.remove('has-panel');
      while (panelBody.firstChild) panelBody.removeChild(panelBody.firstChild);
      if (typeof t.spec.onExit === 'function') {
        try { t.spec.onExit(arena, t.handle); } catch (e) { /* engine's problem */ }
      }
    }

    panelClose.addEventListener('click', function () {
      if (openStation) { openStation.suppressed = true; closePanel(); }
    });

    /* -------------------------------------------------------- patrols ---- */

    function addPatrol(spec) {
      spec = spec || {};
      var route = (spec.route || []).map(function (r) { return [r[0] + 0.5, r[1] + 0.5]; });
      if (!route.length) route = [[p.x, p.y]];
      var pt = {
        id: spec.id || ('patrol-' + (nextId++)),
        route: route,
        leg: 0,
        t: 0,
        x: route[0][0], y: route[0][1],
        dir: 0,
        speed: spec.speed || 1.7,
        icon: spec.icon || '\uD83D\uDD26',
        label: spec.label || 'patrol',
        wait: spec.wait || 0,
        waiting: 0,
        vision: spec.vision === false ? null : {
          range: (spec.vision && spec.vision.range) || 4.6,
          fov: (spec.vision && spec.vision.fov) || 1.05
        },
        alert: 0,
        cool: 0,
        spec: spec
      };
      patrols.push(pt);
      return {
        id: pt.id,
        get x() { return pt.x | 0; },
        get y() { return pt.y | 0; },
        get alerted() { return pt.alert > 0; },
        setSpeed: function (s) { pt.speed = s; return this; },
        remove: function () { var i = patrols.indexOf(pt); if (i >= 0) patrols.splice(i, 1); return this; },
        raw: pt
      };
    }

    /* ============================================================== JUICE  */

    function dust(x, y, n, col) {
      if (reduceMotion) return;
      for (var i = 0; i < n; i++) {
        var a = noise('dust-a', clock * 1000 | 0, i, x | 0, y | 0) * Math.PI * 2;
        var s = 0.25 + noise('dust-s', clock * 1000 | 0, i, y | 0) * 0.55;
        particles.push({
          x: x, y: y,
          vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7,
          life: 0, max: 0.34 + noise('dust-l', i, clock * 100 | 0) * 0.4,
          size: 1.4 + noise('dust-z', i) * 2.2,
          col: col || pal.wallLip
        });
      }
    }

    function ring(x, y, col) {
      rings.push({ x: x, y: y, t: 0, max: 0.62, col: col || pal.acc2 });
    }

    function shake(mag, dur) {
      if (reduceMotion) return;
      shakeMag = Math.max(shakeMag, mag || 5);
      shakeT = Math.max(shakeT, dur || 0.32);
    }

    function hit(col) {
      flashCol = parseColor(col || '#e2695f');
      flashT = 0.42;
      shake(7, 0.3);
    }

    /* ============================================================== INPUT  */

    var KEYMAP = {
      w: 'up', a: 'left', s: 'down', d: 'right',
      arrowup: 'up', arrowleft: 'left', arrowdown: 'down', arrowright: 'right',
      k: 'up', h: 'left', j: 'down', l: 'right'
    };
    var ACTKEYS = { e: 1, ' ': 1, enter: 1, spacebar: 1 };

    function editable(node) {
      if (!node || !node.tagName) return false;
      var tag = node.tagName.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || node.isContentEditable;
    }

    function onKeyDown(ev) {
      if (destroyed || ev.ctrlKey || ev.metaKey || ev.altKey) return;   // never trap browser shortcuts
      if (editable(ev.target)) return;
      var k = String(ev.key || '').toLowerCase();
      if (KEYMAP[k]) {
        keys[KEYMAP[k]] = 1;
        pathQ = null;
        if (k.indexOf('arrow') === 0) ev.preventDefault();              // arrows scroll the page
      } else if (ACTKEYS[k]) {
        if (k === ' ' || k === 'spacebar') ev.preventDefault();         // space scrolls the page
        interact();
      }
    }

    function onKeyUp(ev) {
      var k = String(ev.key || '').toLowerCase();
      if (KEYMAP[k]) keys[KEYMAP[k]] = 0;
    }

    function onBlur() { keys = {}; mouse.held = false; touchHold = false; }

    function screenToWorld(cx, cy) {
      var r = canvas.getBoundingClientRect();
      return {
        x: cam.x + (cx - r.left - view.w / 2) / tile,
        y: cam.y + (cy - r.top - view.h / 2) / tile
      };
    }

    function onMouseMove(ev) {
      var wp = screenToWorld(ev.clientX, ev.clientY);
      mouse.x = wp.x; mouse.y = wp.y; mouse.inside = true;
      if (mouse.held) mouse.moved += 1;
    }

    function onMouseDown(ev) {
      if (ev.button !== 0) return;
      var wp = screenToWorld(ev.clientX, ev.clientY);
      mouse.x = wp.x; mouse.y = wp.y;
      mouse.held = true; mouse.downAt = Date.now(); mouse.moved = 0;
      mouse.downX = wp.x; mouse.downY = wp.y;
      pathQ = null;
      canvas.focus();
    }

    function onMouseUp(ev) {
      if (!mouse.held) return;
      mouse.held = false;
      var quick = (Date.now() - mouse.downAt) < 230;
      var still = len(mouse.x - mouse.downX, mouse.y - mouse.downY) < 0.55;
      if (quick && still) {
        // A tap, not a drag: pathfind there instead of steering there.
        var t = nearThingAt(mouse.x, mouse.y);
        if (t) goTo(t.tx, t.ty);
        else goTo(mouse.x | 0, mouse.y | 0);
      }
      if (ev && ev.preventDefault) ev.preventDefault();
    }

    function onMouseLeave() { mouse.inside = false; mouse.held = false; }

    function onTouchStart(ev) {
      var t = ev.touches && ev.touches[0];
      if (!t) return;
      var wp = screenToWorld(t.clientX, t.clientY);
      mouse.x = wp.x; mouse.y = wp.y; mouse.inside = true;
      touchHold = true; pathQ = null;
      ev.preventDefault();
    }

    function onTouchMove(ev) {
      var t = ev.touches && ev.touches[0];
      if (!t) return;
      var wp = screenToWorld(t.clientX, t.clientY);
      mouse.x = wp.x; mouse.y = wp.y;
      ev.preventDefault();
    }

    function onTouchEnd(ev) {
      touchHold = false; mouse.inside = false;
      if (ev && ev.preventDefault) ev.preventDefault();
    }

    function onContext(ev) { ev.preventDefault(); }

    function nearThingAt(wx, wy) {
      for (var i = 0; i < things.length; i++) {
        var t = things[i];
        if (t.gone) continue;
        if (Math.abs(t.x - wx) < 0.75 && Math.abs(t.y - wy) < 0.75) return t;
      }
      return null;
    }

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    root.addEventListener('blur', onBlur);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('contextmenu', onContext);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    root.addEventListener('resize', resize);

    /* ============================================================ MOVEMENT */

    function goTo(gx, gy) {
      var path = findPath(p.tx, p.ty, gx, gy);
      if (!path) { pathQ = null; return false; }
      pathQ = smoothPath(path);
      if (!pathQ.length) pathQ = null;
      return true;
    }

    function desiredDir() {
      var dx = 0, dy = 0;
      if (keys.left) dx -= 1;
      if (keys.right) dx += 1;
      if (keys.up) dy -= 1;
      if (keys.down) dy += 1;
      if (dx || dy) return { x: dx, y: dy, src: 'key' };

      if (pathQ && pathQ.length) {
        var wp = pathQ[0];
        var tx = wp[0] + 0.5 - p.x, ty = wp[1] + 0.5 - p.y;
        var d = len(tx, ty);
        if (d < 0.16) { pathQ.shift(); if (!pathQ.length) pathQ = null; return { x: 0, y: 0, src: 'path' }; }
        return { x: tx / d, y: ty / d, src: 'path' };
      }

      if ((mouse.held || touchHold) && mouse.inside) {
        var mx = mouse.x - p.x, my = mouse.y - p.y;
        var md = len(mx, my);
        if (md < 0.3) return { x: 0, y: 0, src: 'mouse' };
        return { x: mx / md, y: my / md, src: 'mouse' };
      }
      return { x: 0, y: 0, src: null };
    }

    function move(dt) {
      var dir = desiredDir();
      var dl = len(dir.x, dir.y);

      if (dl > 0) {
        var nx = dir.x / dl, ny = dir.y / dl;
        // Steering against your own momentum bites harder — that is what stops
        // a top-down avatar feeling like it is on ice.
        var against = (nx * p.vx + ny * p.vy) < 0 ? TURN_BOOST : 1;
        p.vx += nx * ACCEL * against * dt;
        p.vy += ny * ACCEL * against * dt;
        var sp = len(p.vx, p.vy);
        if (sp > MAX_SPEED) { p.vx = p.vx / sp * MAX_SPEED; p.vy = p.vy / sp * MAX_SPEED; }
      } else {
        var s = len(p.vx, p.vy);
        if (s > 0) {
          var ns = Math.max(0, s - DECEL * dt);
          if (ns <= 0.0001) { p.vx = 0; p.vy = 0; }
          else { p.vx = p.vx / s * ns; p.vy = p.vy / s * ns; }
        }
      }

      var speed = len(p.vx, p.vy);

      /* ---- axis-separated collision, with corner forgiveness ------------- */
      var stepX = p.vx * dt, stepY = p.vy * dt;

      if (stepX !== 0) {
        var wantX = p.x + stepX;
        if (!blocked(wantX, p.y)) p.x = wantX;
        else {
          var slid = false;
          // Clipping a corner with your shoulder? Slide past it instead of stopping.
          for (var sgn = -1; sgn <= 1 && !slid; sgn += 2) {
            var ny2 = p.y + sgn * CORNER_SLOP;
            if (!blocked(wantX, ny2) && !blocked(p.x, ny2)) {
              p.y += sgn * Math.min(CORNER_NUDGE * dt, CORNER_SLOP);
              if (!blocked(wantX, p.y)) { p.x = wantX; }
              slid = true;
            }
          }
          if (!slid) { p.x = snapAxis(p.x, stepX, true); p.vx = 0; }
        }
      }

      if (stepY !== 0) {
        var wantY = p.y + stepY;
        if (!blocked(p.x, wantY)) p.y = wantY;
        else {
          var slid2 = false;
          for (var sgn2 = -1; sgn2 <= 1 && !slid2; sgn2 += 2) {
            var nx2 = p.x + sgn2 * CORNER_SLOP;
            if (!blocked(nx2, wantY) && !blocked(nx2, p.y)) {
              p.x += sgn2 * Math.min(CORNER_NUDGE * dt, CORNER_SLOP);
              if (!blocked(p.x, wantY)) { p.y = wantY; }
              slid2 = true;
            }
          }
          if (!slid2) { p.y = snapAxis(p.y, stepY, false); p.vy = 0; }
        }
      }

      p.x = clamp(p.x, RADIUS, W - RADIUS);
      p.y = clamp(p.y, RADIUS, H - RADIUS);

      /* ---- facing --------------------------------------------------------- */
      var target = p.facing;
      if (speed > 0.35) target = Math.atan2(p.vy, p.vx);
      else if (mouse.inside) target = Math.atan2(mouse.y - p.y, mouse.x - p.x);
      p.facing += angleDelta(p.facing, target) * Math.min(1, dt * 14);

      /* ---- tile transitions ---------------------------------------------- */
      var ntx = p.x | 0, nty = p.y | 0;
      if (ntx !== p.tx || nty !== p.ty) {
        // A diagonal cut across a junction must still cost both tiles, or the
        // engines that charge per step get quietly cheated.
        if (ntx !== p.tx && nty !== p.ty) {
          if (!map.solid(ntx, p.ty)) enterTile(ntx, p.ty);
          else if (!map.solid(p.tx, nty)) enterTile(p.tx, nty);
        }
        enterTile(ntx, nty);
      }

      /* ---- footfalls ------------------------------------------------------ */
      if (speed > 1.2) {
        stepTimer -= dt * (speed / MAX_SPEED);
        if (stepTimer <= 0) {
          stepTimer = 0.19;
          dust(p.x - p.vx * 0.06, p.y - p.vy * 0.06 + 0.16, 2);
        }
      } else stepTimer = 0;

      p.bob = speed > 0.3 ? Math.sin(clock * 15) * 1.6 : Math.sin(clock * 2.1) * 1.1;
    }

    /** Park flush against the wall we just hit rather than a pixel short of it. */
    function snapAxis(v, delta, isX) {
      var t = delta > 0 ? Math.ceil(v) : Math.floor(v);
      var want = delta > 0 ? t - RADIUS - 0.001 : t + RADIUS + 0.001;
      var probeX = isX ? want : p.x, probeY = isX ? p.y : want;
      return blocked(probeX, probeY) ? v : want;
    }

    function enterTile(tx, ty) {
      if (tx === p.tx && ty === p.ty) return;
      p.tx = tx; p.ty = ty;
      markSeen(tx + 0.5, ty + 0.5, litRadius);
      if (typeof opts.onStep === 'function') {
        try { opts.onStep(tx, ty, arena); } catch (e) { if (root.console) console.warn('[arena] onStep threw:', e); }
      }
      // 'step' things fire the moment you stand on them.
      for (var i = 0; i < things.length; i++) {
        var t = things[i];
        if (t.gone || t.done) continue;
        if (t.trigger !== 'step') continue;
        if (t.tx === tx && t.ty === ty) fire(t);
      }
    }

    function fire(t) {
      if (t.gone || (t.once && t.done)) return;
      t.done = true;
      t.pulse = 1;
      ring(t.x, t.y, t.tint || pal.acc2);
      if (typeof t.spec.onActivate === 'function') {
        try { t.spec.onActivate(arena, t.handle); }
        catch (e) { if (root.console) console.warn('[arena] onActivate threw:', e); }
      }
      if (t.once) t.gone = true;
    }

    function interact() {
      if (!nearest) return false;
      if (nearest.kind === 'station') { nearest.suppressed = false; openPanel(nearest); return true; }
      fire(nearest);
      return true;
    }

    function proximity() {
      var best = null, bestD = 1e9;
      for (var i = 0; i < things.length; i++) {
        var t = things[i];
        if (t.gone) continue;
        var d = len(t.x - p.x, t.y - p.y);
        var was = t.inRange;
        t.inRange = d <= t.radius;
        if (t.inRange && d < bestD) { bestD = d; best = t; }

        if (t.kind === 'station') {
          if (t.inRange && !was && !t.suppressed) openPanel(t);
          if (!t.inRange && was) { t.suppressed = false; if (openStation === t) closePanel(); }
        } else if (t.trigger === 'proximity' && t.inRange && !was) {
          fire(t);
        }
      }
      nearest = best;
    }

    /* ============================================================ PATROLS  */

    function updatePatrols(dt) {
      for (var i = 0; i < patrols.length; i++) {
        var pt = patrols[i];
        if (pt.waiting > 0) { pt.waiting -= dt; }
        else if (pt.route.length > 1) {
          var a = pt.route[pt.leg];
          var b = pt.route[(pt.leg + 1) % pt.route.length];
          var dx = b[0] - a[0], dy = b[1] - a[1];
          var d = len(dx, dy) || 1;
          pt.t += (pt.speed * dt) / d;
          if (pt.t >= 1) {
            pt.t = 0; pt.leg = (pt.leg + 1) % pt.route.length;
            pt.waiting = pt.wait;
            a = pt.route[pt.leg]; b = pt.route[(pt.leg + 1) % pt.route.length];
            dx = b[0] - a[0]; dy = b[1] - a[1];
          }
          pt.x = a[0] + dx * pt.t;
          pt.y = a[1] + dy * pt.t;
          pt.dir = Math.atan2(dy, dx);
        }

        pt.cool = Math.max(0, pt.cool - dt);
        pt.alert = Math.max(0, pt.alert - dt);

        if (pt.vision) {
          var vx = p.x - pt.x, vy = p.y - pt.y;
          var vd = len(vx, vy);
          if (vd <= pt.vision.range && Math.abs(angleDelta(pt.dir, Math.atan2(vy, vx))) <= pt.vision.fov / 2 && clearLine(pt.x, pt.y, p.x, p.y)) {
            pt.alert = 1.2;
            if (pt.cool <= 0) {
              pt.cool = 1.6;
              if (typeof pt.spec.onDetect === 'function') {
                try { pt.spec.onDetect(arena, pt); } catch (e) { /* engine's problem */ }
              }
              if (typeof opts.onDetect === 'function') {
                try { opts.onDetect(pt, arena); } catch (e2) { /* engine's problem */ }
              }
            }
          }
        }
      }
    }

    /* ============================================================== CAMERA */

    function updateCamera(dt) {
      var tx = cam.x, ty = cam.y;
      if (p.x - cam.x > CAM_DEAD) tx = p.x - CAM_DEAD;
      else if (cam.x - p.x > CAM_DEAD) tx = p.x + CAM_DEAD;
      if (p.y - cam.y > CAM_DEAD) ty = p.y - CAM_DEAD;
      else if (cam.y - p.y > CAM_DEAD) ty = p.y + CAM_DEAD;

      var k = 1 - Math.pow(CAM_LERP, dt);
      cam.x = lerp(cam.x, tx, k);
      cam.y = lerp(cam.y, ty, k);

      var halfW = view.w / tile / 2, halfH = view.h / tile / 2;
      cam.x = W <= halfW * 2 ? W / 2 : clamp(cam.x, halfW, W - halfW);
      cam.y = H <= halfH * 2 ? H / 2 : clamp(cam.y, halfH, H - halfH);
    }

    /* ============================================================ RENDERING */

    function resize() {
      if (destroyed) return;
      var w = el.clientWidth || 640;
      var hgt = el.clientHeight || 420;
      var dpr = Math.min(2, root.devicePixelRatio || 1);
      if (w === view.w && hgt === view.h && dpr === view.dpr) return;
      view.w = w; view.h = hgt; view.dpr = dpr;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(hgt * dpr));
      canvas.style.width = w + 'px';
      canvas.style.height = hgt + 'px';
      maskCv.width = canvas.width;
      maskCv.height = canvas.height;

      // Fit the whole map when it comfortably fits; otherwise scroll a camera.
      // The cap is generous on purpose: a 7x7 maze marooned in the middle of a
      // 1000px panel reads as a bug, not as darkness.
      var fit = Math.floor(Math.min(w / W, hgt / H));
      tile = opts.tileSize ? opts.tileSize : clamp(fit, 26, 78);
      if (!opts.tileSize && fit < 26) tile = 34;
    }

    function worldToScreenX(wx) { return (wx - cam.x) * tile + view.w / 2; }
    function worldToScreenY(wy) { return (wy - cam.y) * tile + view.h / 2; }

    function render() {
      var dpr = view.dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, view.w, view.h);

      // shake
      var ox = 0, oy = 0;
      if (shakeT > 0) {
        var amp = shakeMag * (shakeT / 0.32);
        ox = (noise('sh-x', clock * 900 | 0) - 0.5) * amp;
        oy = (noise('sh-y', clock * 900 | 0) - 0.5) * amp;
      }
      ctx.save();
      ctx.translate(ox, oy);

      drawFloor();
      drawThings();
      drawPatrols();
      drawParticles();
      drawPlayer();
      ctx.restore();

      drawLightMask(ox, oy);

      ctx.save();
      ctx.translate(ox, oy);
      drawRings();
      drawPrompt();
      ctx.restore();

      if (flashT > 0) {
        ctx.fillStyle = rgba(flashCol, 0.34 * (flashT / 0.42));
        ctx.fillRect(0, 0, view.w, view.h);
      }
    }

    function drawFloor() {
      var x0 = Math.max(0, Math.floor(cam.x - view.w / tile / 2) - 1);
      var x1 = Math.min(W - 1, Math.ceil(cam.x + view.w / tile / 2) + 1);
      var y0 = Math.max(0, Math.floor(cam.y - view.h / tile / 2) - 1);
      var y1 = Math.min(H - 1, Math.ceil(cam.y + view.h / tile / 2) + 2);
      var lip = Math.max(3, Math.round(tile * 0.17));

      for (var y = y0; y <= y1; y++) {
        for (var x = x0; x <= x1; x++) {
          var idx = y * W + x;
          if (!seen[idx]) continue;
          var sx = Math.round(worldToScreenX(x));
          var sy = Math.round(worldToScreenY(y));
          var n = shadeOf[idx];

          if (!map.solid(x, y)) {
            ctx.fillStyle = rgba(mix(pal.floorB, pal.floorA, n), 1);
            ctx.fillRect(sx, sy, tile + 1, tile + 1);
            // a faint grout line so movement reads against the floor
            ctx.fillStyle = rgba(pal.grid, 0.55);
            ctx.fillRect(sx, sy, tile + 1, 1);
            ctx.fillRect(sx, sy, 1, tile + 1);
            if (n > 0.86) {
              ctx.fillStyle = rgba(pal.wallLip, 0.11);
              ctx.fillRect(sx + tile * 0.3, sy + tile * 0.45, tile * 0.28, 2);
            }
          } else {
            // Base/shadow, then a raised cap: a cheap 3/4 read that stops the
            // map looking like a spreadsheet.
            ctx.fillStyle = rgba(pal.wallSide, 1);
            ctx.fillRect(sx, sy, tile + 1, tile + 1);
            ctx.fillStyle = rgba(mix(pal.wallTop, pal.wallSide, n * 0.4), 1);
            ctx.fillRect(sx, sy - lip, tile + 1, tile + 1);
            ctx.fillStyle = rgba(pal.wallLip, 0.5);
            ctx.fillRect(sx, sy - lip, tile + 1, 2);
            ctx.fillStyle = 'rgba(0,0,0,.5)';
            ctx.fillRect(sx, sy + tile - lip, tile + 1, lip + 1);
          }
        }
      }
    }

    function drawThings() {
      for (var i = 0; i < things.length; i++) {
        var t = things[i];
        if (t.gone) continue;
        var sx = worldToScreenX(t.x), sy = worldToScreenY(t.y);
        if (sx < -tile * 2 || sy < -tile * 2 || sx > view.w + tile * 2 || sy > view.h + tile * 2) continue;
        if (!seen[t.ty * W + t.tx]) continue;

        var pulse = 0.5 + 0.5 * Math.sin(clock * 2.4 + t.tx);
        var col = t.tint ? parseColor(t.tint) : (t.kind === 'station' ? pal.acc : pal.acc2);

        if (t.glow) {
          var gr = tile * (t.kind === 'station' ? 1.15 : 0.78) * (1 + pulse * 0.08);
          var g = ctx.createRadialGradient(sx, sy, 0, sx, sy, gr);
          g.addColorStop(0, rgba(col, t.solved ? 0.10 : 0.26 + pulse * 0.10));
          g.addColorStop(1, rgba(col, 0));
          ctx.fillStyle = g;
          ctx.beginPath(); ctx.arc(sx, sy, gr, 0, Math.PI * 2); ctx.fill();
        }

        // base plate
        ctx.beginPath();
        ctx.ellipse(sx, sy + tile * 0.22, tile * 0.31, tile * 0.13, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,.45)';
        ctx.fill();

        if (t.inRange && !t.solved) {
          ctx.strokeStyle = rgba(col, 0.55 + pulse * 0.35);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(sx, sy, tile * 0.44 + pulse * 2, 0, Math.PI * 2);
          ctx.stroke();
        }

        ctx.font = Math.round(tile * (t.kind === 'station' ? 0.62 : 0.5)) + 'px ' + EMOJI_FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.globalAlpha = t.solved ? 0.55 : 1;
        ctx.fillText(t.icon, sx, sy - (t.kind === 'station' ? tile * 0.05 : 0) + Math.sin(clock * 1.7 + t.ty) * 1.2);
        ctx.globalAlpha = 1;

        if (t.solved) {
          ctx.font = Math.round(tile * 0.3) + 'px ' + EMOJI_FONT;
          ctx.fillText('\u2714', sx + tile * 0.26, sy - tile * 0.26);
        }
      }
    }

    function drawPatrols() {
      for (var i = 0; i < patrols.length; i++) {
        var pt = patrols[i];
        var sx = worldToScreenX(pt.x), sy = worldToScreenY(pt.y);
        if (pt.vision) {
          var r = pt.vision.range * tile;
          var g = ctx.createRadialGradient(sx, sy, tile * 0.2, sx, sy, r);
          var warm = pt.alert > 0 ? [226, 105, 95] : pal.acc2;
          g.addColorStop(0, rgba(warm, pt.alert > 0 ? 0.30 : 0.17));
          g.addColorStop(1, rgba(warm, 0));
          ctx.fillStyle = g;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.arc(sx, sy, r, pt.dir - pt.vision.fov / 2, pt.dir + pt.vision.fov / 2);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = rgba(warm, pt.alert > 0 ? 0.5 : 0.22);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.ellipse(sx, sy + tile * 0.2, tile * 0.26, tile * 0.11, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,.5)';
        ctx.fill();
        ctx.font = Math.round(tile * 0.56) + 'px ' + EMOJI_FONT;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pt.icon, sx, sy);
        if (pt.alert > 0) {
          ctx.font = Math.round(tile * 0.4) + 'px ' + UI_FONT;
          ctx.fillStyle = 'rgba(226,105,95,' + clamp(pt.alert, 0, 1) + ')';
          ctx.fillText('!', sx, sy - tile * 0.6);
        }
      }
    }

    function drawParticles() {
      for (var i = 0; i < particles.length; i++) {
        var q = particles[i];
        var a = 1 - q.life / q.max;
        ctx.fillStyle = rgba(q.col, a * 0.4);
        ctx.beginPath();
        ctx.arc(worldToScreenX(q.x), worldToScreenY(q.y), q.size * a, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    function drawRings() {
      for (var i = 0; i < rings.length; i++) {
        var r = rings[i];
        var f = r.t / r.max;
        ctx.strokeStyle = rgba(r.col, (1 - f) * 0.7);
        ctx.lineWidth = 2 * (1 - f) + 0.5;
        ctx.beginPath();
        ctx.arc(worldToScreenX(r.x), worldToScreenY(r.y), tile * (0.2 + f * 0.9), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    function drawPlayer() {
      var sx = worldToScreenX(p.x), sy = worldToScreenY(p.y);
      var speed = len(p.vx, p.vy);

      ctx.beginPath();
      ctx.ellipse(sx, sy + tile * 0.24, tile * 0.28, tile * 0.12, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fill();

      var g = ctx.createRadialGradient(sx, sy, 0, sx, sy, tile * 0.85);
      g.addColorStop(0, rgba(pal.acc, 0.22));
      g.addColorStop(1, rgba(pal.acc, 0));
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(sx, sy, tile * 0.85, 0, Math.PI * 2); ctx.fill();

      // facing tick — small, so it informs without becoming a cursor
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(p.facing);
      ctx.fillStyle = rgba(pal.acc2, 0.55);
      ctx.beginPath();
      ctx.moveTo(tile * 0.38, 0);
      ctx.lineTo(tile * 0.22, -tile * 0.09);
      ctx.lineTo(tile * 0.22, tile * 0.09);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      var squash = 1 + Math.min(0.14, speed * 0.022);
      ctx.save();
      ctx.translate(sx, sy + p.bob * 0.5);
      ctx.scale(1 / squash, squash);
      ctx.font = Math.round(tile * 0.66) + 'px ' + EMOJI_FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.icon, 0, 0);
      ctx.restore();
    }

    function drawLightMask(ox, oy) {
      var dpr = view.dpr;
      maskCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      maskCtx.globalCompositeOperation = 'source-over';
      maskCtx.clearRect(0, 0, view.w, view.h);
      maskCtx.fillStyle = 'rgba(2,4,7,' + darkness + ')';
      maskCtx.fillRect(0, 0, view.w, view.h);

      maskCtx.globalCompositeOperation = 'destination-out';

      // Memory: ground you have already walked stays faintly readable once the
      // light moves off it. Without this the arena loses the mental map the
      // DOM version gave you for free, and navigation gets miserable.
      if (memory > 0) {
        maskCtx.fillStyle = 'rgba(255,255,255,' + memory + ')';
        var mx0 = Math.max(0, Math.floor(cam.x - view.w / tile / 2) - 1);
        var mx1 = Math.min(W - 1, Math.ceil(cam.x + view.w / tile / 2) + 1);
        var my0 = Math.max(0, Math.floor(cam.y - view.h / tile / 2) - 1);
        var my1 = Math.min(H - 1, Math.ceil(cam.y + view.h / tile / 2) + 2);
        var mlip = Math.max(3, Math.round(tile * 0.17));
        for (var my = my0; my <= my1; my++) {
          for (var mxx = mx0; mxx <= mx1; mxx++) {
            if (!seen[my * W + mxx]) continue;
            maskCtx.fillRect(
              Math.round(worldToScreenX(mxx)) + ox,
              Math.round(worldToScreenY(my)) - mlip + oy,
              tile + 1, tile + mlip + 1
            );
          }
        }
      }

      function hole(wx, wy, radiusTiles, strength) {
        var r = Math.max(6, radiusTiles * tile);
        var sx = worldToScreenX(wx) + ox, sy = worldToScreenY(wy) + oy;
        var g = maskCtx.createRadialGradient(sx, sy, 0, sx, sy, r);
        g.addColorStop(0, 'rgba(255,255,255,' + strength + ')');
        g.addColorStop(0.55, 'rgba(255,255,255,' + strength * 0.86 + ')');
        g.addColorStop(0.82, 'rgba(255,255,255,' + strength * 0.4 + ')');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        maskCtx.fillStyle = g;
        maskCtx.beginPath();
        maskCtx.arc(sx, sy, r, 0, Math.PI * 2);
        maskCtx.fill();
      }

      var flicker = lightStat <= 0 ? 0.82 + 0.18 * Math.sin(clock * 9.3) : 1;
      hole(p.x, p.y, litShown * flicker, 1);

      for (var i = 0; i < things.length; i++) {
        var t = things[i];
        if (t.gone || !t.emits) continue;
        // A thing only lights itself once you have actually found it. Otherwise
        // every cache in the maze advertises itself through the dark and the
        // whole detour-or-beeline decision evaporates.
        if (!seen[t.ty * W + t.tx]) continue;
        if (len(t.x - p.x, t.y - p.y) > litShown + t.emits + 7) continue;
        hole(t.x, t.y, t.emits, t.solved ? 0.28 : 0.45);
      }
      for (var j = 0; j < patrols.length; j++) {
        hole(patrols[j].x, patrols[j].y, 2.1, 0.5);
      }

      maskCtx.globalCompositeOperation = 'source-over';

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(maskCv, 0, 0);
      ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    }

    function drawPrompt() {
      if (!nearest || nearest.gone) return;
      if (nearest.kind === 'station' && openStation === nearest) return;
      var label = nearest.label || nearest.hint;
      if (!label) return;
      var txt = nearest.hint ? (label + '  \u00B7  ' + nearest.hint) : label;

      ctx.font = '600 ' + Math.max(11, Math.round(tile * 0.28)) + 'px ' + UI_FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var w = ctx.measureText(txt).width + 22;
      var sx = clamp(worldToScreenX(nearest.x), w / 2 + 6, view.w - w / 2 - 6);
      var sy = worldToScreenY(nearest.y) - tile * 0.72 + Math.sin(clock * 3) * 1.5;
      var hgt = 24;

      ctx.fillStyle = 'rgba(8,11,17,.9)';
      roundRect(sx - w / 2, sy - hgt / 2, w, hgt, 7);
      ctx.fill();
      ctx.strokeStyle = rgba(pal.acc, 0.6);
      ctx.lineWidth = 1;
      roundRect(sx - w / 2, sy - hgt / 2, w, hgt, 7);
      ctx.stroke();
      ctx.fillStyle = rgba(pal.acc2, 0.96);
      ctx.fillText(txt, sx, sy + 0.5);
    }

    function roundRect(x, y, w, hh, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + hh, r);
      ctx.arcTo(x + w, y + hh, x, y + hh, r);
      ctx.arcTo(x, y + hh, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    /* ================================================================ LOOP */

    function frame(ts) {
      if (destroyed) return;
      raf = root.requestAnimationFrame(frame);
      if (!last) last = ts;
      var dt = Math.min(0.05, (ts - last) / 1000);
      last = ts;
      if (!running || paused) { render(); return; }
      clock += dt;

      move(dt);
      proximity();
      updatePatrols(dt);
      updateCamera(dt);

      litShown = lerp(litShown, litRadius, 1 - Math.pow(0.02, dt));
      markSeen(p.x, p.y, litRadius);

      for (var i = particles.length - 1; i >= 0; i--) {
        var q = particles[i];
        q.life += dt;
        q.x += q.vx * dt; q.y += q.vy * dt;
        q.vx *= 0.92; q.vy *= 0.92;
        if (q.life >= q.max) particles.splice(i, 1);
      }
      for (var j = rings.length - 1; j >= 0; j--) {
        rings[j].t += dt;
        if (rings[j].t >= rings[j].max) rings.splice(j, 1);
      }
      for (var k = things.length - 1; k >= 0; k--) {
        if (things[k].pulse > 0) things[k].pulse = Math.max(0, things[k].pulse - dt * 2);
      }

      if (shakeT > 0) { shakeT -= dt; if (shakeT <= 0) { shakeT = 0; shakeMag = 0; } }
      if (flashT > 0) flashT = Math.max(0, flashT - dt);

      if (typeof opts.onTick === 'function') {
        try { opts.onTick(dt, arena); } catch (e) { if (root.console) console.warn('[arena] onTick threw:', e); }
      }

      resize();
      render();
    }

    /* ============================================================ HUD BITS */

    function hudChip(label, icon) {
      var v = h('b', { class: 'ps-arena__chip-v', text: '' });
      var node = h('div', { class: 'ps-arena__chip' }, [
        icon ? h('span', { class: 'ps-arena__chip-i', text: icon }) : null,
        h('span', { class: 'ps-arena__chip-k', text: label }),
        v
      ]);
      hudEl.appendChild(node);
      return {
        el: node,
        set: function (text, tone) {
          v.textContent = String(text);
          node.className = 'ps-arena__chip' + (tone ? ' is-' + tone : '');
          return this;
        },
        remove: function () { if (node.parentNode) node.parentNode.removeChild(node); }
      };
    }

    function hudMeter(label, icon) {
      var fill = h('i', { class: 'ps-arena__mfill' });
      var v = h('b', { class: 'ps-arena__chip-v', text: '' });
      var node = h('div', { class: 'ps-arena__meter' }, [
        icon ? h('span', { class: 'ps-arena__chip-i', text: icon }) : null,
        h('span', { class: 'ps-arena__chip-k', text: label }),
        h('span', { class: 'ps-arena__mtrack' }, [fill]),
        v
      ]);
      hudEl.appendChild(node);
      return {
        el: node,
        set: function (pct, text, tone) {
          fill.style.width = clamp(pct, 0, 100) + '%';
          v.textContent = text === undefined ? Math.round(pct) : String(text);
          node.className = 'ps-arena__meter' + (tone ? ' is-' + tone : '');
          return this;
        },
        remove: function () { if (node.parentNode) node.parentNode.removeChild(node); }
      };
    }

    function footButton(label, onClick, cls) {
      var b = h('button', { class: 'pz-btn pz-btn--sm ' + (cls || ''), type: 'button' }, [label]);
      b.addEventListener('click', onClick);
      footEl.appendChild(b);
      return b;
    }

    function footNote(text) {
      var n = h('div', { class: 'ps-arena__note', text: text });
      footEl.appendChild(n);
      return n;
    }

    /* ============================================================ BOT PATH */
    /* The ?dev=1 autoplay bot cannot press W. Give it a way to walk that runs
       instantly and fires every single tile event a human walk would. */

    function botTargets() {
      var out = [];
      for (var i = 0; i < things.length; i++) {
        var t = things[i];
        if (t.gone) continue;
        out.push({
          id: t.id, x: t.tx, y: t.ty, kind: t.kind, label: t.label,
          done: t.kind === 'station' ? t.solved : t.done,
          skip: t.botSkip,
          reachable: !!findPath(p.tx, p.ty, t.tx, t.ty)
        });
      }
      return out;
    }

    function botGoTo(target) {
      if (destroyed) return false;
      var gx, gy, i;
      if (typeof target === 'string') {
        for (i = 0; i < things.length; i++) {
          if (things[i].id === target && !things[i].gone) { gx = things[i].tx; gy = things[i].ty; break; }
        }
        if (gx === undefined) return false;
      } else if (target && typeof target === 'object') {
        gx = target.x | 0; gy = target.y | 0;
      } else return false;

      var path = findPath(p.tx, p.ty, gx, gy);
      if (!path) return false;
      for (i = 0; i < path.length; i++) {
        p.x = path[i][0] + 0.5;
        p.y = path[i][1] + 0.5;
        p.vx = 0; p.vy = 0;
        enterTile(path[i][0], path[i][1]);
        if (destroyed) return true;
      }
      cam.x = p.x; cam.y = p.y;
      pathQ = null;
      proximity();
      return true;
    }

    function botInteract() { return interact(); }

    /* ============================================================== PUBLIC */

    arena = {
      el: el,
      canvas: canvas,
      hud: hudEl,
      foot: footEl,
      panel: panelEl,
      panelBody: panelBody,
      width: W,
      height: H,

      /** The adapter: an engine's existing DOM panel, behind a walk. */
      station: function (spec) {
        var t = addThing(spec, 'station');
        t.handle = handleFor(t);
        return t.handle;
      },

      /** Anything you walk onto or press E at: pickups, hazards, doors. */
      prop: function (spec) {
        var t = addThing(spec, 'prop');
        t.handle = handleFor(t);
        return t.handle;
      },

      patrol: addPatrol,

      /* world */
      setTile: function (x, y, solid) { if (map.set) map.set(x, y, solid); return arena; },
      isSolid: function (x, y) { return map.solid(x | 0, y | 0); },
      isSeen: function (x, y) { return !!seen[(y | 0) * W + (x | 0)]; },
      reveal: function (x, y, r) { markSeen((x | 0) + 0.5, (y | 0) + 0.5, r || 3); return arena; },
      revealAll: function () { for (var i = 0; i < seen.length; i++) seen[i] = 1; return arena; },
      walkable: walkable,
      path: function (gx, gy) { return findPath(p.tx, p.ty, gx, gy); },

      /* light */
      setLight: setLight,
      light: function () { return lightStat; },
      lightRadius: function () { return litRadius; },
      setDarkness: function (v) { darkness = clamp(Number(v) || 0, 0, 1); return arena; },
      setMemory: function (v) { memory = clamp(Number(v) || 0, 0, 1); return arena; },

      /* avatar */
      player: function () { return { x: p.x, y: p.y, tx: p.tx, ty: p.ty, vx: p.vx, vy: p.vy, facing: p.facing }; },
      teleport: function (x, y) {
        p.x = (x | 0) + 0.5; p.y = (y | 0) + 0.5; p.vx = 0; p.vy = 0;
        cam.x = p.x; cam.y = p.y; pathQ = null;
        enterTile(x | 0, y | 0);
        return arena;
      },
      goTo: goTo,
      stop: function () { p.vx = 0; p.vy = 0; pathQ = null; keys = {}; return arena; },
      setAvatar: function (icon) { p.icon = icon; return arena; },

      /* juice */
      shake: shake,
      hit: hit,
      dust: function (x, y, n, col) { dust(x + 0.5, y + 0.5, n || 6, col ? parseColor(col) : null); return arena; },
      ping: function (x, y, col) { ring((x | 0) + 0.5, (y | 0) + 0.5, col ? parseColor(col) : pal.acc2); return arena; },
      retint: retint,

      /* DOM helpers so twenty engines get one consistent HUD for free */
      chip: hudChip,
      meter: hudMeter,
      button: footButton,
      note: footNote,
      closePanel: closePanel,

      /* control */
      pause: function (v) { paused = v === undefined ? true : !!v; if (paused) keys = {}; return arena; },
      isPaused: function () { return paused; },
      focus: function () { try { canvas.focus(); } catch (e) { /* not focusable everywhere */ } return arena; },

      /* bot */
      botTargets: botTargets,
      botGoTo: botGoTo,
      botInteract: botInteract,

      destroy: function () {
        if (destroyed) return;
        destroyed = true;
        running = false;
        if (raf) root.cancelAnimationFrame(raf);
        raf = 0;
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('keyup', onKeyUp);
        document.removeEventListener('mouseup', onMouseUp);
        root.removeEventListener('blur', onBlur);
        root.removeEventListener('resize', resize);
        canvas.removeEventListener('mousemove', onMouseMove);
        canvas.removeEventListener('mousedown', onMouseDown);
        canvas.removeEventListener('mouseleave', onMouseLeave);
        canvas.removeEventListener('contextmenu', onContext);
        canvas.removeEventListener('touchstart', onTouchStart);
        canvas.removeEventListener('touchmove', onTouchMove);
        canvas.removeEventListener('touchend', onTouchEnd);
        things.length = 0;
        patrols.length = 0;
        particles.length = 0;
        rings.length = 0;
        openStation = null;
        maskCv.width = maskCv.height = 1;
        canvas.width = canvas.height = 1;
        if (el.parentNode) el.parentNode.removeChild(el);
        if (active === arena) active = null;
      }
    };

    canvas.setAttribute('tabindex', '0');
    canvas.setAttribute('aria-label', 'Playable arena. Move with WASD, arrow keys or the mouse. Press E to use.');
    resize();
    cam.x = p.x; cam.y = p.y;
    markSeen(p.x, p.y, litRadius);
    proximity();
    active = arena;
    raf = root.requestAnimationFrame(frame);
    return arena;
  }

  PS.arena = {
    create: create,
    active: function () { return active; },
    destroyActive: function () { if (active) active.destroy(); }
  };

})(typeof window !== 'undefined' ? window : this);
