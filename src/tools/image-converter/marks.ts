// 書き込み（矢印・四角と丸の枠・文字・番号・蛍光ペン・黒塗り）の形と、選ぶ・動かすための計算。
// 位置は切り抜きと同じく、向きを直した元の画像の画素の座標で持つ。描く（paint.ts）・選ぶときは、
// 画面や保存する画像の座標に移してから計算する。文字と番号は、画像を回しても立てたまま描く。
import {
  between,
  corners,
  editedSize,
  pixelRect,
  type Edits,
  type Point,
  type Rect,
  type Size,
} from './geometry';

export type MarkColor = 'red' | 'yellow' | 'green' | 'blue' | 'black' | 'white';
/** 線の太さ・文字と番号の大きさの段階。 */
export type MarkSize = 's' | 'm' | 'l';

interface Common {
  id: number;
  color: MarkColor;
  size: MarkSize;
  /**
   * 太さ・大きさの基準の長さ（描いたときの、切り抜き・回転した画像の長い辺。元の画像の画素）。
   * 画像の大きさに合わせた太さにし、あとで切り抜いたり縮めたりしても見た目の割合を変えない。
   */
  unit: number;
}
export interface ArrowMark extends Common {
  kind: 'arrow';
  from: Point;
  /** 矢じりの先。 */
  to: Point;
}
export interface BoxMark extends Common {
  kind: 'rect' | 'ellipse' | 'highlight' | 'redact';
  rect: Rect;
}
export interface TextMark extends Common {
  kind: 'text';
  /** 文字の塊の中心。回転しても、ここを中心に立てたまま描く。 */
  at: Point;
  /** 改行で複数行にできる。 */
  text: string;
}
export interface NumberMark extends Common {
  kind: 'number';
  /** 丸の中心。番号は描いた順に 1, 2, 3… と振る（消すと詰め直す）。 */
  at: Point;
}
export type Mark = ArrowMark | BoxMark | TextMark | NumberMark;
export type MarkKind = Mark['kind'];

/** 書き込みの色。画面の配色（ライト・ダーク）に関係なく、画像に描く色そのもの。light は明るい色（縁取りを暗くする）。 */
export const MARK_COLORS: Record<MarkColor, { label: string; value: string; light: boolean }> = {
  red: { label: '赤', value: '#e8352e', light: false },
  yellow: { label: '黄', value: '#ffd21f', light: true },
  green: { label: '緑', value: '#1f9d48', light: false },
  blue: { label: '青', value: '#2474dc', light: false },
  black: { label: '黒', value: '#1d1d1d', light: false },
  white: { label: '白', value: '#ffffff', light: true },
};

/** 基準の長さ（unit）に対する割合。 */
const RATIOS = {
  stroke: { s: 0.0025, m: 0.004, l: 0.0065 },
  text: { s: 0.017, m: 0.024, l: 0.036 },
  badge: { s: 0.011, m: 0.015, l: 0.021 },
} satisfies Record<string, Record<MarkSize, number>>;

/** 線の太さ（元の画像の画素）。 */
export const strokeWidth = (mark: Mark) => Math.max(2, mark.unit * RATIOS.stroke[mark.size]);
/** 文字の大きさ（元の画像の画素）。 */
export const fontSize = (mark: Mark) => Math.max(12, mark.unit * RATIOS.text[mark.size]);
/** 番号の丸の半径（元の画像の画素）。 */
export const badgeRadius = (mark: Mark) => Math.max(9, mark.unit * RATIOS.badge[mark.size]);
/** 文字の行の高さ（文字の大きさに対する倍率）。 */
export const LINE_HEIGHT = 1.3;

/** 新しい書き込みの基準の長さ：今の切り抜き・回転した画像の長い辺。 */
export function markUnit(source: Size, edits: Edits) {
  const size = editedSize(source, edits);
  return Math.max(size.width, size.height);
}

/** 1行の幅を測る関数（大きさ size の文字で）。Canvas で測る（paint.ts の measureLine）。 */
export type Measure = (line: string, size: number) => number;

/** 文字の塊の大きさ（元の画像の画素）。空の行も1行に数える。 */
export function textSize(mark: TextMark, measure: Measure): Size {
  const size = fontSize(mark);
  const lines = mark.text.split('\n');
  return {
    width: Math.max(size * 0.5, ...lines.map((line) => measure(line, size))),
    height: lines.length * size * LINE_HEIGHT,
  };
}

