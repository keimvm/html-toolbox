import { decode, drawEdited } from './convert';
import {
  between,
  editedSize,
  fitLongSide,
  fitPixels,
  pixelRect,
  rotateRect,
  rotatedSize,
  turn,
  unrotateRect,
  type Size,
} from './geometry';
import { isPending, saveItem, schedule, state, type Item } from './items';
import {
  effective,
  formatBytes,
  MAX_QUALITY,
  parseLongSide,
  type Format,
} from './settings';

/** 見比べ・編集の画面に描く画素数の上限。 */
const MAX_VIEW_PIXELS = 32_000_000;

type Mode = 'compare' | 'crop' | 'redact';
type Zoom = 'fit' | 1 | 2;

const HINTS: Record<Mode, string> = {
  compare:
    '左が元の画像（切り抜き・回転・塗りつぶしを当てたもの）、右が保存する画像です。100%・200% ではどちらもスクロールでき、同じ場所を表示します。',
  crop: '画像の上をドラッグして、残す範囲を囲みます。囲み直すと範囲が変わります。',
  redact:
    'ドラッグで囲んだ範囲を黒く塗りつぶします。保存する画像には、塗りつぶした部分の元の画素は残りません。',
};

function $<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`画面の要素が見つかりません: ${selector}`);
  return element;
}

const dialog = $<HTMLDialogElement>('#ic-detail');
const title = $('#ic-detail-title');
const position = $('#ic-position');
const hint = $('#ic-hint');
const zoomGroup = $('#ic-zoom');
const compare = $('#ic-compare');
const beforeScroll = $('#ic-before-scroll');
const afterScroll = $('#ic-after-scroll');
const before = $<HTMLCanvasElement>('#ic-before');
const after = $<HTMLImageElement>('#ic-after');
const afterCaption = $('#ic-after-caption');
const edit = $('#ic-edit');
const frame = $('#ic-edit-frame');
const editCanvas = $<HTMLCanvasElement>('#ic-edit-canvas');
const cropBox = $('#ic-crop-box');
const draft = $('#ic-draft');
const stats = $('#ic-stats');
const formatSelect = $<HTMLSelectElement>('#ic-item-format');
const longInput = $<HTMLInputElement>('#ic-item-long');
const autoQuality = $<HTMLInputElement>('#ic-item-auto');
const qualityRange = $<HTMLInputElement>('#ic-item-quality');
const qualityValue = $<HTMLOutputElement>('#ic-item-quality-value');
const qualityNote = $('#ic-quality-note');

let current: Item | null = null;
/** 開いている画像を読み込んだもの。元の画像の表示と、切り抜き・塗りつぶしの画面に使う。 */
let bitmap: ImageBitmap | null = null;
let mode: Mode = 'compare';
let zoom: Zoom = 'fit';
/** 変換後の欄に表示している画像。変わったときだけ URL を作り直す。 */
let shown: { blob: Blob; url: string } | null = null;
let qualityTimer: number | undefined;

const sourceSize = (): Size | null =>
  bitmap ? { width: bitmap.width, height: bitmap.height } : null;

function show(canvas: HTMLCanvasElement, image: OffscreenCanvas) {
  canvas.width = image.width;
  canvas.height = image.height;
  canvas
    .getContext('bitmaprenderer')
    ?.transferFromImageBitmap(image.transferToImageBitmap());
}

/** 変更した画像を変換し直し、一覧と個別の画面を更新する。 */
function changed(item: Item) {
  schedule(item);
  hooks.onChange(item);
  render();
}

/** 表示する大きさ。変換後の画素を基準にし、元の画像も同じ大きさに並べる。 */
function viewSize(): Size | null {
  const source = sourceSize();
  if (!current || !source) return null;
  if (current.result && !isPending(current))
    return { width: current.result.width, height: current.result.height };
  return fitLongSide(
    editedSize(source, current.edits),
    effective(state.settings, current.overrides).longSide,
  );
}

