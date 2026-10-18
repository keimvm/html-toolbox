import { MAX_QUALITY, MIN_QUALITY } from './settings';

export interface Fitted {
  blob: Blob;
  /** 選んだ画質（1〜100）。 */
  quality: number;
  /** 上限以下に収まったか。上限がなければ null。 */
  fits: boolean | null;
}

/**
 * 上限（バイト）以下に収まる最も高い画質を、MIN_QUALITY〜MAX_QUALITY の整数から二分探索で選ぶ。
 * 画質を上げるほど容量が増えるとみなす。最低の画質でも収まらなければ、最低の画質の結果を返す。
 */
export async function fitQuality(
  encode: (quality: number) => Promise<Blob>,
  limit: number | null,
  range = { min: MIN_QUALITY, max: MAX_QUALITY },
): Promise<Fitted> {
  const tried = new Map<number, Blob>();
  const attempt = async (quality: number) => {
    let blob = tried.get(quality);
    if (!blob) tried.set(quality, (blob = await encode(quality)));
    return blob;
  };
  const best = await attempt(range.max);
  if (limit === null) return { blob: best, quality: range.max, fits: null };
  if (best.size <= limit) return { blob: best, quality: range.max, fits: true };
  let low = range.min,
    high = range.max - 1;
  let found: { blob: Blob; quality: number } | null = null;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const blob = await attempt(middle);
    if (blob.size <= limit) {
      found = { blob, quality: middle };
      low = middle + 1;
    } else high = middle - 1;
  }
  if (found) return { ...found, fits: true };
  return { blob: await attempt(range.min), quality: range.min, fits: false };
}
