(() => {
  const CCM = (globalThis.__CCM = globalThis.__CCM || {});

  CCM.DEFAULTS = {
    inlineDelim: 'dollar',   // 'dollar' => $...$   | 'paren'   => \(...\)
    displayDelim: 'dollar',  // 'dollar' => $$...$$ | 'bracket' => \[...\]
    htmlMath: 'latex',       // 'latex' => 公式输出为 LaTeX 文本 | 'mathml' => 输出 MathML（带 LaTeX 注释）
    escapeMarkdown: true,
    appendSource: false,
    showToast: true,
    language: 'auto',        // 'auto' 跟随浏览器 | 'zh' | 'en'
    openPdfInViewer: false,  // 自动用内置 PDF.js 阅读器打开 PDF；默认仍用浏览器自带阅读器，需要时再切换
    imageLimit: true,        // 复制 PDF 中的图片时限制大小，超过上限自动压缩；关闭则不压缩（无损 PNG）
    imageMaxKB: 100,         // 图片大小上限（内嵌数据的长度，KB）
    // 页面内快捷键（null 表示未设置）。有选区时触发插件复制，没有选区时按键照常传给页面
    shortcuts: {
      markdown: { code: 'KeyM', key: 'M', ctrl: false, alt: true, shift: true, meta: false },
      html: { code: 'KeyH', key: 'H', ctrl: false, alt: true, shift: true, meta: false },
      'html-source': null,
    },
  };

  CCM.delims = (s) => ({
    inline: s.inlineDelim === 'paren' ? ['\\(', '\\)'] : ['$', '$'],
    display: s.displayDelim === 'bracket' ? ['\\[', '\\]'] : ['$$', '$$'],
  });

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  CCM.shortcutLabel = (k) => {
    if (!k) return '';
    const parts = [];
    if (isMac) {
      if (k.ctrl) parts.push('⌃');
      if (k.alt) parts.push('⌥');
      if (k.shift) parts.push('⇧');
      if (k.meta) parts.push('⌘');
      return parts.join('') + k.key;
    }
    if (k.ctrl) parts.push('Ctrl');
    if (k.alt) parts.push('Alt');
    if (k.shift) parts.push('Shift');
    if (k.meta) parts.push('Win');
    parts.push(k.key);
    return parts.join('+');
  };

  CCM.shortcutMatches = (e, k) => !!k && e.code === k.code && !!e.ctrlKey === !!k.ctrl &&
    !!e.altKey === !!k.alt && !!e.shiftKey === !!k.shift && !!e.metaKey === !!k.meta;
})();
