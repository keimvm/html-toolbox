// PDFium の呼び出し。ブラウザーでは Worker の中で使い、テストでは Node.js から直接使う。
// 読み込み・描画・文字の取り出し・ページの結合は @embedpdf/engines の公開 API に任せ、
// 回転の保存・要素の一覧と削除・個別の画像・画像からの PDF 作成・PDF の縮小には PDFium の公開 API を使う。
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  FontCharset,
  type ImageDataLike,
  type PdfDocumentObject,
  type Rotation as PdfRotation,
} from '@embedpdf/models';
import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import type {
  Inspection,
  JpegEncoder,
  PageElement,
  PageImage,
  PageRef,
  RawImage,
  ShrinkOptions,
  ShrinkResult,
} from './types';

/** PDF の1ページの一辺の上限（ポイント）。PDF の仕様上の上限。 */
const MAX_PAGE_SIZE = 14_400;
/** 画像を1ページにするときの大きさ。1 px を 0.75 pt（96 dpi）とする。 */
const POINTS_PER_PIXEL = 0.75;
/** ページを描画するときに一度に確保する画素数の上限。 */
export const MAX_RENDER_PIXELS = 16_000_000;
/** 個別の画像として取り出す画素数の上限。 */
const MAX_EXTRACT_PIXELS = 32_000_000;
/** PDF の中の画像を縮めるときに、読み出す画素数の上限。 */
const MAX_IMAGE_PIXELS = 40_000_000;
/** JPEG にし直しても、元のデータの9割より小さくならなければ差し替えない。 */
const MIN_SAVING = 0.9;

const OBJECT_KINDS: Record<number, PageElement['kind']> = {
  1: 'text',
  2: 'path',
  3: 'image',
  4: 'shading',
  5: 'form',
};
const IMAGE_OBJECT = 3;

interface Source {
  doc: PdfDocumentObject;
  content: ArrayBuffer;
}

export class PdfRuntime {
  private documents = new Map<string, Source>();
  private constructor(
    private module: WrappedPdfiumModule,
    private engine: PdfiumNative,
  ) {}

