import { fitQuality, preferPng } from './fit';
import { editedPoint, editedSize, fitLongSide, type Edits, type Size } from './geometry';
import { redactions } from './marks';
import { paintMarks } from './paint';
import { MAX_QUALITY, mimeType, type Effective, type Format } from './settings';

/** 一覧の見本の長い辺。 */
const THUMBNAIL_SIDE = 360;

export interface Converted {
  blob: Blob;
  width: number;
  height: number;
  format: Format;
  /** 形式を自動で選んだか（設定が「自動」で、画質を手で決めていない）。 */
  auto: boolean;
  /** JPEG の画質（1〜100）。PNG は null。 */
  quality: number | null;
  /** 上限以下に収まったか。上限がなければ null。 */
  fits: boolean | null;
  thumbnail: Blob;
}

/** 向きを直して読む。HEIC などブラウザーが開けない形式は失敗する。 */
export function decode(file: Blob) {
  return createImageBitmap(file, { imageOrientation: 'from-image' });
}

function context2d(canvas: OffscreenCanvas) {
  const context = canvas.getContext('2d');
  if (!context) throw new Error('画像を作成できません。');
  context.imageSmoothingQuality = 'high';
  return context;
}

/**
 * 黒塗り → 切り抜き → 回転 → 縮小の順に描き、最後に縮めた大きさのまま書き込みを描く。
 * 黒塗りは元の大きさで塗ってから縮めるため、範囲の元の画素は結果に混ざらない。
 * 書き込みは縮めた後の画素に描くため、線と文字がぼけない。
 * background を指定すると、透過部分をその色で埋める（JPEG 用）。
 */
export function drawEdited(
  source: ImageBitmap,
  edits: Edits,
  target: Size,
  background: string | null,
): OffscreenCanvas {
  const full = { width: source.width, height: source.height };
  const crop = edits.crop ?? { x: 0, y: 0, ...full };
  const hidden = redactions(edits.marks);
  let image: CanvasImageSource = source;
  let from = crop;
  if (hidden.length) {
    const layer = new OffscreenCanvas(crop.width, crop.height);
    const context = context2d(layer);
    context.drawImage(source, -crop.x, -crop.y);
    context.fillStyle = '#000';
    for (const rect of hidden)
      context.fillRect(rect.x - crop.x, rect.y - crop.y, rect.width, rect.height);
    image = layer;
    from = { x: 0, y: 0, width: crop.width, height: crop.height };
  }
  const canvas = new OffscreenCanvas(target.width, target.height);
  const context = context2d(canvas);
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, target.width, target.height);
  }
  const [width, height] =
    edits.rotation % 180 ? [target.height, target.width] : [target.width, target.height];
  context.save();
  context.translate(target.width / 2, target.height / 2);
  context.rotate((edits.rotation * Math.PI) / 180);
  context.drawImage(
    image,
    from.x,
    from.y,
    from.width,
    from.height,
    -width / 2,
    -height / 2,
    width,
    height,
  );
  context.restore();
  if (edits.marks.length) {
    const edited = editedSize(full, edits);
    const [sx, sy] = [target.width / edited.width, target.height / edited.height];
    paintMarks(context, edits.marks, {
      map: (point) => {
        const [x, y] = editedPoint(point, full, edits);
        return [x * sx, y * sy];
      },
      scale: sx,
      // 黒塗りは上で、縮める前に塗った。
      filter: (mark) => mark.kind !== 'redact',
    });
  }
  return canvas;
}

/** 透過部分を白で埋めた写し（JPEG 用）。 */
function onWhite(image: OffscreenCanvas) {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = context2d(canvas);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, image.width, image.height);
  context.drawImage(image, 0, 0);
  return canvas;
}

/** 画像を全体・個別の設定で変換する。書き出しの前後に checkStale() を呼び、古くなった変換はそこで例外にして中断する。 */
export async function convert(
  source: ImageBitmap,
  edits: Edits,
  settings: Effective,
  checkStale: () => void,
): Promise<Converted> {
  const size = fitLongSide(
    editedSize({ width: source.width, height: source.height }, edits),
    settings.longSide,
  );
  const canvas = drawEdited(source, edits, size, null);
  let white: OffscreenCanvas | null = null;
  /** 同じ形式・画質の書き出しは一度だけにする。 */
  const encoded = new Map<string, Blob>();
  const encode = async (format: Format, quality?: number) => {
    const key = `${format}:${quality ?? ''}`;
    const known = encoded.get(key);
    if (known) return known;
    checkStale();
    const target = format === 'jpeg' ? (white ??= onWhite(canvas)) : canvas;
    const blob = await target.convertToBlob({
      type: mimeType(format),
      quality: quality === undefined ? undefined : quality / 100,
    });
    checkStale();
    encoded.set(key, blob);
    return blob;
  };
  const fits = (blob: Blob) => (settings.limit === null ? null : blob.size <= settings.limit);
  const png = async () => {
    const blob = await encode('png');
    return { blob, format: 'png' as const, quality: null, fits: fits(blob) };
  };
  const jpeg = async () => {
    if (settings.quality === null)
      return {
        ...(await fitQuality((quality) => encode('jpeg', quality), settings.limit)),
        format: 'jpeg' as const,
      };
    const blob = await encode('jpeg', settings.quality);
    return { blob, format: 'jpeg' as const, quality: settings.quality, fits: fits(blob) };
  };
  const auto = settings.format === 'auto' && settings.quality === null;
  let result: Pick<Converted, 'blob' | 'format' | 'quality' | 'fits'>;
  if (settings.format === 'png') result = await png();
  else if (!auto) result = await jpeg();
  else {
    const lossless = await png();
    const best = await encode('jpeg', MAX_QUALITY);
    result = preferPng(lossless.blob.size, best.size, settings.limit) ? lossless : await jpeg();
  }
  const small = fitLongSide(size, THUMBNAIL_SIDE);
  const thumbnail = new OffscreenCanvas(small.width, small.height);
  context2d(thumbnail).drawImage(
    result.format === 'jpeg' ? (white ?? onWhite(canvas)) : canvas,
    0,
    0,
    small.width,
    small.height,
  );
  return {
    ...result,
    auto,
    width: size.width,
    height: size.height,
    thumbnail: await thumbnail.convertToBlob({
      type: mimeType(result.format),
      quality: 0.85,
    }),
  };
}

/**
 * 保存する画像と同じ大きさ・編集で、劣化のない PNG を作る（クリップボードへのコピー用。Chrome・Edge が書き込める画像は PNG だけ）。
 * 描くのは呼んだ時点で済ませ、source をすぐ閉じてよい。
 */
export function renderPng(source: ImageBitmap, edits: Edits, size: Size): Promise<Blob> {
  return drawEdited(source, edits, size, null).convertToBlob({ type: 'image/png' });
}
