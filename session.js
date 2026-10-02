/* Тез Оқу — күнделікті 15 минуттық сессия (session.js).
   Классикалық скрипт: defer/module ЕМЕС. index.html ішінде барлық басқа скрипттен кейін, </body> алдында жүктеледі.
   Спек: «Күнделікті 15 минут — спецификация.md». Жоспар: «Күнделікті 15 минут — іске асыру жоспары.md». */

/* tr() — index.html ішіндегі I18N аудармасы. Тест беттерінде (I18N жоқ) қазақша мәтін қалады, тек {параметр} орнына қойылады. */
if (typeof window.tr !== 'function') window.tr = function (k, p) { return p ? k.replace(/\{(\w+)\}/g, function (m, n) { return p[n] !== undefined ? p[n] : m; }) : k; };

/* ═══ 1. ТАЗА ЯДРО: DOM да, желі де жоқ. Тест: tests/session-core.test.html ═══ */
(function () {
  'use strict';
  var TZ = 'Asia/Almaty';
  var START_DAY = '2026-10-03';   // күн индексінің нөлі (челлендж старты)
  var READ_GOAL_SEC = 600;        // оқу қадамы = 10 минут (челлендж шегі 9 мин, сондықтан 1 мин жоғары)
  var VALVE_MS = 180000;          // «Ақау бар» сілтемесі 3 минуттан кейін шығады

  function almatyDay(date) {
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    var m = {};
    parts.forEach(function (p) { m[p.type] = p.value; });
    return m.year + '-' + m.month + '-' + m.day;
  }

  function dayIndex(day, startDay) {
    return Math.round((Date.parse(day + 'T00:00:00Z') - Date.parse((startDay || START_DAY) + 'T00:00:00Z')) / 86400000);
  }

  // Дашбордтағы карточкалардан (DOM-нан алынған қарапайым объектілер) сессия пулын құрады.
  function poolFromCards(cards, hasFn) {
    var pool = [];
    cards.forEach(function (c) {
      if (!c || !c.cardId || !c.done) return;      // атрибуты жоқ карточка тізімге кірмейді
      if (!hasFn(c.done)) return;                  // функция табылмады — өткізіледі
      var sec = parseInt(c.sec, 10);
      pool.push({
        id: c.cardId.replace(/^trainer-/, ''),
        cardId: c.cardId,
        name: c.name || c.cardId,
        done: c.done,
        sec: sec > 0 ? sec : 75,
        from: /^\d{4}-\d{2}-\d{2}$/.test(c.from || '') ? c.from : ''
      });
    });
    return pool;
  }

  // Бүгінгі 2 ойын: from === бүгін болған жаңа тренажер бірінші; екіншісі қалғандардан күн индексімен ауысады.
  function pickGames(pool, today) {
    var avail = pool.filter(function (t) { return !t.from || t.from <= today; });
    if (!avail.length) return [];
    var idx = Math.max(0, dayIndex(today));
    var fresh = avail.filter(function (t) { return t.from === today; });
    var first = fresh.length ? fresh[fresh.length - 1] : avail[idx % avail.length];
    var rest = avail.filter(function (t) { return t.id !== first.id; });
    var out = [first.id];
    if (rest.length) out.push(rest[idx % rest.length].id);
    return out;
  }

  function buildPlan(pool, today) {
    return ['eye'].concat(pickGames(pool, today), ['reading']);
  }

  // Қатқан жоспардағы тізімнен жоғалған тренажерді келесі үміткерге ауыстырады; орын жоқ болса алып тастайды (lost).
  function resolvePlan(stored, pool, today) {
    var known = {}, used = {}, lost = [];
    pool.forEach(function (t) { known[t.id] = true; });
    var plan = stored.slice();
    plan.forEach(function (id) { used[id] = true; });
    var idx = Math.max(0, dayIndex(today));
    for (var i = 1; i < plan.length - 1; i++) {      // 0 = eye, соңғысы = reading
      if (known[plan[i]]) continue;
      var gone = plan[i];
      var cand = pool.filter(function (t) { return !used[t.id]; });
      if (cand.length) {
        var pick = cand[idx % cand.length];
        plan[i] = pick.id;
        used[pick.id] = true;
      } else {
        plan.splice(i, 1);
        i--;
        lost.push(gone);
      }
    }
    return { plan: plan, lost: lost };
  }

  function nextStep(plan, done) {
    for (var i = 0; i < plan.length; i++) {
      if (!done || !done[plan[i]]) return plan[i];
    }
    return null;
  }

  // Чиптегі секунд: сервер растағанша 599-дан аспайды.
  function readingShown(srvSec, baseSec, localSec, completed) {
    if (completed) return READ_GOAL_SEC;
    var est = Math.max(srvSec || 0, (baseSec || 0) + (localSec || 0));
    return Math.min(Math.floor(est), READ_GOAL_SEC - 1);
  }

  function fmtMMSS(sec) {
    var m = Math.floor(sec / 60), s = sec % 60;
    return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
  }

  function cardState(row, plan) {
    if (!row) return { state: 'none' };
    if (row.completed_at) return { state: 'done' };
    var p = plan || row.plan || [];
    var next = nextStep(p, row.done || {});
    return { state: 'progress', next: next, no: p.indexOf(next) + 1, total: p.length };
  }

  window.TezSessionCore = {
    almatyDay: almatyDay, dayIndex: dayIndex, poolFromCards: poolFromCards, pickGames: pickGames,
    buildPlan: buildPlan, resolvePlan: resolvePlan, nextStep: nextStep, readingShown: readingShown,
    fmtMMSS: fmtMMSS, cardState: cardState,
    START_DAY: START_DAY, READ_GOAL_SEC: READ_GOAL_SEC, VALVE_MS: VALVE_MS
  };
})();

