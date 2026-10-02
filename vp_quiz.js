/* Тез Оқу — Нейронды үдеткіштің түсіну тесті: таза логика (DOM жоқ). Тест: tests/vp-quiz.test.html.
   Спецификация: «Нейронды үдеткіш — түсіну сұрағы — спецификация.md». */
(function () {
  // segments: [{ t, start, words }] — тізбектегі әр мәтін (индекс, бірінші сөз орны, сөз саны); pos — маркер өткен сөз.
  // Нәтиже: { мәтін индексі: өтілген үлес 0..1 }; мәтін екі рет кездессе — үлкені.
  function coverage(segments, pos) {
    var cov = {};
    segments.forEach(function (s) {
      var done = Math.min(s.words, pos - s.start);
      if (done <= 0 || !s.words) return;
      var f = done / s.words;
      if (!(cov[s.t] >= f)) cov[s.t] = f;
    });
    return cov;
  }

  function shuffle(a, rand) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(rand() * (i + 1)), x = a[i]; a[i] = a[j]; a[j] = x;
    }
    return a;
  }

  // Жауабы өтілген бөлікте тұрған (at ≤ үлес×100) сұрақтардан ең көбі max: алдымен әр мәтіннен біреу (үлесі көп мәтін бірінші), сосын қалғаны.
  function pick(cov, bank, max, rand) {
    max = max == null ? 3 : max;
    rand = rand || Math.random;
    var texts = Object.keys(cov).map(Number).filter(function (t) { return bank[t]; })
      .sort(function (a, b) { return cov[b] - cov[a] || a - b; });
    var pools = texts.map(function (t) {
      return shuffle(bank[t].filter(function (q) { return q.at <= cov[t] * 100 + 1e-9; }).map(function (q) { return { t: t, q: q }; }), rand);
    }).filter(function (p) { return p.length; });
    var chosen = [];
    while (chosen.length < max && pools.some(function (p) { return p.length; })) {
      pools.forEach(function (p) { if (p.length && chosen.length < max) chosen.push(p.shift()); });
    }
    return chosen.map(function (c) {
      var order = shuffle([0, 1, 2], rand);
      return { t: c.t, q: c.q.q, options: order.map(function (k) { return c.q.a[k]; }), correct: order.indexOf(0) };
    });
  }

  function score(words, right, total) {
    if (!total) return { pct: 0, score: 0 };
    return { pct: Math.round(100 * right / total), score: Math.round(words * right / total) };
  }

  // Сұрақ тілі — экрандағы мәтіннің тілі (интерфейс тілі емес: орысша мәтіндер жүктелмесе, қазақша мәтін көрсетіледі).
  function bankFor(isKazakhTexts) {
    var Q = window.VP_QUESTIONS || { kk: [], ru: [] };
    return isKazakhTexts || !Q.ru || !Q.ru.length ? Q.kk : Q.ru;
  }

  window.VPQuiz = { coverage: coverage, pick: pick, score: score, bankFor: bankFor };
})();
