/**
 * animations.js
 * Shoulders of Giants — Card Ability Animations (GSAP)
 *
 * Uses GSAP for all animations. Falls back to no-op if GSAP is not loaded.
 * Exposes a single global object: Anim
 *
 * Usage:
 *   Anim.cardReveal(slotEl)              — smooth scale-in on card flip
 *   Anim.pulseYellow(slotEl)             — bright gold flash on At Once trigger
 *   Anim.ripple(slotEl)                  — white ring ripple on affected card
 *   Anim.shake(slotEl)                   — shake + shrink-fade on destroyed card
 *   Anim.cardDiscarded(handCardEl)       — slide up + fade on discarded hand card
 *   Anim.floatNumber(slotEl, delta)      — floating +/- IP number
 *   Anim.setGlow(slotEl, on)             — persistent continuous-ability glow pulse
 *   Anim.conditional(slotEl)             — dramatic burst on conditional trigger
 *   Anim.locationWin(locTileEl)          — gold flash on winning location tile
 *   Anim.celebration()                   — bounce on VICTORY headline
 *   Anim.sadResult()                     — shake on DEFEAT headline
 *   Anim.jesusAscend(handCardEl, cb)     — card rises and fades, fires cb when done
 *   Anim.jesusReturn(handCardEl)         — golden glow flash on Jesus returning
 */

