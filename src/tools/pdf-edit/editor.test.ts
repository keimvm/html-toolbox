import { expect, test } from 'vitest';
import { Editor, type EditorPage } from './editor';

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
test('開いた時点から変更があるかを判定し、回転を一周すると変更なしに戻る', () => {
  const editor = open();
  expect(editor.changed).toBe(false);
  for (let index = 0; index < 3; index++) {
    editor.rotate();
    expect(editor.changed).toBe(true);
  }
  editor.rotate();
  expect(editor.changed).toBe(false);
  editor.undo();
  expect(editor.changed).toBe(true);
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

test('復元後も追加・回転・並べ替え・削除を取り消して読み込み時の状態に戻れる', () => {
  const editor = open();
  editor.rotate();
  editor.append([{ id: 'b-0', sourceId: 'b', sourceIndex: 0, rotation: 90 }]);
  editor.move('b-0', 1);
  editor.remove();
  const snapshot = editor.snapshot();
  const restored = new Editor();
  restored.restore(snapshot);
  expect(restored.pages).toEqual(editor.pages);
  expect(restored.selectedId).toBe(editor.selectedId);
  expect(restored.changed).toBe(true);
  while (restored.canUndo) restored.undo();
  expect(restored.pages).toEqual(pages);
  expect(restored.changed).toBe(false);
  expect(snapshot.pages).toEqual(editor.pages);
});

test('壊れた編集状態は現在の文書を上書きしない', () => {
  const editor = open();
  const state = editor.snapshot();
  for (const invalid of [
    null,
    {},
    { ...state, selectedId: 'missing' },
    { ...state, pages: [pages[0], pages[0]] },
    { ...state, history: [null] },
  ]) {
    expect(() => editor.restore(invalid)).toThrow('復元用の編集状態');
    expect(editor.snapshot()).toEqual(state);
  }
});

test('要素を取り除いたページへの差し替えは選択を移し、取り消すと元のページに戻る', () => {
  const editor = open();
  editor.select('a-1');
  editor.rotate();
  const replaced = { id: 'c-0', sourceId: 'c', sourceIndex: 0, rotation: 90 as const };
  expect(editor.replace('a-1', replaced)).toBe(true);
  expect(editor.pages.map((page) => page.id)).toEqual(['a-0', 'c-0', 'a-2']);
  expect(editor.selectedId).toBe('c-0');
  expect(editor.changed).toBe(true);
  // 同じ id のページは並べない。ないページは差し替えない。
  expect(editor.replace('a-0', replaced)).toBe(false);
  expect(editor.replace('missing', { ...replaced, id: 'd-0' })).toBe(false);
  editor.undo();
  expect(editor.pages[1]).toEqual({ id: 'a-1', sourceId: 'a', sourceIndex: 1, rotation: 90 });
  expect(editor.selectedId).toBe('a-1');
  // 復元用の状態にも差し替えた結果が残る。
  editor.replace('a-1', replaced);
  const restored = new Editor();
  restored.restore(editor.snapshot());
  expect(restored.pages[1]?.sourceId).toBe('c');
  restored.undo();
  expect(restored.pages[1]?.sourceId).toBe('a');
});
