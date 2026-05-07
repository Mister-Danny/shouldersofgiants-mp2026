/**
 * game.js — Shoulders of Giants · Core Turn Engine + Card Ability Engine (Step 6)
 *
 * Slot ordering:     Cards fill left-to-right; gaps compact left on removal.
 * Reveal ordering:   Sequential, alternating player/AI, ~800 ms apart.
 * IP model:          slotData.ip  = base IP at time of play (card.ip + G.cardIPBonus)
 *                    slotData.ipMod  = permanent modifier (reset by Justinian)
 *                    slotData.contMod = continuous modifier (recalculated each pass)
 *                    effectiveIP(s) = s.ip + s.ipMod + s.contMod
 *
 * Ability trigger points:
 *   At Once    — fireAtOnce()      called immediately after flipSlot()
 *   Continuous — evaluateContinuous() called after every At Once + at end of reveal pass
 *   Conditional — triggered by destroyCard() / discardFromHand()
 *
 * Depends on: cards.js, locations.js, ui.js
 * Exposes:    window.initGame()
 */

(function () {
  'use strict';

  /* ── Constants ───────────────────────────────────────────────── */
  const TURNS         = 5;
  const CAPITAL       = 5;
  const HAND_START    = 5;
  const MAX_HAND_SIZE = 7;
  const SLOTS_PER_LOC = 4;
  const REVEAL_DELAY  = 800;
  const POST_REVEAL   = 1200;
  // Active deck IDs come from window.Decks (multi-slot save layer).
  const TYPE_ORDER    = ['Political','Religious','Military','Cultural','Exploration'];

  /* ── Game state ──────────────────────────────────────────────── */
  var G = {
    turn:        1,
    phase:       'select',
    capital:     CAPITAL,
    playerFirst: true,

    playerDeck:  [],
    playerHand:  [],
    aiDeck:      [],
    aiHand:      [],

    turnStartCapital: CAPITAL,  // capital at the start of this turn (may exceed CAPITAL with bonus)

    // locId → [ null | {cardId,ip,revealed,ipMod,contMod} ]  ×4, always compacted
    playerSlots: {},
    aiSlots:     {},

    playerRevealQueue: [],
    aiRevealQueue:     [],

    locations: [],

    // ── Ability state ──────────────────────────────────────────
    bonusCapitalNextTurn:   0,   // Scholar-Officials (player)
    aiBonusCapitalNextTurn: 0,   // Scholar-Officials (AI)
    cardIPBonus:            {},  // player cardId → cumulative bonus IP (Samurai, Jesus)
    aiCardIPBonus:          {},  // AI    cardId → cumulative bonus IP (Samurai, Jesus)
    destroyedIPTotal:       0,   // total IP of cards destroyed by player (William)
    aiDestroyedIPTotal:     0,   // total IP of cards destroyed by AI   (William)
    columbusMoved:          false,
    aiColumbusMoved:        false,
    movedThisTurn:          {},  // cardId → bool  (Magellan, per-turn reset)
    aiMovedThisTurn:        {},
    moveLog:                [],  // player moves this turn [{cardId,fromLocId,toLocId,toSlotIndex,ipModAdded,isColumbus,queued}]
    playerActionLog:        [],  // ordered: {type:'play'|'move', cardId, fromLocId?, fromSlotIndex?, toLocId?}
    locationSnapshots:      {},  // locId → slot-array copy taken at first queueMove from that loc
    reservedSlotsPerLoc:    {},  // locId → count of snap-back slots reserved (one per queued move FROM that loc)
    deferredPlays:          {},  // locId → [slotData] new plays that couldn't fit at snap-back; inserted after queued card moves away

    // ── Adventure Mode ────────────────────────────────────────
    prehistoryMode:         false  // when true, all CC costs are overridden to 0
  };

  /* ── Drag state ──────────────────────────────────────────────── */
  var dragInfo = null;

  /* ── Background music playlist ───────────────────────────────── */
  var _musicTracks = [
    { src: 'music/Cupids Revenge.mp3',     name: 'Cupids Revenge — Kevin MacLeod' },
    { src: 'music/Crossing the Chasm.mp3', name: 'Crossing the Chasm — Kevin MacLeod' },
    { src: 'music/Mountain Emperor.mp3',   name: 'Mountain Emperor — Kevin MacLeod' }
  ];
  var _musicIdx   = 0;
  var _musicHowl  = null;
  var _bgMusicVol = 0.10;  // persists across Play Again

  function _musicUpdateUI() {
    var nameEl  = document.getElementById('music-track-name');
    var playBtn = document.getElementById('music-play-btn');
    if (nameEl)  nameEl.textContent  = _musicTracks[_musicIdx].name;
    if (playBtn) playBtn.textContent = (_musicHowl && _musicHowl.playing()) ? '\u258c\u258c' : '\u25b6';
  }

  function _musicLoadTrack(idx, autoplay) {
    if (_musicHowl) { _musicHowl.stop(); _musicHowl.unload(); _musicHowl = null; }
    _musicIdx = ((idx % _musicTracks.length) + _musicTracks.length) % _musicTracks.length;
    if (typeof Howl === 'undefined') { _musicUpdateUI(); return; }
    _musicHowl = new Howl({
      src:    [_musicTracks[_musicIdx].src],
      volume: _bgMusicVol,
      html5:  true,
      onend:  function () { _musicLoadTrack(_musicIdx + 1, true); },
      onplay: function () { _musicUpdateUI(); },
      onpause: function () { _musicUpdateUI(); },
      onstop: function () { _musicUpdateUI(); }
    });
    if (autoplay) _musicHowl.play();
    _musicUpdateUI();
  }

  function startBgMusic() {
    _musicLoadTrack(0, true);
  }

  function stopBgMusic() {
    if (_musicHowl) { _musicHowl.stop(); _musicHowl.unload(); _musicHowl = null; }
    _musicUpdateUI();
  }

  /* ── Selection timer state ──────────────────────────────────── */
  var _timerEl         = null;   /* kept for compat — legacy HUD box, never shown */
  var _timerValEl      = null;
  var _timerBarWrapEl  = null;
  var _timerBarEl      = null;
  var _timerInterval   = null;
  var _timerSecs       = 0;
  var _timerTotal      = 0;

  /* ── Undo-end-turn state ─────────────────────────────────────── */
  var _undoEndTurnTimer    = null;
  var _undoEndTurnCountdown = 0;

  /* ── DOM refs ────────────────────────────────────────────────── */
  var headerTurnEl     = document.getElementById('battle-turn-info');
  var headerPhaseEl    = document.getElementById('battle-phase-info');
  var capitalNumEl     = null;
  var endTurnBtn       = document.getElementById('battle-end-turn');
  var resetTurnBtn     = document.getElementById('battle-reset-turn');
  var playerHandEl     = document.getElementById('battle-player-hand');
  var boardEl          = document.getElementById('battle-board');
  var battlePopupEl        = document.getElementById('battle-popup-backdrop');
  var battlePopupNameEl    = document.getElementById('battle-popup-name');
  var battlePopupAbilNmEl  = document.getElementById('battle-popup-ability-name');
  var battlePopupAbilTxEl  = document.getElementById('battle-popup-ability-text');
  var battlePopupIPBrkEl   = document.getElementById('battle-popup-ip-breakdown');
  var battlePopupHintEl    = document.getElementById('battle-popup-hint');
  var battlePopupCloseBtn  = document.getElementById('battle-popup-close');
  var oppHandEl            = document.getElementById('battle-opp-hand');

  /* ═══════════════════════════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════════════════════════ */

  function initGame() {
    // Default to easy if no difficulty was chosen (e.g. launched from tutorial)
    if (!window.aiDifficulty) window.aiDifficulty = 'easy';

    /* ── 2P mode: use Match-resolved locations + opponent deck ─── */
    var _2pCfg = (window.matchId && typeof Match !== 'undefined') ? Match.get2PConfig() : null;

    G.locations = (_2pCfg && _2pCfg.locations && _2pCfg.locations.length)
      ? _2pCfg.locations
      : pickLocations();
    window.initBattleUI(G.locations);

    var deckIds = (window.Decks && window.Decks.getActiveCards()) || [];
    G.playerDeck = shuffle(deckIds.slice());
    G.playerHand = G.playerDeck.splice(0, HAND_START);

    G.aiDeck = (_2pCfg && _2pCfg.oppDeckIds && _2pCfg.oppDeckIds.length)
      ? shuffle(_2pCfg.oppDeckIds.slice())
      : buildAiDeck();
    G.aiHand = G.aiDeck.splice(0, HAND_START);

    G.locations.forEach(function (loc) {
      G.playerSlots[loc.id] = [null, null, null, null];
      G.aiSlots[loc.id]     = [null, null, null, null];
    });

    G.turn              = 1;
    G.phase             = 'select';
    G.capital           = CAPITAL;
    G.turnStartCapital  = CAPITAL;
    G.playerFirst       = Math.random() < 0.5;
    showRevealFirstHighlight(G.playerFirst);
    G.playerRevealQueue = [];
    G.aiRevealQueue     = [];

    G.bonusCapitalNextTurn   = 0;
    G.aiBonusCapitalNextTurn = 0;
    G.cardIPBonus            = {};
    G.aiCardIPBonus          = {};
    G.destroyedIPTotal       = 0;
    G.aiDestroyedIPTotal     = 0;
    G.columbusMoved          = false;
    G.aiColumbusMoved        = false;
    G.movedThisTurn          = {};
    G.aiMovedThisTurn        = {};
    G.moveLog                = [];
    G.playerActionLog        = [];
    G.locationSnapshots      = {};
    G.reservedSlotsPerLoc    = {};
    G.deferredPlays          = {};
    dragInfo = null;

    window.setPlayerHand(G.playerHand, G.playerDeck.length);
    updateOppHand();
    capitalNumEl = document.getElementById('battle-capital-num');

    endTurnBtn.textContent     = 'END TURN';
    endTurnBtn.disabled        = false;
    resetTurnBtn.disabled      = false;
    resetTurnBtn.style.display = '';
    document.getElementById('btn-back-results').style.display = 'none';

    updateHeader();
    bindHandEvents();
    refreshMoveableCards();
    startBgMusic();
    _startSelectionTimer();

    if (typeof Analytics !== 'undefined') {
      Analytics.gameStarted(window.aiDifficulty);
    }
  }

  /* ── Utilities ───────────────────────────────────────────────── */

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  /* ═══════════════════════════════════════════════════��══════════
     SELECTION PHASE TIMER
     Active only when window.tournamentMatch === true.
     Turn 1: 60s, each subsequent turn adds 15s.
  ══════════════════════════════════════════════════════════════ */

  function _timerRefs() {
    if (!_timerBarWrapEl) {
      _timerEl       = document.getElementById('battle-timer');      /* legacy */
      _timerValEl    = document.getElementById('battle-timer-val');  /* legacy */
      _timerBarWrapEl = document.getElementById('battle-timer-bar-wrap');
      _timerBarEl     = document.getElementById('battle-timer-bar');
    }
  }

  function _timerBarUpdate() {
    if (!_timerBarEl) return;
    var pct   = _timerTotal > 0 ? Math.max(0, _timerSecs / _timerTotal) * 100 : 0;
    _timerBarEl.style.width = pct + '%';
    _timerBarEl.className   = 'battle-timer-bar' +
      (_timerSecs <= 10 ? ' urgent' : _timerSecs <= 20 ? ' warning' : '');
  }

  function _startSelectionTimer() {
    if (!window.tournamentMatch || window.tournamentMatch === false) return;
    _timerRefs();
    _stopSelectionTimer();

    _timerTotal = 60 + (G.turn - 1) * 15;
    _timerSecs  = _timerTotal;

    if (_timerBarWrapEl) {
      /* Set to 100% instantly (no transition), then let each tick drain smoothly */
      _timerBarEl.style.transition = 'none';
      _timerBarEl.style.width      = '100%';
      _timerBarEl.className        = 'battle-timer-bar';
      _timerBarWrapEl.style.display = '';
      /* Re-enable transition on next frame so the first tick animates */
      requestAnimationFrame(function () {
        if (_timerBarEl) _timerBarEl.style.transition = '';
      });
    }

    _timerInterval = setInterval(function () {
      _timerSecs--;
      _timerBarUpdate();

      if (_timerSecs <= 0) {
        _stopSelectionTimer();
        if (G.phase === 'select' && !window.tutorialActive) {
          if (typeof SFX !== 'undefined') SFX.endTurn();
          onEndTurn();
        }
      }
    }, 1000);
  }

  function _stopSelectionTimer() {
    if (_timerInterval) {
      clearInterval(_timerInterval);
      _timerInterval = null;
    }
    _timerRefs();
    if (_timerBarWrapEl) _timerBarWrapEl.style.display = 'none';
  }

  /* ═══════════════════════════════════════════════════════════════
     2P MATCH HELPERS
  ═══════════════════════════════════════════════════════════════ */

  function _showMatchWaitOverlay(show) {
    var el = document.getElementById('match-wait-overlay');
    if (el) el.style.display = show ? 'flex' : 'none';
  }

  /**
   * Apply serialised opponent actions to G.aiSlots / G.aiRevealQueue.
   * Called in 2P mode after both players have submitted their turn.
   * Moves are applied first (already-revealed cards), then plays (new cards face-down).
   */
  function applyOpponentActions(actions) {
    if (!actions) actions = [];
    G.aiRevealQueue = [];

    /* ── Moves: delegate to executeMove so face-up render, IP mods
          (Cape +1, Magellan +1, Columbus), and slot compaction all
          run correctly for every movement card.                    ── */
    actions.filter(function (a) { return a.type === 'move'; }).forEach(function (a) {
      var fromSlots = G.aiSlots[a.fromLocId];
      if (!fromSlots) return;
      var fromIdx = -1;
      fromSlots.forEach(function (s, i) { if (s && s.cardId === a.cardId) fromIdx = i; });
      if (fromIdx === -1) return;
      executeMove('opp', a.fromLocId, fromIdx, a.toLocId);
    });

    /* ── Plays: place new cards face-down ───────────────────── */
    actions.filter(function (a) { return a.type === 'play'; }).forEach(function (a) {
      var card = CARDS.find(function (c) { return c.id === a.cardId; });
      if (!card) return;
      var locId = a.toLocId;
      if (locId == null || !G.aiSlots[locId]) return;
      var slotIndex = G.aiSlots[locId].indexOf(null);
      if (slotIndex === -1) return;
      var baseIP = card.ip + (G.aiCardIPBonus[a.cardId] || 0);
      G.aiSlots[locId][slotIndex] = { cardId: a.cardId, ip: baseIP, revealed: false, ipMod: 0, contMod: 0, ipModSources: [] };
      G.aiHand = G.aiHand.filter(function (id) { return id !== a.cardId; });
      G.aiRevealQueue.push(a.cardId);
      var slotEl = getSlotEl('opp', locId, slotIndex);
      if (slotEl) { slotEl.dataset.cardId = String(a.cardId); setSlotFaceDown(slotEl); }
    });

    updateOppHand();
  }

  function pickLocations() {
    // Bypass menu: teacher may force a specific set of 3 locations
    try {
      var forced = JSON.parse(localStorage.getItem('sog_forced_locations'));
      if (Array.isArray(forced) && forced.length === 3) {
        var result = forced.map(function (id) {
          return LOCATIONS.find(function (l) { return l.id === id; });
        }).filter(Boolean);
        if (result.length === 3) return result;
      }
    } catch (e) {}
    var pool = LOCATIONS.slice();
    pool.sort(function () { return Math.random() - 0.5; });
    return pool.slice(0, 3);
  }

  function buildAiDeck() {
    var types = TYPE_ORDER.slice();
    types.sort(function () { return Math.random() - 0.5; });
    var deck = [];
    types.slice(0, 3).forEach(function (type) {
      CARDS.filter(function (c) { return c.type === type && !c.locked; })
           .forEach(function (c) { deck.push(c.id); });
    });
    return shuffle(deck);
  }

  function updateHeader() {
    headerTurnEl.textContent  = 'TURN ' + G.turn + ' / ' + TURNS;
    headerPhaseEl.textContent = G.phase === 'select' ? 'SELECT CARDS' : 'REVEAL';
    if (capitalNumEl) capitalNumEl.textContent = G.capital;
  }

  /* ═══════════════════════════════════════════════════════════════
     HAND EVENTS
  ═══════════════════════════════════════════════════════════════ */

  function bindHandEvents() {
    playerHandEl.querySelectorAll('.battle-hand-card').forEach(function (el) {
      el.draggable = true;
      el.addEventListener('click',     onHandCardClick);
      el.addEventListener('dragstart', onHandCardDragStart);
      el.addEventListener('dragend',   onHandCardDragEnd);
    });
  }

  function onHandCardClick() {
    var cardId = parseInt(this.dataset.id, 10);
    var card   = CARDS.find(function (c) { return c.id === cardId; });
    if (!card) return;

    // Build a synthetic slot object so openBattlePopup shows the IP breakdown.
    // Hand cards don't have a live slot, but they may already have accumulated bonuses
    // stored in G.cardIPBonus (e.g. William absorbs destroyed IP, Jesus gains +3 per return).
    // William is a special case: his bonus lives in G.destroyedIPTotal, not cardIPBonus.
    var bonus = (cardId === 15) ? G.destroyedIPTotal : (G.cardIPBonus[cardId] || 0);
    var sources = [];
    if (bonus) {
      var label = cardId === 15 ? 'Destroyed cards (William)' :
                  cardId === 10 ? 'Resurrection bonus'        : 'Bonus';
      sources.push({ source: label, delta: bonus });
    }
    var sd = { cardId: cardId, ip: card.ip, ipMod: bonus, ipModSources: sources, contMod: 0, revealed: true };
    openBattlePopup(card, sd, 'player', false);
  }

  function onHandCardDragStart(e) {
    if (G.phase !== 'select') { e.preventDefault(); return; }
    var id   = parseInt(this.dataset.id, 10);
    var card = CARDS.find(function (c) { return c.id === id; });
    if (!card) return;
    dragInfo = { cardId: id, source: 'hand' };
    e.dataTransfer.effectAllowed = 'move';
    this.classList.add('dragging');
  }

  function onHandCardDragEnd() {
    this.classList.remove('dragging');
    dragInfo = null;
    clearDragOver();
  }

  /* ═══════════════════════════════════════════════════════════════
     BOARD DRAG EVENTS
  ═══════════════════════════════════════════════════════════════ */

  boardEl.addEventListener('dragstart', function (e) {
    // Unplayed (face-up but not yet revealed) slot → undo-play drag
    var fdSlot = e.target.closest('.battle-card-slot.unplayed[data-owner="player"]');
    if (fdSlot) {
      dragInfo = {
        source:    'slot',
        cardId:    parseInt(fdSlot.dataset.cardId,    10),
        locId:     parseInt(fdSlot.dataset.locId,     10),
        slotIndex: parseInt(fdSlot.dataset.slotIndex, 10)
      };
      e.dataTransfer.effectAllowed = 'move';
      fdSlot.classList.add('dragging');
      return;
    }
    // Moveable revealed card → move drag (Magellan / Columbus)
    var mvSlot = e.target.closest('.battle-card-slot.moveable[data-owner="player"]');
    if (mvSlot && G.phase === 'select') {
      dragInfo = {
        source:        'move',
        cardId:        parseInt(mvSlot.dataset.cardId,    10),
        fromLocId:     parseInt(mvSlot.dataset.locId,     10),
        fromSlotIndex: parseInt(mvSlot.dataset.slotIndex, 10)
      };
      e.dataTransfer.effectAllowed = 'move';
      mvSlot.classList.add('dragging');
    }
  });

  boardEl.addEventListener('dragover', function (e) {
    if (!dragInfo) return;

    if (dragInfo.source === 'hand' && G.phase === 'select') {
      var col = e.target.closest('.battle-card-slot[data-owner="player"]');
      if (!col) { clearDragOver(); return; }
      var locId      = parseInt(col.dataset.locId, 10);
      var card       = CARDS.find(function (c) { return c.id === dragInfo.cardId; });
      var firstEmpty   = G.playerSlots[locId].indexOf(null);
      if (!card || firstEmpty === -1 || effectiveCost(card, locId) > G.capital) { clearDragOver(); return; }
      // FIRST_CARD_HERE: first play on Turn 1 must go to the Great Rift Valley
      var riftLoc = G.locations.find(function (l) { return l.abilityKey === 'FIRST_CARD_HERE'; });
      if (riftLoc && G.turn === 1 && G.playerRevealQueue.length === 0 && locId !== riftLoc.id) {
        clearDragOver(); return;
      }
      e.preventDefault();
      clearDragOver();
      var t = getSlotEl('player', locId, firstEmpty);
      if (t) t.classList.add('drag-over');
      return;
    }

    if (dragInfo.source === 'move' && G.phase === 'select') {
      var col = e.target.closest('.battle-card-slot[data-owner="player"]');
      if (!col) { clearDragOver(); return; }
      var toLocId      = parseInt(col.dataset.locId, 10);
      if (toLocId === dragInfo.fromLocId) { clearDragOver(); return; }
      var firstEmpty   = G.playerSlots[toLocId].indexOf(null);
      var availForMove = G.playerSlots[toLocId].filter(function (s) { return s === null; }).length
                       - (G.reservedSlotsPerLoc[toLocId] || 0);
      if (firstEmpty === -1 || availForMove <= 0) { clearDragOver(); return; }
      // CULTURAL_FREE_MOVE_HERE: Cultural cards (not Magellan/Columbus) can only move to Timbuktu
      var movingCard  = CARDS.find(function (c) { return c.id === dragInfo.cardId; });
      var timbuktuLoc = G.locations.find(function (l) { return l.abilityKey === 'CULTURAL_FREE_MOVE_HERE'; });
      if (movingCard && movingCard.type === 'Cultural' && dragInfo.cardId !== 24 && dragInfo.cardId !== 25) {
        if (!timbuktuLoc || toLocId !== timbuktuLoc.id) { clearDragOver(); return; }
      }
      e.preventDefault();
      clearDragOver();
      var t = getSlotEl('player', toLocId, firstEmpty);
      if (t) t.classList.add('drag-over');
    }
  });

  boardEl.addEventListener('dragleave', function (e) {
    var s = e.target.closest('.battle-card-slot');
    if (s) s.classList.remove('drag-over');
  });

  boardEl.addEventListener('drop', function (e) {
    var anySlot = e.target.closest('.battle-card-slot[data-owner="player"]');
    if (!anySlot || !dragInfo) return;
    e.preventDefault();
    anySlot.classList.remove('drag-over');

    if (dragInfo.source === 'hand') {
      commitPlay(dragInfo.cardId, parseInt(anySlot.dataset.locId, 10));
    } else if (dragInfo.source === 'move') {
      var toLocId = parseInt(anySlot.dataset.locId, 10);
      if (toLocId !== dragInfo.fromLocId)
        queueMove(dragInfo.fromLocId, dragInfo.fromSlotIndex, toLocId);
    }
    dragInfo = null;
  });

  boardEl.addEventListener('dragend', function (e) {
    var s = e.target.closest('.battle-card-slot');
    if (s) { s.classList.remove('dragging'); s.classList.remove('drag-over'); }
    dragInfo = null;
    clearDragOver();
  });

  /* ═══════════════════════════════════════════════════════════════
     HAND AREA DROP (undo-play)
  ═══════════════════════════════════════════════════════════════ */

  playerHandEl.addEventListener('dragover', function (e) {
    if (dragInfo && dragInfo.source === 'slot') {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
    }
  });

  playerHandEl.addEventListener('drop', function (e) {
    if (!dragInfo || dragInfo.source !== 'slot') return;
    e.preventDefault();
    undoPlay(dragInfo.locId, dragInfo.slotIndex);
    dragInfo = null;
  });

  /* ═══════════════════════════════════════════════════════════════
     PLAY / UNDO / RESET
  ═══════════════════════════════════════════════════════════════ */

  function commitPlay(cardId, locId) {
    var card = CARDS.find(function (c) { return c.id === cardId; });
    if (!card) return;
    var cost = effectiveCost(card, locId);
    if (cost > G.capital) { var d = getSlotEl('player', locId, 0); if (d) flashDeny(d); return; }
    var si = G.playerSlots[locId].indexOf(null);
    if (si === -1) { var d2 = getSlotEl('player', locId, 0); if (d2) flashDeny(d2); return; }
    // FIRST_CARD_HERE: first play on Turn 1 must go to the Great Rift Valley
    var riftLoc = G.locations.find(function (l) { return l.abilityKey === 'FIRST_CARD_HERE'; });
    if (riftLoc && G.turn === 1 && G.playerRevealQueue.length === 0 && locId !== riftLoc.id) {
      var d2 = getSlotEl('player', locId, 0); if (d2) flashDeny(d2); return;
    }

    var baseIP = card.ip + (G.cardIPBonus[cardId] || 0);
    G.playerSlots[locId][si] = { cardId: cardId, ip: baseIP, revealed: false, ipMod: 0, contMod: 0, ipModSources: [] };
    G.capital -= cost;
    if (typeof SFX !== 'undefined') SFX.capitalSpent();
    G.playerRevealQueue.push(cardId);
    G.playerActionLog.push({ type: 'play', cardId: cardId, toLocId: locId });

    G.playerHand = G.playerHand.filter(function (id) { return id !== cardId; });
    var hEl = playerHandEl.querySelector('.battle-hand-card[data-id="' + cardId + '"]');
    if (hEl) hEl.remove();

    var slotEl = getSlotEl('player', locId, si);
    if (slotEl) {
      slotEl.dataset.cardId = cardId;
      slotEl.className = 'battle-card-slot occupied face-up unplayed';
      slotEl.draggable = true;
      buildCardFace(slotEl, card, baseIP);
    }
    updateHeader();
  }

  function undoPlay(locId, slotIndex) {
    var sd = G.playerSlots[locId][slotIndex];
    if (!sd || sd.revealed) return;
    var card = CARDS.find(function (c) { return c.id === sd.cardId; });
    if (card) G.capital += effectiveCost(card, locId);
    // Cap to this turn's starting capital — preserves bonus capital
    // granted by Scholar-Officials (or any future "+N capital next
    // turn" ability) instead of clamping back to the base 5.
    G.capital = Math.min(G.capital, G.turnStartCapital);
    G.playerRevealQueue = G.playerRevealQueue.filter(function (id) { return id !== sd.cardId; });
    G.playerHand.push(sd.cardId);
    G.playerSlots[locId][slotIndex] = null;
    compactPlayerSlots(locId);
    syncPlayerSlots(locId);
    window.setPlayerHand(G.playerHand, G.playerDeck.length);
    bindHandEvents();
    updateHeader();
  }

  /**
   * Snap back all queued-move previews to their true origin slots.
   * Called at the start of every reveal phase AND from resetTurn.
   *
   * After this call:
   *   - Every queued card is back at its snapshot-position in fromLocId (face-up)
   *   - Cards that compacted during selection are back at their original slots
   *   - Newly played (face-down) cards are in the remaining null slots
   *   - locationSnapshots and reservedSlotsPerLoc are cleared
   */
  function snapBack() {
    var queued = G.moveLog.filter(function (mv) { return mv.queued; });
    if (!queued.length) return;

    // Step 1: remove every preview card from its destination location
    var toSeen = {};
    queued.forEach(function (mv) {
      var idx = G.playerSlots[mv.toLocId].findIndex(function (s) { return s && s.cardId === mv.cardId; });
      if (idx !== -1) {
        G.playerSlots[mv.toLocId][idx] = null;
        clearSlotDOM('player', mv.toLocId, idx);
      }
      toSeen[mv.toLocId] = true;
    });
    // Compact + sync destination locations
    Object.keys(toSeen).forEach(function (idStr) {
      var lid = parseInt(idStr, 10);
      compactPlayerSlots(lid);
      syncPlayerSlots(lid);
    });

    // Step 2: restore each fromLocation from its snapshot, placing new plays in remaining null slots
    var fromSeen = {};
    queued.forEach(function (mv) { fromSeen[mv.fromLocId] = true; });
    Object.keys(fromSeen).forEach(function (idStr) {
      var lid      = parseInt(idStr, 10);
      var snapshot = G.locationSnapshots[lid];
      if (!snapshot) return;

      // New plays are unrevealed cards NOT present in the snapshot
      var snapIds  = snapshot.filter(Boolean).map(function (s) { return s.cardId; });
      var newPlays = [];
      G.playerSlots[lid].forEach(function (s) {
        if (s && !s.revealed && snapIds.indexOf(s.cardId) === -1) newPlays.push(s);
      });

      // Restore snapshot (same object references — card data unchanged)
      G.playerSlots[lid] = snapshot.slice();

      // Append new plays into remaining null slots (in order).
      // If the snapshot was full (e.g. all 4 slots were revealed cards and one
      // queued away), there may not be room for all new plays yet.  Any that
      // don't fit are stored as deferredPlays and inserted after the queued
      // card animates away during the reveal sequence.
      for (var i = 0; i < G.playerSlots[lid].length && newPlays.length; i++) {
        if (G.playerSlots[lid][i] === null) G.playerSlots[lid][i] = newPlays.shift();
      }
      if (newPlays.length > 0) {
        G.deferredPlays[lid] = newPlays;
      }

      syncPlayerSlots(lid);
    });

    // Clear reservation / snapshot state
    G.locationSnapshots     = {};
    G.reservedSlotsPerLoc   = {};
  }

  function resetTurn() {
    // 1. Reset move-tracking flags for any queued moves
    G.moveLog.forEach(function (mv) {
      if (mv.queued) {
        G.movedThisTurn[mv.cardId] = false;
        if (mv.isColumbus) G.columbusMoved = false;
      }
    });

    // 2. Snap queued-move previews back to their origin slots
    snapBack();

    // 3. Return any deferred new plays (didn't fit at snap-back) to hand
    Object.keys(G.deferredPlays).forEach(function (lidStr) {
      var lid = parseInt(lidStr, 10);
      G.deferredPlays[lid].forEach(function (sd) {
        var card = CARDS.find(function (c) { return c.id === sd.cardId; });
        if (card) G.capital += effectiveCost(card, lid);
        G.playerHand.push(sd.cardId);
      });
    });
    G.deferredPlays = {};

    // 4. Return face-down (played-but-not-revealed) cards back to hand
    G.locations.forEach(function (loc) {
      for (var i = 0; i < SLOTS_PER_LOC; i++) {
        var sd = G.playerSlots[loc.id][i];
        if (!sd || sd.revealed) continue;
        var card = CARDS.find(function (c) { return c.id === sd.cardId; });
        if (card) G.capital += effectiveCost(card, loc.id);
        G.playerHand.push(sd.cardId);
        G.playerSlots[loc.id][i] = null;
      }
      compactPlayerSlots(loc.id);
      syncPlayerSlots(loc.id);
    });

    G.capital           = Math.min(G.capital, G.turnStartCapital);
    G.playerRevealQueue = [];
    G.moveLog           = [];
    G.playerActionLog   = [];

    window.setPlayerHand(G.playerHand, G.playerDeck.length);
    refreshHandIPDisplays();
    refreshHandCostDisplays();
    bindHandEvents();
    updateHeader();
  }

  /* ═══════════════════════════════════════════════════════════════
     SLOT HELPERS
  ═══════════════════════════════════════════════════════════════ */

  function getSlotEl(owner, locId, slotIndex) {
    return boardEl.querySelector(
      '.battle-card-slot[data-owner="' + owner + '"]' +
      '[data-loc-id="'     + locId     + '"]' +
      '[data-slot-index="' + slotIndex + '"]'
    );
  }

  function compactPlayerSlots(locId) {
    var f = G.playerSlots[locId].filter(function (s) { return s !== null; });
    while (f.length < SLOTS_PER_LOC) f.push(null);
    G.playerSlots[locId] = f;
  }

  /**
   * Full DOM sync for all 4 player slots at locId.
   * Handles empty, face-down, and revealed (rebuilds face-up after compaction).
   */
  function syncPlayerSlots(locId) {
    for (var i = 0; i < SLOTS_PER_LOC; i++) {
      var sd    = G.playerSlots[locId][i];
      var slotEl = getSlotEl('player', locId, i);
      if (!slotEl) continue;

      if (!sd) {
        slotEl.className = 'battle-card-slot';
        slotEl.innerHTML = '';
        slotEl.removeAttribute('draggable');
        delete slotEl.dataset.cardId;
      } else if (!sd.revealed) {
        var uCard = CARDS.find(function (c) { return c.id === sd.cardId; });
        slotEl.dataset.cardId = sd.cardId;
        slotEl.className      = 'battle-card-slot occupied face-up unplayed';
        slotEl.draggable      = true;
        if (uCard) buildCardFace(slotEl, uCard, effectiveIP(sd));
      } else {
        var card = CARDS.find(function (c) { return c.id === sd.cardId; });
        if (card) {
          slotEl.dataset.cardId = sd.cardId;
          slotEl.className      = 'battle-card-slot occupied face-up';
          slotEl.removeAttribute('draggable');
          buildCardFace(slotEl, card, effectiveIP(sd));
        }
      }
    }
    refreshMoveableCards();
  }

  function compactOppSlots(locId) {
    var f = G.aiSlots[locId].filter(function (s) { return s !== null; });
    while (f.length < SLOTS_PER_LOC) f.push(null);
    G.aiSlots[locId] = f;
  }

  function syncOppSlots(locId) {
    for (var i = 0; i < SLOTS_PER_LOC; i++) {
      var sd     = G.aiSlots[locId][i];
      var slotEl = getSlotEl('opp', locId, i);
      if (!slotEl) continue;
      if (!sd) {
        slotEl.className = 'battle-card-slot';
        slotEl.innerHTML = '';
        slotEl.removeAttribute('draggable');
        delete slotEl.dataset.cardId;
      } else if (!sd.revealed) {
        slotEl.dataset.cardId = sd.cardId;
        slotEl.className      = 'battle-card-slot occupied face-down';
        slotEl.innerHTML      = '';
      } else {
        var card = CARDS.find(function (c) { return c.id === sd.cardId; });
        if (card) {
          slotEl.dataset.cardId = sd.cardId;
          slotEl.className      = 'battle-card-slot occupied face-up';
          slotEl.removeAttribute('draggable');
          buildCardFace(slotEl, card, effectiveIP(sd));
        }
      }
    }
  }

  function setSlotFaceDown(slotEl) {
    slotEl.classList.add('occupied', 'face-down');
    if (slotEl.dataset.owner === 'player') slotEl.draggable = true;
  }

  /** Build card-face HTML inside slotEl (used by flipSlot and placeRevealedCard). */
  function buildCardFace(slotEl, card, displayIP) {
    slotEl.innerHTML = '';
    var wrap = document.createElement('div');
    wrap.className = 'db-card-img-wrap';
    var ph = document.createElement('div');
    ph.className   = 'db-card-img-placeholder';
    ph.textContent = card.name.charAt(0);
    var img = document.createElement('img');
    img.className = 'db-card-img';
    img.alt       = card.name;
    img.src       = 'images/cards/' + card.name + '.jpg';
    img.onerror   = function () { this.style.display = 'none'; };
    wrap.appendChild(ph);
    wrap.appendChild(img);
    var ccEl = document.createElement('div');
    ccEl.className   = 'db-overlay-cc';
    ccEl.textContent = card.cc;
    var ipEl = document.createElement('div');
    ipEl.className   = 'db-overlay-ip';
    ipEl.textContent = displayIP;
    slotEl.appendChild(wrap);
    slotEl.appendChild(ccEl);
    slotEl.appendChild(ipEl);

    // Direct click handler: look up current slotData from game state at click time
    slotEl.onclick = function () {
      if (window.tutorialActive) return;
      if (dragInfo) return;
      var ownerStr = slotEl.dataset.owner;
      var lId      = parseInt(slotEl.dataset.locId,     10);
      var si       = parseInt(slotEl.dataset.slotIndex, 10);
      var slotsRef = ownerStr === 'player' ? G.playerSlots : G.aiSlots;
      var sd       = slotsRef[lId] && slotsRef[lId][si];
      openBattlePopup(card, sd, ownerStr, true);
    };
  }

  /**
   * flipSlot(slotEl, done)
   * Reveals a face-down card with SFX + animation, fires per-card reveal
   * effects (Kente, Juvenal, Cosimo, Henry), then calls done() when all
   * reveal effects are complete so the next card / ability can begin cleanly.
   */
  function flipSlot(slotEl, done) {
    if (typeof SFX !== 'undefined') SFX.cardReveal();
    var cardId    = parseInt(slotEl.dataset.cardId,    10);
    var locId     = parseInt(slotEl.dataset.locId,     10);
    var slotIndex = parseInt(slotEl.dataset.slotIndex, 10);
    var owner     = slotEl.dataset.owner;
    var card      = CARDS.find(function (c) { return c.id === cardId; });
    if (!card) { if (done) done(); return; }
    var slots = owner === 'player' ? G.playerSlots : G.aiSlots;
    if (slots[locId] && slots[locId][slotIndex]) slots[locId][slotIndex].revealed = true;
    slotEl.removeAttribute('draggable');
    slotEl.classList.remove('face-down', 'unplayed');
    slotEl.classList.add('face-up');
    var sd = slots[locId] && slots[locId][slotIndex];
    buildCardFace(slotEl, card, sd ? effectiveIP(sd) : card.ip);
    if (typeof Anim !== 'undefined') Anim.cardReveal(slotEl);

    // ── Per-card reveal SFX + animations ──────────────────────────
    // Wait for the 300ms card-reveal scale-in to finish, then fire
    // per-card effects and signal done when they complete.
    setTimeout(function () {
      var extraDelay = 0; // ms to wait for per-card effects before calling done

      // Kente Cloth (id 17): shield chime + warm orange location glow
      if (cardId === 17) {
        if (typeof SFX !== 'undefined') SFX.kenteSound();
        var locTileEl = boardEl.querySelector('.battle-col[data-loc-id="' + locId + '"]');
        if (typeof Anim !== 'undefined') Anim.setKenteGlow(locTileEl, true);
        extraDelay = Math.max(extraDelay, 400);
      }

      // Juvenal (id 18): laughter + orange flash only when he actually penalises cards
      if (cardId === 18) {
        var juvenalTargetEls = [];
        ['player', 'opp'].forEach(function (own) {
          var sl = own === 'player' ? G.playerSlots : G.aiSlots;
          sl[locId].forEach(function (s, si) {
            if (!s || !s.revealed || s.cardId === 18) return;
            var c = CARDS.find(function (x) { return x.id === s.cardId; });
            if (c && c.cc >= 4) juvenalTargetEls.push(getSlotEl(own, locId, si));
          });
        });
        if (juvenalTargetEls.length > 0) {
          if (typeof SFX  !== 'undefined') SFX.juvenalSound();
          if (typeof Anim !== 'undefined') juvenalTargetEls.forEach(function (el) { if (el) Anim.juvenalFlash(el); });
          extraDelay = Math.max(extraDelay, 600);
        }
      }

      // Any card revealed at a location where Juvenal is already active:
      // flash the newly revealed card if it is penalised (CC ≥ 4, not Juvenal itself)
      if (cardId !== 18 && card && card.cc >= 4) {
        var juvenalPresent = ['player', 'opp'].some(function (own) {
          var sl = own === 'player' ? G.playerSlots : G.aiSlots;
          return sl[locId].some(function (s) { return s && s.revealed && s.cardId === 18; });
        });
        if (juvenalPresent) {
          if (typeof SFX !== 'undefined') SFX.juvenalSound();
          if (typeof Anim !== 'undefined') Anim.juvenalFlash(slotEl);
          extraDelay = Math.max(extraDelay, 600);
        }
      }

      // Cosimo de'Medici (id 19): money-bags chime on reveal
      if (cardId === 19) {
        if (typeof SFX !== 'undefined') SFX.cosimoSound();
        extraDelay = Math.max(extraDelay, 300);
      }

      // Henry the Navigator (id 22): patronage chime on reveal
      if (cardId === 22) {
        if (typeof SFX !== 'undefined') SFX.henrySound();
        extraDelay = Math.max(extraDelay, 300);
      }

      // Signal done after per-card effects have had time to play
      if (done) setTimeout(done, extraDelay);
    }, 320);
  }

  /**
   * Place a card face-up at a location (for Samurai return, Joan summon, Wu push).
   * @param {boolean} [opts.skipLocationAbility] skip MOVE_IN_GAINS_IP
   */
  function placeRevealedCard(owner, locId, cardId, extraIpMod, opts) {
    opts = opts || {};
    var slots = owner === 'player' ? G.playerSlots : G.aiSlots;
    var si    = slots[locId].indexOf(null);
    if (si === -1) return false;
    var card = CARDS.find(function (c) { return c.id === cardId; });
    if (!card) return false;
    var bonusDict = owner === 'player' ? G.cardIPBonus : G.aiCardIPBonus;
    var baseIP = card.ip + (bonusDict[cardId] || 0);
    var sd     = { cardId: cardId, ip: baseIP, revealed: true, ipMod: extraIpMod || 0, contMod: 0, ipModSources: [] };
    if (!opts.skipLocationAbility) {
      var dl = G.locations.find(function (l) { return l.id === locId; });
      if (dl && dl.abilityKey === 'MOVE_IN_GAINS_IP') addIPMod(sd, 1, 'The Cape of Good Hope');
    }
    slots[locId][si] = sd;
    var slotEl = getSlotEl(owner, locId, si);
    if (slotEl) {
      slotEl.dataset.cardId = cardId;
      slotEl.className      = 'battle-card-slot occupied face-up';
      slotEl.removeAttribute('draggable');
      buildCardFace(slotEl, card, effectiveIP(sd));
    }
    return true;
  }

  /** Remove an element from the DOM if still attached. */
  function removeEl(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /** Clone a DOM element as a position:fixed ghost for independent animation. */
  function makeBoardGhost(el, zIndex) {
    if (!el) return null;
    var rect  = el.getBoundingClientRect();
    var ghost = el.cloneNode(true);
    ghost.style.cssText =
      'position:fixed;left:' + rect.left + 'px;top:' + rect.top + 'px;' +
      'width:' + rect.width + 'px;height:' + rect.height + 'px;' +
      'margin:0;z-index:' + (zIndex || 300) + ';pointer-events:none;';
    document.body.appendChild(ghost);
    return ghost;
  }

  function removeGhost(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function clearSlotDOM(owner, locId, slotIndex) {
    var slotEl = getSlotEl(owner, locId, slotIndex);
    if (slotEl) {
      slotEl.className = 'battle-card-slot';
      slotEl.innerHTML = '';
      slotEl.removeAttribute('draggable');
      delete slotEl.dataset.cardId;
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     COST / IP
  ═══════════════════════════════════════════════════════════════ */

  function effectiveCost(card, locId) {
    if (G.prehistoryMode) return 0;
    var loc  = G.locations.find(function (l) { return l.id === locId; });
    var cost = card.cc;
    if (loc && loc.abilityKey === 'RELIGIOUS_DISCOUNT' && card.type === 'Religious')
      cost = Math.max(0, cost - 1);
    if (card.type === 'Cultural' &&
        G.locations.some(function (l) {
          return G.playerSlots[l.id].some(function (s) { return s && s.revealed && s.cardId === 19; });
        }))
      cost = Math.max(0, cost - 1);
    if (card.type === 'Exploration' &&
        G.locations.some(function (l) {
          return G.playerSlots[l.id].some(function (s) { return s && s.revealed && s.cardId === 22; });
        }))
      cost = Math.max(0, cost - 1);
    return cost;
  }

  function effectiveIP(sd) {
    return sd.ip + (sd.ipMod || 0) + (sd.contMod || 0);
  }

  /** Add a named modifier to a slot's permanent IP. */
  function addIPMod(sd, delta, sourceName) {
    sd.ipMod = (sd.ipMod || 0) + delta;
    if (!sd.ipModSources) sd.ipModSources = [];
    sd.ipModSources.push({ source: sourceName, delta: delta });
  }

  /**
   * Show a floating +/- number on a board slot and play the IP sound.
   * Safe to call speculatively — silently skips if element not found.
   */
  function showIPFloat(owner, cardId, delta) {
    if (delta === 0) return;
    var slotEl = findSlotEl(owner, cardId);
    if (slotEl && typeof Anim !== 'undefined') Anim.floatNumber(slotEl, delta);
    if (typeof SFX !== 'undefined') {
      if (delta > 0) SFX.ipGained();
      else           SFX.ipLost();
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     SCORES
  ═══════════════════════════════════════════════════════════════ */

  function updateScores() {
    G.locations.forEach(function (loc) {
      var pIP = 0, aIP = 0;
      G.playerSlots[loc.id].forEach(function (s) { if (s && s.revealed) pIP += effectiveIP(s); });
      G.aiSlots[loc.id].forEach(    function (s) { if (s && s.revealed) aIP += effectiveIP(s); });
      var pEl = document.getElementById('loc-score-player-' + loc.id);
      var aEl = document.getElementById('loc-score-opp-'    + loc.id);
      if (pEl) { var o = parseInt(pEl.textContent,10)||0; pEl.textContent=pIP; if(pIP!==o)flashScore(pEl); }
      if (aEl) { var o = parseInt(aEl.textContent,10)||0; aEl.textContent=aIP; if(aIP!==o)flashScore(aEl); }
    });
  }

  function refreshSlotIPDisplays() {
    G.locations.forEach(function (loc) {
      ['player','opp'].forEach(function (owner) {
        var slots = owner === 'player' ? G.playerSlots : G.aiSlots;
        slots[loc.id].forEach(function (s, si) {
          if (!s || !s.revealed) return;
          var slotEl = getSlotEl(owner, loc.id, si);
          if (!slotEl) return;
          var ipEl = slotEl.querySelector('.db-overlay-ip');
          if (ipEl) ipEl.textContent = effectiveIP(s);
        });
      });
    });
  }

  /**
   * Refresh IP overlays on hand cards.
   * Accounts for G.cardIPBonus (Jesus, Samurai, Magellan) and
   * G.destroyedIPTotal (William the Conqueror, id 15).
   */
  function refreshHandIPDisplays() {
    G.playerHand.forEach(function (cardId) {
      var card = CARDS.find(function (c) { return c.id === cardId; });
      if (!card) return;
      var displayIP = card.ip + (G.cardIPBonus[cardId] || 0);
      if (cardId === 15) displayIP += G.destroyedIPTotal;
      var hEl = playerHandEl.querySelector('.battle-hand-card[data-id="' + cardId + '"] .db-overlay-ip');
      if (hEl) hEl.textContent = displayIP;
    });
  }

  /**
   * Refresh CC overlays on hand cards.
   * Henry the Navigator (id 22): global -1 CC for all Exploration cards.
   * Cosimo de'Medici (id 19): global -1 CC for all Cultural cards.
   */
  function refreshHandCostDisplays() {
    var henryOnBoard  = G.locations.some(function (l) {
      return G.playerSlots[l.id].some(function (s) { return s && s.revealed && s.cardId === 22; });
    });
    var cosimoOnBoard = G.locations.some(function (l) {
      return G.playerSlots[l.id].some(function (s) { return s && s.revealed && s.cardId === 19; });
    });
    G.playerHand.forEach(function (cardId) {
      var card = CARDS.find(function (c) { return c.id === cardId; });
      if (!card) return;
      var displayCC = card.cc;
      if (card.type === 'Exploration' && henryOnBoard)  displayCC = Math.max(0, displayCC - 1);
      if (card.type === 'Cultural'    && cosimoOnBoard) displayCC = Math.max(0, displayCC - 1);
      var hEl = playerHandEl.querySelector('.battle-hand-card[data-id="' + cardId + '"] .db-overlay-cc');
      if (hEl) hEl.textContent = displayCC;
    });
  }

  function flashScore(el) {
    el.classList.remove('score-pop');
    void el.offsetWidth;
    el.classList.add('score-pop');
    setTimeout(function () { el.classList.remove('score-pop'); }, 350);
  }

  /* ═══════════════════════════════════════════════════════════════
     BUTTONS
  ═══════════════════════════════════════════════════════════════ */

  endTurnBtn.addEventListener('click', function () {
    if (window.tutorialActive) return;  // tutorial owns this button
    if (G.phase !== 'select')   return;
    if (typeof SFX !== 'undefined') SFX.endTurn();
    onEndTurn();
  });

  resetTurnBtn.addEventListener('click', function () {
    if (G.phase !== 'select') return;
    resetTurn();
  });

  function onEndTurn() {
    _stopSelectionTimer();
    if (typeof Analytics !== 'undefined') Analytics.turnEnded(G.turn);
    endTurnBtn.disabled   = true;
    resetTurnBtn.disabled = true;

    /* ── Proceed directly (undo window removed for single-player) ── */
    _proceedEndTurn();
  }

  function _cancelUndoEndTurn() {
    if (_undoEndTurnTimer) { clearInterval(_undoEndTurnTimer); _undoEndTurnTimer = null; }
    var undoBtn = document.getElementById('battle-undo-endturn');
    if (undoBtn) { undoBtn.style.display = 'none'; undoBtn.onclick = null; }
  }

  function _proceedEndTurn() {
    /* ── 2P mode: blind-submit then wait for opponent ─────────── */
    if (window.matchId && typeof Match !== 'undefined') {
      _showMatchWaitOverlay(true);
      Match.submitTurn(G.turn, G.playerActionLog.slice(), function (oppActions) {
        _showMatchWaitOverlay(false);
        applyOpponentActions(oppActions);
        setTimeout(startReveal, 600);
      });
      return;
    }

    /* ── Normal AI path ──────────────────────────────────────── */
    runAiMovements();
    runAiSelection();
    updateOppHand();
    setTimeout(startReveal, 600);
  }

  /* ═══════════════════════════════════════════════════════════════
     AI SELECTION
  ═══════════════════════════════════════════════════════════════ */

  function runAiSelection() {
    G.aiRevealQueue = [];
    var budget = CAPITAL + G.aiBonusCapitalNextTurn;
    G.aiBonusCapitalNextTurn = 0;

    // Shared helper: write a decided play to the board and reveal queue.
    function commitPlay(cardId, locId) {
      var card = CARDS.find(function (c) { return c.id === cardId; });
      if (!card) return;
      var slotIndex = G.aiSlots[locId].indexOf(null);
      if (slotIndex === -1) return;
      var baseIP = card.ip + (G.aiCardIPBonus[cardId] || 0);
      G.aiSlots[locId][slotIndex] = { cardId: cardId, ip: baseIP, revealed: false, ipMod: 0, contMod: 0, ipModSources: [] };
      G.aiHand = G.aiHand.filter(function (id) { return id !== cardId; });
      G.aiRevealQueue.push(cardId);
      var slotEl = getSlotEl('opp', locId, slotIndex);
      if (slotEl) { slotEl.dataset.cardId = cardId; setSlotFaceDown(slotEl); }
    }

    /* ── Giant / Hard mode: strategic AI ────────────────────────── */
    if (window.aiDifficulty === 'hard') {
      aiGiantStrategy(budget).forEach(function (play) {
        commitPlay(play.cardId, play.locId);
      });
      return;
    }

    /* ── Easy / Serf mode: random with ~33% carelessness ─────────── */
    var hand    = shuffle(G.aiHand.slice());
    var riftLoc = G.locations.find(function (l) { return l.abilityKey === 'FIRST_CARD_HERE'; });
    var aiFirstPlayed = false;

    hand.forEach(function (cardId) {
      if (budget <= 0) return;
      var card = CARDS.find(function (c) { return c.id === cardId; });
      if (!card || card.cc > budget) return;

      // Randomly skip ~1 in 3 affordable cards to simulate carelessness
      if (Math.random() < 0.33) return;

      var empties = [];
      G.locations.forEach(function (loc) {
        var fi = G.aiSlots[loc.id].indexOf(null);
        if (fi !== -1) empties.push({ locId: loc.id, slotIndex: fi });
      });
      if (!empties.length) return;

      var t;
      if (riftLoc && G.turn === 1 && !aiFirstPlayed) {
        var riftFi = G.aiSlots[riftLoc.id].indexOf(null);
        if (riftFi === -1) return;
        t = { locId: riftLoc.id, slotIndex: riftFi };
      } else {
        shuffle(empties);
        t = empties[0];
      }
      aiFirstPlayed = true;

      var baseIP = card.ip + (G.aiCardIPBonus[cardId] || 0);
      G.aiSlots[t.locId][t.slotIndex] = { cardId: cardId, ip: baseIP, revealed: false, ipMod: 0, contMod: 0, ipModSources: [] };
      G.aiHand = G.aiHand.filter(function (id) { return id !== cardId; });
      G.aiRevealQueue.push(cardId);
      budget -= card.cc;

      var slotEl = getSlotEl('opp', t.locId, t.slotIndex);
      if (slotEl) { slotEl.dataset.cardId = cardId; setSlotFaceDown(slotEl); }
    });
  }

  /**
   * _aiLocGap(locId)
   * Returns playerIP − aiIP for revealed cards at a location.
   * Positive = player leads, Negative = AI leads.
   */
  function _aiLocGap(locId) {
    var pIP = G.playerSlots[locId].reduce(function (s, x) { return s + (x && x.revealed ? effectiveIP(x) : 0); }, 0);
    var aIP = G.aiSlots[locId].reduce(   function (s, x) { return s + (x && x.revealed ? effectiveIP(x) : 0); }, 0);
    return pIP - aIP;
  }

  /**
   * _aiWinLocs(n)
   * Returns the IDs of the n locations the AI is best positioned to win,
   * sorted by lowest gap (most negative = largest AI lead).
   */
  function _aiWinLocs(n) {
    return G.locations.slice()
      .sort(function (a, b) { return _aiLocGap(a.id) - _aiLocGap(b.id); })
      .slice(0, n)
      .map(function (l) { return l.id; });
  }

  /* ═══════════════════════════════════════════════════════════════
     GIANT MODE AI STRATEGY  (hard difficulty only)
  ═══════════════════════════════════════════════════════════════ */

  /**
   * Per-location snapshot of board state from the AI's perspective.
   * Called once at the start of aiGiantStrategy().
   */
  function _giantBoardAnalysis() {
    var result = {};
    G.locations.forEach(function (loc) {
      var pIP = G.playerSlots[loc.id].reduce(function (s, x) { return s + (x ? effectiveIP(x) : 0); }, 0);
      var aIP = G.aiSlots[loc.id].reduce(   function (s, x) { return s + (x ? effectiveIP(x) : 0); }, 0);
      var gap = pIP - aIP;   // positive = player leads (AI losing)

      var playerHighCCCards = G.playerSlots[loc.id].reduce(function (n, s) {
        if (!s) return n;
        var c = CARDS.find(function (x) { return x.id === s.cardId; });
        return n + (c && c.cc >= 4 ? 1 : 0);
      }, 0);

      var playerCards = G.playerSlots[loc.id].filter(Boolean);

      result[loc.id] = {
        gap:                    gap,
        status:                 gap > 0 ? 'losing' : (gap < 0 ? 'winning' : 'tied'),
        playerHighCCCards:      playerHighCCCards,
        playerHasKente:         G.playerSlots[loc.id].some(function (s) { return s && s.cardId === 17; }),
        aiHasKente:             G.aiSlots[loc.id].some(   function (s) { return s && s.cardId === 17; }),
        playerHasVoltaireAlone: playerCards.length === 1 && playerCards[0].cardId === 20,
        aiRevealedCards:        G.aiSlots[loc.id].filter(function (s) { return s && s.revealed; }),
        aiAllCards:             G.aiSlots[loc.id].filter(Boolean),
        availableSlots:         G.aiSlots[loc.id].filter(function (s) { return s === null; }).length
      };
    });
    return result;
  }

  /**
   * Effective capital cost for an AI card at a location, accounting for
   * already-revealed discount cards (Henry anywhere, Cosimo anywhere, Levant).
   */
  function _giantEffectiveCC(cardId, locId) {
    var card = CARDS.find(function (c) { return c.id === cardId; });
    if (!card) return 99;
    var cc = card.cc;

    // Henry the Navigator (id=22): reduces Exploration cc globally
    if (card.type === 'Exploration' && cardId !== 22) {
      var henryOnBoard = G.locations.some(function (l) {
        return G.aiSlots[l.id].some(function (s) { return s && s.revealed && s.cardId === 22; });
      });
      if (henryOnBoard) cc = Math.max(1, cc - 1);
    }
    // Cosimo de'Medici (id=19): reduces Cultural cc from anywhere
    if (card.type === 'Cultural' && cardId !== 19) {
      var cosimoAny = G.locations.some(function (l) {
        return G.aiSlots[l.id].some(function (s) { return s && s.revealed && s.cardId === 19; });
      });
      if (cosimoAny) cc = Math.max(1, cc - 1);
    }
    // Levant (RELIGIOUS_DISCOUNT)
    var loc = G.locations.find(function (l) { return l.id === locId; });
    if (loc && loc.abilityKey === 'RELIGIOUS_DISCOUNT' && card.type === 'Religious') {
      cc = Math.max(1, cc - 1);
    }
    return cc;
  }

  /**
   * Score a single (cardId, locId) candidate play.
   * Returns null if inadvisable; otherwise a numeric score (higher = better).
   * tentativePlays: already-selected plays this turn (for Voltaire/Scholar synergy checks).
   */
  function _giantScorePlay(cardId, locId, boardAnalysis, tentativePlays) {
    var card = CARDS.find(function (c) { return c.id === cardId; });
    if (!card) return null;
    var an = boardAnalysis[locId];

    var tentativeHere = tentativePlays.filter(function (p) { return p.locId === locId; }).length;
    if (an.availableSlots - tentativeHere <= 0) return null;

    var baseIP = card.ip + (G.aiCardIPBonus[cardId] || 0);
    var score  = baseIP;

    /* ── Per-card synergy bonuses ─────────────────────────────── */

    // Juvenal (id=18): each high-CC player card here triggers -2 IP penalty
    if (cardId === 18) {
      score += an.playerHighCCCards * 2;
    }

    // Voltaire (id=20): +4 IP if alone at location; wasted otherwise
    if (cardId === 20) {
      var aiHereTotal = an.aiAllCards.length + tentativeHere;
      score += (aiHereTotal === 0) ? 4 : -2;
    }

    // Cortes (id=13): destroys own revealed cards, gains +1 IP per card destroyed
    if (cardId === 13) {
      if (isKenteProtected(locId)) return null;
      var victims    = an.aiRevealedCards.filter(function (s) { return s.cardId !== 13; });
      var vCount     = victims.length;
      if (vCount < 2) return null;   // per spec: needs multiple victims to be worthwhile
      var vTotIP     = victims.reduce(function (s, x) { return s + effectiveIP(x); }, 0);
      var netChange  = (3 + vCount) - vTotIP;   // net IP change at this location
      if (netChange < 0) return null;
      score = netChange;
      // William synergy: destroyed IP also accumulates on William
      var aiHasWilliam = G.locations.some(function (l) {
        return G.aiSlots[l.id].some(function (s) { return s && s.cardId === 15; });
      });
      if (aiHasWilliam) score += vTotIP;
    }

    // Kente (id=17): extra value protecting high-IP AI cards at location
    if (cardId === 17) {
      var valCards = an.aiRevealedCards.filter(function (s) { return effectiveIP(s) >= 3; }).length;
      score += valCards * 0.5;
    }

    // Scholar-Officials (id=2): bonus capital next turn per other card here
    if (cardId === 2) {
      var othersHere = an.aiAllCards.length + tentativeHere;
      if (othersHere >= 1) score += Math.min(othersHere, 3) * 0.5;
    }

    // Pacal the Great (id=5): triggers At Once abilities of all cards at location
    if (cardId === 5) {
      var atOnceHere = an.aiAllCards.filter(function (s) {
        var c = CARDS.find(function (x) { return x.id === s.cardId; });
        return c && c.ability && c.ability.indexOf('At Once') !== -1;
      }).length;
      score += atOnceHere * 2;
    }

    // Henry the Navigator (id=22): extra value if we have Exploration cards to play
    if (cardId === 22) {
      var expHand = G.aiHand.filter(function (id) {
        if (id === 22) return false;
        var c = CARDS.find(function (x) { return x.id === id; });
        return c && c.type === 'Exploration';
      }).length;
      if (expHand > 0) score += 1;
    }

    // Cosimo de'Medici (id=19): extra value if we have Cultural cards to play
    if (cardId === 19) {
      var cultHand = G.aiHand.filter(function (id) {
        if (id === 19) return false;
        var c = CARDS.find(function (x) { return x.id === id; });
        return c && c.type === 'Cultural';
      }).length;
      if (cultHand > 0) score += 1;
    }

    /* ── Location priority ───────────────────────────────────── */
    score += an.status === 'losing' ? 3 : (an.status === 'tied' ? 2 : 0);

    /* ── Adaptive responses ──────────────────────────────────── */
    // Counter opponent Voltaire alone: playing here breaks the +4 bonus
    if (an.playerHasVoltaireAlone) score += 4;

    return score;
  }

  /**
   * Reveal-queue ordering for selected plays (lower = revealed earlier).
   * Ensures discounters (Henry/Cosimo) go first; Pacal goes last.
   */
  function _giantPlayOrder(cardId) {
    if (cardId === 22 || cardId === 19) return 1;   // Henry / Cosimo: first
    if (cardId === 2)                   return 7;   // Scholar-Officials: after others
    if (cardId === 13)                  return 8;   // Cortes: after own cards established
    if (cardId === 5)                   return 9;   // Pacal: last (triggers all At Once)
    var c = CARDS.find(function (x) { return x.id === cardId; });
    if (c && c.ability && c.ability.indexOf('At Once') !== -1) return 5;
    return 3;
  }

  /**
   * Giant mode card selection.
   * Returns an ordered array of {cardId, locId, cc} plays to commit this turn.
   */
  function aiGiantStrategy(budget) {
    var boardAnalysis = _giantBoardAnalysis();
    var riftLoc       = G.locations.find(function (l) { return l.abilityKey === 'FIRST_CARD_HERE'; });

    var selected   = [];
    var remaining  = budget;
    var usedCards  = {};
    var slotsUsed  = {};
    G.locations.forEach(function (l) { slotsUsed[l.id] = 0; });

    // Build a scored, sorted candidate list from current state.
    function buildCandidates(locFilter) {
      var cands = [];
      G.aiHand.forEach(function (cardId) {
        if (usedCards[cardId]) return;
        G.locations.forEach(function (loc) {
          if (locFilter && loc.id !== locFilter) return;
          var avail = boardAnalysis[loc.id].availableSlots - (slotsUsed[loc.id] || 0);
          if (avail <= 0) return;
          var cc    = _giantEffectiveCC(cardId, loc.id);
          if (cc > remaining) return;
          var score = _giantScorePlay(cardId, loc.id, boardAnalysis, selected);
          if (score === null) return;
          cands.push({ cardId: cardId, locId: loc.id, cc: cc, score: score });
        });
      });
      cands.sort(function (a, b) { return b.score - a.score; });
      return cands;
    }

    // Commit a play if still valid; returns true on success.
    function tryCommit(play) {
      if (usedCards[play.cardId]) return false;
      if (play.cc > remaining)    return false;
      var avail = boardAnalysis[play.locId].availableSlots - (slotsUsed[play.locId] || 0);
      if (avail <= 0) return false;
      // Re-score with updated tentative list (Voltaire, Pacal synergies may shift)
      if (_giantScorePlay(play.cardId, play.locId, boardAnalysis, selected) === null) return false;
      selected.push({ cardId: play.cardId, locId: play.locId, cc: play.cc });
      usedCards[play.cardId]  = true;
      slotsUsed[play.locId]   = (slotsUsed[play.locId] || 0) + 1;
      remaining              -= play.cc;
      return true;
    }

    // Turn 1: first card MUST go to the Rift Valley (FIRST_CARD_HERE rule).
    if (riftLoc && G.turn === 1) {
      var riftCands = buildCandidates(riftLoc.id);
      if (riftCands.length > 0) tryCommit(riftCands[0]);
    }

    // Main pass: greedy selection with 15% random skip for unpredictability.
    buildCandidates(null).forEach(function (play) {
      if (Math.random() < 0.15) return;
      tryCommit(play);
    });

    // Fill pass: if >1 capital unspent, add remaining cards without random skip.
    if (remaining > 1) {
      buildCandidates(null).forEach(function (play) { tryCommit(play); });
    }

    // Sequence: Henry/Cosimo first → vanilla cards → At Once → Scholar/Cortes → Pacal last.
    selected.sort(function (a, b) {
      return _giantPlayOrder(a.cardId) - _giantPlayOrder(b.cardId);
    });

    return selected;
  }

  /* ═══════════════════════════════════════════════════════════════
     MOVEMENT SYSTEM  (Magellan / Columbus)
  ═══════════════════════════════════════════════════════════════ */

  function refreshMoveableCards() {
    boardEl.querySelectorAll('.battle-card-slot.moveable').forEach(function (el) {
      el.classList.remove('moveable');
      if (!el.classList.contains('face-down')) el.removeAttribute('draggable');
    });
    if (G.phase !== 'select') return;
    var scandinaviaLoc   = G.locations.find(function (l) { return l.abilityKey === 'MILITARY_FREE_MOVE_AWAY'; });
    var timbuktuLoc      = G.locations.find(function (l) { return l.abilityKey === 'CULTURAL_FREE_MOVE_HERE'; });
    var timbuktuHasSpace = timbuktuLoc && (
      G.playerSlots[timbuktuLoc.id].indexOf(null) !== -1
    );
    G.locations.forEach(function (loc) {
      G.playerSlots[loc.id].forEach(function (s, si) {
        if (!s || !s.revealed) return;
        var card = CARDS.find(function (x) { return x.id === s.cardId; });
        var mv = (s.cardId === 24 && !G.movedThisTurn[24]) ||   // Magellan
                 (s.cardId === 25 && !G.columbusMoved)    ||    // Columbus
                 // Scandinavia: Military cards can move away for free (once per turn)
                 (scandinaviaLoc && loc.id === scandinaviaLoc.id && card && card.type === 'Military' && !G.movedThisTurn[s.cardId]) ||
                 // Timbuktu: Cultural cards elsewhere can move to Timbuktu for free (once per turn)
                 (timbuktuHasSpace && timbuktuLoc && loc.id !== timbuktuLoc.id && card && card.type === 'Cultural' && !G.movedThisTurn[s.cardId]);
        if (mv) {
          var el = getSlotEl('player', loc.id, si);
          if (el) { el.classList.add('moveable'); el.draggable = true; }
        }
      });
    });
  }

  function executeMove(owner, fromLocId, fromSlotIndex, toLocId) {
    var slots   = owner === 'player' ? G.playerSlots : G.aiSlots;
    var sd      = slots[fromLocId][fromSlotIndex];
    if (!sd) return;
    var cardId  = sd.cardId;
    var toIndex = slots[toLocId].indexOf(null);
    if (toIndex === -1) return;

    slots[fromLocId][fromSlotIndex] = null;
    clearSlotDOM(owner, fromLocId, fromSlotIndex);
    if (owner === 'player') { compactPlayerSlots(fromLocId); syncPlayerSlots(fromLocId); }
    else                    { compactOppSlots(fromLocId);    syncOppSlots(fromLocId);    }

    // Track ipMod added by this move so resetTurn can reverse it
    var ipModAdded = 0;
    var ipModSourcesAdded = [];

    // Apply MOVE_IN_GAINS_IP at destination
    var dl = G.locations.find(function (l) { return l.id === toLocId; });
    if (dl && dl.abilityKey === 'MOVE_IN_GAINS_IP') {
      addIPMod(sd, 1, 'The Cape of Good Hope');
      ipModAdded += 1;
      ipModSourcesAdded.push({ source: 'The Cape of Good Hope', delta: 1 });
    }

    toIndex = slots[toLocId].indexOf(null);
    if (toIndex === -1) return;
    slots[toLocId][toIndex] = sd;

    var card   = CARDS.find(function (c) { return c.id === cardId; });
    var toSlotEl = getSlotEl(owner, toLocId, toIndex);
    if (toSlotEl && card) {
      toSlotEl.dataset.cardId = cardId;
      toSlotEl.className      = 'battle-card-slot occupied face-up';
      toSlotEl.removeAttribute('draggable');
      buildCardFace(toSlotEl, card, effectiveIP(sd));
    }

    // Magellan: +1 IP per move
    if (cardId === 24) {
      addIPMod(sd, 1, 'Magellan');
      ipModAdded += 1;
      ipModSourcesAdded.push({ source: 'Magellan', delta: 1 });
      if (owner === 'player') G.movedThisTurn[24]   = true;
      else                    G.aiMovedThisTurn[24]  = true;
      refreshSlotIPDisplays();
    }

    // Log player moves so resetTurn can undo them
    if (owner === 'player') {
      G.moveLog.push({
        cardId:            cardId,
        fromLocId:         fromLocId,
        toLocId:           toLocId,
        toSlotIdx:         toIndex,
        ipModAdded:        ipModAdded,
        ipModSourcesAdded: ipModSourcesAdded,
        isColumbus:        cardId === 25
      });
    }

    // Location-ability moves (Scandinavia / Timbuktu): track so each card moves at most once per turn
    if (owner === 'player' && cardId !== 24 && cardId !== 25) {
      G.movedThisTurn[cardId] = true;
    }

    // Columbus: one-time move; -1 IP to opponent's Cultural and Political cards at destination
    if (cardId === 25) {
      var flag = owner === 'player' ? 'columbusMoved' : 'aiColumbusMoved';
      if (!G[flag]) {
        G[flag] = true;
        var oppSlots = owner === 'player' ? G.aiSlots : G.playerSlots;
        oppSlots[toLocId].forEach(function (s) {
          if (!s || !s.revealed) return;
          var c = CARDS.find(function (x) { return x.id === s.cardId; });
          if (c && (c.type === 'Cultural' || c.type === 'Political')) addIPMod(s, -1, 'Christopher Columbus');
        });
        refreshSlotIPDisplays();
        updateScores();
      }
    }

    refreshMoveableCards();
    updateScores();
  }

  /**
   * Queue a player card movement during the select phase.
   * The card immediately appears at its destination (face-up, with a pulsing
   * gold border) so the player can see where it's going.  The origin slot is
   * compacted so the next available slot opens up for new plays.
   * At reveal-start, snapBack() restores every card to its true origin before
   * executeMoveAnimated slides it in queue order.
   */
  function queueMove(fromLocId, fromSlotIndex, toLocId) {
    var sd = G.playerSlots[fromLocId][fromSlotIndex];
    if (!sd) return;
    var cardId = sd.cardId;
    var card   = CARDS.find(function (c) { return c.id === cardId; });

    // Destination must have a non-reserved null slot
    var toAvail = G.playerSlots[toLocId].filter(function (s) { return s === null; }).length
                - (G.reservedSlotsPerLoc[toLocId] || 0);
    if (toAvail <= 0) return;

    // Snapshot fromLocId before removing the card (first queue from this loc only)
    if (!G.locationSnapshots[fromLocId]) {
      G.locationSnapshots[fromLocId] = G.playerSlots[fromLocId].slice();
    }
    // Reserve a snap-back slot so new plays can't overfill this location
    G.reservedSlotsPerLoc[fromLocId] = (G.reservedSlotsPerLoc[fromLocId] || 0) + 1;

    // Move card from origin to destination (show at destination during select phase)
    G.playerSlots[fromLocId][fromSlotIndex] = null;
    clearSlotDOM('player', fromLocId, fromSlotIndex);
    compactPlayerSlots(fromLocId);
    syncPlayerSlots(fromLocId);

    var toIdx = G.playerSlots[toLocId].indexOf(null);
    G.playerSlots[toLocId][toIdx] = sd;
    var destSlotEl = getSlotEl('player', toLocId, toIdx);
    if (destSlotEl && card) {
      destSlotEl.dataset.cardId = cardId;
      destSlotEl.className      = 'battle-card-slot occupied face-up queued-dest';
      destSlotEl.removeAttribute('draggable');
      buildCardFace(destSlotEl, card, effectiveIP(sd));
    }

    G.movedThisTurn[cardId] = true;
    if (cardId === 25) G.columbusMoved = true;

    G.playerActionLog.push({ type: 'move', cardId: cardId, fromLocId: fromLocId, fromSlotIndex: fromSlotIndex, toLocId: toLocId });
    G.moveLog.push({ cardId: cardId, fromLocId: fromLocId, fromSlotIndex: fromSlotIndex, toLocId: toLocId, queued: true, isColumbus: cardId === 25 });

    refreshMoveableCards();
    updateScores();
  }

  /**
   * AI auto-movement (both modes).
   * Giant mode also repositions Military from Scandinavia and Cultural toward Timbuktu.
   */
  function runAiMovements() {
    var isHard = window.aiDifficulty === 'hard';

    G.locations.forEach(function (loc) {
      G.aiSlots[loc.id].forEach(function (s, si) {
        if (!s || !s.revealed) return;

        // ── Magellan (id=24) ──────────────────────────────────────
        if (s.cardId === 24 && !G.aiMovedThisTurn[24]) {
          var magBest = null, magBestScore = -Infinity;
          G.locations.forEach(function (l) {
            if (l.id === loc.id || G.aiSlots[l.id].indexOf(null) === -1) return;
            // Giant: move toward most contested (highest gap = AI losing there)
            // Easy: move toward highest player IP
            var magScore = isHard ? _aiLocGap(l.id)
              : G.playerSlots[l.id].reduce(function (sum, ps) {
                return sum + (ps && ps.revealed ? effectiveIP(ps) : 0);
              }, 0);
            if (magScore > magBestScore) { magBestScore = magScore; magBest = l.id; }
          });
          if (magBest !== null) executeMove('opp', loc.id, si, magBest);
        }

        // ── Columbus (id=25) ─────────────────────────────────────
        if (s.cardId === 25 && !G.aiColumbusMoved) {
          var colBest = null, colBestCount = 0;
          G.locations.forEach(function (l) {
            if (l.id === loc.id || G.aiSlots[l.id].indexOf(null) === -1) return;
            var cnt = G.playerSlots[l.id].filter(function (ps) {
              if (!ps || !ps.revealed) return false;
              var c = CARDS.find(function (x) { return x.id === ps.cardId; });
              return c && (c.type === 'Cultural' || c.type === 'Political');
            }).length;
            if (cnt > colBestCount) { colBestCount = cnt; colBest = l.id; }
          });
          if (colBest !== null) executeMove('opp', loc.id, si, colBest);
        }

        // ── Giant: Scandinavia military repositioning ─────────────
        if (isHard) {
          var scandLoc = G.locations.find(function (l) { return l.abilityKey === 'MILITARY_FREE_MOVE_AWAY'; });
          var cardInfo = CARDS.find(function (c) { return c.id === s.cardId; });
          if (scandLoc && loc.id === scandLoc.id &&
              cardInfo && cardInfo.type === 'Military' &&
              s.cardId !== 24 && s.cardId !== 25 &&
              !G.aiMovedThisTurn[s.cardId]) {
            var scandBest = null, scandBestGap = -Infinity;
            G.locations.forEach(function (l) {
              if (l.id === loc.id || G.aiSlots[l.id].indexOf(null) === -1) return;
              var gap = _aiLocGap(l.id);
              if (gap > scandBestGap) { scandBestGap = gap; scandBest = l.id; }
            });
            // Only reposition if AI is losing or tied at the destination
            if (scandBest !== null && scandBestGap >= 0) {
              executeMove('opp', loc.id, si, scandBest);
              G.aiMovedThisTurn[s.cardId] = true;
            }
          }
        }
      });
    });

    // ── Giant: Timbuktu Cultural repositioning ───────────────────
    if (isHard) {
      var timbuktuLoc = G.locations.find(function (l) { return l.abilityKey === 'CULTURAL_FREE_MOVE_HERE'; });
      if (timbuktuLoc && _aiLocGap(timbuktuLoc.id) >= 0) {
        G.locations.forEach(function (srcLoc) {
          if (srcLoc.id === timbuktuLoc.id) return;
          G.aiSlots[srcLoc.id].forEach(function (s, si) {
            if (!s || !s.revealed) return;
            if (G.aiMovedThisTurn[s.cardId]) return;
            if (G.aiSlots[timbuktuLoc.id].indexOf(null) === -1) return; // Timbuktu full
            var crd = CARDS.find(function (c) { return c.id === s.cardId; });
            if (!crd || crd.type !== 'Cultural') return;
            // Only pull from a location where AI is comfortably ahead (safe to spare the card)
            if (_aiLocGap(srcLoc.id) > -2) return;
            executeMove('opp', srcLoc.id, si, timbuktuLoc.id);
            G.aiMovedThisTurn[s.cardId] = true;
          });
        });
      }
    }
  }

  /**
   * Universal movement handler — called during the reveal phase for ALL card moves:
   * player-queued moves (Magellan, Columbus, Scandinavia, Timbuktu, Cape), Empress Wu
   * pushes, and any future movement mechanic.
   *
   * By the time this is called, snapBack() has already returned every queued card
   * to its true origin slot, so the card is at fromLocId ready to slide.
   *
   * opts (optional):
   *   sfxOnStart  — fn() called before the slide animation starts
   *   onLand      — fn(sd, done) called after the slot data is committed; skips
   *                 default Columbus/Magellan on-land behaviour when provided
   */
  function executeMoveAnimated(owner, cardId, fromLocId, toLocId, opts, done) {
    // Support legacy two-arg call: executeMoveAnimated(..., done)
    if (typeof opts === 'function') { done = opts; opts = {}; }
    opts = opts || {};
    done = done || function () {};

    var slots = owner === 'player' ? G.playerSlots : G.aiSlots;
    var card  = CARDS.find(function (c) { return c.id === cardId; });

    // Find card at fromLocId by cardId (snapBack already placed it here)
    var snapIdx = -1;
    for (var fi = 0; fi < slots[fromLocId].length; fi++) {
      if (slots[fromLocId][fi] && slots[fromLocId][fi].cardId === cardId) { snapIdx = fi; break; }
    }
    if (snapIdx === -1) { done(); return; }

    var sd         = slots[fromLocId][snapIdx];
    var fromSlotEl = getSlotEl(owner, fromLocId, snapIdx);
    // Clear any queued-dest styling still on the slot (e.g. non-snapped-back cases)
    if (fromSlotEl) fromSlotEl.classList.remove('queued-dest');

    // ── Slide fromLocId → toLocId ─────────────────────────────────
    var toIndex  = slots[toLocId].indexOf(null);
    if (toIndex === -1) { done(); return; }
    var toSlotEl = getSlotEl(owner, toLocId, toIndex);

    // SFX at start of slide
    if (opts.sfxOnStart) {
      opts.sfxOnStart();
    } else if (cardId === 24 && typeof SFX !== 'undefined') {
      SFX.sailingSound();
    }

    // Apply IP mods (Cape of Good Hope, Magellan +1)
    // Columbus -1 is applied in applyMove() after the slide completes
    var ipModAdded = 0;
    var ipModSourcesAdded = [];
    var dl = G.locations.find(function (l) { return l.id === toLocId; });
    if (dl && dl.abilityKey === 'MOVE_IN_GAINS_IP') {
      addIPMod(sd, 1, 'The Cape of Good Hope');
      ipModAdded += 1;
      ipModSourcesAdded.push({ source: 'The Cape of Good Hope', delta: 1 });
    }
    if (cardId === 24) {
      addIPMod(sd, 1, 'Magellan');
      ipModAdded += 1;
      ipModSourcesAdded.push({ source: 'Magellan', delta: 1 });
    }

    // Mark moveLog entry as executed
    for (var li = 0; li < G.moveLog.length; li++) {
      if (G.moveLog[li].cardId === cardId && G.moveLog[li].queued) {
        G.moveLog[li].queued            = false;
        G.moveLog[li].ipModAdded        = ipModAdded;
        G.moveLog[li].ipModSourcesAdded = ipModSourcesAdded;
        G.moveLog[li].toSlotIdx         = toIndex;
        break;
      }
    }

    function applyMove() {
      slots[fromLocId][snapIdx] = null;
      clearSlotDOM(owner, fromLocId, snapIdx);
      if (owner === 'player') { compactPlayerSlots(fromLocId); syncPlayerSlots(fromLocId); }
      else                    { compactOppSlots(fromLocId);    syncOppSlots(fromLocId);    }

      var finalIdx = slots[toLocId].indexOf(null);
      if (finalIdx === -1) { done(); return; }
      slots[toLocId][finalIdx] = sd;

      var finalSlotEl = getSlotEl(owner, toLocId, finalIdx);
      if (finalSlotEl && card) {
        finalSlotEl.dataset.cardId = cardId;
        finalSlotEl.className      = 'battle-card-slot occupied face-up';
        finalSlotEl.removeAttribute('draggable');
        buildCardFace(finalSlotEl, card, effectiveIP(sd));
      }

      if (cardId === 24) {
        showIPFloat(owner, cardId, 1);
        refreshSlotIPDisplays();
      }

      refreshMoveableCards();
      updateScores();

      // Custom on-land callback (e.g. Empress Wu routes through here)
      if (opts.onLand) { opts.onLand(sd, done); return; }

      // Columbus: apply -1 IP, play bell, shake affected cards, then proceed
      if (cardId === 25) {
        var oppOwner = owner === 'player' ? 'opp' : 'player';
        var oppSlots = owner === 'player' ? G.aiSlots : G.playerSlots;
        var affectedSlotEls = [];

        oppSlots[toLocId].forEach(function (s, si) {
          if (!s || !s.revealed) return;
          var c = CARDS.find(function (x) { return x.id === s.cardId; });
          if (c && (c.type === 'Cultural' || c.type === 'Political')) {
            addIPMod(s, -1, 'Christopher Columbus');
            var affSlotEl = getSlotEl(oppOwner, toLocId, si);
            if (affSlotEl) affectedSlotEls.push(affSlotEl);
          }
        });

        if (affectedSlotEls.length > 0) {
          if (typeof SFX !== 'undefined') SFX.columbusSound();
          var remaining = affectedSlotEls.length;
          affectedSlotEls.forEach(function (affSlotEl) {
            if (typeof Anim !== 'undefined') {
              Anim.columbusShake(affSlotEl, function () {
                Anim.floatNumber(affSlotEl, -1);
                remaining--;
                if (remaining === 0) {
                  refreshSlotIPDisplays();
                  updateScores();
                  done();
                }
              });
            } else {
              remaining--;
              if (remaining === 0) {
                refreshSlotIPDisplays();
                updateScores();
                done();
              }
            }
          });
        } else {
          setTimeout(done, 200);
        }
        return;
      }

      setTimeout(done, 200);
    }

    // GSAP slide animation
    if (typeof gsap !== 'undefined' && fromSlotEl && toSlotEl) {
      var fromRect = fromSlotEl.getBoundingClientRect();
      var toRect   = toSlotEl.getBoundingClientRect();

      var clone = fromSlotEl.cloneNode(true);
      clone.style.cssText = [
        'position:fixed',
        'left:'   + fromRect.left   + 'px',
        'top:'    + fromRect.top    + 'px',
        'width:'  + fromRect.width  + 'px',
        'height:' + fromRect.height + 'px',
        'z-index:9000',
        'pointer-events:none',
        'margin:0',
        'transition:none'
      ].join(';');
      document.body.appendChild(clone);
      fromSlotEl.style.opacity = '0';

      gsap.to(clone, {
        left:     toRect.left,
        top:      toRect.top,
        duration: 0.55,
        ease:     'power2.inOut',
        onComplete: function () {
          document.body.removeChild(clone);
          fromSlotEl.style.opacity = '';
          applyMove();
        }
      });
    } else {
      applyMove();
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     REVEAL PHASE
  ═══════════════════════════════════════════════════════════════ */

  function startReveal() {
    G.phase = 'reveal';
    hideRevealFirstHighlight();  // glow shown during selection — clear it now
    snapBack();            // Restore all queued cards to true origin slots
    refreshMoveableCards();
    updateHeader();

    // Flip all face-up unplayed player cards face-down before reveal begins
    var unplayedEls = Array.prototype.slice.call(
      boardEl.querySelectorAll('.battle-card-slot.unplayed[data-owner="player"]')
    );
    var afterFlip = function () {
      setTimeout(function () { revealNext(buildRevealSequence(), 0); }, 700);
    };

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
            onComplete: afterFlip
          });
        }
      });
    } else {
      unplayedEls.forEach(function (el) {
        el.classList.remove('face-up', 'unplayed');
        el.classList.add('face-down');
        el.innerHTML = '';
      });
      afterFlip();
    }
  }

  function showRevealFirstHighlight(playerFirst) {
    var lucyAv = document.querySelector('.battle-avatar-lucy');
    var otziAv = document.querySelector('.battle-avatar-otzi');
    if (lucyAv) lucyAv.classList.toggle('turn-first', !!playerFirst);
    if (otziAv) otziAv.classList.toggle('turn-first', !playerFirst);
  }

  function hideRevealFirstHighlight() {
    document.querySelectorAll('.battle-avatar.turn-first').forEach(function (el) {
      el.classList.remove('turn-first');
    });
  }

  function buildRevealSequence() {
    // Player side uses playerActionLog (ordered plays + queued moves)
    var pQ = G.playerActionLog.slice();
    // AI side: map raw cardIds to play-type items
    var aQ = G.aiRevealQueue.map(function (id) { return { type: 'play', cardId: id }; });
    var fQ = G.playerFirst ? pQ : aQ;
    var sQ = G.playerFirst ? aQ : pQ;
    var fO = G.playerFirst ? 'player' : 'opp';
    var sO = G.playerFirst ? 'opp'    : 'player';
    var seq = [];
    var len = Math.max(fQ.length, sQ.length);
    for (var i = 0; i < len; i++) {
      if (i < fQ.length) {
        var fi = fQ[i];
        seq.push({ type: fi.type, owner: fO, cardId: fi.cardId,
                   fromLocId: fi.fromLocId, toLocId: fi.toLocId });
      }
      if (i < sQ.length) {
        var si2 = sQ[i];
        seq.push({ type: si2.type, owner: sO, cardId: si2.cardId,
                   fromLocId: si2.fromLocId, toLocId: si2.toLocId });
      }
    }
    return seq;
  }

  function findSlotEl(owner, cardId) {
    var slots = owner === 'player' ? G.playerSlots : G.aiSlots;
    for (var li = 0; li < G.locations.length; li++) {
      var locId = G.locations[li].id;
      for (var si = 0; si < SLOTS_PER_LOC; si++) {
        if (slots[locId][si] && slots[locId][si].cardId === cardId)
          return getSlotEl(owner, locId, si);
      }
    }
    return null;
  }

  function getCardLocId(owner, cardId) {
    var slots = owner === 'player' ? G.playerSlots : G.aiSlots;
    for (var li = 0; li < G.locations.length; li++) {
      var locId = G.locations[li].id;
      for (var si = 0; si < SLOTS_PER_LOC; si++) {
        if (slots[locId][si] && slots[locId][si].cardId === cardId) return locId;
      }
    }
    return null;
  }

  function revealNext(seq, i) {
    if (i >= seq.length) {
      evaluateContinuous();
      refreshSlotIPDisplays();
      refreshHandIPDisplays();
      refreshHandCostDisplays();
      updateScores();
      setTimeout(function () { G.turn >= TURNS ? endGame() : nextTurn(); }, POST_REVEAL);
      return;
    }
    var item = seq[i];

    var proceed = function () {
      // After a queued player move, pop the next deferred new-play for that
      // location into the now-available slot (one per move that leaves).
      if (item.type === 'move' && item.owner === 'player') {
        var deferred = G.deferredPlays[item.fromLocId];
        if (deferred && deferred.length > 0) {
          var sd = deferred.shift();
          if (deferred.length === 0) delete G.deferredPlays[item.fromLocId];
          var fsi = G.playerSlots[item.fromLocId].indexOf(null);
          if (fsi !== -1) {
            G.playerSlots[item.fromLocId][fsi] = sd;
            syncPlayerSlots(item.fromLocId);
          }
        }
      }
      evaluateContinuous();
      refreshSlotIPDisplays();
      refreshHandIPDisplays();
      refreshHandCostDisplays();
      updateScores();
      setTimeout(function () { revealNext(seq, i + 1); }, REVEAL_DELAY);
    };

    if (item.type === 'move') {
      executeMoveAnimated(item.owner, item.cardId, item.fromLocId, item.toLocId, item.opts || {}, proceed);
      return;
    }

    // type === 'play'
    var slotEl = findSlotEl(item.owner, item.cardId);
    var rLocId = slotEl ? getCardLocId(item.owner, item.cardId) : null;
    var rSlots = item.owner === 'player' ? G.playerSlots : G.aiSlots;
    var rSi    = rLocId !== null
      ? rSlots[rLocId].findIndex(function (s) { return s && s.cardId === item.cardId; })
      : -1;
    var rSd    = rSi !== -1 ? rSlots[rLocId][rSi] : null;
    // Use data state (sd.revealed) rather than DOM class — syncPlayerSlots called during a
    // preceding move's applyMove can reset an unrevealed card back to face-up unplayed,
    // causing the DOM class check to miss the card and skip its reveal entirely.
    if (slotEl && rSd && !rSd.revealed) {
      if (!slotEl.classList.contains('face-down')) {
        slotEl.classList.remove('face-up', 'unplayed');
        slotEl.classList.add('face-down');
        slotEl.innerHTML = '';
      }
      // Wait for reveal animation + per-card SFX to finish, then fire ability
      flipSlot(slotEl, function () {
        fireAtOnce(item.owner, item.cardId, rLocId, proceed);
      });
    } else {
      proceed();
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     ABILITY ENGINE
  ═══════════════════════════════════════════════════════════════ */

  function fireAtOnce(owner, cardId, locId, done) {
    // Cards with actual At Once abilities: play sound + pulse animation
    // Cards 2, 3, 5, 13 have custom sfx — skip the generic 8-bit chime for those
    var hasAtOnce = [4, 8, 9, 23].indexOf(cardId) !== -1;
    if (hasAtOnce) {
      if (typeof SFX !== 'undefined') SFX.atOnce();
      var atSlotEl = findSlotEl(owner, cardId);
      if (atSlotEl && typeof Anim !== 'undefined') Anim.pulseYellow(atSlotEl);
    }
    switch (cardId) {
      case 2:  abilityScholarOfficials(owner, locId, done); break;
      case 3:  abilityJustinian(owner, locId, done);        break;
      case 4:  abilityEmpressWu(owner, locId, done);   break;
      case 5:  abilityPacal(owner, locId, done);      break;
      case 8:  abilityFrancisOfAssisi(owner, locId, done); break;
      case 9:  abilityErasmus(owner, locId, done);    break;
      case 13: abilityCortes(owner, locId, done);       break;
      case 23: abilityZhengHe(owner, locId, done);      break;
      default: done();
    }
  }

  function evaluateContinuous() {
    // Snapshot Voltaire's current contMod before clearing, so we can detect activation
    var voltairePrev = {};
    G.locations.forEach(function (loc) {
      ['player', 'opp'].forEach(function (own) {
        var sl = own === 'player' ? G.playerSlots : G.aiSlots;
        sl[loc.id].forEach(function (s) {
          if (s && s.revealed && s.cardId === 20)
            voltairePrev[own + ':' + loc.id] = s.contMod || 0;
        });
      });
    });

    // Clear contMod on all slots
    G.locations.forEach(function (loc) {
      ['player','opp'].forEach(function (own) {
        var sl = own === 'player' ? G.playerSlots : G.aiSlots;
        sl[loc.id].forEach(function (s) { if (s) s.contMod = 0; });
      });
    });

    G.locations.forEach(function (loc) {
      // Juvenal (id 18): -2 IP to all CC≥4 cards here (both sides)
      ['player','opp'].forEach(function (own) {
        var sl = own === 'player' ? G.playerSlots : G.aiSlots;
        if (sl[loc.id].some(function (s) { return s && s.revealed && s.cardId === 18; })) {
          ['player','opp'].forEach(function (to) {
            var ts = to === 'player' ? G.playerSlots : G.aiSlots;
            ts[loc.id].forEach(function (s) {
              if (!s || !s.revealed) return;
              var c = CARDS.find(function (x) { return x.id === s.cardId; });
              if (c && c.cc >= 4) s.contMod = (s.contMod || 0) - 2;
            });
          });
        }
      });

      // Voltaire (id 20): +4 IP if sole revealed card for that owner here
      ['player','opp'].forEach(function (own) {
        var sl  = own === 'player' ? G.playerSlots : G.aiSlots;
        var rev = sl[loc.id].filter(function (s) { return s && s.revealed; });
        if (rev.length === 1 && rev[0].cardId === 20)
          rev[0].contMod = (rev[0].contMod || 0) + 4;
      });

      // William the Conqueror (id 15): contMod = total destroyed IP for that owner
      G.playerSlots[loc.id].forEach(function (s) {
        if (s && s.revealed && s.cardId === 15)
          s.contMod = (s.contMod || 0) + G.destroyedIPTotal;
      });
      G.aiSlots[loc.id].forEach(function (s) {
        if (s && s.revealed && s.cardId === 15)
          s.contMod = (s.contMod || 0) + G.aiDestroyedIPTotal;
      });

      // The Sahara (ALL_MINUS_ONE_IP): -1 IP to ALL revealed cards here (both sides)
      if (loc.abilityKey === 'ALL_MINUS_ONE_IP') {
        ['player', 'opp'].forEach(function (own) {
          var sl = own === 'player' ? G.playerSlots : G.aiSlots;
          sl[loc.id].forEach(function (s) {
            if (s && s.revealed) s.contMod = (s.contMod || 0) - 1;
          });
        });
      }
    });

    // Fire Voltaire animation + sound when his bonus transitions 0 → +4
    G.locations.forEach(function (loc) {
      ['player', 'opp'].forEach(function (own) {
        var sl = own === 'player' ? G.playerSlots : G.aiSlots;
        sl[loc.id].forEach(function (s, si) {
          if (!s || !s.revealed || s.cardId !== 20) return;
          var prev = voltairePrev[own + ':' + loc.id] || 0;
          var next = s.contMod || 0;
          if (next > 0 && prev === 0) {
            var slotEl = getSlotEl(own, loc.id, si);
            if (typeof SFX  !== 'undefined') SFX.voltaireSound();
            if (typeof Anim !== 'undefined' && slotEl) {
              Anim.voltaireRock(slotEl);
              Anim.floatNumber(slotEl, 4);
            }
          }
        });
      });
    });

    // Update continuous glow on all revealed slots
    if (typeof Anim !== 'undefined') {
      G.locations.forEach(function (loc) {
        ['player', 'opp'].forEach(function (own) {
          var sl = own === 'player' ? G.playerSlots : G.aiSlots;
          sl[loc.id].forEach(function (s, si) {
            if (!s || !s.revealed) return;
            var slotEl = getSlotEl(own, loc.id, si);
            Anim.setGlow(slotEl, (s.contMod || 0) !== 0);
          });
        });
      });
      // Update Kente location glow on all tiles
      updateKenteGlows();
    }
  }

  /* Update the persistent orange Kente glow on each location tile.
     Called from evaluateContinuous() every time board state changes. */
  function updateKenteGlows() {
    if (typeof Anim === 'undefined') return;
    G.locations.forEach(function (loc) {
      var kenteOn = isKenteProtected(loc.id);
      var locTileEl = boardEl.querySelector('.battle-col[data-loc-id="' + loc.id + '"]');
      Anim.setKenteGlow(locTileEl, kenteOn);
    });
  }

  /**
   * Trigger William the Conqueror's border-flash animation on the player's William card.
   * Works whether William is in hand or in a board slot.
   * G.destroyedIPTotal must already be incremented before calling.
   * @param {number} ip  The IP just added (> 0)
   */
  /**
   * Update William's displayed IP number immediately (no sound/animation).
   * Called live as each card is destroyed so the number ticks up in real time.
   */
  function updateWilliamDisplay() {
    var williamEl = playerHandEl.querySelector('.battle-hand-card[data-id="15"]');
    var isOnBoard = false;
    if (!williamEl) { williamEl = findSlotEl('player', 15); isOnBoard = !!williamEl; }
    if (!williamEl) return;
    var ipEl = williamEl.querySelector('.db-overlay-ip');
    if (!ipEl) return;
    if (isOnBoard) {
      var wLocId = null, wSlotIdx = -1;
      G.locations.forEach(function (l) {
        if (wLocId !== null) return;
        var idx = G.playerSlots[l.id].findIndex(function (s) { return s && s.cardId === 15; });
        if (idx !== -1) { wLocId = l.id; wSlotIdx = idx; }
      });
      if (wLocId !== null) {
        var wSd = G.playerSlots[wLocId][wSlotIdx];
        wSd.contMod = G.destroyedIPTotal;
        ipEl.textContent = effectiveIP(wSd);
      }
    } else {
      var wCard = CARDS.find(function (c) { return c.id === 15; });
      if (wCard) ipEl.textContent = wCard.ip + (G.cardIPBonus[15] || 0) + G.destroyedIPTotal;
    }
  }

  /**
   * Play William's border-flash animation and sound, then call done() when finished.
   * Separated from updateWilliamDisplay so animations can be queued sequentially.
   * @param {Function} [done]  Called ~1050ms after the animation starts (optional).
   */
  function pulseWilliam(done) {
    var williamEl = playerHandEl.querySelector('.battle-hand-card[data-id="15"]');
    if (!williamEl) williamEl = findSlotEl('player', 15);
    if (!williamEl) { if (done) done(); return; }
    if (typeof SFX  !== 'undefined') SFX.williamGain();
    if (typeof Anim !== 'undefined') Anim.williamPulse(williamEl);
    if (done) setTimeout(done, 1050);
  }

  function isKenteProtected(locId) {
    return G.playerSlots[locId].some(function (s) { return s && s.revealed && s.cardId === 17; }) ||
           G.aiSlots[locId].some(    function (s) { return s && s.revealed && s.cardId === 17; });
  }

  /**
   * Destroy a card at a specific slot.
   * Checks Kente protection, tracks destroyed IP, fires conditional triggers,
   * then compacts/syncs the DOM.
   */
  function destroyCard(owner, locId, slotIndex, opts) {
    opts = opts || {};
    var slots = owner === 'player' ? G.playerSlots : G.aiSlots;
    var sd    = slots[locId][slotIndex];
    if (!sd) return;
    if (!opts.skipKente && isKenteProtected(locId)) return;

    var dIP    = effectiveIP(sd);
    var cardId = sd.cardId;
    if (owner === 'player') { G.destroyedIPTotal  += dIP; updateWilliamDisplay(); pulseWilliam(); }
    else                      G.aiDestroyedIPTotal += dIP;

    // Joan of Arc with a Religious card available → skip standard destroy anim,
    // hand off a ghost to triggerJoanOfArc for the special summon sequence
    var joanSpecial = cardId === 14 && owner === 'player' && G.playerHand.some(function (id) {
      var c = CARDS.find(function (x) { return x.id === id; });
      return c && c.type === 'Religious';
    });

    var dSlotEl = getSlotEl(owner, locId, slotIndex);

    if (joanSpecial) {
      var joanGhost = makeBoardGhost(dSlotEl, 150);
      slots[locId][slotIndex] = null;
      clearSlotDOM(owner, locId, slotIndex);
      if (owner === 'player') { compactPlayerSlots(locId); syncPlayerSlots(locId); }
      triggerJoanOfArc(locId, joanGhost);
      return;
    }

    // Ghost Jan Hus before clearing so the split animation has an element to work with
    var janHusGhost = (cardId === 7) ? makeBoardGhost(dSlotEl, 500) : null;

    // Save Samurai's ipMod before destruction so resurrection can restore it
    if (cardId === 12) {
      var savedKey = owner === 'player' ? '_samuraiSavedMod' : '_aiSamuraiSavedMod';
      G[savedKey] = { ipMod: sd.ipMod || 0, ipModSources: (sd.ipModSources || []).slice() };
    }

    if (typeof SFX !== 'undefined') SFX.cardDestroyed();
    if (dSlotEl && typeof Anim !== 'undefined') Anim.shake(dSlotEl);

    slots[locId][slotIndex] = null;
    clearSlotDOM(owner, locId, slotIndex);
    if (owner === 'player') { compactPlayerSlots(locId); syncPlayerSlots(locId); }
    else { compactOppSlots(locId); syncOppSlots(locId); }

    if (cardId === 7)  triggerJanHus(owner, janHusGhost, function () { if (janHusGhost) removeEl(janHusGhost); });
    if (cardId === 12) triggerSamurai(owner, locId);
    if (cardId === 14 && owner === 'opp') triggerJoanOfArcAI(locId);
    // Joan with no Religious card: no trigger — standard shake already queued above
  }

  /**
   * Discard a card from an owner's hand.
   * Removes from hand state/DOM and fires If/When-discarded triggers.
   */
  function discardFromHand(owner, cardId, callback) {
    if (typeof SFX !== 'undefined') SFX.cardDiscarded();
    var jesusEl  = null;
    var janHusEl = null;
    if (owner === 'player') {
      G.playerHand = G.playerHand.filter(function (id) { return id !== cardId; });
      var hEl = playerHandEl.querySelector('.battle-hand-card[data-id="' + cardId + '"]');
      if (hEl) {
        if (cardId === 10) { jesusEl  = hEl; }  // hold for Jesus ascend animation
        else if (cardId === 7) { janHusEl = hEl; }  // hold for Jan Hus split animation
        else               { hEl.remove(); }    // other discards: silent removal (no generic animation)
      }
    } else {
      G.aiHand = G.aiHand.filter(function (id) { return id !== cardId; });
    }
    if (cardId === 7) {
      triggerJanHus(owner, janHusEl, function () {
        if (janHusEl) removeEl(janHusEl);
        if (callback) callback();
      });
      return;
    }
    if (cardId === 10) { triggerJesusChrist(owner, jesusEl, callback); return; }
    if (callback) callback();
  }

  /* ── At Once ability implementations ────────────────────────── */

  function abilityScholarOfficials(owner, locId, done) {
    var slots = owner === 'player' ? G.playerSlots : G.aiSlots;
    // Count revealed cards at this location, excluding Scholar-Officials (id 2) itself
    var count = slots[locId].filter(function (s) { return s && s.revealed && s.cardId !== 2; }).length;
    if (owner === 'player') G.bonusCapitalNextTurn   += count;
    else                    G.aiBonusCapitalNextTurn += count;
    if (count > 0) {
      var slotIdx = slots[locId].findIndex(function (s) { return s && s.cardId === 2; });
      var slotEl  = slotIdx !== -1 ? getSlotEl(owner, locId, slotIdx) : null;
      if (typeof SFX  !== 'undefined') SFX.coinSound();
      if (typeof Anim !== 'undefined' && slotEl) {
        Anim.scholarPulse(slotEl);
        Anim.floatCapital(slotEl, count);
      }
      // Pulse each contributing card so viewers can see what's being counted
      if (typeof Anim !== 'undefined') {
        slots[locId].forEach(function (s, si) {
          if (!s || !s.revealed || s.cardId === 2) return;
          var contEl = getSlotEl(owner, locId, si);
          if (contEl) Anim.scholarPulse(contEl);
        });
      }
      // Animations run ~1s — wait before signalling next card
      setTimeout(done, 1050);
      return;
    }
    done();
  }

  function abilityJustinian(owner, locId, done) {
    if (typeof SFX !== 'undefined') SFX.justinianShing();

    // Flash Justinian's own card white
    var justinianEl = findSlotEl(owner, 3);
    if (justinianEl && typeof Anim !== 'undefined') Anim.justinianFlash(justinianEl);

    // Reset ipMod on ALL revealed cards here (both sides), show floats for any that changed
    var anyAffected = false;
    ['player', 'opp'].forEach(function (side) {
      var sl = side === 'player' ? G.playerSlots : G.aiSlots;
      sl[locId].forEach(function (s, si) {
        if (!s || !s.revealed) return;
        var oldMod = s.ipMod || 0;
        if (oldMod === 0) return;
        anyAffected = true;
        s.ipMod = 0;
        s.ipModSources = [];
        // If Samurai is reset, clear his accumulated resurrection bonus so the
        // next return starts fresh from base IP
        if (s.cardId === 12) {
          var samBonus = side === 'player' ? G.cardIPBonus : G.aiCardIPBonus;
          samBonus[12] = 0;
        }
        var slotEl = getSlotEl(side, locId, si);
        if (slotEl) {
          var ipEl = slotEl.querySelector('.db-overlay-ip');
          if (ipEl) ipEl.textContent = effectiveIP(s);
          if (typeof Anim !== 'undefined') Anim.justinianFlash(slotEl);
          if (typeof Anim !== 'undefined') Anim.floatNumber(slotEl, -oldMod);
        }
      });
    });

    // White flash is 600ms, float numbers are 750ms — wait for longest animation
    setTimeout(done, anyAffected ? 800 : 650);
  }

  function abilityEmpressWu(owner, locId, done) {
    done = done || function () {};
    var adjLocs = getAdjacentLocIds(locId);
    if (!adjLocs.length) { done(); return; }

    var oppSide  = owner === 'player' ? 'opp' : 'player';
    var oppSlots = oppSide === 'player' ? G.playerSlots : G.aiSlots;

    // Find the highest-IP Political/Military card on the opponent's side at this location
    var best = null;
    oppSlots[locId].forEach(function (s) {
      if (!s || !s.revealed) return;
      var c = CARDS.find(function (x) { return x.id === s.cardId; });
      if (!c || (c.type !== 'Political' && c.type !== 'Military')) return;
      var ip = effectiveIP(s);
      if (!best || ip > best.ip) best = { cardId: s.cardId, ip: ip };
    });
    if (!best) { done(); return; }

    // Find destination: prefer adjacent locations, but fall back to any other location
    // with space so Wu never destroys when a push is possible anywhere on the board.
    var destLocId = null;
    var oppDestSlots = oppSide === 'player' ? G.playerSlots : G.aiSlots;
    // First pass: adjacent locations (preferred)
    for (var i = 0; i < adjLocs.length; i++) {
      if (oppDestSlots[adjLocs[i]].indexOf(null) !== -1) { destLocId = adjLocs[i]; break; }
    }
    // Second pass: any other location if no adjacent slot found
    if (!destLocId) {
      for (var j = 0; j < G.locations.length; j++) {
        var lid = G.locations[j].id;
        if (lid !== locId && oppDestSlots[lid].indexOf(null) !== -1) { destLocId = lid; break; }
      }
    }
    var canPush = destLocId !== null;

    var destSlots = oppSide === 'player' ? G.playerSlots : G.aiSlots;
    var destIdx   = canPush ? destSlots[destLocId].indexOf(null) : -1;

    // ── Element refs ──────────────────────────────────────────────
    var wuEl    = findSlotEl(owner, 4);
    var tgtIdx  = oppSlots[locId].findIndex(function (s) { return s && s.cardId === best.cardId; });
    var tgtEl   = tgtIdx !== -1 ? getSlotEl(oppSide, locId, tgtIdx) : null;
    var destEl  = (canPush && destIdx !== -1) ? getSlotEl(oppSide, destLocId, destIdx) : null;

    // ── No-GSAP fallback ─────────────────────────────────────────
    if (!wuEl || typeof gsap === 'undefined') {
      if (canPush) {
        executeMoveAnimated(oppSide, best.cardId, locId, destLocId, {}, function () {
          updateScores(); evaluateContinuous(); refreshSlotIPDisplays(); done();
        });
      } else {
        destroyCard(oppSide, locId, tgtIdx);
        updateScores(); evaluateContinuous(); refreshSlotIPDisplays();
        done();
      }
      return;
    }

    // ── Snapshot positions before any state change ────────────────
    var wuRect   = wuEl.getBoundingClientRect();
    var tgtRect  = tgtEl  ? tgtEl.getBoundingClientRect()  : wuRect;
    var destRect = destEl ? destEl.getBoundingClientRect() : tgtRect;

    var wuCx  = wuRect.left  + wuRect.width  / 2;
    var wuCy  = wuRect.top   + wuRect.height / 2;
    var tgtCx = tgtRect.left + tgtRect.width  / 2;
    var tgtCy = tgtRect.top  + tgtRect.height / 2;

    // Wu flies 85% of the distance to target (stops just before contact)
    var flightX = (tgtCx - wuCx) * 0.85;
    var flightY = (tgtCy - wuCy) * 0.85;

    // Target flies from its current centre to destination slot centre
    var flyDx = (destRect.left + destRect.width  / 2) - tgtCx;
    var flyDy = (destRect.top  + destRect.height / 2) - tgtCy;

    // ── Create ghosts ─────────────────────────────────────────────
    var wuGhost  = makeBoardGhost(wuEl,  500);
    var tgtGhost = tgtEl ? makeBoardGhost(tgtEl, 499) : null;

    // Hide Wu's actual slot while ghost is animating
    gsap.set(wuEl, { opacity: 0 });

    // ── Completion counter (Wu timeline + target wobble) ──────────
    var pending = 2;
    function tryComplete() {
      if (--pending > 0) return;
      removeEl(wuGhost);
      gsap.set(wuEl, { clearProps: 'opacity' });
      updateScores(); evaluateContinuous(); refreshSlotIPDisplays();
      done();
    }

    // ── Wu animation timeline ─────────────────────────────────────
    var tl = gsap.timeline({ onComplete: tryComplete });

    // Rise toward target
    tl.to(wuGhost, { x: flightX, y: flightY, scale: 1.18,
                     duration: 0.32, ease: 'power2.in' });

    // At impact: play SFX, then push (via universal handler) or destroy
    tl.call(function () {
      if (typeof SFX !== 'undefined') SFX.wuPunch();

      if (canPush) {
        // ── Push path: route through universal movement handler ──
        // Hide the target's real slot so the ghost doesn't flicker against it
        if (tgtEl) gsap.set(tgtEl, { opacity: 0 });
        executeMoveAnimated(oppSide, best.cardId, locId, destLocId, {}, function () {
          if (tgtEl) gsap.set(tgtEl, { clearProps: 'opacity' });
          if (tgtGhost) { removeEl(tgtGhost); }
          tryComplete();
        });

      } else {
        // ── Destroy path: no space to push — obliterate the card ──
        destroyCard(oppSide, locId, tgtIdx);

        if (tgtGhost) {
          gsap.to(tgtGhost, {
            scale: 1.3, opacity: 0, duration: 0.35, ease: 'power2.out',
            onComplete: function () { removeEl(tgtGhost); tryComplete(); }
          });
        } else {
          tryComplete();
        }
      }
    });

    // Wu returns to her slot
    tl.to(wuGhost, { x: 0, y: 0, scale: 1.0,
                     duration: 0.28, ease: 'back.out(1.6)' });
  }

  function abilityPacal(owner, locId, done) {
    var slots = owner === 'player' ? G.playerSlots : G.aiSlots;
    // Collect other At Once cards at this location (exclude Pacal himself)
    var cards = [];
    slots[locId].forEach(function (s) {
      if (!s || !s.revealed || s.cardId === 5) return;
      var c = CARDS.find(function (x) { return x.id === s.cardId; });
      if (c && c.ability && c.ability.indexOf('At Once') !== -1) cards.push(s.cardId);
    });

    // Play Pacal's custom sound immediately
    if (typeof SFX !== 'undefined') SFX.pacalSound();

    // After wipe completes, re-fire each At Once ability one at a time
    function runCards() {
      var idx = 0;
      function next() {
        if (idx >= cards.length) { done(); return; }
        fireAtOnce(owner, cards[idx++], locId, next);
      }
      next();
    }

    // Clock-wipe over Pacal's card, then trigger the chain
    var pacalEl = findSlotEl(owner, 5);
    if (pacalEl && typeof Anim !== 'undefined') {
      Anim.pacalWipe(pacalEl, runCards);
    } else {
      runCards();
    }
  }

  function abilityFrancisOfAssisi(owner, locId, done) {
    var hand = owner === 'player' ? G.playerHand : G.aiHand;
    var best = null, bestCC = -1;
    hand.forEach(function (id) {
      var c = CARDS.find(function (x) { return x.id === id; });
      if (c && c.type === 'Religious' && c.cc > bestCC) { bestCC = c.cc; best = id; }
    });
    if (best === null) { done(); return; }
    if (owner === 'player') {
      // Play Francis sfx; once it ends, run the discard (which handles Jesus/Jan Hus chains)
      if (typeof SFX !== 'undefined') {
        SFX.francisSound(function () { discardFromHand('player', best, done); });
      } else {
        discardFromHand('player', best, done);
      }
      return;
    }
    // AI: sfx fires and forgets, discard proceeds immediately
    if (typeof SFX !== 'undefined') SFX.francisSound();
    discardFromHand(owner, best, done);
  }

  function abilityErasmus(owner, locId, done) {
    if (owner === 'opp') {
      // AI: discard a random hand card
      if (G.aiHand.length > 0) {
        if (typeof SFX !== 'undefined') SFX.erasmusSound();
        var pick = G.aiHand[Math.floor(Math.random() * G.aiHand.length)];
        discardFromHand('opp', pick);
      }
      done();
      return;
    }
    // Player: show chooser then resume
    if (G.playerHand.length === 0) { done(); return; }
    if (typeof SFX !== 'undefined') SFX.erasmusSound();
    showDiscardChooser('Choose a card to discard', G.playerHand.slice(), function (chosenId) {
      if (chosenId !== null) { discardFromHand('player', chosenId, done); return; }
      done();
    });
  }

  function abilityCortes(owner, locId, done) {
    var RISE_Y = -16;    // px upward during the sweep
    var slots    = owner === 'player' ? G.playerSlots : G.aiSlots;
    var cortesEl = findSlotEl(owner, 13);

    // ── Blocked: Kente is protecting ──────────────────────────────
    if (isKenteProtected(locId)) {
      if (!cortesEl || typeof gsap === 'undefined') { done(); return; }
      if (typeof SFX !== 'undefined') SFX.mute(true);
      if (typeof SFX !== 'undefined') SFX.cortesDeflate();
      gsap.timeline({
        onComplete: function () {
          gsap.set(cortesEl, { clearProps: 'scale,y' });
          if (typeof SFX !== 'undefined') SFX.mute(false);
          done();
        }
      })
        .to(cortesEl, { scale: 1.3, y: RISE_Y, duration: 0.25, ease: 'back.out(1.5)' })
        .to(cortesEl, { scale: 1.0, y: 0,      duration: 0.30, ease: 'power2.in' });
      return;
    }

    // ── Snapshot victims (all revealed at this loc except Cortes) ─
    var victims = [];
    slots[locId].forEach(function (s, idx) {
      if (!s || !s.revealed || s.cardId === 13) return;
      var el   = getSlotEl(owner, locId, idx);
      var rect = el ? el.getBoundingClientRect() : null;
      victims.push({ cardId: s.cardId, ip: effectiveIP(s), slotIdx: idx, el: el, rect: rect });
    });

    // No victims → nothing to do
    if (victims.length === 0) { done(); return; }

    // ── No GSAP: instant destroy (fallback) ───────────────────────
    if (!cortesEl || typeof gsap === 'undefined') {
      var ipGainedFB = 0, afterFnsFB = [];
      victims.forEach(function (v) {
        // Save Samurai's ipMod before destruction so resurrection can restore it
        if (v.cardId === 12) {
          var _fbKey = owner === 'player' ? '_samuraiSavedMod' : '_aiSamuraiSavedMod';
          var _fbSd  = slots[locId][v.slotIdx];
          if (_fbSd) G[_fbKey] = { ipMod: _fbSd.ipMod || 0, ipModSources: (_fbSd.ipModSources || []).slice() };
        }
        if (owner === 'player') { G.destroyedIPTotal  += v.ip; updateWilliamDisplay(); pulseWilliam(); }
        else                      G.aiDestroyedIPTotal += v.ip;
        slots[locId][v.slotIdx] = null;
        clearSlotDOM(owner, locId, v.slotIdx);
        ipGainedFB++;
        if (v.cardId === 7)                        afterFnsFB.push(function () { triggerJanHus(owner, null, function () {}); });
        if (v.cardId === 12)                       afterFnsFB.push(function () { triggerSamurai(owner, locId); });
        if (v.cardId === 14 && owner === 'player') afterFnsFB.push(function () { triggerJoanOfArc(locId); });
        if (v.cardId === 14 && owner === 'opp')    afterFnsFB.push(function () { triggerJoanOfArcAI(locId); });
      });
      if (owner === 'player') { compactPlayerSlots(locId); syncPlayerSlots(locId); }
      else                    { compactOppSlots(locId);    syncOppSlots(locId);    }
      afterFnsFB.forEach(function (fn) { fn(); });
      var cortesSdFB = slots[locId].find(function (s) { return s && s.cardId === 13; });
      if (cortesSdFB && ipGainedFB > 0) {
        addIPMod(cortesSdFB, ipGainedFB, 'Cortes');
        showIPFloat(owner, 13, ipGainedFB);
        var cIdx = slots[locId].indexOf(cortesSdFB);
        var cEl  = getSlotEl(owner, locId, cIdx);
        if (cEl) { var ipEl = cEl.querySelector('.db-overlay-ip'); if (ipEl) ipEl.textContent = effectiveIP(cortesSdFB); }
      }
      done();
      return;
    }

    // ── Animated success sequence ─────────────────────────────────
    // Sort right → left so Cortes sweeps from rightmost victim to leftmost
    victims.sort(function (a, b) { return b.slotIdx - a.slotIdx; });

    var cortesRect = cortesEl.getBoundingClientRect();

    // Destination after sweep: slot 0 (Cortes compacts here after victims cleared)
    var slot0El    = getSlotEl(owner, locId, 0);
    var slot0Rect  = slot0El ? slot0El.getBoundingClientRect() : cortesRect;
    var dxFinal    = (slot0Rect.left + slot0Rect.width  / 2) - (cortesRect.left + cortesRect.width  / 2);

    // Separate after-fns so Samurai always runs before Joan, regardless of slot order
    var samuraiAfterFn    = null;   // function(cb) — runs first
    var joanAfterFn       = null;   // function(cb) — runs second
    var otherAfterFns     = [];     // everything else (AI joan, etc.) — sync, runs last
    var ipGained          = 0;
    var williamPulseCount = 0;      // queued after Cortes ends, before Samurai/Joan

    if (typeof SFX !== 'undefined') SFX.mute(true);
    gsap.set(cortesEl, { zIndex: 100, position: 'relative' });

    var tl = gsap.timeline({
      onComplete: function () {
        // Rebuild DOM (cortesEl's old slot becomes empty, Cortes appears at slot 0)
        if (owner === 'player') { compactPlayerSlots(locId); syncPlayerSlots(locId); }
        else                    { compactOppSlots(locId);    syncOppSlots(locId);    }
        gsap.set(cortesEl, { clearProps: 'all' });

        // Unmute and update Cortes IP before any return animations start
        if (typeof SFX !== 'undefined') SFX.mute(false);
        var cortesSd = slots[locId].find(function (s) { return s && s.cardId === 13; });
        if (cortesSd && ipGained > 0) {
          addIPMod(cortesSd, ipGained, 'Cortes');
          showIPFloat(owner, 13, ipGained);
          var cIdx    = slots[locId].indexOf(cortesSd);
          var cSlotEl = getSlotEl(owner, locId, cIdx);
          if (cSlotEl) { var ipEl = cSlotEl.querySelector('.db-overlay-ip'); if (ipEl) ipEl.textContent = effectiveIP(cortesSd); }
        }

        // Sync afterFns: William pulses → Samurai → Joan → done()
        otherAfterFns.forEach(function (fn) { fn(); });

        // Find William's element once (board is compacted now)
        var wElFinal = playerHandEl.querySelector('.battle-hand-card[data-id="15"]') ||
                       findSlotEl('player', 15);

        // Order: (pause) → Samurai → (pause) → Joan → (pause) → William
        var orderedFns = [];
        if (samuraiAfterFn) {
          orderedFns.push(function (cb) { setTimeout(cb, 600); });
          orderedFns.push(samuraiAfterFn);
        }
        if (joanAfterFn) {
          // 800ms breathing room after Samurai before Joan begins
          if (samuraiAfterFn) {
            orderedFns.push(function (cb) { setTimeout(cb, 1100); });
          }
          // Wait for Cortes's audio to finish before Joan's audio starts
          orderedFns.push(function (cb) {
            if (typeof SFX !== 'undefined') SFX.afterCortesAudio(cb);
            else cb();
          });
          orderedFns.push(joanAfterFn);
        }
        // William comes last — 800ms pause before his sfx/animation
        if (williamPulseCount > 0) {
          orderedFns.push(function (cb) { setTimeout(cb, 1100); });
          orderedFns.push((function (el) {
            return function (cb) {
              if (!el) { cb(); return; }
              if (typeof SFX  !== 'undefined') SFX.williamGain();
              if (typeof Anim !== 'undefined') Anim.williamPulse(el);
              setTimeout(cb, 1050);
            };
          })(wElFinal));
        }
        var seqIdx = 0;
        function runNext() {
          if (seqIdx >= orderedFns.length) { done(); return; }
          orderedFns[seqIdx++](runNext);
        }
        runNext();
      }
    });

    // Rise and grow
    tl.to(cortesEl, { scale: 1.3, y: RISE_Y, duration: 0.28, ease: 'back.out(1.5)' });
    // Fire charge sound at the peak of the rise
    tl.call(function () { if (typeof SFX !== 'undefined') SFX.cortesCharge(); });

    // Sweep right → left through each victim
    victims.forEach(function (v) {
      var dx = v.rect ? (v.rect.left + v.rect.width  / 2) - (cortesRect.left + cortesRect.width  / 2) : 0;

      // Joan of Arc with a Religious card available → skip shake/fade; ghost will rise later
      var joanSpecial = v.cardId === 14 && owner === 'player' && G.playerHand.some(function (id) {
        var c = CARDS.find(function (x) { return x.id === id; });
        return c && c.type === 'Religious';
      });
      // Jan Hus ghost captured now (before the fade tween runs) so triggerJanHus has an element
      var janHusGhost = (v.cardId === 7 && v.el) ? makeBoardGhost(v.el, 500) : null;

      // Slide Cortes to victim position (maintain rise elevation)
      tl.to(cortesEl, { x: dx, y: RISE_Y, duration: 0.22, ease: 'power2.inOut' });

      // Shake + fade victim (skipped for Joan when she'll summon instead)
      if (v.el && !joanSpecial) {
        tl.to(v.el, { x: -8, duration: 0.05, ease: 'power1.inOut' }, '<')
          .to(v.el, { x:  8, duration: 0.05 })
          .to(v.el, { x: -5, duration: 0.04 })
          .to(v.el, { x:  0, duration: 0.04 })
          .to(v.el, { opacity: 0, scale: 0.7, duration: 0.18, ease: 'power2.in' }, '<0.06');
      }

      // Update game state once victim has faded (or Cortes passes over Joan)
      tl.call((function (victim, isJoanSpecial, jhGhost) {
        return function () {
          var sIdx = slots[locId].findIndex(function (s) { return s && s.cardId === victim.cardId; });
          if (sIdx === -1) return;

          // For Joan-special: ghost her card face before clearing so it persists for summon anim
          var joanGhost = isJoanSpecial ? makeBoardGhost(victim.el, 150) : null;

          // Save Samurai's ipMod before destruction so resurrection can restore it
          if (victim.cardId === 12) {
            var _savedKey = owner === 'player' ? '_samuraiSavedMod' : '_aiSamuraiSavedMod';
            var _sd = slots[locId][sIdx];
            G[_savedKey] = { ipMod: _sd.ipMod || 0, ipModSources: (_sd.ipModSources || []).slice() };
          }

          // Update William's IP display live as each card falls; queue the sound/anim for after Cortes
          if (owner === 'player') { G.destroyedIPTotal += victim.ip; updateWilliamDisplay(); williamPulseCount++; }
          else                      G.aiDestroyedIPTotal += victim.ip;

          slots[locId][sIdx] = null;
          clearSlotDOM(owner, locId, sIdx);
          if (victim.el) gsap.set(victim.el, { clearProps: 'all' });
          ipGained++;

          // Store in named slots — Samurai first, Joan second in the sequential runner
          if (victim.cardId === 12)
            samuraiAfterFn = function (cb) { triggerSamurai(owner, locId, cb); };
          if (isJoanSpecial)
            joanAfterFn    = function (cb) { triggerJoanOfArc(locId, joanGhost, cb); };
          if (victim.cardId === 14 && owner === 'opp')
            otherAfterFns.push(function () { triggerJoanOfArcAI(locId); });
          if (victim.cardId === 7)
            otherAfterFns.push((function (ghost) {
              return function () { triggerJanHus(owner, ghost, function () { if (ghost) removeEl(ghost); }); };
            })(jhGhost));
        };
      })(v, joanSpecial, janHusGhost));
    });

    // Glide to slot 0 position and settle down
    tl.to(cortesEl, { x: dxFinal, y: 0, duration: 0.30, ease: 'power2.out' })
      .to(cortesEl, { scale: 1.0, duration: 0.20, ease: 'power2.inOut' }, '<0.10');
  }

  function abilityZhengHe(owner, locId, done) {
    var slots   = owner === 'player' ? G.playerSlots : G.aiSlots;
    var adjLocs = getAdjacentLocIds(locId);
    var anyAffected = false;
    adjLocs.forEach(function (adjLocId) {
      var found = false;
      slots[adjLocId].forEach(function (s, si) {
        if (!found && s && s.revealed) {
          addIPMod(s, 2, 'Zheng He');
          // Bounce animation + float number (replaces plain showIPFloat)
          var adjSlotEl = getSlotEl(owner, adjLocId, si);
          if (adjSlotEl && typeof Anim !== 'undefined') {
            Anim.zhengheBounce(adjSlotEl);
          } else {
            showIPFloat(owner, s.cardId, 2);
          }
          found = true;
          anyAffected = true;
        }
      });
    });
    if (anyAffected && typeof SFX !== 'undefined') SFX.zhengheSound();
    // bounce + float animation runs ~750 ms — wait before signalling next card
    setTimeout(done, anyAffected ? 800 : 0);
  }

  function getAdjacentLocIds(locId) {
    var idx = G.locations.findIndex(function (l) { return l.id === locId; });
    var res = [];
    if (idx > 0)                      res.push(G.locations[idx - 1].id);
    if (idx < G.locations.length - 1) res.push(G.locations[idx + 1].id);
    return res;
  }

  /* ── Conditional triggers ────────────────────────────────────── */

  function triggerJanHus(owner, splitEl, done) {
    if (typeof SFX !== 'undefined') SFX.janHusSplit();

    function applyBuffs() {
      var slots = owner === 'player' ? G.playerSlots : G.aiSlots;
      var affected = [];
      G.locations.forEach(function (loc) {
        slots[loc.id].forEach(function (s) {
          if (s && s.revealed) {
            addIPMod(s, 1, 'Jan Hus');
            affected.push({ owner: owner, cardId: s.cardId });
          }
        });
      });
      refreshSlotIPDisplays();
      updateScores();
      // Staggered +1 floats
      affected.forEach(function (item, i) {
        setTimeout(function () {
          showIPFloat(item.owner, item.cardId, 1);
          if (typeof SFX !== 'undefined') SFX.ipGained();
        }, i * 150);
      });
      var totalDelay = affected.length * 150 + 400;
      setTimeout(function () { if (done) done(); }, totalDelay);
    }

    if (typeof Anim !== 'undefined' && splitEl) {
      Anim.janHusSplit(splitEl, applyBuffs);
    } else {
      applyBuffs();
    }
  }

  function triggerJesusChrist(owner, handCardEl, callback) {
    var jBonus = owner === 'player' ? G.cardIPBonus : G.aiCardIPBonus;
    jBonus[10] = (jBonus[10] || 0) + 3;

    if (owner !== 'player') {
      // AI path — no animation needed
      G.aiHand.push(10);
      if (callback) callback();
      return;
    }

    // Player path — ascend animation, then return to hand with glow + sound
    function doReturn() {
      G.playerHand.push(10);
      window.setPlayerHand(G.playerHand, G.playerDeck.length);
      bindHandEvents();
      refreshHandIPDisplays();
      var newJesusEl = playerHandEl.querySelector('.battle-hand-card[data-id="10"]');
      if (newJesusEl && typeof Anim !== 'undefined') Anim.jesusReturn(newJesusEl);
      if (typeof SFX !== 'undefined') {
        SFX.jesusReturn(callback);  // game resumes 500 ms after the track ends
      } else {
        if (callback) callback();
      }
    }

    if (typeof Anim !== 'undefined' && handCardEl) {
      Anim.jesusAscend(handCardEl, doReturn);
    } else {
      if (handCardEl) handCardEl.remove();
      doReturn();
    }
  }

  function triggerSamurai(owner, locId, done) {
    console.log('[Samurai] triggerSamurai called — owner:', owner, 'locId:', locId);
    var sBonus   = owner === 'player' ? G.cardIPBonus : G.aiCardIPBonus;
    var prevBonus = sBonus[12] || 0;
    var newBonus  = prevBonus + 2;

    // Retrieve any saved ipMod from the destroyed Samurai (Zheng He, Columbus, etc.)
    var savedKey = owner === 'player' ? '_samuraiSavedMod' : '_aiSamuraiSavedMod';
    var savedMod = G[savedKey] || { ipMod: 0, ipModSources: [] };
    delete G[savedKey];

    // Zero out before placeRevealedCard so base IP stays at card.ip (2),
    // then apply the full cumulative as a named ipMod so Justinian can reset it.
    sBonus[12] = 0;
    var placed = placeRevealedCard(owner, locId, 12, 0, { skipLocationAbility: true });
    sBonus[12] = newBonus;
    console.log('[Samurai] placeRevealedCard returned:', placed, '| newBonus:', newBonus);

    var sSlots = owner === 'player' ? G.playerSlots : G.aiSlots;
    var sIdx   = sSlots[locId].findIndex(function (s) { return s && s.cardId === 12; });
    var slotEl = sIdx !== -1 ? getSlotEl(owner, locId, sIdx) : null;

    if (sIdx !== -1) {
      var sd = sSlots[locId][sIdx];
      // newBonus = cumulative resurrection chain (+2 per death).
      // savedMod may contain external bonuses (Zheng He, Columbus, etc.)
      // that lived alongside the prior chain bonus in the old slot's ipMod.
      // Subtract the prior chain (prevBonus) from savedMod to isolate external-only mods.
      var externalMod     = Math.max(0, (savedMod.ipMod || 0) - prevBonus);
      var externalSources = savedMod.ipModSources.filter(function (s) { return s.source !== 'Cortes'; });
      var totalMod = newBonus + externalMod;
      var sources  = externalSources.slice();
      sources.push({ source: 'Cortes', delta: newBonus });
      sd.ipMod        = totalMod;
      sd.ipModSources = sources;
      if (slotEl) {
        var ipEl = slotEl.querySelector('.db-overlay-ip');
        if (ipEl) ipEl.textContent = effectiveIP(sd);
      }
    }

    function finish() {
      if (slotEl && typeof Anim !== 'undefined') Anim.ripple(slotEl);
      if (done) done();
    }

    if (!slotEl || typeof gsap === 'undefined') {
      console.log('[Samurai] triggerSamurai — no slotEl or no GSAP, finishing immediately');
      if (typeof SFX !== 'undefined') SFX.samuraiReturn();
      finish();
      return;
    }

    console.log('[Samurai] triggerSamurai — playing return SFX + spin animation');
    if (typeof SFX !== 'undefined') SFX.samuraiReturn();

    gsap.fromTo(slotEl,
      { rotationY: 360, transformPerspective: 800, backfaceVisibility: 'hidden' },
      {
        rotationY: 0, transformPerspective: 800, backfaceVisibility: 'hidden',
        duration:  0.65,
        ease:      'back.out(1.2)',
        onComplete: function () {
          gsap.set(slotEl, { clearProps: 'all' });
          finish();
        }
      }
    );
  }

  function triggerJoanOfArc(locId, joanGhost, done) {
    // Pick a random Religious card from hand
    var religiousIds = G.playerHand.filter(function (id) {
      var c = CARDS.find(function (x) { return x.id === id; });
      return c && c.type === 'Religious';
    });
    if (religiousIds.length === 0) {
      removeGhost(joanGhost);
      if (done) done();
      return;
    }
    var religiousId = religiousIds[Math.floor(Math.random() * religiousIds.length)];

    // Place the summoned card in game state + DOM immediately (initially hidden)
    placeRevealedCard('player', locId, religiousId, 0, { skipLocationAbility: true });
    var destIdx    = G.playerSlots[locId].findIndex(function (s) { return s && s.cardId === religiousId; });
    var destSlotEl = destIdx !== -1 ? getSlotEl('player', locId, destIdx) : null;
    if (destSlotEl && typeof gsap !== 'undefined') gsap.set(destSlotEl, { opacity: 0 });

    // Remove summoned card from hand
    G.playerHand = G.playerHand.filter(function (id) { return id !== religiousId; });
    var hEl = playerHandEl.querySelector('.battle-hand-card[data-id="' + religiousId + '"]');

    // No GSAP → instant, no animation (opacity was never set since gsap unavailable)
    if (typeof gsap === 'undefined') {
      removeGhost(joanGhost);
      if (hEl) hEl.remove();
      window.setPlayerHand(G.playerHand, G.playerDeck.length);
      bindHandEvents(); refreshHandIPDisplays(); refreshHandCostDisplays();
      if (done) done();
      return;
    }

    // Play the Joan ability sound
    if (typeof SFX !== 'undefined') SFX.joanRise();

    // Ghost the hand card so it can fly independently
    var handGhost = hEl ? makeBoardGhost(hEl, 9999) : null;
    if (hEl) hEl.remove();
    window.setPlayerHand(G.playerHand, G.playerDeck.length);
    bindHandEvents(); refreshHandIPDisplays(); refreshHandCostDisplays();

    var tl = gsap.timeline();

    // Joan ghost rises and fades out of her slot (t = 0)
    if (joanGhost) {
      tl.to(joanGhost, {
        y:        -80,
        opacity:  0,
        duration: 0.55,
        ease:     'power2.out',
        onComplete: function () { removeGhost(joanGhost); }
      }, 0);
    }

    // Hand card ghost flies from hand up to destination slot (t = 0.15)
    if (handGhost && destSlotEl) {
      var destRect = destSlotEl.getBoundingClientRect();
      var srcRect  = handGhost.getBoundingClientRect();
      var flyDx    = (destRect.left + destRect.width  / 2) - (srcRect.left + srcRect.width  / 2);
      var flyDy    = (destRect.top  + destRect.height / 2) - (srcRect.top  + srcRect.height / 2);
      tl.to(handGhost, {
        x:        flyDx,
        y:        flyDy,
        duration: 0.50,
        ease:     'power2.inOut',
        onComplete: function () { removeGhost(handGhost); }
      }, 0.15);
    }

    // Reveal destination slot + pulse once ghost has landed (t ≈ 0.65)
    tl.call(function () {
      if (destSlotEl) {
        gsap.set(destSlotEl, { clearProps: 'opacity' });
        if (typeof Anim !== 'undefined') {
          Anim.cardReveal(destSlotEl);
          Anim.ripple(destSlotEl);
        }
      }
      // Fire the summoned card's At Once ability (if any); default case just calls done()
      fireAtOnce('player', religiousId, locId, done || function () {});
    }, null, 0.65);
  }

  function triggerJoanOfArcAI(locId) {
    var religiousId = G.aiHand.find(function (id) {
      var c = CARDS.find(function (x) { return x.id === id; });
      return c && c.type === 'Religious';
    });
    if (religiousId === undefined) return;
    G.aiHand = G.aiHand.filter(function (id) { return id !== religiousId; });
    placeRevealedCard('opp', locId, religiousId, 0, { skipLocationAbility: true });
  }

  /* ═══════════════════════════════════════════════════════════════
     DISCARD CHOOSER UI  (Erasmus + Francis of Assisi)
  ═══════════════════════════════════════════════════════════════ */

  /** Build one visual card element for the discard chooser. */
  function buildChooserCard(card, cardId) {
    var bonus = G.cardIPBonus[cardId] || 0;
    var el = document.createElement('div');
    el.className = 'discard-card-option';

    var imgWrap = document.createElement('div');
    imgWrap.className = 'db-card-img-wrap';

    var ph = document.createElement('div');
    ph.className  = 'db-card-img-placeholder';
    ph.textContent = card.name.charAt(0);

    var img = document.createElement('img');
    img.className = 'db-card-img';
    img.alt = card.name;
    img.src = 'images/cards/' + card.name + '.jpg';
    img.onerror = function () { this.style.display = 'none'; };

    imgWrap.appendChild(ph);
    imgWrap.appendChild(img);

    var ccEl = document.createElement('div');
    ccEl.className   = 'db-overlay-cc';
    ccEl.textContent = card.cc;

    var ipEl = document.createElement('div');
    ipEl.className   = 'db-overlay-ip';
    ipEl.textContent = card.ip + bonus;

    el.appendChild(imgWrap);
    el.appendChild(ccEl);
    el.appendChild(ipEl);
    return el;
  }

  /**
   * Erasmus chooser — shows all hand cards as clickable images.
   * callback(cardId) fires with the chosen card id.
   */
  function showDiscardChooser(title, cardIds, callback) {
    var backdrop = document.createElement('div');
    backdrop.className = 'discard-backdrop';

    var panel = document.createElement('div');
    panel.className = 'discard-panel';

    var titleEl = document.createElement('div');
    titleEl.className   = 'discard-title';
    titleEl.textContent = title;
    panel.appendChild(titleEl);

    var row = document.createElement('div');
    row.className = 'discard-card-row';

    cardIds.forEach(function (cardId) {
      var card = CARDS.find(function (c) { return c.id === cardId; });
      if (!card) return;
      var cardEl = buildChooserCard(card, cardId);
      cardEl.addEventListener('click', function () {
        document.body.removeChild(backdrop);
        callback(cardId);
      });
      row.appendChild(cardEl);
    });

    panel.appendChild(row);
    backdrop.appendChild(panel);
    document.body.appendChild(backdrop);
  }


  /* ═══════════════════════════════════════════════════════════════
     NEXT TURN / END GAME
  ═══════════════════════════════════════════════════════════════ */

  function nextTurn() {
    G.turn    += 1;
    G.phase    = 'select';
    G.capital  = CAPITAL + G.bonusCapitalNextTurn;
    G.turnStartCapital     = G.capital;
    G.bonusCapitalNextTurn = 0;
    dragInfo   = null;

    var playerDrew = G.playerRevealQueue.length;
    var aiDrew     = G.aiRevealQueue.length;
    G.playerRevealQueue = [];
    G.aiRevealQueue     = [];
    G.playerFirst       = !G.playerFirst;
    showRevealFirstHighlight(G.playerFirst);
    G.movedThisTurn          = {};
    G.aiMovedThisTurn        = {};
    G.moveLog                = [];
    G.playerActionLog        = [];
    G.locationSnapshots      = {};
    G.reservedSlotsPerLoc    = {};
    G.deferredPlays          = {};

    var playerCanDraw = Math.min(playerDrew, Math.max(0, MAX_HAND_SIZE - G.playerHand.length));
    var aiCanDraw     = Math.min(aiDrew,     Math.max(0, MAX_HAND_SIZE - G.aiHand.length));
    G.playerDeck.splice(0, playerCanDraw).forEach(function (id) { G.playerHand.push(id); });
    G.aiDeck.splice(0, aiCanDraw).forEach(function (id) { G.aiHand.push(id); });

    window.setPlayerHand(G.playerHand, G.playerDeck.length);
    updateOppHand();
    refreshHandIPDisplays();
    refreshHandCostDisplays();
    updateHeader();
    bindHandEvents();
    refreshMoveableCards();

    endTurnBtn.textContent     = 'END TURN';
    endTurnBtn.disabled        = false;
    resetTurnBtn.disabled      = false;
    resetTurnBtn.style.display = '';
    _startSelectionTimer();

    if (typeof Analytics !== 'undefined') Analytics.turnStarted();
  }

  function endGame() {
    _stopSelectionTimer();
    _cancelUndoEndTurn();
    G.phase = 'over';
    refreshMoveableCards();
    var result = tallyResult();
    if (typeof Analytics !== 'undefined') Analytics.gameCompleted(result);
    showResult(result);

    /* Progression: track wins for card unlocking (single-player only) */
    if (result.outcome === 'player' &&
        typeof Progression !== 'undefined' &&
        !window.matchId && !window.versusStudentMode && !window.tournamentMatch) {
      Progression.recordWin(window.aiDifficulty);
    }

    /* 2P mode: P1 writes match result; both players clear Match state */
    if (window.matchId && typeof Match !== 'undefined') {
      if (window.p1OrP2 === 'p1') {
        Match.reportResult(result.outcome, result.playerTotal, result.aiTotal);
      }
      Match.reset();
      window.matchId  = null;
      window.p1OrP2   = null;
    }

    headerPhaseEl.textContent = 'GAME OVER';
    endTurnBtn.disabled       = true;
    resetTurnBtn.disabled     = true;

    // Location win animations
    if (typeof Anim !== 'undefined') {
      result.locResults.forEach(function (lr) {
        if (lr.winner !== 'tie') {
          var locTile = boardEl.querySelector('.battle-location[data-loc-id="' + lr.loc.id + '"]');
          if (locTile) Anim.locationWin(locTile);
        }
      });
    }

    // Stop background music before game-over sounds play
    stopBgMusic();

    /* Shared helper — shows result screen + headline animation */
    var _showResultScreen = function () {
      showScreen('screen-result');
      if (typeof Anim !== 'undefined') {
        if      (result.outcome === 'player') Anim.celebration();
        else if (result.outcome === 'ai')     Anim.sadResult();
      }
      // Vs AI / Multiplayer match completion — feeds the feedback
      // counter + home-button visibility. Tutorial uses its own
      // showScreen('screen-result') in tutorial.js, so it doesn't
      // reach this code path.
      if (window.Feedback && typeof window.Feedback.recordMatchCompleted === 'function') {
        window.Feedback.recordMatchCompleted();
      }
    };

    /* Tournament champion: Final knockout win always triggers the legend screen */
    var _isTournamentChampion = result.outcome === 'player' &&
                                window.tournamentMatch === 'knockout' &&
                                window.currentKORound  === 'final' &&
                                typeof LegendScreen !== 'undefined';

    /* 5-win session milestone — disabled; replaced by 10-win victory montage in Progression */
    var _isSessionMilestone = false;

    var _isLegendMilestone = _isTournamentChampion || _isSessionMilestone;

    if (_isLegendMilestone) {
      /* Brief pause so board location-win animations are visible, then cut to legend */
      setTimeout(function () {
        var showFn = (_isTournamentChampion && LegendScreen.showChampion)
          ? function (cb) { LegendScreen.showChampion(window.currentLobbyId || '', cb); }
          : function (cb) { LegendScreen.show(cb); };

        showFn(function () {
          /* Legend clicked through — play win sound then show result screen */
          if (typeof SFX !== 'undefined') SFX.gameWon();
          _showResultScreen();
        });
      }, 800);
    } else {
      /* Normal path */
      if (typeof SFX !== 'undefined') {
        if      (result.outcome === 'player') SFX.gameWon();
        else if (result.outcome === 'ai')     SFX.gameLost();
        else                                  SFX.locationWon();
      }
      setTimeout(_showResultScreen, 1000);
    }
  }

  function tallyResult() {
    var locResults = G.locations.map(function (loc) {
      var pIP = G.playerSlots[loc.id].reduce(function (s, x) { return s + (x ? effectiveIP(x) : 0); }, 0);
      var aIP = G.aiSlots[loc.id].reduce(    function (s, x) { return s + (x ? effectiveIP(x) : 0); }, 0);
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
    return { outcome: outcome, tiebreaker: tb, playerWins: pW, aiWins: aW,
             playerTotal: pT, aiTotal: aT, locResults: locResults };
  }

  function showResult(r) {
    var hEl    = document.getElementById('result-headline');
    var subEl  = document.getElementById('result-subline');
    var locsEl = document.getElementById('result-locs');
    var tbEl   = document.getElementById('result-tiebreaker');

    var isGiantWin = r.outcome === 'player' && window.aiDifficulty === 'hard';
    hEl.className   = 'result-headline ' + (isGiantWin ? 'result-giant' : 'result-' + r.outcome);
    hEl.textContent = isGiantWin         ? 'GIANT VICTORY!'
                    : r.outcome === 'player' ? 'VICTORY'
                    : r.outcome === 'ai'     ? 'DEFEAT'
                    : 'DRAW';

    if (r.tiebreaker) {
      subEl.textContent = r.outcome === 'draw'
        ? 'Total IP tied — the game is a draw'
        : (r.outcome === 'player' ? 'You' : 'Opponent') + ' won on total IP across all 3 locations';
    } else {
      var w = r.outcome === 'player' ? r.playerWins : r.aiWins;
      subEl.textContent = (r.outcome === 'player' ? 'You' : 'Opponent') + ' won ' + w + ' of 3 locations';
    }

    locsEl.innerHTML = '';
    r.locResults.forEach(function (lr) {
      var row = document.createElement('div'); row.className = 'result-loc-row';
      var nm  = document.createElement('div'); nm.className = 'result-loc-name'; nm.textContent = lr.loc.name;
      var sc  = document.createElement('div'); sc.className = 'result-loc-scores';
      var yu  = document.createElement('span');
      yu.className   = 'result-loc-you' + (lr.winner === 'player' ? ' result-loc-winner' : '');
      yu.textContent = 'You: ' + lr.playerIP;
      var vs  = document.createElement('span'); vs.className = 'result-loc-vs'; vs.textContent = 'vs';
      var op  = document.createElement('span');
      op.className   = 'result-loc-opp' + (lr.winner === 'ai' ? ' result-loc-winner' : '');
      op.textContent = 'Opp: ' + lr.aiIP;
      sc.appendChild(yu); sc.appendChild(vs); sc.appendChild(op);
      var bd  = document.createElement('div');
      bd.className   = 'result-loc-badge result-loc-badge-' + lr.winner;
      bd.textContent = lr.winner === 'player' ? 'YOU' : lr.winner === 'ai' ? 'OPP' : 'TIE';
      row.appendChild(nm); row.appendChild(sc); row.appendChild(bd);
      locsEl.appendChild(row);
    });

    if (r.tiebreaker) {
      document.getElementById('result-tb-player').textContent = r.playerTotal;
      document.getElementById('result-tb-ai').textContent     = r.aiTotal;
      tbEl.style.display = '';
    } else {
      tbEl.style.display = 'none';
    }

    /* Show/hide lobby return button */
    var lobbyBtn = document.getElementById('result-return-lobby');
    if (lobbyBtn) {
      lobbyBtn.style.display = window.currentLobbyCode ? '' : 'none';
    }

    /* Tournament match: record result */
    if (window.tournamentMatch && window.currentLobbyCode) {
      var outcome = r.outcome === 'player' ? 'win'
                  : r.outcome === 'ai'     ? 'loss'
                  :                          'draw';
      if (window.tournamentMatch === 'knockout') {
        if (window.Multiplayer && typeof window.Multiplayer.recordKnockoutResult === 'function') {
          window.Multiplayer.recordKnockoutResult(outcome);
        }
      } else if (window.tournamentMatch !== 'versus') {
        if (window.Multiplayer && typeof window.Multiplayer.recordGroupResult === 'function') {
          window.Multiplayer.recordGroupResult(outcome);
        }
      }
    }

    /* Versus mode: 35-second auto-return to lobby */
    if (window.tournamentMatch === 'versus') {
      var vsWrap = document.getElementById('vs-result-return-wrap');
      var vsNum  = document.getElementById('vs-result-return-num');
      if (vsWrap) vsWrap.classList.add('visible');
      var vsLeft = 35;
      if (vsNum) vsNum.textContent = vsLeft;
      var vsTimer = setInterval(function () {
        vsLeft--;
        if (vsNum) vsNum.textContent = vsLeft;
        if (vsLeft <= 0) {
          clearInterval(vsTimer);
          if (vsWrap) vsWrap.classList.remove('visible');
          if (window.BattleLobby && typeof window.BattleLobby.returnToLobby === 'function') {
            window.BattleLobby.returnToLobby();
          }
        }
      }, 1000);
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     CARD INFO POPUP
  ═══════════════════════════════════════════════════════════════ */

  /**
   * Build an IP breakdown string for a revealed board card.
   * Shows base + labeled permanent bonus + labeled continuous effects + total.
   */
  function buildIPBreakdown(sd, owner) {
    var parts = ['Base IP: ' + sd.ip];

    // Permanent modifier sources (tracked per-card)
    if (sd.ipModSources && sd.ipModSources.length > 0) {
      sd.ipModSources.forEach(function (entry) {
        parts.push(entry.source + ': ' + (entry.delta >= 0 ? '+' : '') + entry.delta);
      });
    } else if (sd.ipMod) {
      parts.push('Bonus: ' + (sd.ipMod > 0 ? '+' : '') + sd.ipMod);
    }

    // Continuous modifier labels derived from current board state
    var slots  = owner === 'player' ? G.playerSlots : G.aiSlots;
    var locId  = null;
    G.locations.forEach(function (loc) {
      slots[loc.id].forEach(function (s) { if (s && s.cardId === sd.cardId) locId = loc.id; });
    });

    if (locId !== null) {
      var card = CARDS.find(function (c) { return c.id === sd.cardId; });

      // Juvenal (id 18): -2 to CC≥4 cards at this location (either side)
      var juvenalHere = ['player', 'opp'].some(function (own) {
        var sl = own === 'player' ? G.playerSlots : G.aiSlots;
        return sl[locId].some(function (s) { return s && s.revealed && s.cardId === 18; });
      });
      if (juvenalHere && card && card.cc >= 4) parts.push('Juvenal: -2');

      // Voltaire (id 20): +4 if sole revealed card for this owner
      var ownerRev = slots[locId].filter(function (s) { return s && s.revealed; });
      if (ownerRev.length === 1 && sd.cardId === 20) parts.push('Voltaire (Candide): +4');

      // William the Conqueror (id 15): contMod equals total destroyed IP
      if (sd.cardId === 15) {
        var dt = owner === 'player' ? G.destroyedIPTotal : G.aiDestroyedIPTotal;
        if (dt > 0) parts.push('William: +' + dt);
      }
    }

    parts.push('Total: ' + effectiveIP(sd));
    return parts.join('  |  ');
  }

  /**
   * Open the battle card info popup.
   * @param {object} card      Card data from CARDS array
   * @param {object} [sd]      Slot data (for revealed board cards — shows IP breakdown)
   * @param {string} [owner]   'player' | 'opp' (required when sd is provided)
   * @param {boolean} [isBoard] True when called from a board slot (changes hint text)
   */
  function openBattlePopup(card, sd, owner, isBoard) {
    battlePopupNameEl.textContent = card.name;

    if (sd && battlePopupIPBrkEl) {
      battlePopupIPBrkEl.textContent = buildIPBreakdown(sd, owner);
      battlePopupIPBrkEl.style.display = '';
    } else if (battlePopupIPBrkEl) {
      battlePopupIPBrkEl.style.display = 'none';
    }

    if (battlePopupHintEl) {
      battlePopupHintEl.textContent = isBoard ? 'CLICK CARD FOR INFO' : 'DRAG CARD TO A SLOT TO PLAY';
    }

    if (card.ability) {
      battlePopupAbilNmEl.textContent   = card.abilityName;
      battlePopupAbilNmEl.style.display = '';
      battlePopupAbilTxEl.textContent   = card.ability;
      battlePopupAbilTxEl.className     = 'popup-ability-text';
    } else {
      battlePopupAbilNmEl.style.display = 'none';
      battlePopupAbilTxEl.textContent   = 'No special ability.';
      battlePopupAbilTxEl.className     = 'popup-ability-text vanilla';
    }
    battlePopupEl.classList.add('visible');
  }

  function closeBattlePopup() { battlePopupEl.classList.remove('visible'); }

  battlePopupCloseBtn.addEventListener('click', closeBattlePopup);
  battlePopupEl.addEventListener('click', function (e) { if (e.target === battlePopupEl) closeBattlePopup(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeBattlePopup(); });

  /**
   * Rebuild the opponent hand display to match the actual AI hand count + deck count.
   */
  function updateOppHand() {
    if (!oppHandEl) return;
    oppHandEl.innerHTML = '';

    var pile = document.createElement('div');
    pile.className = 'battle-deck-pile';
    var lbl = document.createElement('div');
    lbl.className = 'battle-deck-label';
    lbl.textContent = 'DECK';
    pile.appendChild(lbl);
    var cnt = document.createElement('div');
    cnt.className = 'battle-deck-count';
    cnt.textContent = G.aiDeck.length;
    pile.appendChild(cnt);
    oppHandEl.appendChild(pile);

    var sep = document.createElement('div');
    sep.className = 'battle-hand-sep';
    oppHandEl.appendChild(sep);

    for (var i = 0; i < G.aiHand.length; i++) {
      var back = document.createElement('div');
      back.className = 'battle-card-back';
      oppHandEl.appendChild(back);
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     VISUAL HELPERS
  ═══════════════════════════════════════════════════════════════ */

  function flashDeny(el) {
    el.classList.remove('flash-deny');
    void el.offsetWidth;
    el.classList.add('flash-deny');
    setTimeout(function () { el.classList.remove('flash-deny'); }, 400);
  }

  function clearDragOver() {
    boardEl.querySelectorAll('.drag-over').forEach(function (el) { el.classList.remove('drag-over'); });
  }

  /* ═══════════════════════════════════════════════════════════════
     RESULT SCREEN BUTTONS
  ═══════════════════════════════════════════════════════════════ */

  /**
   * Chain any pending unlock cutscene → victory montage → then call finalCb.
   * Plays unlock cutscene first (if pending), then montage (if pending), then destination.
   */
  function _playPendingCelebrations(finalCb) {
    if (typeof Progression === 'undefined') { finalCb(); return; }

    // Step 1: unlock cutscene?
    function step1() {
      if (Progression.hasPendingCutscene()) {
        var unlockType = Progression.hasPendingCutscene();
        Progression.playCutscene(unlockType, step2);
      } else {
        step2();
      }
    }
    // Step 2: victory montage?
    function step2() {
      if (Progression.hasPendingMontage()) {
        Progression.playMontage(finalCb);
      } else {
        finalCb();
      }
    }
    step1();
  }

  document.getElementById('result-play-again').addEventListener('click', function () {
    // First-time feedback popup intercept (3rd-match milestone).
    // Returns true if popup is now visible — abort the navigation
    // and let the popup's own "Play Again" button re-fire this click.
    if (window.Feedback && window.Feedback.maybeShowPopup()) return;
    _playPendingCelebrations(function () {
      showScreen('screen-battle');
      initGame();
    });
  });

  document.getElementById('result-home').addEventListener('click', function () {
    if (window.Feedback && window.Feedback.maybeShowPopup()) return;
    stopBgMusic();
    _playPendingCelebrations(function () {
      showScreen('screen-home');
    });
  });

  document.getElementById('result-return-lobby').addEventListener('click', function () {
    stopBgMusic();
    if (window.Multiplayer && typeof window.Multiplayer.returnToLobby === 'function') {
      window.Multiplayer.returnToLobby();
    }
  });

  document.getElementById('result-gameboard').addEventListener('click', function () {
    showScreen('screen-battle');
    document.getElementById('btn-back-results').style.display = '';
  });

  document.getElementById('btn-back-results').addEventListener('click', function () {
    document.getElementById('btn-back-results').style.display = 'none';
    showScreen('screen-result');
  });

  /* ── Music control widget ────────────────────────────────────── */
  (function () {
    var prevBtn = document.getElementById('music-prev-btn');
    var playBtn = document.getElementById('music-play-btn');
    var nextBtn = document.getElementById('music-next-btn');
    var slider  = document.getElementById('music-volume-slider');
    if (!prevBtn || !playBtn || !nextBtn || !slider) return;

    slider.value = Math.round(_bgMusicVol * 100);

    prevBtn.addEventListener('click', function () {
      _musicLoadTrack(_musicIdx - 1, true);
    });

    playBtn.addEventListener('click', function () {
      if (!_musicHowl) { _musicLoadTrack(_musicIdx, true); return; }
      if (_musicHowl.playing()) {
        _musicHowl.pause();
      } else {
        _musicHowl.volume(_bgMusicVol);
        _musicHowl.play();
      }
      _musicUpdateUI();
    });

    nextBtn.addEventListener('click', function () {
      _musicLoadTrack(_musicIdx + 1, true);
    });

    slider.addEventListener('input', function () {
      _bgMusicVol = parseInt(slider.value, 10) / 100;
      if (_musicHowl) _musicHowl.volume(_bgMusicVol);
    });
  }());

  /* ═══════════════════════════════════════════════════════════════
     TOUCH DRAG SUPPORT
     Mirrors the mouse drag-and-drop system using touch events.
     Works alongside existing dragstart/dragover/drop without conflict.
  ═══════════════════════════════════════════════════════════════ */

  function initTouchDrag() {
    var THRESHOLD = 8;       // px — tap vs drag discrimination
    var clone     = null;    // floating visual clone during drag
    var cloneW    = 0;
    var cloneH    = 0;
    var active    = false;   // true once threshold crossed
    var srcEl     = null;    // the element the touch started on
    var srcType   = null;    // 'hand' | 'slot' | 'move'
    var startX    = 0;
    var startY    = 0;

    /* Find the draggable element (if any) under an initial touch target */
    function findSource(el) {
      if (window.tutorialActive) return null;  // tutorial handles its own touch drag
      if (G.phase !== 'select') return null;
      var hc = el.closest('.battle-hand-card');
      if (hc) return { type: 'hand', el: hc };
      var fd = el.closest('.battle-card-slot.face-down[data-owner="player"]');
      if (fd) return { type: 'slot', el: fd };
      var mv = el.closest('.battle-card-slot.moveable[data-owner="player"]');
      if (mv) return { type: 'move', el: mv };
      return null;
    }

    /* Build a semi-transparent floating clone that follows the finger */
    function createClone(el) {
      var r = el.getBoundingClientRect();
      cloneW = r.width;
      cloneH = r.height;
      var c = el.cloneNode(true);
      c.style.cssText =
        'position:fixed;' +
        'width:'  + cloneW + 'px;' +
        'height:' + cloneH + 'px;' +
        'top:'    + r.top  + 'px;' +
        'left:'   + r.left + 'px;' +
        'pointer-events:none;' +
        'z-index:9999;' +
        'opacity:0.85;' +
        'transform:scale(1.06);' +
        'transition:none;';
      document.body.appendChild(c);
      return c;
    }

    /* Move clone so it's centred under the finger */
    function positionClone(cx, cy) {
      clone.style.left = (cx - cloneW / 2) + 'px';
      clone.style.top  = (cy - cloneH / 2) + 'px';
    }

    /* Return the element under (cx, cy), hiding clone first so it doesn't block */
    function elUnder(cx, cy) {
      clone.style.visibility = 'hidden';
      var el = document.elementFromPoint(cx, cy);
      clone.style.visibility = '';
      return el;
    }

    /* Highlight the valid drop target slot (mirrors dragover validation) */
    function highlightDropTarget(cx, cy) {
      clearDragOver();
      if (!dragInfo) return;
      var under = elUnder(cx, cy);
      if (!under) return;

      if (dragInfo.source === 'hand') {
        var slot = under.closest('.battle-card-slot[data-owner="player"]');
        if (!slot) return;
        var locId = parseInt(slot.dataset.locId, 10);
        var card  = CARDS.find(function (c) { return c.id === dragInfo.cardId; });
        var fi    = G.playerSlots[locId].indexOf(null);
        if (!card || fi === -1 || effectiveCost(card, locId) > G.capital) return;
        var riftLoc = G.locations.find(function (l) { return l.abilityKey === 'FIRST_CARD_HERE'; });
        if (riftLoc && G.turn === 1 && G.playerRevealQueue.length === 0 && locId !== riftLoc.id) return;
        var t = getSlotEl('player', locId, fi);
        if (t) t.classList.add('drag-over');

      } else if (dragInfo.source === 'move') {
        var slot = under.closest('.battle-card-slot[data-owner="player"]');
        if (!slot) return;
        var locId = parseInt(slot.dataset.locId, 10);
        if (locId === dragInfo.fromLocId) return;
        var fi = G.playerSlots[locId].indexOf(null);
        if (fi === -1) return;
        var mc = CARDS.find(function (c) { return c.id === dragInfo.cardId; });
        var tl = G.locations.find(function (l) { return l.abilityKey === 'CULTURAL_FREE_MOVE_HERE'; });
        if (mc && mc.type === 'Cultural' && dragInfo.cardId !== 24 && dragInfo.cardId !== 25) {
          if (!tl || locId !== tl.id) return;
        }
        var t = getSlotEl('player', locId, fi);
        if (t) t.classList.add('drag-over');
      }
    }

    /* Reset all touch drag state */
    function reset() {
      if (clone && clone.parentNode) clone.parentNode.removeChild(clone);
      clone  = null;
      active = false;
      srcEl  = null;
      srcType = null;
    }

    /* ── touchstart ───────────────────────────────────────────── */
    document.addEventListener('touchstart', function (e) {
      var src = findSource(e.touches[0].target);
      if (!src) { srcEl = null; return; }
      srcEl   = src.el;
      srcType = src.type;
      active  = false;
      clone   = null;
      startX  = e.touches[0].clientX;
      startY  = e.touches[0].clientY;
    }, { passive: true });

    /* ── touchmove ────────────────────────────────────────────── */
    document.addEventListener('touchmove', function (e) {
      if (!srcEl) return;
      var t  = e.touches[0];
      var dx = t.clientX - startX;
      var dy = t.clientY - startY;

      if (!active) {
        if (Math.sqrt(dx * dx + dy * dy) < THRESHOLD) return;
        // Threshold crossed — begin drag
        active = true;
        clone  = createClone(srcEl);
        srcEl.classList.add('dragging');

        if (srcType === 'hand') {
          dragInfo = { cardId: parseInt(srcEl.dataset.id, 10), source: 'hand' };
        } else if (srcType === 'slot') {
          dragInfo = {
            source:    'slot',
            cardId:    parseInt(srcEl.dataset.cardId,    10),
            locId:     parseInt(srcEl.dataset.locId,     10),
            slotIndex: parseInt(srcEl.dataset.slotIndex, 10)
          };
        } else {
          dragInfo = {
            source:        'move',
            cardId:        parseInt(srcEl.dataset.cardId,    10),
            fromLocId:     parseInt(srcEl.dataset.locId,     10),
            fromSlotIndex: parseInt(srcEl.dataset.slotIndex, 10)
          };
        }
      }

      e.preventDefault();  // suppress scroll / zoom during active drag
      positionClone(t.clientX, t.clientY);
      highlightDropTarget(t.clientX, t.clientY);
    }, { passive: false });

    /* ── touchend ─────────────────────────────────────────────── */
    document.addEventListener('touchend', function (e) {
      if (!srcEl) return;

      if (!active) {
        // Tap (no drag): let the browser fire the natural click event
        srcEl = null;
        return;
      }

      var t = e.changedTouches[0];
      clearDragOver();

      // Identify what is under the lifted finger
      var dropEl     = elUnder(t.clientX, t.clientY);
      var slotTarget = dropEl ? dropEl.closest('.battle-card-slot[data-owner="player"]') : null;
      var handTarget = dropEl ? dropEl.closest('#battle-player-hand') : null;

      if (slotTarget && dragInfo) {
        if (dragInfo.source === 'hand') {
          commitPlay(dragInfo.cardId, parseInt(slotTarget.dataset.locId, 10));
        } else if (dragInfo.source === 'move') {
          var toLocId = parseInt(slotTarget.dataset.locId, 10);
          if (toLocId !== dragInfo.fromLocId)
            queueMove(dragInfo.fromLocId, dragInfo.fromSlotIndex, toLocId);
        }
      } else if (handTarget && dragInfo && dragInfo.source === 'slot') {
        undoPlay(dragInfo.locId, dragInfo.slotIndex);
      }

      srcEl.classList.remove('dragging');
      dragInfo = null;
      reset();
    }, { passive: true });

    /* ── touchcancel ──────────────────────────────────────────── */
    document.addEventListener('touchcancel', function () {
      if (srcEl) srcEl.classList.remove('dragging');
      dragInfo = null;
      reset();
    }, { passive: true });
  }

  /* ── One-time init ─────────────────────────────────────────── */
  initTouchDrag();

  /* ── Battle screen scale for sub-1280 viewports ─────────────── */
  (function () {
    function updateBattleScale() {
      var scale = Math.min(1, window.innerWidth / 1280);
      document.documentElement.style.setProperty('--battle-scale', scale);
    }
    updateBattleScale();
    window.addEventListener('resize', updateBattleScale);
  }());

  /* ── Export ──────────────────────────────────────────────────── */
  window.initGame          = initGame;
  window.openBattlePopup   = openBattlePopup;
  window.showResult        = showResult;

})();
