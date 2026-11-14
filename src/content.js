(() => {
  const alive = () => { try { return !!chrome.runtime.id; } catch (_) { return false; } };
  // 扩展重载后旧脚本会失效，允许新脚本重新接管
  if (window.__ccmContent && window.__ccmContent.alive()) return;
  window.__ccmContent = { alive };

  const CCM = globalThis.__CCM;
  const LABELS = { markdown: 'Markdown', html: 'HTML', 'html-source': 'HTML 源码' };
  let settings = { ...CCM.DEFAULTS };

  try {
    chrome.storage.sync.get(CCM.DEFAULTS, (s) => { settings = { ...CCM.DEFAULTS, ...s }; });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const k of Object.keys(changes)) settings[k] = changes[k].newValue;
    });
  } catch (_) { /* ignore */ }

  let lastContextNode = null;
  document.addEventListener('contextmenu', (e) => {
    lastContextNode = (e.composedPath && e.composedPath()[0]) || e.target;
  }, true);

  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function selectionRange() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    return sel.getRangeAt(0);
  }

  function selectedFieldText() {
    const el = document.activeElement;
    if (!el) return null;
    if (el.localName === 'textarea' || (el.localName === 'input' && /^(text|search|url|email|tel)$/i.test(el.type))) {
      try {
        const s = el.selectionStart;
        const e = el.selectionEnd;
        if (s != null && e > s) return el.value.slice(s, e);
      } catch (_) { /* ignore */ }
    }
    return null;
  }

  function generate(format) {
    const range = selectionRange();
    const s = settings;
    if (!range) {
      const t = selectedFieldText();
      if (t == null) return null;
      if (format === 'html') return { text: t, html: escapeHtml(t).replace(/\n/g, '<br>'), mathCount: 0 };
      if (format === 'html-source') return { text: escapeHtml(t).replace(/\n/g, '<br>\n'), mathCount: 0 };
      return { text: t, mathCount: 0 };
    }

    const { fragment, infos } = CCM.capture(range);
    const title = document.title || location.href;
    const url = location.href;

    if (format === 'markdown') {
      let md = CCM.toMarkdown(fragment, infos, s);
      if (s.appendSource) md += `\n\n> 来源：[${title.replace(/\[/g, '&#91;').replace(/\]/g, '&#93;')}](${url.replace(/[ ()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())})`;
      return { text: md, mathCount: infos.size };
    }

    let html = CCM.toHtml(fragment, infos, s);
    if (s.appendSource) html += `\n<p>来源：<a href="${escapeHtml(url)}">${escapeHtml(title)}</a></p>`;
    if (format === 'html-source') return { text: html, mathCount: infos.size };

    let text = CCM.toPlainText(fragment, infos, s);
    if (s.appendSource) text += `\n\n来源：${title} ${url}`;
    return { text, html, mathCount: infos.size };
  }

  // ---------- 剪贴板 ----------
  function copyViaEvent(data) {
    let ok = false;
    const handler = (e) => {
      e.stopImmediatePropagation();
      e.preventDefault();
      try {
        for (const [type, value] of Object.entries(data)) e.clipboardData.setData(type, value);
        ok = true;
      } catch (_) { /* ignore */ }
    };
    window.addEventListener('copy', handler, true);
    try {
      document.execCommand('copy');
    } catch (_) { /* ignore */ } finally {
      window.removeEventListener('copy', handler, true);
    }
    return ok;
  }

  async function writeClipboard(data) {
    if (copyViaEvent(data)) return true;
    try {
      const items = {};
      for (const [type, value] of Object.entries(data)) items[type] = new Blob([value], { type });
      await navigator.clipboard.write([new ClipboardItem(items)]);
      return true;
    } catch (_) {
      return false;
    }
  }

  const toClipboardData = (r) => (r.html != null ? { 'text/html': r.html, 'text/plain': r.text } : { 'text/plain': r.text });

  // ---------- 提示 ----------
  function toast(msg, ok = true) {
    if (!settings.showToast) return;
    try {
      const host = document.createElement('div');
      host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;top:16px;right:16px;pointer-events:none;';
      const root = host.attachShadow({ mode: 'closed' });
      const box = document.createElement('div');
      box.textContent = msg;
      box.style.cssText = [
        'font:13px/1.5 system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif',
        `background:${ok ? '#1f7a4d' : '#b3261e'}`, 'color:#fff', 'padding:8px 14px', 'border-radius:8px',
        'box-shadow:0 4px 16px rgba(0,0,0,.25)', 'opacity:0', 'transform:translateY(-6px)',
        'transition:opacity .18s,transform .18s', 'max-width:360px',
      ].join(';');
      root.appendChild(box);
      (document.body || document.documentElement).appendChild(host);
      requestAnimationFrame(() => { box.style.opacity = '1'; box.style.transform = 'none'; });
      setTimeout(() => { box.style.opacity = '0'; }, 1600);
      setTimeout(() => host.remove(), 1900);
    } catch (_) { /* ignore */ }
  }

  const doneMsg = (format, r) => `✓ 已复制为 ${LABELS[format]}${r.mathCount ? `（含 ${r.mathCount} 个公式）` : ''}`;

  // ---------- 消息 ----------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('ccm-')) return;
    if (msg.requireFocus && !document.hasFocus()) return;

    if (msg.type === 'ccm-toast') {
      toast(msg.text, msg.ok !== false);
      return;
    }

    if (msg.type === 'ccm-generate') {
      let r;
      try { r = generate(msg.format); } catch (e) {
        console.error('[marktex-copy]', e);
        sendResponse({ ok: false, reason: 'error', error: String(e && e.message || e) });
        return;
      }
      if (!r) {
        if (msg.silentIfEmpty) return;
        sendResponse({ ok: false, reason: 'empty' });
        return;
      }
      sendResponse({ ok: true, ...r, data: toClipboardData(r), label: LABELS[msg.format] });
      return;
    }

    if (msg.type === 'ccm-copy') {
      let r;
      try { r = generate(msg.format); } catch (e) {
        console.error('[marktex-copy]', e);
        toast('复制失败：' + (e && e.message || e), false);
        sendResponse({ ok: false, reason: 'error' });
        return;
      }
      if (!r) {
        toast('没有选中任何内容', false);
        sendResponse({ ok: false, reason: 'empty' });
        return;
      }
      const data = toClipboardData(r);
      const message = doneMsg(msg.format, r);
      writeClipboard(data).then((ok) => {
        if (ok) toast(message);
        sendResponse(ok ? { ok: true } : { ok: false, reason: 'clipboard', data, message });
      });
      return true;
    }

    if (msg.type === 'ccm-copy-formula') {
      let info = null;
      try { info = lastContextNode && CCM.formulaAt(lastContextNode); } catch (e) { console.error(e); }
      if (!info) {
        toast('这里没有识别到公式', false);
        sendResponse({ ok: false, reason: 'empty' });
        return;
      }
      const data = { 'text/plain': info.tex };
      writeClipboard(data).then((ok) => {
        if (ok) toast('✓ 已复制公式 LaTeX');
        sendResponse(ok ? { ok: true } : { ok: false, reason: 'clipboard', data, message: '✓ 已复制公式 LaTeX' });
      });
      return true;
    }
  });

  // ---------- 自定义快捷键 ----------
  // 只在有选区时接管按键；没有选区时不拦截，原有快捷键（例如 Ctrl+C）照常生效
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.isComposing) return;
    const map = settings.shortcuts || {};
    for (const format of Object.keys(LABELS)) {
      if (!CCM.shortcutMatches(e, map[format])) continue;
      if (!selectionRange() && selectedFieldText() == null) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      copyFromShortcut(format);
      return;
    }
  }, true);

  async function copyFromShortcut(format) {
    let r;
    try { r = generate(format); } catch (e) {
      console.error('[marktex-copy]', e);
      toast('复制失败：' + (e && e.message || e), false);
      return;
    }
    if (!r) return;
    const data = toClipboardData(r);
    let ok = await writeClipboard(data);
    if (!ok) {
      try { ok = !!(await chrome.runtime.sendMessage({ type: 'ccm-offscreen-copy', data })); } catch (_) { ok = false; }
    }
    toast(ok ? doneMsg(format, r) : '复制失败：无法写入剪贴板', ok);
  }
})();
