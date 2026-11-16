(() => {
  const alive = () => { try { return !!chrome.runtime.id; } catch (_) { return false; } };
  // 扩展重载后旧脚本会失效，允许新脚本重新接管
  if (window.__ccmContent && window.__ccmContent.alive()) return;
  window.__ccmContent = { alive };

  const CCM = globalThis.__CCM;
  const FORMATS = ['markdown', 'html', 'html-source'];
  const t = (key, vars) => CCM.t(key, vars);
  const label = (format) => t('label.' + format);
  let settings = { ...CCM.DEFAULTS };

  // 运行在扩展自己的页面（内置 PDF 阅读器）时，消息通过 runtime.sendMessage 广播，需要按标签页过滤
  const isExtensionPage = location.protocol === 'chrome-extension:' || location.protocol === 'moz-extension:';
  let myTabId = null;
  if (isExtensionPage) {
    // 阅读器可能是独立标签页，也可能以 iframe 嵌在 PDF 原页面里；由后台告知所在标签页
    chrome.runtime.sendMessage({ type: 'ccm-whoami' }).then((r) => { myTabId = r ? r.tabId : null; }).catch(() => {});
  }

  function applySettings(s) {
    settings = { ...CCM.DEFAULTS, ...s };
    CCM.currentLanguage = settings.language;
    CCM.currentSettings = settings;
  }

  try {
    chrome.storage.sync.get(CCM.DEFAULTS, (s) => {
      applySettings(s);
      maybeOpenPdfViewer();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      const next = { ...settings };
      for (const k of Object.keys(changes)) next[k] = changes[k].newValue;
      applySettings(next);
    });
  } catch (_) { /* ignore */ }

  // ---------- PDF：浏览器自带阅读器不允许扩展读取选区，改用内置 PDF.js 阅读器 ----------
  const VIEWER = 'vendor/pdfjs/web/viewer.html';
  const isPdfDocument = () => !isExtensionPage && document.contentType === 'application/pdf';
  const nativeKey = () => 'marktex-native:' + location.href.split('#')[0];
  let readerState = 'none'; // none | loading | open | failed

  function maybeOpenPdfViewer() {
    if (!isPdfDocument() || !settings.openPdfInViewer) return;
    if (/marktex-native/.test(location.hash)) return;
    try { if (sessionStorage.getItem(nativeKey())) return; } catch (_) { /* ignore */ }
    openPdfReader();
  }

  async function readPdfBytes(url) {
    // 在 PDF 原页面里读取：同源、自动带 Cookie，通常直接命中缓存
    try {
      const resp = await fetch(url, { credentials: 'include', cache: 'force-cache' });
      if (resp.ok) return await resp.arrayBuffer();
    } catch (_) { /* 例如 file:// 不支持 fetch */ }
    return new Promise((resolve) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open('GET', url);
        xhr.responseType = 'arraybuffer';
        xhr.onload = () => resolve(xhr.response && xhr.response.byteLength ? xhr.response : null);
        xhr.onerror = () => resolve(null);
        xhr.send();
      } catch (_) { resolve(null); }
    });
  }

  async function openPdfReader() {
    if (readerState === 'loading' || readerState === 'open') return true;
    readerState = 'loading';
    const pdfUrl = location.href;
    const base = pdfUrl.split('#')[0];
    const hash = location.hash.replace(/^#/, '');
    const buf = await readPdfBytes(base);
    const head = buf ? new TextDecoder('latin1').decode(new Uint8Array(buf, 0, Math.min(1024, buf.byteLength))) : '';
    if (!buf || !head.includes('%PDF')) {
      if (location.protocol === 'file:') {
        // 本地文件：交给阅读器按地址打开（需要在扩展详情中允许访问文件网址）
        location.replace(chrome.runtime.getURL(VIEWER) + '?src=' + encodeURIComponent(base) + (hash ? '#' + hash : ''));
        return true;
      }
      readerState = 'failed';
      toast(t('pdf.fetchFailed'), false);
      return false;
    }

    const frame = document.createElement('iframe');
    frame.src = chrome.runtime.getURL(VIEWER) + '?embed=1' + (hash ? '#' + hash : '');
    frame.allow = 'clipboard-read; clipboard-write; fullscreen';
    // 底色与阅读器背景一致，避免加载时闪烁
    const bg = matchMedia('(prefers-color-scheme: dark)').matches ? '#282828' : '#e8eaed';
    frame.style.cssText = `position:fixed;inset:0;width:100vw;height:100vh;border:0;margin:0;z-index:2147483646;background:${bg};`;
    const onMessage = (e) => {
      if (e.source !== frame.contentWindow || !e.data) return;
      if (e.data.type === 'marktex-ready') {
        frame.contentWindow.postMessage({ type: 'marktex-pdf', data: buf, url: pdfUrl }, '*', [buf]);
      } else if (e.data.type === 'marktex-loaded') {
        readerState = 'open';
        if (e.data.title) document.title = e.data.title;
      } else if (e.data.type === 'marktex-title') {
        if (e.data.title) document.title = e.data.title;
      } else if (e.data.type === 'marktex-failed' || e.data.type === 'marktex-native') {
        // 阅读器解析失败：记住选择，重新加载为浏览器自带阅读器
        window.removeEventListener('message', onMessage);
        try { sessionStorage.setItem(nativeKey(), '1'); } catch (_) { /* ignore */ }
        location.reload();
      }
    };
    window.addEventListener('message', onMessage);
    if (closeActionToast) closeActionToast();
    for (const el of document.querySelectorAll('embed, object')) el.remove();
    document.documentElement.style.cssText += ';overflow:hidden;';
    (document.body || document.documentElement).appendChild(frame);
    return true;
  }

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

  function sourceInfo() {
    // 在内置阅读器里，来源应是 PDF 的原始地址
    const src = isExtensionPage ? new URLSearchParams(location.search).get('src') : null;
    return { title: document.title || src || location.href, url: src || location.href };
  }

  function withSource(format, r, s) {
    if (!s.appendSource) return r;
    const { title, url } = sourceInfo();
    const src = t('source');
    if (format === 'markdown') {
      const safeTitle = title.replace(/\[/g, '&#91;').replace(/\]/g, '&#93;');
      const safeUrl = url.replace(/[ ()]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
      r.text += `\n\n> ${src}: [${safeTitle}](${safeUrl})`;
      return r;
    }
    const tail = `\n<p>${escapeHtml(src)}: <a href="${escapeHtml(url)}">${escapeHtml(title)}</a></p>`;
    if (format === 'html-source') r.text += tail;
    else {
      r.html += tail;
      r.text += `\n\n${src}: ${title} ${url}`;
    }
    return r;
  }

  // PDF 全选或选区跨越未渲染的页面时，需要先异步读取这些页面的文本
  async function generateAsync(format) {
    const range = selectionRange();
    if (range && CCM.isPdfViewerPage && CCM.pdfNeedsAsync && CCM.pdfNeedsAsync(range)) {
      const pages = CCM.pdfSelectionPageCount(range);
      const total = (globalThis.PDFViewerApplication && globalThis.PDFViewerApplication.pagesCount) || pages;
      if (total > 15) toast(t('toast.readingPages', { n: total }));
      const p = await CCM.pdfSelectionAsync(range, settings);
      if (p) return generate(format, p);
    }
    return generate(format);
  }

  function generate(format, pdfResult = null) {
    const range = selectionRange();
    const s = settings;
    if (!range) {
      const v = selectedFieldText();
      if (v == null) return null;
      if (format === 'html') return { text: v, html: escapeHtml(v).replace(/\n/g, '<br>'), mathCount: 0 };
      if (format === 'html-source') return { text: escapeHtml(v).replace(/\n/g, '<br>\n'), mathCount: 0 };
      return { text: v, mathCount: 0 };
    }

    // 内置 PDF 阅读器：按文字位置重建段落 / 标题 / 列表
    if (CCM.isPdfViewerPage && CCM.pdfSelection) {
      const p = pdfResult || CCM.pdfSelection(range, s);
      if (p) {
        const n = p.mathCount || 0;
        const r = format === 'markdown' ? { text: p.markdown, mathCount: n }
          : format === 'html-source' ? { text: p.html, mathCount: n }
            : { text: p.text, html: p.html, mathCount: n };
        r.pdfMath = p.hasMath;
        r.pdfRebuilt = p.rebuilt && n > 0;
        return withSource(format, r, s);
      }
    }

    const { fragment, infos } = CCM.capture(range);
    const n = infos.size;
    if (format === 'markdown') return withSource(format, { text: CCM.toMarkdown(fragment, infos, s), mathCount: n }, s);
    const html = CCM.toHtml(fragment, infos, s);
    if (format === 'html-source') return withSource(format, { text: html, mathCount: n }, s);
    return withSource(format, { text: CCM.toPlainText(fragment, infos, s), html, mathCount: n }, s);
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
  // action: { label, run }，带操作按钮的提示不受“显示提示”开关影响，且停留更久
  let closeActionToast = null;
  function toast(msg, ok = true, action = null) {
    if (!settings.showToast && !action && ok) return;
    try {
      const host = document.createElement('div');
      host.style.cssText = `all:initial;position:fixed;z-index:2147483647;top:16px;right:16px;pointer-events:${action ? 'auto' : 'none'};` +
        '-webkit-user-select:none;user-select:none;';
      const root = host.attachShadow({ mode: 'closed' });
      // 页面全选（Ctrl+A）后再弹出提示时，不让提示里的文字也显示为选中状态
      const style = document.createElement('style');
      style.textContent = '*{-webkit-user-select:none;user-select:none}::selection{background:transparent;color:inherit}';
      root.appendChild(style);
      const box = document.createElement('div');
      box.style.cssText = [
        'font:13px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif',
        'background:rgba(28,28,30,.92)', `color:${ok ? '#fff' : '#ffb4ab'}`, 'padding:10px 14px', 'border-radius:10px',
        'box-shadow:0 1px 3px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.14)', 'opacity:0', 'transform:translateY(-6px)',
        'transition:opacity .18s,transform .18s', 'max-width:380px', '-webkit-backdrop-filter:blur(12px)', 'backdrop-filter:blur(12px)',
      ].join(';');
      const text = document.createElement('div');
      text.style.whiteSpace = 'pre-line';
      text.textContent = msg;
      box.appendChild(text);
      const close = () => { box.style.opacity = '0'; setTimeout(() => host.remove(), 250); };
      if (action) { if (closeActionToast) closeActionToast(); closeActionToast = close; }
      if (action) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;gap:8px;justify-content:flex-end;margin-top:8px';
        const mk = (label, primary) => {
          const b = document.createElement('button');
          b.textContent = label;
          b.style.cssText = `font:inherit;font-weight:600;border:0;border-radius:7px;padding:5px 12px;cursor:pointer;${primary ? 'background:#0a84ff;color:#fff' : 'background:rgba(255,255,255,.14);color:#fff'}`;
          return b;
        };
        const later = mk(t('toast.dismiss'), false);
        const go = mk(action.label, true);
        later.onclick = close;
        go.onclick = () => { close(); action.run(); };
        row.append(later, go);
        box.appendChild(row);
      }
      root.appendChild(box);
      // 挂在 <html> 下、<body> 之外：页面全选的选区只覆盖 <body>，不会把提示框也选进去
      document.documentElement.appendChild(host);
      requestAnimationFrame(() => { box.style.opacity = '1'; box.style.transform = 'none'; });
      const life = action ? 10000 : msg.length > 40 ? 3600 : 1700;
      setTimeout(close, life);
    } catch (_) { /* ignore */ }
  }

  // 浏览器自带 PDF 阅读器里无法带格式复制：不复制原文，提示用户切换到 MarkTeX 阅读器
  function promptPdfReader(pdfUrl) {
    const target = pdfUrl || location.href;
    toast(t('toast.pdfNative'), false, {
      label: t('toast.openInReader'),
      run: () => {
        if (isPdfDocument() && target.split('#')[0] === location.href.split('#')[0]) {
          try { sessionStorage.removeItem(nativeKey()); } catch (_) { /* ignore */ }
          openPdfReader();
        } else {
          window.open(chrome.runtime.getURL(VIEWER) + '?src=' + encodeURIComponent(target.split('#')[0]), '_blank');
        }
      },
    });
  }

  const doneMsg = (format, r) => t('toast.copied', { label: label(format) }) +
    (r.mathCount ? t('toast.withMath', { n: r.mathCount }) : '') +
    (r.pdfRebuilt ? '\n' + t('toast.pdfMathRebuilt') : r.pdfMath ? '\n' + t('toast.pdfMath') : '');

  // ---------- 消息 ----------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('ccm-')) return;
    if (msg.type === 'ccm-offscreen-copy') return;
    if (isExtensionPage) {
      if (msg.ccmTabId == null || msg.ccmTabId !== myTabId) return;
    } else if (msg.ccmTabId != null) return;
    if (msg.requireFocus && !document.hasFocus()) return;

    if (msg.type === 'ccm-toast') {
      toast(msg.key ? t(msg.key) : msg.text, msg.ok !== false);
      return;
    }

    if (msg.type === 'ccm-pdf-unsupported') {
      if (window.top !== window && !isPdfDocument()) return; // 只由顶层页面或 PDF 所在文档提示
      promptPdfReader(msg.pdfUrl);
      sendResponse({ ok: true });
      return;
    }

    if (msg.type === 'ccm-pdf-status') {
      if (!isPdfDocument()) return;
      sendResponse({ isPdf: true, readerOpen: readerState === 'open' || readerState === 'loading' });
      return;
    }

    if (msg.type === 'ccm-open-reader') {
      if (!isPdfDocument()) return;
      try { sessionStorage.removeItem(nativeKey()); } catch (_) { /* ignore */ }
      openPdfReader().then((ok) => sendResponse({ ok }));
      return true;
    }

    const hasSelection = () => !!selectionRange() || selectedFieldText() != null;

    if (msg.type === 'ccm-generate') {
      // 没有选区时同步返回（广播给多个 frame 时，没有选区的 frame 保持沉默）
      if (!hasSelection()) {
        if (!msg.silentIfEmpty) sendResponse({ ok: false, reason: 'empty' });
        return;
      }
      generateAsync(msg.format).then((r) => {
        if (!r) sendResponse({ ok: false, reason: 'empty' });
        else sendResponse({ ok: true, ...r, data: toClipboardData(r), label: label(msg.format) });
      }).catch((e) => {
        console.error('[marktex-copy]', e);
        sendResponse({ ok: false, reason: 'error', error: String(e && e.message || e) });
      });
      return true;
    }

    if (msg.type === 'ccm-copy') {
      if (!hasSelection()) {
        toast(t('toast.empty'), false);
        sendResponse({ ok: false, reason: 'empty' });
        return;
      }
      (async () => {
        let r;
        try { r = await generateAsync(msg.format); } catch (e) {
          console.error('[marktex-copy]', e);
          toast(t('toast.failed', { msg: e && e.message || e }), false);
          sendResponse({ ok: false, reason: 'error' });
          return;
        }
        if (!r) {
          toast(t('toast.empty'), false);
          sendResponse({ ok: false, reason: 'empty' });
          return;
        }
        const data = toClipboardData(r);
        const message = doneMsg(msg.format, r);
        const ok = await writeClipboard(data);
        if (ok) toast(message);
        sendResponse(ok ? { ok: true } : { ok: false, reason: 'clipboard', data, message });
      })();
      return true;
    }

    if (msg.type === 'ccm-copy-formula') {
      let info = null;
      try { info = lastContextNode && CCM.formulaAt(lastContextNode); } catch (e) { console.error(e); }
      if (!info) {
        toast(t('toast.noFormula'), false);
        sendResponse({ ok: false, reason: 'empty' });
        return;
      }
      const data = { 'text/plain': info.tex };
      const message = t('toast.formulaCopied');
      writeClipboard(data).then((ok) => {
        if (ok) toast(message);
        sendResponse(ok ? { ok: true } : { ok: false, reason: 'clipboard', data, message });
      });
      return true;
    }
  });

  // ---------- 自定义快捷键 ----------
  // 只在有选区时接管按键；没有选区时不拦截，原有快捷键（例如 Ctrl+C）照常生效
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.isComposing) return;
    const map = settings.shortcuts || {};
    for (const format of FORMATS) {
      if (!CCM.shortcutMatches(e, map[format])) continue;
      if (!selectionRange() && selectedFieldText() == null) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      copyFromShortcut(format);
      return;
    }
  }, true);

  // 供内置 PDF 阅读器工具栏上的 MarkTeX 菜单调用
  CCM.copyFormat = (format) => {
    if (!selectionRange()) { toast(t('toast.empty'), false); return; }
    copyFromShortcut(format);
  };

  async function copyFromShortcut(format) {
    let r;
    try { r = await generateAsync(format); } catch (e) {
      console.error('[marktex-copy]', e);
      toast(t('toast.failed', { msg: e && e.message || e }), false);
      return;
    }
    if (!r) return;
    const data = toClipboardData(r);
    let ok = await writeClipboard(data);
    if (!ok) {
      try { ok = !!(await chrome.runtime.sendMessage({ type: 'ccm-offscreen-copy', data })); } catch (_) { ok = false; }
    }
    toast(ok ? doneMsg(format, r) : t('toast.clipboardFailed'), ok);
  }
})();
