/* ==========================================================================
   PuzzleStudio — js/games/e06_cipher_decode.js       ENGINE 06 · Cipher Decode
   --------------------------------------------------------------------------
   Self-contained: logic + 3 skins + its own CSS. No DOM access until mount().

   THE PUZZLE
     Somebody out there is still transmitting, and they are not transmitting
     in plain. Three ciphers, climbing with the tier:

       T1-T2   Caesar shift      a dial you turn until the words appear
       T3-T4   Keyword alphabet  a mapping pad you fill in letter by letter
       T5+     Morse             a chart, a set of groups, and some of the
                                 groups arrived damaged and have to be read
                                 out of the shape of the word around them

     Above T8 it cycles back through all three at full difficulty so a long
     run does not become one cipher forever.

     Every mode is a real working decode surface — a shift dial, a mapping
     pad, a group-by-group transcription board — never a box to type the
     answer into. Everything is seeded and reproducible, and every message
     is verified decodable against the key before the scene starts.

   THE BRANCH — and it is the important one
     Once you have it, there is a person at the other end of it. You can
     answer, which costs you supplies and ties you to somebody else's
     problem and gets you an ally. Or you can sit on your hands and listen
     to it repeat until it stops.

     Answering hands over an `ally`, which is what core's derived-tag pass
     turns into `has_ally` — the flag the Director reads to pull hard toward
     allocation and barter scenes for the rest of the run. It is deliberately
     NOT set through `tags`: CONTRACT.md reserves the derived tags for core,
     and deriveTags() would strip it back off anyway the moment the ally left.
   ========================================================================== */
