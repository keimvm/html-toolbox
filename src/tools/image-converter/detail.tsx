// 個別の画面。元の画像と変換後を拡大して見比べ、その画像だけの設定・切り抜き・回転・塗りつぶしを行う。
// 座標の計算・スクロールの同期・切り抜きの操作は旧 detail.ts の処理をそのまま移した。
// キャンバス・変換後の画像の src・囲んだ範囲の位置は直接書き換え、文言と設定の欄は Preact で描く。
import { computed, signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { formatBytes } from '../../lib/format';
import { Button, IconButton, Segmented } from '../../ui/components';
import { decode, drawEdited } from './convert';
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
  sourcePoint,
  turn,
  unrotateRect,
  type Rect,
  type Size,
} from './geometry';
import { isPending, type Item, type Items } from './items';
import { effective, MAX_QUALITY, parseLongSide, type Format } from './settings';

/** 見比べ・編集の画面に描く画素数の上限。 */
const MAX_VIEW_PIXELS = 32_000_000;

type Mode = 'compare' | 'crop' | 'redact';
type Zoom = 'fit' | '1' | '2';

const HINTS: Record<Mode, string> = {
  compare:
    '左が元の画像（切り抜き・回転・塗りつぶしの前）、右が保存する画像です。100%・200% ではどちらもスクロールでき、同じ場所を表示します。',
  crop: '画像の上をドラッグして、残す範囲を囲みます。囲み直すと範囲が変わります。矢印キーで範囲を 1 px ずつ動かし、Shift＋矢印キーで幅・高さを 1 px ずつ変えます。',
  redact:
    'ドラッグで囲んだ範囲を黒く塗りつぶします。保存する画像には、塗りつぶした部分の元の画素は残りません。',
};

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

function show(canvas: HTMLCanvasElement, image: OffscreenCanvas) {
  canvas.width = image.width;
  canvas.height = image.height;
  canvas.getContext('bitmaprenderer')?.transferFromImageBitmap(image.transferToImageBitmap());
}

/** 回転した画像の座標の長方形を、枠に対する割合で置く。 */
function place(element: HTMLElement, rect: Rect, full: Size) {
  element.style.left = `${(rect.x / full.width) * 100}%`;
  element.style.top = `${(rect.y / full.height) * 100}%`;
  element.style.width = `${(rect.width / full.width) * 100}%`;
  element.style.height = `${(rect.height / full.height) * 100}%`;
}

/** 欄の中央が、画像のどこに当たるか（画像の幅・高さに対する割合）。 */
function centerOf(scroll: HTMLElement, image: DOMRect): [number, number] {
  const box = scroll.getBoundingClientRect();
  return [
    (box.left + scroll.clientLeft + scroll.clientWidth / 2 - image.left) / image.width,
    (box.top + scroll.clientTop + scroll.clientHeight / 2 - image.top) / image.height,
  ];
}

