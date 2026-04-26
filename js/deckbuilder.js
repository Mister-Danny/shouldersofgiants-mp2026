/**
 * deckbuilder.js
 * Shoulders of Giants — Deck Builder Module
 *
 * Card interactions:
 *   Single click  → opens read-only SNES ability popup
 *   Double click  → toggles card in/out of deck + shows flash feedback
 *
 * Card tile display:
 *   - Full-bleed PNG filling the slot
 *   - CC (top-left)  : large CT Galbite, white @ 75% opacity
 *   - IP (top-right) : large CT Galbite, black with white outline
 *   - "IN DECK" badge fades in at bottom when selected
 *
 * Popup is read-only — ability name + text only, no add/remove buttons.
 * Dismiss with CLOSE button, Escape key, or clicking the backdrop.
 *
 * Depends on: CARDS (js/cards.js), showScreen() (index.html)
 */

(function () {
  'use strict';

  /* ── Constants ───────────────────────────────────────────────── */
  const DECK_SIZE   = 15;
  const STORAGE_KEY = 'sog_saved_deck';
  const TYPE_ORDER  = ['Political', 'Religious', 'Military', 'Cultural', 'Exploration', 'Scientific'];

  /* ── State ───────────────────────────────────────────────────── */
  const _stored   = localStorage.getItem(STORAGE_KEY);
  let selectedIds = _stored ? new Set(JSON.parse(_stored)) : new Set();
  let popupCardId = null; // ID of card currently shown in popup

  /* ── DOM refs ────────────────────────────────────────────────── */
  const mainEl    = document.getElementById('db-main');
  const counterEl = document.getElementById('db-counter');
  const saveBtn   = document.getElementById('db-save');
  const backBtn   = document.getElementById('db-back');
  const toastEl   = document.getElementById('save-toast');

  // Popup (read-only: name + ability only)
  const backdropEl      = document.getElementById('card-popup-backdrop');
  const popupNameEl     = document.getElementById('popup-name');
  const popupAbilNameEl = document.getElementById('popup-ability-name');
  const popupAbilTextEl = document.getElementById('popup-ability-text');
  const popupCloseBtn   = document.getElementById('popup-close-btn');

  /* ── Entry point ─────────────────────────────────────────────── */
  function initDeckBuilder() {
    // Filter out any saved cards that belong to locked types
    if (typeof Progression !== 'undefined') {
      var unlocked = Progression.getUnlockedTypes();
      selectedIds.forEach(function (id) {
        var card = CARDS.find(function (c) { return c.id === id; });
        if (card && unlocked.indexOf(card.type) === -1) selectedIds.delete(id);
      });
    }
    renderAllGroups();
    updateUI();
    mainEl.scrollTop = 0;
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
          hint = '\uD83D\uDD12 Unlocks with ' + remaining + ' More Win' + (remaining !== 1 ? 's' : '') + ' Against the Serf';
        } else if (type === 'Exploration') {
          var gw = typeof Progression !== 'undefined' ? Progression.getGiantWins() : 0;
          var remaining2 = 3 - gw;
          hint = '\uD83D\uDD12 Unlocks with ' + remaining2 + ' More Win' + (remaining2 !== 1 ? 's' : '') + ' Against the Giant';
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

  /**
   * buildCardEl(card)
   * Full-bleed PNG tile with CC / IP overlays.
   *
   * Single click → openPopup (read-only ability view)
   * Double click → toggleCard + flashCard
   */
  function buildCardEl(card, locked) {
    var el = document.createElement('div');
    el.className = 'db-card type-' + card.type.toLowerCase() +
                   (selectedIds.has(card.id) ? ' selected' : '') +
                   (locked ? ' db-card-locked' : '');
    el.dataset.id = card.id;

    // ── Full-bleed image ──
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

    // ── CC — top-left, large, white 75% ──
    var ccEl = document.createElement('div');
    ccEl.className = 'db-overlay-cc';
    ccEl.textContent = card.cc;

    // ── IP — top-right, large, black + white outline ──
    var ipEl = document.createElement('div');
    ipEl.className = 'db-overlay-ip';
    ipEl.textContent = card.ip;

    // ── "IN DECK" badge ──
    var badge = document.createElement('div');
    badge.className = 'db-card-in-deck';
    badge.textContent = 'IN DECK';

    el.appendChild(imgWrap);
    el.appendChild(ccEl);
    el.appendChild(ipEl);
    el.appendChild(badge);

    // ── Lock overlay for locked cards ──
    if (locked) {
      var lockOverlay = document.createElement('div');
      lockOverlay.className = 'db-card-lock-overlay';
      var lockIcon = document.createElement('span');
      lockIcon.className = 'lock-icon';
      lockIcon.textContent = '\uD83D\uDD12';
      lockOverlay.appendChild(lockIcon);
      el.appendChild(lockOverlay);
    }

    // ── Click handler — distinguishes single vs double click ─────
    var clickTimer = null;
    var DBLCLICK_MS = 350;

    el.addEventListener('click', function () {
      if (locked) {
        // Locked cards: single click opens grayscale popup, no double-click
        openPopup(card, true);
        return;
      }

      if (clickTimer) {
        // ── Second click arrived within the window → double-click ──
        clearTimeout(clickTimer);
        clickTimer = null;

        var wasSelected = selectedIds.has(card.id);
        var ok = toggleCard(card.id);
        if (ok) {
          flashCard(el, !wasSelected); // green pulse = added, dim = removed
        } else {
          flashCounter();              // deck full — flash the counter
        }

      } else {
        // ── First click → start window; fire popup if no second click ──
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
   * toggleCard(id)
   * Adds or removes a card from selectedIds.
   * Returns false (and does nothing) when trying to add beyond DECK_SIZE.
   */
  function toggleCard(id) {
    // Block locked card types
    if (typeof Progression !== 'undefined') {
      var card = CARDS.find(function (c) { return c.id === id; });
      if (card && !Progression.isTypeUnlocked(card.type)) return false;
    }
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
      setCardSelected(id, false);
      updateUI();
      return true;
    }
    if (selectedIds.size >= DECK_SIZE) return false;
    selectedIds.add(id);
    setCardSelected(id, true);
    updateUI();
    return true;
  }

  function setCardSelected(id, on) {
    var el = mainEl.querySelector('[data-id="' + id + '"]');
    if (el) el.classList.toggle('selected', on);
  }

  /* ── Visual feedback ─────────────────────────────────────────── */

  /**
   * flashCard(el, wasAdded)
   * Plays a brief CSS animation on the card tile so the player can
   * see the double-click registered.
   *   wasAdded = true  → green pulse  (card entered deck)
   *   wasAdded = false → dim fade-out (card left deck)
   */
  function flashCard(el, wasAdded) {
    var cls = wasAdded ? 'flash-add' : 'flash-remove';
    el.classList.remove('flash-add', 'flash-remove');
    void el.offsetWidth; // restart animation if triggered twice quickly
    el.classList.add(cls);
    setTimeout(function () { el.classList.remove(cls); }, 400);
  }

  /* ── UI state ────────────────────────────────────────────────── */

  function updateUI() {
    var count = selectedIds.size;
    counterEl.textContent = count + ' / ' + DECK_SIZE;
    counterEl.classList.toggle('complete', count === DECK_SIZE);
    saveBtn.disabled    = count !== DECK_SIZE;
    saveBtn.textContent = window.versusStudentMode ? 'Lock In Deck'
                        : window.multiplayerMode    ? 'Enter Lobby'
                        : "Let's Play";
  }

  function flashCounter() {
    counterEl.classList.remove('flash');
    void counterEl.offsetWidth;
    counterEl.classList.add('flash');
    setTimeout(function () { counterEl.classList.remove('flash'); }, 460);
  }

  /* ── Popup (read-only ability viewer) ────────────────────────── */

  /**
   * openPopup(card)
   * Shows the SNES dialogue box with the card's ability name + text.
   * No selection buttons — this is a read-only reference view.
   */
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

  /* ── Persistence ─────────────────────────────────────────────── */

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
    if (selectedIds.size !== DECK_SIZE) return;
    if (window.versusStudentMode) {
      var ids = Array.from(selectedIds);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
      stopDeckMusic();
      if (window.BattleLobby && typeof window.BattleLobby.onLockInDeck === 'function') {
        window.BattleLobby.onLockInDeck(ids);
      }
      return;
    }
    if (window.multiplayerMode) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(selectedIds)));
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
    window.aiDifficulty = difficulty;   // read by game.js runAiSelection
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(selectedIds)));
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

  // Click outside popup panel to dismiss
  backdropEl.addEventListener('click', function (e) {
    if (e.target === backdropEl) closePopup();
  });

  // Escape key
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && popupCardId !== null) closePopup();
  });

  saveBtn.addEventListener('click', openDifficultyModal);
  backBtn.addEventListener('click', function () { stopDeckMusic(); showScreen('screen-home'); });

  // Export so tutorial.js can re-enter the deck builder after tutorial ends
  window.initDeckBuilder = initDeckBuilder;

  document.getElementById('btn-deselect-all').addEventListener('click', function () {
    selectedIds.forEach(function (id) { setCardSelected(id, false); });
    selectedIds.clear();
    updateUI();
  });

  /* ── Home screen buttons ─────────────────────────────────────── */

  // "Versus Mode" — routes to BattleLobby student join if available
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

  // "I'm Ready" — first-time: Lucy intro → video → tutorial
  //               returning:  straight to deck builder
  document.getElementById('btn-ready').addEventListener('click', function () {
    window.multiplayerMode = false;
    if (localStorage.getItem('sog_tutorial_complete')) {
      showScreen('screen-deckbuilder');
      initDeckBuilder();
      playDeckMusic();
      return;
    }
    // First-time player: Lucy 3-line home intro, then video
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
      // Reset scroll to top on every open
      var aboutMain = document.querySelector('#screen-about .about-main');
      if (aboutMain) aboutMain.scrollTop = 0;
    });
  }
  var btnAboutBack = document.getElementById('about-back');
  if (btnAboutBack) {
    btnAboutBack.addEventListener('click', function () { showScreen('screen-home'); });
  }

  // "I'm Ready To Learn" — always replays the full intro → video → tutorial flow
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

  // Video ended → matchup screen → battle + tutorial
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

  // "Watch Intro" button in the deck builder header — plays the intro video
  document.getElementById('db-watch-intro').addEventListener('click', function () {
    stopDeckMusic();
    var video = document.getElementById('intro-video');
    video.currentTime = 0;
    video.play().catch(function () {});
    showScreen('screen-video');
  });

  /* ── Returning-visitor skip ──────────────────────────────────── */
  // Tutorial complete → skip Lucy + video, go straight to deck builder.
  if (localStorage.getItem('sog_tutorial_complete')) {
    showScreen('screen-deckbuilder');
    initDeckBuilder();
    playDeckMusic();
  }

})();
