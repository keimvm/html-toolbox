import { init, type WrappedPdfiumModule } from '@embedpdf/pdfium';
import { PdfiumNative } from '@embedpdf/engines/pdfium';
import {
  FontCharset,
  type PdfDocumentObject,
  type ImageDataLike,
} from '@embedpdf/models';
import type {
  JpegEncoder,
  PageImage,
  RawImage,
  ShrinkOptions,
  ShrinkResult,
} from './types';

/** PDF の1ページの一辺の上限（ポイント）。PDF の仕様上の上限。 */
const MAX_PAGE_SIZE = 14_400;
/** 画像を1ページにするときの大きさ。1 px を 0.75 pt（96 dpi）とする。 */
const POINTS_PER_PIXEL = 0.75;
/** ページを描画するときに一度に確保する画素数の上限。 */
const MAX_RENDER_PIXELS = 16_000_000;
/** PDF の中の画像を縮めるときに、読み出す画素数の上限。 */
const MAX_IMAGE_PIXELS = 40_000_000;
/** JPEG にし直しても、元のデータの9割より小さくならなければ差し替えない。 */
const MIN_SAVING = 0.9;
const IMAGE_OBJECT = 3;

/** ブラウザーでは Worker 内で使う。URL からの読み込みは使わない。 */
export class PdfRuntime {
  private documents = new Map<string, PdfDocumentObject>();
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

  /** ページ数を返す。 */
  async open(id: string, content: ArrayBuffer) {
    const doc = await this.engine
      .openDocumentBuffer({ id, content }, { normalizeRotation: true })
      .toPromise();
    if (!doc.pages.length) {
      await this.engine.closeDocument(doc).toPromise();
      throw new Error('ページのないPDFは開けません。');
    }
    this.documents.set(id, doc);
    return doc.pages.length;
  }

  async close(id: string) {
    const doc = this.documents.get(id);
    if (!doc) return false;
    await this.engine.closeDocument(doc).toPromise();
    this.documents.delete(id);
    return true;
  }

  /** ページを dpi の細かさで描画する。フォントを含まない日本語は内蔵のフォントで描く。 */
  async render(id: string, index: number, dpi: number): Promise<ImageDataLike> {
    const doc = this.documents.get(id);
    const page = doc?.pages[index];
    if (!doc || !page) throw new Error('ページが見つかりません。');
    // 巨大なページで一度に確保する画素数を抑える。
    const scale = Math.min(
      dpi / 72,
      Math.sqrt(MAX_RENDER_PIXELS / (page.size.width * page.size.height)),
    );
    return this.engine
      .renderPageRaw(doc, page, {
        scaleFactor: scale,
        withAnnotations: true,
        withForms: true,
      })
      .toPromise();
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

  /** JPEG はそのまま、PNG は PDFium が展開して画像オブジェクトに入れる。 */
  private setImage(object: number, type: PageImage['type'], data: Uint8Array) {
    const ptr = this.malloc(data.byteLength);
    try {
      this.heap.set(data, ptr);
      const set =
        type === 'image/jpeg'
          ? this.module.EPDFImageObj_SetJpeg
          : this.module.EPDFImageObj_SetPng;
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
          MAX_PAGE_SIZE /
            (Math.max(image.width, image.height) * POINTS_PER_PIXEL),
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
          if (!m.FPDFPage_GenerateContent(page))
            throw new Error('PDFのページを作れません。');
        } finally {
          m.FPDF_ClosePage(page);
        }
      });
      return this.save(document);
    } finally {
      m.FPDF_CloseDocument(document);
    }
  }

  private async withDocument<T>(
    content: ArrayBuffer,
    action: (document: number) => Promise<T>,
  ): Promise<T> {
    const m = this.module;
    const ptr = this.malloc(content.byteLength);
    let document = 0;
    try {
      this.heap.set(new Uint8Array(content), ptr);
      document = m.FPDF_LoadMemDocument(ptr, content.byteLength, '');
      if (!document)
        throw new Error(
          'PDFを開けません。パスワードやファイルの破損を確認してください。',
        );
      return await action(document);
    } finally {
      if (document) m.FPDF_CloseDocument(document);
      this.free(ptr);
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

  /** 画像オブジェクトの画素を RGBA で読む（マスクは含まない）。 */
  private pixels(object: number): RawImage | null {
    const m = this.module;
    const bitmap = m.FPDFImageObj_GetBitmap(object);
    if (!bitmap) return null;
    try {
      const width = m.FPDFBitmap_GetWidth(bitmap);
      const height = m.FPDFBitmap_GetHeight(bitmap);
      const format = m.FPDFBitmap_GetFormat(bitmap);
      if (![1, 2, 3, 4].includes(format)) return null;
      const stride = m.FPDFBitmap_GetStride(bitmap);
      const ptr = m.FPDFBitmap_GetBuffer(bitmap);
      const heap = this.heap;
      const data = new Uint8ClampedArray(width * height * 4);
      // 1:グレー、2:BGR、3:BGRx、4:BGRA。
      const bytes = format === 1 ? 1 : format === 2 ? 3 : 4;
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const from = ptr + y * stride + x * bytes,
            to = (y * width + x) * 4;
          data[to] = heap[from + (format === 1 ? 0 : 2)]!;
          data[to + 1] = heap[from + (format === 1 ? 0 : 1)]!;
          data[to + 2] = heap[from]!;
          data[to + 3] = 255;
        }
      return { width, height, data };
    } finally {
      m.FPDFBitmap_Destroy(bitmap);
    }
  }

  /** 画素数・ページ上の幅と高さ（ポイント）・1画素のビット数。回転・傾けて置かれた画像は null。 */
  private imageInfo(page: number, object: number) {
    const m = this.module;
    const scratch = this.malloc(32);
    const float = (offset: number) =>
      m.pdfium.getValue(scratch + offset, 'float');
    const integer = (offset: number) =>
      m.pdfium.getValue(scratch + offset, 'i32');
    try {
      if (!m.FPDFImageObj_GetImagePixelSize(object, scratch, scratch + 4))
        return null;
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
    if (a <= 0 || d <= 0 || bits < 8 || width * height > MAX_IMAGE_PIXELS)
      return null;
    // 描画して透過を調べるため、ページ上で極端に大きい画像は扱わない。
    if (a * d > MAX_RENDER_PIXELS) return null;
    const dpi = Math.min((width * 72) / a, (height * 72) / d);
    const scale = Math.min(1, options.dpi / dpi);
    const raw = m.FPDFImageObj_GetImageDataRaw(object, 0, 0);
    if (!raw || this.transparent(document, page, object) !== false) return null;
    const image = this.pixels(object);
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
  shrink(
    content: ArrayBuffer,
    options: ShrinkOptions,
    encode: JpegEncoder,
  ): Promise<ShrinkResult> {
    return this.withDocument(content, async (document) => {
      const m = this.module;
      // 差し替えた JPEG。複数ページで共有する画像は、2ページ目以降でもこの中身に変わっている。
      const replaced: Uint8Array[] = [];
      const isReplaced = (object: number) => {
        const size = m.FPDFImageObj_GetImageDataRaw(object, 0, 0);
        const candidates = replaced.filter((jpeg) => jpeg.byteLength === size);
        if (!candidates.length) return false;
        const data = this.rawData(object);
        return candidates.some((jpeg) =>
          jpeg.every((value, index) => value === data[index]),
        );
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
            const jpeg = await this.shrinkImage(
              document,
              page,
              object,
              options,
              encode,
            );
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
