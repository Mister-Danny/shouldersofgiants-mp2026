/**
 * multiplayer.js — Shoulders of Giants · Tournament System
 *
 * Manages all multiplayer and tournament logic via Firebase Realtime Database.
 * Tournaments live at: tournaments/{code}
 * Students live at:    tournaments/{code}/students/{ID}
 *
 * Firebase RTDB must be enabled in the Firebase console for project
 * shoulders-of-giants-db884. Set security rules to allow read/write
 * (refine before production).
 *
 * TTL: Tournaments expire after 14 days. Checked on every load — expired
 * tournaments are removed automatically.
 *
 * Exposes: window.Multiplayer
 *   .createTournament(teacherName, cb)    → creates new tournament, cb(err, code)
 *   .loadTournament(code, cb)             → loads tournament data, cb(err, data)
 *   .joinTournament(code, id, cb)         → student joins by code + 3-letter ID, cb(err, data)
 *   .onTournament(code, cb)               → live listener, calls cb(data) on every change
 *   .offTournament(code)                  → detach live listener
 *   .updateTournament(code, patch, cb)    → merge-update tournament fields, cb(err)
 *   .updateStudent(code, id, patch, cb)   → merge-update a single student record, cb(err)
 *   .removeStudent(code, id, cb)          → remove a student from the lobby, cb(err)
 *   .ready                                → true once RTDB is initialised
 */

