/**
 * feedback.js
 * Match counter + first-time feedback popup + home-screen Feedback
 * button visibility, all driven by two localStorage keys:
 *
 *   sog_completed_matches      integer — Vs AI / Multiplayer matches
 *                              that reached the scoreboard. Tutorial
 *                              completions do NOT increment.
 *   sog_feedback_prompt_seen   "true" once the player has interacted
 *                              with the feedback popup. Set on any
 *                              of the three button presses; never
 *                              shown again automatically.
 *
 * The home-screen Feedback button uses only the counter — once the
 * player crosses 3 matches it stays visible permanently, regardless
 * of whether they've seen / dismissed the popup.
 */
(function () {
  'use strict';

  var COUNT_KEY = 'sog_completed_matches';
  var SEEN_KEY  = 'sog_feedback_prompt_seen';
  var THRESHOLD = 3;
  var FORM_URL  = 'https://forms.gle/8qnJsRppr6FCWZ3J7';

  // ── Counter ──────────────────────────────────────────────────
  function getCount() {
    var n = parseInt(localStorage.getItem(COUNT_KEY) || '0', 10);
    return isNaN(n) ? 0 : n;
  }
  function setCount(n) {
    try { localStorage.setItem(COUNT_KEY, String(n)); } catch (e) {}
  }
  function isSeen()    { return localStorage.getItem(SEEN_KEY) === 'true'; }
  function markSeen()  { try { localStorage.setItem(SEEN_KEY, 'true'); } catch (e) {} }

  /**
   * Called by game.js when a Vs AI / Multiplayer match reaches the
   * scoreboard. Tutorial does NOT call this — its end-of-game flow
   * uses tutorial.js's own showScreen('screen-result') path.
   */
  function recordMatchCompleted() {
    setCount(getCount() + 1);
    refreshHomeButton();
  }

  function shouldShowPopup() {
    return getCount() >= THRESHOLD && !isSeen();
  }

  // ── Popup show / hide ────────────────────────────────────────
  function getBackdrop() { return document.getElementById('feedback-backdrop'); }

  function showPopup() {
    var bd = getBackdrop();
    if (!bd) return false;
    bd.classList.add('visible');
    return true;
  }
  function hidePopup() {
    var bd = getBackdrop();
    if (bd) bd.classList.remove('visible');
  }

  /**
   * Called by game.js's "Home" / "Play Again" handlers on the
   * scoreboard. Returns true if the popup is now visible — caller
   * should abort its own navigation. Returns false otherwise —
   * caller should proceed normally.
   */
  function maybeShowPopup() {
    if (!shouldShowPopup()) return false;
    return showPopup();
  }

  // ── Popup button handlers ────────────────────────────────────
  function onFormBtn() {
    markSeen();
    refreshHomeButton();
    window.open(FORM_URL, '_blank', 'noopener,noreferrer');
    hidePopup();
    // Player stays on the scoreboard — they can hit Home or Play
    // Again again, and the seen flag will short-circuit the popup.
  }

  function onHomeBtn() {
    markSeen();
    refreshHomeButton();
    hidePopup();
    // Re-trigger the underlying scoreboard button. game.js's handler
    // checks Feedback.maybeShowPopup() — since the seen flag is now
    // set it returns false and the navigation proceeds.
    var homeBtn = document.getElementById('result-home');
    if (homeBtn) homeBtn.click();
  }

  function onPlayAgainBtn() {
    markSeen();
    refreshHomeButton();
    hidePopup();
    var paBtn = document.getElementById('result-play-again');
    if (paBtn) paBtn.click();
  }

  // ── Home-screen Feedback button ──────────────────────────────
  function refreshHomeButton() {
    var btn = document.getElementById('btn-home-feedback');
    if (!btn) return;
    btn.style.display = (getCount() >= THRESHOLD) ? '' : 'none';
  }

  function onHomeFeedbackBtn() {
    window.open(FORM_URL, '_blank', 'noopener,noreferrer');
  }

  // ── Init ─────────────────────────────────────────────────────
  function init() {
    var btnForm     = document.getElementById('feedback-form-btn');
    var btnHome     = document.getElementById('feedback-home-btn');
    var btnPlay     = document.getElementById('feedback-playagain-btn');
    var btnHomeNav  = document.getElementById('btn-home-feedback');
    var bd          = getBackdrop();

    if (btnForm) btnForm.addEventListener('click', onFormBtn);
    if (btnHome) btnHome.addEventListener('click', onHomeBtn);
    if (btnPlay) btnPlay.addEventListener('click', onPlayAgainBtn);
    if (btnHomeNav) btnHomeNav.addEventListener('click', onHomeFeedbackBtn);

    // Click on backdrop (outside the panel) does NOT dismiss — the
    // user must interact with one of the three buttons.

    refreshHomeButton();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.Feedback = {
    recordMatchCompleted: recordMatchCompleted,
    maybeShowPopup:       maybeShowPopup,
    refreshHomeButton:    refreshHomeButton,
    getCount:             getCount,
    isSeen:               isSeen
  };
})();