  static async create(wasmBinary: ArrayBuffer, japaneseFont?: Uint8Array) {
    const module = await init({ wasmBinary });
    return new PdfRuntime(
      module,
      new PdfiumNative(module, {
        // フォントを含まない日本語の PDF も、内蔵の Noto Sans JP で描く。
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
    // 配布パッケージの型から欠けている、Emscripten 標準のメモリビュー。
    return (
      this.module.pdfium as typeof this.module.pdfium & {
        HEAPU8: Uint8Array<ArrayBuffer>;
      }
    ).HEAPU8;
  }

  private malloc(size: number) {
    const ptr = this.module.pdfium.wasmExports.malloc(size);
    if (!ptr) throw new Error('PDFを処理するメモリを確保できません。');
    return ptr;
  }

  private free(ptr: number) {
    this.module.pdfium.wasmExports.free(ptr);
  }

  async open(id: string, content: ArrayBuffer): Promise<PdfDocumentObject> {
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

  private source(page: PageRef) {
    const source = this.documents.get(page.sourceId);
    if (!source || !source.doc.pages[page.sourceIndex]) throw new Error('ページが見つかりません。');
    return source;
  }

  /** ページを描く。scale 1 で 72 dpi。巨大なページで一度に確保する画素数を抑える。 */
  async render(page: PageRef, scale: number): Promise<ImageDataLike> {
    const { doc } = this.source(page);
    const original = doc.pages[page.sourceIndex]!;
    const safeScale = Math.min(
      scale,
      Math.sqrt(MAX_RENDER_PIXELS / (original.size.width * original.size.height)),
    );
    return this.engine
      .renderPageRaw(doc, original, {
        scaleFactor: safeScale,
        rotation: (page.rotation / 90) as PdfRotation,
        withAnnotations: true,
        withForms: true,
      })
      .toPromise();
  }

  private loadDocument(content: ArrayBuffer) {
    const m = this.module;
    const ptr = this.malloc(content.byteLength);
    this.heap.set(new Uint8Array(content), ptr);
    const document = m.FPDF_LoadMemDocument(ptr, content.byteLength, '');
    if (!document) {
      this.free(ptr);
      throw new Error('PDFを開けません。パスワードやファイルの破損を確認してください。');
    }
    return {
      document,
      close: () => {
        m.FPDF_CloseDocument(document);
        this.free(ptr);
      },
    };
  }

  private withDocument<T>(content: ArrayBuffer, action: (document: number) => T): T {
    const { document, close } = this.loadDocument(content);
    try {
      return action(document);
    } finally {
      close();
    }
  }

  private async withDocumentAsync<T>(
    content: ArrayBuffer,
    action: (document: number) => Promise<T>,
  ): Promise<T> {
    const { document, close } = this.loadDocument(content);
    try {
      return await action(document);
    } finally {
      close();
    }
  }

  private withPage<T>(page: PageRef, action: (document: number, handle: number) => T) {
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

  private save(document: number): ArrayBuffer {
    const m = this.module;
    const writer = m.PDFiumExt_OpenFileWriter();
    let ptr = 0;
    try {
      m.PDFiumExt_SaveAsCopy(document, writer);
      const size = m.PDFiumExt_GetFileWriterSize(writer);
      if (!size) throw new Error('PDFを保存できませんでした。');
      ptr = this.malloc(size);
      m.PDFiumExt_GetFileWriterData(writer, ptr, size);
      return this.heap.slice(ptr, ptr + size).buffer;
    } finally {
      if (ptr) this.free(ptr);
      m.PDFiumExt_CloseFileWriter(writer);
    }
  }

  async inspect(page: PageRef): Promise<Inspection> {
    const { doc } = this.source(page);
    const text = (await this.engine.extractText(doc, [page.sourceIndex]).toPromise()) as string;
    const ownRotation = doc.pages[page.sourceIndex]!.rotation;
    const elements = this.withPage(page, (_document, handle) => {
      const m = this.module;
      const scratch = this.malloc(32);
      try {
        const result: PageElement[] = [];
        const width = m.FPDF_GetPageWidth(handle);
        const height = m.FPDF_GetPageHeight(handle);
        const float = (offset: number) => m.pdfium.getValue(scratch + offset, 'float');
        const integer = (offset: number) => m.pdfium.getValue(scratch + offset, 'i32');
        // PDFium の座標変換で、CropBox・元の回転・加えた回転を反映する。
        const extra = (page.rotation / 90 - ownRotation + 4) % 4;
        const quarter = extra % 2 !== 0;
        const deviceWidth = Math.round(quarter ? height : width);
        const deviceHeight = Math.round(quarter ? width : height);
        for (let index = 0; index < m.FPDFPage_CountObjects(handle); index++) {
          const object = m.FPDFPage_GetObject(handle, index);
          const type = m.FPDFPageObj_GetType(object);
          if (!m.FPDFPageObj_GetBounds(object, scratch, scratch + 4, scratch + 8, scratch + 12))
            continue;
          const left = float(0),
            bottom = float(4),
            right = float(8),
            top = float(12);
          const corners = (
            [
              [left, bottom],
              [left, top],
              [right, bottom],
              [right, top],
            ] as const
          ).map(([x, y]) => {
            m.FPDF_PageToDevice(
              handle,
              0,
              0,
              deviceWidth,
              deviceHeight,
              extra,
              x,
              y,
              scratch,
              scratch + 4,
            );
            return { x: integer(0) / deviceWidth, y: integer(4) / deviceHeight };
          });
          const x = Math.min(...corners.map((p) => p.x));
          const y = Math.min(...corners.map((p) => p.y));
          const item: PageElement = {
            index,
            kind: OBJECT_KINDS[type] ?? 'other',
            bounds: {
              x,
              y,
              width: Math.max(...corners.map((p) => p.x)) - x,
              height: Math.max(...corners.map((p) => p.y)) - y,
            },
          };
          if (
            type === IMAGE_OBJECT &&
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
        this.free(scratch);
      }
    });
    return { text, elements };
  }

  /** 1:グレー、2:BGR、3:BGRx、4:BGRA のビットマップを RGBA にする。 */
  private bitmapPixels(bitmap: number, keepAlpha: boolean): RawImage | null {
    const m = this.module;
    const width = m.FPDFBitmap_GetWidth(bitmap);
    const height = m.FPDFBitmap_GetHeight(bitmap);
    const format = m.FPDFBitmap_GetFormat(bitmap);
    if (![1, 2, 3, 4].includes(format)) return null;
    const stride = m.FPDFBitmap_GetStride(bitmap);
    const ptr = m.FPDFBitmap_GetBuffer(bitmap);
    const heap = this.heap;
    const data = new Uint8ClampedArray(width * height * 4);
    const bytes = format === 1 ? 1 : format === 2 ? 3 : 4;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const from = ptr + y * stride + x * bytes,
          to = (y * width + x) * 4;
        data[to] = heap[from + (format === 1 ? 0 : 2)]!;
        data[to + 1] = heap[from + (format === 1 ? 0 : 1)]!;
        data[to + 2] = heap[from]!;
        data[to + 3] = keepAlpha && format === 4 ? heap[from + 3]! : 255;
      }
    return { width, height, data };
  }

  /** ページ直下の画像を、元の画素数で取り出す。 */
  image(page: PageRef, index: number): ImageDataLike {
    return this.withPage(page, (_document, handle) => {
      const m = this.module;
      if (!Number.isInteger(index) || index < 0 || index >= m.FPDFPage_CountObjects(handle))
        throw new Error('画像が見つかりません。');
      const object = m.FPDFPage_GetObject(handle, index);
      if (m.FPDFPageObj_GetType(object) !== IMAGE_OBJECT)
        throw new Error('画像を選択してください。');
      const bitmap = m.FPDFImageObj_GetBitmap(object);
      if (!bitmap)
        throw new Error('この画像は個別に取り出せません。ページ全体を画像として保存してください。');
      try {
        if (m.FPDFBitmap_GetWidth(bitmap) * m.FPDFBitmap_GetHeight(bitmap) > MAX_EXTRACT_PIXELS)
          throw new Error('この画像は大きすぎるため個別に保存できません。');
        const pixels = this.bitmapPixels(bitmap, true);
        if (!pixels) throw new Error('この画像形式には対応していません。');
        return pixels;
      } finally {
        m.FPDFBitmap_Destroy(bitmap);
      }
    });
  }

  /**
   * ページ直下の要素を取り除いた1ページの PDF を作り、id として開く。元の PDF には手を加えない。
   * 返す content は復元用に保存する中身。
   */
  async removeElements(page: PageRef, indices: number[], id: string) {
    const { content } = this.source(page);
    const output = this.withDocument(content, (source) => {
      const m = this.module;
      const document = m.FPDF_CreateNewDocument();
      if (!document) throw new Error('PDFを作れません。');
      try {
        if (!m.FPDF_ImportPages(document, source, String(page.sourceIndex + 1), 0))
          throw new Error('ページを写せません。');
        const handle = m.FPDF_LoadPage(document, 0);
        if (!handle) throw new Error('ページを読み込めません。');
        try {
          const count = m.FPDFPage_CountObjects(handle);
          // 後ろから取り除き、残る要素の番号をずらさない。
          for (const index of [...new Set(indices)].sort((a, b) => b - a)) {
            if (!Number.isInteger(index) || index < 0 || index >= count)
              throw new Error('取り除く要素が見つかりません。');
            const object = m.FPDFPage_GetObject(handle, index);
            if (!m.FPDFPage_RemoveObject(handle, object)) throw new Error('要素を取り除けません。');
            m.FPDFPageObj_Destroy(object);
          }
          if (!m.FPDFPage_GenerateContent(handle)) throw new Error('ページを作り直せません。');
        } finally {
          m.FPDF_ClosePage(handle);
        }
        return this.save(document);
      } finally {
        m.FPDF_CloseDocument(document);
      }
    });
    const doc = await this.open(id, output.slice(0));
    return { doc, content: output };
  }

  /** 並べたページを1つの PDF にする。回転は加えた回転で保存する。 */
  async export(pages: PageRef[]): Promise<ArrayBuffer> {
    if (!pages.length) throw new Error('保存するページがありません。');
    pages.forEach((page) => this.source(page));
    const merged = await this.engine
      .mergePages(pages.map((page) => ({ docId: page.sourceId, pageIndices: [page.sourceIndex] })))
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
      return this.save(document);
    });
  }

  /** JPEG はそのまま、PNG は PDFium が展開して画像オブジェクトに入れる。 */
  private setImage(object: number, type: PageImage['type'], data: Uint8Array) {
    const ptr = this.malloc(data.byteLength);
    try {
      this.heap.set(data, ptr);
      const set =
        type === 'image/jpeg' ? this.module.EPDFImageObj_SetJpeg : this.module.EPDFImageObj_SetPng;
      return set(0, 0, object, ptr, data.byteLength);
    } finally {
      this.free(ptr);
    }
  }

  /** 画像を1枚1ページにした PDF を作る。ページは画像と同じ縦横比で、余白を付けない。 */
  create(images: PageImage[]): ArrayBuffer {
    if (!images.length) throw new Error('PDFにする画像がありません。');
    const m = this.module;
    const document = m.FPDF_CreateNewDocument();
    if (!document) throw new Error('PDFを作れません。');
    try {
      images.forEach((image, index) => {
        const fit = Math.min(
          1,
          MAX_PAGE_SIZE / (Math.max(image.width, image.height) * POINTS_PER_PIXEL),
        );
        const width = image.width * POINTS_PER_PIXEL * fit;
        const height = image.height * POINTS_PER_PIXEL * fit;
        const page = m.FPDFPage_New(document, index, width, height);
        if (!page) throw new Error('PDFのページを作れません。');
        try {
          const object = m.FPDFPageObj_NewImageObj(document);
          if (!object) throw new Error('PDFに画像を入れられません。');
          if (
            !this.setImage(object, image.type, new Uint8Array(image.data)) ||
            !m.FPDFImageObj_SetMatrix(object, width, 0, 0, height, 0, 0)
          ) {
            m.FPDFPageObj_Destroy(object);
            throw new Error(`${index + 1}枚目の画像をPDFに入れられません。`);
          }
          m.FPDFPage_InsertObject(page, object);
          if (!m.FPDFPage_GenerateContent(page)) throw new Error('PDFのページを作れません。');
        } finally {
          m.FPDF_ClosePage(page);
        }
      });
      return this.save(document);
    } finally {
      m.FPDF_CloseDocument(document);
    }
  }

  /** 画像オブジェクトの元のデータ（圧縮されたまま）。 */
  private rawData(object: number) {
    const m = this.module;
    const size = m.FPDFImageObj_GetImageDataRaw(object, 0, 0);
    if (!size) return new Uint8Array();
    const ptr = this.malloc(size);
    try {
      m.FPDFImageObj_GetImageDataRaw(object, ptr, size);
      return this.heap.slice(ptr, ptr + size);
    } finally {
      this.free(ptr);
    }
  }

  /** 透過・色抜きのある画像か。ページに置いたときの見た目を描画して調べる。調べられなければ null。 */
  private transparent(document: number, page: number, object: number) {
    const m = this.module;
    const bitmap = m.FPDFImageObj_GetRenderedBitmap(document, page, object);
    if (!bitmap) return null;
    try {
      if (m.FPDFBitmap_GetFormat(bitmap) !== 4) return false;
      const width = m.FPDFBitmap_GetWidth(bitmap);
      const height = m.FPDFBitmap_GetHeight(bitmap);
      const stride = m.FPDFBitmap_GetStride(bitmap);
      const buffer = m.FPDFBitmap_GetBuffer(bitmap);
      const heap = this.heap;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          if (heap[buffer + y * stride + x * 4 + 3]! < 255) return true;
      return false;
    } finally {
      m.FPDFBitmap_Destroy(bitmap);
    }
  }

  /** 画素数・ページ上の幅と高さ（ポイント）・1画素のビット数。回転・傾けて置かれた画像は null。 */
  private imageInfo(page: number, object: number) {
    const m = this.module;
    const scratch = this.malloc(32);
    const float = (offset: number) => m.pdfium.getValue(scratch + offset, 'float');
    const integer = (offset: number) => m.pdfium.getValue(scratch + offset, 'i32');
    try {
      if (!m.FPDFImageObj_GetImagePixelSize(object, scratch, scratch + 4)) return null;
      const width = integer(0),
        height = integer(4);
      // FS_MATRIX の a・b・c・d。
      if (!m.FPDFPageObj_GetMatrix(object, scratch)) return null;
      const a = float(0),
        b = float(4),
        c = float(8),
        d = float(12);
      if (Math.abs(b) > 1e-3 || Math.abs(c) > 1e-3) return null;
      // FPDF_IMAGEOBJ_METADATA の bits_per_pixel。
      if (!m.FPDFImageObj_GetImageMetadata(object, page, scratch)) return null;
      return { width, height, a, d, bits: integer(16) };
    } finally {
      this.free(scratch);
    }
  }

  /**
   * 1つの画像を縮めて JPEG にし直し、差し替えたら JPEG のバイト列を返す。
   * 回転・反転して置かれた画像、白黒2値の画像、透過のある画像、小さくならない画像はそのまま残す。
   */
  private async shrinkImage(
    document: number,
    page: number,
    object: number,
    options: ShrinkOptions,
    encode: JpegEncoder,
  ): Promise<Uint8Array | null> {
    const m = this.module;
    const info = this.imageInfo(page, object);
    if (!info) return null;
    const { width, height, a, d, bits } = info;
    if (a <= 0 || d <= 0 || bits < 8 || width * height > MAX_IMAGE_PIXELS) return null;
    // 描画して透過を調べるため、ページ上で極端に大きい画像は扱わない。
    if (a * d > MAX_RENDER_PIXELS) return null;
    const dpi = Math.min((width * 72) / a, (height * 72) / d);
    const scale = Math.min(1, options.dpi / dpi);
    const raw = m.FPDFImageObj_GetImageDataRaw(object, 0, 0);
    if (!raw || this.transparent(document, page, object) !== false) return null;
    const bitmap = m.FPDFImageObj_GetBitmap(object);
    if (!bitmap) return null;
    let image: RawImage | null;
    try {
      image = this.bitmapPixels(bitmap, false);
    } finally {
      m.FPDFBitmap_Destroy(bitmap);
    }
    if (!image) return null;
    const jpeg = await encode(
      image,
      Math.max(1, Math.round(width * scale)),
      Math.max(1, Math.round(height * scale)),
      options.quality,
    );
    if (jpeg.byteLength >= raw * MIN_SAVING) return null;
    return this.setImage(object, 'image/jpeg', jpeg) ? jpeg : null;
  }

  /**
   * PDF の中の写真・スキャン画像を縮めて JPEG にし直す。文字・図形のオブジェクトには触れない。
   * 対象はページ直下の画像だけで、グループ（Form XObject）内の画像は残す。
   */
  shrink(content: ArrayBuffer, options: ShrinkOptions, encode: JpegEncoder): Promise<ShrinkResult> {
    return this.withDocumentAsync(content, async (document) => {
      const m = this.module;
      // 差し替えた JPEG。複数ページで共有する画像は、2ページ目以降でもこの中身に変わっている。
      const replaced: Uint8Array[] = [];
      const isReplaced = (object: number) => {
        const size = m.FPDFImageObj_GetImageDataRaw(object, 0, 0);
        const candidates = replaced.filter((jpeg) => jpeg.byteLength === size);
        if (!candidates.length) return false;
        const data = this.rawData(object);
        return candidates.some((jpeg) => jpeg.every((value, index) => value === data[index]));
      };
      let images = 0;
      for (let index = 0; index < m.FPDF_GetPageCount(document); index++) {
        const page = m.FPDF_LoadPage(document, index);
        if (!page) throw new Error('ページを読み込めません。');
        try {
          let changed = false;
          for (let k = 0; k < m.FPDFPage_CountObjects(page); k++) {
            const object = m.FPDFPage_GetObject(page, k);
            if (m.FPDFPageObj_GetType(object) !== IMAGE_OBJECT) continue;
            images++;
            if (isReplaced(object)) {
              // 共有された画像。ページの内容を作り直し、元の画像への参照を新しい画像に向ける。
              m.FPDFPageObj_Transform(object, 1, 0, 0, 1, 0, 0);
              changed = true;
              continue;
            }
            const jpeg = await this.shrinkImage(document, page, object, options, encode);
            if (jpeg) {
              replaced.push(jpeg);
              changed = true;
            }
          }
          if (changed && !m.FPDFPage_GenerateContent(page))
            throw new Error('ページを作り直せません。');
        } finally {
          m.FPDF_ClosePage(page);
        }
      }
      return {
        content: replaced.length ? this.save(document) : content,
        images,
        replaced: replaced.length,
      };
    });
  }
}
