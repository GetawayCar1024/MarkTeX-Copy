// 轻量的 TeX → HTML 渲染，用于 PDF 大纲（书签）标题。
// Typora 等导出的书签里，标题中的公式是 TeX 源码（如“求和 \sum_{i=1}^n a_i”“\texttt{std::set} 的用法”），这里把它显示成公式的样子。
// 支持标题里常见的写法：上下标、分数与二项式、根号、重音（\hat、\vec 等）、字体（\mathbb、\mathcal、\texttt、\textbf 等）、
// 希腊字母与各种符号、定界符、矩阵等环境、间距和 \text 等文字命令；运算符、关系符两侧按 TeX 的规则留空。不认识的命令保留原样。
(() => {
  const CCM = (globalThis.__CCM = globalThis.__CCM || {});
  if (CCM.texLiteHtml) return;

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cp = (n) => String.fromCodePoint(n);
  const span = (cls, html) => `<span class="${cls}">${html}</span>`;

  // ---------- 符号：命令名 → 字符。由 mathml2latex.js 的符号表反向得到，再补上别名与文字符号 ----------
  const EXTRA = {
    le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', lt: '<', gt: '>', nleq: '≰', ngeq: '≱',
    to: '→', gets: '←', rightarrow: '→', leftarrow: '←', implies: '⟹', impliedby: '⟸', iff: '⟺',
    land: '∧', lor: '∨', lnot: '¬', owns: '∋', varnothing: '∅', colon: ':', coloneqq: '≔', eqqcolon: '≕',
    lbrace: '{', rbrace: '}', lbrack: '[', rbrack: ']', vert: '|', Vert: '‖', lvert: '|', rvert: '|', lVert: '‖', rVert: '‖',
    dots: '…', ldots: '…', dotsc: '…', dotso: '…', cdots: '⋯', dotsb: '⋯', dotsm: '⋯', dotsi: '⋯', vdots: '⋮', ddots: '⋱',
    prime: '′', backprime: '‵', degree: '°', hslash: 'ℏ', Box: '□', Diamond: '◇', bot: '⊥', complement: '∁',
    smallsetminus: '∖', cdotp: '·', And: '&', infin: '∞', varpropto: '∝', leftrightarrow: '↔',
    R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ', reals: 'ℝ', Reals: 'ℝ', natnums: 'ℕ', Complex: 'ℂ', cnums: 'ℂ',
    S: '§', P: '¶', dag: '†', ddag: '‡', copyright: '©', pounds: '£', euro: '€', yen: '¥',
    textbackslash: '\\', textasciitilde: '~', textasciicircum: '^', textbar: '|', textless: '<', textgreater: '>',
    textendash: '–', textemdash: '—', textbullet: '•', textperiodcentered: '·', textdegree: '°', textregistered: '®',
    texttrademark: '™', textcopyright: '©', textsection: '§', textquoteleft: '‘', textquoteright: '’',
    textquotedblleft: '“', textquotedblright: '”', textunderscore: '_', textdollar: '$',
  };
  let SYMS = null;
  function symbols() {
    if (SYMS) return SYMS;
    SYMS = {};
    for (const [ch, tex] of Object.entries(CCM.texSymbols || {})) {
      const m = /^\\([A-Za-z]+)$/.exec(tex);
      if (m && !SYMS[m[1]] && Array.from(ch).length === 1) SYMS[m[1]] = ch;
    }
    return Object.assign(SYMS, EXTRA);
  }
  // 不在 mathml2latex.js 中、但标题里常见的函数名（正体）
  const MORE_FUNCS = new Set(['arcsec', 'arccsc', 'arccot', 'sgn', 'lcm', 'argmax', 'argmin', 'rank', 'tr', 'Tr', 'diag', 'Var', 'Cov', 'sech', 'csch']);
  const isFunc = (name) => (CCM.texFuncs && CCM.texFuncs.has(name)) || MORE_FUNCS.has(name);

  // ---------- 原子的类别与间距（TeX 的规则，文本样式） ----------
  const REL = new Set([...'=<>:≤≥≦≧⩽⩾≠≈≡∼≃≅∝≪≫≺≻⪯⪰≼≽≍≐≜≔≕≮≯≰≱≁≇≉≢∣∤∥∦⊥⊢⊣⊨∈∉∋∌⊂⊃⊆⊇⊊⊋⊄⊅⊈⊉→←↔⇒⇐⇔⟶⟵⟷⟹⟸⟺↦⟼↑↓↕⇑⇓↗↘↙↖↪↩⇀↼⇌']);
  const BIN = new Set([...'+−±∓×÷·⋅∗∘∙⋆†‡∖∪∩⊎⊓⊔∧∨⊕⊖⊗⊘⊙⋉⋊≀∔⊲⊳⋄']);
  const BIGOP = new Set([...'∑∏∐∫∬∭∮⋃⋂⨁⨂⨀⨄⋁⋀⨆']);
  const OPEN = new Set([...'([{⟨⌈⌊']);
  const CLOSE = new Set([...')]}⟩⌉⌋!?']);
  const classOf = (ch) => (REL.has(ch) ? 'rel' : BIN.has(ch) ? 'bin' : BIGOP.has(ch) ? 'op' : OPEN.has(ch) ? 'open'
    : CLOSE.has(ch) ? 'close' : ch === ',' || ch === ';' ? 'punct' : 'ord');
  const SYM_CLASS = { colon: 'punct', cdotp: 'punct', ldots: 'inner', dots: 'inner', cdots: 'inner', dotsc: 'inner', dotsb: 'inner' };
  const TYPES = ['ord', 'op', 'bin', 'rel', 'open', 'close', 'punct', 'inner'];
  // 0 不留空，1 细（3mu），2 中（4mu），3 粗（5mu）；上下标、分子分母中只保留与大型运算符相邻的细空
  const GAP = [
    [0, 1, 2, 3, 0, 0, 0, 1],
    [1, 1, 0, 3, 0, 0, 0, 1],
    [2, 2, 0, 0, 2, 0, 0, 2],
    [3, 3, 0, 0, 3, 0, 0, 3],
    [0, 0, 0, 0, 0, 0, 0, 0],
    [0, 1, 2, 3, 0, 0, 0, 1],
    [1, 1, 0, 1, 1, 1, 1, 1],
    [1, 1, 2, 3, 1, 0, 1, 1],
  ];
  const gap = (k) => `<span class="tx-s${k}"></span>`;

  // 原子 { cls, html } 连成 HTML；cls 为 null 的是显式的空白，不影响相邻原子的间距
  function join(atoms, script) {
    const real = atoms.filter((a) => a.cls);
    // 不是二元运算的 + − 等（开头的负号、括号后的正负号）按普通符号处理
    real.forEach((a, k) => {
      const p = real[k - 1];
      if (a.cls === 'bin' && (!p || /^(bin|op|rel|open|punct)$/.test(p.cls))) a.cls = 'ord';
      if (/^(rel|close|punct)$/.test(a.cls) && p && p.cls === 'bin') p.cls = 'ord';
    });
    if (real.length && real[real.length - 1].cls === 'bin') real[real.length - 1].cls = 'ord';
    let out = '';
    let prev = null;
    for (const a of atoms) {
      if (a.cls && prev) {
        const g = GAP[TYPES.indexOf(prev.cls)][TYPES.indexOf(a.cls)];
        if (g && (!script || (g === 1 && (prev.cls === 'op' || a.cls === 'op')))) out += gap(g);
      }
      out += a.html;
      if (a.cls) prev = a;
    }
    return out;
  }

  // ---------- 字母的字体：Unicode 数学字母（U+1D400 起，每种字体 52 个字母 A–Z、a–z） ----------
  const BLOCK = { bf: 0, it: 1, bfit: 2, cal: 3, frak: 5, bb: 6, sf: 8, sfbf: 9, sfit: 10, tt: 12 };
  const HOLES = {
    it: { h: 0x210e },
    cal: { B: 0x212c, E: 0x2130, F: 0x2131, H: 0x210b, I: 0x2110, L: 0x2112, M: 0x2133, R: 0x211b, e: 0x212f, g: 0x210a, o: 0x2134 },
    frak: { C: 0x212d, H: 0x210c, I: 0x2111, R: 0x211c, Z: 0x2128 },
    bb: { C: 0x2102, H: 0x210d, N: 0x2115, P: 0x2119, Q: 0x211a, R: 0x211d, Z: 0x2124 },
  };
  const DIGITS = { bf: 0x1d7ce, bb: 0x1d7d8, sf: 0x1d7e2, sfbf: 0x1d7ec, tt: 0x1d7f6 };
  // 希腊字母：小写 α 的位置（大写 Α 在其前 26 个），每组末尾依次是 ∂ ϵ ϑ ϰ ϕ ϱ ϖ
  const GREEK = { it: 0x1d6fc, bf: 0x1d6c2, bfit: 0x1d736 };
  const GREEK_TAIL = '∂ϵϑϰϕϱϖ';
  function styled(ch, font) {
    if (/^[A-Za-z]$/.test(ch)) {
      if (BLOCK[font] == null) return ch;
      const hole = HOLES[font] && HOLES[font][ch];
      if (hole) return cp(hole);
      return cp(0x1d400 + BLOCK[font] * 52 + (ch < 'a' ? ch.charCodeAt(0) - 65 : ch.charCodeAt(0) - 71));
    }
    if (/^[0-9]$/.test(ch)) return DIGITS[font] ? cp(DIGITS[font] + +ch) : ch;
    const base = GREEK[font];
    if (base && ch) {
      const g = ch.codePointAt(0);
      if (g >= 0x3b1 && g <= 0x3c9) return cp(base + g - 0x3b1);
      if (g >= 0x391 && g <= 0x3a9 && font !== 'it') return cp(base - 26 + g - 0x391); // 大写希腊字母默认为正体
      const t = GREEK_TAIL.indexOf(ch);
      if (t >= 0) return cp(base + 25 + t);
    }
    return ch;
  }

  // ---------- 命令表 ----------
  const MATH_FONT = {
    mathrm: 'rm', mathup: 'rm', mathnormal: 'it', mathit: 'it', mathbf: 'bf', mathbfit: 'bfit', boldsymbol: 'bfit', bm: 'bfit',
    pmb: 'bfit', mathsf: 'sf', mathsfit: 'sfit', mathbfsf: 'sfbf', mathtt: 'tt', mathcal: 'cal', mathscr: 'cal', mathfrak: 'frak',
    mathbb: 'bb', Bbb: 'bb',
  };
  const MATH_SWITCH = { rm: 'rm', bf: 'bf', it: 'it', sf: 'sf', tt: 'tt', cal: 'cal', mit: 'it' };
  // 文字命令（参数按文字处理，正体、保留空格）与外层元素
  const TEXT_WRAP = {
    text: 'tx-text', textrm: 'tx-text', textnormal: 'tx-text', textup: 'tx-text', textmd: 'tx-text', mbox: 'tx-text', hbox: 'tx-text',
    textbf: 'b', textit: 'i', textsl: 'i', emph: 'i', texttt: 'tx-tt', textsf: 'tx-sf', textsc: 'tx-sc', url: 'tx-tt', path: 'tx-tt',
    sout: 'tx-del', fbox: 'tx-box', framebox: 'tx-box', pu: 'tx-text',
  };
  // \bfseries 等开关：作用到当前分组结束
  const TEXT_SWITCH = {
    bfseries: 'b', bf: 'b', itshape: 'i', it: 'i', em: 'i', slshape: 'i', ttfamily: 'tx-tt', tt: 'tx-tt', sffamily: 'tx-sf', sf: 'tx-sf',
    scshape: 'tx-sc', sc: 'tx-sc', rmfamily: 'tx-text', rm: 'tx-text', normalfont: 'tx-text', upshape: 'tx-text', mdseries: 'tx-text',
  };
  const wrap = (w, html) => (w === 'b' || w === 'i' ? `<${w}>${html}</${w}>` : span(w, html));
  // 重音：画在参数的正上方
  const ACCENT = {
    hat: 'ˆ', widehat: 'ˆ', check: 'ˇ', widecheck: 'ˇ', tilde: '˜', widetilde: '˜', acute: 'ˊ', grave: 'ˋ', dot: '˙', ddot: '¨',
    dddot: '⋯', breve: '˘', mathring: '˚', vec: '→', overrightarrow: '→', overleftarrow: '←', overleftrightarrow: '↔',
  };
  const ARROW_ACCENT = new Set(['vec', 'overrightarrow', 'overleftarrow', 'overleftrightarrow', 'dddot']);
  const SPACING = {
    ',': gap(1), thinspace: gap(1), ':': gap(2), '>': gap(2), medspace: gap(2), ';': gap(3), thickspace: gap(3),
    '!': span('tx-sneg', ''), negthinspace: span('tx-sneg', ''), ' ': ' ', space: ' ', nobreakspace: '\u00a0',
    enspace: span('tx-en', ''), quad: span('tx-quad', ''), qquad: span('tx-qquad', ''),
  };
  const IGNORE = new Set(['displaystyle', 'textstyle', 'scriptstyle', 'scriptscriptstyle', 'limits', 'nolimits', 'displaylimits',
    'nonscript', 'relax', 'strut', 'mathstrut', 'protect', 'allowbreak', 'nobreak', 'noindent', 'centering', 'par', 'nonumber', 'notag',
    'normalsize', 'small', 'large', 'Large', 'LARGE', 'huge', 'Huge', 'tiny', 'scriptsize', 'footnotesize', 'newline', 'linebreak']);
  const DELIM = {
    langle: '⟨', rangle: '⟩', lvert: '|', rvert: '|', vert: '|', lVert: '‖', rVert: '‖', Vert: '‖', lfloor: '⌊', rfloor: '⌋',
    lceil: '⌈', rceil: '⌉', lbrace: '{', rbrace: '}', lbrack: '[', rbrack: ']', backslash: '\\', uparrow: '↑', downarrow: '↓',
  };
  const NEGATE = {
    '=': '≠', '<': '≮', '>': '≯', '≤': '≰', '≥': '≱', '∈': '∉', '∋': '∌', '⊂': '⊄', '⊃': '⊅', '⊆': '⊈', '⊇': '⊉', '≡': '≢',
    '∼': '≁', '≅': '≇', '≈': '≉', '∣': '∤', '∥': '∦', '|': '∤',
  };
  const ENV_DELIM = { pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['{', '}'], vmatrix: ['|', '|'], Vmatrix: ['‖', '‖'], cases: ['{', ''], dcases: ['{', ''], rcases: ['', '}'] };
  const STAR = new Set(['operatorname', 'tag', 'hspace', 'vspace', 'verb']);
  const ASCII = {
    '-': ['−', 'bin'], '*': ['∗', 'bin'], '+': ['+', 'bin'], '=': ['=', 'rel'], '<': ['<', 'rel'], '>': ['>', 'rel'], ':': [':', 'rel'],
    ',': [',', 'punct'], ';': [';', 'punct'], '(': ['(', 'open'], '[': ['[', 'open'], ')': [')', 'close'], ']': [']', 'close'],
    '!': ['!', 'close'], '?': ['?', 'close'], '`': ['‘', 'ord'],
  };
  const frac = (a, b, cls = '') => `<span class="tx-frac${cls ? ' ' + cls : ''}"><span>${a}</span><span>${b}</span></span>`;
  const LOGO = { TeX: 'T<span class="tx-logo-e">e</span>X', LaTeX: 'L<span class="tx-logo-a">a</span>T<span class="tx-logo-e">e</span>X' };
  LOGO.LaTeXe = LOGO.LaTeX + '2ε';

  // \ce{H2O}（mhchem）：元素符号后的数字为下标，^ 与末尾的 + − 为电荷，-> 等为箭头
  function chem(s) {
    let out = '';
    for (let k = 0; k < s.length;) {
      const rest = s.slice(k);
      let m;
      if ((m = /^\s*(<=>|<->|->|<-)\s*/.exec(rest))) {
        out += gap(3) + { '<=>': '⇌', '<->': '↔', '->': '→', '<-': '←' }[m[1]] + gap(3);
      } else if ((m = /^\s+\+\s+/.exec(rest))) {
        out += gap(2) + '+' + gap(2);
      } else if ((m = /^\^(?:\{([^}]*)\}|([0-9]*[+-]|[0-9]+))/.exec(rest))) {
        out += `<sup>${esc((m[1] ?? m[2]).replace(/-/g, '−'))}</sup>`;
      } else if (k > 0 && /[A-Za-z0-9)\]]/.test(s[k - 1]) && (m = /^[+-](?=\s|$)/.exec(rest))) {
        out += `<sup>${m[0] === '-' ? '−' : '+'}</sup>`;
      } else if (k > 0 && /[A-Za-z)\]]/.test(s[k - 1]) && (m = /^[0-9]+/.exec(rest))) {
        out += `<sub>${m[0]}</sub>`;
      } else {
        m = [s[k]];
        out += esc(s[k]);
      }
      k += m[0].length;
    }
    return out;
  }

  // ---------- 解析：公式（math）与文字（text）两种模式 ----------
  function parser(src) {
    let i = 0;
    let font = 'it';
    let envDepth = 0;
    const ws = () => { while (i < src.length && /\s/.test(src[i])) i++; };
    const look = (re) => { re.lastIndex = i; return re.test(src); };
    const RIGHT = /\\right(?![A-Za-z])/y;
    const END = /\\end(?![A-Za-z])/y;
    const INFIX = /\\(over|choose|atop|brace|brack)(?![A-Za-z])/y;
    const NUM = /[0-9]+(?:\.[0-9]+)*/y;
    const COMMAND = /\\([A-Za-z]+|[^A-Za-z]?)/y;
    const DIMEN = /\s*-?[0-9.]+\s*[a-z]{2}(?:\s*(?:plus|minus)\s*-?[0-9.]+\s*[a-z]{2})*/y;
    const char = () => {
      if (i >= src.length) return '';
      const ch = String.fromCodePoint(src.codePointAt(i));
      i += ch.length;
      return ch;
    };
    // 控制序列：\字母串（其后的空格忽略），或 \ 加一个其他字符
    function command() {
      COMMAND.lastIndex = i;
      const m = COMMAND.exec(src);
      i = COMMAND.lastIndex;
      let name = m[1];
      if (/^[A-Za-z]/.test(name)) {
        if (src[i] === '*' && STAR.has(name)) { i++; name += '*'; }
        if (name !== 'verb' && name !== 'verb*') ws();
      }
      return name;
    }
    // 原样读取一个参数：{…} 或单个字符
    function raw() {
      ws();
      if (src[i] !== '{') return char();
      const start = ++i;
      for (let depth = 0; i < src.length; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === '{') depth++;
        else if (src[i] === '}') { if (!depth) break; depth--; }
      }
      const s = src.slice(start, i);
      i++;
      return s;
    }

    // 公式：原子列表。stop 为结束字符，或 'right' / 'end'（\left…\right、\begin…\end）
    function mlist(stop, script) {
      const saved = font;
      let atoms = [];
      let infix = null; // {a \over b} 等
      while (i < src.length) {
        ws();
        if (i >= src.length) break;
        const c = src[i];
        if (c === stop) break;
        if (c === '}') { if (stop === '}') break; i++; continue; }
        if (c === '\\') {
          if (stop === 'right' && look(RIGHT)) break;
          if (stop === 'end' && look(END)) break;
          INFIX.lastIndex = i;
          const m = INFIX.exec(src);
          if (m) {
            i = INFIX.lastIndex;
            infix = { kind: m[1], num: atoms };
            atoms = [];
            continue;
          }
        }
        const a = matom(script);
        if (!a) continue;
        if (a.cls) scripts(a);
        atoms.push(a);
      }
      font = saved;
      if (!infix) return atoms;
      const num = join(infix.num, true);
      const den = join(atoms, true);
      if (infix.kind === 'over') return [{ cls: 'inner', html: frac(num, den) }];
      if (infix.kind === 'atop') return [{ cls: 'inner', html: frac(num, den, 'tx-binom') }];
      return [{ cls: 'inner', html: `(${frac(num, den, 'tx-binom')})` }];
    }
    // 参数：{…} 或单个记号（上下标中的数字只取一位，与 TeX 相同）
    function margAtoms(script, one = false) {
      ws();
      if (src[i] === '{') {
        i++;
        const a = mlist('}', script);
        i++;
        return a;
      }
      const a = matom(script, one);
      return a ? [a] : [];
    }
    const marg = (script, one) => join(margAtoms(script, one), script);
    function optAtoms(script) {
      ws();
      if (src[i] !== '[') return null;
      i++;
      const a = mlist(']', script);
      i++;
      return a;
    }
    function withFont(f, fn) {
      const saved = font;
      font = f;
      try { return fn(); } finally { font = saved; }
    }
    // 上下标与撇号，接在原子后面
    function scripts(a) {
      let sup = null;
      let sub = null;
      let primes = '';
      for (;;) {
        ws();
        const c = src[i];
        if (c === "'") { i++; primes += '′'; continue; }
        if (c === '^' && sup === null) { i++; sup = marg(true, true); continue; }
        if (c === '_' && sub === null) { i++; sub = marg(true, true); continue; }
        break;
      }
      a.html += primes;
      if (sup !== null && sub !== null) a.html += span('tx-ss', `<span>${sup}</span><span>${sub}</span>`);
      else if (sup !== null) a.html += `<sup>${sup}</sup>`;
      else if (sub !== null) a.html += `<sub>${sub}</sub>`;
    }
    function matom(script, one = false) {
      const c = src[i];
      if (c == null) return null;
      if (c === '{') {
        i++;
        const a = mlist('}', script);
        i++;
        return { cls: 'ord', html: join(a, script) };
      }
      if (c === '\\') return mcommand(script);
      if (c === '^' || c === '_' || c === "'") return { cls: 'ord', html: '' }; // 没有底的上下标
      if (c === '~') { i++; return { cls: null, html: '\u00a0' }; }
      if (c === '&') { i++; return { cls: null, html: span('tx-en', '') }; }
      if (c === '$') { i++; return null; }
      if (/[0-9]/.test(c)) {
        let s = c;
        if (one) i++;
        else { NUM.lastIndex = i; s = NUM.exec(src)[0]; i = NUM.lastIndex; }
        return { cls: 'ord', html: Array.from(s, (d) => styled(d, font)).join('') };
      }
      const ch = char();
      if (/^[A-Za-z]$/.test(ch)) return { cls: 'ord', html: esc(styled(ch, font)) };
      if (ASCII[ch]) return { cls: ASCII[ch][1], html: esc(ASCII[ch][0]) };
      return { cls: classOf(ch), html: esc(styled(ch, font)) };
    }
    // \left 等后面的定界符
    function delim() {
      ws();
      if (src[i] === '\\') {
        const save = i;
        const n = command();
        if (n.length === 1 && !/[A-Za-z]/.test(n)) return n === '|' ? '‖' : n;
        const d = DELIM[n] ?? symbols()[n];
        if (d != null) return d;
        i = save;
        return '';
      }
      const ch = char();
      return ch === '.' ? '' : ch === '<' ? '⟨' : ch === '>' ? '⟩' : ch;
    }
    function mcommand(script) {
      const name = command();
      if (!name) return null;
      if (name.length === 1 && !/[A-Za-z]/.test(name)) {
        if (SPACING[name] != null) return { cls: null, html: SPACING[name] };
        if (name === '{') return { cls: 'open', html: '{' };
        if (name === '}') return { cls: 'close', html: '}' };
        if (name === '|') return { cls: 'ord', html: '‖' };
        if (name === '\\') return envDepth ? { cls: 'punct', html: ';' } : { cls: null, html: ' ' };
        return { cls: 'ord', html: esc(name) }; // \# \$ \% \& \_
      }
      if (SPACING[name] != null) return { cls: null, html: SPACING[name] };
      if (IGNORE.has(name)) return null;
      if (MATH_FONT[name]) return { cls: 'ord', html: withFont(MATH_FONT[name], () => marg(script)) };
      if (MATH_SWITCH[name]) { font = MATH_SWITCH[name]; return null; } // 作用到当前分组结束
      if (TEXT_WRAP[name] != null) return { cls: 'ord', html: wrap(TEXT_WRAP[name], targ()) };
      if (ACCENT[name]) {
        const html = marg(script);
        return { cls: 'ord', html: `<span class="tx-acc${ARROW_ACCENT.has(name) ? ' tx-acc-arrow' : ''}" data-acc="${ACCENT[name]}">${html}</span>` };
      }
      switch (name) {
        case 'operatorname': case 'operatorname*': return { cls: 'op', html: withFont('rm', () => marg(script)) };
        case 'mathop': return { cls: 'op', html: marg(script) };
        case 'mathbin': return { cls: 'bin', html: marg(script) };
        case 'mathrel': return { cls: 'rel', html: marg(script) };
        case 'mathord': return { cls: 'ord', html: marg(script) };
        case 'mathopen': return { cls: 'open', html: marg(script) };
        case 'mathclose': return { cls: 'close', html: marg(script) };
        case 'mathpunct': return { cls: 'punct', html: marg(script) };
        case 'mathinner': return { cls: 'inner', html: marg(script) };
        case 'ensuremath': return { cls: 'ord', html: marg(script) };
        case 'frac': case 'dfrac': case 'tfrac': case 'cfrac': {
          const a = marg(true);
          return { cls: 'inner', html: frac(a, marg(true)) };
        }
        case 'binom': case 'dbinom': case 'tbinom': {
          const a = marg(true);
          return { cls: 'inner', html: `(${frac(a, marg(true), 'tx-binom')})` };
        }
        case 'sqrt': {
          const idx = optAtoms(true);
          const body = marg(script);
          return { cls: 'ord', html: `${idx ? `<sup class="tx-root">${join(idx, true)}</sup>` : ''}√${span('tx-ol', body)}` };
        }
        case 'overline': case 'bar': case 'overbrace': return { cls: 'ord', html: span('tx-ol', marg(script)) };
        case 'underline': case 'underbrace': return { cls: 'ord', html: span('tx-ul', marg(script)) };
        case 'boxed': return { cls: 'ord', html: span('tx-box', marg(script)) };
        case 'cancel': case 'bcancel': case 'xcancel': return { cls: 'ord', html: span('tx-del', marg(script)) };
        case 'phantom': case 'hphantom': return { cls: 'ord', html: span('tx-ph', marg(script)) };
        case 'vphantom': marg(script); return null;
        case 'smash': optAtoms(script); return { cls: 'ord', html: marg(script) };
        case 'overset': case 'stackrel': case 'underset': {
          const label = marg(true);
          const base = margAtoms(script);
          const where = name === 'underset' ? 'tx-under-a' : 'tx-over-a';
          return { cls: base.length === 1 ? base[0].cls || 'ord' : 'ord', html: `<span class="tx-stack"><span class="${where}">${label}</span>${join(base, script)}</span>` };
        }
        case 'xrightarrow': case 'xleftarrow': case 'xRightarrow': case 'xLeftarrow': case 'xleftrightarrow': case 'xmapsto': {
          const below = optAtoms(true);
          const above = marg(true);
          const arrow = { xrightarrow: '⟶', xleftarrow: '⟵', xRightarrow: '⟹', xLeftarrow: '⟸', xleftrightarrow: '⟷', xmapsto: '⟼' }[name];
          return {
            cls: 'rel',
            html: `<span class="tx-stack">${above ? `<span class="tx-over-a">${above}</span>` : ''}${below ? `<span class="tx-under-a">${join(below, true)}</span>` : ''}${arrow}</span>`,
          };
        }
        case 'color': raw(); return null;
        case 'textcolor': case 'mathcolor': raw(); return { cls: 'ord', html: marg(script) };
        case 'colorbox': raw(); return { cls: 'ord', html: wrap('tx-text', targ()) };
        case 'fcolorbox': raw(); raw(); return { cls: 'ord', html: wrap('tx-box', targ()) };
        case 'left': {
          const open = delim();
          const inner = mlist('right', script);
          let close = '';
          if (look(RIGHT)) { command(); close = delim(); }
          return { cls: 'inner', html: esc(open) + join(inner, script) + esc(close) };
        }
        case 'right': return { cls: 'close', html: esc(delim()) };
        case 'middle': case 'bigm': case 'Bigm': case 'biggm': case 'Biggm': return { cls: 'rel', html: esc(delim()) };
        case 'big': case 'Big': case 'bigg': case 'Bigg': return { cls: 'ord', html: esc(delim()) };
        case 'bigl': case 'Bigl': case 'biggl': case 'Biggl': return { cls: 'open', html: esc(delim()) };
        case 'bigr': case 'Bigr': case 'biggr': case 'Biggr': return { cls: 'close', html: esc(delim()) };
        case 'not': {
          ws();
          let ch = '';
          if (src[i] === '\\') {
            const n = command();
            ch = n.length === 1 && !/[A-Za-z]/.test(n) ? n : symbols()[n] || '';
          } else {
            ch = char();
          }
          return { cls: 'rel', html: esc(NEGATE[ch] || (ch ? ch + '\u0338' : '/')) };
        }
        case 'bmod': return { cls: 'bin', html: 'mod' };
        case 'mod': return { cls: 'rel', html: 'mod' };
        case 'pmod': { const a = marg(script); return { cls: 'ord', html: `${span('tx-quad', '')}(mod${gap(1)}${gap(1)}${a})` }; }
        case 'pod': { const a = marg(script); return { cls: 'ord', html: `${span('tx-quad', '')}(${a})` }; }
        case 'begin': {
          const env = raw().replace(/\*$/, '');
          if (/^(array|subarray|alignat|alignedat|tabular)$/.test(env)) raw(); // 列格式
          const [l, r] = ENV_DELIM[env] || ['', ''];
          envDepth++;
          const body = mlist('end', script);
          envDepth--;
          if (look(END)) { command(); raw(); }
          return { cls: 'inner', html: esc(l) + join(body, script) + esc(r) };
        }
        case 'end': raw(); return null;
        case 'tag': return { cls: null, html: `${span('tx-quad', '')}(${targ()})` };
        case 'tag*': return { cls: null, html: `${span('tx-quad', '')}${targ()}` };
        case 'label': case 'index': case 'footnote': case 'hypertarget': raw(); return null;
        case 'ref': case 'autoref': case 'cref': return { cls: 'ord', html: esc(raw()) };
        case 'eqref': return { cls: 'ord', html: `(${esc(raw())})` };
        case 'cite': return { cls: 'ord', html: `[${esc(raw())}]` };
        case 'href': raw(); return { cls: 'ord', html: wrap('tx-text', targ()) };
        case 'hspace': case 'hspace*': raw(); return { cls: null, html: ' ' };
        case 'vspace': case 'vspace*': raw(); return null;
        case 'hskip': case 'mskip': case 'kern': case 'mkern': DIMEN.lastIndex = i; if (DIMEN.test(src)) i = DIMEN.lastIndex; return null;
        case 'ce': return { cls: 'ord', html: chem(raw()) };
        case 'verb': case 'verb*': return { cls: 'ord', html: span('tx-tt', esc(verb())) };
        case 'TeX': case 'LaTeX': case 'LaTeXe': return { cls: 'ord', html: span('tx-logo', LOGO[name]) };
        default: break;
      }
      if (isFunc(name)) return { cls: 'op', html: name };
      const sym = symbols()[name];
      if (sym != null) return { cls: SYM_CLASS[name] || classOf(sym), html: esc(styled(sym, font)) };
      return { cls: 'ord', html: span('tx-text', esc('\\' + name)) };
    }
    // \verb|…|：分隔符之间原样保留
    function verb() {
      const d = char();
      const end = src.indexOf(d, i);
      const s = src.slice(i, end < 0 ? src.length : end);
      i = end < 0 ? src.length : end + d.length;
      return s;
    }

    // 文字：HTML（保留空格，$…$ 中为公式）
    function tlist(stop) {
      let out = '';
      while (i < src.length) {
        const c = src[i];
        if (c === stop) break;
        if (c === '}') { if (stop === '}') break; i++; continue; }
        if (c === '{') {
          i++;
          out += tlist('}');
          i++;
          continue;
        }
        if (c === '$') {
          const n = src[i + 1] === '$' ? 2 : 1;
          i += n;
          const a = withFont('it', () => mlist('$', false));
          i += n;
          out += span('tx-math', join(a, false));
          continue;
        }
        if (c === '\\') { out += tcommand(stop); continue; }
        if (c === '~') { i++; out += '\u00a0'; continue; }
        if (c === '-' && src[i + 1] === '-') {
          const three = src[i + 2] === '-';
          i += three ? 3 : 2;
          out += three ? '—' : '–';
          continue;
        }
        if (c === '`' && src[i + 1] === '`') { i += 2; out += '“'; continue; }
        if (c === "'" && src[i + 1] === "'") { i += 2; out += '”'; continue; }
        if (/\s/.test(c)) { ws(); out += ' '; continue; }
        out += esc(char());
      }
      return out;
    }
    function targ() {
      ws();
      if (src[i] !== '{') return esc(char());
      i++;
      const s = tlist('}');
      i++;
      return s;
    }
    function tcommand(stop) {
      const name = command();
      if (!name) return '';
      if (name.length === 1 && !/[A-Za-z]/.test(name)) {
        if (name === '\\') return ' ';
        if (SPACING[name] != null) return SPACING[name];
        return esc(name);
      }
      if (SPACING[name] != null) return SPACING[name];
      if (IGNORE.has(name)) return '';
      if (TEXT_WRAP[name] != null) return wrap(TEXT_WRAP[name], targ());
      if (TEXT_SWITCH[name]) return wrap(TEXT_SWITCH[name], tlist(stop));
      switch (name) {
        case 'underline': return span('tx-ul', targ());
        case 'textsuperscript': return `<sup>${targ()}</sup>`;
        case 'textsubscript': return `<sub>${targ()}</sub>`;
        case 'textcolor': raw(); return targ();
        case 'color': raw(); return '';
        case 'colorbox': raw(); return targ();
        case 'href': raw(); return targ();
        case 'ensuremath': return span('tx-math', withFont('it', () => marg(false)));
        case 'verb': case 'verb*': return span('tx-tt', esc(verb()));
        case 'TeX': case 'LaTeX': case 'LaTeXe': return span('tx-logo', LOGO[name]);
        case 'label': case 'index': case 'footnote': case 'hypertarget': raw(); return '';
        case 'ref': case 'autoref': case 'cref': return esc(raw());
        case 'eqref': return `(${esc(raw())})`;
        case 'cite': return `[${esc(raw())}]`;
        case 'hspace': case 'hspace*': raw(); return ' ';
        case 'vspace': case 'vspace*': raw(); return '';
        default: break;
      }
      const sym = symbols()[name];
      if (sym != null) return esc(sym);
      return esc('\\' + name);
    }

    return {
      math: () => join(mlist(null, false), false),
      text: () => tlist(null),
    };
  }

  const mathHtml = (src) => span('tx-math', parser(src).math());
  const textHtml = (src) => (/\\[A-Za-z]/.test(src) ? parser(src).text() : esc(src));

  // 有 $…$ 或 \(…\) 分隔：其中按公式，其余按文字（只在含命令时解析，如 \texttt{…}）。
  // 与 Pandoc 相同，$ 之后、结束的 $ 之前不能是空格，结束的 $ 后面不能紧跟数字（“$5 和 $10”不是公式）
  const DELIMITED = /\$\$([^$]+)\$\$|\$(?!\s)([^$]*?[^\s$])\$(?!\d)|\\\(([\s\S]+?)\\\)/;
  function delimited(title) {
    const re = new RegExp(DELIMITED.source, 'g');
    let out = '';
    let last = 0;
    let m;
    while ((m = re.exec(title))) {
      out += textHtml(title.slice(last, m.index)) + mathHtml(m[1] ?? m[2] ?? m[3]);
      last = re.lastIndex;
    }
    return out + textHtml(title.slice(last));
  }

  // 没有分隔符（Typora 等导出的书签）：标题中由 ASCII 与数学符号组成的连续部分按空格切成小段；
  // 含命令或上下标的段，以及与它相连的数字、单个字母、运算符、括号等合起来按公式显示；英文单词、标点和开头的编号保持原样。
  // 下划线只在 x_i、a_{ij} 这类写法中算下标，max_element 之类的标识符不算
  const TEXISH = /\\[A-Za-z]|\\[^\sA-Za-z]|\^|_(?:\{|\\|[A-Za-z0-9](?![A-Za-z0-9]))/;
  const RUN_CHAR = /[\x20-\x7e\u0370-\u03ff\u2032-\u2037\u2100-\u214f\u2190-\u23ff\u27c0-\u27ff\u2980-\u2aff]/;
  // 标题切成“可能是 TeX 的连续部分”与其他文字；花括号内的汉字等也算在内（如 \textbf{粗体}）
  function runs(title) {
    const out = [];
    let cur = '';
    let inRun = false;
    let depth = 0;
    const chars = Array.from(title);
    for (let k = 0; k < chars.length; k++) {
      const ch = chars[k];
      const ok = RUN_CHAR.test(ch) || (inRun && depth > 0);
      if (ok !== inRun && cur) { out.push({ text: cur, run: inRun }); cur = ''; }
      inRun = ok;
      cur += ch;
      if (!ok) continue;
      if (ch === '\\' && k + 1 < chars.length) { cur += chars[++k]; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') depth = Math.max(0, depth - 1);
    }
    if (cur) out.push({ text: cur, run: inRun });
    return out;
  }
  function chunks(s) {
    const out = [];
    let cur = '';
    let space = '';
    let depth = 0;
    const flush = () => { if (cur) out.push({ text: cur, space: '' }); cur = ''; };
    for (let k = 0; k < s.length; k++) {
      const c = s[k];
      if (c === '\\' && k + 1 < s.length) { cur += c + s[++k]; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth = Math.max(0, depth - 1);
      if (/\s/.test(c) && !depth) {
        flush();
        if (out.length) out[out.length - 1].space += c;
        else space += c;
        continue;
      }
      cur += c;
    }
    flush();
    return { lead: space, list: out };
  }
  // \text{…}、\textbf{…} 等文字命令：与相邻的段之间保留空格（公式中的空格本来会被忽略），参数里已有的空格除外
  const TEXT_CHUNK = /^\\(?:text[a-z]*|emph|mbox|hbox|underline|sout|LaTeX|TeX)(?![A-Za-z])/;
  const keepSpace = (left, right) => (TEXT_CHUNK.test(left) && !/\s\}$/.test(left)) || (TEXT_CHUNK.test(right) && !/^\\[A-Za-z]+\{\s/.test(right));
  function run(s) {
    const { lead, list: parts } = chunks(s);
    // “\texttt{x}:” 之类：末尾的标点按文字处理
    const list = [];
    for (const c of parts) {
      const m = /^(.*\})([.,:;!?]+)$/.exec(c.text);
      if (m && TEXISH.test(m[1])) list.push({ text: m[1], space: '' }, { text: m[2], space: c.space });
      else list.push(c);
    }
    // Windows 路径（C:\Users）不是 TeX
    const kind = (t, k) => (TEXISH.test(t) && !/^[A-Za-z]:\\/.test(t) ? 'tex'
      : /[A-Za-z]{2,}/.test(t) || /^[.,:;!?'"–—-]+$/.test(t) || (k === 0 && /^\(?\d+(\.\d+)*[.)]?$/.test(t)) ? 'word' : 'neutral');
    const kinds = list.map((c, k) => kind(c.text, k));
    const math = kinds.map((k) => k === 'tex');
    for (let k = 1; k < list.length; k++) if (!math[k] && kinds[k] === 'neutral' && math[k - 1]) math[k] = true;
    for (let k = list.length - 2; k >= 0; k--) if (!math[k] && kinds[k] === 'neutral' && math[k + 1]) math[k] = true;
    let out = esc(lead);
    for (let k = 0; k < list.length;) {
      if (!math[k]) { out += esc(list[k].text + list[k].space); k++; continue; }
      let src = '';
      let end = k;
      while (end < list.length && math[end]) {
        src += list[end].text;
        const next = list[end + 1];
        if (next && math[end + 1]) src += list[end].space && keepSpace(list[end].text, next.text) ? '\\ ' : list[end].space;
        end++;
      }
      out += mathHtml(src) + esc(list[end - 1].space);
      k = end;
    }
    return { html: out, changed: math.some(Boolean) };
  }
  function undelimited(title) {
    let out = '';
    let changed = false;
    for (const part of runs(title)) {
      if (!part.run) { out += esc(part.text); continue; }
      const r = run(part.text);
      out += r.html;
      changed = changed || r.changed;
    }
    return changed ? out : null;
  }

  // 把标题中的 TeX 片段渲染出来；没有 TeX 写法时返回 null（保持原样）
  CCM.texLiteHtml = (title) => {
    if (!title || !/\\|[_^$]/.test(title)) return null;
    try {
      if (DELIMITED.test(title)) return delimited(title);
      return TEXISH.test(title) ? undelimited(title) : null;
    } catch (e) {
      console.warn('[marktex-copy] tex-lite', e);
      return null;
    }
  };
})();
