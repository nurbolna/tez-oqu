/* Тез Оқу — күнделікті еске салу (reminder.js): уақыт таңдау терезесі + профиль карточкасы.
   Классикалық скрипт: onboarding.js-тен кейін жүктеледі. Жүктелмесе сайт бұрынғыша жұмыс істейді.
   Спек: «Еске салу — спецификация.md». Сервер: reminder.sql (RPC), tg-remind (растау хабарламасы).
   Ілмектер: index.html showDashboard → maybePrompt() (сайтқа кіргенде, 1,5 с кейін), dashNavGo('profile') → renderProfileCard(). */
(function () {
  'use strict';
  if (typeof window.tr !== 'function') window.tr = function (k, p) { return p ? k.replace(/\{(\w+)\}/g, function (m, n) { return p[n] !== undefined ? p[n] : m; }) : k; };

  var SLOTS = [                            // атаулар жүктелгенде бір рет аударылады (tr i18n.ru.js-тен кейін бар)
    { min: 450, label: tr('таңертең') },
    { min: 900, label: tr('сабақтан соң') },
    { min: 1080, label: tr('кешке') },
    { min: 1200, label: tr('кешке') },
    { min: 1290, label: tr('ұйқы алдында') }
  ];
  var DEFAULT_MINUTE = 1200;
  var BOT_URL = 'https://t.me/TezOqu_Bot';
  var S = { st: null, busy: false, promptShown: false, confirmTimer: null };

  /* ── таза функциялар ── */
  function fmtMinute(min) {
    return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0');
  }
  function shouldPrompt(state) { return !!(state && !state.prompted); }   // таңдау жасағанша (Сақтау / Еске салмаңыз) әр кіргенде
  function isSlot(min) { return SLOTS.some(function (s) { return s.min === min; }); }

  /* ── сервер ── */
  function client() { try { return typeof sb !== 'undefined' ? sb : null; } catch (e) { return null; } }
  function load() {
    var c = client(); if (!c) return Promise.resolve(null);
    return c.rpc('reminder_get').then(function (r) {
      if (!r || r.error || !r.data) return null;
      S.st = r.data; return S.st;
    }, function () { return null; });
  }
  function save(enabled, minute) {
    var c = client(); if (!c) return Promise.reject(new Error('no client'));
    return c.rpc('reminder_set', { p_enabled: enabled, p_minute: minute }).then(function (r) {
      if (!r || r.error || !r.data) throw new Error((r && r.error && r.error.message) || 'save failed');
      S.st = r.data; return S.st;
    });
  }
  function confirm() {                       // соңғы сақтаудан CONFIRM_DELAY кейін бір рет: бот ескі уақытты айтпайды
    clearTimeout(S.confirmTimer);
    S.confirmTimer = setTimeout(sendConfirm, api.core.CONFIRM_DELAY);
  }
  function sendConfirm() {                   // бот растау хабарламасын жібереді; жауабын күтпейміз
    var c = client(); if (!c) return;
    try {
      var url = typeof SUPABASE_URL !== 'undefined' ? SUPABASE_URL : '';
      var anon = typeof SUPABASE_ANON_KEY !== 'undefined' ? SUPABASE_ANON_KEY : '';
      c.auth.getSession().then(function (r) {
        var tok = r && r.data && r.data.session && r.data.session.access_token;
        if (!tok || !url) return;
        return fetch(url + '/functions/v1/tg-remind', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, apikey: anon },
          body: JSON.stringify({ action: 'confirm' })
        });
      }).catch(function () {});
    } catch (e) {}
  }

  /* ── батырмалар тобы (терезе мен профильде ортақ) ── */
  function chipsHtml(sel) {
    var h = SLOTS.map(function (s) {
      return '<button type="button" class="tez-rem-chip' + (s.min === sel ? ' is-on' : '') + '" data-min="' + s.min + '"><b>' +
        fmtMinute(s.min) + '</b><small>' + s.label + '</small></button>';
    }).join('');
    var custom = sel !== null && sel !== undefined && !isSlot(sel);
    return h + '<button type="button" class="tez-rem-chip' + (custom ? ' is-on' : '') + '" data-other><b>' +
      (custom ? fmtMinute(sel) : '<i class="ti ti-clock"></i>') + '</b><small>' + tr('басқа') + '</small>' +
      '<select aria-label="' + tr('Басқа уақыт') + '">' + timeOptions(custom ? sel : null) + '</select></button>';
  }
  function timeOptions(sel) {                // 00:00 … 23:45, 15 минут қадам (iOS/Android/компьютерде өз тізімі ашылады)
    var h = '<option value=""' + (sel === null ? ' selected' : '') + '></option>';
    for (var m = 0; m < 1440; m += 15) h += '<option value="' + m + '"' + (m === sel ? ' selected' : '') + '>' + fmtMinute(m) + '</option>';
    return h;
  }
  function markChip(grid, min) {             // таңдауды көрсетеді; «басқа» батырмасында уақытты жазады
    var custom = min !== null && min !== undefined && !isSlot(min);
    Array.prototype.forEach.call(grid.querySelectorAll('.tez-rem-chip'), function (b) {
      var on = b.hasAttribute('data-other') ? custom : +b.getAttribute('data-min') === min;
      b.classList.toggle('is-on', on);
      if (b.hasAttribute('data-other')) {
        b.querySelector('b').innerHTML = custom ? fmtMinute(min) : '<i class="ti ti-clock"></i>';
        b.querySelector('select').value = custom ? String(min) : '';   // сол уақытты қайта таңдағанда да change болады
      }
    });
  }
  function bindChips(grid, onPick) {
    grid.addEventListener('click', function (e) {
      var b = e.target.closest('.tez-rem-chip');
      if (!b || b.hasAttribute('data-other')) return;  // «басқа» — үстіндегі мөлдір select өз тізімін ашады
      onPick(+b.getAttribute('data-min'));
    });
    var sel = grid.querySelector('.tez-rem-chip[data-other] select');
    if (sel) sel.addEventListener('change', function () { if (sel.value !== '') onPick(+sel.value); });
  }

  /* ── хабар ── */
  function toast(text) {
    var t = document.getElementById('tez-rem-toast');
    if (!t) { t = document.createElement('div'); t.id = 'tez-rem-toast'; document.body.appendChild(t); }
    t.textContent = text;
    t.classList.add('is-on');
    clearTimeout(t._h);
    t._h = setTimeout(function () { t.classList.remove('is-on'); }, 2000);
  }

  /* ── терезе ── */
  function closeModal() { var m = document.getElementById('tez-rem-modal'); if (m) m.remove(); }
  function openModal(st) {
    injectStyle();
    var m = document.createElement('div');
    m.id = 'tez-rem-modal';
    m.className = 'tez-rem';
    m.setAttribute('role', 'dialog');
    m.setAttribute('aria-modal', 'true');
    m.setAttribute('aria-labelledby', 'tez-rem-title');
    var head = '<div class="tez-rem-ico"><i class="ti ti-bell"></i></div>' +
      '<div id="tez-rem-title" class="tez-rem-title">' + tr('Күнделікті еске салу') + '</div>';
    if (st.tg_linked) {
      m.innerHTML = '<div class="tez-rem-box">' + head +
        '<div class="tez-rem-sub">' + tr('15 минуттық жаттығуды Telegram-да қай уақытта еске салайық?') + '</div>' +
        '<div class="tez-rem-grid">' + chipsHtml(DEFAULT_MINUTE) + '</div>' +
        '<div class="tez-rem-err" id="tez-rem-err"></div>' +
        '<button type="button" class="tez-rem-btn" id="tez-rem-save">' + tr('Сақтау') + '</button>' +
        '<button type="button" class="tez-rem-link" id="tez-rem-skip">' + tr('Еске салмаңыз') + '</button></div>';
    } else {
      m.innerHTML = '<div class="tez-rem-box">' + head +
        '<div class="tez-rem-sub">' + tr('Еске салу Telegram арқылы келеді. Алдымен ботқа қосылыңыз.') + '</div>' +
        '<a class="tez-rem-btn" id="tez-rem-bot" href="' + BOT_URL + '" target="_blank" rel="noopener"><i class="ti ti-brand-telegram"></i> ' + tr('Ботты ашу') + '</a>' +
        '<button type="button" class="tez-rem-link" id="tez-rem-later">' + tr('Кейінірек') + '</button></div>';
    }
    document.body.appendChild(m);

    if (!st.tg_linked) {
      var later = function () { closeModal(); var c = client(); if (c) c.rpc('reminder_mark_prompted').then(null, function () {}); };
      m.querySelector('#tez-rem-later').onclick = later;
      m.querySelector('#tez-rem-bot').addEventListener('click', later);
      return;
    }
    var sel = DEFAULT_MINUTE, grid = m.querySelector('.tez-rem-grid'), err = m.querySelector('#tez-rem-err');
    bindChips(grid, function (min) { sel = min; markChip(grid, min); });
    var saveBtn = m.querySelector('#tez-rem-save'), skipBtn = m.querySelector('#tez-rem-skip');
    saveBtn.onclick = function () {
      saveBtn.disabled = skipBtn.disabled = true; err.textContent = '';
      save(true, sel).then(function () {
        closeModal(); toast(tr('✓ Сақталды')); confirm();
      }, function () {
        saveBtn.disabled = skipBtn.disabled = false;
        err.textContent = tr('Сақталмады. Интернетті тексеріңіз.');
      });
    };
    skipBtn.onclick = function () {
      closeModal();
      save(false, null).then(null, function () {});   // сәтсіз болса, терезе келесі жолы қайта шығады
    };
  }

  function screenFree() {                    // тек дашборд көрініп тұрғанда және үстінде басқа терезе жоқ кезде
    var d = document.getElementById('dashboard'), fb = document.getElementById('fb-sheet'), au = document.getElementById('auth-overlay');
    return !!d && d.style.display === 'block' &&
      !document.body.classList.contains('tez-ses-on') &&
      !document.getElementById('tz-ob') &&
      !document.getElementById('tez-rem-modal') &&
      !(fb && fb.classList.contains('open')) &&
      !(au && au.classList.contains('show'));
  }
  function maybePrompt() {
    if (S.busy || S.promptShown || (S.st && S.st.prompted) || !screenFree()) return Promise.resolve(false);   // таңдап қойған оқушы үшін сервер сұралмайды
    S.busy = true;
    return load().then(function (st) {
      S.busy = false;
      if (!shouldPrompt(st) || !screenFree()) return false;   // жүктеу кезінде экран ауысса, келесі дашбордта қайта тексеріледі
      S.promptShown = true;
      openModal(st);
      return true;
    }, function () { S.busy = false; return false; });
  }

  /* ── профиль карточкасы ── */
  function renderProfileCard() {
    var card = document.getElementById('pf-reminder-card');
    if (!card) return Promise.resolve();
    injectStyle();
    card.innerHTML = '<div class="pf-card-title">' + tr('Күнделікті еске салу') + '</div><div class="pf-hint">' + tr('Жүктелуде…') + '</div>';
    return load().then(function (st) {
      if (!st) {
        card.innerHTML = '<div class="pf-card-title">' + tr('Күнделікті еске салу') + '</div><div class="pf-hint">' + tr('Жүктелмеді. Интернетті тексеріңіз.') + '</div>';
        return;
      }
      if (!st.tg_linked) {
        card.innerHTML = '<div class="pf-card-title">' + tr('Күнделікті еске салу') + '</div>' +
          '<div class="pf-hint">' + tr('Еске салу Telegram арқылы келеді. Алдымен ботқа қосылыңыз.') + '</div>' +
          '<a class="dash-btn-primary tez-rem-botlink" href="' + BOT_URL + '" target="_blank" rel="noopener"><i class="ti ti-brand-telegram"></i> ' + tr('Ботты ашу') + '</a>';
        return;
      }
      card.innerHTML = '<div class="pf-card-title tez-rem-head"><span>' + tr('Күнделікті еске салу') + '</span>' +
        '<label class="tez-rem-switch"><input type="checkbox" id="tez-rem-toggle" aria-label="' + tr('Күнделікті еске салу') + '"><span></span></label></div>' +
        '<div class="pf-hint">' + tr('Telegram-да күн сайын') + '</div>' +
        '<div class="tez-rem-grid">' + chipsHtml(st.minute) + '</div>' +
        '<div class="tez-rem-status" id="tez-rem-status"></div>';
      var grid = card.querySelector('.tez-rem-grid'), tg = card.querySelector('#tez-rem-toggle'), status = card.querySelector('#tez-rem-status');
      function paint(s) { tg.checked = !!s.enabled; grid.classList.toggle('is-off', !s.enabled); markChip(grid, s.minute); }
      function apply(enabled, minute) {
        var prev = { enabled: S.st.enabled, minute: S.st.minute };
        paint({ enabled: enabled, minute: minute });
        status.textContent = ''; status.classList.remove('is-err');
        save(enabled, minute).then(function (s) {
          paint(s);
          status.textContent = tr('✓ Сақталды');
          clearTimeout(status._h); status._h = setTimeout(function () { status.textContent = ''; }, 2000);
          confirm();
        }, function () {
          paint(prev);
          status.textContent = tr('Сақталмады. Интернетті тексеріңіз.');
          status.classList.add('is-err');
        });
      }
      paint(st);
      bindChips(grid, function (min) { apply(true, min); });
      tg.addEventListener('change', function () {
        if (tg.checked) apply(true, S.st.minute !== null && S.st.minute !== undefined ? S.st.minute : DEFAULT_MINUTE);
        else apply(false, S.st.minute);
      });
    });
  }

  /* ── стиль (дашборд палитрасы: ақ панель, көк акцент) ── */
  function injectStyle() {
    if (document.getElementById('tez-rem-style')) return;
    var st = document.createElement('style');
    st.id = 'tez-rem-style';
    st.textContent = [
      '.tez-rem { position:fixed; inset:0; z-index:8500; background:rgba(31,30,27,.45); display:flex; align-items:center; justify-content:center; padding:16px; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }',
      '.tez-rem-box { width:100%; max-width:360px; background:#fff; color:#1F1E1B; border-radius:16px; padding:22px 18px 14px; text-align:center; box-sizing:border-box; }',
      '.tez-rem-ico { font-size:30px; color:#2A78D6; line-height:1; }',
      '.tez-rem-title { font-size:18px; font-weight:600; margin:6px 0 4px; }',
      '.tez-rem-sub { font-size:14px; color:#57564F; line-height:1.45; margin:0 0 14px; }',
      '.tez-rem-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }',
      '.tez-rem-grid.is-off { opacity:.55; }',
      '.tez-rem-chip { position:relative; font:inherit; border:1px solid #E4E3DD; background:#F1F1EE; color:#1F1E1B; border-radius:10px; padding:8px 4px; cursor:pointer; display:flex; flex-direction:column; align-items:center; gap:2px; min-height:52px; justify-content:center; }',
      '.tez-rem-chip b { font-size:15px; font-weight:600; }',
      '.tez-rem-chip small { font-size:11px; color:#57564F; }',
      '.tez-rem-chip.is-on { background:#E6F1FB; border-color:#2A78D6; color:#1F63B8; }',
      '.tez-rem-chip.is-on small { color:#1F63B8; }',
      '.tez-rem-chip select { position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:pointer; border:0; padding:0; margin:0; font-size:16px; -webkit-appearance:none; appearance:none; }',
      '.tez-rem-btn { display:flex; align-items:center; justify-content:center; gap:6px; width:100%; margin-top:14px; min-height:46px; border:0; border-radius:10px; background:#2A78D6; color:#fff; font:inherit; font-size:15px; font-weight:600; cursor:pointer; text-decoration:none; box-sizing:border-box; }',
      '.tez-rem-btn:disabled { opacity:.6; }',
      '.tez-rem-link { display:block; width:100%; margin-top:6px; padding:10px; border:0; background:none; color:#57564F; font:inherit; font-size:14px; text-decoration:underline; cursor:pointer; }',
      '.tez-rem-err { font-size:13px; color:#C0392B; min-height:0; margin-top:8px; }',
      '.tez-rem-err:empty { display:none; }',
      '#tez-rem-toast { position:fixed; left:50%; bottom:calc(96px + env(safe-area-inset-bottom)); transform:translateX(-50%); background:#1F1E1B; color:#fff; padding:9px 16px; border-radius:20px; font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; z-index:8600; opacity:0; pointer-events:none; transition:opacity .2s; }',
      '#tez-rem-toast.is-on { opacity:1; }',
      '#pf-reminder-card .tez-rem-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }',
      '#pf-reminder-card .pf-hint { margin-bottom:10px; }',
      '#pf-reminder-card .tez-rem-status { font-size:13px; color:#2E7D4F; min-height:18px; margin-top:8px; }',
      '#pf-reminder-card .tez-rem-status.is-err { color:#C0392B; }',
      '.tez-rem-switch { position:relative; width:44px; height:26px; flex-shrink:0; }',
      '.tez-rem-switch input { position:absolute; inset:0; opacity:0; margin:0; cursor:pointer; z-index:1; }',
      '.tez-rem-switch span { position:absolute; inset:0; background:#D3D2C9; border-radius:13px; transition:background .2s; }',
      '.tez-rem-switch span::after { content:""; position:absolute; left:3px; top:3px; width:20px; height:20px; border-radius:50%; background:#fff; transition:transform .2s; }',
      '.tez-rem-switch input:checked + span { background:#2A78D6; }',
      '.tez-rem-switch input:checked + span::after { transform:translateX(18px); }'
    ].join('\n');
    document.head.appendChild(st);
  }

  var api = window.TezReminder = {
    maybePrompt: maybePrompt,
    renderProfileCard: renderProfileCard,
    core: { SLOTS: SLOTS, DEFAULT_MINUTE: DEFAULT_MINUTE, CONFIRM_DELAY: 3000, fmtMinute: fmtMinute, shouldPrompt: shouldPrompt },
    _reset: function () { S.st = null; S.busy = false; S.promptShown = false; clearTimeout(S.confirmTimer); closeModal(); }   // тек тесттер үшін
  };
})();