function layoutCompare() {
  const size = viewSize();
  if (!size) return;
  const scale =
    zoom === 'fit'
      ? Math.min(
          1,
          (beforeScroll.clientWidth - 2) / size.width,
          (beforeScroll.clientHeight - 2) / size.height,
        )
      : zoom;
  for (const view of [before, after]) {
    view.style.width = `${Math.max(1, size.width * scale)}px`;
    view.style.height = `${Math.max(1, size.height * scale)}px`;
  }
}

function renderBefore() {
  const source = sourceSize();
  if (!current || !bitmap || !source) return;
  const size = fitPixels(editedSize(source, current.edits), MAX_VIEW_PIXELS);
  show(before, drawEdited(bitmap, current.edits, size, null));
  layoutCompare();
}

function clearAfter() {
  if (shown) URL.revokeObjectURL(shown.url);
  shown = null;
  after.removeAttribute('src');
}

function renderAfter() {
  if (!current) return;
  const pending = isPending(current);
  afterCaption.textContent = pending ? '変換後（計算しています…）' : '変換後';
  compare.classList.toggle('ic-busy', pending);
  const blob = current.result?.blob;
  if (!pending && blob && blob !== shown?.blob) {
    const previous = shown;
    shown = { blob, url: URL.createObjectURL(blob) };
    after.src = shown.url;
    if (previous) URL.revokeObjectURL(previous.url);
  }
  layoutCompare();
}

/** 切り抜く前の画像（回転・塗りつぶしは当てる）を、枠に収めて描く。 */
function renderEditStage() {
  const source = sourceSize();
  if (!current || !bitmap || !source || mode === 'compare') return;
  const full = rotatedSize(source, current.edits.rotation);
  const scale = Math.min(
    1,
    edit.clientWidth / full.width,
    edit.clientHeight / full.height,
  );
  const css = { width: full.width * scale, height: full.height * scale };
  const pixels = fitPixels(
    {
      width: Math.max(
        1,
        Math.min(full.width, Math.round(css.width * devicePixelRatio)),
      ),
      height: Math.max(
        1,
        Math.min(full.height, Math.round(css.height * devicePixelRatio)),
      ),
    },
    MAX_VIEW_PIXELS,
  );
  show(
    editCanvas,
    drawEdited(bitmap, { ...current.edits, crop: null }, pixels, null),
  );
  frame.style.width = `${css.width}px`;
  frame.style.height = `${css.height}px`;
  const crop = current.edits.crop;
  cropBox.hidden = !crop;
  if (crop)
    place(cropBox, rotateRect(crop, source, current.edits.rotation), full);
}

/** 回転した画像の座標の長方形を、枠に対する割合で置く。 */
function place(
  element: HTMLElement,
  rect: { x: number; y: number; width: number; height: number },
  full: Size,
) {
  element.style.left = `${(rect.x / full.width) * 100}%`;
  element.style.top = `${(rect.y / full.height) * 100}%`;
  element.style.width = `${(rect.width / full.width) * 100}%`;
  element.style.height = `${(rect.height / full.height) * 100}%`;
}

function renderStats() {
  if (!current) return;
  const item = current;
  const settings = effective(state.settings, item.overrides);
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
  stats.replaceChildren(
    ...rows.flatMap(([label, value, warning]) => {
      const term = document.createElement('dt');
      term.textContent = label;
      const detail = document.createElement('dd');
      detail.textContent = value;
      detail.classList.toggle('ic-warning', Boolean(warning));
      return [term, detail];
    }),
  );
}

