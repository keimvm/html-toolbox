// 1枚の画像の編集と仕上がり。中央に画像を大きく出し、回転・切り抜きと書き込み（矢印・枠・文字・番号・蛍光ペン・黒塗り）を
// 画像の上で直接行う。「見比べる」では左に元の画像、右に保存する画像を並べ、拡大したときは同じ場所を見せる。
// 右のパネル（ItemPanel）に、この画像の容量・形式とコピー・保存、この画像だけの設定を置く。
// キャンバスと見比べの画像の大きさ・スクロールは直接書き換え、道具・つまみ・文言は Preact で描く。
import { computed, signal } from '@preact/signals';
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { copyImage } from '../../lib/clipboard';
import { formatBytes } from '../../lib/format';
import { hasMod, isMac, modKey } from '../../lib/platform';
import { Button, IconButton, Segmented, toast } from '../../ui/components';
import { Icon, type IconName } from '../../ui/icons';
import { decode, drawEdited, renderPng } from './convert';
import {
  between,
  editedPoint,
  editedSize,
  fitLongSide,
  fitPixels,
  formatRatio,
  moveRect,
  noEdits,
  pixelRect,
  resizeRect,
  rotatedSize,
  rotateRect,
  snapAngle,
  sourcePoint,
  squarePoint,
  turn,
  unrotateRect,
  viewTransform,
  type Edits,
  type Point,
  type Rect,
  type Size,
  type ViewTransform,
} from './geometry';
import { redo, remember, sameEdits, snapshot, undo } from './history';
import { isPending, type Item, type Items } from './items';
import {
  fontSize,
  handlesOf,
  LINE_HEIGHT,
  mapMark,
  markAt,
  markBounds,
  markUnit,
  MARK_COLORS,
  moveMark,
  oppositeCorner,
  rectHandles,
  settleRedaction,
  textSize,
  type Handle,
  type Mark,
  type MarkColor,
  type MarkKind,
  type MarkSize,
  type TextMark,
} from './marks';
import { MARK_FONT, measureLine, paintMarks } from './paint';
import {
  effective,
  FORMAT_LABELS,
  MAX_QUALITY,
  parseLongSide,
  type FormatChoice,
} from './settings';

/** 画面に描く画素数の上限。 */
const MAX_VIEW_PIXELS = 32_000_000;
/** 書き込みを重ねて描くキャンバス（2枚）の、それぞれの画素数の上限。 */
const MAX_OVERLAY_PIXELS = 8_000_000;
/** 画面の端から画像までの余白（CSS px）。 */
const STAGE_PADDING = 22;
/** 書き込みに当たったとみなす余裕（CSS px）。 */
const HIT_TOLERANCE = 6;
/** これより小さく囲んだ・引いたものは、書き込みにしない（CSS px）。 */
const MIN_DRAG = 4;

type Tool = 'select' | 'crop' | MarkKind;
type Mode = 'edit' | 'compare';
type Zoom = 'fit' | '1' | '2';

const TOOLS: { id: Tool; label: string; icon: IconName; key: string; hint: string }[] = [
  {
    id: 'select',
    label: '選ぶ',
    icon: 'cursor',
    key: 'V',
    hint: 'クリックで書き込みを選び、ドラッグで動かします。四隅・両端の丸をドラッグすると大きさが変わります。Delete で消します。',
  },
  {
    id: 'crop',
    label: '切り抜く',
    icon: 'crop',
    key: 'C',
    hint: 'ドラッグで残す範囲を囲みます（Shift で正方形）。四隅の丸で大きさ、内側のドラッグで位置を変えます。矢印キーで 1 px ずつ動かし、Shift＋矢印キーで幅・高さを変えます。',
  },
  {
    id: 'arrow',
    label: '矢印',
    icon: 'arrow-mark',
    key: 'A',
    hint: 'ドラッグで矢印を引きます。離したところが矢じりの先です。Shift で 45° ずつ。',
  },
  {
    id: 'rect',
    label: '四角で囲む',
    icon: 'square',
    key: 'R',
    hint: 'ドラッグで四角い枠を描きます。Shift で正方形。',
  },
  {
    id: 'ellipse',
    label: '丸で囲む',
    icon: 'circle',
    key: 'O',
    hint: 'ドラッグで丸い枠を描きます。Shift で正円。',
  },
  {
    id: 'text',
    label: '文字',
    icon: 'type',
    key: 'T',
    hint: 'クリックした場所に文字を書きます。Enter で改行、Esc か外側のクリックで確定します。書いた文字はクリック（ほかの道具ではダブルクリック）で直せます。',
  },
  {
    id: 'number',
    label: '番号',
    icon: 'number',
    key: 'N',
    hint: 'クリックするたびに 1, 2, 3… と番号を置きます。途中の番号を消すと、後ろの番号を詰めます。',
  },
  {
    id: 'highlight',
    label: '蛍光ペン',
    icon: 'highlighter',
    key: 'H',
    hint: 'ドラッグで囲んだ範囲に色を重ねます。下の文字は透けて読めます。',
  },
  {
    id: 'redact',
    label: '黒で隠す',
    icon: 'redact',
    key: 'B',
    hint: 'ドラッグで囲んだ範囲を黒く塗りつぶします。保存する画像には、塗りつぶした部分の元の画素は残りません。',
  },
];
const COMPARE_HINT =
  '左が元の画像、右が保存する画像です。100%・200% ではドラッグで表示する場所を動かせ、左右は同じ場所を見せます。';

/** 中が塗られた書き込み。上から別の書き込みを描けるよう、「選ぶ」か同じ道具のときだけつかめる。 */
const FILLED = new Set<MarkKind>(['highlight', 'redact']);
/** 色を選べない道具。 */
const COLORLESS = new Set<Tool>(['select', 'crop', 'redact']);
/** 太さ・大きさを選べない道具。 */
const SIZELESS = new Set<Tool>(['select', 'crop', 'redact', 'highlight']);
const SIZES: { value: MarkSize; label: string }[] = [
  { value: 's', label: '小' },
  { value: 'm', label: '中' },
  { value: 'l', label: '大' },
];

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/** 押している間の操作。点は画面（画像の枠の左上が原点の CSS px）、切り抜きは回転だけを当てた画像の画素で持つ。 */
type Drag =
  | { kind: 'draw'; id: number; start: Point; before: Edits }
  | { kind: 'move'; id: number; start: Point; origin: Mark; before: Edits }
  | { kind: 'handle'; id: number; handle: Handle; fixed: Point; before: Edits }
  | { kind: 'text'; start: Point }
  | { kind: 'crop-new'; start: Point; before: Edits }
  | { kind: 'crop-move'; origin: Rect; start: Point; before: Edits }
  | { kind: 'crop-handle'; fixed: Point; before: Edits };

/** 書いている途中の文字。left・top は文字の塊の左上（画面の px）。 */
interface Writing {
  id: number;
  text: string;
  left: number;
  top: number;
  before: Edits;
}

function show(canvas: HTMLCanvasElement, image: OffscreenCanvas) {
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('bitmaprenderer')?.transferFromImageBitmap(image.transferToImageBitmap());
}

/** 欄の中央が、画像のどこに当たるか（画像の幅・高さに対する割合）。 */
function centerOf(scroller: HTMLElement, image: DOMRect): [number, number] {
  const box = scroller.getBoundingClientRect();
  return [
    (box.left + scroller.clientLeft + scroller.clientWidth / 2 - image.left) / image.width,
    (box.top + scroller.clientTop + scroller.clientHeight / 2 - image.top) / image.height,
  ];
}

const boxStyle = ({ x, y, width, height }: Rect): JSX.CSSProperties => ({
  left: `${x}px`,
  top: `${y}px`,
  width: `${width}px`,
  height: `${height}px`,
});

