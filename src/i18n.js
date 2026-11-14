(() => {
  const CCM = (globalThis.__CCM = globalThis.__CCM || {});
  if (CCM.t) return;

  const MESSAGES = {
    zh: {
      'label.markdown': 'Markdown',
      'label.html': 'HTML',
      'label.html-source': 'HTML 源码',

      'menu.markdown': '复制为 Markdown',
      'menu.html': '复制为 HTML（富文本）',
      'menu.html-source': '复制为 HTML 源码',
      'menu.formula': '复制此处公式的 LaTeX',

      'toast.copied': '✓ 已复制为 {label}',
      'toast.withMath': '（{n} 个公式）',
      'toast.empty': '未选中内容',
      'toast.noFormula': '此处没有公式',
      'toast.formulaCopied': '✓ 已复制公式 LaTeX',
      'toast.failed': '复制失败：{msg}',
      'toast.clipboardFailed': '无法写入剪贴板',
      'toast.pdfNative': '浏览器自带阅读器无法带格式复制',
      'toast.openInReader': '用 MarkTeX 打开',
      'toast.dismiss': '取消',
      'toast.pdfMath': '公式无法还原为 LaTeX，已按文字复制',
      'toast.pdfMathRebuilt': '公式由排版推断，请核对',
      'toast.readingPages': '正在读取全部 {n} 页…',
      'source': '来源',

      'popup.subtitle': '复制为 Markdown / HTML，保留公式',
      'popup.groupCopy': '复制选中内容',
      'popup.rowHtml': 'HTML 富文本',
      'popup.rowHtmlSource': 'HTML 源码',
      'popup.footCopy': '右键菜单中同样可用。',
      'popup.openPdf': '用 MarkTeX 阅读器打开',
      'popup.preview': '预览',
      'popup.previewMeta': '{label} · {n} 字符',
      'popup.groupMath': '公式',
      'popup.inline': '行内公式',
      'popup.display': '块级公式',
      'popup.htmlMath': 'HTML 中的公式',
      'popup.footMath': 'MathML 粘贴到 Word 后可编辑。',
      'popup.groupKeys': '快捷键',
      'popup.keyUnset': '未设置',
      'popup.keyRecording': '请按下快捷键…',
      'popup.keyClear': '清除',
      'popup.keyHint': '点击后按下组合键，Esc 取消。仅在有选中内容时生效。',
      'popup.keyNeedMod': '需包含 Ctrl、Alt 或 ⌘（F1–F12 除外）。',
      'popup.keyCopyHint': '已设为 {key}，未选中内容时为原生复制。',
      'popup.groupGeneral': '通用',
      'popup.escape': '转义 Markdown 特殊字符',
      'popup.appendSource': '末尾附加来源链接',
      'popup.showToast': '复制后显示提示',
      'popup.pdfReader': '默认用 MarkTeX 打开 PDF',
      'popup.footPdf': '浏览器自带阅读器无法带格式复制。',
      'popup.language': '语言',
      'popup.langAuto': '自动',
      'popup.cannotRun': '此页面不允许运行扩展',
      'popup.error': '出错：{msg}',
      'popup.empty': '未选中内容',
      'popup.clipFail': '无法写入剪贴板：{msg}',
      'popup.copied': '已复制为 {label}',
      'popup.withMath': '，{n} 个公式',

      'pdf.loadError': 'MarkTeX 阅读器无法打开此 PDF',
      'pdf.fetchFailed': '无法读取此 PDF',
      'pdf.needFileAccess': '需在扩展详情中开启「允许访问文件网址」',
      'pdf.openSettings': '打开设置',
      'pdf.openNative': '用浏览器自带阅读器打开',
      'notify.title': 'MarkTeX Copy',
    },
    en: {
      'label.markdown': 'Markdown',
      'label.html': 'HTML',
      'label.html-source': 'HTML source',

      'menu.markdown': 'Copy as Markdown',
      'menu.html': 'Copy as HTML (rich text)',
      'menu.html-source': 'Copy as HTML source',
      'menu.formula': 'Copy LaTeX of this formula',

      'toast.copied': '✓ Copied as {label}',
      'toast.withMath': ' ({n} formulas)',
      'toast.empty': 'Nothing selected',
      'toast.noFormula': 'No formula here',
      'toast.formulaCopied': '✓ Copied formula LaTeX',
      'toast.failed': 'Copy failed: {msg}',
      'toast.clipboardFailed': "Couldn't write to the clipboard",
      'toast.pdfNative': "The browser's viewer can't copy formatting",
      'toast.openInReader': 'Open in MarkTeX',
      'toast.dismiss': 'Cancel',
      'toast.pdfMath': "Formulas couldn't be turned into LaTeX; copied as text",
      'toast.pdfMathRebuilt': 'Formulas inferred from layout; please check',
      'toast.readingPages': 'Reading all {n} pages…',
      'source': 'Source',

      'popup.subtitle': 'Copy as Markdown / HTML, formulas included',
      'popup.groupCopy': 'Copy selection',
      'popup.rowHtml': 'HTML (rich text)',
      'popup.rowHtmlSource': 'HTML source',
      'popup.footCopy': 'Also in the right-click menu.',
      'popup.openPdf': 'Open in MarkTeX reader',
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
      'popup.keyHint': 'Click, then press keys (Esc cancels). Only acts on a selection.',
      'popup.keyNeedMod': 'Must include Ctrl, Alt or ⌘ (F1–F12 excepted).',
      'popup.keyCopyHint': 'Set to {key}; native copy without a selection.',
      'popup.groupGeneral': 'General',
      'popup.escape': 'Escape Markdown characters',
      'popup.appendSource': 'Append source link',
      'popup.showToast': 'Show a toast after copying',
      'popup.pdfReader': 'Open PDFs in MarkTeX',
      'popup.footPdf': "The browser's viewer can't copy formatting.",
      'popup.language': 'Language',
      'popup.langAuto': 'Auto',
      'popup.cannotRun': "Extensions can't run on this page",
      'popup.error': 'Error: {msg}',
      'popup.empty': 'Nothing selected',
      'popup.clipFail': "Couldn't write to the clipboard: {msg}",
      'popup.copied': 'Copied as {label}',
      'popup.withMath': ' · {n} formulas',

      'pdf.loadError': "MarkTeX reader couldn't open this PDF",
      'pdf.fetchFailed': "Couldn't read this PDF",
      'pdf.needFileAccess': 'Enable “Allow access to file URLs” in the extension details',
      'pdf.openSettings': 'Open settings',
      'pdf.openNative': "Open in browser's viewer",
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
