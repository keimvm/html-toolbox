// 全体の設定と、画像ごとに変えた設定（「この画像だけ変える」）。容量・大きさの表示（formatBytes・baseName）は src/lib/format.ts。
/** 書き出す形式。 */
export type Format = 'jpeg' | 'png';
/** 設定で選ぶ形式。auto は画像ごとに、PNG でも JPEG と同じくらいに収まる画像（スクリーンショット・図）を PNG、写真を JPEG にする。 */
export type FormatChoice = 'auto' | Format;

export const FORMAT_LABELS: Record<FormatChoice, string> = {
  auto: '自動',
  jpeg: 'JPEG',
  png: 'PNG',
};

/** 全画像に当てる設定。 */
export interface GlobalSettings {
  format: FormatChoice;
  /** 1枚あたりの容量の上限（バイト）。null は上限なし。 */
  limit: number | null;
  /** 長い辺の画素数の上限。null は元のまま。 */
  longSide: number | null;
}

/** 画像ごとに変えた設定。書いていない項目は全体の設定に従う。 */
export interface Overrides {
  format?: FormatChoice;
  /** 手で決めた JPEG の画質（1〜100）。書いていなければ自動。決めると JPEG で書き出す。 */
  quality?: number;
  longSide?: number;
}

export interface Effective extends GlobalSettings {
  /** 手で決めた画質。null は自動（上限に合わせる）。形式が自動でも、画質を決めたら JPEG にする。 */
  quality: number | null;
}

/** 自動で選ぶ JPEG の画質の範囲。上限がないときは最高値を使う。 */
export const MIN_QUALITY = 30;
export const MAX_QUALITY = 90;

export const defaultSettings = (): GlobalSettings => ({
  format: 'auto',
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

export const extension = (format: Format) => (format === 'jpeg' ? 'jpg' : 'png');

export const mimeType = (format: Format): 'image/jpeg' | 'image/png' =>
  format === 'jpeg' ? 'image/jpeg' : 'image/png';
