// 运行在内置 PDF.js 阅读器页面（vendor/pdfjs/web/viewer.html），在 viewer.mjs 之前加载。
// 两种打开方式：
//   1. 嵌入模式 viewer.html?embed=1 —— 由 PDF 原页面中的内容脚本以 iframe 嵌入，并通过 postMessage 传入 PDF 数据。
//      数据在原页面里读取（同源、带 Cookie），需要登录或带令牌的 PDF 也能打开。
//   2. 地址模式 viewer.html?src=<PDF 地址> —— 阅读器自己按地址加载（用于 file:// 等无法嵌入的情况）。
(() => {
  const CCM = (globalThis.__CCM = globalThis.__CCM || {});
  CCM.isPdfViewerPage = true;

  // 页面画布至少按 2 倍分辨率渲染（PDF.js 按 devicePixelRatio 决定画布分辨率）。
  // 屏幕缩放为 100% / 125% / 150% 或阅读器缩放为 130% 等非整数倍时，按屏幕分辨率渲染的文字缺少字体微调，
  // 中西文粗细、大小看起来不一致；超采样后再缩小显示，与浏览器自带阅读器的效果接近。
  try {
    const desc = Object.getOwnPropertyDescriptor(Window.prototype, 'devicePixelRatio') || Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
    const real = desc && desc.get ? () => desc.get.call(window) : () => 1;
    Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => Math.max(2, real()) });
  } catch (_) { /* ignore */ }

  const params = new URLSearchParams(location.search);
  const embedded = params.get('embed') === '1' && window.parent !== window;
  const src = params.get('src');
  let currentUrl = src || '';

  // ---------- 给文本层的每个 span 标注对应的 PDF 文本项（精确基线、字号、宽度、字体名） ----------
  // PDF.js 为每个非空文本项按顺序生成一个 span，外面可能包着 span.markedContent。
  const TEXT_PARAMS = { includeMarkedContent: true, disableNormalization: true };
  CCM.pdfPages = {};

  async function tagPage(app, pageNumber) {
    const view = app.pdfViewer.getPageView(pageNumber - 1);
    if (!view || !view.pdfPage || !view.textLayer || !view.textLayer.div) return;
    const page = view.pdfPage;
    const div = view.textLayer.div;
    try {
      const tc = await page.getTextContent(TEXT_PARAMS);
      // 只有非空文本项才会生成 span；空项只产生换行 <br>。
      // span 的 role 属性可能被无障碍模块改掉，所以按“非 markedContent 包装、非查找高亮”的 span 计数
      const items = tc.items.filter((it) => it.str !== undefined && it.str !== '');
      const spans = Array.from(div.querySelectorAll('span')).filter((s) =>
        !s.classList.contains('markedContent') && !s.classList.contains('highlight') &&
        (s.parentElement === div || s.parentElement.classList.contains('markedContent')));
      if (spans.length !== items.length) {
        console.warn('[marktex-copy] text layer mismatch', pageNumber, spans.length, items.length);
        return;
      }
      const [x0, y0, x1, y1] = page.view;
      CCM.pdfPages[pageNumber] = { page, styles: tc.styles, width: x1 - x0, height: y1 - y0, top: y1 };
      spans.forEach((s, i) => { s.__ccmItem = items[i]; s.__ccmPage = pageNumber; });
      // 公式是矢量路径的 PDF（MathJax 导出）：把识别出的公式字形插入文本层，使其可以被选中和复制
      if (CCM.pdfInjectGlyphs) await CCM.pdfInjectGlyphs(pageNumber, view);
    } catch (e) {
      console.warn('[marktex-copy] tag page failed', e);
    }
  }

  // 字体的真实名称（如 CMMI10 / CMEX10 / LMRoman10-Italic），需要 fontExtraProperties
  CCM.pdfFontName = (pageNumber, fontId) => {
    const info = CCM.pdfPages[pageNumber];
    if (!info) return '';
    try {
      const f = info.page.commonObjs.get(fontId);
      return (f && (f.name || f.loadedName)) || '';
    } catch (_) {
      return '';
    }
  };

  // ---------- 加载失败 ----------
  function fail(err, url) {
    console.warn('[marktex-copy] PDF load failed', err);
    if (embedded) {
      window.parent.postMessage({ type: 'marktex-failed', message: String(err && err.message || err) }, '*');
      return;
    }
    withLanguage(() => {
      const bar = document.createElement('div');
      bar.className = 'marktex-bar';
      const msg = document.createElement('span');
      const isLocal = /^file:/i.test(url);
      msg.textContent = isLocal ? CCM.t('pdf.needFileAccess') : CCM.t('pdf.loadError');
      const a = document.createElement('a');
      if (isLocal) {
        a.textContent = CCM.t('pdf.openSettings');
        a.href = '#';
        a.onclick = (e) => {
          e.preventDefault();
          const engine = /Edg\//.test(navigator.userAgent) ? 'edge' : 'chrome';
          chrome.tabs.create({ url: `${engine}://extensions/?id=${chrome.runtime.id}` });
        };
      } else {
        a.textContent = CCM.t('pdf.openNative');
        a.href = url.split('#')[0] + '#marktex-native';
      }
      bar.append(msg, a);
      document.body.appendChild(bar);
    });
  }

  function withLanguage(fn) {
    try {
      chrome.storage.sync.get({ language: 'auto' }, (s) => { CCM.currentLanguage = s.language; fn(); });
    } catch (_) { fn(); }
  }

  // 切换回浏览器自带阅读器
  function openNative() {
    if (embedded) window.parent.postMessage({ type: 'marktex-native' }, '*');
    else if (currentUrl) location.href = currentUrl.split('#')[0] + '#marktex-native';
  }

  // ---------- 工具栏上的 MarkTeX 菜单 ----------
  function buildToolbar() {
    const right = document.getElementById('toolbarViewerRight');
    if (!right || document.getElementById('marktexButton')) return;
    const wrap = document.createElement('div');
    wrap.className = 'marktex-menu-wrap';
    const btn = document.createElement('button');
    btn.id = 'marktexButton';
    btn.type = 'button';
    btn.className = 'marktex-button';
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17V7h2.4l2.6 3.4L10.6 7H13v10h-2.4v-6.2L8 14l-2.6-3.2V17zm13.5 0-3.5-4h2.3V7h2.4v6H20z"/></svg><span>MarkTeX</span>';
    const menu = document.createElement('div');
    menu.className = 'marktex-menu';
    menu.setAttribute('role', 'menu');
    menu.hidden = true;
    const entries = [['markdown', 'menu.markdown'], ['html', 'menu.html'], ['html-source', 'menu.html-source'], null, ['native', 'pdf.openNative']];
    const render = () => {
      btn.title = CCM.t('menu.markdown');
      menu.textContent = '';
      for (const it of entries) {
        if (!it) {
          const hr = document.createElement('div');
          hr.className = 'marktex-sep';
          menu.appendChild(hr);
          continue;
        }
        const b = document.createElement('button');
        b.type = 'button';
        b.setAttribute('role', 'menuitem');
        b.textContent = CCM.t(it[1]);
        b.dataset.action = it[0];
        menu.appendChild(b);
      }
    };
    const setOpen = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
    withLanguage(render);
    try {
      chrome.storage.onChanged.addListener((c, area) => { if (area === 'sync' && c.language) withLanguage(render); });
    } catch (_) { /* ignore */ }

    wrap.addEventListener('mousedown', (e) => e.preventDefault()); // 点击菜单时不清除页面中的选区
    btn.addEventListener('click', () => setOpen(menu.hidden));
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      setOpen(false);
      if (b.dataset.action === 'native') openNative();
      else if (CCM.copyFormat) CCM.copyFormat(b.dataset.action);
    });
    document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) setOpen(false); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
    wrap.append(btn, menu);
    right.insertBefore(wrap, right.firstChild);

    // 搜索按钮（连同查找栏）移到右侧、MarkTeX 按钮之前
    const find = document.getElementById('viewFindButton');
    const findWrap = find && find.closest('.toolbarButtonWithContainer');
    if (findWrap) {
      findWrap.classList.add('marktex-find');
      right.insertBefore(findWrap, wrap);
    }
  }

  document.addEventListener('webviewerloaded', () => {
    const opts = window.PDFViewerApplicationOptions;
    const app = window.PDFViewerApplication;
    if (!opts || !app) return;
    opts.set('defaultUrl', '');          // 不加载示例文档，由下面手动打开
    opts.set('isEvalSupported', false);   // 扩展页面的 CSP 不允许 eval
    opts.set('fontExtraProperties', true); // 保留字体真实名称，用于识别数学字体
    opts.set('disablePreferences', true);  // 避免阅读器偏好设置覆盖上面的选项

    app.initializedPromise.then(() => {
      buildToolbar();
      app.eventBus.on('textlayerrendered', ({ pageNumber }) => { tagPage(app, pageNumber); });
      // 侧栏视图切换按钮的图标随当前视图变化（见 pdf-viewer.css 中的 data-view）
      const setView = (view) => { const vm = document.getElementById('viewsManager'); if (vm && view) vm.dataset.view = String(view); };
      app.eventBus.on('sidebarviewchanged', ({ view }) => setView(view));
      // 大纲标题中的 TeX 源码（Typora 等导出的书签）显示为公式
      app.eventBus.on('outlineloaded', () => {
        if (!CCM.texLiteHtml) return;
        for (const a of document.querySelectorAll('#outlinesView .treeItem > a')) {
          const html = CCM.texLiteHtml(a.textContent);
          if (!html) continue;
          a.title = a.textContent;
          a.innerHTML = html;
        }
      });

      if (embedded) {
        window.addEventListener('message', (e) => {
          if (e.source !== window.parent || !e.data || e.data.type !== 'marktex-pdf') return;
          const { data, url } = e.data;
          currentUrl = url;
          const name = decodeURIComponent((url.split(/[?#]/)[0].split('/').pop() || 'document.pdf'));
          app.open({ data: new Uint8Array(data), filename: /\.pdf$/i.test(name) ? name : name + '.pdf' })
            .then(() => {
              try { app.setTitleUsingUrl(url, url); } catch (_) { /* ignore */ }
              window.parent.postMessage({ type: 'marktex-loaded', title: document.title }, '*');
            })
            .catch((err) => fail(err, url));
        });
        window.parent.postMessage({ type: 'marktex-ready' }, '*');
      } else if (src) {
        app.open({ url: src, originalUrl: src, withCredentials: true }).catch((err) => fail(err, src));
      }
    });
  });
})();
