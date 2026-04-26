/**
 * progression.js
 * Shoulders of Giants — Card Unlock Progression System
 *
 * Players start with Military, Political, and Cultural cards (15 cards).
 * After 3 Serf wins  → Religious cards unlock (20 cards available).
 * After 3 Giant wins → Exploration cards unlock (all 25 cards).
 *
 * Includes a cinematic unlock cutscene synced to "The Curtain Rises.mp3".
 */

var Progression = (function () {
  'use strict';

  /* ── localStorage key constants ──────────────────────────────── */
  var KEY_SERF_WINS       = 'sog_serf_wins';
  var KEY_GIANT_WINS      = 'sog_giant_wins';
  var KEY_REL_UNLOCKED    = 'sog_religious_unlocked';
  var KEY_EXP_UNLOCKED    = 'sog_exploration_unlocked';
  var KEY_REL_CUTSCENE    = 'sog_religious_cutscene_seen';
  var KEY_EXP_CUTSCENE    = 'sog_exploration_cutscene_seen';
  var KEY_TOTAL_WINS      = 'sog_total_wins';
  var KEY_MONTAGE_SEEN    = 'sog_victory_montage_seen';

  var WINS_REQUIRED       = 3;
  var MONTAGE_THRESHOLD   = 10;
  var BASE_TYPES          = ['Political', 'Military', 'Cultural'];

  /* ── Helpers ─────────────────────────────────────────────────── */
  function _getInt(key) { return parseInt(localStorage.getItem(key) || '0', 10); }
  function _setInt(key, v) { localStorage.setItem(key, String(v)); }
  function _getBool(key) { return localStorage.getItem(key) === 'true'; }
  function _setBool(key) { localStorage.setItem(key, 'true'); }

  /* ── Public API ──────────────────────────────────────────────── */

  function isTypeUnlocked(type) {
    if (BASE_TYPES.indexOf(type) !== -1) return true;
    if (type === 'Religious')   return _getBool(KEY_REL_UNLOCKED);
    if (type === 'Exploration') return _getBool(KEY_EXP_UNLOCKED);
    return false;
  }

  function getUnlockedTypes() {
    var types = BASE_TYPES.slice();
    if (_getBool(KEY_REL_UNLOCKED)) types.push('Religious');
    if (_getBool(KEY_EXP_UNLOCKED)) types.push('Exploration');
    return types;
  }

  function getSerfWins()  { return _getInt(KEY_SERF_WINS); }
  function getGiantWins() { return _getInt(KEY_GIANT_WINS); }

  /**
   * Record a player win. Increments the appropriate counter and
   * checks if a new card type should be unlocked.
   * @param {string} difficulty  'easy' (Serf) or 'hard' (Giant)
   * @returns {{ justUnlocked: string|null }}
   */
  function recordWin(difficulty) {
    var justUnlocked = null;

    if (difficulty === 'easy') {
      var sw = _getInt(KEY_SERF_WINS) + 1;
      _setInt(KEY_SERF_WINS, sw);
      if (sw >= WINS_REQUIRED) {
        _setBool(KEY_REL_UNLOCKED);
        if (!_getBool(KEY_REL_CUTSCENE)) justUnlocked = 'Religious';
      }
    } else if (difficulty === 'hard') {
      var gw = _getInt(KEY_GIANT_WINS) + 1;
      _setInt(KEY_GIANT_WINS, gw);
      if (gw >= WINS_REQUIRED) {
        _setBool(KEY_EXP_UNLOCKED);
        if (!_getBool(KEY_EXP_CUTSCENE)) justUnlocked = 'Exploration';
      }
    }

    // Track total wins for victory montage
    var tw = _getInt(KEY_TOTAL_WINS) + 1;
    _setInt(KEY_TOTAL_WINS, tw);
    if (tw >= MONTAGE_THRESHOLD && !_getBool(KEY_MONTAGE_SEEN)) {
      window._pendingMontage = true;
    }

    console.log('[Progression] recordWin:', difficulty, '| justUnlocked:', justUnlocked,
      '| totalWins:', tw, '| serfWins:', _getInt(KEY_SERF_WINS), '| giantWins:', _getInt(KEY_GIANT_WINS));

    if (justUnlocked) window._pendingUnlock = justUnlocked;
    return { justUnlocked: justUnlocked };
  }

  /**
   * Check if there's a pending cutscene that hasn't been shown yet.
   * @returns {string|null}  'Religious', 'Exploration', or null
   */
  function hasPendingCutscene() {
    var pending = window._pendingUnlock;
    if (!pending) return null;
    if (pending === 'Religious'   && _getBool(KEY_REL_CUTSCENE)) return null;
    if (pending === 'Exploration' && _getBool(KEY_EXP_CUTSCENE)) return null;
    return pending;
  }

  function markCutsceneSeen(type) {
    if (type === 'Religious')   _setBool(KEY_REL_CUTSCENE);
    if (type === 'Exploration') _setBool(KEY_EXP_CUTSCENE);
    window._pendingUnlock = null;
  }

  /* ── Victory Montage (10 total wins) ───────────────────────── */

  function hasPendingMontage() {
    return !!window._pendingMontage && !_getBool(KEY_MONTAGE_SEEN);
  }

  function markMontageSeen() {
    _setBool(KEY_MONTAGE_SEEN);
    window._pendingMontage = null;
  }

  /**
   * Placeholder victory montage — will be replaced with full cinematic later.
   * @param {Function} cb       called when dismissed
   * @param {object}   [opts]   { preview: true } to skip marking as seen
   */
  function playMontage(cb, opts) {
    opts = opts || {};
    var screen = document.getElementById('screen-unlock');
    var stage  = document.getElementById('unlock-stage');
    var titleEl = document.getElementById('unlock-title');
    var curtainL = document.getElementById('unlock-curtain-left');
    var curtainR = document.getElementById('unlock-curtain-right');

    if (!screen || !stage) {
      if (!opts.preview) markMontageSeen();
      if (cb) cb();
      return;
    }

    stage.innerHTML = '';
    titleEl.textContent = '';

    // Build placeholder message
    var msg = document.createElement('div');
    msg.style.cssText =
      'position:absolute;inset:0;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;z-index:5;';
    var line1 = document.createElement('div');
    line1.style.cssText =
      "font-family:'CT Galbite',monospace;font-size:48px;color:#ffd700;" +
      'text-shadow:0 0 30px rgba(255,215,0,0.5),0 2px 6px rgba(0,0,0,0.8);' +
      'letter-spacing:0.04em;margin-bottom:16px;';
    line1.textContent = 'Victory Montage';
    var line2 = document.createElement('div');
    line2.style.cssText =
      "font-family:'CT Galbite',monospace;font-size:28px;color:#a08050;" +
      'text-shadow:0 2px 4px rgba(0,0,0,0.7);letter-spacing:0.03em;';
    line2.textContent = 'Coming Soon';
    var line3 = document.createElement('div');
    line3.style.cssText =
      "font-family:'Source Sans 3',sans-serif;font-size:16px;color:#666;" +
      'margin-top:30px;';
    line3.textContent = '10 wins achieved! Click anywhere to continue.';
    msg.appendChild(line1);
    msg.appendChild(line2);
    msg.appendChild(line3);
    stage.appendChild(msg);

    screen.style.display = 'block';
    if (typeof gsap !== 'undefined') {
      gsap.set(screen, { autoAlpha: 1 });
      gsap.set(curtainL, { y: '0%' });
      gsap.set(curtainR, { y: '0%' });
      gsap.to(curtainL, { y: '-100%', duration: 2, ease: 'power2.inOut' });
      gsap.to(curtainR, { y: '-100%', duration: 2, ease: 'power2.inOut' });
      gsap.fromTo(msg, { autoAlpha: 0, y: 30 }, { autoAlpha: 1, y: 0, duration: 0.8, delay: 1.5 });
    }

    function dismiss() {
      screen.removeEventListener('click', dismiss);
      if (!opts.preview) markMontageSeen();
      if (typeof gsap !== 'undefined') {
        gsap.to(screen, {
          autoAlpha: 0, duration: 0.6,
          onComplete: function () {
            screen.style.display = 'none';
            stage.innerHTML = '';
            gsap.set(curtainL, { y: '0%' });
            gsap.set(curtainR, { y: '0%' });
            if (cb) cb();
          }
        });
      } else {
        screen.style.display = 'none';
        stage.innerHTML = '';
        if (cb) cb();
      }
    }

    // Click anywhere to dismiss (after a brief delay to prevent accidental dismissal)
    setTimeout(function () {
      screen.addEventListener('click', dismiss);
    }, 2500);
  }

  /* ═══════════════════════════════════════════════════════════════
     UNLOCK CUTSCENE
  ═══════════════════════════════════════════════════════════════ */

  var _cutsceneHowl = null;

  /**
   * @param {string}   type     'Religious' or 'Exploration'
   * @param {Function} cb       called when cutscene ends
   * @param {object}   [opts]   { preview: true } to skip marking cutscene as seen
   */
  function playCutscene(type, cb, opts) {
    opts = opts || {};
    var screen   = document.getElementById('screen-unlock');
    var stage    = document.getElementById('unlock-stage');
    var titleEl  = document.getElementById('unlock-title');
    var curtainL = document.getElementById('unlock-curtain-left');
    var curtainR = document.getElementById('unlock-curtain-right');

    if (!screen || !stage || typeof gsap === 'undefined') {
      if (!opts.preview) markCutsceneSeen(type);
      if (cb) cb();
      return;
    }

    // ── Collect the 5 cards for this type ────────────────────────
    var cards = CARDS.filter(function (c) { return c.type === type && !c.locked; });
    stage.innerHTML = '';
    titleEl.textContent = '';

    // ── Card dimensions (90% display size) ──────────────────────
    var CARD_W = 200;
    var CARD_H = 280;
    var GAP    = 20;

    // ── Build card elements ─────────────────────────────────────
    // Each card is a 3D flip container: back (visible first) + front (revealed on flip)
    var cardEls = cards.map(function (card) {
      var el = document.createElement('div');
      el.className = 'unlock-card';
      el.style.width  = CARD_W + 'px';
      el.style.height = CARD_H + 'px';
      el.style.perspective = '800px';

      var inner = document.createElement('div');
      inner.className = 'unlock-card-inner';
      inner.style.cssText = 'position:absolute;inset:0;transform-style:preserve-3d;';

      // Back face (card back image)
      var back = document.createElement('div');
      back.className = 'unlock-card-back';
      back.style.cssText = 'position:absolute;inset:0;backface-visibility:hidden;' +
        'background:url(images/SOG_Card_Back.jpg) center/cover no-repeat;border-radius:5px;';

      // Front face (card artwork + overlays)
      var front = document.createElement('div');
      front.className = 'unlock-card-front';
      front.style.cssText = 'position:absolute;inset:0;backface-visibility:hidden;' +
        'transform:rotateY(180deg);';

      var imgWrap = document.createElement('div');
      imgWrap.className = 'db-card-img-wrap';
      var ph = document.createElement('div');
      ph.className = 'db-card-img-placeholder';
      ph.textContent = card.name.charAt(0);
      var img = document.createElement('img');
      img.className = 'db-card-img';
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
      front.appendChild(imgWrap);
      front.appendChild(ccEl);
      front.appendChild(ipEl);

      inner.appendChild(back);
      inner.appendChild(front);
      el.appendChild(inner);
      stage.appendChild(el);

      el._inner = inner; // reference for flip animation
      return el;
    });

    // ── Layout constants ────────────────────────────────────────
    var cx = window.innerWidth  / 2;
    var cy = window.innerHeight / 2;
    var stackX = cx - CARD_W / 2;
    var stackY = cy - CARD_H / 2;

    // ── Show screen, reset curtains ─────────────────────────────
    screen.style.display = 'block';
    gsap.set(screen, { autoAlpha: 1 });
    gsap.set(curtainL, { y: '0%' });
    gsap.set(curtainR, { y: '0%' });

    // Generate per-card random offsets for organic messiness (25%)
    var cardJitter = cardEls.map(function () {
      return {
        rOff:  (Math.random() - 0.5) * 0.25,   // radius offset factor (-12.5% to +12.5%)
        yOff:  (Math.random() - 0.5) * 0.25,    // vertical offset factor
        aOff:  (Math.random() - 0.5) * 0.5,     // angular offset (radians)
        rDrift: (Math.random() - 0.5) * 2.5      // rotation drift (degrees)
      };
    });

    // Position cards at their starting swirl positions (angle 0, tight cluster at center)
    var SWIRL_RADIUS_MAX = Math.min(cx, cy) * 0.38;
    var initSpread = 0.45;
    cardEls.forEach(function (el, i) {
      var offset = (i - 2) * initSpread + cardJitter[i].aOff * initSpread;
      var initR = SWIRL_RADIUS_MAX * 0.08; // tiny radius — clustered near center
      gsap.set(el, {
        x: cx + Math.cos(offset) * initR - CARD_W / 2,
        y: cy + Math.sin(offset) * initR * 0.65 - CARD_H / 2,
        scale: 1, opacity: 0, rotation: 0
      });
      gsap.set(el._inner, { rotateY: 0 }); // back face showing
    });

    // ── Start music ─────────────────────────────────────────────
    if (typeof Howl !== 'undefined') {
      if (_cutsceneHowl) { _cutsceneHowl.stop(); _cutsceneHowl.unload(); }
      _cutsceneHowl = new Howl({
        src: ['music/The Curtain Rises.mp3'],
        volume: 0.7,
        loop: false,
        html5: true
      });
      _cutsceneHowl.play();
    }

    // ── GSAP master timeline ────────────────────────────────────
    var tl = gsap.timeline({
      onComplete: function () {
        if (_cutsceneHowl) { _cutsceneHowl.stop(); _cutsceneHowl.unload(); _cutsceneHowl = null; }
        screen.style.display = 'none';
        stage.innerHTML = '';
        titleEl.textContent = '';
        gsap.set(curtainL, { y: '0%' });
        gsap.set(curtainR, { y: '0%' });
        if (!opts.preview) markCutsceneSeen(type);
        if (cb) cb();
      }
    });

    // ── Phase 1: Curtain rise + cards fade in at swirl start (0:00 – 0:02) ─
    tl.to(curtainL, { y: '-100%', duration: 2, ease: 'power2.inOut' }, 0);
    tl.to(curtainR, { y: '-100%', duration: 2, ease: 'power2.inOut' }, 0);

    // Fade in cards (already at their initial orbital positions)
    tl.to(cardEls, { opacity: 1, duration: 0.8, stagger: 0.06 }, 0.6);

    // ── Phase 2: Swirl dance, backside up, slow→fast (0:01 – 0:13) ─
    // Starts immediately so cards are moving as they fade in — no jump cut.
    // Radius grows from small to full. 2 full self-spins = ends right-side up.
    var swirlProxy = { angle: 0, radius: SWIRL_RADIUS_MAX * 0.08, spin: 0 };
    var SWIRL_DURATION = 12;
    var SWIRL_ROTATIONS = 3;
    var CARD_FULL_SPINS = 2;

    tl.to(swirlProxy, {
      angle: SWIRL_ROTATIONS * Math.PI * 2,
      radius: SWIRL_RADIUS_MAX,
      spin: CARD_FULL_SPINS * 360,
      duration: SWIRL_DURATION,
      ease: 'power3.in',
      onUpdate: function () {
        var a = swirlProxy.angle;
        var r = swirlProxy.radius;
        var progress = a / (SWIRL_ROTATIONS * Math.PI * 2);
        // Cards start spread out then tighten into a cohesive line
        var spread = 0.45 * (1 - progress * 0.75);
        cardEls.forEach(function (el, i) {
          var j = cardJitter[i];
          var offset = (i - 2) * spread + j.aOff * spread;
          var cardR = r * (1 + j.rOff);
          var x = cx + Math.cos(a + offset) * cardR - CARD_W / 2;
          var y = cy + Math.sin(a + offset) * cardR * (0.65 + j.yOff * 0.15) - CARD_H / 2;
          var wobble = Math.sin(a * 2 + i) * 6 + j.rDrift;
          var rot = swirlProxy.spin + wobble;
          gsap.set(el, { x: x, y: y, rotation: rot });
        });
      }
    }, 1);

    // ── Phase 3: Ninja-dart exit off screen LEFT one by one (0:13 – 0:14.5) ─
    // Still backside up — each card spins rapidly and flies off left
    cardEls.forEach(function (el, i) {
      tl.to(el, {
        x: -CARD_W - 200 - i * 60,
        y: cy - CARD_H / 2 + (i - 2) * 30,
        rotation: '+=720', // 2 full rapid spins like a ninja star
        duration: 0.55,
        ease: 'power3.in'
      }, 13 + i * 0.12);
    });

    // ── Phase 4: Slide in from right, face-up, land in row (0:15 – 0:19) ─
    // Flip all cards to front face and position off-screen right
    tl.call(function () {
      cardEls.forEach(function (el, i) {
        // Flip to front
        gsap.set(el._inner, { rotateY: 180 });
        // Position off-screen right, staggered
        gsap.set(el, {
          x: window.innerWidth + 100 + (4 - i) * 60,
          y: cy - CARD_H / 2 + (4 - i) * 20,
          rotation: 10 + (4 - i) * 3
        });
      });
    }, [], 15);

    // Slide each card smoothly into its final row position from the right
    var totalW = cardEls.length * CARD_W + (cardEls.length - 1) * GAP;
    var rowStartX = cx - totalW / 2;
    var ROW_Y = cy - CARD_H / 2 + 10;

    cardEls.forEach(function (el, i) {
      var finalX = rowStartX + i * (CARD_W + GAP);
      tl.to(el, {
        x: finalX, y: ROW_Y, rotation: 0,
        duration: 0.7, ease: 'back.out(1.4)'
      }, 15.5 + i * 0.2);
    });

    // ── Phase 6: Title pop (0:20) ───────────────────────────────
    titleEl.style.color = type === 'Religious' ? 'var(--c-religious)' : 'var(--c-exploration)';
    var titleText = type === 'Religious'
      ? 'Religious Cards Unlocked!'
      : 'Exploration Cards Unlocked!';

    tl.call(function () { titleEl.textContent = titleText; }, [], 19.8);
    tl.fromTo(titleEl,
      { scale: 0, autoAlpha: 0 },
      { scale: 1, autoAlpha: 1, duration: 0.5, ease: 'back.out(2)' },
      20
    );

    // ── Phase 7: Hold then fade out (0:27 – 0:28) ──────────────
    tl.to(screen, { autoAlpha: 0, duration: 1 }, 27);
  }

  /* ── Expose ──────────────────────────────────────────────────── */
  return {
    isTypeUnlocked:     isTypeUnlocked,
    getUnlockedTypes:   getUnlockedTypes,
    getSerfWins:        getSerfWins,
    getGiantWins:       getGiantWins,
    recordWin:          recordWin,
    hasPendingCutscene: hasPendingCutscene,
    markCutsceneSeen:   markCutsceneSeen,
    playCutscene:       playCutscene,
    hasPendingMontage:  hasPendingMontage,
    markMontageSeen:    markMontageSeen,
    playMontage:        playMontage
  };
})();

window.Progression = Progression;
