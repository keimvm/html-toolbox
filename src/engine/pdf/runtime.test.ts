// PDF エンジン（PdfRuntime）のテスト。Node.js から PDFium を直接使う。
// 旧 PDF編集（tests/pdf.test.ts）と旧 画像変換（tests/pdf.test.ts）のテストを、共有エンジンの形に合わせて移した。
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { PdfRuntime } from './runtime';
import type { JpegEncoder, PageRef, Rotation } from './types';
import {
  createSamplePdf,
  PHOTO_SIZE,
  photoPdf,
  png,
  TINY_JPEG,
  TINY_JPEG_SIZE,
} from './samples.test-support';

const require = createRequire(import.meta.url);
let runtime: PdfRuntime;
/** 結果の PDF を調べるための、別の PDFium。 */
let module: WrappedPdfiumModule;
let engine: PdfiumNative;
const opened: string[] = [];

const page = (sourceIndex: number, sourceId = 'sample', rotation: Rotation = 0): PageRef => ({
  sourceId,
  sourceIndex,
  rotation,
});

async function open(id: string, content: ArrayBuffer) {
  const doc = await runtime.open(id, content);
  opened.push(id);
  return doc;
}

beforeAll(async () => {
  const wasm = new Uint8Array(await readFile(require.resolve('@embedpdf/pdfium/pdfium.wasm')))
    .buffer;
  const font = await readFile(
    resolve(dirname(require.resolve('@embedpdf/fonts-jp')), '../fonts/NotoSansJP-Regular.otf'),
  );
  vi.stubGlobal('fetch', () => {
    throw new Error('テスト中のネットワーク通信は禁止');
  });
  runtime = await PdfRuntime.create(wasm, font);
  module = await init({ wasmBinary: wasm });
  engine = new PdfiumNative(module);
  await open('sample', createSamplePdf());
});
afterAll(async () => {
  vi.unstubAllGlobals();
  for (const id of opened) await runtime.close(id);
});

/** 各ページの直下にある画像の、元のデータ（圧縮されたまま）のバイト数。 */
function imageSizes(content: ArrayBuffer) {
  const m = module;
  const heap = (m.pdfium as typeof m.pdfium & { HEAPU8: Uint8Array<ArrayBuffer> }).HEAPU8;
  const bytes = new Uint8Array(content);
  const ptr = m.pdfium.wasmExports.malloc(bytes.byteLength);
  heap.set(bytes, ptr);
  const document = m.FPDF_LoadMemDocument(ptr, bytes.byteLength, '');
  try {
    expect(document).not.toBe(0);
    return Array.from({ length: m.FPDF_GetPageCount(document) }, (_, index) => {
      const handle = m.FPDF_LoadPage(document, index);
      const sizes: number[] = [];
      for (let k = 0; k < m.FPDFPage_CountObjects(handle); k++) {
        const object = m.FPDFPage_GetObject(handle, k);
        if (m.FPDFPageObj_GetType(object) === 3)
          sizes.push(m.FPDFImageObj_GetImageDataRaw(object, 0, 0));
      }
      m.FPDF_ClosePage(handle);
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
        doc.pages.map((item) => item.index),
      )
      .toPromise()) as string;
  } finally {
    await engine.closeDocument(doc).toPromise();
  }
}

