import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { PdfRuntime } from '../src/pdf/runtime';
import type { JpegEncoder } from '../src/pdf/types';
import {
  PHOTO_SIZE,
  TINY_JPEG,
  TINY_JPEG_SIZE,
  photoPdf,
  png,
} from './samples';

const require = createRequire(import.meta.url);
let runtime: PdfRuntime;
/** 結果の PDF を調べるための、別の PDFium。 */
let module: WrappedPdfiumModule;
let engine: PdfiumNative;
const opened: string[] = [];

beforeAll(async () => {
  const wasm = new Uint8Array(
    await readFile(require.resolve('@embedpdf/pdfium/pdfium.wasm')),
  ).buffer;
  const font = await readFile(
    resolve(
      dirname(require.resolve('@embedpdf/fonts-jp')),
      '../fonts/NotoSansJP-Regular.otf',
    ),
  );
  vi.stubGlobal('fetch', () => {
    throw new Error('テスト中のネットワーク通信は禁止');
  });
  runtime = await PdfRuntime.create(wasm, font);
  module = await init({ wasmBinary: wasm });
  engine = new PdfiumNative(module);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  for (const id of opened) await runtime.close(id);
});

async function open(id: string, content: ArrayBuffer) {
  const pages = await runtime.open(id, content);
  opened.push(id);
  return pages;
}

/** 各ページの直下にある画像の、元のデータ（圧縮されたまま）のバイト数。 */
function imageSizes(content: ArrayBuffer) {
  const m = module;
  const heap = (
    m.pdfium as typeof m.pdfium & { HEAPU8: Uint8Array<ArrayBuffer> }
  ).HEAPU8;
  const bytes = new Uint8Array(content);
  const ptr = m.pdfium.wasmExports.malloc(bytes.byteLength);
  heap.set(bytes, ptr);
  const document = m.FPDF_LoadMemDocument(ptr, bytes.byteLength, '');
  try {
    expect(document).not.toBe(0);
    return Array.from({ length: m.FPDF_GetPageCount(document) }, (_, index) => {
      const page = m.FPDF_LoadPage(document, index);
      const sizes: number[] = [];
      for (let k = 0; k < m.FPDFPage_CountObjects(page); k++) {
        const object = m.FPDFPage_GetObject(page, k);
        if (m.FPDFPageObj_GetType(object) === 3)
          sizes.push(m.FPDFImageObj_GetImageDataRaw(object, 0, 0));
      }
      m.FPDF_ClosePage(page);
      return sizes;
    });
  } finally {
    m.FPDF_CloseDocument(document);
    m.pdfium.wasmExports.free(ptr);
  }
}

async function text(id: string, content: ArrayBuffer) {
  const doc = await engine.openDocumentBuffer({ id, content }).toPromise();
  try {
    return (await engine
      .extractText(
        doc,
        doc.pages.map((page) => page.index),
      )
      .toPromise()) as string;
  } finally {
    await engine.closeDocument(doc).toPromise();
  }
}

const tinyEncoder: JpegEncoder = async () => new Uint8Array(TINY_JPEG);

test('JPEG と PNG を1枚1ページにし、ページを画像と同じ縦横比（1 px = 0.75 pt）にする', async () => {
  const content = runtime.create([
    {
      data: new Uint8Array(TINY_JPEG).buffer,
      type: 'image/jpeg',
      ...TINY_JPEG_SIZE,
    },
    {
      data: new Uint8Array(png(20, 10, () => [200, 50, 50, 255])).buffer,
      type: 'image/png',
      width: 20,
      height: 10,
    },
  ]);
  expect(new TextDecoder().decode(content.slice(0, 5))).toBe('%PDF-');
  expect(await open('created', content)).toBe(2);
  // 96 dpi で描くと、元の画像と同じ画素数になる。
  const first = await runtime.render('created', 0, 96);
  const second = await runtime.render('created', 1, 96);
  expect([first.width, first.height]).toEqual([16, 12]);
  expect([second.width, second.height]).toEqual([20, 10]);
  const center = (image: typeof first) => {
    const at =
      (Math.floor(image.height / 2) * image.width +
        Math.floor(image.width / 2)) *
      4;
    return Array.from(image.data.slice(at, at + 3));
  };
  center(first).forEach((value, index) =>
    expect(Math.abs(value - [40, 120, 80][index]!)).toBeLessThan(12),
  );
  expect(center(second)).toEqual([200, 50, 50]);
  // JPEG は展開せず、そのまま入れる。
  expect(imageSizes(content)[0]).toEqual([TINY_JPEG.byteLength]);
});

test('画像のない PDF は作らない', () => {
  expect(() => runtime.create([])).toThrow();
});

test('写真を縮めて JPEG にし直し、複数ページで共有する画像も差し替え、文字を残す', async () => {
  const original = photoPdf();
  const before = imageSizes(original);
  const calls: [number, number, number, number, number][] = [];
  const result = await runtime.shrink(
    original,
    { dpi: 48, quality: 0.5 },
    async (image, width, height, quality) => {
      calls.push([image.width, image.height, width, height, quality]);
      return new Uint8Array(TINY_JPEG);
    },
  );
  // 96 dpi の写真を 48 dpi に縮めるよう頼む。共有された画像は1回だけ縮める。
  expect(calls).toEqual([[PHOTO_SIZE.width, PHOTO_SIZE.height, 200, 150, 0.5]]);
  expect(result.images).toBe(3);
  expect(result.replaced).toBe(1);
  expect(result.content.byteLength).toBeLessThan(original.byteLength / 10);
  const after = imageSizes(result.content);
  // 写真は両方のページで新しい JPEG になり、透過のある画像は元のまま残る。
  expect(after[0]).toEqual([TINY_JPEG.byteLength, before[0]![1]]);
  expect(after[1]).toEqual([TINY_JPEG.byteLength]);
  const words = await text('shrunk', result.content);
  expect(words).toContain('Page one');
  expect(words).toContain('Page two');
});

test('JPEG にしても小さくならなければ差し替えず、元の PDF を返す', async () => {
  const original = photoPdf();
  const result = await runtime.shrink(
    original,
    { dpi: 150, quality: 0.75 },
    async () => new Uint8Array(PHOTO_SIZE.width * PHOTO_SIZE.height * 3),
  );
  expect(result.replaced).toBe(0);
  expect(result.content.byteLength).toBe(original.byteLength);
});

test('壊れた PDF は小さくせず、失敗として扱う', async () => {
  await expect(
    runtime.shrink(
      new TextEncoder().encode('not a pdf').buffer,
      { dpi: 150, quality: 0.75 },
      tinyEncoder,
    ),
  ).rejects.toThrow();
  await expect(
    runtime.open('broken', new TextEncoder().encode('not a pdf').buffer),
  ).rejects.toBeDefined();
});
