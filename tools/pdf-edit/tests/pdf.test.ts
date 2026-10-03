import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { beforeAll, afterAll, expect, test, vi } from 'vitest';
import { PdfRuntime } from '../src/pdf/runtime';
import { createSamplePdf } from './sample-pdf';
import type { EditorPage } from '../src/editor';

const require = createRequire(import.meta.url);
let runtime: PdfRuntime;
const page = (
  index: number,
  sourceId = 'sample',
  rotation = 0,
): EditorPage => ({
  id: `${sourceId}-${index}`,
  sourceId,
  sourceIndex: index,
  rotation,
});
beforeAll(async () => {
  const bytes = await readFile(require.resolve('@embedpdf/pdfium/pdfium.wasm'));
  const font = await readFile(
    resolve(
      dirname(require.resolve('@embedpdf/fonts-jp')),
      '../fonts/NotoSansJP-Regular.otf',
    ),
  );
  vi.stubGlobal('fetch', () => {
    throw new Error('テスト中のネットワーク通信は禁止');
  });
  runtime = await PdfRuntime.create(new Uint8Array(bytes).buffer, font);
  await runtime.open('sample', createSamplePdf());
});
afterAll(async () => {
  vi.unstubAllGlobals();
  for (const id of ['sample', 'second', 'saved', 'rotated', 'resaved'])
    await runtime.close(id);
});

test('合成PDFの4ページを開き、文字と既知の画像情報を取り出せる', async () => {
  const result = await runtime.inspect(page(1));
  expect(result.text).toContain('Space for better ideas.');
  expect(result.text).toContain('企画チーム / サンプル文書');
  const image = result.elements.find((item) => item.image)!;
  expect(image.image?.width).toBe(160);
  expect(image.image?.height).toBe(82);
  expect(image.image?.widthMm).toBeCloseTo(160, 2);
  expect(image.image?.heightMm).toBeCloseTo(82, 2);
  expect(image.image?.dpiX).toBeCloseTo(25.4, 2);
  expect(image.image?.dpiY).toBeCloseTo(25.4, 2);
  expect(image.bounds.x).toBeCloseTo(60 / 595.276, 2);
  expect(image.bounds.width).toBeCloseTo(453.5433 / 595.276, 2);
});
test('ページの描画と追加回転のサイズが正しい', async () => {
  const normal = await runtime.render(page(0), 1);
  const rotated = await runtime.render(page(0, 'sample', 90), 1);
  expect([normal.width, normal.height]).toEqual([595, 842]);
  expect([rotated.width, rotated.height]).toEqual([842, 595]);
  expect(
    normal.data.some((value, index) => index % 4 !== 3 && value < 200),
  ).toBe(true);
});
test('個別画像は元のピクセル数と色を保持する', async () => {
  const inspection = await runtime.inspect(page(1));
  const element = inspection.elements.find((item) => item.image)!;
  const image = runtime.image(page(1), element.index);
  expect([image.width, image.height]).toEqual([160, 82]);
  expect(Array.from(image.data.slice(0, 4))).toEqual([211, 224, 201, 255]);
  expect(() => runtime.image(page(1), -1)).toThrow();
});
test('削除・並べ替え・回転・別PDFの結合を保存し、再読込して照合する', async () => {
  await runtime.open('second', createSamplePdf());
  const output = await runtime.export([
    page(2),
    page(1, 'sample', 90),
    page(0, 'second'),
  ]);
  expect(new TextDecoder().decode(output.slice(0, 5))).toBe('%PDF-');
  const doc = await runtime.open('saved', output);
  expect(doc.pages).toHaveLength(3);
  expect(doc.pages.map((item) => item.rotation)).toEqual([0, 1, 0]);
  const before = await runtime.render(page(1, 'sample', 90), 1);
  const after = await runtime.render(page(1, 'saved', 90), 1);
  expect([after.width, after.height]).toEqual([before.width, before.height]);
  expect(
    Buffer.compare(new Uint8Array(before.data), new Uint8Array(after.data)),
  ).toBe(0);
  expect((await runtime.inspect(page(0, 'saved'))).text).toContain(
    'Design around people.',
  );
  expect((await runtime.inspect(page(1, 'saved', 90))).text).toContain(
    'Space for better ideas.',
  );
  expect((await runtime.inspect(page(2, 'saved'))).text).toContain(
    'A place to work.',
  );
  expect((await runtime.inspect(page(0))).text).toContain('A place to work.');
  expect((await runtime.inspect(page(1))).text).toContain(
    'Space for better ideas.',
  );
});
test('元から回転したPDFを再保存しても回転が二重に加わらない', async () => {
  const rotated = await runtime.export([page(1, 'sample', 90)]);
  const original = await runtime.open('rotated', rotated);
  expect(original.pages[0]?.rotation).toBe(1);
  const source = page(0, 'rotated', 90);
  const rendering = await runtime.render(source, 1);
  expect([rendering.width, rendering.height]).toEqual([842, 595]);
  const result = await runtime.open('resaved', await runtime.export([source]));
  expect(result.pages[0]?.rotation).toBe(1);
  const image = (await runtime.inspect(source)).elements.find(
    (item) => item.image,
  )!;
  expect(image.bounds.x).toBeCloseTo(350 / 841.89, 2);
  expect(image.bounds.y).toBeCloseTo(60 / 595.276, 2);
});
test('空の保存や壊れたPDFは成功として扱わず、開いている文書は保つ', async () => {
  await expect(runtime.export([])).rejects.toThrow();
  await expect(
    runtime.open('broken', new TextEncoder().encode('not a pdf').buffer),
  ).rejects.toBeDefined();
  expect((await runtime.inspect(page(0))).text).toContain('A place to work.');
});
