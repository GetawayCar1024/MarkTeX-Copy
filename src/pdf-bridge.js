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
      // span 的 role 属性可能被无障碍模块改掉，所以按“非 markedContent 包装、非查找高亮”的 span 计数；
      // 同一文本层可能再次触发 textlayerrendered，此时其中已有插入的公式字形 / 图片占位元素，也不计入
      const items = tc.items.filter((it) => it.str !== undefined && it.str !== '');
      const spans = Array.from(div.querySelectorAll('span')).filter((s) =>
        !s.classList.contains('markedContent') && !s.classList.contains('highlight') &&
        !s.classList.contains('marktex-glyph') && !s.classList.contains('marktex-image') &&
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

  // ---------- 工具栏：仿 Chrome 自带阅读器的布局 ----------
  //   左：侧栏开关、文档标题
  //   中：页码 | 缩小、缩放比例、放大 | 适合页面 / 页宽、旋转
  //   右：搜索、MarkTeX 菜单 | 批注工具 | 下载、打印、更多
  const make = (tag, props = {}) => Object.assign(document.createElement(tag), props);
  const separator = () => make('div', { className: 'verticalToolbarSeparator marktex-separator' });

  function layoutToolbar(app) {
    const left = document.getElementById('toolbarViewerLeft');
    const middle = document.getElementById('toolbarViewerMiddle');
    const toggle = document.getElementById('viewsManagerToggleButton');
    const numPages = document.getElementById('numPages');
    if (!left || !middle || !toggle || !numPages || document.getElementById('marktexTitle')) return;

    // 文档标题（标签页标题里还有文件名等，这里只显示文档自己的标题或文件名）
    const title = make('span', { id: 'marktexTitle' });
    toggle.after(title);
    const setTitle = () => {
      let docTitle = '';
      try { docTitle = app._docTitle || ''; } catch (_) { /* 元数据尚未读取 */ }
      const name = app._docFilename || '';
      title.textContent = docTitle || name || app._title || '';
      title.title = docTitle && name && docTitle !== name ? `${docTitle}\n${name}` : title.textContent;
      // 嵌入在 PDF 原页面中时，由原页面设置标签页标题
      if (embedded && app._title) window.parent.postMessage({ type: 'marktex-title', title: app._title }, '*');
    };
    app.eventBus.on('documentloaded', setTitle);
    app.eventBus.on('metadataloaded', setTitle);

    // 页码移到中间
    middle.prepend(numPages.parentElement, separator());
    // 缩放比例放在缩小、放大按钮之间
    const zoomIn = document.getElementById('zoomInButton');
    const scale = document.getElementById('scaleSelectContainer');
    if (zoomIn && scale) scale.after(zoomIn);

    // 适合页面 / 适合页宽（按当前状态切换），逆时针旋转
    const fit = make('button', { id: 'marktexFitButton', className: 'toolbarButton', type: 'button' });
    const rotate = make('button', { id: 'marktexRotateButton', className: 'toolbarButton', type: 'button' });
    rotate.setAttribute('data-l10n-id', 'pdfjs-page-rotate-ccw-button');
    const syncFit = () => {
      const toWidth = app.pdfViewer && app.pdfViewer.currentScaleValue === 'page-fit';
      fit.dataset.fit = toWidth ? 'width' : 'page';
      fit.title = fit.ariaLabel = CCM.t(toWidth ? 'pdf.fitWidth' : 'pdf.fitPage');
    };
    fit.addEventListener('click', () => {
      app.pdfViewer.currentScaleValue = fit.dataset.fit === 'width' ? 'page-width' : 'page-fit';
    });
    rotate.addEventListener('click', () => app.rotatePages(-90));
    app.eventBus.on('scalechanging', syncFit);
    withLanguage(syncFit);
    middle.append(separator(), fit, rotate);

    // 右侧：下载在打印之前（与 Chrome 一致）
    const download = document.getElementById('downloadButton');
    const print = document.getElementById('printButton');
    if (download && print) print.before(download);
  }

  // ---------- 侧栏：左侧一列视图切换按钮（缩略图 / 大纲 / 附件 / 图层），代替 PDF.js 的下拉菜单 ----------
  function buildSidebarTabs() {
    const vm = document.getElementById('viewsManager');
    if (!vm || document.getElementById('marktexTabs')) return;
    const strip = make('div', { id: 'marktexTabs' });
    strip.setAttribute('role', 'tablist');
    const views = [['thumbnailsViewMenu', 'grid'], ['outlinesViewMenu', 'outline'], ['attachmentsViewMenu', 'attach'], ['layersViewMenu', 'layers']];
    for (const [id, icon] of views) {
      const source = document.getElementById(id);
      if (!source) continue;
      const tab = make('button', { type: 'button', className: 'marktex-tab' });
      tab.dataset.icon = icon;
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', () => source.click());
      // 与 PDF.js 菜单项的状态同步：没有大纲 / 附件 / 图层时隐藏，选中的视图高亮
      const sync = () => {
        tab.hidden = source.disabled && id !== 'thumbnailsViewMenu';
        const selected = source.classList.contains('selected');
        tab.classList.toggle('selected', selected);
        tab.setAttribute('aria-selected', String(selected));
        tab.title = tab.ariaLabel = source.textContent.trim();
      };
      new MutationObserver(sync).observe(source, { attributes: true, childList: true, subtree: true, characterData: true });
      sync();
      strip.appendChild(tab);
    }
    vm.prepend(strip);
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
    btn.innerHTML = '<span class="marktex-logo" aria-hidden="true"></span><span class="marktex-label">MarkTeX</span><span class="marktex-caret" aria-hidden="true"></span>';
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
    wrap.after(separator());

    // 搜索按钮（连同查找栏）移到右侧、MarkTeX 按钮之前
    const find = document.getElementById('viewFindButton');
    const findWrap = find && find.closest('.toolbarButtonWithContainer');
    if (findWrap) {
      findWrap.classList.add('marktex-find');
      right.insertBefore(findWrap, wrap);
    }
    // 查找栏：第一行是输入框和结果数，第二行是各个选项
    const opt1 = document.getElementById('findbarOptionsOneContainer');
    const opt2 = document.getElementById('findbarOptionsTwoContainer');
    if (opt1 && opt2) {
      const box = make('div', { id: 'marktexFindOptions' });
      opt1.before(box);
      box.append(opt1, opt2);
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
      layoutToolbar(app);
      buildToolbar();
      buildSidebarTabs();
      app.eventBus.on('textlayerrendered', ({ pageNumber }) => { tagPage(app, pageNumber); });
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
              // 嵌入模式下 PDF.js 不改 document.title，标题由原页面设置
              window.parent.postMessage({ type: 'marktex-loaded', title: app._title || '' }, '*');
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
