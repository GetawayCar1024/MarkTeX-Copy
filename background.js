const CONTENT_FILES = [
  'src/settings.js',
  'src/mathml2latex.js',
  'src/capture.js',
  'src/markdown.js',
  'src/html.js',
  'src/content.js',
];
const MAIN_WORLD_FILES = ['src/main-world.js'];
const MENU_FORMATS = { 'ccm-md': 'markdown', 'ccm-html': 'html', 'ccm-html-src': 'html-source' };

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'ccm-md', title: '复制为 Markdown', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'ccm-html', title: '复制为 HTML（富文本）', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'ccm-html-src', title: '复制为 HTML 源码', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'ccm-sep', type: 'separator', contexts: ['selection'] });
    chrome.contextMenus.create({
      id: 'ccm-formula',
      title: '复制此处公式的 LaTeX',
      contexts: ['page', 'frame', 'selection', 'image', 'link'],
    });
  });
}

chrome.runtime.onInstalled.addListener(createMenus);
chrome.runtime.onStartup.addListener(createMenus);

async function inject(tabId, frameIds) {
  const target = frameIds ? { tabId, frameIds } : { tabId, allFrames: true };
  await chrome.scripting.executeScript({ target, files: MAIN_WORLD_FILES, world: 'MAIN' }).catch(() => {});
  await chrome.scripting.executeScript({ target, files: CONTENT_FILES });
}

// 发送消息；若页面中还没有内容脚本（例如安装扩展前就打开的标签页），先注入再重试
async function sendToTab(tabId, msg, frameId) {
  const opts = frameId != null ? { frameId } : undefined;
  try {
    return await chrome.tabs.sendMessage(tabId, msg, opts);
  } catch (e) {
    if (!/Receiving end does not exist|Could not establish connection/i.test(String(e && e.message))) return undefined;
  }
  try {
    await inject(tabId, frameId != null ? [frameId] : null);
    return await chrome.tabs.sendMessage(tabId, msg, opts);
  } catch (e) {
    console.warn('[marktex-copy] 无法在此页面运行：', e);
    return undefined;
  }
}

async function offscreenCopy(data) {
  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen/offscreen.html',
      reasons: ['CLIPBOARD'],
      justification: '将转换后的 Markdown / HTML 写入剪贴板',
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
async function handleResult(tabId, frameId, res) {
  if (!res || res.ok || res.reason !== 'clipboard' || !res.data) return;
  const ok = await offscreenCopy(res.data);
  await sendToTab(tabId, { type: 'ccm-toast', text: ok ? res.message : '复制失败：无法写入剪贴板', ok }, frameId);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab || tab.id == null) return;
  const frameId = info.frameId ?? 0;
  let msg;
  if (MENU_FORMATS[info.menuItemId]) msg = { type: 'ccm-copy', format: MENU_FORMATS[info.menuItemId] };
  else if (info.menuItemId === 'ccm-formula') msg = { type: 'ccm-copy-formula' };
  else return;
  const res = await sendToTab(tab.id, msg, frameId);
  await handleResult(tab.id, frameId, res);
});

// 页面内快捷键复制失败时，内容脚本请求用 offscreen 文档写入
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'ccm-offscreen-copy') return;
  offscreenCopy(msg.data).then(sendResponse);
  return true;
});