function renderControls() {
  if (!current) return;
  const item = current;
  const settings = effective(state.settings, item.overrides);
  formatSelect.value = item.overrides.format ?? '';
  formatSelect.options[0]!.textContent = `全体の設定に従う（${state.settings.format === 'jpeg' ? 'JPEG' : 'PNG'}）`;
  if (document.activeElement !== longInput)
    longInput.value = item.overrides.longSide?.toString() ?? '';
  longInput.placeholder = `全体：${state.settings.longSide ?? '元のまま'}`;
  const png = settings.format === 'png';
  const auto = item.overrides.quality === undefined;
  autoQuality.checked = auto;
  autoQuality.disabled = png;
  qualityRange.disabled = png || auto;
  if (document.activeElement !== qualityRange) {
    const quality =
      item.overrides.quality ?? item.result?.quality ?? MAX_QUALITY;
    qualityRange.value = String(quality);
  }
  qualityValue.textContent = png ? '—' : qualityRange.value;
  qualityNote.textContent = png
    ? 'PNG は画質の段階がありません。容量を減らすには長い辺を小さくします。'
    : auto && settings.limit === null
      ? `上限がないため、画質 ${MAX_QUALITY} にします。`
      : '';
  for (const [action, disabled] of [
    ['clear-crop', !item.edits.crop],
    ['undo-redact', !item.edits.redactions.length],
    ['save-current', isPending(item) || !item.result],
    ['prev', !neighbor(-1)],
    ['next', !neighbor(1)],
  ] as const)
    dialog.querySelector<HTMLButtonElement>(
      `[data-action="${action}"]`,
    )!.disabled = disabled;
}

function render() {
  if (!current) return;
  title.textContent = current.name;
  title.title = current.source;
  position.textContent = `${state.items.indexOf(current) + 1} / ${state.items.length}`;
  for (const button of dialog.querySelectorAll<HTMLButtonElement>(
    '[data-mode]',
  ))
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  for (const button of zoomGroup.querySelectorAll<HTMLButtonElement>(
    '[data-zoom]',
  ))
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.zoom === String(zoom)),
    );
  zoomGroup.hidden = mode !== 'compare';
  hint.textContent = HINTS[mode];
  compare.hidden = mode !== 'compare';
  edit.hidden = mode === 'compare';
  edit.dataset.mode = mode;
  renderStats();
  renderControls();
  renderAfter();
}

function neighbor(step: 1 | -1) {
  if (!current) return undefined;
  const items = state.items;
  for (
    let index = items.indexOf(current) + step;
    index >= 0 && index < items.length;
    index += step
  )
    if (!items[index]!.error) return items[index];
  return undefined;
}

/** 個別の画面を開く。開いたまま別の画像に切り替えることもできる。 */
export async function openDetail(item: Item) {
  if (item.error) return;
  window.clearTimeout(qualityTimer);
  current = item;
  state.current = item;
  bitmap?.close();
  bitmap = null;
  before.width = before.height = 0;
  editCanvas.width = editCanvas.height = 0;
  clearAfter();
  if (!dialog.open) {
    mode = 'compare';
    zoom = 'fit';
    dialog.showModal();
  }
  render();
  const loaded = await decode(item.file).catch(() => null);
  if (current !== item) {
    loaded?.close();
    return;
  }
  bitmap = loaded;
  renderBefore();
  renderEditStage();
  render();
}

/** 変換が済んだら、開いている画像の表示を更新する。 */
export function refreshDetail(item: Item) {
  if (item !== current) return;
  renderStats();
  renderControls();
  renderAfter();
}

interface Hooks {
  /** 設定・編集を変えたとき（一覧の表示の更新に使う）。 */
  onChange: (item: Item) => void;
  onClose: () => void;
}
let hooks: Hooks = { onChange: () => {}, onClose: () => {} };

function setMode(next: Mode) {
  mode = next;
  render();
  renderEditStage();
}

let dragStart: [number, number] | null = null;
function pointOf(event: PointerEvent): [number, number] {
  const source = sourceSize()!;
  const full = rotatedSize(source, current!.edits.rotation);
  const box = frame.getBoundingClientRect();
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  return [
    clamp((event.clientX - box.left) / box.width) * full.width,
    clamp((event.clientY - box.top) / box.height) * full.height,
  ];
}

function finishDrag(event: PointerEvent) {
  const source = sourceSize();
  if (!dragStart || !current || !source) return;
  const rect = between(dragStart, pointOf(event));
  dragStart = null;
  draft.hidden = true;
  const area = pixelRect(
    unrotateRect(rect, source, current.edits.rotation),
    source,
    4,
  );
  if (!area) return;
  if (mode === 'crop') current.edits.crop = area;
  else current.edits.redactions.push(area);
  changed(current);
  renderBefore();
  renderEditStage();
}

