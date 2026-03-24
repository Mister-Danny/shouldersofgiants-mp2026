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
  const DRAW_PER_TURN = 2;
  const SLOTS_PER_LOC = 4;
  const REVEAL_DELAY  = 800;
  const POST_REVEAL   = 1200;
  const STORAGE_KEY   = 'sog_saved_deck';
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
    playerActionLog:        []   // ordered: {type:'play'|'move', cardId, fromLocId?, fromSlotIndex?, toLocId?}
  };

  /* ── Drag state ──────────────────────────────────────────────── */
  var dragInfo = null;

  /* ── Background music ────────────────────────────────────────── */
  var _bgMusic = null;
  var _bgMusicVol  = 0.10;  // persists across Play Again
  var _bgMusicMuted = false;

  function getBgMusic() {
    if (!_bgMusic && typeof Howl !== 'undefined') {
      _bgMusic = new Howl({
        src:    ['music/Dozing Off INSTRUMENTAL.m4a'],
        loop:   true,
        volume: _bgMusicVol,
        html5:  true
      });
    }
    return _bgMusic;
  }

  function startBgMusic() {
    var m = getBgMusic();
    if (!m) return;
    if (!m.playing()) { m.volume(_bgMusicVol); m.play(); }
  }

  function stopBgMusic() {
    if (_bgMusic && _bgMusic.playing()) { _bgMusic.stop(); }
  }

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
    G.locations = pickLocations();
    window.initBattleUI(G.locations);

    var saved   = localStorage.getItem(STORAGE_KEY);
    var deckIds = saved ? JSON.parse(saved) : [];
    G.playerDeck = shuffle(deckIds.slice());
    G.playerHand = G.playerDeck.splice(0, HAND_START);

    G.aiDeck = buildAiDeck();
    G.aiHand = G.aiDeck.splice(0, HAND_START);

    G.locations.forEach(function (loc) {
      G.playerSlots[loc.id] = [null, null, null, null];
      G.aiSlots[loc.id]     = [null, null, null, null];
    });

    G.turn              = 1;
    G.phase             = 'select';
    G.capital           = CAPITAL;
    G.turnStartCapital  = CAPITAL;
    G.playerFirst       = true;
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
    dragInfo = null;

    window.setPlayerHand(G.playerHand, G.playerDeck.length);
    updateOppHand();
    capitalNumEl = document.getElementById('battle-capital-num');

    endTurnBtn.textContent  = 'END TURN';
    endTurnBtn.disabled     = false;
    resetTurnBtn.disabled   = false;
    document.getElementById('btn-back-results').style.display = 'none';

    updateHeader();
    bindHandEvents();
    refreshMoveableCards();
    startBgMusic();
  }

  /* ── Utilities ───────────────────────────────────────────────── */

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function pickLocations() {
    var pool = LOCATIONS.slice();
    pool.sort(function () { return Math.random() - 0.5; });
    return pool.slice(0, 3);
  }

  function buildAiDeck() {
    var types = TYPE_ORDER.slice();
    types.sort(function () { return Math.random() - 0.5; });
    var deck = [];
    types.slice(0, 3).forEach(function (type) {
      CARDS.filter(function (c) { return c.type === type; })
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
    // Face-down slot → undo-play drag
    var fdSlot = e.target.closest('.battle-card-slot.face-down[data-owner="player"]');
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
      var firstEmpty = G.playerSlots[locId].indexOf(null);
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
      var toLocId    = parseInt(col.dataset.locId, 10);
      if (toLocId === dragInfo.fromLocId) { clearDragOver(); return; }
      var firstEmpty = G.playerSlots[toLocId].indexOf(null);
      if (firstEmpty === -1) { clearDragOver(); return; }
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
    if (si === -1) return;
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
    G.playerActionLog.push({ type: 'play', cardId: cardId });

    G.playerHand = G.playerHand.filter(function (id) { return id !== cardId; });
    var hEl = playerHandEl.querySelector('.battle-hand-card[data-id="' + cardId + '"]');
    if (hEl) hEl.remove();

    var slotEl = getSlotEl('player', locId, si);
    if (slotEl) { slotEl.dataset.cardId = cardId; setSlotFaceDown(slotEl); }
    updateHeader();
  }

  function undoPlay(locId, slotIndex) {
    var sd = G.playerSlots[locId][slotIndex];
    if (!sd || sd.revealed) return;
    var card = CARDS.find(function (c) { return c.id === sd.cardId; });
    if (card) G.capital += effectiveCost(card, locId);
    G.capital = Math.min(G.capital, CAPITAL);
    G.playerRevealQueue = G.playerRevealQueue.filter(function (id) { return id !== sd.cardId; });
    G.playerHand.push(sd.cardId);
    G.playerSlots[locId][slotIndex] = null;
    compactPlayerSlots(locId);
    syncPlayerSlots(locId);
    window.setPlayerHand(G.playerHand, G.playerDeck.length);
    bindHandEvents();
    updateHeader();
  }

  function resetTurn() {
    // 1. Return face-down (played-but-not-revealed) cards back to hand
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

    // 2. Undo or clear queued moves from this select phase
    for (var mi = G.moveLog.length - 1; mi >= 0; mi--) {
      var mv = G.moveLog[mi];

      if (mv.queued) {
        // Card is currently at toLocId (the preview destination) — move it back
        var qCurrIdx = G.playerSlots[mv.toLocId].findIndex(function (s) { return s && s.cardId === mv.cardId; });
        if (qCurrIdx !== -1) {
          var qSd = G.playerSlots[mv.toLocId][qCurrIdx];
          G.playerSlots[mv.toLocId][qCurrIdx] = null;
          clearSlotDOM('player', mv.toLocId, qCurrIdx);
          compactPlayerSlots(mv.toLocId);
          syncPlayerSlots(mv.toLocId);
          var qOrigIdx = G.playerSlots[mv.fromLocId].indexOf(null);
          if (qOrigIdx !== -1) {
            G.playerSlots[mv.fromLocId][qOrigIdx] = qSd;
          }
          compactPlayerSlots(mv.fromLocId);
          syncPlayerSlots(mv.fromLocId);
        }
        G.movedThisTurn[mv.cardId] = false;
        if (mv.isColumbus) G.columbusMoved = false;
        continue;
      }

      // Card actually moved (legacy path — shouldn't happen in select phase with new system)
      // Find the card in its current (moved-to) location
      var currIdx = G.playerSlots[mv.toLocId].findIndex(function (s) { return s && s.cardId === mv.cardId; });
      if (currIdx === -1) continue;
      var sdMv = G.playerSlots[mv.toLocId][currIdx];

      // Reverse the ipMod added by this move
      sdMv.ipMod = (sdMv.ipMod || 0) - mv.ipModAdded;
      if (sdMv.ipModSources && mv.ipModSourcesAdded) {
        mv.ipModSourcesAdded.forEach(function (entry) {
          var idx = sdMv.ipModSources.findIndex(function (e) {
            return e.source === entry.source && e.delta === entry.delta;
          });
          if (idx !== -1) sdMv.ipModSources.splice(idx, 1);
        });
      }

      // Undo Columbus -1 penalty on opponent's Cultural cards
      if (mv.isColumbus && G.columbusMoved) {
        G.columbusMoved = false;
        G.aiSlots[mv.toLocId].forEach(function (s) {
          if (!s) return;
          var c = CARDS.find(function (x) { return x.id === s.cardId; });
          if (c && c.type === 'Cultural') {
            s.ipMod = (s.ipMod || 0) + 1;
            if (s.ipModSources) {
              var ci = s.ipModSources.findIndex(function (e) { return e.source === 'Christopher Columbus'; });
              if (ci !== -1) s.ipModSources.splice(ci, 1);
            }
          }
        });
      }
      G.movedThisTurn[mv.cardId] = false;

      // Move the card back to its original location
      G.playerSlots[mv.toLocId][currIdx] = null;
      clearSlotDOM('player', mv.toLocId, currIdx);

      var origIdx = G.playerSlots[mv.fromLocId].indexOf(null);
      if (origIdx !== -1) {
        G.playerSlots[mv.fromLocId][origIdx] = sdMv;
      }
    }
    G.moveLog = [];
    G.playerActionLog = [];

    // Sync all locations after moves are undone
    G.locations.forEach(function (loc) {
      compactPlayerSlots(loc.id);
      syncPlayerSlots(loc.id);
    });

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
        slotEl.dataset.cardId = sd.cardId;
        slotEl.className      = 'battle-card-slot occupied face-down';
        slotEl.innerHTML      = '';
        slotEl.draggable      = true;
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

  function flipSlot(slotEl) {
    if (typeof SFX !== 'undefined') SFX.cardReveal();
    var cardId    = parseInt(slotEl.dataset.cardId,    10);
    var locId     = parseInt(slotEl.dataset.locId,     10);
    var slotIndex = parseInt(slotEl.dataset.slotIndex, 10);
    var owner     = slotEl.dataset.owner;
    var card      = CARDS.find(function (c) { return c.id === cardId; });
    if (!card) return;
    var slots = owner === 'player' ? G.playerSlots : G.aiSlots;
    if (slots[locId] && slots[locId][slotIndex]) slots[locId][slotIndex].revealed = true;
    slotEl.removeAttribute('draggable');
    slotEl.classList.remove('face-down');
    slotEl.classList.add('face-up');
    var sd = slots[locId] && slots[locId][slotIndex];
    buildCardFace(slotEl, card, sd ? effectiveIP(sd) : card.ip);
    if (typeof Anim !== 'undefined') Anim.cardReveal(slotEl);

    // ── Per-card reveal SFX + animations ──────────────────────────
    // Delay slightly so effects fire after the 300 ms reveal animation.
    setTimeout(function () {
      // Kente Cloth (id 17): shield chime + warm orange location glow
      if (cardId === 17) {
        if (typeof SFX !== 'undefined') SFX.kenteSound();
        var locTileEl = boardEl.querySelector('.battle-col[data-loc-id="' + locId + '"]');
        if (typeof Anim !== 'undefined') Anim.setKenteGlow(locTileEl, true);
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
        }
      }

      // Cosimo de'Medici (id 19): money-bags chime on reveal
      if (cardId === 19) {
        if (typeof SFX !== 'undefined') SFX.cosimoSound();
      }

      // Henry the Navigator (id 22): patronage chime on reveal
      if (cardId === 22) {
        if (typeof SFX !== 'undefined') SFX.henrySound();
      }
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
    endTurnBtn.disabled   = true;
    resetTurnBtn.disabled = true;
    runAiMovements();
    runAiSelection();
    updateOppHand();  // reflect cards AI committed to board
    setTimeout(startReveal, 600);
  }

  /* ═══════════════════════════════════════════════════════════════
     AI SELECTION  (placeholder — Step 7 replaces)
  ═══════════════════════════════════════════════════════════════ */

  function runAiSelection() {
    G.aiRevealQueue = [];
    var budget = CAPITAL + G.aiBonusCapitalNextTurn;
    G.aiBonusCapitalNextTurn = 0;
    var hand = shuffle(G.aiHand.slice());

    // FIRST_CARD_HERE: on Turn 1, force AI's first card to the Great Rift Valley
    var riftLoc = G.locations.find(function (l) { return l.abilityKey === 'FIRST_CARD_HERE'; });
    var aiFirstPlayed = false;

    hand.forEach(function (cardId) {
      if (budget <= 0) return;
      var card = CARDS.find(function (c) { return c.id === cardId; });
      if (!card || card.cc > budget) return;

      var empties = [];
      G.locations.forEach(function (loc) {
        var fi = G.aiSlots[loc.id].indexOf(null);
        if (fi !== -1) empties.push({ locId: loc.id, slotIndex: fi });
      });
      if (!empties.length) return;

      var t;
      if (riftLoc && G.turn === 1 && !aiFirstPlayed) {
        // Must play first card to Rift Valley
        var riftFi = G.aiSlots[riftLoc.id].indexOf(null);
        if (riftFi === -1) return; // Rift Valley full, skip
        t = { locId: riftLoc.id, slotIndex: riftFi };
        aiFirstPlayed = true;
      } else {
        aiFirstPlayed = true;
        shuffle(empties);
        t = empties[0];
      }
      var baseIP = card.ip + (G.aiCardIPBonus[cardId] || 0);
      G.aiSlots[t.locId][t.slotIndex] = { cardId: cardId, ip: baseIP, revealed: false, ipMod: 0, contMod: 0, ipModSources: [] };
      G.aiHand = G.aiHand.filter(function (id) { return id !== cardId; });
      G.aiRevealQueue.push(cardId);
      budget -= card.cc;

      var slotEl = getSlotEl('opp', t.locId, t.slotIndex);
      if (slotEl) { slotEl.dataset.cardId = cardId; setSlotFaceDown(slotEl); }
    });
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
    var timbuktuHasSpace = timbuktuLoc && G.playerSlots[timbuktuLoc.id].indexOf(null) !== -1;
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

    // Columbus: one-time move; -1 IP to opponent's Cultural cards at destination
    if (cardId === 25) {
      var flag = owner === 'player' ? 'columbusMoved' : 'aiColumbusMoved';
      if (!G[flag]) {
        G[flag] = true;
        var oppSlots = owner === 'player' ? G.aiSlots : G.playerSlots;
        oppSlots[toLocId].forEach(function (s) {
          if (!s) return;
          var c = CARDS.find(function (x) { return x.id === s.cardId; });
          if (c && c.type === 'Cultural') addIPMod(s, -1, 'Christopher Columbus');
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
   * The card moves immediately to the destination so the player can see it,
   * with a pulsing border indicating it's queued (not yet permanent).
   * On End Turn the reveal phase will snap it back then re-animate the move.
   */
  function queueMove(fromLocId, fromSlotIndex, toLocId) {
    var sd = G.playerSlots[fromLocId][fromSlotIndex];
    if (!sd) return;
    var cardId = sd.cardId;
    var card   = CARDS.find(function (c) { return c.id === cardId; });
    var toIndex = G.playerSlots[toLocId].indexOf(null);
    if (toIndex === -1) return;

    // Move card immediately to destination — visual preview, no IP mods applied yet
    G.playerSlots[fromLocId][fromSlotIndex] = null;
    clearSlotDOM('player', fromLocId, fromSlotIndex);
    compactPlayerSlots(fromLocId);
    syncPlayerSlots(fromLocId);

    G.playerSlots[toLocId][toIndex] = sd;
    var toSlotEl = getSlotEl('player', toLocId, toIndex);
    if (toSlotEl && card) {
      toSlotEl.dataset.cardId = cardId;
      toSlotEl.className      = 'battle-card-slot occupied face-up queued-move';
      toSlotEl.removeAttribute('draggable');
      buildCardFace(toSlotEl, card, effectiveIP(sd));
    }

    // Mark as moved so it can't be queued again this turn
    G.movedThisTurn[cardId] = true;
    if (cardId === 25) G.columbusMoved = true;

    // Log to playerActionLog (ordered, for reveal sequence)
    G.playerActionLog.push({ type: 'move', cardId: cardId, fromLocId: fromLocId, toLocId: toLocId });

    // Log to moveLog (for resetTurn to undo the preview move)
    G.moveLog.push({ cardId: cardId, fromLocId: fromLocId, toLocId: toLocId, queued: true, isColumbus: cardId === 25 });

    refreshMoveableCards();
    updateScores();
  }

  /** AI auto-movement: Magellan moves toward highest-IP player location; Columbus toward Cultural. */
  function runAiMovements() {
    G.locations.forEach(function (loc) {
      G.aiSlots[loc.id].forEach(function (s, si) {
        if (!s || !s.revealed) return;

        if (s.cardId === 24 && !G.aiMovedThisTurn[24]) {          // AI Magellan
          var best = null, bestScore = -Infinity;
          G.locations.forEach(function (l) {
            if (l.id === loc.id || G.aiSlots[l.id].indexOf(null) === -1) return;
            var score = G.playerSlots[l.id].reduce(function (sum, ps) {
              return sum + (ps && ps.revealed ? effectiveIP(ps) : 0);
            }, 0);
            if (score > bestScore) { bestScore = score; best = l.id; }
          });
          if (best !== null) executeMove('opp', loc.id, si, best);
        }

        if (s.cardId === 25 && !G.aiColumbusMoved) {              // AI Columbus
          var best = null, bestCount = 0;
          G.locations.forEach(function (l) {
            if (l.id === loc.id || G.aiSlots[l.id].indexOf(null) === -1) return;
            var cnt = G.playerSlots[l.id].filter(function (ps) {
              if (!ps || !ps.revealed) return false;
              var c = CARDS.find(function (x) { return x.id === ps.cardId; });
              return c && c.type === 'Cultural';
            }).length;
            if (cnt > bestCount) { bestCount = cnt; best = l.id; }
          });
          if (best !== null) executeMove('opp', loc.id, si, best);
        }
      });
    });
  }

  /**
   * Execute a queued move during the reveal phase.
   * The card is currently at toLocId (the select-phase preview position).
   * Step 1: snap it back to fromLocId instantly.
   * Step 2: slide it from fromLocId → toLocId with GSAP, applying IP mods.
   */
  function executeMoveAnimated(owner, cardId, fromLocId, toLocId, done) {
    var slots = owner === 'player' ? G.playerSlots : G.aiSlots;
    var card  = CARDS.find(function (c) { return c.id === cardId; });

    // ── Step 1: snap back to fromLocId ───────────────────────────
    // Card is currently at toLocId (preview position); find and remove it
    var previewIdx = -1;
    for (var pi = 0; pi < slots[toLocId].length; pi++) {
      if (slots[toLocId][pi] && slots[toLocId][pi].cardId === cardId) { previewIdx = pi; break; }
    }
    if (previewIdx === -1) { done(); return; }

    var sd = slots[toLocId][previewIdx];

    // Remove queued-move indicator and pull card out of toLocId
    var previewSlotEl = getSlotEl(owner, toLocId, previewIdx);
    if (previewSlotEl) previewSlotEl.classList.remove('queued-move');
    slots[toLocId][previewIdx] = null;
    clearSlotDOM(owner, toLocId, previewIdx);
    if (owner === 'player') { compactPlayerSlots(toLocId); syncPlayerSlots(toLocId); }
    else                    { compactOppSlots(toLocId);    syncOppSlots(toLocId);    }

    // Place card back at fromLocId (instant snap — no animation)
    var snapIdx = slots[fromLocId].indexOf(null);
    if (snapIdx === -1) { done(); return; }
    slots[fromLocId][snapIdx] = sd;
    var fromSlotEl = getSlotEl(owner, fromLocId, snapIdx);
    if (fromSlotEl && card) {
      fromSlotEl.dataset.cardId = cardId;
      fromSlotEl.className      = 'battle-card-slot occupied face-up';
      fromSlotEl.removeAttribute('draggable');
      buildCardFace(fromSlotEl, card, effectiveIP(sd));
    }

    // ── Step 2: slide fromLocId → toLocId ────────────────────────
    var toIndex  = slots[toLocId].indexOf(null);
    if (toIndex === -1) { done(); return; }
    var toSlotEl = getSlotEl(owner, toLocId, toIndex);

    // Sailing SFX for Magellan
    if (cardId === 24 && typeof SFX !== 'undefined') SFX.sailingSound();

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

      // Columbus: apply -1 IP, play bell, shake affected cards, then proceed
      if (cardId === 25) {
        var oppOwner = owner === 'player' ? 'opp' : 'player';
        var oppSlots = owner === 'player' ? G.aiSlots : G.playerSlots;
        var affectedSlotEls = [];

        oppSlots[toLocId].forEach(function (s, si) {
          if (!s) return;
          var c = CARDS.find(function (x) { return x.id === s.cardId; });
          if (c && c.type === 'Cultural') {
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
    refreshMoveableCards();
    updateHeader();
    revealNext(buildRevealSequence(), 0);
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
      evaluateContinuous();
      refreshSlotIPDisplays();
      refreshHandIPDisplays();
      refreshHandCostDisplays();
      updateScores();
      setTimeout(function () { revealNext(seq, i + 1); }, REVEAL_DELAY);
    };

    if (item.type === 'move') {
      executeMoveAnimated(item.owner, item.cardId, item.fromLocId, item.toLocId, proceed);
      return;
    }

    // type === 'play'
    var slotEl = findSlotEl(item.owner, item.cardId);
    if (slotEl && slotEl.classList.contains('face-down')) {
      flipSlot(slotEl);
      var locId = getCardLocId(item.owner, item.cardId);
      fireAtOnce(item.owner, item.cardId, locId, proceed);
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
        else if (typeof Anim !== 'undefined') { Anim.cardDiscarded(hEl); }
        else               { hEl.remove(); }
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
    if (owner === 'player') {
      G.bonusCapitalNextTurn += count;
      if (count > 0) {
        var slotIdx = slots[locId].findIndex(function (s) { return s && s.cardId === 2; });
        var slotEl  = slotIdx !== -1 ? getSlotEl('player', locId, slotIdx) : null;
        if (typeof SFX  !== 'undefined') SFX.coinSound();
        if (typeof Anim !== 'undefined' && slotEl) {
          Anim.scholarPulse(slotEl);
          Anim.floatCapital(slotEl, count);
        }
        // Pulse each contributing card so the player can see what's being counted
        if (typeof Anim !== 'undefined') {
          slots[locId].forEach(function (s, si) {
            if (!s || !s.revealed || s.cardId === 2) return;
            var contEl = getSlotEl('player', locId, si);
            if (contEl) Anim.scholarPulse(contEl);
          });
        }
        // Animations run ~1s — wait before signalling next card
        setTimeout(done, 1050);
        return;
      }
    } else {
      G.aiBonusCapitalNextTurn += count;
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

    // Find destination BEFORE animation starts (null = no space → destroy instead)
    var destLocId = null;
    for (var i = 0; i < adjLocs.length; i++) {
      var ds = oppSide === 'player' ? G.playerSlots : G.aiSlots;
      if (ds[adjLocs[i]].indexOf(null) !== -1) { destLocId = adjLocs[i]; break; }
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
        _wuCommitPush(oppSide, locId, best.cardId, destLocId);
      } else {
        destroyCard(oppSide, locId, tgtIdx);
      }
      updateScores(); evaluateContinuous(); refreshSlotIPDisplays();
      done();
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

    // At impact: play SFX, then push or destroy
    tl.call(function () {
      if (typeof SFX !== 'undefined') SFX.wuPunch();

      if (canPush) {
        // ── Push path: commit state and fly target to destination ──
        _wuCommitPush(oppSide, locId, best.cardId, destLocId);
        if (destEl) gsap.set(destEl, { opacity: 0 });

        if (tgtGhost) {
          gsap.to(tgtGhost, {
            x: flyDx, y: flyDy,
            duration: 0.30, ease: 'power3.out',
            onComplete: function () {
              gsap.fromTo(tgtGhost,
                { rotation: -10 },
                { rotation: 0, duration: 0.42, ease: 'elastic.out(1.3, 0.4)',
                  onComplete: function () {
                    removeEl(tgtGhost);
                    if (destEl) gsap.set(destEl, { clearProps: 'opacity' });
                    tryComplete();
                  }
                }
              );
            }
          });
        } else {
          if (destEl) gsap.set(destEl, { clearProps: 'opacity' });
          tryComplete();
        }

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

  /**
   * Commit Empress Wu's push: remove target card from source, place at destination.
   * Called both by the animated path and the no-GSAP fallback.
   */
  function _wuCommitPush(oppSide, srcLocId, cardId, destLocId) {
    var srcSlots = oppSide === 'player' ? G.playerSlots : G.aiSlots;
    var currIdx  = srcSlots[srcLocId].findIndex(function (s) { return s && s.cardId === cardId; });
    if (currIdx === -1) return;
    var sd = srcSlots[srcLocId][currIdx];
    srcSlots[srcLocId][currIdx] = null;
    clearSlotDOM(oppSide, srcLocId, currIdx);
    if (oppSide === 'player') { compactPlayerSlots(srcLocId); syncPlayerSlots(srcLocId); }
    else                      { compactOppSlots(srcLocId);    syncOppSlots(srcLocId);    }

    var destSlots = oppSide === 'player' ? G.playerSlots : G.aiSlots;
    var destIdx   = destSlots[destLocId].indexOf(null);
    if (destIdx === -1) return;
    destSlots[destLocId][destIdx] = sd;
    var dl = G.locations.find(function (l) { return l.id === destLocId; });
    if (dl && dl.abilityKey === 'MOVE_IN_GAINS_IP') addIPMod(sd, 1, 'The Cape of Good Hope');
    var card      = CARDS.find(function (c) { return c.id === cardId; });
    var destSlotEl = getSlotEl(oppSide, destLocId, destIdx);
    if (destSlotEl && card) {
      destSlotEl.dataset.cardId = cardId;
      destSlotEl.className      = 'battle-card-slot occupied face-up';
      destSlotEl.removeAttribute('draggable');
      buildCardFace(destSlotEl, card, effectiveIP(sd));
    }
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
        if (owner === 'player') { G.destroyedIPTotal  += v.ip; updateWilliamDisplay(); pulseWilliam(); }
        else                      G.aiDestroyedIPTotal += v.ip;
        slots[locId][v.slotIdx] = null;
        clearSlotDOM(owner, locId, v.slotIdx);
        ipGainedFB++;
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
      tl.call((function (victim, isJoanSpecial) {
        return function () {
          var sIdx = slots[locId].findIndex(function (s) { return s && s.cardId === victim.cardId; });
          if (sIdx === -1) return;

          // For Joan-special: ghost her card face before clearing so it persists for summon anim
          var joanGhost = isJoanSpecial ? makeBoardGhost(victim.el, 150) : null;

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
        };
      })(v, joanSpecial));
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
    var sBonus   = owner === 'player' ? G.cardIPBonus : G.aiCardIPBonus;
    var prevBonus = sBonus[12] || 0;
    var newBonus  = prevBonus + 2;

    // Zero out before placeRevealedCard so base IP stays at card.ip (2),
    // then apply the full cumulative as a named ipMod so Justinian can reset it.
    sBonus[12] = 0;
    placeRevealedCard(owner, locId, 12, 0, { skipLocationAbility: true });
    sBonus[12] = newBonus;

    var sSlots = owner === 'player' ? G.playerSlots : G.aiSlots;
    var sIdx   = sSlots[locId].findIndex(function (s) { return s && s.cardId === 12; });
    var slotEl = sIdx !== -1 ? getSlotEl(owner, locId, sIdx) : null;

    if (sIdx !== -1) {
      var sd = sSlots[locId][sIdx];
      sd.ipMod        = newBonus;
      sd.ipModSources = [{ source: 'Cortes', delta: newBonus }];
      if (slotEl) {
        var ipEl = slotEl.querySelector('.db-overlay-ip');
        if (ipEl) ipEl.textContent = effectiveIP(sd);
      }
    }

    function finish() {
      if (slotEl && typeof Anim !== 'undefined') Anim.ripple(slotEl);
      if (done) done();
    }

    if (!slotEl || typeof gsap === 'undefined') { finish(); return; }

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

    G.playerRevealQueue = [];
    G.aiRevealQueue     = [];
    G.playerFirst       = !G.playerFirst;
    G.movedThisTurn     = {};
    G.aiMovedThisTurn   = {};
    G.moveLog           = [];
    G.playerActionLog   = [];

    G.playerDeck.splice(0, DRAW_PER_TURN).forEach(function (id) { G.playerHand.push(id); });
    G.aiDeck.splice(0, DRAW_PER_TURN).forEach(function (id) { G.aiHand.push(id); });

    window.setPlayerHand(G.playerHand, G.playerDeck.length);
    updateOppHand();
    refreshHandIPDisplays();
    refreshHandCostDisplays();
    updateHeader();
    bindHandEvents();
    refreshMoveableCards();

    endTurnBtn.textContent  = 'END TURN';
    endTurnBtn.disabled     = false;
    resetTurnBtn.disabled   = false;
  }

  function endGame() {
    G.phase = 'over';
    refreshMoveableCards();
    var result = tallyResult();
    showResult(result);
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

    // Game outcome sound + results screen headline animation
    if (typeof SFX !== 'undefined') {
      if      (result.outcome === 'player') SFX.gameWon();
      else if (result.outcome === 'ai')     SFX.gameLost();
      else                                  SFX.locationWon();  // draw — gentler sound
    }

    setTimeout(function () {
      showScreen('screen-result');
      // Animate the result headline after screen transition
      if (typeof Anim !== 'undefined') {
        if      (result.outcome === 'player') Anim.celebration();
        else if (result.outcome === 'ai')     Anim.sadResult();
      }
    }, 1000);
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

    hEl.className = 'result-headline result-' + r.outcome;
    hEl.textContent = r.outcome === 'player' ? 'VICTORY' : r.outcome === 'ai' ? 'DEFEAT' : 'DRAW';

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

  document.getElementById('result-play-again').addEventListener('click', function () {
    showScreen('screen-battle');
    initGame();   // startBgMusic() is called inside initGame
  });

  document.getElementById('result-home').addEventListener('click', function () {
    stopBgMusic();
    showScreen('screen-home');
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
    var toggleBtn = document.getElementById('music-toggle-btn');
    var slider    = document.getElementById('music-volume-slider');
    if (!toggleBtn || !slider) return;

    // Sync slider thumb to initial volume
    slider.value = Math.round(_bgMusicVol * 100);

    toggleBtn.addEventListener('click', function () {
      var m = getBgMusic();
      _bgMusicMuted = !_bgMusicMuted;
      if (_bgMusicMuted) {
        toggleBtn.textContent = '♪';   // dimmed note = muted
        toggleBtn.classList.add('muted');
        if (m) m.volume(0);
      } else {
        toggleBtn.textContent = '♫';
        toggleBtn.classList.remove('muted');
        if (m) m.volume(_bgMusicVol);
      }
    });

    slider.addEventListener('input', function () {
      _bgMusicVol = parseInt(slider.value, 10) / 100;
      var m = getBgMusic();
      if (!_bgMusicMuted && m) m.volume(_bgMusicVol);
      // If volume dragged above 0 while muted, un-mute
      if (_bgMusicVol > 0 && _bgMusicMuted) {
        _bgMusicMuted = false;
        toggleBtn.textContent = '♫';
        toggleBtn.classList.remove('muted');
        if (m) m.volume(_bgMusicVol);
      }
      // If dragged to 0, treat as muted
      if (_bgMusicVol === 0) {
        _bgMusicMuted = true;
        toggleBtn.textContent = '♪';
        toggleBtn.classList.add('muted');
      }
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

})();
