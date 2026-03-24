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
  const TYPE_ORDER  = ['Political', 'Religious', 'Military', 'Cultural', 'Exploration'];

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
    renderAllGroups();
    updateUI();
    mainEl.scrollTop = 0;
  }

  /* ── Rendering ───────────────────────────────────────────────── */

  function renderAllGroups() {
    mainEl.innerHTML = '';
    TYPE_ORDER.forEach(function (type) {
      var cards = CARDS.filter(function (c) { return c.type === type; });
      if (!cards.length) return;

      var section = document.createElement('section');
      section.className = 'db-type-group type-' + type.toLowerCase();

      var header = document.createElement('div');
      header.className = 'db-type-header';
      header.innerHTML =
        '<div class="db-type-pip"></div>' +
        '<span class="db-type-label">' + type + '</span>' +
        '<span class="db-type-count">(' + cards.length + ')</span>';

      var row = document.createElement('div');
      row.className = 'db-card-row';
      cards.forEach(function (card) { row.appendChild(buildCardEl(card)); });

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
  function buildCardEl(card) {
    var el = document.createElement('div');
    el.className = 'db-card type-' + card.type.toLowerCase() +
                   (selectedIds.has(card.id) ? ' selected' : '');
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

    // imgWrap is out of normal flow (position:absolute); overlays are direct
    // children of el (.db-card, position:relative, z-index:0) so they sit in
    // the card's own stacking context and cannot escape it.
    el.appendChild(imgWrap);
    el.appendChild(ccEl);
    el.appendChild(ipEl);
    el.appendChild(badge);

    // ── Click handler — distinguishes single vs double click ─────
    //
    // Using native click + manual timer instead of the click/dblclick
    // pair, because the browser fires click BEFORE dblclick, which
    // causes the popup to open on every double-click attempt and makes
    // double-click detection unreliable.
    //
    // How it works:
    //   First click  → start a 350 ms timer.
    //   Second click within 350 ms → cancel timer, treat as double-click.
    //   Timer expires without a second click → treat as single click.
    //
    // 350 ms is intentionally more forgiving than the OS default
    // (~200–300 ms) so the interaction feels easy to trigger.
    var clickTimer = null;
    var DBLCLICK_MS = 350;

    el.addEventListener('click', function () {
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
    saveBtn.disabled = count !== DECK_SIZE;
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
  function openPopup(card) {
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

    backdropEl.classList.add('visible');
  }

  function closePopup() {
    backdropEl.classList.remove('visible');
    popupCardId = null;
  }

  /* ── Persistence ─────────────────────────────────────────────── */

  // Pre-load deck-select music so it plays with zero latency on video end
  var deckMusic = new Audio('music/Dozing Off Card Select.m4a');
  deckMusic.preload = 'auto';
  deckMusic.loop    = false;

  function saveDeck() {
    if (selectedIds.size !== DECK_SIZE) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(selectedIds)));
    // Stop music immediately before leaving the deck builder
    deckMusic.pause();
    deckMusic.currentTime = 0;
    showScreen('screen-battle');
    if (typeof initGame === 'function') initGame();
  }

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

  saveBtn.addEventListener('click', saveDeck);
  backBtn.addEventListener('click', function () { showScreen('screen-home'); });

  // Export so tutorial.js can re-enter the deck builder after tutorial ends
  window.initDeckBuilder = initDeckBuilder;

  document.getElementById('btn-deselect-all').addEventListener('click', function () {
    selectedIds.forEach(function (id) { setCardSelected(id, false); });
    selectedIds.clear();
    updateUI();
  });

  /* ── Home screen buttons ─────────────────────────────────────── */

  // "I'm Ready" — radial wipe → video → deck builder + music
  document.getElementById('btn-ready').addEventListener('click', function () {
    var wipe  = document.getElementById('radial-wipe');
    var video = document.getElementById('intro-video');

    // Start loading + playing the video NOW, while the wipe covers the screen.
    // This ensures the first frame is ready the instant the wipe finishes.
    video.currentTime = 0;
    video.play().catch(function () {});

    wipe.classList.add('animating');

    setTimeout(function () {
      // Wipe has fully covered the screen — reveal the video screen.
      showScreen('screen-video');

      // Reset wipe instantly (no animation) so it's ready for next use.
      wipe.classList.remove('animating');
      wipe.style.clipPath = 'circle(0% at 50% 50%)';
      requestAnimationFrame(function () {
        wipe.style.clipPath = '';
      });
    }, 650); // matches radial-wipe-expand duration
  });

  // Video ended → deck builder; music starts with zero delay (pre-loaded)
  document.getElementById('intro-video').addEventListener('ended', function () {
    localStorage.setItem('sog_intro_seen', 'true');
    showScreen('screen-deckbuilder');
    initDeckBuilder();
    deckMusic.currentTime = 0;
    deckMusic.play().catch(function () {});
  });

  // "I'm Ready to Learn How" — show Coming Soon popup
  document.getElementById('btn-learn').addEventListener('click', function () {
    if (typeof window.startTutorial === 'function') {
      window.startTutorial();
    } else {
      document.getElementById('coming-soon-backdrop').classList.add('visible');
    }
  });

  document.getElementById('coming-soon-close').addEventListener('click', function () {
    document.getElementById('coming-soon-backdrop').classList.remove('visible');
  });

  document.getElementById('coming-soon-backdrop').addEventListener('click', function (e) {
    if (e.target === this) this.classList.remove('visible');
  });

  // "Watch Intro" button in the deck builder header — returns to home screen
  document.getElementById('db-watch-intro').addEventListener('click', function () {
    var wipe = document.getElementById('radial-wipe');
    deckMusic.pause();
    deckMusic.currentTime = 0;
    wipe.classList.add('animating');
    setTimeout(function () {
      showScreen('screen-home');
      wipe.classList.remove('animating');
      wipe.style.clipPath = 'circle(0% at 50% 50%)';
      requestAnimationFrame(function () { wipe.style.clipPath = ''; });
    }, 650);
  });

  /* ── Returning-visitor skip ──────────────────────────────────── */
  // If the player has already seen the intro, go straight to deck builder.
  if (localStorage.getItem('sog_intro_seen')) {
    showScreen('screen-deckbuilder');
    initDeckBuilder();
    deckMusic.currentTime = 0;
    deckMusic.play().catch(function () {});
  }

})();
