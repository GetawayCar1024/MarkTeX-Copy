// 批注共用 PDF.js 的一条撤销 / 重做历史；不另建只用于删除的历史或提示条。
(() => {
  const CCM = (globalThis.__CCM = globalThis.__CCM || {});
  const editable = (target) => target instanceof Element && (target.isContentEditable || !!target.closest('input, textarea, select'));
  function historyAction(event) {
    if (event.altKey || event.isComposing || !(event.ctrlKey || event.metaKey)) return null;
    const key = event.key.toLowerCase();
    if (key === 'z') return event.shiftKey ? 'redo' : 'undo';
    return key === 'y' && event.ctrlKey && !event.shiftKey ? 'redo' : null;
  }
  CCM.installPdfEditing = (app) => {
    const right = document.getElementById('toolbarViewerRight');
    if (!right || document.getElementById('marktexHistory')) return;
    const group = document.createElement('div');
    group.id = 'marktexHistory'; group.className = 'toolbarHorizontalGroup marktex-history'; group.setAttribute('role', 'group');
    const buttons = {};
    const announce = document.createElement('span');
    announce.className = 'visuallyHidden'; announce.setAttribute('role', 'status');
    const manager = () => app.pdfViewer?._layerProperties?.annotationEditorUIManager;
    let canUndo = false, canRedo = false, busy = false;
    const hasDraft = () => {
      const focused = document.activeElement;
      return !!(focused?.isContentEditable && focused.closest('.freeTextEditor') && focused.textContent.trim());
    };
    const sync = () => {
      // 第一条文字批注在失焦前还没进入 PDF.js 历史，但按钮也应能提交它并撤销。
      const draft = hasDraft();
      buttons.undo.disabled = busy || !manager() || !(canUndo || draft);
      buttons.redo.disabled = busy || !manager() || !canRedo || draft;
    };
    const run = async (action) => {
      const ui = manager();
      if (!ui || buttons[action].disabled) return;
      CCM.stopPdfAutoscroll?.();
      const draft = hasDraft();
      busy = true; sync();
      try {
        ui.endCurrentEditing();
        // 提交文字会异步建立浮动工具栏；等这一帧完成后再撤销，避免删除仍在初始化的编辑器。
        if (draft) await new Promise(requestAnimationFrame);
        if (manager() !== ui) return;
        ui[action]();
        announce.textContent = CCM.t(action === 'undo' ? 'pdf.undone' : 'pdf.redone');
      } finally {
        busy = false; sync();
      }
    };
    for (const action of ['undo', 'redo']) {
      const button = document.createElement('button');
      button.id = action === 'undo' ? 'marktexUndoButton' : 'marktexRedoButton';
      button.type = 'button'; button.className = 'toolbarButton'; button.disabled = true;
      button.setAttribute('aria-keyshortcuts', action === 'undo' ? 'Control+Z Meta+Z' : 'Control+Shift+Z Control+Y Meta+Shift+Z');
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', () => run(action));
      buttons[action] = button;
      group.append(button);
    }
    group.append(announce);
    const editors = document.getElementById('editorModeButtons');
    right.insertBefore(group, editors || document.getElementById('downloadButton'));
    const label = () => {
      const mac = /Mac|iPhone|iPad/.test(navigator.platform);
      group.setAttribute('aria-label', CCM.t('pdf.history'));
      buttons.undo.title = `${CCM.t('pdf.undo')} (${mac ? '⌘Z' : 'Ctrl+Z'})`;
      buttons.redo.title = `${CCM.t('pdf.redo')} (${mac ? '⇧⌘Z' : 'Ctrl+Shift+Z / Ctrl+Y'})`;
      for (const action of ['undo', 'redo']) buttons[action].setAttribute('aria-label', CCM.t(`pdf.${action}`));
    };
    label();
    try {
      chrome.storage.sync.get({ language: 'auto' }, ({ language }) => { CCM.currentLanguage = language; label(); });
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== 'sync' || !changes.language) return;
        CCM.currentLanguage = changes.language.newValue || 'auto';
        label();
      });
    } catch (_) { /* ignore */ }
    app.eventBus.on('editingstateschanged', ({ source, details }) => {
      if (source !== manager()) return;
      if ('hasSomethingToUndo' in details) canUndo = details.hasSomethingToUndo;
      if ('hasSomethingToRedo' in details) canRedo = details.hasSomethingToRedo;
      sync();
    });
    app.eventBus.on('pagesinit', () => { canUndo = canRedo = false; announce.textContent = ''; sync(); });
    document.addEventListener('input', (event) => { if (event.target instanceof Element && event.target.closest('.freeTextEditor')) sync(); }, true);
    document.addEventListener('focusin', sync);
    document.addEventListener('focusout', () => queueMicrotask(sync));
    // 直接阻止旧提示条显示，避免其 100ms 后抢走键盘焦点。
    if (app.editorUndoBar) {
      app.editorUndoBar.hide();
      app.editorUndoBar.show = () => app.editorUndoBar.hide();
    }
    window.addEventListener('keydown', (event) => {
      const action = historyAction(event);
      if (!action || editable(event.target) || app.overlayManager?.active || !manager()) return;
      event.preventDefault(); event.stopImmediatePropagation();
      run(action); // 阻止 PDF.js 的第二次处理；表单与正在输入的文字仍使用自己的撤销。
    }, true);
  };
  CCM._pdfEditingDebug = { historyAction };
})();
