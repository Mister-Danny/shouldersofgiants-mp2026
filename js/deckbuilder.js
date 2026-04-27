/**
 * deckbuilder.js
 * Shoulders of Giants — Deck Builder Module
 *
 * Multi-deck support:
 *   The active deck is whichever slot is currently selected in
 *   window.Decks. All add/remove/rename operations auto-save through
 *   that module — there is no Save button.
 *
 * Card interactions:
 *   Single click  → opens read-only ability popup
 *   Double click  → toggles card in/out of active slot's deck
 *
 * Slot row interactions:
 *   Click slot card        → switches active slot (re-renders grid + counter)
 *   Click pencil icon      → opens Rename Deck modal
 *
 * Depends on: window.Decks (js/decks.js), CARDS (js/cards.js),
 *             showScreen() (index.html)
 */

(function () {
  'use strict';

  /* ── Constants ───────────────────────────────────────────────── */
  var DECK_SIZE  = (window.Decks && window.Decks.DECK_SIZE) || 15;
  var SLOT_COUNT = (window.Decks && window.Decks.SLOT_COUNT) || 3;
  var TYPE_ORDER = ['Political', 'Religious', 'Military', 'Cultural', 'Exploration', 'Scientific'];

  /* ── State ───────────────────────────────────────────────────── */
  var popupCardId = null;       // ID of card currently shown in popup
  var renameSlot  = null;       // slot currently being renamed (1/2/3)

  /* ── DOM refs ────────────────────────────────────────────────── */
  var mainEl    = document.getElementById('db-main');
  var counterEl = document.getElementById('db-counter');
  var saveBtn   = document.getElementById('db-save');
  var saveHint  = document.getElementById('db-save-hint');
  var backBtn   = document.getElementById('db-back');
  var slotRowEl = document.getElementById('db-slot-row');

  // Card-detail popup (read-only)
  var backdropEl      = document.getElementById('card-popup-backdrop');
  var popupNameEl     = document.getElementById('popup-name');
  var popupAbilNameEl = document.getElementById('popup-ability-name');
  var popupAbilTextEl = document.getElementById('popup-ability-text');
  var popupCloseBtn   = document.getElementById('popup-close-btn');

  // Rename modal
  var renameBackdrop  = document.getElementById('rename-deck-backdrop');
  var renameInput     = document.getElementById('rename-deck-input');
  var renameCounter   = document.getElementById('rename-deck-counter-num');
  var renameSaveBtn   = document.getElementById('rename-deck-save');
  var renameCancelBtn = document.getElementById('rename-deck-cancel');

  /* ── Selection helpers (delegate to Decks) ───────────────────── */

  function isSelected(cardId)    { return window.Decks.hasCard(cardId); }
  function activeCards()         { return window.Decks.getActiveCards(); }
  function activeCardCount()     { return activeCards().length; }

  /* ── Entry point ─────────────────────────────────────────────── */

  function initDeckBuilder() {
    // Drop any saved cards in any slot that belong to locked types now
    if (typeof Progression !== 'undefined') {
      var unlocked = Progression.getUnlockedTypes();
      window.Decks.filterAllCards(function (id) {
        var card = CARDS.find(function (c) { return c.id === id; });
        return !card || unlocked.indexOf(card.type) !== -1;
      });
    }
    renderSlotRow();
    renderAllGroups();
    updateUI();
    mainEl.scrollTop = 0;
  }

  /* ── Slot row rendering ──────────────────────────────────────── */

  function renderSlotRow() {
    if (!slotRowEl) return;
    slotRowEl.innerHTML = '';
    var active = window.Decks.getActiveSlot();
    for (var slot = 1; slot <= SLOT_COUNT; slot++) {
      slotRowEl.appendChild(buildSlotCard(slot, slot === active));
    }
  }

  function buildSlotCard(slot, isActive) {
    var deck = window.Decks.getDeck(slot);
    var el = document.createElement('div');
    el.className = 'db-slot-card' + (isActive ? ' active' : '');
    el.dataset.slot = String(slot);

    var name = document.createElement('span');
    name.className = 'db-slot-name';
    name.textContent = deck.name;

    var edit = document.createElement('button');
    edit.className = 'db-slot-edit';
    edit.type = 'button';
    edit.setAttribute('aria-label', 'Rename ' + deck.name);
    edit.innerHTML = '✎'; // pencil ✎

    // Whole card switches active slot (except clicks on the pencil)
    el.addEventListener('click', function (e) {
      if (e.target.closest('.db-slot-edit')) return; // pencil handles itself
      switchToSlot(slot);
    });

    // Pencil opens rename modal
    edit.addEventListener('click', function (e) {
      e.stopPropagation();
      openRenameModal(slot);
    });

    el.appendChild(name);
    el.appendChild(edit);
    return el;
  }

  function switchToSlot(slot) {
    if (slot === window.Decks.getActiveSlot()) return;
    window.Decks.setActiveSlot(slot);
    // Full re-render so all "selected" / "in-deck" states reflect the new slot
    renderSlotRow();
    renderAllGroups();
    updateUI();
  }

  /* ── Rendering ───────────────────────────────────────────────── */

  function renderAllGroups() {
    mainEl.innerHTML = '';
    TYPE_ORDER.forEach(function (type) {
      var cards = CARDS.filter(function (c) { return c.type === type && !c.locked; });
      if (!cards.length) return;

      var locked = typeof Progression !== 'undefined' && !Progression.isTypeUnlocked(type);

      var section = document.createElement('section');
      section.className = 'db-type-group type-' + type.toLowerCase() + (locked ? ' locked' : '');

      var header = document.createElement('div');
      header.className = 'db-type-header';
      var headerHTML =
        '<div class="db-type-pip"></div>' +
        '<span class="db-type-label">' + type + '</span>' +
        '<span class="db-type-count">(' + cards.length + ')</span>';
      if (locked) {
        var hint = '';
        if (type === 'Religious') {
          var sw = typeof Progression !== 'undefined' ? Progression.getSerfWins() : 0;
          var remaining = 3 - sw;
          hint = '🔒 Unlocks with ' + remaining + ' More Win' + (remaining !== 1 ? 's' : '') + ' Against the Serf';
        } else if (type === 'Exploration') {
          var gw = typeof Progression !== 'undefined' ? Progression.getGiantWins() : 0;
          var remaining2 = 3 - gw;
          hint = '🔒 Unlocks with ' + remaining2 + ' More Win' + (remaining2 !== 1 ? 's' : '') + ' Against the Giant';
        }
        headerHTML += '<span class="db-type-lock-badge">' + hint + '</span>';
      }
      header.innerHTML = headerHTML;

      var row = document.createElement('div');
      row.className = 'db-card-row';
      cards.forEach(function (card) { row.appendChild(buildCardEl(card, locked)); });

      section.appendChild(header);
      section.appendChild(row);
      mainEl.appendChild(section);
    });
  }

  function buildCardEl(card, locked) {
    var el = document.createElement('div');
    el.className = 'db-card type-' + card.type.toLowerCase() +
                   (isSelected(card.id) ? ' selected' : '') +
                   (locked ? ' db-card-locked' : '');
    el.dataset.id = card.id;

    // Image + overlays
    var imgWrap = document.createElement('div');
    imgWrap.className = 'db-card-img-wrap';

    var ph = document.createElement('div');
    ph.className = 'db-card-img-placeholder';
    ph.textContent = card.name.charAt(0);

    var img = document.createElement('img');
    img.className = 'db-card-img';
    img.alt = card.name;
    img.src = 'images/cards/' + card.name + '.jpg';
    img.onerror = function () { this.style.display = 'none'; };

    imgWrap.appendChild(ph);
    imgWrap.appendChild(img);

    var ccEl = document.createElement('div');
    ccEl.className = 'db-overlay-cc';
    ccEl.textContent = card.cc;

    var ipEl = document.createElement('div');
    ipEl.className = 'db-overlay-ip';
    ipEl.textContent = card.ip;

    var badge = document.createElement('div');
    badge.className = 'db-card-in-deck';
    badge.textContent = 'IN DECK';

    el.appendChild(imgWrap);
    el.appendChild(ccEl);
    el.appendChild(ipEl);
    el.appendChild(badge);

    if (locked) {
      var lockOverlay = document.createElement('div');
      lockOverlay.className = 'db-card-lock-overlay';
      var lockIcon = document.createElement('span');
      lockIcon.className = 'lock-icon';
      lockIcon.textContent = '🔒';
      lockOverlay.appendChild(lockIcon);
      el.appendChild(lockOverlay);
    }

    // Single vs double-click distinction
    var clickTimer = null;
    var DBLCLICK_MS = 350;

    el.addEventListener('click', function () {
      if (locked) {
        openPopup(card, true);
        return;
      }

      if (clickTimer) {
        clearTimeout(clickTimer);
        clickTimer = null;
        var wasSelected = isSelected(card.id);
        var ok = toggleCard(card.id);
        if (ok) {
          flashCard(el, !wasSelected);
        } else {
          flashCounter();
        }
      } else {
        clickTimer = setTimeout(function () {
          clickTimer = null;
          openPopup(card);
        }, DBLCLICK_MS);
      }
    });

    return el;
  }

  /* ── Selection logic ─────────────────────────────────────────── */

  /**
   * Adds or removes the card from the active slot.
   * Returns false (and does nothing) when trying to add beyond DECK_SIZE
   * or when the card type is locked.
   */
  function toggleCard(id) {
    if (typeof Progression !== 'undefined') {
      var card = CARDS.find(function (c) { return c.id === id; });
      if (card && !Progression.isTypeUnlocked(card.type)) return false;
    }
    var ok;
    if (isSelected(id)) {
      ok = window.Decks.removeCard(id);
      if (ok) setCardSelected(id, false);
    } else {
      ok = window.Decks.addCard(id);
      if (ok) setCardSelected(id, true);
    }
    if (ok) updateUI();
    return ok;
  }

  function setCardSelected(id, on) {
    var el = mainEl.querySelector('[data-id="' + id + '"]');
    if (el) el.classList.toggle('selected', on);
  }

  /* ── Visual feedback ─────────────────────────────────────────── */

  function flashCard(el, wasAdded) {
    var cls = wasAdded ? 'flash-add' : 'flash-remove';
    el.classList.remove('flash-add', 'flash-remove');
    void el.offsetWidth;
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, 400);
  }

  function flashCounter() {
    counterEl.classList.remove('flash');
    void counterEl.offsetWidth;
    counterEl.classList.add('flash');
    setTimeout(function () { counterEl.classList.remove('flash'); }, 460);
  }

  /* ── UI state ────────────────────────────────────────────────── */

  function updateUI() {
    var count = activeCardCount();
    counterEl.textContent = count + ' / ' + DECK_SIZE;
    counterEl.classList.toggle('complete', count === DECK_SIZE);
    saveBtn.disabled    = count !== DECK_SIZE;
    saveBtn.textContent = window.versusStudentMode ? 'Lock In Deck'
                        : window.multiplayerMode    ? 'Enter Lobby'
                        : "Let's Play";
  }

  /* ── Popup (read-only ability viewer) ────────────────────────── */

  function openPopup(card, isLocked) {
    popupCardId = card.id;
    popupNameEl.textContent = card.name;
    if (card.ability) {
      popupAbilNameEl.textContent = card.abilityName;
      popupAbilNameEl.style.display = '';
      popupAbilTextEl.textContent   = card.ability;
      popupAbilTextEl.className     = 'popup-ability-text';
    } else {
      popupAbilNameEl.style.display = 'none';
      popupAbilTextEl.textContent   = 'No special ability.';
      popupAbilTextEl.className     = 'popup-ability-text vanilla';
    }
    backdropEl.classList.toggle('popup-locked', !!isLocked);
    backdropEl.classList.add('visible');
  }

  function closePopup() {
    backdropEl.classList.remove('visible');
    popupCardId = null;
  }

  /* ── Rename modal ────────────────────────────────────────────── */

  function openRenameModal(slot) {
    var deck = window.Decks.getDeck(slot);
    if (!deck) return;
    renameSlot = slot;
    renameInput.value = deck.name;
    renameCounter.textContent = renameInput.value.length;
    renameBackdrop.classList.add('visible');
    // Focus + select the text on next tick so the popup transition completes
    setTimeout(function () {
      renameInput.focus();
      renameInput.select();
    }, 30);
  }

  function closeRenameModal() {
    renameBackdrop.classList.remove('visible');
    renameSlot = null;
  }

  function commitRename() {
    if (renameSlot === null) return;
    window.Decks.rename(renameSlot, renameInput.value);
    renderSlotRow(); // re-render shows the new name
    closeRenameModal();
  }

  /* ── Persistence (now thin — Decks owns it) ──────────────────── */

  // Deck-select background music (Howler for reliable cross-browser playback)
  var _deckHowl = null;

  function getDeckMusic() {
    if (!_deckHowl && typeof Howl !== 'undefined') {
      _deckHowl = new Howl({
        src:    ['music/Dozing Off Card Select.m4a'],
        volume: 0.5,
        loop:   false,
        html5:  true
      });
    }
    return _deckHowl;
  }

  function playDeckMusic() {
    var m = getDeckMusic();
    if (!m) return;
    if (!m.playing()) { m.seek(0); m.play(); }
  }

  function stopDeckMusic() {
    if (_deckHowl && _deckHowl.playing()) { _deckHowl.stop(); }
  }

  /* ── Difficulty modal ────────────────────────────────────────── */

  var diffBackdropEl = document.getElementById('difficulty-backdrop');

  function openDifficultyModal() {
    if (activeCardCount() !== DECK_SIZE) return;
    if (window.versusStudentMode) {
      stopDeckMusic();
      if (window.BattleLobby && typeof window.BattleLobby.onLockInDeck === 'function') {
        window.BattleLobby.onLockInDeck(activeCards());
      }
      return;
    }
    if (window.multiplayerMode) {
      stopDeckMusic();
      if (window.Multiplayer && typeof window.Multiplayer.showLobbyEntry === 'function') {
        window.Multiplayer.showLobbyEntry();
      }
      return;
    }
    diffBackdropEl.classList.add('visible');
  }

  function chooseDifficulty(difficulty) {
    diffBackdropEl.classList.remove('visible');
    window.aiDifficulty = difficulty;
    stopDeckMusic();
    showScreen('screen-battle');
    if (typeof initGame === 'function') initGame();
  }

  document.getElementById('btn-difficulty-easy').addEventListener('click', function () {
    chooseDifficulty('easy');
  });
  document.getElementById('btn-difficulty-hard').addEventListener('click', function () {
    chooseDifficulty('hard');
  });
  diffBackdropEl.addEventListener('click', function (e) {
    if (e.target === diffBackdropEl) diffBackdropEl.classList.remove('visible');
  });

  /* ── Event wiring ────────────────────────────────────────────── */

  popupCloseBtn.addEventListener('click', closePopup);
  backdropEl.addEventListener('click', function (e) {
    if (e.target === backdropEl) closePopup();
  });

  // Rename modal wiring
  renameSaveBtn.addEventListener('click', commitRename);
  renameCancelBtn.addEventListener('click', closeRenameModal);
  renameBackdrop.addEventListener('click', function (e) {
    if (e.target === renameBackdrop) closeRenameModal();
  });
  renameInput.addEventListener('input', function () {
    renameCounter.textContent = renameInput.value.length;
  });
  renameInput.addEventListener('keydown', function (e) {
    if (e.key === 'Enter')      { e.preventDefault(); commitRename(); }
    else if (e.key === 'Escape'){ e.preventDefault(); closeRenameModal(); }
  });

  // Global Escape — close whichever popup is open
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (renameBackdrop.classList.contains('visible')) closeRenameModal();
    else if (popupCardId !== null) closePopup();
  });

  saveBtn.addEventListener('click', openDifficultyModal);
  backBtn.addEventListener('click', function () { stopDeckMusic(); showScreen('screen-home'); });

  // Export so tutorial.js can re-enter the deck builder after tutorial ends
  window.initDeckBuilder = initDeckBuilder;

  /* ── Home screen buttons ─────────────────────────────────────── */

  document.getElementById('btn-versus').addEventListener('click', function () {
    if (window.BattleLobby && typeof window.BattleLobby.showStudentJoin === 'function') {
      window.BattleLobby.showStudentJoin();
      return;
    }
    window.multiplayerMode = true;
    showScreen('screen-deckbuilder');
    initDeckBuilder();
    playDeckMusic();
  });

  document.getElementById('btn-ready').addEventListener('click', function () {
    window.multiplayerMode = false;
    if (localStorage.getItem('sog_tutorial_complete')) {
      showScreen('screen-deckbuilder');
      initDeckBuilder();
      playDeckMusic();
      return;
    }
    if (typeof window.startHomeIntro === 'function') {
      window.startHomeIntro(function () {
        var video = document.getElementById('intro-video');
        video.currentTime = 0;
        video.play().catch(function () {});
        showScreen('screen-video');
      });
    }
  });

  // "About the Game" — open the About screen, no music change
  var btnAbout = document.getElementById('btn-about');
  if (btnAbout) {
    btnAbout.addEventListener('click', function () {
      showScreen('screen-about');
      var aboutMain = document.querySelector('#screen-about .about-main');
      if (aboutMain) aboutMain.scrollTop = 0;
    });
  }
  var btnAboutBack = document.getElementById('about-back');
  if (btnAboutBack) {
    btnAboutBack.addEventListener('click', function () { showScreen('screen-home'); });
  }

  document.getElementById('btn-learn').addEventListener('click', function () {
    window.multiplayerMode = false;
    localStorage.removeItem('sog_tutorial_complete');
    if (typeof window.startHomeIntro === 'function') {
      window.startHomeIntro(function () {
        var video = document.getElementById('intro-video');
        video.currentTime = 0;
        video.play().catch(function () {});
        showScreen('screen-video');
      });
    }
  });

  document.getElementById('intro-video').addEventListener('ended', function () {
    if (typeof window.showMatchupScreen === 'function') {
      window.showMatchupScreen(function () {
        showScreen('screen-battle');
        if (typeof window.startTutorial === 'function') window.startTutorial();
      });
    } else {
      showScreen('screen-battle');
      if (typeof window.startTutorial === 'function') window.startTutorial();
    }
  });

  document.getElementById('coming-soon-close').addEventListener('click', function () {
    document.getElementById('coming-soon-backdrop').classList.remove('visible');
  });

  document.getElementById('coming-soon-backdrop').addEventListener('click', function (e) {
    if (e.target === this) this.classList.remove('visible');
  });

  /* ── Returning-visitor skip ──────────────────────────────────── */
  // Tutorial complete → skip Lucy + video, go straight to deck builder.
  if (localStorage.getItem('sog_tutorial_complete')) {
    showScreen('screen-deckbuilder');
    initDeckBuilder();
    playDeckMusic();
  }

})();
