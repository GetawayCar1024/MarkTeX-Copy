(() => {
  const CCM = (globalThis.__CCM = globalThis.__CCM || {});
  if (CCM.toMarkdown) return;

  const BLOCK = new Set([
    'address', 'article', 'aside', 'center', 'details', 'dialog', 'dir', 'div', 'dl', 'fieldset',
    'figcaption', 'figure', 'footer', 'form', 'header', 'hgroup', 'main', 'menu', 'nav', 'p',
    'section', 'summary', 'legend', 'caption', 'dt', 'dd',
  ]);
  const LINE_NUM_RE = /(^|\s)(line-?numbers?(-rows)?|linenos?|lineno|gutter|hljs-ln-numbers|code-line-number|react-syntax-highlighter-line-number)(\s|$)/i;
  const BR = '\u0002';
  const PRE = '\u0000';

  const blk = (s) => '\n\n' + s.trim().replace(/\n (?=\S)/g, '\n') + '\n\n';
  const indent = (s, pad) => s.split('\n').map((l, i) => (i === 0 || !l ? l : pad + l)).join('\n');
  const encUrl = (u) => u.replace(/[ ()<>]/g, (c) => ({ ' ': '%20', '(': '%28', ')': '%29', '<': '%3C', '>': '%3E' }[c]));

  // 注意：不能把 [ ] 转义成 \[ \]，很多环境（Typora / Obsidian / MathJax）会把 \[ … \] 当成块级公式。
  // 方括号只有在会被解析成链接语法（[x](…) / [x][…] / [x]:）时才处理，且改用 HTML 实体。
  function esc(t, st) {
    if (!st.s.escapeMarkdown) return t;
    t = t.replace(/\\/g, '\\\\')
      .replace(/([*`])/g, '\\$1')
      .replace(/(?<![A-Za-z0-9])_|_(?![A-Za-z0-9])/g, '\\_')
      .replace(/<(?=[A-Za-z/!?])/g, '&lt;')
      .replace(/\[([^\]\n]*)\](?=[([:])/g, '&#91;$1&#93;')
      .replace(/!(?=\[)/g, '&#33;');
    if (st.s.inlineDelim !== 'paren') t = t.replace(/\$/g, '\\$');
    return t;
  }

  // 链接文字 / 图片 alt 内部的方括号一律用 HTML 实体：
  // [\[1\]](…) 中的 \[ \] 会被部分环境当作公式，[[1]](…) 在 Obsidian 里又会变成双链，都无法正常显示为链接
  const escLabel = (t) => t.replace(/\[/g, '&#91;').replace(/\]/g, '&#93;');

  // 强调标记先用占位符，最后按 CommonMark 的 flanking 规则决定输出 ** 还是 <strong>。
  // 典型问题：中文里 “**结论：**内容” 的结束 ** 前是标点、后是汉字，按规范不会被识别为粗体。
  const EMPH_OPEN = '\u0003';
  const EMPH_CLOSE = '\u0004';
  function wrap(content, mark, st) {
    const m = content.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!m[2] || /\n\n/.test(m[2])) return content;
    const id = st.emph.push(mark) - 1;
    return `${m[1]}${EMPH_OPEN}${id}${EMPH_OPEN}${m[2]}${EMPH_CLOSE}${id}${EMPH_CLOSE}${m[3]}`;
  }

  const EMPH_TAG = { '**': 'strong', '*': 'em', '~~': 'del' };
  function resolveEmphasis(md, st) {
    const re = new RegExp(`${EMPH_OPEN}(\\d+)${EMPH_OPEN}|${EMPH_CLOSE}(\\d+)${EMPH_CLOSE}`, 'g');
    const pos = {};
    let m;
    while ((m = re.exec(md))) {
      const id = m[1] ?? m[2];
      const p = (pos[id] = pos[id] || {});
      if (m[1] != null) { p.os = m.index; p.oe = m.index + m[0].length; } else { p.cs = m.index; p.ce = m.index + m[0].length; }
    }
    const ws = (c) => !c || /\s/.test(c);
    const punct = (c) => !!c && new RegExp(`[\\p{P}\\p{S}${EMPH_OPEN}${EMPH_CLOSE}]`, 'u').test(c);
    const ok = {};
    for (const [id, p] of Object.entries(pos)) {
      if (p.os == null || p.cs == null) { ok[id] = false; continue; }
      const before = md[p.os - 1];
      const first = md[p.oe];
      const last = md[p.cs - 1];
      const after = md[p.ce];
      const leftFlanking = !ws(first) && (!punct(first) || ws(before) || punct(before));
      const rightFlanking = !ws(last) && (!punct(last) || ws(after) || punct(after));
      ok[id] = leftFlanking && rightFlanking;
    }
    return md.replace(re, (_, o, c) => {
      const id = o ?? c;
      const mark = st.emph[id];
      if (ok[id]) return mark;
      return o != null ? `<${EMPH_TAG[mark]}>` : `</${EMPH_TAG[mark]}>`;
    });
  }

  function inlineCode(t) {
    t = t.replace(/\n/g, ' ');
    if (!t.trim()) return t;
    const runs = t.match(/`+/g);
    const fence = '`'.repeat(runs ? Math.max(...runs.map((r) => r.length)) + 1 : 1);
    const pad = t.startsWith('`') || t.endsWith('`') ? ' ' : '';
    return fence + pad + t + pad + fence;
  }

  function rawText(node, st) {
    let out = '';
    const walk = (n) => {
      if (n.nodeType === 3) { out += n.nodeValue; return; }
      if (n.nodeType !== 1 && n.nodeType !== 11) return;
      const tag = n.localName;
      if (tag === 'br') { out += '\n'; return; }
      if (tag === 'ccm-math') {
        const info = st.infos.get(n.getAttribute('data-id'));
        out += info ? info.tex : '';
        return;
      }
      if (n.nodeType === 1 && LINE_NUM_RE.test(n.getAttribute('class') || '')) return;
      const line = n.nodeType === 1 && (tag === 'div' || tag === 'p' || tag === 'li' || tag === 'tr');
      if (line && out && !out.endsWith('\n')) out += '\n';
      for (const c of n.childNodes) walk(c);
      if (line && out && !out.endsWith('\n')) out += '\n';
    };
    walk(node);
    return out;
  }

  function langOf(el) {
    if (!el || el.nodeType !== 1) return '';
    const d = el.getAttribute('data-lang') || el.getAttribute('data-language');
    if (d && /^[\w+#.-]+$/.test(d)) return d.toLowerCase();
    const m = (el.getAttribute('class') || '').match(/(?:^|\s)(?:language-|lang-|highlight-source-|brush:\s*)([\w+#.-]+)/);
    return m ? m[1].toLowerCase() : '';
  }

  const kids = (node, ctx) => {
    let out = '';
    for (const c of node.childNodes) out += conv(c, ctx);
    return out;
  };

  function math(node, ctx) {
    const st = ctx.st;
    const info = st.infos.get(node.getAttribute('data-id'));
    if (!info) return '';
    let tex = info.tex.trim();
    if (!tex) return '';
    const [io, ic] = st.delims.inline;
    const [dO, dC] = st.delims.display;
    if (info.display && !ctx.inline && !ctx.table) {
      tex = tex.replace(/\n\s*\n/g, '\n');
      return `\n\n${dO}\n${tex}\n${dC}\n\n`;
    }
    tex = tex.replace(/\s*\n\s*/g, ' ');
    return info.display ? `${dO}${tex}${dC}` : `${io}${tex}${ic}`;
  }

  function pre(node, ctx) {
    const codes = node.querySelectorAll('code');
    const src = codes.length === 1 ? codes[0] : node;
    const lang = langOf(codes[0]) || langOf(node) || langOf(node.parentElement) ||
      langOf(node.parentElement && node.parentElement.parentElement);
    const text = rawText(src, ctx.st).replace(/\n+$/, '');
    if (ctx.table || ctx.inline) return inlineCode(text);
    const runs = text.match(/`{3,}/g);
    const fence = '`'.repeat(runs ? Math.max(...runs.map((r) => r.length)) + 1 : 3);
    ctx.st.pres.push(fence + lang + '\n' + text + '\n' + fence);
    return `\n\n${PRE}${ctx.st.pres.length - 1}${PRE}\n\n`;
  }

  function link(node, ctx) {
    const href = node.getAttribute('href');
    const content = kids(node, { ...ctx, inline: true, inLink: true }).replace(new RegExp(BR, 'g'), '').replace(/\s*\n\s*/g, ' ').trim();
    if (!href || /^javascript:/i.test(href)) return content;
    if (!content) return '';
    if (content === href || content === esc(href, ctx.st)) return `<${href}>`;
    const title = node.getAttribute('title');
    return `[${content}](${encUrl(href)}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
  }

  function image(node) {
    const src = node.getAttribute('src');
    if (!src) return '';
    const alt = escLabel((node.getAttribute('alt') || '').replace(/\s+/g, ' '));
    const title = node.getAttribute('title');
    return `![${alt}](${encUrl(src)}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
  }

  function liContent(li, ctx) {
    return kids(li, { ...ctx, inline: false })
      .replace(/^\s+|\s+$/g, '')
      .replace(/\n (?=\S)/g, '\n')
      .replace(/\n{2,}/g, '\n');
  }

  function list(node, ctx) {
    if (ctx.inline) return ' ' + kids(node, ctx) + ' ';
    const ordered = node.localName === 'ol';
    let n = parseInt(node.getAttribute('start'), 10);
    if (isNaN(n)) n = 1;
    const out = [];
    let lastPad = '  ';
    for (const ch of node.childNodes) {
      if (ch.nodeType === 1 && ch.localName === 'li') {
        const v = parseInt(ch.getAttribute('value'), 10);
        if (!isNaN(v)) n = v;
        const marker = ordered ? `${n++}. ` : '- ';
        lastPad = ' '.repeat(marker.length);
        out.push(marker + indent(liContent(ch, ctx), lastPad));
      } else if (ch.nodeType === 1 && (ch.localName === 'ul' || ch.localName === 'ol')) {
        const sub = list(ch, ctx).trim();
        if (!sub) continue;
        if (out.length) out[out.length - 1] += '\n' + lastPad + indent(sub, lastPad);
        else out.push(sub);
      } else {
        const c = conv(ch, ctx).trim();
        if (!c) continue;
        if (out.length) out[out.length - 1] += ' ' + c;
        else out.push('- ' + c);
      }
    }
    if (!out.length) return '';
    if (ctx.table) return '\n' + out.join('\n') + '\n';
    return blk(out.join('\n'));
  }

  function quote(node, ctx) {
    if (ctx.inline || ctx.table) return kids(node, ctx);
    const c = kids(node, ctx).trim().replace(/\n (?=\S)/g, '\n').replace(/\n{3,}/g, '\n\n');
    if (!c) return '';
    return blk(c.split('\n').map((l) => (l ? '> ' + l : '>')).join('\n'));
  }

  function cellMd(cell, ctx) {
    return kids(cell, { ...ctx, table: true })
      .replace(new RegExp(BR, 'g'), '')
      .trim()
      .replace(/\s*\n+\s*/g, '<br>')
      .replace(/\|/g, '\\|');
  }

  function table(node, ctx) {
    if (ctx.table || ctx.inline) return ' ' + kids(node, { ...ctx, table: true }) + ' ';
    const rows = node.localName === 'tr' ? [node] : Array.from(node.querySelectorAll('tr')).filter((tr) => {
      for (let p = tr.parentElement; p && p !== node; p = p.parentElement) if (p.localName === 'table') return false;
      return true;
    });
    const matrix = rows.map((tr) => {
      const r = [];
      for (const cell of tr.children) {
        if (cell.localName !== 'td' && cell.localName !== 'th') continue;
        r.push(cellMd(cell, ctx));
        const span = parseInt(cell.getAttribute('colspan'), 10) || 1;
        for (let i = 1; i < span; i++) r.push('');
      }
      return r;
    }).filter((r) => r.length);
    if (!matrix.length) return kids(node, ctx);
    const cols = Math.max(...matrix.map((r) => r.length));
    for (const r of matrix) while (r.length < cols) r.push('');
    const line = (r) => '| ' + r.join(' | ') + ' |';
    let out = [line(matrix[0]), '|' + ' --- |'.repeat(cols), ...matrix.slice(1).map(line)].join('\n');
    const caption = node.localName === 'table' ? node.querySelector(':scope > caption') : null;
    if (caption) {
      const c = cellMd(caption, ctx);
      if (c) out = c + '\n\n' + out;
    }
    return blk(out);
  }

  function conv(node, ctx) {
    if (node.nodeType === 3 || node.nodeType === 4) {
      const t = esc(node.nodeValue.replace(/\s+/g, ' '), ctx.st);
      return ctx.inLink ? escLabel(t) : t;
    }
    if (node.nodeType === 11) return kids(node, ctx);
    if (node.nodeType !== 1) return '';
    const tag = node.localName;
    switch (tag) {
      case 'ccm-math': return math(node, ctx);
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const t = kids(node, { ...ctx, inline: true }).replace(new RegExp(BR, 'g'), ' ').replace(/\s+/g, ' ').trim();
        if (!t) return '';
        if (ctx.inline || ctx.table) return ' ' + t + ' ';
        return blk('#'.repeat(+tag[1]) + ' ' + t);
      }
      case 'br': return ctx.table ? '<br>' : ctx.inline ? ' ' : BR + '\n';
      case 'hr': return ctx.inline || ctx.table ? ' ' : blk('---');
      case 'strong': case 'b': return wrap(kids(node, ctx), '**', ctx.st);
      case 'em': case 'i': case 'cite': case 'dfn': case 'var': return wrap(kids(node, ctx), '*', ctx.st);
      case 'del': case 's': case 'strike': return wrap(kids(node, ctx), '~~', ctx.st);
      case 'code': case 'samp': case 'tt': return inlineCode(rawText(node, ctx.st));
      case 'kbd': return `<kbd>${rawText(node, ctx.st)}</kbd>`;
      case 'sub': case 'sup': return `<${tag}>${kids(node, ctx)}</${tag}>`;
      case 'pre': return pre(node, ctx);
      case 'a': return link(node, ctx);
      case 'img': return image(node);
      case 'ul': case 'ol': return list(node, ctx);
      case 'li': return ctx.inline || ctx.table ? kids(node, ctx) : blk('- ' + indent(liContent(node, ctx), '  '));
      case 'blockquote': return quote(node, ctx);
      case 'table': case 'thead': case 'tbody': case 'tfoot': case 'tr': return table(node, ctx);
      case 'input': return node.getAttribute('type') === 'checkbox' ? (node.hasAttribute('checked') ? '[x] ' : '[ ] ') : '';
      case 'dt': case 'summary': {
        if (ctx.inline || ctx.table) return kids(node, ctx);
        return blk(wrap(kids(node, ctx).trim(), '**', ctx.st));
      }
      default: {
        if (!BLOCK.has(tag)) return kids(node, ctx);
        if (ctx.inline) return ' ' + kids(node, ctx) + ' ';
        if (ctx.table) return '\n' + kids(node, ctx) + '\n';
        return blk(kids(node, ctx));
      }
    }
  }

  CCM.escapeMarkdownText = (t, settings) => esc(t, { s: settings });

  CCM.toMarkdown = function toMarkdown(root, infos, settings) {
    const st = { infos, s: settings, delims: CCM.delims(settings), pres: [], emph: [] };
    let md = conv(root, { st, inline: false, table: false });
    md = md
      .replace(new RegExp(`[ \\t]+${BR}`, 'g'), BR)
      .replace(/[ \t]+$/gm, '')
      .replace(new RegExp(`${BR}(?=\\n|$)`, 'g'), '  ')
      .replace(new RegExp(BR, 'g'), '')
      .replace(/^ (?=\S)/gm, '')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+|\s+$/g, '');
    md = resolveEmphasis(md, st);
    // 还原代码块（保持其所在列表/引用的缩进前缀）
    md = md.replace(new RegExp(`^(.*?)${PRE}(\\d+)${PRE}`, 'gm'), (_, prefix, i) => {
      const cont = prefix.replace(/[^>\s]/g, ' ');
      return st.pres[+i].split('\n').map((l, j) => (j === 0 ? prefix + l : l ? cont + l : cont.trimEnd())).join('\n');
    });
    return md;
  };

  CCM.toPlainText = function toPlainText(root, infos, settings) {
    const d = CCM.delims(settings);
    let out = '';
    const ensure = (k) => {
      out = out.replace(/[ \t]+$/, '');
      const m = out.match(/\n*$/)[0].length;
      if (out && m < k) out += '\n'.repeat(k - m);
    };
    const walk = (n, inPre) => {
      if (n.nodeType === 3 || n.nodeType === 4) {
        out += inPre ? n.nodeValue : n.nodeValue.replace(/\s+/g, ' ');
        return;
      }
      if (n.nodeType !== 1 && n.nodeType !== 11) return;
      const tag = n.localName;
      if (tag === 'ccm-math') {
        const i = infos.get(n.getAttribute('data-id'));
        if (i) out += i.display ? `\n${d.display[0]}${i.tex}${d.display[1]}\n` : `${d.inline[0]}${i.tex}${d.inline[1]}`;
        return;
      }
      if (tag === 'br') { out += '\n'; return; }
      const line = n.nodeType === 1 && /^(li|tr|dt|dd)$/.test(tag);
      const block = !line && n.nodeType === 1 && (BLOCK.has(tag) || /^(h[1-6]|ul|ol|pre|blockquote|table|hr)$/.test(tag));
      const gap = block ? (/^(ul|ol)$/.test(tag) && n.parentElement && n.parentElement.localName === 'li' ? 1 : 2) : 1;
      if (block || line) ensure(gap);
      if (tag === 'li') out += '- ';
      for (const c of n.childNodes) walk(c, inPre || tag === 'pre');
      if (tag === 'td' || tag === 'th') out += '\t';
      if (block || line) ensure(gap);
    };
    walk(root, false);
    return out.replace(/[ \t]+\n/g, '\n').replace(/\n (?=\S)/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  };
})();
