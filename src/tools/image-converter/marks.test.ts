import { expect, test } from 'vitest';
import { rotatePoint, type Point } from './geometry';
import {
  arrowShape,
  hitMark,
  mapMark,
  markAt,
  moveMark,
  numberLabels,
  oppositeCorner,
  paintOrder,
  settleRedaction,
  strokeWidth,
  textSize,
  type Mark,
} from './marks';

/** 文字の幅を、文字数に比例するとみなして測る（Canvas の代わり）。 */
const measure = (line: string, size: number) => line.length * size * 0.6;
/** unit 1000・大きさ「中」なら、線の太さ 4 px・文字 24 px・番号の半径 15 px。 */
const common = { color: 'red', size: 'm', unit: 1000 } as const;
const view = { scale: 1, tolerance: 3, measure };

test('線の太さは画像の長い辺に合わせ、細すぎないようにする', () => {
  expect(strokeWidth({ ...common, id: 1, kind: 'arrow', from: [0, 0], to: [1, 1] })).toBeCloseTo(4);
  expect(
    strokeWidth({
      ...common,
      size: 'l',
      unit: 1920,
      id: 1,
      kind: 'arrow',
      from: [0, 0],
      to: [1, 1],
    }),
  ).toBeCloseTo(12.48);
  expect(
    strokeWidth({ ...common, unit: 100, id: 1, kind: 'arrow', from: [0, 0], to: [1, 1] }),
  ).toBe(2);
});

test('矢印は先が to で、軸の左右に同じ形になり、根元より矢じりが太い', () => {
  const shape = arrowShape([0, 0], [100, 0], 10);
  expect(shape).toHaveLength(7);
  expect(shape[3]).toEqual([100, 0]);
  for (let index = 0; index < 3; index++) {
    expect(shape[index]![0]).toBeCloseTo(shape[6 - index]![0]);
    expect(shape[index]![1]).toBeCloseTo(-shape[6 - index]![1]);
  }
  const [tail, neck, wing] = shape.map(([, y]) => Math.abs(y));
  expect(tail!).toBeLessThan(neck!);
  expect(neck!).toBeLessThan(wing!);
  // 短い矢印でも、矢じりが根元より後ろへはみ出さない。
  for (const [x] of arrowShape([0, 0], [10, 0], 10)) {
    expect(x).toBeGreaterThanOrEqual(-1e-9);
    expect(x).toBeLessThanOrEqual(10);
  }
  expect(arrowShape([5, 5], [5, 5], 10)).toEqual([]);
});

test('枠は線の上だけで当たり、内側では当たらない。蛍光ペンと黒塗りは内側でも当たる', () => {
  const rect = { x: 10, y: 10, width: 100, height: 60 };
  const frame: Mark = { ...common, id: 1, kind: 'rect', rect };
  expect(hitMark(frame, [10, 40], view)).toBe(true);
  expect(hitMark(frame, [112, 40], view)).toBe(true);
  expect(hitMark(frame, [60, 40], view)).toBe(false);
  expect(hitMark(frame, [0, 0], view)).toBe(false);
  const highlight: Mark = { ...common, id: 2, kind: 'highlight', rect };
  expect(hitMark(highlight, [60, 40], view)).toBe(true);
  const ellipse: Mark = { ...common, id: 3, kind: 'ellipse', rect: { ...rect, x: 0, y: 0 } };
  expect(hitMark(ellipse, [100, 30], view)).toBe(true);
  expect(hitMark(ellipse, [50, 30], view)).toBe(false);
});

test('矢印は線の近く、番号は丸の中、文字は文字の塊の中で当たる', () => {
  const arrow: Mark = { ...common, id: 1, kind: 'arrow', from: [0, 0], to: [100, 0] };
  expect(hitMark(arrow, [50, 3], view)).toBe(true);
  expect(hitMark(arrow, [50, 30], view)).toBe(false);
  const badge: Mark = { ...common, id: 2, kind: 'number', at: [50, 50] };
  expect(hitMark(badge, [60, 50], view)).toBe(true);
  expect(hitMark(badge, [80, 50], view)).toBe(false);
  const text: Mark = { ...common, id: 3, kind: 'text', at: [100, 100], text: 'あいう' };
  expect(hitMark(text, [100, 100], view)).toBe(true);
  expect(hitMark(text, [120, 112], view)).toBe(true);
  expect(hitMark(text, [130, 100], view)).toBe(false);
  // 表示を2倍にすると、当たる範囲も2倍になる。
  const doubled = mapMark(text, ([x, y]) => [x * 2, y * 2]);
  expect(hitMark(doubled, [235, 200], { ...view, scale: 2 })).toBe(true);
  expect(hitMark(doubled, [235, 200], view)).toBe(false);
});

test('重なった書き込みは、上に描くものに当たる。黒塗りはいつも一番下に描く', () => {
  const frame: Mark = {
    ...common,
    id: 1,
    kind: 'rect',
    rect: { x: 0, y: 0, width: 100, height: 100 },
  };
  const arrow: Mark = { ...common, id: 2, kind: 'arrow', from: [0, 50], to: [60, 50] };
  const redact: Mark = {
    ...common,
    id: 3,
    kind: 'redact',
    rect: { x: 0, y: 40, width: 30, height: 20 },
  };
  const options = { ...view, map: (point: Point) => point };
  expect(markAt([frame, arrow, redact], [1, 50], options)).toBe(arrow);
  expect(markAt([frame, arrow, redact], [20, 45], options)).toBe(arrow);
  expect(markAt([frame, arrow, redact], [25, 62], options)).toBe(redact);
  // 中が塗られた書き込みを飛ばすと、その上から別の書き込みを描ける（何にも当たらない）。
  expect(
    markAt([frame, redact], [20, 50], { ...options, accept: (mark) => mark.kind !== 'redact' }),
  ).toBeUndefined();
  expect(markAt([frame, redact], [20, 50], options)).toBe(redact);
  expect(markAt([frame, arrow, redact], [70, 80], options)).toBeUndefined();
});

