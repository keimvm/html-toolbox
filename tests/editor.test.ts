import { expect, test } from 'vitest';
import { Editor, type EditorPage } from '../src/editor';

const pages: EditorPage[] = Array.from({ length: 3 }, (_, index) => ({
  id: `a-${index}`,
  sourceId: 'a',
  sourceIndex: index,
  rotation: 0,
}));
function open() {
  const editor = new Editor();
  editor.open(pages);
  return editor;
}

test('並べ替えたページの選択と元PDFの参照が維持され、取り消せる', () => {
  const editor = open();
  editor.select('a-1');
  editor.move('a-1', 2);
  expect(editor.pages.map((page) => page.sourceIndex)).toEqual([0, 2, 1]);
  expect(editor.selectedIndex).toBe(2);
  expect(editor.changed).toBe(true);
  editor.undo();
  expect(editor.pages).toEqual(pages);
  expect(editor.selectedId).toBe('a-1');
  expect(editor.changed).toBe(false);
});
test('末尾を削除すると直前のページを選び、最後の1ページは削除しない', () => {
  const editor = open();
  editor.select('a-2');
  editor.remove();
  expect(editor.selectedId).toBe('a-1');
  editor.remove();
  expect(editor.remove()).toBe(false);
  expect(editor.pages).toHaveLength(1);
  editor.undo();
  expect(editor.pages).toHaveLength(2);
  expect(editor.selectedId).toBe('a-1');
});
test('回転・別PDFの結合・取り消しを連続して行える', () => {
  const editor = open();
  editor.rotate();
  editor.append([{ id: 'b-0', sourceId: 'b', sourceIndex: 0, rotation: 90 }]);
  expect(editor.selectedId).toBe('b-0');
  editor.undo();
  expect(editor.selectedId).toBe('a-0');
  expect(editor.pages[0]?.rotation).toBe(90);
  editor.undo();
  expect(editor.changed).toBe(false);
});
test('保存後の取り消しは未保存になり、保存内容に戻れば変更なしになる', () => {
  const editor = open();
  editor.rotate();
  editor.markSaved();
  expect(editor.changed).toBe(false);
  editor.undo();
  expect(editor.changed).toBe(true);
  editor.rotate();
  expect(editor.changed).toBe(false);
});
test('範囲外や同じ位置への移動は履歴も変更状態も増やさない', () => {
  const editor = open();
  for (const index of [-1, 0, 3, 1.5])
    expect(editor.move('a-0', index)).toBe(false);
  expect(editor.move('missing', 1)).toBe(false);
  expect(editor.canUndo).toBe(false);
  expect(editor.changed).toBe(false);
});
test('文書を閉じると選択と履歴を初期化する', () => {
  const editor = open();
  editor.rotate();
  editor.open([]);
  expect(editor.selected).toBeUndefined();
  expect(editor.canUndo).toBe(false);
  expect(editor.changed).toBe(false);
});