var Anim = (function () {
  'use strict';

  function hasGSAP() { return typeof gsap !== 'undefined'; }

  /* ── Helpers ─────────────────────────────────────────────────── */

  /**
   * Create a fixed-position ghost clone of an element.
   * Useful when the original will be removed immediately but we still want to animate.
   */
  function makeGhost(el, zIndex) {
    var rect  = el.getBoundingClientRect();
    var ghost = document.createElement('div');
    ghost.className  = el.className;
    ghost.innerHTML  = el.innerHTML;
    ghost.style.cssText =
      'position:fixed;left:' + rect.left + 'px;top:' + rect.top + 'px;' +
      'width:' + rect.width + 'px;height:' + rect.height + 'px;' +
      'margin:0;z-index:' + (zIndex || 500) + ';pointer-events:none;';
    document.body.appendChild(ghost);
    return ghost;
  }

  /** Remove an element from the DOM if still attached. */
  function removeEl(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  /** Create an absolutely-positioned overlay div inside a slot/card element. */
  function makeOverlay(el, css) {
    var overlay = document.createElement('div');
    overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;border-radius:2px;z-index:60;' + (css || '');
    el.appendChild(overlay);
    return overlay;
  }

  /* ═══════════════════════════════════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════════════════════════════════ */

  return {

    /**
     * Card reveal — smooth scale-in when a card flips face-up.
     * Called in flipSlot() after buildCardFace().
     */
    cardReveal: function (el) {
      if (!el || !hasGSAP()) return;
      gsap.fromTo(el,
        { scale: 0.75, opacity: 0 },
        {
          scale: 1, opacity: 1,
          duration: 0.30,
          ease: 'power2.out',
          onComplete: function () { gsap.set(el, { clearProps: 'transform,opacity' }); }
        }
      );
    },

    /**
     * Pacal clock-wipe — gold overlay starts full and sweeps away clockwise from 12 o'clock.
     * Uses an SVG even-odd compound path: rect MINUS growing sector = remaining gold coverage.
     * Calls onComplete when the wipe finishes and the overlay is removed.
     * @param {Element}  el          The slot element to wipe over
     * @param {Function} onComplete  Called when animation finishes
     */
    pacalWipe: function (el, onComplete) {
      if (!el) { if (onComplete) onComplete(); return; }

      var w  = el.offsetWidth  || 90;
      var h  = el.offsetHeight || 130;
      var cx = w / 2;
      var cy = h / 2;
      var r  = Math.sqrt(cx * cx + cy * cy) + 6;  // radius covers all four corners

      // Wrapper with overflow:hidden so the wipe respects the card's rounded corners
      var wrap = makeOverlay(el, 'overflow:hidden;z-index:80;');

      var ns   = 'http://www.w3.org/2000/svg';
      var svg  = document.createElementNS(ns, 'svg');
      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';

      var path = document.createElementNS(ns, 'path');
      path.setAttribute('fill', 'rgba(255,215,0,0.88)');
      path.setAttribute('fill-rule', 'evenodd');
      svg.appendChild(path);
      wrap.appendChild(svg);

      // Full card rectangle (always present as the gold base)
      var rectPath = 'M 0 0 L ' + w + ' 0 L ' + w + ' ' + h + ' L 0 ' + h + ' Z ';

      /**
       * Build a compound path: rect MINUS a clockwise sector from 12-o'clock to angleDeg.
       * Even-odd fill makes the overlapping sector area transparent (the "wiped" hole).
       */
      function buildPath(angleDeg) {
        if (angleDeg <= 0) return rectPath;  // angle = 0 → no hole → full gold coverage
        var a   = Math.min(angleDeg, 359.9); // clamp to avoid degenerate full-circle arc
        var rad = (a - 90) * Math.PI / 180;  // convert clock angle to SVG angle
        var hx  = cx + r * Math.cos(rad);
        var hy  = cy + r * Math.sin(rad);
        var large = a > 180 ? 1 : 0;
        // Sector: center → 12-o'clock → arc clockwise to current angle → back to center
        return rectPath +
               'M ' + cx + ' ' + cy + ' ' +
               'L ' + cx + ' ' + (cy - r) + ' ' +
               'A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + hx + ' ' + hy + ' Z';
      }

      path.setAttribute('d', buildPath(0));  // start: fully covered

      if (!hasGSAP()) {
        setTimeout(function () { removeEl(wrap); if (onComplete) onComplete(); }, 850);
        return;
      }

      var progress = { angle: 0 };
      gsap.to(progress, {
        angle:    360,
        duration: 0.80,
        ease:     'power2.inOut',
        onUpdate: function () {
          path.setAttribute('d', buildPath(progress.angle));
        },
        onComplete: function () {
          removeEl(wrap);
          if (onComplete) onComplete();
        }
      });
    },

    /**
     * Justinian white flash — bright white overlay on Justinian's card, ~600ms total.
     * Separate from pulseYellow so it can run alongside the generic At Once chime pulse.
     */
    justinianFlash: function (el) {
      if (!el || !hasGSAP()) return;
      var flash = makeOverlay(el, 'background:rgba(255,255,255,0.9);opacity:0;');
      var tl = gsap.timeline({ onComplete: function () { removeEl(flash); } });
      tl.to(flash, { opacity: 1,   duration: 0.08, ease: 'power2.in' })
        .to(flash, { opacity: 0,   duration: 0.52, ease: 'power2.out' });
    },

    /**
     * Bright gold flash — fires on At Once ability trigger.
     */
    pulseYellow: function (el) {
      if (!el || !hasGSAP()) return;
      var flash = makeOverlay(el, 'background:rgba(255,215,0,0.75);opacity:0;');
      var tl = gsap.timeline({ onComplete: function () { removeEl(flash); } });
      tl.to(flash, { opacity: 0.85, duration: 0.08, ease: 'power2.in' })
        .to(flash, { opacity: 0,    duration: 0.38, ease: 'power2.out' });
    },

    /**
     * White ripple ring — fires on cards affected by an ability.
     */
    ripple: function (el) {
      if (!el || !hasGSAP()) return;
      var ring = makeOverlay(el, 'border:3px solid rgba(255,255,255,0.9);background:transparent;');
      gsap.fromTo(ring,
        { opacity: 1, scale: 1 },
        {
          opacity: 0, scale: 1.3, duration: 0.5, ease: 'power2.out',
          onComplete: function () { removeEl(ring); }
        }
      );
    },

    /**
     * Shake + shrink-fade — fires when a card is destroyed.
     * Uses a ghost clone so the animation outlives clearSlotDOM.
     */
    shake: function (el) {
      if (!el || !hasGSAP()) return;
      var ghost = makeGhost(el, 500);
      var tl = gsap.timeline({ onComplete: function () { removeEl(ghost); } });
      tl.to(ghost, { x: -9,  duration: 0.06, ease: 'power1.inOut' })
        .to(ghost, { x:  9,  duration: 0.06 })
        .to(ghost, { x: -6,  duration: 0.05 })
        .to(ghost, { x:  6,  duration: 0.05 })
        .to(ghost, { x:  0,  duration: 0.04 })
        .to(ghost, { scale: 0.65, opacity: 0, duration: 0.20, ease: 'power2.in' });
    },

    /**
     * Card discarded — hand card slides upward and fades out.
     * Removes the original element immediately and animates a ghost in its place.
     */
    cardDiscarded: function (el) {
      if (!el) return;
      if (!hasGSAP()) { removeEl(el); return; }
      var ghost = makeGhost(el, 500);
      removeEl(el);
      gsap.to(ghost, {
        y:       -80,
        opacity: 0,
        duration: 0.40,
        ease:    'power2.out',
        onComplete: function () { removeEl(ghost); }
      });
    },

    /**
     * Floating number — fires after any IP change.
     * @param {Element} el     The slot element the number rises from
     * @param {number}  delta  Positive = green+up, negative = red+down
     */
    floatNumber: function (el, delta) {
      if (!el || delta === 0) return;
      var num = document.createElement('div');
      num.className   = 'anim-float-num ' + (delta > 0 ? 'anim-float-plus' : 'anim-float-minus');
      num.textContent = (delta > 0 ? '+' : '') + delta;
      el.appendChild(num);
      if (!hasGSAP()) {
        setTimeout(function () { removeEl(num); }, 750);
        return;
      }
      gsap.fromTo(num,
        { y: 0, opacity: 1 },
        {
          y:        delta > 0 ? -40 : 20,
          opacity:  0,
          duration: 0.75,
          ease:     delta > 0 ? 'power1.out' : 'power1.in',
          onComplete: function () { removeEl(num); }
        }
      );
    },

    /**
     * Persistent glow pulse — on/off for continuous ability active state.
     * @param {Element} el   Slot element
     * @param {boolean} on   True = start glow loop, false = stop and clear
     */
    setGlow: function (el, on) {
      if (!el) return;
      if (!hasGSAP()) {
        el.classList.toggle('anim-cont-glow', !!on);
        return;
      }
      gsap.killTweensOf(el, 'boxShadow');  // scope kill — do NOT touch opacity/scale/transform
      if (on) {
        gsap.to(el, {
          boxShadow: '0 0 0 2px rgba(64,224,224,0.9), 0 0 14px 4px rgba(64,224,224,0.65)',
          duration:  0.75,
          repeat:    -1,
          yoyo:      true,
          ease:      'sine.inOut'
        });
      } else {
        gsap.set(el, { clearProps: 'boxShadow' });
      }
    },

    /**
     * Conditional trigger burst — fires when an If/When ability activates.
     * @param {Element} el  The slot element whose card triggered the ability
     */
    conditional: function (el) {
      if (!el || !hasGSAP()) return;
      var flash = makeOverlay(el, 'background:rgba(255,110,0,0.8);opacity:0;');
      var ring  = makeOverlay(el, 'border:3px solid rgba(255,110,0,0.9);background:transparent;');
      var tl = gsap.timeline({ onComplete: function () { removeEl(flash); } });
      tl.to(flash, { opacity: 1,   duration: 0.10, ease: 'power2.in' })
        .to(flash, { opacity: 0,   duration: 0.50, ease: 'power2.out' });
      gsap.fromTo(ring,
        { opacity: 1, scale: 1 },
        {
          opacity: 0, scale: 1.6, duration: 0.65, ease: 'power2.out',
          onComplete: function () { removeEl(ring); }
        }
      );
    },

    /**
     * Location win flash — gold pulse on the winning location tile.
     */
    locationWin: function (el) {
      if (!el || !hasGSAP()) return;
      var flash = makeOverlay(el, 'background:rgba(212,175,55,0.45);opacity:0;');
      gsap.to(flash, {
        opacity:  0.9,
        duration: 0.22,
        yoyo:     true,
        repeat:   5,
        ease:     'power2.inOut',
        onComplete: function () { removeEl(flash); }
      });
    },

    /**
     * Bounce the VICTORY headline on the results screen.
     */
    celebration: function () {
      var el = document.getElementById('result-headline');
      if (!el || !hasGSAP()) return;
      gsap.fromTo(el,
        { scale: 1 },
        {
          scale:    1.2,
          duration: 0.15,
          yoyo:     true,
          repeat:   5,
          ease:     'back.out(2)',
          clearProps: 'transform'
        }
      );
    },

    /**
     * Shake the DEFEAT headline on the results screen.
     */
    sadResult: function () {
      var el = document.getElementById('result-headline');
      if (!el || !hasGSAP()) return;
      var tl = gsap.timeline({ onComplete: function () { gsap.set(el, { clearProps: 'x' }); } });
      tl.to(el, { x: -12, duration: 0.07 })
        .to(el, { x:  12, duration: 0.07 })
        .to(el, { x:  -8, duration: 0.06 })
        .to(el, { x:   8, duration: 0.06 })
        .to(el, { x:   0, duration: 0.05 });
    },

    /**
     * Jesus Christ ascend — card rises from hand and fades out.
     * Clones the hand card into a fixed overlay, removes the original,
     * plays the GSAP tween, then fires callback when complete.
     * @param {Element}  handCardEl  The .battle-hand-card element to animate
     * @param {Function} callback    Called after animation finishes
     */
    jesusAscend: function (handCardEl, callback) {
      if (!handCardEl) { if (callback) callback(); return; }
      var ghost = makeGhost(handCardEl, 9999);
      removeEl(handCardEl);
      if (!hasGSAP()) {
        setTimeout(function () { removeEl(ghost); if (callback) callback(); }, 1400);
        return;
      }
      gsap.to(ghost, {
        y:        -120,
        opacity:  0,
        scale:    0.88,
        duration: 1.40,
        ease:     'power2.out',
        onComplete: function () { removeEl(ghost); if (callback) callback(); }
      });
    },

    /**
     * William the Conqueror pulse — dark red border flash each time a card is destroyed.
     * Uses an overlay so it never conflicts with the continuous-ability cyan glow.
     * @param {Element} el  The card element (hand card or board slot)
     */
    williamPulse: function (el) {
      if (!el || !hasGSAP()) return;
      var flash = makeOverlay(el,
        'border:3px solid rgba(255,40,40,1.0);' +
        'box-shadow:inset 0 0 22px 8px rgba(255,60,60,0.65), 0 0 14px 5px rgba(255,0,0,0.55);' +
        'opacity:0;border-radius:3px;');
      var tl = gsap.timeline({ onComplete: function () { removeEl(flash); } });
      tl.to(flash, { opacity: 1, duration: 0.10, ease: 'power3.in' })
        .to(flash, { opacity: 0, duration: 0.95, ease: 'power2.out' });
    },

    /**
     * Scholar-Officials gold border glow — fades out over ~1s.
     * @param {Element} el  The slot element for Scholar-Officials
     */
    scholarPulse: function (el) {
      if (!el || !hasGSAP()) return;
      var flash = makeOverlay(el,
        'border:2px solid rgba(255,215,0,0.9);' +
        'box-shadow:inset 0 0 10px 3px rgba(255,180,0,0.35);' +
        'opacity:0;border-radius:3px;');
      var tl = gsap.timeline({ onComplete: function () { removeEl(flash); } });
      tl.to(flash, { opacity: 1, duration: 0.12, ease: 'power2.in' })
        .to(flash, { opacity: 0, duration: 0.88, ease: 'power2.out' });
    },

    /**
     * Floating capital text — "+N Capital" rises from Scholar-Officials' slot.
     * @param {Element} el      The slot element
     * @param {number}  amount  Number of bonus capital earned
     */
    floatCapital: function (el, amount) {
      if (!el || amount <= 0) return;
      var num = document.createElement('div');
      num.className   = 'anim-float-capital';
      num.textContent = '+' + amount + ' Capital';
      el.appendChild(num);
      if (!hasGSAP()) {
        setTimeout(function () { removeEl(num); }, 1000);
        return;
      }
      gsap.fromTo(num,
        { y: 0, opacity: 1 },
        {
          y:        -50,
          opacity:  0,
          duration: 1.00,
          ease:     'power1.out',
          onComplete: function () { removeEl(num); }
        }
      );
    },

    /**
     * Jesus Christ return glow — golden flash on his newly re-added hand card.
     * @param {Element} el  The .battle-hand-card element that just appeared
     */
    jesusReturn: function (el) {
      if (!el || !hasGSAP()) return;
      var tl = gsap.timeline({
        onComplete: function () { gsap.set(el, { clearProps: 'scale,opacity,boxShadow' }); }
      });
      tl.fromTo(el,
          { scale: 0.85, opacity: 0.3 },
          { scale: 1.08, opacity: 1,
            boxShadow: '0 0 28px 10px rgba(255,215,0,0.95)',
            duration: 0.25, ease: 'power2.out' }
        )
        .to(el, { scale: 1.0, boxShadow: '0 0 14px 4px rgba(255,215,0,0.55)', duration: 0.25 })
        .to(el, { boxShadow: '0 0 0 0 rgba(255,215,0,0)', duration: 0.25, ease: 'power2.in' });
    },

    /**
     * Kente Cloth location glow — persistent warm orange glow on the location tile.
     * on=true: pulses briefly then settles into a subtle steady amber glow.
     * on=false: kills the tween and clears the boxShadow.
     * @param {Element} locTileEl  The .battle-location tile element
     * @param {boolean} on
     */
    setKenteGlow: function (locTileEl, on) {
      if (!locTileEl) return;
      if (!hasGSAP()) {
        locTileEl.classList.toggle('anim-kente-glow', !!on);
        return;
      }
      gsap.killTweensOf(locTileEl, 'boxShadow');
      if (on) {
        // Phase 1: strong initial pulse, then settle into a gentle yoyo loop
        gsap.timeline()
          .to(locTileEl, {
            boxShadow: '0 0 0 4px rgba(255,140,0,0.9), 0 0 32px 12px rgba(255,120,0,0.75)',
            duration: 0.35, ease: 'power2.out'
          })
          .to(locTileEl, {
            boxShadow: '0 0 0 2px rgba(255,140,0,0.55), 0 0 14px 5px rgba(255,100,0,0.35)',
            duration: 0.55, ease: 'power2.inOut',
            onComplete: function () {
              gsap.to(locTileEl, {
                boxShadow: '0 0 0 3px rgba(255,150,0,0.70), 0 0 20px 8px rgba(255,110,0,0.50)',
                duration: 1.4, repeat: -1, yoyo: true, ease: 'sine.inOut'
              });
            }
          });
      } else {
        gsap.set(locTileEl, { clearProps: 'boxShadow' });
      }
    },

    /**
     * Juvenal penalty flash — brief orange-amber border glow on a card slot
     * to indicate it is being penalised by Juvenal's -2 IP reduction.
     * @param {Element} slotEl  The .battle-card-slot element being penalised
     */
    juvenalFlash: function (slotEl) {
      if (!slotEl || !hasGSAP()) return;
      var flash = makeOverlay(slotEl,
        'border:3px solid rgba(255,120,0,0.95);' +
        'box-shadow:inset 0 0 18px 6px rgba(255,100,0,0.55),0 0 12px 4px rgba(255,80,0,0.50);' +
        'opacity:0;border-radius:3px;');
      var tl = gsap.timeline({ onComplete: function () { removeEl(flash); } });
      tl.to(flash, { opacity: 1, duration: 0.10, ease: 'power2.in'  })
        .to(flash, { opacity: 0, duration: 0.70, ease: 'power2.out' });
    },

    /**
     * Jan Hus split — card tears vertically in half.
     * Left half slides left + fades; right half slides right + fades simultaneously.
     * The caller is responsible for removing or hiding `el` after `onComplete` fires.
     * @param {Element}  el          Card element to split (hand card or board ghost)
     * @param {Function} onComplete  Called once both halves have fully faded out
     */
    janHusSplit: function (el, onComplete) {
      if (!el || !hasGSAP()) { if (onComplete) onComplete(); return; }

      var rect  = el.getBoundingClientRect();
      var w     = rect.width;
      var travel = Math.round(w * 0.7);

      // Left half: clips the left 50% of the card
      var leftGhost = document.createElement('div');
      leftGhost.innerHTML  = el.innerHTML;
      leftGhost.className  = el.className;
      leftGhost.style.cssText =
        'position:fixed;left:' + rect.left + 'px;top:' + rect.top + 'px;' +
        'width:' + w + 'px;height:' + rect.height + 'px;margin:0;' +
        'clip-path:polygon(0 0,50% 0,50% 100%,0 100%);' +
        'z-index:501;pointer-events:none;overflow:hidden;';
      document.body.appendChild(leftGhost);

      // Right half: clips the right 50% of the card
      var rightGhost = document.createElement('div');
      rightGhost.innerHTML  = el.innerHTML;
      rightGhost.className  = el.className;
      rightGhost.style.cssText =
        'position:fixed;left:' + rect.left + 'px;top:' + rect.top + 'px;' +
        'width:' + w + 'px;height:' + rect.height + 'px;margin:0;' +
        'clip-path:polygon(50% 0,100% 0,100% 100%,50% 100%);' +
        'z-index:501;pointer-events:none;overflow:hidden;';
      document.body.appendChild(rightGhost);

      // Hide the original while the ghosts animate
      gsap.set(el, { opacity: 0 });

      var done = false;
      function finish() {
        if (done) return; done = true;
        removeEl(leftGhost);
        removeEl(rightGhost);
        if (onComplete) onComplete();
      }

      gsap.to(leftGhost,  { x: -travel, opacity: 0, duration: 0.55, ease: 'power2.out',
                            onComplete: finish });
      gsap.to(rightGhost, { x:  travel, opacity: 0, duration: 0.55, ease: 'power2.out',
                            onComplete: finish });
    },

    /**
     * Zheng He IP delivery — slot hops up 13px and bounces back, then a green +2 floats up.
     * @param {Element} slotEl  The .battle-card-slot receiving the +2 IP bonus
     */
    zhengheBounce: function (slotEl) {
      if (!slotEl || !hasGSAP()) {
        this.floatNumber(slotEl, 2);
        return;
      }
      var self = this;
      gsap.timeline({ onComplete: function () { self.floatNumber(slotEl, 2); } })
        .to(slotEl, { y: -13, duration: 0.14, ease: 'power2.out' })
        .to(slotEl, { y:   0, duration: 0.22, ease: 'bounce.out' });
    },

    /**
     * Voltaire smug rock — gentle left-right rotation when his +4 bonus activates.
     * ~1 second total; card rocks -8° → +8° → settle back to 0°.
     * @param {Element} slotEl  Voltaire's .battle-card-slot element
     */
    voltaireRock: function (slotEl) {
      if (!slotEl || !hasGSAP()) return;
      gsap.timeline({
        onComplete: function () { gsap.set(slotEl, { clearProps: 'rotation' }); }
      })
        .to(slotEl, { rotation: -8, duration: 0.14, ease: 'power2.out'   })
        .to(slotEl, { rotation:  8, duration: 0.26, ease: 'power2.inOut' })
        .to(slotEl, { rotation: -5, duration: 0.20, ease: 'power2.inOut' })
        .to(slotEl, { rotation:  3, duration: 0.18, ease: 'power2.inOut' })
        .to(slotEl, { rotation:  0, duration: 0.14, ease: 'power2.in'    });
    },

    /**
     * Columbus arrival shake — rapid earthquake vibration on an opponent Cultural card
     * that is being hit by Columbus's -1 IP penalty.
     * Calls onComplete when the shake finishes (caller then shows -1 float).
     * @param {Element}  slotEl      The .battle-card-slot to shake
     * @param {Function} onComplete  Called after the shake settles
     */
    columbusShake: function (slotEl, onComplete) {
      if (!slotEl || !hasGSAP()) {
        if (onComplete) onComplete();
        return;
      }
      var tl = gsap.timeline({
        onComplete: function () {
          gsap.set(slotEl, { clearProps: 'x' });
          if (onComplete) onComplete();
        }
      });
      tl.to(slotEl, { x: -8,  duration: 0.065, ease: 'power1.inOut' })
        .to(slotEl, { x:  8,  duration: 0.065 })
        .to(slotEl, { x: -8,  duration: 0.065 })
        .to(slotEl, { x:  8,  duration: 0.065 })
        .to(slotEl, { x: -7,  duration: 0.065 })
        .to(slotEl, { x:  7,  duration: 0.065 })
        .to(slotEl, { x: -6,  duration: 0.065 })
        .to(slotEl, { x:  6,  duration: 0.065 })
        .to(slotEl, { x: -5,  duration: 0.065 })
        .to(slotEl, { x:  5,  duration: 0.065 })
        .to(slotEl, { x: -4,  duration: 0.065 })
        .to(slotEl, { x:  4,  duration: 0.065 })
        .to(slotEl, { x: -2,  duration: 0.05  })
        .to(slotEl, { x:  0,  duration: 0.05  });
    }

  };

})();
