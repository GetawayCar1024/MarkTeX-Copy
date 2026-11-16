(() => {
  const CCM = (globalThis.__CCM = globalThis.__CCM || {});
  if (CCM.t) return;

  const MESSAGES = {
    zh: {
      'label.markdown': 'Markdown',
      'label.html': 'HTML',
      'label.html-source': 'HTML 源码',

      'menu.markdown': '复制为 Markdown',
      'menu.html': '复制为 HTML',
      'menu.html-source': '复制为 HTML 源码',
      'menu.formula': '复制公式 LaTeX',

      'toast.copied': '✓ 已复制 {label}',
      'toast.withMath': ' · {n} 个公式',
      'toast.empty': '未选中内容',
      'toast.noFormula': '此处没有公式',
      'toast.formulaCopied': '✓ 已复制 LaTeX',
      'toast.failed': '复制失败：{msg}',
      'toast.clipboardFailed': '无法写入剪贴板',
      'toast.pdfNative': '自带阅读器不支持带格式复制',
      'toast.openInReader': '用 MarkTeX 打开',
      'toast.dismiss': '取消',
      'toast.pdfMath': '公式无法还原，已按文字复制',
      'toast.pdfMathRebuilt': '公式为推断结果，请核对',
      'toast.readingPages': '正在读取 {n} 页…',
      'source': '来源',

      'popup.subtitle': '复制网页与 PDF，保留公式',
      'popup.groupCopy': '复制选中内容',
      'popup.rowHtml': 'HTML 富文本',
      'popup.rowHtmlSource': 'HTML 源码',
      'popup.openPdf': '用 MarkTeX 打开',
      'popup.preview': '预览',
      'popup.previewMeta': '{label} · {n} 字符',
      'popup.groupMath': '公式',
      'popup.inline': '行内公式',
      'popup.display': '块级公式',
      'popup.htmlMath': 'HTML 中的公式',
      'popup.footMath': 'MathML 可在 Word 中编辑。',
      'popup.groupKeys': '快捷键',
      'popup.keyUnset': '未设置',
      'popup.keyRecording': '请按键…',
      'popup.keyClear': '清除',
      'popup.keyHint': '点击后按组合键，Esc 取消。',
      'popup.keyNeedMod': '需含 Ctrl、Alt 或 ⌘（F1–F12 可单独使用）。',
      'popup.keyCopyHint': '{key} 在未选中内容时仍为普通复制。',
      'popup.groupGeneral': '通用',
      'popup.escape': '转义 Markdown 字符',
      'popup.appendSource': '附加来源链接',
      'popup.showToast': '显示复制提示',
      'popup.pdfReader': '默认用 MarkTeX 打开 PDF',
      'popup.language': '语言',
      'popup.langAuto': '自动',
      'popup.cannotRun': '此页面不允许运行扩展',
      'popup.error': '出错：{msg}',
      'popup.empty': '未选中内容',
      'popup.clipFail': '无法写入剪贴板：{msg}',
      'popup.copied': '已复制为 {label}',
      'popup.withMath': '，{n} 个公式',

      'pdf.loadError': '无法打开此 PDF',
      'pdf.fetchFailed': '无法读取此 PDF',
      'pdf.needFileAccess': '请在扩展详情中开启「允许访问文件网址」',
      'pdf.openSettings': '打开设置',
      'pdf.openNative': '用自带阅读器打开',
      'pdf.fitPage': '适合页面',
      'pdf.fitWidth': '适合页宽',
      'notify.title': 'MarkTeX Copy',
    },
    en: {
      'label.markdown': 'Markdown',
      'label.html': 'HTML',
      'label.html-source': 'HTML source',

      'menu.markdown': 'Copy as Markdown',
      'menu.html': 'Copy as HTML',
      'menu.html-source': 'Copy as HTML source',
      'menu.formula': 'Copy formula LaTeX',

      'toast.copied': '✓ Copied {label}',
      'toast.withMath': ' · {n} formulas',
      'toast.empty': 'Nothing selected',
      'toast.noFormula': 'No formula here',
      'toast.formulaCopied': '✓ Copied LaTeX',
      'toast.failed': 'Copy failed: {msg}',
      'toast.clipboardFailed': "Couldn't write to the clipboard",
      'toast.pdfNative': "Built-in viewer can't copy formatting",
      'toast.openInReader': 'Open in MarkTeX',
      'toast.dismiss': 'Cancel',
      'toast.pdfMath': "Formulas not recovered; copied as text",
      'toast.pdfMathRebuilt': 'Formulas inferred; please check',
      'toast.readingPages': 'Reading {n} pages…',
      'source': 'Source',

      'popup.subtitle': 'Copy web pages and PDFs with formulas',
      'popup.groupCopy': 'Copy selection',
      'popup.rowHtml': 'HTML (rich text)',
      'popup.rowHtmlSource': 'HTML source',
      'popup.openPdf': 'Open in MarkTeX',
      'popup.preview': 'Preview',
      'popup.previewMeta': '{label} · {n} chars',
      'popup.groupMath': 'Formulas',
      'popup.inline': 'Inline',
      'popup.display': 'Display',
      'popup.htmlMath': 'Formulas in HTML',
      'popup.footMath': 'MathML stays editable in Word.',
      'popup.groupKeys': 'Shortcuts',
      'popup.keyUnset': 'Not set',
      'popup.keyRecording': 'Press keys…',
      'popup.keyClear': 'Clear',
      'popup.keyHint': 'Click, then press keys. Esc cancels.',
      'popup.keyNeedMod': 'Include Ctrl, Alt or ⌘ (F1–F12 work alone).',
      'popup.keyCopyHint': '{key} still copies normally without a selection.',
      'popup.groupGeneral': 'General',
      'popup.escape': 'Escape Markdown characters',
      'popup.appendSource': 'Append source link',
      'popup.showToast': 'Show copy toast',
      'popup.pdfReader': 'Open PDFs in MarkTeX',
      'popup.language': 'Language',
      'popup.langAuto': 'Auto',
      'popup.cannotRun': "Extensions can't run on this page",
      'popup.error': 'Error: {msg}',
      'popup.empty': 'Nothing selected',
      'popup.clipFail': "Couldn't write to the clipboard: {msg}",
      'popup.copied': 'Copied as {label}',
      'popup.withMath': ' · {n} formulas',

      'pdf.loadError': "Couldn't open this PDF",
      'pdf.fetchFailed': "Couldn't read this PDF",
      'pdf.needFileAccess': 'Enable “Allow access to file URLs” in the extension details',
      'pdf.openSettings': 'Open settings',
      'pdf.openNative': 'Open in built-in viewer',
      'pdf.fitPage': 'Fit to page',
      'pdf.fitWidth': 'Fit to width',
      'notify.title': 'MarkTeX Copy',
    },
  };

  function uiLanguage() {
    try {
      if (globalThis.chrome && chrome.i18n && chrome.i18n.getUILanguage) return chrome.i18n.getUILanguage();
    } catch (_) { /* ignore */ }
    return (globalThis.navigator && navigator.language) || 'en';
  }

  CCM.resolveLang = (setting) => {
    if (setting === 'zh' || setting === 'en') return setting;
    return /^zh/i.test(uiLanguage()) ? 'zh' : 'en';
  };

  CCM.t = (key, vars, lang) => {
    const l = lang || CCM.resolveLang(CCM.currentLanguage);
    let s = (MESSAGES[l] && MESSAGES[l][key]) ?? MESSAGES.en[key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
    return s;
  };

  // currentLanguage 由各页面在读取设置后更新（'auto' | 'zh' | 'en'）
  CCM.currentLanguage = 'auto';
})();
