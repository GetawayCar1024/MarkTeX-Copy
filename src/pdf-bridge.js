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

  // ---------- 工具栏布局 ----------
  //   左：侧栏开关、文档标题
  //   中：翻页与页码、缩放（各合成一组），适合页面 / 页宽、旋转
  //   右：搜索、MarkTeX 菜单，批注工具，下载、打印、更多
  const make = (tag, props = {}) => Object.assign(document.createElement(tag), props);
  const $ = (id) => document.getElementById(id);
  const group = (cls, children) => {
    const g = make('div', { className: `marktex-group ${cls}` });
    g.append(...children);
    return g;
  };
  // 扩展的语言、快捷键设置改变时更新文字
  const onSettingsChanged = (fn) => {
    try {
      chrome.storage.onChanged.addListener((c, area) => { if (area === 'sync' && (c.language || c.shortcuts)) withLanguage(fn); });
    } catch (_) { /* ignore */ }
  };

  function layoutToolbar(app) {
    const middle = $('toolbarViewerMiddle');
    const toggle = $('viewsManagerToggleButton');
    const numPages = $('numPages');
    const [prev, next, zoomOut, zoomIn, scale] = ['previous', 'next', 'zoomOutButton', 'zoomInButton', 'scaleSelectContainer'].map($);
    if (!middle || !toggle || !numPages || !prev || !next || !zoomOut || !zoomIn || !scale || $('marktexTitle')) return;

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

    // 翻页按钮与页码合成一组“⌃ 3 / 12 ⌄”，缩放合成一组“− 100% +”，都放在中间。
    // 翻页按钮原来所在的分组在窄窗口中隐藏（hiddenSmallView），移出后由按钮自己带上这个类
    const leftovers = [prev.parentElement, zoomOut.parentElement];
    prev.classList.add('hiddenSmallView');
    next.classList.add('hiddenSmallView');
    const pages = group('marktex-pages', [prev, numPages.parentElement, next]);
    const zoom = group('marktex-zoom', [zoomOut, scale, zoomIn]);
    for (const g of leftovers) if (!g.querySelector('button, input, select')) g.remove();

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
    middle.append(pages, zoom, fit, rotate);

    // 右侧：下载在打印之前
    const download = $('downloadButton');
    const print = $('printButton');
    if (download && print) print.before(download);
  }

  // ---------- 侧栏：顶部的分段控件（页面 / 大纲 / 附件 / 图层），代替 PDF.js 的下拉菜单 ----------
  function buildSidebarViews() {
    const title = $('viewsManagerTitle');
    if (!title || $('marktexViews')) return;
    const seg = make('div', { id: 'marktexViews', className: 'marktex-segmented' });
    seg.setAttribute('role', 'tablist');
    const views = [['thumbnailsViewMenu', 'pdf.viewPages'], ['outlinesViewMenu', 'pdf.viewOutline'], ['attachmentsViewMenu', 'pdf.viewAttachments'], ['layersViewMenu', 'pdf.viewLayers']];
    const tabs = [];
    // 只有一种视图可选（没有大纲等）时不显示成分段控件，只作为标题
    const syncCount = () => seg.classList.toggle('single', tabs.filter(([t]) => !t.hidden).length < 2);
    for (const [id, key] of views) {
      const source = $(id);
      if (!source) continue;
      const tab = make('button', { type: 'button', className: 'marktex-seg' });
      tab.setAttribute('role', 'tab');
      tab.addEventListener('click', () => source.click());
      // 与 PDF.js 菜单项的状态同步：没有大纲 / 附件 / 图层时隐藏，选中的视图高亮
      const sync = () => {
        tab.hidden = source.disabled && id !== 'thumbnailsViewMenu';
        const selected = source.classList.contains('selected');
        tab.classList.toggle('selected', selected);
        tab.setAttribute('aria-selected', String(selected));
        tab.title = source.textContent.trim();
        syncCount();
      };
      new MutationObserver(sync).observe(source, { attributes: true, childList: true, subtree: true, characterData: true });
      tabs.push([tab, key]);
      seg.appendChild(tab);
      sync();
    }
    const label = () => { for (const [tab, key] of tabs) tab.replaceChildren(make('span', { className: 'marktex-seg-label', textContent: CCM.t(key) })); };
    withLanguage(label);
    onSettingsChanged(label);
    title.prepend(seg);
  }

  // ---------- 工具栏上的 MarkTeX 菜单：与扩展弹窗中“复制选中内容”一组相同的条目、图标和快捷键 ----------
  const MENU = [
    { header: 'popup.groupCopy' },
    { action: 'markdown', text: 'Markdown', tile: 'blue', icon: 'fmt-markdown' },
    { action: 'html', label: 'popup.rowHtml', tile: 'orange', icon: 'fmt-html' },
    { action: 'html-source', label: 'popup.rowHtmlSource', tile: 'gray', icon: 'fmt-source' },
    null,
    { action: 'native', label: 'pdf.openNative', tile: 'indigo', icon: 'open-native' },
  ];

  // 工具栏中弹出框的关闭方法（按钮 → close），供下面的 managePopovers 使用
  const popoverClose = new Map();

  function buildToolbar() {
    const right = $('toolbarViewerRight');
    if (!right || $('marktexButton')) return;
    // 与其他工具栏按钮相同的结构：.toolbarButtonWithContainer 中的按钮与弹出框；按钮只显示扩展图标
    const wrap = make('div', { id: 'marktexMenuContainer', className: 'toolbarButtonWithContainer marktex-menu-wrap' });
    const btn = make('button', { id: 'marktexButton', type: 'button', className: 'toolbarButton', title: 'MarkTeX Copy' });
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'marktexMenu');
    btn.append(make('span', { textContent: 'MarkTeX Copy' }));
    const menu = make('div', { id: 'marktexMenu', className: 'marktex-menu', hidden: true });
    menu.setAttribute('role', 'menu');
    const render = (shortcuts = {}) => {
      menu.textContent = '';
      for (const it of MENU) {
        if (!it) {
          menu.appendChild(make('div', { className: 'marktex-sep' }));
        } else if (it.header) {
          menu.appendChild(make('div', { className: 'marktex-menu-title', textContent: CCM.t(it.header) }));
        } else {
          const b = make('button', { type: 'button' });
          b.setAttribute('role', 'menuitem');
          b.dataset.action = it.action;
          const tile = make('span', { className: `marktex-tile tile-${it.tile}` });
          tile.dataset.icon = it.icon;
          const key = shortcuts[it.action] ? CCM.shortcutLabel(shortcuts[it.action]) : '';
          b.append(tile, make('span', { className: 'marktex-item-label', textContent: it.text || CCM.t(it.label) }), make('span', { className: 'marktex-kbd', textContent: key }));
          menu.appendChild(b);
        }
      }
    };
    const update = () => {
      try {
        chrome.storage.sync.get({ shortcuts: CCM.DEFAULTS && CCM.DEFAULTS.shortcuts }, (s) => render(s.shortcuts || {}));
      } catch (_) { render(); }
    };
    const setOpen = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
    popoverClose.set(btn, () => setOpen(false));
    withLanguage(update);
    onSettingsChanged(update);

    wrap.addEventListener('mousedown', (e) => e.preventDefault()); // 点击菜单时不清除页面中的选区
    btn.addEventListener('click', () => setOpen(menu.hidden));
    menu.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      setOpen(false);
      if (b.dataset.action === 'native') openNative();
      else if (CCM.copyFormat) CCM.copyFormat(b.dataset.action);
    });
    // 键盘操作：在按钮上按 ↓ / ↑ 打开菜单，菜单中用 ↓ / ↑ 移动（只在用键盘时移动焦点，鼠标点击不改变焦点和页面选区）
    const focusItem = (step) => {
      const items = Array.from(menu.querySelectorAll('button'));
      const i = items.indexOf(document.activeElement);
      const n = items.length;
      items[i < 0 ? (step > 0 ? 0 : n - 1) : (i + step + n) % n].focus();
    };
    wrap.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      setOpen(true);
      focusItem(e.key === 'ArrowDown' ? 1 : -1);
    });
    wrap.append(btn, menu);
    right.insertBefore(wrap, right.firstChild);

    // 搜索按钮（连同查找栏）移到右侧、MarkTeX 按钮之前
    const find = $('viewFindButton');
    const findWrap = find && find.closest('.toolbarButtonWithContainer');
    if (findWrap) {
      findWrap.classList.add('marktex-find');
      right.insertBefore(findWrap, wrap);
    }
    // 查找栏：第一行是输入框、上一个 / 下一个和结果数，第二行是各个选项
    const opt1 = $('findbarOptionsOneContainer');
    const opt2 = $('findbarOptionsTwoContainer');
    if (opt1 && opt2) {
      const box = make('div', { id: 'marktexFindOptions' });
      opt1.before(box);
      box.append(opt1, opt2);
    }
  }

  // ---------- 工具栏中的弹出框：MarkTeX 菜单、查找栏、更多菜单、批注工具的参数面板 ----------
  // 同一时刻只展开一个；在框外按下鼠标（页面、侧栏、工具栏的其他位置）或按 Esc 时收起。
  // 批注工具（高亮、文字、画笔、图片等）同时是一种模式：收起的只是参数面板，工具仍然选中（按钮保持高亮），
  // 可以继续在页面上书写；这时再点按钮重新展开面板，面板展开时点按钮则退出工具（与 PDF.js 相同）。
  function managePopovers(app) {
    const boxes = Array.from(document.querySelectorAll('#toolbarViewerRight button[aria-controls]')).map((button) => ({
      button,
      panel: $(button.getAttribute('aria-controls')),
      root: button.closest('.toolbarButtonWithContainer') || button.parentElement,
      tool: /^editor\w+Button$/.test(button.id),
    })).filter((b) => b.panel);
    const isOpen = (b) => b.button.getAttribute('aria-expanded') === 'true';
    const close = (b) => {
      if (!isOpen(b)) return;
      if (b.tool) {
        b.panel.classList.add('hidden');
        b.button.setAttribute('aria-expanded', 'false');
      } else if (popoverClose.has(b.button)) {
        popoverClose.get(b.button)();
      } else if (b.button.id === 'viewFindButton' && app.findBar) {
        app.findBar.close();
      } else if (b.button.id === 'secondaryToolbarToggleButton' && app.secondaryToolbar) {
        app.secondaryToolbar.close();
      } else {
        b.button.click();
      }
    };

    // 展开一个时收起其他的（包括用 Ctrl+F 等快捷键、键盘操作打开的情况）
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        const opened = boxes.find((b) => b.button === r.target && isOpen(b));
        if (opened) for (const b of boxes) if (b !== opened) close(b);
      }
    });
    for (const b of boxes) observer.observe(b.button, { attributes: true, attributeFilter: ['aria-expanded'] });

    document.addEventListener('pointerdown', (e) => {
      for (const b of boxes) if (isOpen(b) && !b.root.contains(e.target)) close(b);
    }, true);

    // 工具仍然选中、面板已收起时点按钮：重新展开面板（PDF.js 原本会退出工具）
    document.addEventListener('click', (e) => {
      const b = boxes.find((x) => x.tool && x.button.contains(e.target));
      if (!b || isOpen(b) || !b.button.classList.contains('toggled')) return;
      e.stopImmediatePropagation();
      b.panel.classList.remove('hidden');
      b.button.setAttribute('aria-expanded', 'true');
    }, true);

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      for (const b of boxes) {
        if (!isOpen(b)) continue;
        if (b.panel.contains(document.activeElement)) b.button.focus();
        close(b);
      }
    }, true);
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
      managePopovers(app);
      buildSidebarViews();
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
