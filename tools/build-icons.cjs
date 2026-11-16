// 生成扩展图标：icons/icon{16,32,48,64,128,192,512}.png 与矢量原稿 icons/icon.svg。
// 图案：方形蓝底上的白色根号 √x，x 为 TeX（Computer Modern）粗斜体，轮廓取自 MathJax 字库（Apache License 2.0）。
// 不依赖第三方库：路径展平后做扫描线填充（超采样抗锯齿），PNG 用 Node 自带的 zlib 编码。
// 用法：node tools/build-icons.cjs
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const BLUE = '#1a73e8';
const WHITE = '#ffffff';

// MathJax TeX 字库中的粗斜体 x（U+1D499），单位 1/1000 em，y 轴向上
const BOLD_ITALIC_X = 'M74 282H63Q43 282 43 296Q43 298 45 307T56 332T76 365T110 401T159 433Q200 451 233 451H236Q273 451 282 450Q358 437 382 400L392 410Q434 452 483 452Q538 452 568 421T599 346Q599 303 573 280T517 256Q494 256 478 270T462 308Q462 343 488 367Q501 377 520 385Q520 386 516 389T502 396T480 400T462 398Q429 383 415 341Q354 116 354 80T405 44Q449 44 485 74T535 142Q539 156 542 159T562 162H568H579Q599 162 599 148Q599 135 586 111T550 60T485 12T397 -8Q313 -8 266 35L258 44Q215 -7 161 -7H156Q99 -7 71 25T43 95Q43 143 70 165T125 188Q148 188 164 174T180 136Q180 101 154 77Q141 67 122 59Q124 54 136 49T161 43Q183 43 200 61T226 103Q287 328 287 364T236 400Q200 400 164 377T107 302Q103 288 100 285T80 282H74Z';

// 原稿坐标：128 × 128，蓝底铺满；输出时按尺寸留边
const LARGE = {
  radical: { points: [[15, 67], [30, 57], [47, 100], [75, 24], [115, 24]], width: 11 },
  x: { x: 66 - 43 * 0.086, y: 97, k: 0.086 },
};
// 工具栏中的 16 / 32px：线条对齐像素，x 稍大（坐标仍按 128 计，1px = 8）
const SMALL = {
  radical: { points: [[8, 70], [26, 58], [44, 104], [72, 24], [120, 24]], width: 16 },
  x: { x: 66 - 43 * 0.1, y: 104, k: 0.1 },
};
const PADDING = { 16: 0, 32: 0, 48: 2, 64: 3, 128: 8, 192: 12, 512: 32 };

// ---------- 几何 ----------
// SVG 路径 → 多边形（曲线按固定段数展平）
function flatten(d, map) {
  const tokens = d.match(/[MLHVQTCSZ]|-?\d*\.?\d+(?:e-?\d+)?/gi);
  const polys = [];
  let poly = null;
  let cmd = '';
  let x = 0;
  let y = 0;
  let cx = 0; // 上一个控制点（用于 T / S）
  let cy = 0;
  let i = 0;
  const num = () => parseFloat(tokens[i++]);
  const push = (px, py) => poly.push(map(px, py));
  const quad = (x1, y1, x2, y2) => {
    for (let t = 1; t <= 12; t++) {
      const s = t / 12;
      push((1 - s) * (1 - s) * x + 2 * (1 - s) * s * x1 + s * s * x2, (1 - s) * (1 - s) * y + 2 * (1 - s) * s * y1 + s * s * y2);
    }
    cx = x1; cy = y1; x = x2; y = y2;
  };
  const cubic = (x1, y1, x2, y2, x3, y3) => {
    for (let t = 1; t <= 16; t++) {
      const s = t / 16;
      const a = (1 - s) ** 3;
      const b = 3 * (1 - s) ** 2 * s;
      const c = 3 * (1 - s) * s * s;
      const e = s ** 3;
      push(a * x + b * x1 + c * x2 + e * x3, a * y + b * y1 + c * y2 + e * y3);
    }
    cx = x2; cy = y2; x = x3; y = y3;
  };
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
    const C = cmd.toUpperCase();
    if (C === 'M') { x = num(); y = num(); poly = []; polys.push(poly); push(x, y); cx = x; cy = y; cmd = 'L'; }
    else if (C === 'L') { x = num(); y = num(); push(x, y); cx = x; cy = y; }
    else if (C === 'H') { x = num(); push(x, y); cx = x; cy = y; }
    else if (C === 'V') { y = num(); push(x, y); cx = x; cy = y; }
    else if (C === 'Q') { const a = num(); const b = num(); quad(a, b, num(), num()); }
    else if (C === 'T') { quad(2 * x - cx, 2 * y - cy, num(), num()); }
    else if (C === 'C') { const a = num(); const b = num(); const c = num(); const e = num(); cubic(a, b, c, e, num(), num()); }
    else if (C === 'S') { const c = num(); const e = num(); cubic(2 * x - cx, 2 * y - cy, c, e, num(), num()); }
    else if (C === 'Z') { cmd = ''; }
    else i++;
  }
  return polys.filter((p) => p.length > 2);
}

