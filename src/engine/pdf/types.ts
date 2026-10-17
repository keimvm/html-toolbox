// PDF エンジン（Worker の中の PDFium）とのやり取りの型。PDF編集と画像変換が同じ Worker を使う。
import type { ImageDataLike, PdfDocumentObject } from '@embedpdf/models';

export type Rotation = 0 | 90 | 180 | 270;

/** 開いた PDF の1ページ。元のファイル（sourceId）の何ページ目かと、加えた回転だけを持つ。 */
export interface PageRef {
  sourceId: string;
  sourceIndex: number;
  /** 表示・保存するときの回転（元の回転を含む、時計回り）。 */
  rotation: Rotation;
}

export interface PageElement {
  /** ページ直下の要素の番号（0から）。 */
  index: number;
  kind: 'text' | 'path' | 'image' | 'shading' | 'form' | 'other';
  /** ページ（回転後）の幅・高さに対する割合。 */
  bounds: { x: number; y: number; width: number; height: number };
  image?: {
    width: number;
    height: number;
    widthMm: number;
    heightMm: number;
    dpiX: number;
    dpiY: number;
  };
}

export interface Inspection {
  text: string;
  elements: PageElement[];
}

/** PDF の1ページにする画像。data は JPEG か PNG のファイルの中身。 */
export interface PageImage {
  data: ArrayBuffer;
  type: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
}

/** PDF の中の画像を縮めるときの目安。 */
export interface ShrinkOptions {
  /** ページ上の大きさに対する解像度の上限。これより細かい画像だけを縮める。 */
  dpi: number;
  /** JPEG の画質（0〜1）。 */
  quality: number;
}

export interface ShrinkResult {
  content: ArrayBuffer;
  /** ページ直下の画像の数（複数ページで同じ画像を使う場合は、使うたびに数える）。 */
  images: number;
  /** JPEG にし直した画像の数。 */
  replaced: number;
}

export type RawImage = ImageDataLike;

/** 画像を width×height に縮め、JPEG のバイト列にする。 */
export type JpegEncoder = (
  image: RawImage,
  width: number,
  height: number,
  quality: number,
) => Promise<Uint8Array>;

export interface Operations {
  open: {
    args: { id: string; content: ArrayBuffer };
    result: PdfDocumentObject;
  };
  close: { args: { id: string }; result: boolean };
  render: {
    args: {
      page: PageRef;
      /** 1 で 72 dpi。巨大なページでは画素数の上限まで下げる。 */
      scale: number;
      type?: 'image/png' | 'image/jpeg';
    };
    result: Blob;
  };
  inspect: { args: { page: PageRef }; result: Inspection };
  image: { args: { page: PageRef; index: number }; result: Blob };
  export: { args: { pages: PageRef[] }; result: ArrayBuffer };
  /** ページ直下の要素を取り除いた1ページの PDF を、新しい元ファイル id として開く。 */
  removeElements: {
    args: { page: PageRef; indices: number[]; id: string };
    result: { doc: PdfDocumentObject; content: ArrayBuffer };
  };
  create: { args: { images: PageImage[] }; result: ArrayBuffer };
  shrink: {
    args: { content: ArrayBuffer; options: ShrinkOptions };
    result: ShrinkResult;
  };
}

export type Request = {
  [K in keyof Operations]: {
    id: number;
    method: K;
    args: Operations[K]['args'];
  };
}[keyof Operations];

export type Response = { id: number; result: unknown } | { id: number; error: string };
