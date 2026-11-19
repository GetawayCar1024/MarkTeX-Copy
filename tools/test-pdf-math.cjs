// node --test tools/test-pdf-math.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function load() {
  const ctx = vm.createContext({ console });
  for (const file of ['mathml2latex.js', 'pdf-text.js', 'pdf-glyphs.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), ctx, { filename: file });
  }
  return { ctx, c: ctx.__CCM };
}

const piece = (str, x0, y, extra = {}) => ({ str, x0, x1: x0 + 5, y, s: 10, page: 1, font: 'CMMI10', mathFont: true, ...extra });
function lines(c, pieces) {
  c.pdfPages = { 1: { top: 200, height: 200 } };
  return c._pdfDebug.richLines(pieces.map((p, order) => ({ ...p, order })), { noImages: true });
}
const formula = (l) => l.parts.filter((p) => p.t === 'math').map((p) => p.tex).join(' ');

test('TeX fraction rules may be stroked lines, not filled rectangles', async () => {
  const { ctx, c } = load();
  ctx.pdfjsLib = { OPS: { constructPath: 91, stroke: 20 } };
  c.mathjaxGlyphs = {};
  const page = {
    pageNumber: 1,
    view: [0, 0, 200, 200],
    commonObjs: { get: () => ({ name: 'AAAAAA+CMR10' }) },
    getOperatorList: async () => ({ fnArray: [91], argsArray: [[20, [[0, 20, 100, 1, 30, 100]], [20, 100, 30, 100]]] }),
    getTextContent: async () => ({ items: [
      { str: '1', fontName: 'f1', transform: [10, 0, 0, 10, 22, 105], width: 5 },
      { str: '2', fontName: 'f1', transform: [10, 0, 0, 10, 22, 90], width: 5 },
    ] }),
  };
  const { items } = await c.pdfGlyphsFor(page);
  assert.equal(items.filter((g) => g.rule).length, 1);
});

test('TeX determinant bars may be drawn instead of stored as text', async () => {
  const { ctx, c } = load();
  ctx.pdfjsLib = { OPS: { constructPath: 91, stroke: 20 } };
  c.mathjaxGlyphs = {};
  const page = {
    pageNumber: 1,
    view: [0, 0, 200, 200],
    commonObjs: { get: () => ({ name: 'AAAAAA+CMMI10' }) },
    getOperatorList: async () => ({ fnArray: [91, 91], argsArray: [20, 50].map((x) =>
      [20, [[0, x, 80, 1, x, 110]], [x, 80, x, 110]]) }),
    getTextContent: async () => ({ items: ['a', 'b', 'c', 'd'].map((str, i) =>
      ({ str, fontName: 'f1', transform: [10, 0, 0, 10, i % 2 ? 40 : 25, i < 2 ? 100 : 85], width: 5 })) }),
  };
  const { items } = await c.pdfGlyphsFor(page);
  assert.equal(items.filter((g) => g.str === '|' && g.tall).length, 2);
});

test('CMEX form-feed glyphs are delimiters, not whitespace', async () => {
  const { ctx, c } = load();
  ctx.pdfjsLib = { OPS: { setFont: 1, beginText: 2, moveText: 3, showText: 4 } };
  c.mathjaxGlyphs = {};
  const page = {
    pageNumber: 1,
    view: [0, 0, 200, 200],
    commonObjs: { get: () => ({ name: 'AAAAAA+CMEX10' }) },
    getOperatorList: async () => ({ fnArray: [1, 2, 3, 4], argsArray: [
      ['cmex', 10], [], [20, 100], [[{ originalCharCode: 12, unicode: '\f', width: 333.3, isSpace: false }]],
    ] }),
  };
  const { items } = await c.pdfGlyphsFor(page);
  assert.equal(items.length, 1);
  assert.equal(items[0].str, '|');
  assert.equal(items[0].x, 20);
  assert.ok(items[0].tall.top > items[0].tall.bottom);
});

test('math font styles and letterlike Unicode retain their LaTeX meaning', () => {
  const { c } = load();
  assert.equal(c._pdfParseMath([piece('R', 0, 100, { style: 'mathbb' }), piece('n', 5, 104, { s: 7 })]), '\\mathbb{R}^n');
  assert.equal(c._pdfParseMath([piece('α', 0, 100, { style: 'boldsymbol' })]), '\\boldsymbol{\\alpha}');
  assert.equal(c.charTex('ℱ'), '\\mathscr{F}');
  assert.equal(c.charTex('≢'), '\\not\\equiv');
});

