/**
 * First-load welcome modal — "Before You Begin"
 *
 * Shows once on the very first visit to the game in a given browser.
 * Skipped silently on every subsequent visit (unless localStorage is cleared).
 * Also skipped for "returning players" who already have any existing
 * progress saved (tutorial complete, saved deck, wins, unlocks) but no
 * welcome flag yet — so we don't pop this on people who pre-date the modal.
 */
(function () {
  'use strict';

  var WELCOME_KEY = 'sog_welcome_seen';

  // If any of these existing keys is set, treat the user as a returning player.
  // (List mirrors the keys cleared by bypass.js "Reset All Data" + progression keys.)
  var PROGRESS_KEYS = [
    'sog_tutorial_complete',
    'sog_decks',
    'sog_serf_wins',
    'sog_giant_wins',
    'sog_total_wins',
    'sog_religious_unlocked',
    'sog_exploration_unlocked',
    'sog_religious_cutscene_seen',
    'sog_exploration_cutscene_seen',
    'sog_victory_montage_seen'
  ];

  function hasExistingProgress() {
    for (var i = 0; i < PROGRESS_KEYS.length; i++) {
      try {
        if (localStorage.getItem(PROGRESS_KEYS[i])) return true;
      } catch (e) { return false; }
    }
    return false;
  }

  function init() {
    try {
      // Already dismissed → nothing to do
      if (localStorage.getItem(WELCOME_KEY) === 'true') return;

      // Returning player who pre-dates this modal → mark seen and skip
      if (hasExistingProgress()) {
        localStorage.setItem(WELCOME_KEY, 'true');
        return;
      }
    } catch (e) {
      // localStorage disabled / blocked — fall through to show the welcome anyway
    }

    var backdrop = document.getElementById('welcome-backdrop');
    var btn      = document.getElementById('welcome-dismiss');
    if (!backdrop || !btn) return;

    // Show the modal — same .visible-class pattern as every other popup-backdrop.
    // (.popup-backdrop has pointer-events:none until .visible is added, so the
    // home buttons behind it are non-interactive while the modal is up.)
    backdrop.classList.add('visible');

    function dismiss() {
      try { localStorage.setItem(WELCOME_KEY, 'true'); } catch (e) {}
      backdrop.classList.remove('visible');
      btn.removeEventListener('click', dismiss);
    }

    // Single handler covers both desktop click and mobile tap (standard click event)
    btn.addEventListener('click', dismiss);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
