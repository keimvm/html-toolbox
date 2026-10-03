import { expect, test } from 'vitest';
import {
  editedPoint,
  editedSize,
  fitLongSide,
  fitPixels,
  pixelRect,
  rotatePoint,
  rotateRect,
  sourcePoint,
  turn,
  unrotatePoint,
  unrotateRect,
  type Rotation,
} from '../src/geometry';

const size = { width: 40, height: 30 };
const rotations: Rotation[] = [0, 90, 180, 270];

test('回転は左右どちらにも4回で一周する', () => {
  expect(turn(0, 1)).toBe(90);
  expect(turn(270, 1)).toBe(0);
  expect(turn(0, -1)).toBe(270);
  expect(turn(90, -1)).toBe(0);
});

test('時計回りに回した画像の座標と、元の画像の座標を行き来できる', () => {
  // 元の画像の左上の点は、右に90度回すと右上に来る。
  expect(rotatePoint([0, 0], size, 90)).toEqual([30, 0]);
  expect(rotatePoint([0, 0], size, 180)).toEqual([40, 30]);
  expect(rotatePoint([0, 0], size, 270)).toEqual([0, 40]);
  for (const rotation of rotations)
    for (const point of [
      [0, 0],
      [12, 7],
      [40, 30],
    ] as [number, number][])
      expect(
        unrotatePoint(rotatePoint(point, size, rotation), size, rotation),
      ).toEqual(point);
});

test('回した画像の上で囲んだ範囲を、元の画像の範囲に戻せる', () => {
  const rect = { x: 5, y: 10, width: 20, height: 8 };
  for (const rotation of rotations)
    expect(
      unrotateRect(rotateRect(rect, size, rotation), size, rotation),
    ).toEqual(rect);
  // 右に90度回すと、元の画像の上端は右端になる。
  expect(rotateRect({ x: 0, y: 0, width: 40, height: 5 }, size, 90)).toEqual({
    x: 25,
    y: 0,
    width: 5,
    height: 40,
  });
});

test('範囲は画素の境目まで外側へ広げ、画像の中に収め、小さすぎれば使わない', () => {
  expect(pixelRect({ x: 1.6, y: 2.2, width: 3, height: 3 }, size)).toEqual({
    x: 1,
    y: 2,
    width: 4,
    height: 4,
  });
  expect(pixelRect({ x: -5, y: 25, width: 60, height: 10 }, size)).toEqual({
    x: 0,
    y: 25,
    width: 40,
    height: 5,
  });
  expect(pixelRect({ x: 10, y: 10, width: 1, height: 20 }, size, 4)).toBeNull();
});

test('切り抜き・回転した後の大きさ', () => {
  const crop = { x: 0, y: 0, width: 20, height: 10 };
  expect(editedSize(size, { rotation: 0, crop: null, redactions: [] })).toEqual(
    size,
  );
  expect(editedSize(size, { rotation: 90, crop, redactions: [] })).toEqual({
    width: 10,
    height: 20,
  });
});

test('見比べで、切り抜き・回転した画像の点と元の画像の点を行き来できる', () => {
  const crop = { x: 10, y: 5, width: 20, height: 10 };
  // 切り抜いた範囲の左上は、右に90度回すと右上に来る。
  expect(
    editedPoint([10, 5], size, { rotation: 90, crop, redactions: [] }),
  ).toEqual([10, 0]);
  expect(
    sourcePoint([10, 0], size, { rotation: 90, crop, redactions: [] }),
  ).toEqual([10, 5]);
  // 切り抜いた範囲の外の点は、切り抜いた画像の外の座標になる。
  expect(
    editedPoint([0, 0], size, { rotation: 0, crop, redactions: [] }),
  ).toEqual([-10, -5]);
  for (const rotation of rotations)
    for (const edits of [
      { rotation, crop, redactions: [] },
      { rotation, crop: null, redactions: [] },
    ])
      expect(
        sourcePoint(editedPoint([17, 9], size, edits), size, edits),
      ).toEqual([17, 9]);
});

test('長い辺だけを基準に縮め、拡大はしない', () => {
  expect(fitLongSide({ width: 4032, height: 3024 }, 1920)).toEqual({
    width: 1920,
    height: 1440,
  });
  expect(fitLongSide({ width: 1080, height: 2340 }, 1920)).toEqual({
    width: 886,
    height: 1920,
  });
  expect(fitLongSide({ width: 800, height: 600 }, 1920)).toEqual({
    width: 800,
    height: 600,
  });
  expect(fitLongSide({ width: 800, height: 600 }, null)).toEqual({
    width: 800,
    height: 600,
  });
});

test('表示用に画素数を上限まで減らす', () => {
  const fitted = fitPixels({ width: 8000, height: 6000 }, 12_000_000);
  expect(fitted.width * fitted.height).toBeLessThanOrEqual(12_000_000);
  expect(fitted.width / fitted.height).toBeCloseTo(4 / 3, 2);
  expect(fitPixels(size, 12_000_000)).toEqual(size);
});
