// 生成阅读器工具栏 / 侧栏图标（src/reader-icons/*.svg）：统一的 20×20 线性图标，1.5 线宽、圆角端点，
// 风格接近扩展弹窗（iOS / SF Symbols）。PDF.js 用 mask-image 显示，颜色由 CSS 决定。
// 用法：node tools/build-reader-icons.cjs
const fs = require('fs');
const path = require('path');
const { X_PATH, TWO_PATH, TWO_SCALE, TWO_SHIFT, GLYPH_BOX } = require('./build-icons.cjs');

const S = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>\n`;
// 实心图标（24×24），与扩展弹窗中各行的图标相同
const F = (d) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="${d}"/></svg>\n`;
const dot = (x, y, r = 1.25) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#000" stroke="none"/>`;
const page = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1.8"/>`;

// MarkTeX 按钮：与扩展图标相同的“选中的 x²”。选区用半透明，在单色图标中显示为浅色
function logo() {
  const n = (v) => +v.toFixed(4);
  const [x0, y0, x1, y1] = GLYPH_BOX;
  const k = 9.4 / (x1 - x0);
  const ox = 10 - ((x0 + x1) / 2) * k;
  const oy = 9.7 - ((y0 + y1) / 2) * k;
  const k2 = k * TWO_SCALE;
  return '<g fill="#000" stroke="none">' +
    '<rect x="3.4" y="4.6" width="13.2" height="10.8" fill-opacity="0.3"/>' +
    '<rect x="2.2" y="4" width="1.3" height="11.4"/><circle cx="2.85" cy="3.4" r="1.65"/>' +
    '<rect x="16.5" y="4.6" width="1.3" height="11.4"/><circle cx="17.15" cy="16.6" r="1.65"/>' +
    `<path transform="matrix(${n(k)} 0 0 ${-n(k)} ${n(ox)} ${n(oy)})" d="${X_PATH}"/>` +
    `<path transform="matrix(${n(k2)} 0 0 ${-n(k2)} ${n(ox + TWO_SHIFT[0] * k)} ${n(oy - TWO_SHIFT[1] * k)})" d="${TWO_PATH}"/>` +
    '</g>';
}

