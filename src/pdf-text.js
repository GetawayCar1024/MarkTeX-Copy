// PDF.js 文本层 → 结构化内容（段落 / 标题 / 列表 / 公式）
// PDF 里只有定位好的文字片段，没有段落、标题和公式结构，这里根据位置、字号和字体重建：
//   * 正文：按行合并为段落，识别标题（字号）、列表（项目符号 / 编号）、跨页段落、页眉页脚
//   * 公式：按字体（CMMI / CMSY / CMEX / 数学斜体等）和上下标偏移识别，
//           再按二维排版还原 LaTeX：上下标、∑ 等大型运算符的上下限、分式、多行对齐公式
(() => {
  const CCM = (globalThis.__CCM = globalThis.__CCM || {});
  if (CCM.pdfSelection) return;

  const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/;
  const CJK_PUNCT = /^[\u3000-\u303f\uff01-\uff0f\uff1a-\uff20\uff3b-\uff40\uff5b-\uff65]$/;
  const SENTENCE_END = /[.。!?！？:：;；…]["”’)）\]]*$/;
  const BULLET_RE = /^([•●○◦▪▫■□‣⁃∙·▸►\-–—*∗])\s+(.*)$/;
  const BULLET_CHAR = /^[•●○◦▪▫■□‣⁃∙▸►–—∗*]$/;
  const MONO_FONT = /mono|consol|courier|menlo|monaco|lucida\s*console|lucidaconsole|sourcecode|inconsolata|firacode|fira\s*code|jetbrains|cascadia|sfmono/i;
  // LaTeX picture 环境的绘图字体（画代码框的圆角、斜线），字形不是文字
  const PICTURE_FONT = /(^|\+)L(CIRCLE|INE)W?10$/i;
  // 没有 Unicode 映射的字形，PDF.js 给出的是控制字符
  const CONTROL_ONLY = (s) => /[\u0000-\u0008\u000e-\u001f]/.test(s) && !/[^\s\u0000-\u001f]/.test(s);
  // 粗体：字体名含 Bold 等，或中文排版中常用来表示加粗的黑体
  const BOLD_FONT = /bold|heavy|black|semibold|demibold|simhei|heiti|黑体/i;
  const EMPHASIS_DOTS = /^[·・•﹅﹆]+$/;
  const ORDERED_RE = /^(\d{1,3})[.)]\s+(.*)$/;
  const OTHER_ENUM_RE = /^(\(\d{1,3}\)|（\d{1,3}）|[（(][一二三四五六七八九十]+[)）]|[一二三四五六七八九十]+、|[a-zA-Z][.)]\s)/;

  const BIG_OPS = new Set(Array.from('∑∏∐∫∬∭∮⋃⋂⨁⨂⨀⨄⋁⋀'));
  const LIMIT_FUNCS = new Set(['lim', 'limsup', 'liminf', 'max', 'min', 'sup', 'inf', 'det', 'gcd', 'Pr']);
  const MATH_FONT = /(^|\+)(CMMI|CMSY|CMEX|CMBSY|CMMIB|MSAM|MSBM|EUFM|EUSM|EUEX|RSFS|LMMath|LatinModernMath|STIX\w*Math|XITS\w*Math|Cambria\W?Math|TeXGyre\w*Math|NewCM\w*Math|FiraMath|Asana|MTMI|MTSY|MTEX|Euclid|MathJax)/i;
  const EXT_FONT = /(^|\+)(CMEX|EUEX|MTEX)|Extension/i;
  const ITALIC_FONT = /Italic|Oblique|(^|\+)CMTI|-It$/i;
  const ROMAN_FONT = /(^|\+)(CMR|CMBX|LMRoman|LMRomanDemi|CMSL)/i;
  const NEUTRAL_RE = /^[\s\d()[\]{}+\-−=<>.,;:!|/*'′·…]+$/;

  const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // macOS 生成的 PDF 常把部分汉字映射为外形相同的康熙部首（“⼀”U+2F00 而不是“一”U+4E00），复制出的文字无法搜索；
  // 换回对应的统一汉字（每个字符一对一，长度不变）
  const fixCjk = (s) => s.replace(/[\u2e9f\u2ef3\u2f00-\u2fd5]/g, (c) => c.normalize('NFKC'));
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
  const texOf = (e) => (e.atom || e.tex != null ? e.tex : texStr(e.str));

  const RADICALS = new Set(Array.from('√∛∜'));
  const isRad = (e) => !e.atom && RADICALS.has((e.str || '').trim());
  // “虚拟基线”：TeX 的大型运算符（CMEX）和根号（CMSY √）的基线在字形顶部，字形向下悬挂
  // MathJax 字形（geo）的坐标是真实基线，不需要修正
  const vy = (e) => (e.atom || e.geo ? e.y : e.isExt ? e.y - 0.9 * e.s : isRad(e) ? e.y - 0.84 * e.s : e.y);

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
    const els = input.filter((e) => e.atom || e.rule || (e.str && e.str.trim()));
    if (!els.length || els.every((e) => e.rule)) return '';
    if (depth > 8) return join([...els].filter((e) => !e.rule).sort((a, b) => a.x0 - b.x0).map(texOf));
    const s = refSize(els.filter((e) => !e.rule));
    const used = new Set();
    const atoms = [];
    const pool = () => els.filter((e) => !used.has(e) && !e.rule).concat(atoms.filter((a) => !used.has(a)));

    // 0) 横线（来自矢量公式）：根号横线 → \sqrt，分数线 → \frac，否则上 / 下划线。短的（内层的）先处理
    const mid = (e) => (e.x0 + e.x1) / 2;
    for (const r of els.filter((e) => e.rule).sort((a, b) => (a.x1 - a.x0) - (b.x1 - b.x0))) {
      used.add(r);
      const sz = r.s || s;
      const within = (e) => mid(e) >= r.x0 - 0.05 * sz && mid(e) <= r.x1 + 0.05 * sz;
      const surd = pool().find((e) => isRad(e) && Math.abs(e.x1 - r.x0) < 0.6 * sz && e.y < r.y + 0.2 * sz);
      if (surd) {
        // 被开方数：横线下方、不低于根号的基线（再往下是外层分数的分母等）
        const body = pool().filter((e) => e !== surd && within(e) && vy(e) < r.y && vy(e) > r.y - 3 * sz && (!surd.geo || vy(e) > surd.y - 0.5 * sz));
        // 根指数：根号左上方的小字号内容
        const index = pool().filter((e) => e !== surd && !body.includes(e) && e.s < 0.8 * surd.s &&
          e.x1 <= surd.x0 + 0.6 * surd.s && e.x0 >= surd.x0 - 1.2 * surd.s && vy(e) > surd.y);
        [surd, ...body, ...index].forEach((e) => used.add(e));
        const idx = index.length ? `[${parseMath(copyEls(index), depth + 1)}]` : '';
        const bodyY = body.length ? baselineOf(body, refSize(body)) : r.y - 0.8 * sz;
        atoms.push({ atom: true, base: true, tex: `\\sqrt${idx}{${parseMath(copyEls(body), depth + 1)}}`, x0: Math.min(surd.x0, ...index.map((e) => e.x0)), x1: r.x1, y: bodyY, s: sz });
        continue;
      }
      const num = pool().filter((e) => within(e) && vy(e) > r.y && vy(e) < r.y + 2.8 * sz);
      const den = pool().filter((e) => within(e) && vy(e) < r.y && vy(e) > r.y - 2.8 * sz);
      if (!num.length && !den.length) continue;
      [...num, ...den].forEach((e) => used.add(e));
      let tex;
      if (num.length && den.length) tex = `\\frac{${parseMath(copyEls(num), depth + 1)}}{${parseMath(copyEls(den), depth + 1)}}`;
      else if (num.length) tex = `\\overline{${parseMath(copyEls(num), depth + 1)}}`;
      else tex = `\\underline{${parseMath(copyEls(den), depth + 1)}}`;
      // 数学轴在基线之上约 0.25em：分数的“基线”取横线下方 0.25em
      atoms.push({ atom: true, tex, x0: r.x0, x1: r.x1, y: num.length && den.length ? r.y - 0.25 * sz : baselineOf(num.concat(den), sz), s: sz });
    }

    // 1) 带上下限的大型运算符（上下限与运算符水平重叠，位于其上方 / 下方）；
    //    行间公式中的 \max、\min、\lim 等的下限也写在正下方
    for (const op of els) {
      if (used.has(op) || op.atom) continue;
      const name = op.str.trim();
      const big = Array.from(name).length === 1 && BIG_OPS.has(name);
      if (!big && !LIMIT_FUNCS.has(name)) continue;
      const cy = op.isExt ? op.y - 0.65 * op.s : op.y + 0.3 * op.s;
      const lims = els.filter((e) => e !== op && !used.has(e) && !e.atom && e.s < op.s * 0.92 &&
        overlapX(e, op) > 0.25 * Math.min(e.x1 - e.x0, op.x1 - op.x0) && Math.abs(e.y - cy) < 2.8 * op.s &&
        (big || e.y < op.y - 0.45 * op.s));
      if (!lims.length) continue;
      // 比运算符宽的上下限：同一行上与之相连的部分也属于上下限（如 \max 下方的 1\le i\le n）
      for (let grow = true; grow;) {
        grow = false;
        for (const e of els) {
          if (e === op || e.atom || used.has(e) || lims.includes(e) || e.s >= op.s * 0.92) continue;
          if (lims.some((q) => Math.abs(q.y - e.y) < 0.25 * q.s && Math.max(e.x0 - q.x1, q.x0 - e.x1) < 0.6 * q.s)) {
            lims.push(e);
            grow = true;
          }
        }
      }
      lims.forEach((e) => used.add(e));
      used.add(op);
      const lo = lims.filter((e) => e.y < cy);
      const up = lims.filter((e) => e.y >= cy);
      atoms.push({
        atom: true,
        base: true,
        tex: texOf(op) + (lo.length ? `_{${parseMath(copyEls(lo), depth + 1)}}` : '') +
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
    const g = item.__glyph;
    if (g && g.image) return { str: '', image: g.image, x0: g.x, x1: g.x1, y: g.y, s: 10, page: pn, order, font: '' };
    if (g && g.bullet) {
      // 画出来的列表符号：位置、字号在 richLines 中对齐到同一行的文字
      return { str: g.str, x0: g.x, x1: g.x1, y: g.y, cy: g.cy, s: g.s, page: pn, order, font: '', bullet: true, isExt: false, mathFont: false, italic: false };
    }
    if (g) {
      // 由 pdf-glyphs.js 从矢量路径识别出的 MathJax 字形（位置、字号都是真实值）
      const font = 'MathJax-' + g.variant;
      return {
        str: g.rule ? '' : g.str,
        x0: g.x,
        x1: g.x1,
        y: g.y,
        s: g.s,
        page: pn,
        order,
        font,
        geo: true,
        rule: !!g.rule,
        tex: g.tex,
        base: !!g.base,
        isExt: false,
        mathFont: true,
        italic: /italic|mathit/i.test(g.variant) || /[\u{1d434}-\u{1d467}\u{1d6e2}-\u{1d71b}]/u.test(g.str),
      };
    }
    const len = str.length || 1;
    const font = CCM.pdfFontName ? CCM.pdfFontName(pn, item.fontName) : '';
    return {
      str: fixCjk(str.slice(st, en)),
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
  const boxOf = (p) => {
    if (p.rule) return [p.y - 0.1 * p.s, p.y + 0.1 * p.s];
    if (p.geo) return BIG_OPS.has(p.str) || isRad(p) ? [p.y - 0.6 * p.s, p.y + 1.0 * p.s] : [p.y - 0.25 * p.s, p.y + 0.8 * p.s];
    if (p.isExt) return [p.y - 1.6 * p.s, p.y + 0.25 * p.s];
    if (isRad(p)) return [p.y - 1.05 * p.s, p.y + 0.1 * p.s];
    return [p.y - 0.25 * p.s, p.y + 0.8 * p.s];
  };

  // 把位于表格边框内的文字项取出，按单元格还原后作为一个“表格行”加入 lines；返回剩余的文字项
  function extractTables(page, arr, bodyS, info, lines) {
    const tables = (CCM.pdfTables && CCM.pdfTables[page]) || [];
    if (!tables.length) return arr;
    let rest = arr;
    for (const t of tables) {
      const inside = (p) => {
        const cx = (p.x0 + p.x1) / 2;
        const y = p.rule ? p.y : vy(p);
        return cx > t.x0 && cx < t.x1 && y > t.y0 && y < t.y1;
      };
      const mine = rest.filter(inside);
      if (!mine.length) continue;
      const nr = t.rows.length - 1;
      const nc = t.cols.length - 1;
      const grid = Array.from({ length: nr }, () => Array.from({ length: nc }, () => []));
      // 合并单元格：某一列中缺少的横线不算行分隔，内容归到合并区域的第一行
      const colRows = t.cols.slice(0, -1).map((left, c) => {
        const mid = (left + t.cols[c + 1]) / 2;
        const segs = t.hsegs || [];
        return t.rows.filter((y, i) => i === 0 || i === t.rows.length - 1 || !segs.length ||
          segs.some((h) => Math.abs(h.y - y) < 1.5 && h.x0 <= mid && h.x1 >= mid));
      });
      for (const p of mine) {
        const cx = (p.x0 + p.x1) / 2;
        const y = p.rule ? p.y : vy(p);
        let c = t.cols.findIndex((left, i) => i < nc && cx >= left && cx < t.cols[i + 1]);
        if (c < 0) c = nc - 1;
        const rows = colRows[c];
        const k = rows.findIndex((top, i) => i < rows.length - 1 && y <= top && y > rows[i + 1]);
        let r = k < 0 ? nr - 1 : t.rows.findIndex((top) => Math.abs(top - rows[k]) < 0.01);
        if (r < 0 || r >= nr) r = nr - 1;
        grid[r][c].push(p);
      }
      const rows = grid.map((row) => row.map((cell) => {
        if (!cell.some((p) => p.str.trim())) return [];
        const ls = richLines(cell, { noTables: true, noImages: true, bodyS });
        return ls.reduce((acc, l) => (acc.length ? joinParts(acc, l.parts) : l.parts.map((x) => ({ ...x }))), []);
      })).filter((row) => row.some((cell) => cell.length));
      if (rows.reduce((a, row) => a + row.filter((c) => c.length).length, 0) < 2) continue;
      rest = rest.filter((p) => !inside(p));
      lines.push({
        page, table: true, rows, items: mine, parts: [], text: '▦',
        order: Math.min(...mine.map((p) => p.order)),
        s: bodyS, B: t.y1, h: bodyS,
        top: info.top - t.y1, bottom: info.top - t.y0, left: t.x0, right: t.x1,
        pageTop: 0, pageH: info.height,
      });
    }
    return rest;
  }

  function richLines(pieces, opts = {}) {
    const byPage = new Map();
    // 选中的图片（文本层中的图片占位元素）单独记录，不参与分行
    const picked = new Map();
    for (const p of pieces) {
      if (!byPage.has(p.page)) byPage.set(p.page, []);
      if (p.image) {
        if (!picked.has(p.page)) picked.set(p.page, new Set());
        picked.get(p.page).add(p.image);
        continue;
      }
      byPage.get(p.page).push(p);
    }
    const lines = [];
    for (let [page, arr] of byPage) {
      const info = (CCM.pdfPages && CCM.pdfPages[page]) || { height: 0, top: 0 };
      const sizes = [];
      for (const p of arr) if (!p.isExt && p.str.trim()) for (let k = 0; k < Math.min(p.str.length, 50); k++) sizes.push(p.s);
      const bodyS = opts.bodyS || median(sizes) || 10;
      // 被裁剪掉、看不见的内容（macOS 打印时跨页的一行在上下两页各画一次）。同一行的文字、公式统一按正文字号判断；
      // 分数线在数学轴上，比基线高约 0.25em
      if (CCM.pdfClipped && !opts.noTables) arr = arr.filter((p) => p.bullet || !CCM.pdfClipped(page, p.rule ? p.y - 0.25 * bodyS : p.y, bodyS));
      arr = arr.filter((p) => !PICTURE_FONT.test(p.font || '') && !CONTROL_ONLY(p.str));
      // 着重号（中文排版中字下的小圆点）是装饰，不是内容
      // 带着重号的文字按加粗处理（点在字的上方或下方，覆盖文字的大部分宽度）
      const isDot = (p) => !p.geo && !p.rule && !p.bullet && EMPHASIS_DOTS.test(p.str.trim()) && p.s < 0.8 * bodyS;
      const dotsHere = arr.filter(isDot);
      if (dotsHere.length) {
        for (const q of arr) {
          if (isDot(q) || !q.str.trim() || q.geo) continue;
          const cy = q.y + 0.35 * q.s;
          const near = dotsHere.filter((d) => Math.abs(d.y + 0.3 * d.s - cy) < 1.1 * q.s && d.x0 >= q.x0 - 1 && d.x1 <= q.x1 + 1);
          const n = Array.from(q.str.trim()).length;
          if (near.length && near.length >= 0.7 * n) q.emph = true;
        }
      }
      arr = arr.filter((p) => !isDot(p));
      // 画出来的列表符号：对齐到右侧紧邻的文字所在的行；旁边没有文字的（如图表中的圆点）丢弃
      arr = arr.filter((p) => {
        if (!p.bullet) return true;
        let best = null;
        for (const q of arr) {
          if (q.bullet || q.rule || !q.str.trim()) continue;
          const gap = q.x0 - p.x1;
          if (gap < -0.5 || gap > 3 * q.s || Math.abs(q.y + 0.33 * q.s - p.cy) > 0.5 * q.s) continue;
          if (!best || gap < best.gap) best = { q, gap };
        }
        if (!best) return false;
        p.y = best.q.y;
        p.s = best.q.s;
        return true;
      });
      // 有边框线的表格：表格内的内容按单元格分别还原
      if (!opts.noTables) arr = extractTables(page, arr, bodyS, info, lines);
      // 小字号的数学内容（上下标、上下限、行内分式的分子分母）、大型运算符与根号不作为“行”的锚点，之后再分配到最近的行
      // 矢量公式的分数线：线上下方的分子、分母（即使是正常字号）也不作为锚点，之后并入分数线所在的行
      const fracRules = arr.filter((r) => r.rule && !arr.some((e) => isRad(e) && Math.abs(e.x1 - r.x0) < 0.6 * r.s));
      const inFraction = (p) => p.geo && fracRules.some((r) => {
        const cx = (p.x0 + p.x1) / 2;
        const d = vy(p) - r.y;
        return cx > r.x0 && cx < r.x1 && Math.abs(d) < 2.5 * r.s && Math.abs(d + 0.25 * r.s) > 0.4 * p.s;
      });
      const floating = (p) => p.isExt || isRad(p) || p.rule || inFraction(p) ||
        (p.s < 0.88 * bodyS && !CJK.test(p.str) && (p.mathFont || p.italic || ROMAN_FONT.test(p.font) || !p.font));

      const anchors = [];
      const others = [];
      for (const p of [...arr].sort((a, b) => a.order - b.order)) ((p.str.trim() || p.rule) && !floating(p) ? anchors : others).push(p);

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
      // 横线（分数线、根号线）先分配，并把行的范围扩展到横线两端，使分子、分母都能归到这一行
      const leftovers = [];
      for (const p of [...others].sort((a, b) => !!b.rule - !!a.rule)) {
        const y = vy(p);
        let best = null;
        for (const c of clusters) {
          if (p.x1 < c.x0 - 2 * c.s || p.x0 > c.x1 + 2 * c.s) continue;
          const d = Math.min(...c.ys.map((b) => Math.abs(y - b)));
          if (d < 1.7 * c.s && (!best || d < best.d)) best = { c, d };
        }
        if (best && p.rule) {
          best.c.x0 = Math.min(best.c.x0, p.x0);
          best.c.x1 = Math.max(best.c.x1, p.x1);
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

      const sizeOf = (arr) => {
        const sz = [];
        for (const p of arr) for (let k = 0; k < Math.min(p.str.length, 50); k++) sz.push(p.s);
        return median(sz);
      };
      for (const c of clusters) {
        const items = c.items.sort((a, b) => a.x0 - b.x0);
        if (!items.some((p) => p.str.trim())) continue;
        const normal = items.filter((p) => !p.isExt && !isRad(p) && p.str.trim());
        const s = sizeOf(normal) || items[0].s;
        // 行高按正文文字计算：MathJax 公式的字号通常比正文大一些，公式多的行不能因此被当成标题或另起一段。
        // 列表符号的字号可能与正文不同，不算在内；只有公式和标点的行不会是标题
        const textual = normal.filter((p) => !p.geo && !p.mathFont && !BULLET_CHAR.test(p.str.trim()));
        const words = sizeOf(textual.filter((p) => /[\p{L}\p{N}]/u.test(p.str)));
        const ts = words || sizeOf(textual);
        const B = normal.length ? baselineOf(normal.map((p) => ({ ...p })), s) : c.y;
        const tops = items.map((p) => boxOf(p)[1]);
        const bots = items.map((p) => boxOf(p)[0]);
        lines.push({
          page,
          items,
          order: Math.min(...items.map((p) => p.order)),
          s,
          B,
          baseTop: info.top - B,
          h: ts || s,
          mathOnly: !words,
          top: info.top - Math.max(...tops),
          bottom: info.top - Math.min(...bots),
          left: Math.min(...items.map((p) => p.x0)),
          right: Math.max(...items.map((p) => p.x1)),
          pageTop: 0,
          pageH: info.height,
        });
      }
    }
    if (!opts.noImages) addImages(lines, byPage, opts.fullPages, picked);
    for (const l of lines) if (!l.table && !l.image) buildParts(l);
    sortLines(lines);
    return lines.filter((l) => l.text);
  }

  // 页面中的图片作为单独的“行”加入：整页选中时全部加入，否则只加入位于选中文字上下范围内的
  function addImages(lines, byPage, fullPages, picked) {
    const pics = CCM.pdfImages || {};
    const pages = new Set([...byPage.keys(), ...(fullPages || [])]);
    for (const page of pages) {
      const list = pics[page];
      const info = CCM.pdfPages && CCM.pdfPages[page];
      if (!list || !list.length || !info) continue;
      const own = lines.filter((l) => l.page === page);
      const full = fullPages && fullPages.has(page);
      const top = own.length ? Math.min(...own.map((l) => l.top)) : 0;
      const bottom = own.length ? Math.max(...own.map((l) => l.bottom)) : 0;
      // 文本层中已有图片占位元素时，以是否选中占位元素为准；否则按图片是否位于选中文字的上下范围内
      const hasSpans = typeof document !== 'undefined' && !!document.querySelector(`.page[data-page-number="${page}"] .textLayer .marktex-image`);
      const sel = (picked && picked.get(page)) || new Set();
      for (const img of list) {
        const t = info.top - img.y1;
        const b = info.top - img.y0;
        const mid = (t + b) / 2;
        if (!full && !sel.has(img) && (hasSpans || !(mid > top && mid < bottom))) continue;
        const s = own.length ? median(own.map((l) => l.s)) : 10;
        lines.push({
          page, image: img, items: [], parts: [], text: '▣', order: Infinity,
          s, B: img.y0, h: s, top: t, bottom: b, left: img.x0, right: img.x1, pageTop: 0, pageH: info.height,
        });
      }
    }
  }

  // 阅读顺序：单栏页面按位置从上到下（PDF 内部的文字顺序不一定是阅读顺序）；多栏页面保留内部顺序
  function sortLines(lines) {
    const multi = new Set();
    const byPage = new Map();
    for (const l of lines) {
      if (!byPage.has(l.page)) byPage.set(l.page, []);
      byPage.get(l.page).push(l);
    }
    for (const [page, ls] of byPage) {
      const text = ls.filter((l) => !l.image && !l.table);
      const W = Math.max(...text.map((l) => l.right)) - Math.min(...text.map((l) => l.left));
      let pairs = 0;
      for (let i = 0; i < text.length; i++) {
        for (let j = i + 1; j < text.length; j++) {
          const a = text[i];
          const b = text[j];
          if (Math.abs(a.top - b.top) > 0.5 * Math.max(a.h, b.h)) continue;
          const wide = (l) => l.right - l.left > 0.25 * W;
          if (wide(a) && wide(b) && (a.right < b.left || b.right < a.left)) pairs++;
        }
      }
      if (pairs >= 3) multi.add(page);
      // 多栏页面：图片放在其下方第一行之前
      if (multi.has(page)) {
        for (const im of ls.filter((l) => l.image)) {
          const below = text.filter((l) => l.top >= im.top).sort((a, b) => a.top - b.top)[0];
          im.order = below ? below.order - 0.5 : Math.max(0, ...text.map((l) => l.order)) + 0.5;
        }
      }
    }
    lines.sort((a, b) => {
      if (a.page !== b.page) return a.page - b.page;
      if (multi.has(a.page)) return a.order - b.order;
      // 同一行上的内容（上下位置相近）按从左到右
      if (Math.abs(a.top - b.top) < 0.3 * Math.min(a.h, b.h)) return a.left - b.left;
      return a.top - b.top;
    });
  }

  // ---------- 精确模式：一行内区分正文与公式 ----------
  function buildParts(line) {
    const { items, B, s } = line;
    for (const p of items) {
      const t = p.str.replace(/\s+/g, '');
      const script = p.s < 0.85 * s && Math.abs(p.y - B) > 0.08 * s;
      if (p.rule) p.kind = 'math';
      else if (!t) p.kind = 'space';
      else if (CJK.test(p.str)) p.kind = 'text';
      else if (p.mathFont || p.isExt || script) p.kind = 'math';
      else if (p.italic && /^[A-Za-z]$/.test(t)) p.kind = 'math';
      else if (RADICALS.has(t)) p.kind = 'math';
      else if ((p.italic && /^[A-Za-z]{2,4}$/.test(t)) || NEUTRAL_RE.test(p.str) || FUNCS.has(t)) p.kind = 'neutral';
      else p.kind = 'text';
    }
    const solid = items.filter((p) => p.kind !== 'space');
    // 行首单独的列表符号（包括用 MathJax 画出的 ∗）是列表标记，不是公式
    if (solid[0] && BULLET_CHAR.test(solid[0].str.trim()) && solid[1] && solid[1].x0 - solid[0].x1 > 0.2 * s) solid[0].kind = 'text';

    // 代码行：大部分字符来自等宽字体（注释里的中文可能是其他字体）
    const chars = (arr) => arr.reduce((a, p) => a + p.str.replace(/\s+/g, '').length, 0);
    // 注释开始之后的内容（常换成中文字体）不参与判断
    const sorted = [...solid].sort((a, b) => a.x0 - b.x0);
    const ci = sorted.findIndex((p) => MONO_FONT.test(p.font) && /\/\/|\/\*/.test(p.str));
    const judged = ci >= 0 ? sorted.slice(0, ci + 1) : sorted;
    const monoItems = judged.filter((p) => MONO_FONT.test(p.font));
    const total = chars(judged);
    if (total && MONO_FONT.test(solid[0].font) && chars(monoItems) / total >= 0.7 && !solid.some((p) => p.geo || p.rule)) {
      const cw = monoItems.reduce((a, p) => a + (p.x1 - p.x0), 0) / Math.max(1, monoItems.reduce((a, p) => a + p.str.length, 0)) || 0.6 * s;
      const codeOf = (arr) => {
        let txt = '';
        let prevItem = null;
        for (const p of arr) {
          if (prevItem) {
            const gap = p.x0 - prevItem.x1;
            if (gap > 0.3 * cw) txt += ' '.repeat(Math.max(1, Math.round(gap / cw)));
          }
          txt += p.str;
          prevItem = p;
        }
        return txt.replace(/\s+$/, '');
      };
      const byX = [...solid].sort((a, b) => a.x0 - b.x0);
      line.mono = true;
      line.charW = cw;
      line.codeText = codeOf(byX);
      // 编辑器打印的行号栏：行首单独的数字，与代码之间隔开一段距离（是否真是行号，在 render 中按整个代码块判断）。
      // 行号与代码的字号或字体不同，或者间距不是整数个字符宽（代码本身的空格总是整数个字符宽）
      const [f, g] = byX;
      const gap = g ? (g.x0 - f.x1) / cw : 0;
      const apart = g && gap > 1.2 && (Math.abs(f.s - g.s) > 0.05 * g.s || f.font !== g.font || Math.abs(gap - Math.round(gap)) > 0.15);
      if (/^\d{1,5}$/.test(f.str.trim()) && (!g || apart)) {
        line.lineNo = { n: +f.str.trim(), x0: f.x0, x1: f.x1, text: g ? codeOf(byX.slice(1)) : '', left: g ? g.x0 : null };
      }
    } else if (solid.length > 1) {
      // 正文字体排版的带行号代码 / 样例（如 LaTeX listings：行号为粗体，内容为 LMRoman）：行首的数字与内容字号相同、字体不同，
      // 隔开一段距离，内容不是中文。先记下，是否真是行号在 promoteListings 中按连续的几行判断
      const byX = [...solid].sort((a, b) => a.x0 - b.x0);
      const [f, g] = byX;
      if (/^\d{1,5}$/.test(f.str.trim()) && !f.mathFont && !f.geo && f.font && g.font && f.font !== g.font &&
        g.x0 - f.x1 > 0.4 * s && Math.abs(f.s - g.s) < 0.08 * g.s) {
        let txt = '';
        let prevP = null;
        for (const p of byX.slice(1)) {
          if (prevP && p.x0 - prevP.x1 > 0.2 * s) txt += ' ';
          txt += p.str;
          prevP = p;
        }
        txt = txt.replace(/\s+/g, ' ').trim();
        const cjk = (txt.match(new RegExp(CJK.source, 'g')) || []).length;
        if (cjk < 0.3 * txt.replace(/\s/g, '').length) {
          const pieces = byX.slice(1).map((p) => ({ str: p.str, x0: p.x0, x1: p.x1 }));
          line.numbered = { n: +f.str.trim(), x0: f.x0, x1: f.x1, left: g.x0, font: f.font, contentFont: g.font, text: txt, pieces };
        }
      }
    }

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
          if (last && last.t === 'text' && gap > 0.12 * s && !/\s$/.test(last.s)) {
            if (last.code) parts.push({ t: 'text', s: ' ' });
            else last.s += ' ';
          }
          parts.push({ t: 'math', items: [p] });
        }
      } else if (MONO_FONT.test(p.font) && !line.mono) {
        // 正文中的等宽字体片段（文件名、函数名等）：行内代码；前后的空格单独成段，不放进反引号里
        const str = p.str.replace(/\s+/g, ' ');
        if (last && last.t === 'text' && last.code && gap < 0.4 * s) {
          last.s += (gap > 0.15 * s ? ' ' : '') + str;
        } else {
          if (last && last.t === 'text' && !last.code && gap > 0.12 * s && !/\s$/.test(last.s)) last.s += ' ';
          else if (last && (last.t === 'math' || last.code) && gap > 0.12 * s) parts.push({ t: 'text', s: ' ' });
          parts.push({ t: 'text', s: str, code: true });
        }
      } else {
        // 两端对齐时，中文字之间可能被逐字插入空格（只在大部分字之间都有空格时去掉）
        let str = p.str.replace(/\s+/g, ' ');
        const spaced = (str.match(/(?:^|\S) (?=\S)/g) || []).length;
        const cjkN = (str.match(new RegExp(CJK.source, 'g')) || []).length;
        if (cjkN >= 4 && spaced >= 0.6 * (cjkN - 1)) str = str.replace(/(\S) (?=\S)/g, (m, a, i, all) => (CJK.test(a) && CJK.test(all[i + 2]) ? a : m));
        const bold = BOLD_FONT.test(p.font) || !!p.emph;
        if (last && last.t === 'text' && last.code) {
          if (gap > 0.12 * s && !/^\s/.test(str)) str = ' ' + str;
          parts.push({ t: 'text', s: str, bold });
        } else if (last && last.t === 'text') {
          // 中文与西文之间有可见间距时保留空格（如“考虑 DP”、“1 平衡”）
          const a = last.s.slice(-1);
          const b = str[0];
          const mixed = a && b && !/\s/.test(a) && !/\s/.test(b) && CJK.test(a) !== CJK.test(b);
          const sp = gap > 0.15 * s && (needsSpace(last.s, str) || mixed);
          if (!last.bold === !bold) last.s += (sp ? ' ' : '') + str;
          else parts.push({ t: 'text', s: (sp ? ' ' : '') + str, bold });
        } else {
          if (last && last.t === 'math' && gap > 0.12 * s && !/^\s/.test(str)) str = ' ' + str;
          parts.push({ t: 'text', s: str, bold });
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
      l.text = fixCjk(l.text.replace(/\s+/g, ' ').trim());
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

  // 跨多页选择时，去掉在多页的页面边缘重复出现的页眉 / 页脚（幻灯片导航、作者、页码等）。
  // 页眉页脚是页面最上 / 最下的一行，字号不大于正文，而且大部分页面都有；
  // 偶尔有两页恰好以同名小标题（如“【样例 1 输入】”）开头，不能当成页眉删掉
  function dropRunningHeaders(lines) {
    const pages = new Set(lines.map((l) => l.page));
    if (pages.size < 2) return lines;
    const bodyH = bodyHeight(lines);
    const outer = new Map();
    for (const l of lines) {
      const o = outer.get(l.page) || { top: Infinity, bottom: -Infinity };
      o.top = Math.min(o.top, l.top);
      o.bottom = Math.max(o.bottom, l.bottom);
      outer.set(l.page, o);
    }
    // 代码行、只有符号的行（如单独的“{”）、比正文大的标题不会是页眉页脚
    const edge = (l) => {
      if (!l.pageH || l.mono || l.table || l.image || l.h > bodyH * 1.1 || !/[\p{L}\p{N}]/u.test(l.text)) return null;
      const y = (l.top - l.pageTop) / l.pageH;
      const o = outer.get(l.page);
      if (y < 0.12 && l.top - o.top < 0.5 * l.h) return 'T';
      if (y > 0.88 && o.bottom - l.bottom < 0.5 * l.h) return 'B';
      return null;
    };
    const cands = [];
    for (const l of lines) {
      const e = edge(l);
      if (e) cands.push({ l, e, t: l.text.replace(/\d+/g, '#').replace(/\s+/g, '') });
    }
    // 别的页面同一边缘有相同的一行；或者一行是另一行的开头（页眉左侧固定、右侧是随章节变化的标题，有的页只有左侧）
    const alike = (a, b) => a.t === b.t || (Math.min(a.t.length, b.t.length) >= 8 && (a.t.startsWith(b.t) || b.t.startsWith(a.t)));
    const repeated = new Set(cands.filter((a) => cands.some((b) => b.l.page !== a.l.page && b.e === a.e && alike(a, b))));
    const covered = { T: new Set(), B: new Set() };
    for (const c of repeated) covered[c.e].add(c.l.page);
    const drop = new Set([...repeated].filter((c) => covered[c.e].size >= 0.5 * pages.size).map((c) => c.l));
    return lines.filter((l) => !drop.has(l));
  }

  function mergeTextParts(parts) {
    const out = [];
    for (const p of parts) {
      const last = out[out.length - 1];
      if (last && last.t === 'text' && p.t === 'text' && !last.code === !p.code && (!last.bold === !p.bold || !p.s.trim())) last.s += p.s;
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
      return mergeTextParts([...a.slice(0, -1), { ...x, s: x.s.slice(0, -1) + y.s }, ...b.slice(1)]);
    }
    const lc = x.t === 'text' ? x.s.slice(-1) : '';
    const fc = y.t === 'text' ? y.s[0] : '';
    // 中文标点前后不加空格（如公式结尾的一行，下一行以“，”开头）
    const sep = (lc && fc && (CJK.test(lc) || CJK.test(fc))) || CJK_PUNCT.test(fc) || CJK_PUNCT.test(lc) ? '' : ' ';
    return mergeTextParts([...a, ...(sep ? [{ t: 'text', s: sep }] : []), ...b]);
  }

  const MATH_LINE_CHARS = /[=+−×÷∑∏∫√≤≥≠≈∈∉∀∃⌊⌋⌈⌉±∞∂∇→⇒′|]/;
  const looksLikeMathLine = (s) => !CJK.test(s) && s.length <= 80 && (s.length <= 3 || MATH_LINE_CHARS.test(s)) &&
    !/[A-Za-z]{3,}\s+[A-Za-z]{3,}\s+[A-Za-z]{3,}/.test(s);

  // 正文字体排版、带行号的代码或样例按代码块处理（复制时去掉行号，见 render）。连续几行行首的数字依次加一、
  // 左端或右端对齐、样式相同（跨页继续的也算）：从 1 开始至少两行，或者至少三行；只有一行的（如一行的样例输出），
  // 要求文档中已有同样样式的代码块
  function promoteListings(lines) {
    const style = (l) => `${l.numbered.font}|${l.numbered.contentFont}`;
    const continues = (first, prev, l) => l.numbered.n === prev.numbered.n + 1 && style(l) === style(prev) &&
      (Math.abs(l.numbered.x0 - first.numbered.x0) < 0.4 * l.s || Math.abs(l.numbered.x1 - first.numbered.x1) < 0.4 * l.s) &&
      (l.page !== prev.page || (l.top > prev.top && l.top - prev.top < 3 * l.h));
    const runs = [];
    let run = [];
    for (const l of lines) {
      if (!l.numbered || l.mono) {
        if (run.length) runs.push(run);
        run = [];
        continue;
      }
      if (run.length && !continues(run[0], run[run.length - 1], l)) {
        runs.push(run);
        run = [];
      }
      run.push(l);
    }
    if (run.length) runs.push(run);
    // 等宽格子排版（listings 默认的 columns=fixed，每格 0.6em，字符居中）：窄字符（如“.”、数字）之间的空隙可能被 PDF.js
    // 当成空格插入同一文本项中；真正的空格是一整个空格子，空隙超过 0.6em，PDF.js 会另起一项。按格子重建这样的行。
    // 判断依据（满足其一）：各行首字的位置因字符宽窄相差零点几 em（自然排版时各行从同一位置开始）；
    // 相邻两项之间恰好隔着整数个格子（自然排版时一句话在同一项中，空格不会让 PDF.js 另起一项）
    const isFixed = (r, cell) => {
      const lefts = r.map((l) => l.numbered.left);
      const near = lefts.filter((x) => x - Math.min(...lefts) < cell);
      if (near.length >= 2 && Math.max(...near) - Math.min(...near) > 0.2 * cell) return true;
      // 一长串数字：TeX 字体中数字宽 0.5em，排在格子中时每个数字占 0.6em
      for (const l of r) {
        for (const p of l.numbered.pieces) {
          const digits = p.str.replace(/\s+/g, '');
          if (/^\d{4,}$/.test(digits) && (p.x1 - p.x0) / digits.length > (0.56 / 0.6) * cell) return true;
        }
      }
      let good = 0;
      let total = 0;
      for (const l of r) {
        const ps = l.numbered.pieces.filter((p) => p.str.trim());
        for (let i = 1; i < ps.length; i++) {
          if (ps[i].x0 - ps[i - 1].x1 <= 0.3 * cell) continue;
          const k = (ps[i].x0 - ps[i - 1].x0) / cell - ps[i - 1].str.replace(/\s+/g, '').length;
          total++;
          if (k > 0.5 && Math.abs(k - Math.round(k)) < 0.25) good++;
        }
      }
      return total >= 2 && good >= 0.75 * total;
    };
    const fixedText = (pieces, cell) => {
      let txt = '';
      let prev = null;
      for (const p of pieces) {
        const str = p.str.replace(/\s+/g, '');
        if (!str) continue;
        if (prev && p.x0 - prev.x1 > 0.3 * cell) txt += ' '.repeat(Math.max(1, Math.round((p.x0 - prev.x0) / cell) - prev.n));
        txt += str;
        prev = { x0: p.x0, x1: p.x1, n: str.length };
      }
      return txt;
    };
    const promote = (r, fixed) => {
      for (const l of r) {
        const nb = l.numbered;
        // 排版时把数据中的“-”变成了减号 U+2212，复制出来的样例要能直接使用
        const text = (fixed ? fixedText(nb.pieces, 0.6 * l.s) : nb.text).replace(/\u2212/g, '-');
        Object.assign(l, { mono: true, prop: true, charW: 0.6 * l.s, codeText: `${nb.n} ${text}` });
        l.lineNo = { n: nb.n, x0: nb.x0, x1: nb.x1, text, left: nb.left };
      }
    };
    const accepted = [];
    const styles = new Set();
    const single = [];
    for (const r of runs) {
      if ((r.length >= 2 && r[0].numbered.n === 1) || r.length >= 3) {
        accepted.push(r);
        styles.add(style(r[0]));
      } else single.push(r);
    }
    for (const r of single) if (r[0].numbered.n === 1 && styles.has(style(r[0]))) accepted.push(r);
    // 同一样式的代码块排版方式相同：其中一块能判断出是等宽格子，其他块也按格子处理
    const fixedStyles = new Set(accepted.filter((r) => isFixed(r, 0.6 * r[0].s)).map((r) => style(r[0])));
    for (const r of accepted) promote(r, fixedStyles.has(style(r[0])));
  }

  function buildBlocks(lines) {
    promoteListings(lines);
    const bodyH = bodyHeight(lines);
    const gaps = [];
    for (let i = 1; i < lines.length; i++) {
      const a = lines[i - 1];
      const b = lines[i];
      if (a.page === b.page && !a.display && !b.display && !a.image && !b.image && !a.table && !b.table && Math.abs(a.h - bodyH) < bodyH * 0.15 && Math.abs(b.h - bodyH) < bodyH * 0.15) {
        const g = a.B != null && b.B != null ? a.B - b.B : b.top - a.top;
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

    // 行间公式通常居中；表格单元格、行首的短公式等不居中的，按段落中的行内公式处理
    const centered = (l) => {
      const colW = maxRight - minLeft;
      if (!(colW > 0)) return true;
      return Math.abs((l.left - minLeft) - (maxRight - l.right)) < 0.2 * colW;
    };
    const kindOf = (l) => {
      if (l.table) return { type: 'table' };
      if (l.image) return { type: 'image' };
      if (l.mono) return { type: 'code' };
      if (l.display && centered(l)) return { type: 'display' };
      const ratio = l.h / bodyH;
      if (ratio >= 1.15 && !l.mathOnly && l.text.length <= 120 && !SENTENCE_END.test(l.text.replace(/[:：]$/, ''))) {
        return { type: 'h', level: ratio >= 1.7 ? 1 : ratio >= 1.28 ? 2 : 3 };
      }
      const first = l.parts[0];
      if (first && first.t === 'text') {
        let m = first.s.match(BULLET_RE);
        if (m) return { type: 'ul', strip: first.s.length - m[2].length };
        // 列表符号单独成段（其后是粗体、代码或公式）
        if (BULLET_CHAR.test(first.s.trim()) && l.parts.length > 1) return { type: 'ul', strip: first.s.length };
        m = first.s.match(ORDERED_RE);
        if (m) return { type: 'ol', n: +m[1], strip: first.s.length - m[2].length };
        if (OTHER_ENUM_RE.test(first.s)) return { type: 'p', forceNew: true };
      }
      if (l.legacy && looksLikeMathLine(l.text)) return { type: 'math' };
      return { type: 'p' };
    };
    const stripParts = (parts, n) => {
      if (!n) return parts.map((p) => ({ ...p }));
      const out = [{ ...parts[0], s: parts[0].s.slice(n) }, ...parts.slice(1).map((p) => ({ ...p }))];
      while (out.length && out[0].t === 'text' && !out[0].s.trim()) out.shift();
      if (out[0] && out[0].t === 'text') out[0].s = out[0].s.replace(/^\s+/, '');
      return out.filter((p) => p.t !== 'text' || p.s);
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
      if (k.type === 'table') {
        // 跨页的表格：上一页底部的表格在本页顶部继续（位置、列数相同）；Chrome 打印时会在新页重复表头，去掉重复的那一行
        const rowText = (r) => r.map((c) => c.map((p) => (p.t === 'math' ? p.tex : p.s)).join('').replace(/\s+/g, '')).join('|');
        if (cur && cur.type === 'table' && prev && prev.table && l.page === prev.page + 1 && l.pageH && prev.pageH &&
          (prev.bottom - prev.pageTop) / prev.pageH > 0.7 && (l.top - l.pageTop) / l.pageH < 0.3 &&
          Math.abs(l.left - prev.left) < 3 && Math.abs(l.right - prev.right) < 3 && cur.rows[0].length === l.rows[0].length) {
          cur.rows = cur.rows.concat(rowText(l.rows[0]) === rowText(cur.rows[0]) ? l.rows.slice(1) : l.rows);
          continue;
        }
        cur = { type: 'table', rows: l.rows };
        blocks.push(cur);
        continue;
      }
      if (k.type === 'image') {
        cur = { type: 'image', line: l };
        blocks.push(cur);
        continue;
      }
      // 代码块：连续的等宽字体行（允许中间有一个空行，或跨页继续）
      if (k.type === 'code') {
        if (cur && cur.type === 'code' && prev && (prev.page !== l.page || l.top - prev.top < lineGap * 2.6)) cur.lines.push(l);
        else { cur = { type: 'code', lines: [l] }; blocks.push(cur); }
        continue;
      }
      // 简单模式：公式的上下限、分子分母分布在多行，连续的公式行合并成一块
      if (cur && cur.type === 'math' && k.type === 'math' && prev && prev.page === l.page && l.top - prev.top < lineGap * 3) {
        cur.parts = joinParts(cur.parts, l.parts);
        continue;
      }
      let fresh = !cur || cur.type === 'display' || cur.type === 'code' || cur.type === 'table' || cur.type === 'image' || k.type === 'ul' || k.type === 'ol' || k.forceNew ||
        (k.type === 'math') !== (cur.type === 'math') || (k.type === 'h') !== (cur.type === 'h');
      if (!fresh && prev) {
        const curText = cur.parts.map((p) => (p.t === 'text' ? p.s : '$')).join('');
        if (prev.page !== l.page) {
          // 跨页：上一页最后一行不是句末才接续；标题不跨页接续
          fresh = SENTENCE_END.test(curText) || k.type === 'h';
        } else {
          // 行距按基线计算（含公式的行顶部更高，用行顶会高估行距）；行内的分式、上下标会把行距撑大
          const g = prev.B != null && l.B != null ? prev.B - l.B : l.top - prev.top;
          const extra = prev.baseTop != null && l.baseTop != null
            ? Math.max(0, prev.bottom - prev.baseTop - 0.35 * prev.h) + Math.max(0, l.baseTop - l.top - 0.95 * l.h) : 0;
          if (g < 0 || g > lineGap * 1.45 + extra) fresh = true;
          else if (Math.abs(l.h - prev.h) > bodyH * 0.2) fresh = true;
          // 标题折行时上一行会排到右边界；没排满的是另一个标题（如居中的题目名之后紧跟“题目背景”）
          else if (cur.type === 'h' && prev.right < maxRight - 2 * prev.h) fresh = true;
          // 列表项之后，比列表标记更靠左的一行是新段落
          else if ((cur.type === 'ul' || cur.type === 'ol') && l.left < cur.left0 - 0.3 * bodyH) fresh = true;
          // 句末且没有排满一行：段落结束（中文两端对齐，差一个字就说明是段尾）
          else if ((cur.type === 'p' || cur.type === 'ul' || cur.type === 'ol') && SENTENCE_END.test(prev.text) &&
            prev.right < maxRight - bodyH * (CJK.test(prev.text.slice(-1)) ? 0.9 : 3)) fresh = true;
          else if (cur.type === 'p' && l.left - minLeft > bodyH * 1.2 && prev.left - minLeft < bodyH * 0.5) fresh = true;
          // 很短、且不以标点结尾的一行（如幻灯片里的“性质 1”“证明 2”）是独立的小标题
          else if (cur.type === 'p' && cur.parts.length === prev.parts.length && prev.text.length <= 12 &&
            !SENTENCE_END.test(prev.text) && prev.right - prev.left < (maxRight - minLeft) * 0.4) fresh = true;
        }
      }
      if (fresh) {
        cur = { type: k.type, level: k.level, n: k.n, parts: stripParts(l.parts, k.strip), left0: l.left };
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
  // PDF 中没有代码语言的信息：只在特征明显时按内容推断，拿不准就留空
  const CODE_LANGS = [
    ['cpp', /^\s*#include\s*[<"]|\busing\s+namespace\s+std\b|\bstd::|\bcout\s*<<|\bcin\s*>>|\btemplate\s*</m],
    ['java', /\bpublic\s+(static\s+)?(class|void)\b|\bSystem\.out\.print/],
    ['python', /^\s*def\s+\w+\s*\(.*\)\s*:|^\s*(from\s+[\w.]+\s+)?import\s+\w+(\s+as\s+\w+)?\s*$|\bprint\s*\(.*\)\s*$|^\s*if\s+__name__\s*==/m],
    ['rust', /\bfn\s+\w+\s*\(|\blet\s+mut\b|\bprintln!\s*\(/],
    ['go', /^\s*package\s+\w+\s*$|\bfunc\s+\w+\s*\(|\bfmt\.Print/m],
    ['javascript', /\bconsole\.log\s*\(|\bfunction\s+\w+\s*\(|=>\s*[{(]|\b(const|let)\s+\w+\s*=/],
    ['bash', /^#!\/bin\/(ba)?sh|^\s*\$\s+\w+/m],
  ];
  function guessCodeLang(code) {
    const cppOnly = /\busing\s+namespace\b|\bstd::|\bcout\b|\bcin\b|#include\s*<(bits\/|iostream|vector|algorithm|cstdio|cstring)|\btemplate\s*<|\bclass\s+\w+/;
    if (/^\s*#include\s*</m.test(code) && !cppOnly.test(code)) return 'c';
    for (const [lang, re] of CODE_LANGS) if (lang !== 'c' && re.test(code)) return lang;
    return '';
  }

  CCM.guessCodeLang = guessCodeLang;

  function render(blocks, settings) {
    const d = CCM.delims ? CCM.delims(settings) : { inline: ['$', '$'], display: ['$$', '$$'] };
    const [io, ic] = d.inline;
    const [dO, dC] = d.display;
    const esc = (t) => (CCM.escapeMarkdownText ? CCM.escapeMarkdownText(t, settings) : t);
    const md = [];
    const html = [];
    const text = [];
    let mathCount = 0;

    const codeMd = (s) => {
      const t = s.trim();
      const run = Math.max(0, ...(t.match(/`+/g) || []).map((m) => m.length));
      const f = '`'.repeat(run + 1);
      return run ? `${f} ${t} ${f}` : `${f}${t}${f}`;
    };
    // 粗体：首尾的空白和标点放在标记外面（**加粗**。），否则 Markdown 可能不认
    const EDGE_PUNCT = /^([\s\u3000-\u303f\uff00-\uff0f\uff1a-\uff20.,;:!?()[\]"'“”‘’]*)([\s\S]*?)([\s\u3000-\u303f\uff00-\uff0f\uff1a-\uff20.,;:!?()[\]"'“”‘’]*)$/;
    const boldWrap = (s, f, open, close) => {
      const [, a, mid, z] = s.match(EDGE_PUNCT);
      return mid ? f(a) + open + f(mid) + close + f(z) : f(s);
    };
    const textMd = (p) => (p.bold ? boldWrap(p.s, esc, '**', '**') : esc(p.s));
    const textHtml = (p) => (p.bold ? boldWrap(p.s, escHtml, '<strong>', '</strong>') : escHtml(p.s));
    const plain = (parts) => parts.map((p) => (p.bold ? { ...p, bold: false } : p));
    const partsMd = (parts) => parts.map((p) => (p.t === 'math' ? `${io}${p.tex}${ic}` : p.code ? codeMd(p.s) : textMd(p))).join('');
    const partsHtml = (parts) => parts.map((p) => (p.t === 'math'
      ? `<span class="math math-inline">${escHtml(io + p.tex + ic)}</span>` : p.code ? `<code>${escHtml(p.s.trim())}</code>` : textHtml(p))).join('');
    const partsText = (parts) => parts.map((p) => (p.t === 'math' ? io + p.tex + ic : p.s)).join('');

    let listStack = [];
    // HTML 中已打开的列表（每层的最后一个 <li> 尚未闭合，嵌套列表放在其中）
    const hStack = [];
    const closeTo = (depth) => { while (hStack.length > depth) html.push(`</li></${hStack.pop()}>`); };
    let topType = null;
    for (const b of blocks) {
      const isList = b.type === 'ul' || b.type === 'ol';
      if (b.parts) mathCount += b.parts.filter((p) => p.t === 'math').length;

      // 列表嵌套层级：按列表标记的水平位置
      let indent = '';
      const prevList = md.length ? md[md.length - 1].list : null;
      let sep = '\n\n';
      if (isList) {
        const x = b.left0 || 0;
        while (listStack.length && x < listStack[listStack.length - 1] - 2) listStack.pop();
        if (!listStack.length || x > listStack[listStack.length - 1] + 2) listStack.push(x);
        const depth = listStack.length;
        indent = '    '.repeat(depth - 1);
        // 同一列表内（含嵌套）不空行；顶层换了列表类型才空一行
        if (prevList && (depth > 1 || topType === b.type)) sep = '\n';
        if (depth === 1) topType = b.type;
        closeTo(depth);
        if (hStack.length === depth && hStack[depth - 1] !== b.type) closeTo(depth - 1);
        if (hStack.length === depth) html.push('</li>');
        while (hStack.length < depth) {
          html.push(b.type === 'ol' && b.n !== 1 ? `<ol start="${b.n}">` : `<${b.type}>`);
          hStack.push(b.type);
        }
      } else {
        listStack = [];
        topType = null;
        closeTo(0);
      }
      let line;
      if (b.type === 'image') {
        // 图片数据只在异步生成时读取（见 pdfSelectionAsync）；没有数据时跳过
        const src = b.line.src;
        if (!src) continue;
        const w = Math.round(b.line.right - b.line.left);
        line = `![](${src})`;
        html.push(`<p><img src="${src}" width="${Math.round(w * 4 / 3)}" alt=""></p>`);
      } else if (b.type === 'table') {
        const n = Math.max(...b.rows.map((r) => r.length));
        const rows = b.rows.map((r) => Array.from({ length: n }, (_, i) => r[i] || []));
        // 表头本身就会加粗显示：整行都是粗体时去掉粗体标记
        const textParts = rows[0].flat().filter((p) => p.t === 'text' && p.s.trim());
        if (textParts.length && textParts.every((p) => p.bold)) rows[0] = rows[0].map(plain);
        mathCount += rows.reduce((a, r) => a + r.reduce((x, c) => x + c.filter((p) => p.t === 'math').length, 0), 0);
        const cellMd = (c) => partsMd(c).replace(/\n/g, ' ').replace(/\|/g, '\\|').trim();
        const mdRow = (r) => `| ${r.map(cellMd).join(' | ')} |`;
        line = [mdRow(rows[0]), `| ${rows[0].map(() => '---').join(' | ')} |`, ...rows.slice(1).map(mdRow)].join('\n');
        const htmlRow = (r, tag) => `<tr>${r.map((c) => `<${tag}>${partsHtml(c)}</${tag}>`).join('')}</tr>`;
        html.push(`<table><thead>${htmlRow(rows[0], 'th')}</thead><tbody>${rows.slice(1).map((r) => htmlRow(r, 'td')).join('')}</tbody></table>`);
        text.push(rows.map((r) => r.map((c) => partsText(c).replace(/\s+/g, ' ').trim()).join('\t')).join('\n'));
      } else if (b.type === 'code') {
        const cw = median(b.lines.map((l) => l.charW).filter(Boolean)) || 6;
        // 行号栏：行首的数字依次加一、左端或右端对齐，代码都在行号栏右侧（过长折行的续行没有行号）。复制时去掉行号
        const nos = b.lines.map((l) => l.lineNo).filter(Boolean);
        const aligned = (key) => nos.every((n) => Math.abs(n[key] - nos[0][key]) < 0.3 * cw);
        const edge = nos.length ? Math.max(...nos.map((n) => n.x1)) + 0.8 * cw : 0;
        const gutter = !!b.lines[0].lineNo && nos.every((n, i) => (i ? n.n === nos[i - 1].n + 1 : nos.length > 1 || n.n === 1)) &&
          nos.filter((n) => n.left != null).length >= nos.length / 2 &&
          (aligned('x0') || aligned('x1')) && nos.every((n) => n.left == null || n.left > edge) &&
          b.lines.every((l) => l.lineNo || l.left > edge);
        const leftOf = (l) => (gutter && l.lineNo ? l.lineNo.left : l.left);
        const textOf = (l) => (gutter && l.lineNo ? l.lineNo.text : l.codeText);
        const lefts = b.lines.map(leftOf).filter((x) => x != null);
        const base = lefts.length ? Math.min(...lefts) : 0;
        const steps = [];
        for (let i = 1; i < b.lines.length; i++) if (b.lines[i].page === b.lines[i - 1].page) steps.push(b.lines[i].top - b.lines[i - 1].top);
        const step = median(steps.filter((x) => x > 0)) || 0;
        // 正文字体排版的代码（promoteListings）：字符居中排在等宽的格子里，各行首字的位置相差不到一格，不算缩进
        const slack = b.lines.some((l) => l.prop) ? 0.35 : 0;
        const out = [];
        b.lines.forEach((l, i) => {
          const p = b.lines[i - 1];
          if (p && step && p.page === l.page && l.top - p.top > step * 1.6) out.push('');
          const x = leftOf(l);
          out.push(x == null ? '' : ' '.repeat(Math.max(0, Math.round((x - base) / cw - slack))) + textOf(l));
        });
        const body = out.join('\n');
        const fence = /```/.test(body) ? '````' : '```';
        const lang = guessCodeLang(body);
        line = `${fence}${lang}\n${body}\n${fence}`;
        html.push(`<pre><code${lang ? ` class="language-${lang}"` : ''}>${escHtml(body)}</code></pre>`);
        text.push(body);
      } else if (b.type === 'display') {
        mathCount++;
        const tex = displayTex(b.rows);
        line = `${dO}\n${tex}\n${dC}`;
        html.push(`<div class="math math-display">${escHtml(dO + tex + dC)}</div>`);
        text.push(dO + tex + dC);
      } else {
        if (b.type === 'h') line = '#'.repeat(b.level) + ' ' + partsMd(plain(b.parts));
        else if (b.type === 'ul') line = indent + '- ' + partsMd(b.parts);
        else if (b.type === 'ol') line = indent + `${b.n}. ` + partsMd(b.parts);
        else line = partsMd(b.parts).replace(/^(#{1,6}\s|>|[-+*]\s)/, '\\$1');

        if (b.type === 'h') html.push(`<h${b.level}>${partsHtml(plain(b.parts))}</h${b.level}>`);
        else if (isList) html.push(`<li>${partsHtml(b.parts)}`);
        else html.push(`<p>${partsHtml(b.parts)}</p>`);
        text.push(indent + (b.type === 'ul' ? '- ' : b.type === 'ol' ? `${b.n}. ` : '') + partsText(b.parts));
      }
      md.push({ s: (md.length ? sep : '') + line, list: isList ? b.type : null });
    }
    closeTo(0);
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
    // 选区所在页面有图片：图片数据需要异步读取
    const pics = CCM.pdfImages || {};
    for (let n = from; n <= to; n++) if (pics[n] && pics[n].length) return true;
    return false;
  };

  // 内嵌图片的数据大小上限（设置中的“图片大小上限”，默认 100 KB；不限制时为 0）：过长的 data URL 在 Typora 等编辑器中无法显示
  const imageLimit = (settings) => {
    const s = settings || CCM.DEFAULTS || {};
    if (s.imageLimit === false) return 0;
    const kb = Math.round(+s.imageMaxKB);
    return (Number.isFinite(kb) && kb >= 10 ? kb : 100) * 1024;
  };
  // 不限制时为无损的 PNG；限制时先试 PNG，超出再降低 JPEG 画质，最后缩小尺寸
  function compact(canvas, limit) {
    const png = canvas.toDataURL('image/png');
    if (!limit || png.length <= limit) return png;
    let src = canvas;
    for (let round = 0; round < 8; round++) {
      for (const q of [0.88, 0.78, 0.68]) {
        const url = src.toDataURL('image/jpeg', q);
        if (url.length <= limit) return url;
      }
      const next = document.createElement('canvas');
      next.width = Math.max(1, Math.round(src.width * 0.8));
      next.height = Math.max(1, Math.round(src.height * 0.8));
      const ctx = next.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, next.width, next.height);
      src = next;
    }
    return src.toDataURL('image/jpeg', 0.68);
  }

  // 图片：把页面渲染到画布上再裁出图片区域（与阅读器中看到的一致，也不依赖图片的编码格式）。
  // 结果按大小上限缓存在图片对象上，修改设置后重新生成
  async function imageSources(lines, limit) {
    const app = globalThis.PDFViewerApplication;
    const renders = new Map();
    const renderPage = (n) => {
      if (!renders.has(n)) {
        renders.set(n, (async () => {
          const page = await app.pdfDocument.getPage(n);
          const viewport = page.getViewport({ scale: 2 });
          const canvas = document.createElement('canvas');
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          const ctx = canvas.getContext('2d');
          await page.render({ canvasContext: ctx, canvas, viewport }).promise;
          return { canvas, viewport };
        })());
      }
      return renders.get(n);
    };
    for (const l of lines) {
      if (!l.image) continue;
      const cache = (l.image.srcs = l.image.srcs || {});
      if (cache[limit]) { l.src = cache[limit]; continue; }
      try {
        const { canvas, viewport } = await renderPage(l.page);
        const [a, b] = viewport.convertToViewportPoint(l.image.x0, l.image.y0);
        const [c, d] = viewport.convertToViewportPoint(l.image.x1, l.image.y1);
        const x = Math.max(0, Math.floor(Math.min(a, c)));
        const y = Math.max(0, Math.floor(Math.min(b, d)));
        const w = Math.min(canvas.width - x, Math.ceil(Math.abs(c - a)));
        const h = Math.min(canvas.height - y, Math.ceil(Math.abs(d - b)));
        if (w < 2 || h < 2) continue;
        const out = document.createElement('canvas');
        out.width = w;
        out.height = h;
        const octx = out.getContext('2d');
        octx.fillStyle = '#fff';
        octx.fillRect(0, 0, w, h);
        octx.drawImage(canvas, x, y, w, h, 0, 0, w, h);
        l.src = cache[limit] = compact(out, limit);
      } catch (e) {
        console.warn('[marktex-copy] image export failed', e);
      }
    }
    renders.clear();
  }
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
    // 矢量公式（MathJax 导出）：识别出的字形按阅读顺序插入文字项之间
    let all = items;
    if (CCM.pdfGlyphsFor) {
      const { items: glyphs } = await CCM.pdfGlyphsFor(page);
      if (glyphs.length) {
        const texts = items.map((it) => ({ x: it.transform[4], y: it.transform[5], s: Math.hypot(it.transform[2], it.transform[3]) || 10, ref: it }));
        const plan = CCM.mergeGlyphOrder(texts, glyphs.map((g) => ({ x: g.x, y: g.y, s: g.s, ref: g })));
        all = [];
        let k = 0;
        const pending = new Map();
        for (const { glyph, before } of plan) {
          const key = before ? before.ref : null;
          if (!pending.has(key)) pending.set(key, []);
          pending.get(key).push(CCM.glyphItem(glyph.ref));
        }
        for (const it of items) {
          if (pending.has(it)) all.push(...pending.get(it));
          all.push(it);
          k++;
        }
        if (pending.has(null)) all.push(...pending.get(null));
      }
    }
    return all.map((it, i) => toPiece(it, n, 0, it.str.length, orderBase + i));
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
    // 整页选中的页面：页面中的图片全部加入
    const fullPages = new Set();
    for (let n = from; n <= to; n++) if (all || (n !== from && n !== to)) fullPages.add(n);
    const lines = richLines(pieces, { fullPages });
    if (!lines.length) return null;
    await imageSources(lines, imageLimit(settings));
    const out = render(buildBlocks(dropRunningHeaders(lines)), settings);
    out.rebuilt = true;
    out.hasMath = false;
    return out;
  };

  // 供测试使用
  CCM._pdfParseMath = parseMath;
  CCM._pdfDebug = { richLines, apiPieces, buildBlocks };
})();
