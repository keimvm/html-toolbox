import { expect, test } from 'vitest';
import {
  currentPreviewPage,
  previewWidth,
  stepZoom,
  isPreviewZoom,
} from '../src/preview';
import { Editor } from '../src/editor';

const viewport = { top: 100, bottom: 700 };

test('倍率はPDFの寸法を基準にし、幅合わせでは表示領域を使う', () => {
  expect(previewWidth(600, 500, 100)).toBe(800);
  expect(previewWidth(600, 500, 200)).toBe(1600);
  expect(previewWidth(600, 500, 25)).toBe(200);
  expect(previewWidth(600, 500, 'fit')).toBe(500);
  expect(previewWidth(600, 0, 'fit')).toBe(1);
});
test('拡大縮小は上下限を守り、幅合わせ相当の倍率からも次の段階へ進む', () => {
  expect(stepZoom(100, 1)).toBe(125);
  expect(stepZoom(100, -1)).toBe(75);
  expect(stepZoom(88, 1)).toBe(100);
  expect(stepZoom(88, -1)).toBe(75);
  expect(stepZoom(400, 1)).toBe(300);
  expect(stepZoom(10, -1)).toBe(25);
  expect(isPreviewZoom('fit')).toBe(true);
  expect(isPreviewZoom(200)).toBe(true);
  for (const value of [NaN, 0, 400, '100', null])
    expect(isPreviewZoom(value)).toBe(false);
});

test('長いページの途中では同じページを選び、上端を通過したら次へ進む', () => {
  expect(
    currentPreviewPage(
      [
        { top: -300, bottom: 180 },
        { top: 208, bottom: 1008 },
      ],
      viewport,
      false,
    ),
  ).toBe(0);
  expect(
    currentPreviewPage(
      [
        { top: -400, bottom: 80 },
        { top: 108, bottom: 908 },
      ],
      viewport,
      false,
    ),
  ).toBe(1);
});

test('ページ間の余白では次のページを選び、逆方向にも追従する', () => {
  const pages = [
    { top: -500, bottom: 110 },
    { top: 138, bottom: 450 },
    { top: 478, bottom: 1500 },
  ];
  expect(currentPreviewPage(pages, viewport, false)).toBe(1);
  expect(
    currentPreviewPage(
      pages.map(({ top, bottom }) => ({
        top: top + 100,
        bottom: bottom + 100,
      })),
      viewport,
      false,
    ),
  ).toBe(0);
});

test('短い最終ページも、スクロールの末尾で選べる', () => {
  expect(
    currentPreviewPage(
      [
        { top: -600, bottom: 450 },
        { top: 478, bottom: 680 },
      ],
      viewport,
      true,
    ),
  ).toBe(1);
});

test('空の文書や非表示の領域ではページを選ばない', () => {
  expect(currentPreviewPage([], viewport, true)).toBe(-1);
  expect(
    currentPreviewPage([{ top: 0, bottom: 500 }], { top: 0, bottom: 0 }, true),
  ).toBe(-1);
  expect(currentPreviewPage([{ top: 124, bottom: 680 }], viewport, true)).toBe(
    0,
  );
});

test('スクロールによる選択は編集履歴を増やさず、表示中のページを編集する', () => {
  const editor = new Editor();
  editor.open(
    [0, 1].map((index) => ({
      id: `page-${index}`,
      sourceId: 'sample',
      sourceIndex: index,
      rotation: 0,
    })),
  );
  const index = currentPreviewPage(
    [
      { top: -400, bottom: 80 },
      { top: 108, bottom: 908 },
    ],
    viewport,
    false,
  );
  editor.select(editor.pages[index]!.id);
  expect(editor.changed).toBe(false);
  expect(editor.canUndo).toBe(false);
  editor.rotate();
  expect(editor.pages.map((page) => page.rotation)).toEqual([0, 90]);
  editor.undo();
  expect(editor.selectedIndex).toBe(1);
  expect(editor.changed).toBe(false);
});