/** 番号の書き込みに振る番号（描いた順）。 */
export function numberLabels(marks: readonly Mark[]): Map<number, number> {
  const labels = new Map<number, number>();
  for (const mark of marks) if (mark.kind === 'number') labels.set(mark.id, labels.size + 1);
  return labels;
}

/**
 * 重ねる順。黒塗りは画像そのものに塗るため一番下、蛍光ペンはその上で、下の文字が透けるように色を掛け合わせる。
 * ほかの書き込みは描いた順に重ねる。
 */
export function paintOrder(marks: readonly Mark[]): Mark[] {
  const rank = (mark: Mark) => (mark.kind === 'redact' ? 0 : mark.kind === 'highlight' ? 1 : 2);
  return [...marks].sort((a, b) => rank(a) - rank(b));
}

/** 黒塗りの範囲。保存する画像では、縮める前の元の画像に塗る（convert.ts）。 */
export const redactions = (marks: readonly Mark[]): Rect[] =>
  marks.flatMap((mark) => (mark.kind === 'redact' ? [mark.rect] : []));

/** 書き込みの点をすべて map で移す。長方形は移した2つの角を対角にする（90度単位の回転なら長方形のまま）。 */
export function mapMark(mark: Mark, map: (point: Point) => Point): Mark {
  switch (mark.kind) {
    case 'arrow':
      return { ...mark, from: map(mark.from), to: map(mark.to) };
    case 'text':
    case 'number':
      return { ...mark, at: map(mark.at) };
    default: {
      const [a, b] = corners(mark.rect);
      return { ...mark, rect: between(map(a), map(b)) };
    }
  }
}

export const moveMark = (mark: Mark, dx: number, dy: number) =>
  mapMark(mark, ([x, y]) => [x + dx, y + dy]);

/**
 * 黒塗りの範囲を、画素の境目まで外側へ広げて画像の中に収める。範囲にかかる画素の元の色を、縁に混ぜて残さないため。
 * 画像の外へ出た範囲はそのまま残す（塗る画素がない）。
 */
export function settleRedaction(mark: Mark, source: Size): Mark {
  if (mark.kind !== 'redact') return mark;
  const rect = pixelRect(mark.rect, source, 1);
  return rect ? { ...mark, rect } : mark;
}

/**
 * 根元が細く、先に返しの付いた矢じりがある矢印の形（多角形の頂点）。width は線の太さで、矢じりはその数倍。
 * 短い矢印では矢じりを長さに合わせて小さくする。
 */
export function arrowShape(from: Point, to: Point, width: number): Point[] {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (!length) return [];
  const [ux, uy] = [(x2 - x1) / length, (y2 - y1) / length];
  const [nx, ny] = [-uy, ux];
  const head = Math.min(length * 0.6, width * 4.6);
  const wing = head * 0.58;
  const neck = Math.min(width * 0.62, wing * 0.5);
  const tail = width * 0.16;
  const at = (along: number, side: number): Point => [
    x2 - ux * along + nx * side,
    y2 - uy * along + ny * side,
  ];
  return [
    at(length, tail),
    at(head * 0.8, neck),
    at(head * 1.05, wing),
    [x2, y2],
    at(head * 1.05, -wing),
    at(head * 0.8, -neck),
    at(length, -tail),
  ];
}

