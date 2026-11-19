// 阅读器导航：中键自动滚动，以及不打断手动浏览的大纲定位。
(() => {
  const CCM = (globalThis.__CCM = globalThis.__CCM || {});
  const $ = (id) => document.getElementById(id);
  const installed = new WeakSet();

  function installAutoscroll(app) {
    let active = null;
    let frame = 0;
    let middlePort = null;
    const root = document.documentElement;
    const stop = () => {
      if (!active) return;
      cancelAnimationFrame(frame);
      active.marker.remove();
      delete active.port.dataset.marktexAutoscroll;
      active = null;
      root.classList.remove('marktex-autoscrolling');
      root.style.removeProperty('--mt-scroll-cursor');
    };
    CCM.stopPdfAutoscroll = stop;
    const speed = (distance) => Math.sign(distance) * Math.min(2.4, Math.pow(Math.max(0, Math.abs(distance) - 10), 1.3) / 350);
    const tick = (time) => {
      if (!active) return;
      const a = active;
      if (!a.port.isConnected || !a.port.clientHeight) { stop(); return; }
      const dt = Math.min(40, time - a.time || 16);
      a.time = time;
      const dx = a.horizontal ? speed(a.x - a.startX) : 0;
      const dy = a.vertical ? speed(a.y - a.startY) : 0;
      a.port.scrollBy({ left: dx * dt, top: dy * dt, behavior: 'instant' });
      const cursor = dx && dy ? 'all-scroll' : dx ? 'ew-resize' : dy ? 'ns-resize' : 'all-scroll';
      if (root.style.getPropertyValue('--mt-scroll-cursor') !== cursor) root.style.setProperty('--mt-scroll-cursor', cursor);
      frame = requestAnimationFrame(tick);
    };
    const consume = (event) => { event.preventDefault(); event.stopImmediatePropagation(); };
    document.addEventListener('pointerdown', (event) => {
      if (active) { if (event.button === 1) middlePort = active.port; stop(); consume(event); return; }
      middlePort = null;
      if (event.button !== 1 || event.pointerType !== 'mouse' || app.pdfViewer?.isInPresentationMode) return;
      const port = event.target.closest('#viewsManagerContent, #viewerContainer');
      if (!port || event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      const horizontal = port.scrollWidth > port.clientWidth + 1;
      const vertical = port.scrollHeight > port.clientHeight + 1;
      if (!horizontal && !vertical) return;
      const marker = document.createElement('div');
      marker.className = 'marktex-scroll-origin';
      marker.setAttribute('aria-hidden', 'true');
      marker.dataset.axes = horizontal && vertical ? 'both' : horizontal ? 'horizontal' : 'vertical';
      marker.style.left = `${event.clientX}px`;
      marker.style.top = `${event.clientY}px`;
      document.body.append(marker);
      active = { port, marker, horizontal, vertical, startX: event.clientX, startY: event.clientY,
        x: event.clientX, y: event.clientY, time: 0, dragged: false, released: false };
      port.dataset.marktexAutoscroll = 'true';
      middlePort = port;
      root.classList.add('marktex-autoscrolling');
      frame = requestAnimationFrame(tick);
      consume(event); // 不让中键变成打开链接、绘图或浏览器自己的自动滚动。
    }, true);
    document.addEventListener('pointermove', (event) => {
      if (!active) return;
      active.x = event.clientX;
      active.y = event.clientY;
      if (!active.released && Math.hypot(active.x - active.startX, active.y - active.startY) > 10) active.dragged = true;
    }, true);
    document.addEventListener('pointerup', (event) => {
      if (!active || event.button !== 1) return;
      if (active.dragged) stop(); // 按住中键拖动：松开即停止；单击中键：保持自动滚动。
      else active.released = true;
      consume(event);
    }, true);
    document.addEventListener('auxclick', (event) => {
      if (event.button === 1 && middlePort?.contains(event.target)) consume(event);
      middlePort = null;
    }, true);
    document.addEventListener('keydown', (event) => {
      if (!active) return;
      stop();
      if (event.key === 'Escape') consume(event);
    }, true);
    document.addEventListener('wheel', stop, { capture: true, passive: true });
    window.addEventListener('blur', stop);
    window.addEventListener('pagehide', stop);
    document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
    app.eventBus.on('pagesinit', stop);
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

  function installOutlineFollow(app) {
    const tree = $('outlinesView'), panel = $('viewsManagerContent'), viewer = $('viewerContainer');
    const locate = $('viewsManagerCurrentOutlineButton');
    if (!tree || !panel || !viewer || !locate) return;
    let doc = null, entries = [], current = null, paused = false, frame = 0;
    const byAnchor = new Map();
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
      if (!entry || !isVisible()) return;
      for (let node = entry.anchor.parentElement.parentElement; node && node !== tree; node = node.parentElement) {
        if (node.classList.contains('treeItem')) node.querySelector(':scope > .treeItemToggler')?.classList.remove('treeItemsHidden');
      }
      const item = entry.anchor.getBoundingClientRect(), bounds = panel.getBoundingClientRect();
      if (item.top < bounds.top + 8) panel.scrollTop += item.top - bounds.top - 8;
      else if (item.bottom > bounds.bottom - 48) panel.scrollTop += item.bottom - bounds.bottom + 48;
    };
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
      mark(outlineAt(entries, page, offset));
      if (force || (!paused && panel.dataset.marktexAutoscroll !== 'true')) reveal(current);
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
      doc = pdf; entries = []; byAnchor.clear(); mark(null); paused = false;
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
    const resume = () => { paused = false; schedule(); };
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
    locate.addEventListener('click', (event) => {
      if (!entries.length) return;
      event.preventDefault(); event.stopImmediatePropagation(); paused = false; update(true);
    }, true);
    viewer.addEventListener('scroll', schedule, { passive: true });
    for (const name of ['pagechanging', 'updateviewarea', 'sidebarviewchanged', 'scalechanging']) app.eventBus.on(name, schedule);
    app.eventBus.on('rotationchanging', reindexPositions);
    app.eventBus.on('pagesinit', () => { doc = app.pdfDocument; entries = []; byAnchor.clear(); mark(null); });
    app.eventBus.on('outlineloaded', () => { rebuild().catch((error) => console.warn('[marktex-copy] outline navigation', error)); });
  }

  CCM.installPdfNavigation = (app) => {
    if (installed.has(app)) return;
    installed.add(app);
    installAutoscroll(app);
    installOutlineFollow(app);
  };
  CCM._pdfNavigationDebug = { outlineAt };
})();