const ICONS = {
  sidebar: '<rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.75"/><path d="M7.75 3.75v12.5M4.75 7h1M4.75 9.5h1"/>',
  search: '<circle cx="8.75" cy="8.75" r="5.25"/><path d="m12.6 12.6 4.15 4.15"/>',
  'chevron-up': '<path d="m5 12.5 5-5 5 5"/>',
  'chevron-down': '<path d="m5 7.5 5 5 5-5"/>',
  'chevron-right': '<path d="m7.5 5 5 5-5 5"/>',
  'chevron-down-small': '<path d="m6.5 8.25 3.5 3.5 3.5-3.5"/>',
  minus: '<path d="M4.75 10h10.5"/>',
  plus: '<path d="M4.75 10h10.5M10 4.75v10.5"/>',
  highlight: '<path d="m12.4 3.6 4 4-6.9 6.9H5.5v-4z"/><path d="M3.5 17h7"/>',
  text: '<path d="M5 6V4.5h10V6M10 4.5v11M8 15.5h4"/>',
  ink: '<path d="M13.3 3.9a1.7 1.7 0 0 1 2.4 0l.4.4a1.7 1.7 0 0 1 0 2.4L7.6 15.2l-3.85 1.05L4.8 12.4z"/><path d="m12 5.2 2.8 2.8"/>',
  stamp: '<rect x="2.75" y="4" width="14.5" height="12" rx="2.5"/><circle cx="7.2" cy="8.2" r="1.3"/><path d="m3.2 14 4.1-3.4 3.2 2.6 2.4-2 4 3.1"/>',
  signature: '<path d="M3 13.5c1.8-3.7 3.2-6.4 4.3-6.4 1.3 0-1.2 6 .6 6 1.3 0 2.2-3.4 3.3-3.4.9 0-.2 2.6 1.1 2.6.9 0 1.7-.8 3.2-.8"/><path d="M3 16.75h14"/>',
  comment: '<path d="M4.75 4h10.5a2 2 0 0 1 2 2v6.25a2 2 0 0 1-2 2H9.5l-3.75 2.9v-2.9h-1a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z"/>',
  print: '<path d="M6 7.25V3.75h8v3.5"/><rect x="2.75" y="7.25" width="14.5" height="7" rx="2"/><path d="M6 12h8v4.5H6z"/>',
  download: '<path d="M10 3.25v9.5M6.25 9.25 10 13l3.75-3.75"/><path d="M3.75 13.5v1.25a2 2 0 0 0 2 2h8.5a2 2 0 0 0 2-2V13.5"/>',
  more: dot(5, 10) + dot(10, 10) + dot(15, 10),
  open: '<path d="M2.75 6.25a2 2 0 0 1 2-2h3.1l1.9 2h5.5a2 2 0 0 1 2 2v5.5a2 2 0 0 1-2 2h-10.5a2 2 0 0 1-2-2z"/>',
  present: '<rect x="2.75" y="3.75" width="14.5" height="10" rx="2"/><path d="M10 13.75v3M6.75 16.75h6.5"/>',
  bookmark: '<path d="M6 3.75h8a.75.75 0 0 1 .75.75v12l-4.75-3.2-4.75 3.2v-12A.75.75 0 0 1 6 3.75z"/>',
  grid: '<rect x="3.5" y="3.5" width="5.25" height="5.25" rx="1.4"/><rect x="11.25" y="3.5" width="5.25" height="5.25" rx="1.4"/><rect x="3.5" y="11.25" width="5.25" height="5.25" rx="1.4"/><rect x="11.25" y="11.25" width="5.25" height="5.25" rx="1.4"/>',
  outline: dot(4.75, 5.5, 1) + dot(7.25, 10, 1) + dot(7.25, 14.5, 1) + '<path d="M7.75 5.5h8.5M10.25 10h6M10.25 14.5h6"/>',
  attach: '<path d="m15.4 9.4-5.7 5.7a3.4 3.4 0 0 1-4.8-4.8l6.3-6.3a2.25 2.25 0 0 1 3.2 3.2l-6.2 6.2a1.1 1.1 0 0 1-1.6-1.6l5.6-5.6"/>',
  layers: '<path d="M10 3.5 17 7 10 10.5 3 7z"/><path d="m3 10.25 7 3.5 7-3.5M3 13.5l7 3.5 7-3.5"/>',
  locate: '<circle cx="10" cy="10" r="5.75"/>' + dot(10, 10, 1.6) + '<path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2"/>',
  close: '<path d="m5.5 5.5 9 9M14.5 5.5l-9 9"/>',
  check: '<path d="m4.5 10.5 3.75 3.5 7.25-8"/>',
  'first-page': '<path d="M5 4.5h10M5 13.5l5-5 5 5"/>',
  'last-page': '<path d="M5 15.5h10M5 6.5l5 5 5-5"/>',
  'rotate-cw': '<path d="M15.75 10a5.75 5.75 0 1 1-1.9-4.3"/><path d="M15.5 3.25v3.25h-3.25"/>',
  'rotate-ccw': '<path d="M4.25 10a5.75 5.75 0 1 0 1.9-4.3"/><path d="M4.5 3.25v3.25h3.25"/>',
  // 适合页面 / 适合页宽
  'fit-page': '<path d="M3.75 3.25h12.5M3.75 16.75h12.5M10 6v8M7.75 8 10 5.75 12.25 8M7.75 12 10 14.25 12.25 12"/>',
  'fit-width': '<path d="M3.25 3.75v12.5M16.75 3.75v12.5M6 10h8M8 7.75 5.75 10 8 12.25M12 7.75l2.25 2.25L12 12.25"/>',
  select: '<path d="M5.25 3.5 15 9.3l-4.4 1.15-2.1 4.1z"/>',
  hand: '<path d="M7 10.5V5.25a1.25 1.25 0 0 1 2.5 0V9.5M9.5 9.25V4a1.25 1.25 0 0 1 2.5 0v5.25M12 9.5V5.5a1.25 1.25 0 0 1 2.5 0v6.25a5 5 0 0 1-5 5h-.6a4.6 4.6 0 0 1-3.7-1.9l-2.1-2.9a1.25 1.25 0 0 1 2-1.5L7 12.25"/>',
  'scroll-page': page(5.5, 3, 9, 14),
  'scroll-vertical': page(5.5, 2.75, 9, 6.25) + page(5.5, 11, 9, 6.25),
  'scroll-horizontal': page(2.75, 5.5, 6.25, 9) + page(11, 5.5, 6.25, 9),
  'scroll-wrapped': page(3.25, 3.25, 5.75, 5.75) + page(11, 3.25, 5.75, 5.75) + page(3.25, 11, 5.75, 5.75) + page(11, 11, 5.75, 5.75),
  'spread-none': page(6, 4, 8, 12),
  'spread-odd': page(2.75, 4, 6.5, 12) + page(10.75, 4, 6.5, 12) + '<path d="M5 8h2"/>',
  'spread-even': page(2.75, 4, 6.5, 12) + page(10.75, 4, 6.5, 12) + '<path d="M13 8h2"/>',
  info: '<circle cx="10" cy="10" r="7.25"/><path d="M10 9.25V14"/>' + dot(10, 6.4, 1),
  logo: logo(),
};

