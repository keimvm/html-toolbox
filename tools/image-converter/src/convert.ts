import { fitQuality } from './fit';
import { editedSize, fitLongSide, type Edits, type Size } from './geometry';
import { mimeType, type Effective, type Format } from './settings';

/** 一覧の見本の長い辺。 */
const THUMBNAIL_SIDE = 360;

export interface Converted {
  blob: Blob;
  width: number;
  height: number;
  format: Format;
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
 * 塗りつぶし → 切り抜き → 回転 → 縮小の順に描く。
 * 塗りつぶしは元の大きさで描いてから縮めるため、範囲の元の画素は結果に混ざらない。
 * background を指定すると、透過部分をその色で埋める（JPEG 用）。
 */
export function drawEdited(
  source: ImageBitmap,
  edits: Edits,
  target: Size,
  background: string | null,
): OffscreenCanvas {
  const crop = edits.crop ?? {
    x: 0,
    y: 0,
    width: source.width,
    height: source.height,
  };
  let image: CanvasImageSource = source;
  let from = crop;
  if (edits.redactions.length) {
    const layer = new OffscreenCanvas(crop.width, crop.height);
    const context = context2d(layer);
    context.drawImage(source, -crop.x, -crop.y);
    context.fillStyle = '#000';
    for (const rect of edits.redactions)
      context.fillRect(
        rect.x - crop.x,
        rect.y - crop.y,
        rect.width,
        rect.height,
      );
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
    edits.rotation % 180
      ? [target.height, target.width]
      : [target.width, target.height];
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
  const jpeg = settings.format === 'jpeg';
  const canvas = drawEdited(source, edits, size, jpeg ? '#fff' : null);
  const encode = async (quality?: number) => {
    checkStale();
    const blob = await canvas.convertToBlob({
      type: mimeType(settings.format),
      quality: quality === undefined ? undefined : quality / 100,
    });
    checkStale();
    return blob;
  };
  let result: Pick<Converted, 'blob' | 'quality' | 'fits'>;
  if (!jpeg) {
    const blob = await encode();
    result = {
      blob,
      quality: null,
      fits: settings.limit === null ? null : blob.size <= settings.limit,
    };
  } else if (settings.quality !== null) {
    const blob = await encode(settings.quality);
    result = {
      blob,
      quality: settings.quality,
      fits: settings.limit === null ? null : blob.size <= settings.limit,
    };
  } else result = await fitQuality(encode, settings.limit);
  const small = fitLongSide(size, THUMBNAIL_SIDE);
  const thumbnail = new OffscreenCanvas(small.width, small.height);
  context2d(thumbnail).drawImage(canvas, 0, 0, small.width, small.height);
  return {
    ...result,
    width: size.width,
    height: size.height,
    format: settings.format,
    thumbnail: await thumbnail.convertToBlob({
      type: mimeType(settings.format),
      quality: 0.85,
    }),
  };
}
