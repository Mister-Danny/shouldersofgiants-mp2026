/**
 * ui.js
 * Shoulders of Giants — UI Rendering
 *
 * Exposes:
 *   window.initBattleUI(locations)          — builds the battle screen scaffold
 *   window.setPlayerHand(cardIds, deckCount) — rebuilds the player hand area
 *
 * Both are called by game.js after game state is initialised.
 *
 * Depends on: CARDS (js/cards.js), LOCATIONS (js/locations.js)
 */

(function () {
  'use strict';

  /* ── Constants ───────────────────────────────────────────────── */
  const OPP_HAND_SIZE  = 5;    // face-down cards shown in opponent hand
  const OPP_DECK_START = 10;   // opponent deck remaining after initial deal
  const SLOTS_PER_LOC  = 4;    // card slots per location per player

  /* ── DOM refs ────────────────────────────────────────────────── */
  const headerTurnEl  = document.getElementById('battle-turn-info');
  const headerPhaseEl = document.getElementById('battle-phase-info');
  const headerCapEl   = document.getElementById('battle-capital-info');
  const oppHandEl     = document.getElementById('battle-opp-hand');
  const boardEl       = document.getElementById('battle-board');
  const playerHandEl  = document.getElementById('battle-player-hand');

  /* ═══════════════════════════════════════════════════════════════
     PUBLIC ENTRY POINTS
  ═══════════════════════════════════════════════════════════════ */

  /**
   * initBattleUI(locations)
   * Builds the static battle scaffold: header · opp hand · board columns.
   * Leaves the player hand area empty; game.js fills it via setPlayerHand().
   * @param {Array} locations  3 Location objects chosen by game.js
   */
  function initBattleUI(locations) {
    resetHeader();
    buildOppHand();
    buildBoard(locations);
    playerHandEl.innerHTML = '';
  }

  /**
   * setPlayerHand(cardIds, deckCount)
   * Rebuilds the player hand display with the given card ids and deck count.
   * Called by game.js at game start and at the start of each new turn.
   * @param {number[]} cardIds   IDs of cards currently in hand
   * @param {number}   deckCount Cards remaining in the draw pile
   */
  function setPlayerHand(cardIds, deckCount) {
    playerHandEl.innerHTML = '';

    cardIds.forEach(function (id) {
      var card = CARDS.find(function (c) { return c.id === id; });
      if (card) playerHandEl.appendChild(buildHandCard(card));
    });

    var sep = document.createElement('div');
    sep.className = 'battle-hand-sep';
    playerHandEl.appendChild(sep);

    playerHandEl.appendChild(buildDeckPile(deckCount));
  }

  /* ── Header ──────────────────────────────────────────────────── */

  function resetHeader() {
    headerTurnEl.textContent  = 'TURN 1 / 4';
    headerPhaseEl.textContent = 'SELECT CARDS';
    headerCapEl.innerHTML =
      '<span class="battle-capital-label">CAPITAL</span>' +
      '<span class="battle-capital-num" id="battle-capital-num">6</span>';
  }

  /* ── Opponent hand ───────────────────────────────────────────── */

  function buildOppHand() {
    oppHandEl.innerHTML = '';

    oppHandEl.appendChild(buildDeckPile(OPP_DECK_START));

    var sep = document.createElement('div');
    sep.className = 'battle-hand-sep';
    oppHandEl.appendChild(sep);

    for (var i = 0; i < OPP_HAND_SIZE; i++) {
      var back = document.createElement('div');
      back.className = 'battle-card-back';
      oppHandEl.appendChild(back);
    }
  }

  function buildDeckPile(count) {
    var pile = document.createElement('div');
    pile.className = 'battle-deck-pile';

    var label = document.createElement('div');
    label.className   = 'battle-deck-label';
    label.textContent = 'DECK';
    pile.appendChild(label);

    var countEl = document.createElement('div');
    countEl.className   = 'battle-deck-count';
    countEl.textContent = count;
    pile.appendChild(countEl);

    return pile;
  }

  /* ── Play board ──────────────────────────────────────────────── */

  function buildBoard(locations) {
    boardEl.innerHTML = '';
    locations.forEach(function (loc) {
      boardEl.appendChild(buildLocationCol(loc));
    });
  }

  function buildLocationCol(loc) {
    var col = document.createElement('div');
    col.className    = 'battle-col';
    col.dataset.locId = loc.id;

    col.appendChild(buildSlotArea('opp',    loc.id));
    col.appendChild(buildLocationTile(loc));
    col.appendChild(buildSlotArea('player', loc.id));

    return col;
  }

  function buildSlotArea(owner, locId) {
    var area = document.createElement('div');
    area.className     = owner === 'opp' ? 'battle-slots-opp' : 'battle-slots-player';
    area.dataset.owner = owner;

    for (var i = 0; i < SLOTS_PER_LOC; i++) {
      var slot = document.createElement('div');
      slot.className         = 'battle-card-slot';
      slot.dataset.locId     = locId;
      slot.dataset.owner     = owner;
      slot.dataset.slotIndex = i;
      area.appendChild(slot);
    }

    return area;
  }

  function buildLocationTile(loc) {
    var tile = document.createElement('div');
    tile.className    = 'battle-location';
    tile.dataset.locId = loc.id;

    var scoreOpp = document.createElement('div');
    scoreOpp.className   = 'battle-loc-score-opp';
    scoreOpp.textContent = '0';
    scoreOpp.id          = 'loc-score-opp-' + loc.id;

    var info = document.createElement('div');
    info.className = 'battle-loc-info';

    var name = document.createElement('div');
    name.className   = 'battle-loc-name';
    name.textContent = loc.name;

    var region = document.createElement('div');
    region.className   = 'battle-loc-region';
    region.textContent = loc.region;

    var ability = document.createElement('div');
    ability.className   = 'battle-loc-ability';
    ability.textContent = loc.abilityText;

    info.appendChild(name);
    info.appendChild(region);
    info.appendChild(ability);

    var scorePlayer = document.createElement('div');
    scorePlayer.className   = 'battle-loc-score-player';
    scorePlayer.textContent = '0';
    scorePlayer.id          = 'loc-score-player-' + loc.id;

    tile.appendChild(scoreOpp);
    tile.appendChild(info);
    tile.appendChild(scorePlayer);

    return tile;
  }

  /* ── Player hand cards ───────────────────────────────────────── */

  /**
   * buildHandCard(card)
   * Builds a hand card element reusing the deck-builder image/overlay
   * structure (.db-card-img-wrap, .db-overlay-cc, .db-overlay-ip).
   * CSS on .battle-hand-card scales the overlays to hand size.
   */
  function buildHandCard(card) {
    var el = document.createElement('div');
    el.className  = 'battle-hand-card';
    el.dataset.id = card.id;

    var imgWrap = document.createElement('div');
    imgWrap.className = 'db-card-img-wrap';

    var ph = document.createElement('div');
    ph.className  = 'db-card-img-placeholder';
    ph.textContent = card.name.charAt(0);

    var img = document.createElement('img');
    img.className = 'db-card-img';
    img.alt       = card.name;
    img.src       = 'images/cards/' + card.name + '.jpg';
    img.onerror   = function () { this.style.display = 'none'; };

    imgWrap.appendChild(ph);
    imgWrap.appendChild(img);

    var ccEl = document.createElement('div');
    ccEl.className   = 'db-overlay-cc';
    ccEl.textContent = card.cc;

    var ipEl = document.createElement('div');
    ipEl.className   = 'db-overlay-ip';
    ipEl.textContent = card.ip;

    el.appendChild(imgWrap);
    el.appendChild(ccEl);
    el.appendChild(ipEl);

    return el;
  }

  /* ── Global exports ──────────────────────────────────────────── */
  window.initBattleUI  = initBattleUI;
  window.setPlayerHand = setPlayerHand;

})();