// 折线描边（斜接拐角、平头端点）→ 多边形
function stroke(points, width) {
  const h = width / 2;
  const normal = (a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy);
    return [-dy / l, dx / l];
  };
  const side = (sign) => {
    const out = [];
    for (let k = 0; k < points.length; k++) {
      const p = points[k];
      const n0 = k > 0 ? normal(points[k - 1], p) : null;
      const n1 = k < points.length - 1 ? normal(p, points[k + 1]) : null;
      if (!n0 || !n1) {
        const n = n0 || n1;
        out.push([p[0] + sign * h * n[0], p[1] + sign * h * n[1]]);
        continue;
      }
      // 两条偏移线的交点
      const m = [n0[0] + n1[0], n0[1] + n1[1]];
      const ml = Math.hypot(m[0], m[1]);
      const cos = (m[0] * n0[0] + m[1] * n0[1]) / ml;
      const len = h / cos;
      out.push([p[0] + sign * len * m[0] / ml, p[1] + sign * len * m[1] / ml]);
    }
    return out;
  };
  return side(1).concat(side(-1).reverse());
}

// ---------- 光栅化 ----------
// 非零环绕规则填充；ss × ss 超采样
function coverage(polys, size, ss) {
  const W = size * ss;
  const edges = [];
  for (const poly of polys) {
    for (let k = 0; k < poly.length; k++) {
      const [x0, y0] = poly[k].map((v) => v * ss);
      const [x1, y1] = poly[(k + 1) % poly.length].map((v) => v * ss);
      if (y0 === y1) continue;
      if (y0 < y1) edges.push({ ya: y0, yb: y1, x: x0, dx: (x1 - x0) / (y1 - y0), w: 1 });
      else edges.push({ ya: y1, yb: y0, x: x1, dx: (x0 - x1) / (y0 - y1), w: -1 });
    }
  }
  const acc = new Float32Array(size * size);
  for (let row = 0; row < W; row++) {
    const c = row + 0.5;
    const xs = [];
    for (const e of edges) if (c >= e.ya && c < e.yb) xs.push([e.x + (c - e.ya) * e.dx, e.w]);
    xs.sort((a, b) => a[0] - b[0]);
    let wind = 0;
    for (let k = 0; k < xs.length - 1; k++) {
      wind += xs[k][1];
      if (!wind) continue;
      const a = Math.max(0, Math.ceil(xs[k][0] - 0.5));
      const b = Math.min(W, Math.ceil(xs[k + 1][0] - 0.5));
      const py = Math.floor(row / ss);
      for (let x = a; x < b; x++) acc[py * size + Math.floor(x / ss)] += 1;
    }
  }
  const n = ss * ss;
  for (let k = 0; k < acc.length; k++) acc[k] /= n;
  return acc;
}

const rgb = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255);

function render(size) {
  const pad = PADDING[size] ?? Math.round(size / 16);
  const s = (size - 2 * pad) / 128;
  const at = (x, y) => [pad + x * s, pad + y * s];
  const { radical, x: g } = size <= 32 ? SMALL : LARGE;
  const layers = [
    { color: BLUE, polys: [[at(0, 0), at(128, 0), at(128, 128), at(0, 128)]] },
    { color: WHITE, polys: [stroke(radical.points.map(([x, y]) => at(x, y)), radical.width * s)] },
    { color: WHITE, polys: flatten(BOLD_ITALIC_X, (x, y) => at(g.x + x * g.k, g.y - y * g.k)) },
  ];
  const ss = size <= 64 ? 16 : 6;
  const px = new Float32Array(size * size * 4); // 预乘 alpha
  for (const layer of layers) {
    const cov = coverage(layer.polys, size, ss);
    const [r, g, b] = rgb(layer.color);
    for (let k = 0; k < cov.length; k++) {
      const a = Math.min(1, cov[k]);
      if (!a) continue;
      const o = k * 4;
      px[o] = r * a + px[o] * (1 - a);
      px[o + 1] = g * a + px[o + 1] * (1 - a);
      px[o + 2] = b * a + px[o + 2] * (1 - a);
      px[o + 3] = a + px[o + 3] * (1 - a);
    }
  }
  const out = Buffer.alloc(size * size * 4);
  for (let k = 0; k < size * size; k++) {
    const a = px[k * 4 + 3];
    for (let c = 0; c < 3; c++) out[k * 4 + c] = a ? Math.round((px[k * 4 + c] / a) * 255) : 0;
    out[k * 4 + 3] = Math.round(a * 255);
  }
  return out;
}

// ---------- PNG ----------
const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
function png(size, rgba) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 位深
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- 输出 ----------
function svg() {
  const { radical, x: g } = LARGE;
  const pts = radical.points.map((p) => p.join(' ')).join(' L');
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">\n' +
    `  <rect width="128" height="128" fill="${BLUE}"/>\n` +
    `  <path d="M${pts}" fill="none" stroke="${WHITE}" stroke-width="${radical.width}" stroke-miterlimit="10"/>\n` +
    `  <path transform="translate(${+g.x.toFixed(3)} ${g.y}) scale(${g.k} -${g.k})" fill="${WHITE}" d="${BOLD_ITALIC_X}"/>\n` +
    '</svg>\n';
}

const dir = path.join(__dirname, '..', 'icons');
fs.writeFileSync(path.join(dir, 'icon.svg'), svg());
for (const size of Object.keys(PADDING).map(Number)) fs.writeFileSync(path.join(dir, `icon${size}.png`), png(size, render(size)));
console.log('icons:', Object.keys(PADDING).join(', '));
