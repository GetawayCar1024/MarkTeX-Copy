// 从 MathJax 3 的 SVG 字库生成“字形轮廓签名 → 字符”对照表（src/mathjax-glyphs.js）。
// 用于识别 Typora 等工具用 MathJax SVG 导出的 PDF：其中公式是矢量路径，没有文字。
//
// 用法：node tools/build-mathjax-glyphs.cjs <mathjax-full 包目录>
//   例如先 `npm pack mathjax-full@3.2.2` 并解压，再传入解压出的 package 目录。
//
// 签名规则（必须与 src/pdf-glyphs.js 中对 PDF.js 路径数据的处理一致）：
//   只取每段路径的终点，按顺序拼接：M x,y / P x,y / Z，坐标是相对于第一个点的整数（字库坐标都是整数）。
//   直线和曲线都记为 P（Chrome 导出时会把退化的曲线改成直线），并跳过零长度的段；
//   闭合（Z）前若不在子路径起点，补一段回到起点。
//   用相对坐标是因为 macOS（Quartz）导出的 PDF 会把字形路径直接换算成页面坐标，
//   只能先由坐标间的整数比例求出缩放，再得到相对于起点的字库坐标；Windows（Chrome）导出的则是原始字库坐标。
//
// 表的值：[码位, 变体, 字宽, 起点 x, 起点 y, ...]，每 5 项一个候选。
// 同一形状在不同位置出现时（如句点“.”与居中点“⋅”）保留多个候选，由起点位置或同一行的基线区分。
const fs = require('fs');
const path = require('path');

// 路径终点序列：[['M', x, y] | ['P', x, y] | ['Z']]
function outline(d) {
  const tokens = d.match(/[MLHVQTCSZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) || [];
  const out = [];
  let cmd = null;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let i = 0;
  const num = () => parseFloat(tokens[i++]);
  const r = (v) => Math.round(v);
  const seg = (nx, ny) => {
    if (r(nx) !== r(x) || r(ny) !== r(y)) out.push(['P', r(nx), r(ny)]);
    x = nx;
    y = ny;
  };
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
    switch (cmd) {
      case 'M': x = num(); y = num(); sx = x; sy = y; out.push(['M', r(x), r(y)]); cmd = 'L'; break;
      case 'L': { const nx = num(); seg(nx, num()); break; }
      case 'H': seg(num(), y); break;
      case 'V': seg(x, num()); break;
      case 'Q': { num(); num(); const nx = num(); seg(nx, num()); break; }
      case 'T': { const nx = num(); seg(nx, num()); break; }
      case 'C': { num(); num(); num(); num(); const nx = num(); seg(nx, num()); break; }
      case 'S': { num(); num(); const nx = num(); seg(nx, num()); break; }
      case 'Z': case 'z':
        // 闭合时补一段回到子路径起点（PDF 中会显式写出这一段）
        if (out.length && out[out.length - 1][0] !== 'Z') { seg(sx, sy); out.push(['Z']); }
        x = sx; y = sy; cmd = null; break;
      default: i++; // 未知指令：跳过
    }
  }
  return out;
}

function signature(points) {
  const [, x0, y0] = points[0];
  return points.map((p) => (p[0] === 'Z' ? 'Z' : `${p[0]}${p[1] - x0},${p[2] - y0}`)).join(' ');
}

// 32 位 FNV-1a，作为签名的紧凑键
function fnv(s) {
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// 同一轮廓、同一位置出现在多个码位 / 变体中时，保留最常用的那个
const rank = (v) => (v === 'normal' ? 0 : v === 'math' || v === 'italic' ? 1 : 2);
// 形状相同的字符中优先使用的码位：撇号 ′（而不是 ʹ）、拉丁字母（而不是同形的希腊大写字母）、Δ / Ω（而不是 ∆ / Ω）
const PREFER = new Set([0x2032, 0x394, 0x3a9, 0x27, 0x22, 0x2e, 0x7c, 0xd7, 0x2016, 0xb7, 0x2f, 0x2c6, 0x2dc]);
const better = (a, b) => {
  if (rank(a.variant) !== rank(b.variant)) return rank(a.variant) < rank(b.variant);
  const latin = (c) => c < 0x300;
  if (PREFER.has(a.cp) !== PREFER.has(b.cp)) return PREFER.has(a.cp);
  if (latin(a.cp) !== latin(b.cp)) return latin(a.cp);
  return a.cp < b.cp;
};

function build(pkg) {
  const dir = path.join(pkg, 'js/output/svg/fonts/tex');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
  const groups = new Map();
  let total = 0;
  for (const f of files) {
    const mod = require(path.join(dir, f));
    const variant = Object.keys(mod)[0];
    for (const [code, info] of Object.entries(mod[variant])) {
      const opts = info[3];
      if (!opts || !opts.p) continue;
      const pts = outline('M' + opts.p + (/Z\s*$/i.test(opts.p) ? '' : 'Z'));
      const key = fnv(signature(pts));
      const entry = { cp: +code, variant, w: Math.round((info[2] || 0) * 1000), x0: pts[0][1], y0: pts[0][2] };
      total++;
      if (!groups.has(key)) groups.set(key, []);
      const list = groups.get(key);
      const same = list.findIndex((e) => e.x0 === entry.x0 && e.y0 === entry.y0);
      if (same < 0) list.push(entry);
      else if (better(entry, list[same])) list[same] = entry;
    }
  }
  const table = {};
  let multi = 0;
  for (const [key, list] of groups) {
    list.sort((a, b) => (better(a, b) ? -1 : better(b, a) ? 1 : 0));
    if (list.length > 1) multi++;
    table[key] = list.flatMap((e) => [e.cp, e.variant, e.w, e.x0, e.y0]);
  }

  const out = path.join(__dirname, '..', 'src', 'mathjax-glyphs.js');
  const body = '// 自动生成：tools/build-mathjax-glyphs.cjs（MathJax 3 SVG TeX 字库）。请勿手改。\n' +
    '// 键：字形轮廓签名的哈希；值：[Unicode 码位, MathJax 变体, 字宽（1/1000 em）, 起点 x, 起点 y]，可能有多组\n' +
    '(() => {\n  const CCM = (globalThis.__CCM = globalThis.__CCM || {});\n  CCM.mathjaxGlyphs = ' +
    JSON.stringify(table) + ';\n})();\n';
  fs.writeFileSync(out, body);
  console.log(`glyphs: ${total}, signatures: ${groups.size}, with several positions: ${multi}, size: ${(body.length / 1024).toFixed(0)} KB`);
}

module.exports = { outline, signature, fnv };
if (require.main === module) build(path.resolve(process.argv[2] || '.'));