/** 点から線分への距離。 */
export function segmentDistance([px, py]: Point, [x1, y1]: Point, [x2, y2]: Point) {
  const [dx, dy] = [x2 - x1, y2 - y1];
  const squared = dx * dx + dy * dy;
  const t = squared ? Math.min(1, Math.max(0, ((px - x1) * dx + (py - y1) * dy) / squared)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

const inside = ([px, py]: Point, rect: Rect, margin: number) =>
  px >= rect.x - margin &&
  px <= rect.x + rect.width + margin &&
  py >= rect.y - margin &&
  py <= rect.y + rect.height + margin;

/** 文字の塊・番号の丸を囲む長方形（mark は表示の座標に移したもの。scale はその倍率）。 */
export function markBounds(mark: TextMark | NumberMark, scale: number, measure: Measure): Rect {
  const [cx, cy] = mark.at;
  if (mark.kind === 'number') {
    const radius = badgeRadius(mark) * scale;
    return { x: cx - radius, y: cy - radius, width: radius * 2, height: radius * 2 };
  }
  const size = textSize(mark, measure);
  const [width, height] = [size.width * scale, size.height * scale];
  return { x: cx - width / 2, y: cy - height / 2, width, height };
}

/**
 * point が書き込みに当たっているか。mark は表示の座標に移したもので、scale はその倍率、tolerance は当たりの余裕（表示の px）。
 * 枠は線の上だけで当たり、内側で別の書き込みを描けるようにする。
 */
export function hitMark(
  mark: Mark,
  point: Point,
  { scale, tolerance, measure }: { scale: number; tolerance: number; measure: Measure },
): boolean {
  switch (mark.kind) {
    case 'arrow':
      return (
        segmentDistance(point, mark.from, mark.to) <= tolerance + strokeWidth(mark) * scale * 1.6
      );
    case 'number': {
      const radius = badgeRadius(mark) * scale;
      return Math.hypot(point[0] - mark.at[0], point[1] - mark.at[1]) <= radius + tolerance;
    }
    case 'text':
      return inside(point, markBounds(mark, scale, measure), tolerance);
    case 'highlight':
    case 'redact':
      return inside(point, mark.rect, tolerance);
    case 'rect': {
      const half = (strokeWidth(mark) * scale) / 2 + tolerance;
      const { x, y, width, height } = mark.rect;
      const inner = {
        x: x + half,
        y: y + half,
        width: width - half * 2,
        height: height - half * 2,
      };
      return (
        inside(point, mark.rect, half) &&
        (inner.width <= 0 || inner.height <= 0 || !inside(point, inner, 0))
      );
    }
    case 'ellipse': {
      const half = (strokeWidth(mark) * scale) / 2 + tolerance;
      const [rx, ry] = [mark.rect.width / 2, mark.rect.height / 2];
      const [cx, cy] = [mark.rect.x + rx, mark.rect.y + ry];
      if (rx <= half || ry <= half) return inside(point, mark.rect, half);
      // 楕円の線までのおおよその距離（中心からの正規化した距離と 1 の差に、短い方の半径を掛ける）。
      const distance = Math.hypot((point[0] - cx) / rx, (point[1] - cy) / ry);
      return Math.abs(distance - 1) * Math.min(rx, ry) <= half;
    }
  }
}

/**
 * point に当たる一番上の書き込み。marks は元の画像の座標のまま渡し、map で表示の座標に移して調べる。
 * accept が偽の書き込みは飛ばす。
 */
export function markAt(
  marks: readonly Mark[],
  point: Point,
  options: {
    map: (point: Point) => Point;
    scale: number;
    tolerance: number;
    measure: Measure;
    accept?: (mark: Mark) => boolean;
  },
): Mark | undefined {
  const order = paintOrder(marks);
  for (let index = order.length - 1; index >= 0; index--) {
    const mark = order[index]!;
    if (options.accept && !options.accept(mark)) continue;
    if (hitMark(mapMark(mark, options.map), point, options)) return mark;
  }
  return undefined;
}

/** 大きさを変えるためにつかむ点。矢印は両端、枠・蛍光ペン・黒塗りは四隅。文字と番号は大きさの段階で変える。 */
export type Handle = 'from' | 'to' | 'nw' | 'ne' | 'sw' | 'se';

/** つかむ点の位置（mark は表示の座標に移したもの）。 */
export function handlesOf(mark: Mark): [Handle, Point][] {
  if (mark.kind === 'arrow')
    return [
      ['from', mark.from],
      ['to', mark.to],
    ];
  if (mark.kind === 'text' || mark.kind === 'number') return [];
  return rectHandles(mark.rect);
}

export function rectHandles({ x, y, width, height }: Rect): [Handle, Point][] {
  return [
    ['nw', [x, y]],
    ['ne', [x + width, y]],
    ['sw', [x, y + height]],
    ['se', [x + width, y + height]],
  ];
}

/** 角をつかんで大きさを変えるとき、動かさない反対の角。 */
export function oppositeCorner({ x, y, width, height }: Rect, handle: Handle): Point {
  const right = x + width;
  const bottom = y + height;
  switch (handle) {
    case 'nw':
      return [right, bottom];
    case 'ne':
      return [x, bottom];
    case 'sw':
      return [right, y];
    default:
      return [x, y];
  }
}
