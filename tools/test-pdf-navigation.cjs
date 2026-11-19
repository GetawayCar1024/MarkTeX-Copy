// node --test tools/test-pdf-navigation.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const context = vm.createContext({ console });
for (const name of ['pdf-navigation.js', 'pdf-editing.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', name), 'utf8'), context, { filename: name });
}
const { outlineAt } = context.__CCM._pdfNavigationDebug;
const { historyAction } = context.__CCM._pdfEditingDebug;
const entries = [
  { id: 'chapter', page: 1, offset: 0.05 },
  { id: 'first-topic', page: 1, offset: 0.2 },
  { id: 'second-topic', page: 1, offset: 0.65 },
  { id: 'next-chapter', page: 4, offset: 0.1 },
];

test('outline follows headings within the same page', () => {
  assert.equal(outlineAt(entries, 1, 0.1).id, 'chapter');
  assert.equal(outlineAt(entries, 1, 0.4).id, 'first-topic');
  assert.equal(outlineAt(entries, 1, 0.7).id, 'second-topic');
});

test('pages without headings retain the preceding section', () => {
  assert.equal(outlineAt(entries, 3, 0).id, 'second-topic');
  assert.equal(outlineAt(entries, 4, 0.01).id, 'second-topic');
  assert.equal(outlineAt(entries, 4, 0.2).id, 'next-chapter');
});

test('outline does not point to a future chapter before the first heading', () => {
  assert.equal(outlineAt(entries, 0, 0), null);
  assert.equal(outlineAt([], 1, 0), null);
  assert.equal(outlineAt(entries, 1, 0).id, 'chapter');
});

test('undo and redo use Windows and macOS conventions', () => {
  for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
    assert.equal(historyAction({ key: 'z', ...modifier }), 'undo');
    assert.equal(historyAction({ key: 'Z', shiftKey: true, ...modifier }), 'redo');
  }
  assert.equal(historyAction({ key: 'y', ctrlKey: true }), 'redo');
});

test('unmodified keys, IME composition and Alt combinations are untouched', () => {
  assert.equal(historyAction({ key: 'z' }), null);
  assert.equal(historyAction({ key: 'z', ctrlKey: true, altKey: true }), null);
  assert.equal(historyAction({ key: 'z', metaKey: true, isComposing: true }), null);
  assert.equal(historyAction({ key: 'y', metaKey: true }), null);
  assert.equal(historyAction({ key: 'a', ctrlKey: true }), null);
});
