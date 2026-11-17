// 生成扩展图标：icons/icon{16,20,24,32,48,64,128,192,512}.png 与矢量原稿 icons/icon.svg。
// 图案：Markdown 标志（M↓，Dustin Curtis，CC0）作为蓝色实心徽章。所有尺寸都由同一份 128 格的设计稿缩放，
// 工具栏中的小图标与大图标完全一致；20 / 24px 供屏幕缩放 125% / 150% 时直接使用，不必由 32px 缩小。
// 用法：node tools/build-icons.cjs
const fs = require('fs');
const path = require('path');
const { roundRect, rasterize, png } = require('./icon-lib.cjs');

// 设计稿（128 格）：徽章上下边在 16px 时恰好落在整像素上（y = 3 与 13）
const BADGE = { x0: 0, y0: 24, x1: 128, y1: 104, r: 16, top: '#47a3ff', bottom: '#0a6cff' };
const GLYPH = { cx: 64, cy: 64, w: 96, color: '#ffffff' };
// Markdown 标志原稿（208 × 128）中的 M 与箭头
const MARK_M = [[30, 98], [30, 30], [50, 30], [70, 55], [90, 30], [110, 30], [110, 98], [90, 98], [90, 59], [70, 84], [50, 59], [50, 98]];
const MARK_ARROW = [[155, 98], [125, 65], [145, 65], [145, 30], [165, 30], [165, 65], [185, 65]];

// 设计稿中的徽章与 M↓（128 格坐标）
function mark() {
  const k = GLYPH.w / (185 - 30);
  const ox = GLYPH.cx - ((30 + 185) / 2) * k;
  const oy = GLYPH.cy - ((30 + 98) / 2) * k;
  const at = (list) => list.map(([x, y]) => [ox + x * k, oy + y * k]);
  return { badge: BADGE, m: at(MARK_M), arrow: at(MARK_ARROW) };
}

// 输出像素：32px 及以下铺满，更大的四周留约 4% 的透明边
function layers(size) {
  const pad = size <= 32 ? 0 : Math.round(size * 0.04);
  const u = (size - 2 * pad) / 128;
  const P = (v) => pad + v * u;
  const { badge: b, m, arrow } = mark();
  const map = (list) => list.map(([x, y]) => [P(x), P(y)]);
  return [
    { fill: { from: [0, P(b.y0)], to: [0, P(b.y1)], stops: [b.top, b.bottom] }, polys: [roundRect(P(b.x0), P(b.y0), P(b.x1), P(b.y1), b.r * u)] },
    { fill: GLYPH.color, polys: [map(m), map(arrow)] },
  ];
}

// 矢量原稿（128 × 128，不留边）；viewBox 可只取徽章部分（阅读器工具栏中的 MarkTeX 按钮）
function svg(viewBox = '0 0 128 128') {
  const { badge: b, m, arrow } = mark();
  const n = (v) => +v.toFixed(2);
  const poly = (p) => 'M' + p.map(([x, y]) => `${n(x)} ${n(y)}`).join('L') + 'Z';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">\n` +
    `  <defs><linearGradient id="badge" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${b.top}"/><stop offset="1" stop-color="${b.bottom}"/></linearGradient></defs>\n` +
    `  <rect x="${b.x0}" y="${b.y0}" width="${b.x1 - b.x0}" height="${b.y1 - b.y0}" rx="${b.r}" fill="url(#badge)"/>\n` +
    `  <path d="${poly(m)}${poly(arrow)}" fill="${GLYPH.color}"/>\n` +
    '</svg>\n';
}

const SIZES = [16, 20, 24, 32, 48, 64, 128, 192, 512];
if (require.main === module) {
  const dir = path.join(__dirname, '..', 'icons');
  fs.writeFileSync(path.join(dir, 'icon.svg'), svg());
  for (const size of SIZES) fs.writeFileSync(path.join(dir, `icon${size}.png`), png(size, rasterize(layers(size), size)));
  console.log('icons:', SIZES.join(', '));
}
module.exports = { mark, svg };
