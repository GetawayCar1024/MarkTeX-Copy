(() => {
  const CCM = (globalThis.__CCM = globalThis.__CCM || {});
  if (CCM.mathmlToLatex) return;

  const SYM = {
    // Greek
    'α': '\\alpha', 'β': '\\beta', 'γ': '\\gamma', 'δ': '\\delta', 'ϵ': '\\epsilon', 'ε': '\\varepsilon',
    'ζ': '\\zeta', 'η': '\\eta', 'θ': '\\theta', 'ϑ': '\\vartheta', 'ι': '\\iota', 'κ': '\\kappa',
    'ϰ': '\\varkappa', 'λ': '\\lambda', 'μ': '\\mu', 'ν': '\\nu', 'ξ': '\\xi', 'ο': 'o', 'π': '\\pi',
    'ϖ': '\\varpi', 'ρ': '\\rho', 'ϱ': '\\varrho', 'σ': '\\sigma', 'ς': '\\varsigma', 'τ': '\\tau',
    'υ': '\\upsilon', 'ϕ': '\\phi', 'φ': '\\varphi', 'χ': '\\chi', 'ψ': '\\psi', 'ω': '\\omega',
    'Γ': '\\Gamma', 'Δ': '\\Delta', 'Θ': '\\Theta', 'Λ': '\\Lambda', 'Ξ': '\\Xi', 'Π': '\\Pi',
    'Σ': '\\Sigma', 'Υ': '\\Upsilon', 'Φ': '\\Phi', 'Ψ': '\\Psi', 'Ω': '\\Omega',
    'Α': 'A', 'Β': 'B', 'Ε': 'E', 'Ζ': 'Z', 'Η': 'H', 'Ι': 'I', 'Κ': 'K', 'Μ': 'M', 'Ν': 'N',
    'Ο': 'O', 'Ρ': 'P', 'Τ': 'T', 'Χ': 'X', 'ϝ': '\\digamma',
    // Binary operators / relations
    '±': '\\pm', '∓': '\\mp', '×': '\\times', '÷': '\\div', '·': '\\cdot', '⋅': '\\cdot', '∗': '\\ast',
    '∘': '\\circ', '∙': '\\bullet', '⋆': '\\star', '†': '\\dagger', '‡': '\\ddagger', '∖': '\\setminus',
    '≤': '\\le', '≥': '\\ge', '≦': '\\leqq', '≧': '\\geqq', '⩽': '\\leqslant', '⩾': '\\geqslant',
    '≠': '\\ne', '≈': '\\approx', '≡': '\\equiv', '∼': '\\sim', '≃': '\\simeq', '≅': '\\cong',
    '∝': '\\propto', '≪': '\\ll', '≫': '\\gg', '≺': '\\prec', '≻': '\\succ', '⪯': '\\preceq',
    '⪰': '\\succeq', '≼': '\\preccurlyeq', '≽': '\\succcurlyeq', '≍': '\\asymp', '≐': '\\doteq',
    '≜': '\\triangleq', '≔': ':=', '≮': '\\nless', '≯': '\\ngtr', '≰': '\\nleq', '≱': '\\ngeq',
    '≁': '\\nsim', '≇': '\\ncong', '∣': '\\mid', '∤': '\\nmid', '∥': '\\parallel', '∦': '\\nparallel',
    '⊥': '\\perp', '⊤': '\\top', '⊢': '\\vdash', '⊣': '\\dashv', '⊨': '\\models',
    '∈': '\\in', '∉': '\\notin', '∋': '\\ni', '∌': '\\not\\ni', '⊂': '\\subset', '⊃': '\\supset',
    '⊆': '\\subseteq', '⊇': '\\supseteq', '⊊': '\\subsetneq', '⊋': '\\supsetneq', '⊄': '\\not\\subset',
    '⊈': '\\nsubseteq', '⊉': '\\nsupseteq', '∪': '\\cup', '∩': '\\cap', '⊎': '\\uplus', '⊓': '\\sqcap',
    '⊔': '\\sqcup', '∧': '\\wedge', '∨': '\\vee', '¬': '\\neg', '⊕': '\\oplus', '⊖': '\\ominus',
    '⊗': '\\otimes', '⊘': '\\oslash', '⊙': '\\odot', '⋉': '\\ltimes', '⋊': '\\rtimes', '≀': '\\wr',
    '∔': '\\dotplus', '⊲': '\\lhd', '⊳': '\\rhd', '⋄': '\\diamond', '◯': '\\bigcirc',
    // Big operators
    '∑': '\\sum', '∏': '\\prod', '∐': '\\coprod', '∫': '\\int', '∬': '\\iint', '∭': '\\iiint',
    '∮': '\\oint', '⋃': '\\bigcup', '⋂': '\\bigcap', '⨁': '\\bigoplus', '⨂': '\\bigotimes',
    '⨀': '\\bigodot', '⨄': '\\biguplus', '⋁': '\\bigvee', '⋀': '\\bigwedge', '⨆': '\\bigsqcup',
    // Arrows
    '→': '\\to', '←': '\\leftarrow', '↔': '\\leftrightarrow', '⇒': '\\Rightarrow', '⇐': '\\Leftarrow',
    '⇔': '\\Leftrightarrow', '⟶': '\\longrightarrow', '⟵': '\\longleftarrow', '⟷': '\\longleftrightarrow',
    '⟹': '\\Longrightarrow', '⟸': '\\Longleftarrow', '⟺': '\\iff', '↦': '\\mapsto', '⟼': '\\longmapsto',
    '↑': '\\uparrow', '↓': '\\downarrow', '↕': '\\updownarrow', '⇑': '\\Uparrow', '⇓': '\\Downarrow',
    '↗': '\\nearrow', '↘': '\\searrow', '↙': '\\swarrow', '↖': '\\nwarrow', '↪': '\\hookrightarrow',
    '↩': '\\hookleftarrow', '⇀': '\\rightharpoonup', '↼': '\\leftharpoonup', '⇌': '\\rightleftharpoons',
    // Misc symbols
    '∀': '\\forall', '∃': '\\exists', '∄': '\\nexists', '∅': '\\emptyset', '∞': '\\infty', '∂': '\\partial',
    '∇': '\\nabla', 'ℝ': '\\mathbb{R}', 'ℕ': '\\mathbb{N}', 'ℤ': '\\mathbb{Z}', 'ℚ': '\\mathbb{Q}',
    'ℂ': '\\mathbb{C}', 'ℙ': '\\mathbb{P}', 'ℍ': '\\mathbb{H}', 'ℏ': '\\hbar', 'ℓ': '\\ell',
    'ℵ': '\\aleph', 'ℶ': '\\beth', 'ℑ': '\\Im', 'ℜ': '\\Re', '℘': '\\wp', 'ℎ': 'h', 'ı': '\\imath',
    'ȷ': '\\jmath', 'ð': '\\eth', '…': '\\ldots', '⋯': '\\cdots', '⋮': '\\vdots', '⋱': '\\ddots',
    '′': "'", '″': "''", '‴': "'''", '∠': '\\angle', '∡': '\\measuredangle', '°': '^{\\circ}',
    '⟨': '\\langle', '⟩': '\\rangle', '〈': '\\langle', '〉': '\\rangle', '⌈': '\\lceil', '⌉': '\\rceil',
    '⌊': '\\lfloor', '⌋': '\\rfloor', '‖': '\\|', '∴': '\\therefore', '∵': '\\because', '□': '\\square',
    '■': '\\blacksquare', '∎': '\\blacksquare', '△': '\\triangle', '▽': '\\triangledown', '★': '\\bigstar',
    '♯': '\\sharp', '♭': '\\flat', '♮': '\\natural', '♠': '\\spadesuit', '♥': '\\heartsuit',
    '♦': '\\diamondsuit', '♣': '\\clubsuit', '✓': '\\checkmark',
    '−': '-', '∕': '/', '∶': ':',
    // Invisible / spacing characters
    '\u2061': '', '\u2062': '', '\u2063': '', '\u2064': '', '\u200b': '', '\u00a0': '~',
    '\u2009': '\\,', '\u2005': '\\;', '\u2004': '\\;', '\u2002': '\\enspace', '\u2003': '\\quad',
    // TeX special characters
    '{': '\\{', '}': '\\}', '#': '\\#', '%': '\\%', '&': '\\&', '$': '\\$', '_': '\\_',
    '\\': '\\backslash', '~': '\\sim',
  };

  const FUNCS = new Set([
    'sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh', 'coth',
    'log', 'ln', 'lg', 'exp', 'lim', 'limsup', 'liminf', 'max', 'min', 'sup', 'inf', 'det', 'dim', 'ker',
    'deg', 'arg', 'gcd', 'hom', 'Pr',
  ]);

  // Mathematical Alphanumeric Symbols (U+1D400 – U+1D6A3): 13 blocks of 52 letters
  const ALNUM_STYLES = ['mathbf', '', 'boldsymbol', 'mathcal', 'mathcal', 'mathfrak', 'mathbb', 'mathfrak',
    'mathsf', 'mathsf', 'mathsf', 'mathsf', 'mathtt'];

  const OVER = {
    '^': 'hat', 'ˆ': 'hat', '\u0302': 'hat', '~': 'tilde', '˜': 'tilde', '\u0303': 'tilde',
    '¯': 'bar', '‾': 'bar', '\u0304': 'bar', '\u0305': 'bar', '_': 'bar', '―': 'bar',
    '→': 'vec', '\u20d7': 'vec', '˙': 'dot', '\u0307': 'dot', '¨': 'ddot', '\u0308': 'ddot',
    'ˇ': 'check', '\u030c': 'check', '˘': 'breve', '\u0306': 'breve', '´': 'acute', '\u0301': 'acute',
    '`': 'grave', '\u0300': 'grave', '˚': 'mathring', '\u030a': 'mathring',
    '⏞': 'overbrace', '︷': 'overbrace', '←': 'overleftarrow', '↔': 'overleftrightarrow',
  };
  const WIDE = { hat: 'widehat', tilde: 'widetilde', bar: 'overline', vec: 'overrightarrow' };
  const UNDER = {
    '_': 'underline', '¯': 'underline', '‾': 'underline', '\u0332': 'underline', '―': 'underline',
    '⏟': 'underbrace', '︸': 'underbrace', '←': 'underleftarrow', '→': 'underrightarrow',
    '↔': 'underleftrightarrow',
  };
  const FENCE_ENV = { '()': 'pmatrix', '[]': 'bmatrix', '{}': 'Bmatrix', '||': 'vmatrix', '‖‖': 'Vmatrix', '∥∥': 'Vmatrix', '{': 'cases' };
  const LIMIT_RE = /^\\(sum|prod|coprod|bigcup|bigcap|bigoplus|bigotimes|bigodot|biguplus|bigvee|bigwedge|bigsqcup|int|iint|iiint|oint|lim|limsup|liminf|max|min|sup|inf|det|gcd|Pr|arg)$|^\\operatorname/;

  function charTex(ch) {
    if (Object.prototype.hasOwnProperty.call(SYM, ch)) return SYM[ch];
    const cp = ch.codePointAt(0);
    if (cp >= 0x1d400 && cp <= 0x1d6a3) {
      const style = ALNUM_STYLES[Math.floor((cp - 0x1d400) / 52)] || '';
      const base = ch.normalize('NFKC');
      return style ? `\\${style}{${base}}` : base;
    }
    if (cp >= 0x1d6a8 && cp <= 0x1d7ff) {
      const n = ch.normalize('NFKC');
      return Object.prototype.hasOwnProperty.call(SYM, n) ? SYM[n] : n;
    }
    return ch;
  }

  function join(parts) {
    let out = '';
    for (const p of parts) {
      if (!p) continue;
      if (/\\[A-Za-z]+$/.test(out) && /^[A-Za-z]/.test(p)) out += ' ';
      out += p;
    }
    return out;
  }

  const chars = (t) => join(Array.from(t).map(charTex));
  const isSingle = (s) => /^([A-Za-z0-9]|\\[A-Za-z]+)$/.test(s.trim());
  function grp(s) {
    s = s.trim();
    if (!s) return '{}';
    return isSingle(s) || /^\\math[a-z]+\{[^{}]*\}$/.test(s) ? s : `{${s}}`;
  }
  const seq = (k) => join(k.map(conv));
  const text = (n) => (n ? n.textContent.trim() : '');

  function texAnnotation(n) {
    for (const a of n.children) {
      if (a.localName !== 'annotation') continue;
      const enc = (a.getAttribute('encoding') || '').toLowerCase();
      if (enc === 'application/x-tex' || enc === 'tex' || enc === 'text/x-tex' || enc === 'latex') return a.textContent.trim();
    }
    return '';
  }

  function variant(s, v, single) {
    if (/^\\math[a-z]+\{/.test(s)) return s;
    switch (v) {
      case 'bold': return `\\mathbf{${s}}`;
      case 'bold-italic': return `\\boldsymbol{${s}}`;
      case 'double-struck': return `\\mathbb{${s}}`;
      case 'script': case 'bold-script': return `\\mathcal{${s}}`;
      case 'fraktur': case 'bold-fraktur': return `\\mathfrak{${s}}`;
      case 'sans-serif': case 'bold-sans-serif': case 'sans-serif-italic': case 'sans-serif-bold-italic': return `\\mathsf{${s}}`;
      case 'monospace': return `\\mathtt{${s}}`;
      case 'normal': return single && /^[A-Za-z]$/.test(s) ? `\\mathrm{${s}}` : s;
      default: return s;
    }
  }

  function mi(n) {
    const t = n.textContent.trim();
    if (!t) return '';
    const v = n.getAttribute('mathvariant');
    if (Array.from(t).length === 1) return variant(chars(t), v, true);
    if (FUNCS.has(t)) return '\\' + t;
    const body = chars(t);
    if (v && v !== 'normal' && v !== 'italic') return variant(body, v, false);
    return (n.getAttribute('data-mjx-texclass') === 'OP' ? '\\operatorname{' : '\\mathrm{') + body + '}';
  }

  function mo(n) {
    const t = n.textContent.trim();
    if (!t) return '';
    if (FUNCS.has(t)) return '\\' + t;
    if (/^[A-Za-z]{2,}$/.test(t)) return `\\operatorname{${t}}`;
    return chars(t);
  }

  function mtext(t) {
    if (!t.trim()) return t.length ? '\\ ' : '';
    const esc = t.replace(/\u00a0/g, ' ').replace(/[\\{}#$%&_^~]/g, (c) =>
      ({ '\\': '\\textbackslash{}', '^': '\\^{}', '~': '\\~{}' }[c] || '\\' + c));
    return `\\text{${esc}}`;
  }

  function mspace(n) {
    if (n.getAttribute('linebreak') === 'newline') return ' \\\\ ';
    const w = (n.getAttribute('width') || '').trim();
    const named = { veryverythinmathspace: 1 / 18, verythinmathspace: 2 / 18, thinmathspace: 3 / 18, mediummathspace: 4 / 18, thickmathspace: 5 / 18, verythickmathspace: 6 / 18, veryverythickmathspace: 7 / 18 };
    let em = 0;
    if (named[w] != null) em = named[w];
    else {
      const m = w.match(/^(-?[\d.]+)\s*(em|ex|px|pt|mu)?$/);
      if (m) {
        em = parseFloat(m[1]);
        em = { ex: em * 0.43, px: em / 16, pt: em / 10, mu: em / 18 }[m[2]] ?? em;
      }
    }
    if (em >= 1.9) return '\\qquad';
    if (em >= 0.9) return '\\quad';
    if (em >= 0.25) return '\\;';
    if (em >= 0.2) return '\\:';
    if (em > 0.1) return '\\,';
    if (em < -0.1) return '\\!';
    return '';
  }

  function isLimitsBase(node, tex) {
    if (LIMIT_RE.test(tex.trim())) return true;
    if (!node) return false;
    if (node.localName === 'mo' && (node.getAttribute('movablelimits') === 'true' || node.getAttribute('largeop') === 'true')) return true;
    if (node.localName === 'mrow' && node.children.length === 1) return isLimitsBase(node.children[0], tex);
    return false;
  }

  function script(b, sb, sp) {
    const bt = conv(b);
    const st = sb ? conv(sb) : '';
    const pt = sp ? conv(sp) : '';
    const brace = /^\\(overbrace|underbrace)/.test(bt);
    let out = brace ? bt : grp(bt);
    if (st) out += '_' + grp(st);
    if (pt) out += /^'+$/.test(pt) ? pt : '^' + grp(pt);
    return out;
  }

  function isZeroLine(f) {
    const lt = f.getAttribute('linethickness');
    return lt != null && /^0(\.0*)?([a-z%]*)$/i.test(lt.trim());
  }

  function mfrac(n, k) {
    const a = conv(k[0]);
    const b = conv(k[1]);
    if (isZeroLine(n)) return `\\genfrac{}{}{0pt}{}{${a}}{${b}}`;
    return `\\frac{${a}}{${b}}`;
  }

  function accentChild(c, table) {
    if (!c || c.localName !== 'mo') return undefined;
    return table[text(c)];
  }

  function mover(k) {
    const b = conv(k[0]);
    const acc = accentChild(k[1], OVER);
    if (acc) return `\\${!isSingle(b) && WIDE[acc] ? WIDE[acc] : acc}{${b}}`;
    const o = conv(k[1]);
    if (isLimitsBase(k[0], b) || /^\\(overbrace|underbrace)/.test(b)) return b + '^' + grp(o);
    return `\\overset{${o}}{${b}}`;
  }

  function munder(k) {
    const b = conv(k[0]);
    const acc = accentChild(k[1], UNDER);
    if (acc) return `\\${acc}{${b}}`;
    const u = conv(k[1]);
    if (isLimitsBase(k[0], b) || /^\\(overbrace|underbrace)/.test(b)) return b + '_' + grp(u);
    return `\\underset{${u}}{${b}}`;
  }

  function munderover(k) {
    const b = conv(k[0]);
    const u = conv(k[1]);
    const o = conv(k[2]);
    if (isLimitsBase(k[0], b) || !/[^\s]/.test(b) || Array.from(text(k[0])).length === 1) return `${b}_${grp(u)}^${grp(o)}`;
    return `\\overset{${o}}{\\underset{${u}}{${b}}}`;
  }

  function mtable(n, env) {
    const rows = Array.from(n.children)
      .filter((r) => r.localName === 'mtr' || r.localName === 'mlabeledtr')
      .map((r) => {
        let cells = Array.from(r.children).filter((c) => c.localName === 'mtd');
        if (r.localName === 'mlabeledtr') cells = cells.slice(1);
        return cells.map(conv).join(' & ');
      });
    if (!env) {
      const ca = (n.getAttribute('columnalign') || '').trim();
      env = /^right\s+left/.test(ca) ? 'aligned' : 'matrix';
    }
    return `\\begin{${env}} ${rows.join(' \\\\ ')} \\end{${env}}`;
  }

  function fenceTex(c) {
    if (!c) return '.';
    return charTex(c);
  }

  function isFence(el, cls) {
    if (!el || el.localName !== 'mo') return false;
    const tc = el.getAttribute('data-mjx-texclass');
    if (tc) return tc === cls;
    return el.getAttribute('fence') === 'true' && el.getAttribute('stretchy') !== 'false';
  }

  function mrow(k) {
    if (k.length >= 2) {
      const f = k[0];
      const l = k[k.length - 1];
      const open = isFence(f, 'OPEN');
      const close = isFence(l, 'CLOSE');
      if (open && close) {
        const o = text(f);
        const c = text(l);
        const inner = k.slice(1, -1);
        if (inner.length === 1) {
          const x = inner[0];
          if (x.localName === 'mtable' && FENCE_ENV[o + c]) return mtable(x, FENCE_ENV[o + c]);
          if (x.localName === 'mfrac' && o === '(' && c === ')' && isZeroLine(x)) {
            return `\\binom{${conv(x.children[0])}}{${conv(x.children[1])}}`;
          }
        }
        return join(['\\left' + fenceTex(o), ...inner.map(conv), '\\right' + fenceTex(c)]);
      }
      if (open && k.length === 2 && k[1].localName === 'mtable' && text(f) === '{') return mtable(k[1], 'cases');
    }
    return seq(k);
  }

  function mfenced(n, k) {
    const o = n.getAttribute('open') ?? '(';
    const c = n.getAttribute('close') ?? ')';
    const seps = (n.getAttribute('separators') ?? ',').replace(/\s+/g, '');
    if (k.length === 1 && k[0].localName === 'mtable' && FENCE_ENV[o + c]) return mtable(k[0], FENCE_ENV[o + c]);
    const parts = [];
    k.forEach((ch, i) => {
      if (i > 0 && seps) parts.push(charTex(seps[Math.min(i - 1, seps.length - 1)]));
      parts.push(conv(ch));
    });
    return join(['\\left' + fenceTex(o), ...parts, '\\right' + fenceTex(c)]);
  }

  function menclose(n, k) {
    const no = (n.getAttribute('notation') || 'longdiv').split(/\s+/);
    const inner = seq(k);
    if (no.includes('box') || no.includes('roundedbox')) return `\\boxed{${inner}}`;
    if (no.some((x) => /strike$/.test(x))) return `\\cancel{${inner}}`;
    if (no.includes('top')) return `\\overline{${inner}}`;
    if (no.includes('bottom')) return `\\underline{${inner}}`;
    return inner;
  }

  function mmulti(k) {
    const base = conv(k[0]);
    const pre = [];
    const post = [];
    let inPre = false;
    for (let i = 1; i < k.length;) {
      if (k[i].localName === 'mprescripts') { inPre = true; i++; continue; }
      (inPre ? pre : post).push([k[i], k[i + 1]]);
      i += 2;
    }
    const fmt = (pairs) => pairs.map(([a, b]) => {
      const A = a && a.localName !== 'none' ? conv(a) : '';
      const B = b && b.localName !== 'none' ? conv(b) : '';
      return (A ? '_' + grp(A) : '') + (B ? '^' + grp(B) : '');
    }).join('');
    return (pre.length ? '{}' + fmt(pre) : '') + grp(base) + fmt(post);
  }

  function conv(n) {
    if (!n || n.nodeType !== 1) return '';
    const tag = n.localName.replace(/^.*:/, '');
    const k = Array.from(n.children);
    switch (tag) {
      case 'math': case 'mstyle': case 'mpadded': case 'merror': case 'mtd':
        return seq(k);
      case 'mrow': return mrow(k);
      case 'semantics': return texAnnotation(n) || (k.length ? conv(k[0]) : '');
      case 'annotation': case 'annotation-xml': case 'none': case 'mprescripts': return '';
      case 'maction': return k.length ? conv(k[0]) : '';
      case 'mphantom': return `\\phantom{${seq(k)}}`;
      case 'mi': return mi(n);
      case 'mn': return chars(n.textContent.trim());
      case 'mo': return mo(n);
      case 'mtext': return mtext(n.textContent);
      case 'ms': return mtext('"' + n.textContent + '"');
      case 'mspace': return mspace(n);
      case 'msup': return script(k[0], null, k[1]);
      case 'msub': return script(k[0], k[1], null);
      case 'msubsup': return script(k[0], k[1], k[2]);
      case 'mfrac': return mfrac(n, k);
      case 'msqrt': return `\\sqrt{${seq(k)}}`;
      case 'mroot': return `\\sqrt[${conv(k[1])}]{${conv(k[0])}}`;
      case 'mover': return mover(k);
      case 'munder': return munder(k);
      case 'munderover': return munderover(k);
      case 'mtable': return mtable(n, null);
      case 'mtr': case 'mlabeledtr': return k.map(conv).join(' & ');
      case 'mfenced': return mfenced(n, k);
      case 'menclose': return menclose(n, k);
      case 'mmultiscripts': return mmulti(k);
      default: return seq(k);
    }
  }

  // 供 PDF 公式重建复用
  CCM.charTex = charTex;
  CCM.texJoin = join;
  CCM.texGroup = grp;
  CCM.texFuncs = FUNCS;

  CCM.mathmlToLatex = (math) => {
    try {
      return conv(math).replace(/\s+/g, ' ').trim();
    } catch (e) {
      console.warn('[marktex-copy] MathML → LaTeX 失败', e);
      return '';
    }
  };
})();