test('a negation slash overlays the following relation', () => {
  const { c } = load();
  const tex = c._pdfParseMath([piece('a', 0, 100), piece('\u0338', 8, 100, { x1: 8 }), piece('=', 8, 100), piece('b', 18, 100)]);
  assert.equal(tex, 'a\\ne b');
});

test('a radical bar includes its index and the whole radicand', () => {
  const { c } = load();
  const tex = c._pdfParseMath([
    piece('√', 0, 100, { x1: 10, geo: true }), piece('3', 3, 105, { x1: 6, s: 5 }),
    piece('', 10, 110, { x1: 33, rule: true }), piece('x', 10, 100), piece('2', 15, 104, { s: 7 }),
    piece('+', 21, 100), piece('y', 28, 100),
  ]);
  assert.equal(tex, '\\sqrt[3]{x^2+y}');
});

test('upper and lower rules have the correct orientation', () => {
  const { c } = load();
  for (const [y, name] of [[108, 'overline'], [98, 'underline']]) {
    const tex = c._pdfParseMath([piece('u', 0, 100), piece('', 0, y, { x1: 5, rule: true })]);
    assert.equal(tex, `\\${name}{u}`);
  }
});

test('labels belong above relations, not above arbitrary fraction digits', () => {
  const { c } = load();
  assert.equal(c._pdfParseMath([
    piece('=', 0, 100, { x1: 10 }), piece('def', 0, 108, { x1: 10, s: 7, upright: true }),
  ]), '\\overset{\\text{def}}{=}');
  assert.equal(c._pdfParseMath([
    piece('1', 0, 107), piece('', 0, 103, { x1: 10, rule: true }), piece('i', 0, 95), piece('2', 5, 99, { s: 7 }),
  ]), '\\frac{1}{i^2}');
});

test('matrix rows are joined by their tall delimiters', () => {
  const { c } = load();
  const ls = lines(c, [
    piece('(', 0, 116, { isExt: true, extH: 3 }), piece(')', 30, 116, { isExt: true, extH: 3 }),
    piece('a', 7, 108), piece('b', 22, 108), piece('c', 7, 92), piece('d', 22, 92),
  ]);
  assert.equal(ls.length, 1);
  assert.equal(formula(ls[0]), '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}');
});

test('cases retain the condition column, including ordinary text', () => {
  const { c } = load();
  const ls = lines(c, [
    piece('{', 0, 118, { isExt: true, extH: 3 }), piece('1', 7, 108), piece('0', 7, 92),
    piece('x', 22, 108), piece('>', 28, 108), piece('0', 34, 108),
    piece('otherwise', 22, 92, { x1: 60, mathFont: false, font: 'LMRoman10-Regular' }),
  ]);
  assert.equal(ls.length, 1);
  assert.equal(formula(ls[0]), '\\begin{cases} 1 & x>0 \\\\ 0 & \\text{otherwise} \\end{cases}');
});

test('subscripts inside tall parentheses are not binomial rows', () => {
  const { c } = load();
  const tex = c._pdfParseMath([
    piece('(', 0, 110, { isExt: true, extH: 2.4 }), piece('b', 7, 100), piece('i', 12, 96, { s: 7 }),
    piece(')', 18, 110, { isExt: true, extH: 2.4 }),
  ]);
  assert.equal(tex, '\\left(b_i\\right)');
});

test('a vector formula uses its own baseline, not the surrounding text baseline', () => {
  const { c } = load();
  const ls = lines(c, [
    piece('正文', 0, 100, { x1: 20, font: 'SimSun', mathFont: false }),
    piece('x', 21, 95, { geo: true }), piece('i', 26, 92, { s: 7, geo: true }),
  ]);
  assert.equal(formula(ls[0]), 'x_i');
});

test('a standalone extension-font operator has a finite line size', () => {
  const { c } = load();
  const ls = lines(c, [piece('∑', 0, 110, { isExt: true })]);
  assert.equal(ls.length, 1);
  assert.ok(Number.isFinite(ls[0].s));
  assert.equal(formula(ls[0]), '\\sum');
});

test('monospace letters, digits and punctuation use the same text command', () => {
  const { c } = load();
  for (const cp of [0x1d68a, 0x1d7f6, 0x3a, 0x5f, 0x3c]) {
    const g = c._glyphDebug.glyphInfo([cp, 'monospace', 525]);
    assert.equal(g.cmd, 'texttt');
  }
});

test('an unknown font variant does not discard readable characters', () => {
  const { c } = load();
  const g = c._glyphDebug.glyphInfo([0x61, 'unknown-font-variant', 500]);
  assert.equal(g.str, 'a');
  assert.equal(c._pdfParseMath([piece(g.str, 0, 100)]), 'a');
});