test('重ねる順は、黒塗り・蛍光ペン・ほかの書き込み（描いた順）', () => {
  const marks: Mark[] = [
    { ...common, id: 1, kind: 'arrow', from: [0, 0], to: [1, 1] },
    { ...common, id: 2, kind: 'highlight', rect: { x: 0, y: 0, width: 1, height: 1 } },
    { ...common, id: 3, kind: 'redact', rect: { x: 0, y: 0, width: 1, height: 1 } },
    { ...common, id: 4, kind: 'text', at: [0, 0], text: 'a' },
  ];
  expect(paintOrder(marks).map((mark) => mark.id)).toEqual([3, 2, 1, 4]);
});

test('番号は描いた順に振り、途中を消すと詰め直す', () => {
  const marks: Mark[] = [
    { ...common, id: 10, kind: 'number', at: [0, 0] },
    { ...common, id: 11, kind: 'arrow', from: [0, 0], to: [1, 1] },
    { ...common, id: 12, kind: 'number', at: [0, 0] },
    { ...common, id: 13, kind: 'number', at: [0, 0] },
  ];
  expect([...numberLabels(marks)]).toEqual([
    [10, 1],
    [12, 2],
    [13, 3],
  ]);
  expect([...numberLabels(marks.filter((mark) => mark.id !== 12))]).toEqual([
    [10, 1],
    [13, 2],
  ]);
});

test('黒塗りの範囲は画素の境目まで外側へ広げ、画像の外の範囲や、ほかの書き込みは変えない', () => {
  const source = { width: 10, height: 10 };
  const redact: Mark = {
    ...common,
    id: 1,
    kind: 'redact',
    rect: { x: 1.2, y: 2.7, width: 3.1, height: 4 },
  };
  expect(settleRedaction(redact, source)).toMatchObject({
    rect: { x: 1, y: 2, width: 4, height: 5 },
  });
  const outside: Mark = { ...redact, rect: { x: 20, y: 20, width: 5, height: 5 } };
  expect(settleRedaction(outside, source)).toBe(outside);
  const frame: Mark = { ...redact, kind: 'rect' };
  expect(settleRedaction(frame, source)).toBe(frame);
});

test('縮小表示で黒塗りを繰り返し移動して確定しても、幅と高さを変えない', () => {
  const source = { width: 2000, height: 1000 };
  let mark: Mark = {
    ...common,
    id: 1,
    kind: 'redact',
    rect: { x: 100, y: 100, width: 100, height: 50 },
  };
  // 表示倍率 0.3 で、画面の 1 px ずつ右下へ動かす。
  for (let i = 0; i < 20; i++)
    mark = settleRedaction(moveMark(mark, 1 / 0.3, 1 / 0.3), source);
  expect(mark).toMatchObject({ rect: { x: 160, y: 160, width: 100, height: 50 } });
  for (let i = 0; i < 20; i++)
    mark = settleRedaction(moveMark(mark, -1 / 0.3, -1 / 0.3), source);
  expect(mark).toMatchObject({ rect: { x: 100, y: 100, width: 100, height: 50 } });

  // ほかの書き込みは小数の座標のまま動かす。
  expect(moveMark({ ...mark, kind: 'rect' } as Mark, 0.25, -0.5)).toMatchObject({
    rect: { x: 100.25, y: 99.5, width: 100, height: 50 },
  });
});

test('回した画像の座標に移しても、枠は長方形のまま。動かすと全部の点が同じだけ動く', () => {
  const size = { width: 40, height: 30 };
  const frame: Mark = {
    ...common,
    id: 1,
    kind: 'rect',
    rect: { x: 0, y: 0, width: 40, height: 5 },
  };
  expect(mapMark(frame, (point) => rotatePoint(point, size, 90))).toMatchObject({
    rect: { x: 25, y: 0, width: 5, height: 40 },
  });
  const arrow: Mark = { ...common, id: 2, kind: 'arrow', from: [1, 2], to: [3, 4] };
  expect(moveMark(arrow, 10, -1)).toMatchObject({ from: [11, 1], to: [13, 3] });
});

test('文字の塊は一番長い行の幅と行数の高さで、空でも幅を持つ', () => {
  const text = { ...common, id: 1, kind: 'text' as const, at: [0, 0] as Point, text: 'ab\n\nabcd' };
  const size = textSize(text, measure);
  expect(size.width).toBeCloseTo(4 * 24 * 0.6);
  expect(size.height).toBeCloseTo(3 * 24 * 1.3);
  expect(textSize({ ...text, text: '' }, measure).width).toBeCloseTo(12);
});

test('角をつかんで大きさを変えるとき、反対の角を動かさない', () => {
  const rect = { x: 10, y: 20, width: 30, height: 40 };
  expect(oppositeCorner(rect, 'nw')).toEqual([40, 60]);
  expect(oppositeCorner(rect, 'ne')).toEqual([10, 60]);
  expect(oppositeCorner(rect, 'sw')).toEqual([40, 20]);
  expect(oppositeCorner(rect, 'se')).toEqual([10, 20]);
});
