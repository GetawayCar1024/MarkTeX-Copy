// 绘制图标的公共部分（tools/build-icons.cjs、tools/build-reader-icons.cjs 共用）：路径展平、基本图形、TeX 字形、
// 扫描线填充（超采样抗锯齿）与 PNG 编码。不依赖第三方库。
const zlib = require('zlib');

// MathJax TeX 字库中的粗斜体 x（U+1D499）与粗体 2（U+1D7D0）（Apache License 2.0），单位 1/1000 em，y 轴向上
const X_PATH = 'M74 282H63Q43 282 43 296Q43 298 45 307T56 332T76 365T110 401T159 433Q200 451 233 451H236Q273 451 282 450Q358 437 382 400L392 410Q434 452 483 452Q538 452 568 421T599 346Q599 303 573 280T517 256Q494 256 478 270T462 308Q462 343 488 367Q501 377 520 385Q520 386 516 389T502 396T480 400T462 398Q429 383 415 341Q354 116 354 80T405 44Q449 44 485 74T535 142Q539 156 542 159T562 162H568H579Q599 162 599 148Q599 135 586 111T550 60T485 12T397 -8Q313 -8 266 35L258 44Q215 -7 161 -7H156Q99 -7 71 25T43 95Q43 143 70 165T125 188Q148 188 164 174T180 136Q180 101 154 77Q141 67 122 59Q124 54 136 49T161 43Q183 43 200 61T226 103Q287 328 287 364T236 400Q200 400 164 377T107 302Q103 288 100 285T80 282H74Z';
const TWO_PATH = 'M175 580Q175 578 185 572T205 551T215 510Q215 467 191 449T137 430Q107 430 83 448T58 511Q58 558 91 592T168 640T259 654Q328 654 383 637Q451 610 484 563T517 459Q517 401 482 360T368 262Q340 243 265 184L210 140H274Q416 140 429 145Q439 148 447 186T455 237H517V233Q516 230 501 119Q489 9 486 4V0H57V25Q57 51 58 54Q60 57 109 106T215 214T288 291Q364 377 364 458Q364 515 328 553T231 592Q214 592 201 589T181 584T175 580Z';
// 上标 2：0.7 倍大小，基线抬高 0.4em
const TWO_SCALE = 0.7;
const TWO_SHIFT = [630, 400];

// ---------- 几何 ----------
// SVG 路径（仅绝对坐标命令）→ 多边形，曲线按固定段数展平
function flatten(d) {
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
  const quad = (x1, y1, x2, y2) => {
    for (let t = 1; t <= 12; t++) {
      const s = t / 12;
      poly.push([(1 - s) * (1 - s) * x + 2 * (1 - s) * s * x1 + s * s * x2, (1 - s) * (1 - s) * y + 2 * (1 - s) * s * y1 + s * s * y2]);
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
      poly.push([a * x + b * x1 + c * x2 + e * x3, a * y + b * y1 + c * y2 + e * y3]);
    }
    cx = x2; cy = y2; x = x3; y = y3;
  };
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
    const C = cmd.toUpperCase();
    if (C === 'M') { x = num(); y = num(); poly = [[x, y]]; polys.push(poly); cx = x; cy = y; cmd = 'L'; }
    else if (C === 'L') { x = num(); y = num(); poly.push([x, y]); cx = x; cy = y; }
    else if (C === 'H') { x = num(); poly.push([x, y]); cx = x; cy = y; }
    else if (C === 'V') { y = num(); poly.push([x, y]); cx = x; cy = y; }
    else if (C === 'Q') { const a = num(); const b = num(); quad(a, b, num(), num()); }
    else if (C === 'T') { quad(2 * x - cx, 2 * y - cy, num(), num()); }
    else if (C === 'C') { const a = num(); const b = num(); const c = num(); const e = num(); cubic(a, b, c, e, num(), num()); }
    else if (C === 'S') { const c = num(); const e = num(); cubic(2 * x - cx, 2 * y - cy, c, e, num(), num()); }
    else if (C === 'Z') { cmd = ''; }
    else i++;
  }
  return polys.filter((p) => p.length > 2);
}