export function createDetail(store: Items, { onSave }: { onSave: (item: Item) => void }) {
  const current = signal<Item | null>(null);
  const mode = signal<Mode>('compare');
  const zoom = signal<Zoom>('fit');
  /** 元の画像を読み込んだら増やす。 */
  const loaded = signal(0);
  /** 入力中の長い辺・画質（確定するまで設定に書かない）。 */
  const longDraft = signal<string | null>(null);
  const qualityDraft = signal<number | null>(null);
  /** 開いている画像を読み込んだもの。元の画像の表示と、切り抜き・塗りつぶしの画面に使う。 */
  let bitmap: ImageBitmap | null = null;
  /** 変換後の欄に表示している画像。変わったときだけ URL を作り直す。 */
  let shown: { blob: Blob; url: string } | null = null;
  let qualityTimer = 0;
  let dragStart: [number, number] | null = null;
  const el: {
    before?: HTMLCanvasElement | null;
    after?: HTMLImageElement | null;
    beforeScroll?: HTMLDivElement | null;
    afterScroll?: HTMLDivElement | null;
    edit?: HTMLDivElement | null;
    frame?: HTMLDivElement | null;
    editCanvas?: HTMLCanvasElement | null;
    cropBox?: HTMLDivElement | null;
    cropLabel?: HTMLSpanElement | null;
    draft?: HTMLDivElement | null;
    draftLabel?: HTMLSpanElement | null;
  } = {};

  const sourceSize = (): Size | null =>
    bitmap ? { width: bitmap.width, height: bitmap.height } : null;

  function neighbor(step: 1 | -1) {
    const item = current.value;
    if (!item) return undefined;
    const items = store.items.value;
    for (let index = items.indexOf(item) + step; index >= 0 && index < items.length; index += step)
      if (!items[index]!.error) return items[index];
    return undefined;
  }

  /** 変換後の欄に表示する大きさ（変換後の画素数）。 */
  function viewSize(): Size | null {
    const source = sourceSize();
    const item = current.value;
    if (!item || !source) return null;
    if (item.result && !isPending(item))
      return { width: item.result.width, height: item.result.height };
    return fitLongSide(
      editedSize(source, item.edits),
      effective(store.settings.value, item.overrides).longSide,
    );
  }

  /**
   * 変換後の画素数を基準に並べる。元の画像は変換後と同じ割合で縮めた大きさとし、
   * 同じ部分が左右で同じ大きさに見えるようにする。全体表示では、それぞれを欄に収める。
   */
  function layoutCompare() {
    const size = viewSize();
    const source = sourceSize();
    const item = current.value;
    if (!size || !source || !item || !el.before || !el.after) return;
    const ratio = size.width / editedSize(source, item.edits).width;
    const original = { width: source.width * ratio, height: source.height * ratio };
    for (const [view, scroll, shownSize] of [
      [el.before, el.beforeScroll, original],
      [el.after, el.afterScroll, size],
    ] as const) {
      if (!scroll) continue;
      const scale =
        zoom.value === 'fit'
          ? Math.min(
              1,
              (scroll.clientWidth - 2) / shownSize.width,
              (scroll.clientHeight - 2) / shownSize.height,
            )
          : Number(zoom.value);
      view.style.width = `${Math.max(1, shownSize.width * scale)}px`;
      view.style.height = `${Math.max(1, shownSize.height * scale)}px`;
    }
  }

  /** 元の画像は、切り抜き・回転・塗りつぶしの前のまま描く。 */
  function renderBefore() {
    const source = sourceSize();
    if (!bitmap || !source || !el.before) return;
    show(el.before, drawEdited(bitmap, noEdits(), fitPixels(source, MAX_VIEW_PIXELS), null));
    layoutCompare();
  }

  /** 自分で動かした欄のスクロール位置。この位置への scroll では、もう片方を動かさない。 */
  const moved = new WeakMap<HTMLElement, [number, number]>();

  /** 欄の中央に見えている点を、もう片方の欄でも中央に表示する。 */
  function follow(from: HTMLElement | null | undefined, to: HTMLElement | null | undefined) {
    const source = sourceSize();
    const item = current.value;
    if (!item || !source || !from || !to || !el.before || !el.after) return;
    const viewOf = (scroll: HTMLElement) => (scroll === el.beforeScroll ? el.before! : el.after!);
    const fromImage = viewOf(from).getBoundingClientRect();
    const toImage = viewOf(to).getBoundingClientRect();
    if (!fromImage.width || !fromImage.height) return;
    if (!toImage.width || !toImage.height) return;
    const edited = editedSize(source, item.edits);
    const [fromSize, toSize] = from === el.beforeScroll ? [source, edited] : [edited, source];
    const [fx, fy] = centerOf(from, fromImage);
    const point: [number, number] = [fx * fromSize.width, fy * fromSize.height];
    const [x, y] =
      from === el.beforeScroll
        ? editedPoint(point, source, item.edits)
        : sourcePoint(point, source, item.edits);
    const [cx, cy] = centerOf(to, toImage);
    const previous = [to.scrollLeft, to.scrollTop];
    to.scrollBy((x / toSize.width - cx) * toImage.width, (y / toSize.height - cy) * toImage.height);
    if (previous[0] !== to.scrollLeft || previous[1] !== to.scrollTop)
      moved.set(to, [to.scrollLeft, to.scrollTop]);
  }

  function clearAfter() {
    if (shown) URL.revokeObjectURL(shown.url);
    shown = null;
    el.after?.removeAttribute('src');
  }

  function renderAfter() {
    const item = current.value;
    if (!item || !el.after) return;
    const blob = item.result?.blob;
    if (!isPending(item) && blob && blob !== shown?.blob) {
      const previous = shown;
      shown = { blob, url: URL.createObjectURL(blob) };
      el.after.src = shown.url;
      if (previous) URL.revokeObjectURL(previous.url);
    }
    layoutCompare();
  }

  /**
   * 囲んだ範囲の大きさと縦横比（回転した後の向き）を、範囲の外に表示する。
   * 上に置き、入らなければ下に、上下とも入らなければ範囲の内側に置く。右にはみ出すときは、範囲の右端に揃える。
   */
  function showSize(label: HTMLElement, size: Size | null, rect: Rect, full: Size) {
    label.textContent = size ? `${size.width} × ${size.height} px・${formatRatio(size)}` : '';
    const frame = el.frame;
    if (!size || !label.offsetHeight || !frame) return;
    const scale = frame.clientHeight / full.height;
    const room = label.offsetHeight + 8;
    label.dataset.side =
      rect.y * scale >= room
        ? 'above'
        : frame.clientHeight - (rect.y + rect.height) * scale >= room
          ? 'below'
          : 'inside';
    label.dataset.align = rect.x * scale + label.offsetWidth > frame.clientWidth ? 'end' : 'start';
  }

  /** 切り抜きの範囲を、大きさと縦横比を添えて置く。 */
  function placeCrop() {
    const source = sourceSize();
    const item = current.value;
    const crop = item?.edits.crop;
    const box = el.cropBox;
    if (!box) return;
    box.toggleAttribute('data-show', Boolean(crop));
    if (!item || !source || !crop || !el.cropLabel) return;
    const rotation = item.edits.rotation;
    const rect = rotateRect(crop, source, rotation);
    const full = rotatedSize(source, rotation);
    place(box, rect, full);
    showSize(el.cropLabel, rect, rect, full);
  }

  /** 切り抜く前の画像（回転・塗りつぶしは当てる）を、枠に収めて描く。 */
  function renderEditStage() {
    const source = sourceSize();
    const item = current.value;
    const { edit, frame, editCanvas } = el;
    if (!item || !bitmap || !source || mode.value === 'compare' || !edit || !frame || !editCanvas)
      return;
    const full = rotatedSize(source, item.edits.rotation);
    const scale = Math.min(1, edit.clientWidth / full.width, edit.clientHeight / full.height);
    const css = { width: full.width * scale, height: full.height * scale };
    const pixels = fitPixels(
      {
        width: Math.max(1, Math.min(full.width, Math.round(css.width * devicePixelRatio))),
        height: Math.max(1, Math.min(full.height, Math.round(css.height * devicePixelRatio))),
      },
      MAX_VIEW_PIXELS,
    );
    show(editCanvas, drawEdited(bitmap, { ...item.edits, crop: null }, pixels, null));
    frame.style.width = `${css.width}px`;
    frame.style.height = `${css.height}px`;
    placeCrop();
  }

  /** 変更した画像を変換し直す。 */
  function changed(item: Item) {
    store.schedule(item);
    renderAfter();
  }

  function updateOverrides(update: (item: Item) => void) {
    const item = current.value;
    if (!item) return;
    update(item);
    changed(item);
  }

  function editImage(update: (item: Item) => void) {
    const item = current.value;
    if (!item) return;
    update(item);
    changed(item);
    renderEditStage();
  }

  function pointOf(event: PointerEvent): [number, number] {
    const source = sourceSize()!;
    const full = rotatedSize(source, current.value!.edits.rotation);
    const box = el.frame!.getBoundingClientRect();
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    return [
      clamp((event.clientX - box.left) / box.width) * full.width,
      clamp((event.clientY - box.top) / box.height) * full.height,
    ];
  }

  /** 回転した画像の上で囲んだ範囲を、元の画像の画素の範囲にする。小さすぎる範囲は null。 */
  function areaOf(rect: Rect): Rect | null {
    const source = sourceSize()!;
    return pixelRect(unrotateRect(rect, source, current.value!.edits.rotation), source, 4);
  }

  function showDraft(event: PointerEvent) {
    const source = sourceSize();
    const item = current.value;
    if (!dragStart || !item || !source || !el.draft || !el.draftLabel) return;
    const rect = between(dragStart, pointOf(event));
    const area = areaOf(rect);
    const full = rotatedSize(source, item.edits.rotation);
    el.draft.setAttribute('data-show', '');
    place(el.draft, rect, full);
    showSize(el.draftLabel, area && rotatedSize(area, item.edits.rotation), rect, full);
    // 囲み直している間は、今の切り抜きの範囲を隠して、新しい範囲の大きさだけを見せる。
    if (mode.value === 'crop') el.cropBox?.removeAttribute('data-show');
  }

  function endDrag() {
    dragStart = null;
    el.draft?.removeAttribute('data-show');
    el.cropBox?.toggleAttribute('data-show', Boolean(current.value?.edits.crop));
  }

  function finishDrag(event: PointerEvent) {
    const item = current.value;
    if (!dragStart || !item || !bitmap) return;
    const area = areaOf(between(dragStart, pointOf(event)));
    endDrag();
    if (!area) return;
    editImage((target) => {
      if (mode.value === 'crop') target.edits.crop = area;
      else target.edits.redactions.push(area);
    });
  }

  /** 矢印キーで切り抜きの範囲を 1 px ずつ動かす。Shift を押しながらなら幅・高さを変える。 */
  function nudgeCrop(event: KeyboardEvent) {
    const step = ARROWS[event.key];
    const source = sourceSize();
    const item = current.value;
    const crop = item?.edits.crop;
    if (!step || mode.value !== 'crop' || !item || !crop || !source || dragStart) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    // 設定の入力欄・つまみでは、矢印キー本来の操作を優先する。
    if ((event.target as Element).closest('input, select, textarea, [role="radiogroup"]')) return;
    event.preventDefault();
    const rotation = item.edits.rotation;
    const full = rotatedSize(source, rotation);
    const rect = rotateRect(crop, source, rotation);
    const next = event.shiftKey ? resizeRect(rect, full, ...step) : moveRect(rect, full, ...step);
    if (
      next.x === rect.x &&
      next.y === rect.y &&
      next.width === rect.width &&
      next.height === rect.height
    )
      return;
    item.edits.crop = unrotateRect(next, source, rotation);
    changed(item);
    placeCrop();
  }

  /** 個別の画面を開く。開いたまま別の画像に切り替えることもできる。 */
  async function open(item: Item) {
    if (item.error) return;
    clearTimeout(qualityTimer);
    if (!current.value) {
      mode.value = 'compare';
      zoom.value = 'fit';
    }
    bitmap?.close();
    bitmap = null;
    clearAfter();
    for (const canvas of [el.before, el.editCanvas]) if (canvas) canvas.width = canvas.height = 0;
    longDraft.value = null;
    qualityDraft.value = null;
    current.value = item;
    store.setCurrent(item);
    const image = await decode(item.file).catch(() => null);
    if (current.value !== item) {
      image?.close();
      return;
    }
    bitmap = image;
    loaded.value++;
  }

  function close() {
    clearTimeout(qualityTimer);
    current.value = null;
    store.setCurrent(null);
    bitmap?.close();
    bitmap = null;
    clearAfter();
  }

  store.onConverted((item) => {
    if (item === current.value) renderAfter();
  });

  const stats = computed(() => {
    void store.revision.value;
    const item = current.value;
    if (!item) return [];
    const settings = effective(store.settings.value, item.overrides);
    const rows: [string, string, boolean?][] = [
      [
        '元の画像',
        `${item.size ? `${item.size.width} × ${item.size.height} px・` : ''}${formatBytes(item.file.size)}`,
      ],
    ];
    const result = item.result;
    if (isPending(item) || !result) rows.push(['変換後', '計算しています…']);
    else {
      rows.push([
        '変換後',
        `${result.width} × ${result.height} px・${formatBytes(result.blob.size)}`,
      ]);
      rows.push([
        '形式',
        result.quality === null
          ? 'PNG'
          : `JPEG・画質 ${result.quality}（${item.overrides.quality === undefined ? '自動' : '手で指定'}）`,
      ]);
      rows.push(
        settings.limit === null
          ? ['上限', 'なし']
          : result.fits
            ? ['上限', `${formatBytes(settings.limit)} 以下に収まっています`]
            : ['上限', `${formatBytes(settings.limit)} を超えています`, true],
      );
    }
    return rows;
  });

  function Side({ item }: { item: Item }) {
    const global = store.settings.value;
    const settings = effective(global, item.overrides);
    const png = settings.format === 'png';
    const auto = item.overrides.quality === undefined;
    const quality =
      qualityDraft.value ?? item.overrides.quality ?? item.result?.quality ?? MAX_QUALITY;
    const pending = isPending(item);
    return (
      <aside class="ic-side tb-scroll">
        <dl class="ic-stats">
          {stats.value.map(([label, value, warning]) => (
            <div key={label} class="ic-stat" data-warning={warning ? '' : undefined}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <section class="ic-side-section" aria-labelledby="ic-item-settings-title">
          <h3 id="ic-item-settings-title">この画像の設定</h3>
          <label class="ic-field">
            <span>出力形式</span>
            <select
              class="tb-input"
              value={item.overrides.format ?? ''}
              onChange={(event) => {
                const value = (event.target as HTMLSelectElement).value;
                updateOverrides((target) => {
                  if (value) target.overrides.format = value as Format;
                  else delete target.overrides.format;
                });
              }}
            >
              <option value="">
                全体の設定に従う（{global.format === 'jpeg' ? 'JPEG' : 'PNG'}）
              </option>
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
                onInput={(event) => (longDraft.value = (event.target as HTMLInputElement).value)}
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
              空にすると全体の設定（{global.longSide ? `${global.longSide} px` : '元のまま'}
              ）に従います。
            </small>
          </label>
          <div class="ic-field">
            <span>画質</span>
            <label class="ic-check">
              <input
                type="checkbox"
                checked={auto}
                disabled={png}
                onChange={(event) => {
                  const checked = (event.target as HTMLInputElement).checked;
                  updateOverrides((target) => {
                    if (checked) delete target.overrides.quality;
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
                disabled={png || auto}
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
            {(png || (auto && settings.limit === null)) && (
              <small class="ic-muted">
                {png
                  ? 'PNG は画質の段階がありません。容量を減らすには長い辺を小さくします。'
                  : `上限がないため、画質 ${MAX_QUALITY} にします。`}
              </small>
            )}
          </div>
          <Button
            size="small"
            disabled={!Object.keys(item.overrides).length}
            onClick={() => updateOverrides((target) => (target.overrides = {}))}
          >
            全体の設定に戻す
          </Button>
        </section>
        <section class="ic-side-section" aria-labelledby="ic-edit-title">
          <h3 id="ic-edit-title">回転・切り抜き・塗りつぶし</h3>
          <div class="ic-buttons">
            <Button
              icon="rotate-ccw"
              size="small"
              onClick={() =>
                editImage((target) => (target.edits.rotation = turn(target.edits.rotation, -1)))
              }
            >
              左に回す
            </Button>
            <Button
              icon="rotate-cw"
              size="small"
              onClick={() =>
                editImage((target) => (target.edits.rotation = turn(target.edits.rotation, 1)))
              }
            >
              右に回す
            </Button>
            <Button
              icon="crop"
              size="small"
              disabled={!item.edits.crop}
              onClick={() => editImage((target) => (target.edits.crop = null))}
            >
              切り抜きを解除
            </Button>
            <Button
              icon="undo"
              size="small"
              disabled={!item.edits.redactions.length}
              onClick={() => editImage((target) => target.edits.redactions.pop())}
            >
              塗りを1つ戻す
            </Button>
          </div>
        </section>
        <Button
          variant="primary"
          icon={item.saved ? 'check' : 'download'}
          class="ic-save-current"
          disabled={pending || !item.result}
          onClick={() => onSave(item)}
        >
          {item.saved ? '保存しました（もう一度保存）' : 'この画像を保存'}
        </Button>
      </aside>
    );
  }

  /** active が偽（ほかの画面を見ている）間は閉じておき、ほかの画面を操作できなくしない。 */
  function View({ active }: { active: boolean }) {
    const item = current.value;
    void store.revision.value;
    void loaded.value;
    const ref = useRef<HTMLDialogElement>(null);
    const visible = Boolean(item) && active;

    useLayoutEffect(() => {
      const dialog = ref.current;
      if (!dialog) return;
      if (visible && !dialog.open) dialog.showModal();
      else if (!visible && dialog.open) dialog.close();
    }, [visible]);

    // 読み込んだら描く。
    useLayoutEffect(() => {
      if (!bitmap) return;
      renderBefore();
      renderEditStage();
      renderAfter();
      follow(el.afterScroll, el.beforeScroll);
    }, [loaded.value]);

    // 操作・倍率を変えたら描き直す。
    useLayoutEffect(() => {
      renderEditStage();
      layoutCompare();
      if (mode.value === 'compare') follow(el.afterScroll, el.beforeScroll);
    }, [mode.value, zoom.value]);

    useEffect(() => {
      const dialog = ref.current;
      if (!dialog) return;
      const observer = new ResizeObserver(() => {
        if (!current.value) return;
        layoutCompare();
        renderEditStage();
      });
      observer.observe(dialog);
      return () => observer.disconnect();
    }, []);

    const previous = item ? neighbor(-1) : undefined;
    const next = item ? neighbor(1) : undefined;
    const items = store.items.value;
    const pending = item ? isPending(item) : false;
    const onScroll = (from: 'before' | 'after') => () => {
      const [source, target] =
        from === 'before' ? [el.beforeScroll, el.afterScroll] : [el.afterScroll, el.beforeScroll];
      if (!source) return;
      const own = moved.get(source);
      moved.delete(source);
      if (own?.[0] === source.scrollLeft && own[1] === source.scrollTop) return;
      follow(source, target);
    };

    return (
      <dialog
        ref={ref}
        class="tb-dialog ic-detail"
        aria-labelledby="ic-detail-title"
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onKeyDown={nudgeCrop}
      >
        {item && (
          <>
            <div class="ic-detail-head">
              <h2 id="ic-detail-title" title={item.source}>
                {item.name}
              </h2>
              <span class="ic-position">
                {items.indexOf(item) + 1} / {items.length}
              </span>
              <div class="ic-detail-nav">
                <IconButton
                  icon="chevron-left"
                  label="前の画像"
                  variant="secondary"
                  disabled={!previous}
                  onClick={() => previous && void open(previous)}
                />
                <IconButton
                  icon="chevron-right"
                  label="次の画像"
                  variant="secondary"
                  disabled={!next}
                  onClick={() => next && void open(next)}
                />
                <IconButton icon="x" label="閉じる" onClick={close} />
              </div>
            </div>
            <div class="ic-detail-body">
              <div class="ic-stage">
                <div class="ic-stage-tools">
                  <Segmented
                    label="操作"
                    value={mode.value}
                    onChange={(value) => (mode.value = value)}
                    options={[
                      { value: 'compare', label: '見比べる' },
                      { value: 'crop', label: '切り抜く' },
                      { value: 'redact', label: '塗りつぶす' },
                    ]}
                  />
                  {mode.value === 'compare' && (
                    <Segmented
                      label="表示の倍率"
                      value={zoom.value}
                      onChange={(value) => (zoom.value = value)}
                      options={[
                        { value: 'fit', label: '全体' },
                        { value: '1', label: '100%' },
                        { value: '2', label: '200%' },
                      ]}
                    />
                  )}
                </div>
                <p class="ic-hint">{HINTS[mode.value]}</p>
                <div
                  class="ic-compare"
                  hidden={mode.value !== 'compare'}
                  data-busy={pending ? '' : undefined}
                >
                  <figure class="ic-pane">
                    <figcaption>元の画像</figcaption>
                    <div
                      class="ic-scroll tb-scroll"
                      ref={(element) => {
                        el.beforeScroll = element;
                      }}
                      onScroll={onScroll('before')}
                    >
                      <canvas
                        class="ic-view"
                        ref={(element) => {
                          el.before = element;
                        }}
                      />
                    </div>
                  </figure>
                  <figure class="ic-pane">
                    <figcaption>
                      {pending ? (
                        <>
                          <span class="tb-spinner" /> 変換後（計算しています…）
                        </>
                      ) : (
                        '変換後'
                      )}
                    </figcaption>
                    <div
                      class="ic-scroll tb-scroll"
                      ref={(element) => {
                        el.afterScroll = element;
                      }}
                      onScroll={onScroll('after')}
                    >
                      <img
                        class="ic-view ic-after"
                        alt="変換後の画像"
                        ref={(element) => {
                          el.after = element;
                        }}
                      />
                    </div>
                  </figure>
                </div>
                <div
                  class="ic-edit"
                  hidden={mode.value === 'compare'}
                  data-mode={mode.value}
                  ref={(element) => {
                    el.edit = element;
                  }}
                >
                  <div
                    class="ic-edit-frame"
                    tabindex={-1}
                    ref={(element) => {
                      el.frame = element;
                    }}
                    onPointerDown={(event) => {
                      if (mode.value === 'compare' || !bitmap || event.button !== 0) return;
                      event.preventDefault();
                      // 囲んだあとの矢印キーが、設定の入力欄ではなく範囲に効くようにする。
                      el.frame?.focus({ preventScroll: true });
                      el.frame?.setPointerCapture(event.pointerId);
                      dragStart = pointOf(event);
                    }}
                    onPointerMove={showDraft}
                    onPointerUp={finishDrag}
                    onPointerCancel={endDrag}
                  >
                    <canvas
                      class="ic-edit-canvas"
                      ref={(element) => {
                        el.editCanvas = element;
                      }}
                    />
                    <div
                      class="ic-crop-box"
                      ref={(element) => {
                        el.cropBox = element;
                      }}
                    >
                      <span
                        class="ic-box-label"
                        ref={(element) => {
                          el.cropLabel = element;
                        }}
                      />
                    </div>
                    <div
                      class="ic-draft"
                      ref={(element) => {
                        el.draft = element;
                      }}
                    >
                      <span
                        class="ic-box-label"
                        ref={(element) => {
                          el.draftLabel = element;
                        }}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <Side item={item} />
            </div>
          </>
        )}
      </dialog>
    );
  }

  return { View, open, close, current };
}
