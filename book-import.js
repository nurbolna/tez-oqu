/* ══════════════════════════════════════════
   Тез Оқу — КІТАП ИМПОРТЫ (EPUB / PDF → тараулар + блоктар + суреттер)
   Жоспар: «Кітап құрылымы — іске асыру жоспары» (1-тапсырма). Прототип: tests/book-proto/proto.html.

   TezBookImport.parse(file, onProgress) → Promise<Book>
     file       — File немесе {name, arrayBuffer()}
     onProgress — ({stage:'text'|'images', done, total}) => void, міндетті емес (PDF-те 'text' кезеңі 2×бет саны: мәтін, сосын графика)
     Book = { scanned?:true,
              chapters:[{title, depth, skip, blocks:[{t:'h'|'p'|'li'|'q'|'cap'|'img', s?, lvl?, img?, txt?}]}],
              images: Map<id, Blob>, info }
   Сөйлем ішіндегі сурет мәтінде жеке «сөз» болып тұрады: ⟦i:ID⟧.
   img блогындағы txt:true — бұзылған шрифтті мәтін жолағы (сурет ретінде көрсетіледі).

   Тәуелділік: глобал pdfjsLib (3.11) және JSZip — index.html оларды осы файлдан бұрын жүктейді.
   ══════════════════════════════════════════ */