describe('PDF編集で使う操作', () => {
  test('合成PDFの4ページを開き、文字と既知の画像情報を取り出せる', async () => {
    const result = await runtime.inspect(page(1));
    expect(result.text).toContain('Space for better ideas.');
    expect(result.text).toContain('企画チーム / サンプル文書');
    const image = result.elements.find((item) => item.image)!;
    expect(image.kind).toBe('image');
    expect(image.image?.width).toBe(160);
    expect(image.image?.height).toBe(82);
    expect(image.image?.widthMm).toBeCloseTo(160, 2);
    expect(image.image?.heightMm).toBeCloseTo(82, 2);
    expect(image.image?.dpiX).toBeCloseTo(25.4, 2);
    expect(image.image?.dpiY).toBeCloseTo(25.4, 2);
    expect(image.bounds.x).toBeCloseTo(60 / 595.276, 2);
    expect(image.bounds.width).toBeCloseTo(453.5433 / 595.276, 2);
    expect(result.elements.some((item) => item.kind === 'text')).toBe(true);
  });

  test('ページの描画と追加回転のサイズが正しい', async () => {
    const normal = await runtime.render(page(0), 1);
    const rotated = await runtime.render(page(0, 'sample', 90), 1);
    expect([normal.width, normal.height]).toEqual([595, 842]);
    expect([rotated.width, rotated.height]).toEqual([842, 595]);
    expect(normal.data.some((value, index) => index % 4 !== 3 && value < 200)).toBe(true);
  });

  test('個別画像は元のピクセル数と色を保持する', async () => {
    const inspection = await runtime.inspect(page(1));
    const element = inspection.elements.find((item) => item.image)!;
    const image = runtime.image(page(1), element.index);
    expect([image.width, image.height]).toEqual([160, 82]);
    expect(Array.from(image.data.slice(0, 4))).toEqual([211, 224, 201, 255]);
    expect(() => runtime.image(page(1), -1)).toThrow();
    const notImage = inspection.elements.find((item) => item.kind !== 'image')!;
    expect(() => runtime.image(page(1), notImage.index)).toThrow('画像を選択してください。');
  });

  test('削除・並べ替え・回転・別PDFの結合を保存し、再読込して照合する', async () => {
    await open('second', createSamplePdf());
    const output = await runtime.export([page(2), page(1, 'sample', 90), page(0, 'second')]);
    expect(new TextDecoder().decode(output.slice(0, 5))).toBe('%PDF-');
    const doc = await open('saved', output);
    expect(doc.pages).toHaveLength(3);
    expect(doc.pages.map((item) => item.rotation)).toEqual([0, 1, 0]);
    const before = await runtime.render(page(1, 'sample', 90), 1);
    const after = await runtime.render(page(1, 'saved', 90), 1);
    expect([after.width, after.height]).toEqual([before.width, before.height]);
    expect(Buffer.compare(new Uint8Array(before.data), new Uint8Array(after.data))).toBe(0);
    expect((await runtime.inspect(page(0, 'saved'))).text).toContain('Design around people.');
    expect((await runtime.inspect(page(1, 'saved', 90))).text).toContain('Space for better ideas.');
    expect((await runtime.inspect(page(2, 'saved'))).text).toContain('A place to work.');
    // 元の PDF は変わらない。
    expect((await runtime.inspect(page(0))).text).toContain('A place to work.');
    expect((await runtime.inspect(page(1))).text).toContain('Space for better ideas.');
  });

  test('元から回転したPDFを再保存しても回転が二重に加わらない', async () => {
    const rotated = await runtime.export([page(1, 'sample', 90)]);
    const original = await open('rotated', rotated);
    expect(original.pages[0]?.rotation).toBe(1);
    const source = page(0, 'rotated', 90);
    const rendering = await runtime.render(source, 1);
    expect([rendering.width, rendering.height]).toEqual([842, 595]);
    const result = await open('resaved', await runtime.export([source]));
    expect(result.pages[0]?.rotation).toBe(1);
    const image = (await runtime.inspect(source)).elements.find((item) => item.image)!;
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

  test('要素を取り除いた1ページを新しい元ファイルとして開き、残りの要素と文字を保ち、元の PDF は変えない', async () => {
    const before = await runtime.inspect(page(1));
    const image = before.elements.find((item) => item.kind === 'image')!;
    const { doc, content } = await runtime.removeElements(page(1), [image.index], 'removed');
    opened.push('removed');
    expect(new TextDecoder().decode(content.slice(0, 5))).toBe('%PDF-');
    expect(doc.pages).toHaveLength(1);
    const after = await runtime.inspect(page(0, 'removed'));
    expect(after.elements.some((item) => item.kind === 'image')).toBe(false);
    expect(after.elements).toHaveLength(before.elements.length - 1);
    expect(after.elements.map((item) => item.kind)).toEqual(
      before.elements.filter((item) => item.index !== image.index).map((item) => item.kind),
    );
    expect(after.text).toContain('Space for better ideas.');
    expect(after.text).toContain('企画チーム / サンプル文書');
    // 描いても画像の色（211, 224, 201）が残らない。
    const rendered = await runtime.render(page(0, 'removed'), 1);
    const at =
      (Math.round(rendered.height * 0.6) * rendered.width + Math.round(rendered.width / 2)) * 4;
    expect(Array.from(rendered.data.slice(at, at + 3))).toEqual([255, 255, 255]);
    // 返した中身を開き直しても同じ（復元用データ）。
    const reopened = await open('removed-again', content.slice(0));
    expect(reopened.pages).toHaveLength(1);
    expect((await runtime.inspect(page(0, 'removed-again'))).elements).toHaveLength(
      after.elements.length,
    );
    // 元の PDF は変わらない。
    expect((await runtime.inspect(page(1))).elements).toHaveLength(before.elements.length);
  });

  test('回転したページの要素を取り除いても、ページの回転は保つ', async () => {
    const before = await runtime.inspect(page(0, 'rotated', 90));
    const target = before.elements.find((item) => item.kind === 'image')!;
    const { doc } = await runtime.removeElements(
      page(0, 'rotated', 90),
      [target.index],
      'rotated-removed',
    );
    opened.push('rotated-removed');
    expect(doc.pages[0]?.rotation).toBe(1);
    const rendered = await runtime.render(page(0, 'rotated-removed', 90), 1);
    expect([rendered.width, rendered.height]).toEqual([842, 595]);
  });

  test('存在しない要素は取り除かず、失敗として扱う', async () => {
    await expect(runtime.removeElements(page(0), [9999], 'missing')).rejects.toThrow(
      '取り除く要素が見つかりません。',
    );
    await expect(runtime.removeElements(page(0), [-1], 'missing')).rejects.toThrow();
  });
});

describe('画像からの PDF 作成と PDF の縮小', () => {
  const tinyEncoder: JpegEncoder = async () => new Uint8Array(TINY_JPEG);

  test('JPEG と PNG を1枚1ページにし、ページを画像と同じ縦横比（1 px = 0.75 pt）にする', async () => {
    const content = runtime.create([
      { data: new Uint8Array(TINY_JPEG).buffer, type: 'image/jpeg', ...TINY_JPEG_SIZE },
      {
        data: new Uint8Array(png(20, 10, () => [200, 50, 50, 255])).buffer,
        type: 'image/png',
        width: 20,
        height: 10,
      },
    ]);
    expect(new TextDecoder().decode(content.slice(0, 5))).toBe('%PDF-');
    expect((await open('created', content)).pages).toHaveLength(2);
    // 96 dpi で描くと、元の画像と同じ画素数になる。
    const first = await runtime.render(page(0, 'created'), 96 / 72);
    const second = await runtime.render(page(1, 'created'), 96 / 72);
    expect([first.width, first.height]).toEqual([16, 12]);
    expect([second.width, second.height]).toEqual([20, 10]);
    const center = (image: typeof first) => {
      const at = (Math.floor(image.height / 2) * image.width + Math.floor(image.width / 2)) * 4;
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
  });
});
