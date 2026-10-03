import { expect, test } from 'vitest';
import { fitQuality } from '../src/fit';
import {
  baseName,
  effective,
  formatBytes,
  parseLimit,
  parseLongSide,
} from '../src/settings';

test('上限は 1 KB = 1,000 バイトで数え、空・0以下・数でないものは上限なしにする', () => {
  expect(parseLimit('1', 'MB')).toBe(1_000_000);
  expect(parseLimit('1.5', 'MB')).toBe(1_500_000);
  expect(parseLimit(' 300 ', 'KB')).toBe(300_000);
  expect(parseLimit('', 'MB')).toBeNull();
  expect(parseLimit('0', 'MB')).toBeNull();
  expect(parseLimit('-2', 'KB')).toBeNull();
  expect(parseLimit('abc', 'KB')).toBeNull();
});

test('長い辺は整数の画素数にし、空・1未満は元のままにする', () => {
  expect(parseLongSide('1920')).toBe(1920);
  expect(parseLongSide('1280.4')).toBe(1280);
  expect(parseLongSide('')).toBeNull();
  expect(parseLongSide('0')).toBeNull();
});

test('個別に変えた設定だけがその画像に効き、上限は全体の設定に従う', () => {
  const global = {
    format: 'jpeg' as const,
    limit: 1_000_000,
    longSide: 1920,
  };
  expect(effective(global, {})).toEqual({ ...global, quality: null });
  expect(
    effective(global, { format: 'png', longSide: 800, quality: 70 }),
  ).toEqual({ format: 'png', limit: 1_000_000, longSide: 800, quality: 70 });
});

test('容量の表示と、保存名の元になる名前', () => {
  expect(formatBytes(512)).toBe('512 B');
  expect(formatBytes(820_400)).toBe('820 KB');
  expect(formatBytes(1_234_567)).toBe('1.23 MB');
  expect(formatBytes(23_456_789)).toBe('23.5 MB');
  expect(baseName('IMG_0001.HEIC')).toBe('IMG_0001');
  expect(baseName('報告書.v2.pdf')).toBe('報告書.v2');
  expect(baseName('.hidden')).toBe('.hidden');
});

/** 画質に比例して容量が増える、仮の書き出し。 */
function fakeEncoder() {
  const calls: number[] = [];
  const encode = async (quality: number) => {
    calls.push(quality);
    return new Blob([new Uint8Array(quality * 1_000)]);
  };
  return { calls, encode };
}

test('上限以下に収まる最も高い画質を選ぶ', async () => {
  const { calls, encode } = fakeEncoder();
  const result = await fitQuality(encode, 55_500);
  expect(result.quality).toBe(55);
  expect(result.fits).toBe(true);
  expect(result.blob.size).toBe(55_000);
  // 二分探索なので、画質ごとに試さない。
  expect(calls.length).toBeLessThanOrEqual(8);
  expect(new Set(calls).size).toBe(calls.length);
});

test('最高の画質で収まれば、それ以上試さない。上限がなければ最高の画質にする', async () => {
  const fits = fakeEncoder();
  expect(await fitQuality(fits.encode, 5_000_000)).toMatchObject({
    quality: 90,
    fits: true,
  });
  expect(fits.calls).toEqual([90]);
  const unlimited = fakeEncoder();
  expect(await fitQuality(unlimited.encode, null)).toMatchObject({
    quality: 90,
    fits: null,
  });
  expect(unlimited.calls).toEqual([90]);
});

test('最低の画質でも収まらなければ、最低の画質の結果に印を付ける', async () => {
  const { encode } = fakeEncoder();
  const result = await fitQuality(encode, 10_000);
  expect(result).toMatchObject({ quality: 30, fits: false });
  expect(result.blob.size).toBe(30_000);
});