(function () {
  'use strict';

  /* ── Constants ───────────────────────────────────────────────── */
  var TTL_MS          = 14 * 24 * 60 * 60 * 1000;   // 14 days in milliseconds
  var DB_URL          = 'https://shoulders-of-giants-db884-default-rtdb.firebaseio.com';
  var TOURNAMENTS_REF = 'tournaments';

  /* ── Module state ────────────────────────────────────────────── */
  var _db           = null;
  var _ready        = false;
  var _listeners    = {};   // code → Firebase listener reference

  /* ── Firebase init ───────────────────────────────────────────── */
  (function initRTDB() {
    try {
      var config = {
        apiKey:            'AIzaSyC1RwlyaNm6vomkc2gSkVkhJxIHpohEddQ',
        authDomain:        'shoulders-of-giants-db884.firebaseapp.com',
        projectId:         'shoulders-of-giants-db884',
        storageBucket:     'shoulders-of-giants-db884.firebasestorage.app',
        messagingSenderId: '580586690652',
        appId:             '1:580586690652:web:ae6376c516a59663412e99',
        databaseURL:       DB_URL
      };

      /* Use a named app 'rtdb' so it doesn't conflict with the default app
         that analytics.js initialises (which has no databaseURL).            */
      var app;
      try {
        app = firebase.app('rtdb');   // already exists (e.g. hot-reload)
      } catch (e) {
        app = firebase.initializeApp(config, 'rtdb');
      }

      _db    = firebase.database(app);
      _ready = true;
    } catch (e) {
      console.warn('[Multiplayer] RTDB init failed:', e.message);
    }
  })();

  /* ── Utility ─────────────────────────────────────────────────── */

  /**
   * Generate a random 5-digit numeric tournament code (10000–99999).
   */
  function _makeCode() {
    return String(Math.floor(10000 + Math.random() * 90000));
  }

  /**
   * Generate a random 3-letter uppercase student ID (e.g. "KTZ").
   */
  function _makeId() {
    var letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';   // no I/O to avoid confusion
    var id = '';
    for (var i = 0; i < 3; i++) {
      id += letters[Math.floor(Math.random() * letters.length)];
    }
    return id;
  }

  /**
   * Return a reference to a tournament node.
   */
  function _ref(code) {
    return _db.ref(TOURNAMENTS_REF + '/' + code);
  }

  /**
   * Return true if a tournament record has expired.
   */
  function _isExpired(data) {
    return data && data.ttl && Date.now() > data.ttl;
  }

  /**
   * Wrap a Firebase promise in an (err, result) callback pattern.
   */
  function _cb(promise, callback) {
    promise.then(function (result) {
      if (callback) callback(null, result);
    }).catch(function (err) {
      if (callback) callback(err, null);
    });
  }

  /* ── Public API ──────────────────────────────────────────────── */

  /**
   * Create a new tournament in RTDB.
   *
   * Picks a random 5-digit code, checks it isn't already taken, then writes
   * the initial tournament document. Retries up to 5 times on collision.
   *
   * @param {string}   teacherName  Display name for the teacher/host
   * @param {Function} cb           cb(err, code) — code is the 5-digit string
   */
  function createTournament(teacherName, cb) {
    if (!_ready) { cb(new Error('RTDB not ready'), null); return; }

    var attempts = 0;

    function tryCreate() {
      attempts++;
      if (attempts > 5) { cb(new Error('Could not generate a unique tournament code. Try again.'), null); return; }

      var code = _makeCode();
      var ref  = _ref(code);

      ref.once('value').then(function (snap) {
        if (snap.exists()) { tryCreate(); return; }   // collision — retry

        var now = Date.now();
        var tournament = {
          code:      code,
          teacher:   teacherName || 'Teacher',
          status:    'lobby',
          createdAt: now,
          ttl:       now + TTL_MS,
          students:  {},
          groups:    {},
          matches:   {},
          bracket:   {}
        };

        return ref.set(tournament).then(function () {
          cb(null, code);
        });
      }).catch(function (err) {
        cb(err, null);
      });
    }

    tryCreate();
  }

  /**
   * Load a tournament by code.
   * If the tournament is expired, it is deleted and an error is returned.
   *
   * @param {string}   code  5-digit tournament code
   * @param {Function} cb    cb(err, data) — data is the tournament object or null
   */
  function loadTournament(code, cb) {
    if (!_ready) { cb(new Error('RTDB not ready'), null); return; }

    _ref(code).once('value').then(function (snap) {
      if (!snap.exists()) {
        cb(new Error('Tournament not found. Check your code and try again.'), null);
        return;
      }
      var data = snap.val();
      if (_isExpired(data)) {
        _ref(code).remove();   // clean up expired tournament
        cb(new Error('This tournament has expired (older than 14 days).'), null);
        return;
      }
      cb(null, data);
    }).catch(function (err) {
      cb(err, null);
    });
  }

  /**
   * Student joins a tournament by entering the code and choosing a 3-letter ID.
   * Returns an error if the ID is already taken or the tournament is not in 'lobby' status.
   *
   * @param {string}   code  5-digit tournament code
   * @param {string}   id    3-letter uppercase ID chosen by the student
   * @param {Function} cb    cb(err, tournamentData)
   */
  function joinTournament(code, id, cb) {
    if (!_ready) { cb(new Error('RTDB not ready'), null); return; }

    id = id.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
    if (id.length !== 3) { cb(new Error('ID must be exactly 3 letters.'), null); return; }

    loadTournament(code, function (err, data) {
      if (err) { cb(err, null); return; }

      if (data.status !== 'lobby') {
        cb(new Error('This tournament has already started.'), null);
        return;
      }

      if (data.students && data.students[id]) {
        cb(new Error('That ID is already taken. Choose a different one.'), null);
        return;
      }

      /* Check for an active boot block */
      _db.ref(TOURNAMENTS_REF + '/' + code + '/blocks/' + id).once('value').then(function (snap) {
        if (snap.exists()) {
          var block     = snap.val();
          var remaining = Math.ceil((block.blockedUntil - Date.now()) / 1000);
          if (remaining > 0) {
            cb(new Error('You were removed from this tournament. Try again in ' +
              remaining + ' second' + (remaining !== 1 ? 's' : '') + '.'), null);
            return;
          }
          /* Block has expired — remove it, then proceed */
          snap.ref.remove().then(function () { _doJoin(code, id, cb); });
          return;
        }
        _doJoin(code, id, cb);
      }).catch(function () {
        /* If block check fails, proceed anyway */
        _doJoin(code, id, cb);
      });
    });
  }

  function _doJoin(code, id, cb) {
    _db.ref(TOURNAMENTS_REF + '/' + code + '/students/' + id).set({
      id:       id,
      joinedAt: Date.now(),
      deck:     null,
      groupId:  null,
      points:   0,
      wins:     0,
      losses:   0,
      draws:    0,
      status:   'active'
    }).then(function () {
      loadTournament(code, cb);
    }).catch(function (err) { cb(err, null); });
  }

  /**
   * Attach a live real-time listener to a tournament.
   * The callback fires immediately with current data, then on every change.
   *
   * @param {string}   code  5-digit tournament code
   * @param {Function} cb    cb(data) — data is the tournament object, or null if deleted
   */
  function onTournament(code, cb) {
    if (!_ready) return;
    offTournament(code);   // detach any existing listener first

    var ref      = _ref(code);
    var handler  = ref.on('value', function (snap) {
      cb(snap.exists() ? snap.val() : null);
    });
    _listeners[code] = { ref: ref, handler: handler };
  }

  /**
   * Detach the live listener for a tournament.
   *
   * @param {string} code  5-digit tournament code
   */
  function offTournament(code) {
    if (_listeners[code]) {
      _listeners[code].ref.off('value', _listeners[code].handler);
      delete _listeners[code];
    }
  }

  /**
   * Merge-update top-level tournament fields (does not overwrite child nodes).
   *
   * @param {string}   code   5-digit tournament code
   * @param {Object}   patch  Fields to update (shallow merge at tournament root)
   * @param {Function} cb     cb(err)
   */
  function updateTournament(code, patch, cb) {
    if (!_ready) { if (cb) cb(new Error('RTDB not ready')); return; }
    _cb(_ref(code).update(patch), cb);
  }

  /**
   * Merge-update a single student record.
   *
   * @param {string}   code   5-digit tournament code
   * @param {string}   id     3-letter student ID
   * @param {Object}   patch  Fields to update on the student record
   * @param {Function} cb     cb(err)
   */
  function updateStudent(code, id, patch, cb) {
    if (!_ready) { if (cb) cb(new Error('RTDB not ready')); return; }
    _cb(_db.ref(TOURNAMENTS_REF + '/' + code + '/students/' + id).update(patch), cb);
  }

  /**
   * Remove a student from the tournament lobby.
   *
   * @param {string}   code  5-digit tournament code
   * @param {string}   id    3-letter student ID
   * @param {Function} cb    cb(err)
   */
  function removeStudent(code, id, cb) {
    if (!_ready) { if (cb) cb(new Error('RTDB not ready')); return; }
    _cb(_db.ref(TOURNAMENTS_REF + '/' + code + '/students/' + id).remove(), cb);
  }

  /* ══════════════════════════════════════════════════════════════
     Teacher Tournament Lobby
  ══════════════════════════════════════════════════════════════ */

  var TEACHER_CODE_KEY = 'sog_teacher_code';
  var GROUP_SIZE       = 4;    // players per group (fixed)
  var _tlobCode        = null;
  var _tlobStudents    = {};   // live snapshot of students in the lobby
  var _tlobGroups      = null; // group assignment currently being previewed
  var _tlobNumGroups   = 8;    // number of groups configured in the panel
  var _bootLog         = {};   // studentId → [bootTimestamp, ...]
  var _tlobToastTimer  = null;
  var _tlobMode        = null;  // 'tournament' | 'quickmatch' | null
  var _tlobLastData    = null;  // most recent full tournament snapshot
  var _tlobQuickMatches = {};   // matchId → { p1, p2, status }
  var _qmSelected      = [];   // up to 2 IDs picked for next QM
  var _tlobRefreshTimer = null; // 30-second forced re-fetch for classroom WiFi resilience

  /**
   * Boot a student from the tournament.
   * Tracks boot timestamps per student in memory.
   * After 3 boots within 2 minutes, writes a 30-second block to Firebase.
   *
   * @param {string}   code       5-digit tournament code
   * @param {string}   studentId  3-letter student ID
   * @param {Function} onDone     called with (err, { blocked: boolean })
   */
  function bootStudent(code, studentId, onDone) {
    var now     = Date.now();
    var TWO_MIN = 2 * 60 * 1000;

    /* Prune old entries, append new timestamp */
    var log = (_bootLog[studentId] || []).filter(function (t) { return now - t < TWO_MIN; });
    log.push(now);
    _bootLog[studentId] = log;

    var willBlock = log.length >= 3;

    /* Remove the student first */
    removeStudent(code, studentId, function (err) {
      if (err) { if (onDone) onDone(err, null); return; }

      if (willBlock) {
        _db.ref(TOURNAMENTS_REF + '/' + code + '/blocks/' + studentId)
          .set({ blockedUntil: now + 30000 })
          .catch(function () {})
          .then(function () {
            if (onDone) onDone(null, { blocked: true });
          });
      } else {
        if (onDone) onDone(null, { blocked: false });
      }
    });
  }

  /* ── Teacher lobby internal helpers ─────────────────────────── */

  function _tlobSetCode(code) {
    var el = document.getElementById('tlob-code-display');
    if (el) el.textContent = code;
  }

  function _tlobFormatTime(ts) {
    var d = new Date(ts);
    return (d.getHours()   < 10 ? '0' : '') + d.getHours()   + ':' +
           (d.getMinutes() < 10 ? '0' : '') + d.getMinutes() + ':' +
           (d.getSeconds() < 10 ? '0' : '') + d.getSeconds();
  }

  function _tlobSetStudents(students) {
    _tlobStudents = students || {};   // keep live snapshot for group assignment

    var list  = document.getElementById('tlob-student-list');
    var count = document.getElementById('tlob-student-count');
    if (!list) return;

    var ids = Object.keys(_tlobStudents);

    /* Enable "Start Group Stage" as soon as there is at least one student */
    var startBtn = document.getElementById('tlob-start');
    if (startBtn) startBtn.disabled = ids.length === 0;
    if (count) count.textContent = ids.length;

    if (ids.length === 0) {
      list.innerHTML = '<div class="tlob-empty">No students yet \u2014 share the code above</div>';
      return;
    }

    /* Sort by joinedAt ascending */
    ids.sort(function (a, b) {
      return (students[a].joinedAt || 0) - (students[b].joinedAt || 0);
    });

    list.innerHTML = '';

    /* Header row */
    var hdr       = document.createElement('div');
    hdr.className = 'tlob-row tlob-row-header';
    hdr.innerHTML =
      '<span class="tlob-col-id">ID</span>' +
      '<span class="tlob-col-time">Joined</span>' +
      '<span class="tlob-col-action"></span>';
    list.appendChild(hdr);

    ids.forEach(function (id) {
      var s   = students[id];
      var row = document.createElement('div');
      row.className   = 'tlob-row';
      row.dataset.sid = id;

      var timeStr    = s.joinedAt ? _tlobFormatTime(s.joinedAt) : '\u2014';
      var statusStr  = '';
      if (s.matchStatus === 'playing') {
        var rnd = s.groupRound || '?';
        statusStr = '<span style="color:var(--snes-green);font-size:12px;">▶R' + rnd + '</span>';
      } else if (s.groupPoints !== undefined) {
        var pts = s.groupPoints || 0;
        statusStr = '<span style="color:var(--snes-cyan);font-size:12px;">' + pts + 'pts</span>';
      }

      row.innerHTML =
        '<span class="tlob-col-id">' + id + (statusStr ? ' ' + statusStr : '') + '</span>' +
        '<span class="tlob-col-time">' + timeStr + '</span>' +
        '<span class="tlob-col-action">' +
          '<button class="btn-snes tlob-boot-btn" data-sid="' + id + '">BOOT</button>' +
        '</span>';

      list.appendChild(row);
    });

    /* Wire boot button clicks */
    list.querySelectorAll('.tlob-boot-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var sid = this.dataset.sid;
        this.disabled    = true;
        this.textContent = 'Booting\u2026';

        /* Peek at boot log to predict whether this will trigger a block */
        var now     = Date.now();
        var TWO_MIN = 2 * 60 * 1000;
        var priorCount = (_bootLog[sid] || []).filter(function (t) { return now - t < TWO_MIN; }).length;
        var willBlock  = priorCount >= 2;  /* this boot makes it 3+ */

        bootStudent(_tlobCode, sid, function (err) {
          if (err) {
            _tlobShowToast('Boot failed: ' + err.message, true);
            return;
          }
          _tlobShowToast(willBlock
            ? 'Booted ' + sid + ' \u2014 blocked for 30s'
            : 'Booted ' + sid);
        });
      });
    });
  }

  /* ── Group assignment helpers ────────────────────────────────── */

  /**
   * Assign studentIds into numGroups groups of GROUP_SIZE each.
   * Remaining slots are filled with BOT1, BOT2, … placeholders.
   * Students are shuffled before assignment.
   */
  function _generateGroups(studentIds, numGroups) {
    var totalSlots = numGroups * GROUP_SIZE;

    /* Fisher-Yates shuffle */
    var members = studentIds.slice();
    for (var i = members.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = members[i]; members[i] = members[j]; members[j] = tmp;
    }

    /* Pad with bots */
    var botIdx = 1;
    while (members.length < totalSlots) { members.push('BOT' + botIdx++); }

    /* Slice into groups */
    var groups = {};
    for (var g = 0; g < numGroups; g++) {
      var gid   = 'G' + (g + 1);
      var start = g * GROUP_SIZE;
      var pts   = {};
      members.slice(start, start + GROUP_SIZE).forEach(function (m) { pts[m] = 0; });
      groups[gid] = {
        id:      gid,
        name:    'Group ' + (g + 1),
        members: members.slice(start, start + GROUP_SIZE),
        points:  pts
      };
    }
    return groups;
  }

  /** Redraw the group card grid and update the config strip values. */
  function _renderGroupsPanel() {
    var studentIds = Object.keys(_tlobStudents);
    var totalSlots = _tlobNumGroups * GROUP_SIZE;
    var botCount   = Math.max(0, totalSlots - studentIds.length);

    var cfgS = document.getElementById('tlob-cfg-students');
    var cfgG = document.getElementById('tlob-cfg-groups');
    var cfgB = document.getElementById('tlob-cfg-bots');
    if (cfgS) cfgS.textContent = studentIds.length;
    if (cfgG) cfgG.textContent = _tlobNumGroups;
    if (cfgB) cfgB.textContent = botCount;

    var grid = document.getElementById('tlob-groups-grid');
    if (!grid || !_tlobGroups) return;
    grid.innerHTML = '';

    Object.keys(_tlobGroups).forEach(function (gid) {
      var group = _tlobGroups[gid];
      var card  = document.createElement('div');
      card.className = 'tlob-group-card';

      var lbl       = document.createElement('div');
      lbl.className = 'tlob-group-label';
      lbl.textContent = group.name;
      card.appendChild(lbl);

      group.members.forEach(function (m) {
        var row       = document.createElement('div');
        var isBot     = m.indexOf('BOT') === 0;
        row.className = 'tlob-group-member' + (isBot ? ' is-bot' : '');
        row.textContent = isBot ? ('~ ' + m) : m;
        card.appendChild(row);
      });

      grid.appendChild(card);
    });
  }

  /** Switch the teacher lobby from the student-list view to the groups panel. */
  function _showGroupsView() {
    var studentIds = Object.keys(_tlobStudents);
    /* Minimum groups = at least enough to seat everyone; never below 1 */
    _tlobNumGroups = Math.max(8, Math.ceil(studentIds.length / GROUP_SIZE));
    _tlobGroups    = _generateGroups(studentIds, _tlobNumGroups);

    document.querySelector('.teacher-lobby-body').style.display  = 'none';
    document.getElementById('tlob-groups-panel').style.display   = 'flex';
    _renderGroupsPanel();
  }

  /** Return from groups panel back to the student-list view. */
  function _hideGroupsView() {
    document.getElementById('tlob-groups-panel').style.display  = 'none';
    document.querySelector('.teacher-lobby-body').style.display  = 'flex';
  }

  /**
   * Commit the current group assignment to Firebase and lock the lobby.
   * Sets tournament status → 'group_stage'; students in the waiting room
   * detect the change via their onTournament listener (Part 5 handles navigation).
   */
  function _confirmAndStart() {
    if (!_tlobCode || !_tlobGroups) return;

    var btn = document.getElementById('tlob-confirm-start');
    if (btn) { btn.disabled = true; btn.textContent = 'Starting\u2026'; }

    var updates = {};
    updates[TOURNAMENTS_REF + '/' + _tlobCode + '/groups']    = _tlobGroups;
    updates[TOURNAMENTS_REF + '/' + _tlobCode + '/status']    = 'group_stage';
    updates[TOURNAMENTS_REF + '/' + _tlobCode + '/startedAt'] = Date.now();

    _db.ref().update(updates).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = '\u2713 Confirm & Start'; }
      _tlobShowToast('Group stage started! ' + _tlobNumGroups + ' groups of ' + GROUP_SIZE);
      _hideGroupsView();
    }).catch(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = '\u2713 Confirm & Start'; }
      _tlobShowToast('Failed to start: ' + err.message, true);
    });
  }

  /**
   * Restore teacher lobby UI to the correct phase state after loading a tournament.
   * Called once on resume/load — not on every listener update.
   */
  function _tlobRestorePhaseUI(data) {
    /* Phase 2 action strip (Advance to Knockout button) */
    var phase2 = document.getElementById('tlob-phase2-actions');
    if (phase2) phase2.style.display = (data.status === 'group_stage') ? '' : 'none';

    /* If tournament is already in knockout/complete, open the KO panel directly */
    if (data.status === 'knockout' || data.status === 'complete') {
      /* Ensure any other panels are hidden */
      var bodyEl = document.querySelector('.teacher-lobby-body');
      if (bodyEl) bodyEl.style.display = 'none';
      var koPanel = document.getElementById('tlob-ko-panel');
      if (koPanel) {
        koPanel.style.display = 'flex';
        _renderKOBracket(data);
        var statusMsg = document.getElementById('tlob-ko-status-msg');
        if (statusMsg) statusMsg.textContent =
          data.status === 'complete'
            ? '\u2605 Champion: ' + ((data.bracket && data.bracket.champion) || '?')
            : 'Knockout in progress';
        var confirmBtn = document.getElementById('tlob-ko-confirm');
        if (confirmBtn) confirmBtn.style.display = 'none';
      }
    }
  }

  function _tlobApplySnapshot(data) {
    if (!data) return;
    _tlobLastData = data;
    _tlobSetStudents(data.students || {});

    _tlobQuickMatches = data.quickMatches || {};
    if (_tlobMode === 'quickmatch') _renderQMPanel();

    var phase2 = document.getElementById('tlob-phase2-actions');
    if (phase2) {
      phase2.style.display = (data.status === 'group_stage') ? '' : 'none';
    }

    var koPanel = document.getElementById('tlob-ko-panel');
    if (koPanel && koPanel.style.display !== 'none') {
      if (data.status === 'knockout' || data.status === 'complete') {
        _renderKOBracket(data);
        var statusMsg = document.getElementById('tlob-ko-status-msg');
        if (statusMsg) statusMsg.textContent =
          data.status === 'complete'
            ? '\u2605 Champion: ' + ((data.bracket && data.bracket.champion) || '?')
            : 'Knockout in progress';
      }
    }
  }

  function _tlobStopRefresh() {
    if (_tlobRefreshTimer) { clearInterval(_tlobRefreshTimer); _tlobRefreshTimer = null; }
  }

  function _tlobStartListener() {
    if (!_tlobCode) return;

    /* Live listener — fires on every Firebase change */
    onTournament(_tlobCode, _tlobApplySnapshot);

    /* 30-second forced re-fetch — resilience for spotty classroom WiFi */
    _tlobStopRefresh();
    _tlobRefreshTimer = setInterval(function () {
      if (!_tlobCode || !_db) return;
      _db.ref(TOURNAMENTS_REF + '/' + _tlobCode).once('value').then(function (snap) {
        _tlobApplySnapshot(snap.val());
      }).catch(function () {});
    }, 30000);
  }

  /* ── Mode selection panel ────────────────────────────────────── */

  function _showModePanel() {
    document.querySelector('.teacher-lobby-body').style.display = 'none';
    document.getElementById('tlob-groups-panel').style.display  = 'none';
    document.getElementById('tlob-mode-panel').style.display    = 'flex';
  }

  function _hideModePanel() {
    document.getElementById('tlob-mode-panel').style.display    = 'none';
    document.querySelector('.teacher-lobby-body').style.display = 'flex';
  }

  /* ── Quick Match panel ───────────────────────────────────────── */

  function _showQMPanel() {
    document.getElementById('tlob-mode-panel').style.display = 'none';
    _qmSelected = [];
    _renderQMPanel();
    document.getElementById('tlob-qm-panel').style.display = 'flex';
  }

  function _hideQMPanel() {
    document.getElementById('tlob-qm-panel').style.display  = 'none';
    document.getElementById('tlob-mode-panel').style.display = 'flex';
  }

  /** Rebuild the QM chip list, pair display, and active matches list. */
  function _renderQMPanel() {
    var available = document.getElementById('tlob-qm-available');
    var p1El      = document.getElementById('tlob-qm-p1');
    var p2El      = document.getElementById('tlob-qm-p2');
    var startBtn  = document.getElementById('tlob-qm-start');
    var activeSection = document.getElementById('tlob-qm-active-section');
    var activeList    = document.getElementById('tlob-qm-active-list');
    if (!available) return;

    /* Which students are currently in an active match? */
    var inMatch = {};
    Object.keys(_tlobQuickMatches).forEach(function (mid) {
      var m = _tlobQuickMatches[mid];
      if (m.status === 'pending' || m.status === 'in_progress') {
        inMatch[m.p1] = mid;
        inMatch[m.p2] = mid;
      }
    });

    /* Rebuild chip list */
    available.innerHTML = '';
    var ids = Object.keys(_tlobStudents);
    if (!ids.length) {
      available.innerHTML = '<span style="color:var(--text-muted);font-size:14px;">No students in lobby yet.</span>';
    } else {
      ids.forEach(function (id) {
        var chip = document.createElement('button');
        chip.className = 'tlob-qm-chip';
        chip.textContent = id;
        chip.dataset.sid = id;
        if (inMatch[id]) {
          chip.classList.add('in-match');
          chip.disabled = true;
        } else if (_qmSelected.indexOf(id) !== -1) {
          chip.classList.add('selected');
        }
        chip.addEventListener('click', function () {
          if (inMatch[id]) return;
          var idx = _qmSelected.indexOf(id);
          if (idx !== -1) {
            _qmSelected.splice(idx, 1);
          } else if (_qmSelected.length < 2) {
            _qmSelected.push(id);
          }
          _renderQMPanel();
        });
        available.appendChild(chip);
      });
    }

    /* Pair display */
    if (p1El) {
      p1El.textContent = _qmSelected[0] || '?';
      p1El.classList.toggle('tlob-qm-empty', !_qmSelected[0]);
    }
    if (p2El) {
      p2El.textContent = _qmSelected[1] || '?';
      p2El.classList.toggle('tlob-qm-empty', !_qmSelected[1]);
    }
    if (startBtn) startBtn.disabled = _qmSelected.length !== 2;

    /* Active matches */
    var activeKeys = Object.keys(_tlobQuickMatches).filter(function (mid) {
      var m = _tlobQuickMatches[mid];
      return m.status === 'pending' || m.status === 'in_progress';
    });
    if (activeKeys.length && activeSection && activeList) {
      activeSection.style.display = '';
      activeList.innerHTML = '';
      activeKeys.forEach(function (mid) {
        var m   = _tlobQuickMatches[mid];
        var row = document.createElement('div');
        row.className = 'tlob-qm-match-row';
        row.innerHTML =
          '<span class="match-players">' + m.p1 + ' vs ' + m.p2 + '</span>' +
          '<span class="match-status">' + (m.status === 'in_progress' ? '▶ In Progress' : '⏳ Starting') + '</span>';
        activeList.appendChild(row);
      });
    } else if (activeSection) {
      activeSection.style.display = 'none';
    }
  }

  /**
   * Write a Quick Match record to Firebase and notify both students.
   */
  function _startQuickMatch(p1, p2) {
    var matchId = 'qm_' + Date.now() + '_' + Math.floor(Math.random() * 9000 + 1000);
    var updates = {};
    var base    = TOURNAMENTS_REF + '/' + _tlobCode;

    updates[base + '/quickMatches/' + matchId] = {
      p1:        p1,
      p2:        p2,
      status:    'pending',
      createdAt: Date.now()
    };
    updates[base + '/students/' + p1 + '/matchStatus']  = 'pending';
    updates[base + '/students/' + p1 + '/matchId']      = matchId;
    updates[base + '/students/' + p1 + '/opponentId']   = p2;
    updates[base + '/students/' + p2 + '/matchStatus']  = 'pending';
    updates[base + '/students/' + p2 + '/matchId']      = matchId;
    updates[base + '/students/' + p2 + '/opponentId']   = p1;

    var btn = document.getElementById('tlob-qm-start');
    if (btn) { btn.disabled = true; btn.textContent = 'Starting\u2026'; }

    _db.ref().update(updates).then(function () {
      _qmSelected = [];
      if (btn) { btn.textContent = '\u25b6 Start Match'; }
      _tlobShowToast('Match started: ' + p1 + ' vs ' + p2);
      _renderQMPanel();
    }).catch(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = '\u25b6 Start Match'; }
      _tlobShowToast('Failed to start match: ' + err.message, true);
    });
  }

  function _tlobShowToast(msg, isError) {
    var el = document.getElementById('tlob-toast');
    if (!el) return;
    el.textContent = msg;
    el.className   = 'tlob-toast' + (isError ? ' tlob-toast-error' : '') + ' visible';
    clearTimeout(_tlobToastTimer);
    _tlobToastTimer = setTimeout(function () {
      el.classList.remove('visible');
    }, 3200);
  }

  function _tlobCreateNew() {
    _tlobSetCode('Creating\u2026');
    createTournament('Teacher', function (err, code) {
      if (err) {
        _tlobSetCode('Error');
        _tlobShowToast('Could not create tournament: ' + err.message, true);
        return;
      }
      _tlobCode = code;
      localStorage.setItem(TEACHER_CODE_KEY, code);
      _tlobSetCode(code);
      _tlobSetStudents({});
      _tlobStartListener();
      _tlobShowToast('New tournament created: ' + code);
    });
  }

  /**
   * Open the teacher tournament lobby overlay.
   * Resumes the saved tournament if one exists; otherwise creates a new one.
   */
  function showTeacherLobby() {
    if (!_ready) {
      /* Show backdrop with error message rather than silently failing */
      var backdrop = document.getElementById('teacher-lobby-backdrop');
      if (backdrop) {
        backdrop.style.display = 'flex';
        _tlobSetCode('Offline');
        _tlobShowToast('Firebase not connected \u2014 check your internet', true);
      }
      return;
    }

    var backdrop = document.getElementById('teacher-lobby-backdrop');
    if (!backdrop) return;

    backdrop.style.display = 'flex';

    /* Close any open load modal */
    var loadModal = document.getElementById('tlob-load-modal');
    if (loadModal) loadModal.style.display = 'none';

    var savedCode = localStorage.getItem(TEACHER_CODE_KEY);

    if (savedCode) {
      _tlobSetCode(savedCode + '\u2026');
      loadTournament(savedCode, function (err, data) {
        if (err) {
          /* Saved tournament expired or not found — create a fresh one */
          _tlobShowToast('Previous tournament expired \u2014 creating new one');
          _tlobCode = null;
          offTournament(savedCode);
          _tlobCreateNew();
          return;
        }
        /* Resume saved tournament */
        if (_tlobCode && _tlobCode !== savedCode) offTournament(_tlobCode);
        _tlobCode     = savedCode;
        _tlobLastData = data;
        _tlobSetCode(savedCode);
        _tlobSetStudents(data.students || {});
        _tlobRestorePhaseUI(data);
        _tlobStartListener();
      });
    } else {
      _tlobCreateNew();
    }
  }

  /* ── Wire up teacher lobby UI events (runs once at script load) ─ */
  (function _initTeacherLobbyEvents() {
    var backdrop = document.getElementById('teacher-lobby-backdrop');
    if (!backdrop) return;

    /* Close button */
    document.getElementById('tlob-close').addEventListener('click', function () {
      offTournament(_tlobCode);
      _tlobStopRefresh();
      backdrop.style.display = 'none';
    });

    /* Click outside dialog to close */
    backdrop.addEventListener('click', function (e) {
      if (e.target === backdrop) {
        offTournament(_tlobCode);
        _tlobStopRefresh();
        backdrop.style.display = 'none';
      }
    });

    /* + New: create a brand-new tournament */
    document.getElementById('tlob-new').addEventListener('click', function () {
      if (!confirm('Create a new tournament? Students in the current lobby will need to rejoin with a new code.')) return;
      offTournament(_tlobCode);
      _tlobCode = null;
      _bootLog  = {};
      _tlobSetStudents({});
      _tlobCreateNew();
    });

    /* Save: write current code to localStorage */
    document.getElementById('tlob-save').addEventListener('click', function () {
      if (!_tlobCode || _tlobCode === 'Creating\u2026' || _tlobCode === '\u2014') return;
      localStorage.setItem(TEACHER_CODE_KEY, _tlobCode);
      _tlobShowToast('Saved! Tournament code: ' + _tlobCode);
    });

    /* Load code modal */
    var loadModal   = document.getElementById('tlob-load-modal');
    var loadInput   = document.getElementById('tlob-load-input');
    var loadError   = document.getElementById('tlob-load-error');
    var loadConfirm = document.getElementById('tlob-load-confirm');
    var loadCancel  = document.getElementById('tlob-load-cancel');

    document.getElementById('tlob-load').addEventListener('click', function () {
      loadInput.value         = '';
      loadError.textContent   = '';
      loadConfirm.disabled    = false;
      loadConfirm.textContent = 'Load';
      loadModal.style.display = 'flex';
      setTimeout(function () { loadInput.focus(); }, 50);
    });

    loadCancel.addEventListener('click', function () {
      loadModal.style.display = 'none';
    });

    loadInput.addEventListener('input', function () {
      this.value = this.value.replace(/[^\d]/g, '');
    });

    loadInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') loadConfirm.click();
      if (e.key === 'Escape') loadCancel.click();
    });

    loadConfirm.addEventListener('click', function () {
      var code = loadInput.value.trim();
      if (!/^\d{5}$/.test(code)) {
        loadError.textContent = 'Enter a valid 5-digit code.';
        return;
      }

      loadConfirm.disabled    = true;
      loadConfirm.textContent = 'Loading\u2026';
      loadError.textContent   = '';

      loadTournament(code, function (err, data) {
        loadConfirm.disabled    = false;
        loadConfirm.textContent = 'Load';

        if (err) {
          loadError.textContent = err.message;
          return;
        }

        offTournament(_tlobCode);
        _tlobCode     = code;
        _tlobLastData = data;
        localStorage.setItem(TEACHER_CODE_KEY, code);
        loadModal.style.display = 'none';
        _tlobSetCode(code);
        _tlobSetStudents(data.students || {});
        _tlobRestorePhaseUI(data);
        _tlobStartListener();
        _tlobShowToast('Loaded tournament: ' + code);
      });
    });

    /* Start → opens mode selection panel */
    document.getElementById('tlob-start').addEventListener('click', _showModePanel);

    /* ── Mode panel events ─── */
    document.getElementById('tlob-mode-back').addEventListener('click', _hideModePanel);

    document.getElementById('tlob-select-tournament').addEventListener('click', function () {
      _tlobMode = 'tournament';
      _hideModePanel();
      _showGroupsView();
    });

    document.getElementById('tlob-select-quickmatch').addEventListener('click', function () {
      _tlobMode = 'quickmatch';
      _showQMPanel();
    });

    /* ── QM panel events ─── */
    document.getElementById('tlob-qm-back').addEventListener('click', _hideQMPanel);

    document.getElementById('tlob-qm-clear').addEventListener('click', function () {
      _qmSelected = [];
      _renderQMPanel();
    });

    document.getElementById('tlob-qm-start').addEventListener('click', function () {
      if (_qmSelected.length === 2) {
        _startQuickMatch(_qmSelected[0], _qmSelected[1]);
      }
    });

    /* ── Group assignment panel events ─── */
    document.getElementById('tlob-groups-back').addEventListener('click', _hideGroupsView);

    document.getElementById('tlob-groups-minus').addEventListener('click', function () {
      var minGroups = Math.max(1, Math.ceil(Object.keys(_tlobStudents).length / GROUP_SIZE));
      if (_tlobNumGroups <= minGroups) return;
      _tlobNumGroups--;
      _tlobGroups = _generateGroups(Object.keys(_tlobStudents), _tlobNumGroups);
      _renderGroupsPanel();
    });

    document.getElementById('tlob-groups-plus').addEventListener('click', function () {
      _tlobNumGroups++;
      _tlobGroups = _generateGroups(Object.keys(_tlobStudents), _tlobNumGroups);
      _renderGroupsPanel();
    });

    document.getElementById('tlob-groups-shuffle').addEventListener('click', function () {
      _tlobGroups = _generateGroups(Object.keys(_tlobStudents), _tlobNumGroups);
      _renderGroupsPanel();
    });

    document.getElementById('tlob-confirm-start').addEventListener('click', _confirmAndStart);

    /* ── Advance to Knockout button ─── */
    document.getElementById('tlob-advance-ko').addEventListener('click', _showKOSetupPanel);

    /* ── KO setup panel events ─── */
    document.getElementById('tlob-ko-back').addEventListener('click', _hideKOSetupPanel);
    document.getElementById('tlob-ko-confirm').addEventListener('click', _confirmStartKnockout);
  })();

  /* ══════════════════════════════════════════════════════════════
     Lobby UI — entry form + waiting room
  ══════════════════════════════════════════════════════════════ */

  var _lobbyCode = null;
  var _lobbyId   = null;

  /* Group stage state */
  var _myGroupId      = null;
  var _myGroupData    = null;   // { id, name, members[], points{} }
  var _myCurrentRound = 0;     // 1-3; 0 = not started

  /* Knockout state */
  var KO_ROUNDS   = ['r16', 'qf', 'sf', 'final'];
  var KO_LABELS   = { r16: 'Round of 16', qf: 'Quarter-Final', sf: 'Semi-Final', final: 'Final' };
  var KO_NEXT     = { r16: 'qf', qf: 'sf', sf: 'final', final: null };
  var _myKORound  = null;   // current knockout round or null

  /* DOM refs (set once on first use) */
  var _lobbyEntryPanel   = null;
  var _lobbyWaitPanel    = null;
  var _lobbyErrorEl      = null;
  var _lobbyCodeInput    = null;
  var _lobbyIdInput      = null;
  var _lobbyJoinBtn      = null;
  var _lobbyStudentCount = null;

  function _lobbyRefs() {
    if (_lobbyEntryPanel) return;
    _lobbyEntryPanel   = document.getElementById('lobby-entry-panel');
    _lobbyWaitPanel    = document.getElementById('lobby-waiting-panel');
    _lobbyErrorEl      = document.getElementById('lobby-error');
    _lobbyCodeInput    = document.getElementById('lobby-code-input');
    _lobbyIdInput      = document.getElementById('lobby-id-input');
    _lobbyJoinBtn      = document.getElementById('lobby-join-btn');
    _lobbyStudentCount = document.getElementById('lobby-student-count');
  }

  function _lobbySetError(msg) {
    _lobbyRefs();
    if (_lobbyErrorEl) _lobbyErrorEl.textContent = msg || '';
  }

  function _lobbyUpdateCount(data) {
    _lobbyRefs();
    if (!_lobbyStudentCount) return;
    var count = data && data.students ? Object.keys(data.students).length : 0;
    _lobbyStudentCount.textContent = count;
  }

  /**
   * Show the lobby entry panel (called from deckbuilder after "Enter Lobby").
   */
  function showLobbyEntry() {
    _lobbyRefs();

    /* Reset to entry state */
    _lobbyEntryPanel.style.display  = 'flex';
    _lobbyWaitPanel.style.display   = 'none';
    _lobbyErrorEl.textContent       = '';
    _lobbyCodeInput.value           = '';
    _lobbyIdInput.value             = _makeId();
    _lobbyJoinBtn.disabled          = false;
    _lobbyJoinBtn.textContent       = 'JOIN';

    showScreen('screen-lobby');
  }

  /* ═══════════════════════════════════════════════════════════════
     GROUP STAGE — student-side panel
  ══════════════════════════════════════════════════════════════ */

  /**
   * Compute round-robin opponents for this student within their group.
   * Returns array of 3 strings (opponent IDs), one per round.
   * Uses circular offset so each pair meets exactly once.
   */
  function _computeOpponents(members, myId) {
    var others = members.filter(function (m) { return m !== myId; });
    /* others has 3 entries for a group of 4 — round N → others[N-1] */
    return others;
  }

  /**
   * Show the group stage panel, hiding all other lobby panels.
   * Called from _handleLobbyUpdate when status === 'group_stage'.
   */
  function _showGroupPanel(tournamentData) {
    _lobbyRefs();

    /* Find this student's group */
    var groups = tournamentData.groups || {};
    var myGroup = null;
    var foundGroupId = null;
    Object.keys(groups).forEach(function (gid) {
      var g = groups[gid];
      if (g.members && g.members.indexOf(_lobbyId) !== -1) {
        myGroup      = g;
        foundGroupId = gid;
      }
    });

    if (!myGroup) return; /* student not assigned to a group (shouldn't happen) */

    _myGroupId   = foundGroupId;
    _myGroupData = myGroup;

    /* Read round progress from this student's Firebase record */
    var myRecord = tournamentData.students && tournamentData.students[_lobbyId];
    if (myRecord && myRecord.groupRound) {
      _myCurrentRound = myRecord.groupRound;
    } else if (_myCurrentRound === 0) {
      _myCurrentRound = 0;
    }

    /* Hide other panels, show group panel */
    _lobbyEntryPanel.style.display = 'none';
    _lobbyWaitPanel.style.display  = 'none';
    var groupPanel = document.getElementById('lobby-group-panel');
    if (groupPanel) groupPanel.style.display = 'flex';

    _renderGroupPanel(tournamentData);
  }

  /**
   * Rebuild the group standings table and round schedule from latest data.
   */
  function _renderGroupPanel(tournamentData) {
    if (!_myGroupData) return;

    var members = _myGroupData.members || [];

    /* Title */
    var titleEl = document.getElementById('lobby-group-title');
    if (titleEl) titleEl.textContent = _myGroupData.name || ('Group ' + _myGroupId);

    /* ── Standings table ── */
    var tbody = document.getElementById('lobby-group-standings-body');
    if (tbody) {
      tbody.innerHTML = '';

      /* Pull per-member results from tournament data */
      var allStudents = (tournamentData && tournamentData.students) || {};

      /* Build display rows */
      var rows = members.map(function (memberId) {
        var isBot  = memberId.indexOf('BOT') === 0;
        var rec    = allStudents[memberId] || {};
        var rr     = rec.roundResults || {};
        var wins   = 0, draws = 0, losses = 0, pts = 0;
        [1, 2, 3].forEach(function (r) {
          var res = rr[r];
          if (res === 'win')  { wins++;   pts += 3; }
          if (res === 'draw') { draws++;  pts += 1; }
          if (res === 'loss') { losses++; }
        });
        return { id: memberId, isBot: isBot, wins: wins, draws: draws, losses: losses, pts: pts };
      });

      /* Sort by pts desc */
      rows.sort(function (a, b) { return b.pts - a.pts; });

      rows.forEach(function (row) {
        var tr = document.createElement('tr');
        if (row.id === _lobbyId) tr.className = 'gs-me';

        var tdId  = document.createElement('td');
        tdId.className = 'gs-col-id' + (row.isBot ? ' gs-col-bot' : '');
        tdId.textContent = row.id === _lobbyId ? row.id + ' (you)' : row.id;

        var tdWDL = document.createElement('td');
        tdWDL.className = 'gs-col-wdl';
        tdWDL.textContent = row.wins + '\u2013' + row.draws + '\u2013' + row.losses;

        var tdPts = document.createElement('td');
        tdPts.className = 'gs-col-pts';
        tdPts.textContent = row.pts;

        tr.appendChild(tdId);
        tr.appendChild(tdWDL);
        tr.appendChild(tdPts);
        tbody.appendChild(tr);
      });
    }

    /* ── Round schedule ── */
    var roundList = document.getElementById('lobby-round-list');
    if (!roundList) return;
    roundList.innerHTML = '';

    var opponents = _computeOpponents(members, _lobbyId);
    var myRecord  = (tournamentData && tournamentData.students && tournamentData.students[_lobbyId]) || {};
    var rr        = myRecord.roundResults || {};

    opponents.forEach(function (oppId, idx) {
      var round   = idx + 1;
      var result  = rr[round];
      var isBot   = oppId.indexOf('BOT') === 0;

      var rowEl = document.createElement('div');
      rowEl.className = 'lobby-round-row';

      var lbl = document.createElement('div');
      lbl.className   = 'lobby-round-label';
      lbl.textContent = 'Round ' + round;

      var opp = document.createElement('div');
      opp.className   = 'lobby-round-opp' + (isBot ? ' is-bot' : '');
      opp.textContent = 'vs ' + oppId;

      var action = document.createElement('div');
      action.className = 'lobby-round-action';

      if (result) {
        /* Already played — show result badge */
        var badge = document.createElement('div');
        badge.className   = 'lobby-round-result ' + result;
        badge.textContent = result === 'win' ? '✓ WIN'
                          : result === 'draw' ? '= DRAW'
                          : '✕ LOSS';
        action.appendChild(badge);
      } else if (window.matchId && window.currentGroupRound === round) {
        /* Currently waiting for this opponent — show spinner inline */
        var waitWrap = document.createElement('div');
        waitWrap.className = 'lobby-round-waiting';
        var waitSpinner = document.createElement('div');
        waitSpinner.className = 'lobby-round-spinner';
        var waitMsg = document.createElement('span');
        waitMsg.className   = 'lobby-round-wait-msg';
        waitMsg.textContent = 'Waiting for ' + oppId + '\u2026';
        waitWrap.appendChild(waitSpinner);
        waitWrap.appendChild(waitMsg);
        action.appendChild(waitWrap);
      } else {
        /* Not yet played */
        var btn = document.createElement('button');
        btn.className = 'lobby-round-btn btn-snes';

        var prevDone = round === 1 || rr[round - 1];
        btn.disabled    = !prevDone;
        btn.textContent = prevDone ? '▶ Play' : 'Locked';

        btn.addEventListener('click', (function (r, oId) {
          return function () { _startGroupRound(r, oId); };
        }(round, oppId)));
        action.appendChild(btn);
      }

      rowEl.appendChild(lbl);
      rowEl.appendChild(opp);
      rowEl.appendChild(action);
      roundList.appendChild(rowEl);
    });
  }

  /**
   * Navigate to battle for a specific group round.
   * For non-BOT opponents with Match module available: attempts a live 2P match.
   * Falls back to AI if the opponent doesn't connect within 30 s.
   */
  function _startGroupRound(round, opponentId) {
    _myCurrentRound = round;
    window.tournamentMatch   = 'group';
    window.currentLobbyCode  = _lobbyCode;
    window.currentLobbyId    = _lobbyId;
    window.currentGroupRound = round;
    window.currentGroupOpp   = opponentId;
    window.aiDifficulty      = 'easy';

    /* Mark student as playing in Firebase */
    var updates = {};
    updates[TOURNAMENTS_REF + '/' + _lobbyCode + '/students/' + _lobbyId + '/groupRound'] = round;
    updates[TOURNAMENTS_REF + '/' + _lobbyCode + '/students/' + _lobbyId + '/matchStatus'] = 'playing';
    _db.ref().update(updates).catch(function () {});

    var isBot = !opponentId || opponentId.indexOf('BOT') === 0;

    /* ── True 2P: Match.init for real-student opponents ──────── */
    if (!isBot && typeof Match !== 'undefined') {
      /* Deterministic match ID — both players derive the same key */
      var matchId = _lobbyCode + '_g' + (_myGroupId || 'x') + '_r' + round;
      /* Lexicographically smaller ID becomes P1 (picks locations) */
      var myRole  = (_lobbyId < opponentId) ? 'p1' : 'p2';
      var deckIds = [];
      try {
        deckIds = (window.Decks && window.Decks.getActiveCards()) || [];
      } catch (e) {}

      /* Show waiting row — opponent is also expected to click Play */
      _setGroupRoundWaiting(round, opponentId, true);

      window.matchId = matchId;
      window.p1OrP2  = myRole;

      Match.init(matchId, myRole, _lobbyCode, _lobbyId, opponentId, deckIds, function () {
        /* onBothReady or timeout — window.matchId is null on timeout (AI fallback) */
        _setGroupRoundWaiting(round, opponentId, false);
        if (typeof showScreen === 'function') showScreen('screen-battle');
        if (typeof initGame   === 'function') initGame();
      });
      return;
    }

    /* ── AI fallback: BOT opponent or no Match module ─────────── */
    if (typeof showScreen === 'function') showScreen('screen-battle');
    if (typeof initGame   === 'function') initGame();
  }

  /**
   * Toggle the "waiting for opponent" state on a round row.
   * @param {number}  round
   * @param {string}  opponentId
   * @param {boolean} isWaiting  true = show spinner + Cancel; false = restore Play button
   */
  function _setGroupRoundWaiting(round, opponentId, isWaiting) {
    var roundList = document.getElementById('lobby-round-list');
    if (!roundList) return;
    var rows   = roundList.querySelectorAll('.lobby-round-row');
    var rowEl  = rows[round - 1];
    if (!rowEl) return;
    var action = rowEl.querySelector('.lobby-round-action');
    if (!action) return;
    action.innerHTML = '';

    if (isWaiting) {
      var wrap = document.createElement('div');
      wrap.className = 'lobby-round-waiting';

      var spinner = document.createElement('div');
      spinner.className = 'lobby-round-spinner';

      var msg = document.createElement('span');
      msg.className   = 'lobby-round-wait-msg';
      msg.textContent = 'Waiting for ' + opponentId + '\u2026';

      var cancelBtn = document.createElement('button');
      cancelBtn.className   = 'lobby-round-btn btn-snes';
      cancelBtn.style.marginLeft = '8px';
      cancelBtn.style.padding    = '2px 8px';
      cancelBtn.style.fontSize   = '11px';
      cancelBtn.textContent = 'Cancel';
      cancelBtn.addEventListener('click', function () {
        if (typeof Match !== 'undefined') Match.reset();
        window.matchId = null;
        window.p1OrP2  = null;
        if (_db && _lobbyCode && _lobbyId) {
          var upd = {};
          upd[TOURNAMENTS_REF + '/' + _lobbyCode + '/students/' + _lobbyId + '/matchStatus'] = 'waiting';
          _db.ref().update(upd).catch(function () {});
        }
        _setGroupRoundWaiting(round, opponentId, false);
      });

      wrap.appendChild(spinner);
      wrap.appendChild(msg);
      wrap.appendChild(cancelBtn);
      action.appendChild(wrap);
    } else {
      /* Restore Play button */
      var btn = document.createElement('button');
      btn.className   = 'lobby-round-btn btn-snes';
      btn.textContent = '▶ Play';
      btn.addEventListener('click', function () { _startGroupRound(round, opponentId); });
      action.appendChild(btn);
    }
  }

  /**
   * Called by game.js showResult after a tournament group match.
   * Writes result to Firebase and refreshes the group panel.
   */
  function recordGroupResult(outcome) {
    if (!_lobbyCode || !_lobbyId || !_myCurrentRound) return;

    var pts = outcome === 'win' ? 3 : outcome === 'draw' ? 1 : 0;
    var updates = {};
    var base    = TOURNAMENTS_REF + '/' + _lobbyCode + '/students/' + _lobbyId;
    updates[base + '/roundResults/' + _myCurrentRound] = outcome;
    updates[base + '/matchStatus']                     = 'waiting';

    /* Accumulate group points */
    _db.ref(base + '/groupPoints').once('value').then(function (snap) {
      var current = snap.val() || 0;
      updates[base + '/groupPoints'] = current + pts;
      return _db.ref().update(updates);
    }).catch(function () {
      _db.ref().update(updates).catch(function () {});
    });
  }

  /* ═══════════════════════════════════════════════════════════════
     KNOCKOUT STAGE — student-side panel
  ══════════════════════════════════════════════════════════════ */

  /** Hide all lobby panels, show the knockout panel. */
  function _showKnockoutPanel(tournamentData) {
    _lobbyRefs();
    _lobbyEntryPanel.style.display = 'none';
    _lobbyWaitPanel.style.display  = 'none';
    var gp = document.getElementById('lobby-group-panel');
    if (gp) gp.style.display = 'none';
    var kp = document.getElementById('lobby-knockout-panel');
    if (kp) kp.style.display = 'flex';

    /* Determine this student's knockout status */
    var myRec = tournamentData.students && tournamentData.students[_lobbyId];
    _myKORound = (myRec && myRec.knockoutStatus) || null;

    _renderKnockoutPanel(tournamentData);
  }

  /** Rebuild the knockout ladder for this student. */
  function _renderKnockoutPanel(tournamentData) {
    var myRec    = (tournamentData.students && tournamentData.students[_lobbyId]) || {};
    var koStatus = myRec.knockoutStatus || null;
    var koResults = myRec.knockoutResults || {};
    var bracket   = tournamentData.bracket || {};
    var bracketParts = bracket.participants || {};

    /* Banner */
    var bannerEl = document.getElementById('lobby-ko-banner');
    if (bannerEl) {
      if (koStatus === 'champion') {
        bannerEl.style.display = '';
        bannerEl.className     = 'lobby-ko-banner champion';
        bannerEl.textContent   = '\u2605 CHAMPION! \u2605';
      } else if (koStatus === 'eliminated') {
        bannerEl.style.display = '';
        bannerEl.className     = 'lobby-ko-banner eliminated';
        bannerEl.textContent   = 'Eliminated — thanks for playing!';
      } else if (koStatus) {
        bannerEl.style.display = '';
        bannerEl.className     = 'lobby-ko-banner advanced';
        bannerEl.textContent   = '\u2713 You advanced! Playing: ' + (KO_LABELS[koStatus] || koStatus);
      } else {
        bannerEl.style.display = 'none';
      }
    }

    /* Ladder */
    var ladderEl = document.getElementById('lobby-ko-ladder');
    if (!ladderEl) return;
    ladderEl.innerHTML = '';

    KO_ROUNDS.forEach(function (round) {
      var isEliminated = koStatus === 'eliminated';
      var participants = bracketParts[round] || [];
      var inThisRound  = participants.indexOf(_lobbyId) !== -1;
      var result       = koResults[round];

      if (!inThisRound && round !== koStatus) return; /* skip rounds not relevant yet */

      var isActive = koStatus === round && !result;
      var row = document.createElement('div');
      row.className = 'lobby-ko-row' + (isActive ? ' active' : '');

      var lbl  = document.createElement('div');
      lbl.className   = 'lobby-ko-row-label' + (isActive ? ' active-lbl' : '');
      lbl.textContent = KO_LABELS[round] || round;

      var info = document.createElement('div');
      info.className = 'lobby-ko-row-info';

      if (result) {
        info.className  += result === 'win' ? ' eligible' : '';
        var badge = document.createElement('span');
        badge.className = 'lobby-round-result ' + result;
        badge.textContent = result === 'win' ? '\u2713 Advanced' : '\u2715 Eliminated';
        info.appendChild(badge);
      } else if (isActive) {
        info.className  += ' eligible';
        info.textContent = 'Ready to play';
      } else {
        info.className  += ' locked';
        info.textContent = inThisRound ? 'Waiting\u2026' : 'Not reached';
      }

      row.appendChild(lbl);
      row.appendChild(info);
      ladderEl.appendChild(row);
    });

    /* Champion row */
    if (koStatus === 'champion') {
      var champRow = document.createElement('div');
      champRow.className = 'lobby-ko-row active';
      champRow.innerHTML =
        '<div class="lobby-ko-row-label active-lbl">Champion</div>' +
        '<div class="lobby-ko-row-info eligible">\u2605 ' + _lobbyId + ' \u2605</div>';
      ladderEl.appendChild(champRow);
    }

    /* Play button */
    var playWrap = document.getElementById('lobby-ko-play-wrap');
    var playBtn  = document.getElementById('lobby-ko-play-btn');
    var canPlay  = koStatus && KO_ROUNDS.indexOf(koStatus) !== -1 && !koResults[koStatus];
    if (playWrap) playWrap.style.display = canPlay ? '' : 'none';
    if (playBtn && canPlay) {
      playBtn.onclick = function () { _startKnockoutMatch(koStatus); };
      playBtn.textContent = '\u25b6 Play ' + (KO_LABELS[koStatus] || koStatus);
    }
  }

  /**
   * Navigate to battle for a knockout round.
   */
  function _startKnockoutMatch(round) {
    _myKORound               = round;
    window.tournamentMatch   = 'knockout';
    window.currentLobbyCode  = _lobbyCode;
    window.currentLobbyId    = _lobbyId;
    window.currentKORound    = round;
    window.aiDifficulty      = 'hard';  // knockout games use hard AI

    var updates = {};
    updates[TOURNAMENTS_REF + '/' + _lobbyCode + '/students/' + _lobbyId + '/matchStatus'] = 'playing';
    _db.ref().update(updates).catch(function () {});

    if (typeof showScreen === 'function') showScreen('screen-battle');
    if (typeof initGame   === 'function') initGame();
  }

  /**
   * Record a knockout match result. Called by game.js showResult().
   * Writes result, advances bracket if player won, or eliminates them.
   */
  function recordKnockoutResult(outcome) {
    if (!_lobbyCode || !_lobbyId || !_myKORound) return;

    var round     = _myKORound;
    var nextRound = KO_NEXT[round];
    var updates   = {};
    var base      = TOURNAMENTS_REF + '/' + _lobbyCode + '/students/' + _lobbyId;

    updates[base + '/knockoutResults/' + round] = outcome;
    updates[base + '/matchStatus'] = 'waiting';

    if (outcome === 'win') {
      if (nextRound) {
        /* Advance to next round */
        updates[base + '/knockoutStatus'] = nextRound;
        /* Add to next round's participants array via a transaction-free push:
           read current participants, append, write back */
        _db.ref(TOURNAMENTS_REF + '/' + _lobbyCode + '/bracket/participants/' + nextRound)
          .once('value')
          .then(function (snap) {
            var list = snap.val() || [];
            if (list.indexOf(_lobbyId) === -1) list.push(_lobbyId);
            updates[TOURNAMENTS_REF + '/' + _lobbyCode + '/bracket/participants/' + nextRound] = list;
            return _db.ref().update(updates);
          }).catch(function () {
            _db.ref().update(updates).catch(function () {});
          });
      } else {
        /* Won the final → Champion! */
        updates[base + '/knockoutStatus'] = 'champion';
        updates[TOURNAMENTS_REF + '/' + _lobbyCode + '/bracket/champion'] = _lobbyId;
        updates[TOURNAMENTS_REF + '/' + _lobbyCode + '/status']           = 'complete';
        _db.ref().update(updates).catch(function () {});
      }
    } else {
      /* Lost → eliminated */
      updates[base + '/knockoutStatus'] = 'eliminated';
      _db.ref().update(updates).catch(function () {});
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     KNOCKOUT STAGE — teacher side
  ══════════════════════════════════════════════════════════════ */

  /**
   * Calculate which students advance from each group.
   * Returns array of { id, groupId, rank, points } sorted by groupId + rank.
   */
  function _calculateAdvancers(tournamentData) {
    var groups   = tournamentData.groups   || {};
    var students = tournamentData.students || {};
    var advancers = [];

    Object.keys(groups).sort().forEach(function (gid) {
      var g    = groups[gid];
      var mems = (g.members || []).filter(function (m) { return m.indexOf('BOT') !== 0; });

      /* Build ranking: sort by groupPoints desc, then wins desc */
      var ranked = mems.map(function (id) {
        var s    = students[id] || {};
        var rr   = s.roundResults || {};
        var wins = [1, 2, 3].filter(function (r) { return rr[r] === 'win'; }).length;
        return { id: id, groupId: gid, points: s.groupPoints || 0, wins: wins };
      });
      ranked.sort(function (a, b) {
        return b.points !== a.points ? b.points - a.points : b.wins - a.wins;
      });

      /* Top 2 advance — fill with BOTs if fewer than 2 real students */
      for (var rank = 1; rank <= 2; rank++) {
        if (ranked[rank - 1]) {
          advancers.push({ id: ranked[rank - 1].id, groupId: gid, rank: rank, points: ranked[rank - 1].points });
        } else {
          /* Fill with a bot placeholder so bracket has 16 slots */
          var botId = 'BOT_' + gid + '_' + rank;
          advancers.push({ id: botId, groupId: gid, rank: rank, points: 0 });
        }
      }
    });

    return advancers;
  }

  /** Show the teacher's KO setup panel. */
  function _showKOSetupPanel() {
    document.querySelector('.teacher-lobby-body').style.display = 'none';
    document.getElementById('tlob-ko-panel').style.display      = 'flex';
    _renderKOSetup(_tlobLastData);
  }

  function _hideKOSetupPanel() {
    document.getElementById('tlob-ko-panel').style.display      = 'none';
    document.querySelector('.teacher-lobby-body').style.display = 'flex';
  }

  /** Render the advancers grid in the teacher KO panel. */
  function _renderKOSetup(data) {
    var content    = document.getElementById('tlob-ko-content');
    var confirmBtn = document.getElementById('tlob-ko-confirm');
    var statusMsg  = document.getElementById('tlob-ko-status-msg');
    if (!content) return;

    var tournamentData = data || _tlobLastData || { groups: _tlobGroups || {}, students: _tlobStudents };

    /* If tournament already in knockout — show live bracket instead */
    if (tournamentData.status === 'knockout' || tournamentData.status === 'complete') {
      _renderKOBracket(tournamentData);
      if (confirmBtn) confirmBtn.style.display = 'none';
      if (statusMsg)  statusMsg.textContent    = tournamentData.status === 'complete'
        ? 'Champion: ' + (tournamentData.bracket && tournamentData.bracket.champion ? tournamentData.bracket.champion : '?')
        : 'Knockout in progress';
      return;
    }

    var advancers = _calculateAdvancers(tournamentData);
    var groups    = tournamentData.groups || {};

    content.innerHTML = '';

    /* Section: advancers by group */
    var titleEl = document.createElement('div');
    titleEl.className   = 'tlob-ko-section-title';
    titleEl.textContent = 'Advancers (' + advancers.length + ' players)';
    content.appendChild(titleEl);

    var grid = document.createElement('div');
    grid.className = 'tlob-ko-groups-grid';

    Object.keys(groups).sort().forEach(function (gid) {
      var block = document.createElement('div');
      block.className = 'tlob-ko-group-block';

      var nameEl       = document.createElement('div');
      nameEl.className = 'tlob-ko-group-name';
      nameEl.textContent = (groups[gid].name || gid);
      block.appendChild(nameEl);

      [1, 2].forEach(function (rank) {
        var adv = advancers.find(function (a) { return a.groupId === gid && a.rank === rank; });
        if (adv) {
          var el       = document.createElement('div');
          var isBot    = adv.id.indexOf('BOT') === 0;
          el.className = 'tlob-ko-advancer' + (rank === 2 ? ' rank2' : '') + (isBot ? ' bot' : '');
          el.textContent = (rank === 1 ? '\u25b6' : '\u25b7') + ' ' + adv.id;
          block.appendChild(el);
        }
      });

      grid.appendChild(block);
    });

    content.appendChild(grid);

    if (statusMsg) statusMsg.textContent = advancers.length + ' players will enter the knockout bracket';
    if (confirmBtn) {
      confirmBtn.style.display = '';
      confirmBtn.disabled      = advancers.length === 0;
    }

    /* Store advancers for use when confirm is clicked */
    content._advancers = advancers;
  }

  /** Render live bracket table (used when knockout is already running). */
  function _renderKOBracket(tournamentData) {
    var content  = document.getElementById('tlob-ko-content');
    if (!content) return;
    content.innerHTML = '';

    var students  = tournamentData.students || {};
    var allIds    = Object.keys(students).filter(function (id) { return id.indexOf('BOT') !== 0; });

    var titleEl       = document.createElement('div');
    titleEl.className = 'tlob-ko-section-title';
    titleEl.textContent = 'Knockout Bracket Progress';
    content.appendChild(titleEl);

    var table  = document.createElement('table');
    table.className = 'tlob-ko-bracket';

    var thead = document.createElement('thead');
    thead.innerHTML = '<tr><th>Player</th><th>R16</th><th>QF</th><th>SF</th><th>Final</th><th>Status</th></tr>';
    table.appendChild(thead);

    var tbody = document.createElement('tbody');
    allIds.forEach(function (id) {
      var s  = students[id] || {};
      var rr = s.knockoutResults || {};
      var tr = document.createElement('tr');

      function cell(val) {
        var td = document.createElement('td');
        if (!val)             { td.className = 'ko-pending'; td.textContent = '\u2013'; }
        else if (val === 'win')  { td.className = 'ko-win';  td.textContent = '\u2713'; }
        else                     { td.className = 'ko-loss'; td.textContent = '\u2715'; }
        return td;
      }

      var tdId = document.createElement('td'); tdId.className = 'ko-id'; tdId.textContent = id;
      tr.appendChild(tdId);
      tr.appendChild(cell(rr.r16));
      tr.appendChild(cell(rr.qf));
      tr.appendChild(cell(rr.sf));
      tr.appendChild(cell(rr.final));

      var tdStatus = document.createElement('td');
      var ks = s.knockoutStatus || '\u2013';
      tdStatus.className   = ks === 'champion' ? 'ko-win' : ks === 'eliminated' ? 'ko-loss' : 'ko-round';
      tdStatus.textContent = ks === 'champion' ? '\u2605 Champion' : KO_LABELS[ks] || ks;
      tr.appendChild(tdStatus);

      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    content.appendChild(table);
  }

  /**
   * Teacher confirms advancement — writes 16 participants + sets status = 'knockout'.
   */
  function _confirmStartKnockout() {
    var content    = document.getElementById('tlob-ko-content');
    var confirmBtn = document.getElementById('tlob-ko-confirm');
    if (!content || !content._advancers) return;

    var advancers = content._advancers;
    var advIds    = advancers.map(function (a) { return a.id; });
    var nonAdvIds = Object.keys(_tlobStudents).filter(function (id) { return advIds.indexOf(id) === -1; });

    if (confirmBtn) { confirmBtn.disabled = true; confirmBtn.textContent = 'Starting\u2026'; }

    var updates = {};
    updates[TOURNAMENTS_REF + '/' + _tlobCode + '/status'] = 'knockout';
    updates[TOURNAMENTS_REF + '/' + _tlobCode + '/bracket/participants/r16'] = advIds;

    /* Set knockoutStatus on each student */
    advancers.forEach(function (a) {
      if (a.id.indexOf('BOT') !== 0) {
        updates[TOURNAMENTS_REF + '/' + _tlobCode + '/students/' + a.id + '/knockoutStatus'] = 'r16';
      }
    });
    nonAdvIds.forEach(function (id) {
      updates[TOURNAMENTS_REF + '/' + _tlobCode + '/students/' + id + '/knockoutStatus'] = 'eliminated';
    });

    _db.ref().update(updates).then(function () {
      _tlobShowToast('Knockout started! ' + advIds.filter(function(id){ return id.indexOf('BOT') !== 0; }).length + ' players in the bracket');
      _renderKOSetup({ status: 'knockout', bracket: { participants: { r16: advIds } }, students: _tlobStudents });
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = '\u25b4 Bracket Live'; }
    }).catch(function (err) {
      _tlobShowToast('Failed: ' + err.message, true);
      if (confirmBtn) { confirmBtn.disabled = false; confirmBtn.textContent = '\u25b6 Start Knockout'; }
    });
  }

  function _showWaiting(data) {
    _lobbyRefs();
    _lobbyEntryPanel.style.display = 'none';
    _lobbyWaitPanel.style.display  = 'flex';

    document.getElementById('lobby-disp-code').textContent = _lobbyCode;
    document.getElementById('lobby-disp-id').textContent   = _lobbyId;
    _lobbyUpdateCount(data);

    /* Live listener */
    onTournament(_lobbyCode, _handleLobbyUpdate);
  }

  function _handleLobbyUpdate(updated) {
    _lobbyRefs();
    if (!updated) {
      offTournament(_lobbyCode);
      _lobbyCode = null;
      _lobbyId   = null;
      _lobbyEntryPanel.style.display = 'flex';
      _lobbyWaitPanel.style.display  = 'none';
      _lobbySetError('Tournament was closed by the teacher.');
      return;
    }
    _lobbyUpdateCount(updated);

    /* Check if a quick match was assigned to this student */
    var myRecord = updated.students && updated.students[_lobbyId];
    if (myRecord && myRecord.matchStatus === 'pending' && myRecord.matchId) {
      var matchData = updated.quickMatches && updated.quickMatches[myRecord.matchId];
      _showMatchFound(myRecord, matchData);
      return;
    }

    /* Knockout stage detected */
    if (updated.status === 'knockout' || updated.status === 'complete') {
      /* Stop listening once tournament is complete — no more state changes expected */
      if (updated.status === 'complete') offTournament(_lobbyCode);

      var kp = document.getElementById('lobby-knockout-panel');
      if (kp && kp.style.display !== 'none') {
        _renderKnockoutPanel(updated);
      } else {
        _showKnockoutPanel(updated);
      }
      return;
    }

    /* Group stage started */
    if (updated.status === 'group_stage') {
      /* If already showing group panel, just re-render standings */
      var groupPanel = document.getElementById('lobby-group-panel');
      if (groupPanel && groupPanel.style.display !== 'none') {
        _renderGroupPanel(updated);
        return;
      }
      /* First time detecting group_stage → show group panel */
      _showGroupPanel(updated);
    }
  }

  /**
   * Show "Match Found!" UI in the waiting room.
   * Injects a ready button that, when clicked, marks matchStatus='in_progress'
   * and navigates to the battle screen.
   */
  function _showMatchFound(myRecord, matchData) {
    var waitPanel = document.getElementById('lobby-waiting-panel');
    if (!waitPanel) return;

    var msgEl = waitPanel.querySelector('.lobby-waiting-msg');
    if (msgEl) {
      msgEl.innerHTML =
        '<span style="color:var(--snes-yellow);font-size:20px;">⚡ Match Found!</span><br>' +
        '<span style="color:var(--text-dim);font-size:15px;">vs <strong style="color:var(--snes-cyan);">' +
        (myRecord.opponentId || '?') + '</strong></span>';
    }

    /* Remove any previously injected ready button */
    var oldBtn = waitPanel.querySelector('#lobby-ready-btn');
    if (oldBtn) oldBtn.remove();

    var readyBtn = document.createElement('button');
    readyBtn.id        = 'lobby-ready-btn';
    readyBtn.className = 'btn-snes lobby-btn-join';
    readyBtn.style.marginTop = '18px';
    readyBtn.textContent = "I'm Ready";

    readyBtn.addEventListener('click', function () {
      readyBtn.disabled    = true;
      readyBtn.textContent = 'Connecting\u2026';

      /* Mark in_progress in Firebase */
      var updates = {};
      var base = TOURNAMENTS_REF + '/' + _lobbyCode;
      updates[base + '/students/' + _lobbyId + '/matchStatus'] = 'in_progress';
      if (myRecord.matchId) {
        updates[base + '/quickMatches/' + myRecord.matchId + '/status'] = 'in_progress';
      }

      window.currentLobbyCode = _lobbyCode;
      window.currentLobbyId   = _lobbyId;

      /* Determine P1/P2 role */
      var myRole  = (matchData && matchData.p1 === _lobbyId) ? 'p1' : 'p2';
      var oppId   = myRecord.opponentId ||
                    (matchData ? (myRole === 'p1' ? matchData.p2 : matchData.p1) : '') || '';
      var deckIds = [];
      try {
        deckIds = (window.Decks && window.Decks.getActiveCards()) || [];
      } catch (e) {}

      function _startBattle() {
        offTournament(_lobbyCode);
        if (typeof showScreen === 'function') showScreen('screen-battle');
        if (typeof initGame   === 'function') initGame();
      }

      (_db ? _db.ref().update(updates) : Promise.resolve()).then(function () {
        if (myRecord.matchId && typeof Match !== 'undefined') {
          readyBtn.textContent = 'Waiting for opponent\u2026';
          window.matchId  = myRecord.matchId;
          window.p1OrP2   = myRole;
          Match.init(myRecord.matchId, myRole, _lobbyCode, _lobbyId, oppId, deckIds, _startBattle);
        } else {
          _startBattle();
        }
      }).catch(function () {
        _startBattle();
      });
    });

    waitPanel.appendChild(readyBtn);
  }

  /**
   * Called from the result screen's "← Lobby" button.
   * Clears the student's match state in Firebase and returns them to the waiting room.
   */
  function returnToLobby() {
    var code = window.currentLobbyCode || _lobbyCode;
    var id   = window.currentLobbyId   || _lobbyId;

    /* Clear tournament match context */
    window.tournamentMatch   = false;
    window.currentLobbyCode  = null;
    window.currentLobbyId    = null;
    window.currentGroupRound = null;
    window.currentGroupOpp   = null;
    window.currentKORound    = null;
    window.matchId           = null;
    window.p1OrP2            = null;
    if (typeof Match !== 'undefined') Match.reset();

    if (!code || !id) {
      if (typeof showScreen === 'function') showScreen('screen-lobby');
      return;
    }

    _lobbyCode = code;
    _lobbyId   = id;

    var updates = {};
    var base    = TOURNAMENTS_REF + '/' + code + '/students/' + id;
    /* Clear quick-match fields (tournament group mode doesn't use these) */
    updates[base + '/matchId']    = null;
    updates[base + '/opponentId'] = null;

    (_db ? _db.ref().update(updates) : Promise.resolve())
      .catch(function () {})
      .then(function () {
        _lobbyRefs();
        if (typeof showScreen === 'function') showScreen('screen-lobby');

        /* Remove any injected ready button */
        var oldBtn = document.getElementById('lobby-ready-btn');
        if (oldBtn) oldBtn.remove();

        /* One-shot read to restore correct panel, then attach live listener */
        offTournament(code);
        onTournament(code, function (data) {
          if (!data) return;
          offTournament(code);

          if (data.status === 'complete') {
            /* Tournament over — show final panel, no listener needed */
            _showKnockoutPanel(data);
          } else if (data.status === 'knockout') {
            _showKnockoutPanel(data);
            onTournament(code, _handleLobbyUpdate);
          } else if (data.status === 'group_stage') {
            _showGroupPanel(data);
            onTournament(code, _handleLobbyUpdate);
          } else {
            /* Quick match or waiting — restore waiting room */
            _lobbyEntryPanel.style.display = 'none';
            _lobbyWaitPanel.style.display  = 'flex';
            document.getElementById('lobby-group-panel').style.display    = 'none';
            document.getElementById('lobby-knockout-panel').style.display = 'none';
            onTournament(code, _handleLobbyUpdate);
          }
        });
      });
  }

  /* ── Wire up lobby events (runs once at script load) ─────────── */
  (function _initLobbyEvents() {
    /* Guard — elements must exist in the DOM */
    var codeInput  = document.getElementById('lobby-code-input');
    if (!codeInput) return;

    var idInput    = document.getElementById('lobby-id-input');
    var shuffleBtn = document.getElementById('lobby-id-shuffle');
    var joinBtn    = document.getElementById('lobby-join-btn');
    var backBtn    = document.getElementById('lobby-back-btn');
    var leaveBtn   = document.getElementById('lobby-leave-btn');
    var errorEl    = document.getElementById('lobby-error');

    /* Code input: digits only */
    codeInput.addEventListener('input', function () {
      this.value = this.value.replace(/[^\d]/g, '');
    });

    /* ID input: letters only, auto-uppercase */
    idInput.addEventListener('input', function () {
      this.value = this.value.toUpperCase().replace(/[^A-Z]/g, '');
    });

    /* Shuffle: generate a fresh random ID suggestion */
    shuffleBtn.addEventListener('click', function () {
      idInput.value       = _makeId();
      errorEl.textContent = '';
    });

    /* Enter on code input → jump to ID input */
    codeInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') idInput.focus();
    });

    /* Enter on ID input → submit */
    idInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') joinBtn.click();
    });

    /* Back → deck builder */
    backBtn.addEventListener('click', function () {
      if (typeof showScreen === 'function') showScreen('screen-deckbuilder');
      if (typeof window.initDeckBuilder === 'function') window.initDeckBuilder();
    });

    /* Join */
    joinBtn.addEventListener('click', function () {
      var code = codeInput.value.trim();
      var id   = idInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);

      if (!/^\d{5}$/.test(code)) {
        errorEl.textContent = 'Enter a valid 5-digit tournament code.';
        return;
      }
      if (id.length !== 3) {
        errorEl.textContent = 'Your ID must be exactly 3 letters.';
        return;
      }

      joinBtn.disabled    = true;
      joinBtn.textContent = 'Joining\u2026';
      errorEl.textContent = '';

      joinTournament(code, id, function (err, data) {
        joinBtn.disabled    = false;
        joinBtn.textContent = 'JOIN';

        if (err) {
          errorEl.textContent = err.message;
          return;
        }

        _lobbyCode = code;
        _lobbyId   = id;
        _showWaiting(data);
      });
    });

    /* Leave lobby — remove student record, go back to entry panel */
    leaveBtn.addEventListener('click', function () {
      if (_lobbyCode && _lobbyId) {
        offTournament(_lobbyCode);
        removeStudent(_lobbyCode, _lobbyId, function () {});
        _lobbyCode = null;
        _lobbyId   = null;
      }
      document.getElementById('lobby-entry-panel').style.display  = 'flex';
      document.getElementById('lobby-waiting-panel').style.display = 'none';
      var gp = document.getElementById('lobby-group-panel');
      if (gp) gp.style.display = 'none';
      errorEl.textContent = '';
    });

    /* Leave Tournament from group stage panel */
    var groupLeaveBtn = document.getElementById('lobby-group-leave');
    if (groupLeaveBtn) {
      groupLeaveBtn.addEventListener('click', function () {
        if (_lobbyCode && _lobbyId) {
          offTournament(_lobbyCode);
          removeStudent(_lobbyCode, _lobbyId, function () {});
          _lobbyCode   = null;
          _lobbyId     = null;
          _myGroupId   = null;
          _myGroupData = null;
        }
        document.getElementById('lobby-group-panel').style.display  = 'none';
        document.getElementById('lobby-entry-panel').style.display  = 'flex';
        errorEl.textContent = '';
      });
    }

    /* Leave Tournament from knockout panel */
    var koLeaveBtn = document.getElementById('lobby-ko-leave');
    if (koLeaveBtn) {
      koLeaveBtn.addEventListener('click', function () {
        if (_lobbyCode && _lobbyId) {
          offTournament(_lobbyCode);
          removeStudent(_lobbyCode, _lobbyId, function () {});
          _lobbyCode  = null;
          _lobbyId    = null;
          _myKORound  = null;
        }
        document.getElementById('lobby-knockout-panel').style.display = 'none';
        document.getElementById('lobby-entry-panel').style.display    = 'flex';
        errorEl.textContent = '';
      });
    }
  })();

  /* ── Expose ──────────────────────────────────────────────────── */
  window.Multiplayer = {
    get ready()        { return _ready; },
    createTournament:  createTournament,
    loadTournament:    loadTournament,
    joinTournament:    joinTournament,
    onTournament:      onTournament,
    offTournament:     offTournament,
    updateTournament:  updateTournament,
    updateStudent:     updateStudent,
    removeStudent:     removeStudent,
    bootStudent:       bootStudent,
    showTeacherLobby:      showTeacherLobby,
    showLobbyEntry:        showLobbyEntry,
    returnToLobby:         returnToLobby,
    recordGroupResult:     recordGroupResult,
    recordKnockoutResult:  recordKnockoutResult,
    _makeId:               _makeId
  };

})();
