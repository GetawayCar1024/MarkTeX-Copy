// 轻量的 TeX → HTML 渲染，用于 PDF 大纲（书签）标题。
// Typora 等导出的书签里，标题中的公式是 TeX 源码（如“求和 \sum_{i=1}^n a_i”），这里把它显示成公式的样子。
// 只覆盖标题里常见的写法：上下标、分数、根号、字体命令、希腊字母与运算符。
(() => {
  const CCM = (globalThis.__CCM = globalThis.__CCM || {});
  if (CCM.texLiteHtml) return;

  let CMD = null; // \alpha → α 等，由 mathml2latex.js 的符号表反向得到
  function commands() {
    if (CMD) return CMD;
    CMD = {};
    for (const [ch, tex] of Object.entries(CCM.texSymbols || {})) {
      const m = /^\\([A-Za-z]+)$/.exec(tex);
      if (m && !CMD[m[1]] && Array.from(ch).length === 1) CMD[m[1]] = ch;
    }
    Object.assign(CMD, { le: '≤', ge: '≥', ne: '≠', to: '→', gets: '←', lbrace: '{', rbrace: '}', lvert: '|', rvert: '|', vert: '|', Vert: '‖', dots: '…' });
    return CMD;
  }
  const UPRIGHT = /^(text|textrm|textnormal|mathrm|operatorname|textup|mbox)$/;
  const BOLD = /^(textbf|mathbf|boldsymbol|bm)$/;
  const SPACE = { ',': '\u2009', ':': '\u2005', ';': '\u2004', ' ': ' ', quad: '\u2003', qquad: '\u2003\u2003', '!': '' };
  const DOUBLE = { C: 'ℂ', H: 'ℍ', N: 'ℕ', P: 'ℙ', Q: 'ℚ', R: 'ℝ', Z: 'ℤ' };
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function render(src) {
    let i = 0;
    const funcs = CCM.texFuncs || new Set();
    const group = () => {
      while (src[i] === ' ') i++;
      if (src[i] === '{') {
        i++;
        const out = seq('}');
        i++;
        return out;
      }
      return atom();
    };
    const rawGroup = () => {
      while (src[i] === ' ') i++;
      if (src[i] !== '{') return src[i++] || '';
      let depth = 0;
      const start = ++i;
      for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { if (!depth) break; depth--; }
      }
      return src.slice(start, i++);
    };
    function atom() {
      const c = src[i];
      if (c == null) return '';
      if (c === '\\') {
        const m = /^\\([A-Za-z]+|.)/.exec(src.slice(i));
        i += m[0].length;
        const name = m[1];
        if (UPRIGHT.test(name)) return `<span class="tx-up">${esc(rawGroup())}</span>`;
        if (BOLD.test(name)) return `<b>${group()}</b>`;
        if (name === 'mathbb') return Array.from(rawGroup()).map((ch) => DOUBLE[ch] || ch).join('');
        if (/^(mathcal|mathscr|mathfrak|mathsf|mathtt|mathit)$/.test(name)) return group();
        if (/^[dt]?frac$/.test(name)) { const a = group(); const b = group(); return `<span class="tx-frac"><span>${a}</span><span>${b}</span></span>`; }
        if (name === 'sqrt') {
          let idx = '';
          if (src[i] === '[') { const e = src.indexOf(']', i); idx = `<sup>${esc(src.slice(i + 1, e))}</sup>`; i = e + 1; }
          return `${idx}√<span class="tx-sqrt">${group()}</span>`;
        }
        if (/^(overline|bar)$/.test(name)) return `<span class="tx-sqrt">${group()}</span>`;
        if (/^(left|right|big|Big|bigg|Bigg|bigl|bigr|Bigl|Bigr|displaystyle|textstyle|limits|nolimits)$/.test(name)) return '';
        if (SPACE[name] != null) return SPACE[name];
        if (funcs.has(name)) return `<span class="tx-up">${name}</span>`;
        const sym = commands()[name];
        if (sym) return esc(sym);
        if (/^[{}%$&#_]$/.test(name)) return esc(name);
        return esc('\\' + name);
      }
      i++;
      if (c === '^' || c === '_') { const tag = c === '^' ? 'sup' : 'sub'; return `<${tag}>${group()}</${tag}>`; }
      if (c === '{') { const out = seq('}'); i++; return out; }
      if (c === '~') return ' ';
      if (/[A-Za-z]/.test(c)) return `<i>${c}</i>`;
      if (c === '-') return '−';
      if (c === "'") return '′';
      return esc(c);
    }
    function seq(end) {
      let out = '';
      while (i < src.length && src[i] !== end) out += atom();
      return out;
    }
    return seq(null);
  }

  // 把标题中的 TeX 片段渲染出来；没有 TeX 写法时返回 null（保持原样）
  CCM.texLiteHtml = (title) => {
    if (!/\\[A-Za-z]+|[A-Za-z0-9}][_^]/.test(title)) return null;
    // TeX 片段：由 ASCII 字符组成、且包含命令或上下标的连续部分
    const parts = title.split(/([\x21-\x7e](?:[\x20-\x7e]*[\x21-\x7e])?)/);
    let changed = false;
    const html = parts.map((p, k) => {
      if (k % 2 === 0 || !/\\[A-Za-z]+|[_^]/.test(p)) return esc(p);
      changed = true;
      return `<span class="tx-math">${render(p.replace(/^\$+|\$+$/g, ''))}</span>`;
    }).join('');
    return changed ? html : null;
  };
})();
