import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  FontCharset,
  type PdfDocumentObject,
  type ImageDataLike,
  type Rotation,
} from '@embedpdf/models';
import type { EditorPage } from '../editor';
import type { Inspection, PageElement } from './types';

/** ブラウザーではWorker内で使用する。URL読み込みAPIは公開しない。 */
export class PdfRuntime {
  private documents = new Map<
    string,
    { doc: PdfDocumentObject; content: ArrayBuffer }
  >();
  constructor(
    private module: WrappedPdfiumModule,
    private engine: PdfiumNative,
  ) {}

  static async create(wasmBinary: ArrayBuffer, japaneseFont?: Uint8Array) {
    const module = await init({ wasmBinary });
    return new PdfRuntime(
      module,
      new PdfiumNative(module, {
        fontFallback: japaneseFont
          ? {
              fonts: { [FontCharset.SHIFTJIS]: 'japanese' },
              defaultFont: 'japanese',
              fontLoader: () => japaneseFont,
            }
          : null,
      }),
    );
  }

  private get heap() {
    // 配布パッケージの型から欠けている、Emscripten標準のメモリビュー。
    return (
      this.module.pdfium as typeof this.module.pdfium & {
        HEAPU8: Uint8Array<ArrayBuffer>;
      }
    ).HEAPU8;
  }

  async open(id: string, content: ArrayBuffer) {
    const doc = await this.engine
      .openDocumentBuffer({ id, content }, { normalizeRotation: true })
      .toPromise();
    if (!doc.pages.length) {
      await this.engine.closeDocument(doc).toPromise();
      throw new Error('ページのないPDFは開けません。');
    }
    this.documents.set(id, { doc, content });
    return doc;
  }

  async close(id: string) {
    const source = this.documents.get(id);
    if (!source) return false;
    await this.engine.closeDocument(source.doc).toPromise();
    this.documents.delete(id);
    return true;
  }

  private source(page: EditorPage) {
    const source = this.documents.get(page.sourceId);
    if (!source || !source.doc.pages[page.sourceIndex])
      throw new Error('ページが見つかりません。');
    return source;
  }

  async render(page: EditorPage, scale: number): Promise<ImageDataLike> {
    const { doc } = this.source(page);
    const original = doc.pages[page.sourceIndex]!;
    // 巨大なページで一度に確保する画素数を抑える。
    const safeScale = Math.min(
      scale,
      Math.sqrt(16_000_000 / (original.size.width * original.size.height)),
    );
    return this.engine
      .renderPageRaw(doc, original, {
        scaleFactor: safeScale,
        rotation: (page.rotation / 90) as Rotation,
        withAnnotations: true,
        withForms: true,
      })
      .toPromise();
  }

  private withDocument<T>(
    content: ArrayBuffer,
    action: (document: number) => T,
  ): T {
    const m = this.module;
    const ptr = m.pdfium.wasmExports.malloc(content.byteLength);
    if (!ptr) throw new Error('PDFを処理するメモリを確保できません。');
    let document = 0;
    try {
      this.heap.set(new Uint8Array(content), ptr);
      document = m.FPDF_LoadMemDocument(ptr, content.byteLength, '');
      if (!document)
        throw new Error(
          'PDFを開けません。パスワードやファイルの破損を確認してください。',
        );
      return action(document);
    } finally {
      if (document) m.FPDF_CloseDocument(document);
      m.pdfium.wasmExports.free(ptr);
    }
  }

  private withPage<T>(
    page: EditorPage,
    action: (document: number, handle: number) => T,
  ) {
    const { content } = this.source(page);
    return this.withDocument(content, (document) => {
      const handle = this.module.FPDF_LoadPage(document, page.sourceIndex);
      if (!handle) throw new Error('ページを読み込めません。');
      try {
        return action(document, handle);
      } finally {
        this.module.FPDF_ClosePage(handle);
      }
    });
  }

