(() => {
  const CCM = (globalThis.__CCM = globalThis.__CCM || {});
  if (CCM.toHtml) return;

  const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
  const DROP = new Set(['script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'object', 'embed', 'button', 'select', 'textarea', 'link', 'meta']);
  const UNWRAP = new Set(['span', 'font']);
  const ATTRS = {
    a: ['href', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    td: ['colspan', 'rowspan', 'align'],
    th: ['colspan', 'rowspan', 'align', 'scope'],
    ol: ['start', 'type', 'reversed'],
    li: ['value'],
    input: ['type', 'checked', 'disabled'],
    col: ['span'],
    colgroup: ['span'],
    abbr: ['title'],
    time: ['datetime'],
    blockquote: ['cite'],
    q: ['cite'],
    details: ['open'],
  };

  function sanitize(root) {
    for (const el of Array.from(root.querySelectorAll('*'))) {
      if (el.namespaceURI === MATHML_NS) continue;
      const tag = el.localName;
      if (tag === 'ccm-math') continue;
      if (DROP.has(tag) || (tag === 'input' && el.getAttribute('type') !== 'checkbox')) {
        el.remove();
        continue;
      }
      const keep = ATTRS[tag] || [];
      for (const a of Array.from(el.attributes)) {
        if (keep.includes(a.name)) continue;
        if ((tag === 'code' || tag === 'pre') && a.name === 'class') {
          const m = a.value.match(/(?:^|\s)(language-[\w+#.-]+)/);
          if (m) { el.setAttribute('class', m[1]); continue; }
        }
        el.removeAttribute(a.name);
      }
      if (tag === 'a' && /^\s*javascript:/i.test(el.getAttribute('href') || '')) el.removeAttribute('href');
      if (UNWRAP.has(tag)) el.replaceWith(...el.childNodes);
    }
  }

  function ensureAnnotation(m, tex) {
    if (!tex || m.querySelector('annotation')) return;
    const sem = document.createElementNS(MATHML_NS, 'semantics');
    const row = document.createElementNS(MATHML_NS, 'mrow');
    while (m.firstChild) row.appendChild(m.firstChild);
    const ann = document.createElementNS(MATHML_NS, 'annotation');
    ann.setAttribute('encoding', 'application/x-tex');
    ann.textContent = tex;
    sem.append(row, ann);
    m.appendChild(sem);
  }

  function renderMath(info, settings) {
    if (settings.htmlMath === 'mathml' && info.mathEl && info.mathEl.namespaceURI === MATHML_NS) {
      const m = info.mathEl.cloneNode(true);
      for (const el of [m, ...m.querySelectorAll('*')]) {
        for (const a of Array.from(el.attributes)) {
          if (a.name === 'class' || a.name === 'style' || a.name === 'id' || a.name.startsWith('data-') || a.name === 'unselectable') el.removeAttribute(a.name);
        }
      }
      m.setAttribute('xmlns', MATHML_NS);
      if (info.display) m.setAttribute('display', 'block');
      else m.removeAttribute('display');
      ensureAnnotation(m, info.tex);
      return m;
    }
    const d = CCM.delims(settings);
    const tex = info.tex.trim();
    if (info.display) {
      const div = document.createElement('div');
      div.className = 'math math-display';
      div.textContent = `${d.display[0]}${tex}${d.display[1]}`;
      return div;
    }
    const span = document.createElement('span');
    span.className = 'math math-inline';
    span.textContent = `${d.inline[0]}${tex}${d.inline[1]}`;
    return span;
  }

  CCM.toHtml = function toHtml(fragment, infos, settings) {
    const root = document.createElement('div');
    root.appendChild(fragment.cloneNode(true));
    sanitize(root);
    for (const ph of Array.from(root.querySelectorAll('ccm-math'))) {
      const info = infos.get(ph.getAttribute('data-id'));
      if (info) ph.replaceWith(renderMath(info, settings));
      else ph.remove();
    }
    return root.innerHTML.trim();
  };
})();