(function (root) {
  'use strict';

  var PS = root.PuzzleStudio;
  if (!PS || !PS.registry) { if (root.console) console.error('[e06] core not loaded'); return; }

  var ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  var MORSE = {
    A: '.-', B: '-...', C: '-.-.', D: '-..', E: '.', F: '..-.', G: '--.', H: '....',
    I: '..', J: '.---', K: '-.-', L: '.-..', M: '--', N: '-.', O: '---', P: '.--.',
    Q: '--.-', R: '.-.', S: '...', T: '-', U: '..-', V: '...-', W: '.--', X: '-..-',
    Y: '-.--', Z: '--..'
  };

  /* ======================================================== SKIN CONTENT == */

  var CONTENT = {
    radio_tower: {
      source: 'the set', sourceIcon: '\uD83D\uDCFB',
      channel: '121.5 repeating, weak, and somebody keeps keying it.',
      caller: 'a maintenance crew three valleys over',
      answerTitle: 'Key the mic',
      answerDesc: 'Give them your position and a time. They will come, and they will arrive hungry, cold and owed.',
      silentTitle: 'Log it and say nothing',
      silentDesc: 'Write the message in the margin of the manual, put the handset down, and let it repeat into an empty room.',
      answered: 'You key the mic twice and a voice comes back so fast they must have been holding the handset.',
      silent: 'You listen to it four more times. On the fifth it stops, and the hiss afterwards is a different kind of quiet.',
      messages: [
        'MAYDAY WE ARE UNDER THE WEST STAIR',
        'FOUR ALIVE NO WATER SINCE TUESDAY',
        'BRIDGE IS OUT DO NOT COME BY ROAD',
        'RELAY BURNING SEND ANYONE WHO CAN WALK',
        'WE HAVE FUEL AND NOTHING TO PUT IT IN',
        'HOLDING AT THE MAST UNTIL FIRST LIGHT'
      ],
      keywords: ['LIFEBOAT', 'BLACKOUT', 'SANDSTORM', 'CROWBAR', 'DAYBREAK']
    },

    scratched_journal: {
      source: 'the journal', sourceIcon: '\uD83D\uDCD3',
      channel: 'Pencil, pressed hard, in a hand that was in a hurry.',
      caller: 'whoever was keeping this book',
      answerTitle: 'Go where it says',
      answerDesc: 'Follow the page. Somebody wrote it for a reason and somebody may still be at the end of it, needing more than you have.',
      silentTitle: 'Close the book',
      silentDesc: 'Put it back on the shelf exactly as you found it and take the corridor you were already taking.',
      answered: 'You find them where the page said, and they look at you the way people look at weather.',
      silent: 'You shut the cover. The spine cracks like it has not been opened in a while, which is not true.',
      messages: [
        'THEY LEFT AT DAWN BY THE LOWER DOOR',
        'DO NOT DRINK FROM THE SOUTH TANK',
        'MEET AT THE CHAPEL IF IT ALL GOES WRONG',
        'THE KEY IS UNDER THE THIRD STEP',
        'NINE OF US WENT DOWN AND SIX CAME BACK',
        'IF YOU READ THIS I AM STILL ALIVE'
      ],
      keywords: ['CHAPEL', 'LANTERN', 'WINDROSE', 'FOXGLOVE', 'MIDNIGHT']
    },

    buoy_morse: {
      source: 'the buoy', sourceIcon: '\uD83D\uDEA2',
      channel: 'A light on the water, blinking on a cycle, going nowhere.',
      caller: 'a boat that is still afloat somewhere off the point',
      answerTitle: 'Answer with the torch',
      answerDesc: 'Flash it back. They will pull for the light, and what comes ashore will be cold, soaked and entirely your problem.',
      silentTitle: 'Watch it and stay dark',
      silentDesc: 'Note the cycle, note the bearing, and do not put a light on the water for anything to steer by.',
      answered: 'The blinking stops mid-cycle. Twenty minutes later you hear oars.',
      silent: 'It blinks for another hour, slows, and goes out. The dark afterwards is total.',
      messages: [
        'TAKING WATER OFF THE POINT',
        'SIX SOULS IN THE BOAT NO ENGINE',
        'SEND LIGHT WE CANNOT SEE THE SHORE',
        'DRIFTING WEST WITH THE TIDE',
        'WE HAVE THE CHILD SHE IS COLD',
        'ANCHOR IS GONE AND SO IS THE MAST'
      ],
      keywords: ['SEAWALL', 'HARBOUR', 'NORTHING', 'DRIFTWOOD', 'MOONRISE']
    }
  };

  /* ============================================================= CIPHERS == */

  function caesarEncode(plain, shift) {
    var out = '';
    for (var i = 0; i < plain.length; i++) {
      var ch = plain.charAt(i);
      var at = ALPHA.indexOf(ch);
      out += at < 0 ? ch : ALPHA.charAt((at + shift) % 26);
    }
    return out;
  }

  function caesarDecode(cipher, shift) {
    return caesarEncode(cipher, (26 - (shift % 26)) % 26);
  }

  /** Keyword alphabet: unique letters of the key, then the rest in order. */
  function keyedAlphabet(word) {
    var seen = {}, out = '', i, ch;
    for (i = 0; i < word.length; i++) {
      ch = word.charAt(i);
      if (ALPHA.indexOf(ch) < 0 || seen[ch]) continue;
      seen[ch] = true; out += ch;
    }
    for (i = 0; i < 26; i++) {
      ch = ALPHA.charAt(i);
      if (seen[ch]) continue;
      seen[ch] = true; out += ch;
    }
    return out;
  }

  function substEncode(plain, keyed) {
    var out = '';
    for (var i = 0; i < plain.length; i++) {
      var at = ALPHA.indexOf(plain.charAt(i));
      out += at < 0 ? plain.charAt(i) : keyed.charAt(at);
    }
    return out;
  }

  function morseGroups(plain) {
    var words = plain.split(' '), out = [], w, i;
    for (w = 0; w < words.length; w++) {
      if (w) out.push({ gap: true });
      for (i = 0; i < words[w].length; i++) {
        var ch = words[w].charAt(i);
        out.push({ gap: false, code: MORSE[ch] || '', plain: ch });
      }
    }
    return out;
  }

  /* ============================================================== BUILD == */

  function modeFor(tier, rng) {
    if (tier <= 2) return 'caesar';
    if (tier <= 4) return 'keyword';
    if (tier <= 7) return 'morse';
    return rng.pick(['caesar', 'keyword', 'morse']);   // top of the ladder cycles
  }

  function build(state, rng, tier, skin) {
    var C = CONTENT[skin.id] || CONTENT.radio_tower;
    var t = Math.min(8, tier);
    var mode = modeFor(tier, rng);

    // Longer messages the deeper you are, but never so long the pad becomes
    // an admin task. Take the first N words of the intercept.
    var full = rng.pick(C.messages);
    var words = full.split(' ');
    var keep = Math.min(words.length, Math.max(4, 3 + Math.ceil(t / 2)));
    var plain = words.slice(0, keep).join(' ');

    var puzzle = {
      tier: t,
      mode: mode,
      plain: plain,
      cipher: '',
      attempts: 0,
      solved: false,
      content: C,
      // caesar
      shift: 0, dial: 0,
      // keyword
      keyword: '', keyed: '', bound: {}, given: {}, selected: null,
      // morse
      groups: [], answers: [], damaged: {}, picked: -1
    };

    if (mode === 'caesar') {
      puzzle.shift = rng.int(3, 23);
      puzzle.cipher = caesarEncode(plain, puzzle.shift);
      // Start the dial anywhere except the answer, and never adjacent to it,
      // so the first two clicks can't fall into it.
      do { puzzle.dial = rng.int(0, 25); }
      while (Math.abs(puzzle.dial - puzzle.shift) <= 1);
    } else if (mode === 'keyword') {
      puzzle.keyword = rng.pick(C.keywords);
      puzzle.keyed = keyedAlphabet(puzzle.keyword);
      puzzle.cipher = substEncode(plain, puzzle.keyed);

      // Freebies: hand over part of the mapping so the rest falls out of
      // word shape and the fact that a keyword alphabet runs in plain order
      // after the key. Fewer the deeper you go, but never so few that it
      // stops being deduction and turns into a search.
      var used = [], seen = {}, i, ch;
      for (i = 0; i < plain.length; i++) {
        ch = plain.charAt(i);
        if (ch === ' ' || seen[ch]) continue;
        seen[ch] = true; used.push(ch);
      }
      var share = Math.max(0.34, 0.55 - t * 0.045);
      var freebies = Math.max(1, Math.round(used.length * share));
      var gift = rng.sample(used, Math.min(freebies, Math.max(0, used.length - 2)));
      for (i = 0; i < gift.length; i++) {
        var cipherCh = puzzle.keyed.charAt(ALPHA.indexOf(gift[i]));
        puzzle.given[cipherCh] = gift[i];
        puzzle.bound[cipherCh] = gift[i];
      }
    } else {
      puzzle.groups = morseGroups(plain);
      puzzle.cipher = plain;

      var letters = [];
      for (var g = 0; g < puzzle.groups.length; g++) {
        puzzle.answers.push(puzzle.groups[g].gap ? null : '');
        if (!puzzle.groups[g].gap) letters.push(g);
      }

      // Salt water and bad aerials: some groups arrive with a symbol missing,
      // and have to be read out of the shape of the word they sit in.
      var breaks = Math.min(letters.length - 2, Math.max(1, Math.round(t / 1.6)));
      var hurt = rng.sample(letters, Math.max(0, breaks));
      for (var b = 0; b < hurt.length; b++) {
        var grp = puzzle.groups[hurt[b]];
        if (!grp.code.length) continue;
        var at = rng.int(0, grp.code.length - 1);
        grp.shown = grp.code.substring(0, at) + '?' + grp.code.substring(at + 1);
        puzzle.damaged[hurt[b]] = true;
      }
      for (var s2 = 0; s2 < puzzle.groups.length; s2++) {
        if (!puzzle.groups[s2].gap && !puzzle.groups[s2].shown) puzzle.groups[s2].shown = puzzle.groups[s2].code;
      }
    }

    return puzzle;
  }

  /* ------------------------------------------------------- reading it back */

  /** What the player's current settings say the message is. */
  function reading(puzzle) {
    var i, out;
    if (puzzle.mode === 'caesar') return caesarDecode(puzzle.cipher, puzzle.dial);
    if (puzzle.mode === 'keyword') {
      out = '';
      for (i = 0; i < puzzle.cipher.length; i++) {
        var ch = puzzle.cipher.charAt(i);
        if (ch === ' ') { out += ' '; continue; }
        out += puzzle.bound[ch] || '\u00B7';
      }
      return out;
    }
    out = '';
    for (i = 0; i < puzzle.groups.length; i++) {
      if (puzzle.groups[i].gap) { out += ' '; continue; }
      out += puzzle.answers[i] || '\u00B7';
    }
    return out;
  }

  function isRight(puzzle) { return reading(puzzle) === puzzle.plain; }

  /* ================================================================ CSS == */

  var CSS = [
    '.pz-ciph{display:flex;flex-direction:column;gap:16px}',

    '.pz-ciph-intercept{padding:12px 14px;border-radius:10px;border:1px solid var(--line);',
    '  background:#05070a;font-family:var(--font-mono);font-size:clamp(12px,2.1vw,15px);',
    '  letter-spacing:.16em;color:var(--dim);word-break:break-word;line-height:1.9}',
    '.pz-ciph-intercept b{color:var(--text-2);font-weight:400}',

    '.pz-ciph-out{padding:14px;border-radius:10px;border:1px solid var(--line);',
    '  background:linear-gradient(180deg,var(--panel-2),var(--panel));font-family:var(--font-mono);',
    '  font-size:clamp(13px,2.4vw,17px);letter-spacing:.2em;line-height:1.9;color:var(--acc-2);',
    '  word-break:break-word;min-height:32px}',
    '.pz-ciph-out.is-right{border-color:var(--acc);box-shadow:0 0 26px var(--acc-glow) inset}',
    '.pz-ciph-out .un{color:var(--dimmer)}',

    '.pz-ciph-dial{display:flex;gap:14px;align-items:center;flex-wrap:wrap}',
    '.pz-ciph-dial__n{font-family:var(--font-mono);font-size:34px;font-weight:700;color:var(--acc-2);min-width:56px;text-align:center}',
    '.pz-ciph-dial__l{font-family:var(--font-mono);font-size:12px;color:var(--dim);line-height:1.7}',
    '.pz-ciph-wheel{display:flex;flex-wrap:wrap;gap:3px}',
    '.pz-ciph-wheel__c{display:flex;flex-direction:column;align-items:center;padding:3px 5px;border-radius:5px;',
    '  border:1px solid var(--line-soft);background:var(--panel);font-family:var(--font-mono);font-size:10px}',
    '.pz-ciph-wheel__c b{color:var(--acc-2);font-size:11px}',
    '.pz-ciph-wheel__c span{color:var(--dimmer)}',

    '.pz-ciph-pad{display:grid;grid-template-columns:repeat(auto-fill,minmax(46px,1fr));gap:5px}',
    '.pz-ciph-key{display:flex;flex-direction:column;align-items:center;gap:1px;padding:6px 2px;border-radius:7px;',
    '  border:1px solid var(--line);background:var(--panel-2);color:var(--text);cursor:pointer;',
    '  font-family:var(--font-mono);font-size:13px;transition:border-color .14s var(--ease),transform .14s var(--ease)}',
    '.pz-ciph-key:hover:not(:disabled){border-color:var(--acc);transform:translateY(-2px)}',
    '.pz-ciph-key:disabled{opacity:.3;cursor:default}',
    '.pz-ciph-key small{font-size:9px;color:var(--dim);letter-spacing:.04em}',
    '.pz-ciph-key.is-sel{border-color:var(--acc);background:var(--acc-wash);box-shadow:0 0 14px var(--acc-glow)}',
    '.pz-ciph-key.is-bound small{color:var(--acc-2)}',
    '.pz-ciph-key.is-given{border-style:dashed}',

    '.pz-ciph-groups{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
    '.pz-ciph-grp{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 9px;border-radius:8px;',
    '  border:1px solid var(--line);background:var(--panel-2);color:var(--text-2);cursor:pointer;',
    '  font-family:var(--font-mono);font-size:14px;letter-spacing:.12em;',
    '  transition:border-color .14s var(--ease),transform .14s var(--ease)}',
    '.pz-ciph-grp:hover:not(:disabled){border-color:var(--acc);transform:translateY(-2px)}',
    '.pz-ciph-grp:disabled{opacity:.35;cursor:default}',
    '.pz-ciph-grp b{font-size:12px;color:var(--acc-2);letter-spacing:0}',
    '.pz-ciph-grp.is-sel{border-color:var(--acc);background:var(--acc-wash)}',
    '.pz-ciph-grp.is-hurt{border-color:var(--bad);color:var(--bad)}',
    '.pz-ciph-grp.is-hurt b{color:var(--warn)}',
    '.pz-ciph-space{width:14px}',

    '.pz-ciph-chart{display:grid;grid-template-columns:repeat(auto-fill,minmax(62px,1fr));gap:3px;',
    '  font-family:var(--font-mono);font-size:11px;color:var(--dim)}',
    '.pz-ciph-chart span b{color:var(--text-2);margin-right:5px}',

    '.pz-ciph-note{font-size:12px;color:var(--dim);line-height:1.55}',
    '.pz-ciph-bad{font-size:12px;line-height:1.5;color:var(--bad);padding:8px 10px;border-radius:7px;',
    '  background:rgba(226,105,95,.08);border:1px solid rgba(226,105,95,.28)}'
  ].join('\n');

  /* ================================================================ MOUNT = */

  var teardownFns = [];

  function mount(el, state, api, puzzle, skin) {
    var h = PS.ui.h;
    var C = puzzle.content;
    var finished = false;

    var interceptBox = h('div', { class: 'pz-ciph-intercept' });
    var outBox   = h('div', { class: 'pz-ciph-out' });
    var toolBox  = h('div', { class: 'pz-col' });
    var noteBox  = h('div', {});
    var actions  = h('div', { class: 'pz-col' });

    /* --------------------------------------------------------- the output */

    function paintOut() {
      var txt = reading(puzzle);
      PS.ui.clear(outBox);
      for (var i = 0; i < txt.length; i++) {
        var ch = txt.charAt(i);
        if (ch === '\u00B7') outBox.appendChild(h('span', { class: 'un', text: '\u00B7' }));
        else outBox.appendChild(h('span', { text: ch }));
      }
      var right = isRight(puzzle);
      outBox.className = 'pz-ciph-out' + (right ? ' is-right' : '');

      PS.ui.clear(noteBox);
      if (!puzzle.solved && right) {
        noteBox.appendChild(h('div', { class: 'pz-note', text: 'That reads. Send it through when you are sure.' }));
      } else if (!puzzle.solved && puzzle.attempts) {
        noteBox.appendChild(h('div', { class: 'pz-ciph-bad',
          text: 'That is not language. ' + puzzle.attempts + ' bad read' + (puzzle.attempts === 1 ? '' : 's') + ' so far, and each one costs you.' }));
      }
    }

    function paintIntercept() {
      PS.ui.clear(interceptBox);
      if (puzzle.mode === 'morse') {
        interceptBox.appendChild(h('span', { text: C.channel }));
        return;
      }
      for (var i = 0; i < puzzle.cipher.length; i++) {
        var ch = puzzle.cipher.charAt(i);
        interceptBox.appendChild(ch === ' ' ? h('span', { text: '\u2003' }) : h('b', { text: ch }));
      }
    }

    /* ------------------------------------------------------- CAESAR: dial */

    function buildDial() {
      var num = h('div', { class: 'pz-ciph-dial__n', text: String(puzzle.dial) });
      var wheel = h('div', { class: 'pz-ciph-wheel' });

      function paintWheel() {
        num.textContent = String(puzzle.dial);
        PS.ui.clear(wheel);
        for (var i = 0; i < 26; i++) {
          wheel.appendChild(h('span', { class: 'pz-ciph-wheel__c' }, [
            h('b', { text: ALPHA.charAt(i) }),
            h('span', { text: ALPHA.charAt((i + 26 - puzzle.dial) % 26) })
          ]));
        }
      }

      function nudge(by) {
        if (finished || puzzle.solved) return;
        puzzle.dial = (puzzle.dial + by + 26) % 26;
        paintWheel();
        paintOut();
      }

      paintWheel();
      return h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-ciph-dial' }, [
          h('button', { class: 'pz-btn', type: 'button', onclick: function () { nudge(-1); } }, ['\u25C0 back one']),
          num,
          h('button', { class: 'pz-btn', type: 'button', onclick: function () { nudge(1); } }, ['on one \u25B6']),
          h('div', { class: 'pz-ciph-dial__l', text: 'Turns of the ring \u2014 cipher letter on top, plain underneath.' })
        ]),
        wheel
      ]);
    }

    /* --------------------------------------------------- KEYWORD: the pad */

    function buildPad() {
      var cipherPad = h('div', { class: 'pz-ciph-pad' });
      var plainPad  = h('div', { class: 'pz-ciph-pad' });

      // Only the cipher letters that actually occur — no busywork.
      var present = [], seen = {}, i, ch;
      for (i = 0; i < puzzle.cipher.length; i++) {
        ch = puzzle.cipher.charAt(i);
        if (ch === ' ' || seen[ch]) continue;
        seen[ch] = true; present.push(ch);
      }
      present.sort();

      function usedPlain(p) {
        for (var k in puzzle.bound) {
          if (Object.prototype.hasOwnProperty.call(puzzle.bound, k) && puzzle.bound[k] === p) return k;
        }
        return null;
      }

      function paintPads() {
        PS.ui.clear(cipherPad);
        for (var j = 0; j < present.length; j++) {
          (function (cch) {
            var bound = puzzle.bound[cch];
            var given = !!puzzle.given[cch];
            var b = h('button', {
              type: 'button',
              class: 'pz-ciph-key' + (puzzle.selected === cch ? ' is-sel' : '') +
                     (bound ? ' is-bound' : '') + (given ? ' is-given' : ''),
              disabled: finished || puzzle.solved || given,
              title: given ? 'Already known from the header.' : 'Select, then pick what it stands for.'
            }, [
              h('span', { text: cch }),
              h('small', { text: bound || '\u2013' })
            ]);
            b.addEventListener('click', function () { selectCipher(cch); });
            cipherPad.appendChild(b);
          })(present[j]);
        }

        PS.ui.clear(plainPad);
        for (var k = 0; k < 26; k++) {
          (function (pch) {
            var taken = usedPlain(pch);
            var b = h('button', {
              type: 'button',
              class: 'pz-ciph-key' + (taken ? ' is-bound' : ''),
              disabled: finished || puzzle.solved || !puzzle.selected || (taken && puzzle.given[taken]),
              title: taken ? 'Currently stands for ' + taken : 'Assign to the selected letter'
            }, [
              h('span', { text: pch }),
              h('small', { text: taken || ' ' })
            ]);
            b.addEventListener('click', function () { assign(pch); });
            plainPad.appendChild(b);
          })(ALPHA.charAt(k));
        }
      }

      function selectCipher(cch) {
        if (finished || puzzle.solved || puzzle.given[cch]) return;
        puzzle.selected = puzzle.selected === cch ? null : cch;
        paintPads();
      }

      function assign(pch) {
        if (finished || puzzle.solved || !puzzle.selected) return;
        var holder = usedPlain(pch);
        if (holder && holder !== puzzle.selected && puzzle.given[holder]) {
          api.toast(pch + ' is already spoken for by ' + holder + '.', 'bad', 1500);
          return;
        }
        if (puzzle.bound[puzzle.selected] === pch) {
          delete puzzle.bound[puzzle.selected];        // clicking it again clears it
        } else {
          if (holder) delete puzzle.bound[holder];     // a plain letter maps once
          puzzle.bound[puzzle.selected] = pch;
        }
        puzzle.selected = null;
        paintPads();
        paintOut();
      }

      paintPads();
      return h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-ciph-note', text: 'Pick a cipher letter, then the letter you think it stands for. The ones with a dashed edge came free with the header.' }),
        cipherPad,
        h('div', { class: 'pz-ciph-note', text: 'Plain alphabet' }),
        plainPad
      ]);
    }

    /* -------------------------------------------------- MORSE: the groups */

    function buildMorse() {
      var groupBox = h('div', { class: 'pz-ciph-groups' });
      var letterPad = h('div', { class: 'pz-ciph-pad' });
      var chart = h('div', { class: 'pz-ciph-chart' });

      for (var c = 0; c < 26; c++) {
        chart.appendChild(h('span', {}, [
          h('b', { text: ALPHA.charAt(c) }),
          MORSE[ALPHA.charAt(c)]
        ]));
      }

      function paintGroups() {
        PS.ui.clear(groupBox);
        for (var i = 0; i < puzzle.groups.length; i++) {
          if (puzzle.groups[i].gap) { groupBox.appendChild(h('span', { class: 'pz-ciph-space' })); continue; }
          (function (ix) {
            var g = puzzle.groups[ix];
            var b = h('button', {
              type: 'button',
              class: 'pz-ciph-grp' + (puzzle.picked === ix ? ' is-sel' : '') + (puzzle.damaged[ix] ? ' is-hurt' : ''),
              disabled: finished || puzzle.solved,
              title: puzzle.damaged[ix] ? 'This one came through broken.' : 'Read it off the chart.'
            }, [
              h('span', { text: g.shown }),
              h('b', { text: puzzle.answers[ix] || '\u00B7' })
            ]);
            b.addEventListener('click', function () { pick(ix); });
            groupBox.appendChild(b);
          })(i);
        }
      }

      function paintLetters() {
        PS.ui.clear(letterPad);
        for (var k = 0; k < 26; k++) {
          (function (ch) {
            var b = h('button', {
              type: 'button', class: 'pz-ciph-key',
              disabled: finished || puzzle.solved || puzzle.picked < 0
            }, [
              h('span', { text: ch }),
              h('small', { text: MORSE[ch] })
            ]);
            b.addEventListener('click', function () { setLetter(ch); });
            letterPad.appendChild(b);
          })(ALPHA.charAt(k));
        }
      }

      function pick(ix) {
        if (finished || puzzle.solved) return;
        puzzle.picked = puzzle.picked === ix ? -1 : ix;
        paintGroups();
        paintLetters();
      }

      function setLetter(ch) {
        if (finished || puzzle.solved || puzzle.picked < 0) return;
        puzzle.answers[puzzle.picked] = puzzle.answers[puzzle.picked] === ch ? '' : ch;
        // Roll on to the next unfilled group so a clean read is one click each.
        var next = -1;
        for (var i = puzzle.picked + 1; i < puzzle.groups.length; i++) {
          if (!puzzle.groups[i].gap && !puzzle.answers[i]) { next = i; break; }
        }
        puzzle.picked = next;
        paintGroups();
        paintLetters();
        paintOut();
      }

      paintGroups();
      paintLetters();
      return h('div', { class: 'pz-col' }, [
        h('div', { class: 'pz-ciph-note', text: 'Pick a group, then the letter it spells. Groups in red arrived with a symbol missing \u2014 read those out of the word around them.' }),
        groupBox,
        h('div', { class: 'pz-ciph-note', text: 'Alphabet' }),
        letterPad,
        h('div', { class: 'pz-card' }, [
          h('div', { class: 'pz-card__head', text: 'Chart' }),
          chart
        ])
      ]);
    }

    /* ------------------------------------------------------------ confirm */

    function confirmRead() {
      if (finished || puzzle.solved) return;
      if (!isRight(puzzle)) {
        puzzle.attempts++;
        api.tweak({ morale: -4, energy: -2 });
        api.toast('It comes out as noise. Try it again.', 'bad', 2200);
        paintOut();
        return;
      }
      puzzle.solved = true;
      api.flash();
      paintOut();
      renderBranch();
    }

    function renderBranch() {
      PS.ui.clear(actions);
      PS.ui.append(actions, [
        h('div', { class: 'pz-intro' }, [
          'It reads: ', h('em', { text: puzzle.plain }), '. There is ', C.caller,
          ' at the other end of that, and they do not know you exist yet.'
        ]),
        h('div', { class: 'pz-choices' }, [
          branchBtn('\uD83E\uDD1D', C.answerTitle, C.answerDesc, 'answer'),
          branchBtn('\uD83E\uDD10', C.silentTitle, C.silentDesc, 'silent')
        ])
      ]);
    }

    function branchBtn(ic, title, desc, id) {
      return h('button', { class: 'pz-choice', type: 'button', onclick: function () { finishRun(id); } }, [
        h('div', { class: 'pz-choice__i', text: ic }),
        h('div', { class: 'pz-choice__t', text: title }),
        h('div', { class: 'pz-choice__d', text: desc })
      ]);
    }

    function finishRun(mode) {
      if (finished) return;
      finished = true;

      var clean = puzzle.attempts === 0;

      if (mode === 'answer') {
        // has_ally is DERIVED by core from an 'ally' in the pack and is
        // recomputed on every apply, so setting it in `tags` would be both
        // forbidden by CONTRACT.md and useless — deriveTags() would delete it
        // again the moment the ally left. Handing over the item is what
        // actually wires the Director's pull toward allocation and barter.
        // The obligation is real too: somebody else eats out of your pack now.
        var owed = [];
        if (state.has('ration')) owed.push('ration');
        else if (state.has('water')) owed.push('water');

        api.finish({
          outcome: clean ? 'success' : 'partial',
          stats: { morale: 14, energy: -8, light: 3 },
          gain: ['ally'],
          lose: owed,
          tags: ['answered_the_call', 'owes_a_debt'],
          signals: {
            logic: clean ? 4 : 2,
            caution: 0,
            speed: clean ? 1 : 0,
            scavenge: 0
          },
          choice: 'answer',
          summary: C.answered + ' You are two now, which is warmer and slower and considerably more complicated.'
        });
        return;
      }

      api.finish({
        outcome: clean ? 'success' : 'partial',
        stats: { morale: -6, energy: -3 },
        gain: [], lose: [],
        tags: ['stayed_silent', 'has_intel'],
        signals: {
          logic: clean ? 4 : 2,
          caution: 4,
          speed: 0,
          scavenge: 0
        },
        choice: 'silent',
        summary: C.silent + ' You know what it said. That is all you took from it.'
      });
    }

    function walkAway() {
      if (finished) return;
      finished = true;
      api.finish({
        outcome: 'fail',
        stats: { morale: -9, energy: -5 },
        gain: [], lose: [], tags: ['gave_up_listening'],
        signals: { caution: 2 },
        choice: null,
        summary: 'You could not make it come apart, and eventually you stopped trying.'
      });
    }

    /* ------------------------------------------------------------- layout */

    PS.ui.append(actions, [
      h('button', { class: 'pz-btn pz-btn--primary', type: 'button', onclick: confirmRead },
        ['\u2713 That is what it says']),
      h('button', { class: 'pz-btn pz-btn--danger pz-btn--sm', type: 'button', onclick: walkAway },
        ['\u21A9 Give up on it'])
    ]);

    var tool = puzzle.mode === 'caesar' ? buildDial()
             : puzzle.mode === 'keyword' ? buildPad()
             : buildMorse();

    PS.ui.append(toolBox, tool);

    PS.ui.append(el, h('div', { class: 'pz-ciph' }, [
      h('div', { class: 'pz-card' }, [
        h('div', { class: 'pz-card__head', text: 'Intercept \u00B7 ' +
          (puzzle.mode === 'caesar' ? 'shifted alphabet'
           : puzzle.mode === 'keyword' ? 'keyword alphabet' : 'morse') }),
        interceptBox,
        h('div', { class: 'pz-note', text: C.channel })
      ]),
      h('div', { class: 'pz-card' }, [
        h('div', { class: 'pz-card__head', text: 'Reads as' }),
        outBox,
        noteBox
      ]),
      h('div', { class: 'pz-card' }, [
        h('div', { class: 'pz-card__head', text: 'Decode' }),
        toolBox
      ]),
      actions
    ]));

    paintIntercept();
    paintOut();
  }

  function unmount() {
    while (teardownFns.length) {
      try { teardownFns.pop()(); } catch (e) { /* keep unwinding */ }
    }
  }

  /* ================================================================ HINT = */

  function hint(puzzle) {
    var i;
    if (puzzle.mode === 'caesar') {
      var off = ((puzzle.shift - puzzle.dial) + 26) % 26;
      if (off === 0) return 'The ring is already where it wants to be. Read it and send it.';
      return 'You are ' + Math.min(off, 26 - off) + ' turn' + (Math.min(off, 26 - off) === 1 ? '' : 's') +
        ' out, and the ring wants to go ' + (off <= 13 ? 'on' : 'back') + '.';
    }
    if (puzzle.mode === 'keyword') {
      for (i = 0; i < puzzle.cipher.length; i++) {
        var ch = puzzle.cipher.charAt(i);
        if (ch === ' ') continue;
        var truth = puzzle.plain.charAt(i);
        if (puzzle.bound[ch] === truth) continue;
        return ch + ' stands for ' + truth + '. The rest of it falls out of the word shapes.';
      }
      return 'Every letter is placed. Send it.';
    }
    for (i = 0; i < puzzle.groups.length; i++) {
      if (puzzle.groups[i].gap) continue;
      if (puzzle.answers[i] === puzzle.groups[i].plain) continue;
      return 'Group ' + (i + 1) + ' is ' + puzzle.groups[i].plain +
        (puzzle.damaged[i] ? ' \u2014 it came through with a symbol missing.' : '.');
    }
    return 'Every group is read. Send it.';
  }

  /* ============================================================ AUTOSOLVE = */

  function autoSolve(puzzle, rng) {
    var mode = rng.chance(0.5) ? 'answer' : 'silent';
    if (mode === 'answer') {
      return {
        outcome: 'success',
        stats: { morale: 14, energy: -8, light: 3 },
        gain: ['ally'], lose: [],
        tags: ['answered_the_call', 'owes_a_debt'],
        signals: { logic: 4, speed: 1 },
        choice: 'answer',
        summary: 'Broke the ' + puzzle.mode + ' out of it and answered the call.'
      };
    }
    return {
      outcome: 'success',
      stats: { morale: -6, energy: -3 },
      gain: [], lose: [],
      tags: ['stayed_silent', 'has_intel'],
      signals: { logic: 4, caution: 4 },
      choice: 'silent',
      summary: 'Broke the ' + puzzle.mode + ' out of it and did not answer.'
    };
  }

  /* ============================================================ REGISTER = */

  PS.registry.register({
    id: 'cipher_decode',
    name: 'Cipher Decode',
    icon: '\uD83D\uDCFB',
    blurb: 'Somebody is still transmitting. Whether you answer is the whole question.',

    favors:   { logic: 3, caution: 1 },
    provides: ['intel', 'contact'],
    tagHooks: ['has_ally', 'has_intel', 'stayed_silent'],
    requires: function () { return true; },

    css: CSS,

    skins: [
      {
        id: 'radio_tower', biome: 'industrial', title: 'The Relay Tower',
        icon: '\uD83D\uDCFB', palette: 'rust',
        intro: 'The hut at the base of the mast still has power and the set inside it is still listening. Someone is transmitting on a loop and not in clear, which means they think somebody is listening who should not be. They are probably right.',
        nouns: { source: 'the set', signal: 'the transmission', caller: 'the voice' }
      },
      {
        id: 'scratched_journal', biome: 'indoor', title: 'The Scratched Journal',
        icon: '\uD83D\uDCD3', palette: 'bone',
        intro: 'It was under the mattress, which is where people put the things they mean. Most of it is dates and weather. The last two pages are not in English, or in anything, and whoever wrote them pressed hard enough to go through to the board underneath.',
        nouns: { source: 'the journal', signal: 'the last entry', caller: 'the writer' }
      },
      {
        id: 'buoy_morse', biome: 'water', title: 'The Buoy Light',
        icon: '\uD83D\uDEA2', palette: 'ice',
        intro: 'There is a light out on the water that is not a navigation light, because navigation lights do not do that. It blinks, waits, and blinks again on exactly the same cycle. Somebody with cold hands is doing that by hand, over and over, and has been for some time.',
        nouns: { source: 'the light', signal: 'the cycle', caller: 'the boat' }
      }
    ],

    build: build,
    mount: mount,
    unmount: unmount,
    hint: hint,
    autoSolve: autoSolve
  });

})(typeof window !== 'undefined' ? window : this);
