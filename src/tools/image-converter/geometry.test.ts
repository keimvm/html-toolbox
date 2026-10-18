import { expect, test } from 'vitest';
import {
  editedPoint,
  editedSize,
  fitLongSide,
  fitPixels,
  formatRatio,
  moveRect,
  pixelRect,
  resizeRect,
  rotatePoint,
  rotateRect,
  snapAngle,
  sourcePoint,
  squarePoint,
  turn,
  unrotatePoint,
  unrotateRect,
  viewTransform,
  type Rotation,
} from './geometry';

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
      expect(unrotatePoint(rotatePoint(point, size, rotation), size, rotation)).toEqual(point);
});

test('回した画像の上で囲んだ範囲を、元の画像の範囲に戻せる', () => {
  const rect = { x: 5, y: 10, width: 20, height: 8 };
  for (const rotation of rotations)
    expect(unrotateRect(rotateRect(rect, size, rotation), size, rotation)).toEqual(rect);
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
  expect(editedSize(size, { rotation: 0, crop: null, marks: [] })).toEqual(size);
  expect(editedSize(size, { rotation: 90, crop, marks: [] })).toEqual({
    width: 10,
    height: 20,
  });
});

test('見比べで、切り抜き・回転した画像の点と元の画像の点を行き来できる', () => {
  const crop = { x: 10, y: 5, width: 20, height: 10 };
  // 切り抜いた範囲の左上は、右に90度回すと右上に来る。
  expect(editedPoint([10, 5], size, { rotation: 90, crop, marks: [] })).toEqual([10, 0]);
  expect(sourcePoint([10, 0], size, { rotation: 90, crop, marks: [] })).toEqual([10, 5]);
  // 切り抜いた範囲の外の点は、切り抜いた画像の外の座標になる。
  expect(editedPoint([0, 0], size, { rotation: 0, crop, marks: [] })).toEqual([-10, -5]);
  for (const rotation of rotations)
    for (const edits of [
      { rotation, crop, marks: [] },
      { rotation, crop: null, marks: [] },
    ])
      expect(sourcePoint(editedPoint([17, 9], size, edits), size, edits)).toEqual([17, 9]);
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

test('矢印キーで範囲を動かすと、画像の端で止まる', () => {
  const rect = { x: 5, y: 10, width: 20, height: 8 };
  expect(moveRect(rect, size, 1, 0)).toEqual({ ...rect, x: 6 });
  expect(moveRect(rect, size, 0, -1)).toEqual({ ...rect, y: 9 });
  expect(moveRect({ ...rect, x: 0 }, size, -1, 0)).toEqual({ ...rect, x: 0 });
  expect(moveRect({ ...rect, x: 20 }, size, 1, 0)).toEqual({ ...rect, x: 20 });
  expect(moveRect({ ...rect, y: 22 }, size, 0, 1)).toEqual({ ...rect, y: 22 });
});

test('矢印キーで幅・高さを変えると、左上は動かず、1 px 以上・画像の中に収まる', () => {
  const rect = { x: 5, y: 10, width: 20, height: 8 };
  expect(resizeRect(rect, size, 1, 0)).toEqual({ ...rect, width: 21 });
  expect(resizeRect(rect, size, 0, -1)).toEqual({ ...rect, height: 7 });
  expect(resizeRect({ ...rect, width: 1 }, size, -1, 0)).toEqual({
    ...rect,
    width: 1,
  });
  expect(resizeRect({ ...rect, width: 35 }, size, 1, 0)).toEqual({
    ...rect,
    width: 35,
  });
  expect(resizeRect({ ...rect, height: 20 }, size, 0, 1)).toEqual({
    ...rect,
    height: 20,
  });
});

test('縦横比は、正方形と小さな整数の比をそのまま、それ以外を小数で表す', () => {
  expect(formatRatio({ width: 800, height: 800 })).toBe('1:1 正方形');
  expect(formatRatio({ width: 1920, height: 1080 })).toBe('16:9');
  expect(formatRatio({ width: 600, height: 800 })).toBe('3:4');
  // 1 px だけ違う範囲は正方形と書かず、比も 1:1 にしない。
  expect(formatRatio({ width: 801, height: 800 })).toBe('約 1.00:1');
  expect(formatRatio({ width: 1000, height: 1501 })).toBe('約 1:1.50');
});

test('編集の画面の座標と元の画像の座標を、切り抜く画面・切り抜いた画面のどちらでも行き来できる', () => {
  const crop = { x: 10, y: 5, width: 20, height: 10 };
  for (const rotation of rotations)
    for (const edits of [
      { rotation, crop, marks: [] },
      { rotation, crop: null, marks: [] },
    ])
      for (const cropView of [true, false]) {
        const view = viewTransform(size, edits, { crop: cropView, scale: 2.5 });
        const [x, y] = view.fromView(view.toView([17, 9]));
        expect(x).toBeCloseTo(17);
        expect(y).toBeCloseTo(9);
      }
  // 切り抜く画面は回転だけを当てた画像、ほかは切り抜いた画像を表示する。
  const edits = { rotation: 90 as const, crop, marks: [] };
  expect(viewTransform(size, edits, { crop: true, scale: 1 }).size).toEqual({
    width: 30,
    height: 40,
  });
  expect(viewTransform(size, edits, { crop: false, scale: 2 }).size).toEqual({
    width: 10,
    height: 20,
  });
  // 切り抜いた範囲の左上は、右に90度回した切り抜いた画面の右上（2倍で表示）に来る。
  expect(viewTransform(size, edits, { crop: false, scale: 2 }).toView([10, 5])).toEqual([20, 0]);
});

test('Shift を押しながらのドラッグは、正方形と 45° 刻みにそろえる', () => {
  expect(squarePoint([10, 10], [30, 15])).toEqual([30, 30]);
  expect(squarePoint([10, 10], [4, 40])).toEqual([-20, 40]);
  // 動かしていない向きは、正の向きに広げる。
  expect(squarePoint([10, 10], [10, 25])).toEqual([25, 25]);
  const [x, y] = snapAngle([0, 0], [10, 1]);
  expect(x).toBeCloseTo(Math.hypot(10, 1));
  expect(y).toBeCloseTo(0);
  const [dx, dy] = snapAngle([0, 0], [10, 9]);
  expect(dx).toBeCloseTo(dy);
  expect(Math.hypot(dx, dy)).toBeCloseTo(Math.hypot(10, 9));
});