/* ═══ 2. ҚОЗҒАЛТҚЫШ: DOM + Supabase RPC ═══ */
(function () {
  'use strict';
  if (window.__TEZ_SESSION_TEST__ || !window.TezSessionCore) return;
  var Core = window.TezSessionCore;
  var onLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var qs = onLocal ? new URLSearchParams(location.search) : null;     // ?session=all&valve=400 тек localhost-та (тест үшін)
  var SESSION_MODE = (qs && qs.get('session')) || 'all';           // 'off' | 'admins' | 'all'
  var VALVE_MS = (qs && parseInt(qs.get('valve'), 10)) || Core.VALVE_MS;
  var RETRY_WAITS = (qs && qs.get('retry') === 'fast') ? [20, 20, 20] : [1000, 3000, 8000];
  var LAG_AFTER = (qs && parseInt(qs.get('lag'), 10)) || 90;          // сервер минуты осынша секундтан кейін артта қалса, оқушыға түсіндіреміз
  if (SESSION_MODE === 'off') return;

  var EYE = { id: 'eye', name: tr('Көз жаттығуы'), sec: 90, cardId: 'trainer-eyewarmup', done: 'eyeWarmupFinish' };
  var S = {
    pool: [], row: null, plan: null, openStep: null, openSince: 0,
    srvRead: 0, readBase: 0, localRead: 0,
    isAdmin: null, adminFor: '', refreshId: 0, loadedOnce: false, busy: false, valveTimer: 0,
    pending: {}, userId: undefined, leftReading: false
  };
  var wrapped = {};
  var E;

  /* ── көмекшілер ── */
  function $(id) { return document.getElementById(id); }
  function mk(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function root(id) {                       // body-ға бекітілген қабат, бір рет жасалады
    var e = $(id);
    if (!e) { e = mk('div', 'tez-ses'); e.id = id; document.body.appendChild(e); }
    return e;
  }
  function today() { return Core.almatyDay(new Date()); }
  function toast(text) {
    var t = root('tez-ses-toast');
    t.textContent = text;
    t.classList.add('is-on');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { t.classList.remove('is-on'); }, 4000);
  }


  /* ── күй көмекшілері: күн ауысуы, қолданушы ауысуы, сақталмаған қадамдар ── */
  function isDayError(r) { return !!(r && r.error && /session not started/.test(r.error.message || '')); }
  function mergeRow(local, server) {          // сервердің done-ы басым, бірақ жергілікті (әлі сақталмаған) қадамдар жоғалмайды
    var done = Object.assign({}, (local && local.done) || {}, (server && server.done) || {});
    return Object.assign({}, local || {}, server || {}, { done: done });
  }
  function handleDayChanged() {
    toast(tr('Күн ауысты. Сессияны жаңадан бастаңыз.'));
    S.row = null; S.plan = null; S.pending = {};
    exitToDashboard();
  }
  function syncUser() {                       // ортақ құрылғыда басқа оқушы кірсе, алдыңғының күйі қалмайды
    var id = authUser ? authUser.id : '';
    if (S.userId === id) return;
    S.userId = id;
    S.row = null; S.plan = null; S.srvRead = 0; S.readBase = 0; S.localRead = 0;
    S.loadedOnce = false; S.pending = {}; S.openStep = null;
    clearValve(); hideCard(); hideLine();
    try { if (E && E.cleanupReading) E.cleanupReading(); } catch (e) {}
    removeCard();
  }
  function flushPending() {                   // сақталмай қалған қадамдарды серверге қайта жібереді; бәрі сәтті болса true
    var ids = Object.keys(S.pending);
    if (!ids.length) return Promise.resolve(true);
    var chain = Promise.resolve(true);
    ids.forEach(function (id) {
      chain = chain.then(function (allOk) {
        if (!S.pending[id]) return allOk;
        return callRetry('session_step_done', { p_step: id, p_bug: !!S.pending[id].bug }).then(function (r) {
          if (r.ok && r.data) { delete S.pending[id]; S.row = mergeRow(S.row, r.data); return allOk; }
          if (isDayError(r)) { handleDayChanged(); return false; }
          return false;
        });
      });
    });
    return chain;
  }

  /* ── Supabase RPC ── */
  function call(name, args) {
    return Promise.resolve().then(function () { return sb.rpc(name, args || {}); }).then(function (res) {
      if (res && res.error) { console.warn('[session]', name, res.error.message); return { ok: false, data: null, error: res.error }; }
      return { ok: true, data: res ? res.data : null };
    }).catch(function (e) { console.warn('[session]', name, e); return { ok: false, data: null, error: { message: String((e && e.message) || e) } }; });
  }
  function callRetry(name, args) {
    var waits = RETRY_WAITS;
    function go(i) {
      return call(name, args).then(function (r) {
        if (r.ok || i >= waits.length || isDayError(r)) return r;
        return new Promise(function (res) { setTimeout(res, waits[i]); }).then(function () { return go(i + 1); });
      });
    }
    return go(0);
  }
  function enabled() {
    if (!authUser) return Promise.resolve(false);
    if (SESSION_MODE === 'all') return Promise.resolve(true);
    if (S.adminFor === authUser.id) return Promise.resolve(S.isAdmin === true);
    return call('is_admin').then(function (r) {
      S.adminFor = authUser.id;
      S.isAdmin = r.ok && r.data === true;
      return S.isAdmin;
    });
  }

  /* ── тренажер пулы: дашбордтағы карточкалар ── */
  function nameOf(id) {
    if (id === 'eye') return EYE.name;
    if (id === 'reading') return tr('Кітап оқу');
    for (var i = 0; i < S.pool.length; i++) if (S.pool[i].id === id) return S.pool[i].name;
    return id;
  }
  function secOf(id) {
    if (id === 'eye') return EYE.sec;
    for (var i = 0; i < S.pool.length; i++) if (S.pool[i].id === id) return S.pool[i].sec;
    return 75;
  }
  function wrapDone(fnName, stepId) {       // аяқталу функциясын орайды: түпнұсқа орындалады, сосын қадам белгіленеді
    if (wrapped[fnName]) return;
    var orig = window[fnName];
    if (typeof orig !== 'function') return;
    wrapped[fnName] = true;
    var w = function () {
      var r = orig.apply(this, arguments);
      try { onTrainerDone(stepId); } catch (e) { console.warn('[session] done hook', e); }
      return r;
    };
    w.__tezWrapped = true;
    window[fnName] = w;
  }
  function scanPool() {
    var cards = [], nodes = document.querySelectorAll('#dash-trainers-grid .dash-trainer-card[data-session-done]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i], nm = n.querySelector('.dash-trainer-name');
      cards.push({
        cardId: n.id, name: nm ? nm.textContent.trim() : n.id, done: n.getAttribute('data-session-done'),
        sec: n.getAttribute('data-session-sec'), from: n.getAttribute('data-session-from') || ''
      });
    }
    cards.forEach(function (c) {
      if (typeof window[c.done] !== 'function') console.warn('[session] карточка өткізілді, функция табылмады:', c.cardId, c.done);
    });
    S.pool = Core.poolFromCards(cards, function (fn) { return typeof window[fn] === 'function'; });
    S.pool.forEach(function (t) { wrapDone(t.done, t.id); });
    wrapDone(EYE.done, EYE.id);
    return S.pool;
  }

  /* ── дашбордтағы карточка ── */
  function ensureCard() {
    var c = $('tez-ses-card');
    if (c) return c;
    var host = $('bl-banner');
    if (!host || !host.parentNode) return null;
    c = mk('div', 'tez-ses');
    c.id = 'tez-ses-card';
    host.parentNode.insertBefore(c, host.nextSibling);
    return c;
  }
  function removeCard() { var c = $('tez-ses-card'); if (c && c.parentNode) c.parentNode.removeChild(c); }
  function setCardBusy(b) { var btn = document.querySelector('#tez-ses-card .tez-ses-btn'); if (btn) btn.disabled = b; }
  function chipsFor(plan, done, next) {
    var wrap = mk('div', 'tez-ses-chips');
    plan.forEach(function (id) {
      var isDone = !!(done && done[id]);
      var cls = 'tez-ses-chip' + (isDone ? ' is-done' : id === next ? ' is-next' : '');
      var bug = isDone && done[id].bug ? ' ⚠' : '';
      wrap.appendChild(mk('span', cls, (isDone ? '✓ ' : '') + nameOf(id) + bug));
    });
    return wrap;
  }
  function renderCard(force) {
    var c = ensureCard();
    if (!c) return;
    c.textContent = '';
    var st = force ? { state: force } : Core.cardState(S.row, S.plan);
    c.className = 'tez-ses' + (st.state === 'done' ? ' is-done' : '');
    var title = tr('Бүгінгі 15 минут'), sub = '', btnLabel = '';
    if (st.state === 'loading') sub = tr('Жүктелуде…');
    else if (st.state === 'error') sub = tr('Сессия қазір қолжетімсіз. Тренажерлерді төменнен қолмен ашуға болады.');
    else if (st.state === 'none') { sub = tr('Көз жаттығуы → 2 ойын → 10 минут оқу. Бір басумен бастаңыз.'); btnLabel = tr('Бастау'); }
    else if (st.state === 'progress') { title += ' · ' + tr('Қадам {no}/{total}', { no: st.no, total: st.total }); sub = tr('Келесі: {name}', { name: nameOf(st.next) }); btnLabel = tr('Жалғастыру'); }
    else if (st.state === 'done') { title = tr('Бүгін аяқталды ✓'); sub = tr('15 минуттық сессия орындалды. Қосымша жаттығулар төменде.'); }
    c.appendChild(mk('div', 'tez-ses-title', title));
    c.appendChild(mk('div', 'tez-ses-sub', sub));
    if (st.state === 'none') {
      var g = mk('div', 'tez-ses-chips');
      [tr('Көз жаттығуы'), tr('Ойын'), tr('Ойын'), tr('Оқу · 10 мин')].forEach(function (t) { g.appendChild(mk('span', 'tez-ses-chip', t)); });
      c.appendChild(g);
    } else if (st.state === 'progress' || st.state === 'done') {
      c.appendChild(chipsFor(S.plan || S.row.plan, S.row.done, st.next));
    }
    if (btnLabel) {
      var b = mk('button', 'tez-ses-btn', btnLabel);
      b.onclick = start;
      b.disabled = S.busy;
      c.appendChild(b);
    }
  }

  /* ── күй: серверден жолды алу ── */
  function applyRow(row) {
    S.row = row || null;
    if (!S.row) { S.plan = null; S.srvRead = 0; return; }
    S.srvRead = S.row.read_seconds || 0;
    var d = Object.assign({}, S.row.done || {});
    Object.keys(S.pending).forEach(function (id) { if (!d[id]) d[id] = { at: new Date().toISOString(), bug: !!S.pending[id].bug }; });
    S.row = Object.assign({}, S.row, { done: d });
    var res = Core.resolvePlan(S.row.plan, S.pool, today());
    S.plan = res.plan;
    res.lost.forEach(function (id) {          // орын табылмаған қадамды bug белгісімен жабамыз, сервердегі есеп сәйкес болсын
      if (!(S.row.done && S.row.done[id])) {
        call('session_step_done', { p_step: id, p_bug: true }).then(function (r) { if (r.ok && r.data) S.row = Object.assign({}, S.row, r.data); });
      }
    });
  }
  function refresh() {
    var token = ++S.refreshId;
    return enabled().then(function (on) {
      if (token !== S.refreshId) return;
      if (!on) { removeCard(); return; }
      scanPool();
      if (!S.loadedOnce) renderCard('loading');
      return call('session_status', {}).then(function (r) {
        if (token !== S.refreshId) return;
        if (!r.ok) { renderCard('error'); return; }
        S.loadedOnce = true;
        applyRow(r.data);
        renderCard();
      });
    });
  }

  /* ── ағын: бастау, келесі қадам, аяқтау ── */
  function start() {
    if (S.busy || !authUser) return;
    syncUser();
    S.busy = true;
    setCardBusy(true);
    scanPool();
    if (S.row && S.row.day && S.row.day !== today()) { S.row = null; S.plan = null; S.pending = {}; }   // қолданба түні бойы ашық тұрса, кешегі жол қайта қолданылмайды
    var go = S.row ? Promise.resolve(true)
      : callRetry('session_start', { p_plan: Core.buildPlan(S.pool, today()) }).then(function (r) {
          if (!r.ok || !r.data) { renderCard('error'); return false; }
          applyRow(r.data);
          return true;
        });
    go.then(function (ok) { if (ok) launchNext(); })
      .then(function () { S.busy = false; setCardBusy(false); }, function (e) { console.warn('[session] start', e); S.busy = false; setCardBusy(false); });
  }
  function launchNext() {
    hideCard(); clearValve();
    var step = Core.nextStep(S.plan, S.row.done || {});
    if (!step) { exitToDashboard(); return; }
    if (step === 'reading') {
      flushPending().then(function (ok) {
        if (!S.row) return;                                    // күн ауысты: handleDayChanged жұмыс істеді
        if (!ok) {
          showCard(tr('Байланыс қатесі'), tr('Алдыңғы қадамдар сақталмады. Интернетті тексеріп, қайта көріңіз.'), [
            { label: tr('Қайта көру'), primary: true, onClick: launchNext },
            { label: tr('Шығу'), onClick: exitToDashboard }
          ]);
          return;
        }
        if (E.openReading) E.openReading(); else exitToDashboard();
      });
      return;
    }
    var card = $(step === 'eye' ? EYE.cardId : 'trainer-' + step);
    S.openStep = null;                         // карточканың click()-і hideAllViews() шақыруы мүмкін; openStep-ті ашқаннан кейін қоямыз
    if (card) card.click();
    else if (step === 'eye' && typeof window.showEyeWarmup === 'function') window.showEyeWarmup();
    S.openStep = step;
    S.openSince = Date.now();
    document.body.classList.add('tez-ses-on');
    renderLine();
    armValve();
  }
  function onTrainerDone(id) {
    if (!S.row || S.openStep !== id) return;   // тек сессия ашқан қадам есептеледі
    S.openStep = null;                         // бір қадам = бір рет
    markDone(id, false);
  }
  function markDone(id, bug) {
    if (!S.row) return Promise.resolve();
    var done = Object.assign({}, S.row.done || {});
    if (!done[id]) done[id] = { at: new Date().toISOString(), bug: !!bug };
    S.row = Object.assign({}, S.row, { done: done });
    S.pending[id] = { bug: !!bug };
    clearValve();
    renderLine();
    showNext(id);
    return flushPending().then(function (ok) {
      if (!ok && S.row) toast(tr('Байланыс қатесі: қадам әзірге сақталмады, қайта көреміз.'));
    });
  }
  function showNext(finishedId) {
    var step = Core.nextStep(S.plan, S.row.done || {});
    if (!step) { exitToDashboard(); return; }
    var sub = step === 'reading' ? tr('Келесі: кітап оқу · 10 минут')
      : tr('Келесі: {name} · ≈{mins} мин', { name: nameOf(step), mins: Math.max(1, Math.round(secOf(step) / 60)) });
    showCard(tr('✓ {name} аяқталды', { name: nameOf(finishedId) }), sub, [
      { label: step === 'reading' ? tr('Кітап таңдау →') : tr('Бастау →'), primary: true, onClick: launchNext },
      { label: tr('Шығу'), onClick: exitToDashboard }
    ]);
  }
  function exitToDashboard() {
    clearValve(); hideCard();
    var fromReader = S.openStep === 'reading';
    if (fromReader) S.leftReading = true;                    // onDashboard білсін: оқудан шықтық, status сұрауын кешіктіреміз
    S.openStep = null;
    try { if (typeof playing !== 'undefined' && playing === true && typeof stop === 'function') stop(); } catch (e) { console.warn('[session] stop', e); }   // оқырман ▶ фонда жүрмесін (артқа көрсеткі де солай істейді)
    if (typeof window.showDashboard === 'function') window.showDashboard();
    if (fromReader) { try { if (typeof window.fbAskReading === 'function') window.fbAskReading(); } catch (e) {} }
  }

  /* ── UI: «Келесі» карточкасы, прогресс сызығы, клапан ── */
  function showCard(title, sub, buttons) {
    var box = root('tez-ses-next');
    box.textContent = '';
    box.appendChild(mk('div', 'tez-ses-title', title));
    if (sub) box.appendChild(mk('div', 'tez-ses-sub', sub));
    var row = mk('div', 'tez-ses-row');
    buttons.forEach(function (b) {
      var btn = mk('button', 'tez-ses-btn' + (b.primary ? '' : ' is-ghost'), b.label);
      btn.onclick = function () { b.onClick(); };
      row.appendChild(btn);
    });
    box.appendChild(row);
    box.classList.add('is-on');
  }
  function hideCard() { var b = $('tez-ses-next'); if (b) b.classList.remove('is-on'); }
  function renderLine() {
    if (!S.row || !S.plan) return;
    var line = root('tez-ses-line');
    line.textContent = '';
    var cur = S.openStep || Core.nextStep(S.plan, S.row.done || {});
    S.plan.forEach(function (id) {
      var seg = document.createElement('i');
      if (S.row.done && S.row.done[id]) seg.className = 'is-done';
      else if (id === cur) seg.className = 'is-cur';
      line.appendChild(seg);
    });
    line.classList.add('is-on');
  }
  function hideLine() { var l = $('tez-ses-line'); if (l) l.classList.remove('is-on'); }
  function armValve() {
    clearValve();
    if (!S.openStep || S.openStep === 'reading') return;
    var step = S.openStep;
    S.valveTimer = setTimeout(function () {
      if (S.openStep !== step) return;
      var box = root('tez-ses-valve');
      box.textContent = '';
      box.appendChild(mk('span', '', tr('Ақау бар ма?')));
      var b = mk('button', 'tez-ses-btn is-ghost', tr('Келесіге өту'));
      b.onclick = function () { S.openStep = null; markDone(step, true); };
      box.appendChild(b);
      box.classList.add('is-on');
    }, VALVE_MS);
  }
  function clearValve() {
    clearTimeout(S.valveTimer);
    var v = $('tez-ses-valve');
    if (v) v.classList.remove('is-on');
  }

  /* ── дашбордқа оралу хугі (index.html showDashboard-тан шақырады) ── */
  function onDashboard() {
    var wasReading = S.openStep === 'reading' || S.leftReading;
    S.leftReading = false;
    syncUser();
    S.openStep = null;
    clearValve(); hideCard(); hideLine();
    try { if (E.cleanupReading) E.cleanupReading(); } catch (e) {}
    document.body.classList.remove('tez-ses-on');
    if (S.loadedOnce) { try { renderCard(); } catch (e) {} }          // жергілікті күйден бірден көрсетеміз
    var go = function () { refresh().catch(function (e) { console.warn('[session] refresh', e); }); };
    if (wasReading) setTimeout(go, 1500); else go();                  // оқырманнан шыққанда соңғы жазба серверге жетіп үлгерсін
  }

  /* ── стиль ── */
  function injectStyle() {
    var st = document.createElement('style');
    st.id = 'tez-ses-style';
    st.textContent = [
      '.tez-ses { --s-panel:#fff; --s-border:#E4E3DD; --s-text:#1F1E1B; --s-text2:#57564F; --s-text3:#8A8980; --s-accent:#2A78D6; --s-accent-bg:#E6F1FB; --s-green:#2E7D4F; --s-green-bg:#E8F3EC; --s-tile:#F1F1EE; color:var(--s-text); box-sizing:border-box; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; }',
      '.tez-ses *, .tez-ses *::before, .tez-ses *::after { box-sizing:inherit; }',
      '#tez-ses-card { margin:0 0 16px; padding:18px 20px; background:var(--s-panel); border:1px solid var(--s-border); border-radius:14px; }',
      '#tez-ses-card.is-done { background:var(--s-green-bg); border-color:#BFDCC9; }',
      '.tez-ses-title { font-size:17px; font-weight:600; margin:0 0 4px; }',
      '.tez-ses-sub { font-size:14px; color:var(--s-text2); margin:0 0 12px; line-height:1.45; }',
      '.tez-ses-chips { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 14px; }',
      '.tez-ses-chip { font-size:13px; padding:4px 10px; border-radius:999px; background:var(--s-tile); color:var(--s-text2); }',
      '.tez-ses-chip.is-done { background:var(--s-green-bg); color:var(--s-green); }',
      '.tez-ses-chip.is-next { background:var(--s-accent-bg); color:var(--s-accent); font-weight:600; }',
      '.tez-ses-row { display:flex; flex-wrap:wrap; gap:8px; }',
      '.tez-ses-btn { display:inline-flex; align-items:center; justify-content:center; min-height:48px; padding:0 20px; border:0; border-radius:12px; background:var(--s-accent); color:#fff; font:inherit; font-size:16px; font-weight:600; cursor:pointer; }',
      '.tez-ses-btn:disabled { opacity:.5; cursor:default; }',
      '.tez-ses-btn.is-ghost { background:transparent; color:var(--s-text2); border:1px solid var(--s-border); }',
      '#tez-ses-line { position:fixed; top:0; left:0; right:0; height:4px; display:none; gap:3px; padding:0 6px; z-index:60; pointer-events:none; }',
      '#tez-ses-line.is-on { display:flex; }',
      '#tez-ses-line i { flex:1; border-radius:2px; background:rgba(0,0,0,.14); }',
      '#tez-ses-line i.is-done { background:var(--s-green); }',
      '#tez-ses-line i.is-cur { background:var(--s-accent); }',
      '#tez-ses-next { position:fixed; left:50%; top:calc(14px + env(safe-area-inset-top)); transform:translateX(-50%); width:calc(100% - 24px); max-width:440px; display:none; z-index:70; padding:14px 16px; background:var(--s-panel); border:1px solid var(--s-border); border-radius:14px; box-shadow:0 8px 28px rgba(0,0,0,.18); }',
      '#tez-ses-next.is-on { display:block; }',
      '#tez-ses-valve { position:fixed; left:50%; transform:translateX(-50%); bottom:calc(76px + env(safe-area-inset-bottom)); display:none; align-items:center; gap:10px; z-index:70; padding:10px 14px; background:var(--s-panel); border:1px solid var(--s-border); border-radius:12px; box-shadow:0 6px 20px rgba(0,0,0,.16); font-size:14px; }',
      '#tez-ses-valve.is-on { display:flex; }',
      '#tez-ses-valve .tez-ses-btn { min-height:40px; font-size:14px; padding:0 14px; }',
      '#tez-ses-toast { position:fixed; left:50%; transform:translateX(-50%); bottom:calc(24px + env(safe-area-inset-bottom)); display:none; z-index:75; padding:10px 16px; background:rgba(31,30,27,.9); color:#fff; border-radius:10px; font-size:14px; max-width:calc(100% - 24px); }',
      '#tez-ses-toast.is-on { display:block; }',
      '#tez-ses-chip { position:fixed; right:12px; top:calc(12px + env(safe-area-inset-top)); display:none; z-index:60; padding:6px 12px; border-radius:999px; background:rgba(31,30,27,.82); color:#fff; font-size:14px; font-variant-numeric:tabular-nums; pointer-events:none; }',
      '#tez-ses-chip.is-on { display:block; }',
      '#tez-ses-picker { position:fixed; inset:0; display:none; z-index:65; background:#F7F7F5; overflow-y:auto; }',
      '#tez-ses-picker.is-on { display:block; }',
      '.tez-ses-picker-in { max-width:520px; margin:0 auto; padding:calc(20px + env(safe-area-inset-top)) 16px calc(28px + env(safe-area-inset-bottom)); }',
      '.tez-ses-book { display:flex; align-items:center; gap:12px; padding:14px 16px; margin:0 0 10px; background:var(--s-panel); border:1px solid var(--s-border); border-radius:12px; cursor:pointer; }',
      '.tez-ses-book-t { font-size:16px; font-weight:600; word-break:break-word; }',
      '.tez-ses-book-m { font-size:13px; color:var(--s-text3); margin-top:4px; }',
      '.tez-ses-track { height:4px; background:var(--s-tile); border-radius:2px; margin-top:8px; }',
      '.tez-ses-track i { display:block; height:100%; background:var(--s-accent); border-radius:2px; }',
      '.tez-ses-go { color:var(--s-accent); font-weight:600; white-space:nowrap; }',
      'body.tez-ses-on #ew-skip { display:none !important; }',
      'body.tez-ses-on #timer-wrap { display:none !important; }',
      'body.tez-ses-on .chrome-pop-label:has(+ #timer-wrap) { display:none !important; }'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ── іске қосу ── */
  E = {
    S: S, call: call, callRetry: callRetry, mk: mk, root: root, renderLine: renderLine,
    showCard: showCard, hideCard: hideCard, exitToDashboard: exitToDashboard, toast: toast,
    flushPending: flushPending, mergeRow: mergeRow, handleDayChanged: handleDayChanged, LAG_AFTER: LAG_AFTER,
    openReading: null, cleanupReading: null, pollStatus: null
  };
  injectStyle();
  scanPool();
  document.addEventListener('visibilitychange', function () {       // қолданба түні бойы ашық тұрса, күн ауысқанда карточка жаңарады
    if (document.visibilityState !== 'visible' || S.openStep !== null || !authUser) return;
    var d = $('dashboard');
    if (d && d.style.display === 'block') refresh().catch(function () {});
  });
  window.TezSession = { onDashboard: onDashboard, start: start, rescan: scanPool, _E: E, _S: S, _Core: Core };
})();

/* ═══ 3. ОҚУ ҚАДАМЫ: кітап таңдау, ▶ уақытын санау, аяқтау ═══ */
(function () {
  'use strict';
  if (window.__TEZ_SESSION_TEST__ || !window.TezSession) return;
  var E = window.TezSession._E, S = E.S, Core = window.TezSession._Core;
  var tick = 0, lastPoll = 0, wasPlaying = false, observer = null, lastPos = 0, lagWarned = false;

  function byId(id) { return document.getElementById(id); }
  function readerVisible() { var a = byId('app'); return !!a && a.style.display === 'block'; }
  function closePicker() { var p = byId('tez-ses-picker'); if (p) p.classList.remove('is-on'); }
  function hideChip() { var c = byId('tez-ses-chip'); if (c) c.classList.remove('is-on'); }

  // Чипті оқырман құралдар жолағының түймелерін (Aa, ⚡, бетбелгі) жаппайтындай орналастырады.
  function placeChip(chip) {
    var app = byId('app'), tb = byId('chrome-top'), act = byId('chrome-top-actions'), back = byId('back-to-dash');
    chip.style.left = 'auto'; chip.style.right = '12px'; chip.style.top = '';       // әдепкі: оң жақ жоғарыда
    if (!app || !tb || !act || !back || app.classList.contains('fs-mode')) return;   // жолақ жасырын болса, әдепкі орын
    var tbr = tb.getBoundingClientRect(), br = back.getBoundingClientRect(), ar = act.getBoundingClientRect();
    var w = chip.offsetWidth, h = chip.offsetHeight, left = br.right + 10;
    if (ar.left - 10 - left >= w) {                    // жолақтағы бос орынға сыяды
      chip.style.left = left + 'px'; chip.style.right = 'auto';
      chip.style.top = Math.round(tbr.top + (tbr.height - h) / 2) + 'px';
    } else {                                           // сыймаса: жолақтың астында, оң жақта
      chip.style.top = Math.round(tbr.bottom + 6) + 'px';
    }
  }
  function renderChip() {
    var chip = E.root('tez-ses-chip');
    var completed = !!(S.row && S.row.completed_at);
    var shown = Core.readingShown(S.srvRead, S.readBase, S.localRead, completed);
    chip.textContent = Core.fmtMMSS(shown) + ' / 10:00' + (completed ? ' ✓' : '');
    var on = S.openStep === 'reading' && readerVisible();
    chip.classList.toggle('is-on', on);
    if (on) placeChip(chip);
  }

  function bookTitle() {                    // жеке кітап атауы серверге/мұғалімге жіберілмейді
    if (typeof currentBookPrivate !== 'undefined' && currentBookPrivate === true) return 'Жеке кітап';
    return typeof currentFileName === 'string' ? currentFileName : '';
  }

  function pollStatus() {
    lastPoll = Date.now();
    if (Object.keys(S.pending).length) E.flushPending();      // reading_since жоқ болса, сақталмаған қадамдарды қайта жібереміз
    return E.call('session_status', { p_book: bookTitle() }).then(function (r) {
      if (!r.ok) return;
      if (!r.data) { if (S.openStep === 'reading') E.handleDayChanged(); return; }   // бүгінгі жол жоқ: күн ауысты
      var wasDone = !!(S.row && S.row.completed_at);
      S.row = E.mergeRow(S.row, r.data);
      S.srvRead = r.data.read_seconds || 0;
      if (!wasDone && r.data.completed_at) onCompleted();
    });
  }

  function onCompleted() {
    renderChip();
    E.renderLine();
    E.showCard(tr('✓ Күн есепке кірді'), tr('Бүгінгі 15 минут орындалды. Қаласаңыз, оқуды жалғастыра беріңіз.'), [
      { label: tr('Аяқтау'), primary: true, onClick: E.exitToDashboard },
      { label: tr('Оқуды жалғастыру'), onClick: E.hideCard }
    ]);
  }

  function startWatch() {
    clearInterval(tick);
    S.localRead = 0;
    S.readBase = S.srvRead || 0;
    lastPoll = Date.now();
    wasPlaying = false;
    lagWarned = false;
    lastPos = typeof pos === 'number' ? pos : 0;
    tick = setInterval(function () {
      var completed = !!(S.row && S.row.completed_at);
      var nowPlaying = typeof playing !== 'undefined' && playing === true;
      var p = typeof pos === 'number' ? pos : lastPos;
      if (S.openStep === 'reading' && !completed && nowPlaying) {            // жергілікті бағалау сервердің формуласымен: сөз ÷ WPM
        var wpm = typeof getWPM === 'function' ? getWPM() : 0;
        if (p > lastPos && wpm > 0) S.localRead += (p - lastPos) / wpm * 60;
      }
      lastPos = p;
      if (!lagWarned && !completed && nowPlaying && S.localRead >= E.LAG_AFTER && (S.readBase + S.localRead) - S.srvRead > E.LAG_AFTER / 2) {
        lagWarned = true;
        E.toast(tr('Оқу минуты сервермен сәйкеспей тұр. Кітаптың бұлтқа жүктелуін күтіңіз немесе кітапты қайта ашыңыз.'));
      }
      if (wasPlaying && !nowPlaying && S.openStep === 'reading') setTimeout(pollStatus, 1500);   // ▶ тоқтағанда жазба жазылып үлгерсін
      wasPlaying = nowPlaying;
      renderChip();
      if (S.openStep !== 'reading' || completed) return;
      var gap = Date.now() - lastPoll;
      var est = S.readBase + S.localRead;
      if (gap >= 15000 || (est >= Core.READ_GOAL_SEC && gap >= 5000)) pollStatus();
    }, 1000);
  }

  function watchReader() {                  // оқырман ашылса (таңдаудан немесе жаңа кітап жүктеуден) таңдау экранын жабады
    if (observer) return;
    var app = byId('app');
    if (!app) return;
    observer = new MutationObserver(function () {
      if (S.openStep === 'reading' && readerVisible()) {
        closePicker();
        if (!tick) startWatch();
      }
      renderChip();
    });
    observer.observe(app, { attributes: true, attributeFilter: ['style'] });
  }

  function collectBooks() {
    var cloudP = typeof window.loadCloudBooks === 'function' ? window.loadCloudBooks().catch(function () { return []; }) : Promise.resolve([]);
    var keysP = typeof window.idbAllTextKeys === 'function' ? window.idbAllTextKeys().catch(function () { return new Set(); }) : Promise.resolve(new Set());
    return Promise.all([cloudP, keysP]).then(function (res) {
      var cloud = res[0] || [], keys = res[1] || new Set(), out = [];
      function prog(b) { return Array.isArray(b.reading_progress) ? b.reading_progress[0] : b.reading_progress; }
      function ts(b) { var p = prog(b); return Date.parse((p && p.updated_at) || b.created_at || '') || 0; }
      cloud.slice().sort(function (a, b) { return ts(b) - ts(a); }).forEach(function (b) {
        var p = prog(b);
        var pct = p && b.total_words ? Math.min(100, Math.round(p.position / b.total_words * 100)) : 0;
        out.push({ title: b.filename, pct: pct, meta: tr('Бұлт'), open: function () { window.openCloudBook(b); } });
      });
      if (typeof window.lsAllBooks === 'function') window.lsAllBooks().forEach(function (name) {
        var p = window.lsLoadProgress(name);
        if (!p || !p.private || !keys.has(name)) return;
        out.push({ title: name, pct: p.total ? Math.round(p.pos / p.total * 100) : 0, meta: tr('Жеке · осы құрылғыда'), open: function () { window.loadFromCache(name); } });
      });
      var cur = typeof currentFileName === 'string' ? currentFileName : '';
      out.sort(function (a, b) { return (b.title === cur) - (a.title === cur); });          // соңғы ашылған кітап жоғарыда
      return out;
    });
  }

  function openPicker() {
    S.openStep = 'reading';
    S.openSince = Date.now();
    document.body.classList.add('tez-ses-on');
    E.renderLine();
    var box = E.root('tez-ses-picker');
    box.textContent = '';
    var inner = E.mk('div', 'tez-ses-picker-in');
    inner.appendChild(E.mk('div', 'tez-ses-title', tr('Не оқимыз?')));
    inner.appendChild(E.mk('div', 'tez-ses-sub', tr('Кітапты таңдаңыз. Минут тек ▶ басып оқығанда есептеледі: 10 минут жинағанда күн есепке кіреді.')));
    var list = E.mk('div', 'tez-ses-books');
    list.appendChild(E.mk('div', 'tez-ses-sub', tr('Жүктелуде…')));
    inner.appendChild(list);
    var actions = E.mk('div', 'tez-ses-row');
    var add = E.mk('button', 'tez-ses-btn is-ghost', tr('+ Жаңа кітап қосу'));
    add.onclick = function () { var f = byId('file-input'); if (f) f.click(); };
    var exit = E.mk('button', 'tez-ses-btn is-ghost', tr('Шығу'));
    exit.onclick = function () { E.exitToDashboard(); };
    actions.appendChild(add);
    actions.appendChild(exit);
    inner.appendChild(actions);
    box.appendChild(inner);
    box.classList.add('is-on');
    watchReader();
    collectBooks().then(function (items) {
      list.textContent = '';
      if (!items.length) { list.appendChild(E.mk('div', 'tez-ses-sub', tr('Әлі кітап жоқ. «Жаңа кітап қосу» батырмасын басыңыз.'))); return; }
      items.forEach(function (it) {
        var row = E.mk('div', 'tez-ses-book');
        var left = E.mk('div', '');
        left.style.flex = '1';
        left.style.minWidth = '0';
        left.appendChild(E.mk('div', 'tez-ses-book-t', it.title));
        var track = E.mk('div', 'tez-ses-track');
        var fill = document.createElement('i');
        fill.style.width = it.pct + '%';
        track.appendChild(fill);
        left.appendChild(track);
        left.appendChild(E.mk('div', 'tez-ses-book-m', tr('{pct}% оқылды', { pct: it.pct }) + ' · ' + it.meta));
        row.appendChild(left);
        row.appendChild(E.mk('div', 'tez-ses-go', tr('Оқу →')));
        row.onclick = function () { startWatch(); it.open(); };
        list.appendChild(row);
      });
    });
  }

  function cleanup() { clearInterval(tick); tick = 0; closePicker(); hideChip(); }

  E.openReading = openPicker;
  E.cleanupReading = cleanup;
  E.pollStatus = pollStatus;
})();
