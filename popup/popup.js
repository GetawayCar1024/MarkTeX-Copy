const CCM = globalThis.__CCM;
const CONTENT_FILES = ['src/settings.js', 'src/mathml2latex.js', 'src/capture.js', 'src/markdown.js', 'src/html.js', 'src/content.js'];
const FORMATS = ['markdown', 'html', 'html-source'];
const KEY_HINT = '点击后按下组合键，Esc 取消。只在网页中有选中内容时生效，否则按键照常交给网页，所以也可以直接设为 Ctrl+C。';

const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));

let settings = { ...CCM.DEFAULTS };

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
      btn.textContent = k ? CCM.shortcutLabel(k) : '未设置';
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
  hint(KEY_HINT);
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

async function setShortcut(format, k) {
  const map = { ...(settings.shortcuts || {}) };
  map[format] = k;
  if (k) {
    for (const f of FORMATS) {
      if (f !== format && map[f] && map[f].code === k.code && !!map[f].ctrl === k.ctrl && !!map[f].alt === k.alt &&
        !!map[f].shift === k.shift && !!map[f].meta === k.meta) map[f] = null;
    }
  }
  await save({ shortcuts: map });
}

function bindShortcuts() {
  for (const btn of $$('.key')) {
    btn.addEventListener('click', () => {
      if (recording === btn) return stopRecording();
      if (recording) stopRecording();
      recording = btn;
      btn.textContent = '请按下快捷键…';
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
      hint('快捷键需要包含 Ctrl、Alt 或 ⌘ 之一（F1–F12 除外）。', true);
      return;
    }
    const format = recording.dataset.format;
    const k = { code: e.code, key: keyLabel(e), ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey };
    recording = null;
    await setShortcut(format, k);
    const label = CCM.shortcutLabel(k);
    hint(/^(Ctrl|⌘)\+?C$/.test(label) || label === '⌘C'
      ? `已设为 ${label}：有选中内容时由插件复制，否则仍是浏览器原生复制。`
      : KEY_HINT);
    renderShortcuts();
  }, true);
}

// ---------- 复制 ----------
async function ask(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(String(e && e.message))) return undefined;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['src/main-world.js'], world: 'MAIN' }).catch(() => {});
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: CONTENT_FILES });
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch (_) {
    return null;
  }
}

async function run(format) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) return;
  const res = await ask(tab.id, { type: 'ccm-generate', format, silentIfEmpty: true });
  if (res === null) return banner('无法在此页面运行（浏览器内置页面或扩展商店）', false);
  if (!res || !res.ok) return banner(res && res.error ? '出错：' + res.error : '页面中没有选中任何内容', false);

  try {
    const items = {};
    for (const [type, value] of Object.entries(res.data)) items[type] = new Blob([value], { type });
    await navigator.clipboard.write([new ClipboardItem(items)]);
  } catch (e) {
    return banner('写入剪贴板失败：' + e.message, false);
  }
  banner(`已复制为 ${res.label}${res.mathCount ? `，含 ${res.mathCount} 个公式` : ''}`, true);
  const text = format === 'html' ? res.data['text/html'] : res.text;
  $('#previewGroup').hidden = false;
  $('#preview').value = text;
  $('#previewMeta').textContent = `${res.label} · ${text.length} 字符`;
}

// ---------- 初始化 ----------
(async () => {
  settings = { ...CCM.DEFAULTS, ...(await chrome.storage.sync.get(CCM.DEFAULTS)) };
  $('#version').textContent = 'v' + chrome.runtime.getManifest().version;
  renderSegments();
  bindSettings();
  renderShortcuts();
  bindShortcuts();
  for (const row of $$('.row.action')) row.addEventListener('click', () => run(row.dataset.format));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const k of Object.keys(changes)) settings[k] = changes[k].newValue;
    renderSegments();
    renderShortcuts();
  });
})();