function updateOverrides(update: (item: Item) => void) {
  if (!current) return;
  update(current);
  changed(current);
}

export function setupDetail(next: Hooks) {
  hooks = next;
  dialog.addEventListener('click', (event) => {
    const target = (event.target as Element).closest<HTMLElement>(
      '[data-action], [data-mode], [data-zoom]',
    );
    if (!target || !current) return;
    if (target.dataset.mode) return setMode(target.dataset.mode as Mode);
    if (target.dataset.zoom) {
      zoom =
        target.dataset.zoom === 'fit'
          ? 'fit'
          : (Number(target.dataset.zoom) as Zoom);
      render();
      return;
    }
    const item = current;
    switch (target.dataset.action) {
      case 'close-detail':
        dialog.close();
        break;
      case 'prev':
      case 'next': {
        const other = neighbor(target.dataset.action === 'prev' ? -1 : 1);
        if (other) void openDetail(other);
        break;
      }
      case 'rotate-left':
      case 'rotate-right':
        item.edits.rotation = turn(
          item.edits.rotation,
          target.dataset.action === 'rotate-left' ? -1 : 1,
        );
        changed(item);
        renderBefore();
        renderEditStage();
        break;
      case 'clear-crop':
        item.edits.crop = null;
        changed(item);
        renderBefore();
        renderEditStage();
        break;
      case 'undo-redact':
        item.edits.redactions.pop();
        changed(item);
        renderBefore();
        renderEditStage();
        break;
      case 'reset-item':
        updateOverrides((it) => (it.overrides = {}));
        break;
      case 'save-current':
        if (saveItem(item)) hooks.onChange(item);
        break;
    }
  });
  formatSelect.addEventListener('change', () =>
    updateOverrides((item) => {
      if (formatSelect.value)
        item.overrides.format = formatSelect.value as Format;
      else delete item.overrides.format;
    }),
  );
  longInput.addEventListener('change', () =>
    updateOverrides((item) => {
      const value = parseLongSide(longInput.value);
      if (value === null) delete item.overrides.longSide;
      else item.overrides.longSide = value;
    }),
  );
  autoQuality.addEventListener('change', () =>
    updateOverrides((item) => {
      if (autoQuality.checked) delete item.overrides.quality;
      else item.overrides.quality = item.result?.quality ?? MAX_QUALITY;
    }),
  );
  qualityRange.addEventListener('input', () => {
    qualityValue.textContent = qualityRange.value;
    window.clearTimeout(qualityTimer);
    qualityTimer = window.setTimeout(
      () =>
        updateOverrides(
          (item) => (item.overrides.quality = Number(qualityRange.value)),
        ),
      200,
    );
  });

  frame.addEventListener('pointerdown', (event) => {
    if (mode === 'compare' || !current || !bitmap || event.button !== 0) return;
    event.preventDefault();
    frame.setPointerCapture(event.pointerId);
    dragStart = pointOf(event);
  });
  frame.addEventListener('pointermove', (event) => {
    const source = sourceSize();
    if (!dragStart || !current || !source) return;
    draft.hidden = false;
    place(
      draft,
      between(dragStart, pointOf(event)),
      rotatedSize(source, current.edits.rotation),
    );
  });
  frame.addEventListener('pointerup', finishDrag);
  frame.addEventListener('pointercancel', () => {
    dragStart = null;
    draft.hidden = true;
  });

  // 拡大したときは、元と変換後で同じ場所を表示する。
  for (const [from, to] of [
    [beforeScroll, afterScroll],
    [afterScroll, beforeScroll],
  ] as const)
    from.addEventListener('scroll', () => {
      if (to.scrollLeft !== from.scrollLeft || to.scrollTop !== from.scrollTop)
        to.scrollTo(from.scrollLeft, from.scrollTop);
    });
  new ResizeObserver(() => {
    if (!dialog.open) return;
    layoutCompare();
    renderEditStage();
  }).observe(dialog);

  dialog.addEventListener('close', () => {
    window.clearTimeout(qualityTimer);
    current = null;
    state.current = null;
    bitmap?.close();
    bitmap = null;
    clearAfter();
    hooks.onClose();
  });
}
