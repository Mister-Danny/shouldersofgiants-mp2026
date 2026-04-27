/**
 * battlelobby.js — Battle Lobby System
 * Exposes: window.BattleLobby
 *
 * Triple-click title → BattleLobby.prompt()
 *   "Spartacus" → Mode Select
 *     VERSUS MODE  → Teacher lobby (Firebase: versus/{code}/)
 *     TOURNAMENT   → Existing Multiplayer system
 *   "Swift"       → BypassMenu.open()
 *
 * Student flow: btn-versus → BattleLobby.showStudentJoin()
 *   Enter code + 3-letter ID → Deck Builder (Lock In Deck)
 *   → Wait → Countdown → Launch game
 */
(function () {
  'use strict';

  /* ── Firebase ──────────────────────────────────────────────── */
  var VERSUS_ROOT = 'versus';
  var _db = null;

  function _getDb() {
    if (_db) return _db;
    try { _db = firebase.database(firebase.app('rtdb')); } catch (e) {}
    return _db;
  }

  function _vRef(code) {
    var db = _getDb();
    if (!db || !code) return null;
    return db.ref(VERSUS_ROOT + '/' + code);
  }

  /* ── Module state ───────────────────────────────────────────── */
  var _s = {
    role:        null,    // 'teacher' | 'student'
    code:        null,
    studentId:   null,
    slotKey:     null,
    slotRole:    null,    // 'p1' | 'p2'
    lobbyRef:    null,
    cdTimer:     null,
    teacherData: null     // last Firebase snapshot (teacher side)
  };

  /* ── Helpers ────────────────────────────────────────────────── */

  function _genCode() {
    return String(Math.floor(10000 + Math.random() * 90000));
  }

  function _showEl(id) {
    var el = document.getElementById(id);
    if (el) el.classList.add('visible');
  }

  function _hideEl(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('visible');
  }

  function _val(id) {
    var el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }

  function _setText(id, t) {
    var el = document.getElementById(id);
    if (el) el.textContent = t;
  }

  /* ══════════════════════════════════════════════════════════════
     PASSWORD PROMPT
  ══════════════════════════════════════════════════════════════ */

  function prompt() {
    _setText('bl-pw-error', '');
    _showEl('bl-pw-backdrop');
    var inp = document.getElementById('bl-pw-input');
    if (inp) { inp.value = ''; setTimeout(function () { inp.focus(); }, 80); }
  }

  function _onPwSubmit() {
    var pw = _val('bl-pw-input');
    if (pw === 'Spartacus') {
      _hideEl('bl-pw-backdrop');
      showModeSelect();
    } else if (pw === 'Swift') {
      _hideEl('bl-pw-backdrop');
      if (window.BypassMenu) window.BypassMenu.open();
    } else {
      _setText('bl-pw-error', 'Incorrect password.');
      var inp = document.getElementById('bl-pw-input');
      if (inp) { inp.value = ''; inp.focus(); }
    }
  }

  /* ══════════════════════════════════════════════════════════════
     MODE SELECT
  ══════════════════════════════════════════════════════════════ */

  function showModeSelect() {
    _showEl('bl-mode-backdrop');
  }

  /* ══════════════════════════════════════════════════════════════
     TOURNAMENT MENU
  ══════════════════════════════════════════════════════════════ */

  function showTournamentMenu() {
    _hideEl('bl-mode-backdrop');
    _setText('bl-tournament-error', '');
    var inp = document.getElementById('bl-load-code-input');
    if (inp) inp.value = '';
    _showEl('bl-tournament-backdrop');
  }

  function _startNewTournament() {
    _hideEl('bl-tournament-backdrop');
    if (window.Multiplayer && typeof window.Multiplayer.showTeacherLobby === 'function') {
      window.Multiplayer.showTeacherLobby();
    }
  }

  function _loadSavedTournament() {
    var code = _val('bl-load-code-input');
    if (!code) { _setText('bl-tournament-error', 'Enter a tournament code.'); return; }
    _hideEl('bl-tournament-backdrop');
    try { localStorage.setItem('sog_teacher_code', code); } catch (e) {}
    if (window.Multiplayer && typeof window.Multiplayer.showTeacherLobby === 'function') {
      window.Multiplayer.showTeacherLobby();
    }
  }

  /* ══════════════════════════════════════════════════════════════
     TEACHER VERSUS LOBBY
  ══════════════════════════════════════════════════════════════ */

  function showTeacherVersus() {
    _hideEl('bl-mode-backdrop');
    _s.role = 'teacher';
    _s.code = _genCode();
    _setText('vt-code-display', _s.code);
    _hideEl('vt-countdown-wrap');
    _showEl('vt-backdrop');

    var ref = _vRef(_s.code);
    if (ref) {
      ref.set({
        code:      _s.code,
        createdAt: Date.now(),
        status:    'lobby',
        matchups:  null,
        students:  null
      }).catch(function () {});
      _s.lobbyRef = ref;
      ref.on('value', _onTeacherSnapshot);
    } else {
      _renderTeacherPanels({ students: {}, matchups: {} });
    }
  }

  function _onTeacherSnapshot(snap) {
    _s.teacherData = snap.val() || {};
    _renderTeacherPanels(_s.teacherData);
  }

  function _renderTeacherPanels(data) {
    var students = data.students || {};
    var matchups = data.matchups || {};

    /* Build set of assigned IDs */
    var assigned = {};
    Object.keys(matchups).forEach(function (key) {
      var m = matchups[key];
      if (m.p1) assigned[m.p1] = true;
      if (m.p2) assigned[m.p2] = true;
    });

    /* WAITING ROOM */
    var waitEl = document.getElementById('vt-waiting-list');
    if (waitEl) {
      waitEl.innerHTML = '';
      var unassigned = Object.keys(students).filter(function (id) { return !assigned[id]; });
      if (unassigned.length === 0) {
        var emp = document.createElement('div');
        emp.className = 'vt-empty';
        emp.textContent = unassigned.length === 0 && Object.keys(students).length === 0
          ? 'Waiting for students to join…'
          : 'All students are matched up.';
        waitEl.appendChild(emp);
      } else {
        unassigned.forEach(function (id) {
          var s = students[id];
          var row = document.createElement('div');
          row.className = 'vt-student-row';
          var nameEl = document.createElement('span');
          nameEl.className = 'vt-student-id';
          nameEl.textContent = id;
          var badge = document.createElement('span');
          badge.className = 'vt-lock-badge' + (s.deckLocked ? ' locked' : '');
          badge.textContent = s.deckLocked ? 'DECK LOCKED' : 'Choosing deck\u2026';
          row.appendChild(nameEl);
          row.appendChild(badge);
          waitEl.appendChild(row);
        });
      }
    }

    /* MATCHUPS */
    var matchEl = document.getElementById('vt-matchups-list');
    if (matchEl) {
      matchEl.innerHTML = '';
      var mKeys = Object.keys(matchups).sort();
      if (mKeys.length === 0) {
        var empm = document.createElement('div');
        empm.className = 'vt-empty';
        empm.textContent = 'No matchups yet. Students auto-pair as they join.';
        matchEl.appendChild(empm);
      } else {
        mKeys.forEach(function (key) {
          matchEl.appendChild(_buildMatchupRow(key, matchups[key]));
        });
      }
    }

    /* READY BUTTON */
    var readyBtn = document.getElementById('vt-ready-btn');
    if (readyBtn) {
      var sKeys = Object.keys(students);
      readyBtn.disabled = sKeys.length === 0;
    }

    /* Student count */
    var count = Object.keys(students).length;
    _setText('vt-student-count', count + ' student' + (count !== 1 ? 's' : '') + ' connected');
  }

  function _buildMatchupRow(key, m) {
    var row = document.createElement('div');
    row.className = 'vt-matchup-row';

    var p1Name = m.p1Bot ? '[Bot]' : (m.p1 || '\u2014');
    var p2Name = m.p2Bot ? '[Bot]' : (m.p2 || '\u2014');

    var p1El = document.createElement('span');
    p1El.className = 'vt-mp-player';
    p1El.textContent = p1Name;

    var vsEl = document.createElement('span');
    vsEl.className = 'vt-mp-vs';
    vsEl.textContent = 'vs';

    var p2El = document.createElement('span');
    p2El.className = 'vt-mp-player';
    p2El.textContent = p2Name;

    var bootBtn = document.createElement('button');
    bootBtn.className = 'btn-snes vt-boot-btn';
    bootBtn.textContent = 'BOOT';
    /* Closure to capture key and m correctly */
    (function (k, mu) {
      bootBtn.addEventListener('click', function () { _bootMatchup(k, mu); });
    }(key, m));

    row.appendChild(p1El);
    row.appendChild(vsEl);
    row.appendChild(p2El);
    row.appendChild(bootBtn);
    return row;
  }

  function _bootMatchup(key, m) {
    var ref = _vRef(_s.code);
    if (!ref) return;
    var updates = {};
    updates['matchups/' + key] = null;
    if (m.p1 && !m.p1Bot) {
      updates['students/' + m.p1 + '/slotKey']  = null;
      updates['students/' + m.p1 + '/slotRole'] = null;
    }
    if (m.p2 && !m.p2Bot) {
      updates['students/' + m.p2 + '/slotKey']  = null;
      updates['students/' + m.p2 + '/slotRole'] = null;
    }
    ref.update(updates).catch(function () {});
  }

  function _randomize() {
    var ref = _vRef(_s.code);
    if (!ref || !_s.teacherData) return;
    var students = _s.teacherData.students || {};
    var ids = Object.keys(students);
    if (ids.length === 0) return;

    /* Fisher-Yates shuffle */
    for (var i = ids.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = ids[i]; ids[i] = ids[j]; ids[j] = tmp;
    }

    var updates = {};
    /* Clear existing matchups and student slot assignments */
    updates['matchups'] = null;
    ids.forEach(function (id) {
      updates['students/' + id + '/slotKey']  = null;
      updates['students/' + id + '/slotRole'] = null;
    });

    /* Build new matchups */
    var numPairs = Math.floor(ids.length / 2);
    for (var p = 0; p < numPairs; p++) {
      var mKey = 's' + p;
      updates['matchups/' + mKey + '/p1']     = ids[p * 2];
      updates['matchups/' + mKey + '/p2']     = ids[p * 2 + 1];
      updates['matchups/' + mKey + '/status'] = 'open';
      updates['students/' + ids[p * 2] + '/slotKey']       = mKey;
      updates['students/' + ids[p * 2] + '/slotRole']      = 'p1';
      updates['students/' + ids[p * 2 + 1] + '/slotKey']   = mKey;
      updates['students/' + ids[p * 2 + 1] + '/slotRole']  = 'p2';
    }
    /* Odd student gets a bot */
    if (ids.length % 2 === 1) {
      var botKey = 's' + numPairs;
      updates['matchups/' + botKey + '/p1']     = ids[ids.length - 1];
      updates['matchups/' + botKey + '/p2Bot']  = 'serf';
      updates['matchups/' + botKey + '/status'] = 'open';
      updates['students/' + ids[ids.length - 1] + '/slotKey']  = botKey;
      updates['students/' + ids[ids.length - 1] + '/slotRole'] = 'p1';
    }
    ref.update(updates).catch(function () {});
  }

  function _addBot() {
    var ref = _vRef(_s.code);
    if (!ref || !_s.teacherData) return;
    var students = _s.teacherData.students || {};
    var matchups = _s.teacherData.matchups || {};
    var mKeys    = Object.keys(matchups);

    /* Look for a matchup slot with only one player and no bot */
    for (var i = 0; i < mKeys.length; i++) {
      var m = matchups[mKeys[i]];
      if (m.p1 && !m.p2 && !m.p2Bot) {
        ref.child('matchups/' + mKeys[i] + '/p2Bot').set('serf').catch(function () {});
        return;
      }
      if (!m.p1 && !m.p1Bot && m.p2) {
        ref.child('matchups/' + mKeys[i] + '/p1Bot').set('serf').catch(function () {});
        return;
      }
    }

    /* Find unmatched student and pair with a bot */
    var assigned = {};
    mKeys.forEach(function (k) {
      var m = matchups[k];
      if (m.p1) assigned[m.p1] = true;
      if (m.p2) assigned[m.p2] = true;
    });
    var unassigned = Object.keys(students).filter(function (id) { return !assigned[id]; });
    if (unassigned.length > 0) {
      var newKey = 's' + mKeys.length;
      var updates = {};
      updates['matchups/' + newKey + '/p1']     = unassigned[0];
      updates['matchups/' + newKey + '/p2Bot']  = 'serf';
      updates['matchups/' + newKey + '/status'] = 'open';
      updates['students/' + unassigned[0] + '/slotKey']  = newKey;
      updates['students/' + unassigned[0] + '/slotRole'] = 'p1';
      ref.update(updates).catch(function () {});
    }
  }

  function _startTeacherCountdown() {
    var ref = _vRef(_s.code);
    var now = Date.now();
    if (ref) {
      ref.update({ status: 'countdown', countdownStart: now }).catch(function () {});
    }

    /* Show inline countdown in the teacher panel */
    _showEl('vt-countdown-wrap');

    _runCountdown('vt-countdown-num', 30, function () {
      _hideEl('vt-countdown-wrap');
      if (ref) { ref.child('status').set('active').catch(function () {}); }
      _hideEl('vt-backdrop');
      _showEl('vt-active-overlay');
    });
  }

  function _runCountdown(numElId, seconds, onDone) {
    if (_s.cdTimer) { clearInterval(_s.cdTimer); _s.cdTimer = null; }
    var remaining = seconds;
    _setText(numElId, remaining);
    _s.cdTimer = setInterval(function () {
      remaining--;
      _setText(numElId, remaining);
      if (remaining <= 0) {
        clearInterval(_s.cdTimer);
        _s.cdTimer = null;
        onDone();
      }
    }, 1000);
  }

  function _closeTeacherVersus() {
    if (_s.lobbyRef) { _s.lobbyRef.off('value', _onTeacherSnapshot); }
    if (_s.cdTimer)  { clearInterval(_s.cdTimer); _s.cdTimer = null; }
    _hideEl('vt-backdrop');
    _hideEl('vt-countdown-wrap');
    _s.code     = null;
    _s.lobbyRef = null;
  }

  /* ══════════════════════════════════════════════════════════════
     STUDENT VERSUS FLOW
  ══════════════════════════════════════════════════════════════ */

  function showStudentJoin() {
    _setText('vs-join-error', '');
    var codeInp = document.getElementById('vs-code-input');
    var idInp   = document.getElementById('vs-id-input');
    if (codeInp) codeInp.value = '';
    if (idInp)   idInp.value   = '';
    _showEl('vs-join-backdrop');
    if (codeInp) setTimeout(function () { codeInp.focus(); }, 80);
  }

  function _submitJoin() {
    var code = _val('vs-code-input');
    var id   = _val('vs-id-input').toUpperCase();

    if (!/^\d{5}$/.test(code)) {
      _setText('vs-join-error', 'Enter the 5-digit code from your teacher.');
      return;
    }
    if (!/^[A-Z]{3}$/.test(id)) {
      _setText('vs-join-error', 'Enter your 3-letter ID (e.g. ABC).');
      return;
    }

    var ref = _vRef(code);
    if (!ref) {
      /* No Firebase — proceed without sync */
      _s.role = 'student'; _s.code = code; _s.studentId = id;
      _hideEl('vs-join-backdrop');
      _enterDeckBuilder();
      return;
    }

    _setText('vs-join-error', 'Connecting\u2026');

    ref.once('value', function (snap) {
      var data = snap.val();
      if (!data || data.status === 'active') {
        _setText('vs-join-error', 'Lobby not found or already in progress.');
        return;
      }
      _s.role = 'student'; _s.code = code; _s.studentId = id;
      _assignSlot(ref, data, id, function () {
        _hideEl('vs-join-backdrop');
        _enterDeckBuilder();
      }, function (err) {
        _setText('vs-join-error', err);
      });
    });
  }

  function _assignSlot(ref, data, id, onOk, onErr) {
    var students = data.students || {};

    /* Already joined? */
    if (students[id]) {
      _s.slotKey  = students[id].slotKey;
      _s.slotRole = students[id].slotRole;
      onOk();
      return;
    }

    var matchups = data.matchups || {};
    var mKeys    = Object.keys(matchups).sort();
    var foundKey = null, foundRole = null;

    /* Find open slot in existing matchups */
    for (var i = 0; i < mKeys.length; i++) {
      var m = matchups[mKeys[i]];
      if (!m.p1 && !m.p1Bot) { foundKey = mKeys[i]; foundRole = 'p1'; break; }
      if (!m.p2 && !m.p2Bot) { foundKey = mKeys[i]; foundRole = 'p2'; break; }
    }
    /* Or start a new matchup */
    if (!foundKey) { foundKey = 's' + mKeys.length; foundRole = 'p1'; }

    _s.slotKey  = foundKey;
    _s.slotRole = foundRole;

    var updates = {};
    updates['students/' + id + '/id']         = id;
    updates['students/' + id + '/joinedAt']   = Date.now();
    updates['students/' + id + '/deck']       = null;
    updates['students/' + id + '/deckLocked'] = false;
    updates['students/' + id + '/slotKey']    = foundKey;
    updates['students/' + id + '/slotRole']   = foundRole;
    updates['matchups/' + foundKey + '/' + foundRole] = id;
    if (!matchups[foundKey]) {
      updates['matchups/' + foundKey + '/status'] = 'open';
    }

    ref.update(updates)
      .then(function () { onOk(); })
      .catch(function () { onErr('Connection error. Try again.'); });
  }

  function _enterDeckBuilder() {
    window.versusStudentMode = true;
    window.multiplayerMode   = false;
    if (typeof showScreen === 'function') showScreen('screen-deckbuilder');
    if (typeof window.initDeckBuilder === 'function') window.initDeckBuilder();
  }

  function onLockInDeck(deckIds) {
    if (_s.role !== 'student') return;
    var ref = _vRef(_s.code);
    if (ref && _s.studentId) {
      var updates = {};
      updates['students/' + _s.studentId + '/deck']       = deckIds;
      updates['students/' + _s.studentId + '/deckLocked'] = true;
      ref.update(updates).catch(function () {});
    }
    _showStudentWaiting();
  }

  function _showStudentWaiting() {
    _showEl('vs-wait-backdrop');

    var ref = _vRef(_s.code);
    if (!ref) return;

    /* Listen for status changes from teacher */
    ref.child('status').on('value', function statusListener(snap) {
      var status = snap.val();
      if (status === 'countdown') {
        ref.child('countdownStart').once('value', function (startSnap) {
          var start   = startSnap.val() || Date.now();
          var elapsed = Math.floor((Date.now() - start) / 1000);
          var left    = Math.max(1, 30 - elapsed);
          ref.child('status').off('value', statusListener);
          _hideEl('vs-wait-backdrop');
          _showEl('vs-countdown-overlay');
          _runCountdown('vs-countdown-num', left, function () {
            _hideEl('vs-countdown-overlay');
            _launchStudentGame();
          });
        });
      } else if (status === 'active') {
        ref.child('status').off('value', statusListener);
        _hideEl('vs-wait-backdrop');
        _hideEl('vs-countdown-overlay');
        _launchStudentGame();
      }
    });
  }

  function _launchStudentGame() {
    if (_s.cdTimer) { clearInterval(_s.cdTimer); _s.cdTimer = null; }
    var ref = _vRef(_s.code);
    if (!ref) { _doLaunch(null); return; }
    ref.once('value', function (snap) {
      var data     = snap.val() || {};
      var matchups = data.matchups || {};
      var mu       = _s.slotKey ? (matchups[_s.slotKey] || null) : null;
      _doLaunch(mu);
    });
  }

  function _doLaunch(mu) {
    window.tournamentMatch   = 'versus';
    window.currentLobbyCode  = _s.code;
    window.versusStudentMode = false;

    var oppRole  = (_s.slotRole === 'p1') ? 'p2' : 'p1';
    var oppId    = mu ? (mu[oppRole] || null) : null;
    var isBotOpp = mu && mu[oppRole + 'Bot'];

    if (oppId && !isBotOpp && typeof Match !== 'undefined') {
      /* Blind 2-player match via match.js */
      var matchId = (_s.slotKey || 's0') + '_' + _s.code;
      var deckIds = [];
      try { deckIds = (window.Decks && window.Decks.getActiveCards()) || []; } catch (e) {}
      Match.init(matchId, _s.slotRole, _s.code, _s.studentId, oppId, deckIds, function () {
        if (typeof showScreen === 'function') showScreen('screen-battle');
        if (typeof initGame   === 'function') initGame();
      });
    } else {
      /* Bot opponent or no Firebase */
      if (typeof showScreen === 'function') showScreen('screen-battle');
      if (typeof initGame   === 'function') initGame();
    }
  }

  /* ══════════════════════════════════════════════════════════════
     POST-MATCH AUTO-RETURN  (triggered by 35-s timer in game.js)
  ══════════════════════════════════════════════════════════════ */

  function returnToLobby() {
    window.tournamentMatch   = null;
    window.currentLobbyCode  = null;
    window.versusStudentMode = false;
    /* Reset BattleLobby state and send student home */
    _s.role      = null;
    _s.code      = null;
    _s.studentId = null;
    _s.slotKey   = null;
    _s.slotRole  = null;
    if (typeof showScreen === 'function') showScreen('screen-home');
  }

  /* ══════════════════════════════════════════════════════════════
     DOM WIRING
  ══════════════════════════════════════════════════════════════ */

  function _wire() {
    /* Password */
    var pwForm = document.getElementById('bl-pw-form');
    if (pwForm) pwForm.addEventListener('submit', function (e) { e.preventDefault(); _onPwSubmit(); });
    var pwCancel = document.getElementById('bl-pw-cancel');
    if (pwCancel) pwCancel.addEventListener('click', function () { _hideEl('bl-pw-backdrop'); });

    /* Mode select */
    var mVs  = document.getElementById('bl-mode-versus');
    if (mVs)  mVs.addEventListener('click', showTeacherVersus);
    var mTn  = document.getElementById('bl-mode-tournament');
    if (mTn)  mTn.addEventListener('click', showTournamentMenu);
    var mCx  = document.getElementById('bl-mode-cancel');
    if (mCx)  mCx.addEventListener('click', function () { _hideEl('bl-mode-backdrop'); });

    /* Tournament menu */
    var tNew = document.getElementById('bl-tourn-new');
    if (tNew) tNew.addEventListener('click', _startNewTournament);
    var tLd  = document.getElementById('bl-tourn-load-btn');
    if (tLd)  tLd.addEventListener('click', _loadSavedTournament);
    var tCx  = document.getElementById('bl-tourn-cancel');
    if (tCx)  tCx.addEventListener('click', function () { _hideEl('bl-tournament-backdrop'); });

    /* Teacher versus */
    var vtRand  = document.getElementById('vt-randomize-btn');
    if (vtRand)  vtRand.addEventListener('click', _randomize);
    var vtBot   = document.getElementById('vt-addbot-btn');
    if (vtBot)   vtBot.addEventListener('click', _addBot);
    var vtReady = document.getElementById('vt-ready-btn');
    if (vtReady) vtReady.addEventListener('click', _startTeacherCountdown);
    var vtClose = document.getElementById('vt-close-btn');
    if (vtClose) vtClose.addEventListener('click', _closeTeacherVersus);

    /* Active session */
    var vtAClose = document.getElementById('vt-active-close');
    if (vtAClose) vtAClose.addEventListener('click', function () {
      _hideEl('vt-active-overlay');
      /* Reset status so a new session can be created */
      var ref = _vRef(_s.code);
      if (ref) ref.child('status').set('lobby').catch(function () {});
    });

    /* Student join */
    var vsForm   = document.getElementById('vs-join-form');
    if (vsForm)   vsForm.addEventListener('submit', function (e) { e.preventDefault(); _submitJoin(); });
    var vsCancel = document.getElementById('vs-join-cancel');
    if (vsCancel) vsCancel.addEventListener('click', function () {
      window.versusStudentMode = false;
      _hideEl('vs-join-backdrop');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _wire);
  } else {
    _wire();
  }

  /* ── Public surface ─────────────────────────────────────────── */
  window.BattleLobby = {
    prompt:            prompt,
    showModeSelect:    showModeSelect,
    showTeacherVersus: showTeacherVersus,
    showStudentJoin:   showStudentJoin,
    showTournamentMenu: showTournamentMenu,
    onLockInDeck:      onLockInDeck,
    returnToLobby:     returnToLobby
  };

})();
