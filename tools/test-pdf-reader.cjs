// Browser regression: node tools/test-pdf-reader.cjs [extension-directory]
// Requires playwright-core + Chromium. PLAYWRIGHT_MODULE may point to an existing installation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');

// A small, deterministic PDF: real page text and separate TeX bookmark titles.
// No TeX installation, network downloads or PDF-generation dependencies are needed.
function fixture() {
  const objects = [''];
  const reserve = () => { objects.push(''); return objects.length - 1; };
  const set = (id, text) => { objects[id] = text; };
  const ref = (id) => `${id} 0 R`;
  const quote = (s) => `(${s.replace(/[\\()]/g, '\\$&')})`;
  const catalog = reserve(), pages = reserve(), outlines = reserve();
  const regular = reserve(), bold = reserve(), mono = reserve();
  set(regular, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  set(bold, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');
  set(mono, '<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>');
  const records = Array.from({ length: 42 }, () => ({
    page: reserve(), content: reserve(), chapter: reserve(), first: reserve(), second: reserve(),
  }));
  const line = (font, size, x, y, text) => `BT /${font} ${size} Tf ${x} ${y} Td ${quote(text)} Tj ET\n`;
  records.forEach((r, index) => {
    const n = index + 1;
    let content = line('F2', 24, 48, 760, `Chapter ${n}`) + line('F2', 18, 48, 690, `Topic ${n}.1`);
    content += line('F3', 14, 48, 660, 'std::vector<int>');
    for (let j = 0; j < 8; j++) content += line('F1', 12, 48, 625 - j * 22, 'Reader text for annotation and scrolling regression tests.');
    content += line('F2', 18, 48, 350, `Topic ${n}.2`) + line('F1', 12, 48, 320, 'Another section on the same page.');
    set(r.content, `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}endstream`);
    set(r.page, `<< /Type /Page /Parent ${ref(pages)} /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${ref(regular)} /F2 ${ref(bold)} /F3 ${ref(mono)} >> >> /Contents ${ref(r.content)} >>`);
    const prev = index ? `/Prev ${ref(records[index - 1].chapter)}` : '';
    const next = index + 1 < records.length ? `/Next ${ref(records[index + 1].chapter)}` : '';
    set(r.chapter, `<< /Title ${quote(`Chapter ${n}: \\texttt{std::vector<int>}`)} /Parent ${ref(outlines)} ${prev} ${next} /First ${ref(r.first)} /Last ${ref(r.second)} /Count 2 /Dest [${ref(r.page)} /XYZ 48 800 null] >>`);
    set(r.first, `<< /Title ${quote(`Topic ${n}.1`)} /Parent ${ref(r.chapter)} /Next ${ref(r.second)} /Dest [${ref(r.page)} /XYZ 48 715 null] >>`);
    set(r.second, `<< /Title ${quote(`Topic ${n}.2`)} /Parent ${ref(r.chapter)} /Prev ${ref(r.first)} /Dest [${ref(r.page)} /XYZ 48 375 null] >>`);
  });
  set(pages, `<< /Type /Pages /Count ${records.length} /Kids [${records.map((r) => ref(r.page)).join(' ')}] >>`);
  set(outlines, `<< /Type /Outlines /First ${ref(records[0].chapter)} /Last ${ref(records.at(-1).chapter)} /Count ${records.length * 3} >>`);
  set(catalog, `<< /Type /Catalog /Pages ${ref(pages)} /Outlines ${ref(outlines)} >>`);
  let pdf = '%PDF-1.7\n';
  const offsets = [0];
  for (let i = 1; i < objects.length; i++) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root ${ref(catalog)} >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

(async () => {
  const pdf = fixture();
  const server = http.createServer((_req, res) => { res.writeHead(200, { 'Content-Type': 'application/pdf' }); res.end(pdf); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const root = process.env.MARKTEX_TEST_DIR || os.tmpdir();
  fs.mkdirSync(root, { recursive: true });
  const profile = fs.mkdtempSync(path.join(root, 'marktex-reader-'));
  const extension = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
  let browser, failures = 0;
  try {
    browser = await chromium.launchPersistentContext(profile, {
      channel: process.env.PLAYWRIGHT_CHANNEL || 'chromium', headless: true,
      args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
      viewport: { width: 1440, height: 900 },
    });
    let [worker] = browser.serviceWorkers();
    if (!worker) worker = await browser.waitForEvent('serviceworker');
    const page = await browser.newPage();
    page.on('pageerror', (error) => { failures++; console.error('PAGE ERROR:', error.message); });
    const id = new URL(worker.url()).host;
    const url = `chrome-extension://${id}/vendor/pdfjs/web/viewer.html?src=${encodeURIComponent(`http://127.0.0.1:${server.address().port}/reader.pdf`)}`;
    const ready = async () => {
      await page.waitForFunction(() => window.PDFViewerApplication?.pdfDocument && document.querySelector('.page[data-page-number="1"] .textLayer span'));
      await page.waitForFunction(() => document.getElementById('marktexUndoButton'));
      await page.waitForFunction(() => PDFViewerApplication.isInitialViewSet);
      await page.evaluate(() => { PDFViewerApplication.pdfViewer.currentScaleValue = 'page-fit'; PDFViewerApplication.page = 1; });
      await page.waitForSelector('.page[data-page-number="1"] .annotationEditorLayer', { state: 'attached' });
    };
    await page.goto(url); await ready();
    const check = async (name, fn) => {
      try { await fn(); console.log(`PASS ${name}`); }
      catch (error) { failures++; console.error(`FAIL ${name}: ${error.message}`); }
    };
    await check('copy keeps monospace text', async () => {
      await page.locator('#viewerContainer').click({ position: { x: 5, y: 150 } });
      await page.keyboard.press('Control+a');
      const md = await page.evaluate(async () => {
        const c = window.__CCM;
        return (await c.pdfSelectionAsync(getSelection().getRangeAt(0), c.DEFAULTS)).markdown;
      });
      assert.ok(md.includes('std::vector<int>'));
      await page.evaluate(() => getSelection().removeAllRanges());
    });
    await check('middle-click scroll stops with Escape', async () => {
      const box = await page.locator('#viewerContainer').boundingBox();
      const x = box.x + box.width / 2, y = box.y + 180;
      await page.mouse.click(x, y, { button: 'middle' });
      assert.equal(await page.locator('.marktex-scroll-origin').count(), 1);
      await page.mouse.move(x, y + 100); await page.waitForTimeout(200);
      assert.ok(await page.evaluate(() => document.getElementById('viewerContainer').scrollTop > 10));
      await page.keyboard.press('Escape');
      const top = await page.evaluate(() => document.getElementById('viewerContainer').scrollTop);
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => document.getElementById('viewerContainer').scrollTop), top);
    });
    await check('outline follows same-page sections without overriding manual scrolling', async () => {
      if (!await page.evaluate(() => PDFViewerApplication.viewsManager.isOpen)) await page.click('#viewsManagerToggleButton');
      await page.click('.marktex-seg:nth-child(2)');
      await page.evaluate(async () => {
        const outline = await PDFViewerApplication.pdfDocument.getOutline();
        await PDFViewerApplication.pdfLinkService.goToDestination(outline[29].items[1].dest);
      });
      await page.waitForFunction(() => /30\.2/.test(document.querySelector('#outlinesView [aria-current="location"]')?.textContent || ''));
      await page.evaluate(() => {
        const panel = document.getElementById('viewsManagerContent');
        panel.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 })); panel.scrollTop = 0;
        PDFViewerApplication.page = 31;
      });
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => document.getElementById('viewsManagerContent').scrollTop), 0);
      await page.click('#viewsManagerCurrentOutlineButton');
      assert.ok(await page.evaluate(() => document.getElementById('viewsManagerContent').scrollTop > 100));
    });
    await check('middle-clicking an outline link scrolls only the sidebar', async () => {
      await page.evaluate(() => { document.getElementById('viewsManagerContent').scrollTop = 0; });
      const before = await page.evaluate(() => document.getElementById('viewerContainer').scrollTop);
      const tabs = browser.pages().length;
      const rect = await page.locator('#outlinesView .treeItem > a').first().boundingBox();
      const x = rect.x + 50, y = rect.y + rect.height / 2;
      await page.mouse.click(x, y, { button: 'middle' });
      await page.mouse.move(x, y + 80); await page.waitForTimeout(200);
      assert.ok(await page.evaluate(() => document.getElementById('viewsManagerContent').scrollTop > 10));
      assert.equal(await page.evaluate(() => document.getElementById('viewerContainer').scrollTop), before);
      assert.equal(browser.pages().length, tabs);
      await page.keyboard.press('Escape');
    });
    await check('clicking a rendered formula selects its outline row', async () => {
      await page.evaluate(() => { document.getElementById('viewsManagerContent').scrollTop = 0; });
      await page.locator('#outlinesView .tx-tt').first().click();
      await page.waitForFunction(() => PDFViewerApplication.page === 1);
      assert.equal(await page.locator('#outlinesView .treeItem.selected > a .tx-tt').count(), 1);
    });
    await check('first uncommitted text annotation can be undone and redone', async () => {
      await page.reload(); await ready();
      await page.click('#editorFreeTextButton');
      await page.waitForFunction(() => PDFViewerApplication.pdfViewer.annotationEditorMode === 3);
      await page.locator('.page[data-page-number="1"] .annotationEditorLayer').click({ position: { x: 150, y: 230 } });
      const input = page.locator('.freeTextEditor [contenteditable="true"]').first();
      await input.waitFor(); await input.fill('A fresh note');
      assert.equal(await page.locator('#marktexUndoButton').isEnabled(), true);
      await page.click('#marktexUndoButton');
      await page.waitForFunction(() => !document.querySelector('.freeTextEditor'));
      await page.click('#marktexRedoButton');
      await page.waitForSelector('.freeTextEditor');
    });
    await check('ink uses the same undo and redo history', async () => {
      await page.click('#editorInkButton');
      const rect = await page.locator('.page[data-page-number="1"] .canvasWrapper').boundingBox();
      await page.mouse.move(rect.x + 180, rect.y + 320); await page.mouse.down();
      await page.mouse.move(rect.x + 280, rect.y + 360, { steps: 8 }); await page.mouse.up();
      await page.click('#marktexButton'); await page.keyboard.press('Escape');
      await page.waitForSelector('.inkEditor');
      await page.click('#marktexUndoButton');
      await page.waitForFunction(() => !document.querySelector('.inkEditor'));
      await page.keyboard.press('Control+Shift+z');
      await page.waitForSelector('.inkEditor');
    });
    await check('highlight deletion has no legacy undo bar and can be redone', async () => {
      await page.reload(); await ready();
      await page.evaluate(() => {
        const span = [...document.querySelectorAll('.page[data-page-number="1"] .textLayer span')].find((s) => s.textContent.includes('Reader text'));
        const range = document.createRange(); range.selectNodeContents(span);
        getSelection().removeAllRanges(); getSelection().addRange(range);
        PDFViewerApplication.pdfViewer._layerProperties.annotationEditorUIManager.highlightSelection('main_toolbar');
      });
      await page.waitForSelector('.highlightEditor');
      await page.keyboard.press('Delete');
      await page.waitForFunction(() => !document.querySelector('.highlightEditor'));
      assert.equal(await page.evaluate(() => PDFViewerApplication.editorUndoBar.isOpen), false);
      await page.click('#marktexUndoButton'); await page.waitForSelector('.highlightEditor');
      await page.click('#marktexRedoButton');
      await page.waitForFunction(() => !document.querySelector('.highlightEditor'));
    });
    await check('input-field undo does not change annotation history', async () => {
      await page.evaluate(() => {
        window.testCounter = 0;
        PDFViewerApplication.pdfViewer._layerProperties.annotationEditorUIManager.addCommands({
          cmd: () => window.testCounter++, undo: () => window.testCounter--, mustExec: true,
        });
      });
      await page.click('#viewFindButton'); await page.locator('#findInput').pressSequentially('testing');
      await page.keyboard.press('Control+z');
      assert.equal(await page.evaluate(() => testCounter), 1);
      await page.keyboard.press('Escape');
    });
    await check('new document resets history controls', async () => {
      await page.reload(); await ready();
      assert.equal(await page.locator('#marktexUndoButton').isDisabled(), true);
      assert.equal(await page.locator('#marktexRedoButton').isDisabled(), true);
    });
    console.log(failures ? `${failures} reader checks failed` : 'All reader checks passed');
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true });
  }
  process.exitCode = failures ? 1 : 0;
})().catch((error) => { console.error(error); process.exitCode = 1; });
