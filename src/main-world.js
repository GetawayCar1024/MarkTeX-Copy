// 运行在页面主世界（MAIN world），用于读取页面上 MathJax 对象中保存的 TeX 源码。
// MathJax v3/v4 渲染后 DOM 中不再保留 TeX，只能通过 MathJax.startup.document 拿到。
(() => {
  if (window.__ccmMainWorldReady) return;
  Object.defineProperty(window, '__ccmMainWorldReady', { value: true });

  function lookup(el) {
    const MJ = window.MathJax;
    if (!MJ || typeof MJ !== 'object') return null;
    try {
      const doc = MJ.startup && MJ.startup.document;
      if (doc && doc.math && typeof doc.math[Symbol.iterator] === 'function') {
        for (const item of doc.math) {
          const root = item.typesetRoot;
          if (!root || (root !== el && !(root.contains && root.contains(el)))) continue;
          const name = item.inputJax && item.inputJax.name;
          if (name && name !== 'TeX') return null;
          return { tex: String(item.math), display: !!item.display };
        }
      }
    } catch (_) { /* ignore */ }
    try {
      // MathJax v2
      if (MJ.Hub && typeof MJ.Hub.getJaxFor === 'function') {
        const jax = MJ.Hub.getJaxFor(el);
        if (jax && /tex/i.test(String(jax.inputJax || ''))) {
          return { tex: String(jax.originalText), display: !!(jax.root && jax.root.display === 'block') };
        }
      }
    } catch (_) { /* ignore */ }
    return null;
  }

  document.addEventListener('__ccm_query_tex', (e) => {
    const el = e.target;
    e.stopImmediatePropagation();
    let res = null;
    try { res = lookup(el); } catch (_) { /* ignore */ }
    el.dispatchEvent(new CustomEvent('__ccm_tex_result', { detail: res ? JSON.stringify(res) : '' }));
  }, true);
})();
