// 書き込みを Canvas に描く。保存する画像（convert.ts）と編集の画面（editor.tsx）が同じ描き方を使い、見たとおりに保存する。
// 位置は map で描く先の座標に移し、太さ・大きさは scale 倍にして、縮めた後の画素に直接描く（線と文字をぼかさない）。
import type { Point } from './geometry';
import {
  arrowShape,
  badgeRadius,
  fontSize,
  LINE_HEIGHT,
  mapMark,
  MARK_COLORS,
  numberLabels,
  paintOrder,
  strokeWidth,
  textSize,
  type Mark,
} from './marks';

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** 書き込みの文字の書体。OS に入っている日本語の書体を太字で使う。 */
export const MARK_FONT =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic UI", "Yu Gothic", Meiryo, sans-serif';
const font = (size: number) => `700 ${size}px ${MARK_FONT}`;
/** 明るい色の書き込みの縁取り・番号の文字の色。 */
const DARK = '#1d1d1d';

let measurer: OffscreenCanvasRenderingContext2D | null = null;
/** 1行の幅（大きさ size の文字で）。 */
export function measureLine(line: string, size: number) {
  measurer ??= new OffscreenCanvas(1, 1).getContext('2d');
  if (!measurer) return line.length * size;
  measurer.font = font(size);
  return measurer.measureText(line).width;
}

export interface PaintOptions {
  /** 元の画像の点を、描く先の点にする。 */
  map: (point: Point) => Point;
  /** 元の画像の 1 px が、描く先の何 px か。 */
  scale: number;
  /** 描くかどうか。省略するとすべて描く。 */
  filter?: (mark: Mark) => boolean;
}

/** 書き込みを重ねる順（paintOrder）に描く。番号は全体の中の順で振るため、filter で外したものも数える。 */
export function paintMarks(context: Context, marks: readonly Mark[], options: PaintOptions) {
  const labels = numberLabels(marks);
  for (const mark of paintOrder(marks)) {
    if (options.filter && !options.filter(mark)) continue;
    context.save();
    paint(context, mapMark(mark, options.map), options.scale, labels.get(mark.id) ?? 0);
    context.restore();
  }
}

/** 浮いて見える控えめな影。白い背景のスクリーンショットでも、書き込みが画面の一部に見えないようにする。 */
function shadow(context: Context, size: number) {
  context.shadowColor = 'rgba(0, 0, 0, 0.3)';
  context.shadowBlur = Math.max(2, size);
  context.shadowOffsetY = size * 0.25;
}

function paint(context: Context, mark: Mark, scale: number, label: number) {
  const color = MARK_COLORS[mark.color];
  switch (mark.kind) {
    case 'arrow': {
      const width = strokeWidth(mark) * scale;
      const shape = arrowShape(mark.from, mark.to, width);
      if (!shape.length) return;
      shadow(context, width);
      context.fillStyle = color.value;
      context.beginPath();
      for (const [index, [x, y]] of shape.entries())
        if (index) context.lineTo(x, y);
        else context.moveTo(x, y);
      context.closePath();
      context.fill();
      return;
    }
    case 'rect':
    case 'ellipse': {
      const width = strokeWidth(mark) * scale;
      const { x, y, width: w, height: h } = mark.rect;
      shadow(context, width);
      context.strokeStyle = color.value;
      context.lineWidth = width;
      context.lineJoin = 'round';
      context.beginPath();
      if (mark.kind === 'rect') context.roundRect(x, y, w, h, Math.min(width * 0.8, w / 2, h / 2));
      else context.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      context.stroke();
      return;
    }
    case 'highlight': {
      // 色を掛け合わせ、下の文字は黒いまま読めるようにする。
      context.globalCompositeOperation = 'multiply';
      context.globalAlpha = 0.5;
      context.fillStyle = color.value;
      context.fillRect(mark.rect.x, mark.rect.y, mark.rect.width, mark.rect.height);
      return;
    }
    case 'redact': {
      context.fillStyle = '#000';
      context.fillRect(mark.rect.x, mark.rect.y, mark.rect.width, mark.rect.height);
      return;
    }
    case 'number': {
      const radius = badgeRadius(mark) * scale;
      const [cx, cy] = mark.at;
      const ink = color.light ? DARK : '#fff';
      shadow(context, radius * 0.25);
      context.fillStyle = color.value;
      context.beginPath();
      context.arc(cx, cy, radius, 0, Math.PI * 2);
      context.fill();
      context.shadowColor = 'transparent';
      context.lineWidth = radius * 0.14;
      context.strokeStyle = ink;
      context.stroke();
      const text = String(label);
      context.font = font(radius * (text.length > 1 ? 1 : 1.2));
      context.textAlign = 'center';
      context.textBaseline = 'alphabetic';
      context.fillStyle = ink;
      // 数字の見た目の上下の中心を、丸の中心にそろえる。
      const metrics = context.measureText(text);
      context.fillText(
        text,
        cx,
        cy + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2,
      );
      return;
    }
    case 'text': {
      const size = fontSize(mark) * scale;
      const box = textSize(mark, measureLine);
      const left = mark.at[0] - (box.width * scale) / 2;
      const top = mark.at[1] - (box.height * scale) / 2;
      context.font = font(size);
      context.textAlign = 'left';
      context.textBaseline = 'middle';
      context.lineJoin = 'round';
      // 縁取りを付け、どんな背景の上でも読めるようにする。
      context.lineWidth = size * 0.22;
      context.strokeStyle = color.light ? DARK : '#fff';
      context.fillStyle = color.value;
      for (const [index, line] of mark.text.split('\n').entries()) {
        const y = top + size * LINE_HEIGHT * (index + 0.5);
        context.strokeText(line, left, y);
        context.fillText(line, left, y);
      }
      return;
    }
  }
}
