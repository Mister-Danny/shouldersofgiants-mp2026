/**
 * bypass.js — Shoulders of Giants · Teacher Bypass Menu
 *
 * Opens when the player triple-clicks the "Shoulders of Giants" title.
 * Sections: Tutorial Controls, Session Controls, Classroom Controls, Data Review.
 *
 * Depends on: Firebase compat v9 (initialised by analytics.js before this loads)
 * Exposes:    window.BypassMenu
 */
(function () {
  'use strict';

  /* ── localStorage keys (must match analytics.js) ─────────────── */
  var FORCED_LOCS_KEY = 'sog_forced_locations';
  var TUTORIAL_KEY    = 'sog_tutorial_complete';
  var TEST_MODE_KEY   = 'sog_test_mode';
  // Saved decks now live in window.Decks (multi-slot system).
  var ABANDONED_KEY   = 'sog_abandoned_session';

  /* ── Module state ─────────────────────────────────────────────── */
  var _db         = null;
  var dateFilter  = 'today';  // 'today' | 'week' | 'all'
  var logExpanded = false;

  /* ══════════════════════════════════════════════════════════════
     Firestore — reuse the already-initialised Firebase app
  ══════════════════════════════════════════════════════════════ */
  function getDb() {
    if (_db) return _db;
    try {
      if (typeof firebase !== 'undefined') {
        _db = firebase.firestore();
      }
    } catch (e) {
      console.warn('[BypassMenu] Firestore unavailable:', e);
    }
    return _db;
  }

  /* ══════════════════════════════════════════════════════════════
     Date helpers
  ══════════════════════════════════════════════════════════════ */
  function startOfToday() {
    var d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function startOfWeek() {
    var d = new Date();
    var day = d.getDay();                 // 0 = Sunday
    var diff = day === 0 ? -6 : 1 - day; // back to Monday
    d.setDate(d.getDate() + diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  function getFilterStart() {
    if (dateFilter === 'today') return startOfToday();
    if (dateFilter === 'week')  return startOfWeek();
    return null; // all time — no lower bound
  }

  /* ══════════════════════════════════════════════════════════════
     Open / Close
  ══════════════════════════════════════════════════════════════ */
  function open() {
    var el = document.getElementById('bypass-backdrop');
    if (!el) return;
    el.style.display = 'flex';
    refreshTestModeBtn();
    refreshForcedLocations();
    loadStats();
  }

  function close() {
    var el = document.getElementById('bypass-backdrop');
    if (el) el.style.display = 'none';
    collapseLog();
  }

  /* ══════════════════════════════════════════════════════════════
     Tutorial Controls
  ══════════════════════════════════════════════════════════════ */
  function skipTutorial() {
    localStorage.setItem(TUTORIAL_KEY, 'true');
    showBypassToast('Tutorial skipped — going to Deck Builder');
    close();
    setTimeout(function () {
      if (typeof showScreen      === 'function') showScreen('screen-deckbuilder');
      if (typeof initDeckBuilder === 'function') initDeckBuilder();
    }, 600);
  }

  function resetTutorial() {
    localStorage.removeItem(TUTORIAL_KEY);
    showBypassToast('Tutorial reset — will replay on next visit');
  }

  /* ══════════════════════════════════════════════════════════════
     Session Controls
  ══════════════════════════════════════════════════════════════ */
  function refreshTestModeBtn() {
    var btn = document.getElementById('bypass-test-toggle');
    if (!btn) return;
    var on = localStorage.getItem(TEST_MODE_KEY) === 'true';
    btn.textContent = 'TEST MODE: ' + (on ? 'ON' : 'OFF');
    btn.className   = 'btn-snes bypass-btn-action ' + (on ? 'bypass-test-on' : 'bypass-test-off');
  }

  function toggleTestMode() {
    var on = localStorage.getItem(TEST_MODE_KEY) === 'true';
    var next = !on;
    localStorage.setItem(TEST_MODE_KEY, next ? 'true' : 'false');
    // Sync visible TEST MODE badge without full page reload
    var ind = document.getElementById('test-mode-indicator');
    if (ind) ind.style.display = next ? 'block' : 'none';
    refreshTestModeBtn();
    showBypassToast('Test mode ' + (next ? 'ON' : 'OFF'));
  }

  function resetAllData() {
    if (!confirm('Reset ALL student data?\n\nThis clears the saved deck, tutorial progress, test mode flag, and all session state. The page will reload immediately.\n\nThis cannot be undone.')) return;
    if (!confirm('Second confirmation: click OK to wipe all data and reload.')) return;
    localStorage.removeItem(TUTORIAL_KEY);
    localStorage.removeItem(TEST_MODE_KEY);
    if (window.Decks && typeof window.Decks.clearAll === 'function') window.Decks.clearAll();
    localStorage.removeItem(ABANDONED_KEY);
    localStorage.removeItem(FORCED_LOCS_KEY);
    location.reload();
  }

  /* ══════════════════════════════════════════════════════════════
     Classroom Controls — Force Locations
  ══════════════════════════════════════════════════════════════ */
  function refreshForcedLocations() {
    var stored = null;
    try { stored = JSON.parse(localStorage.getItem(FORCED_LOCS_KEY)); } catch (e) {}
    var forced = Array.isArray(stored) ? stored : [];

    document.querySelectorAll('.bypass-loc-check').forEach(function (cb) {
      cb.checked = forced.indexOf(parseInt(cb.value, 10)) !== -1;
    });
    updateLocStatus(forced.length === 3 ? forced : []);
  }

  function updateLocStatus(forced) {
    var el = document.getElementById('bypass-loc-status');
    if (!el) return;
    if (!forced || forced.length === 0) {
      el.textContent = 'Random each game';
      el.className   = 'bypass-loc-status bypass-loc-random';
    } else if (forced.length === 3) {
      el.textContent = 'LOCKED';
      el.className   = 'bypass-loc-status bypass-loc-locked';
    } else {
      el.textContent = 'Select exactly 3 to lock';
      el.className   = 'bypass-loc-status bypass-loc-partial';
    }
  }

  function onLocCheckChange(changedCb) {
    var checked = [];
    document.querySelectorAll('.bypass-loc-check:checked').forEach(function (cb) {
      checked.push(parseInt(cb.value, 10));
    });

    if (checked.length > 3) {
      changedCb.checked = false;
      showBypassToast('Select exactly 3 locations to lock');
      return;
    }

    if (checked.length === 3) {
      localStorage.setItem(FORCED_LOCS_KEY, JSON.stringify(checked));
      updateLocStatus(checked);
      showBypassToast('Locations locked for all games');
    } else {
      localStorage.removeItem(FORCED_LOCS_KEY);
      updateLocStatus([]);
      if (checked.length === 0) showBypassToast('Locations will randomize normally');
    }
  }

  function clearForcedLocations() {
    localStorage.removeItem(FORCED_LOCS_KEY);
    document.querySelectorAll('.bypass-loc-check').forEach(function (cb) {
      cb.checked = false;
    });
    updateLocStatus([]);
    showBypassToast('Locations will randomize normally');
  }

  /* ══════════════════════════════════════════════════════════════
     Data Review — build Firestore query for the current filter
  ══════════════════════════════════════════════════════════════ */
  function buildQuery(limit) {
    var db = getDb();
    if (!db) return null;
    var filterStart = getFilterStart();
    var q = db.collection('sessions');
    if (filterStart) {
      q = q.where('timestamp', '>=', firebase.firestore.Timestamp.fromDate(filterStart));
    }
    q = q.orderBy('timestamp', 'desc');
    if (limit) q = q.limit(limit);
    return q;
  }

  /* ── Stats panel ── */
  function loadStats() {
    var statsEl = document.getElementById('bypass-stats');
    if (!statsEl) return;
    statsEl.innerHTML = '<span class="bypass-loading">Loading\u2026</span>';

    var q = buildQuery(0);
    if (!q) {
      statsEl.innerHTML = '<span class="bypass-err">Firebase not available</span>';
      return;
    }

    q.get().then(function (snap) {
      renderStats(snap.docs.map(function (d) { return d.data(); }));
    }).catch(function (e) {
      statsEl.innerHTML = '<span class="bypass-err">Error: ' + e.message + '</span>';
    });
  }

  function renderStats(sessions) {
    var statsEl = document.getElementById('bypass-stats');
    if (!statsEl) return;

    var total     = sessions.length;
    var completed = sessions.filter(function (s) { return s.completed; }).length;
    var wins      = sessions.filter(function (s) { return s.outcome === 'player'; }).length;
    var losses    = sessions.filter(function (s) { return s.outcome === 'ai'; }).length;
    var draws     = sessions.filter(function (s) { return s.outcome === 'draw'; }).length;
    var abandoned = sessions.filter(function (s) { return s.outcome === 'abandoned'; }).length;

    var allDurs = [];
    sessions.forEach(function (s) {
      if (Array.isArray(s.turnDurations)) {
        s.turnDurations.forEach(function (d) { allDurs.push(d); });
      }
    });
    var avgTurn = allDurs.length
      ? Math.round(allDurs.reduce(function (a, b) { return a + b; }, 0) / allDurs.length)
      : null;

    var outcomeTotal = wins + losses + draws;
    var winRate = outcomeTotal > 0
      ? (wins / outcomeTotal * 100).toFixed(0) + '%'
      : '\u2014';

    var label = dateFilter === 'today' ? 'Today'
              : dateFilter === 'week'  ? 'This Week'
              : 'All Time';

    statsEl.innerHTML =
      row('Games Started (' + label + ')', total) +
      row('Games Completed', completed) +
      divider() +
      '<div class="bypass-stat-row">' +
        '<span class="bypass-stat-label">Wins / Losses / Draws</span>' +
        '<span class="bypass-stat-val">' +
          '<span class="bypass-win">'  + wins   + '</span> / ' +
          '<span class="bypass-loss">' + losses + '</span> / ' +
          '<span class="bypass-draw">' + draws  + '</span>' +
        '</span>' +
      '</div>' +
      row('Win Rate', winRate) +
      row('Abandoned', abandoned) +
      divider() +
      row('Avg Turn Duration', avgTurn !== null ? avgTurn + 's' : '\u2014');

    function row(label, val) {
      return '<div class="bypass-stat-row">' +
        '<span class="bypass-stat-label">' + label + '</span>' +
        '<span class="bypass-stat-val">'   + val   + '</span>' +
      '</div>';
    }
    function divider() {
      return '<div class="bypass-stat-divider"></div>';
    }
  }

  /* ── Full Log ── */
  function collapseLog() {
    var logPanel = document.getElementById('bypass-log-panel');
    var logBtn   = document.getElementById('bypass-view-log');
    if (logPanel) logPanel.style.display = 'none';
    if (logBtn)   logBtn.textContent = 'VIEW FULL LOG';
    logExpanded = false;
  }

  function loadFullLog() {
    var logEl    = document.getElementById('bypass-log-list');
    var logPanel = document.getElementById('bypass-log-panel');
    if (!logEl || !logPanel) return;

    logEl.innerHTML        = '<span class="bypass-loading">Loading\u2026</span>';
    logPanel.style.display = 'block';
    logExpanded            = true;

    var logBtn = document.getElementById('bypass-view-log');
    if (logBtn) logBtn.textContent = 'HIDE LOG';

    var q = buildQuery(20);
    if (!q) {
      logEl.innerHTML = '<span class="bypass-err">Firebase not available</span>';
      return;
    }

    q.get().then(function (snap) {
      renderLog(snap.docs.map(function (d) { return d.data(); }), logEl);
    }).catch(function (e) {
      logEl.innerHTML = '<span class="bypass-err">Error: ' + e.message + '</span>';
    });
  }

  function renderLog(sessions, logEl) {
    if (!sessions.length) {
      logEl.innerHTML = '<div class="bypass-log-empty">No sessions found for this period.</div>';
      return;
    }

    logEl.innerHTML = sessions.map(function (s) {
      var ts = s.timestamp
        ? new Date(s.timestamp.seconds * 1000)
        : null;
      var tsStr = ts
        ? ts.toLocaleDateString() + ' ' + ts.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '\u2014';

      var outcome      = s.outcome || '\u2014';
      var outcomeClass = outcome === 'player'   ? 'bypass-win'
                       : outcome === 'ai'       ? 'bypass-loss'
                       : outcome === 'draw'     ? 'bypass-draw'
                       : 'bypass-abandoned';

      var durs    = Array.isArray(s.turnDurations) ? s.turnDurations : [];
      var durStr  = durs.length ? durs.map(function (d) { return d + 's'; }).join(', ') : '\u2014';

      var locs    = Array.isArray(s.locationScores) ? s.locationScores : [];
      var locStr  = locs.length
        ? locs.map(function (l) {
            return '<span class="bypass-loc-line">' +
              l.location + ': <span class="bypass-win">' + l.playerIP + '</span>' +
              ' vs <span class="bypass-loss">' + l.aiIP + '</span>' +
              ' (' + l.winner + ')' +
            '</span>';
          }).join('')
        : '\u2014';

      var scoreStr = (s.playerTotal != null && s.aiTotal != null)
        ? 'IP Total: <span class="bypass-win">' + s.playerTotal + '</span>' +
          ' vs <span class="bypass-loss">' + s.aiTotal + '</span>'
        : '';

      var testBadge = s.isTestSession
        ? '<span class="bypass-test-badge">TEST</span>'
        : '';

      return '<div class="bypass-log-entry">' +
        '<div class="bypass-log-top">' +
          '<span class="bypass-log-ts">' + tsStr + '</span>' +
          testBadge +
          '<span class="bypass-log-outcome ' + outcomeClass + '">' + outcome.toUpperCase() + '</span>' +
          '<span class="bypass-log-diff">' + (s.difficulty || '\u2014') + '</span>' +
        '</div>' +
        '<div class="bypass-log-detail">Turns: ' + durStr + '</div>' +
        '<div class="bypass-log-detail bypass-log-locs">' + locStr + '</div>' +
        (scoreStr ? '<div class="bypass-log-detail">' + scoreStr + '</div>' : '') +
      '</div>';
    }).join('');
  }

  /* ── Export CSV ── */
  function exportCSV() {
    var exportBtn = document.getElementById('bypass-export');
    var q = buildQuery(50);
    if (!q) { showBypassToast('Firebase not available'); return; }

    if (exportBtn) exportBtn.textContent = 'LOADING\u2026';

    q.get().then(function (snap) {
      var header = [
        'timestamp','outcome','difficulty','completed','turns',
        'avgTurnSec','playerTotal','aiTotal',
        'loc1','loc1_player','loc1_ai','loc1_winner',
        'loc2','loc2_player','loc2_ai','loc2_winner',
        'loc3','loc3_player','loc3_ai','loc3_winner',
        'isTestSession'
      ];

      var rows = [header];
      snap.docs.forEach(function (doc) {
        var s    = doc.data();
        var ts   = s.timestamp ? new Date(s.timestamp.seconds * 1000).toISOString() : '';
        var durs = Array.isArray(s.turnDurations) ? s.turnDurations : [];
        var avg  = durs.length
          ? Math.round(durs.reduce(function (a, b) { return a + b; }, 0) / durs.length)
          : '';
        var locs = Array.isArray(s.locationScores) ? s.locationScores : [];
        var lc   = [0, 1, 2].map(function (i) {
          var l = locs[i];
          return l ? [l.location, l.playerIP, l.aiIP, l.winner] : ['', '', '', ''];
        });

        rows.push([
          ts,
          s.outcome   || '',
          s.difficulty || '',
          s.completed  ? 'true' : 'false',
          durs.length,
          avg,
          s.playerTotal != null ? s.playerTotal : '',
          s.aiTotal     != null ? s.aiTotal     : '',
          lc[0][0], lc[0][1], lc[0][2], lc[0][3],
          lc[1][0], lc[1][1], lc[1][2], lc[1][3],
          lc[2][0], lc[2][1], lc[2][2], lc[2][3],
          s.isTestSession ? 'true' : 'false'
        ]);
      });

      var csv = rows.map(function (r) {
        return r.map(function (cell) {
          var v = String(cell == null ? '' : cell);
          return (v.indexOf(',') !== -1 || v.indexOf('"') !== -1 || v.indexOf('\n') !== -1)
            ? '"' + v.replace(/"/g, '""') + '"'
            : v;
        }).join(',');
      }).join('\n');

      var count = rows.length - 1;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(csv)
          .then(function () { showBypassToast('CSV copied (' + count + ' sessions) — paste into spreadsheet'); })
          .catch(function () { fallbackCopy(csv, count); });
      } else {
        fallbackCopy(csv, count);
      }
      if (exportBtn) exportBtn.textContent = 'EXPORT CSV';
    }).catch(function (e) {
      showBypassToast('Export error: ' + e.message);
      if (exportBtn) exportBtn.textContent = 'EXPORT CSV';
    });
  }

  function fallbackCopy(text, count) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showBypassToast('CSV copied (' + count + ' sessions)');
    } catch (e) {
      showBypassToast('Copy failed — data logged to console');
      console.log('[BypassMenu] CSV export:\n', text);
    }
    document.body.removeChild(ta);
  }

  /* ══════════════════════════════════════════════════════════════
     Toast notification
  ══════════════════════════════════════════════════════════════ */
  function showBypassToast(msg) {
    var el = document.getElementById('bypass-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('bypass-toast-visible');
    clearTimeout(el._timer);
    el._timer = setTimeout(function () {
      el.classList.remove('bypass-toast-visible');
    }, 3000);
  }

  /* ══════════════════════════════════════════════════════════════
     DOM event binding
  ══════════════════════════════════════════════════════════════ */
  function bindEvents() {
    var backdrop = document.getElementById('bypass-backdrop');
    if (!backdrop) return;

    /* Close on backdrop click (outside dialog) */
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) close();
    });

    /* Escape key */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var bd = document.getElementById('bypass-backdrop');
        if (bd && bd.style.display !== 'none') close();
      }
    });

    /* Header close */
    var closeBtn = document.getElementById('bypass-close');
    if (closeBtn) closeBtn.addEventListener('click', close);

    /* Tutorial controls */
    var skipBtn = document.getElementById('bypass-skip-tut');
    if (skipBtn) skipBtn.addEventListener('click', skipTutorial);

    var resetTutBtn = document.getElementById('bypass-reset-tut');
    if (resetTutBtn) resetTutBtn.addEventListener('click', resetTutorial);

    /* Session controls */
    var testBtn = document.getElementById('bypass-test-toggle');
    if (testBtn) testBtn.addEventListener('click', toggleTestMode);

    var resetAllBtn = document.getElementById('bypass-reset-all');
    if (resetAllBtn) resetAllBtn.addEventListener('click', resetAllData);

    var openLobbyBtn = document.getElementById('bypass-open-lobby');
    if (openLobbyBtn) openLobbyBtn.addEventListener('click', function () {
      close();
      if (window.Multiplayer && typeof window.Multiplayer.showTeacherLobby === 'function') {
        window.Multiplayer.showTeacherLobby();
      }
    });

    var legendBtn = document.getElementById('bypass-play-legend');
    if (legendBtn) legendBtn.addEventListener('click', function () {
      if (window.LegendScreen) {
        close();
        window.LegendScreen.show(function () {});
      }
    });

    /* Progression controls */
    var relBtn = document.getElementById('bypass-play-religious');
    if (relBtn) relBtn.addEventListener('click', function () {
      if (typeof Progression !== 'undefined') {
        close();
        Progression.playCutscene('Religious', function () {
          showScreen('screen-home');
        }, { preview: true });
      }
    });

    var expBtn = document.getElementById('bypass-play-exploration');
    if (expBtn) expBtn.addEventListener('click', function () {
      if (typeof Progression !== 'undefined') {
        close();
        Progression.playCutscene('Exploration', function () {
          showScreen('screen-home');
        }, { preview: true });
      }
    });

    var montageBtn = document.getElementById('bypass-play-montage');
    if (montageBtn) montageBtn.addEventListener('click', function () {
      if (typeof Progression !== 'undefined') {
        close();
        Progression.playMontage(function () {
          showScreen('screen-home');
        }, { preview: true });
      }
    });

    var resetProgBtn = document.getElementById('bypass-reset-progress');
    if (resetProgBtn) resetProgBtn.addEventListener('click', function () {
      localStorage.removeItem('sog_serf_wins');
      localStorage.removeItem('sog_giant_wins');
      localStorage.removeItem('sog_religious_unlocked');
      localStorage.removeItem('sog_exploration_unlocked');
      localStorage.removeItem('sog_religious_cutscene_seen');
      localStorage.removeItem('sog_exploration_cutscene_seen');
      localStorage.removeItem('sog_total_wins');
      localStorage.removeItem('sog_victory_montage_seen');
      window._pendingUnlock = null;
      window._pendingMontage = null;
      showBypassToast('All progression reset — reload to see changes in deck builder');
    });

    /* Location checkboxes */
    document.querySelectorAll('.bypass-loc-check').forEach(function (cb) {
      cb.addEventListener('change', function () {
        onLocCheckChange(cb);
      });
    });

    var clearLocBtn = document.getElementById('bypass-loc-clear');
    if (clearLocBtn) clearLocBtn.addEventListener('click', clearForcedLocations);

    /* Date filter */
    document.querySelectorAll('.bypass-date-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        dateFilter = this.dataset.filter;
        document.querySelectorAll('.bypass-date-btn').forEach(function (b) {
          b.classList.remove('active');
        });
        this.classList.add('active');
        loadStats();
        if (logExpanded) loadFullLog();
      });
    });

    /* Log */
    var logBtn = document.getElementById('bypass-view-log');
    if (logBtn) logBtn.addEventListener('click', function () {
      if (logExpanded) {
        collapseLog();
      } else {
        loadFullLog();
      }
    });

    var logClose = document.getElementById('bypass-log-close');
    if (logClose) logClose.addEventListener('click', collapseLog);

    /* Export */
    var exportBtn = document.getElementById('bypass-export');
    if (exportBtn) exportBtn.addEventListener('click', exportCSV);
  }

  /* ── Bootstrap ───────────────────────────────────────────────── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindEvents);
  } else {
    bindEvents();
  }

  window.BypassMenu = { open: open, close: close };

})();


/* ══════════════════════════════════════════════════════════════════
   BypassAuth — password gate for the teacher bypass menu.
   Shown on triple-click before the bypass menu itself opens.
   Exposes: window.BypassAuth.prompt()
══════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  var CORRECT = 'Swift';
  var _deniedTimer = null;

  /* ── Element shortcuts ─────────────────────────────────────────── */
  function el(id) { return document.getElementById(id); }

  /* ── Show the prompt ───────────────────────────────────────────── */
  function prompt() {
    var backdrop = el('bypass-pw-backdrop');
    var input    = el('bypass-pw-input');
    var msg      = el('bypass-pw-msg');
    if (!backdrop) return;

    /* Reset state */
    clearTimeout(_deniedTimer);
    if (input) { input.value = ''; input.classList.remove('bypass-pw-shake'); }
    if (msg)   { msg.textContent = ''; msg.className = 'bypass-pw-msg'; }

    backdrop.style.display = 'flex';

    /* Auto-focus after the display:flex paint */
    setTimeout(function () { if (input) input.focus(); }, 40);
  }

  /* ── Hide the prompt ───────────────────────────────────────────── */
  function dismissPrompt() {
    var backdrop = el('bypass-pw-backdrop');
    if (backdrop) backdrop.style.display = 'none';
    clearTimeout(_deniedTimer);
  }

  /* ── Submit handler ────────────────────────────────────────────── */
  function submit() {
    var input = el('bypass-pw-input');
    var msg   = el('bypass-pw-msg');
    if (!input) return;

    var value = input.value;

    if (value === CORRECT) {
      dismissPrompt();
      if (window.BypassMenu) window.BypassMenu.open();
    } else {
      /* Wrong password — flash "Access Denied" and auto-close */
      input.value = '';
      if (input.classList) {
        input.classList.remove('bypass-pw-shake');
        /* Force reflow so the animation restarts cleanly */
        void input.offsetWidth;
        input.classList.add('bypass-pw-shake');
      }
      if (msg) {
        msg.textContent = 'Access Denied';
        msg.className   = 'bypass-pw-msg bypass-pw-denied';
      }
      clearTimeout(_deniedTimer);
      _deniedTimer = setTimeout(dismissPrompt, 1500);
    }
  }

  /* ── Bind events once DOM is ready ────────────────────────────── */
  function bindAuth() {
    var backdrop  = el('bypass-pw-backdrop');
    var submitBtn = el('bypass-pw-submit');
    var input     = el('bypass-pw-input');

    if (!backdrop) return;

    /* Close on backdrop click (click outside the box) */
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) dismissPrompt();
    });

    /* Submit button */
    if (submitBtn) submitBtn.addEventListener('click', submit);

    /* Enter key in input */
    if (input) {
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          submit();
        }
        /* Escape closes the prompt */
        if (e.key === 'Escape') dismissPrompt();
      });
    }

    /* Escape key globally (when prompt is open) */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        var bd = el('bypass-pw-backdrop');
        if (bd && bd.style.display !== 'none') dismissPrompt();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindAuth);
  } else {
    bindAuth();
  }

  window.BypassAuth = { prompt: prompt };

})();
