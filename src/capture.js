(() => {
  const CCM = (globalThis.__CCM = globalThis.__CCM || {});
  if (CCM.capture) return;

  // 所有可能是“公式根节点”的元素（外层优先：遍历时先遇到外层，识别成功则不再进入内部）
  const ROOT_SEL = [
    '[data-tex]', '[data-latex]', '[data-formula]', '[data-math-tex]',
    '.math-inline[data-math]', '.math-block[data-math]',          // Gemini 等
    '.katex-display', '.katex', '.katex--inline', '.katex--display', // KaTeX / CSDN
    'mjx-container',                                                  // MathJax v3 / v4
    '.MathJax_Display', '.MathJax_SVG_Display', '[id^="MathJax-Element-"][id$="-Frame"]', // MathJax v2
    '.MathJax_Preview', 'script[type^="math/tex"]',
    '.mwe-math-element',                                              // Wikipedia
    'span.math.inline', 'span.math.display',                          // Pandoc
    'math',                                                           // 原生 MathML
    'img.tex', 'img.latex', 'img.math', 'img.equation', 'img[class*="mwe-math"]',
    'img[data-latex]', 'img[data-tex]', 'img[src*="latex" i]', 'img[src*="codecogs" i]',
    'img[src*="mathtex" i]', 'img[src*="/tex?" i]', 'img[src*="tex.cgi" i]', 'img[src*="/equation" i]',
  ].join(',');

  const FRAME_SEL = '[id^="MathJax-Element-"][id$="-Frame"]';
  const DISPLAY_SEL = [
    '.katex-display', '.katex--display', '.MathJax_Display', '.MathJax_SVG_Display',
    'mjx-container[display="true"]', 'math[display="block"]', '.math-block', 'span.math.display',
    '.mwe-math-fallback-image-display',
  ].join(',');
  const NO_EXPAND_SEL = '.MathJax_Preview, script';
  const STRONG_IMG_SEL = 'img.tex, img.latex, img.math, img.equation, img[data-latex], img[data-tex], img[class*="mwe-math"]';

  const SKIP_TAGS = new Set([
    'script', 'style', 'noscript', 'template', 'link', 'meta', 'button', 'select', 'textarea',
    'iframe', 'object', 'embed', 'canvas', 'svg', 'video', 'audio',
  ]);
  const FORMAT_WRAP = new Set([
    'pre', 'code', 'a', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'strike', 'sub', 'sup', 'mark',
    'kbd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote',
  ]);
  const TABLE_PARTS = new Set(['tr', 'tbody', 'thead', 'tfoot', 'table']);

  // ---------- 与页面主世界（main-world.js）通信，获取 MathJax v3 的 TeX 源码 ----------
  function queryMainWorld(el) {
    let out = '';
    const h = (e) => { out = typeof e.detail === 'string' ? e.detail : ''; };
    el.addEventListener('__ccm_tex_result', h);
    try {
      el.dispatchEvent(new CustomEvent('__ccm_query_tex', { bubbles: true, composed: true }));
    } catch (_) { /* ignore */ } finally {
      el.removeEventListener('__ccm_tex_result', h);
    }
    if (!out) return null;
    try { return JSON.parse(out); } catch (_) { return null; }
  }

  function cleanTex(t) {
    t = String(t == null ? '' : t).trim();
    let m = t.match(/^\{\\(?:displaystyle|textstyle)\s*([\s\S]*)\}$/); // Wikipedia alttext
    if (m) t = m[1].trim();
    m = t.match(/^\$\$([\s\S]+)\$\$$/) || t.match(/^\\\[([\s\S]+)\\\]$/) || t.match(/^\\\(([\s\S]+)\\\)$/) ||
      t.match(/^\$([^$]+)\$$/);
    if (m) t = m[1].trim();
    return t;
  }

  function isDisplay(el) {
    try {
      if (el.matches(DISPLAY_SEL) || el.closest('.katex-display, .MathJax_Display, mjx-container[display="true"]')) return true;
      if (el.querySelector(DISPLAY_SEL)) return true;
      if (el.localName === 'img' || el.localName === 'math') return false;
      const d = getComputedStyle(el).display;
      return d === 'block' || d === 'flex' || d === 'table';
    } catch (_) {
      return false;
    }
  }

  const make = (tex, display, mathEl) => {
    const t = cleanTex(tex);
    if (!t) return null;
    return { tex: t, display: !!display, mathEl: mathEl || null };
  };

  function fromMathML(m, display) {
    if (!m) return null;
    let tex = '';
    for (const a of m.querySelectorAll('annotation')) {
      const enc = (a.getAttribute('encoding') || '').toLowerCase();
      if (/^(application\/x-tex|tex|text\/x-tex|latex)$/.test(enc)) { tex = a.textContent; break; }
    }
    if (!tex) tex = m.getAttribute('alttext') || '';
    if (!tex && CCM.mathmlToLatex) tex = CCM.mathmlToLatex(m);
    return make(tex, display || m.getAttribute('display') === 'block', m);
  }

  // 从一个公式根节点提取 { tex, display, mathEl }；{ remove:true } 表示丢弃该节点
  function extractMath(el) {
    const tag = el.localName;
    if (el.matches('.MathJax_Preview')) return { remove: true };
    if (tag === 'script') {
      if (el.id && document.getElementById(el.id + '-Frame')) return { remove: true };
      return make(el.textContent, /mode\s*=\s*display/i.test(el.type), null);
    }

    const display = isDisplay(el);

    const attr = el.getAttribute('data-tex') ?? el.getAttribute('data-latex') ?? el.getAttribute('data-formula') ??
      el.getAttribute('data-math-tex') ?? el.getAttribute('data-math');
    if (attr && attr.trim()) {
      let tex = attr;
      let disp = display;
      // 知乎：块级公式的 data-tex 以 "\\" 结尾
      if (el.classList.contains('ztext-math') && /\\\\\s*$/.test(tex)) {
        disp = true;
        tex = tex.replace(/\\\\\s*$/, '');
      }
      return make(tex, disp, el.querySelector('math'));
    }

    // MathJax v3 / v4
    const mjx = tag === 'mjx-container' ? el : el.querySelector('mjx-container');
    if (mjx) {
      const m = mjx.querySelector('math');
      const r = queryMainWorld(mjx);
      const disp = display || mjx.getAttribute('display') === 'true';
      if (r && r.tex) return make(r.tex, disp || !!r.display, m);
      return m ? fromMathML(m, disp) : null;
    }

    // MathJax v2：渲染节点 id="MathJax-Element-N-Frame"，TeX 源码在 <script id="MathJax-Element-N">
    const frame = el.matches(FRAME_SEL) ? el : el.querySelector(FRAME_SEL);
    if (frame) {
      const script = document.getElementById(frame.id.replace(/-Frame$/, ''));
      const m = frame.querySelector('math');
      if (script && /^math\/tex/i.test(script.type)) {
        return make(script.textContent, display || /mode\s*=\s*display/i.test(script.type), m);
      }
      const r = queryMainWorld(frame);
      if (r && r.tex) return make(r.tex, display || !!r.display, m);
      return m ? fromMathML(m, display) : null;
    }

    // KaTeX
    const katex = el.classList.contains('katex') ? el : el.querySelector('.katex');
    if (katex) {
      const ann = katex.querySelector('annotation[encoding="application/x-tex"]');
      const m = katex.querySelector('math');
      if (ann) return make(ann.textContent, display, m);
      if (m) return fromMathML(m, display);
      // 只输出了 HTML（如洛谷）：按排版结构反推
      return CCM.katexHtmlToLatex ? make(CCM.katexHtmlToLatex(katex), display, null) : null;
    }

    // Wikipedia
    if (el.classList.contains('mwe-math-element')) {
      const m = el.querySelector('math');
      const img = el.querySelector('img');
      const tex = (m && m.getAttribute('alttext')) || (img && img.getAttribute('alt'));
      if (tex) return make(tex, display || (m && m.getAttribute('display') === 'block'), m);
    }

    if (tag === 'img') {
      const alt = el.getAttribute('data-latex') || el.getAttribute('data-tex') || el.getAttribute('alt') || el.getAttribute('title');
      if (!alt || !alt.trim()) return null;
      if (!el.matches(STRONG_IMG_SEL) && !/[\\^_{}=]/.test(alt)) return null;
      return make(alt, el.classList.contains('mwe-math-fallback-image-display'), null);
    }

    const m = tag === 'math' ? el : el.querySelector('math');
    if (m) return fromMathML(m, display);

    // Pandoc 未渲染的原始公式：<span class="math inline">\(x\)</span>
    if (el.matches('span.math.inline, span.math.display')) {
      return make(el.textContent, el.classList.contains('display'), null);
    }
    return null;
  }

  function outermostRoot(node) {
    let el = node && (node.nodeType === 1 ? node : node.parentElement);
    let found = null;
    while (el) {
      try {
        if (el.matches(ROOT_SEL) && !el.matches(NO_EXPAND_SEL)) found = el;
      } catch (_) { /* ignore */ }
      el = el.parentElement;
    }
    return found;
  }

  function isVisible(el) {
    if (typeof el.checkVisibility !== 'function') return true;
    if (el.checkVisibility({ visibilityProperty: true })) return true;
    const tag = el.localName;
    if (tag === 'br' || tag === 'wbr' || tag === 'col' || tag === 'colgroup') return true;
    try {
      const cs = getComputedStyle(el);
      if (cs.display === 'contents') return true;
    } catch (_) { /* ignore */ }
    return false;
  }

  function fixup(live, clone) {
    const tag = live.localName;
    if (tag === 'a' && live.hasAttribute('href')) {
      clone.setAttribute('href', live.href);
    } else if (tag === 'img') {
      const lazy = live.getAttribute('data-src') || live.getAttribute('data-original') ||
        live.getAttribute('data-lazy-src') || live.getAttribute('data-actualsrc');
      let src = live.currentSrc || live.src;
      if (lazy && (!src || src.startsWith('data:'))) {
        try { src = new URL(lazy, location.href).href; } catch (_) { /* ignore */ }
      }
      if (src) clone.setAttribute('src', src);
      clone.removeAttribute('srcset');
    } else if (tag === 'input' && live.type === 'checkbox') {
      if (live.checked) clone.setAttribute('checked', '');
      else clone.removeAttribute('checked');
    }
  }

  // ---------- 把“用 CSS 实现的”标题 / 粗体 / 斜体 / 删除线还原为语义标签 ----------
  const BOLD_TAGS = new Set(['b', 'strong', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'th']);
  const ITALIC_TAGS = new Set(['i', 'em', 'cite', 'dfn', 'var']);
  const STRIKE_TAGS = new Set(['s', 'del', 'strike']);
  const NO_STYLE_TAGS = new Set(['pre', 'code', 'kbd', 'samp', 'tt', 'a', 'img', 'br', 'hr', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'ul', 'ol', 'ccm-math']);
  const BLOCK_CHILD_SEL = 'p,div,li,ul,ol,h1,h2,h3,h4,h5,h6,table,pre,blockquote,section,article,figure,dl';
  const HEADING_CLASS_RE = /(?:^|\s)(?:heading-h|heading-|header-h|title-h)([1-6])(?:\s|$)/i;

  function headingLevel(el) {
    if (/^h[1-6]$/.test(el.localName)) return 0;
    if (el.getAttribute('role') === 'heading') {
      const lv = parseInt(el.getAttribute('aria-level'), 10);
      return lv >= 1 && lv <= 6 ? lv : 2;
    }
    const m = (el.getAttribute('class') || '').match(HEADING_CLASS_RE);
    return m ? +m[1] : 0;
  }

  function styleFlags(el) {
    const tag = el.localName;
    const f = {
      bold: BOLD_TAGS.has(tag), italic: ITALIC_TAGS.has(tag), strike: STRIKE_TAGS.has(tag),
      css: { bold: false, italic: false, strike: false },
    };
    if (NO_STYLE_TAGS.has(tag)) return f;
    let cs;
    try { cs = getComputedStyle(el); } catch (_) { return f; }
    const w = parseInt(cs.fontWeight, 10) || (cs.fontWeight === 'bold' ? 700 : 400);
    // 着重号（text-emphasis，字下的小圆点）按加粗处理
    const emph = cs.textEmphasisStyle || cs.webkitTextEmphasisStyle || 'none';
    const dots = emph !== 'none' && emph !== '';
    f.css.bold = w >= 600 || dots;
    if (dots && cs.fontStyle === 'normal') f.italic = false; // 用 <em> 实现的着重号不是斜体
    f.css.italic = cs.fontStyle === 'italic' || cs.fontStyle.startsWith('oblique');
    f.css.strike = (cs.textDecorationLine || cs.textDecoration || '').includes('line-through');
    return f;
  }

  function shell(live) {
    const lv = headingLevel(live);
    if (lv) return document.createElement('h' + lv);
    // 用 <em> 实现的着重号（不倾斜、字下加点）：不当作斜体，之后按加粗处理
    if (ITALIC_TAGS.has(live.localName)) {
      try {
        const cs = getComputedStyle(live);
        const emph = cs.textEmphasisStyle || cs.webkitTextEmphasisStyle || 'none';
        if (emph !== 'none' && cs.fontStyle === 'normal') return document.createElement('span');
      } catch (_) { /* ignore */ }
    }
    // 自定义元素（含连字符）不直接 cloneNode，避免触发页面的组件构造函数
    if (live.localName.includes('-')) {
      let block = false;
      try { block = /^(block|flex|grid|table|list-item)$/.test(getComputedStyle(live).display); } catch (_) { /* ignore */ }
      return document.createElement(block ? 'div' : 'span');
    }
    const c = live.cloneNode(false);
    fixup(live, c);
    return c;
  }

  // 按 Range 复制 DOM，过程中把公式替换成 <ccm-math data-id>，丢弃隐藏元素
  // fmt：当前已经输出的格式（祖先已有 <strong> 时，子元素不再重复包裹）
  function applyStyles(node, c, fmt) {
    const f = styleFlags(node);
    const next = {
      bold: fmt.bold || f.bold || /^h[1-6]$/.test(c.localName),
      italic: fmt.italic || f.italic,
      strike: fmt.strike || f.strike,
    };
    let inner = c;
    const want = [
      ['bold', 'strong'], ['italic', 'em'], ['strike', 'del'],
    ].filter(([k]) => f.css[k] && !next[k]);
    // 含块级子元素时不在外层包裹（否则会产生跨段落的强调），交给子元素各自判断
    if (want.length && !node.querySelector(BLOCK_CHILD_SEL)) {
      for (const [k, tag] of want) {
        const w = document.createElement(tag);
        inner.appendChild(w);
        inner = w;
        next[k] = true;
      }
    }
    return { inner, next };
  }

  function cloneRange(range, infos, baseFmt) {
    const frag = document.createDocumentFragment();
    const sc = range.startContainer;
    const so = range.startOffset;
    const ec = range.endContainer;
    const eo = range.endOffset;
    const isText = (n) => n.nodeType === 3 || n.nodeType === 4;

    const visit = (node, parent, fmt) => {
      if (isText(node)) {
        const t = node.nodeValue.slice(node === sc ? so : 0, node === ec ? eo : undefined);
        if (t) parent.appendChild(document.createTextNode(t));
        return;
      }
      if (node.nodeType !== 1) return;
      const tag = node.localName;

      let isRoot = false;
      try { isRoot = node.matches(ROOT_SEL); } catch (_) { /* ignore */ }
      if (isRoot) {
        const info = extractMath(node);
        if (info && info.remove) return;
        if (info) {
          const id = String(infos.size);
          infos.set(id, info);
          const ph = document.createElement('ccm-math');
          ph.setAttribute('data-id', id);
          parent.appendChild(ph);
          return;
        }
      }
      if (SKIP_TAGS.has(tag)) return;
      if (tag === 'input' && node.type !== 'checkbox') return;
      if (!isVisible(node)) return;

      const c = shell(node);
      parent.appendChild(c);
      const { inner, next } = applyStyles(node, c, fmt);
      for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
        if (range.intersectsNode(ch)) visit(ch, inner, next);
      }
    };

    const ca = range.commonAncestorContainer;
    if (isText(ca)) visit(ca, frag, baseFmt);
    else for (let ch = ca.firstChild; ch; ch = ch.nextSibling) if (range.intersectsNode(ch)) visit(ch, frag, baseFmt);
    return frag;
  }

  // 选区的公共祖先本身带有 CSS 粗体/斜体时（例如只选中了一个加粗 span 里的几个字）
  function baseFormat(caEl) {
    const fmt = { bold: false, italic: false, strike: false };
    for (let el = caEl; el; el = el.parentElement) {
      const t = el.localName;
      if (BOLD_TAGS.has(t) || headingLevel(el)) fmt.bold = true;
      if (ITALIC_TAGS.has(t)) fmt.italic = true;
      if (STRIKE_TAGS.has(t)) fmt.strike = true;
    }
    const css = caEl ? styleFlags(caEl).css : {};
    const wrap = [];
    if (css.bold && !fmt.bold) wrap.push('strong');
    if (css.italic && !fmt.italic) wrap.push('em');
    if (css.strike && !fmt.strike) wrap.push('del');
    return {
      fmt: { bold: fmt.bold || !!css.bold, italic: fmt.italic || !!css.italic, strike: fmt.strike || !!css.strike },
      wrap,
    };
  }

  function wrapFragment(frag, tags) {
    if (!tags.length || frag.querySelector(BLOCK_CHILD_SEL)) return frag;
    let outer = null;
    let inner = null;
    for (const t of tags) {
      const el = document.createElement(t);
      if (inner) inner.appendChild(el); else outer = el;
      inner = el;
    }
    while (frag.firstChild) inner.appendChild(frag.firstChild);
    frag.appendChild(outer);
    return frag;
  }

  // 选区完全落在 <pre>/<code>/<a>/<h1>/表格行 等内部时，补上这些祖先，保证格式不丢
  function wrapAncestors(frag, caEl) {
    let out = frag;
    let el = caEl;
    let first = true;
    let inTable = false;
    while (el && el !== document.body && el !== document.documentElement) {
      const t = el.localName;
      let wrap = false;
      const lv = headingLevel(el);
      if (lv) {
        const h = document.createElement('h' + lv);
        h.appendChild(out);
        out = h;
      } else if (FORMAT_WRAP.has(t)) wrap = true;
      else if (first && (t === 'ul' || t === 'ol')) wrap = true;
      else if ((first || inTable) && TABLE_PARTS.has(t)) {
        wrap = true;
        inTable = t !== 'table';
      }
      if (wrap) {
        const c = el.cloneNode(false);
        fixup(el, c);
        c.appendChild(out);
        out = c;
      }
      first = false;
      el = el.parentElement;
    }
    if (out === frag) return frag;
    const f = document.createDocumentFragment();
    f.appendChild(out);
    return f;
  }

  CCM.capture = function capture(srcRange) {
    const range = srcRange.cloneRange();
    const s = outermostRoot(range.startContainer);
    if (s) range.setStartBefore(s);
    const e = outermostRoot(range.endContainer);
    if (e) range.setEndAfter(e);

    const infos = new Map();
    const ca = range.commonAncestorContainer;
    const caEl = ca.nodeType === 1 ? ca : ca.parentElement;
    const base = baseFormat(caEl);
    let fragment = cloneRange(range, infos, base.fmt);
    fragment = wrapFragment(fragment, base.wrap);
    fragment = wrapAncestors(fragment, caEl);
    return { fragment, infos };
  };

  // 右键“复制此处公式”：从点击位置向上找公式
  CCM.formulaAt = function formulaAt(node) {
    const root = outermostRoot(node);
    if (!root) return null;
    const info = extractMath(root);
    return info && !info.remove ? info : null;
  };

  CCM.extractMath = extractMath;
})();
