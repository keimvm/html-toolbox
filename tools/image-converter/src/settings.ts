export type Format = 'jpeg' | 'png';

/** 全画像に当てる設定。 */
export interface GlobalSettings {
  format: Format;
  /** 1枚あたりの容量の上限（バイト）。null は上限なし。 */
  limit: number | null;
  /** 長い辺の画素数の上限。null は元のまま。 */
  longSide: number | null;
}

/** 個別の画面で変えた設定。書いていない項目は全体の設定に従う。 */
export interface Overrides {
  format?: Format;
  /** 手で決めた JPEG の画質（1〜100）。書いていなければ自動。 */
  quality?: number;
  longSide?: number;
}

export interface Effective extends GlobalSettings {
  /** 手で決めた画質。null は自動（上限に合わせる）。 */
  quality: number | null;
}

/** 自動で選ぶ JPEG の画質の範囲。上限がないときは最高値を使う。 */
export const MIN_QUALITY = 30;
export const MAX_QUALITY = 90;

export const defaultSettings = (): GlobalSettings => ({
  format: 'jpeg',
  limit: 1_000_000,
  longSide: 1920,
});

export function effective(global: GlobalSettings, item: Overrides): Effective {
  return {
    format: item.format ?? global.format,
    limit: global.limit,
    longSide: item.longSide ?? global.longSide,
    quality: item.quality ?? null,
  };
}

/** 1 KB を 1,000 バイトとして数える。添付先の数え方（1,024 バイト）より小さめになる。 */
const UNITS = { KB: 1_000, MB: 1_000_000 } as const;
export type LimitUnit = keyof typeof UNITS;

/** 入力欄の値から上限のバイト数を求める。空・0以下・数でないものは上限なし。 */
export function parseLimit(value: string, unit: LimitUnit): number | null {
  const number = Number(value.trim());
  if (!value.trim() || !Number.isFinite(number) || number <= 0) return null;
  return Math.round(number * UNITS[unit]);
}

/** 入力欄の値から長い辺の画素数を求める。空・1未満・数でないものは null。 */
export function parseLongSide(value: string): number | null {
  const number = Math.round(Number(value.trim()));
  if (!value.trim() || !Number.isFinite(number) || number < 1) return null;
  return number;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  const mb = bytes / 1_000_000;
  return `${mb < 10 ? mb.toFixed(2) : mb < 100 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** 拡張子を除いた名前。 */
export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

export const extension = (format: Format) =>
  format === 'jpeg' ? 'jpg' : 'png';

export const mimeType = (format: Format): 'image/jpeg' | 'image/png' =>
  format === 'jpeg' ? 'image/jpeg' : 'image/png';

export const isPdf = (file: File) =>
  file.type === 'application/pdf' || /\.pdf$/iu.test(file.name);
