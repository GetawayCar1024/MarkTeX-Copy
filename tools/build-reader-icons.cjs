// 生成阅读器工具栏 / 侧栏图标（src/reader-icons/*.svg）：统一的 20×20 线性图标，1.5 线宽，
// 方角为主（与阅读器无圆角的界面一致）。PDF.js 用 mask-image 显示，颜色由 CSS 决定。
// 用法：node tools/build-reader-icons.cjs
const fs = require('fs');
const path = require('path');

const S = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${body}</svg>\n`;
const dot = (x, y, r = 1.25) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#000" stroke="none"/>`;
const page = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0.75"/>`;
// 扩展图标中的 √x（x 为 TeX 粗斜体，轮廓取自 MathJax 字库）
const LOGO_X = 'M74 282H63Q43 282 43 296Q43 298 45 307T56 332T76 365T110 401T159 433Q200 451 233 451H236Q273 451 282 450Q358 437 382 400L392 410Q434 452 483 452Q538 452 568 421T599 346Q599 303 573 280T517 256Q494 256 478 270T462 308Q462 343 488 367Q501 377 520 385Q520 386 516 389T502 396T480 400T462 398Q429 383 415 341Q354 116 354 80T405 44Q449 44 485 74T535 142Q539 156 542 159T562 162H568H579Q599 162 599 148Q599 135 586 111T550 60T485 12T397 -8Q313 -8 266 35L258 44Q215 -7 161 -7H156Q99 -7 71 25T43 95Q43 143 70 165T125 188Q148 188 164 174T180 136Q180 101 154 77Q141 67 122 59Q124 54 136 49T161 43Q183 43 200 61T226 103Q287 328 287 364T236 400Q200 400 164 377T107 302Q103 288 100 285T80 282H74Z';

const ICONS = {
  sidebar: '<rect x="2.75" y="3.75" width="14.5" height="12.5" rx="1"/><path d="M7.75 3.75v12.5M4.75 7h1M4.75 9.5h1"/>',
  menu: '<path d="M3.25 5.5h13.5M3.25 10h13.5M3.25 14.5h13.5"/>',
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
  stamp: '<rect x="2.75" y="4" width="14.5" height="12" rx="1"/><circle cx="7.2" cy="8.2" r="1.3"/><path d="m3.2 14 4.1-3.4 3.2 2.6 2.4-2 4 3.1"/>',
  signature: '<path d="M3 13.5c1.8-3.7 3.2-6.4 4.3-6.4 1.3 0-1.2 6 .6 6 1.3 0 2.2-3.4 3.3-3.4.9 0-.2 2.6 1.1 2.6.9 0 1.7-.8 3.2-.8"/><path d="M3 16.75h14"/>',
  comment: '<path d="M3.25 4h13.5v10.25H9.5l-3.75 2.9v-2.9h-2.5z"/>',
  print: '<path d="M6 7.25V3.75h8v3.5"/><rect x="2.75" y="7.25" width="14.5" height="7" rx="0.75"/><path d="M6 12h8v4.5H6z"/>',
  download: '<path d="M10 3.25v9.5M6.25 9.25 10 13l3.75-3.75"/><path d="M3.75 13.5v3h12.5v-3"/>',
  more: dot(5, 10) + dot(10, 10) + dot(15, 10),
  'more-vert': dot(10, 5) + dot(10, 10) + dot(10, 15),
  open: '<path d="M2.75 4.25h5.1l1.9 2h7.5v9.5H2.75z"/>',
  present: '<rect x="2.75" y="3.75" width="14.5" height="10" rx="0.75"/><path d="M10 13.75v3M6.75 16.75h6.5"/>',
  bookmark: '<path d="M5.25 3.75h9.5v12.75l-4.75-3.2-4.75 3.2z"/>',
  grid: '<rect x="3.5" y="3.5" width="5.25" height="5.25" rx="0.5"/><rect x="11.25" y="3.5" width="5.25" height="5.25" rx="0.5"/><rect x="3.5" y="11.25" width="5.25" height="5.25" rx="0.5"/><rect x="11.25" y="11.25" width="5.25" height="5.25" rx="0.5"/>',
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
  // 适合页面 / 适合页宽（与 Chrome 阅读器的切换按钮相同的含义）
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
  // MarkTeX 菜单按钮：与扩展图标一致的 √x
  logo: '<path d="M1.6 10.6 4 9.2l2.6 6.6L10.9 3.6h7" stroke-width="1.9" stroke-linecap="butt" stroke-linejoin="miter"/>' +
    `<path transform="translate(9.95 15.45) scale(0.0135 -0.0135)" fill="#000" stroke="none" d="${LOGO_X}"/>`,
};

const dir = path.join(__dirname, '..', 'src', 'reader-icons');
fs.mkdirSync(dir, { recursive: true });
for (const [name, body] of Object.entries(ICONS)) fs.writeFileSync(path.join(dir, `${name}.svg`), S(body));
console.log(`icons: ${Object.keys(ICONS).length}`);
