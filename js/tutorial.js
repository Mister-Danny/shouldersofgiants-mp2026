/**
 * tutorial.js — Shoulders of Giants · Interactive Tutorial
 *
 * Guided 3-turn game narrated by Lucy (a 3.2-million-year-old hominid).
 * Uses fixed locations + scripted AI; does NOT invoke game.js logic.
 *
 * Card placement uses drag-to-place.
 *
 * Exposes: window.startTutorial()
 * Guards:  window.tutorialActive  (checked by game.js to suppress its handlers)
 */
(function () {
  'use strict';

  /* ── Fixed tutorial locations ─────────────────────────────────
     Left = Timbuktu          (id 5)
     Mid  = Great Rift Valley (id 2)
     Right= The Sahara         (id 6)                           */
  var LOC_TIMB   = LOCATIONS.find(function (l) { return l.id === 5; }); // Timbuktu   — left
  var LOC_RIFT   = LOCATIONS.find(function (l) { return l.id === 2; }); // Great Rift — center
  var LOC_SAHARA = LOCATIONS.find(function (l) { return l.id === 6; }); // The Sahara — right
  var T_LOCS     = [LOC_TIMB, LOC_RIFT, LOC_SAHARA];

  /* ── Scripted draws ───────────────────────────────────────────
     Turn 1 opening hand; Turn 2 additions                       */
  var PLAYER_T1_HAND = [1, 12, 3, 19, 25]; // Citizens, Samurai, Justinian, Cosimo, Columbus
  // Ordered draw queue for tutorial (draw-what-you-played, max 7 hand size)
  var TUT_DRAW_QUEUE = [4, 2, 24, 6, 13, 18, 15, 20]; // Empress Wu, Scholar-Officials, Magellan, Priests, Cortes, Juvenal, William, Voltaire

  /* ── Tutorial state ─────────────────────────────────────────── */
  var TS = {
    active:       false,
    turn:         1,
    capital:      5,
    playerHand:   [],
    playerSlots:  {},
    aiSlots:      {},
    // Dialogue
    dialogQueue:  [],
    dialogOnDone: null,
    typing:       false,
    fullText:     '',
    typedLen:     0,
    typeTimer:    null,
    // Interaction gating
    awaitAction:  null,   // 'citizens_rift'|'free_end_turn'|'ability_clicks'|'magellan_play'|'magellan_board_move'
    freeEndCb:    null,
    playerWon:    null,   // 'player'|'otzi'|'draw'
    useBubbles:   false,  // true during battle tutorial; false on home screen
    // T3+ ability gating
    abilitiesActive:    false,
    abilityCardsToTap:  [],
    abilityCardsTapped: {},
    needMagellanMove:      false,
    pendingMove:           null,
    playerActionLog:       [],   // ordered list of {type:'play',cardId,locId} and {type:'move',cardId,...}
    bonusCapitalNextTurn:  0,
    destroyedIPTotal:      0,   // IP accumulated by William the Conqueror
    tutTotalDrawn:         0    // total cards drawn from deck (for deck pile display)
  };

  /* ── DOM refs (assigned in init) ─────────────────────────────── */
  var boxEl, textEl, hintEl, dimEl, skipEl, endEl;
  var lucyBubbleEl, lucyBubbleTextEl, lucyBubbleHintEl;
  var otziBoxEl, otziTextEl;
  var playerHandEl, boardEl, endTurnBtnEl, capitalNumEl;
  var clickOverlayEl = null; // full-screen transparent click-anywhere overlay
  var numHighlightEl = null; // floating element that pulses over a number overlay
  var tutDragCardId        = null; // hand card being dragged
  var tutBoardDragCardId   = null; // board card being dragged (Magellan move)
  var tutBoardDragFromLocId = null;
  var tutBoardDragFromSi    = null;
  var _otziTyping = false, _otziFullText = '', _otziTypeTimer = null, _otziOnDone = null;

  /* ═══════════════════════════════════════════════════════════════
     WEB AUDIO  — typewriter blip
  ═══════════════════════════════════════════════════════════════ */

  var _audioCtx   = null;
  var _blipCount  = 0;    // incremented each character; blip plays every 3rd

  function getAudioCtx() {
    if (!_audioCtx) {
      try {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) { /* audio not supported */ }
    }
    return _audioCtx;
  }

  /* Short (~35 ms) sine-wave blip at ~480 Hz with fast attack/decay.
     Plays on every 3rd character to avoid being overwhelming.       */
  function playBlip() {
    _blipCount++;
    if (_blipCount % 3 !== 0) return;
    var ctx = getAudioCtx();
    if (!ctx) return;
    try {
      var osc  = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'sine';
      osc.frequency.value = 480;           // mid-pitched, not shrill
      var t = ctx.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.10, t + 0.005);  // 5 ms attack
      gain.gain.linearRampToValueAtTime(0,    t + 0.035);  // fade out by 35 ms
      osc.start(t);
      osc.stop(t + 0.04);
    } catch (e) { /* silently skip */ }
  }

  /* Ötzi's blip — lower pitched, gruffer triangle wave at ~120 Hz.
     Slightly longer decay gives a heavier, older character.         */
  var _otziBlipCount = 0;
  function playOtziBlip() {
    _otziBlipCount++;
    if (_otziBlipCount % 3 !== 0) return;
    var ctx = getAudioCtx();
    if (!ctx) return;
    try {
      var osc  = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = 'triangle';               // warmer, more organic than sine
      osc.frequency.value = 120;           // deep, gruff rumble
      var t = ctx.currentTime;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(0.14, t + 0.008);  // slightly slower attack
      gain.gain.linearRampToValueAtTime(0,    t + 0.060);  // longer tail = heavier feel
      osc.start(t);
      osc.stop(t + 0.07);
    } catch (e) { /* silently skip */ }
  }

  /* ═══════════════════════════════════════════════════════════════
     HOME INTRO  — 3-line Lucy sequence shown on the home screen
     before the video plays on a player's first visit.
     Called by deckbuilder.js when "I'm Ready" is clicked.
  ═══════════════════════════════════════════════════════════════ */

  function startHomeIntro(onDone) {
    if (!boxEl) initDOMRefs();

    TS.active = true;   // enables click/spacebar dialogue advance
    // Home intro: no nickname — just "Lucy"
    var speakerEl = boxEl.querySelector('.tut-speaker');
    if (speakerEl) speakerEl.innerHTML = 'Lucy';
    showEl(boxEl);

    queueDialogues([
      'You? Make history? Ha!',
      'You look as ready as an Aztec inviting a conquistador to dinner.',
      'If you want to make history, you\'re going to need a lesson from your ancestors.'
    ], function () {
      // After last line: fade Lucy + home screen, then hand off to caller
      TS.active = false;
      var homeEl = document.getElementById('screen-home');
      if (typeof gsap !== 'undefined') {
        gsap.to([boxEl, homeEl], {
          opacity: 0, duration: 0.55, ease: 'power1.in',
          onComplete: function () {
            homeEl.style.opacity = '';
            boxEl.style.opacity  = '';
            hideEl(boxEl);
            onDone();
          }
        });
      } else {
        hideEl(boxEl);
        onDone();
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     MATCHUP SCREEN  — cinematic Lucy vs Ötzi intro
     Shown between the intro video and the tutorial battle.
     Calls onDone() when the VS hold completes.
  ═══════════════════════════════════════════════════════════════ */

  function showMatchupScreen(onDone) {
    var TYPE_SPEED = 28;   // ms per character — matches tutorial typewriter
    var phase      = 0;    // 0=lucyLine 1=otziSlides+line 2=lucyReply 3=vsReveal
    var typing     = false;
    var fullText   = '';
    var typeTimer  = null;
    var _mBlipCt   = 0;
    var _mAudioCtx = null;

    /* ── Minimal typewriter blip (self-contained) ─────────── */
    function blip() {
      _mBlipCt++;
      if (_mBlipCt % 3 !== 0) return;
      if (!_mAudioCtx) {
        try { _mAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { return; }
      }
      try {
        var osc  = _mAudioCtx.createOscillator();
        var gain = _mAudioCtx.createGain();
        osc.connect(gain); gain.connect(_mAudioCtx.destination);
        osc.type = 'sine'; osc.frequency.value = 420;
        var t = _mAudioCtx.currentTime;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.07, t + 0.005);
        gain.gain.linearRampToValueAtTime(0,    t + 0.035);
        osc.start(t); osc.stop(t + 0.04);
      } catch (e) {}
    }

    /* ── Ötzi's matchup blip — triangle 120 Hz, longer decay ── */
    function blipOtzi() {
      _mBlipCt++;
      if (_mBlipCt % 3 !== 0) return;
      if (!_mAudioCtx) {
        try { _mAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { return; }
      }
      try {
        var osc  = _mAudioCtx.createOscillator();
        var gain = _mAudioCtx.createGain();
        osc.connect(gain); gain.connect(_mAudioCtx.destination);
        osc.type = 'triangle'; osc.frequency.value = 120;
        var t = _mAudioCtx.currentTime;
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(0.14, t + 0.008);
        gain.gain.linearRampToValueAtTime(0,    t + 0.060);
        osc.start(t); osc.stop(t + 0.07);
      } catch (e) {}
    }

    /* ── Lightning crack sound ────────────────────────────── */
    function playLightningSound() {
      if (!_mAudioCtx) {
        try { _mAudioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { return; }
      }
      try {
        var dur   = 0.35;
        var sRate = _mAudioCtx.sampleRate;
        var len   = Math.floor(sRate * dur);
        var buf   = _mAudioCtx.createBuffer(1, len, sRate);
        var data  = buf.getChannelData(0);
        for (var i = 0; i < len; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 1.5);
        }
        var src  = _mAudioCtx.createBufferSource();
        src.buffer = buf;
        var hpf  = _mAudioCtx.createBiquadFilter();
        hpf.type = 'highpass';
        hpf.frequency.value = 600;
        var gain = _mAudioCtx.createGain();
        gain.gain.value = 0.65;
        src.connect(hpf); hpf.connect(gain); gain.connect(_mAudioCtx.destination);
        src.start();
      } catch (e) {}
    }

    /* ── Build DOM ────────────────────────────────────────── */
    var screen = document.createElement('div');
    screen.id  = 'matchup-screen';

    /* Lucy group — portrait col + dialogue box, top-left */
    var lucyGroup = document.createElement('div');
    lucyGroup.className = 'matchup-lucy-group';

    var lucyPortCol = document.createElement('div');
    lucyPortCol.className = 'matchup-portrait-col';

    var lucyFrame = document.createElement('div');
    lucyFrame.className = 'matchup-portrait-frame';
    var lucyImg = document.createElement('img');
    lucyImg.className = 'matchup-portrait-img';
    lucyImg.src = 'images/Lucy.png';
    lucyImg.alt = 'Lucy';
    lucyImg.onerror = function () { this.style.display = 'none'; };
    lucyFrame.appendChild(lucyImg);

    var lucyNameCard = document.createElement('div');
    lucyNameCard.className = 'matchup-name-card';
    var lucyNameTxt = document.createElement('div');
    lucyNameTxt.className = 'matchup-name-text';
    lucyNameTxt.innerHTML = 'Lucy<br><span class="matchup-name-sub">The Ancient One</span>';
    lucyNameCard.appendChild(lucyNameTxt);

    lucyPortCol.appendChild(lucyFrame);
    lucyPortCol.appendChild(lucyNameCard);

    var lucyDlg = document.createElement('div');
    lucyDlg.className = 'matchup-dialogue';
    var lucyDlgText = document.createElement('div');
    lucyDlgText.className = 'matchup-dialogue-text';
    var lucyDlgHint = document.createElement('div');
    lucyDlgHint.className = 'matchup-dialogue-hint';
    lucyDlgHint.textContent = '\u25b6 Click to continue';
    lucyDlg.appendChild(lucyDlgText);
    lucyDlg.appendChild(lucyDlgHint);

    lucyGroup.appendChild(lucyPortCol);
    lucyGroup.appendChild(lucyDlg);

    /* Ötzi group — dialogue box + portrait col, bottom-right */
    var otziGroup = document.createElement('div');
    otziGroup.className = 'matchup-otzi-group';

    var otziDlg = document.createElement('div');
    otziDlg.className = 'matchup-dialogue';
    var otziDlgText = document.createElement('div');
    otziDlgText.className = 'matchup-dialogue-text';
    var otziDlgHint = document.createElement('div');
    otziDlgHint.className = 'matchup-dialogue-hint';
    otziDlgHint.textContent = '\u25b6 Click to continue';
    otziDlg.appendChild(otziDlgText);
    otziDlg.appendChild(otziDlgHint);

    var otziPortCol = document.createElement('div');
    otziPortCol.className = 'matchup-portrait-col';

    var otziFrame = document.createElement('div');
    otziFrame.className = 'matchup-portrait-frame';
    var otziImg = document.createElement('img');
    otziImg.className = 'matchup-portrait-img';
    otziImg.src = 'images/Otzi.jpg';
    otziImg.alt = '\u00d6tzi';
    otziImg.onerror = function () { this.style.display = 'none'; };
    otziFrame.appendChild(otziImg);

    var otziNameCard = document.createElement('div');
    otziNameCard.className = 'matchup-name-card';
    var otziNameTxt = document.createElement('div');
    otziNameTxt.className = 'matchup-name-text';
    otziNameTxt.innerHTML = '\u00d6tzi<br><span class="matchup-name-sub">The Iceman</span>';
    otziNameCard.appendChild(otziNameTxt);

    otziPortCol.appendChild(otziFrame);
    otziPortCol.appendChild(otziNameCard);

    /* Dialogue on left of Otzi's portrait */
    otziGroup.appendChild(otziDlg);
    otziGroup.appendChild(otziPortCol);

    /* VS graphic (absolutely centered in screen) */
    var vsWrap = document.createElement('div');
    vsWrap.className = 'matchup-vs-wrap';
    var vsTxt = document.createElement('div');
    vsTxt.className = 'matchup-vs-text';
    vsTxt.textContent = 'VS';
    vsWrap.appendChild(vsTxt);

    /* White flash overlay for lightning transition */
    var flashEl = document.createElement('div');
    flashEl.className = 'matchup-flash';

    screen.appendChild(lucyGroup);
    screen.appendChild(otziGroup);
    screen.appendChild(vsWrap);
    screen.appendChild(flashEl);
    document.body.appendChild(screen);

    /* ── GSAP initial states ──────────────────────────────── */
    gsap.set(lucyGroup,   { x: -560, opacity: 0 });
    gsap.set(otziGroup,   { x:  560, opacity: 0 });
    gsap.set(lucyDlg,     { opacity: 0 });
    gsap.set(lucyDlgHint, { opacity: 0 });
    gsap.set(otziDlg,     { opacity: 0 });
    gsap.set(otziDlgHint, { opacity: 0 });
    gsap.set(vsWrap,      { scale: 0, opacity: 0 });
    gsap.set(flashEl,     { opacity: 0 });

    /* ── Active dialogue refs (for skip-to-end) ───────────── */
    var activeDlgText = null;
    var activeDlgHint = null;
    var animating     = false;  // blocks advance() during slide animations

    /* ── Typewriter — accepts optional blipFn ─────────────── */
    function typeIt(dlgText, dlgHint, text, blipFn) {
      blipFn = blipFn || blip;
      if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
      fullText      = text;
      typing        = true;
      _mBlipCt      = 0;
      activeDlgText = dlgText;
      activeDlgHint = dlgHint;
      dlgText.textContent = '';
      gsap.set(dlgHint, { opacity: 0 });
      var idx = 0;
      typeTimer = setInterval(function () {
        idx++;
        dlgText.textContent = fullText.slice(0, idx);
        blipFn();
        if (idx >= fullText.length) {
          clearInterval(typeTimer); typeTimer = null;
          typing = false;
          gsap.to(dlgHint, { opacity: 1, duration: 0.3 });
        }
      }, TYPE_SPEED);
    }

    function showLucyLine(text) {
      gsap.to(lucyDlg, { opacity: 1, duration: 0.25 });
      typeIt(lucyDlgText, lucyDlgHint, text, blip);
    }

    function showOtziLine(text) {
      gsap.to(otziDlg, { opacity: 1, duration: 0.25 });
      typeIt(otziDlgText, otziDlgHint, text, blipOtzi);
    }

    /* ── Lightning flash → battle screen transition ───────── */
    function doLightningTransition() {
      playLightningSound();
      var tl = gsap.timeline();
      tl.to(flashEl, { opacity: 0.85, duration: 0.05 })
        .to(flashEl, { opacity: 0,    duration: 0.07 })
        .to(flashEl, { opacity: 0.6,  duration: 0.04 })
        .to(flashEl, { opacity: 0,    duration: 0.09 })
        .to(flashEl, { opacity: 1,    duration: 0.18,
            onComplete: function () {
              // Full white — swap to battle screen, then fade out
              var bodyFlash = document.createElement('div');
              bodyFlash.style.cssText =
                'position:fixed;inset:0;background:#fff;z-index:4999;pointer-events:none;';
              document.body.appendChild(bodyFlash);
              teardown();
              onDone();
              gsap.to(bodyFlash, {
                opacity: 0, duration: 0.55, delay: 0.05,
                onComplete: function () {
                  if (bodyFlash.parentNode) bodyFlash.parentNode.removeChild(bodyFlash);
                }
              });
            }
          });
    }

    /* ── Phase advance (click / spacebar / enter) ─────────── */
    function advance() {
      if (animating) return;

      // First click while typing → skip to end of current line
      if (typing) {
        clearInterval(typeTimer); typeTimer = null;
        typing = false;
        if (activeDlgText) activeDlgText.textContent = fullText;
        if (activeDlgHint) gsap.to(activeDlgHint, { opacity: 1, duration: 0 });
        return;
      }

      phase++;

      if (phase === 1) {
        showLucyLine('Let me show you how we do things around here\u2026');

      } else if (phase === 2) {
        // Ötzi slides in from the right; block advance until he lands
        animating = true;
        gsap.to(otziGroup, {
          x: 0, opacity: 1, duration: 0.75, ease: 'power3.out',
          onComplete: function () {
            animating = false;
            showOtziLine('Not so fast grandma.');
          }
        });

      } else if (phase === 3) {
        showLucyLine('What do you want, \u00d6tzi?');

      } else if (phase === 4) {
        showOtziLine('The kid doesn\u2019t want to learn how to smack rocks together.');

      } else if (phase === 5) {
        showLucyLine('I didn\u2019t stand up so you could fall and die in ice.');

      } else if (phase === 6) {
        // VS pops center, then lightning flash to battle
        animating = true;
        gsap.to(lucyDlg, { opacity: 0, duration: 0.2 });
        gsap.to(otziDlg, { opacity: 0, duration: 0.2 });
        gsap.to(vsWrap, {
          scale: 1, opacity: 1,
          duration: 0.55, delay: 0.2,
          ease: 'back.out(1.6)',
          onComplete: function () {
            setTimeout(doLightningTransition, 2000);
          }
        });
      }
    }

    /* ── Input listeners ──────────────────────────────────── */
    screen.addEventListener('click', advance);
    function onKey(e) {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); advance(); }
    }
    document.addEventListener('keydown', onKey);

    /* ── Teardown ─────────────────────────────────────────── */
    function teardown() {
      document.removeEventListener('keydown', onKey);
      if (typeTimer) { clearInterval(typeTimer); typeTimer = null; }
      if (screen.parentNode) screen.parentNode.removeChild(screen);
    }

    /* ── Kick off: Lucy slides in, shows opening line ─────── */
    animating = true;
    gsap.to(lucyGroup, {
      x: 0, opacity: 1, duration: 0.75, ease: 'power3.out',
      onComplete: function () {
        animating = false;
        showLucyLine('Pretty cool for a 3.2 million-year-old, huh?');
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     PUBLIC ENTRY POINT  — called after the intro video ends
  ═══════════════════════════════════════════════════════════════ */

  function startTutorial() {
    if (!boxEl) initDOMRefs();

    var speakerEl = boxEl.querySelector('.tut-speaker');
    if (speakerEl) speakerEl.textContent = 'Lucy';

    window.tutorialActive = true;

    TS.active      = true;
    TS.turn        = 1;
    TS.capital     = 5;
    TS.playerHand  = PLAYER_T1_HAND.slice();
    TS.playerSlots = emptySlotMap();
    TS.aiSlots     = emptySlotMap();
    TS.awaitAction        = null;
    TS.freeEndCb          = null;
    TS.playerWon          = null;
    TS.useBubbles         = true;
    TS.abilitiesActive    = false;
    TS.abilityCardsToTap  = [];
    TS.abilityCardsTapped = {};
    TS.needMagellanMove      = false;
    TS.bonusCapitalNextTurn  = 0;
    TS.destroyedIPTotal      = 0;
    TS.playerFirst           = Math.random() < 0.5;
    TS.tutDrawQueueIdx       = 0;
    TS.cardsPlayedThisTurn   = 0;
    TS.tutTotalDrawn         = 0;

    showEl(skipEl);
    setupBattle();
  }

  function emptySlotMap() {
    var m = {};
    T_LOCS.forEach(function (l) { m[l.id] = [null, null, null, null]; });
    return m;
  }

  /* ── DOM init ──────────────────────────────────────────────── */

  function initDOMRefs() {
    boxEl        = document.getElementById('tut-box');
    textEl       = document.getElementById('tut-text');
    hintEl       = document.getElementById('tut-hint');
    dimEl        = document.getElementById('tut-dim');
    skipEl       = document.getElementById('tut-skip');
    endEl        = document.getElementById('tut-end');
    playerHandEl = document.getElementById('battle-player-hand');
    boardEl      = document.getElementById('battle-board');
    endTurnBtnEl = document.getElementById('battle-end-turn');

    // Delegated click-to-reveal-ability for board cards during the
    // tutorial. Mirrors the live game's board click for both player
    // AND opponent cards — covers every code path that builds a
    // face-up slot (reveal, move, push, animation rebuild) without
    // having to wire onclick at every site. Starter cards (T1/T2
    // placements) show "No special ability — For now" instead of
    // their real ability text, since abilities aren't introduced
    // until turn 3.
    if (boardEl && !boardEl._tutBoardClickWired) {
      boardEl._tutBoardClickWired = true;
      boardEl.addEventListener('click', function (ev) {
        if (!window.tutorialActive) return;
        var slotEl = ev.target.closest('.battle-card-slot.face-up.occupied');
        if (!slotEl) return;
        if (typeof window.openBattlePopup !== 'function') return;
        var ownerStr = slotEl.dataset.owner;
        var locId    = parseInt(slotEl.dataset.locId,     10);
        var si       = parseInt(slotEl.dataset.slotIndex, 10);
        if (!ownerStr || isNaN(locId) || isNaN(si)) return;
        var slotsRef = ownerStr === 'player' ? TS.playerSlots : TS.aiSlots;
        var sd       = slotsRef[locId] && slotsRef[locId][si];
        if (!sd || !sd.revealed) return;
        var realCard = CARDS.find(function (c) { return c.id === sd.cardId; });
        if (!realCard) return;
        var isStarter = !!sd._starter;
        var displayCard = isStarter
          ? { name: realCard.name, cc: realCard.cc, ip: realCard.ip,
              type: realCard.type, ability: null, abilityName: null }
          : realCard;
        window.openBattlePopup(displayCard, sd, ownerStr, true);
        if (isStarter) {
          // openBattlePopup writes "No special ability." for null-ability
          // cards; override to the tutorial-specific text with em dash.
          var txEl = document.getElementById('battle-popup-ability-text');
          if (txEl) txEl.textContent = 'No special ability — For now';
        }
      });
    }

    // Lucy comic bubble (battle tutorial)
    lucyBubbleEl     = document.getElementById('tut-lucy-bubble');
    lucyBubbleTextEl = document.getElementById('tut-lucy-text');
    lucyBubbleHintEl = document.getElementById('tut-lucy-hint');
    lucyBubbleEl.addEventListener('click', function () { advanceDialogue(); });

    // Create Otzi comic bubble dynamically
    otziBoxEl = document.createElement('div');
    otziBoxEl.id = 'tut-otzi-box';
    otziBoxEl.innerHTML =
      '<div id="tut-otzi-text" class="tut-bubble-text"></div>' +
      '<div class="tut-bubble-hint" id="tut-otzi-hint">\u25b6 Click to continue</div>';
    otziBoxEl.style.display = 'none';
    document.body.appendChild(otziBoxEl);
    otziTextEl = document.getElementById('tut-otzi-text');
    otziBoxEl.addEventListener('click', function () { advanceOtzi(); });

    // Click tut-box or spacebar → advance dialogue
    boxEl.addEventListener('click', function () { advanceDialogue(); });
    document.addEventListener('keydown', function (e) {
      if (!TS.active) return;
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        if (otziBoxEl && otziBoxEl.style.display !== 'none') { advanceOtzi(); }
        else { advanceDialogue(); }
      }
    });

    // Tutorial End Turn button
    endTurnBtnEl.addEventListener('click', function () {
      if (!TS.active) return;
      if (TS.awaitAction === 'end_turn') { onEndTurnClicked(); }
      else if (TS.awaitAction === 'free_end_turn') { onFreeEndTurn(); }
    });

    // Dim overlay — advances dialogue when not waiting for player action
    dimEl.addEventListener('click', function () {
      if (TS.awaitAction) return;
      advanceDialogue();
    });

    // Skip button
    skipEl.addEventListener('click', exitTutorial);

    // Completion panel buttons
    document.getElementById('tut-btn-ready').addEventListener('click', finishTutorial);
    document.getElementById('tut-btn-again').addEventListener('click', function () {
      hideEl(endEl);
      startTutorial();
    });

    // Board-level drag handlers for card placement
    initBoardDrag();

    // Full-screen click-anywhere overlay (advances dialogue on click)
    clickOverlayEl = document.createElement('div');
    clickOverlayEl.id = 'tut-click-overlay';
    document.body.appendChild(clickOverlayEl);
    clickOverlayEl.addEventListener('click', function () {
      if (otziBoxEl && otziBoxEl.style.display !== 'none') {
        advanceOtzi();
      } else {
        advanceDialogue();
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     BATTLE SETUP
  ═══════════════════════════════════════════════════════════════ */

  function setupBattle() {
    showScreen('screen-battle');
    window.initBattleUI(T_LOCS);
    capitalNumEl = document.getElementById('battle-capital-num');
    endTurnBtnEl.disabled = true;
    var resetBtn = document.getElementById('battle-reset-turn');
    resetBtn.disabled = true;
    resetBtn.style.display = 'none';
    document.getElementById('btn-back-results').style.display = 'none';

    // Turn 1: only Rift Valley visible; Timbuktu and Sahara hidden
    var timbCol   = boardEl.querySelector('.battle-col[data-loc-id="5"]');
    var saharaCol = boardEl.querySelector('.battle-col[data-loc-id="6"]');
    if (timbCol)   { timbCol.style.opacity = '0';   timbCol.style.pointerEvents = 'none'; }
    if (saharaCol) { saharaCol.style.opacity = '0'; saharaCol.style.pointerEvents = 'none'; }

    // Hide all location ability text
    boardEl.querySelectorAll('.battle-loc-ability').forEach(function (el) {
      el.classList.add('tut-ability-hidden');
    });

    // Hide music player and stop any background music during tutorial
    var _musicCtrl = document.getElementById('battle-music-ctrl');
    if (_musicCtrl) _musicCtrl.style.display = 'none';
    if (typeof Howler !== 'undefined') Howler.stop();

    setHeader(1, 'SELECT CARDS', 5);
    renderHand(TS.playerHand);
    step_openingDialogue();
  }

  /* ═══════════════════════════════════════════════════════════════
     STEP MACHINE — TURN 1
  ═══════════════════════════════════════════════════════════════ */

  function step_openingDialogue() {
    showEl(lucyBubbleEl);
    hideEl(boxEl);

    queueDialogues(["Let\u2019s show \u00d6tzi how history is written."], function () {
      showOtziLine("Like you can even write\u2026", function () {

        // Rift Valley white glow on — targets the full column (background image is on .battle-col)
        var riftTileEl = boardEl.querySelector('.battle-col[data-loc-id="2"]');
        if (riftTileEl) riftTileEl.classList.add('tut-white-glow');

        queueDialogues(["See The Great Rift Valley?"], function () {
          queueDialogues(["Aside from being the birthplace of humanity\u2026"], function () {
            queueDialogues(["That\u2019s where you play cards to gain Influence Points."], function () {

              // Rift glow off
              if (riftTileEl) riftTileEl.classList.remove('tut-white-glow');

              showOtziLine("Not more than me.", function () {
                queueDialogues(["Definitely more than him."], function () {

                  queueDialogues(["You spend Capital to play cards."], function () {
                    // Citizens pops + CC highlight together on this line
                    var cEl = getHandCardEl(1);
                    if (cEl) {
                      gsap.killTweensOf(cEl);
                      gsap.set(cEl, { zIndex: 100 });
                      gsap.to(cEl, { scale: 1.35, duration: 0.14, ease: 'power2.out' });
                    }
                    pinNumHighlight(cEl, 'cc');
                    queueDialogues(["This is this card\u2019s Capital cost."], function () {

                      // CC highlight off, Citizens stays popped
                      removeNumHighlight();

                      // Capital counter white glow on
                      var capEl = document.getElementById('battle-capital-info');
                      if (capEl) capEl.classList.add('tut-white-glow');

                      queueDialogues(["Each turn you have 5 Capital to spend"], function () {

                        // Capital glow off (player clicked to continue)
                        if (capEl) capEl.classList.remove('tut-white-glow');

                        // IP highlight — Citizens still popped
                        var cEl2 = getHandCardEl(1);
                        pinNumHighlight(cEl2, 'ip');

                        queueDialogues(["The number on the top right of the card"], function () {
                          queueDialogues(["Is the card\u2019s Influence Points."], function () {

                            // IP highlight off
                            removeNumHighlight();

                            queueDialogues(["Let\u2019s put that card into play."], function () {
                              step_playCitizens();
                            });
                          });
                        });
                      });
                    });
                  });
                });
              });
            });
          });
        });
      });
    });
  }

  function step_playCitizens() {
    var citizensEl = getHandCardEl(1);
    lit(citizensEl);
    getPlayerSlotsFor(2).forEach(lit);
    TS.awaitAction = 'citizens_rift';
    setLocked(true);
    updateHint();
  }

  function onCitizensPlaced() {
    TS.awaitAction = null;
    setLocked(false);
    var citizensEl = getHandCardEl(1);
    unlit(citizensEl);
    getPlayerSlotsFor(2).forEach(unlit);

    queueDialogues([
      "But your turn isn\u2019t over yet.",
      "You still have more Capital to spend.",
      "Select another card to play"
    ], function () {
      lit(endTurnBtnEl);
      queueDialogues(["When you\u2019re done click \u2018End Turn\u2019 and watch your influence grow."], function () {
        hideEl(lucyBubbleEl);
        step_freeTurn(onT1EndTurn);
        startInactivityTimer();
      });
    });
  }

  /* ── Inactivity timer ──────────────────────────────────────── */

  var _inactivityTimer = null;

  function startInactivityTimer() {
    if (_inactivityTimer) clearTimeout(_inactivityTimer);
    _inactivityTimer = setTimeout(function () {
      lit(endTurnBtnEl);
    }, 90000);
  }

  function cancelInactivityTimer() {
    if (_inactivityTimer) { clearTimeout(_inactivityTimer); _inactivityTimer = null; }
  }

  /* ── Turn management dispatcher ──────────────────────────────── */

  function startTurn(n) {
    TS.turn        = n;
    TS.capital     = 5 + (TS.bonusCapitalNextTurn || 0);
    TS.bonusCapitalNextTurn = 0;
    TS.playerFirst = !TS.playerFirst;   // alternate from previous turn

    // Draw-what-you-played: draw as many cards as were played last turn
    if (n > 1) {
      var played  = TS.cardsPlayedThisTurn;
      var canDraw = Math.max(0, 7 - TS.playerHand.length);
      var count   = Math.min(played, canDraw);
      for (var i = 0; i < count && TS.tutDrawQueueIdx < TUT_DRAW_QUEUE.length; i++) {
        var drawId = TUT_DRAW_QUEUE[TS.tutDrawQueueIdx++];
        if (TS.playerHand.indexOf(drawId) === -1) TS.playerHand.push(drawId);
        TS.tutTotalDrawn++;
      }
      // Safety: Magellan (24) must be in hand by T3 for the tutorial's scripted steps
      if (n === 3 && TS.playerHand.indexOf(24) === -1) {
        while (TS.tutDrawQueueIdx < TUT_DRAW_QUEUE.length && TUT_DRAW_QUEUE[TS.tutDrawQueueIdx] !== 24) {
          TS.tutDrawQueueIdx++;
        }
        if (TS.tutDrawQueueIdx < TUT_DRAW_QUEUE.length) {
          TS.playerHand.push(24);
          TS.tutDrawQueueIdx++;
          TS.tutTotalDrawn++;
        }
      }
    }
    TS.cardsPlayedThisTurn = 0;
    TS.pendingMove           = null;
    TS.playerActionLog       = [];

    if (n === 2) { startTurn2(); return; }
    if (n === 3) { startTurn3(); return; }
    if (n === 4) { startTurn4(); return; }
    if (n === 5) { startTurn5(); return; }
  }

  /* ── Turn 1 end ──────────────────────────────────────────────── */

  function onT1EndTurn() {
    cancelInactivityTimer();
    unlit(endTurnBtnEl);
    setHeader(1, 'REVEAL', TS.capital);
    placeAICards(1);
    runReveal(1, function () {
      var ps = scoreAt('player', 2), as = scoreAt('opp', 2);
      if (ps === as) {
        showOtziLine("A tie? How exciting\u2026", function () {
          showEl(lucyBubbleEl);
          queueDialogues(["You want to see excitement?"], function () {
            revealNewLocations(function () { startTurn(2); });
          });
        });
      } else if (ps > as) {
        showOtziLine("Hmm\u2026 a lucky start.", function () {
          showEl(lucyBubbleEl);
          queueDialogues(["You want to see excitement?"], function () {
            revealNewLocations(function () { startTurn(2); });
          });
        });
      } else {
        showOtziLine("I told you, I\u2019d win.", function () {
          showEl(lucyBubbleEl);
          queueDialogues(["We\u2019re just getting started."], function () {
            revealNewLocations(function () { startTurn(2); });
          });
        });
      }
    });
  }

  /* ── Turn 2 ──────────────────────────────────────────────────── */

  function startTurn2() {
    renderHand(TS.playerHand);
    setHeader(2, 'SELECT CARDS', TS.capital);
    // Lucy is visible from onT1EndTurn callback
    queueDialogues([
      "The world is a big place.",
      "Your goal is to gain more Influence Points at 2 of 3 locations."
    ], function () {
      hideEl(lucyBubbleEl);
      step_freeTurn(onT2EndTurn);
    });
  }

  function onT2EndTurn() {
    setHeader(2, 'REVEAL', TS.capital);
    placeAICards(2);
    runReveal(2, function () {
      var bl = boardLeader();
      if (bl.outcome === 'draw') {
        showOtziLine("A tie? How exciting\u2026", function () {
          showEl(lucyBubbleEl);
          startTurn(3);
        });
      } else if (bl.outcome === 'player' && bl.tiebreaker) {
        // Locations even but player ahead on total IP
        showOtziLine("Locations look even\u2026 but those numbers worry me.", function () {
          showEl(lucyBubbleEl);
          queueDialogues([
            "When location wins are split, total influence across all three breaks the tie \u2014 and you\u2019re ahead."
          ], function () { startTurn(3); });
        });
      } else if (bl.outcome === 'otzi' && bl.tiebreaker) {
        showOtziLine("Locations are even, but the numbers are mine.", function () {
          showEl(lucyBubbleEl);
          queueDialogues([
            "Even when locations look split, total influence breaks the tie \u2014 Otzi\u2019s edging it. Watch the totals."
          ], function () { startTurn(3); });
        });
      } else if (bl.outcome === 'player') {
        showOtziLine("History has a long arc.", function () {
          showEl(lucyBubbleEl);
          queueDialogues(["And it bends to me."], function () { startTurn(3); });
        });
      } else {
        showOtziLine("The world gets bigger and you get smaller.", function () {
          showEl(lucyBubbleEl);
          queueDialogues(["You spelled smarter wrong."], function () { startTurn(3); });
        });
      }
    });
  }

  /* ── Turn 3 — abilities unlock ───────────────────────────────── */

  function startTurn3() {
    TS.abilitiesActive = true;
    // Build ability tap list before renderHand so glow class is applied correctly
    TS.abilityCardsToTap = TS.playerHand.filter(function (id) {
      var card = CARDS.find(function (c) { return c.id === id; });
      return card && card.ability !== null;
    });
    TS.abilityCardsTapped = {};
    renderHand(TS.playerHand);
    setHeader(3, 'SELECT CARDS', TS.capital);

    if (typeof SFX !== 'undefined' && typeof SFX.atOnce === 'function') SFX.atOnce();

    // Lucy is visible from onT2EndTurn callback
    queueDialogues(["Let\u2019s evolve things."], function () {
      queueDialogues([
        "Most cards have special abilities.",
        "Click on your cards to see what they do."
      ], function () {
        TS.awaitAction = 'ability_clicks';
        endTurnBtnEl.disabled = true;
        updateHint();
      });
    });
  }

  function waitForPopupClose(cb) {
    var popupEl = document.getElementById('battle-popup-backdrop');
    if (!popupEl || !popupEl.classList.contains('visible')) { cb(); return; }
    var observer = new MutationObserver(function () {
      if (!popupEl.classList.contains('visible')) {
        observer.disconnect();
        cb();
      }
    });
    observer.observe(popupEl, { attributes: true, attributeFilter: ['class'] });
  }

  function checkAllAbilitiesClicked() {
    var allDone = TS.abilityCardsToTap.every(function (id) {
      return !!TS.abilityCardsTapped[id];
    });
    if (!allDone) return;
    TS.awaitAction = null;
    var magellanEl = getHandCardEl(24);
    if (magellanEl) lit(magellanEl);
    // lucyBubble still visible
    queueDialogues(["Put them to work."], function () {
      TS.awaitAction = 'magellan_play';
      endTurnBtnEl.disabled = true;
      updateHint();
    });
  }

  function onT3EndTurn() {
    setHeader(3, 'REVEAL', TS.capital);
    placeAICards(3);
    runReveal(3, function () {
      var bl = boardLeader();
      if (bl.outcome === 'draw') {
        showOtziLine("A tie? How exciting\u2026", function () {
          showEl(lucyBubbleEl);
          startTurn(4);
        });
      } else if (bl.outcome === 'player' && bl.tiebreaker) {
        showOtziLine("Locations are split, but those totals\u2026", function () {
          showEl(lucyBubbleEl);
          queueDialogues([
            "Total influence is the tiebreaker when location wins are even. You\u2019re still in the lead."
          ], function () { startTurn(4); });
        });
      } else if (bl.outcome === 'otzi' && bl.tiebreaker) {
        showOtziLine("It looks even \u2014 but the totals say otherwise.", function () {
          showEl(lucyBubbleEl);
          queueDialogues([
            "Otzi\u2019s leading on total influence. Push harder at the locations you can flip."
          ], function () { startTurn(4); });
        });
      } else if (bl.outcome === 'player') {
        showOtziLine("Grrr\u2026", function () {
          showEl(lucyBubbleEl);
          queueDialogues(["Australopithecus got your tongue?"], function () { startTurn(4); });
        });
      } else {
        showOtziLine("Muahahaha\u2026", function () {
          showEl(lucyBubbleEl);
          queueDialogues(["Do not lose to this homo sapien."], function () { startTurn(4); });
        });
      }
    });
  }

  /* ── Turn 4 — location abilities + Magellan move ─────────────── */

  function startTurn4() {
    renderHand(TS.playerHand);
    setHeader(4, 'SELECT CARDS', TS.capital);

    if (typeof SFX !== 'undefined' && typeof SFX.atOnce === 'function') SFX.atOnce();

    // Fade in location ability text + glow nameplates
    boardEl.querySelectorAll('.battle-loc-ability').forEach(function (el) {
      el.classList.remove('tut-ability-hidden');
      gsap.fromTo(el, { opacity: 0 }, { opacity: 1, duration: 0.6, ease: 'power1.out' });
    });
    boardEl.querySelectorAll('.battle-loc-name').forEach(function (el) {
      el.classList.add('tut-loc-glow');
      setTimeout(function () { el.classList.remove('tut-loc-glow'); }, 2200);
    });

    // Lucy is visible from onT3EndTurn callback
    queueDialogues(["The fun isn\u2019t done yet."], function () {
      queueDialogues(["Locations also have their own abilities"], function () {
        // Highlight Magellan on board
        var magellanPos = findPlayerCard(24);
        if (magellanPos) {
          var mSlotEl = getTutSlotEl('player', magellanPos.locId, magellanPos.si);
          if (mSlotEl) lit(mSlotEl);
        }
        queueDialogues(["Speaking of special abilities, some cards can move."], function () {
          step_magellanMove();
        });
      });
    });
  }

  function step_magellanMove() {
    var magellanPos = findPlayerCard(24);
    if (!magellanPos) {
      // Magellan not on board — skip directly to free turn
      queueDialogues(["Now finish the rest of your turn."], function () {
        hideEl(lucyBubbleEl);
        step_freeTurn(onT4EndTurn);
      });
      return;
    }
    makeBoardCardMoveable(magellanPos.locId, magellanPos.si);
    queueDialogues(["Try dragging Magellan to a new location."], function () {
      TS.awaitAction = 'magellan_board_move';
      updateHint();
    });
  }

  function onMagellanMoved() {
    TS.awaitAction = null;
    // lucyBubble still showing from step_magellanMove
    queueDialogues(["Nice. Now finish the rest of your turn."], function () {
      hideEl(lucyBubbleEl);
      step_freeTurn(onT4EndTurn);
    });
  }

  function onT4EndTurn() {
    setHeader(4, 'REVEAL', TS.capital);
    placeAICards(4);
    runReveal(4, function () {
      var bl = boardLeader();
      if (bl.outcome === 'draw') {
        showOtziLine("A tie? How exciting\u2026", function () {
          showEl(lucyBubbleEl);
          startTurn(5);
        });
      } else if (bl.outcome === 'player' && bl.tiebreaker) {
        showOtziLine("Locations are even, but the totals are slipping away from me.", function () {
          showEl(lucyBubbleEl);
          queueDialogues([
            "Total influence is breaking the tie in your favor. One more turn \u2014 keep it up."
          ], function () { startTurn(5); });
        });
      } else if (bl.outcome === 'otzi' && bl.tiebreaker) {
        showOtziLine("Looks tied \u2014 but the totals belong to Otzi.", function () {
          showEl(lucyBubbleEl);
          queueDialogues([
            "Otzi\u2019s edging the totals. One turn left to flip a location or push your numbers higher."
          ], function () { startTurn(5); });
        });
      } else if (bl.outcome === 'player') {
        showOtziLine("I don\u2019t like where this is headed.", function () {
          showEl(lucyBubbleEl);
          startTurn(5);
        });
      } else {
        showOtziLine("I eat flint chips like you for breakfast.", function () {
          showEl(lucyBubbleEl);
          queueDialogues(["You eat flint chips for breakfast?"], function () { startTurn(5); });
        });
      }
    });
  }

  /* ── Turn 5 — final turn ─────────────────────────────────────── */

  function startTurn5() {
    renderHand(TS.playerHand);
    setHeader(5, 'SELECT CARDS', TS.capital);
    // Lucy is visible from onT4EndTurn callback
    queueDialogues([
      "I\u2019m all out of surprises.",
      "Take him down."
    ], function () {
      hideEl(lucyBubbleEl);
      step_freeTurn(onT5EndTurn);
    });
  }

  function onT5EndTurn() {
    setHeader(5, 'REVEAL', TS.capital);
    placeAICards(5);
    runReveal(5, function () {
      showPostGameDialogue(determineWinner());
    });
  }

  /* ── Post-game flow ──────────────────────────────────────────── */

  /**
   * Computes the current board leader, mirroring the live game's
   * resolution: location wins decide the match unless they're tied,
   * in which case total influence across all three locations breaks
   * the tie.
   *
   * Returns { outcome, tiebreaker, pT, oT, pw, ow } where outcome is
   * 'player' | 'otzi' | 'draw' and tiebreaker is true only when the
   * outcome was decided by total IP rather than location count.
   */
  function boardLeader() {
    var pw = 0, ow = 0, pT = 0, oT = 0;
    T_LOCS.forEach(function (loc) {
      var ps = scoreAt('player', loc.id), as = scoreAt('opp', loc.id);
      if (ps > as) pw++; else if (as > ps) ow++;
      pT += ps; oT += as;
    });
    var outcome, tiebreaker = false;
    if      (pw > ow) outcome = 'player';
    else if (ow > pw) outcome = 'otzi';
    else {
      tiebreaker = true;
      outcome = pT > oT ? 'player' : (oT > pT ? 'otzi' : 'draw');
      if (outcome === 'draw') tiebreaker = false;   // truly even
    }
    return { outcome: outcome, tiebreaker: tiebreaker, pT: pT, oT: oT, pw: pw, ow: ow };
  }

  function determineWinner() { return boardLeader().outcome; }

  function showPostGameDialogue(won) {
    var bl = boardLeader();
    if (won === 'draw') {
      // Truly even \u2014 tied on locations AND on total IP
      showOtziLine("A tie? How exciting\u2026", function () {
        showEl(lucyBubbleEl);
        queueDialogues(["As always, history has been written by the victors."], function () {
          showTutorialResults(won);
        });
      });
    } else if (won === 'player' && bl.tiebreaker) {
      // Locations split 1-1 with one tied; total IP decided in player's favor
      showOtziLine("Hmph. Locations are even, but the numbers\u2026", function () {
        showEl(lucyBubbleEl);
        queueDialogues([
          "Locations were split, but total influence across all three breaks the tie. You came out ahead.",
          "History was written by the one who counted further."
        ], function () { showTutorialResults(won); });
      });
    } else if (won === 'otzi' && bl.tiebreaker) {
      // Locations split 1-1 with one tied; total IP decided in Otzi's favor
      showOtziLine("Even when it looks even, the totals favor me.", function () {
        showEl(lucyBubbleEl);
        queueDialogues([
          "When location wins are split, total influence breaks the tie \u2014 and this one went Otzi\u2019s way.",
          "You\u2019re not done. Adapt and try again."
        ], function () { showTutorialResults(won); });
      });
    } else if (won === 'player') {
      showOtziLine("No! Not again.", function () {
        showEl(lucyBubbleEl);
        queueDialogues(["As always, history has been written by the victors."], function () {
          showTutorialResults(won);
        });
      });
    } else {
      showOtziLine("The mountain keeps the strong and buries the weak.", function () {
        showEl(lucyBubbleEl);
        queueDialogues(["You\u2019re not done. Adapt and try again."], function () {
          showTutorialResults(won);
        });
      });
    }
  }

  function showTutorialResults(won) {
    // Partial teardown — keep Lucy bubble available for final dialogue
    clearSelection();
    removeNumHighlight();
    cancelInactivityTimer();
    TS.active     = false;
    TS.useBubbles = false;
    window.tutorialActive = false;
    if (TS.typeTimer) { clearInterval(TS.typeTimer); TS.typeTimer = null; }
    setLocked(false);
    hideEl(lucyBubbleEl);
    hideEl(skipEl);
    hideEl(dimEl);
    hideEl(endEl);
    if (otziBoxEl) hideEl(otziBoxEl);
    if (_otziTypeTimer) { clearInterval(_otziTypeTimer); _otziTypeTimer = null; }
    if (clickOverlayEl) clickOverlayEl.style.pointerEvents = 'none';
    document.body.classList.remove('tut-locked');
    document.querySelectorAll('.tut-lit').forEach(function (el) { el.classList.remove('tut-lit'); });
    document.querySelectorAll('.tut-ability-glow').forEach(function (el) { el.classList.remove('tut-ability-glow'); });

    // Build result data from tutorial state
    var locResults = T_LOCS.map(function (loc) {
      var pIP = 0, aIP = 0;
      TS.playerSlots[loc.id].forEach(function (sd) { if (sd && sd.revealed) pIP += tEffectiveIP(sd); });
      TS.aiSlots[loc.id].forEach(function (sd)     { if (sd && sd.revealed) aIP += tEffectiveIP(sd); });
      return { loc: loc, playerIP: pIP, aiIP: aIP,
               winner: pIP > aIP ? 'player' : aIP > pIP ? 'ai' : 'tie' };
    });
    var pW = locResults.filter(function (r) { return r.winner === 'player'; }).length;
    var aW = locResults.filter(function (r) { return r.winner === 'ai';     }).length;
    var outcome, tb = false, pT = 0, aT = 0;
    if      (pW >= 2) { outcome = 'player'; }
    else if (aW >= 2) { outcome = 'ai'; }
    else {
      tb = true;
      pT = locResults.reduce(function (s, r) { return s + r.playerIP; }, 0);
      aT = locResults.reduce(function (s, r) { return s + r.aiIP;     }, 0);
      outcome = pT > aT ? 'player' : aT > pT ? 'ai' : 'draw';
    }
    var result = { outcome: outcome, tiebreaker: tb, playerWins: pW, aiWins: aW,
                   playerTotal: pT, aiTotal: aT, locResults: locResults };

    // Populate result screen
    if (typeof window.showResult === 'function') window.showResult(result);

    // Location win animations while still on battle screen
    if (typeof Anim !== 'undefined') {
      locResults.forEach(function (lr) {
        if (lr.winner !== 'tie') {
          var locTile = boardEl.querySelector('.battle-location[data-loc-id="' + lr.loc.id + '"]');
          if (locTile) Anim.locationWin(locTile);
        }
      });
    }

    // SFX
    if (typeof SFX !== 'undefined') {
      if (outcome === 'player') SFX.gameWon();
      else if (outcome === 'ai') SFX.gameLost();
      else SFX.locationWon();
    }

    // Switch to result screen
    showScreen('screen-result');
    if (typeof Anim !== 'undefined') {
      if      (outcome === 'player') Anim.celebration();
      else if (outcome === 'ai')     Anim.sadResult();
    }

    // Hide Play Again during tutorial results
    var playAgainBtn = document.getElementById('result-play-again');
    if (playAgainBtn) playAgainBtn.style.display = 'none';

    // After 4 seconds Lucy's full dialogue box appears with final line
    setTimeout(function () {
      TS.active     = true;
      TS.useBubbles = false;
      hideEl(lucyBubbleEl);
      var speakerEl = boxEl ? boxEl.querySelector('.tut-speaker') : null;
      if (speakerEl) speakerEl.textContent = 'Lucy';
      showEl(boxEl);
      var line = (outcome === 'player' || outcome === 'draw')
        ? 'You did make history afterall. The Giants are waiting for you.'
        : 'Well, I said you need a lesson or two, but keep trying. Adapt. And one day, you will be ready for those Giants.';
      queueDialogues([line], function () {
        hideEl(boxEl);
        TS.active = false;
        localStorage.setItem('sog_tutorial_complete', 'true');
        // Disable click overlay so result screen buttons are clickable
        if (clickOverlayEl) clickOverlayEl.style.pointerEvents = 'none';
      });
    }, 4000);
  }

  function goHome(won) {
    // Partial teardown — preserves boxEl for home-screen dialogue
    clearSelection();
    removeNumHighlight();
    cancelInactivityTimer();
    TS.active     = false;
    TS.useBubbles = false;
    window.tutorialActive = false;
    if (TS.typeTimer) { clearInterval(TS.typeTimer); TS.typeTimer = null; }
    setLocked(false);
    hideEl(lucyBubbleEl);
    hideEl(skipEl);
    hideEl(dimEl);
    hideEl(endEl);
    if (otziBoxEl) hideEl(otziBoxEl);
    if (_otziTypeTimer) { clearInterval(_otziTypeTimer); _otziTypeTimer = null; }
    document.body.classList.remove('tut-locked');
    document.querySelectorAll('.tut-lit').forEach(function (el) { el.classList.remove('tut-lit'); });
    document.querySelectorAll('.tut-valid-slot').forEach(function (el) { el.classList.remove('tut-valid-slot'); });
    document.querySelectorAll('.tut-ability-glow').forEach(function (el) { el.classList.remove('tut-ability-glow'); });
    document.querySelectorAll('.tut-moveable').forEach(function (el) {
      el.classList.remove('tut-moveable'); el.removeAttribute('draggable');
    });
    document.querySelectorAll('.tut-loc-glow').forEach(function (el) { el.classList.remove('tut-loc-glow'); });
    document.querySelectorAll('.tut-ability-hidden').forEach(function (el) { el.classList.remove('tut-ability-hidden'); });
    var _musicCtrl = document.getElementById('battle-music-ctrl');
    if (_musicCtrl) _musicCtrl.style.display = '';

    showScreen('screen-home');
    showHomeOutcomeDialogue(won);
  }

  function showHomeOutcomeDialogue(won) {
    TS.active     = true;
    TS.useBubbles = false;
    var speakerEl = boxEl ? boxEl.querySelector('.tut-speaker') : null;
    if (speakerEl) speakerEl.textContent = 'Lucy';
    showEl(boxEl);
    var line = (won === 'player' || won === 'draw')
      ? "You just made history, kid. The Giants are waiting for you. Think you can handle them?"
      : "Perhaps a little more practice\u2026 but the Giants are waiting whenever you\u2019re ready.";
    showDialogue(line, function () {
      if (typeof gsap !== 'undefined') {
        gsap.to(boxEl, { opacity: 0, duration: 0.5, ease: 'power1.in', onComplete: function () {
          hideEl(boxEl);
          boxEl.style.opacity = '';
          TS.active = false;
          localStorage.setItem('sog_tutorial_complete', 'true');
        }});
      } else {
        hideEl(boxEl);
        TS.active = false;
        localStorage.setItem('sog_tutorial_complete', 'true');
      }
    });
  }

  /* ── Score helper ───────────────────────────────────────────── */

  function scoreAt(owner, locId) {
    var slots = owner === 'player' ? TS.playerSlots[locId] : TS.aiSlots[locId];
    if (!slots) return 0;
    var total = 0;
    slots.forEach(function (sd) { if (sd && sd.revealed) total += tEffectiveIP(sd); });
    return total;
  }

  /* ── AI card placement (hardcoded per turn) ──────────────────── */

  function placeAICards(turn) {
    var plays = [];
    if (turn === 1) plays = [{ l: 2, c: 21 }, { l: 2, c: 14 }]; // Nomad+JoA → Rift
    if (turn === 2) plays = [{ l: 6, c: 10 }];                   // Jesus Christ → Sahara
    if (turn === 3) plays = [{ l: 5, c: 18 }, { l: 5, c: 2  }]; // Juvenal+Scholar-Officials → Timbuktu
    if (turn === 4) plays = [{ l: 2, c: 3  }, { l: 5, c: 23 }]; // Justinian→Rift, ZhengHe→Timbuktu
    if (turn === 5) plays = [{ l: 6, c: 4  }, { l: 5, c: 11 }]; // EmpressWu→Sahara, Knight→Timbuktu
    plays.forEach(function (item) {
      var slots = TS.aiSlots[item.l]; if (!slots) return;
      var si = slots.indexOf(null); if (si === -1) return;
      var card = CARDS.find(function (c) { return c.id === item.c; }); if (!card) return;
      slots[si] = {
        cardId: item.c, ip: card.ip, revealed: false, contMod: 0,
        // Starter cards (T1/T2 placements) are pre-ability — they
        // always show "No special ability — For now" when clicked
        // on the board, regardless of the card's real ability.
        _starter: turn <= 2
      };
      var slotEl = getTutSlotEl('opp', item.l, si);
      if (slotEl) slotEl.className = 'battle-card-slot occupied face-down';
    });
  }

  /* ── Location reveal (T1 → T2 transition) ───────────────────── */

  function revealNewLocations(onDone) {
    var timbCol   = boardEl.querySelector('.battle-col[data-loc-id="5"]');
    var saharaCol = boardEl.querySelector('.battle-col[data-loc-id="6"]');

    if (typeof gsap !== 'undefined') {
      if (timbCol) gsap.fromTo(timbCol, { x: -300, opacity: 0 }, {
        x: 0, opacity: 1, duration: 0.7, ease: 'power3.out',
        onStart: function () { timbCol.style.pointerEvents = ''; }
      });
      if (saharaCol) gsap.fromTo(saharaCol, { x: 300, opacity: 0 }, {
        x: 0, opacity: 1, duration: 0.7, ease: 'power3.out',
        onStart: function () { saharaCol.style.pointerEvents = ''; },
        onComplete: onDone
      });
      if (!saharaCol && onDone) setTimeout(onDone, 700);
    } else {
      if (timbCol)   { timbCol.style.opacity = '';   timbCol.style.pointerEvents = ''; }
      if (saharaCol) { saharaCol.style.opacity = ''; saharaCol.style.pointerEvents = ''; }
      if (onDone) onDone();
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     CARD PLACEMENT
  ═══════════════════════════════════════════════════════════════ */

  /* Tutorial-aware effective cost (Henry + Levant discounts). */
  function tEffectiveCost(card, locId) {
    var cost = card.cc;
    var loc = T_LOCS.find(function (l) { return l.id === locId; });
    if (loc && loc.abilityKey === 'RELIGIOUS_DISCOUNT' && card.type === 'Religious')
      cost = Math.max(0, cost - 1);
    if (card.type === 'Exploration' && TS.abilitiesActive) {
      var henryOnBoard = T_LOCS.some(function (l) {
        return TS.playerSlots[l.id].some(function (s) { return s && s.revealed && s.cardId === 22; });
      });
      if (henryOnBoard) cost = Math.max(0, cost - 1);
    }
    return cost;
  }

  function playCard(cardId, locId) {
    var card = CARDS.find(function (c) { return c.id === cardId; });
    if (!card) return false;
    var slots = TS.playerSlots[locId];
    if (!slots) return false;
    var si = slots.indexOf(null);
    var cost = tEffectiveCost(card, locId);
    if (si === -1 || cost > TS.capital) return false;

    slots[si] = {
      cardId: cardId, ip: card.ip, revealed: false, contMod: 0,
      // Starter cards (T1/T2 placements) are pre-ability — they
      // always show "No special ability — For now" when clicked.
      _starter: TS.turn <= 2
    };
    TS.capital -= cost;
    TS.playerHand = TS.playerHand.filter(function (id) { return id !== cardId; });
    TS.cardsPlayedThisTurn++;
    TS.playerActionLog.push({ type: 'play', cardId: cardId, locId: locId });

    var slotEl = getTutSlotEl('player', locId, si);
    if (slotEl) {
      slotEl.dataset.cardId = cardId;
      slotEl.className = 'battle-card-slot occupied face-up unplayed';
      slotEl.draggable = true;
      slotEl.innerHTML = '';
      var _w = document.createElement('div'); _w.className = 'db-card-img-wrap';
      var _p = document.createElement('div'); _p.className = 'db-card-img-placeholder'; _p.textContent = card.name.charAt(0);
      var _i = document.createElement('img'); _i.className = 'db-card-img'; _i.src = 'images/cards/' + card.name + '.jpg'; _i.onerror = function () { this.style.display = 'none'; };
      _w.appendChild(_p); _w.appendChild(_i);
      var _cc = document.createElement('div'); _cc.className = 'db-overlay-cc'; _cc.textContent = card.cc;
      var _ip = document.createElement('div'); _ip.className = 'db-overlay-ip'; _ip.textContent = card.ip;
      slotEl.appendChild(_w); slotEl.appendChild(_cc); slotEl.appendChild(_ip);
    }

    renderHand(TS.playerHand);
    setCapital(TS.capital);
    cancelInactivityTimer();
    startInactivityTimer();
    return true;
  }

  /* Find a player card on the board; returns {locId, si} or null */
  function findPlayerCard(cardId) {
    for (var locId in TS.playerSlots) {
      var slots = TS.playerSlots[locId];
      for (var i = 0; i < slots.length; i++) {
        if (slots[i] && slots[i].cardId === cardId) {
          return { locId: parseInt(locId, 10), si: i };
        }
      }
    }
    return null;
  }

  /* Make a revealed board-card slot draggable for the Magellan move */
  function makeBoardCardMoveable(locId, si) {
    var slotEl = getTutSlotEl('player', locId, si);
    if (!slotEl) return;
    slotEl.draggable = true;
    slotEl.classList.add('tut-moveable');
    slotEl.dataset.boardDragLocId = locId;
    slotEl.dataset.boardDragSi    = si;
  }

  /* Move a player board card to a new location (Magellan gains +1 IP per move) */
  /* Compact slots so all cards shift down to fill any null gaps */
  function compactTutSlotsAt(owner, locId) {
    var sl = owner === 'player' ? TS.playerSlots : TS.aiSlots;
    var slots = sl[locId];
    // Build a packed array of non-null entries
    var packed = slots.filter(function (s) { return s !== null; });
    while (packed.length < slots.length) packed.push(null);
    for (var i = 0; i < slots.length; i++) {
      slots[i] = packed[i];
      var slotEl = getTutSlotEl(owner, locId, i);
      if (!slotEl) continue;
      if (!packed[i]) {
        slotEl.className = 'battle-card-slot';
        slotEl.innerHTML = '';
        slotEl.removeAttribute('draggable');
        delete slotEl.dataset.cardId;
      } else if (!packed[i].revealed) {
        // Unrevealed card — show as face-down (no content visible)
        slotEl.dataset.cardId = packed[i].cardId;
        slotEl.className = 'battle-card-slot occupied face-down';
        slotEl.innerHTML = '';
      } else {
        var card = CARDS.find(function (c) { return c.id === packed[i].cardId; });
        if (!card) continue;
        slotEl.dataset.cardId = card.id;
        slotEl.className = 'battle-card-slot occupied face-up';
        slotEl.innerHTML = '';
        var wrap = document.createElement('div'); wrap.className = 'db-card-img-wrap';
        var ph2  = document.createElement('div'); ph2.className = 'db-card-img-placeholder'; ph2.textContent = card.name.charAt(0);
        var img2 = document.createElement('img'); img2.className = 'db-card-img';
        img2.src = 'images/cards/' + card.name + '.jpg';
        img2.onerror = function () { this.style.display = 'none'; };
        wrap.appendChild(ph2); wrap.appendChild(img2);
        var cc2 = document.createElement('div'); cc2.className = 'db-overlay-cc'; cc2.textContent = card.cc;
        var ip2 = document.createElement('div'); ip2.className = 'db-overlay-ip'; ip2.textContent = tEffectiveIP(packed[i]);
        slotEl.appendChild(wrap); slotEl.appendChild(cc2); slotEl.appendChild(ip2);
      }
    }
  }

  function moveBoardCard(fromLocId, fromSi, toLocId) {
    var fromSlots = TS.playerSlots[fromLocId];
    var toSlots   = TS.playerSlots[toLocId];
    if (!fromSlots || !toSlots) return false;
    var sd = fromSlots[fromSi];
    if (!sd) return false;
    var toSi = toSlots.indexOf(null);
    if (toSi === -1) return false;

    // Queue the move — don't apply IP bonus yet; that happens during reveal
    TS.pendingMove = {
      cardId: sd.cardId, sd: sd,
      fromLocId: fromLocId, fromSi: fromSi,
      toLocId: toLocId
    };
    TS.playerActionLog.push({ type: 'move', cardId: sd.cardId, fromLocId: fromLocId, fromSi: fromSi, toLocId: toLocId });

    // Visually move the card to the destination during selection
    toSlots[toSi]     = sd;
    fromSlots[fromSi] = null;

    // Compact source location so remaining cards slide up
    compactTutSlotsAt('player', fromLocId);

    // Clear drag attributes from the old slot (now compacted)
    var fromEl = getTutSlotEl('player', fromLocId, fromSi);
    if (fromEl) {
      fromEl.removeAttribute('draggable');
      fromEl.classList.remove('tut-moveable');
      delete fromEl.dataset.boardDragLocId;
      delete fromEl.dataset.boardDragSi;
    }

    // Build new face-up slot at destination (visual preview)
    var toEl = getTutSlotEl('player', toLocId, toSi);
    if (toEl) {
      var card = CARDS.find(function (c) { return c.id === sd.cardId; });
      toEl.className = 'battle-card-slot occupied face-up';
      toEl.innerHTML = '';
      toEl.removeAttribute('draggable');
      if (card) {
        var wrap = document.createElement('div');
        wrap.className = 'db-card-img-wrap';
        var ph = document.createElement('div');
        ph.className   = 'db-card-img-placeholder';
        ph.textContent = card.name.charAt(0);
        var img = document.createElement('img');
        img.className = 'db-card-img';
        img.src       = 'images/cards/' + card.name + '.jpg';
        img.onerror   = function () { this.style.display = 'none'; };
        wrap.appendChild(ph); wrap.appendChild(img);
        var ccEl = document.createElement('div');
        ccEl.className = 'db-overlay-cc'; ccEl.textContent = card.cc;
        var ipEl = document.createElement('div');
        ipEl.className = 'db-overlay-ip'; ipEl.textContent = sd.ip;
        toEl.appendChild(wrap); toEl.appendChild(ccEl); toEl.appendChild(ipEl);
      }
    }
    updateScores();
    return true;
  }

  /* Snap a pending board move back to origin (called at reveal start).
     Only touches the two affected slots — leaves other cards untouched
     so unrevealed cards keep their face-up unplayed state for the
     flip-to-face-down animation that follows. */
  function tutSnapBack() {
    var mv = TS.pendingMove;
    if (!mv) return;

    // Find the card at its current (destination) slot
    var destSlots = TS.playerSlots[mv.toLocId];
    var destIdx = -1;
    for (var i = 0; i < destSlots.length; i++) {
      if (destSlots[i] && destSlots[i].cardId === mv.cardId) { destIdx = i; break; }
    }
    if (destIdx === -1) { TS.pendingMove = null; return; }

    // Move it back to origin in state
    var origSlots = TS.playerSlots[mv.fromLocId];
    var origSi = origSlots.indexOf(null);
    if (origSi === -1) origSi = mv.fromSi; // fallback
    origSlots[origSi] = mv.sd;
    destSlots[destIdx] = null;

    // Clear the destination slot DOM (where Magellan was previewed)
    var destEl = getTutSlotEl('player', mv.toLocId, destIdx);
    if (destEl) {
      destEl.className = 'battle-card-slot';
      destEl.innerHTML = '';
      delete destEl.dataset.cardId;
    }

    // Rebuild Magellan at his origin slot
    var origEl = getTutSlotEl('player', mv.fromLocId, origSi);
    if (origEl) {
      var card = CARDS.find(function (c) { return c.id === mv.cardId; });
      origEl.dataset.cardId = mv.cardId;
      origEl.className = 'battle-card-slot occupied face-up';
      origEl.innerHTML = '';
      if (card) {
        var wrap = document.createElement('div'); wrap.className = 'db-card-img-wrap';
        var ph = document.createElement('div'); ph.className = 'db-card-img-placeholder'; ph.textContent = card.name.charAt(0);
        var img = document.createElement('img'); img.className = 'db-card-img';
        img.src = 'images/cards/' + card.name + '.jpg';
        img.onerror = function () { this.style.display = 'none'; };
        wrap.appendChild(ph); wrap.appendChild(img);
        var ccEl = document.createElement('div'); ccEl.className = 'db-overlay-cc'; ccEl.textContent = card.cc;
        var ipEl = document.createElement('div'); ipEl.className = 'db-overlay-ip'; ipEl.textContent = mv.sd.ip;
        origEl.appendChild(wrap); origEl.appendChild(ccEl); origEl.appendChild(ipEl);
      }
    }
  }

  /* Execute the pending move with animation + SFX during reveal. */
  function tutExecutePendingMove(done) {
    var mv = TS.pendingMove;
    TS.pendingMove = null;
    if (!mv) { done(); return; }

    // Find card at origin (where snapBack placed it)
    var origSlots = TS.playerSlots[mv.fromLocId];
    var fromSi = -1;
    for (var i = 0; i < origSlots.length; i++) {
      if (origSlots[i] && origSlots[i].cardId === mv.cardId) { fromSi = i; break; }
    }
    if (fromSi === -1) { done(); return; }
    var sd = origSlots[fromSi];

    // Find destination slot
    var destSlots = TS.playerSlots[mv.toLocId];
    var toSi = destSlots.indexOf(null);
    if (toSi === -1) { done(); return; }

    var card = CARDS.find(function (c) { return c.id === mv.cardId; });
    var fromEl = getTutSlotEl('player', mv.fromLocId, fromSi);
    var toEl   = getTutSlotEl('player', mv.toLocId, toSi);

    // Play sailing SFX
    if (typeof SFX !== 'undefined') SFX.sailingSound();

    // Animate slide from origin to destination
    if (fromEl && toEl && typeof gsap !== 'undefined') {
      var fromRect = fromEl.getBoundingClientRect();
      var toRect   = toEl.getBoundingClientRect();
      var dx = toRect.left - fromRect.left;
      var dy = toRect.top  - fromRect.top;

      gsap.to(fromEl, {
        x: dx, y: dy, duration: 0.45, ease: 'power2.inOut',
        onComplete: function () {
          gsap.set(fromEl, { clearProps: 'x,y' });
          // Apply the actual move in state
          sd.ip += 1;
          destSlots[toSi] = sd;
          origSlots[fromSi] = null;

          // Clear the origin slot (where Magellan was)
          fromEl.className = 'battle-card-slot';
          fromEl.innerHTML = '';
          delete fromEl.dataset.cardId;

          // Build Magellan at destination
          var destCardEl = getTutSlotEl('player', mv.toLocId, toSi);
          if (destCardEl && card) {
            destCardEl.dataset.cardId = mv.cardId;
            destCardEl.className = 'battle-card-slot occupied face-up';
            destCardEl.innerHTML = '';
            var _w = document.createElement('div'); _w.className = 'db-card-img-wrap';
            var _p = document.createElement('div'); _p.className = 'db-card-img-placeholder'; _p.textContent = card.name.charAt(0);
            var _i = document.createElement('img'); _i.className = 'db-card-img';
            _i.src = 'images/cards/' + card.name + '.jpg'; _i.onerror = function () { this.style.display = 'none'; };
            _w.appendChild(_p); _w.appendChild(_i);
            var _cc = document.createElement('div'); _cc.className = 'db-overlay-cc'; _cc.textContent = card.cc;
            var _ip = document.createElement('div'); _ip.className = 'db-overlay-ip'; _ip.textContent = tEffectiveIP(sd);
            destCardEl.appendChild(_w); destCardEl.appendChild(_cc); destCardEl.appendChild(_ip);
            if (typeof Anim !== 'undefined') Anim.floatNumber(destCardEl, 1);
          }

          updateScores();
          evalContinuous_tut();
          setTimeout(done, 600);
        }
      });
    } else {
      // No GSAP fallback — instant move
      sd.ip += 1;
      destSlots[toSi] = sd;
      origSlots[fromSi] = null;

      // Clear origin slot
      if (fromEl) {
        fromEl.className = 'battle-card-slot';
        fromEl.innerHTML = '';
        delete fromEl.dataset.cardId;
      }
      // Build at destination
      if (toEl && card) {
        toEl.dataset.cardId = mv.cardId;
        toEl.className = 'battle-card-slot occupied face-up';
        toEl.innerHTML = '';
        var _w2 = document.createElement('div'); _w2.className = 'db-card-img-wrap';
        var _p2 = document.createElement('div'); _p2.className = 'db-card-img-placeholder'; _p2.textContent = card.name.charAt(0);
        var _i2 = document.createElement('img'); _i2.className = 'db-card-img';
        _i2.src = 'images/cards/' + card.name + '.jpg'; _i2.onerror = function () { this.style.display = 'none'; };
        _w2.appendChild(_p2); _w2.appendChild(_i2);
        var _cc2 = document.createElement('div'); _cc2.className = 'db-overlay-cc'; _cc2.textContent = card.cc;
        var _ip2 = document.createElement('div'); _ip2.className = 'db-overlay-ip'; _ip2.textContent = tEffectiveIP(sd);
        toEl.appendChild(_w2); toEl.appendChild(_cc2); toEl.appendChild(_ip2);
      }

      updateScores();
      evalContinuous_tut();
      done();
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     REVEAL SEQUENCE
  ═══════════════════════════════════════════════════════════════ */

  function runReveal(turn, onDone) {
    // Snap any pending board move back to origin before reveal begins
    tutSnapBack();

    // Flip all face-up unplayed player cards face-down before reveal begins
    var unplayedEls = Array.prototype.slice.call(
      document.querySelectorAll('.battle-card-slot.unplayed[data-owner="player"]')
    );
    function doReveal() {
      // Build player sequence from actionLog (preserves play/move order)
      var pQ = TS.playerActionLog.map(function (action) {
        if (action.type === 'move') {
          return { type: 'move', owner: 'player', cardId: action.cardId,
                   fromLocId: action.fromLocId, toLocId: action.toLocId };
        }
        // type === 'play': find the unrevealed slot data for this card
        var sl = TS.playerSlots[action.locId];
        for (var i = 0; i < sl.length; i++) {
          if (sl[i] && !sl[i].revealed && sl[i].cardId === action.cardId) {
            return { type: 'play', owner: 'player', locId: action.locId, si: i, sd: sl[i] };
          }
        }
        return null;
      }).filter(Boolean);

      // AI plays (no ordering needed)
      var aQ = [];
      T_LOCS.forEach(function (loc) {
        TS.aiSlots[loc.id].forEach(function (sd, i) {
          if (sd && !sd.revealed) aQ.push({ type: 'play', owner: 'opp', locId: loc.id, si: i, sd: sd });
        });
      });

      // Interleave based on who goes first
      var fQ = TS.playerFirst ? pQ : aQ;
      var sQ = TS.playerFirst ? aQ : pQ;
      var combined = [];
      var max = Math.max(fQ.length, sQ.length);
      for (var i = 0; i < max; i++) {
        if (i < fQ.length) combined.push(fQ[i]);
        if (i < sQ.length) combined.push(sQ[i]);
      }

      showTutRevealHighlight(TS.playerFirst);
      var idx = 0;
      function next() {
        if (idx >= combined.length) {
          hideTutRevealHighlight();
          updateScores();
          setTimeout(onDone, 800);
          return;
        }
        var item = combined[idx++];
        if (item.type === 'move') {
          tutExecutePendingMove(function () {
            updateScores();
            setTimeout(next, 1000);
          });
        } else {
          flipCard(item, function () {
            updateScores();
            setTimeout(next, 1000);
          });
        }
      }
      setTimeout(next, 700);
    } // end doReveal

    if (unplayedEls.length && typeof gsap !== 'undefined') {
      gsap.to(unplayedEls, {
        scaleX: 0, duration: 0.15, ease: 'power2.in',
        onComplete: function () {
          unplayedEls.forEach(function (el) {
            el.classList.remove('face-up', 'unplayed');
            el.classList.add('face-down');
            el.innerHTML = '';
          });
          gsap.to(unplayedEls, { scaleX: 1, duration: 0.12, ease: 'power2.out',
            onComplete: doReveal
          });
        }
      });
    } else {
      unplayedEls.forEach(function (el) {
        el.classList.remove('face-up', 'unplayed');
        el.classList.add('face-down');
        el.innerHTML = '';
      });
      doReveal();
    }
  }

  function flipCard(item, proceed) {
    item.sd.revealed = true;
    var card = CARDS.find(function (c) { return c.id === item.sd.cardId; });
    if (!card) { if (proceed) proceed(); return; }
    var slotEl = getTutSlotEl(item.owner, item.locId, item.si);
    if (!slotEl) { if (proceed) proceed(); return; }

    if (typeof SFX !== 'undefined') SFX.cardReveal();

    slotEl.innerHTML = '';
    slotEl.className = 'battle-card-slot occupied face-up';
    slotEl.removeAttribute('draggable');

    var wrap = document.createElement('div');
    wrap.className = 'db-card-img-wrap';
    var ph = document.createElement('div');
    ph.className   = 'db-card-img-placeholder';
    ph.textContent = card.name.charAt(0);
    var img = document.createElement('img');
    img.className = 'db-card-img';
    img.src       = 'images/cards/' + card.name + '.jpg';
    img.onerror   = function () { this.style.display = 'none'; };
    wrap.appendChild(ph);
    wrap.appendChild(img);

    var ccEl = document.createElement('div');
    ccEl.className   = 'db-overlay-cc';
    ccEl.textContent = card.cc;
    var ipEl = document.createElement('div');
    ipEl.className   = 'db-overlay-ip';
    ipEl.textContent = tEffectiveIP(item.sd);

    slotEl.appendChild(wrap);
    slotEl.appendChild(ccEl);
    slotEl.appendChild(ipEl);

    if (typeof Anim !== 'undefined') Anim.cardReveal(slotEl);

    // ── Per-card reveal SFX + animations (mirrors game.js flipSlot) ──
    var cardId = item.sd.cardId;
    var locId  = item.locId;
    setTimeout(function () {
      // Kente Cloth (17): shield chime + orange location glow
      if (cardId === 17) {
        if (typeof SFX  !== 'undefined') SFX.kenteSound();
        var locTileEl = boardEl.querySelector('.battle-col[data-loc-id="' + locId + '"]');
        if (typeof Anim !== 'undefined') Anim.setKenteGlow(locTileEl, true);
      }

      // Juvenal (18): laughter + orange flash on penalised cards (CC >= 4)
      if (cardId === 18) {
        var jTargets = [];
        ['player', 'opp'].forEach(function (own) {
          var sl = own === 'player' ? TS.playerSlots : TS.aiSlots;
          (sl[locId] || []).forEach(function (s, si) {
            if (!s || !s.revealed || s.cardId === 18) return;
            var c = CARDS.find(function (x) { return x.id === s.cardId; });
            if (c && c.cc >= 4) jTargets.push(getTutSlotEl(own, locId, si));
          });
        });
        if (jTargets.length > 0) {
          if (typeof SFX  !== 'undefined') SFX.juvenalSound();
          if (typeof Anim !== 'undefined') jTargets.forEach(function (el) { if (el) Anim.juvenalFlash(el); });
        }
      }

      // Any card revealed where Juvenal is already active
      if (cardId !== 18 && card.cc >= 4) {
        var jPresent = ['player', 'opp'].some(function (own) {
          var sl = own === 'player' ? TS.playerSlots : TS.aiSlots;
          return (sl[locId] || []).some(function (s) { return s && s.revealed && s.cardId === 18; });
        });
        if (jPresent) {
          if (typeof SFX  !== 'undefined') SFX.juvenalSound();
          if (typeof Anim !== 'undefined') Anim.juvenalFlash(slotEl);
        }
      }

      // Cosimo de'Medici (19): money-bags chime
      if (cardId === 19) {
        if (typeof SFX !== 'undefined') SFX.cosimoSound();
      }

      // Henry the Navigator (22): patronage chime
      if (cardId === 22) {
        if (typeof SFX !== 'undefined') SFX.henrySound();
      }

      fireAtOnce_tut(item.owner, item.sd.cardId, item.locId, function () {
        evalContinuous_tut();
        if (proceed) proceed();
      });
    }, 320);
  }

  function tEffectiveIP(sd) {
    return sd.ip + (sd.contMod || 0);
  }

  /* ═══════════════════════════════════════════════════════════════
     TUTORIAL ABILITY ENGINE  (active from T3 onward)
  ═══════════════════════════════════════════════════════════════ */

  /* Re-evaluate all Continuous abilities and update slot IP displays. */
  function evalContinuous_tut() {
    if (!TS.abilitiesActive) return;

    // Snapshot Voltaire's current contMod so we can detect 0 → +4 activation
    var voltairePrev = {};
    T_LOCS.forEach(function (loc) {
      ['player', 'opp'].forEach(function (own) {
        var sl = own === 'player' ? TS.playerSlots : TS.aiSlots;
        sl[loc.id].forEach(function (s) {
          if (s && s.revealed && s.cardId === 20)
            voltairePrev[own + ':' + loc.id] = s.contMod || 0;
        });
      });
    });

    // Reset contMods
    T_LOCS.forEach(function (loc) {
      ['player', 'opp'].forEach(function (own) {
        var sl = own === 'player' ? TS.playerSlots : TS.aiSlots;
        sl[loc.id].forEach(function (s) { if (s) s.contMod = 0; });
      });
    });

    T_LOCS.forEach(function (loc) {
      var sides = [
        { own: 'player', sl: TS.playerSlots },
        { own: 'opp',    sl: TS.aiSlots     }
      ];

      // Juvenal (18): -2 IP to all revealed 4/5-CC cards at this location (both sides)
      sides.forEach(function (side) {
        side.sl[loc.id].forEach(function (s) {
          if (!s || !s.revealed || s.cardId !== 18) return;
          sides.forEach(function (side2) {
            side2.sl[loc.id].forEach(function (s2) {
              if (!s2 || !s2.revealed || s2.cardId === 18) return;
              var c2 = CARDS.find(function (c) { return c.id === s2.cardId; });
              if (c2 && c2.cc >= 4) s2.contMod = (s2.contMod || 0) - 2;
            });
          });
        });
      });

      // Voltaire (20): +4 IP if the only revealed card on that side at this location
      sides.forEach(function (side) {
        side.sl[loc.id].forEach(function (s) {
          if (!s || !s.revealed || s.cardId !== 20) return;
          var count = side.sl[loc.id].filter(function (s2) {
            return s2 && s2.revealed;
          }).length;
          if (count === 1) s.contMod = (s.contMod || 0) + 4;
        });
      });

      // William the Conqueror (15): +destroyedIPTotal (player only; AI doesn't play William)
      TS.playerSlots[loc.id].forEach(function (s) {
        if (s && s.revealed && s.cardId === 15 && TS.destroyedIPTotal > 0)
          s.contMod = (s.contMod || 0) + TS.destroyedIPTotal;
      });

      // The Sahara (ALL_MINUS_ONE_IP): -1 IP to ALL revealed cards here (both sides)
      if (loc.abilityKey === 'ALL_MINUS_ONE_IP') {
        sides.forEach(function (side) {
          side.sl[loc.id].forEach(function (s) {
            if (s && s.revealed) s.contMod = (s.contMod || 0) - 1;
          });
        });
      }
    });

    // Fire Voltaire animation + sound when his bonus transitions 0 → +4
    T_LOCS.forEach(function (loc) {
      ['player', 'opp'].forEach(function (own) {
        var sl = own === 'player' ? TS.playerSlots : TS.aiSlots;
        sl[loc.id].forEach(function (s, si) {
          if (!s || !s.revealed || s.cardId !== 20) return;
          var prev = voltairePrev[own + ':' + loc.id] || 0;
          var next = s.contMod || 0;
          if (next > 0 && prev === 0) {
            var slotEl = getTutSlotEl(own, loc.id, si);
            if (typeof SFX  !== 'undefined') SFX.voltaireSound();
            if (typeof Anim !== 'undefined' && slotEl) {
              Anim.voltaireRock(slotEl);
              Anim.floatNumber(slotEl, 4);
            }
          }
        });
      });
    });

    // Update continuous glow on all revealed slots + Kente location glows
    if (typeof Anim !== 'undefined') {
      T_LOCS.forEach(function (loc) {
        // Card glows
        ['player', 'opp'].forEach(function (own) {
          var sl = own === 'player' ? TS.playerSlots : TS.aiSlots;
          sl[loc.id].forEach(function (s, si) {
            if (!s || !s.revealed) return;
            var slotEl = getTutSlotEl(own, loc.id, si);
            Anim.setGlow(slotEl, (s.contMod || 0) !== 0);
          });
        });
        // Kente location glow
        var hasKente = ['player', 'opp'].some(function (own) {
          var sl = own === 'player' ? TS.playerSlots : TS.aiSlots;
          return sl[loc.id].some(function (s) { return s && s.revealed && s.cardId === 17; });
        });
        var locTileEl = boardEl.querySelector('.battle-col[data-loc-id="' + loc.id + '"]');
        if (locTileEl) Anim.setKenteGlow(locTileEl, hasKente);
      });
    }

    // Refresh all revealed-slot IP displays with updated contMods
    T_LOCS.forEach(function (loc) {
      ['player', 'opp'].forEach(function (own) {
        var sl = own === 'player' ? TS.playerSlots : TS.aiSlots;
        for (var i = 0; i < 4; i++) {
          var sd = sl[loc.id][i];
          if (!sd || !sd.revealed) continue;
          var slotEl = getTutSlotEl(own, loc.id, i);
          if (!slotEl) continue;
          var ipEl = slotEl.querySelector('.db-overlay-ip');
          if (ipEl) ipEl.textContent = tEffectiveIP(sd);
        }
      });
    });
  }

  /* Fire the At Once ability for a just-revealed card (no-op before T3). */
  function fireAtOnce_tut(owner, cardId, locId, done) {
    if (!TS.abilitiesActive) { done(); return; }
    // Generic At Once pulse for cards that use the standard chime (mirrors game.js)
    var genericPulse = [4, 23].indexOf(cardId) !== -1;
    if (genericPulse) {
      if (typeof SFX !== 'undefined') SFX.atOnce();
      var atEl = tFindSlotEl(owner, cardId);
      if (atEl && typeof Anim !== 'undefined') Anim.pulseYellow(atEl);
    }
    switch (cardId) {
      case 2:  tAb_ScholarOfficials(owner, locId, done); break;
      case 3:  tAb_Justinian(owner, locId, done);        break;
      case 4:  tAb_EmpressWu(owner, locId, done);        break;
      case 5:  tAb_Pacal(owner, locId, done);            break;
      case 13: tAb_HernanCortes(owner, locId, done);     break;
      case 23: tAb_ZhengHe(owner, locId, done);          break;
      default: done(); break;
    }
  }

  /* Scholar-Officials: player earns +1 Capital next turn per other card at this location. */
  function tAb_ScholarOfficials(owner, locId, done) {
    if (owner !== 'player') { done(); return; }   // AI capital not tracked
    var sl = TS.playerSlots[locId];
    // Count revealed player cards here except Scholar-Officials itself
    var others = sl.filter(function (s) { return s && s.revealed && s.cardId !== 2; }).length;
    if (others === 0) { done(); return; }

    TS.bonusCapitalNextTurn += others;

    // Find Scholar-Officials' slot element
    var soIdx = -1;
    for (var i = 0; i < sl.length; i++) {
      if (sl[i] && sl[i].cardId === 2) { soIdx = i; break; }
    }
    var soEl = soIdx !== -1 ? getTutSlotEl(owner, locId, soIdx) : null;

    if (typeof SFX  !== 'undefined') SFX.coinSound();
    if (typeof Anim !== 'undefined' && soEl) {
      Anim.scholarPulse(soEl);
      Anim.floatCapital(soEl, others);
      // Pulse each contributing card
      sl.forEach(function (s, si) {
        if (!s || !s.revealed || s.cardId === 2) return;
        var contEl = getTutSlotEl(owner, locId, si);
        if (contEl) Anim.scholarPulse(contEl);
      });
    }
    setTimeout(done, 1050);
  }

  /* Justinian: reset all cards at this location to their original IP. */
  function tAb_Justinian(owner, locId, done) {
    if (typeof SFX !== 'undefined') SFX.justinianShing();

    // Flash Justinian's own card
    var justSl = owner === 'player' ? TS.playerSlots : TS.aiSlots;
    var justEl = null;
    for (var ji = 0; ji < justSl[locId].length; ji++) {
      if (justSl[locId][ji] && justSl[locId][ji].cardId === 3) {
        justEl = getTutSlotEl(owner, locId, ji); break;
      }
    }
    if (justEl && typeof Anim !== 'undefined') Anim.justinianFlash(justEl);

    // Reset IP for all revealed cards at this location and flash affected cards
    var anyAffected = false;
    ['player', 'opp'].forEach(function (own) {
      var sl = own === 'player' ? TS.playerSlots : TS.aiSlots;
      sl[locId].forEach(function (s, i) {
        if (!s || !s.revealed) return;
        var card = CARDS.find(function (c) { return c.id === s.cardId; });
        if (!card) return;
        var oldIP = s.ip;
        s.ip = card.ip;
        var slotEl = getTutSlotEl(own, locId, i);
        if (slotEl) {
          var ipEl = slotEl.querySelector('.db-overlay-ip');
          if (ipEl) ipEl.textContent = tEffectiveIP(s);
          if (oldIP !== card.ip) {
            anyAffected = true;
            if (typeof Anim !== 'undefined') {
              Anim.justinianFlash(slotEl);
              Anim.floatNumber(slotEl, card.ip - oldIP);
            }
          }
        }
      });
    });

    setTimeout(done, anyAffected ? 800 : 650);
  }

  /* Pacal: trigger At Once abilities of all your other revealed cards here. */
  function tAb_Pacal(owner, locId, done) {
    var sl = owner === 'player' ? TS.playerSlots : TS.aiSlots;
    // Collect other At Once cards at this location (exclude Pacal himself)
    var cards = [];
    sl[locId].forEach(function (s) {
      if (!s || !s.revealed || s.cardId === 5) return;
      var c = CARDS.find(function (x) { return x.id === s.cardId; });
      if (c && c.ability && c.ability.indexOf('At Once') !== -1) cards.push(s.cardId);
    });

    if (typeof SFX !== 'undefined') SFX.pacalSound();

    function runCards() {
      var idx = 0;
      function next() {
        if (idx >= cards.length) { done(); return; }
        fireAtOnce_tut(owner, cards[idx++], locId, next);
      }
      next();
    }

    // Clock-wipe over Pacal's card, then trigger the chain
    var pacalEl = tFindSlotEl(owner, 5);
    if (pacalEl && typeof Anim !== 'undefined') {
      Anim.pacalWipe(pacalEl, runCards);
    } else {
      runCards();
    }
  }

  /* Zheng He: +2 IP to the first revealed card on your side at each adjacent location. */
  function tAb_ZhengHe(owner, locId, done) {
    var locIdx = -1;
    for (var li = 0; li < T_LOCS.length; li++) {
      if (T_LOCS[li].id === locId) { locIdx = li; break; }
    }
    var adjIds = [];
    if (locIdx > 0)               adjIds.push(T_LOCS[locIdx - 1].id);
    if (locIdx < T_LOCS.length - 1) adjIds.push(T_LOCS[locIdx + 1].id);

    // Bounce Zheng He's card
    var zhengEl = tFindSlotEl(owner, 23);
    if (zhengEl && typeof Anim !== 'undefined') Anim.zhengheBounce(zhengEl);

    var sl = owner === 'player' ? TS.playerSlots : TS.aiSlots;
    adjIds.forEach(function (adjId) {
      for (var i = 0; i < 4; i++) {
        var s = sl[adjId] && sl[adjId][i];
        if (s && s.revealed) {
          s.ip += 2;
          // Float +2 on the boosted card and update display
          var boostedEl = getTutSlotEl(owner, adjId, i);
          if (boostedEl) {
            if (typeof Anim !== 'undefined') Anim.floatNumber(boostedEl, 2);
            var ipEl = boostedEl.querySelector('.db-overlay-ip');
            if (ipEl) ipEl.textContent = tEffectiveIP(s);
          }
          break;
        }
      }
    });
    setTimeout(done, 900);
  }

  /* Hernan Cortes: destroy all of your other revealed cards here, +1 IP each. */
  function tAb_HernanCortes(owner, locId, done) {
    if (typeof SFX !== 'undefined') SFX.cortesCharge();
    var sl = owner === 'player' ? TS.playerSlots : TS.aiSlots;

    // Collect victims with their current IP values before destruction
    // Include all cards at this location (revealed or not) — Cortes fires on reveal so
    // other cards placed this turn may not be revealed yet when the ability triggers.
    var victims = [];
    for (var i = 0; i < sl[locId].length; i++) {
      var s = sl[locId][i];
      if (!s || s.cardId === 13) continue;
      victims.push({ idx: i, ip: tEffectiveIP(s), cardId: s.cardId });
    }
    if (victims.length === 0) { done(); return; }

    // Find Cortes element and slot data for the animation
    var cortesIdx = -1;
    for (var ci = 0; ci < sl[locId].length; ci++) {
      if (sl[locId][ci] && sl[locId][ci].cardId === 13) { cortesIdx = ci; break; }
    }
    var cortesEl = cortesIdx !== -1 ? getTutSlotEl(owner, locId, cortesIdx) : null;

    // Animate with GSAP if available, else instant
    if (cortesEl && typeof gsap !== 'undefined') {
      var RISE_Y = -14;
      var tl = gsap.timeline({ onComplete: afterDestroy });
      tl.to(cortesEl, { scale: 1.25, y: RISE_Y, duration: 0.25, ease: 'back.out(1.5)' });
      victims.forEach(function (v) {
        var el = getTutSlotEl(owner, locId, v.idx);
        if (el) tl.to(el, { opacity: 0, scale: 0.7, duration: 0.18, ease: 'power2.in' }, '<0.05');
      });
      tl.to(cortesEl, { scale: 1.0, y: 0, duration: 0.22, ease: 'power2.out' });
    } else {
      afterDestroy();
    }

    function afterDestroy() {
      if (cortesEl && typeof gsap !== 'undefined') gsap.set(cortesEl, { clearProps: 'scale,y' });
      var ipGained = 0;
      var samuraiResurrectAt = null; // locId where Samurai should return
      victims.forEach(function (v) {
        // Track destroyed IP for William the Conqueror
        if (owner === 'player') TS.destroyedIPTotal += v.ip;
        sl[locId][v.idx] = null;
        var deadEl = getTutSlotEl(owner, locId, v.idx);
        if (deadEl) {
          if (typeof gsap !== 'undefined') gsap.set(deadEl, { clearProps: 'all' });
          deadEl.className = 'battle-card-slot';
          deadEl.innerHTML = '';
        }
        ipGained++;
        // Samurai Bushido Code: flag for resurrection at this location
        if (v.cardId === 12) samuraiResurrectAt = locId;
      });
      // Give Cortes +1 IP for each card destroyed
      if (cortesIdx !== -1 && sl[locId][cortesIdx]) {
        var cortesSd = sl[locId][cortesIdx];
        cortesSd.ip += ipGained;
        // Compact slots so any gaps fill in after destruction
        compactTutSlotsAt(owner, locId);
        var cEl = getTutSlotEl(owner, locId, sl[locId].indexOf(cortesSd));
        if (cEl) {
          var ipEl = cEl.querySelector('.db-overlay-ip');
          if (ipEl) ipEl.textContent = tEffectiveIP(cortesSd);
          if (typeof Anim !== 'undefined') Anim.floatNumber(cEl, ipGained);
        }
      }
      // William pulse + hand display update
      if (owner === 'player') {
        tUpdateWilliamHand();
        tPulseWilliam();
      }
      // Handle Samurai Bushido Code resurrection
      if (samuraiResurrectAt !== null) {
        tAb_SamuraiResurrect(owner, samuraiResurrectAt, done);
      } else {
        done();
      }
    }
  }

  /* Samurai Bushido Code: resurrect Samurai at the given location with +2 IP. */
  function tAb_SamuraiResurrect(owner, locId, done) {
    var sl = owner === 'player' ? TS.playerSlots : TS.aiSlots;
    var samCard = CARDS.find(function (c) { return c.id === 12; });
    if (!samCard) { done(); return; }
    var si = sl[locId].indexOf(null);
    if (si === -1) { done(); return; } // no room
    sl[locId][si] = { cardId: 12, ip: samCard.ip + 2, revealed: true, contMod: 0 };
    if (typeof SFX !== 'undefined') SFX.samuraiReturn();
    var slotEl = getTutSlotEl(owner, locId, si);
    if (slotEl) {
      slotEl.className = 'battle-card-slot occupied face-up';
      slotEl.innerHTML = '';
      var wrap = document.createElement('div'); wrap.className = 'db-card-img-wrap';
      var ph2  = document.createElement('div'); ph2.className = 'db-card-img-placeholder'; ph2.textContent = samCard.name.charAt(0);
      var img2 = document.createElement('img'); img2.className = 'db-card-img';
      img2.src = 'images/cards/' + samCard.name + '.jpg';
      img2.onerror = function () { this.style.display = 'none'; };
      wrap.appendChild(ph2); wrap.appendChild(img2);
      var cc2 = document.createElement('div'); cc2.className = 'db-overlay-cc'; cc2.textContent = samCard.cc;
      var ip2 = document.createElement('div'); ip2.className = 'db-overlay-ip'; ip2.textContent = samCard.ip + 2;
      slotEl.appendChild(wrap); slotEl.appendChild(cc2); slotEl.appendChild(ip2);
      if (typeof gsap !== 'undefined') {
        gsap.from(slotEl, { scale: 0, opacity: 0, duration: 0.35, ease: 'back.out(2)',
          onComplete: function () { updateScores(); done(); } });
        return;
      }
    }
    updateScores();
    done();
  }

  /* Update William's IP overlay in the player's hand (if present). */
  function tUpdateWilliamHand() {
    var wEl = playerHandEl ? playerHandEl.querySelector('.battle-hand-card[data-id="15"]') : null;
    if (!wEl) {
      // Also check board slots
      wEl = tFindSlotEl('player', 15);
    }
    if (!wEl) return;
    var ipEl = wEl.querySelector('.db-overlay-ip');
    if (!ipEl) return;
    var card = CARDS.find(function (c) { return c.id === 15; });
    if (card) ipEl.textContent = card.ip + TS.destroyedIPTotal;
  }

  function tPulseWilliam() {
    var wEl = playerHandEl ? playerHandEl.querySelector('.battle-hand-card[data-id="15"]') : null;
    if (!wEl) wEl = tFindSlotEl('player', 15);
    if (!wEl) return;
    if (typeof SFX  !== 'undefined') SFX.williamGain();
    if (typeof Anim !== 'undefined') Anim.williamPulse(wEl);
  }

  /* Empress Wu: push (or destroy) the highest-IP Political/Military card here. */
  function tAb_EmpressWu(owner, locId, done) {

    // Find highest-IP Pol/Mil card on the OPPONENT's side at this location (excluding Wu)
    var oppSide = owner === 'player' ? 'opp' : 'player';
    var oppSlots = oppSide === 'player' ? TS.playerSlots : TS.aiSlots;
    var best = null, bestIP = -Infinity, bestOwn = oppSide, bestIdx = -1;
    oppSlots[locId].forEach(function (s, i) {
      if (!s || s.cardId === 4) return;
      var c = CARDS.find(function (c_) { return c_.id === s.cardId; });
      if (!c || (c.type !== 'Political' && c.type !== 'Military')) return;
      var ip = tEffectiveIP(s);
      if (ip > bestIP) { bestIP = ip; best = s; bestIdx = i; }
    });

    // Find Wu's slot element for the "rise" animation
    var wuSl = owner === 'player' ? TS.playerSlots : TS.aiSlots;
    var wuEl = null;
    for (var wi = 0; wi < wuSl[locId].length; wi++) {
      if (wuSl[locId][wi] && wuSl[locId][wi].cardId === 4) {
        wuEl = getTutSlotEl(owner, locId, wi); break;
      }
    }

    if (!best) {
      if (wuEl && typeof gsap !== 'undefined') {
        gsap.timeline({ onComplete: done })
          .to(wuEl, { scale: 1.2, duration: 0.2, ease: 'back.out(2)' })
          .to(wuEl, { scale: 1.0, duration: 0.18, ease: 'power2.out' });
      } else { done(); }
      return;
    }

    var ownerSl = bestOwn === 'player' ? TS.playerSlots : TS.aiSlots;
    var pushed = false;
    var destLocId = null, destFi = -1;

    // Find an adjacent location with a free slot
    for (var li = 0; li < T_LOCS.length; li++) {
      if (T_LOCS[li].id === locId) continue;
      var destSl = ownerSl[T_LOCS[li].id];
      var fi = destSl.indexOf(null);
      if (fi === -1) continue;
      destLocId = T_LOCS[li].id;
      destFi    = fi;
      pushed    = true;
      break;
    }

    function executeMove() {
      if (typeof SFX !== 'undefined') SFX.wuPunch();
      if (pushed) {
        ownerSl[destLocId][destFi] = best;
        ownerSl[locId][bestIdx]    = null;
        // Compact source location
        compactTutSlotsAt(bestOwn, locId);
        // Render card at destination
        var toEl = getTutSlotEl(bestOwn, destLocId, destFi);
        if (toEl) {
          var movedCard = CARDS.find(function (c_) { return c_.id === best.cardId; });
          toEl.className = 'battle-card-slot occupied face-up';
          if (movedCard) {
            var wrap = document.createElement('div'); wrap.className = 'db-card-img-wrap';
            var ph = document.createElement('div'); ph.className = 'db-card-img-placeholder'; ph.textContent = movedCard.name.charAt(0);
            var img = document.createElement('img'); img.className = 'db-card-img';
            img.src = 'images/cards/' + movedCard.name + '.jpg';
            img.onerror = function () { this.style.display = 'none'; };
            wrap.appendChild(ph); wrap.appendChild(img);
            var ccEl = document.createElement('div'); ccEl.className = 'db-overlay-cc'; ccEl.textContent = movedCard.cc;
            var ipEl2 = document.createElement('div'); ipEl2.className = 'db-overlay-ip'; ipEl2.textContent = tEffectiveIP(best);
            toEl.appendChild(wrap); toEl.appendChild(ccEl); toEl.appendChild(ipEl2);
          }
        }
        updateScores();
        done();
      } else {
        // No room elsewhere — destroy the card
        if (typeof SFX !== 'undefined') SFX.cardDestroyed();
        var isSamurai = (best.cardId === 12);
        if (bestOwn === 'player') TS.destroyedIPTotal += bestIP;
        ownerSl[locId][bestIdx] = null;
        var deadEl2 = getTutSlotEl(bestOwn, locId, bestIdx);
        if (deadEl2) {
          if (typeof gsap !== 'undefined') gsap.set(deadEl2, { clearProps: 'all' });
          deadEl2.className = 'battle-card-slot'; deadEl2.innerHTML = '';
        }
        compactTutSlotsAt(bestOwn, locId);
        if (bestOwn === 'player') { tUpdateWilliamHand(); tPulseWilliam(); }
        if (isSamurai) {
          tAb_SamuraiResurrect(bestOwn, locId, done);
        } else {
          updateScores();
          done();
        }
      }
    }

    // Wu rise animation → then execute the push/destroy
    if (wuEl && typeof gsap !== 'undefined') {
      gsap.timeline({ onComplete: executeMove })
        .to(wuEl, { scale: 1.2, y: -10, duration: 0.22, ease: 'back.out(2)' })
        .to(wuEl, { scale: 1.0, y: 0,   duration: 0.2,  ease: 'power2.out' });
    } else {
      executeMove();
    }
  }

  function updateScores() {
    T_LOCS.forEach(function (loc) {
      var ps = 0, as = 0;
      TS.playerSlots[loc.id].forEach(function (sd) { if (sd && sd.revealed) ps += tEffectiveIP(sd); });
      TS.aiSlots[loc.id].forEach(function (sd)     { if (sd && sd.revealed) as += tEffectiveIP(sd); });
      var pEl = document.getElementById('loc-score-player-' + loc.id);
      var aEl = document.getElementById('loc-score-opp-'    + loc.id);
      if (pEl) pEl.textContent = ps;
      if (aEl) aEl.textContent = as;
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     HAND RENDERING
  ═══════════════════════════════════════════════════════════════ */

  function renderHand(cardIds) {
    playerHandEl.innerHTML = '';
    cardIds.forEach(function (id) {
      var card = CARDS.find(function (c) { return c.id === id; });
      if (!card) return;
      var ipBonus = (id === 15) ? TS.destroyedIPTotal : 0;
      var el = buildHandCard(card, ipBonus);
      // Pulsing glow only on T3 ability-discovery cards, not on cards added in later turns
      if (TS.abilityCardsToTap.indexOf(id) !== -1 && !TS.abilityCardsTapped[id]) {
        el.classList.add('tut-ability-glow');
      }
      addTutDrag(el, id);
      playerHandEl.appendChild(el);
    });
    var sep = document.createElement('div');
    sep.className = 'battle-hand-sep';
    playerHandEl.appendChild(sep);
    var pileCount = Math.max(0, TUT_DRAW_QUEUE.length - TS.tutTotalDrawn);
    playerHandEl.appendChild(buildDeckPile(pileCount));
  }

  function buildHandCard(card, ipBonus) {
    var el = document.createElement('div');
    el.className  = 'battle-hand-card';
    el.dataset.id = card.id;
    var wrap = document.createElement('div');
    wrap.className = 'db-card-img-wrap';
    var ph = document.createElement('div');
    ph.className   = 'db-card-img-placeholder';
    ph.textContent = card.name.charAt(0);
    var img = document.createElement('img');
    img.className = 'db-card-img';
    img.src       = 'images/cards/' + card.name + '.jpg';
    img.onerror   = function () { this.style.display = 'none'; };
    wrap.appendChild(ph);
    wrap.appendChild(img);
    var cc = document.createElement('div');
    cc.className   = 'db-overlay-cc';
    cc.textContent = card.cc;
    var ip = document.createElement('div');
    ip.className   = 'db-overlay-ip';
    ip.textContent = card.ip + (ipBonus || 0);
    el.appendChild(wrap);
    el.appendChild(cc);
    el.appendChild(ip);

    // GSAP hover — same as regular hand cards
    if (typeof gsap !== 'undefined') {
      el.addEventListener('mouseenter', function () {
        if (el.classList.contains('selected')) return;
        gsap.killTweensOf(el);
        gsap.set(el, { zIndex: 100 });
        gsap.to(el, { scale: 1.35, duration: 0.14, ease: 'power2.out' });
      });
      el.addEventListener('mouseleave', function () {
        gsap.killTweensOf(el);
        gsap.to(el, {
          scale: 1, duration: 0.22, ease: 'power2.inOut',
          onComplete: function () { gsap.set(el, { zIndex: 1 }); }
        });
      });
    }

    return el;
  }

  function buildDeckPile(count) {
    var pile = document.createElement('div');
    pile.className = 'battle-deck-pile';
    var lbl = document.createElement('div');
    lbl.className   = 'battle-deck-label';
    lbl.textContent = 'DECK';
    var cnt = document.createElement('div');
    cnt.className   = 'battle-deck-count';
    cnt.textContent = count;
    pile.appendChild(lbl);
    pile.appendChild(cnt);
    return pile;
  }

  /* ═══════════════════════════════════════════════════════════════
     DRAG-TO-PLAY SYSTEM
  ═══════════════════════════════════════════════════════════════ */

  /* Returns true when this hand card may be dragged given the current step. */
  function canDrag(cardId) {
    if (!TS.awaitAction) return false;
    if (TS.awaitAction === 'citizens_rift') return cardId === 1;
    if (TS.awaitAction === 'free_end_turn') return true;
    if (TS.awaitAction === 'magellan_play') {
      // Only Magellan or 1-CC cards allowed in this phase
      var c = CARDS.find(function (c_) { return c_.id === cardId; });
      return cardId === 24 || (c && c.cc === 1);
    }
    return false;
  }

  /* Returns true when tutDragCardId may be dropped at locId. */
  function validLocForCard(cardId, locId) {
    if (!TS.playerSlots[locId]) return false;
    if (TS.playerSlots[locId].indexOf(null) === -1) return false;
    var card = CARDS.find(function (c) { return c.id === cardId; });
    if (!card || card.cc > TS.capital) return false;
    if (TS.awaitAction === 'citizens_rift') return locId === 2 && cardId === 1;
    if (TS.awaitAction === 'free_end_turn') {
      if (TS.turn === 1) return locId === 2;
      return true;
    }
    if (TS.awaitAction === 'magellan_play') return true;
    return false;
  }

  /* Make a hand card draggable; gates on canDrag.
     Click opens the info popup; in T3 ability_clicks phase it tracks taps. */
  function addTutDrag(cardEl, cardId) {
    cardEl.draggable = true;

    cardEl.addEventListener('click', function (e) {
      e.stopPropagation();
      if (tutDragCardId !== null) return;

      var card = CARDS.find(function (c) { return c.id === cardId; });
      if (!card || typeof window.openBattlePopup !== 'function') return;

      // Ability-click gating (T3)
      if (TS.awaitAction === 'ability_clicks' && card.ability) {
        if (!TS.abilityCardsTapped[cardId]) {
          TS.abilityCardsTapped[cardId] = true;
          cardEl.classList.remove('tut-ability-glow');
        }
        var sd2 = { cardId: cardId, ip: card.ip, ipMod: 0, ipModSources: [], contMod: 0, revealed: true };
        window.openBattlePopup(card, sd2, 'player', false);
        // Wait until popup is closed before checking if all abilities are viewed
        waitForPopupClose(function () { checkAllAbilitiesClicked(); });
        return;
      }

      // Normal popup (suppress ability in T1/T2)
      var displayCard = TS.abilitiesActive
        ? card
        : { name: card.name, cc: card.cc, ip: card.ip, type: card.type, ability: null, abilityName: null };
      var sd = { cardId: cardId, ip: card.ip, ipMod: 0, ipModSources: [], contMod: 0, revealed: true };
      window.openBattlePopup(displayCard, sd, 'player', false);
    });

    cardEl.addEventListener('dragstart', function (e) {
      if (!canDrag(cardId)) { e.preventDefault(); return; }
      tutDragCardId = cardId;
      e.dataTransfer.effectAllowed = 'move';
      cardEl.classList.add('dragging');
      T_LOCS.forEach(function (loc) {
        if (!validLocForCard(cardId, loc.id)) return;
        var si = TS.playerSlots[loc.id].indexOf(null);
        if (si === -1) return;
        var sl = getTutSlotEl('player', loc.id, si);
        if (sl) sl.classList.add('tut-valid-slot');
      });
    });

    cardEl.addEventListener('dragend', function () {
      cardEl.classList.remove('dragging');
      tutDragCardId = null;
      clearDragHighlights();
    });
  }

  /* Clear all drag-related highlights from the board. */
  function clearDragHighlights() {
    document.querySelectorAll('.tut-valid-slot').forEach(function (el) {
      el.classList.remove('tut-valid-slot');
    });
    document.querySelectorAll('.drag-over').forEach(function (el) {
      el.classList.remove('drag-over');
    });
  }

  /* Kept for teardown compatibility. */
  function clearSelection() {
    tutDragCardId = null;
    clearDragHighlights();
  }

  /* Board-level drag handlers — registered once in initDOMRefs. */
  function initBoardDrag() {

    // Dragstart on board cards (Magellan board-move)
    boardEl.addEventListener('dragstart', function (e) {
      if (!TS.active) return;
      if (TS.awaitAction !== 'magellan_board_move' && TS.awaitAction !== 'free_end_turn') return;
      var slotEl = e.target.closest('.battle-card-slot.tut-moveable[data-owner="player"]');
      if (!slotEl) return;
      tutBoardDragCardId    = 24; // always Magellan in this tutorial
      tutBoardDragFromLocId = parseInt(slotEl.dataset.boardDragLocId || '0', 10);
      tutBoardDragFromSi    = parseInt(slotEl.dataset.boardDragSi    || '0', 10);
      e.dataTransfer.effectAllowed = 'move';
      slotEl.classList.add('dragging');
      // Highlight valid destinations
      T_LOCS.forEach(function (loc) {
        if (loc.id === tutBoardDragFromLocId) return;
        var destEl = getFirstAvailableSlotEl('player', loc.id);
        if (destEl) destEl.classList.add('tut-valid-slot');
      });
    });

    boardEl.addEventListener('dragover', function (e) {
      if (!TS.active) return;

      // Board-card move in progress
      if (tutBoardDragFromLocId !== null) {
        var slotEl2 = e.target.closest('.battle-card-slot[data-owner="player"]');
        if (!slotEl2) return;
        var locId2 = parseInt(slotEl2.dataset.locId, 10);
        if (locId2 === tutBoardDragFromLocId) return;
        if (!TS.playerSlots[locId2] || TS.playerSlots[locId2].indexOf(null) === -1) return;
        e.preventDefault();
        document.querySelectorAll('.drag-over').forEach(function (el) { el.classList.remove('drag-over'); });
        var firstEmpty2 = getFirstAvailableSlotEl('player', locId2);
        if (firstEmpty2) firstEmpty2.classList.add('drag-over');
        return;
      }

      // Hand-card drag in progress
      if (tutDragCardId === null) return;
      var slotEl = e.target.closest('.battle-card-slot[data-owner="player"]');
      if (!slotEl) { clearDragHighlights(); return; }
      var locId = parseInt(slotEl.dataset.locId, 10);
      if (!validLocForCard(tutDragCardId, locId)) { clearDragHighlights(); return; }
      e.preventDefault();
      document.querySelectorAll('.drag-over').forEach(function (el) { el.classList.remove('drag-over'); });
      var firstEmpty = getFirstAvailableSlotEl('player', locId);
      if (firstEmpty) firstEmpty.classList.add('drag-over');
    });

    boardEl.addEventListener('dragleave', function (e) {
      var s = e.target.closest('.battle-card-slot');
      if (s) s.classList.remove('drag-over');
    });

    boardEl.addEventListener('drop', function (e) {
      e.preventDefault();
      var slotEl = e.target.closest('.battle-card-slot[data-owner="player"]');
      if (!slotEl) return;
      slotEl.classList.remove('drag-over');
      var locId = parseInt(slotEl.dataset.locId, 10);

      // Board-card drop (Magellan move)
      if (tutBoardDragFromLocId !== null) {
        var fromLocId = tutBoardDragFromLocId;
        var fromSi    = tutBoardDragFromSi;
        tutBoardDragCardId    = null;
        tutBoardDragFromLocId = null;
        tutBoardDragFromSi    = null;
        document.querySelectorAll('.tut-moveable.dragging').forEach(function (el) {
          el.classList.remove('dragging');
        });
        clearDragHighlights();
        if (locId === fromLocId) return;
        if (!TS.playerSlots[locId] || TS.playerSlots[locId].indexOf(null) === -1) return;
        var moved = moveBoardCard(fromLocId, fromSi, locId);
        if (moved && TS.awaitAction === 'magellan_board_move') {
          onMagellanMoved();
        }
        return;
      }

      // Hand-card drop
      if (tutDragCardId === null) return;
      if (!validLocForCard(tutDragCardId, locId)) return;

      var cardId = tutDragCardId;
      var action = TS.awaitAction;
      tutDragCardId = null;
      clearDragHighlights();

      var ok = playCard(cardId, locId);
      if (!ok) return;

      if (action === 'citizens_rift') {
        onCitizensPlaced();
      } else if (action === 'magellan_play' && cardId === 24) {
        // Magellan played — unlock free turn
        hideEl(lucyBubbleEl);
        step_freeTurn(onT3EndTurn);
      }
      // 'free_end_turn': player continues freely
    });

    // Dragend on board (cleanup if Magellan drag is aborted mid-air)
    boardEl.addEventListener('dragend', function () {
      if (tutBoardDragFromLocId !== null) {
        document.querySelectorAll('.tut-moveable.dragging').forEach(function (el) {
          el.classList.remove('dragging');
        });
        tutBoardDragCardId    = null;
        tutBoardDragFromLocId = null;
        tutBoardDragFromSi    = null;
        clearDragHighlights();
      }
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     DIALOGUE SYSTEM
  ═══════════════════════════════════════════════════════════════ */

  var TYPE_SPEED = 28; // ms per character

  function queueDialogues(texts, onAllDone) {
    TS.dialogQueue  = texts.slice(1);
    TS.dialogOnDone = onAllDone || null;
    typeText(texts[0]);
  }

  function showDialogue(text, onDone) {
    TS.dialogQueue  = [];
    TS.dialogOnDone = onDone || null;
    typeText(text);
  }

  function typeText(text) {
    if (TS.typeTimer) { clearInterval(TS.typeTimer); TS.typeTimer = null; }
    TS.fullText = text;
    TS.typedLen = 0;
    TS.typing   = true;
    _blipCount  = 0;
    var activeTextEl = TS.useBubbles ? lucyBubbleTextEl : textEl;
    activeTextEl.textContent = '';
    updateHint();

    var lucyAvEl = document.querySelector('.battle-avatar-lucy');
    if (lucyAvEl) lucyAvEl.classList.add('tut-speaking');

    TS.typeTimer = setInterval(function () {
      TS.typedLen++;
      activeTextEl.textContent = TS.fullText.slice(0, TS.typedLen);
      playBlip();
      if (TS.typedLen >= TS.fullText.length) {
        clearInterval(TS.typeTimer);
        TS.typeTimer = null;
        TS.typing = false;
        updateHint();
        if (lucyAvEl) lucyAvEl.classList.remove('tut-speaking');
      }
    }, TYPE_SPEED);
  }

  function advanceDialogue() {
    if (TS.typing) {
      clearInterval(TS.typeTimer);
      TS.typeTimer = null;
      TS.typing = false;
      var activeTextEl = TS.useBubbles ? lucyBubbleTextEl : textEl;
      activeTextEl.textContent = TS.fullText;
      updateHint();
      var lucyAvEl = document.querySelector('.battle-avatar-lucy');
      if (lucyAvEl) lucyAvEl.classList.remove('tut-speaking');
      return;
    }
    if (TS.awaitAction) return; // player must act

    if (TS.dialogQueue.length > 0) {
      typeText(TS.dialogQueue.shift());
    } else if (TS.dialogOnDone) {
      var cb = TS.dialogOnDone;
      TS.dialogOnDone = null;
      cb();
    }
  }

  function updateHint() {
    var actionHints = {
      'citizens_rift':       'DRAG CITIZENS TO THE GREAT RIFT VALLEY',
      'free_end_turn':       'CLICK END TURN WHEN READY',
      'ability_clicks':      'CLICK EACH GLOWING CARD TO VIEW ITS ABILITY',
      'magellan_play':       'PLAY MAGELLAN — DRAG HIM TO A LOCATION',
      'magellan_board_move': 'DRAG MAGELLAN TO A NEW LOCATION'
    };
    var activeHintEl = TS.useBubbles ? lucyBubbleHintEl : hintEl;
    if (!activeHintEl) return;
    if (TS.awaitAction && actionHints[TS.awaitAction]) {
      activeHintEl.textContent = actionHints[TS.awaitAction];
      activeHintEl.classList.add('tut-hint-action');
    } else if (TS.typing) {
      activeHintEl.textContent = '\u25b6 Click to skip';
      activeHintEl.classList.remove('tut-hint-action');
    } else {
      activeHintEl.textContent = '\u25b6 Click to continue';
      activeHintEl.classList.remove('tut-hint-action');
    }
    updateOverlay();
  }

  /* Activate the full-screen click overlay only when dialogue is waiting
     for a click-to-continue and no board interaction is required.       */
  function updateOverlay() {
    if (!clickOverlayEl) return;
    var active = TS.active && !TS.awaitAction;
    clickOverlayEl.style.pointerEvents = active ? 'auto' : 'none';
  }

  /* ═══════════════════════════════════════════════════════════════
     ÖTZI DIALOGUE SYSTEM
  ═══════════════════════════════════════════════════════════════ */

  function showOtziLine(text, onDone) {
    if (!otziBoxEl) { if (onDone) onDone(); return; }
    _otziOnDone   = onDone || null;
    _otziFullText = text;
    _otziTyping   = true;
    _blipCount    = 0;
    otziTextEl.textContent = '';
    showEl(otziBoxEl);
    updateOverlay(); // activate click-anywhere while Otzi is speaking
    var idx = 0;
    if (_otziTypeTimer) clearInterval(_otziTypeTimer);
    _otziTypeTimer = setInterval(function () {
      idx++;
      otziTextEl.textContent = _otziFullText.slice(0, idx);
      playOtziBlip();
      if (idx >= _otziFullText.length) {
        clearInterval(_otziTypeTimer);
        _otziTypeTimer = null;
        _otziTyping = false;
      }
    }, 28);
  }

  function advanceOtzi() {
    if (_otziTyping) {
      if (_otziTypeTimer) { clearInterval(_otziTypeTimer); _otziTypeTimer = null; }
      _otziTyping = false;
      otziTextEl.textContent = _otziFullText;
      return;
    }
    hideEl(otziBoxEl);
    updateOverlay(); // deactivate (or let Lucy re-activate via typeText → updateHint)
    var cb = _otziOnDone;
    _otziOnDone = null;
    if (cb) cb();
  }

  /* ═══════════════════════════════════════════════════════════════
     HIGHLIGHT / LOCK / DIM
  ═══════════════════════════════════════════════════════════════ */

  function lit(el)   { if (el) el.classList.add('tut-lit'); }
  function unlit(el) { if (el) el.classList.remove('tut-lit'); }

  function showTutRevealHighlight(playerFirst) {
    var lucyAv = document.querySelector('.battle-avatar-lucy');
    var otziAv = document.querySelector('.battle-avatar-otzi');
    if (lucyAv) lucyAv.classList.toggle('reveal-first', !!playerFirst);
    if (otziAv) otziAv.classList.toggle('reveal-first', !playerFirst);
  }

  function hideTutRevealHighlight() {
    document.querySelectorAll('.battle-avatar.reveal-first').forEach(function (el) {
      el.classList.remove('reveal-first');
    });
  }

  function setLocked(on) {
    document.body.classList.toggle('tut-locked', on);
  }

  /* ── Number highlight ─────────────────────────────────────────── */
  /*
   * Places a pulsing gold box exactly over the CC (top-left) or IP
   * (top-right) overlay element on the given card.  Uses a fixed-
   * positioned div that is repositioned by a rAF loop so it tracks
   * the card even if layout shifts (scroll, resize).
   */
  function pinNumHighlight(cardEl, which) {
    removeNumHighlight(); // clear any existing one

    var overlayEl = cardEl.querySelector(
      which === 'cc' ? '.db-overlay-cc' : '.db-overlay-ip'
    );
    if (!overlayEl) return;

    var el = document.createElement('div');
    el.className = 'tut-num-highlight';
    document.body.appendChild(el);
    numHighlightEl = el;

    var animId;
    function track() {
      if (!numHighlightEl) return; // removed
      var r = overlayEl.getBoundingClientRect();
      el.style.left   = r.left + 'px';
      el.style.top    = r.top  + 'px';
      el.style.width  = r.width  + 'px';
      el.style.height = r.height + 'px';
      animId = requestAnimationFrame(track);
    }
    track();
    numHighlightEl._animId = animId;
  }

  function removeNumHighlight() {
    if (!numHighlightEl) return;
    if (numHighlightEl._animId) cancelAnimationFrame(numHighlightEl._animId);
    numHighlightEl.remove();
    numHighlightEl = null;
  }

  /* ═══════════════════════════════════════════════════════════════
     HEADER / CAPITAL HELPERS
  ═══════════════════════════════════════════════════════════════ */

  function setHeader(turn, phase, capital) {
    var ti = document.getElementById('battle-turn-info');
    var pi = document.getElementById('battle-phase-info');
    if (ti) ti.textContent = 'TURN ' + turn + ' / 5';
    if (pi) pi.textContent = phase;
    setCapital(capital);
  }

  function setCapital(n) {
    TS.capital = n;
    if (!capitalNumEl) capitalNumEl = document.getElementById('battle-capital-num');
    if (capitalNumEl) capitalNumEl.textContent = n;
  }

  /* ═══════════════════════════════════════════════════════════════
     DOM QUERY HELPERS
  ═══════════════════════════════════════════════════════════════ */

  function getHandCardEl(cardId) {
    return playerHandEl.querySelector('.battle-hand-card[data-id="' + cardId + '"]');
  }

  /* Find a slot element by owner and cardId (scans all locations). */
  function tFindSlotEl(owner, cardId) {
    var sl = owner === 'player' ? TS.playerSlots : TS.aiSlots;
    for (var li = 0; li < T_LOCS.length; li++) {
      var locId = T_LOCS[li].id;
      for (var i = 0; i < (sl[locId] || []).length; i++) {
        if (sl[locId][i] && sl[locId][i].cardId === cardId)
          return getTutSlotEl(owner, locId, i);
      }
    }
    return null;
  }

  function getTutSlotEl(owner, locId, si) {
    return boardEl.querySelector(
      '.battle-card-slot[data-owner="' + owner + '"]' +
      '[data-loc-id="' + locId + '"]' +
      '[data-slot-index="' + si + '"]'
    );
  }

  function getPlayerSlotsFor(locId) {
    return Array.from(boardEl.querySelectorAll(
      '.battle-card-slot[data-owner="player"][data-loc-id="' + locId + '"]'
    ));
  }

  function getFirstAvailableSlotEl(owner, locId) {
    var slots = owner === 'player' ? TS.playerSlots[locId] : TS.aiSlots[locId];
    if (!slots) return null;
    var si = slots.indexOf(null);
    if (si === -1) return null;
    return getTutSlotEl(owner, locId, si);
  }

  function showEl(el) { if (el) el.style.display = ''; }
  function hideEl(el) { if (el) el.style.display = 'none'; }

  /* ═══════════════════════════════════════════════════════════════
     FREE PLAY TURN
  ═══════════════════════════════════════════════════════════════ */

  function step_freeTurn(onEndTurn) {
    var popupEl = document.getElementById('battle-popup-backdrop');
    if (popupEl) popupEl.classList.remove('visible');
    endTurnBtnEl.disabled = false;
    lit(endTurnBtnEl);
    TS.awaitAction = 'free_end_turn';
    TS.freeEndCb   = onEndTurn;
    setLocked(false);
    renderHand(TS.playerHand);
    // If Magellan is already on the board, make it draggable each free turn
    var magPos = findPlayerCard(24);
    if (magPos) makeBoardCardMoveable(magPos.locId, magPos.si);
    updateHint();
  }

  function onFreeEndTurn() {
    cancelInactivityTimer();
    clearSelection();
    document.querySelectorAll('.tut-moveable').forEach(function (el) {
      el.classList.remove('tut-moveable');
      el.removeAttribute('draggable');
    });
    unlit(endTurnBtnEl);
    endTurnBtnEl.disabled = true;
    var cb = TS.freeEndCb;
    TS.freeEndCb   = null;
    TS.awaitAction = null;
    if (cb) cb();
  }

  /* Placeholder for old end_turn action (kept for initDOMRefs handler reference) */
  function onEndTurnClicked() {
    onFreeEndTurn();
  }

  /* ═══════════════════════════════════════════════════════════════
     EXIT / COMPLETE
  ═══════════════════════════════════════════════════════════════ */

  function exitTutorial() {
    localStorage.setItem('sog_tutorial_complete', 'true');
    teardown();
    showScreen('screen-deckbuilder');
    if (typeof window.initDeckBuilder === 'function') window.initDeckBuilder();
  }

  function finishTutorial() {
    exitTutorial();
  }

  function teardown() {
    clearSelection();
    removeNumHighlight();
    cancelInactivityTimer();
    TS.active             = false;
    TS.useBubbles         = false;
    window.tutorialActive = false;
    if (TS.typeTimer) { clearInterval(TS.typeTimer); TS.typeTimer = null; }
    setLocked(false);
    hideEl(boxEl);
    hideEl(lucyBubbleEl);
    hideEl(skipEl);
    hideEl(dimEl);
    hideEl(endEl);
    document.body.classList.remove('tut-locked');
    document.querySelectorAll('.tut-lit').forEach(function (el) {
      el.classList.remove('tut-lit');
    });
    document.querySelectorAll('.tut-valid-slot').forEach(function (el) {
      el.classList.remove('tut-valid-slot');
    });
    document.querySelectorAll('.tut-ability-glow').forEach(function (el) {
      el.classList.remove('tut-ability-glow');
    });
    document.querySelectorAll('.tut-moveable').forEach(function (el) {
      el.classList.remove('tut-moveable');
      el.removeAttribute('draggable');
    });
    document.querySelectorAll('.tut-loc-glow').forEach(function (el) {
      el.classList.remove('tut-loc-glow');
    });
    // Clean up Otzi box
    if (otziBoxEl) hideEl(otziBoxEl);
    if (_otziTypeTimer) { clearInterval(_otziTypeTimer); _otziTypeTimer = null; }
    // Remove tut-ability-hidden classes
    document.querySelectorAll('.tut-ability-hidden').forEach(function (el) {
      el.classList.remove('tut-ability-hidden');
    });
    // Deactivate click overlay
    if (clickOverlayEl) clickOverlayEl.style.pointerEvents = 'none';
    // Clean up board drag state
    tutBoardDragCardId    = null;
    tutBoardDragFromLocId = null;
    tutBoardDragFromSi    = null;
    // Restore music player
    var _musicCtrl = document.getElementById('battle-music-ctrl');
    if (_musicCtrl) _musicCtrl.style.display = '';
  }

  /* ── Exports ─────────────────────────────────────────────────── */
  window.startHomeIntro    = startHomeIntro;
  window.showMatchupScreen = showMatchupScreen;
  window.startTutorial     = startTutorial;

}());
