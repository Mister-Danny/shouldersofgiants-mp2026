/**
 * tutorial.js — Shoulders of Giants · Interactive Tutorial
 *
 * Guided 5-turn game narrated by Lucy (a 3.2-million-year-old hominid).
 * Uses fixed locations + scripted AI; does NOT invoke game.js logic.
 *
 * Card placement uses click-to-select then click-to-place (no drag).
 *
 * Exposes: window.startTutorial()
 * Guards:  window.tutorialActive  (checked by game.js to suppress its handlers)
 */
(function () {
  'use strict';

  /* ── Fixed tutorial locations ─────────────────────────────────
     Left = Great Rift Valley  (id 2)
     Mid  = The Levant          (id 4)
     Right= Timbuktu            (id 5)                           */
  var LOC_RIFT = LOCATIONS.find(function (l) { return l.id === 2; });
  var LOC_LEV  = LOCATIONS.find(function (l) { return l.id === 4; });
  var LOC_TIMB = LOCATIONS.find(function (l) { return l.id === 5; });
  var T_LOCS   = [LOC_RIFT, LOC_LEV, LOC_TIMB];

  /* ── Scripted AI plays per turn: [{l: locId, c: cardId}] ───── */
  var AI_SCRIPT = {
    1: [{ l: 2, c: 6  }, { l: 4, c: 16 }, { l: 5, c: 11 }],
    2: [{ l: 4, c: 21 }],
    3: [{ l: 2, c: 1  }],
    4: [{ l: 5, c: 6  }],
    5: [{ l: 4, c: 11 }]
  };

  /* ── Tutorial state ─────────────────────────────────────────── */
  var TS = {
    active:          false,
    turn:            1,
    capital:         5,
    playerHand:      [],
    playerSlots:     {},
    aiSlots:         {},
    // Dialogue
    dialogQueue:     [],
    dialogOnDone:    null,
    typing:          false,
    fullText:        '',
    typedLen:        0,
    typeTimer:       null,
    // Interaction gating
    awaitAction:     null,   // 'citizens_rift'|'two_more'|'end_turn'|'zhenghe_play'|'scholar_play'|'free_end_turn'
    freeEndCb:       null,   // callback after free-turn End Turn
    t5Count:         0,      // cards placed during step_playTwoMore
    t5Locs:          {},     // locIds already used in that step
    bonusCapital:    0       // extra capital granted by Scholar-Officials for next turn
  };

  /* ── DOM refs (assigned in init) ─────────────────────────────── */
  var boxEl, textEl, hintEl, dimEl, skipEl, endEl;
  var playerHandEl, boardEl, endTurnBtnEl, capitalNumEl;
  var numHighlightEl = null; // floating element that pulses over a number overlay
  var tutDragCardId  = null; // card being dragged (null when no drag in progress)

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

  /* ═══════════════════════════════════════════════════════════════
     PUBLIC ENTRY POINT
  ═══════════════════════════════════════════════════════════════ */

  function startTutorial() {
    if (!boxEl) initDOMRefs();

    window.tutorialActive = true;

    // Reset state
    TS.active          = true;
    TS.turn            = 1;
    TS.capital         = 5;
    TS.playerHand      = [1, 6, 11, 16, 21]; // Citizens Priests Knight Griots Nomad
    TS.playerSlots     = emptySlotMap();
    TS.aiSlots         = emptySlotMap();
    TS.awaitAction     = null;
    TS.freeEndCb       = null;
    TS.t5Count         = 0;
    TS.t5Locs          = {};
    TS.bonusCapital    = 0;

    showEl(skipEl);

    // Show first dialogue on the HOME screen, then transition to the battle board
    showEl(boxEl);
    queueDialogues([
      "Well hello there! I\u2019m Lucy. I\u2019ve been around for about 3.2 million years, so trust me when I say I know a thing or two about history. Let me show you how this game works."
    ], function () {
      transitionToBattle();
    });
  }

  /* Play tutorialtransition.m4a + white flash, then switch to the battle screen */
  function transitionToBattle() {
    // Sound
    var snd = new Howl({ src: ['sfx/tutorialtransition.m4a'], volume: 1.0, html5: true });
    snd.play();

    // White flash overlay
    var flash = document.createElement('div');
    flash.style.cssText = 'position:fixed;inset:0;background:#fff;opacity:0;z-index:9999;pointer-events:none;';
    document.body.appendChild(flash);

    if (typeof gsap !== 'undefined') {
      gsap.to(flash, { opacity: 1, duration: 0.25, ease: 'power1.in', onComplete: function () {
        setupBattle();
        gsap.to(flash, { opacity: 0, duration: 0.45, delay: 0.08, ease: 'power1.out', onComplete: function () {
          document.body.removeChild(flash);
        }});
      }});
    } else {
      // Fallback: no animation
      document.body.removeChild(flash);
      setupBattle();
    }
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

    // Click tut-box or spacebar → advance dialogue
    boxEl.addEventListener('click', function () { advanceDialogue(); });
    document.addEventListener('keydown', function (e) {
      if (!TS.active) return;
      if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); advanceDialogue(); }
    });

    // Tutorial End Turn button (must precede game.js listener; game.js is guarded)
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
  }

  /* ═══════════════════════════════════════════════════════════════
     STEP MACHINE
  ═══════════════════════════════════════════════════════════════ */

  function setupBattle() {
    showScreen('screen-battle');
    window.initBattleUI(T_LOCS);
    renderHand(TS.playerHand);
    setHeader(1, 'SELECT CARDS', 5);

    endTurnBtnEl.disabled = true;
    document.getElementById('battle-reset-turn').disabled = true;
    document.getElementById('btn-back-results').style.display = 'none';

    capitalNumEl = document.getElementById('battle-capital-num');

    // Box is already visible from the home-screen dialogue; continue with second line
    queueDialogues([
      "Your goal is simple \u2014 win 2 out of 3 locations by having more Influence Points there than your opponent when the game ends. Easy right? \u2026Don\u2019t worry, it gets trickier."
    ], function () { step_handIntro(); });
  }

  /* Step 1 — Hand intro: two-part with number highlights */
  function step_handIntro() {
    var cardEl = getHandCardEl(1); // Citizens
    lit(cardEl);

    // First box: Capital Cost (top-left number)
    pinNumHighlight(cardEl, 'cc');
    queueDialogues([
      "See that number in the top left corner of your card? That\u2019s the Capital Cost \u2014 how much it costs to play. Spend wisely, you only get 5 Capital per turn!"
    ], function () {
      // Second box: Influence Points (top-right number)
      pinNumHighlight(cardEl, 'ip');
      queueDialogues([
        "And that number in the top right corner? Those are Influence Points \u2014 the power your card brings to a location. More IP means more control!"
      ], function () {
        removeNumHighlight();
        unlit(cardEl);
        step_capitalIntro();
      });
    });
  }

  /* Step 2 — Capital */
  function step_capitalIntro() {
    var el = document.getElementById('battle-capital-info');
    lit(el);
    queueDialogues([
      "You get 5 Capital to spend each turn. See it up there in the corner? That\u2019s your budget. Spend it wisely \u2014 any leftover Capital disappears at the end of the turn. Painful, I know."
    ], function () {
      unlit(el);
      step_playCitizens();
    });
  }

  /* Step 3 — Place Citizens at Rift Valley */
  function step_playCitizens() {
    lit(getHandCardEl(1));
    var firstSlot = getFirstAvailableSlotEl('player', 2);
    if (firstSlot) lit(firstSlot);

    TS.awaitAction = 'citizens_rift';
    setLocked(true);
    showDialogue("Drag your Citizens card to The Great Rift Valley slot. Go on, I\u2019ll wait.", null);
  }

  function onCitizensPlaced() {
    TS.awaitAction = null;
    setLocked(false);
    getPlayerSlotsFor(2).forEach(unlit);
    queueDialogues([
      "Nice! You just spent 1 Capital and committed Citizens to that location. See your Capital drop to 4? Every card you play costs Capital."
    ], function () { step_playTwoMore(); });
  }

  /* Step 4 — Play two more cards */
  function step_playTwoMore() {
    TS.t5Count = 0;
    TS.t5Locs  = {};
    TS.awaitAction = 'two_more';
    setLocked(true);

    TS.playerHand.forEach(function (id) { lit(getHandCardEl(id)); });
    var slotLev  = getFirstAvailableSlotEl('player', 4);
    var slotTimb = getFirstAvailableSlotEl('player', 5);
    if (slotLev)  lit(slotLev);
    if (slotTimb) lit(slotTimb);

    showDialogue(
      "You still have 4 Capital left. Drag any card to the middle or right location slot. Do that twice \u2014 one card per location.",
      null
    );
  }

  function onTwoMorePlaced(locId) {
    TS.t5Count++;
    TS.t5Locs[locId] = true;
    getPlayerSlotsFor(locId).forEach(unlit);

    if (TS.t5Count >= 2 && Object.keys(TS.t5Locs).length >= 2) {
      TS.awaitAction = null;
      setLocked(false);
      TS.playerHand.forEach(function (id) { var el = getHandCardEl(id); if (el) unlit(el); });
      queueDialogues([
        "Great! You\u2019ve got cards at all three locations. Now let\u2019s see what happens next."
      ], function () { step_endTurn(); });
    } else {
      // renderHand() was called inside playCard() and rebuilt all hand DOM elements —
      // re-apply tut-lit so the player can still select cards under body.tut-locked
      TS.playerHand.forEach(function (id) {
        var el = getHandCardEl(id);
        if (el) lit(el);
      });
      // Re-light the remaining valid target slots (any location not yet used)
      T_LOCS.forEach(function (loc) {
        if (loc.id === 2) return;              // Rift Valley not valid for two_more
        if (TS.t5Locs[loc.id]) return;         // already placed here
        var sl = getFirstAvailableSlotEl('player', loc.id);
        if (sl) lit(sl);
      });
    }
  }

  /* Step 5 — End Turn */
  function step_endTurn() {
    endTurnBtnEl.disabled = false;
    lit(endTurnBtnEl);
    TS.awaitAction = 'end_turn';
    setLocked(true);
    showDialogue(
      "When you\u2019re done playing cards, hit the End Turn button. That tells the game you\u2019re ready to reveal.",
      null
    );
  }

  function onEndTurnClicked() {
    TS.awaitAction = null;
    setLocked(false);
    unlit(endTurnBtnEl);
    endTurnBtnEl.disabled = true;
    setHeader(1, 'REVEAL', TS.capital);
    placeAICards(1);

    queueDialogues([
      "Now watch carefully. This is the reveal phase. Both players reveal their cards one at a time. See those Influence Points adding up at each location?"
    ], function () {
      runReveal(1, function () {
        queueDialogues([
          "One to one across the board. Truly historic. Let\u2019s get some real cards on the board and spice things up, shall we?"
        ], function () { startTurn(2); });
      });
    });
  }

  /* Turns 2–5 */
  function startTurn(n) {
    TS.turn    = n;
    TS.capital = 5 + TS.bonusCapital;
    TS.bonusCapital = 0;
    setHeader(n, 'SELECT CARDS', TS.capital);
    endTurnBtnEl.disabled = true;

    var drawn;
    if      (n === 2) { drawn = [2, 23]; }   // Scholar-Officials, Zheng He
    else if (n === 3) { drawn = [10, 9]; }   // Jesus Christ, Erasmus
    else if (n === 4) { drawn = [21, 6]; }   // Nomad, Priests
    else if (n === 5) { drawn = [3, 7]; }    // Alexander, Pope Innocent III
    else              { drawn = []; }

    drawn.forEach(function (id) {
      if (TS.playerHand.indexOf(id) === -1) TS.playerHand.push(id);
    });
    renderHand(TS.playerHand);

    if (n === 2) {
      queueDialogues([
        "Now we\u2019re talking! You\u2019ve drawn Scholar-Officials and Zheng He \u2014 both have abilities. Let\u2019s find out what they do."
      ], function () { step_readScholar(); });
    } else if (n === 3) {
      queueDialogues([
        "New cards! Notice the pink borders \u2014 they\u2019re both Religious cards. Same type, same colour. Let\u2019s see what they do."
      ], function () { step_readJesus(); });
    } else if (n === 4) {
      queueDialogues([
        "Turn 4 of 5 \u2014 you\u2019re getting the hang of it! The board is taking shape. Play what you like this turn, then hit End Turn."
      ], function () {
        step_freeTurn(function () { startTurn(5); });
      });
    } else if (n === 5) {
      queueDialogues([
        "This is it \u2014 the last turn! After these cards are revealed the game ends. Make your plays count."
      ], function () {
        step_freeTurn(function () { runFinalReveal(); });
      });
    }
  }

  /* ── Turn 2: guided read Scholar-Officials → Zheng He → play both ── */

  function step_readScholar() {
    var soEl = getHandCardEl(2);
    if (soEl) lit(soEl);
    TS.awaitAction = 'read_scholar';
    setLocked(true);
    showDialogue("Click Scholar-Officials to read what they do.", null);
  }

  function onReadScholar() {
    TS.awaitAction = null;
    setLocked(false);
    var soEl = getHandCardEl(2);
    if (soEl) unlit(soEl);
    queueDialogues([
      "For every other card at their location when revealed, Scholar-Officials grant you +1 Capital next turn. The more allies they have, the richer you get."
    ], function () { step_readZhenghe(); });
  }

  function step_readZhenghe() {
    var zhEl = getHandCardEl(23);
    if (zhEl) lit(zhEl);
    TS.awaitAction = 'read_zhenghe';
    setLocked(true);
    showDialogue("Now click Zheng He.", null);
  }

  function onReadZhenghe() {
    TS.awaitAction = null;
    setLocked(false);
    var zhEl = getHandCardEl(23);
    if (zhEl) unlit(zhEl);
    queueDialogues([
      "When Zheng He is revealed, he delivers +2 IP to a card at each location next to him. A generous explorer.",
      "Here\u2019s the play: drag Zheng He to The Great Rift Valley first, then Scholar-Officials right alongside him. Zheng He boosts the neighbours, Scholar-Officials count their allies. Together they\u2019re much stronger."
    ], function () { step_zhenghePlay(); });
  }

  function step_zhenghePlay() {
    var zhEl = getHandCardEl(23);
    if (zhEl) lit(zhEl);
    var targetSlot = getFirstAvailableSlotEl('player', 2);
    if (targetSlot) lit(targetSlot);
    TS.awaitAction = 'zhenghe_play';
    setLocked(true);
    showDialogue("Drag Zheng He to The Great Rift Valley slot.", null);
  }

  function onZhengHePlayed() {
    TS.awaitAction = null;
    setLocked(false);
    getPlayerSlotsFor(2).forEach(unlit);
    step_scholarPlay();
  }

  function step_scholarPlay() {
    var soEl = getHandCardEl(2);
    if (soEl) lit(soEl);
    var targetSlot = getFirstAvailableSlotEl('player', 2);
    if (targetSlot) lit(targetSlot);
    TS.awaitAction = 'scholar_play';
    setLocked(true);
    showDialogue("Now drag Scholar-Officials to The Great Rift Valley alongside Zheng He.", null);
  }

  function onScholarPlayed() {
    TS.awaitAction = null;
    setLocked(false);
    getPlayerSlotsFor(2).forEach(unlit);
    queueDialogues([
      "Perfect. End the turn and watch what happens."
    ], function () {
      step_freeTurn(function () {
        queueDialogues([
          "See that? Zheng He delivered +2 IP to the card next to him, and Scholar-Officials counted their allies \u2014 that\u2019s extra Capital heading your way this turn."
        ], function () { startTurn(3); });
      });
    });
  }

  /* ── Turn 3: guided read Jesus → Erasmus → free play ── */

  function step_readJesus() {
    var jesusEl = getHandCardEl(10);
    if (jesusEl) lit(jesusEl);
    TS.awaitAction = 'read_jesus';
    setLocked(true);
    showDialogue("Click Jesus Christ to read what he does.", null);
  }

  function onReadJesus() {
    TS.awaitAction = null;
    setLocked(false);
    var jesusEl = getHandCardEl(10);
    if (jesusEl) unlit(jesusEl);
    queueDialogues([
      "If Jesus is discarded, he gains +3 IP and comes back to your hand. Persistent fellow."
    ], function () { step_readErasmus(); });
  }

  function step_readErasmus() {
    var erasmusEl = getHandCardEl(9);
    if (erasmusEl) lit(erasmusEl);
    TS.awaitAction = 'read_erasmus';
    setLocked(true);
    showDialogue("Now click Erasmus.", null);
  }

  function onReadErasmus() {
    TS.awaitAction = null;
    setLocked(false);
    var erasmusEl = getHandCardEl(9);
    if (erasmusEl) unlit(erasmusEl);
    queueDialogues([
      "Erasmus lets you choose any card from your hand to discard. Any card at all\u2026",
      "I wonder what happens when Erasmus discards a certain someone who gains +3\u00a0IP when discarded and comes back to your hand. Play what you like this turn, then hit End Turn."
    ], function () {
      step_freeTurn(function () { startTurn(4); });
    });
  }

  /* Free-play turn (Turns 2 remainder, 3, 4, 5) */
  function step_freeTurn(onEndTurn) {
    endTurnBtnEl.disabled = false;
    lit(endTurnBtnEl);
    TS.awaitAction = 'free_end_turn';
    TS.freeEndCb   = onEndTurn;
    setLocked(false);
    renderHand(TS.playerHand);
    updateHint();
  }

  function onFreeEndTurn() {
    clearSelection();
    TS.awaitAction = null;
    setLocked(false);
    unlit(endTurnBtnEl);
    endTurnBtnEl.disabled = true;
    setHeader(TS.turn, 'REVEAL', TS.capital);
    placeAICards(TS.turn);

    var cb = TS.freeEndCb;
    TS.freeEndCb = null;
    runReveal(TS.turn, cb || function () {});
  }

  /* Final reveal and completion */
  function runFinalReveal() {
    queueDialogues([
      "And that\u2019s Shoulders of Giants! You win by controlling 2 out of 3 locations. Now that you know the basics \u2014 are you ready to make history for real?"
    ], function () {
      localStorage.setItem('sog_tutorial_complete', 'true');
      hideEl(boxEl);
      hideEl(skipEl);
      showEl(endEl);
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     CARD PLACEMENT
  ═══════════════════════════════════════════════════════════════ */

  function playCard(cardId, locId) {
    var card = CARDS.find(function (c) { return c.id === cardId; });
    if (!card) return false;
    var slots = TS.playerSlots[locId];
    if (!slots) return false;
    var si = slots.indexOf(null);
    if (si === -1 || card.cc > TS.capital) return false;

    slots[si] = { cardId: cardId, ip: card.ip, revealed: false };
    TS.capital -= card.cc;
    TS.playerHand = TS.playerHand.filter(function (id) { return id !== cardId; });

    var slotEl = getTutSlotEl('player', locId, si);
    if (slotEl) {
      slotEl.className = 'battle-card-slot occupied face-down';
      slotEl.dataset.cardId = cardId;
      slotEl.removeAttribute('draggable');
    }

    renderHand(TS.playerHand);
    setCapital(TS.capital);

    if (TS.awaitAction === 'free_end_turn') {
      TS.playerHand.forEach(function (id) { var el = getHandCardEl(id); if (el) lit(el); });
    }
    return true;
  }

  function placeAICards(turn) {
    var script = AI_SCRIPT[turn] || [];
    script.forEach(function (item) {
      var slots = TS.aiSlots[item.l];
      if (!slots) return;
      var si = slots.indexOf(null);
      if (si === -1) return;
      var card = CARDS.find(function (c) { return c.id === item.c; });
      if (!card) return;
      slots[si] = { cardId: item.c, ip: card.ip, revealed: false };
      var slotEl = getTutSlotEl('opp', item.l, si);
      if (slotEl) slotEl.className = 'battle-card-slot occupied face-down';
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     REVEAL SEQUENCE
  ═══════════════════════════════════════════════════════════════ */

  function runReveal(turn, onDone) {
    var pQ = [], aQ = [];
    T_LOCS.forEach(function (loc) {
      TS.playerSlots[loc.id].forEach(function (sd, i) {
        if (sd && !sd.revealed) pQ.push({ owner: 'player', locId: loc.id, si: i, sd: sd });
      });
      TS.aiSlots[loc.id].forEach(function (sd, i) {
        if (sd && !sd.revealed) aQ.push({ owner: 'opp', locId: loc.id, si: i, sd: sd });
      });
    });

    var combined = [];
    var max = Math.max(pQ.length, aQ.length);
    for (var i = 0; i < max; i++) {
      if (i < pQ.length) combined.push(pQ[i]);
      if (i < aQ.length) combined.push(aQ[i]);
    }

    var idx = 0;
    function next() {
      if (idx >= combined.length) {
        updateScores();
        setTimeout(onDone, 800);
        return;
      }
      var item = combined[idx++];
      flipCard(item);
      updateScores();
      setTimeout(next, 1000);
    }
    next();
  }

  function flipCard(item) {
    item.sd.revealed = true;
    var card = CARDS.find(function (c) { return c.id === item.sd.cardId; });
    if (!card) return;
    var slotEl = getTutSlotEl(item.owner, item.locId, item.si);
    if (!slotEl) return;

    // ── Flip SFX + animation ──────────────────────────────────────
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
    ipEl.textContent = item.sd.ip;

    slotEl.appendChild(wrap);
    slotEl.appendChild(ccEl);
    slotEl.appendChild(ipEl);

    if (typeof Anim !== 'undefined') Anim.cardReveal(slotEl);

    // ── Per-card ability simulations ──────────────────────────────
    var cardId = item.sd.cardId;
    setTimeout(function () {

      // Scholar-Officials (id 2): count allies, queue bonus Capital for next turn
      if (cardId === 2 && item.owner === 'player') {
        var allies = TS.playerSlots[item.locId].filter(function (sd) {
          return sd !== null && sd.cardId !== 2;
        }).length;
        if (allies > 0) {
          TS.bonusCapital += allies;
          if (typeof Anim !== 'undefined') Anim.floatNumber(slotEl, allies);
          if (typeof SFX  !== 'undefined') SFX.ipGained();
        }
      }

      // Zheng He (id 23): deliver +2 IP to first revealed player card at each adjacent location
      if (cardId === 23 && item.owner === 'player') {
        var locIndex = T_LOCS.findIndex(function (l) { return l.id === item.locId; });
        [-1, 1].forEach(function (offset) {
          var adjLoc = T_LOCS[locIndex + offset];
          if (!adjLoc) return;
          var adjSlots = TS.playerSlots[adjLoc.id];
          for (var i = 0; i < adjSlots.length; i++) {
            if (adjSlots[i] && adjSlots[i].revealed) {
              adjSlots[i].ip += 2;
              var adjSlotEl = getTutSlotEl('player', adjLoc.id, i);
              if (adjSlotEl) {
                var adjIpEl = adjSlotEl.querySelector('.db-overlay-ip');
                if (adjIpEl) adjIpEl.textContent = adjSlots[i].ip;
                if (typeof Anim !== 'undefined') Anim.floatNumber(adjSlotEl, 2);
                if (typeof SFX  !== 'undefined') SFX.ipGained();
              }
              break; // only first revealed card per adjacent location
            }
          }
        });
        updateScores();
      }

    }, 320);
  }

  function updateScores() {
    T_LOCS.forEach(function (loc) {
      var ps = 0, as = 0;
      TS.playerSlots[loc.id].forEach(function (sd) { if (sd && sd.revealed) ps += sd.ip; });
      TS.aiSlots[loc.id].forEach(function (sd)     { if (sd && sd.revealed) as += sd.ip; });
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
      var el = buildHandCard(card);
      addTutDrag(el, id);
      playerHandEl.appendChild(el);
    });
    var sep = document.createElement('div');
    sep.className = 'battle-hand-sep';
    playerHandEl.appendChild(sep);
    var pileCount = Math.max(0, 10 - TS.turn * 2);
    playerHandEl.appendChild(buildDeckPile(pileCount));
  }

  function buildHandCard(card) {
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
    ip.textContent = card.ip;
    el.appendChild(wrap);
    el.appendChild(cc);
    el.appendChild(ip);
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
     dragstart on a hand card → tutDragCardId set, valid slots lit.
     drop on a player slot    → card placed, step callbacks fired.
  ═══════════════════════════════════════════════════════════════ */

  /* Returns true when this card may be dragged given the current step. */
  function canDrag(cardId) {
    if (!TS.awaitAction) return false;
    if (TS.awaitAction === 'citizens_rift') return cardId === 1;
    if (TS.awaitAction === 'two_more')      return true;
    if (TS.awaitAction === 'zhenghe_play')  return cardId === 23;
    if (TS.awaitAction === 'scholar_play')  return cardId === 2;
    if (TS.awaitAction === 'free_end_turn') return true;
    // read_* actions: cards are clickable but not draggable
    return false;
  }

  /* Returns true when tutDragCardId may be dropped at locId. */
  function validLocForCard(cardId, locId) {
    if (!TS.playerSlots[locId]) return false;
    if (TS.playerSlots[locId].indexOf(null) === -1) return false;
    var card = CARDS.find(function (c) { return c.id === cardId; });
    if (!card || card.cc > TS.capital) return false;
    if (TS.awaitAction === 'citizens_rift') return locId === 2;
    if (TS.awaitAction === 'two_more')      return locId !== 2 && !TS.t5Locs[locId];
    if (TS.awaitAction === 'zhenghe_play')  return locId === 2;
    if (TS.awaitAction === 'scholar_play')  return locId === 2;
    if (TS.awaitAction === 'free_end_turn') return true;
    return false;
  }

  /* Make a hand card draggable; gates on canDrag.
     Click always opens the info popup so the player can read abilities. */
  function addTutDrag(cardEl, cardId) {
    cardEl.draggable = true;

    cardEl.addEventListener('click', function (e) {
      e.stopPropagation(); // prevent click bubbling to dialogue box / dim overlay
      if (tutDragCardId !== null) return;
      var card = CARDS.find(function (c) { return c.id === cardId; });
      if (!card || typeof window.openBattlePopup !== 'function') return;
      var sd = { cardId: cardId, ip: card.ip, ipMod: 0, ipModSources: [], contMod: 0, revealed: true };
      window.openBattlePopup(card, sd, 'player', false);
      // Fire guided-read callbacks
      if (TS.awaitAction === 'read_scholar'  && cardId === 2)  { onReadScholar();  return; }
      if (TS.awaitAction === 'read_zhenghe'  && cardId === 23) { onReadZhenghe();  return; }
      if (TS.awaitAction === 'read_jesus'    && cardId === 10) { onReadJesus();    return; }
      if (TS.awaitAction === 'read_erasmus'  && cardId === 9)  { onReadErasmus();  return; }
    });

    cardEl.addEventListener('dragstart', function (e) {
      if (!canDrag(cardId)) { e.preventDefault(); return; }
      tutDragCardId = cardId;
      e.dataTransfer.effectAllowed = 'move';
      cardEl.classList.add('dragging');
      // Pre-highlight valid drop slots so the player can see where to go
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
    boardEl.addEventListener('dragover', function (e) {
      if (!TS.active || tutDragCardId === null) return;
      var slotEl = e.target.closest('.battle-card-slot[data-owner="player"]');
      if (!slotEl) { clearDragHighlights(); return; }
      var locId = parseInt(slotEl.dataset.locId, 10);
      if (!validLocForCard(tutDragCardId, locId)) { clearDragHighlights(); return; }
      e.preventDefault();
      // Show drag-over highlight on the first empty slot at this column
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
      if (!slotEl || tutDragCardId === null) return;
      slotEl.classList.remove('drag-over');
      var locId  = parseInt(slotEl.dataset.locId, 10);
      if (!validLocForCard(tutDragCardId, locId)) return;

      var cardId = tutDragCardId;
      var action = TS.awaitAction;
      tutDragCardId = null;
      clearDragHighlights();

      var ok = playCard(cardId, locId);
      if (!ok) return;

      if      (action === 'citizens_rift') { onCitizensPlaced(); }
      else if (action === 'two_more')      { onTwoMorePlaced(locId); }
      else if (action === 'zhenghe_play')  { onZhengHePlayed(); }
      else if (action === 'scholar_play')  { onScholarPlayed(); }
      // free_end_turn: player continues at will
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
    _blipCount  = 0;   // reset blip counter for each new line
    textEl.textContent = '';
    updateHint();

    TS.typeTimer = setInterval(function () {
      TS.typedLen++;
      textEl.textContent = TS.fullText.slice(0, TS.typedLen);
      playBlip();
      if (TS.typedLen >= TS.fullText.length) {
        clearInterval(TS.typeTimer);
        TS.typeTimer = null;
        TS.typing = false;
        updateHint();
      }
    }, TYPE_SPEED);
  }

  function advanceDialogue() {
    if (TS.typing) {
      clearInterval(TS.typeTimer);
      TS.typeTimer = null;
      TS.typing = false;
      textEl.textContent = TS.fullText;
      updateHint();
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
      'citizens_rift':  'DRAG CITIZENS TO THE GREAT RIFT VALLEY SLOT',
      'two_more':       'DRAG A CARD TO THE MIDDLE OR RIGHT LOCATION',
      'read_scholar':   'CLICK SCHOLAR-OFFICIALS TO READ THEIR ABILITY',
      'read_zhenghe':   'CLICK ZHENG HE TO READ HIS ABILITY',
      'read_jesus':     'CLICK JESUS CHRIST TO READ HIS ABILITY',
      'read_erasmus':   'CLICK ERASMUS TO READ HIS ABILITY',
      'zhenghe_play':   'DRAG ZHENG HE TO THE GREAT RIFT VALLEY SLOT',
      'end_turn':       'CLICK THE END TURN BUTTON',
      'scholar_play':   'CLICK SCHOLAR-OFFICIALS, THEN CLICK THE GREAT RIFT VALLEY',
      'free_end_turn':  'CLICK END TURN WHEN READY'
    };
    if (TS.awaitAction && actionHints[TS.awaitAction]) {
      hintEl.textContent = actionHints[TS.awaitAction];
      hintEl.classList.add('tut-hint-action');
    } else if (TS.typing) {
      hintEl.textContent = '\u25b6 Click to skip';
      hintEl.classList.remove('tut-hint-action');
    } else {
      hintEl.textContent = '\u25b6 Click to continue';
      hintEl.classList.remove('tut-hint-action');
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     HIGHLIGHT / LOCK / DIM
  ═══════════════════════════════════════════════════════════════ */

  function lit(el)   { if (el) el.classList.add('tut-lit'); }
  function unlit(el) { if (el) el.classList.remove('tut-lit'); }

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
     EXIT / COMPLETE
  ═══════════════════════════════════════════════════════════════ */

  function exitTutorial() {
    teardown();
    showScreen('screen-deckbuilder');
    if (typeof window.initDeckBuilder === 'function') window.initDeckBuilder();
  }

  function finishTutorial() {
    teardown();
    showScreen('screen-deckbuilder');
    if (typeof window.initDeckBuilder === 'function') window.initDeckBuilder();
  }

  function teardown() {
    clearSelection();
    removeNumHighlight();
    TS.active             = false;
    window.tutorialActive = false;
    if (TS.typeTimer) { clearInterval(TS.typeTimer); TS.typeTimer = null; }
    setLocked(false);
    hideEl(boxEl);
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
  }

  /* ── Export ──────────────────────────────────────────────────── */
  window.startTutorial = startTutorial;

}());