// Apple 图标的连续曲率圆角：用指数为 5 的超椭圆近似
function squircle(x0, y0, x1, y1, steps = 256) {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const a = (x1 - x0) / 2;
  const b = (y1 - y0) / 2;
  const pts = [];
  for (let k = 0; k < steps; k++) {
    const t = (k / steps) * 2 * Math.PI;
    const c = Math.cos(t);
    const s = Math.sin(t);
    pts.push([cx + a * Math.sign(c) * Math.abs(c) ** 0.4, cy + b * Math.sign(s) * Math.abs(s) ** 0.4]);
  }
  return pts;
}
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
function roundRect(x0, y0, x1, y1, r, steps = 12) {
  r = Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2);
  const pts = [];
  const corner = (cx, cy, a0) => {
    for (let k = 0; k <= steps; k++) {
      const t = a0 + (k / steps) * (Math.PI / 2);
      pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
  };
  corner(x1 - r, y0 + r, -Math.PI / 2);
  corner(x1 - r, y1 - r, 0);
  corner(x0 + r, y1 - r, Math.PI / 2);
  corner(x0 + r, y0 + r, Math.PI);
  return pts;
}
const circle = (cx, cy, r, steps = 64) => Array.from({ length: steps }, (_, k) => [cx + r * Math.cos((k / steps) * 2 * Math.PI), cy + r * Math.sin((k / steps) * 2 * Math.PI)]);
// 线段（平头），宽 w
function segment([x0, y0], [x1, y1], w) {
  const l = Math.hypot(x1 - x0, y1 - y0);
  const nx = ((y0 - y1) / l) * (w / 2);
  const ny = ((x1 - x0) / l) * (w / 2);
  return [[x0 + nx, y0 + ny], [x1 + nx, y1 + ny], [x1 - nx, y1 - ny], [x0 - nx, y0 - ny]];
}
// 折线描边（斜接拐角，过尖的拐角改为斜切；平头端点）
function polyline(points, width, miterLimit = 2) {
  const h = width / 2;
  const normal = (a, b) => {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const l = Math.hypot(dx, dy);
    return [-dy / l, dx / l];
  };
  const side = (sign) => points.flatMap((p, k) => {
    const n0 = k > 0 ? normal(points[k - 1], p) : null;
    const n1 = k < points.length - 1 ? normal(p, points[k + 1]) : null;
    if (!n0 || !n1) {
      const n = n0 || n1;
      return [[p[0] + sign * h * n[0], p[1] + sign * h * n[1]]];
    }
    const m = [n0[0] + n1[0], n0[1] + n1[1]];
    const ml = Math.hypot(m[0], m[1]);
    const cos = ml > 1e-9 ? (m[0] * n0[0] + m[1] * n0[1]) / ml : 0;
    if (cos > 1 / miterLimit) {
      const len = h / cos;
      return [[p[0] + sign * len * m[0] / ml, p[1] + sign * len * m[1] / ml]];
    }
    return [[p[0] + sign * h * n0[0], p[1] + sign * h * n0[1]], [p[0] + sign * h * n1[0], p[1] + sign * h * n1[1]]];
  });
  return side(1).concat(side(-1).reverse());
}
// 小尺寸下的斜体 x：两笔斜线。box 为外框，slant 为上端相对下端向右的偏移
const strokeX = ([x0, y0, x1, y1], weight, slant) => [segment([x0 + slant, y0], [x1 - slant, y1], weight), segment([x1, y0], [x0, y1], weight)];

// ---------- TeX 字形 ----------
function shape(polys) {
  const xs = polys.flat().map((p) => p[0]);
  const ys = polys.flat().map((p) => p[1]);
  return { polys, box: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
}
const xPolys = flatten(X_PATH).map((p) => p.map(([px, py]) => [px, -py]));
const twoPolys = flatten(TWO_PATH).map((p) => p.map(([px, py]) => [TWO_SCALE * px + TWO_SHIFT[0], -(TWO_SCALE * py + TWO_SHIFT[1])]));
// 字体单位、y 轴向下
const TEX = { x: shape(xPolys), x2: shape([...xPolys, ...twoPolys]) };
// 把字形放到中心 (cx, cy)，宽 w 或高 h；返回放好的多边形与变换（缩放 k、平移 ox / oy）
function fit(g, { cx, cy, w, h }) {
  const [x0, y0, x1, y1] = g.box;
  const k = w ? w / (x1 - x0) : h / (y1 - y0);
  const ox = cx - ((x0 + x1) / 2) * k;
  const oy = cy - ((y0 + y1) / 2) * k;
  return { k, ox, oy, polys: g.polys.map((p) => p.map(([x, y]) => [ox + x * k, oy + y * k])) };
}

// ---------- 光栅化 ----------
// 非零环绕规则填充；ss × ss 超采样，返回每个像素的覆盖率
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
    const py = Math.floor(row / ss);
    for (let k = 0; k < xs.length - 1; k++) {
      wind += xs[k][1];
      if (!wind) continue;
      const a = Math.max(0, Math.ceil(xs[k][0] - 0.5));
      const b = Math.min(W, Math.ceil(xs[k + 1][0] - 0.5));
      for (let x = a; x < b; x++) acc[py * size + Math.floor(x / ss)] += 1;
    }
  }
  const n = ss * ss;
  for (let k = 0; k < acc.length; k++) acc[k] = Math.min(1, acc[k] / n);
  return acc;
}

const rgb = (hex) => [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16) / 255);

// 图层：{ polys, fill, alpha }。fill 为颜色 '#rrggbb'，或线性渐变 { from: [x, y], to: [x, y], stops: [起点颜色, 终点颜色] }
function rasterize(layers, size) {
  const ss = size <= 64 ? 16 : 6;
  const px = new Float32Array(size * size * 4); // 预乘 alpha
  for (const layer of layers) {
    const cov = coverage(layer.polys, size, ss);
    const alpha = layer.alpha ?? 1;
    const solid = typeof layer.fill === 'string' ? rgb(layer.fill) : null;
    let g = null;
    if (!solid) {
      const [fx, fy] = layer.fill.from;
      const [tx, ty] = layer.fill.to;
      const d2 = (tx - fx) ** 2 + (ty - fy) ** 2;
      g = { fx, fy, dx: (tx - fx) / d2, dy: (ty - fy) / d2, a: rgb(layer.fill.stops[0]), b: rgb(layer.fill.stops[1]) };
    }
    for (let k = 0; k < cov.length; k++) {
      const a = cov[k] * alpha;
      if (!a) continue;
      let color = solid;
      if (!color) {
        const x = (k % size) + 0.5 - g.fx;
        const y = Math.floor(k / size) + 0.5 - g.fy;
        const t = Math.min(1, Math.max(0, x * g.dx + y * g.dy));
        color = g.a.map((v, c) => v + (g.b[c] - v) * t);
      }
      const o = k * 4;
      for (let c = 0; c < 3; c++) px[o + c] = color[c] * a + px[o + c] * (1 - a);
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

module.exports = {
  X_PATH, TWO_PATH, TWO_SCALE, TWO_SHIFT, TEX,
  flatten, squircle, rect, roundRect, circle, segment, polyline, strokeX, fit, rasterize, png,
};
