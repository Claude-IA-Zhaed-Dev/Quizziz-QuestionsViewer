/*!
 * Wayground (Quizizz) - Exportador de perguntas e alternativas
 * Versão 1.0.0
 *
 * Uso: abra a página do quiz (a que lista TODAS as perguntas), abra o console (F12)
 * e execute este arquivo. Nada é instalado. Só lê o texto da página.
 * Exporta APENAS perguntas e alternativas, na ordem em que aparecem.
 */
(() => {
  'use strict';

  const w = window;
  const d = document;

  // Se já foi executado antes nesta aba, limpa a execução anterior.
  try { if (w.WGExport && typeof w.WGExport.destroy === 'function') w.WGExport.destroy(); } catch (_) { /* ignore */ }

  /* ====================================================================
   * CONFIGURAÇÃO (pode ser alterada em WGExport.CFG antes de rodar de novo)
   * ================================================================== */
  const CFG = {
    letters: true,        // true: "A) texto"   false: "- texto"
    stepRatio: 0.7,       // quanto da altura da tela rolar por passo
    settleMs: 350,        // espera após cada rolagem (carregamento lento)
    idleRounds: 3,        // rodadas sem novidade no fim da página para parar
    maxRounds: 800,       // trava de segurança
    // Tipos de pergunta que não têm alternativas (ignora textos auxiliares)
    noOptionTypes: /open[\s-]?ended|fill[\s-]?in|blank|draw|aberta|preench|lacuna|desenh|escrever|resposta\s+(?:livre|curta)/i,
    // Ajuste manual (só se a detecção automática falhar). Seletores CSS:
    //   card: cada pergunta | question: texto da pergunta | option: cada alternativa
    selectors: { card: '', question: '', option: '' },
  };

  /* ====================================================================
   * PADRÕES
   * ================================================================== */
  // Linha de metadados de cada pergunta: "30 sec • 1 pt" (aceita pt/pts/ponto(s)/points)
  const META_RE = /^[^•·|\n]{1,60}[•·|]\s*\d+(?:[.,]\d+)?\s*(?:pts?|points?|pontos?|ponto|puntos?|punto|punkte?|punti)\.?$/i;
  // Número da pergunta: "1." / "Q1" / "Pergunta 1"
  const NUM_RE = /^(?:q(?:uestion)?|pergunta|quest[aã]o)?\s*#?\s*(\d{1,4})\s*[.):]?$/i;
  // Rótulos de "tipo" (ex.: "MULTIPLE CHOICE QUESTION"), usado só no plano B
  const TYPE_RE = /^(?:[A-ZÀ-Ý&\s/-]+\s(?:QUESTIONS?|QUEST[ÃA]O|PERGUNTAS?)|POLL|ENQUETE|DRAW|DESENHO|CATEGORIZE|CATEGORIZAR|MATCH|REORDER|ORDENAR|HOT\s?TEXT)$/;
  // Número da pergunta como âncora (plano B): "1." / "1)" / "Q1" / "Pergunta 1"
  const ANCHOR_NUM_RE = /^\s*(?:(?:q(?:uestion)?|pergunta|quest[aã]o)\s*#?\s*(\d{1,3})\s*[.):]?|(\d{1,3})\s*[.):])\s*$/i;
  const anchorNum = (t) => { const m = String(t).match(ANCHOR_NUM_RE); return m ? parseInt(m[1] || m[2], 10) : null; };
  // Textos de interface que nunca são pergunta/alternativa
  const JUNK_RE = /^(?:(?:show|hide|ver|mostrar|ocultar|esconder)\s+(?:all\s+|todas\s+as\s+)?(?:answers?|respostas?|explanations?|explica[cç][aã]o|explica[cç][oõ]es)|(?:correct\s+answers?|resposta\s+correta|respostas\s+corretas)\s*:?|(?:explanation|explica[cç][aã]o)\s*:?)$/i;

  // Textos de rodapé/convite da página: tudo a partir daqui não é alternativa
  const TAIL_RE = /^(?:access all questions|acesse todas as perguntas|create resources|criar recursos|host any resource|hospede|get auto-graded|continue with|continuar com|already have an account|j[aá] tem uma conta|similar resources|recursos semelhantes|popular resources|recursos populares|discover more resources|descubra mais)/i;

  const SKIP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head', 'iframe', 'select', 'option', 'input', 'textarea', 'source', 'track', 'link', 'meta']);

  /* ====================================================================
   * UTILIDADES
   * ================================================================== */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const collapse = (s) => String(s).replace(/[\u200b-\u200d\ufeff]/g, '').replace(/[\s\u00a0]+/g, ' ').trim();
  const clsOf = (el) => (typeof el.className === 'string' ? el.className : (el.getAttribute && el.getAttribute('class')) || '');
  const letter = (i) => (i < 26 ? String.fromCharCode(65 + i) : String(i + 1));
  const state = { cancelled: false, host: null, text: '', items: [], result: null };

  function cleanBlock(raw) {
    return raw
      .replace(/[\u200b-\u200d\ufeff]/g, '')
      .replace(/[ \t\r\f\v\u00a0]+/g, ' ')
      .replace(/ ?\n ?/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function chain(el) { const a = []; for (let p = el; p; p = p.parentElement) a.push(p); return a; }
  function lcaOf(els) {
    let anc = chain(els[0]);
    for (let i = 1; i < els.length; i++) { const s = new Set(chain(els[i])); anc = anc.filter((a) => s.has(a)); }
    return anc[0];
  }
  function childOf(R, el) { let c = el; while (c && c.parentElement !== R) c = c.parentElement; return c || el; }

  function alike(a, b) {
    if (a.localName !== b.localName) return false;
    const ta = clsOf(a).split(/\s+/).filter(Boolean);
    const tb = clsOf(b).split(/\s+/).filter(Boolean);
    if (!ta.length && !tb.length) return true;
    if (!ta.length || !tb.length) return false;
    const sb = new Set(tb);
    return ta.some((t) => sb.has(t));
  }

  /* ====================================================================
   * LEITURA DO TEXTO VISÍVEL (tokens -> blocos)
   * ================================================================== */
  function isMathEl(el) {
    try { return el.matches('.katex, mjx-container, .MathJax, math, .math-tex, [data-latex]'); } catch (_) { return false; }
  }
  function mathText(el) {
    const a = el.querySelector && el.querySelector('annotation[encoding="application/x-tex"]');
    if (a && a.textContent.trim()) return ' $' + a.textContent.trim() + '$ ';
    const dl = el.getAttribute && el.getAttribute('data-latex');
    if (dl) return ' $' + dl + '$ ';
    const al = el.getAttribute && el.getAttribute('aria-label');
    if (al) return ' ' + al + ' ';
    const mm = el.querySelector && el.querySelector('.katex-mathml, math, mjx-assistive-mml');
    return ' ' + collapse((mm || el).textContent) + ' ';
  }

  function tokenize(root) {
    const tokens = [];
    const cache = new Map();
    const cs = (el) => { let v = cache.get(el); if (!v) { v = w.getComputedStyle(el); cache.set(el, v); } return v; };
    const INLINE = new Set(['inline', 'contents', 'ruby', 'ruby-text', 'ruby-base']);

    const blockOf = (el) => {
      let cur = el;
      while (cur && cur !== root) {
        if (!INLINE.has(cs(cur).display)) return cur;
        cur = cur.parentElement;
      }
      return root;
    };

    const hidden = (el, st) => {
      if (el.hidden) return true;
      if (st.display === 'none') return true;
      if (st.visibility === 'hidden' || st.visibility === 'collapse') return true;
      const wd = parseFloat(st.width), ht = parseFloat(st.height);
      if (wd <= 1 && ht <= 1 && st.overflow !== 'visible' && st.overflow !== '') return true;
      if (/\b(?:sr-only|visually-?hidden|screen-?reader(?:-?only|-?text)?)\b/i.test(clsOf(el))) return true;
      return false;
    };

    const bigEnough = (img) => {
      let wd = 0;
      try { wd = img.getBoundingClientRect().width; } catch (_) { /* ignore */ }
      if (!wd) wd = parseFloat(img.getAttribute('width')) || img.naturalWidth || 0;
      return wd === 0 || wd >= 24; // 0 = tamanho desconhecido -> considera
    };

    (function walk(node) {
      if (node.nodeType === 3) {
        const p = node.parentElement;
        if (!p || !node.nodeValue) return;
        let t = node.nodeValue;
        t = /^pre/.test(cs(p).whiteSpace) ? t.replace(/[ \t\f\v\u00a0]+/g, ' ') : t.replace(/\s+/g, ' ');
        tokens.push({ text: t, block: blockOf(p) });
        return;
      }
      if (node.nodeType !== 1) return;
      const el = node;
      const tag = el.localName;
      if (SKIP.has(tag)) return;
      if (hidden(el, cs(el))) return;
      if (isMathEl(el)) { tokens.push({ text: mathText(el), block: blockOf(el) }); return; }
      if (tag === 'br') { tokens.push({ text: '\n', block: blockOf(el.parentElement || el) }); return; }
      if (tag === 'img') { if (bigEnough(el)) tokens.push({ text: ' [imagem] ', block: blockOf(el) }); return; }
      if (tag === 'video') { tokens.push({ text: ' [vídeo] ', block: blockOf(el) }); return; }
      if (tag === 'audio') { tokens.push({ text: ' [áudio] ', block: blockOf(el) }); return; }
      for (let c = el.firstChild; c; c = c.nextSibling) walk(c);
    })(root);
    return tokens;
  }

  function blocksOf(root) {
    const tokens = tokenize(root);
    const blocks = [];
    let cur = null;
    for (const t of tokens) {
      if (!cur || cur.el !== t.block) { cur = { el: t.block, raw: '' }; blocks.push(cur); }
      cur.raw += t.text;
    }
    return blocks.map((b) => ({ el: b.el, text: cleanBlock(b.raw) })).filter((b) => b.text);
  }

  /* ====================================================================
   * LOCALIZAR AS PERGUNTAS NA PÁGINA
   * ================================================================== */
  function visibleDeep(el) {
    for (let c = el; c && c !== d.body; c = c.parentElement) {
      const st = w.getComputedStyle(c);
      if (st.display === 'none' || st.visibility === 'hidden') return false;
    }
    return true;
  }

  // Âncora principal: a linha "30 sec • 1 pt"
  function findMetaEls() {
    const hits = [];
    const all = d.body.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el.childElementCount > 8 || SKIP.has(el.localName)) continue;
      const raw = el.textContent;
      if (!raw || raw.length < 5 || raw.length > 90 || !/[•·|]/.test(raw)) continue;
      if (META_RE.test(collapse(raw))) hits.push(el);
    }
    return hits.filter((el) => !hits.some((o) => o !== el && el.contains(o))).filter(visibleDeep);
  }

  // Âncora reserva: números "1." "2." "3." (ou Q1, Q2...) em sequência
  function findNumberAnchors() {
    const cands = [];
    const all = d.body.querySelectorAll('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el.childElementCount > 2 || SKIP.has(el.localName)) continue;
      const t = el.textContent;
      if (!t || t.length > 18 || anchorNum(t) === null) continue;
      cands.push(el);
    }
    const deepest = cands.filter((el) => !cands.some((o) => o !== el && el.contains(o))).filter(visibleDeep);
    let best = [], run = [];
    for (const el of deepest) {
      const n = anchorNum(el.textContent);
      if (run.length && n === anchorNum(run[run.length - 1].textContent) + 1) run.push(el);
      else run = [el];
      if (run.length > best.length) best = run.slice();
    }
    return best;
  }

  const LANDMARKS = 'nav,footer,aside,h1,[role="navigation"],[role="banner"],[role="contentinfo"]';

  // Quantos blocos de texto existem depois do cabeçalho (número / tipo / "30 sec • 1 pt")
  function bodyCount(el, anchor, mode) {
    const blocks = blocksOf(el);
    let hdr = -1;
    if (mode === 'meta') blocks.forEach((b, i) => { if (anchor.contains(b.el)) hdr = i; });
    else hdr = blocks.findIndex((b) => anchorNum(b.text) !== null);
    return blocks.length - (hdr + 1);
  }

  // Descobre o "card" de uma pergunta a partir da âncora.
  //  - várias perguntas na tela: maior elemento que contém só ESTA âncora
  //  - uma só (quiz de 1 pergunta / lista virtualizada): menor elemento que já tem
  //    pergunta + alternativas, sem engolir menu/rodapé da página
  function cardFromAnchor(anchor, anchors, mode) {
    const single = anchors.length === 1;
    let cur = anchor;
    for (;;) {
      if (single && bodyCount(cur, anchor, mode) >= 2) break;
      const p = cur.parentElement;
      if (!p || p === d.body || p === d.documentElement || p.localName === 'main' || p.getAttribute('role') === 'main') break;
      if (single) {
        if (p.querySelector(LANDMARKS)) break;
      } else {
        let count = 0;
        for (const a of anchors) { if (p.contains(a) && ++count > 1) break; }
        if (count > 1) break;
      }
      cur = p;
    }
    return cur;
  }

  /* ====================================================================
   * SEPARAR PERGUNTA x ALTERNATIVAS
   * ================================================================== */
  function divergence(blocks) {
    const R = lcaOf(blocks.map((b) => b.el));
    const groups = [];
    for (const b of blocks) {
      const key = b.el === R ? b : childOf(R, b.el);
      const last = groups[groups.length - 1];
      if (last && last.key === key) last.blocks.push(b);
      else groups.push({ key, el: b.el === R ? R : key, blocks: [b] });
    }
    return { R, groups };
  }

  function unitsFromBlocks(blocks) {
    if (blocks.length < 2) return [blocks];
    const { groups } = divergence(blocks);
    return groups.length < 2 ? [blocks] : groups.map((g) => g.blocks);
  }

  const isLabelSeq = (s, j) => { const t = s.replace(/[.):]$/, ''); return t.toUpperCase() === String.fromCharCode(65 + j) || t === String(j + 1); };

  // Alternativas em linhas (grade 2x2 com linhas) -> achata
  function flattenRows(units) {
    if (units.length >= 2 && units.length <= 3 && units.every((u) => u.length >= 2)) {
      const subs = units.map((u) => divergence(u).groups);
      const j = subs[0].length;
      if (j >= 2 && subs.every((s) => s.length === j && s.every((x) => alike(x.el, s[0].el)))) {
        // se o 1º item de cada unidade é um selo A/B/C (ou 1/2/3), não é grade: é [selo][texto]
        const badge = subs.every((s, i) => isLabelSeq(s[0].blocks.map((b) => b.text).join(' '), i));
        if (!badge) return subs.flat().map((g) => g.blocks);
      }
    }
    return units;
  }

  // Remove rótulos "A", "B", "C"... que sejam só enfeite (somente se forem sequenciais)
  function stripLabels(units, texts) {
    if (units.length >= 2 && units.every((u, j) => u.length >= 2 && isLabelSeq(u[0].text, j))) {
      return units.map((u) => u.slice(1).map((b) => b.text).join(' '));
    }
    const pre = /^([A-H])[.):]\s+/;
    if (texts.length >= 2 && texts.every((t, j) => { const m = t.match(pre); return m && m[1] === String.fromCharCode(65 + j); })) {
      return texts.map((t) => t.replace(pre, ''));
    }
    return texts;
  }

  function splitBody(body) {
    if (!body.length) return { question: '', options: [] };
    if (body.length === 1) return { question: body[0].text, options: [] };

    const { groups } = divergence(body);
    const m = groups.length;
    let qGroups, optBlocks;

    if (m === 1) {
      return { question: body.map((b) => b.text).join('\n'), options: [] };
    }
    if (m === 2) {
      qGroups = [groups[0]];
      optBlocks = unitsFromBlocks(groups[1].blocks);
    } else {
      // (1) sequência final de irmãos parecidos = alternativas
      let k = 1;
      while (k < m && alike(groups[m - 1 - k].el, groups[m - k].el)) k++;
      if (k >= 2 && k < m) {
        qGroups = groups.slice(0, m - k);
        optBlocks = groups.slice(m - k).map((g) => g.blocks);
      } else {
        // (2) o grupo com mais blocos (depois do primeiro) é a lista de alternativas
        let r = -1, max = 1;
        groups.forEach((g, i) => { if (i >= 1 && g.blocks.length >= max && g.blocks.length >= 2) { r = i; max = g.blocks.length; } });
        if (r >= 1) {
          qGroups = groups.slice(0, r);
          optBlocks = unitsFromBlocks(groups[r].blocks);
        } else {
          // (3) lista "plana": primeiro = pergunta, resto = alternativas
          qGroups = [groups[0]];
          optBlocks = groups.slice(1).map((g) => g.blocks);
        }
      }
    }

    optBlocks = flattenRows(optBlocks);
    const texts = optBlocks.map((u) => u.map((b) => b.text).join(' '));
    const options = stripLabels(optBlocks, texts).map(collapse).filter(Boolean);
    const question = qGroups.map((g) => g.blocks.map((b) => b.text).join('\n')).join('\n');
    return { question, options };
  }

  function parseCard(roots, anchor, mode) {
    const blocks = roots.flatMap((r) => blocksOf(r));

    // índice do último bloco do cabeçalho
    let hdrEnd = -1;
    if (mode === 'meta') {
      if (anchor) blocks.forEach((b, i) => { if (anchor.contains(b.el)) hdrEnd = i; });
      if (hdrEnd < 0) hdrEnd = blocks.findIndex((b) => META_RE.test(b.text));
    } else {
      const ni = blocks.findIndex((b) => anchorNum(b.text) !== null);
      hdrEnd = ni;
      while (hdrEnd >= 0 && hdrEnd + 1 < blocks.length && hdrEnd - ni < 2 && TYPE_RE.test(blocks[hdrEnd + 1].text)) hdrEnd++;
    }

    const header = hdrEnd >= 0 ? blocks.slice(0, hdrEnd + 1) : [];
    let num = null;
    const typeParts = [];
    for (const b of header) {
      const m = b.text.match(NUM_RE) || b.text.match(/^\s*(\d{1,4})\s*[.)]\s/);
      if (num === null && m) { num = parseInt(m[1], 10); continue; }
      if (!META_RE.test(b.text) && !NUM_RE.test(b.text)) typeParts.push(b.text);
    }
    const type = typeParts.join(' | ');

    let body = blocks.slice(hdrEnd + 1);
    const cut = body.findIndex((b) => TAIL_RE.test(b.text));
    if (cut >= 0) body = body.slice(0, cut);
    body = body.filter((b) => !JUNK_RE.test(b.text));
    const noOpt = !!(type && CFG.noOptionTypes.test(type));

    let question = '', options = [];
    const S = CFG.selectors;
    if (S.question && S.option) {
      try {
        const qe = roots.map((r) => r.querySelector(S.question)).find(Boolean);
        question = qe ? blocksOf(qe).map((b) => b.text).join('\n') : '';
        options = roots.flatMap((r) => Array.from(r.querySelectorAll(S.option)))
          .map((o) => collapse(blocksOf(o).map((b) => b.text).join(' '))).filter(Boolean);
      } catch (e) { console.warn('[WGExport] seletor inválido:', e.message); }
    } else {
      ({ question, options } = splitBody(body));
    }
    if (noOpt) options = [];
    return { num, type, question, options, bodyBlocks: body.length };
  }

  // Cache: não re-lê um card cujo conteúdo não mudou entre uma rolagem e outra
  let parseCache = new WeakMap();
  const fingerprint = (el) => el.textContent.length + ':' + el.getElementsByTagName('*').length + ':' + el.getElementsByTagName('img').length;

  // Uma "foto" da página no momento: todas as perguntas hoje presentes no DOM
  function scanOnce() {
    const out = [];
    const S = CFG.selectors;
    if (S.card) {
      let cards = [];
      try { cards = Array.from(d.querySelectorAll(S.card)); } catch (_) { /* ignore */ }
      for (const c of cards) {
        const q = parseCard([c], null, 'meta');
        if (q.question || q.options.length) { q.card = c; out.push(q); }
      }
      return out;
    }

    let anchors = findMetaEls();
    let mode = 'meta';
    if (!anchors.length) { anchors = findNumberAnchors(); mode = 'number'; }
    if (!anchors.length) return out;

    const seen = new Set();
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const card = cardFromAnchor(a, anchors, mode);
      if (seen.has(card)) continue;
      seen.add(card);
      const fp = fingerprint(card);
      const hit = parseCache.get(card);
      if (hit && hit.fp === fp && hit.mode === mode) { out.push(Object.assign({ card }, hit.q)); continue; }
      let q = parseCard([card], a, mode);
      // Cabeçalho separado do corpo (irmãos): estende até a próxima pergunta
      let extended = false;
      if (!q.question && !q.options.length) {
        const roots = [card];
        const next = anchors[i + 1];
        for (let s = card.nextElementSibling, n = 0; s && n < 12; s = s.nextElementSibling, n++) {
          if (next && (s === next || s.contains(next))) break;
          roots.push(s);
        }
        if (roots.length > 1) { q = parseCard(roots, a, mode); extended = true; }
      }
      if (q.question || q.options.length) {
        if (!extended) parseCache.set(card, { fp, mode, q });
        q.card = card; out.push(q);
      }
    }
    return out;
  }

  /* ====================================================================
   * ACUMULADOR (junta várias "fotos" enquanto a página rola)
   * ================================================================== */
  const hashOf = (q) => q.question + '\u0001' + q.options.join('\u0002');
  class Store {
    constructor() { this.items = []; this.byNum = new Map(); this.hashSeen = new Map(); }
    get size() { return this.items.length; }
    addPass(list) {
      const passCount = new Map();
      for (const q of list) {
        const item = { num: q.num, type: q.type, question: q.question, options: q.options };
        if (q.num !== null) {
          const ex = this.byNum.get(q.num);
          if (!ex) { this.items.push(item); this.byNum.set(q.num, item); }
          else if (item.options.length > ex.options.length || (item.options.length === ex.options.length && item.question.length > ex.question.length)) {
            Object.assign(ex, item);
          }
        } else {
          const h = hashOf(item);
          const c = (passCount.get(h) || 0) + 1;
          passCount.set(h, c);
          if (c > (this.hashSeen.get(h) || 0)) { this.items.push(item); this.hashSeen.set(h, c); }
        }
      }
    }
    sorted() {
      const all = this.items.slice();
      return all.every((i) => i.num !== null) ? all.sort((a, b) => a.num - b.num) : all;
    }
  }

  /* ====================================================================
   * ROLAGEM
   * ================================================================== */
  const isDoc = (s) => s === d.documentElement || s === d.body || s === d.scrollingElement;
  const getTop = (s) => (isDoc(s) ? (w.pageYOffset || d.documentElement.scrollTop || (d.body && d.body.scrollTop) || 0) : s.scrollTop);
  const viewH = (s) => (isDoc(s) ? w.innerHeight : s.clientHeight) || 600;
  const totalH = (s) => (isDoc(s) ? Math.max(d.documentElement.scrollHeight, d.body ? d.body.scrollHeight : 0) : s.scrollHeight);
  function setTop(s, y) {
    try {
      if (isDoc(s)) w.scrollTo({ top: y, left: 0, behavior: 'instant' });
      else s.scrollTo({ top: y, left: 0, behavior: 'instant' });
    } catch (_) {
      if (isDoc(s)) w.scrollTo(0, y); else s.scrollTop = y;
    }
  }
  function findScroller(from) {
    for (let p = from && from.parentElement; p && p !== d.body && p !== d.documentElement; p = p.parentElement) {
      const st = w.getComputedStyle(p);
      if (/(auto|scroll|overlay)/.test(st.overflowY) && p.scrollHeight > p.clientHeight + 24) return p;
    }
    return d.scrollingElement || d.documentElement;
  }

  function expectedCount() {
    const txt = (d.body.innerText || d.body.textContent || '');
    const m = txt.match(/(?:^|\D)(\d{1,4})\s+(?:questions?|perguntas?|quest[õo]es)\b/i);
    return m ? parseInt(m[1], 10) : null;
  }
  const LOGIN_WALL_RE = /creating a free account|crie uma conta|criar uma conta|criando uma conta|sign up to (?:see|view)|log in to (?:see|view)/i;

  function finish(store) {
    const items = store.sorted();
    const warnings = [];
    const expected = expectedCount();
    const bodyTxt = d.body.innerText || d.body.textContent || '';
    if (expected && items.length < expected) {
      warnings.push(`A página indica ${expected} perguntas, mas só ${items.length} foram capturadas.` +
        (LOGIN_WALL_RE.test(bodyTxt) ? ' A página parece pedir login para mostrar todas: entre na sua conta e rode de novo.' : ' Rode de novo ou use WGExport.debug().'));
    }
    const nums = items.map((i) => i.num).filter((n) => n !== null);
    if (nums.length) {
      const missing = [];
      for (let n = Math.min(...nums); n <= Math.max(...nums); n++) if (!nums.includes(n)) missing.push(n);
      if (missing.length) warnings.push('Perguntas não capturadas (números faltando): ' + missing.join(', ') + '.');
    }
    const noOpts = items.map((q, i) => ({ q, i })).filter(({ q }) => !q.options.length && !(q.type && CFG.noOptionTypes.test(q.type)));
    if (noOpts.length && noOpts.length < items.length) {
      warnings.push('Sem alternativas detectadas nas perguntas: ' + noOpts.map(({ i }) => i + 1).join(', ') + ' (pode ser pergunta aberta/imagem).');
    }
    return { items, warnings, expected };
  }

  async function collect(opts = {}) {
    state.cancelled = false;
    parseCache = new WeakMap();
    const store = new Store();
    let pass = [];
    for (let tries = 0; tries < 6; tries++) {
      pass = scanOnce();
      if (pass.length) break;
      await sleep(500);
    }
    if (!pass.length) return finish(store);

    const scroller = findScroller(pass[0].card);
    const origTop = getTop(scroller);
    setTop(scroller, 0);
    await sleep(CFG.settleMs);

    const expected = expectedCount();
    let idle = 0, stuck = 0, lastTop = -1;
    for (let round = 0; round < CFG.maxRounds && !state.cancelled; round++) {
      const before = store.size;
      store.addPass(scanOnce());
      if (opts.onProgress) opts.onProgress(store.size);
      // Já temos exatamente o total que a página anuncia: não precisa rolar mais
      if (expected && store.size === expected) {
        const ns = store.items.map((i) => i.num).filter((n) => n !== null);
        if (!ns.length || (Math.max(...ns) - Math.min(...ns) + 1 === ns.length)) break;
      }

      const top = getTop(scroller), vh = viewH(scroller), total = totalH(scroller);
      const atBottom = top + vh >= total - 6;
      if (atBottom) {
        idle = store.size === before ? idle + 1 : 0;
        if (idle >= CFG.idleRounds) break;
        await sleep(CFG.settleMs * 2);
        setTop(scroller, total);
      } else {
        idle = 0;
        stuck = Math.abs(top - lastTop) < 2 ? stuck + 1 : 0;
        if (stuck >= 4) break;
        lastTop = top;
        setTop(scroller, top + Math.max(160, vh * CFG.stepRatio));
        await sleep(CFG.settleMs);
      }
    }
    setTop(scroller, origTop);
    return finish(store);
  }

  /* ====================================================================
   * FORMATO DE SAÍDA
   * ================================================================== */
  function format(items) {
    return items.map((q, i) => {
      const lines = [`${i + 1}. ${q.question || '[pergunta sem texto]'}`];
      q.options.forEach((o, j) => lines.push((CFG.letters ? `${letter(j)}) ` : '- ') + o));
      return lines.join('\n');
    }).join('\n\n');
  }

  /* ====================================================================
   * PAINEL (sem innerHTML: compatível com CSP / Trusted Types)
   * ================================================================== */
  function h(tag, style, props, ...kids) {
    const e = d.createElement(tag);
    if (style) for (const k of Object.keys(style)) e.style.setProperty(k, style[k]);
    if (props) for (const k of Object.keys(props)) e[k] = props[k];
    for (const kid of kids) if (kid) e.appendChild(kid);
    return e;
  }

  async function copyText(text, ta) {
    try { if (w.navigator.clipboard && w.navigator.clipboard.writeText) { await w.navigator.clipboard.writeText(text); return true; } } catch (_) { /* tenta o plano B */ }
    try { ta.focus(); ta.select(); return !!d.execCommand('copy'); } catch (_) { return false; }
  }

  function buildUI() {
    const host = h('div', { position: 'fixed', top: '12px', right: '12px', 'z-index': '2147483647', width: 'min(580px, 94vw)' });
    const root = host.attachShadow({ mode: 'open' });
    const font = '14px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
    const box = h('div', {
      background: '#14161f', color: '#e8eaf2', border: '1px solid #3a3f55', 'border-radius': '12px',
      'box-shadow': '0 12px 40px rgba(0,0,0,.5)', font, padding: '12px', display: 'flex', 'flex-direction': 'column', gap: '8px',
      'box-sizing': 'border-box',
    });
    const title = h('div', { 'font-weight': '700', 'font-size': '15px', flex: '1' }, { textContent: 'Wayground • Exportar perguntas' });
    const btn = (label, bg) => h('button', {
      background: bg, color: '#fff', border: '0', 'border-radius': '8px', padding: '8px 14px', cursor: 'pointer', font, 'font-weight': '600',
    }, { textContent: label, type: 'button' });
    const closeBtn = btn('✕', '#3a3f55'); closeBtn.style.setProperty('padding', '4px 10px');
    const status = h('div', { color: '#aab0c8', 'font-size': '13px' }, { textContent: 'Procurando perguntas…' });
    const warn = h('div', { display: 'none', background: '#3b2f10', color: '#ffd98a', 'border-radius': '8px', padding: '8px 10px', 'font-size': '12.5px', 'white-space': 'pre-wrap' });
    const ta = h('textarea', {
      width: '100%', height: '320px', 'box-sizing': 'border-box', background: '#0d0f16', color: '#e8eaf2', border: '1px solid #3a3f55',
      'border-radius': '8px', padding: '8px', font: '12.5px/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace', resize: 'vertical',
    }, { readOnly: true, spellcheck: false, placeholder: 'As perguntas aparecerão aqui…' });
    const copyBtn = btn('Copiar tudo', '#4c6fff');
    const dlBtn = btn('Baixar .txt', '#2f3550');
    const stopBtn = btn('Parar', '#a5452f');
    const row = h('div', { display: 'flex', gap: '8px', 'flex-wrap': 'wrap' }, null, copyBtn, dlBtn, stopBtn);
    const head = h('div', { display: 'flex', 'align-items': 'center', gap: '8px' }, null, title, closeBtn);
    box.append(head, status, warn, ta, row);
    root.appendChild(box);
    d.documentElement.appendChild(host);

    const setEnabled = (on) => { [copyBtn, dlBtn].forEach((b) => { b.disabled = !on; b.style.setProperty('opacity', on ? '1' : '.5'); }); };
    setEnabled(false);

    const ui = {
      host, ta, status, warn, copyBtn, dlBtn, stopBtn, closeBtn, setEnabled,
      setStatus: (t) => { status.textContent = t; },
      setWarnings: (arr) => { warn.textContent = arr.map((x) => '⚠ ' + x).join('\n'); warn.style.setProperty('display', arr.length ? 'block' : 'none'); },
    };
    closeBtn.onclick = () => destroy();
    stopBtn.onclick = () => { state.cancelled = true; stopBtn.style.setProperty('display', 'none'); };
    copyBtn.onclick = async () => {
      const ok = await copyText(ta.value, ta);
      ui.setStatus(ok ? '✅ Copiado para a área de transferência!' : 'Não consegui copiar sozinho: clique no texto, Ctrl+A e Ctrl+C.');
    };
    dlBtn.onclick = () => {
      try {
        const url = URL.createObjectURL(new Blob([ta.value], { type: 'text/plain;charset=utf-8' }));
        const a = h('a', null, { href: url, download: 'perguntas-wayground.txt' });
        d.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      } catch (e) { ui.setStatus('Não foi possível baixar: ' + e.message); }
    };
    return ui;
  }

  /* ====================================================================
   * DIAGNÓSTICO
   * ================================================================== */
  function outline(el, depth = 0, max = 9, lines = []) {
    if (depth > max) return lines;
    const c = clsOf(el).trim();
    const cls = c ? '.' + c.split(/\s+/).slice(0, 3).join('.') : '';
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.nodeValue).join('').replace(/\s+/g, ' ').trim();
    lines.push('  '.repeat(depth) + el.localName + cls + (own ? '  "' + own.slice(0, 70) + '"' : ''));
    for (const k of el.children) if (!SKIP.has(k.localName) && (k.textContent.trim() || k.querySelector('img'))) outline(k, depth + 1, max, lines);
    return lines;
  }

  function debug(n = 2) {
    const metas = findMetaEls();
    const anchors = metas.length ? metas : findNumberAnchors();
    const out = [`WGExport v1.0.0 | âncoras: ${anchors.length} (${metas.length ? 'meta "30 sec • 1 pt"' : 'numeração'})`];
    anchors.slice(0, n).forEach((a, i) => {
      const card = cardFromAnchor(a, anchors, metas.length ? 'meta' : 'number');
      out.push(`\n--- pergunta #${i + 1}: estrutura HTML ---`);
      out.push(outline(card).join('\n'));
      out.push('--- blocos de texto ---');
      blocksOf(card).forEach((b, j) => out.push(`${j}: ${b.el.localName} | ${b.text.slice(0, 80).replace(/\n/g, '⏎')}`));
    });
    const txt = out.join('\n');
    console.log(txt);
    return txt;
  }

  /* ====================================================================
   * EXECUÇÃO
   * ================================================================== */
  function destroy() {
    state.cancelled = true;
    if (state.host && state.host.parentNode) state.host.parentNode.removeChild(state.host);
    state.host = null;
    try { delete w.WGExport; } catch (_) { w.WGExport = undefined; }
  }

  async function run() {
    if (state.host && state.host.parentNode) state.host.parentNode.removeChild(state.host);
    const ui = buildUI();
    state.host = ui.host;
    try {
      const res = await collect({ onProgress: (n) => ui.setStatus(`Rolando a página… ${n} pergunta(s) encontrada(s)`) });
      state.result = res;
      state.items = res.items;
      state.text = format(res.items);
      ui.stopBtn.style.setProperty('display', 'none');
      ui.ta.value = state.text;
      ui.setWarnings(res.warnings);
      if (!res.items.length) {
        ui.setStatus('Nenhuma pergunta encontrada. Abra a página do quiz (a que lista as perguntas) e rode de novo. Se persistir: WGExport.debug()');
        return res;
      }
      ui.setEnabled(true);
      const ok = await copyText(state.text, ui.ta).catch(() => false);
      ui.setStatus(`${res.items.length} pergunta(s) ${ok ? 'copiada(s) automaticamente ✅' : 'prontas. Clique em "Copiar tudo".'}`);
      console.log(`[WGExport] ${res.items.length} perguntas. Texto em WGExport.text (ou copy(WGExport.text) no console).`);
      return res;
    } catch (e) {
      console.error('[WGExport] erro:', e);
      ui.setStatus('Erro: ' + (e && e.message ? e.message : e));
      throw e;
    }
  }

  w.WGExport = {
    version: '1.0.0', CFG, run, collect, scanOnce, format, debug, destroy,
    get text() { return state.text; },
    get items() { return state.items; },
  };

  if (!w.__WG_NO_AUTORUN__) run();
})();