const scaleRect = ({ x, y, width, height }: Rect, by: number): Rect => ({
  x: x * by,
  y: y * by,
  width: width * by,
  height: height * by,
});

const insideRect = ([x, y]: Point, rect: Rect) =>
  x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;

export function createEditor(store: Items, { onSave }: { onSave: (item: Item) => void }) {
  const current = signal<Item | null>(null);
  const tool = signal<Tool>('select');
  const mode = signal<Mode>('edit');
  const zoom = signal<Zoom>('fit');
  /** 選んでいる書き込みの id。 */
  const selected = signal<number | null>(null);
  /** 次に描く書き込みの色・大きさ。蛍光ペンの色は別に覚える。 */
  const style = signal<{ color: MarkColor; size: MarkSize; highlight: MarkColor }>({
    color: 'red',
    size: 'm',
    highlight: 'yellow',
  });
  const writing = signal<Writing | null>(null);
  /** 確定前の文字も、終了すると失う作業として追跡する。 */
  const pendingText = computed(() => {
    const state = writing.value;
    if (!state) return false;
    const original = state.before.marks.find((mark) => mark.id === state.id);
    return state.text.replace(/\s+$/u, '') !== (original?.kind === 'text' ? original.text : '');
  });
  /** 元の画像を読み込んだ・読み込めなかったら増やす。 */
  const loaded = signal(0);
  /** 書き込み・切り抜きの範囲を描き直したら増やす（つまみと範囲の枠を置き直す）。 */
  const tick = signal(0);
  /** 入力中の長い辺・画質（確定するまで設定に書かない）。 */
  const longDraft = signal<string | null>(null);
  const qualityDraft = signal<number | null>(null);
  /** 開いている画像を読み込んだもの。編集・見比べの画面に描く。 */
  let bitmap: ImageBitmap | null = null;
  let failed = false;
  /** 編集の画面の倍率（CSS px / 元の画像の画素）。0 は表示していない。 */
  let scale = 0;
  let drag: Drag | null = null;
  /**
   * 描いている・動かしている・書いている途中の書き込みと、囲んでいる途中の切り抜き（元の画像の画素）。
   * 確定するまで item.edits に入れず、同時に進む変換が途中の形を保存する画像に使わないようにする。
   */
  let draft: Mark | null = null;
  let cropDraft: Rect | null = null;
  let sequence = 0;
  let qualityTimer = 0;
  /** 見比べで、ドラッグで表示する場所を動かしている欄と、直前のポインターの位置。 */
  let panning: { scroller: HTMLDivElement; at: Point } | null = null;
  let centerNext = false;
  let baseKey = '';
  let beforeDrawn = false;
  /** 見比べで、自分で動かした欄のスクロール位置。この位置への scroll では、もう片方を動かさない。 */
  const moved = new WeakMap<HTMLElement, [number, number]>();
  /** 見比べで表示している保存する画像。変わったときだけ URL を作り直す。 */
  let shown: { blob: Blob; url: string } | null = null;
  const el: {
    stage?: HTMLDivElement | null;
    frame?: HTMLDivElement | null;
    base?: HTMLCanvasElement | null;
    tint?: HTMLCanvasElement | null;
    ink?: HTMLCanvasElement | null;
    beforeScroll?: HTMLDivElement | null;
    afterScroll?: HTMLDivElement | null;
    before?: HTMLCanvasElement | null;
    after?: HTMLImageElement | null;
  } = {};

  const sourceSize = (): Size | null =>
    bitmap ? { width: bitmap.width, height: bitmap.height } : null;
  const cropping = () => tool.value === 'crop';

  /** 今の編集の画面の座標。表示していなければ null。 */
  function space(): ViewTransform | null {
    const item = current.value;
    const source = sourceSize();
    if (!item || !source || !scale) return null;
    return viewTransform(source, item.edits, { crop: cropping(), scale });
  }

  /** 書き込み（途中のものがあればそちら）。 */
  function markById(id: number | null) {
    if (id === null) return undefined;
    if (draft?.id === id) return draft;
    return current.value?.edits.marks.find((mark) => mark.id === id);
  }

  /** 画面に描く書き込み：確定した書き込みに、途中の書き込みを差し替えて（新しければ足して）並べる。 */
  function shownMarks(): Mark[] {
    const marks = current.value?.edits.marks ?? [];
    const next = draft;
    if (!next) return marks;
    return marks.some((mark) => mark.id === next.id)
      ? marks.map((mark) => (mark.id === next.id ? next : mark))
      : [...marks, next];
  }

  /** 途中の書き込みを確定して item.edits に入れる。 */
  function settleDraft() {
    const item = current.value;
    const next = draft;
    draft = null;
    if (!item || !next) return;
    const index = item.edits.marks.findIndex((mark) => mark.id === next.id);
    if (index < 0) item.edits.marks.push(next);
    else item.edits.marks[index] = next;
  }

  // ── 描く ──

  /** 画像の枠を、画面に収まる大きさにする（拡大はしない）。 */
  function layoutEdit() {
    const item = current.value;
    const source = sourceSize();
    const { stage, frame } = el;
    scale = 0;
    if (!item || !source || !stage || !frame || mode.value !== 'edit') return;
    const size = cropping()
      ? rotatedSize(source, item.edits.rotation)
      : editedSize(source, item.edits);
    const room = {
      width: stage.clientWidth - STAGE_PADDING * 2,
      height: stage.clientHeight - STAGE_PADDING * 2,
    };
    if (room.width <= 0 || room.height <= 0) return;
    scale = Math.min(1, room.width / size.width, room.height / size.height);
    frame.style.width = `${size.width * scale}px`;
    frame.style.height = `${size.height * scale}px`;
  }

  /** 画像そのもの（回転と、切り抜く道具以外では切り抜き）を描く。書き込みは重ねたキャンバスに描く。 */
  function renderBase() {
    const item = current.value;
    const view = space();
    const canvas = el.base;
    if (!item || !bitmap || !view || !canvas) return;
    const pixels = fitPixels(
      {
        width: Math.max(
          1,
          Math.min(view.size.width, Math.round(view.size.width * scale * devicePixelRatio)),
        ),
        height: Math.max(
          1,
          Math.min(view.size.height, Math.round(view.size.height * scale * devicePixelRatio)),
        ),
      },
      MAX_VIEW_PIXELS,
    );
    const crop = cropping() ? null : item.edits.crop;
    const key = JSON.stringify([item.id, item.edits.rotation, crop, pixels]);
    if (key === baseKey) return;
    baseKey = key;
    show(
      canvas,
      drawEdited(bitmap, { rotation: item.edits.rotation, crop, marks: [] }, pixels, null),
    );
  }

  /**
   * 書き込みを、画像に重ねた2枚のキャンバスに描く。蛍光ペンは下の1枚に描き、CSS で画像と色を掛け合わせる
   * （保存する画像で色を掛け合わせて描くのと同じ見た目）。黒塗りもここに描く（保存する画像では元の画像に塗る）。
   */
  function renderMarks() {
    const item = current.value;
    const view = space();
    const { tint, ink } = el;
    if (!item || !view || !tint || !ink) return;
    const css = { width: view.size.width * scale, height: view.size.height * scale };
    const ratio = Math.min(
      devicePixelRatio,
      Math.sqrt(MAX_OVERLAY_PIXELS / Math.max(1, css.width * css.height)),
    );
    const width = Math.max(1, Math.round(css.width * ratio));
    const height = Math.max(1, Math.round(css.height * ratio));
    const skip = writing.value?.id;
    const options = {
      map: (point: Point): Point => {
        const [x, y] = view.toView(point);
        return [x * ratio, y * ratio];
      },
      scale: scale * ratio,
    };
    for (const [canvas, highlight] of [
      [tint, true],
      [ink, false],
    ] as const) {
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      const context = canvas.getContext('2d');
      if (!context) continue;
      context.clearRect(0, 0, width, height);
      paintMarks(context, shownMarks(), {
        ...options,
        filter: (mark) => mark.id !== skip && (mark.kind === 'highlight') === highlight,
      });
    }
    tick.value++;
  }

  /** 見比べで、保存する画像の大きさ。変換が済むまでは設定から求める。 */
  function compareSize(): Size | null {
    const item = current.value;
    const source = sourceSize();
    if (!item || !source) return null;
    if (item.result) return { width: item.result.width, height: item.result.height };
    return fitLongSide(
      editedSize(source, item.edits),
      effective(store.settings.value, item.overrides).longSide,
    );
  }

  function clearAfter() {
    if (shown) URL.revokeObjectURL(shown.url);
    shown = null;
    el.after?.removeAttribute('src');
  }

  /**
   * 見比べの画面。左に元の画像（切り抜き・回転・書き込みの前のまま）、右に保存する画像を並べる。
   * 100%・200% は保存する画像の画素が基準。元の画像は保存する画像と同じ割合で縮めた大きさで出し、同じ部分が左右で同じ大きさに見えるようにする。
   * 全体では、それぞれを欄に収める。
   */
  function layoutCompare() {
    const item = current.value;
    const source = sourceSize();
    const size = compareSize();
    const { beforeScroll, afterScroll, before, after } = el;
    if (mode.value !== 'compare' || !item || !bitmap || !source || !size) return;
    if (!beforeScroll || !afterScroll || !before || !after) return;
    const blob = item.result?.blob;
    if (blob && blob !== shown?.blob) {
      const previous = shown;
      shown = { blob, url: URL.createObjectURL(blob) };
      after.src = shown.url;
      if (previous) URL.revokeObjectURL(previous.url);
    }
    if (!beforeDrawn) {
      beforeDrawn = true;
      show(before, drawEdited(bitmap, noEdits(), fitPixels(source, MAX_VIEW_PIXELS), null));
    }
    const ratio = size.width / editedSize(source, item.edits).width;
    const original = { width: source.width * ratio, height: source.height * ratio };
    for (const [view, scroller, shownSize] of [
      [before, beforeScroll, original],
      [after, afterScroll, size],
    ] as const) {
      const fit = Math.min(
        1,
        (scroller.clientWidth - STAGE_PADDING * 2) / shownSize.width,
        (scroller.clientHeight - STAGE_PADDING * 2) / shownSize.height,
      );
      const by = zoom.value === 'fit' ? fit : Number(zoom.value);
      view.style.width = `${Math.max(1, shownSize.width * by)}px`;
      view.style.height = `${Math.max(1, shownSize.height * by)}px`;
    }
    if (centerNext) {
      centerNext = false;
      afterScroll.scrollLeft = (afterScroll.scrollWidth - afterScroll.clientWidth) / 2;
      afterScroll.scrollTop = (afterScroll.scrollHeight - afterScroll.clientHeight) / 2;
    }
    follow(afterScroll, beforeScroll);
  }

  /** 見比べで、欄の中央に見えている点を、もう片方の欄でも中央に表示する。切り抜き・回転の分は座標を変換して合わせる。 */
  function follow(from: HTMLElement | null | undefined, to: HTMLElement | null | undefined) {
    const item = current.value;
    const source = sourceSize();
    const { before, after } = el;
    if (!item || !source || !from || !to || !before || !after) return;
    const viewOf = (scroller: HTMLElement) => (scroller === el.beforeScroll ? before : after);
    const fromImage = viewOf(from).getBoundingClientRect();
    const toImage = viewOf(to).getBoundingClientRect();
    if (!fromImage.width || !fromImage.height || !toImage.width || !toImage.height) return;
    const edited = editedSize(source, item.edits);
    const fromBefore = from === el.beforeScroll;
    const [fromSize, toSize] = fromBefore ? [source, edited] : [edited, source];
    const [fx, fy] = centerOf(from, fromImage);
    const point: Point = [fx * fromSize.width, fy * fromSize.height];
    const [x, y] = fromBefore
      ? editedPoint(point, source, item.edits)
      : sourcePoint(point, source, item.edits);
    const [cx, cy] = centerOf(to, toImage);
    const previous = [to.scrollLeft, to.scrollTop];
    to.scrollBy((x / toSize.width - cx) * toImage.width, (y / toSize.height - cy) * toImage.height);
    if (previous[0] !== to.scrollLeft || previous[1] !== to.scrollTop)
      moved.set(to, [to.scrollLeft, to.scrollTop]);
  }

  function refresh() {
    if (mode.value === 'edit') {
      layoutEdit();
      renderBase();
      renderMarks();
    } else layoutCompare();
  }

  // ── 変える ──

  /** 変えた編集を確かめ、変わっていれば取り消しの分に積んで変換し直す。 */
  function commit(before: Edits) {
    const item = current.value;
    const source = sourceSize();
    if (!item || !source) return;
    item.edits.marks = item.edits.marks.map((mark) => settleRedaction(mark, source));
    if (!sameEdits(before, item.edits)) {
      remember(item.history, before);
      store.schedule(item);
    }
    refresh();
  }

  /** ボタン・キーでの一度の変更。 */
  function change(update: (edits: Edits) => void) {
    const item = current.value;
    if (!item) return;
    finishText();
    const before = snapshot(item.edits);
    update(item.edits);
    commit(before);
  }

  function updateMark(id: number, update: (mark: Mark) => Mark) {
    change((edits) => {
      const index = edits.marks.findIndex((mark) => mark.id === id);
      if (index >= 0) edits.marks[index] = update(edits.marks[index]!);
    });
  }

  function restore(edits: Edits | null) {
    const item = current.value;
    if (!item || !edits) return;
    draft = null;
    cropDraft = null;
    item.edits = edits;
    if (!markById(selected.value)) selected.value = null;
    store.schedule(item);
    refresh();
  }

  function undoEdit() {
    finishText();
    const item = current.value;
    if (item) restore(undo(item.history, item.edits));
  }

  function redoEdit() {
    finishText();
    const item = current.value;
    if (item) restore(redo(item.history, item.edits));
  }

  function setTool(next: Tool) {
    finishText();
    if (next !== 'select') selected.value = null;
    tool.value = next;
    mode.value = 'edit';
  }

  function setMode(next: Mode) {
    finishText();
    if (next === 'compare' && zoom.value !== 'fit') centerNext = true;
    mode.value = next;
  }

  function setColor(color: MarkColor) {
    const chosen = markById(selected.value);
    const kind = chosen?.kind ?? tool.value;
    style.value =
      kind === 'highlight' ? { ...style.value, highlight: color } : { ...style.value, color };
    if (chosen && chosen.kind !== 'redact') updateMark(chosen.id, (mark) => ({ ...mark, color }));
  }

  function setSize(size: MarkSize) {
    const chosen = markById(selected.value);
    style.value = { ...style.value, size };
    if (chosen && !FILLED.has(chosen.kind)) updateMark(chosen.id, (mark) => ({ ...mark, size }));
  }

  function deleteSelected() {
    const id = selected.value;
    if (id === null) return;
    selected.value = null;
    change((edits) => {
      edits.marks = edits.marks.filter((mark) => mark.id !== id);
    });
  }

  function newMark(kind: MarkKind, at: Point): Mark {
    const item = current.value!;
    const common = {
      id: ++sequence,
      color:
        kind === 'highlight'
          ? style.value.highlight
          : kind === 'redact'
            ? 'black'
            : style.value.color,
      size: style.value.size,
      unit: markUnit(sourceSize()!, item.edits),
    } as const;
    switch (kind) {
      case 'arrow':
        return { ...common, kind, from: at, to: at };
      case 'text':
        return { ...common, kind, at, text: '' };
      case 'number':
        return { ...common, kind, at };
      default:
        return { ...common, kind, rect: { x: at[0], y: at[1], width: 0, height: 0 } };
    }
  }

  // ── 文字 ──

  function startNewText(point: Point) {
    const item = current.value;
    const view = space();
    if (!item || !view) return;
    const before = snapshot(item.edits);
    const mark = newMark('text', view.fromView(point));
    draft = mark;
    // クリックした点が、1行目の高さの真ん中に来るようにする。
    const line = fontSize(mark) * scale * LINE_HEIGHT;
    selected.value = mark.id;
    writing.value = { id: mark.id, text: '', left: point[0], top: point[1] - line / 2, before };
    renderMarks();
  }

  function startEdit(mark: TextMark) {
    const item = current.value;
    const view = space();
    if (!item || !view) return;
    finishText();
    const bounds = markBounds(mapMark(mark, view.toView) as TextMark, scale, measureLine);
    draft = { ...mark };
    selected.value = mark.id;
    writing.value = {
      id: mark.id,
      text: mark.text,
      left: bounds.x,
      top: bounds.y,
      before: snapshot(item.edits),
    };
    renderMarks();
  }

  /** 書いている文字を確定する。左上を動かさずに、文字の塊の中心を求め直す。空なら消す。 */
  function finishText() {
    const state = writing.value;
    if (!state) return;
    writing.value = null;
    const item = current.value;
    const view = space();
    const mark = markById(state.id);
    draft = null;
    if (item && view && mark?.kind === 'text') {
      const text = mark.text.replace(/\s+$/u, '');
      if (!text.trim()) {
        item.edits.marks = item.edits.marks.filter((other) => other.id !== mark.id);
        if (selected.value === mark.id) selected.value = null;
      } else if (
        !item.edits.marks.some(
          (other) => other.kind === 'text' && other.id === mark.id && other.text === text,
        )
      ) {
        // 文字を変えたときだけ置き直す（変えていなければ、行き来の誤差で位置をずらさない）。
        const size = textSize({ ...mark, text }, measureLine);
        draft = {
          ...mark,
          text,
          at: view.fromView([
            state.left + (size.width * scale) / 2,
            state.top + (size.height * scale) / 2,
          ]),
        };
        settleDraft();
      }
    }
    commit(state.before);
  }

  // ── 切り抜き（回転だけを当てた画像の画素で扱う） ──

  function cropRect(): Rect | null {
    const item = current.value;
    const source = sourceSize();
    const crop = cropDraft ?? item?.edits.crop;
    if (!item || !crop || !source) return null;
    return rotateRect(crop, source, item.edits.rotation);
  }

  /** 回転した画像の上の範囲を、元の画像の画素の切り抜きにする。小さすぎる範囲では変えない。 */
  function setCrop(rect: Rect) {
    const item = current.value;
    const source = sourceSize();
    if (!item || !source) return;
    const area = pixelRect(unrotateRect(rect, source, item.edits.rotation), source, 4);
    if (area) cropDraft = area;
  }

  function startCrop(point: Point, handle: Handle | undefined, before: Edits) {
    const at: Point = [point[0] / scale, point[1] / scale];
    const rect = cropRect();
    if (handle && rect) drag = { kind: 'crop-handle', fixed: oppositeCorner(rect, handle), before };
    else if (rect && insideRect(at, rect))
      drag = { kind: 'crop-move', origin: rect, start: at, before };
    else drag = { kind: 'crop-new', start: at, before };
  }

  function dragCrop(state: Drag, point: Point, square: boolean) {
    const source = sourceSize();
    const item = current.value;
    if (!source || !item) return;
    const at: Point = [point[0] / scale, point[1] / scale];
    if (state.kind === 'crop-new')
      setCrop(between(state.start, square ? squarePoint(state.start, at) : at));
    else if (state.kind === 'crop-handle')
      setCrop(between(state.fixed, square ? squarePoint(state.fixed, at) : at));
    else if (state.kind === 'crop-move')
      setCrop(
        moveRect(
          state.origin,
          rotatedSize(source, item.edits.rotation),
          Math.round(at[0] - state.start[0]),
          Math.round(at[1] - state.start[1]),
        ),
      );
    tick.value++;
  }

  /** 矢印キーで切り抜きの範囲を 1 px ずつ動かす。Shift を押しながらなら幅・高さを変える。 */
  function nudgeCrop(step: [number, number], resize: boolean) {
    const source = sourceSize();
    const item = current.value;
    const crop = item?.edits.crop;
    if (!item || !crop || !source) return;
    const rotation = item.edits.rotation;
    const full = rotatedSize(source, rotation);
    const rect = rotateRect(crop, source, rotation);
    const next = resize ? resizeRect(rect, full, ...step) : moveRect(rect, full, ...step);
    change((edits) => (edits.crop = unrotateRect(next, source, rotation)));
  }

  // ── ポインター ──

  function pointOf(event: MouseEvent): Point {
    const box = el.frame!.getBoundingClientRect();
    const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
    return [clamp(event.clientX - box.left, box.width), clamp(event.clientY - box.top, box.height)];
  }

  function hitAt(point: Point): Mark | undefined {
    const item = current.value;
    const view = space();
    if (!item || !view) return undefined;
    return markAt(item.edits.marks, point, {
      map: view.toView,
      scale,
      tolerance: HIT_TOLERANCE,
      measure: measureLine,
      accept: (mark) =>
        mark.id !== writing.value?.id &&
        (!FILLED.has(mark.kind) || tool.value === 'select' || tool.value === mark.kind),
    });
  }

  function tooSmall(mark: Mark, view: ViewTransform) {
    const shown = mapMark(mark, view.toView);
    if (shown.kind === 'arrow')
      return Math.hypot(shown.to[0] - shown.from[0], shown.to[1] - shown.from[1]) < MIN_DRAG * 2;
    if (shown.kind === 'text' || shown.kind === 'number') return false;
    return shown.rect.width < MIN_DRAG || shown.rect.height < MIN_DRAG;
  }

  function onPointerDown(event: PointerEvent) {
    const item = current.value;
    const view = space();
    const frame = el.frame;
    if (event.button !== 0 || !item || !view || !frame || !bitmap) return;
    const target = event.target as Element;
    if (target.closest('.ic-text-input')) return;
    event.preventDefault();
    if (writing.value) {
      // 外側をクリックしたら、書いている文字を確定するだけにする。
      finishText();
      frame.focus({ preventScroll: true });
      return;
    }
    // 囲んだあとの矢印キー・Delete が、設定の入力欄ではなく画像に効くようにする。
    frame.focus({ preventScroll: true });
    frame.setPointerCapture(event.pointerId);
    const point = pointOf(event);
    const before = snapshot(item.edits);
    const handle = target.closest<HTMLElement>('[data-handle]')?.dataset.handle as
      Handle | undefined;
    const kind = tool.value;
    if (kind === 'crop') {
      startCrop(point, handle, before);
      return;
    }
    const chosen = markById(selected.value);
    if (handle && chosen) {
      const shown = mapMark(chosen, view.toView);
      const fixed: Point =
        shown.kind === 'arrow'
          ? handle === 'from'
            ? shown.to
            : shown.from
          : shown.kind === 'text' || shown.kind === 'number'
            ? shown.at
            : oppositeCorner(shown.rect, handle);
      drag = { kind: 'handle', id: chosen.id, handle, fixed, before };
      return;
    }
    const hit = hitAt(point);
    if (hit) {
      selected.value = hit.id;
      drag = { kind: 'move', id: hit.id, start: point, origin: hit, before };
      return;
    }
    selected.value = null;
    if (kind === 'select') return;
    if (kind === 'text') {
      drag = { kind: 'text', start: point };
      return;
    }
    const mark = newMark(kind, view.fromView(point));
    draft = mark;
    if (kind === 'number') {
      // 置いたまま、離すまで動かして位置を決められる。
      selected.value = mark.id;
      drag = { kind: 'move', id: mark.id, start: point, origin: mark, before };
    } else drag = { kind: 'draw', id: mark.id, start: point, before };
    renderMarks();
  }

  /** 押していないときは、つかめるものの上でカーソルを変える。 */
  function hover(point: Point, target: Element) {
    const frame = el.frame;
    if (!frame) return;
    // つまみ・文字の欄は CSS のカーソルにする。空にすると、道具ごとのカーソル（CSS）に戻る。
    let movable = false;
    if (!target.closest('[data-handle], .ic-text-input')) {
      const rect = cropping() ? cropRect() : null;
      movable = cropping()
        ? Boolean(rect && insideRect([point[0] / scale, point[1] / scale], rect))
        : Boolean(hitAt(point));
    }
    frame.style.cursor = movable ? 'move' : '';
  }

  function onPointerMove(event: PointerEvent) {
    const state = drag;
    const view = space();
    if (!view || !el.frame) return;
    const point = pointOf(event);
    if (!state) {
      hover(point, event.target as Element);
      return;
    }
    const mark = 'id' in state ? markById(state.id) : undefined;
    switch (state.kind) {
      case 'draw':
        if (mark?.kind === 'arrow')
          draft = {
            ...mark,
            to: view.fromView(event.shiftKey ? snapAngle(state.start, point) : point),
          };
        else if (mark && mark.kind !== 'text' && mark.kind !== 'number')
          draft = {
            ...mark,
            rect: between(
              view.fromView(state.start),
              view.fromView(event.shiftKey ? squarePoint(state.start, point) : point),
            ),
          };
        renderMarks();
        return;
      case 'move': {
        if (!mark) return;
        // 開始位置からの移動量を使い、黒塗りの丸めによる誤差をイベントごとに積み重ねない。
        const [a, b] = [view.fromView(state.start), view.fromView(point)];
        draft = moveMark(state.origin, b[0] - a[0], b[1] - a[1]);
        renderMarks();
        return;
      }
      case 'handle':
        if (mark?.kind === 'arrow') {
          const end = view.fromView(event.shiftKey ? snapAngle(state.fixed, point) : point);
          draft = state.handle === 'from' ? { ...mark, from: end } : { ...mark, to: end };
        } else if (mark && mark.kind !== 'text' && mark.kind !== 'number')
          draft = {
            ...mark,
            rect: between(
              view.fromView(state.fixed),
              view.fromView(event.shiftKey ? squarePoint(state.fixed, point) : point),
            ),
          };
        renderMarks();
        return;
      case 'text':
        return;
      default:
        dragCrop(state, point, event.shiftKey);
    }
  }

  function onPointerUp(event: PointerEvent) {
    const state = drag;
    drag = null;
    const view = space();
    if (!state) return;
    if (!view) {
      draft = null;
      cropDraft = null;
      return;
    }
    if (state.kind === 'text') {
      const point = pointOf(event);
      if (Math.hypot(point[0] - state.start[0], point[1] - state.start[1]) < MIN_DRAG)
        startNewText(state.start);
      return;
    }
    if (state.kind === 'draw') {
      const mark = markById(state.id);
      if (!mark || tooSmall(mark, view)) {
        draft = null;
        renderMarks();
        return;
      }
      selected.value = state.id;
    }
    settleDraft();
    const item = current.value;
    if (item && cropDraft) item.edits.crop = cropDraft;
    cropDraft = null;
    commit(state.before);
    // 文字の道具で、書いた文字をクリックしたら（動かさなければ）書き直す。
    if (state.kind === 'move' && tool.value === 'text') {
      const point = pointOf(event);
      const mark = markById(state.id);
      if (
        mark?.kind === 'text' &&
        Math.hypot(point[0] - state.start[0], point[1] - state.start[1]) < MIN_DRAG
      )
        startEdit(mark);
    }
  }

  function onPointerCancel() {
    drag = null;
    // 途中の形を捨てる（item.edits は離すまで書き換えていない）。
    draft = null;
    cropDraft = null;
    if (!markById(selected.value)) selected.value = null;
    refresh();
  }

  function onDoubleClick(event: MouseEvent) {
    if (cropping() || writing.value || !space()) return;
    const hit = hitAt(pointOf(event));
    if (hit?.kind === 'text') startEdit(hit);
  }

  // 見比べ：拡大したときの表示の移動。動かした欄に、もう片方の欄を合わせる。

  function onCompareScroll(event: Event) {
    const from = event.currentTarget as HTMLDivElement;
    const own = moved.get(from);
    moved.delete(from);
    if (own?.[0] === from.scrollLeft && own[1] === from.scrollTop) return;
    follow(from, from === el.beforeScroll ? el.afterScroll : el.beforeScroll);
  }

  function onComparePointerDown(event: PointerEvent) {
    const scroller = event.currentTarget as HTMLDivElement;
    // 指では、標準のスクロールに任せる。
    if (event.button !== 0 || event.pointerType === 'touch') return;
    // スクロールバーの上では、標準のスクロールに任せる。
    const area = scroller.getBoundingClientRect();
    if (
      event.clientX - area.left > scroller.clientWidth ||
      event.clientY - area.top > scroller.clientHeight
    )
      return;
    if (
      scroller.scrollWidth <= scroller.clientWidth &&
      scroller.scrollHeight <= scroller.clientHeight
    )
      return;
    event.preventDefault();
    scroller.setPointerCapture(event.pointerId);
    panning = { scroller, at: [event.clientX, event.clientY] };
  }

  function onComparePointerMove(event: PointerEvent) {
    if (!panning) return;
    panning.scroller.scrollBy(panning.at[0] - event.clientX, panning.at[1] - event.clientY);
    panning.at = [event.clientX, event.clientY];
  }

  function onComparePointerUp() {
    panning = null;
  }

  // ── キー ──

  /** 画面全体のキー操作（index.tsx が、入力欄・ダイアログでないときに渡す）。 */
  function handleKey(event: KeyboardEvent) {
    const item = current.value;
    if (!item) return;
    const field = (event.target as Element | null)?.closest?.('input, select, textarea');
    const toggle =
      field instanceof HTMLInputElement && (field.type === 'radio' || field.type === 'checkbox');
    if (field && !toggle) return;
    if (hasMod(event) && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'z' || (key === 'y' && !isMac)) {
        event.preventDefault();
        if (key === 'y' || event.shiftKey) redoEdit();
        else undoEdit();
      } else if (key === 'c' && !event.shiftKey && (getSelection()?.isCollapsed ?? true)) {
        event.preventDefault();
        void copy();
      } else if (key === 's' && !event.shiftKey) {
        event.preventDefault();
        onSave(item);
      }
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Escape') {
      if (selected.value !== null) selected.value = null;
      else if (mode.value === 'compare') setMode('edit');
      else if (tool.value !== 'select') setTool('select');
      return;
    }
    const step = ARROWS[event.key];
    if (step) {
      // 切り替えのラジオでは、矢印キー本来の操作（選択肢の移動）を優先する。
      if (field || mode.value !== 'edit' || drag) return;
      const chosen = markById(selected.value);
      const shown = space();
      if (cropping() && item.edits.crop) {
        event.preventDefault();
        nudgeCrop(step, event.shiftKey);
      } else if (chosen && shown) {
        event.preventDefault();
        // 画面の 1 px（Shift で 10 px）ずつ動かす。
        const amount = event.shiftKey ? 10 : 1;
        const [a, b] = [
          shown.fromView([0, 0]),
          shown.fromView([step[0] * amount, step[1] * amount]),
        ];
        updateMark(chosen.id, (mark) => moveMark(mark, b[0] - a[0], b[1] - a[1]));
      }
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (mode.value !== 'edit') return;
      if (selected.value !== null) {
        event.preventDefault();
        deleteSelected();
      } else if (cropping() && item.edits.crop) {
        event.preventDefault();
        change((edits) => (edits.crop = null));
      }
      return;
    }
    const found = TOOLS.find((info) => info.key === event.key.toUpperCase());
    if (found && !event.repeat) {
      event.preventDefault();
      setTool(found.id);
    }
  }

  // ── 開く・コピー ──

  /** 画像を開く。null で閉じる。 */
  async function open(item: Item | null) {
    if (current.value === item) return;
    finishText();
    drag = null;
    draft = null;
    cropDraft = null;
    selected.value = null;
    clearTimeout(qualityTimer);
    longDraft.value = null;
    qualityDraft.value = null;
    bitmap?.close();
    bitmap = null;
    failed = false;
    baseKey = '';
    beforeDrawn = false;
    clearAfter();
    for (const canvas of [el.base, el.tint, el.ink, el.before])
      if (canvas) canvas.width = canvas.height = 0;
    current.value = item;
    store.setCurrent(item);
    loaded.value++;
    if (!item) return;
    const image = await decode(item.file).catch(() => null);
    if (current.value !== item) {
      image?.close();
      return;
    }
    bitmap = image;
    failed = !image;
    loaded.value++;
  }

  /** 保存する画像をクリップボードにコピーする。JPEG で保存する画像も、同じ大きさの劣化のない PNG にしてコピーする。 */
  async function copy() {
    const item = current.value;
    const result = item?.result;
    if (!item || !result || isPending(item) || item.error) {
      toast('変換が終わってからコピーしてください。');
      return;
    }
    finishText();
    const png =
      result.format === 'png'
        ? result.blob
        : bitmap
          ? renderPng(bitmap, item.edits, result)
          : decode(item.file).then((image) => {
              try {
                return renderPng(image, item.edits, result);
              } finally {
                image.close();
              }
            });
    const copied = await copyImage(png);
    toast(
      copied
        ? 'コピーしました。メールやチャット、資料に貼り付けられます。'
        : 'コピーできませんでした。「保存」でファイルにしてください。',
      { tone: copied ? 'success' : 'error' },
    );
  }

  // ── 画面 ──

  function Toolbar() {
    void store.revision.value;
    const item = current.value;
    const chosen = markById(selected.value);
    const kind = chosen?.kind ?? tool.value;
    const colorable = chosen ? chosen.kind !== 'redact' : !COLORLESS.has(tool.value);
    const sizable = chosen ? !FILLED.has(chosen.kind) : !SIZELESS.has(tool.value);
    const color =
      chosen?.color ?? (kind === 'highlight' ? style.value.highlight : style.value.color);
    const size = chosen?.size ?? style.value.size;
    const editing = mode.value === 'edit';
    return (
      <div class="ic-toolbar" role="toolbar" aria-label="画像の編集">
        {editing ? (
          <>
            <div class="ic-tool-group" role="group" aria-label="道具">
              {TOOLS.map((info) => (
                <IconButton
                  key={info.id}
                  icon={info.icon}
                  label={`${info.label}（${info.key}）`}
                  aria-pressed={tool.value === info.id}
                  aria-keyshortcuts={info.key}
                  class="ic-tool"
                  onClick={() => setTool(info.id)}
                />
              ))}
            </div>
            <span class="ic-tool-divider" aria-hidden="true" />
            <div class="ic-tool-group" role="group" aria-label="色">
              {(Object.keys(MARK_COLORS) as MarkColor[]).map((key) => (
                <button
                  key={key}
                  type="button"
                  class="ic-swatch"
                  style={{ '--ic-swatch': MARK_COLORS[key].value } as JSX.CSSProperties}
                  aria-label={MARK_COLORS[key].label}
                  title={MARK_COLORS[key].label}
                  aria-pressed={colorable && color === key}
                  disabled={!colorable}
                  onClick={() => setColor(key)}
                />
              ))}
            </div>
            <div class="ic-tool-group" role="group" aria-label="太さ・大きさ">
              {SIZES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  class="tb-button ic-size"
                  aria-label={`太さ・大きさ：${option.label}`}
                  title={`太さ・大きさ：${option.label}`}
                  aria-pressed={sizable && size === option.value}
                  disabled={!sizable}
                  onClick={() => setSize(option.value)}
                >
                  <span class="ic-size-dot" data-size={option.value} />
                </button>
              ))}
            </div>
            <span class="ic-tool-divider" aria-hidden="true" />
            <div class="ic-tool-group" role="group" aria-label="取り消し・回転">
              <IconButton
                icon="undo"
                label={`元に戻す（${modKey}+Z）`}
                disabled={!item?.history.past.length}
                onClick={undoEdit}
              />
              <IconButton
                icon="redo"
                label={`やり直す（${isMac ? '⇧⌘Z' : 'Ctrl+Y'}）`}
                disabled={!item?.history.future.length}
                onClick={redoEdit}
              />
              <IconButton
                icon="rotate-ccw"
                label="左に90度回す"
                onClick={() => change((edits) => (edits.rotation = turn(edits.rotation, -1)))}
              />
              <IconButton
                icon="rotate-cw"
                label="右に90度回す"
                onClick={() => change((edits) => (edits.rotation = turn(edits.rotation, 1)))}
              />
            </div>
          </>
        ) : (
          <div class="ic-tool-group">
            <Segmented<Zoom>
              label="表示の倍率"
              value={zoom.value}
              onChange={(value) => {
                centerNext = value !== 'fit';
                zoom.value = value;
              }}
              options={[
                { value: 'fit', label: '全体' },
                { value: '1', label: '100%' },
                { value: '2', label: '200%' },
              ]}
            />
          </div>
        )}
        <div class="ic-tool-end">
          <Segmented<Mode>
            label="表示"
            value={mode.value}
            onChange={setMode}
            options={[
              { value: 'edit', label: '編集' },
              { value: 'compare', label: '見比べる', title: '元の画像と保存する画像を見比べます' },
            ]}
          />
        </div>
      </div>
    );
  }

  function HintBar() {
    void store.revision.value;
    const item = current.value;
    const chosen = markById(selected.value);
    const editing = mode.value === 'edit';
    return (
      <div class="ic-hintbar">
        <p class="ic-hint">
          {editing ? TOOLS.find((info) => info.id === tool.value)!.hint : COMPARE_HINT}
        </p>
        {editing && cropping() && item?.edits.crop && (
          <Button size="small" icon="x" onClick={() => change((edits) => (edits.crop = null))}>
            切り抜きを解除
          </Button>
        )}
        {editing && chosen && !writing.value && (
          <Button size="small" icon="trash" onClick={deleteSelected}>
            この書き込みを消す
          </Button>
        )}
      </div>
    );
  }

  /** 切り抜く範囲の外側を暗くする（画像の枠の中だけに出す）。 */
  function CropShade() {
    void tick.value;
    const rect = cropping() && scale ? cropRect() : null;
    return rect ? <div class="ic-crop-shade" style={boxStyle(scaleRect(rect, scale))} /> : null;
  }

  /** 切り抜く範囲の枠と大きさ、選んだ書き込みの枠とつまみ。枠の外にはみ出してよい。 */
  function Overlay() {
    void tick.value;
    const label = useRef<HTMLSpanElement>(null);
    const item = current.value;
    const shown = space();
    const crop = cropping() ? cropRect() : null;
    useLayoutEffect(() => {
      // 大きさの表示は範囲のすぐ外（上、入らなければ下、どちらも入らなければ内側）に置き、右にはみ出すなら右端にそろえる。
      const element = label.current;
      const frame = el.frame;
      if (!element || !frame || !crop) return;
      const rect = scaleRect(crop, scale);
      const room = element.offsetHeight + 8;
      element.dataset.side =
        rect.y >= room
          ? 'above'
          : frame.clientHeight - (rect.y + rect.height) >= room
            ? 'below'
            : 'inside';
      element.dataset.align = rect.x + element.offsetWidth > frame.clientWidth ? 'end' : 'start';
    });
    if (!item || !shown) return null;
    if (cropping()) {
      if (!crop) return null;
      const rect = scaleRect(crop, scale);
      return (
        <div class="ic-crop-box" style={boxStyle(rect)}>
          <span class="ic-box-label" ref={label}>
            {crop.width} × {crop.height} px・{formatRatio(crop)}
          </span>
          {rectHandles({ x: 0, y: 0, width: rect.width, height: rect.height }).map(
            ([handle, [x, y]]) => (
              <span
                key={handle}
                class="ic-handle"
                data-handle={handle}
                style={{ left: `${x}px`, top: `${y}px` }}
              />
            ),
          )}
        </div>
      );
    }
    const mark = markById(selected.value);
    if (!mark || writing.value?.id === mark.id) return null;
    const placed = mapMark(mark, shown.toView);
    return (
      <>
        {placed.kind === 'text' || placed.kind === 'number' ? (
          <span
            class="ic-selection"
            style={boxStyle(markBounds(placed, scale, measureLine))}
            data-round={placed.kind === 'number' ? '' : undefined}
          />
        ) : (
          placed.kind !== 'arrow' && <span class="ic-selection" style={boxStyle(placed.rect)} />
        )}
        {handlesOf(placed).map(([handle, [x, y]]) => (
          <span
            key={handle}
            class="ic-handle"
            data-handle={handle}
            style={{ left: `${x}px`, top: `${y}px` }}
          />
        ))}
      </>
    );
  }

  /** 書いている途中の文字の欄。確定するまでは、キャンバスの代わりにこの欄に文字を出す。 */
  function TextInput() {
    const state = writing.value;
    const ref = useRef<HTMLTextAreaElement>(null);
    const mark = state ? markById(state.id) : undefined;
    useLayoutEffect(() => {
      const input = ref.current;
      if (!input || mark?.kind !== 'text') return;
      input.value = mark.text;
      input.focus({ preventScroll: true });
      input.setSelectionRange(input.value.length, input.value.length);
    }, [state?.id]);
    if (!state || mark?.kind !== 'text' || !scale) return null;
    const color = MARK_COLORS[mark.color];
    return (
      <textarea
        ref={ref}
        class="ic-text-input"
        rows={1}
        spellcheck={false}
        aria-label="書き込む文字"
        style={
          {
            left: `${state.left}px`,
            top: `${state.top}px`,
            font: `700 ${fontSize(mark) * scale}px/${LINE_HEIGHT} ${MARK_FONT}`,
            color: color.value,
            '--ic-halo': color.light ? '#1d1d1d' : '#fff',
          } as JSX.CSSProperties
        }
        onInput={(event) => {
          if (draft?.id === state.id && draft.kind === 'text') {
            const text = (event.target as HTMLTextAreaElement).value;
            draft = { ...draft, text };
            writing.value = { ...state, text };
          }
        }}
        onKeyDown={(event) => {
          if (event.isComposing) return;
          if (event.key === 'Escape' || (event.key === 'Enter' && hasMod(event))) {
            event.preventDefault();
            event.stopPropagation();
            finishText();
            el.frame?.focus({ preventScroll: true });
          }
        }}
        onBlur={finishText}
      />
    );
  }

  function Stage() {
    void store.revision.value;
    void loaded.value;
    void tool.value;
    void mode.value;
    void zoom.value;
    const item = current.value;
    // 描き直しは、描いた後の大きさを使うため、画面を作った直後に行う。
    useLayoutEffect(() => refresh());
    useEffect(() => {
      const stage = el.stage;
      if (!stage) return;
      const observer = new ResizeObserver(() => refresh());
      observer.observe(stage);
      return () => observer.disconnect();
    }, []);
    const pending = item ? isPending(item) : false;
    const waiting = Boolean(item) && !bitmap && !failed;
    const editing = mode.value === 'edit';
    return (
      <section class="ic-editor" aria-label="画像の編集">
        <Toolbar />
        <HintBar />
        <div
          class="ic-stage"
          ref={(element) => {
            el.stage = element;
          }}
        >
          {waiting && <span class="tb-spinner ic-stage-spinner" />}
          {failed && item && (
            <p class="ic-stage-message">
              <Icon name="image" />
              {item.error ?? 'この画像は開けません。'}
            </p>
          )}
          <div class="ic-canvas" hidden={!editing || failed}>
            <div
              class="ic-frame"
              data-tool={tool.value}
              tabindex={-1}
              ref={(element) => {
                el.frame = element;
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              onDblClick={onDoubleClick}
            >
              <div class="ic-frame-clip">
                <canvas
                  class="ic-layer"
                  ref={(element) => {
                    el.base = element;
                  }}
                />
                <canvas
                  class="ic-layer ic-tint"
                  ref={(element) => {
                    el.tint = element;
                  }}
                />
                <canvas
                  class="ic-layer"
                  ref={(element) => {
                    el.ink = element;
                  }}
                />
                <CropShade />
              </div>
              <Overlay />
              <TextInput />
            </div>
          </div>
          <div
            class="ic-compare"
            hidden={editing || failed}
            data-zoomed={zoom.value === 'fit' ? undefined : ''}
          >
            <figure class="ic-pane">
              <figcaption>元の画像</figcaption>
              <div
                class="ic-compare-scroll tb-scroll"
                ref={(element) => {
                  el.beforeScroll = element;
                }}
                onScroll={onCompareScroll}
                onPointerDown={onComparePointerDown}
                onPointerMove={onComparePointerMove}
                onPointerUp={onComparePointerUp}
                onPointerCancel={onComparePointerUp}
              >
                <canvas
                  class="ic-compare-view"
                  ref={(element) => {
                    el.before = element;
                  }}
                />
              </div>
            </figure>
            <figure class="ic-pane" data-pending={pending ? '' : undefined}>
              <figcaption>
                {pending || !item?.result ? (
                  <>
                    <span class="tb-spinner" /> 保存する画像（計算しています…）
                  </>
                ) : (
                  `保存する画像・${formatBytes(item.result.blob.size)}`
                )}
              </figcaption>
              <div
                class="ic-compare-scroll tb-scroll"
                ref={(element) => {
                  el.afterScroll = element;
                }}
                onScroll={onCompareScroll}
                onPointerDown={onComparePointerDown}
                onPointerMove={onComparePointerMove}
                onPointerUp={onComparePointerUp}
                onPointerCancel={onComparePointerUp}
              >
                <img
                  class="ic-compare-view"
                  alt="保存する画像"
                  draggable={false}
                  ref={(element) => {
                    el.after = element;
                  }}
                />
              </div>
            </figure>
          </div>
        </div>
      </section>
    );
  }

  /** 容量と上限の目盛り。 */
  function Gauge({ item, limit }: { item: Item; limit: number | null }) {
    const result = item.result;
    const pending = isPending(item);
    if (item.error) return <p class="ic-gauge-error">{item.error}</p>;
    if (!result)
      return (
        <div class="ic-gauge" data-pending="">
          <div class="ic-gauge-head">
            <span class="tb-spinner" /> 計算しています…
          </div>
        </div>
      );
    const size = result.blob.size;
    const ratio = limit === null ? null : size / limit;
    return (
      <div
        class="ic-gauge"
        data-pending={pending ? '' : undefined}
        data-over={result.fits === false ? '' : undefined}
      >
        <div class="ic-gauge-head">
          <strong class="ic-gauge-size">{formatBytes(size)}</strong>
          <span class="ic-gauge-limit">
            {limit === null ? '上限なし' : `/ 上限 ${formatBytes(limit)}`}
          </span>
          {pending && <span class="tb-spinner" title="計算し直しています" />}
        </div>
        {ratio !== null && limit !== null && (
          <div
            class="ic-gauge-bar"
            role="meter"
            aria-label="上限に対する容量"
            aria-valuemin={0}
            aria-valuemax={limit}
            aria-valuenow={Math.min(size, limit)}
          >
            <span style={{ width: `${Math.min(100, ratio * 100)}%` }} />
          </div>
        )}
        {ratio !== null && limit !== null && (
          <p class="ic-gauge-note">
            {result.fits
              ? `上限の ${Math.max(1, Math.round(ratio * 100))}% に収まっています。`
              : `上限を ${formatBytes(size - limit)} 超えています。長い辺を小さくするか、JPEG にしてください。`}
          </p>
        )}
      </div>
    );
  }

  /** 右のパネルの「この画像」：容量・形式、この画像だけの設定、コピー・保存。 */
  function ItemPanel() {
    void store.revision.value;
    const item = current.value;
    if (!item) return null;
    const global = store.settings.value;
    const settings = effective(global, item.overrides);
    const result = item.result;
    const pending = isPending(item);
    const ready = Boolean(result && !pending && !item.error);
    const png = settings.format === 'png';
    const manual = item.overrides.quality !== undefined;
    const quality = qualityDraft.value ?? item.overrides.quality ?? result?.quality ?? MAX_QUALITY;
    const own = Object.keys(item.overrides).length > 0;
    const updateOverrides = (update: (target: Item) => void) => {
      update(item);
      store.schedule(item);
    };
    return (
      <>
        <section class="ic-section" aria-labelledby="ic-this-title">
          <h2 class="ic-section-title" id="ic-this-title">
            この画像
          </h2>
          <Gauge item={item} limit={settings.limit} />
          <dl class="ic-facts">
            <div>
              <dt>大きさ</dt>
              <dd>{result ? `${result.width} × ${result.height} px` : '—'}</dd>
            </div>
            <div>
              <dt>形式</dt>
              <dd>
                {result
                  ? `${result.format === 'png' ? 'PNG' : 'JPEG'}${result.auto ? '（自動で選択）' : ''}${
                      result.quality === null
                        ? ''
                        : `・画質 ${result.quality}${manual ? '（手で指定）' : ''}`
                    }`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>元の画像</dt>
              <dd>
                {item.size ? `${item.size.width} × ${item.size.height} px・` : ''}
                {formatBytes(item.file.size)}
              </dd>
            </div>
          </dl>
          <details class="ic-own" open={own}>
            <summary>
              この画像だけ変える
              {own && (
                <span class="tb-badge" data-tone="accent">
                  変更あり
                </span>
              )}
            </summary>
            <div class="ic-own-body">
              <label class="ic-field">
                <span>形式</span>
                <select
                  class="tb-input"
                  value={item.overrides.format ?? ''}
                  onChange={(event) => {
                    const value = (event.target as HTMLSelectElement).value;
                    updateOverrides((target) => {
                      if (value) target.overrides.format = value as FormatChoice;
                      else delete target.overrides.format;
                    });
                  }}
                >
                  <option value="">すべての画像と同じ（{FORMAT_LABELS[global.format]}）</option>
                  <option value="auto">自動</option>
                  <option value="jpeg">JPEG</option>
                  <option value="png">PNG</option>
                </select>
              </label>
              <label class="ic-field">
                <span>長い辺</span>
                <span class="ic-with-unit">
                  <input
                    class="tb-input ic-number"
                    type="number"
                    min="1"
                    step="1"
                    list="ic-long-list"
                    placeholder={global.longSide ? String(global.longSide) : '元のまま'}
                    value={longDraft.value ?? item.overrides.longSide?.toString() ?? ''}
                    onInput={(event) =>
                      (longDraft.value = (event.target as HTMLInputElement).value)
                    }
                    onChange={(event) => {
                      const value = parseLongSide((event.target as HTMLInputElement).value);
                      longDraft.value = null;
                      updateOverrides((target) => {
                        if (value === null) delete target.overrides.longSide;
                        else target.overrides.longSide = value;
                      });
                    }}
                  />
                  px
                </span>
                <small class="ic-muted">
                  空にすると、すべての画像と同じ（
                  {global.longSide ? `${global.longSide} px` : '元のまま'}）です。
                </small>
              </label>
              <div class="ic-field">
                <span>画質</span>
                <label class="ic-check">
                  <input
                    type="checkbox"
                    checked={!manual}
                    disabled={png}
                    onChange={(event) => {
                      const auto = (event.target as HTMLInputElement).checked;
                      updateOverrides((target) => {
                        if (auto) delete target.overrides.quality;
                        else target.overrides.quality = target.result?.quality ?? MAX_QUALITY;
                      });
                    }}
                  />
                  上限に合わせて自動で決める
                </label>
                <span class="ic-with-unit">
                  <input
                    type="range"
                    min="1"
                    max="100"
                    step="1"
                    aria-label="画質"
                    disabled={png || !manual}
                    value={quality}
                    onInput={(event) => {
                      const value = Number((event.target as HTMLInputElement).value);
                      qualityDraft.value = value;
                      clearTimeout(qualityTimer);
                      qualityTimer = window.setTimeout(() => {
                        qualityDraft.value = null;
                        updateOverrides((target) => (target.overrides.quality = value));
                      }, 200);
                    }}
                  />
                  <output class="ic-quality">{png ? '—' : quality}</output>
                </span>
                {(png || manual || settings.limit === null) && (
                  <small class="ic-muted">
                    {png
                      ? 'PNG は画質の段階がありません。容量を減らすには長い辺を小さくします。'
                      : manual
                        ? '画質を手で決めると、JPEG で保存します。'
                        : `上限がないため、JPEG にするときは画質 ${MAX_QUALITY} にします。`}
                  </small>
                )}
              </div>
              <Button
                size="small"
                disabled={!own}
                onClick={() => updateOverrides((target) => (target.overrides = {}))}
              >
                すべての画像と同じに戻す
              </Button>
            </div>
          </details>
        </section>
        <div class="ic-panel-actions">
          <Button
            icon="copy"
            disabled={!ready}
            title={`PNG でクリップボードにコピー（${modKey}+C）`}
            onClick={() => void copy()}
          >
            コピー
          </Button>
          <Button
            variant="primary"
            icon={item.saved ? 'check' : 'download'}
            disabled={!ready}
            title={`この画像をダウンロードして保存（${modKey}+S）`}
            onClick={() => onSave(item)}
          >
            {item.saved ? '保存済み・もう一度' : 'この画像を保存'}
          </Button>
        </div>
      </>
    );
  }

  return { Stage, ItemPanel, open, current, handleKey, finishText, pendingText };
}

export type Editor = ReturnType<typeof createEditor>;
