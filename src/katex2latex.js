// 从 KaTeX 渲染出的 HTML 还原 LaTeX。
// 有些网站（如洛谷）只输出 KaTeX 的 HTML（output: 'html'），页面里没有 MathML 和 TeX 源码，只能按排版结构反推。
// 新版 KaTeX 的部分类名带 katex- 前缀（katex-base、katex-sizing、katex-accent 等），两种写法都支持。
(() => {
  const CCM = (globalThis.__CCM = globalThis.__CCM || {});
  if (CCM.katexHtmlToLatex) return;

  const has = (el, c) => !!el.classList && (el.classList.contains(c) || el.classList.contains('katex-' + c));
  const charTex = (ch) => (CCM.charTex ? CCM.charTex(ch) : ch);
  const join = (parts) => (CCM.texJoin ? CCM.texJoin(parts) : parts.join(''));
  const grp = (s) => (CCM.texGroup ? CCM.texGroup(s) : `{${s}}`);
  const funcs = () => CCM.texFuncs || new Set();

  const FONT_CMD = {
    mathrm: 'mathrm', mathbf: 'mathbf', boldsymbol: 'boldsymbol', mathbb: 'mathbb', mathcal: 'mathcal',
    mathfrak: 'mathfrak', mathscr: 'mathscr', mathsf: 'mathsf', mathtt: 'mathtt', mathsfit: 'mathsf', textbf: 'mathbf',
  };
  const ACCENTS = {
    '^': 'hat', 'ˆ': 'hat', '~': 'tilde', '˜': 'tilde', 'ˉ': 'bar', '¯': 'bar', '˙': 'dot', '¨': 'ddot',
    'ˇ': 'check', '˘': 'breve', 'ˊ': 'acute', '´': 'acute', 'ˋ': 'grave', '`': 'grave', '˚': 'mathring',
  };
  // 拼接式大括号的部件 → 对应的定界符
  const STACKED = { '⎛': '(', '⎝': '(', '⎞': ')', '⎠': ')', '⎡': '[', '⎣': '[', '⎤': ']', '⎦': ']', '⎧': '{', '⎩': '{', '⎫': '}', '⎭': '}', '∣': '|', '∥': '‖', '⎪': '|' };
  const ENV = { '()': 'pmatrix', '[]': 'bmatrix', '\\{\\}': 'Bmatrix', '||': 'vmatrix', '\\|\\|': 'Vmatrix', '\\{.': 'cases' };
  const BIG = ['', '\\big', '\\Big', '\\bigg', '\\Bigg'];

  const leafText = (el) => el.textContent.replace(/[\u200b\u2060]/g, '');
  const isLeaf = (el) => !el.querySelector('[class]');
  const chars = (t) => join(Array.from(t).map(charTex));

  // vlist 中的各项：{ shift（>0 表示上移）, nodes }
  function vlistItems(el) {
    const t = has(el, 'vlist-t') ? el : Array.from(el.children).find((c) => has(c, 'vlist-t'));
    if (!t) return [];
    const r = Array.from(t.children).find((c) => has(c, 'vlist-r'));
    const v = r && Array.from(r.children).find((c) => has(c, 'vlist'));
    if (!v) return [];
    const out = [];
    for (const item of v.children) {
      const strut = Array.from(item.children).find((c) => has(c, 'pstrut'));
      if (!strut) continue;
      const top = parseFloat(item.style.top) || 0;
      const ph = parseFloat(strut.style.height) || 0;
      out.push({ el: item, shift: -(top + ph), nodes: Array.from(item.children).filter((c) => c !== strut) });
    }
    return out;
  }
  const itemsTex = (nodes) => join(nodes.map(conv)).trim();

  function delimOf(el) {
    if (!el || has(el, 'nulldelimiter')) return '.';
    const t = leafText(el).trim();
    if (!t) return '.';
    const c = Array.from(t)[0];
    const ch = STACKED[c] || c;
    if (ch === '‖') return '\\|';
    return charTex(ch);
  }
  const bigOf = (el) => {
    const s = has(el, 'delimsizing') ? el : el.querySelector('.delimsizing, .katex-delimsizing');
    const m = s && !has(s, 'mult') && (s.className.match(/\bsize([1-4])\b/) || [])[1];
    return m ? BIG[+m] : '';
  };

  function mspace(el, prev, next) {
    if (has(el, 'newline')) return ' \\\\ ';
    // 二元运算符、关系符、运算符、标点周围的间距是 KaTeX 自动加的
    const auto = (n) => n && ['mbin', 'mrel', 'mop', 'mpunct', 'minner'].some((c) => has(n, c));
    if (auto(prev) || auto(next)) return '';
    const em = parseFloat(el.style.marginRight || el.style.width) || 0;
    if (em >= 1.9) return '\\qquad ';
    if (em >= 0.9) return '\\quad ';
    if (em >= 0.25) return '\\;';
    if (em >= 0.2) return '\\:';
    if (em > 0.1) return '\\,';
    if (em < -0.1) return '\\!';
    return '';
  }

  function children(el) {
    const kids = Array.from(el.childNodes);
    const out = [];
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i];
      if (k.nodeType === 3) { out.push(chars(k.nodeValue.replace(/[\u200b\u2060]/g, ''))); continue; }
      if (k.nodeType !== 1) continue;
      // \binom：( 无分数线的 mfrac )
      const f = kids[i + 1];
      const c = kids[i + 2];
      if (has(k, 'mopen') && f && f.nodeType === 1 && has(f, 'mfrac') && !f.querySelector('.frac-line, .katex-frac-line') && c && c.nodeType === 1 && has(c, 'mclose')) {
        const items = vlistItems(f.querySelector('.vlist-t') || f).sort((a, b) => b.shift - a.shift);
        if (items.length === 2 && delimOf(k) === '(' && delimOf(c) === ')') {
          out.push(`\\binom{${itemsTex(items[0].nodes)}}{${itemsTex(items[1].nodes)}}`);
          i += 2;
          continue;
        }
      }
      if (has(k, 'mspace')) {
        let a = k.previousElementSibling;
        while (a && has(a, 'mspace')) a = a.previousElementSibling;
        let b = k.nextElementSibling;
        while (b && has(b, 'mspace')) b = b.nextElementSibling;
        out.push(mspace(k, a, b));
      }
      else out.push(conv(k));
    }
    return join(out);
  }

  function supsub(el) {
    let sub = '';
    let sup = '';
    for (const it of vlistItems(el)) {
      const t = itemsTex(it.nodes);
      if (!t) continue;
      if (it.shift > 0) sup = t; else sub = t;
    }
    let s = sub ? '_' + grp(sub) : '';
    if (sup) s += /^'+$/.test(sup) ? sup : '^' + grp(sup);
    return s;
  }

  function table(el) {
    const cols = Array.from(el.children).filter((c) => /\bcol-align-[lcr]\b/.test(c.className));
    const aligns = cols.map((c) => c.className.match(/\bcol-align-([lcr])\b/)[1]);
    const colCells = cols.map((c) => vlistItems(c).map((it) => ({ shift: it.shift, tex: itemsTex(it.nodes) })));
    const shifts = [];
    for (const cells of colCells) for (const c of cells) if (!shifts.some((s) => Math.abs(s - c.shift) < 0.2)) shifts.push(c.shift);
    shifts.sort((a, b) => b - a);
    const rows = shifts.map((s) => colCells.map((cells) => (cells.find((c) => Math.abs(c.shift - s) < 0.2) || { tex: '' }).tex));
    return { aligns, rows };
  }
  const tableBody = (t) => t.rows.map((r) => r.join(' & ')).join(' \\\\ ');

  function minner(el) {
    const kids = Array.from(el.children);
    const first = kids[0];
    const last = kids[kids.length - 1];
    if (!(kids.length >= 2 && has(first, 'mopen') && has(last, 'mclose'))) return isLeaf(el) ? chars(leafText(el)) : children(el);
    const l = delimOf(first);
    const r = delimOf(last);
    const mid = kids.slice(1, -1);
    // 带括号的矩阵、cases
    const tbl = mid.length === 1 && mid[0].querySelector(':scope > .mtable, :scope > .katex-mtable');
    if (tbl) {
      const env = ENV[l + r];
      const t = table(tbl);
      if (env) return `\\begin{${env}}${tableBody(t)}\\end{${env}}`;
      return `\\left${l}\\begin{matrix}${tableBody(t)}\\end{matrix}\\right${r}`;
    }
    const tmp = document.createElement('span');
    for (const m of mid) tmp.appendChild(m.cloneNode(true));
    return `\\left${l}${children(tmp)}\\right${r}`;
  }

  function conv(el) {
    if (el.nodeType === 3) return chars(el.nodeValue);
    if (el.nodeType !== 1) return '';
    if (has(el, 'katex-mathml') || has(el, 'strut') || has(el, 'pstrut') || has(el, 'nulldelimiter') || has(el, 'vlist-s') || has(el, 'tag')) return '';
    if (el.localName === 'svg') return '';
    if (has(el, 'msupsub')) return supsub(el);
    if (has(el, 'mfrac')) {
      const items = vlistItems(el);
      const line = items.find((it) => it.nodes.some((n) => has(n, 'frac-line')));
      const rest = items.filter((it) => it !== line).sort((a, b) => b.shift - a.shift);
      if (rest.length !== 2) return children(el);
      const [n, d] = rest.map((it) => itemsTex(it.nodes));
      if (!line) return `{${n} \\atop ${d}}`;
      // 行内公式中不缩小的分数是 \dfrac
      const small = rest[0].nodes.some((x) => has(x, 'sizing'));
      return `\\${!small && !el.closest('.katex-display') && !el.closest('.mtight') ? 'dfrac' : 'frac'}{${n}}{${d}}`;
    }
    if (has(el, 'sqrt')) {
      const root = Array.from(el.children).find((c) => has(c, 'root'));
      const main = Array.from(el.children).find((c) => has(c, 'vlist-t'));
      const body = main ? vlistItems(main).find((it) => !it.el.querySelector('.hide-tail, .katex-hide-tail, svg') || has(it.el, 'svg-align')) : null;
      const idx = root ? itemsTex(vlistItems(root).flatMap((it) => it.nodes)) : '';
      return `\\sqrt${idx ? `[${idx}]` : ''}{${body ? itemsTex(body.nodes) : ''}}`;
    }
    if (has(el, 'accent')) {
      const items = vlistItems(el);
      const acc = items.find((it) => it.nodes.some((n) => has(n, 'accent-body')));
      const body = items.find((it) => it !== acc);
      const b = body ? itemsTex(body.nodes) : '';
      const ab = acc && acc.nodes.find((n) => has(n, 'accent-body'));
      let cmd = 'hat';
      if (ab) {
        const t = leafText(ab).trim();
        if (t && ACCENTS[t]) cmd = ACCENTS[t];
        else if (ab.querySelector('.overlay, .katex-overlay')) cmd = 'vec';
        else if (ab.querySelector('svg')) cmd = Array.from(b).length > 1 ? 'widehat' : 'hat';
      }
      if (/^(hat|tilde)$/.test(cmd) && el.querySelector('svg') && b.replace(/\\[A-Za-z]+|[{}]/g, 'x').length > 1) cmd = 'wide' + cmd;
      return `\\${cmd}{${b}}`;
    }
    if (has(el, 'overline') || has(el, 'underline')) {
      const kind = has(el, 'overline') ? 'overline' : 'underline';
      const body = vlistItems(el).find((it) => !it.nodes.some((n) => has(n, kind + '-line')));
      return `\\${kind}{${body ? itemsTex(body.nodes) : ''}}`;
    }
    if (has(el, 'mtable')) {
      const t = table(el);
      const env = t.aligns.includes('r') ? 'aligned' : 'matrix';
      return `\\begin{${env}}${tableBody(t)}\\end{${env}}`;
    }
    if (has(el, 'fbox') || (has(el, 'boxpad') && has(el, 'enclosing'))) return `\\boxed{${children(el)}}`;
    if (has(el, 'mop')) {
      if (has(el, 'op-limits')) {
        const items = vlistItems(el);
        const op = items.find((it) => Math.abs(it.shift) < 0.05) || items.find((it) => it.el.querySelector('.op-symbol, .mop'));
        let lower = '';
        let upper = '';
        for (const it of items) {
          if (it === op) continue;
          if (it.shift > 0) upper = itemsTex(it.nodes); else lower = itemsTex(it.nodes);
        }
        const base = op ? itemsTex(op.nodes) : '';
        // 行内公式中上下限放在正上下方：\limits
        const lim = !el.closest('.katex-display') && /^\\(sum|prod|coprod|bigcup|bigcap|bigoplus|bigotimes|bigodot|biguplus|bigvee|bigwedge|bigsqcup|int|iint|iiint|oint)$/.test(base) ? '\\limits' : '';
        return base + lim + (lower ? '_' + grp(lower) : '') + (upper ? '^' + grp(upper) : '');
      }
      // \operatorname、小字号中的函数名：内部可能还有一层带类名的 span
      if (!isLeaf(el) && el.querySelector('.msupsub, .mop, .op-symbol, .vlist-t, .katex-vlist-t')) return children(el);
      const t = leafText(el).trim();
      if (!isLeaf(el) && el.querySelector('.mathrm, .katex-mathrm') && /^[A-Za-z]+$/.test(t) && !funcs().has(t)) return `\\operatorname{${t}}`;
      if (funcs().has(t)) return '\\' + t;
      if (/^[A-Za-z]{2,}$/.test(t)) return `\\operatorname{${t}}`;
      return chars(t);
    }
    if (has(el, 'minner')) return minner(el);
    if (has(el, 'mbin') && el.textContent.trim() === 'mod') return '\\bmod ';
    const sized = has(el, 'delimsizing') || Array.from(el.children).some((c) => has(c, 'delimsizing'));
    if ((has(el, 'mopen') || has(el, 'mclose') || (has(el, 'mord') && el.children.length === 1)) && sized) {
      const big = bigOf(el);
      const d = delimOf(el);
      const side = has(el, 'mopen') ? 'l' : has(el, 'mclose') ? 'r' : '';
      return big ? `${big}${side}${d}` : d;
    }
    if (has(el, 'text') && has(el, 'mord')) {
      const t = el.textContent.replace(/[\u200b\u2060]/g, '').replace(/\u00a0/g, ' ');
      return `\\text{${t.replace(/[\\{}#$%&_^~]/g, (c) => ({ '\\': '\\textbackslash{}', '^': '\\^{}', '~': '\\~{}' }[c] || '\\' + c))}}`;
    }
    if (isLeaf(el)) {
      const t = leafText(el);
      if (!t.trim()) return '';
      const font = Object.keys(FONT_CMD).find((f) => has(el, f));
      if (font) return `\\${FONT_CMD[font]}{${chars(t)}}`;
      // 竖线：作关系符时是 \mid，否则是普通的 |
      if (!el.closest('.mrel')) {
        if (t.trim() === '∣') return '|';
        if (t.trim() === '∥') return '\\|';
      }
      return chars(t);
    }
    return children(el);
  }

  // 参数：.katex-html 元素（或包含它的 .katex）
  CCM.katexHtmlToLatex = (root) => {
    const h = root && (has(root, 'katex-html') || root.classList.contains('katex-html') ? root : root.querySelector('.katex-html'));
    if (!h) return '';
    return join(Array.from(h.children).map((b) => (b.classList.contains('katex-base') || b.classList.contains('base') ? children(b) : conv(b))))
      // \not：KaTeX 用私有区字符 U+E020 叠在后一个符号上
      .replace(/\ue020\s*(=|\\in\b|\\[A-Za-z]+|.)/g, (m, x) => (x === '=' ? '\\ne ' : x === '\\in' ? '\\notin ' : '\\not' + x))
      // 单字符的上下标后紧跟字母时加空格，便于阅读（a_i b 而不是 a_ib）
      .replace(/(?<!\\)([_^])([A-Za-z0-9])(?=[A-Za-z0-9])/g, '$1$2 ')
      .replace(/\s+/g, ' ').trim();
  };
})();
