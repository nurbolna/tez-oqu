/* Тез Оқу — танысу экраны (онбординг): 5 анимациялы слайд + оқырманды бірінші ашқандағы 3 кеңес (onboarding.js).
   Классикалық скрипт: session.js-тен кейін, </body> алдында жүктеледі. Жүктелмесе сайт бұрынғыша жұмыс істейді.
   Спек: «Танысу экраны (онбординг) — спецификация.md».
   index.html-дегі ілмектер (бәрі try/catch ішінде): showDashboard → maybeShow(), hideAllViews → close(),
   showReaderView → readerHints(), Профиль → open(). */
(function () {
  'use strict';
  if (typeof window.tr !== 'function') window.tr = function (k, p) { return p ? k.replace(/\{(\w+)\}/g, function (m, n) { return p[n] !== undefined ? p[n] : m; }) : k; };

  var VERSION = 1;
  var SHOW_DELAY = 600;           // дашборд сызылып, логин қалпына келіп үлгерсін
  var READER_DELAY = 900;         // кітап мәтіні жүктеліп, toolbar орнына тұрсын
  var LS_KEY = 'tezOnboarding_';
  var reduced = false;
  try { reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
  var forced = false;
  try {
    var qs = new URLSearchParams(location.search);
    if (qs.get('onboarding') === '1') {
      forced = true;
      qs.delete('onboarding');
      history.replaceState(null, '', location.pathname + (qs.toString() ? '?' + qs : '') + location.hash);
    }
  } catch (e) {}

  /* ── белгі: user_metadata.onboarding (+ localStorage көшірмесі) ── */
  function user() { try { return typeof authUser !== 'undefined' ? authUser : null; } catch (e) { return null; } }
  function readFlag() {
    var u = user(); if (!u) return {};
    var meta = (u.user_metadata && u.user_metadata.onboarding) || {};
    var local = {};
    try { local = JSON.parse(localStorage.getItem(LS_KEY + u.id) || '{}') || {}; } catch (e) {}
    var f = {};
    [local, meta].forEach(function (o) { for (var k in o) if (o[k] !== undefined && o[k] !== null) f[k] = o[k]; });
    if (local.reader) f.reader = true;
    if ((local.v || 0) > (meta.v || 0)) { f.v = local.v; f.done = local.done; f.slide = local.slide; }
    return f;
  }
  function writeFlag(patch) {
    var u = user(); if (!u) return;
    var f = readFlag();
    for (var k in patch) f[k] = patch[k];
    try { localStorage.setItem(LS_KEY + u.id, JSON.stringify(f)); } catch (e) {}
    u.user_metadata = u.user_metadata || {};
    u.user_metadata.onboarding = f;
    try {
      if (typeof sb !== 'undefined' && sb && sb.auth) sb.auth.updateUser({ data: { onboarding: f } }).catch(function () {});
    } catch (e) {}
  }

  /* ── таймерлер: жаңа слайд ашылса, ескі анимация тоқтайды ── */
  var gen = 0, timers = [];
  function later(fn, ms) { var g = gen; timers.push(setTimeout(function () { if (g === gen) fn(); }, ms)); }
  function stopAnims() { gen++; timers.forEach(clearTimeout); timers = []; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  /* ── стиль ── */
  function injectStyle() {
    if ($('tz-ob-style')) return;
    var st = document.createElement('style');
    st.id = 'tz-ob-style';
    st.textContent = [
      '.tz-ob { --o-bg:#F7F7F5; --o-panel:#fff; --o-border:#E4E3DD; --o-border2:#D3D2C9; --o-text:#1F1E1B; --o-text2:#57564F; --o-text3:#8A8980; --o-accent:#2A78D6; --o-accent-bg:#E6F1FB; --o-green:#2E7D4F; --o-green-bg:#E8F3EC; --o-tile:#F1F1EE; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif; color:var(--o-text); box-sizing:border-box; }',
      '.tz-ob *, .tz-ob *::before, .tz-ob *::after { box-sizing:inherit; }',
      '#tz-ob { position:fixed; inset:0; z-index:9000; background:var(--o-bg); display:flex; justify-content:center; opacity:0; transition:opacity .25s; touch-action:pan-y; }',
      '#tz-ob.open { opacity:1; }',
      '#tz-ob-col { width:100%; max-width:440px; height:100%; display:flex; flex-direction:column; padding:calc(14px + env(safe-area-inset-top)) 22px calc(22px + env(safe-area-inset-bottom)); }',
      '#tz-ob-top { display:flex; justify-content:flex-end; min-height:28px; }',
      '#tz-ob-skip { background:none; border:none; font:inherit; font-size:14px; color:var(--o-text3); cursor:pointer; padding:4px 6px; }',
      '#tz-ob-body { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; text-align:center; min-height:0; }',
      '#tz-ob-anim { width:100%; min-height:200px; display:flex; align-items:center; justify-content:center; }',
      '#tz-ob-title { font-size:22px; font-weight:600; margin:22px 0 8px; line-height:1.25; }',
      '#tz-ob-text { font-size:15px; line-height:1.5; color:var(--o-text2); margin:0; max-width:320px; }',
      '#tz-ob-dots { display:flex; justify-content:center; gap:6px; margin:0 0 18px; }',
      '#tz-ob-dots span { width:7px; height:7px; border-radius:4px; background:var(--o-border2); transition:all .3s; }',
      '#tz-ob-dots span.on { width:20px; background:var(--o-accent); }',
      '.tz-ob-btn { width:100%; height:48px; border:none; border-radius:12px; background:var(--o-accent); color:#fff; font:inherit; font-size:16px; font-weight:500; cursor:pointer; }',
      '.tz-ob-btn.pulse { animation:tzObPulse 1.6s ease-in-out infinite; }',
      '#tz-ob-later { display:block; margin:12px auto 0; background:none; border:none; font:inherit; font-size:14px; color:var(--o-text2); cursor:pointer; }',
      '@keyframes tzObPulse { 0%,100% { transform:scale(1); } 50% { transform:scale(1.04); } }',
      /* 1-слайд: сөздер */
      '.tz-ob-words { font-size:17px; line-height:1.9; max-width:280px; }',
      '.tz-ob-w { padding:1px 1px; border-radius:5px; transition:background .15s, color .15s; }',
      '.tz-ob-w.hl { background:var(--o-accent-bg); color:var(--o-accent); }',
      '.tz-ob-wpm { margin-top:16px; font-size:13px; color:var(--o-text2); }',
      '.tz-ob-wpm b { font-size:26px; font-weight:600; color:var(--o-text); margin-left:4px; }',
      /* 2-слайд: уақыт сызығы */
      '.tz-ob-line { display:flex; gap:3px; height:14px; border-radius:7px; overflow:hidden; background:var(--o-tile); }',
      '.tz-ob-seg { width:0; background:var(--o-accent); transition:width .7s ease-out; }',
      '.tz-ob-lbls { display:flex; margin-top:12px; }',
      '.tz-ob-lbl { min-width:64px; font-size:13px; opacity:0; transition:opacity .3s; }',
      '.tz-ob-lbl i { font-size:22px; }',
      '.tz-ob-lbl span { display:block; color:var(--o-text2); }',
      '.tz-ob-total { margin-top:16px; font-size:16px; font-weight:600; color:var(--o-green); opacity:0; transition:opacity .3s; }',
      /* 3-слайд: Шульте */
      '.tz-ob-grid { display:grid; grid-template-columns:repeat(3,52px); gap:7px; }',
      '.tz-ob-cell { width:52px; height:52px; border:1px solid var(--o-border2); border-radius:9px; background:var(--o-panel); display:flex; align-items:center; justify-content:center; font-size:20px; transition:all .25s; }',
      '.tz-ob-cell.ok { background:var(--o-green-bg); color:var(--o-green); border-color:#BFDCC9; }',
      /* 4-слайд: оқырман макеті */
      '.tz-ob-reader { width:240px; background:var(--o-panel); border:1px solid var(--o-border2); border-radius:14px; padding:12px 14px; text-align:left; }',
      '.tz-ob-rtop { display:flex; justify-content:space-between; font-size:18px; }',
      '.tz-ob-rtop i, .tz-ob-play { border-radius:8px; transition:box-shadow .25s, transform .15s; padding:2px; }',
      '.tz-ob-ring { box-shadow:0 0 0 3px var(--o-accent); }',
      '.tz-ob-timer { height:16px; margin:8px 0 2px; font-size:12px; color:var(--o-accent); opacity:0; transition:opacity .3s; }',
      '.tz-ob-ln { height:6px; background:var(--o-border2); border-radius:3px; margin:8px 0; }',
      '.tz-ob-rbot { display:flex; justify-content:space-between; align-items:center; margin-top:12px; }',
      '.tz-ob-min { font-size:13px; color:var(--o-text2); }',
      '.tz-ob-min.on { color:var(--o-green); font-weight:600; }',
      '.tz-ob-play { width:40px; height:40px; border-radius:50% !important; background:var(--o-accent); color:#fff; display:flex; align-items:center; justify-content:center; font-size:20px; padding:0; }',
      /* 5-слайд: график */
      '.tz-ob-bars { display:flex; align-items:flex-end; gap:9px; height:140px; }',
      '.tz-ob-bar { width:28px; height:0; background:var(--o-accent); border-radius:5px 5px 0 0; transition:height .6s cubic-bezier(.2,.8,.2,1); }',
      /* оқырман кеңестері */
      '#tz-ob-hint { position:fixed; inset:0; z-index:9500; cursor:pointer; }',
      '#tz-ob-hole { position:fixed; border-radius:12px; box-shadow:0 0 0 3px #2A78D6, 0 0 0 9999px rgba(0,0,0,.5); transition:all .3s; pointer-events:none; }',
      '#tz-ob-tip { position:fixed; max-width:240px; background:#2A78D6; color:#fff; font-size:14px; line-height:1.4; padding:10px 12px; border-radius:10px; pointer-events:none; }',
      '#tz-ob-tip small { display:block; margin-top:4px; font-size:12px; opacity:.8; }',
      '@media (max-height:620px) { #tz-ob-anim { min-height:160px; transform:scale(.85); } #tz-ob-title { margin-top:10px; } }'
    ].join('\n');
    document.head.appendChild(st);
  }

  /* ── слайдтар ── */
  function firstName() {
    var u = user();
    var n = (u && u.user_metadata && u.user_metadata.full_name || '').trim().split(/\s+/)[0];
    return n || '';
  }
  var SLIDES = [
    { title: function () { var n = firstName(); return n ? tr('Сәлем, {name}!', { name: n }) : tr('Сәлем!'); },
      text: function () { return tr('Мұнда түсініп, бірақ 2 есе жылдам оқуды үйренесің.'); }, anim: animWords },
    { title: function () { return tr('Күніне 15 минут'); },
      text: function () { return tr('Әр күн бір ғана формула: көз → ойын → кітап.'); }, anim: animTimeline },
    { title: function () { return tr('Ойындар көзді жаттықтырады'); },
      text: function () { return tr('Шульте, Көру өрісі т.б. Әр ойынның өз нұсқаулығы бар.'); }, anim: animSchulte },
    { title: function () { return tr('Кітапты ▶ басып оқы'); },
      text: function () { return tr('Минут тек ▶ басқанда есептеледі. Шыққанда ← бас.'); }, anim: animReader },
    { title: function () { return tr('Дайынсың!'); },
      text: function () { return tr('Бүгінгі бірінші сабақты қазір бастайық.'); }, anim: animBars }
  ];

  function animWords(box) {
    var ws = tr('Кітап оқу ойды кеңейтеді және сөздік қорды байытады').split(/\s+/);
    box.innerHTML = '<div><div class="tz-ob-words">' + ws.map(function (w, k) { return '<span class="tz-ob-w" id="tz-ob-w' + k + '">' + esc(w) + '</span>'; }).join(' ') +
      '</div><div class="tz-ob-wpm">WPM<b id="tz-ob-wpm">150</b></div></div>';
    if (reduced) { $('tz-ob-wpm').textContent = '300'; return; }
    function clear() { ws.forEach(function (_, k) { var e = $('tz-ob-w' + k); if (e) e.classList.remove('hl'); }); }
    ws.forEach(function (_, k) { later(function () { clear(); $('tz-ob-w' + k).classList.add('hl'); }, 300 + k * 380); });
    var t0 = 300 + ws.length * 380 + 200, third = Math.ceil(ws.length / 3);
    [0, 1, 2].forEach(function (g) {
      later(function () { clear(); for (var x = g * third; x < Math.min(ws.length, (g + 1) * third); x++) $('tz-ob-w' + x).classList.add('hl'); }, t0 + g * 450);
    });
    for (var k = 0; k <= 15; k++) (function (k) { later(function () { $('tz-ob-wpm').textContent = 150 + k * 10; }, t0 + k * 80); })(k);
    later(clear, t0 + 1500);
  }

  function animTimeline(box) {
    var st = [['ti-eye', tr('Көз'), tr('1,5 мин'), 10], ['ti-target', tr('Ойын'), tr('3–4 мин'), 25], ['ti-book', tr('Кітап'), tr('10 мин'), 65]];
    box.innerHTML = '<div style="width:100%;max-width:330px"><div class="tz-ob-line">' +
      st.map(function (x, k) { return '<div class="tz-ob-seg" id="tz-ob-seg' + k + '" style="opacity:' + (0.55 + k * 0.2) + '"></div>'; }).join('') +
      '</div><div class="tz-ob-lbls">' +
      st.map(function (x, k) { return '<div class="tz-ob-lbl" id="tz-ob-lbl' + k + '" style="flex:' + x[3] + '"><i class="ti ' + x[0] + '"></i><div>' + esc(x[1]) + '</div><span>' + esc(x[2]) + '</span></div>'; }).join('') +
      '</div><div class="tz-ob-total" id="tz-ob-total">' + esc(tr('= 15 минут')) + ' <i class="ti ti-check"></i></div></div>';
    function step(k) { $('tz-ob-seg' + k).style.width = st[k][3] + '%'; $('tz-ob-lbl' + k).style.opacity = 1; }
    if (reduced) { st.forEach(function (_, k) { step(k); }); $('tz-ob-total').style.opacity = 1; return; }
    st.forEach(function (_, k) { later(function () { step(k); }, 300 + k * 750); });
    later(function () { $('tz-ob-total').style.opacity = 1; }, 2700);
  }

  function animSchulte(box) {
    var n = [7, 2, 9, 4, 1, 6, 3, 8, 5];
    box.innerHTML = '<div class="tz-ob-grid">' + n.map(function (v) { return '<div class="tz-ob-cell" id="tz-ob-c' + v + '">' + v + '</div>'; }).join('') + '</div>';
    for (var v = 1; v <= 9; v++) (function (v) {
      if (reduced) $('tz-ob-c' + v).classList.add('ok');
      else later(function () { $('tz-ob-c' + v).classList.add('ok'); }, 300 + v * 300);
    })(v);
  }

  function animReader(box) {
    box.innerHTML = '<div class="tz-ob-reader"><div class="tz-ob-rtop"><i class="ti ti-arrow-left" id="tz-ob-a1"></i><i class="ti ti-bolt" id="tz-ob-a2"></i></div>' +
      '<div class="tz-ob-timer" id="tz-ob-a5">⏱ ' + esc(tr('Таймер')) + ' 10:00</div>' +
      [90, 100, 80, 95].map(function (w) { return '<div class="tz-ob-ln" style="width:' + w + '%"></div>'; }).join('') +
      '<div class="tz-ob-rbot"><span class="tz-ob-min" id="tz-ob-a4">' + esc(tr('{n} мин', { n: 0 })) + '</span><div class="tz-ob-play" id="tz-ob-a3"><i class="ti ti-player-play"></i></div></div></div>';
    if (reduced) {
      $('tz-ob-a5').style.opacity = 1; $('tz-ob-a4').textContent = tr('{n} мин', { n: 10 }); $('tz-ob-a4').classList.add('on');
      $('tz-ob-a3').classList.add('tz-ob-ring'); return;
    }
    later(function () { $('tz-ob-a2').classList.add('tz-ob-ring'); }, 400);
    later(function () { $('tz-ob-a2').classList.remove('tz-ob-ring'); $('tz-ob-a5').style.opacity = 1; }, 1200);
    later(function () { $('tz-ob-a3').classList.add('tz-ob-ring'); $('tz-ob-a3').style.transform = 'scale(.88)'; }, 1800);
    later(function () { $('tz-ob-a3').style.transform = ''; $('tz-ob-a3').innerHTML = '<i class="ti ti-player-pause"></i>'; }, 2050);
    for (var k = 1; k <= 10; k++) (function (k) {
      later(function () { var e = $('tz-ob-a4'); e.textContent = tr('{n} мин', { n: k }); e.classList.add('on'); }, 2100 + k * 140);
    })(k);
    later(function () { $('tz-ob-a3').classList.remove('tz-ob-ring'); $('tz-ob-a1').classList.add('tz-ob-ring'); }, 3700);
  }

  function animBars(box) {
    var h = [30, 45, 40, 62, 58, 80, 96];
    box.innerHTML = '<div class="tz-ob-bars">' + h.map(function (_, k) { return '<div class="tz-ob-bar" id="tz-ob-b' + k + '"></div>'; }).join('') + '</div>';
    h.forEach(function (v, k) {
      if (reduced) $('tz-ob-b' + k).style.height = v + '%';
      else later(function () { $('tz-ob-b' + k).style.height = v + '%'; }, 200 + k * 120);
    });
  }

  /* ── overlay ── */
  var S = { open: false, i: 0, replay: false, touchX: null };

  function build() {
    injectStyle();
    var el = document.createElement('div');
    el.id = 'tz-ob';
    el.className = 'tz-ob';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML = '<div id="tz-ob-col"><div id="tz-ob-top"><button id="tz-ob-skip" type="button"></button></div>' +
      '<div id="tz-ob-body"><div id="tz-ob-anim"></div><div id="tz-ob-title"></div><p id="tz-ob-text"></p></div>' +
      '<div><div id="tz-ob-dots"></div><div id="tz-ob-actions"></div></div></div>';
    document.body.appendChild(el);
    $('tz-ob-skip').addEventListener('click', skip);
    el.addEventListener('touchstart', function (e) { S.touchX = e.touches[0].clientX; }, { passive: true });
    el.addEventListener('touchend', function (e) {
      if (S.touchX === null) return;
      var dx = e.changedTouches[0].clientX - S.touchX; S.touchX = null;
      if (dx < -50) next(); else if (dx > 50) prev();
    });
    return el;
  }

  function render() {
    stopAnims();
    var s = SLIDES[S.i], last = S.i === SLIDES.length - 1;
    $('tz-ob-skip').textContent = S.replay ? tr('Жабу') : tr('Өткізу');
    $('tz-ob-skip').style.visibility = last && !S.replay ? 'hidden' : '';
    $('tz-ob-title').textContent = s.title();
    $('tz-ob-text').textContent = s.text();
    $('tz-ob-dots').innerHTML = SLIDES.map(function (_, k) { return '<span class="' + (k === S.i ? 'on' : '') + '"></span>'; }).join('');
    var act = $('tz-ob-actions');
    if (!last) {
      act.innerHTML = '<button class="tz-ob-btn" id="tz-ob-next" type="button"></button>';
      $('tz-ob-next').textContent = tr('Келесі →');
      $('tz-ob-next').onclick = next;
    } else if (S.replay) {
      act.innerHTML = '<button class="tz-ob-btn" id="tz-ob-next" type="button"></button>';
      $('tz-ob-next').textContent = tr('Жабу');
      $('tz-ob-next').onclick = function () { close(); };
    } else {
      act.innerHTML = '<button class="tz-ob-btn pulse" id="tz-ob-go" type="button"></button><button id="tz-ob-later" type="button"></button>';
      $('tz-ob-go').textContent = tr('Бірінші сабақты бастау');
      $('tz-ob-later').textContent = tr('Кейін, дашбордқа');
      $('tz-ob-go').onclick = finishAndStart;
      $('tz-ob-later').onclick = function () { writeFlag({ v: VERSION, done: 'finish', slide: SLIDES.length, at: new Date().toISOString() }); close(); };
      if (reduced) $('tz-ob-go').classList.remove('pulse');
    }
    s.anim($('tz-ob-anim'));
    try { (last ? $('tz-ob-go') || $('tz-ob-next') : $('tz-ob-next')).focus({ preventScroll: true }); } catch (e) {}
  }

  function next() { if (S.i < SLIDES.length - 1) { S.i++; if (!S.replay) writeFlagLocal(); render(); } }
  function prev() { if (S.i > 0) { S.i--; render(); } }
  // Әр слайдта серверге жазбаймыз: тек localStorage (Өткізу/Бастау басылғанда серверге кетеді).
  function writeFlagLocal() {
    var u = user(); if (!u) return;
    var f = readFlag(); f.v = VERSION; f.done = 'skip'; f.slide = S.i + 1;
    try { localStorage.setItem(LS_KEY + u.id, JSON.stringify(f)); } catch (e) {}
  }
  function skip() {
    if (!S.replay) writeFlag({ v: VERSION, done: 'skip', slide: S.i + 1, at: new Date().toISOString() });
    close();
  }
  function onKey(e) {
    if (!S.open) return;
    if (e.key === 'ArrowRight') next();
    else if (e.key === 'ArrowLeft') prev();
    else if (e.key === 'Escape') skip();
  }

  function finishAndStart() {
    writeFlag({ v: VERSION, done: 'finish', slide: SLIDES.length, at: new Date().toISOString() });
    close();
    var card = $('tez-ses-card');
    var sessionVisible = !!(window.TezSession && card && card.offsetParent !== null && !card.classList.contains('is-done'));
    try {
      if (sessionVisible) window.TezSession.start();
      else if (typeof window.showEyeWarmup === 'function') window.showEyeWarmup();
    } catch (e) { console.warn('[onboarding] start', e); }
  }

  function open(replay) {
    if (S.open) return;
    var el = $('tz-ob') || build();
    S.open = true; S.i = 0; S.replay = !!replay;
    el.style.display = 'flex';
    requestAnimationFrame(function () { el.classList.add('open'); });
    document.addEventListener('keydown', onKey);
    if (!S.replay) writeFlag({ v: VERSION, done: 'skip', slide: 1, at: new Date().toISOString() });   // ортасында бет жаңарса, қайта шықпайды
    render();
  }

  function close() {
    stopAnims();
    closeHints();
    if (!S.open) return;
    S.open = false;
    document.removeEventListener('keydown', onKey);
    var el = $('tz-ob');
    if (el) { el.classList.remove('open'); el.style.display = 'none'; }
  }

  var showTimer = 0;
  function maybeShow() {
    clearTimeout(showTimer);
    showTimer = setTimeout(function () {
      var u = user(), dash = $('dashboard');
      if (!u || !dash || dash.style.display === 'none' || S.open) return;
      var auth = $('auth-overlay');
      if (auth && auth.offsetParent !== null) return;
      if (forced) { forced = false; open(false); return; }
      if ((readFlag().v || 0) >= VERSION) return;
      open(false);
    }, SHOW_DELAY);
  }

  /* ── оқырман кеңестері (кітапты бірінші ашқанда) ── */
  var H = { on: false, n: 0, timer: 0 };
  var HINTS = [
    { id: 'speed-btn', text: function () { return tr('Жылдамдық пен 10 минуттық таймер осында'); } },
    { id: 'play-btn', text: function () { return tr('▶ бас. Минут тек осылай есептеледі'); } },
    { id: 'back-to-dash', text: function () { return tr('Біткенде осы жерден шық'); } }
  ];
  function readerHints() {
    clearTimeout(H.timer);
    if (readFlag().reader) return;
    H.timer = setTimeout(function () {
      var app = $('app');
      if (!user() || !app || app.style.display === 'none' || H.on || S.open) return;
      app.classList.remove('fs-mode');   // toolbar көрініп тұруы керек
      injectStyle();
      var el = document.createElement('div');
      el.id = 'tz-ob-hint';
      el.className = 'tz-ob';
      el.innerHTML = '<div id="tz-ob-hole"></div><div id="tz-ob-tip"></div>';
      document.body.appendChild(el);
      el.addEventListener('click', onHintClick);
      window.addEventListener('resize', placeHint);
      H.on = true; H.n = 0;
      placeHint();
    }, READER_DELAY);
  }
  function hintRect(i) {
    var t = $(HINTS[i].id);
    if (!t) return null;
    var r = t.getBoundingClientRect();
    return r.width ? r : null;
  }
  function placeHint() {
    if (!H.on) return;
    while (H.n < HINTS.length && !hintRect(H.n)) H.n++;   // батырма жоқ/көрінбесе, келесіге өтеміз
    if (H.n >= HINTS.length) { finishHints(); return; }
    var r = hintRect(H.n), pad = 6, hole = $('tz-ob-hole'), tip = $('tz-ob-tip');
    hole.style.left = (r.left - pad) + 'px'; hole.style.top = (r.top - pad) + 'px';
    hole.style.width = (r.width + pad * 2) + 'px'; hole.style.height = (r.height + pad * 2) + 'px';
    hole.style.borderRadius = HINTS[H.n].id === 'play-btn' ? '50%' : '12px';
    tip.innerHTML = esc(HINTS[H.n].text()) + '<small>' + (H.n + 1) + '/' + HINTS.length + ' · ' + esc(tr('экранды түрт')) + '</small>';
    var vw = window.innerWidth, vh = window.innerHeight, tw = Math.min(240, vw - 24);
    tip.style.maxWidth = tw + 'px';
    var left = Math.max(12, Math.min(vw - tw - 12, r.left + r.width / 2 - tw / 2));
    tip.style.left = left + 'px';
    var below = r.top + r.height / 2 < vh / 2;
    tip.style.top = below ? (r.bottom + pad + 12) + 'px' : '';
    tip.style.bottom = below ? '' : (vh - r.top + pad + 12) + 'px';
  }
  function onHintClick(e) {
    var r = hintRect(H.n);
    var inside = r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    if (inside && HINTS[H.n].id === 'play-btn') {   // ▶ басылса: кеңестерді жауып, оқуды бастаймыз
      finishHints();
      try { $('play-btn').click(); } catch (err) {}
      return;
    }
    H.n++;
    placeHint();
  }
  function finishHints() { writeFlag({ reader: true }); closeHints(); }
  function closeHints() {
    clearTimeout(H.timer);
    if (!H.on) return;
    H.on = false;
    window.removeEventListener('resize', placeHint);
    var el = $('tz-ob-hint');
    if (el) el.remove();
  }

  window.TezOnboarding = {
    maybeShow: maybeShow,
    open: function () { open(true); },
    close: close,
    readerHints: readerHints,
    _reset: function () { var u = user(); if (u) { try { localStorage.removeItem(LS_KEY + u.id); } catch (e) {} writeFlag({ v: 0, done: null, slide: null, reader: null }); } }
  };
})();
