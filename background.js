importScripts('src/settings.js', 'src/i18n.js');

const CCM = globalThis.__CCM;
const CONTENT_FILES = [
  'src/settings.js',
  'src/i18n.js',
  'src/mathml2latex.js',
  'src/katex2latex.js',
  'src/capture.js',
  'src/markdown.js',
  'src/html.js',
  'src/pdf-text.js',
  'src/content.js',
];
const MAIN_WORLD_FILES = ['src/main-world.js'];
const MENU_FORMATS = { 'ccm-md': 'markdown', 'ccm-html': 'html', 'ccm-html-src': 'html-source' };
const EXT_ORIGIN = chrome.runtime.getURL('');

async function getSettings() {
  const s = { ...CCM.DEFAULTS, ...(await chrome.storage.sync.get(CCM.DEFAULTS)) };
  CCM.currentLanguage = s.language;
  return s;
}

async function createMenus() {
  await getSettings();
  const t = (k) => CCM.t(k);
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'ccm-md', title: t('menu.markdown'), contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'ccm-html', title: t('menu.html'), contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'ccm-html-src', title: t('menu.html-source'), contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'ccm-sep', type: 'separator', contexts: ['selection'] });
    chrome.contextMenus.create({
      id: 'ccm-formula',
      title: t('menu.formula'),
      contexts: ['page', 'frame', 'selection', 'image', 'link'],
    });
  });
}

chrome.runtime.onInstalled.addListener(createMenus);
chrome.runtime.onStartup.addListener(createMenus);
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.language) createMenus();
});

const isExtensionUrl = (u) => !!(u && u.startsWith(EXT_ORIGIN));
const isExtensionTab = (tab) => !!(tab && isExtensionUrl(tab.url));

async function inject(tabId, frameIds) {
  const target = frameIds ? { tabId, frameIds } : { tabId, allFrames: true };
  await chrome.scripting.executeScript({ target, files: MAIN_WORLD_FILES, world: 'MAIN' }).catch(() => {});
  await chrome.scripting.executeScript({ target, files: CONTENT_FILES });
}

// 发送消息；若页面中还没有内容脚本（例如安装扩展前就打开的标签页），先注入再重试。
// 返回 undefined 表示该页面无法运行扩展脚本（例如浏览器自带的 PDF 阅读器）。
async function sendToTab(tab, msg, frameId, frameUrl) {
  // MarkTeX 阅读器（独立标签页，或嵌在 PDF 页面里的 iframe）是扩展页面，用 runtime 消息并按标签页过滤
  if (isExtensionTab(tab) || isExtensionUrl(frameUrl)) {
    try { return await chrome.runtime.sendMessage({ ...msg, ccmTabId: tab.id }); } catch (_) { return undefined; }
  }
  const opts = frameId != null ? { frameId } : undefined;
  try {
    return await chrome.tabs.sendMessage(tab.id, msg, opts);
  } catch (e) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(String(e && e.message))) return null;
  }
  try {
    await inject(tab.id, frameId != null ? [frameId] : null);
    return await chrome.tabs.sendMessage(tab.id, msg, opts);
  } catch (e) {
    console.warn('[marktex-copy] cannot run on this page:', e && e.message);
    return undefined;
  }
}

async function offscreenCopy(data) {
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['CLIPBOARD'],
      justification: 'Write converted Markdown / HTML to the clipboard',
    });
  } catch (_) {
    // 已存在
  }
  try {
    return !!(await chrome.runtime.sendMessage({ target: 'ccm-offscreen', data }));
  } catch (_) {
    return false;
  }
}

// 页面内直接写剪贴板失败时（极少数页面），退回 offscreen 文档写入
async function handleResult(tab, frameId, res) {
  if (!res || res.ok || res.reason !== 'clipboard' || !res.data) return;
  const ok = await offscreenCopy(res.data);
  await sendToTab(tab, ok ? { type: 'ccm-toast', text: res.message, ok } : { type: 'ccm-toast', key: 'toast.clipboardFailed', ok }, frameId);
}

// 浏览器自带的 PDF 阅读器：扩展无法读取带格式的选区。不复制原文，而是提示用户切换到 MarkTeX 阅读器
const EXT_SETTINGS_URL = () => (/Edg\//.test(navigator.userAgent) ? 'edge' : 'chrome') + '://extensions/?id=' + chrome.runtime.id;

async function promptPdfReader(tab, pdfUrl) {
  await getSettings();
  const isLocal = /^file:/i.test(pdfUrl || '');
  // 本地 PDF 且未允许访问文件网址：内容脚本和阅读器都读不到文件，直接说明如何开启
  if (isLocal && !(await chrome.extension.isAllowedFileSchemeAccess())) {
    notify('ccm-file-' + tab.id, CCM.t('pdf.needFileAccess'), CCM.t('pdf.openSettings'), { openSettings: true });
    return;
  }
  const shown = await chrome.tabs.sendMessage(tab.id, { type: 'ccm-pdf-unsupported', pdfUrl }).catch(() => null);
  if (shown && shown.ok) return;
  // 页面里没有内容脚本时，用系统通知
  notify('ccm-pdf-' + tab.id, CCM.t('toast.pdfNative'), CCM.t('toast.openInReader'), { tabId: tab.id, url: pdfUrl });
}

const pendingNotify = new Map();
function notify(id, message, button, action) {
  pendingNotify.set(id, action);
  chrome.notifications.create(id, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: CCM.t('notify.title'),
    message,
    buttons: [{ title: button }],
    priority: 1,
  });
}

chrome.notifications.onButtonClicked.addListener(async (id) => {
  const a = pendingNotify.get(id);
  if (!a) return;
  pendingNotify.delete(id);
  chrome.notifications.clear(id);
  if (a.openSettings) {
    await chrome.tabs.create({ url: EXT_SETTINGS_URL() });
    return;
  }
  const [base, hash = ''] = a.url.split('#');
  await chrome.tabs.update(a.tabId, { url: chrome.runtime.getURL('vendor/pdfjs/web/viewer.html') + '?src=' + encodeURIComponent(base) + (hash ? '#' + hash : '') });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || tab.id == null) return;
  const frameId = info.frameId ?? 0;
  const format = MENU_FORMATS[info.menuItemId];
  let msg;
  if (format) msg = { type: 'ccm-copy', format };
  else if (info.menuItemId === 'ccm-formula') msg = { type: 'ccm-copy-formula' };
  else return;
  const res = await sendToTab(tab, msg, frameId, info.frameUrl);
  if (res === undefined && format) {
    await promptPdfReader(tab, info.pageUrl || tab.url);
    return;
  }
  await handleResult(tab, frameId, res);
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;
  // 阅读器页面询问自己所在的标签页（嵌入为 iframe 时 tabs.getCurrent 不可靠）
  if (msg.type === 'ccm-whoami') {
    sendResponse({ tabId: sender.tab ? sender.tab.id : null, frameId: sender.frameId });
    return;
  }
  // 页面内快捷键复制失败时，内容脚本请求用 offscreen 文档写入
  if (msg.type === 'ccm-offscreen-copy') {
    offscreenCopy(msg.data).then(sendResponse);
    return true;
  }
});
