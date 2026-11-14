const CCM = globalThis.__CCM;
const CONTENT_FILES = [
  'src/settings.js', 'src/i18n.js', 'src/mathml2latex.js', 'src/capture.js',
  'src/markdown.js', 'src/html.js', 'src/pdf-text.js', 'src/content.js',
];
const FORMATS = ['markdown', 'html', 'html-source'];
const EXT_ORIGIN = chrome.runtime.getURL('');
const VIEWER_URL = chrome.runtime.getURL('vendor/pdfjs/web/viewer.html');

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const t = (k, v) => CCM.t(k, v);

let settings = { ...CCM.DEFAULTS };

// ---------- 文案 ----------
function applyI18n() {
  CCM.currentLanguage = settings.language;
  const lang = CCM.resolveLang(settings.language);
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  for (const el of $$('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const b of $$('[data-clear]')) { b.title = t('popup.keyClear'); b.setAttribute('aria-label', t('popup.keyClear')); }
  if (!recording) hint(t('popup.keyHint'));
}

// ---------- 提示条 ----------
let bannerTimer = 0;
function banner(text, ok) {
  const el = $('#banner');
  el.textContent = text;
  el.className = 'banner ' + (ok ? 'ok' : 'err');
  el.hidden = false;
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => { el.hidden = true; }, ok ? 2600 : 4000);
}

function save(patch) {
  Object.assign(settings, patch);
  return chrome.storage.sync.set(patch);
}

// ---------- 设置项 ----------
function renderSegments() {
  for (const seg of $$('.seg')) {
    const value = settings[seg.dataset.name];
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('active', b.dataset.value === value);
  }
}

function bindSettings() {
  for (const seg of $$('.seg')) {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      save({ [seg.dataset.name]: b.dataset.value });
      renderSegments();
      if (seg.dataset.name === 'language') {
        applyI18n();
        renderShortcuts();
      }
    });
  }
  for (const input of $$('input.switch')) {
    input.checked = !!settings[input.name];
    input.addEventListener('change', () => save({ [input.name]: input.checked }));
  }
}

// ---------- 快捷键 ----------
let recording = null;

function renderShortcuts() {
  const map = settings.shortcuts || {};
  for (const f of FORMATS) {
    const k = map[f];
    const btn = document.querySelector(`.key[data-format="${f}"]`);
    if (btn !== recording) {
      btn.textContent = k ? CCM.shortcutLabel(k) : t('popup.keyUnset');
      btn.classList.toggle('empty', !k);
      btn.classList.remove('recording');
    }
    document.querySelector(`[data-clear="${f}"]`).hidden = !k;
    document.querySelector(`[data-shortcut-label="${f}"]`).textContent = k ? CCM.shortcutLabel(k) : '';
  }
}

function hint(text, warn) {
  const el = $('#keyHint');
  el.textContent = text;
  el.classList.toggle('warn', !!warn);
}

function stopRecording() {
  recording = null;
  hint(t('popup.keyHint'));
  renderShortcuts();
}

const CODE_LABELS = {
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', Space: 'Space', Enter: 'Enter', Tab: 'Tab',
  ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Insert: 'Ins', Delete: 'Del',
  Home: 'Home', End: 'End', PageUp: 'PgUp', PageDown: 'PgDn',
};

function keyLabel(e) {
  let m;
  if ((m = e.code.match(/^Key([A-Z])$/))) return m[1];
  if ((m = e.code.match(/^(?:Digit|Numpad)(\d)$/))) return m[1];
  if (/^F\d{1,2}$/.test(e.code)) return e.code;
  if (CODE_LABELS[e.code]) return CODE_LABELS[e.code];
  return e.key.length === 1 ? e.key.toUpperCase() : e.key;
}

const sameKey = (a, b) => !!a && !!b && a.code === b.code && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt &&
  !!a.shift === !!b.shift && !!a.meta === !!b.meta;

async function setShortcut(format, k) {
  const map = { ...(settings.shortcuts || {}) };
  map[format] = k;
  if (k) for (const f of FORMATS) if (f !== format && sameKey(map[f], k)) map[f] = null;
  await save({ shortcuts: map });
}

function bindShortcuts() {
  for (const btn of $$('.key')) {
    btn.addEventListener('click', () => {
      if (recording === btn) return stopRecording();
      if (recording) stopRecording();
      recording = btn;
      btn.textContent = t('popup.keyRecording');
      btn.classList.add('recording');
      btn.classList.remove('empty');
    });
  }
  for (const b of $$('[data-clear]')) {
    b.addEventListener('click', async () => {
      if (recording) stopRecording();
      await setShortcut(b.dataset.clear, null);
      renderShortcuts();
    });
  }

  document.addEventListener('keydown', async (e) => {
    if (!recording) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return stopRecording();
    if (['Control', 'Alt', 'Shift', 'Meta', 'AltGraph', 'CapsLock', 'OS', 'Fn'].includes(e.key)) return;
    const isFn = /^F\d{1,2}$/.test(e.code);
    if (!e.ctrlKey && !e.altKey && !e.metaKey && !isFn) {
      hint(t('popup.keyNeedMod'), true);
      return;
    }
    const format = recording.dataset.format;
    const k = { code: e.code, key: keyLabel(e), ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
    recording = null;
    await setShortcut(format, k);
    const isCopyKey = k.code === 'KeyC' && !k.alt && !k.shift && (k.ctrl !== k.meta);
    hint(isCopyKey ? t('popup.keyCopyHint', { key: CCM.shortcutLabel(k) }) : t('popup.keyHint'));
    renderShortcuts();
  }, true);
}

// ---------- 与页面通信 ----------
const isExtensionTab = (tab) => !!(tab && tab.url && tab.url.startsWith(EXT_ORIGIN));

async function askPage(tab, msg) {
  try {
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch (e) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(String(e && e.message))) return undefined;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['src/main-world.js'], world: 'MAIN' }).catch(() => {});
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: CONTENT_FILES });
    return await chrome.tabs.sendMessage(tab.id, msg);
  } catch (_) {
    return null;
  }
}