  async inspect(page: EditorPage): Promise<Inspection> {
    const { doc } = this.source(page);
    const text = (await this.engine
      .extractText(doc, [page.sourceIndex])
      .toPromise()) as string;
    const elements = this.withPage(page, (_document, handle) => {
      const m = this.module;
      const scratch = m.pdfium.wasmExports.malloc(32);
      try {
        const result: PageElement[] = [];
        const width = m.FPDF_GetPageWidth(handle);
        const height = m.FPDF_GetPageHeight(handle);
        const float = (offset: number) =>
          m.pdfium.getValue(scratch + offset, 'float');
        const integer = (offset: number) =>
          m.pdfium.getValue(scratch + offset, 'i32');
        for (let index = 0; index < m.FPDFPage_CountObjects(handle); index++) {
          const object = m.FPDFPage_GetObject(handle, index);
          const type = m.FPDFPageObj_GetType(object);
          if (
            !m.FPDFPageObj_GetBounds(
              object,
              scratch,
              scratch + 4,
              scratch + 8,
              scratch + 12,
            )
          )
            continue;
          const left = float(0),
            bottom = float(4),
            right = float(8),
            top = float(12);
          // PDFiumの座標変換APIで、CropBox・元の回転・追加の回転を反映する。
          const corners = [
            [left, bottom],
            [left, top],
            [right, bottom],
            [right, top],
          ].map(([x, y]) => {
            const extraRotation =
              (page.rotation / 90 - doc.pages[page.sourceIndex]!.rotation + 4) %
              4;
            const quarterTurn = extraRotation % 2 !== 0;
            m.FPDF_PageToDevice(
              handle,
              0,
              0,
              Math.round(quarterTurn ? height : width),
              Math.round(quarterTurn ? width : height),
              extraRotation,
              x!,
              y!,
              scratch,
              scratch + 4,
            );
            return {
              x: integer(0) / (quarterTurn ? height : width),
              y: integer(4) / (quarterTurn ? width : height),
            };
          });
          const x = Math.min(...corners.map((p) => p.x)),
            y = Math.min(...corners.map((p) => p.y));
          const item: PageElement = {
            index,
            type:
              (
                {
                  1: '文字',
                  2: '図形・罫線',
                  3: '画像',
                  4: 'グラデーション',
                  5: 'グループ',
                } as Record<number, string>
              )[type] ?? 'その他',
            bounds: {
              x,
              y,
              width: Math.max(...corners.map((p) => p.x)) - x,
              height: Math.max(...corners.map((p) => p.y)) - y,
            },
          };
          if (
            type === 3 &&
            m.FPDFImageObj_GetImagePixelSize(object, scratch, scratch + 4)
          ) {
            const pixelWidth = integer(0),
              pixelHeight = integer(4);
            if (m.FPDFPageObj_GetMatrix(object, scratch)) {
              const w = Math.hypot(float(0), float(4)),
                h = Math.hypot(float(8), float(12));
              item.image = {
                width: pixelWidth,
                height: pixelHeight,
                widthMm: (w * 25.4) / 72,
                heightMm: (h * 25.4) / 72,
                dpiX: w ? (pixelWidth * 72) / w : 0,
                dpiY: h ? (pixelHeight * 72) / h : 0,
              };
            }
          }
          result.push(item);
        }
        return result;
      } finally {
        m.pdfium.wasmExports.free(scratch);
      }
    });
    return { text, elements };
  }

  image(page: EditorPage, index: number): ImageDataLike {
    return this.withPage(page, (_document, handle) => {
      const m = this.module;
      if (
        !Number.isInteger(index) ||
        index < 0 ||
        index >= m.FPDFPage_CountObjects(handle)
      )
        throw new Error('画像が見つかりません。');
      const object = m.FPDFPage_GetObject(handle, index);
      if (m.FPDFPageObj_GetType(object) !== 3)
        throw new Error('画像を選択してください。');
      const bitmap = m.FPDFImageObj_GetBitmap(object);
      if (!bitmap)
        throw new Error(
          'この画像は個別に取り出せません。ページ全体のPNG保存をご利用ください。',
        );
      try {
        const width = m.FPDFBitmap_GetWidth(bitmap),
          height = m.FPDFBitmap_GetHeight(bitmap);
        if (width * height > 32_000_000)
          throw new Error('この画像は大きすぎるため個別保存できません。');
        const format = m.FPDFBitmap_GetFormat(bitmap),
          stride = m.FPDFBitmap_GetStride(bitmap);
        const ptr = m.FPDFBitmap_GetBuffer(bitmap);
        if (![1, 2, 3, 4].includes(format))
          throw new Error('この画像形式には対応していません。');
        const data = new Uint8ClampedArray(width * height * 4);
        const bytes = format === 1 ? 1 : format === 2 ? 3 : 4;
        for (let y = 0; y < height; y++)
          for (let x = 0; x < width; x++) {
            const from = ptr + y * stride + x * bytes,
              to = (y * width + x) * 4;
            data[to] = this.heap[from + (format === 1 ? 0 : 2)]!;
            data[to + 1] = this.heap[from + (format === 1 ? 0 : 1)]!;
            data[to + 2] = this.heap[from]!;
            data[to + 3] = format === 4 ? this.heap[from + 3]! : 255;
          }
        return { width, height, data };
      } finally {
        m.FPDFBitmap_Destroy(bitmap);
      }
    });
  }

  async export(pages: EditorPage[]): Promise<ArrayBuffer> {
    if (!pages.length) throw new Error('保存するページがありません。');
    pages.forEach((page) => this.source(page));
    const merged = await this.engine
      .mergePages(
        pages.map((page) => ({
          docId: page.sourceId,
          pageIndices: [page.sourceIndex],
        })),
      )
      .toPromise();
    return this.withDocument(merged.content, (document) => {
      const m = this.module;
      pages.forEach((page, index) => {
        const handle = m.FPDF_LoadPage(document, index);
        if (!handle) throw new Error('保存するページを読み込めません。');
        try {
          m.FPDFPage_SetRotation(handle, page.rotation / 90);
        } finally {
          m.FPDF_ClosePage(handle);
        }
      });
      const writer = m.PDFiumExt_OpenFileWriter();
      let ptr = 0;
      try {
        m.PDFiumExt_SaveAsCopy(document, writer);
        const size = m.PDFiumExt_GetFileWriterSize(writer);
        if (!size) throw new Error('PDFを保存できませんでした。');
        ptr = m.pdfium.wasmExports.malloc(size);
        m.PDFiumExt_GetFileWriterData(writer, ptr, size);
        return this.heap.slice(ptr, ptr + size).buffer;
      } finally {
        if (ptr) m.pdfium.wasmExports.free(ptr);
        m.PDFiumExt_CloseFileWriter(writer);
      }
    });
  }
}
