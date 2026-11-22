// 阅读器导航：侧栏支持浏览器自带的中键滚动，以及可开关、不打断手动浏览的大纲自动跟随。
(() => {
  const CCM = (globalThis.__CCM = globalThis.__CCM || {});
  const $ = (id) => document.getElementById(id);
  const installed = new WeakSet();

  // 侧栏里几乎全是链接（大纲条目、缩略图），浏览器在链接上按中键时会打开新标签页而不是开始自动滚动。
  // 按下中键时暂时去掉链接的 href，让浏览器按普通区域处理（开始自带的中键滚动），之后再恢复。
  function installSidebarMiddleScroll() {
    const panel = $('viewsManagerContent');
    if (!panel) return;
    const held = new Map();
    let timer = 0;
    const restore = () => {
      clearTimeout(timer);
      timer = 0;
      for (const [a, href] of held) a.setAttribute('href', href);
      held.clear();
    };
    const restoreLater = () => { clearTimeout(timer); timer = setTimeout(restore, 0); };
    panel.addEventListener('pointerdown', (event) => {
      restore();
      if (event.button !== 1) return;
      const a = event.target.closest('a[href]');
      if (!a || !panel.contains(a)) return;
      held.set(a, a.getAttribute('href'));
      a.removeAttribute('href');
    }, true);
    for (const name of ['pointerup', 'auxclick', 'pointercancel']) document.addEventListener(name, restoreLater, true);
    window.addEventListener('blur', restore);
  }

  // 已按页码、页内位置排序的大纲；同一位置取更深的条目，尚未进入的下一节不能提前选中。
  function outlineAt(entries, page, offset) {
    let current = null;
    for (const entry of entries) {
      if (entry.page > page || (entry.page === page && entry.offset > offset + 0.002)) break;
      current = entry;
    }
    return current || (entries[0]?.page === page ? entries[0] : null);
  }

  // 把元素滚到容器中间；靠近开头或结尾时由滚动范围自然限制（停在顶部 / 底部）。
  // 相邻条目之间平滑过渡；跳转较远时直接定位，避免长时间的滚动动画
  function centerIn(container, el, smooth) {
    const item = el.getBoundingClientRect(), bounds = container.getBoundingClientRect();
    const max = container.scrollHeight - container.clientHeight;
    const target = Math.max(0, Math.min(max, container.scrollTop + (item.top + item.height / 2) - (bounds.top + bounds.height / 2)));
    const distance = Math.abs(target - container.scrollTop);
    if (distance >= 1) container.scrollTo({ top: target, behavior: smooth && distance < container.clientHeight / 2 ? 'smooth' : 'instant' });
  }

  // 页面缩略图：当前页同样尽量保持在侧栏中间（PDF.js 默认只在缩略图离开可见区域时才滚动）。
  // 手动浏览侧栏时（isPaused）不移动，与大纲的处理一致
  function installThumbnailFollow(app, isPaused) {
    const thumbs = app.pdfThumbnailViewer;
    if (!thumbs || thumbs.__marktexCentered || typeof thumbs.scrollThumbnailIntoView !== 'function') return;
    thumbs.__marktexCentered = true;
    const original = thumbs.scrollThumbnailIntoView.bind(thumbs);
    thumbs.scrollThumbnailIntoView = (pageNumber) => {
      const container = thumbs.scrollableContainer || $('viewsManagerContent');
      const before = container ? container.scrollTop : 0;
      const previous = thumbs._currentPageNumber;
      original(pageNumber);
      const div = thumbs._thumbnails?.[pageNumber - 1]?.div;
      if (!container || !div || !div.isConnected || !container.clientHeight) return;
      if (isPaused()) { container.scrollTop = before; return; }
      centerIn(container, div, previous !== pageNumber && Math.abs(previous - pageNumber) === 1);
    };
  }

  function installOutlineFollow(app) {
    const tree = $('outlinesView'), panel = $('viewsManagerContent'), viewer = $('viewerContainer');
    const locate = $('viewsManagerCurrentOutlineButton');
    if (!tree || !panel || !viewer || !locate) return;
    let doc = null, entries = [], current = null, paused = false, frame = 0;
    let follow = CCM.DEFAULTS ? CCM.DEFAULTS.outlineFollow !== false : true;
    const byAnchor = new Map();
    // 右下角的按钮切换“自动跟随”：开启时大纲随阅读位置滚动，当前章节保持在侧栏中间
    const render = () => {
      locate.setAttribute('aria-pressed', String(follow));
      const label = CCM.t ? CCM.t(follow ? 'pdf.followOn' : 'pdf.followOff') : '';
      if (label) { locate.title = label; locate.setAttribute('aria-label', label); }
      locate.removeAttribute('data-l10n-id');
      const span = locate.querySelector('span');
      if (span) { span.removeAttribute('data-l10n-id'); span.textContent = label; }
    };
    const setFollow = (on, save) => {
      follow = !!on;
      render();
      if (save) { try { chrome.storage.sync.set({ outlineFollow: follow }); } catch (_) { /* ignore */ } }
    };
    try {
      chrome.storage.sync.get({ outlineFollow: follow }, (s) => { setFollow(s.outlineFollow !== false, false); if (follow) schedule(); });
      chrome.storage.onChanged.addListener((c, area) => {
        if (area === 'sync' && c.outlineFollow) setFollow(c.outlineFollow.newValue !== false, false);
        if (area === 'sync' && c.language) setTimeout(render, 0);
      });
    } catch (_) { /* ignore */ }
    render();
    const isVisible = () => app.viewsManager?.isOpen && !tree.hidden && !tree.classList.contains('hidden');
    const mark = (entry) => {
      if (current === entry) return;
      current?.anchor.removeAttribute('aria-current');
      current?.anchor.parentElement?.classList.remove('selected');
      current = entry;
      if (!entry) return;
      // 与 PDF.js 的点击高亮保持一致，但不用它只按页码定位的算法。
      app.pdfOutlineViewer?._updateCurrentTreeItem?.(entry.anchor.parentElement);
      entry.anchor.parentElement.classList.add('selected');
      entry.anchor.setAttribute('aria-current', 'location');
    };
    const reveal = (entry) => {
      if (!entry || !isVisible()) return false;
      for (let node = entry.anchor.parentElement.parentElement; node && node !== tree; node = node.parentElement) {
        if (node.classList.contains('treeItem')) node.querySelector(':scope > .treeItemToggler')?.classList.remove('treeItemsHidden');
      }
      centerIn(panel, entry.anchor, smooth);
      return true;
    };
    let smooth = false;
    let pending = true; // 恢复跟随、切换到大纲视图或大纲加载后，即使章节未变也要定位一次
    const update = (force = false) => {
      if (doc !== app.pdfDocument || !entries.length) return;
      const edge = viewer.getBoundingClientRect().top + 24;
      let page = app.page || 1, offset = 0;
      for (const n of [page - 1, page, page + 1]) {
        const view = app.pdfViewer.getPageView(n - 1);
        if (!view?.div || !view.div.isConnected) continue;
        const bounds = view.div.getBoundingClientRect();
        if (bounds.top <= edge && bounds.bottom > edge) {
          page = n;
          offset = Math.max(0, Math.min(1, (edge - bounds.top) / bounds.height));
          break;
        }
      }
      const before = current;
      mark(outlineAt(entries, page, offset));
      // 只在当前章节变化（或手动定位）时滚动大纲，章节切换时平滑过渡
      if (force || (follow && !paused && (current !== before || pending))) {
        smooth = !force && !!before && !pending;
        if (reveal(current)) pending = false;
        smooth = false;
      }
    };
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => { frame = 0; update(); });
    };
    const reindexPositions = () => {
      for (const entry of entries) {
        const rotation = (entry.pdfPage.rotate + (app.pdfViewer.pagesRotation || 0)) % 360;
        const viewport = entry.pdfPage.getViewport({ scale: 1, rotation });
        entry.offset = !Number.isFinite(entry.y) ? 0 : Math.max(0, Math.min(1, viewport.convertToViewportPoint(entry.x, entry.y)[1] / viewport.height));
      }
      entries.sort((a, b) => a.page - b.page || a.offset - b.offset || a.depth - b.depth || a.order - b.order);
      schedule();
    };
    const rebuild = async () => {
      const pdf = app.pdfDocument;
      doc = pdf; entries = []; byAnchor.clear(); mark(null); paused = false; pending = true;
      if (!pdf) return;
      const outline = await pdf.getOutline();
      if (doc !== pdf || !outline) return;
      const anchors = [...tree.querySelectorAll('.treeItem > a')], flat = [];
      const visit = (items, depth) => {
        for (const item of items) { flat.push({ item, depth, order: flat.length }); visit(item.items || [], depth + 1); }
      };
      visit(outline, 0);
      const pages = new Map();
      const getPage = (n) => {
        if (!pages.has(n)) pages.set(n, pdf.getPage(n));
        return pages.get(n);
      };
      const resolved = await Promise.all(flat.map(async ({ item, depth, order }) => {
        try {
          const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
          if (!Array.isArray(dest) || !anchors[order]) return null;
          const page = Number.isInteger(dest[0]) ? dest[0] + 1 : (await pdf.getPageIndex(dest[0])) + 1;
          const pdfPage = await getPage(page), type = dest[1]?.name;
          const y = type === 'XYZ' ? dest[3] : type === 'FitH' || type === 'FitBH' ? dest[2] : type === 'FitR' ? dest[5] : null;
          const x = (type === 'XYZ' || type === 'FitR') && Number.isFinite(dest[2]) ? dest[2] : pdfPage.view[0];
          return { anchor: anchors[order], dest: item.dest, page, pdfPage, x, y, depth, order };
        } catch (_) { return null; } // 外部链接、损坏的目的地不影响其余条目。
      }));
      if (doc !== pdf || app.pdfDocument !== pdf) return;
      entries = resolved.filter(Boolean);
      for (const entry of entries) byAnchor.set(entry.anchor, entry);
      locate.disabled = !entries.length;
      reindexPositions();
    };
    const pause = () => { paused = true; };
    panel.addEventListener('wheel', pause, { passive: true });
    panel.addEventListener('pointerdown', pause, true);
    panel.addEventListener('keydown', (event) => { if (/^(Arrow|Page|Home|End)/.test(event.key)) pause(); });
    const resume = () => { if (paused) pending = true; paused = false; schedule(); };
    viewer.addEventListener('wheel', resume, { passive: true });
    viewer.addEventListener('pointerdown', resume, true);
    $('toolbarContainer')?.addEventListener('pointerdown', (event) => { if (!panel.contains(event.target)) resume(); }, true);
    tree.addEventListener('click', (event) => {
      const anchor = event.target.closest('.treeItem > a'), entry = byAnchor.get(anchor);
      if (!entry || event.button !== 0) return;
      event.preventDefault(); event.stopImmediatePropagation();
      paused = false; mark(entry);
      app.pdfLinkService.goToDestination(entry.dest);
    }, true);
    // 按钮：开关自动跟随；打开时立即定位到当前章节
    locate.addEventListener('click', (event) => {
      event.preventDefault(); event.stopImmediatePropagation();
      setFollow(!follow, true);
      if (follow && entries.length) { paused = false; update(true); }
    }, true);
    viewer.addEventListener('scroll', schedule, { passive: true });
    app.eventBus.on('sidebarviewchanged', () => { pending = true; schedule(); });
    for (const name of ['pagechanging', 'updateviewarea', 'scalechanging']) app.eventBus.on(name, schedule);
    app.eventBus.on('rotationchanging', reindexPositions);
    app.eventBus.on('pagesinit', () => { doc = app.pdfDocument; entries = []; byAnchor.clear(); mark(null); });
    app.eventBus.on('outlineloaded', () => { rebuild().catch((error) => console.warn('[marktex-copy] outline navigation', error)); });
    installThumbnailFollow(app, () => paused);
  }

  CCM.installPdfNavigation = (app) => {
    if (installed.has(app)) return;
    installed.add(app);
    installSidebarMiddleScroll();
    installOutlineFollow(app);
  };
  CCM._pdfNavigationDebug = { outlineAt };
})();