// MarkTeX 菜单中各项的彩色小方块里的图标（与扩展弹窗一致）
const FILLED = {
  'fmt-markdown': 'M3 17V7h2.4l2.6 3.4L10.6 7H13v10h-2.4v-6.2L8 14l-2.6-3.2V17zm13.5 0-3.5-4h2.3V7h2.4v6H20z',
  'fmt-html': 'M8.6 16.6 4 12l4.6-4.6L10 8.8 6.8 12l3.2 3.2zm6.8 0L14 15.2l3.2-3.2L14 8.8l1.4-1.4L20 12z',
  'fmt-source': 'M9 4H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h2v-2H7v-4.5A2.5 2.5 0 0 0 5.6 12 2.5 2.5 0 0 0 7 9.5V6h2zm6 0h2a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-2v-2h2v-4.5a2.5 2.5 0 0 1 1.4-2.5A2.5 2.5 0 0 1 17 9.5V6h-2z',
  // 用浏览器自带阅读器打开：方框与向右上的箭头
  'open-native': 'M11 4v2H6.5a.5.5 0 0 0-.5.5v11a.5.5 0 0 0 .5.5h11a.5.5 0 0 0 .5-.5V13h2v4.5a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-11A2.5 2.5 0 0 1 6.5 4zm2 0h7v7h-2V7.4l-6.3 6.3-1.4-1.4L16.6 6H13z',
};

const dir = path.join(__dirname, '..', 'src', 'reader-icons');
fs.mkdirSync(dir, { recursive: true });
for (const [name, body] of Object.entries(ICONS)) fs.writeFileSync(path.join(dir, `${name}.svg`), S(body));
for (const [name, d] of Object.entries(FILLED)) fs.writeFileSync(path.join(dir, `${name}.svg`), F(d));
// 删除不再生成的旧图标
const keep = new Set([...Object.keys(ICONS), ...Object.keys(FILLED)].map((n) => `${n}.svg`));
for (const f of fs.readdirSync(dir)) if (f.endsWith('.svg') && !keep.has(f)) fs.unlinkSync(path.join(dir, f));
console.log(`icons: ${keep.size}`);
