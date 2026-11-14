// PDF.js 文本层 → 结构化内容（段落 / 标题 / 列表 / 公式）
// PDF 里只有定位好的文字片段，没有段落、标题和公式结构，这里根据位置、字号和字体重建：
//   * 正文：按行合并为段落，识别标题（字号）、列表（项目符号 / 编号）、跨页段落、页眉页脚
//   * 公式：按字体（CMMI / CMSY / CMEX / 数学斜体等）和上下标偏移识别，
//           再按二维排版还原 LaTeX：上下标、∑ 等大型运算符的上下限、分式、多行对齐公式
(() => {
  const CCM = (globalThis.__CCM = globalThis.__CCM || {});
  if (CCM.pdfSelection) return;

  const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/;
  const SENTENCE_END = /[.。!?！？:：;；…]["”’)）\]]*$/;
  const BULLET_RE = /^([•●○◦▪▫■□‣⁃∙·▸►\-–—*])\s+(.*)$/;
  const ORDERED_RE = /^(\d{1,3})[.)]\s+(.*)$/;
  const OTHER_ENUM_RE = /^(\(\d{1,3}\)|（\d{1,3}）|[（(][一二三四五六七八九十]+[)）]|[一二三四五六七八九十]+、|[a-zA-Z][.)]\s)/;

  const BIG_OPS = new Set(Array.from('∑∏∐∫∬∭∮⋃⋂⨁⨂⨀⨄⋁⋀'));
  const MATH_FONT = /(^|\+)(CMMI|CMSY|CMEX|CMBSY|CMMIB|MSAM|MSBM|EUFM|EUSM|EUEX|RSFS|LMMath|LatinModernMath|STIX\w*Math|XITS\w*Math|Cambria\W?Math|TeXGyre\w*Math|NewCM\w*Math|FiraMath|Asana|MTMI|MTSY|MTEX|Euclid|MathJax)/i;
  const EXT_FONT = /(^|\+)(CMEX|EUEX|MTEX)|Extension/i;
  const ITALIC_FONT = /Italic|Oblique|(^|\+)CMTI|-It$/i;
  const ROMAN_FONT = /(^|\+)(CMR|CMBX|LMRoman|LMRomanDemi|CMSL)/i;
  const NEUTRAL_RE = /^[\s\d()[\]{}+\-−=<>.,;:!|/*'′·…]+$/;

  const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const median = (values) => {
    if (!values.length) return 0;
    const v = [...values].sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  };
  const needsSpace = (a, b) => {
    if (!a || !b) return false;
    const x = a[a.length - 1];
    const y = b[0];
    if (/\s/.test(x) || /\s/.test(y)) return false;
    if (CJK.test(x) || CJK.test(y)) return false;
    return true;
  };

  // ======================================================================
  //  公式：二维排版 → LaTeX
  // ======================================================================
  const join = (parts) => (CCM.texJoin ? CCM.texJoin(parts) : parts.join(''));
  const grp = (s) => (CCM.texGroup ? CCM.texGroup(s) : `{${s}}`);
  const charTex = (c) => (CCM.charTex ? CCM.charTex(c) : c);
  const FUNCS = CCM.texFuncs || new Set();
  const copyEls = (arr) => arr.map((e) => ({ ...e }));
  const overlapX = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);

  function texStr(str) {
    str = (str || '').replace(/\s+/g, ''); // 公式里的空格没有意义（例如 "+ 1)"、"· · ·"）
    if (!str) return '';
    if (/^[·⋅]{3}$/.test(str)) return '\\cdots';
    if (/^\.{3}$/.test(str) || str === '…') return '\\ldots';
    if (FUNCS.has(str)) return '\\' + str;
    return join(Array.from(str).map(charTex));
  }
  const texOf = (e) => (e.atom ? e.tex : texStr(e.str));

  const RADICALS = new Set(Array.from('√∛∜'));
  const isRad = (e) => !e.atom && RADICALS.has((e.str || '').trim());
  // “虚拟基线”：TeX 的大型运算符（CMEX）和根号（CMSY √）的基线在字形顶部，字形向下悬挂
  const vy = (e) => (e.atom ? e.y : e.isExt ? e.y - 0.9 * e.s : isRad(e) ? e.y - 0.84 * e.s : e.y);

  function refSize(els) {
    const sizes = els.filter((e) => !e.isExt && !isRad(e)).map((e) => e.s);
    return sizes.length ? Math.max(...sizes) : Math.max(...els.map((e) => e.s));
  }

  function baselineOf(els, s) {
    let pool = els.filter((e) => !e.isExt && !e.atom && !isRad(e) && e.s >= 0.85 * s);
    if (!pool.length) pool = els.filter((e) => !e.isExt && !isRad(e));
    if (!pool.length) return vy(els[0]);
    let best = null;
    for (const e of pool) {
      const w = pool.filter((o) => Math.abs(o.y - e.y) < 0.15 * s).reduce((a, o) => a + (o.str ? o.str.length : 2), 0);
      if (!best || w > best.w) best = { w, y: e.y };
    }
    return best.y;
  }

  // 水平段：基线相同、相邻的主体字符；紧贴其后的小字号上下标并入段的水平范围
  function segments(els, s) {
    const isPrimary = (e) => e.atom || e.isExt || isRad(e) || e.s >= 0.7 * s;
    const segs = [];
    // 按水平顺序依次处理：小字号内容延长它所依附的段，使 ∑_{j∈S} a_j 这类被下标隔开的内容仍是同一段
    for (const e of [...els].sort((a, b) => a.x0 - b.x0)) {
      if (!isPrimary(e)) {
        const g = segs.find((g) => e.x0 >= g.x0 - 0.3 * g.s && e.x0 <= g.x1 + 0.5 * g.s &&
          e.y > g.y - 0.7 * g.s && e.y < g.y + 0.9 * g.s);
        if (g) g.x1 = Math.max(g.x1, e.x1);
        continue;
      }
      const y = vy(e);
      const seg = segs.find((g) => Math.abs(g.y - y) < 0.2 * Math.max(g.s, e.s) && Math.abs(g.s - e.s) < 0.25 * Math.max(g.s, e.s) &&
        e.x0 - g.x1 < 0.8 * e.s && e.x0 >= g.x0 - 0.1 * e.s);
      if (seg) {
        seg.x1 = Math.max(seg.x1, e.x1);
        seg.items.push(e);
        if (!e.isExt && !isRad(e)) seg.solid = true;
      } else {
        segs.push({ y, s: e.s, x0: e.x0, x1: e.x1, items: [e], solid: !e.isExt && !isRad(e) });
      }
    }
    return segs.filter((g) => g.solid);
  }

  function isBaseEl(e, B, s) {
    if (e.isExt || e.base || isRad(e)) return true;
    if (e.atom) return Math.abs(e.y - B) < 0.45 * s;
    return Math.abs(e.y - B) <= 0.2 * s && e.s >= 0.8 * s;
  }

  function parseMath(input, depth = 0) {
    const els = input.filter((e) => e.atom || (e.str && e.str.trim()));
    if (!els.length) return '';
    if (depth > 8) return join([...els].sort((a, b) => a.x0 - b.x0).map(texOf));
    const s = refSize(els);
    const used = new Set();
    const atoms = [];
    const pool = () => els.filter((e) => !used.has(e)).concat(atoms.filter((a) => !used.has(a)));

    // 1) 带上下限的大型运算符（上下限与运算符水平重叠，位于其上方 / 下方）
    for (const op of els) {
      if (used.has(op) || op.atom || Array.from(op.str.trim()).length !== 1 || !BIG_OPS.has(op.str.trim())) continue;
      const cy = op.isExt ? op.y - 0.65 * op.s : op.y + 0.3 * op.s;
      const lims = els.filter((e) => e !== op && !used.has(e) && !e.atom && e.s < op.s * 0.92 &&
        overlapX(e, op) > 0.25 * Math.min(e.x1 - e.x0, op.x1 - op.x0) && Math.abs(e.y - cy) < 2.8 * op.s);
      if (!lims.length) continue;
      lims.forEach((e) => used.add(e));
      used.add(op);
      const lo = lims.filter((e) => e.y < cy);
      const up = lims.filter((e) => e.y >= cy);
      atoms.push({
        atom: true,
        base: true,
        tex: texStr(op.str) + (lo.length ? `_{${parseMath(copyEls(lo), depth + 1)}}` : '') +
          (up.length ? `^{${parseMath(copyEls(up), depth + 1)}}` : '') + ' ',
        x0: Math.min(op.x0, ...lims.map((e) => e.x0)),
        x1: Math.max(op.x1, ...lims.map((e) => e.x1)),
        y: op.isExt ? cy - 0.25 * op.s : op.y,
        s: op.s,
      });
    }

    // 2) 分式：上下两段字号相近、水平居中对齐、中间没有其他内容（分数线是图形，不在文字里）
    for (let guard = 0; guard < 24; guard++) {
      const cand = pool();
      const segs = segments(cand, s);
      let best = null;
      for (const U of segs) {
        for (const L of segs) {
          if (U === L) continue;
          const sz = Math.max(U.s, L.s);
          const dy = U.y - L.y;
          if (dy < 0.85 * sz || dy > 2.6 * sz || Math.abs(U.s - L.s) > 0.3 * sz) continue;
          const cu = (U.x0 + U.x1) / 2;
          const cl = (L.x0 + L.x1) / 2;
          if (Math.abs(cu - cl) > 0.25 * Math.max(U.x1 - U.x0, L.x1 - L.x0) + 0.35 * sz) continue;
          const x0 = Math.min(U.x0, L.x0);
          const x1 = Math.max(U.x1, L.x1);
          if (segs.some((M) => M !== U && M !== L && M.y < U.y - 0.25 * M.s && M.y > L.y + 0.25 * M.s &&
            M.x1 > x0 + 0.05 * sz && M.x0 < x1 - 0.05 * sz)) continue;
          // 紧贴在某个字符右侧、上下叠放的小字号是上下标，不是分式
          if (sz < 0.85 * s && cand.some((b) => !b.atom && b.s >= 0.85 * s && b.x1 <= x0 + 0.05 * s && x0 - b.x1 < 0.05 * s &&
            b.y < U.y && b.y > L.y)) continue;
          if (!best || dy < best.dy) best = { U, L, dy, x0, x1, sz };
        }
      }
      if (!best) break;
      const { U, L, x0, x1, sz } = best;
      const mid = (U.y + L.y) / 2;
      const inX = (e) => e.x1 > x0 - 0.1 * sz && e.x0 < x1 + 0.1 * sz;
      const num = cand.filter((e) => inX(e) && vy(e) > mid && vy(e) < U.y + 1.3 * sz);
      const den = cand.filter((e) => inX(e) && vy(e) < mid && vy(e) > L.y - 1.3 * sz);
      if (!num.length || !den.length) break;
      const all = num.concat(den);
      all.forEach((e) => used.add(e));
      atoms.push({
        atom: true,
        tex: `\\frac{${parseMath(copyEls(num), depth + 1)}}{${parseMath(copyEls(den), depth + 1)}}`,
        x0: Math.min(...all.map((e) => e.x0)),
        x1: Math.max(...all.map((e) => e.x1)),
        y: mid,
        s: sz,
      });
    }

    // 3) 按水平顺序输出：偏离基线的小字号作为上下标（递归处理嵌套），根号吸收其后的被开方数
    const rest = pool().sort((a, b) => a.x0 - b.x0);
    const B = baselineOf(rest, s);
    const out = [];
    let i = 0;
    while (i < rest.length) {
      if (isRad(rest[i])) {
        const rad = rest[i++];
        const body = [];
        if (i < rest.length && rest[i].atom && !rest[i].base) {
          body.push(rest[i++]);
        } else {
          // 根号的横线是图形，无法知道覆盖范围：取紧随其后的连续字母 / 数字（及其上下标）
          while (i < rest.length) {
            const e = rest[i];
            if (isBaseEl(e, B, s)) {
              if (e.atom || isRad(e) || !/^[A-Za-z0-9.]+$/.test(e.str.replace(/\s+/g, ''))) break;
              body.push(e);
              i++;
            } else if (body.length) {
              body.push(e);
              i++;
            } else break;
          }
        }
        const cmd = rad.str.trim() === '∛' ? '\\sqrt[3]' : rad.str.trim() === '∜' ? '\\sqrt[4]' : '\\sqrt';
        out.push(`${cmd}{${parseMath(copyEls(body), depth + 1)}}`);
        continue;
      }
      let base = '';
      if (isBaseEl(rest[i], B, s)) { base = texOf(rest[i]); i++; }
      const scripts = [];
      while (i < rest.length && !isBaseEl(rest[i], B, s)) scripts.push(rest[i++]);
      if (!scripts.length) { out.push(base); continue; }
      const sup = scripts.filter((e) => e.y > B + 0.05 * s);
      const sub = scripts.filter((e) => e.y <= B + 0.05 * s);
      let tex = base || '{}';
      if (sub.length) tex += '_' + grp(parseMath(copyEls(sub), depth + 1));
      if (sup.length) {
        const st = parseMath(copyEls(sup), depth + 1);
        tex += /^'+$/.test(st) ? st : '^' + grp(st);
      }
      out.push(tex);
    }
    return join(out).trim();
  }

  // 多行公式（对齐环境）：行首是关系符的放在左列
  function displayTex(rows) {
    if (rows.length === 1) return rows[0];
    const rel = /^(=|<|>|\\le|\\ge|\\leq|\\geq|\\ne|\\approx|\\equiv|\\sim|\\simeq|\\to|\\Rightarrow|\\iff)(?![A-Za-z])/;
    const lines = rows.map((r) => {
      const m = r.match(rel);
      return m ? m[0] + ' &' + r.slice(m[0].length) : '&' + r;
    });
    return '\\begin{aligned}\n' + lines.join(' \\\\\n') + '\n\\end{aligned}';
  }

  // ======================================================================
  //  收集选区中的文本项
  // ======================================================================
  function selectedTextNodes(range) {
    const ca = range.commonAncestorContainer;
    if (ca.nodeType === 3) return [ca];
    const out = [];
    const walker = document.createTreeWalker(ca, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (range.intersectsNode(n)) out.push(n);
    return out;
  }

  function inPdfTextLayer(range) {
    const ca = range.commonAncestorContainer;
    const el = ca.nodeType === 1 ? ca : ca.parentElement;
    return !!(el && (el.closest('.textLayer') || el.querySelector('.textLayer') || el.closest('#viewer')));
  }

  function itemSpanOf(node) {
    let el = node.nodeType === 1 ? node : node.parentElement;
    while (el && !el.__ccmItem) {
      if (el.classList && el.classList.contains('textLayer')) return null;
      el = el.parentElement;
    }
    return el;
  }

  function textOffsetIn(span, node, off) {
    if (node.nodeType !== 3) return null;
    let n = 0;
    const w = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      if (t === node) return n + off;
      n += t.nodeValue.length;
    }
    return null;
  }

  // 精确数据：每个 span 已由 pdf-bridge 标注了 PDF 文本项（基线、字号、宽度、字体）
  function collectRich(range) {
    const spans = [];
    const seen = new Set();
    for (const n of selectedTextNodes(range)) {
      if (!n.parentElement || !n.parentElement.closest('.textLayer')) continue;
      const span = itemSpanOf(n);
      if (!span) return null; // 有未标注的页面，退回简单模式
      if (!seen.has(span)) { seen.add(span); spans.push(span); }
    }
    if (!spans.length) return null;
    const pieces = [];
    spans.forEach((span, order) => {
      const item = span.__ccmItem;
      const str = item.str;
      let st = 0;
      let en = str.length;
      if (span.contains(range.startContainer)) st = textOffsetIn(span, range.startContainer, range.startOffset) ?? 0;
      if (span.contains(range.endContainer)) en = textOffsetIn(span, range.endContainer, range.endOffset) ?? str.length;
      if (en <= st) return;
      pieces.push(toPiece(item, span.__ccmPage, st, en, order));
    });
    return pieces.length ? pieces : null;
  }

  function toPiece(item, pn, st, en, order) {
    const str = item.str;
    const [, , c, d, e, f] = item.transform;
    const s = Math.hypot(c, d) || item.height || 10;
    const len = str.length || 1;
    const font = CCM.pdfFontName ? CCM.pdfFontName(pn, item.fontName) : '';
    return {
      str: str.slice(st, en),
      x0: e + (item.width * st) / len,
      x1: e + (item.width * en) / len,
      y: f,
      s,
      page: pn,
      order,
      font,
      isExt: EXT_FONT.test(font),
      mathFont: MATH_FONT.test(font),
      italic: ITALIC_FONT.test(font),
    };
  }

  // ---------- 精确模式：分行 ----------
  const boxOf = (p) => (p.isExt ? [p.y - 1.6 * p.s, p.y + 0.25 * p.s] : isRad(p) ? [p.y - 1.05 * p.s, p.y + 0.1 * p.s] : [p.y - 0.25 * p.s, p.y + 0.8 * p.s]);

  function richLines(pieces) {
    const byPage = new Map();
    for (const p of pieces) {
      if (!byPage.has(p.page)) byPage.set(p.page, []);
      byPage.get(p.page).push(p);
    }
    const lines = [];
    for (const [page, arr] of byPage) {
      const info = (CCM.pdfPages && CCM.pdfPages[page]) || { height: 0, top: 0 };
      const sizes = [];
      for (const p of arr) if (!p.isExt && p.str.trim()) for (let k = 0; k < Math.min(p.str.length, 50); k++) sizes.push(p.s);
      const bodyS = median(sizes) || 10;
      // 小字号的数学内容（上下标、上下限、行内分式的分子分母）、大型运算符与根号不作为“行”的锚点，之后再分配到最近的行
      const floating = (p) => p.isExt || isRad(p) ||
        (p.s < 0.88 * bodyS && !CJK.test(p.str) && (p.mathFont || p.italic || ROMAN_FONT.test(p.font) || !p.font));

      const anchors = [];
      const others = [];
      for (const p of [...arr].sort((a, b) => a.order - b.order)) (p.str.trim() && !floating(p) ? anchors : others).push(p);

      // A) 同一基线、水平相邻的锚点组成一行（相隔很远的视为另一栏）
      let clusters = [];
      for (const p of anchors) {
        const tol = Math.max(p.s, bodyS);
        const c = clusters.find((g) => Math.abs(g.y - p.y) < 0.3 * Math.max(g.s, p.s) &&
          p.x0 - g.x1 < 2 * tol && g.x0 - p.x1 < 2 * tol);
        if (c) {
          c.items.push(p);
          c.x0 = Math.min(c.x0, p.x0);
          c.x1 = Math.max(c.x1, p.x1);
          c.s = Math.max(c.s, p.s);
          c.weight += p.str.length;
        } else {
          clusters.push({ y: p.y, ys: [p.y], s: p.s, x0: p.x0, x1: p.x1, items: [p], weight: p.str.length });
        }
      }
      // 两段同基线的内容之间被上下标、根号、行内分式等“浮动”内容填满时，视为同一行
      const bridged = (a, b) => {
        const [L, R] = a.x0 <= b.x0 ? [a, b] : [b, a];
        const tol = 2 * Math.max(L.s, R.s, bodyS);
        const fill = others
          .filter((p) => p.x1 > L.x1 - tol && p.x0 < R.x0 + tol && Math.abs(vy(p) - L.y) < 1.3 * Math.max(L.s, R.s))
          .sort((x, y) => x.x0 - y.x0);
        let pos = L.x1;
        for (const p of fill) if (p.x0 - pos < tol) pos = Math.max(pos, p.x1);
        return R.x0 - pos < tol;
      };
      const yDist = (a, b) => Math.min(...a.ys.flatMap((y1) => b.ys.map((y2) => Math.abs(y1 - y2))));
      // B) 合并：基线相差不到一行的（行间公式里的分子、主行、分母），以及被浮动内容连接起来的同一行
      for (let merged = true; merged;) {
        merged = false;
        outer: for (let i = 0; i < clusters.length; i++) {
          for (let j = i + 1; j < clusters.length; j++) {
            const a = clusters[i];
            const b = clusters[j];
            const s = Math.max(a.s, b.s);
            const close = yDist(a, b) < 0.85 * s && b.x0 - a.x1 <= s && a.x0 - b.x1 <= s;
            const sameRow = Math.abs(a.y - b.y) < 0.3 * s && bridged(a, b);
            if (!close && !sameRow) continue;
            const main = a.weight >= b.weight ? a : b;
            clusters[i] = {
              y: main.y,
              ys: a.ys.concat(b.ys),
              s,
              x0: Math.min(a.x0, b.x0),
              x1: Math.max(a.x1, b.x1),
              items: a.items.concat(b.items),
              weight: a.weight + b.weight,
            };
            clusters.splice(j, 1);
            merged = true;
            break outer;
          }
        }
      }
      // C) 其余内容分配到垂直距离最近的行
      const leftovers = [];
      for (const p of others) {
        const y = vy(p);
        let best = null;
        for (const c of clusters) {
          if (p.x1 < c.x0 - 2 * c.s || p.x0 > c.x1 + 2 * c.s) continue;
          const d = Math.min(...c.ys.map((b) => Math.abs(y - b)));
          if (d < 1.7 * c.s && (!best || d < best.d)) best = { c, d };
        }
        if (best) best.c.items.push(p);
        else leftovers.push(p);
      }
      // 没有任何正文锚点的独立小字号内容（例如只有一个小号公式）
      for (const p of leftovers) {
        const y = vy(p);
        const c = clusters.find((g) => g.orphan && Math.abs(g.y - y) < 1.2 * Math.max(g.s, p.s) && p.x0 - g.x1 < 2 * g.s && g.x0 - p.x1 < 2 * g.s);
        if (c) {
          c.items.push(p);
          c.x0 = Math.min(c.x0, p.x0);
          c.x1 = Math.max(c.x1, p.x1);
        } else {
          clusters.push({ y, ys: [y], s: p.s, x0: p.x0, x1: p.x1, items: [p], weight: 0, orphan: true });
        }
      }

      for (const c of clusters) {
        const items = c.items.sort((a, b) => a.x0 - b.x0);
        if (!items.some((p) => p.str.trim())) continue;
        const normal = items.filter((p) => !p.isExt && !isRad(p) && p.str.trim());
        const sz = [];
        for (const p of normal) for (let k = 0; k < Math.min(p.str.length, 50); k++) sz.push(p.s);
        const s = median(sz) || items[0].s;
        const B = normal.length ? baselineOf(normal.map((p) => ({ ...p })), s) : c.y;
        const tops = items.map((p) => boxOf(p)[1]);
        const bots = items.map((p) => boxOf(p)[0]);
        lines.push({
          page,
          items,
          order: Math.min(...items.map((p) => p.order)),
          s,
          B,
          h: s,
          top: info.top - Math.max(...tops),
          bottom: info.top - Math.min(...bots),
          left: Math.min(...items.map((p) => p.x0)),
          right: Math.max(...items.map((p) => p.x1)),
          pageTop: 0,
          pageH: info.height,
        });
      }
    }
    lines.sort((a, b) => a.page - b.page || a.order - b.order);
    for (const l of lines) buildParts(l);
    return lines.filter((l) => l.text);
  }

  // ---------- 精确模式：一行内区分正文与公式 ----------
  function buildParts(line) {
    const { items, B, s } = line;
    for (const p of items) {
      const t = p.str.replace(/\s+/g, '');
      const script = p.s < 0.85 * s && Math.abs(p.y - B) > 0.08 * s;
      if (!t) p.kind = 'space';
      else if (CJK.test(p.str)) p.kind = 'text';
      else if (p.mathFont || p.isExt || script) p.kind = 'math';
      else if (p.italic && /^[A-Za-z]$/.test(t)) p.kind = 'math';
      else if (RADICALS.has(t)) p.kind = 'math';
      else if ((p.italic && /^[A-Za-z]{2,4}$/.test(t)) || NEUTRAL_RE.test(p.str) || FUNCS.has(t)) p.kind = 'neutral';
      else p.kind = 'text';
    }
    const solid = items.filter((p) => p.kind !== 'space');
    // 与公式相邻的数字、括号、运算符、函数名并入公式
    for (let changed = true; changed;) {
      changed = false;
      solid.forEach((p, i) => {
        if (p.kind !== 'neutral') return;
        const near = (q) => q && q.kind === 'math' && Math.max(q.x0 - p.x1, p.x0 - q.x1) < 0.8 * s;
        if (near(solid[i - 1]) || near(solid[i + 1])) { p.kind = 'math'; changed = true; }
        else if (p.italic && /^[A-Za-z]{2,4}$/.test(p.str.trim()) && [solid[i - 1], solid[i + 1]].some((q) => q && q.kind === 'text' && CJK.test(q.str))) { p.kind = 'math'; changed = true; }
      });
    }
    // 公式末尾的句读归还正文
    solid.forEach((p, i) => {
      if (p.kind === 'math' && /^[.,;:]+$/.test(p.str.trim()) && !(solid[i + 1] && solid[i + 1].kind === 'math') && !p.mathFont) p.kind = 'text';
    });
    for (const p of solid) if (p.kind === 'neutral') p.kind = 'text';

    const parts = [];
    let prev = null;
    for (const p of solid) {
      const gap = prev ? p.x0 - prev.x1 : 0;
      const last = parts[parts.length - 1];
      if (p.kind === 'math') {
        if (last && last.t === 'math' && gap < 1.2 * s) last.items.push(p);
        else {
          if (last && last.t === 'text' && gap > 0.12 * s && !/\s$/.test(last.s)) last.s += ' ';
          parts.push({ t: 'math', items: [p] });
        }
      } else {
        let str = p.str.replace(/\s+/g, ' ');
        if (last && last.t === 'text') {
          // 中文与西文之间有可见间距时保留空格（如“考虑 DP”、“1 平衡”）
          const a = last.s.slice(-1);
          const b = str[0];
          const mixed = a && b && !/\s/.test(a) && !/\s/.test(b) && CJK.test(a) !== CJK.test(b);
          if (gap > 0.15 * s && (needsSpace(last.s, str) || mixed)) last.s += ' ';
          last.s += str;
        } else {
          if (last && last.t === 'math' && gap > 0.12 * s && !/^\s/.test(str)) str = ' ' + str;
          parts.push({ t: 'text', s: str });
        }
      }
      prev = p;
    }
    for (const part of parts) {
      if (part.t === 'math') { part.tex = parseMath(copyEls(part.items)); delete part.items; }
    }
    line.parts = parts.filter((p) => (p.t === 'math' ? p.tex : p.s));
    if (line.parts.length && line.parts[0].t === 'text') line.parts[0].s = line.parts[0].s.replace(/^\s+/, '');
    const lastP = line.parts[line.parts.length - 1];
    if (lastP && lastP.t === 'text') lastP.s = lastP.s.replace(/\s+$/, '');
    line.display = line.parts.length === 1 && line.parts[0].t === 'math';
    line.text = line.parts.map((p) => (p.t === 'math' ? `$${p.tex}$` : p.s)).join('');
  }

  // ---------- 简单模式（span 尚未标注时）：只用屏幕位置 ----------
  function collectLegacy(range) {
    const items = [];
    for (const n of selectedTextNodes(range)) {
      const span = n.parentElement;
      if (!span || !span.closest('.textLayer')) continue;
      let str = n.nodeValue;
      const s = n === range.startContainer ? range.startOffset : 0;
      const e = n === range.endContainer ? range.endOffset : str.length;
      str = str.slice(s, e);
      if (!str) continue;
      const r = span.getBoundingClientRect();
      if (!r.width && !r.height) continue;
      const pageEl = span.closest('.page');
      const pr = pageEl ? pageEl.getBoundingClientRect() : null;
      items.push({
        str, left: r.left, right: r.right, top: r.top, bottom: r.bottom, h: r.height,
        page: pageEl ? +pageEl.dataset.pageNumber || 0 : 0,
        pageTop: pr ? pr.top : 0, pageH: pr ? pr.height : 0,
        eol: !!(span.nextSibling && span.nextSibling.nodeName === 'BR'),
      });
    }
    if (!items.length) return null;
    const lines = [];
    let cur = null;
    for (const it of items) {
      const overlap = cur ? Math.min(cur.bottom, it.bottom) - Math.max(cur.top, it.top) : 0;
      const same = cur && cur.page === it.page && !cur.eol && it.left > cur.left - 1 &&
        (overlap > Math.min(cur.h, it.h) * 0.35 ||
          Math.abs((it.top + it.bottom) / 2 - (cur.top + cur.bottom) / 2) < Math.max(Math.min(cur.h, it.h) * 0.6, 2));
      if (!same) {
        cur = { ...it, text: '' };
        lines.push(cur);
      } else {
        if (it.left - cur.right > Math.min(cur.h, it.h) * 0.15 && needsSpace(cur.text, it.str)) cur.text += ' ';
        cur.top = Math.min(cur.top, it.top);
        cur.bottom = Math.max(cur.bottom, it.bottom);
        cur.right = Math.max(cur.right, it.right);
        cur.h = Math.max(cur.h, it.h);
      }
      cur.text += it.str;
      cur.eol = it.eol;
    }
    for (const l of lines) {
      l.text = l.text.replace(/\s+/g, ' ').trim();
      l.parts = [{ t: 'text', s: l.text }];
      l.display = false;
      l.legacy = true;
    }
    return lines.filter((l) => l.text);
  }

  // ======================================================================
  //  分段
  // ======================================================================
  function bodyHeight(lines) {
    const arr = [];
    for (const l of lines) if (!l.display) for (let i = 0; i < Math.min(l.text.length, 200); i++) arr.push(l.h);
    return median(arr) || (lines[0] && lines[0].h) || 12;
  }

  // 跨多页选择时，去掉在多页的页面边缘重复出现的页眉 / 页脚（幻灯片导航、作者、页码等）
  function dropRunningHeaders(lines) {
    const pages = new Set(lines.map((l) => l.page));
    if (pages.size < 2) return lines;
    const edge = (l) => {
      if (!l.pageH) return false;
      const y = (l.top - l.pageTop) / l.pageH;
      return y < 0.12 || y > 0.88;
    };
    const key = (l) => l.text.replace(/\d+/g, '#').replace(/\s+/g, '');
    const seen = new Map();
    for (const l of lines) {
      if (!edge(l)) continue;
      const k = key(l);
      if (!seen.has(k)) seen.set(k, new Set());
      seen.get(k).add(l.page);
    }
    return lines.filter((l) => !(edge(l) && seen.get(key(l)).size >= 2));
  }

  function mergeTextParts(parts) {
    const out = [];
    for (const p of parts) {
      const last = out[out.length - 1];
      if (last && last.t === 'text' && p.t === 'text') last.s += p.s;
      else out.push({ ...p });
    }
    return out;
  }

  // 段落内换行合并：英文断词连字符、中日韩文字之间不加空格
  function joinParts(a, b) {
    const x = a[a.length - 1];
    const y = b[0];
    if (!x || !y) return a.concat(b);
    if (x.t === 'text' && y.t === 'text' && /[A-Za-z]-$/.test(x.s) && /^[a-z]/.test(y.s)) {
      return mergeTextParts([...a.slice(0, -1), { t: 'text', s: x.s.slice(0, -1) + y.s }, ...b.slice(1)]);
    }
    const lc = x.t === 'text' ? x.s.slice(-1) : '';
    const fc = y.t === 'text' ? y.s[0] : '';
    const sep = lc && fc && (CJK.test(lc) || CJK.test(fc)) ? '' : ' ';
    return mergeTextParts([...a, ...(sep ? [{ t: 'text', s: sep }] : []), ...b]);
  }

  const MATH_LINE_CHARS = /[=+−×÷∑∏∫√≤≥≠≈∈∉∀∃⌊⌋⌈⌉±∞∂∇→⇒′|]/;
  const looksLikeMathLine = (s) => !CJK.test(s) && s.length <= 80 && (s.length <= 3 || MATH_LINE_CHARS.test(s)) &&
    !/[A-Za-z]{3,}\s+[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(s);

  function buildBlocks(lines) {
    const bodyH = bodyHeight(lines);
    const gaps = [];
    for (let i = 1; i < lines.length; i++) {
      const a = lines[i - 1];
      const b = lines[i];
      if (a.page === b.page && !a.display && !b.display && Math.abs(a.h - bodyH) < bodyH * 0.15 && Math.abs(b.h - bodyH) < bodyH * 0.15) {
        const g = b.top - a.top;
        if (g > 0) gaps.push(g);
      }
    }
    const lineGap = median(gaps) || bodyH * 1.4;
    const textLines = lines.filter((l) => !l.display);
    const maxRight = textLines.length ? Math.max(...textLines.map((l) => l.right)) : 0;
    const minLeft = textLines.length ? Math.min(...textLines.map((l) => l.left)) : 0;

    // 页面边缘的独立页码
    lines = lines.filter((l, i) => {
      if (!/^\d{1,4}$/.test(l.text) || !l.pageH) return true;
      const y = (l.top - l.pageTop) / l.pageH;
      if (y > 0.08 && y < 0.92) return true;
      const prev = lines[i - 1];
      const next = lines[i + 1];
      return !((!prev || prev.page !== l.page) || (!next || next.page !== l.page));
    });

    const kindOf = (l) => {
      if (l.display) return { type: 'display' };
      const ratio = l.h / bodyH;
      if (ratio >= 1.15 && l.text.length <= 120 && !SENTENCE_END.test(l.text.replace(/[:：]$/, ''))) {
        return { type: 'h', level: ratio >= 1.7 ? 1 : ratio >= 1.28 ? 2 : 3 };
      }
      const first = l.parts[0];
      if (first && first.t === 'text') {
        let m = first.s.match(BULLET_RE);
        if (m) return { type: 'ul', strip: first.s.length - m[2].length };
        m = first.s.match(ORDERED_RE);
        if (m) return { type: 'ol', n: +m[1], strip: first.s.length - m[2].length };
        if (OTHER_ENUM_RE.test(first.s)) return { type: 'p', forceNew: true };
      }
      if (l.legacy && looksLikeMathLine(l.text)) return { type: 'math' };
      return { type: 'p' };
    };
    const stripParts = (parts, n) => {
      if (!n) return parts.map((p) => ({ ...p }));
      return [{ t: 'text', s: parts[0].s.slice(n) }, ...parts.slice(1).map((p) => ({ ...p }))].filter((p) => p.t !== 'text' || p.s);
    };

    const blocks = [];
    let cur = null;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      const prev = lines[i - 1];
      const k = kindOf(l);

      if (k.type === 'display') {
        if (cur && cur.type === 'display' && prev && prev.page === l.page && l.top - prev.bottom < bodyH * 2.5) cur.rows.push(l.parts[0].tex);
        else { cur = { type: 'display', rows: [l.parts[0].tex] }; blocks.push(cur); }
        continue;
      }
      // 简单模式：公式的上下限、分子分母分布在多行，连续的公式行合并成一块
      if (cur && cur.type === 'math' && k.type === 'math' && prev && prev.page === l.page && l.top - prev.top < lineGap * 3) {
        cur.parts = joinParts(cur.parts, l.parts);
        continue;
      }
      let fresh = !cur || cur.type === 'display' || k.type === 'ul' || k.type === 'ol' || k.forceNew ||
        (k.type === 'math') !== (cur.type === 'math') || (k.type === 'h') !== (cur.type === 'h');
      if (!fresh && prev) {
        const curText = cur.parts.map((p) => (p.t === 'text' ? p.s : '$')).join('');
        if (prev.page !== l.page) {
          fresh = SENTENCE_END.test(curText); // 跨页：上一页最后一行不是句末才接续
        } else {
          const g = l.top - prev.top;
          if (g < 0 || g > lineGap * 1.45) fresh = true;
          else if (Math.abs(l.h - prev.h) > bodyH * 0.2) fresh = true;
          // 句末且没有排满一行：段落结束（中文两端对齐，差一个字就说明是段尾）
          else if (cur.type === 'p' && SENTENCE_END.test(prev.text) &&
            prev.right < maxRight - bodyH * (CJK.test(prev.text.slice(-1)) ? 0.9 : 3)) fresh = true;
          else if (cur.type === 'p' && l.left - minLeft > bodyH * 1.2 && prev.left - minLeft < bodyH * 0.5) fresh = true;
          // 很短、且不以标点结尾的一行（如幻灯片里的“性质 1”“证明 2”）是独立的小标题
          else if (cur.type === 'p' && cur.parts.length === prev.parts.length && prev.text.length <= 12 &&
            !SENTENCE_END.test(prev.text) && prev.right - prev.left < (maxRight - minLeft) * 0.4) fresh = true;
        }
      }
      if (fresh) {
        cur = { type: k.type, level: k.level, n: k.n, parts: stripParts(l.parts, k.strip) };
        blocks.push(cur);
      } else {
        cur.parts = joinParts(cur.parts, l.parts);
      }
    }
    return blocks;
  }

  // ======================================================================
  //  输出
  // ======================================================================
  function render(blocks, settings) {
    const d = CCM.delims ? CCM.delims(settings) : { inline: ['$', '$'], display: ['$$', '$$'] };
    const [io, ic] = d.inline;
    const [dO, dC] = d.display;
    const esc = (t) => (CCM.escapeMarkdownText ? CCM.escapeMarkdownText(t, settings) : t);
    const md = [];
    const html = [];
    const text = [];
    let mathCount = 0;
    let listType = null;

    const partsMd = (parts) => parts.map((p) => (p.t === 'math' ? `${io}${p.tex}${ic}` : esc(p.s))).join('');
    const partsHtml = (parts) => parts.map((p) => (p.t === 'math'
      ? `<span class="math math-inline">${escHtml(io + p.tex + ic)}</span>` : escHtml(p.s))).join('');
    const partsText = (parts) => parts.map((p) => (p.t === 'math' ? io + p.tex + ic : p.s)).join('');

    for (const b of blocks) {
      const isList = b.type === 'ul' || b.type === 'ol';
      if (listType && listType !== b.type) { html.push(`</${listType}>`); listType = null; }
      if (isList && !listType) { html.push(b.type === 'ol' && b.n !== 1 ? `<ol start="${b.n}">` : `<${b.type}>`); listType = b.type; }
      if (b.parts) mathCount += b.parts.filter((p) => p.t === 'math').length;

      const prevList = md.length ? md[md.length - 1].list : null;
      const sep = isList && prevList === b.type ? '\n' : '\n\n';
      let line;
      if (b.type === 'display') {
        mathCount++;
        const tex = displayTex(b.rows);
        line = `${dO}\n${tex}\n${dC}`;
        html.push(`<div class="math math-display">${escHtml(dO + tex + dC)}</div>`);
        text.push(dO + tex + dC);
      } else {
        if (b.type === 'h') line = '#'.repeat(b.level) + ' ' + partsMd(b.parts);
        else if (b.type === 'ul') line = '- ' + partsMd(b.parts);
        else if (b.type === 'ol') line = `${b.n}. ` + partsMd(b.parts);
        else line = partsMd(b.parts).replace(/^(#{1,6}\s|>|[-+*]\s)/, '\\$1');

        if (b.type === 'h') html.push(`<h${b.level}>${partsHtml(b.parts)}</h${b.level}>`);
        else if (isList) html.push(`<li>${partsHtml(b.parts)}</li>`);
        else html.push(`<p>${partsHtml(b.parts)}</p>`);
        text.push((b.type === 'ul' ? '- ' : b.type === 'ol' ? `${b.n}. ` : '') + partsText(b.parts));
      }
      md.push({ s: (md.length ? sep : '') + line, list: isList ? b.type : null });
    }
    if (listType) html.push(`</${listType}>`);
    return { markdown: md.map((x) => x.s).join(''), html: html.join('\n'), text: text.join('\n\n'), mathCount };
  }

  // 对外：根据当前选区生成 { markdown, html, text, mathCount, rebuilt }；选区不在 PDF 文本层时返回 null
  CCM.pdfSelection = function pdfSelection(range, settings) {
    if (!inPdfTextLayer(range)) return null;
    const rich = collectRich(range);
    const lines = rich ? richLines(rich) : collectLegacy(range);
    if (!lines || !lines.length) return null;
    const out = render(buildBlocks(dropRunningHeaders(lines)), settings);
    out.rebuilt = !!rich;
    out.hasMath = !rich && /[∑∏∫√≤≥≠≈∈∉∀∃⌊⌋⌈⌉±×÷∞∂∇→⇒−′]/.test(out.text);
    return out;
  };

  // ======================================================================
  //  全选 / 跨越未渲染页面的选区
  //  PDF.js 只为视口附近的页面生成文本层，Ctrl+A 只能选中这些页面；
  //  这时直接通过 PDF.js 接口读取所需页面的全部文本项。
  // ======================================================================
  let selectAll = false;
  let selectAllResult = null;
  if (typeof document !== 'undefined') {
    // 页码框、缩放框属于工具栏：在其中按 Ctrl+A 也全选 PDF 内容；只有查找框、批注编辑等真正的输入区域保留原生行为
    const editable = (el) => el && el.id !== 'pageNumber' && el.id !== 'scaleSelect' &&
      (el.isContentEditable || /^(input|textarea|select)$/i.test(el.localName));
    document.addEventListener('keydown', (e) => {
      if (!CCM.isPdfViewerPage) return;
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== 'a' || editable(e.target)) return;
      const viewer = document.getElementById('viewer');
      if (!viewer) return;
      if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#toolbarContainer')) {
        document.activeElement.blur();
      }
      // 全选只选中 PDF 页面内容（不含工具栏、页码、缩放框和侧边栏）
      e.preventDefault();
      e.stopPropagation();
      const range = document.createRange();
      range.selectNodeContents(viewer);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      selectAll = true;
      selectAllResult = null;
      // 提前在后台读取全部页面，供随后的浏览器原生复制（Ctrl+C）使用
      const settings = CCM.currentSettings || CCM.DEFAULTS || {};
      CCM.pdfSelectionAsync(range, settings).then((r) => { if (selectAll) selectAllResult = r; }).catch(() => {});
    }, true);
    document.addEventListener('pointerdown', () => { selectAll = false; selectAllResult = null; }, true);
    document.addEventListener('selectionchange', () => {
      const s = getSelection();
      if (!s || s.isCollapsed) { selectAll = false; selectAllResult = null; }
    });
    // 全选后按浏览器原生复制：PDF.js 只能复制已渲染的页面，这里换成全部页面的文本
    document.addEventListener('copy', (e) => {
      if (!CCM.isPdfViewerPage || !selectAll || !selectAllResult || !e.clipboardData) return;
      e.clipboardData.setData('text/plain', selectAllResult.text);
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
    }, true);
  }

  const pageOfNode = (node) => {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    const pg = el && el.closest && el.closest('.page');
    return pg ? +pg.dataset.pageNumber || 0 : 0;
  };
  const pageTagged = (n) => {
    const layer = document.querySelector(`.page[data-page-number="${n}"] .textLayer`);
    if (!layer) return false;
    const span = layer.querySelector('span:not(.markedContent)');
    return !span || !!span.__ccmItem; // 没有文字的页面也算已就绪
  };

  function selectionPages(range) {
    const app = globalThis.PDFViewerApplication;
    const total = (app && app.pagesCount) || 0;
    if (selectAll && total) return { from: 1, to: total, all: true };
    const nodes = selectedTextNodes(range).filter((n) => n.parentElement && n.parentElement.closest('.textLayer'));
    const from = pageOfNode(range.startContainer) || (nodes.length ? pageOfNode(nodes[0]) : 0);
    const to = pageOfNode(range.endContainer) || (nodes.length ? pageOfNode(nodes[nodes.length - 1]) : 0);
    return { from, to: Math.max(from, to), all: false };
  }

  // 是否需要异步读取（全选，或选区中间有尚未渲染文本层的页面）
  CCM.pdfNeedsAsync = (range) => {
    const app = globalThis.PDFViewerApplication;
    if (!app || !app.pdfDocument) return false;
    if (selectAll) return true;
    if (!inPdfTextLayer(range)) return false;
    const { from, to } = selectionPages(range);
    if (!from) return false;
    for (let n = from + 1; n < to; n++) if (!pageTagged(n)) return true;
    return false;
  };
  CCM.pdfSelectionPageCount = (range) => {
    const { from, to } = selectionPages(range);
    return from ? to - from + 1 : 0;
  };

  async function apiPieces(n, orderBase) {
    const app = globalThis.PDFViewerApplication;
    const page = await app.pdfDocument.getPage(n);
    const tc = await page.getTextContent({ includeMarkedContent: true, disableNormalization: true });
    const items = tc.items.filter((it) => it.str);
    // 字体在页面渲染（解析操作列表）时才会加载；未渲染过的页面需要先解析一次才能拿到字体名
    const fontsMissing = items.some((it) => { try { page.commonObjs.get(it.fontName); return false; } catch (_) { return true; } });
    if (fontsMissing) { try { await page.getOperatorList(); } catch (_) { /* ignore */ } }
    const [x0, y0, x1, y1] = page.view;
    if (!CCM.pdfPages[n]) CCM.pdfPages[n] = { page, styles: tc.styles, width: x1 - x0, height: y1 - y0, top: y1 };
    return items.map((it, i) => toPiece(it, n, 0, it.str.length, orderBase + i));
  }

  CCM.pdfSelectionAsync = async function pdfSelectionAsync(range, settings, onProgress) {
    const { from, to, all } = selectionPages(range);
    if (!from) return null;
    const dom = all ? [] : collectRich(range) || [];
    const pieces = [];
    for (let n = from; n <= to; n++) {
      const own = dom.filter((p) => p.page === n);
      // 起止页按实际选区（可能只选了一部分）；中间页整页读取
      if (!all && (n === from || n === to || pageTagged(n)) && own.length) pieces.push(...own);
      else if (all || (n !== from && n !== to)) pieces.push(...await apiPieces(n, pieces.length));
      if (onProgress) onProgress(n - from + 1, to - from + 1);
    }
    pieces.forEach((p, i) => { p.order = i; });
    if (!pieces.length) return null;
    const lines = richLines(pieces);
    if (!lines.length) return null;
    const out = render(buildBlocks(dropRunningHeaders(lines)), settings);
    out.rebuilt = true;
    out.hasMath = false;
    return out;
  };

  // 供测试使用
  CCM._pdfParseMath = parseMath;
})();