(function () {
  'use strict';

  // Оқуға жатпайтын тараулар — тізімде көрінеді, бірақ әдепкіде өткізіледі
  const SKIP_RE = /^(cover|title page|half title|copyright|contents|table of contents|dedication|acknowledg|notes|endnotes|index|bibliography|about the (author|publisher)|also by|praise for|other books|get \d+ free|.*special offer|final word|appendix|resources|мұқаба|мазмұн|мазмұны|авторлық|алғыс|ескерту|автор туралы|содержание|оглавление|авторские|об авторе|примечания|благодарност|kapak|içindekiler|telif|teşekkür|dipnot|yazar hakkında)/i;
  const isSkip = t => SKIP_RE.test(t.replace(/İ/g, 'I').replace(/^[\d.\s]+/, ''));
  // Закладкасы жоқ PDF-те тарау басын білдіретін тақырып
  const CHAP_RE = /^((chapter|part|глава|часть|раздел|бөлім|тарау|bölüm|kısım|kitap)\s*[\divxlcа-я]*\b|[\divxlc]+\s*[-–.]?\s*(тарау|бөлім|глава|bölüm)\b)/i;
  const LOWER = /^[a-zа-яәіңғүұқөһçğıöşü]/;
  const NOTE = /\u0001[^\u0002]*\u0002/g;          // сілтеме нөмірі (талдау кезіндегі уақытша белгі)
  const INL = /\u0005(\d+)\u0006/g;                // сөйлем ішіндегі сурет (уақытша белгі)
  const inlToken = id => '⟦i:' + id + '⟧';

  const report = (cb, stage, done, total) => { if (cb) try { cb({ stage, done, total }); } catch (e) {} };

  /* ═══════════ EPUB ═══════════ */
  async function parseEpub(buf, onProgress) {
    const zip = await JSZip.loadAsync(buf), P = new DOMParser();
    const xml = async p => P.parseFromString(await zip.file(p).async('string'), 'application/xhtml+xml');
    const opfPath = (await xml('META-INF/container.xml')).querySelector('rootfile').getAttribute('full-path');
    const base = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const opf = await xml(opfPath);
    const man = {};
    opf.querySelectorAll('manifest item').forEach(i => man[i.getAttribute('id')] = { href: base + decodeURI(i.getAttribute('href')), props: i.getAttribute('properties') || '', type: i.getAttribute('media-type') });
    const mime = {}; Object.values(man).forEach(m => mime[m.href] = m.type);
    const spine = [...opf.querySelectorAll('spine itemref')].map(r => man[r.getAttribute('idref')]?.href).filter(Boolean);
    const resolve = (from, href) => { const u = new URL(href, 'http://x/' + from); return { file: decodeURI(u.pathname.slice(1)), frag: u.hash.slice(1) }; };
    const epType = e => (e.getAttribute('epub:type') || e.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '');

    // Мазмұн: алдымен EPUB3 nav, болмаса NCX, ол да болмаса — spine файлдары
    let toc = [];
    const navItem = Object.values(man).find(m => m.props.includes('nav'));
    if (navItem && zip.file(navItem.href)) {
      const d = await xml(navItem.href);
      const nav = [...d.querySelectorAll('nav')].find(n => epType(n) === 'toc') || d.querySelector('nav');
      const walk = (ol, depth) => [...ol.children].forEach(li => {
        const a = li.querySelector(':scope>a,:scope>span'), sub = li.querySelector(':scope>ol');
        if (a && a.getAttribute('href')) toc.push({ title: a.textContent.trim().replace(/\s+/g, ' '), depth, ...resolve(navItem.href, a.getAttribute('href')) });
        if (sub) walk(sub, depth + 1);
      });
      const ol = nav && nav.querySelector('ol'); if (ol) walk(ol, 0);
    }
    if (!toc.length) {
      const ncx = Object.values(man).find(m => m.type === 'application/x-dtbncx+xml');
      if (ncx && zip.file(ncx.href)) {
        const d = await xml(ncx.href);
        const walk = (el, depth) => [...el.children].filter(c => c.localName === 'navPoint').forEach(np => {
          toc.push({ title: np.querySelector('navLabel text').textContent.trim(), depth, ...resolve(ncx.href, np.querySelector('content').getAttribute('src')) });
          walk(np, depth + 1);
        });
        const map = d.querySelector('navMap'); if (map) walk(map, 0);
      }
    }
    if (!toc.length) toc = spine.map((f, i) => ({ title: `${i + 1}-бөлім`, depth: 0, file: f, frag: '' }));

    // Spine-ды ретімен оқып, блоктарды тиесілі тарауға салу
    const starts = new Map(); toc.forEach((t, i) => { const k = t.file + '#' + t.frag; if (!starts.has(k)) starts.set(k, i); });
    const chapters = toc.map(t => ({ title: t.title, depth: t.depth, blocks: [] }));
    const images = new Map();
    let cur = -1;
    const BLOCK = 'p,h1,h2,h3,h4,h5,h6,li,blockquote,pre,dt,dd,figcaption,div';
    const LEAF_TEST = 'p,h1,h2,h3,h4,h5,h6,li,pre,dt,dd,figcaption,div';
    const push = b => { if (cur >= 0) chapters[cur].blocks.push(b); };
    let fi = 0;
    for (const f of spine) {
      report(onProgress, 'text', ++fi, spine.length);
      if (!zip.file(f)) continue;
      const doc = P.parseFromString(await zip.file(f).async('string'), 'application/xhtml+xml');
      const body = doc.querySelector('body'); if (!body) continue;
      if (starts.has(f + '#')) cur = starts.get(f + '#');
      body.querySelectorAll('script,style').forEach(e => e.remove());
      body.querySelectorAll('[role="doc-pagebreak"]').forEach(e => e.remove());
      [...body.querySelectorAll('*')].filter(e => /pagebreak/.test(epType(e))).forEach(e => e.remove());
      // сілтеме нөмірлері (era.1) — мәтінге кірмейді
      const noterefs = [...body.querySelectorAll('sup,a')].filter(e => {
        const t = epType(e) + ' ' + (e.getAttribute('role') || '') + ' ' + (e.getAttribute('class') || '');
        return e.localName === 'sup' || /noteref|enref|fnref|footnote/i.test(t) || (/^\[?\d{1,3}\]?$/.test(e.textContent.trim()) && (e.getAttribute('href') || '').includes('#'));
      });
      const tw = doc.createTreeWalker(body, 1);
      let n;
      while ((n = tw.nextNode())) {
        const id = n.getAttribute('id'); if (id && starts.has(f + '#' + id)) cur = starts.get(f + '#' + id);
        // сурет: <img src> немесе SVG <image xlink:href>
        if (n.localName === 'img' || n.localName === 'image') {
          const src = n.getAttribute('src') || n.getAttribute('xlink:href') || n.getAttributeNS('http://www.w3.org/1999/xlink', 'href');
          const p = src && resolve(f, src).file;
          if (cur >= 0 && p && zip.file(p)) {
            const blob = new Blob([await zip.file(p).async('arraybuffer')], { type: mime[p] || 'image/jpeg' });
            if (!(await isTinyImage(blob))) { const iid = String(images.size); images.set(iid, blob); push({ t: 'img', img: iid }); }
          }
          continue;
        }
        if (!n.matches(BLOCK)) continue;
        if (n.querySelector(LEAF_TEST)) continue; // тек ең ішкі блоктар
        noterefs.forEach(r => { if (n.contains(r)) r.replaceWith(doc.createTextNode('\u0001' + r.textContent.trim() + '\u0002')); });
        const s = n.textContent.replace(/\s+/g, ' ').trim(); if (!s) continue;
        const cls = (n.getAttribute('class') || '') + ' ' + (n.parentNode.getAttribute?.('class') || '');
        const t = /^h[1-6]$/.test(n.localName) ? 'h' : n.localName === 'figcaption' || /caption/i.test(cls) ? 'cap' : n.localName === 'li' ? 'li' : (n.closest('blockquote') ? 'q' : 'p');
        push(t === 'h' ? { t, lvl: +n.localName[1] <= 2 ? 2 : 3, s } : { t, s });
      }
    }
    chapters.forEach(c => c.skip = isSkip(c.title));
    return { chapters, images, info: `epub · ${chapters.length} тарау · ${images.size} сурет` };
  }

  // 100px-тен кіші сурет — безендіру белгісі, оқуға қажет емес
  async function isTinyImage(blob) {
    if (typeof createImageBitmap !== 'function') return false;
    try { const bm = await createImageBitmap(blob); const tiny = bm.width < 100 && bm.height < 100; bm.close && bm.close(); return tiny; }
    catch (e) { return false; }
  }

  /* ═══════════ PDF ═══════════ */
  // Бет графикасы: суреттердің орны (CTM стегі бойынша, сурет CTM-нің бірлік шаршысын толтырады)
  // және векторлық тізім белгілері (кішкентай, шаршыға жақын фигура)
  function pdfGraphics(ol) {
    const O = pdfjsLib.OPS, mul = (m, n) => [m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3], m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3], m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5]];
    let ctm = [1, 0, 0, 1, 0, 0]; const st = [], imgs = [], dots = [];
    const tp = (x, y) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]];
    ol.fnArray.forEach((fn, i) => {
      const a = ol.argsArray[i];
      if (fn === O.save) st.push(ctm); else if (fn === O.restore) ctm = st.pop() || ctm;
      else if (fn === O.transform) ctm = mul(a, ctm);
      else if (fn === O.paintFormXObjectBegin) { st.push(ctm); if (a && a[0]) ctm = mul(a[0], ctm); }
      else if (fn === O.paintFormXObjectEnd) ctm = st.pop() || ctm;
      else if (fn === O.constructPath && a && a[0].length <= 30 && dots.length < 400) {
        const pts = []; let k = 0;
        a[0].forEach(op => {
          const n = op === O.rectangle ? 4 : op === O.curveTo ? 6 : (op === O.curveTo2 || op === O.curveTo3) ? 4 : (op === O.moveTo || op === O.lineTo) ? 2 : 0;
          const c = a[1].slice(k, k + n); k += n;
          if (op === O.rectangle) pts.push(tp(c[0], c[1]), tp(c[0] + c[2], c[1] + c[3])); else for (let j = 0; j < c.length; j += 2) pts.push(tp(c[j], c[j + 1]));
        });
        if (!pts.length) return;
        const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), w = x1 - x0, h = y1 - y0;
        if (w > 1.5 && h > 1.5 && w < 10 && h < 10 && w / h < 2 && h / w < 2) dots.push({ x: x1, y: (y0 + y1) / 2 });
      }
      else if (fn === O.paintImageXObject || fn === O.paintInlineImageXObject || fn === O.paintJpegXObject || fn === O.paintImageXObjectRepeat) {
        const xs = [ctm[4], ctm[0] + ctm[4], ctm[2] + ctm[4], ctm[0] + ctm[2] + ctm[4]], ys = [ctm[5], ctm[1] + ctm[5], ctm[3] + ctm[5], ctm[1] + ctm[3] + ctm[5]];
        imgs.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]);
      }
    });
    return { imgs, dots };
  }

  // Канвастың бір аймағын JPEG Blob-қа. canvas.toBlob кодтауды браузердің бос уақытына қалдырады — бет өзгеріп жатқанда
  // (прогресс жазуы) және кадр салынбайтын фондағы/жасырын қойындыда ол минуттап күтуі мүмкін. OffscreenCanvas.convertToBlob
  // бұған тәуелді емес; ол жоқ браузерде — синхронды toDataURL.
  async function cropToJpeg(src, x, y, w, h) {
    const W = Math.round(w), H = Math.round(h);
    if (typeof OffscreenCanvas === 'function') {
      try {
        const o = new OffscreenCanvas(W, H), ctx = o.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.drawImage(src, x, y, w, h, 0, 0, W, H);
        return await o.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
      } catch (e) {}
    }
    const o = document.createElement('canvas'); o.width = W; o.height = H;
    const ctx = o.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.drawImage(src, x, y, w, h, 0, 0, W, H);
    const url = o.toDataURL('image/jpeg', 0.85), bin = atob(url.slice(url.indexOf(',') + 1)), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: 'image/jpeg' });
  }

  // Беттердің кемінде жартысында мәтін жоқ десе болады → сканерленген кітап
  const isScanned = charsPerPage => {
    if (!charsPerPage.length) return true;
    const s = charsPerPage.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)] < 30;
  };

  async function parsePdf(buf, onProgress) {
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
    const N = pdf.numPages;
    // 1) әр беттің мәтіні + графикасы (operator list баяу, бірақ импорт бір-ақ рет жүреді)
    const pages = [], meta = [], graphics = [];
    for (let i = 1; i <= N; i++) {
      const pg = await pdf.getPage(i), vp = pg.getViewport({ scale: 1 }), tc = await pg.getTextContent();
      const items = tc.items.filter(x => x.str.trim()).map(x => ({ s: x.str, x: x.transform[4], y: x.transform[5], sz: Math.round(Math.hypot(x.transform[2], x.transform[3]) * 10) / 10, w: x.width, f: x.fontName }));
      pages.push(items); meta.push({ chars: items.reduce((n, it) => n + it.s.length, 0), area: vp.width * vp.height });
      if (i === 1 || i % 5 === 0) report(onProgress, 'text', i, 2 * N);
    }
    if (isScanned(meta.map(m => m.chars))) { await pdf.destroy(); return { scanned: true, chapters: [], images: new Map(), info: 'scanned' }; }
    for (let i = 1; i <= N; i++) {
      const g = pdfGraphics(await (await pdf.getPage(i)).getOperatorList());
      // нағыз суреттер: иконка емес (<60pt), мәтін астындағы толық беттік фон емес
      g.imgs = g.imgs.filter(b => { const w = b[2] - b[0], h = b[3] - b[1]; return w >= 60 && h >= 60 && !(w * h > meta[i - 1].area * 0.85 && meta[i - 1].chars > 300); });
      graphics.push(g);
      if (i % 5 === 0) report(onProgress, 'text', N + i, 2 * N);
    }

    // 2) негізгі шрифт өлшемі = ең көп таңба жазылған өлшем
    const hist = {}; pages.flat().forEach(it => hist[it.sz] = (hist[it.sz] || 0) + it.s.length);
    const body = +Object.entries(hist).sort((a, b) => b[1] - a[1])[0][0];
    const totalChars = Object.values(hist).reduce((a, b) => a + b, 0);
    const textSize = sz => (hist[sz] || 0) > totalChars * 0.03; // үлкен, бірақ жиі өлшем (мыс. ірі терілген кіріспе) = мәтін, тақырып емес
    // 2b) бұзылған шрифттер (Unicode картасы жоқ → «�J ı..,f:';» сияқты қоқыс) — бүкіл кітап бойынша, шрифт сайын бағаланады:
    //     қоқыс шрифтте «сөз» ~1.4 әріп, таңбалардың көбі әріп емес; қалыпты шрифтте ~5 әріп. Тек сандардан тұратын шрифт (бет нөмірі) — бұзылған емес.
    const FS = {};
    pages.flat().forEach(it => {
      const f = FS[it.f] || (FS[it.f] = { n: 0, bad: 0, w: 0, wl: 0 }), nonsp = it.s.replace(/\s/g, '').length, ws = it.s.match(/\p{L}+/gu) || [];
      f.n += nonsp; f.bad += nonsp - (it.s.match(/[\p{L}\d]/gu) || []).length + (it.s.match(/�/g) || []).length * 3;
      f.w += ws.length; f.wl += ws.reduce((a, w) => a + w.length, 0);
    });
    const broken = new Set(Object.entries(FS).filter(([k, f]) => f.n >= 30 && f.w >= 5 && f.bad / f.n > 0.6 && f.wl / f.w < 2).map(([k]) => k));

    // 3) бет элементтерін жолдарға топтау (бірдей негіз сызығы)
    const crops = [];   // қиылатын аймақтар: {page, box} — индексі ⟦i:⟧ белгісінде қолданылады
    const linesFor = (pi, g) => {
      let items = pages[pi].map(o => ({ ...o }));
      // безендірілген үлкен бас әріп (drop cap) — қасындағы жолдың бірінші сөзіне жабыстырылады
      items.filter(it => it.sz >= body * 2.5 && it.s.trim().length <= 2).forEach(dc => {
        const tgt = items.filter(it => it !== dc && it.sz < body * 1.12 && it.x > dc.x && it.y >= dc.y - 2 && it.y <= dc.y + dc.sz).sort((a, b) => b.y - a.y || a.x - b.x)[0];
        if (tgt) { tgt.s = dc.s.trim() + tgt.s; tgt.x = dc.x; dc.drop = true; }
      });
      items = items.filter(it => !it.drop);
      const ls = [];
      items.forEach(it => { let l = ls.find(l => Math.abs(l.y - it.y) < 2); if (!l) ls.push(l = { y: it.y, items: [] }); l.items.push(it); });
      // негізгі жолдағы кішкентай сандар = сілтеме нөмірі
      ls.forEach(l => l.items.forEach(i => { const m = i.sz < body * 0.8 && l.items.some(o => o.sz >= body * 0.95) && i.s.trim().match(/^([.,;:]?)(\d{1,3})$/); if (m) i.s = m[1] + '\u0001' + m[2] + '\u0002'; }));
      ls.forEach(l => {
        l.items.sort((a, b) => a.x - b.x); l.x = l.items[0].x; l.r = Math.max(...l.items.map(i => i.x + i.w));
        l.sz = Math.max(...l.items.filter(i => !i.s.includes('\u0001') && !broken.has(i.f)).map(i => i.sz).concat(0)) || Math.max(...l.items.map(i => i.sz));
        const bc = l.items.filter(i => broken.has(i.f)).reduce((n, i) => n + i.s.length, 0);
        l.broken = bc > l.items.reduce((n, i) => n + i.s.length, 0) / 2;
        if (!l.broken && bc) {
          // қалыпты сөйлем ішіндегі бірнеше қоқыс сөз → кішкентай сурет болып қиылады
          const keep = []; let run = null;
          l.items.forEach(i => {
            if (broken.has(i.f)) {
              if (!run) { run = { ...i, s: '', r: i.x + i.w, top: i.y + i.sz, bot: i.y - i.sz * 0.35 }; keep.push(run); }
              run.r = Math.max(run.r, i.x + i.w); run.top = Math.max(run.top, i.y + i.sz * 1.05); run.bot = Math.min(run.bot, i.y - i.sz * 0.35);
            } else { run = null; keep.push(i); }
          });
          keep.forEach(i => { if (i.top !== undefined) { crops.push({ page: pi, box: [i.x - 1, i.bot, i.r + 1, i.top] }); i.s = '\u0005' + (crops.length - 1) + '\u0006'; i.w = i.r - i.x; } });
          l.items = keep;
        }
        l.dot = g.dots.some(d => d.x < l.x && l.x - d.x < body * 2.5 && Math.abs(d.y - (l.y + body * 0.3)) < body * 0.7);
        l.s = l.items.reduce((acc, i, k) => { const prev = l.items[k - 1], gap = prev ? i.x - (prev.x + prev.w) : 0; return acc + (prev && gap > body * 0.15 && !acc.endsWith(' ') ? ' ' : '') + i.s; }, '').replace(/\s+/g, ' ').trim();
      });
      g.imgs.forEach(b => ls.push({ img: b, y: b[3], s: '' }));
      return ls.sort((a, b) => b.y - a.y);
    };
    const pLines = pages.map((_, pi) => linesFor(pi, graphics[pi]));

    // 3b) кітаптың өз сөздігі — pdf.js өшіріп тастайтын жұмсақ сызықшамен (U+00AD) бөлінген сөздерді қайта біріктіру үшін («bulunabi|lir»)
    const lc = w => w.toLowerCase(), vocab = new Map();
    pLines.forEach(ls => ls.forEach(l => { if (l.broken || l.img) return; const ws = l.s.replace(NOTE, '').match(/\p{L}+/gu) || []; ws.slice(1, -1).forEach(w => { w = lc(w); vocab.set(w, (vocab.get(w) || 0) + 1); }); }));
    const glue = (a, b) => {
      const ma = a.match(/(\p{L}+)$/u), mb = b.match(/^(\p{Ll}\p{L}*)/u); if (!ma || !mb) return false;
      const f1 = lc(ma[1]), f2 = lc(mb[1]), cc = vocab.get(f1 + f2) || 0;
      return cc > 0 && cc >= Math.min(vocab.get(f1) || 0, vocab.get(f2) || 0);
    };
    const join = (a, b) => a.endsWith('-') && LOWER.test(b) ? a.slice(0, -1) + b : glue(a, b) ? a + b : a + ' ' + b;

    // 4) колонтитулдар: көп бетте қайталанатын бірінші/соңғы жол (сандар қалыпқа келтіріледі)
    const norm = s => s.replace(/\d+/g, '#').toLowerCase();
    const edges = ls => { const t = ls.filter(l => !l.img); return [t[0], t[t.length - 1]].filter(Boolean); };
    const edgeCount = {}; pLines.forEach(ls => edges(ls).forEach(l => { edgeCount[norm(l.s)] = (edgeCount[norm(l.s)] || 0) + 1; }));
    const runHead = new Set(Object.entries(edgeCount).filter(([k, v]) => v >= Math.max(3, N * 0.15)).map(([k]) => k));
    // 5) негізгі мәтін геометриясы: жол аралығы, сол жақ шеті, оң жақ шеті, мәтін тегістелген бе
    const mode = o => { const e = Object.entries(o).sort((a, b) => b[1] - a[1])[0]; return e ? +e[0] : 0; };
    const bodyLines = pLines.flat().filter(l => l.sz === body);
    const gaps = {}; pLines.forEach(ls => ls.forEach((l, k) => { const nx = ls[k + 1]; if (nx && l.sz === body && nx.sz === body) { const g = Math.round(l.y - nx.y); if (g > 0) gaps[g] = (gaps[g] || 0) + 1; } }));
    const lineGap = mode(gaps) || body * 1.2;
    const lx = {}; bodyLines.forEach(l => { lx[Math.round(l.x)] = (lx[Math.round(l.x)] || 0) + 1; });
    const marginX = mode(lx);
    const rs = bodyLines.map(l => l.r).sort((a, b) => a - b), colRight = rs[Math.floor(rs.length * 0.9)] || 0;
    const justified = bodyLines.filter(l => colRight - l.r < body).length / Math.max(1, bodyLines.length) > 0.5;
    const BULLET = /^([•●▪◦■►✓✔*]\s|\d{1,2}[.)]\s|[a-zа-я][)]\s)/i;

    // 6) беттің жолдарын блоктарға жіктеу
    const classify = (ls, pi) => {
      const out = []; let para = null, prevY = null, prevLine = null;
      const flush = () => { if (para) { out.push(para); para = null; } };
      const ed = new Set(edges(ls));
      ls.forEach(l => {
        if (l.img) { flush(); crops.push({ page: pi, box: l.img }); out.push({ t: 'img', crop: crops.length - 1 }); prevY = null; prevLine = null; return; }
        // безендірілген тақырып шрифттері де жиі жартылай бұзылған («'Birinc i 'B ö {üm»)
        const toks = l.s.split(' ').filter(Boolean);
        if (!l.broken && l.sz >= body * 1.12 && !textSize(l.sz) && (/[{}|\\^~]/.test(l.s) || toks.filter(t => /\p{L}/u.test(t) && /\d/.test(t)).length >= 2 || toks.filter(t => t.length <= 1).length > toks.length * 0.4)) l.broken = true;
        if (ed.has(l) && /^[\divxlc\s]+$/i.test(l.s)) { flush(); return; }   // бет нөмірі (бұзылған шрифтпен терілсе де)
        if (l.broken) {
          flush();
          if (/^[\s_\-–—.·•*~]*$/.test(l.s)) return;   // безендіру сызықтары, «* * *» бөлгіштері
          // қоқыс шрифтті мәтін → беттің сол жолағы сурет болып көрсетіледі
          const box = [l.x - 2, l.y - l.sz * 0.35, l.r + 2, l.y + l.sz * 1.05], last = out[out.length - 1];
          if (last && last.t === 'img' && last.txt && crops[last.crop].box[1] - box[3] < lineGap * 1.2) {
            const lb = crops[last.crop].box; crops[last.crop].box = [Math.min(lb[0], box[0]), box[1], Math.max(lb[2], box[2]), lb[3]];
          } else { crops.push({ page: pi, box }); out.push({ t: 'img', txt: true, crop: crops.length - 1 }); }
          prevY = null; prevLine = null; return;
        }
        if (ed.has(l) && (runHead.has(norm(l.s)) || /^[\divxlc]+$/i.test(l.s))) { flush(); return; }  // колонтитул, бет нөмірі
        if (l.sz < body * 0.88) { flush(); prevY = null; prevLine = null; return; }                       // сілтемелер, ұсақ жазулар
        if (l.sz >= body * 1.12 && !textSize(l.sz)) {                                                     // тақырып
          const last = out[out.length - 1];
          if (last && last.t === 'h' && last.sz === l.sz && prevY !== null && prevY - l.y < l.sz * 2) last.s += ' ' + l.s;
          else { flush(); out.push({ t: 'h', lvl: l.sz >= body * 1.3 ? 2 : 3, sz: l.sz, top: !out.length, s: l.s }); }
          prevY = l.y; prevLine = null; return;
        }
        const indented = l.x - marginX > body * 1.2;
        // алдыңғы жол ерте бітті, бірақ осы жолдың бірінші сөзі сонда сиятын еді → ол жол абзацты/пунктті аяқтаған
        const it0 = l.items[0], fw = it0.w / Math.max(1, it0.s.length) * (l.s.split(' ')[0].length + 1);
        const shortPrev = prevLine && (justified || prevLine.x - marginX > body * 1.2) && colRight - prevLine.r > fw + body * 0.5;
        const bul = l.dot || BULLET.test(l.s);
        // белгісі бар пункт ішінде келесі блокты тек жаңа белгі (немесе бос аралық) бастайды
        const newPara = !para || prevY === null || prevY - l.y > lineGap * Math.max(1, l.sz / body) * 1.35 || bul || (!para.bul && (shortPrev || (indented && Math.abs(para.x - l.x) > 2)));
        if (newPara) { flush(); para = { t: 'li', bul, n: 1, allInd: indented, s: l.s.replace(/^[•●▪◦■►✓✔]\s*/, ''), x: l.x }; }
        else { para.n++; para.allInd = para.allInd && Math.abs(l.x - para.x) < 2; para.s = join(para.s, l.s); }
        prevY = l.y; prevLine = l;
      });
      flush();
      // тізім пункті: белгісі бар, немесе бір шегіністегі ≥2 блок қатары (асылмалы жолдарымен);
      // абзацтың бірінші жолының шегінісі тізім емес — оның қалған жолдары шетке қайтады
      for (let i = 0; i < out.length; i++) {
        const b = out[i]; if (b.t !== 'li') continue;
        let j = i; while (out[j + 1] && out[j + 1].t === 'li' && out[j + 1].allInd && b.allInd && Math.abs(out[j + 1].x - b.x) < 2) j++;
        const isList = b.bul || j > i || (b.allInd && b.n >= 2);
        for (let k = i; k <= j; k++) out[k].t = isList || out[k].bul ? 'li' : 'p';
        i = j;
      }
      out.forEach(b => { delete b.bul; delete b.n; delete b.allInd; delete b.x; });
      return out;
    };
    const pageBlocks = pLines.map((ls, pi) => classify(ls, pi));

    // 7) тараулар: закладкалар → бет басындағы ірі тақырып / «Chapter N» → ~15 минуттық бөліктер
    const ol = await pdf.getOutline(); let ents = [], how = '';
    const walk = async (items, depth) => {
      for (const o of items || []) {
        let d = o.dest; if (typeof d === 'string') d = await pdf.getDestination(d);
        let p = null; try { p = d ? await pdf.getPageIndex(d[0]) : null; } catch (e) {}
        if (p !== null) ents.push({ title: o.title.trim(), depth, page: p });
        await walk(o.items, depth + 1);
      }
    };
    await walk(ol, 0);
    if (ents.length >= 2) how = `${ents.length} закладка`;
    else {
      ents = [];
      pageBlocks.forEach((bl, p) => { const h = bl.find(b => b.t === 'h' && (b.top && b.lvl === 2 || CHAP_RE.test(b.s))); if (h) ents.push({ title: h.s.replace(NOTE, '').slice(0, 90), depth: 0, page: p }); });
      if (ents.length >= 3) { how = `${ents.length} тақырып`; if (ents[0].page > 0) ents.unshift({ title: 'Кітап басы', depth: 0, page: 0, skip: true }); }
      else {
        ents = []; let acc = 0, start = 0; const W = 3500; // ≈ 230 сөз/мин жылдамдықпен 15 минут
        pageBlocks.forEach((bl, p) => {
          acc += bl.filter(b => b.s).reduce((n, b) => n + b.s.split(/\s+/).length, 0);
          if (acc >= W || p === N - 1) { ents.push({ title: `${ents.length + 1}-бөлік · ${start + 1}–${p + 1} беттер`, depth: 0, page: start }); start = p + 1; acc = 0; }
        });
        how = '15 минуттық бөліктер';
      }
    }
    ents.sort((a, b) => a.page - b.page);
    const assemble = pbs => {
      const blocks = [];
      pbs.forEach(pb => {
        pb.forEach(b => {
          const last = blocks[blocks.length - 1];
          // бетке бөлініп кеткен абзац: алдыңғысы сөйлеммен бітпесе, жалғастырамыз
          if (b.t === 'p' && last && last.t === 'p' && last.cont && !/[.!?…:”"»)]$/.test(last.s) && LOWER.test(b.s)) last.s = join(last.s, b.s);
          else blocks.push({ ...b });
        });
        const lb = blocks[blocks.length - 1]; blocks.forEach(b => { if (b !== lb) delete b.cont; }); if (lb) lb.cont = true;
      });
      blocks.forEach(b => { delete b.cont; delete b.sz; delete b.top; });
      return blocks;
    };
    const chapters = ents.map((e, i) => {
      const end = ents.slice(i + 1).find(n => n.page > e.page)?.page ?? N;
      return { title: e.title, depth: e.depth, skip: !!e.skip || isSkip(e.title), blocks: assemble(pageBlocks.slice(e.page, end)) };
    });

    // 8) суреттерді қию: әр бет бір рет салынады (intent 'print' — requestAnimationFrame-сіз,
    //    сондықтан фондағы/жасырын қойындыда да бітеді), канвас бет біткен соң босатылады
    const images = new Map(), byPage = new Map();
    crops.forEach((c, i) => { if (!byPage.has(c.page)) byPage.set(c.page, []); byPage.get(c.page).push(i); });
    const pagesWithCrops = [...byPage.keys()].sort((a, b) => a - b);
    let done = 0;
    for (const p of pagesWithCrops) {
      // бүкіл бетті емес, тек қиылатын аймақтардың жиынын саламыз — арабша жолақтар көбіне беттің кішкентай бөлігі
      const pg = await pdf.getPage(p + 1), vp = pg.getViewport({ scale: 2 });
      const rects = byPage.get(p).map(ci => { const r = vp.convertToViewportRectangle(crops[ci].box); return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])]; });
      const ux = Math.max(0, Math.floor(Math.min(...rects.map(r => r[0])))), uy = Math.max(0, Math.floor(Math.min(...rects.map(r => r[1]))));
      const uw = Math.min(Math.ceil(vp.width), Math.ceil(Math.max(...rects.map(r => r[2])))) - ux, uh = Math.min(Math.ceil(vp.height), Math.ceil(Math.max(...rects.map(r => r[3])))) - uy;
      if (uw < 2 || uh < 2) { report(onProgress, 'images', ++done, pagesWithCrops.length); continue; }
      const cv = document.createElement('canvas'); cv.width = uw; cv.height = uh;
      await pg.render({ canvasContext: cv.getContext('2d'), viewport: vp, transform: [1, 0, 0, 1, -ux, -uy], intent: 'print' }).promise;
      for (let k = 0; k < rects.length; k++) {
        const ci = byPage.get(p)[k], r = rects[k];
        const x = Math.max(0, r[0] - ux), y = Math.max(0, r[1] - uy), w = Math.min(uw - x, r[2] - r[0]), h = Math.min(uh - y, r[3] - r[1]);
        if (w < 2 || h < 2) continue;
        const blob = await cropToJpeg(cv, x, y, w, h);
        if (blob) images.set(String(ci), blob);
      }
      cv.width = cv.height = 0; pg.cleanup();
      report(onProgress, 'images', ++done, pagesWithCrops.length);
    }
    // қиылмай қалған суреттер блоктан/мәтіннен алынады; уақытша белгілер соңғы түріне келтіріледі
    chapters.forEach(c => {
      c.blocks = c.blocks.filter(b => b.t !== 'img' || images.has(String(b.crop))).map(b => {
        if (b.t === 'img') return b.txt ? { t: 'img', img: String(b.crop), txt: true } : { t: 'img', img: String(b.crop) };
        // PDF-тегі аралық сақталады: сурет әріптерге тиіп тұрса (бұзылған шрифтпен терілген жеке әріп, мыс. «⟦i⟧лл⟦i⟧һ»), сөз бөлінбейді
        return { ...b, s: b.s.replace(INL, (m, id) => images.has(id) ? inlToken(id) : '') };
      });
    });
    await pdf.destroy();
    return { chapters, images, crops: crops.length, info: `pdf · шрифт ${body}pt · ${justified ? 'тегістелген' : 'солға тураланған'} · ${how}${broken.size ? ` · ${broken.size} бұзылған шрифт` : ''}` };
  }

  /* ═══════════ ОРТАҚ: соңғы тазалау ═══════════ */
  // Сілтеме нөмірлерін алып тастау, бос мәтінді блоктарды өшіру, бос орындарды қалыпқа келтіру
  function finalize(book) {
    book.chapters.forEach(c => {
      c.title = c.title.replace(NOTE, '').replace(/\s+/g, ' ').trim();
      c.blocks = c.blocks.map(b => b.t === 'img' ? b : { ...b, s: b.s.replace(NOTE, '').replace(/�/g, '').replace(/\s+/g, ' ').trim() })
        .filter(b => b.t === 'img' || b.s);
    });
    return book;
  }

  async function parse(file, onProgress) {
    const name = (file.name || '').toLowerCase();
    const buf = await file.arrayBuffer();
    let book;
    if (name.endsWith('.epub')) book = await parseEpub(buf, onProgress);
    else if (name.endsWith('.pdf')) book = await parsePdf(buf, onProgress);
    else throw new Error('Тек .epub және .pdf файлдары талданады');
    return book.scanned ? book : finalize(book);
  }

  /* ═══════════ МӘТІН ТАЗАЛАУ (тек TZB1 кітаптары үшін) ═══════════
     Ескі жалпақ мәтіндерге index.html-дегі cleanKazakhText қолданылады (deserialize-ке беріледі) — олардың сөз саны
     өзгермеуі керек, әйтпесе сақталған позиция 0-ге түседі. Мұндағы айырмашылықтар:
       • әріп ретінде кирилл блогы толық + кеңейтілген латын саналады (түрікше «İş», «Üç» сияқты тек ерекше әріптерден
         тұратын сөздер бұрын тасталатын); араб әріптері бұрынғыдай алынады (PDF-те олар сурет болып келеді);
       • «сөз- жалғасы» тасымалы шынымен біріктіріледі (ескі нұсқада '\s' жолдың ішінде 's' болып кеткендіктен
         «self-sufficient» → «selfufficient» болатын, ал «қаза- қтың» біріктірілмейтін). */
  const ALPHA = 'a-zA-Z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u024F\u0400-\u04FF';
  const RE_HYPH = new RegExp('([' + ALPHA + '])-\\s+(\\p{Ll})', 'gu');   // екінші бөлігі кіші әріппен басталса ғана
  const RE_HAS = new RegExp('[' + ALPHA + '0-9]');
  const RE_NONALPHA = new RegExp('[^' + ALPHA + '0-9]');
  function cleanText(text) {
    text = text.replace(RE_HYPH, '$1$2');
    const cleaned = [];
    for (const tok of text.split(/\s+/)) {
      if (!tok) continue;
      if (/^\d{1,4}$/.test(tok)) continue;                       // бет нөмірлері
      if (!RE_HAS.test(tok)) continue;                          // әрпі де, саны да жоқ таңбалар
      if (/^[-–—.,!?:;]+$/.test(tok)) continue;
      if (tok.length === 1 && RE_NONALPHA.test(tok)) continue;
      cleaned.push(tok);
    }
    return cleaned.join(' ');
  }

  /* ═══════════ TZB1 САҚТАУ ФОРМАТЫ ═══════════
     Бір жол = бір жазба. IndexedDB-де де, B2-де де жай мәтін ретінде сақталады.
       @TZB1
       #C|тарау аты|skip (1/бос)|depth
       H2|тақырып   H3|тақырып
       P|абзац   L|тізім пункті   Q|дәйексөз   C|сурет жазуы
       I|сурет id   T|бұзылған шрифтті мәтін жолағы (сурет) id
     Сөйлем ішіндегі сурет — мәтінде ⟦i:ID⟧. Суреттердің өзі (Blob) мәтінге кірмейді. */
  const MAGIC = '@TZB1';
  const TAG = { p: 'P', li: 'L', q: 'Q', cap: 'C' }, UNTAG = { P: 'p', L: 'li', Q: 'q', C: 'cap' };
  const oneLine = s => String(s).replace(/[\r\n]+/g, ' ');
  function serialize(book) {
    const out = [MAGIC];
    book.chapters.forEach(c => {
      out.push('#C|' + oneLine(c.title).replace(/\|/g, '¦') + '|' + (c.skip ? '1' : '') + '|' + (c.depth || 0));
      c.blocks.forEach(b => {
        if (b.t === 'img') out.push((b.txt ? 'T|' : 'I|') + b.img);
        else if (b.t === 'h') out.push('H' + (b.lvl === 3 ? 3 : 2) + '|' + oneLine(b.s));
        else if (TAG[b.t]) out.push(TAG[b.t] + '|' + oneLine(b.s));
      });
    });
    return out.join('\n');
  }
  const isStructured = text => typeof text === 'string' && text.startsWith(MAGIC + '\n');

  // Мәтін → {words, blocks, chapters, structured}
  //   words    — тек сөздер (бұрынғыдай: pos, бетбелгі, статистика осыған сүйенеді); ⟦i:ID⟧ бар сөз — бір «сөз»
  //   blocks   — {t:'p'|'li'|'q'|'cap', start, end} сөз аралығы; {t:'h', lvl, s, at}; {t:'img', img, txt?, at}
  //              (at = келесі сөздің нөмірі: блок сол сөздің алдында тұрады)
  //   chapters — {title, skip, depth, start, end}
  // Ескі жалпақ мәтін: бір p блогы + бір тарау, words бұрынғы loadWords-пен дәл бірдей.
  //   legacyClean — ескі жалпақ мәтінді тазалайтын функция (index.html: cleanKazakhText); TZB1 әрқашан cleanText-пен тазаланады
  function deserialize(text, legacyClean) {
    const split = (s, f) => f(s).split(/\s+/).filter(w => w.length > 0);
    if (!isStructured(text)) {
      const words = split(text || '', legacyClean || cleanText);
      return { structured: false, words, blocks: [{ t: 'p', start: 0, end: words.length }], chapters: [{ title: '', skip: false, depth: 0, start: 0, end: words.length }] };
    }
    const words = [], blocks = [], chapters = [];
    const lines = text.split('\n');
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i], bar = line.indexOf('|'); if (bar < 0) continue;
      const tag = line.slice(0, bar), body = line.slice(bar + 1);
      if (tag === '#C') {
        const [title, skip, depth] = body.split('|');
        if (chapters.length) chapters[chapters.length - 1].end = words.length;
        chapters.push({ title, skip: skip === '1', depth: +depth || 0, start: words.length, end: words.length });
      } else if (tag === 'H2' || tag === 'H3') {
        blocks.push({ t: 'h', lvl: tag === 'H3' ? 3 : 2, s: body, at: words.length });
      } else if (tag === 'I' || tag === 'T') {
        blocks.push(tag === 'T' ? { t: 'img', img: body, txt: true, at: words.length } : { t: 'img', img: body, at: words.length });
      } else if (UNTAG[tag]) {
        const start = words.length;
        // ⟦i:ID⟧ бар сөз тазалаудан аман өтуі үшін өзгеріссіз қосылады (сурет сөздің ортасында да болуы мүмкін: «⟦i:2⟧лл⟦i:3⟧һ»)
        let buf = [];
        const flush = () => { if (buf.length) { words.push(...split(buf.join(' '), cleanText)); buf = []; } };
        body.split(/\s+/).forEach(tok => { if (!tok) return; if (tok.includes('⟦i:')) { flush(); words.push(tok); } else buf.push(tok); });
        flush();
        if (words.length > start) blocks.push({ t: UNTAG[tag], start, end: words.length });
      }
    }
    if (chapters.length) chapters[chapters.length - 1].end = words.length;
    else chapters.push({ title: '', skip: false, depth: 0, start: 0, end: words.length });
    return { structured: true, words, blocks, chapters };
  }
  // books.total_words және сақталған позицияның total-ы үшін — words.length-пен әрқашан бірдей
  const countWords = (text, legacyClean) => deserialize(text, legacyClean).words.length;

  window.TezBookImport = { parse, isSkip, inlToken, cleanText, serialize, deserialize, isStructured, countWords, _test: { isScanned, pdfGraphics, parseEpub, parsePdf } };
})();
