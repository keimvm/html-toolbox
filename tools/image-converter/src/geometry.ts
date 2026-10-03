/** 時計回りの回転（度）。 */
export type Rotation = 0 | 90 | 180 | 270;
export interface Size {
  width: number;
  height: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
type Point = [x: number, y: number];

/** 切り抜き・塗りつぶしは、向きを直した元の画像の画素の座標で持つ。回転は最後に当てる。 */
export interface Edits {
  rotation: Rotation;
  crop: Rect | null;
  redactions: Rect[];
}

export const noEdits = (): Edits => ({
  rotation: 0,
  crop: null,
  redactions: [],
});

export const turn = (rotation: Rotation, quarter: 1 | -1) =>
  ((rotation + quarter * 90 + 360) % 360) as Rotation;

export const rotatedSize = (size: Size, rotation: Rotation): Size =>
  rotation % 180 ? { width: size.height, height: size.width } : { ...size };

/** 元の画像（size）の点を、回転した画像の点にする。 */
export function rotatePoint(
  [x, y]: Point,
  size: Size,
  rotation: Rotation,
): Point {
  switch (rotation) {
    case 90:
      return [size.height - y, x];
    case 180:
      return [size.width - x, size.height - y];
    case 270:
      return [y, size.width - x];
    default:
      return [x, y];
  }
}

/** 回転した画像の点を、元の画像（size）の点に戻す。 */
export function unrotatePoint(
  [x, y]: Point,
  size: Size,
  rotation: Rotation,
): Point {
  switch (rotation) {
    case 90:
      return [y, size.height - x];
    case 180:
      return [size.width - x, size.height - y];
    case 270:
      return [size.width - y, x];
    default:
      return [x, y];
  }
}

/** 2点を対角とする長方形。 */
export function between([x1, y1]: Point, [x2, y2]: Point): Rect {
  const x = Math.min(x1, x2),
    y = Math.min(y1, y2);
  return { x, y, width: Math.abs(x2 - x1), height: Math.abs(y2 - y1) };
}

const corners = (rect: Rect): [Point, Point] => [
  [rect.x, rect.y],
  [rect.x + rect.width, rect.y + rect.height],
];

export function rotateRect(rect: Rect, size: Size, rotation: Rotation) {
  const [a, b] = corners(rect);
  return between(
    rotatePoint(a, size, rotation),
    rotatePoint(b, size, rotation),
  );
}

export function unrotateRect(rect: Rect, size: Size, rotation: Rotation) {
  const [a, b] = corners(rect);
  return between(
    unrotatePoint(a, size, rotation),
    unrotatePoint(b, size, rotation),
  );
}

/**
 * 画素の境目に合わせて外側へ広げ、画像の中に収める。
 * 塗りつぶしでは、範囲にかかる画素を残さないよう外側へ丸める。小さすぎる範囲は null。
 */
export function pixelRect(rect: Rect, bounds: Size, minimum = 2): Rect | null {
  const left = Math.max(0, Math.floor(rect.x));
  const top = Math.max(0, Math.floor(rect.y));
  const right = Math.min(bounds.width, Math.ceil(rect.x + rect.width));
  const bottom = Math.min(bounds.height, Math.ceil(rect.y + rect.height));
  if (right - left < minimum || bottom - top < minimum) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** 切り抜き・回転した後の大きさ。 */
export function editedSize(source: Size, edits: Edits): Size {
  return rotatedSize(edits.crop ?? source, edits.rotation);
}

/** 長い辺を longSide 以下に縮めた大きさ。拡大はしない。 */
export function fitLongSide(size: Size, longSide: number | null): Size {
  const long = Math.max(size.width, size.height);
  if (!longSide || long <= longSide) return { ...size };
  const scale = longSide / long;
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/** 画素数を maxPixels 以下に収めた大きさ。 */
export function fitPixels(size: Size, maxPixels: number): Size {
  const scale = Math.min(1, Math.sqrt(maxPixels / (size.width * size.height)));
  if (scale >= 1) return { ...size };
  return {
    width: Math.max(1, Math.floor(size.width * scale)),
    height: Math.max(1, Math.floor(size.height * scale)),
  };
}
