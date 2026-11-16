// 识别“公式被画成矢量路径”的 PDF（Typora 等用 MathJax SVG 导出的 PDF）。
// 这类 PDF 的公式没有任何文字，只有一条条路径；但每个字形的路径就是 MathJax 字库里的原始轮廓，
// 因此可以按轮廓签名（见 tools/build-mathjax-glyphs.cjs）查表认出字符。
// 分数线、根号横线是单独的矩形，也一并记录下来，供公式还原使用。
//   * Windows（Chrome 打印）：字形路径是字库坐标，外加一个缩放变换
//   * macOS（Quartz 打印）：字形路径已换算为页面坐标，缩放由坐标间的整数比例求出
(() => {
  const CCM = (globalThis.__CCM = globalThis.__CCM || {});
  if (CCM.pdfGlyphsFor) return;

  // ---------- 签名：必须与 tools/build-mathjax-glyphs.cjs 保持一致 ----------
  // 路径终点：[[类型, x, y]]，类型 0 = M，1 = P，2 = Z；map 把路径坐标换算到所需坐标系，same 判断两个坐标是否相同
  function endpoints(data, map, same) {
    const out = [];
    let x = NaN;
    let y = NaN;
    let sx = NaN;
    let sy = NaN;
    const seg = (p) => {
      if (!same(p[0], x) || !same(p[1], y)) out.push([1, p[0], p[1]]);
      [x, y] = p;
    };
    for (let i = 0; i < data.length;) {
      const op = data[i++];
      if (op === 0) { [x, y] = map(data[i], data[i + 1]); sx = x; sy = y; out.push([0, x, y]); i += 2; }
      else if (op === 1) { seg(map(data[i], data[i + 1])); i += 2; }
      else if (op === 2) { seg(map(data[i + 4], data[i + 5])); i += 6; }
      else if (op === 3) { seg(map(data[i + 2], data[i + 3])); i += 4; }
      else if (op === 4) { if (out.length && out[out.length - 1][0] !== 2) { seg([sx, sy]); out.push([2]); } x = sx; y = sy; }
      else return null;
    }
    return out;
  }

  // 相对于第一个点的签名；fx、fy 把坐标差换算为字库单位
  function signature(pts, fx, fy) {
    const [, x0, y0] = pts[0];
    let s = '';
    for (const p of pts) {
      if (s) s += ' ';
      s += p[0] === 2 ? 'Z' : (p[0] ? 'P' : 'M') + Math.round((p[1] - x0) * fx) + ',' + Math.round((p[2] - y0) * fy);
    }
    return s;
  }

  // 表中的候选：[码位, 变体, 字宽, 起点 x, 起点 y] 每 5 项一组
  const candidates = (list) => {
    const out = [];
    for (let i = 0; i + 4 < list.length; i += 5) out.push({ cp: list[i], variant: list[i + 1], w: list[i + 2], x0: list[i + 3], y0: list[i + 4] });
    return out;
  };

  // 页面坐标中的字形：坐标差都是缩放 k 的整数倍（字库坐标都是整数）。
  // 取一个不太小的坐标差作为起点，假设它是 a 个字库单位；再由小到大逐个检验其余坐标差，
  // 同时用最小二乘修正 k。返回由大到小的几个可行缩放
  const NOISE = 1.5e-4; // PDF 中坐标差的误差（坐标约保留 4 位小数）
  function scalesOf(vals) {
    const out = [];
    if (!vals.length) return out;
    vals.sort((a, b) => a - b);
    const seed = vals.find((v) => v >= 0.12) || vals[vals.length - 1];
    for (let a = 1; a <= 64 && out.length < 3; a++) {
      let k = seed / a;
      if (k < 0.0015) break; // 对应字号 1.5pt
      let sxn = seed * a;
      let snn = a * a;
      let ok = true;
      for (const v of vals) {
        const q = v / k;
        const n = Math.round(q);
        const err = (q * NOISE) / (k * Math.sqrt(snn));
        if (err > 0.3 || Math.abs(q - n) > 0.1 + err) { ok = false; break; }
        sxn += v * n;
        snn += n * n;
        k = sxn / snn;
      }
      if (ok) out.push(k);
    }
    return out;
  }

  function pageGlyph(data, ctm, box, table) {
    const bw = box.x1 - box.x0;
    const bh = box.y1 - box.y0;
    if (!(bw > 0.1 || bh > 0.1) || bw > 160 || bh > 160) return null;
    const pts = endpoints(data, (x, y) => [ctm[0] * x + ctm[4], ctm[3] * y + ctm[5]], (a, b) => Math.abs(a - b) < 6e-4);
    if (!pts || pts.length < 4 || pts.length > 3000) return null;
    const [, X0, Y0] = pts[0];
    const vx = [];
    const vy = [];
    const add = (arr, d) => { d = Math.abs(d); if (d >= 6e-4) arr.push(d); };
    let px = X0;
    let py = Y0;
    for (const p of pts) {
      if (p[0] === 2) continue;
      add(vx, p[1] - X0); add(vx, p[1] - px);
      add(vy, p[2] - Y0); add(vy, p[2] - py);
      px = p[1];
      py = p[2];
    }
    const lookup = (kx, ky) => {
      const list = table[fnv(signature(pts, 1 / kx, 1 / ky))];
      return list ? { X0, Y0, kx, ky, cands: candidates(list).map((c) => ({ ...c, ox: X0 - kx * c.x0, oy: Y0 - ky * c.y0 })) } : null;
    };
    // 普通字形：横竖等比缩放，两个方向的坐标差一起求缩放
    for (const k of scalesOf(vx.concat(vy))) {
      const hit = lookup(k, k);
      if (hit) return hit;
    }
    // 可伸缩定界符的延伸部件：只在一个方向上拉伸
    const xs = scalesOf(vx);
    const ys = xs.length ? scalesOf(vy) : [];
    for (const kx of xs) {
      for (const ky of ys) {
        if (Math.abs(kx / ky - 1) < 0.004) continue;
        const hit = lookup(kx, ky);
        if (hit) return hit;
      }
    }
    return null;
  }

  // 形状相同、位置不同的字形（如句点“.”与居中点“⋅”、“…”与“⋯”）：取基线与附近字形一致的那个
  function resolvePositions(raw, known) {
    const refs = known.concat(raw.filter((r) => r.cands.length === 1).map((r) => ({ x: r.cands[0].ox, y: r.cands[0].oy, s: 1000 * r.kx })));
    for (const r of raw) {
      if (r.cands.length < 2) continue;
      const s = 1000 * r.kx;
      let best = null;
      for (const c of r.cands) {
        let d = Infinity;
        for (const g of refs) {
          if (Math.abs(g.s - s) > 0.35 * s || Math.abs(g.x - r.X0) > 5 * s) continue;
          d = Math.min(d, Math.abs(g.y - c.oy));
        }
        if (d < 0.15 * s && (!best || d < best.d)) best = { c, d };
      }
      if (best) r.cands = [best.c, ...r.cands.filter((c) => c !== best.c)];
    }
  }

  function fnv(s) {
    let h = 0x811c9dc5;
    for (let k = 0; k < s.length; k++) {
      h ^= s.charCodeAt(k);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
  }

  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  // 矩形 [x0, y0, x1, y1] 经变换 m 后的外框
  const boxOf = (m, r) => {
    const xs = [];
    const ys = [];
    for (const [x, y] of [[r[0], r[1]], [r[2], r[1]], [r[0], r[3]], [r[2], r[3]]]) {
      xs.push(m[0] * x + m[2] * y + m[4]);
      ys.push(m[1] * x + m[3] * y + m[5]);
    }
    return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
  };
  const intersect = (c, b) => (c ? { x0: Math.max(c.x0, b.x0), x1: Math.min(c.x1, b.x1), y0: Math.max(c.y0, b.y0), y1: Math.min(c.y1, b.y1) } : b);

  // 字体变体中的 ASCII 字母 → LaTeX 写法
  const VARIANT_CMD = {
    bold: 'mathbf', boldItalic: 'boldsymbol', monospace: 'mathtt',
    sansSerif: 'mathsf', sansSerifBold: 'mathsf', sansSerifItalic: 'mathsf', sansSerifBoldItalic: 'mathsf',
    fraktur: 'mathfrak', frakturBold: 'mathfrak',
    texCalligraphic: 'mathcal', texCalligraphicBold: 'mathcal',
  };
  // 拼接式的大括号、方括号等：只保留顶端部件并换成普通字符，其余部件丢弃
  const DELIM_PARTS = {
    '⎛': '(', '⎞': ')', '⎡': '[', '⎤': ']', '⎧': '{', '⎫': '}', '⌈': '⌈', '⌉': '⌉',
    '⎜': '', '⎝': '', '⎟': '', '⎠': '', '⎢': '', '⎣': '', '⎥': '', '⎦': '', '⎨': '', '⎩': '', '⎪': '', '⎬': '', '⎭': '', '⏐': '',
  };
  const ITALIC_VARIANTS = /italic|mathit/i;

  // Unicode 数学字母（U+1D400–1D6A3，每 52 个一组）对应的样式；'' 表示普通数学斜体
  const ALNUM_STYLES = ['mathbf', '', 'boldsymbol', 'mathcal', 'mathcal', 'mathfrak', 'mathbb', 'mathfrak',
    'mathsf', 'mathsf', 'mathsf', 'mathsf', 'mathtt'];
  const DIGIT_STYLES = ['mathbf', 'mathbb', 'mathsf', 'mathsf', 'mathtt']; // U+1D7CE 起，每 10 个一组

  function glyphInfo(hit) {
    const [cp, variant, w] = hit;
    if (cp >= 0xe000 && cp <= 0xf8ff) return null; // 私有区：可伸缩定界符的延伸部件
    // 数学字母码位（粗体、黑板粗体等）还原为“样式 + 普通字母”，便于合并成 \mathbf{MiB}
    if (cp >= 0x1d400 && cp <= 0x1d6a3) {
      const style = ALNUM_STYLES[Math.floor((cp - 0x1d400) / 52)];
      if (style) {
        const ch = String.fromCodePoint(cp).normalize('NFKC');
        if (/^[A-Za-z]$/.test(ch)) return { str: ch, variant, w, cmd: style };
      }
    }
    if (cp >= 0x1d7ce && cp <= 0x1d7ff) {
      const style = DIGIT_STYLES[Math.floor((cp - 0x1d7ce) / 10)];
      return { str: String.fromCodePoint(cp).normalize('NFKC'), variant, w, cmd: style };
    }
    let ch = String.fromCodePoint(cp);
    if (Object.prototype.hasOwnProperty.call(DELIM_PARTS, ch)) {
      ch = DELIM_PARTS[ch];
      if (!ch) return null;
      return { str: ch, variant, w, base: true };
    }
    const info = { str: ch, variant, w };
    const cmd = VARIANT_CMD[variant];
    if (cmd && /^[A-Za-z0-9]$/.test(ch)) info.cmd = cmd; // 如 \mathbf{x}，相邻字母之后会合并成 \mathbf{MiB}
    else if (variant === 'normal' && /^[A-Za-z]$/.test(ch)) info.upright = true; // 正体字母：函数名或 \mathrm
    return info;
  }

  // 识别一页：返回 { items: [{ str, x, x1, y, s, variant, tex?, rule?, base? }] }，坐标为 PDF 用户空间（y 向上）
  async function recognize(page) {
    const table = CCM.mathjaxGlyphs;
    const OPS = globalThis.pdfjsLib && globalThis.pdfjsLib.OPS;
    if (!table || !OPS) return { items: [] };
    const ops = await page.getOperatorList();
    const glyphs = [];
    const placed = []; // 页面坐标中认出的字形，位置待定（见 resolvePositions）
    const rects = [];
    const pageRects = [];
    const strokes = [];
    const dots = [];
    const images = [];
    let ctm = [1, 0, 0, 1, 0, 0];
    // 当前的裁剪范围（页面坐标的外框，null 表示不裁剪）。macOS 打印的 PDF 中，跨页的一行会在上下两页各画一次，
    // 各被页面内容区的裁剪挡住一部分。文字和公式字形是否看得见按整行判断（见 CCM.pdfClipped），这里只排除看不见的表格线、图片等
    let clip = null;
    let pendingClip = false;
    const stack = [];
    const textClips = [];
    let unclippedText = false;
    const TEXT_OPS = new Set([OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText]);
    // 边框线常常压在裁剪范围的边上，留 1pt 余量
    const visible = (b) => !clip || Math.min(b.y1, clip.y1 + 1) - Math.max(b.y0, clip.y0 - 1) >= 0.4 * (b.y1 - b.y0);
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i];
      const a = ops.argsArray[i];
      if (fn === OPS.save) stack.push([ctm, clip]);
      else if (fn === OPS.restore) [ctm, clip] = stack.pop() || [ctm, clip];
      else if (fn === OPS.transform) ctm = mul(ctm, a);
      else if (fn === OPS.paintFormXObjectBegin) {
        stack.push([ctm, clip]);
        if (a && a[0]) ctm = mul(ctm, a[0]);
        if (a && a[1]) clip = intersect(clip, boxOf(ctm, a[1]));
      } else if (fn === OPS.paintFormXObjectEnd) [ctm, clip] = stack.pop() || [ctm, clip];
      else if (fn === OPS.clip || fn === OPS.eoClip) pendingClip = true;
      else if (TEXT_OPS.has(fn)) {
        if (!clip) unclippedText = true;
        else if (!textClips.some((r) => Math.abs(r.y0 - clip.y0) < 0.5 && Math.abs(r.y1 - clip.y1) < 0.5)) textClips.push(clip);
      } else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject || fn === OPS.paintImageXObjectRepeat) {
        // 图片：单位正方形经当前变换后的外框
        const box = boxOf(ctm, [0, 0, 1, 1]);
        if (visible(box)) images.push(box);
      } else if (fn === OPS.constructPath) {
        const data = a && a[1] && a[1][0];
        const mm = a && a[2];
        if (!data || !mm) continue;
        const box = boxOf(ctm, mm);
        if (pendingClip) {
          pendingClip = false;
          clip = intersect(clip, box);
          if (a[0] === OPS.endPath) continue;
        }
        const scale = Math.hypot(ctm[0], ctm[1]);
        if (!(scale > 0) || Math.abs(ctm[1]) > 1e-6 || Math.abs(ctm[2]) > 1e-6) continue; // 只看未旋转的路径
        const isRect = data.length === 13 && data[0] === 0 && data[3] === 1 && data[6] === 1 && data[9] === 1 && data[12] === 4;
        const filled = a[0] === OPS.fill || a[0] === OPS.eoFill;
        if (scale > 0.05) {
          // macOS 打印的公式字形：路径已是页面坐标
          if (filled && !isRect) {
            const g = pageGlyph(data, ctm, box, table);
            if (g) { placed.push(g); continue; }
          }
          // 页面单位下的细线（填充的细矩形或描边的直线段）：可能是表格边框，也可能是 macOS 打印的分数线
          const line = a[0] === OPS.stroke && data.length === 6 && data[0] === 0 && data[3] === 1;
          if (((isRect && filled) || line) && visible(box)) strokes.push(box);
          if (isRect && filled) pageRects.push(box);
          // 画出来的列表符号（Chrome 打印的 PDF）：实心圆 •、空心圆 ◦、小方块 ▪
          const w = box.x1 - box.x0;
          const h = box.y1 - box.y0;
          if ((filled || a[0] === OPS.stroke) && !line && w >= 1.5 && w <= 8 && Math.abs(w - h) < 0.25 * Math.max(w, h)) {
            dots.push({ ...box, shape: isRect ? (filled ? '▪' : '▫') : filled ? '•' : '◦' });
          }
          continue;
        }
        if (isRect) {
          rects.push({ x: ctm[4] + mm[0] * scale, x1: ctm[4] + mm[2] * scale, y0: ctm[5] + mm[1] * ctm[3], y1: ctm[5] + mm[3] * ctm[3], s: scale * 1000 });
          continue;
        }
        // Windows 打印的公式字形：字库坐标 + 缩放变换，起点位置也必须与字库一致
        const pts = endpoints(data, (x, y) => [Math.round(x), Math.round(y)], (p, q) => p === q);
        const list = pts && pts.length && table[fnv(signature(pts, 1, 1))];
        if (!list) continue;
        const cs = candidates(list);
        const c = cs.find((e) => e.x0 === pts[0][1] && e.y0 === pts[0][2]) || cs[0];
        const info = glyphInfo([c.cp, c.variant, c.w]);
        if (!info) continue;
        glyphs.push({ ...info, x: ctm[4], x1: ctm[4] + (info.w || mm[2]) * scale, y: ctm[5], s: scale * 1000 });
      }
    }
    // 所有文字都画在裁剪范围内时，记下这些范围：范围之外（上下页边距中）的文字是看不见的
    CCM.pdfTextClips = CCM.pdfTextClips || {};
    if (page.pageNumber) CCM.pdfTextClips[page.pageNumber] = !unclippedText && textClips.length ? textClips : null;
    resolvePositions(placed, glyphs);
    for (const g of placed) {
      const c = g.cands[0];
      const info = glyphInfo([c.cp, c.variant, c.w]);
      if (info) glyphs.push({ ...info, x: c.ox, x1: c.ox + c.w * g.kx, y: c.oy, s: 1000 * g.kx });
    }
    const tables = findTables(strokes);
    // macOS 打印的分数线、根号横线：页面单位的细矩形，紧贴在公式字形的上方或下方，两端与这些字形（及根号）对齐。
    // 标题下的分隔线、表格线虽然附近也可能有公式，但会比公式长得多
    for (const r of placed.length ? pageRects : []) {
      const y = (r.y0 + r.y1) / 2;
      if (r.y1 - r.y0 > 3 || tables.some((t) => r.x0 < t.x1 && r.x1 > t.x0 && t.rows.some((ty) => Math.abs(ty - y) < 1.5))) continue;
      const near = glyphs.filter((g) => g.x1 > r.x0 - 0.3 * g.s && g.x < r.x1 + 0.3 * g.s &&
        g.y - y < 1.5 * g.s && y - g.y < 1.6 * g.s && (g.y > y || y - (g.y + 0.75 * g.s) < 0.6 * g.s));
      if (!near.length) continue;
      const s = Math.max(...near.map((g) => g.s));
      const gx0 = Math.min(...near.map((g) => g.x));
      const gx1 = Math.max(...near.map((g) => g.x1));
      if (r.x0 < gx0 - 0.6 * s || r.x1 > gx1 + 0.6 * s) continue;
      rects.push({ x: r.x0, x1: r.x1, y0: r.y0, y1: r.y1, s });
    }
    CCM.pdfTables = CCM.pdfTables || {};
    if (page.pageNumber) CCM.pdfTables[page.pageNumber] = tables;
    // 图片（截图、插图）：去掉很小的（图标、装饰）、铺满整页的（扫描件的底图）和重复的
    const [vx0, vy0, vx1, vy1] = page.view;
    const pageArea = (vx1 - vx0) * (vy1 - vy0);
    const pics = [];
    for (const im of images) {
      const w = im.x1 - im.x0;
      const h = im.y1 - im.y0;
      if (w < 24 || h < 24 || w * h > 0.85 * pageArea) continue;
      if (pics.some((q) => Math.abs(q.x0 - im.x0) < 1 && Math.abs(q.y0 - im.y0) < 1 && Math.abs(q.x1 - im.x1) < 1 && Math.abs(q.y1 - im.y1) < 1)) continue;
      // 被另一张图片完全包含的（例如截图上叠加的小图）并入外层图片
      if (pics.some((q) => q.x0 <= im.x0 + 1 && q.x1 >= im.x1 - 1 && q.y0 <= im.y0 + 1 && q.y1 >= im.y1 - 1)) continue;
      for (let k = pics.length - 1; k >= 0; k--) {
        const q = pics[k];
        if (im.x0 <= q.x0 + 1 && im.x1 >= q.x1 - 1 && im.y0 <= q.y0 + 1 && im.y1 >= q.y1 - 1) pics.splice(k, 1);
      }
      pics.push(im);
    }
    CCM.pdfImages = CCM.pdfImages || {};
    if (page.pageNumber) CCM.pdfImages[page.pageNumber] = pics;
    // 列表符号：字号按符号直径估算（之后在 pdf-text.js 中对齐到同一行的文字）
    const bullets = dots.map((d) => {
      const s = (d.x1 - d.x0) * 3;
      return { str: d.shape, bullet: true, variant: 'bullet', x: d.x0, x1: d.x1, y: (d.y0 + d.y1) / 2 - 0.3 * s, cy: (d.y0 + d.y1) / 2, s };
    });
    if (!glyphs.length) return { items: bullets, tables };

    // 横线：分数线、根号横线、上划线（细长矩形，且附近有公式字形）
    const rules = [];
    for (const r of rects) {
      const h = Math.abs(r.y1 - r.y0);
      const len = r.x1 - r.x;
      if (!(len > 0) || h > 0.2 * r.s || len < 0.2 * r.s) continue;
      const y = (r.y0 + r.y1) / 2;
      if (!glyphs.some((g) => Math.abs(g.y - y) < 3 * g.s && g.x1 > r.x - 2 * g.s && g.x < r.x1 + 2 * g.s)) continue;
      rules.push({ str: '', rule: true, x: r.x, x1: r.x1, y, s: r.s, variant: 'rule' });
    }

    // 合并连续的同类字母：正体（log、sin、max 等函数名）、同一字体变体（\mathbf{MiB}）
    glyphs.sort((a, b) => (Math.abs(a.y - b.y) < 0.3 * Math.max(a.s, b.s) ? a.x - b.x : b.y - a.y));
    const kind = (g) => (g.upright ? 'upright' : g.cmd || null);
    const merged = [];
    for (const g of glyphs) {
      const last = merged[merged.length - 1];
      if (kind(g) && last && kind(last) === kind(g) && Math.abs(last.y - g.y) < 0.05 * g.s && Math.abs(last.s - g.s) < 0.05 * g.s &&
        g.x - last.x1 < 0.12 * g.s && g.x >= last.x - 0.01) {
        last.str += g.str;
        last.x1 = g.x1;
      } else {
        merged.push({ ...g });
      }
    }
    const funcs = CCM.texFuncs || new Set();
    for (const g of merged) {
      if (g.cmd) g.tex = `\\${g.cmd}{${g.str}}`;
      else if (g.upright) {
        if (funcs.has(g.str)) g.tex = '\\' + g.str;
        else if (g.str === 'mod') g.tex = '\\bmod';
        else g.tex = g.str.length > 1 ? `\\text{${g.str}}` : `\\mathrm{${g.str}}`;
      }
    }
    return { items: merged.concat(rules, bullets), tables };
  }

  // 由细线拼出表格网格：返回 [{ x0, x1, y0, y1, rows: [由上到下的横线 y], cols: [由左到右的竖线 x] }]
  function findTables(strokes) {
    const T = 2.5; // 线宽上限
    const hs = [];
    const vs = [];
    for (const r of strokes) {
      const w = r.x1 - r.x0;
      const h = r.y1 - r.y0;
      if (h <= T && w > 8) hs.push({ x0: r.x0, x1: r.x1, y: (r.y0 + r.y1) / 2 });
      else if (w <= T && h > 8) vs.push({ x: (r.x0 + r.x1) / 2, y0: r.y0, y1: r.y1 });
    }
    if (hs.length < 2) return [];
    // 按相交关系分组（并查集）
    const segs = hs.map((h) => ({ x0: h.x0, x1: h.x1, y0: h.y, y1: h.y, h }))
      .concat(vs.map((v) => ({ x0: v.x, x1: v.x, y0: v.y0, y1: v.y1, v })));
    const parent = segs.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const E = 2;
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const a = segs[i];
        const b = segs[j];
        if (a.x0 - E <= b.x1 && b.x0 - E <= a.x1 && a.y0 - E <= b.y1 && b.y0 - E <= a.y1) parent[find(i)] = find(j);
      }
    }
    const groups = new Map();
    segs.forEach((s, i) => {
      const k = find(i);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    });
    const levels = (vals, tol) => {
      const out = [];
      for (const v of [...vals].sort((a, b) => a - b)) {
        if (out.length && v - out[out.length - 1].v < tol) out[out.length - 1].list.push(v);
        else out.push({ v, list: [v] });
      }
      return out.map((g) => g.list.reduce((a, b) => a + b, 0) / g.list.length);
    };
    const tables = [];
    for (const g of groups.values()) {
      const H = g.filter((s) => s.h).map((s) => s.h);
      const V = g.filter((s) => s.v).map((s) => s.v);
      if (H.length < 2) continue;
      const x0 = Math.min(...H.map((h) => h.x0));
      const x1 = Math.max(...H.map((h) => h.x1));
      const W = x1 - x0;
      // 行分隔线：横跨表格大部分宽度（同一高度上的多段合计）
      const ys = levels(H.map((h) => h.y), 1.5).filter((y) =>
        H.filter((h) => Math.abs(h.y - y) < 1.5).reduce((a, h) => a + (h.x1 - h.x0), 0) > 0.6 * W);
      if (ys.length < 2) continue;
      const cols = levels(V.map((v) => v.x), 1.5).filter((x) => x > x0 + 3 && x < x1 - 3);
      if (ys.length < 3 && !cols.length) continue; // 只有上下两条线、没有竖线：多半是方框，不是表格
      tables.push({ x0, x1, y0: Math.min(...ys), y1: Math.max(...ys), rows: ys.sort((a, b) => b - a), cols: [x0, ...cols, x1], hsegs: H });
    }
    return tables;
  }

  // 基线为 y 的一行（正文字号 s）是否被裁剪掉：行的中线不在裁剪范围内（只看上下方向，代码块等横向溢出的内容仍算可见）。
  // 跨页的一行在上下两页各露出一部分，按中线判断恰好只保留其中一处；同一行的文字和公式字形结论相同
  CCM.pdfClipped = (pageNumber, y, s) => {
    const clips = CCM.pdfTextClips && CCM.pdfTextClips[pageNumber];
    const c = y + 0.3 * s;
    return !!clips && !clips.some((r) => c >= r.y0 && c <= r.y1);
  };

  const cache = new WeakMap();
  CCM.pdfGlyphsFor = (page) => {
    if (!cache.has(page)) cache.set(page, recognize(page).catch((e) => { console.warn('[marktex-copy] glyph recognition failed', e); return { items: [] }; }));
    return cache.get(page);
  };

  // 合成一个“文本项”，与 PDF.js 的 textContent 项同构，便于复用后续流程
  CCM.glyphItem = (g) => ({
    str: g.rule ? '\u2009' : g.str,
    transform: [g.s, 0, 0, g.s, g.x, g.y],
    width: Math.max(0, g.x1 - g.x),
    height: g.s,
    fontName: '__mjx:' + g.variant,
    __glyph: g,
  });

  // 把公式字形按阅读顺序插入：位于其后、或下一行的第一个文本项之前
  CCM.mergeGlyphOrder = (textEntries, glyphEntries) => {
    // entries: { x, y, s, ref }；返回 [{ glyph, before: textEntry | null }]
    const plan = [];
    const sorted = [...glyphEntries].sort((a, b) => (Math.abs(a.y - b.y) < 0.5 * Math.max(a.s, b.s) ? a.x - b.x : b.y - a.y));
    for (const g of sorted) {
      let before = null;
      for (const t of textEntries) {
        const sameLine = Math.abs(t.y - g.y) < 0.6 * Math.max(t.s, g.s);
        if ((sameLine && t.x >= g.x) || (!sameLine && t.y < g.y)) { before = t; break; }
      }
      plan.push({ glyph: g, before });
    }
    return plan;
  };

  // 图片占位元素的选中底色范围由字体的上下伸部决定（通常大于 1em），会超出图片。
  // 按实际测得的文字区域调整字号和位置，使选中范围正好覆盖图片。比例与缩放无关，只需调整一次
  function fitImageSpans(div) {
    const layer = div.getBoundingClientRect();
    if (!layer.height) return;
    for (const span of div.querySelectorAll('.marktex-image')) {
      const text = span.firstChild;
      if (!text) continue;
      const box = span.getBoundingClientRect(); // 行框：高度 = 字号 = 图片高度
      const r = document.createRange();
      r.selectNodeContents(span);
      const area = r.getBoundingClientRect(); // 文字区域：即选中底色的范围
      if (!(box.height > 0 && area.height > 0)) continue;
      const k = box.height / area.height;
      const fh = parseFloat(span.style.getPropertyValue('--font-height')) || 0;
      if (!fh || Math.abs(k - 1) < 0.01) continue;
      span.style.setProperty('--font-height', `${(fh * k).toFixed(3)}px`);
      span.style.setProperty('--scale-x', String((parseFloat(span.style.getPropertyValue('--scale-x')) / k).toFixed(4)));
      const area2 = r.getBoundingClientRect();
      const shift = (area2.top - box.top) / layer.height * 100;
      span.style.top = `${(parseFloat(span.style.top) - shift).toFixed(3)}%`;
    }
  }

  // 在已渲染的文本层中插入透明的公式字形，使其可以被选中、全选和复制
  CCM.pdfInjectGlyphs = async (pageNumber, view) => {
    const page = view && view.pdfPage;
    const div = view && view.textLayer && view.textLayer.div;
    if (!page || !div) return 0;
    const { items: glyphs } = await CCM.pdfGlyphsFor(page);
    // 被裁剪掉、看不见的文字和公式不参与选中（按正文字号判断，与 pdf-text.js 一致）
    const textSpans = Array.from(div.querySelectorAll('span')).filter((s) => s.__ccmItem && !s.__ccmItem.__glyph);
    const sizes = textSpans.map((s) => Math.hypot(s.__ccmItem.transform[2], s.__ccmItem.transform[3])).sort((a, b) => a - b);
    const body = sizes[Math.floor(sizes.length / 2)] || 10;
    const clipped = (g) => !g.image && !g.bullet && CCM.pdfClipped(pageNumber, g.rule ? g.y - 0.25 * body : g.y, body);
    for (const span of textSpans) if (CCM.pdfClipped(pageNumber, span.__ccmItem.transform[5], body)) span.classList.add('marktex-clipped');
    // 图片也放一个透明的占位元素（宽高与图片相同），使图片可以被选中、显示选中底色，并决定复制时是否包含该图片
    const pics = ((CCM.pdfImages || {})[pageNumber] || []).map((im) => ({
      str: '\u2003', image: im, variant: 'image', x: im.x0, x1: im.x1, y: im.y0, s: im.y1 - im.y0,
    }));
    const items = glyphs.concat(pics);
    if (!items.length || !div.isConnected) return 0;
    if (div.__ccmGlyphs) return div.__ccmGlyphs;
    const [px0, , px1, py1] = page.view;
    const W = px1 - page.view[0];
    const H = py1 - page.view[1];
    const texts = Array.from(div.querySelectorAll('span')).filter((s) => s.__ccmItem && !s.__ccmItem.__glyph).map((s) => {
      const t = s.__ccmItem.transform;
      return { x: t[4], y: t[5], s: Math.hypot(t[2], t[3]) || 10, ref: s };
    });
    // 阅读顺序：图片按其上边缘排在下方文字之前
    const plan = CCM.mergeGlyphOrder(texts, items.map((g) => (g.image ? { x: g.x, y: g.image.y1 - 1, s: 10, ref: g } : { x: g.x, y: g.y, s: g.s, ref: g })));
    const end = div.querySelector('.endOfContent');
    for (const { glyph: { ref: g }, before } of plan) {
      const span = document.createElement('span');
      const item = CCM.glyphItem(g);
      span.textContent = item.str;
      span.className = g.image ? 'marktex-image' : 'marktex-glyph';
      if (clipped(g)) span.classList.add('marktex-clipped');
      span.setAttribute('role', 'presentation');
      const top = g.image ? g.image.y1 : g.rule ? g.y + 0.05 * g.s : g.y + 0.78 * g.s;
      span.style.left = `${((100 * (g.x - px0)) / W).toFixed(3)}%`;
      span.style.top = `${((100 * (py1 - top)) / H).toFixed(3)}%`;
      span.style.setProperty('--font-height', `${g.s.toFixed(2)}px`);
      if (g.image) {
        // 全角空格宽 1em：横向缩放到图片宽度
        span.style.setProperty('--scale-x', String(((g.x1 - g.x) / g.s).toFixed(4)));
      } else {
        const est = 0.55 * g.s * Math.max(1, Array.from(item.str).length);
        span.style.setProperty('--scale-x', String(Math.max(0.2, Math.min(4, (g.x1 - g.x) / est)).toFixed(3)));
      }
      span.__ccmItem = item;
      span.__ccmPage = pageNumber;
      const ref = before ? before.ref : end;
      if (ref && ref.parentNode) ref.parentNode.insertBefore(span, ref);
      else div.appendChild(span);
    }
    fitImageSpans(div);
    div.__ccmGlyphs = items.length;
    return items.length;
  };

  // 供测试使用
  CCM._glyphDebug = { endpoints, signature, scalesOf, pageGlyph, fnv };
})();
