chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== 'ccm-offscreen') return;
  let ok = false;
  const handler = (e) => {
    e.preventDefault();
    for (const [type, value] of Object.entries(msg.data || {})) e.clipboardData.setData(type, value);
    ok = true;
  };
  const buf = document.getElementById('buf');
  buf.value = ' ';
  buf.select();
  document.addEventListener('copy', handler);
  try {
    document.execCommand('copy');
  } finally {
    document.removeEventListener('copy', handler);
  }
  sendResponse(ok);
});
