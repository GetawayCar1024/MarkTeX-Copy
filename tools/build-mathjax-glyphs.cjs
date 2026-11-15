// 从 MathJax 3 的 SVG 字库生成“字形轮廓签名 → 字符”对照表（src/mathjax-glyphs.js）。
// 用于识别 Typora 等工具用 MathJax SVG 导出的 PDF：其中公式是矢量路径，没有文字。
//
// 用法：node tools/build-mathjax-glyphs.cjs <mathjax-full 包目录>
//   例如先 `npm pack mathjax-full@3` 并解压，再传入解压出的 package 目录。
//
// 签名规则（必须与 src/pdf-glyphs.js 中对 PDF.js 路径数据的处理一致）：
//   只取每段路径的终点并四舍五入为整数，按顺序拼接：M x,y / P x,y / Z。
//   直线和曲线都记为 P（Chrome 导出时会把退化的曲线改成直线），并跳过零长度的段；
//   闭合（Z）前若不在子路径起点，补一段回到起点。
const fs = require('fs');
const path = require('path');


function signature(d) {
  const tokens = d.match(/[MLHVQTCSZ]|-?\d*\.?\d+(?:e-?\d+)?/gi) || [];
  const out = [];
  let cmd = null;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  const num = () => parseFloat(tokens[i++]);
  let i = 0;
  const r = (v) => Math.round(v);
  const seg = (nx, ny) => {
    if (r(nx) !== r(x) || r(ny) !== r(y)) out.push(`P${r(nx)},${r(ny)}`);
    x = nx;
    y = ny;
  };
  while (i < tokens.length) {
    if (/^[A-Za-z]$/.test(tokens[i])) cmd = tokens[i++];
    switch (cmd) {
      case 'M': x = num(); y = num(); sx = x; sy = y; out.push(`M${r(x)},${r(y)}`); cmd = 'L'; break;
      case 'L': { const nx = num(); seg(nx, num()); break; }
      case 'H': seg(num(), y); break;
      case 'V': seg(x, num()); break;
      case 'Q': { num(); num(); const nx = num(); seg(nx, num()); break; }
      case 'T': { const nx = num(); seg(nx, num()); break; }
      case 'C': { num(); num(); num(); num(); const nx = num(); seg(nx, num()); break; }
      case 'S': { num(); num(); const nx = num(); seg(nx, num()); break; }
      case 'Z': case 'z':
        // 闭合时补一段回到子路径起点（PDF 中会显式写出这一段）
        if (out[out.length - 1] !== 'Z') { seg(sx, sy); out.push('Z'); }
        x = sx; y = sy; cmd = null; break;
      default: i++; // 未知指令：跳过
    }
  }
  return out.join(' ');
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

function build(pkg) {
const dir = path.join(pkg, 'js/output/svg/fonts/tex');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js'));
const table = {};
let total = 0;
let dup = 0;
for (const f of files) {
  const mod = require(path.join(dir, f));
  const variant = Object.keys(mod)[0];
  const data = mod[variant];
  for (const [code, info] of Object.entries(data)) {
    const opts = info[3];
    if (!opts || !opts.p) continue;
    const sig = signature('M' + opts.p + (/Z\s*$/i.test(opts.p) ? '' : 'Z'));
    const key = fnv(sig);
    const cp = +code;
    const w = Math.round((info[2] || 0) * 1000);
    const entry = [cp, variant, w];
    total++;
    if (table[key] && (table[key][0] !== cp || table[key][1] !== variant)) {
      dup++;
      // 同一轮廓出现在多个变体中（例如 normal 与 smallop 共用）：保留较“常用”的那个
      const rank = (v) => (v === 'normal' ? 0 : v === 'math' || v === 'italic' ? 1 : 2);
      if (rank(variant) >= rank(table[key][1])) continue;
    }
    table[key] = entry;
  }
}

const out = path.join(__dirname, '..', 'src', 'mathjax-glyphs.js');
const body = '// 自动生成：tools/build-mathjax-glyphs.cjs（MathJax 3 SVG TeX 字库）。请勿手改。\n' +
  '// 键：字形轮廓签名的哈希；值：[Unicode 码位, MathJax 变体, 字宽（1/1000 em）]\n' +
  '(() => {\n  const CCM = (globalThis.__CCM = globalThis.__CCM || {});\n  CCM.mathjaxGlyphs = ' +
  JSON.stringify(table) + ';\n})();\n';
fs.writeFileSync(out, body);
console.log(`glyphs: ${total}, unique signatures: ${Object.keys(table).length}, shared: ${dup}, size: ${(body.length / 1024).toFixed(0)} KB`);
}

module.exports = { signature, fnv };
if (require.main === module) build(path.resolve(process.argv[2] || '.'));
