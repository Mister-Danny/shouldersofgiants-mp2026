/**
 * audio.js
 * Shoulders of Giants — SNES-style Sound Effects
 *
 * All sounds synthesised with the Web Audio API — no external files.
 * Exposes a single global object: SFX
 *
 * Usage:
 *   SFX.cardReveal()
 *   SFX.atOnce()
 *   SFX.continuous()
 *   SFX.conditional()
 *   SFX.cardDestroyed()
 *   SFX.cardDiscarded()
 *   SFX.ipGained()
 *   SFX.ipLost()
 *   SFX.locationWon()
 *   SFX.capitalSpent()
 *   SFX.endTurn()
 *   SFX.gameWon()
 *   SFX.gameLost()
 */

var SFX = (function () {
  'use strict';

  var ctx    = null;
  var _muted = false;   // suppresses all synth + file sounds during Cortes animation

  function getCtx() {
    if (!ctx) {
      try {
        ctx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) {
        return null;
      }
    }
    // Resume if suspended (browser autoplay policy)
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /**
   * Play a single oscillator tone.
   * @param {number} freq      Frequency in Hz
   * @param {string} type      Oscillator type: 'square'|'sine'|'sawtooth'|'triangle'
   * @param {number} attack    Seconds to peak
   * @param {number} sustain   Seconds at peak
   * @param {number} release   Seconds to silence
   * @param {number} gain      Peak gain (0–1)
   * @param {number} [delay]   Start offset from now in seconds
   */
  function tone(freq, type, attack, sustain, release, gain, delay) {
    if (_muted) return;
    var ac = getCtx();
    if (!ac) return;
    try {
      var osc = ac.createOscillator();
      var env = ac.createGain();
      var now = ac.currentTime + (delay || 0);

      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, now);

      env.gain.setValueAtTime(0, now);
      env.gain.linearRampToValueAtTime(gain || 0.25, now + attack);
      env.gain.setValueAtTime(gain || 0.25, now + attack + sustain);
      env.gain.linearRampToValueAtTime(0.0001, now + attack + sustain + release);

      osc.connect(env);
      env.connect(ac.destination);
      osc.start(now);
      osc.stop(now + attack + sustain + release + 0.01);
    } catch (e) {}
  }

  /**
   * Play a white-noise burst (for crunch/destroy effects).
   * @param {number} duration  Length in seconds
   * @param {number} gain      Initial gain
   * @param {number} [delay]   Start offset from now in seconds
   */
  function noise(duration, gain, delay) {
    if (_muted) return;
    var ac = getCtx();
    if (!ac) return;
    try {
      var bufLen = Math.floor(ac.sampleRate * duration);
      var buf    = ac.createBuffer(1, bufLen, ac.sampleRate);
      var data   = buf.getChannelData(0);
      for (var i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

      var src = ac.createBufferSource();
      src.buffer = buf;

      var env = ac.createGain();
      var now = ac.currentTime + (delay || 0);
      env.gain.setValueAtTime(gain || 0.3, now);
      env.gain.exponentialRampToValueAtTime(0.0001, now + duration);

      src.connect(env);
      env.connect(ac.destination);
      src.start(now);
      src.stop(now + duration + 0.01);
    } catch (e) {}
  }

  /* ── Howler-based sounds (file-backed) ───────────────────────── */

  var _jesusHowl       = null;
  var _jesusOnFinished = null;

  var _cortesHowl    = null;
  var _deflateHowl   = null;
  var _joanHowl      = null;
  var _samuraiHowl   = null;
  var _williamHowl   = null;
  var _coinHowl      = null;
  var _pacalHowl     = null;
  var _justinianHowl = null;
  var _wuHowl        = null;
  var _kenteHowl     = null;
  var _juvenalHowl   = null;
  var _cosimoHowl    = null;
  var _janHusHowl    = null;
  var _francisHowl   = null;
  var _erasmusHowl   = null;
  var _henryHowl     = null;
  var _zhengheHowl   = null;
  var _sailingHowl   = null;
  var _columbusHowl  = null;
  var _voltaireHowl  = null;

  function cortesHowl() {
    if (typeof Howl === 'undefined') return null;
    if (!_cortesHowl) {
      _cortesHowl = new Howl({
        src:    ['sfx/cortes-destroy.mp3'],
        volume: 1.0,
        html5:  true
      });
    }
    return _cortesHowl;
  }

  function deflateHowl() {
    if (typeof Howl === 'undefined') return null;
    if (!_deflateHowl) {
      _deflateHowl = new Howl({
        src:    ['sfx/cortes-deflate.mp3'],
        volume: 1.0,
        html5:  true
      });
    }
    return _deflateHowl;
  }

  function joanHowl() {
    if (typeof Howl === 'undefined') return null;
    if (!_joanHowl) {
      _joanHowl = new Howl({
        src:    ['sfx/joan-warhorn.mp3'],
        volume: 1.0,
        html5:  true
      });
    }
    return _joanHowl;
  }

  function williamHowl() {
    if (typeof Howl === 'undefined') return null;
    if (!_williamHowl) {
      _williamHowl = new Howl({
        src:    ['sfx/william-mine.mp3'],
        volume: 1.0,
        html5:  true
      });
    }
    return _williamHowl;
  }

  function samuraiHowl() {
    if (typeof Howl === 'undefined') return null;
    if (!_samuraiHowl) {
      _samuraiHowl = new Howl({
        src:    ["sfx/samurai-rise.mp3"],
        volume: 1.0,
        html5:  true
      });
    }
    return _samuraiHowl;
  }

  function coinHowl() {
    if (typeof Howl === 'undefined') return null;
    if (!_coinHowl) {
      _coinHowl = new Howl({
        src:    ['sfx/scholar-officials-coin.mp3'],
        volume: 1.0,
        html5:  true
      });
    }
    return _coinHowl;
  }

  function pacalHowl() {
    if (typeof Howl === 'undefined') return null;
    if (!_pacalHowl) {
      _pacalHowl = new Howl({
        src:   ['sfx/pacal-rewind.mp3'],
        volume: 1.0,
        html5:  true
      });
    }
    return _pacalHowl;
  }

  function wuHowl() {
    if (typeof Howl === 'undefined') return null;
    if (!_wuHowl) {
      _wuHowl = new Howl({
        src:    ['sfx/empresswu-push.mp3'],
        volume: 1.0,
        html5:  true
      });
    }
    return _wuHowl;
  }

  function erasmusHowl() {
    if (typeof Howl === 'undefined') return null;
    if (!_erasmusHowl) {
      _erasmusHowl = new Howl({
        src:   ['sfx/erasmus-noyield.mp3'],
        volume: 1.0,
        html5:  true
      });
    }
    return _erasmusHowl;
  }

  function henryHowl() {
    if (typeof Howl === 'undefined') return null;
    if (!_henryHowl) {
      _henryHowl = new Howl({ src: ['sfx/henrynav-watermoney.mp3'], volume: 1.0, html5: true });
    }
    return _henryHowl;
  }

  function zhengheHowl() {
    if (typeof Howl === 'undefined') return null;
    if (!_zhengheHowl) {
      _zhengheHowl = new Howl({ src: ['sfx/zhenghe-bubble.mp3'], volume: 1.0, html5: true });
    }
    return _zhengheHowl;
  }

  function sailingHowl() {
    if (typeof Howl === 'undefined') return null;
    if (!_sailingHowl) {
      _sailingHowl = new Howl({ src: ['sfx/boat-waves.mp3'], volume: 1.0, html5: true });
    }
    return _sailingHowl;
  }

  function columbusHowl() {
    if (typeof Howl === 'undefined') return null;
    if (!_columbusHowl) {
      _columbusHowl = new Howl({ src: ['sfx/columbus-churchbell.mp3'], volume: 1.0, html5: true });
    }
    return _columbusHowl;
  }

  function voltaireHowl() {
    if (typeof Howl === 'undefined') return null;
    if (!_voltaireHowl) {
      _voltaireHowl = new Howl({ src: ['sfx/voltaire-break.mp3'], volume: 1.0, html5: true });
    }
    return _voltaireHowl;
  }

  function francisHowl() {
    if (typeof Howl === 'undefined') return null;
    if (!_francisHowl) {
      _francisHowl = new Howl({
        src:   ['sfx/francis-prayer.mp3'],
        volume: 1.0,
        html5:  true
      });
    }
    return _francisHowl;
  }

  function justinianHowl() {
    if (typeof Howl === 'undefined') return null;
    if (!_justinianHowl) {
      _justinianHowl = new Howl({
        src:    ['sfx/justinian-reset.mp3'],
        volume: 1.0,
        html5:  true
      });
    }
    return _justinianHowl;
  }

  function kenteHowl() {
    if (typeof Howl === 'undefined') return null;
    if (!_kenteHowl) {
      _kenteHowl = new Howl({ src: ['sfx/kente-shield.mp3'], volume: 1.0, html5: true });
    }
    return _kenteHowl;
  }

  function juvenalHowl() {
    if (typeof Howl === 'undefined') return null;
    if (!_juvenalHowl) {
      _juvenalHowl = new Howl({ src: ['sfx/juvenal-laugh.mp3'], volume: 1.0, html5: true });
    }
    return _juvenalHowl;
  }

  function cosimoHowl() {
    if (typeof Howl === 'undefined') return null;
    if (!_cosimoHowl) {
      _cosimoHowl = new Howl({ src: ['sfx/demedici-money.mp3'], volume: 1.0, html5: true });
    }
    return _cosimoHowl;
  }

  function jesusHowl() {
    if (typeof Howl === 'undefined') return null;
    if (!_jesusHowl) {
      _jesusHowl = new Howl({
        src:    ['sfx/jesus-resurrect.mp3'],
        volume: 1.0,
        html5:  true,     // stream rather than buffer the whole file
        onend: function () {
          var cb = _jesusOnFinished;
          _jesusOnFinished = null;
          if (cb) setTimeout(cb, 500);
        },
        onloaderror: function () {
          var cb = _jesusOnFinished;
          _jesusOnFinished = null;
          if (cb) setTimeout(cb, 500);
        },
        onplayerror: function () {
          var cb = _jesusOnFinished;
          _jesusOnFinished = null;
          if (cb) setTimeout(cb, 500);
        }
      });
    }
    return _jesusHowl;
  }

  /* ── Public SFX API ─────────────────────────────────────────── */

  return {

    /** Card flips face-up: quick pitch click */
    cardReveal: function () {
      tone(440, 'square', 0.005, 0.015, 0.07, 0.09);
      tone(660, 'square', 0.003, 0.010, 0.05, 0.06, 0.025);
    },

    /** At Once ability fires: ascending 3-note chime */
    atOnce: function () {
      tone(523, 'square', 0.005, 0.04, 0.06, 0.09);          // C5
      tone(659, 'square', 0.005, 0.04, 0.06, 0.09, 0.11);    // E5
      tone(784, 'square', 0.005, 0.05, 0.10, 0.09, 0.22);    // G5
    },

    /** Continuous ability activates: soft warm two-note hum */
    continuous: function () {
      tone(330, 'sine', 0.015, 0.06, 0.10, 0.12);
      tone(440, 'sine', 0.015, 0.05, 0.10, 0.08, 0.08);
    },

    /** Conditional ability triggers: dramatic descending 3-note drop */
    conditional: function () {
      tone(523, 'square', 0.005, 0.06, 0.05, 0.14);          // C5
      tone(415, 'square', 0.005, 0.06, 0.05, 0.14, 0.13);    // Ab4
      tone(311, 'square', 0.005, 0.10, 0.12, 0.14, 0.26);    // Eb4
    },

    /** Card destroyed: noise crunch + pitch drop */
    cardDestroyed: function () {
      noise(0.06, 0.35);
      tone(200, 'sawtooth', 0.005, 0.04, 0.14, 0.14);
      tone(100, 'square',   0.005, 0.04, 0.14, 0.09, 0.08);
    },

    /** Card discarded from hand: high-to-low whoosh sweep */
    cardDiscarded: function () {
      var ac = getCtx();
      if (!ac) return;
      try {
        var osc = ac.createOscillator();
        var env = ac.createGain();
        var now = ac.currentTime;
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(700, now);
        osc.frequency.exponentialRampToValueAtTime(120, now + 0.22);
        env.gain.setValueAtTime(0.18, now);
        env.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
        osc.connect(env);
        env.connect(ac.destination);
        osc.start(now);
        osc.stop(now + 0.23);
      } catch (e) {}
    },

    /** IP increased: bright high-pitched ding */
    ipGained: function () {
      tone(880, 'sine', 0.004, 0.03, 0.14, 0.14);
    },

    /** IP decreased: short low thud */
    ipLost: function () {
      tone(110, 'square', 0.004, 0.03, 0.12, 0.14);
      noise(0.04, 0.18);
    },

    /** Location win fanfare: 5-note triumphant arpeggio */
    locationWon: function () {
      var notes = [523, 659, 784, 1047, 1319];  // C E G C E
      notes.forEach(function (f, i) {
        tone(f, 'square', 0.005, 0.06, 0.09, 0.14, i * 0.1);
      });
    },

    /** Capital spent (card played): soft click */
    capitalSpent: function () {
      tone(440, 'square', 0.002, 0.008, 0.025, 0.05);
    },

    /** End Turn button pressed: punchy medium thump */
    endTurn: function () {
      tone(293, 'square', 0.003, 0.04, 0.07, 0.16);
      tone(220, 'square', 0.003, 0.03, 0.09, 0.11, 0.05);
    },

    /** Game won: 7-note victory fanfare */
    gameWon: function () {
      var notes = [523, 659, 784, 523, 659, 784, 1047];
      var times = [0, 0.12, 0.24, 0.45, 0.57, 0.69, 0.85];
      notes.forEach(function (f, i) {
        tone(f, 'square', 0.005, 0.08, 0.12, 0.16, times[i]);
      });
    },

    /** Game lost: 4-note sad descending melody */
    gameLost: function () {
      var notes = [494, 440, 392, 330];  // B A G E
      notes.forEach(function (f, i) {
        tone(f, 'square', 0.005, 0.10, 0.16, 0.14, i * 0.22);
      });
    },

    /** Cortes charge — plays "You Are Nothing" m4a (fire-and-forget) */
    cortesCharge: function () {
      var howl = cortesHowl();
      if (howl) { howl.stop(); howl.play(); return; }
      try { new Audio('sfx/cortes-destroy.mp3').play(); } catch (e) {}
    },

    /** Calls cb() once Cortes's audio finishes (or immediately if it's not playing). */
    afterCortesAudio: function (cb) {
      var howl = cortesHowl();
      if (!howl || !howl.playing()) { cb(); return; }
      howl.once('end', cb);
    },

    /**
     * William the Conqueror gains IP — plays "william-mine.mp3" on every card destruction.
     * Exempt from mute so it fires live during Cortes's animation sequence.
     */
    williamGain: function () {
      var howl = williamHowl();
      if (howl) { howl.stop(); howl.play(); return; }
      try { new Audio('sfx/william-mine.mp3').play(); } catch (e) {}
    },

    /** Samurai returns — plays "samurai-rise.mp3" (fire-and-forget) */
    samuraiReturn: function () {
      var howl = samuraiHowl();
      if (howl) { howl.stop(); howl.play(); return; }
      try { new Audio("sfx/samurai-rise.mp3").play(); } catch (e) {}
    },

    /** Joan of Arc ability — plays "joan-warhorn.mp3" (fire-and-forget) */
    joanRise: function () {
      var howl = joanHowl();
      if (howl) { howl.stop(); howl.play(); return; }
      try { new Audio('sfx/joan-warhorn.mp3').play(); } catch (e) {}
    },

    /** Scholar-Officials ability — plays scholar-officials-coin.mp3 */
    coinSound: function () {
      if (_muted) return;
      var howl = coinHowl();
      if (howl) { howl.stop(); howl.play(); return; }
      try { new Audio('sfx/scholar-officials-coin.mp3').play(); } catch (e) {}
    },

    /** Pacal the Great ability — plays pacal-rewind.mp3 */
    pacalSound: function () {
      if (_muted) return;
      var howl = pacalHowl();
      if (howl) { howl.stop(); howl.play(); return; }
      try { new Audio('sfx/pacal-rewind.mp3').play(); } catch (e) {}
    },

    /** Erasmus ability — plays erasmus-noyield.mp3 when the discard chooser opens */
    erasmusSound: function () {
      var howl = erasmusHowl();
      if (howl) { howl.stop(); howl.play(); return; }
      try { new Audio('sfx/erasmus-noyield.mp3').play(); } catch (e) {}
    },

    /**
     * Francis of Assisi ability — plays francis-prayer.mp3.
     * @param {Function} [callback]  Called when the track ends (or immediately on fallback).
     */
    francisSound: function (callback) {
      var howl = francisHowl();
      if (howl) {
        if (callback) howl.once('end', callback);
        howl.stop();
        howl.play();
        return;
      }
      try { new Audio('sfx/francis-prayer.mp3').play(); } catch (e) {}
      if (callback) setTimeout(callback, 800);
    },

    /** Jan Hus ability — plays janhus-firebell.mp3 */
    janHusSplit: function () {
      if (_muted) return;
      if (!_janHusHowl && typeof Howl !== 'undefined') {
        _janHusHowl = new Howl({ src: ['sfx/janhus-firebell.mp3'], volume: 1.0, html5: true });
      }
      if (_janHusHowl) { _janHusHowl.stop(); _janHusHowl.play(); return; }
      try { new Audio('sfx/janhus-firebell.mp3').play(); } catch (e) {}
    },

    /** Empress Wu ability — plays Empress Wu_mixdown.wav */
    wuPunch: function () {
      if (_muted) return;
      var howl = wuHowl();
      if (howl) { howl.stop(); howl.play(); return; }
      try { new Audio('sfx/empresswu-push.mp3').play(); } catch (e) {}
    },

    /** Justinian ability — plays justinian-reset.mp3 */
    justinianShing: function () {
      if (_muted) return;
      var howl = justinianHowl();
      if (howl) { howl.stop(); howl.play(); return; }
      try { new Audio('sfx/justinian-reset.mp3').play(); } catch (e) {}
    },

    /** Cortes blocked — plays deflate sfx (fire-and-forget) */
    cortesDeflate: function () {
      var howl = deflateHowl();
      if (howl) { howl.stop(); howl.play(); return; }
      try { new Audio('sfx/cortes-deflate.mp3').play(); } catch (e) {}
    },

    /** Kente revealed — shield spell chime */
    kenteSound: function () {
      if (_muted) return;
      var howl = kenteHowl();
      if (howl) { howl.stop(); howl.play(); return; }
      try { new Audio('sfx/kente-shield.mp3').play(); } catch (e) {}
    },

    /** Juvenal revealed / penalising a card — laughter sfx */
    juvenalSound: function () {
      if (_muted) return;
      var howl = juvenalHowl();
      if (howl) { howl.stop(); howl.play(); return; }
      try { new Audio('sfx/juvenal-laugh.mp3').play(); } catch (e) {}
    },

    /** Cosimo de'Medici revealed — money-bags sfx */
    cosimoSound: function () {
      if (_muted) return;
      var howl = cosimoHowl();
      if (howl) { howl.stop(); howl.play(); return; }
      try { new Audio('sfx/demedici-money.mp3').play(); } catch (e) {}
    },

    /** Henry the Navigator revealed — "thank you for your patronage" */
    henrySound: function () {
      if (_muted) return;
      var howl = henryHowl();
      if (howl) { howl.stop(); howl.play(); return; }
      try { new Audio('sfx/henrynav-watermoney.mp3').play(); } catch (e) {}
    },

    /** Zheng He ability fires — plays zhenghe-bubble when cards are boosted */
    zhengheSound: function () {
      if (_muted) return;
      var howl = zhengheHowl();
      if (howl) { howl.stop(); howl.play(); return; }
      try { new Audio('sfx/zhenghe-bubble.mp3').play(); } catch (e) {}
    },

    /** Magellan moves — plays boat-waves.mp3 */
    sailingSound: function () {
      if (_muted) return;
      var howl = sailingHowl();
      if (howl) { howl.stop(); howl.play(); return; }
      try { new Audio('sfx/boat-waves.mp3').play(); } catch (e) {}
    },

    /** Voltaire ability activates (+4 bonus as sole card) */
    voltaireSound: function () {
      if (_muted) return;
      var howl = voltaireHowl();
      if (howl) { howl.stop(); howl.play(); return; }
      try { new Audio('sfx/voltaire-break.mp3').play(); } catch (e) {}
    },

    /** Columbus arrives at a location with Cultural cards — plays church bell */
    columbusSound: function () {
      if (_muted) return;
      var howl = columbusHowl();
      if (howl) { howl.stop(); howl.play(); return; }
      try { new Audio('sfx/columbus-churchbell.mp3').play(); } catch (e) {}
    },

    /**
     * Silence / restore all sounds (used during Cortes animation).
     * cortesCharge and cortesDeflate are exempt and always play.
     */
    mute: function (v) { _muted = !!v; },

    /**
     * Jesus Christ returns to hand: plays the sfx file via Howler.
     * Falls back to raw Audio if Howler is not loaded.
     * @param {Function} [onFinished]  Called 500 ms after the track ends.
     */
    jesusReturn: function (onFinished) {
      if (_muted) { if (onFinished) setTimeout(onFinished, 500); return; }
      var howl = jesusHowl();
      if (howl) {
        _jesusOnFinished = onFinished || null;
        howl.stop();
        howl.play();
        return;
      }
      // Fallback: Howler not loaded — use raw Audio element
      try {
        var audio = new Audio('sfx/jesus-resurrect.mp3');
        audio.volume = 1.0;
        if (onFinished) {
          audio.addEventListener('ended', function () { setTimeout(onFinished, 500); });
          audio.addEventListener('error', function () { setTimeout(onFinished, 500); });
        }
        audio.play().catch(function () { if (onFinished) setTimeout(onFinished, 500); });
      } catch (e) {
        if (onFinished) setTimeout(onFinished, 500);
      }
    }

  };

})();
