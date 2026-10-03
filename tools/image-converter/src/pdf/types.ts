import type { ImageDataLike } from '@embedpdf/models';

export type RawImage = ImageDataLike;

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

/** 画像を width×height に縮め、JPEG のバイト列にする。 */
export type JpegEncoder = (
  image: RawImage,
  width: number,
  height: number,
  quality: number,
) => Promise<Uint8Array>;

export interface Operations {
  open: { args: { id: string; content: ArrayBuffer }; result: number };
  close: { args: { id: string }; result: boolean };
  render: { args: { id: string; index: number; dpi: number }; result: Blob };
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
