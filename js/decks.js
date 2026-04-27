/**
 * decks.js
 * Multi-deck save system for Shoulders of Giants.
 *
 * Stores up to 3 decks under localStorage key `sog_decks`, plus an
 * active-slot pointer in `sog_active_deck_slot`. Migrates the legacy
 * single-deck `sog_saved_deck` key into Slot 1 on first load, then
 * deletes it.
 *
 * All deck reads and writes across the codebase go through window.Decks.
 * This is the only module that touches deck-related localStorage keys.
 */
(function () {
  'use strict';

  var DECKS_KEY  = 'sog_decks';
  var ACTIVE_KEY = 'sog_active_deck_slot';
  var LEGACY_KEY = 'sog_saved_deck';
  var SLOT_COUNT = 3;
  var NAME_MAX   = 20;
  var DECK_SIZE  = 15;

  // Allow alphanumerics, spaces, basic punctuation. Strip everything else
  // (emojis, control chars, layout-breakers).
  var NAME_SAFE_STRIP = /[^A-Za-z0-9 .,!?'\-]/g;

  function defaultName(slot) { return 'Deck ' + slot; }

  function emptyDecks() {
    var arr = [];
    for (var i = 1; i <= SLOT_COUNT; i++) {
      arr.push({ id: i, name: defaultName(i), cards: [] });
    }
    return arr;
  }

  function sanitizeName(raw, slot) {
    if (typeof raw !== 'string') return defaultName(slot);
    var clean = raw.replace(NAME_SAFE_STRIP, '').trim().slice(0, NAME_MAX);
    return clean || defaultName(slot);
  }

  function readDecks() {
    try {
      var s = localStorage.getItem(DECKS_KEY);
      if (s) {
        var parsed = JSON.parse(s);
        if (Array.isArray(parsed) && parsed.length === SLOT_COUNT) {
          // Validate shape — fall back to empty if malformed
          var ok = parsed.every(function (d, i) {
            return d && typeof d === 'object'
                && d.id === (i + 1)
                && typeof d.name === 'string'
                && Array.isArray(d.cards);
          });
          if (ok) return parsed;
        }
      }
    } catch (e) {}
    return null;
  }

  function persistDecks(decks) {
    try { localStorage.setItem(DECKS_KEY, JSON.stringify(decks)); } catch (e) {}
  }

  function readActive() {
    try {
      var n = parseInt(localStorage.getItem(ACTIVE_KEY), 10);
      if (n >= 1 && n <= SLOT_COUNT) return n;
    } catch (e) {}
    return 1;
  }

  function persistActive(slot) {
    try { localStorage.setItem(ACTIVE_KEY, String(slot)); } catch (e) {}
  }

  // ── State + migration on module load ──────────────────────────
  var _decks  = readDecks();
  var _active = readActive();
  var _migrated = false;

  if (!_decks) {
    _decks = emptyDecks();
    // Migrate legacy single-deck data into Slot 1
    try {
      var legacy = localStorage.getItem(LEGACY_KEY);
      if (legacy) {
        var legacyArr = JSON.parse(legacy);
        if (Array.isArray(legacyArr)) {
          // Trim to deck size just in case
          _decks[0].cards = legacyArr.slice(0, DECK_SIZE);
          _migrated = true;
        }
      }
    } catch (e) {}
    persistDecks(_decks);
  }
  // Always remove the legacy key — it's owned by this module now
  try { localStorage.removeItem(LEGACY_KEY); } catch (e) {}

  // ── Public API ────────────────────────────────────────────────

  function getActiveSlot() { return _active; }

  function setActiveSlot(slot) {
    slot = parseInt(slot, 10);
    if (!(slot >= 1 && slot <= SLOT_COUNT)) return false;
    _active = slot;
    persistActive(slot);
    return true;
  }

  function getDeck(slot) {
    var idx = parseInt(slot, 10) - 1;
    return _decks[idx] || null;
  }

  function getAllDecks() { return _decks.slice(); }

  function getActive() { return _decks[_active - 1]; }

  function getActiveCards() { return _decks[_active - 1].cards.slice(); }

  function getCardCount(slot) {
    var d = getDeck(slot || _active);
    return d ? d.cards.length : 0;
  }

  function _save() { persistDecks(_decks); }

  function addCard(cardId) {
    var d = _decks[_active - 1];
    if (d.cards.length >= DECK_SIZE) return false;
    if (d.cards.indexOf(cardId) !== -1) return false;
    d.cards.push(cardId);
    _save();
    return true;
  }

  function removeCard(cardId) {
    var d = _decks[_active - 1];
    var i = d.cards.indexOf(cardId);
    if (i === -1) return false;
    d.cards.splice(i, 1);
    _save();
    return true;
  }

  function hasCard(cardId) {
    return _decks[_active - 1].cards.indexOf(cardId) !== -1;
  }

  function rename(slot, raw) {
    var d = getDeck(slot);
    if (!d) return false;
    d.name = sanitizeName(raw, slot);
    _save();
    return true;
  }

  function clearAll() {
    _decks  = emptyDecks();
    _active = 1;
    persistDecks(_decks);
    persistActive(_active);
    try { localStorage.removeItem(LEGACY_KEY); } catch (e) {}
  }

  /**
   * Filter every slot's cards through a predicate (e.g. drop locked types).
   * Mutates state and persists if anything changed.
   */
  function filterAllCards(predicate) {
    var changed = false;
    _decks.forEach(function (d) {
      var orig = d.cards.length;
      d.cards = d.cards.filter(predicate);
      if (d.cards.length !== orig) changed = true;
    });
    if (changed) _save();
  }

  function wasMigrated() { return _migrated; }

  window.Decks = {
    SLOT_COUNT:     SLOT_COUNT,
    DECK_SIZE:      DECK_SIZE,
    NAME_MAX:       NAME_MAX,
    getActiveSlot:  getActiveSlot,
    setActiveSlot:  setActiveSlot,
    getDeck:        getDeck,
    getAllDecks:    getAllDecks,
    getActive:      getActive,
    getActiveCards: getActiveCards,
    getCardCount:   getCardCount,
    addCard:        addCard,
    removeCard:     removeCard,
    hasCard:        hasCard,
    rename:         rename,
    clearAll:       clearAll,
    filterAllCards: filterAllCards,
    sanitizeName:   sanitizeName,
    defaultName:    defaultName,
    wasMigrated:    wasMigrated
  };
})();