// 选区可能在普通网页里，也可能在 MarkTeX 阅读器里（独立标签页或嵌入 PDF 页面的 iframe），两路同时询问
async function ask(tab, msg) {
  const viaReader = chrome.runtime.sendMessage({ ...msg, ccmTabId: tab.id }).catch(() => undefined);
  const viaPage = isExtensionTab(tab) ? Promise.resolve(undefined) : askPage(tab, msg);
  const [r, p] = await Promise.all([viaReader, viaPage]);
  if (r && r.ok) return r;
  if (p && p.ok) return p;
  return r || p || (p === null && !r ? null : undefined);
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab && tab.id != null ? tab : null;
}

async function run(format) {
  const tab = await activeTab();
  if (!tab) return;
  const res = await ask(tab, { type: 'ccm-generate', format, silentIfEmpty: true });
  if (res == null && pdfTab) return banner(t('toast.pdfNative'), false);
  if (res === null) return banner(t('popup.cannotRun'), false);
  if (!res || !res.ok) return banner(res && res.error ? t('popup.error', { msg: res.error }) : t('popup.empty'), false);

  try {
    const items = {};
    for (const [type, value] of Object.entries(res.data)) items[type] = new Blob([value], { type });
    await navigator.clipboard.write([new ClipboardItem(items)]);
  } catch (e) {
    return banner(t('popup.clipFail', { msg: e.message }), false);
  }
  banner(t('popup.copied', { label: res.label }) + (res.mathCount ? t('popup.withMath', { n: res.mathCount }) : ''), true);
  const text = format === 'html' ? res.data['text/html'] : res.text;
  $('#previewGroup').hidden = false;
  $('#preview').value = text;
  $('#previewMeta').textContent = t('popup.previewMeta', { label: res.label, n: text.length });
}

// 当前标签页是浏览器自带阅读器打开的 PDF 时，提供“在 MarkTeX 阅读器中打开”
let pdfTab = false;
async function detectPdf() {
  const tab = await activeTab();
  if (!tab || isExtensionTab(tab) || !/^(https?|file):/.test(tab.url || '')) return;
  const status = await chrome.tabs.sendMessage(tab.id, { type: 'ccm-pdf-status' }, { frameId: 0 }).catch(() => null);
  let isPdf = !!(status && status.isPdf);
  if (!status) {
    // 没有内容脚本时（例如本地文件未授权），按地址判断
    isPdf = /\.pdf($|[?#])/i.test(tab.url);
  }
  if (!isPdf) return;
  pdfTab = !(status && status.readerOpen);
  if (!pdfTab) return;
  $('#pdfGroup').hidden = false;
  $('#openPdf').addEventListener('click', async () => {
    if (/^file:/i.test(tab.url) && !(await chrome.extension.isAllowedFileSchemeAccess())) {
      banner(t('pdf.needFileAccess'), false);
      const engine = /Edg\//.test(navigator.userAgent) ? 'edge' : 'chrome';
      setTimeout(() => chrome.tabs.create({ url: `${engine}://extensions/?id=${chrome.runtime.id}` }), 1800);
      return;
    }
    const r = status ? await chrome.tabs.sendMessage(tab.id, { type: 'ccm-open-reader' }, { frameId: 0 }).catch(() => null) : null;
    if (!r || !r.ok) {
      const [base, hash = ''] = tab.url.split('#');
      const clean = hash.replace(/(^|&)?marktex-native/, '');
      await chrome.tabs.update(tab.id, { url: VIEWER_URL + '?src=' + encodeURIComponent(base) + (clean ? '#' + clean : '') });
    }
    window.close();
  });
}

// ---------- 初始化 ----------
(async () => {
  settings = { ...CCM.DEFAULTS, ...(await chrome.storage.sync.get(CCM.DEFAULTS)) };
  $('#version').textContent = 'v' + chrome.runtime.getManifest().version;
  applyI18n();
  renderSegments();
  bindSettings();
  renderShortcuts();
  bindShortcuts();
  for (const row of $$('.row.action[data-format]')) row.addEventListener('click', () => run(row.dataset.format));
  detectPdf();
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const k of Object.keys(changes)) settings[k] = changes[k].newValue;
    renderSegments();
    renderShortcuts();
    if (changes.language) applyI18n();
  });
})();
