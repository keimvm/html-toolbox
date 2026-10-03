import '../../../ui/theme.css';
import './style.css';
import { setupToolHeader } from '../../../ui/header.js';
import { downloadBlob } from '../../../ui/download.js';
import { watchFileDrop } from '../../../ui/file-drop.js';
import licenses from './licenses.txt?raw';
import { openDetail, refreshDetail, setupDetail } from './detail';
import {
  createItem,
  idle,
  isPending,
  onConverted,
  readyItems,
  saveItem,
  schedule,
  state,
  type Item,
} from './items';
import { PdfClient } from './pdf/client';
import type { ShrinkOptions } from './pdf/types';
import {
  baseName,
  formatBytes,
  isPdf,
  mimeType,
  parseLimit,
  parseLongSide,
  type Format,
  type GlobalSettings,
  type LimitUnit,
} from './settings';

function $<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`画面の要素が見つかりません: ${selector}`);
  return element;
}
// 保存した配色を最初に反映する。
setupToolHeader($('.ic-header'));

/** PDF のページを画像にするときの細かさ。長い辺の設定で、ここから縮める。 */
const PAGE_DPI = 200;
/** 「すべて保存」で、ダウンロードを始める間隔（ミリ秒）。 */
const SAVE_INTERVAL = 300;
const SHRINK_PRESETS: Record<string, ShrinkOptions> = {
  high: { dpi: 200, quality: 0.85 },
  standard: { dpi: 150, quality: 0.75 },
  small: { dpi: 100, quality: 0.6 },
};

const main = $('#ic-main');
const empty = $('#ic-empty');
const work = $('#ic-work');
const list = $<HTMLUListElement>('#ic-list');
const summary = $('#ic-summary');
const status = $('#ic-status');
const template = $<HTMLTemplateElement>('#ic-item-template');
const fileInput = $<HTMLInputElement>('#ic-file');
const settingsForm = $<HTMLFormElement>('#ic-settings');
const formatSelect = $<HTMLSelectElement>('#ic-format');
const limitInput = $<HTMLInputElement>('#ic-limit');
const limitUnit = $<HTMLSelectElement>('#ic-limit-unit');
const longInput = $<HTMLInputElement>('#ic-long');
const pdfDialog = $<HTMLDialogElement>('#ic-pdf');
const pdfMessage = $('#ic-pdf-message');
const shrinkDialog = $<HTMLDialogElement>('#ic-shrink');
const shrinkInput = $<HTMLInputElement>('#ic-shrink-file');
const shrinkName = $('#ic-shrink-name');
const shrinkPreset = $<HTMLSelectElement>('#ic-shrink-preset');
const shrinkResult = $('#ic-shrink-result');
const about = $<HTMLDialogElement>('#ic-about');

const elements = new Map<Item, HTMLLIElement>();
let pdfClient: PdfClient | null = null;
/** PDF の処理（PDFium と日本語フォント）は、最初に使うときに読み込む。 */
const pdf = () => (pdfClient ??= new PdfClient());
const message = (error: unknown) =>
  error instanceof Error ? error.message : '';

let combined: { blob: Blob; saved: boolean } | null = null;
let shrinkFile: File | null = null;
let shrunk: { blob: Blob; saved: boolean } | null = null;
let shrinking = false;
let pdfSequence = 0;

function button(root: ParentNode, action: string) {
  return root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
}

// 全体の設定 --------------------------------------------------------------

function showSettings(settings: GlobalSettings) {
  formatSelect.value = settings.format;
  limitUnit.value = 'MB';
  limitInput.value =
    settings.limit === null ? '' : String(settings.limit / 1_000_000);
  longInput.value = settings.longSide?.toString() ?? '';
}

function readSettings(): GlobalSettings {
  return {
    format: formatSelect.value as Format,
    limit: parseLimit(limitInput.value, limitUnit.value as LimitUnit),
    longSide: parseLongSide(longInput.value),
  };
}

let settingsTimer: number | undefined;
function applySettings() {
  window.clearTimeout(settingsTimer);
  const next = readSettings();
  const previous = state.settings;
  if (
    next.format === previous.format &&
    next.limit === previous.limit &&
    next.longSide === previous.longSide
  )
    return;
  state.settings = next;
  for (const item of state.items) {
    schedule(item);
    renderItem(item);
  }
  renderSummary();
}
settingsForm.addEventListener('input', () => {
  window.clearTimeout(settingsTimer);
  settingsTimer = window.setTimeout(applySettings, 400);
});
settingsForm.addEventListener('change', applySettings);
settingsForm.addEventListener('submit', (event) => {
  event.preventDefault();
  applySettings();
});

// 一覧 ------------------------------------------------------------------

function renderItem(item: Item) {
  const element = elements.get(item);
  if (!element) return;
  const pending = isPending(item);
  const result = item.result;
  const image = element.querySelector('img')!;
  if (!item.thumbnailUrl) image.removeAttribute('src');
  else if (image.getAttribute('src') !== item.thumbnailUrl)
    image.src = item.thumbnailUrl;
  element.querySelector('.ic-item-name')!.textContent = item.name;
  element.querySelector<HTMLElement>('.ic-item-name')!.title = item.source;
  element.querySelector('.ic-item-source')!.textContent =
    `元：${item.size ? `${item.size.width} × ${item.size.height} px・` : ''}${formatBytes(item.file.size)}`;
  const line = element.querySelector('.ic-item-result')!;
  const over = !pending && !item.error && result?.fits === false;
  if (item.error) line.textContent = item.error;
  else if (pending || !result) line.textContent = '計算しています…';
  else
    line.textContent = `変換後：${result.width} × ${result.height} px・${formatBytes(result.blob.size)}・${result.quality === null ? 'PNG' : `JPEG 画質 ${result.quality}`}${over ? '・上限を超えています' : ''}${item.saved ? '・保存済み' : ''}`;
  element.classList.toggle('ic-over', over);
  element.classList.toggle('ic-error', Boolean(item.error));
  element.classList.toggle('ic-pending', pending);
  for (const open of element.querySelectorAll<HTMLButtonElement>(
    '[data-action="open"]',
  )) {
    open.disabled = Boolean(item.error);
    open.setAttribute('aria-label', `「${item.name}」を確かめる・直す`);
  }
  button(element, 'save').disabled = pending || !result || Boolean(item.error);
  const remove = button(element, 'remove');
  remove.setAttribute('aria-label', `「${item.name}」を一覧から外す`);
  remove.title = '一覧から外す';
}

function renderSummary() {
  const items = state.items;
  empty.hidden = items.length > 0;
  work.hidden = items.length === 0;
  const usable = items.filter((item) => !item.error);
  const ready = readyItems();
  const waiting = items.filter(isPending).length;
  const over = ready.filter((item) => item.result?.fits === false).length;
  const errors = items.length - usable.length;
  const parts: [string, string?][] = [
    [
      `${items.length} 枚・元の合計 ${formatBytes(usable.reduce((sum, item) => sum + item.file.size, 0))} → 変換後 ${formatBytes(ready.reduce((sum, item) => sum + item.result!.blob.size, 0))}`,
    ],
  ];
  if (waiting) parts.push([`${waiting} 枚を計算中`]);
  if (over) parts.push([`上限を超えた画像 ${over} 枚`, 'ic-warning']);
  if (errors) parts.push([`開けないファイル ${errors} 件`, 'ic-warning']);
  summary.replaceChildren(
    ...parts.map(([text, className]) => {
      const span = document.createElement('span');
      span.textContent = text;
      if (className) span.className = className;
      return span;
    }),
  );
  const none = usable.length === 0;
  button(work, 'save-all').disabled = none;
  button(work, 'make-pdf').disabled = none;
}

function addItem(file: Blob, name: string, source: string, outputBase: string) {
  const item = createItem(file, name, source, outputBase);
  const element = template.content.firstElementChild!.cloneNode(
    true,
  ) as HTMLLIElement;
  elements.set(item, element);
  state.items.push(item);
  list.append(element);
  schedule(item);
  renderItem(item);
}

async function addPdf(file: File) {
  const id = `pdf-${++pdfSequence}`;
  const label = `「${file.name}」`;
  status.textContent = `${label}を読み込んでいます…`;
  try {
    const client = pdf();
    const count = await client.call('open', {
      id,
      content: await file.arrayBuffer(),
    });
    try {
      const digits = Math.max(2, String(count).length);
      for (let index = 0; index < count; index++) {
        status.textContent = `${label}のページを画像にしています（${index + 1} / ${count}）`;
        const blob = await client.call('render', { id, index, dpi: PAGE_DPI });
        const base = `${baseName(file.name)}-p${String(index + 1).padStart(digits, '0')}`;
        addItem(
          blob,
          `${base}.png`,
          `${file.name} の ${index + 1} ページ`,
          base,
        );
        renderSummary();
      }
    } finally {
      await client.call('close', { id }).catch(() => false);
    }
    status.textContent = `${label}の ${count} ページを一覧に加えました。`;
  } catch (error) {
    status.textContent = `${label}を開けません。${message(error)}`;
  }
}

let adding: Promise<void> = Promise.resolve();
function addFiles(files: File[]) {
  adding = adding.then(async () => {
    for (const file of files) {
      if (isPdf(file)) await addPdf(file);
      else {
        status.textContent = '';
        addItem(file, file.name, file.name, `${baseName(file.name)}-変換`);
      }
    }
    renderSummary();
  });
}

function removeItem(item: Item) {
  state.items = state.items.filter((other) => other !== item);
  elements.get(item)?.remove();
  elements.delete(item);
  if (item.thumbnailUrl) URL.revokeObjectURL(item.thumbnailUrl);
  renderSummary();
}

const hasUnsaved = () =>
  state.items.some((item) => !item.error && !item.saved) ||
  Boolean(combined && !combined.saved && pdfDialog.open) ||
  Boolean(shrunk && !shrunk.saved && shrinkDialog.open);

async function saveAll() {
  const saveButton = button(work, 'save-all');
  saveButton.disabled = true;
  try {
    status.textContent = '変換が終わるのを待っています…';
    await idle();
    const ready = readyItems();
    for (const [index, item] of ready.entries()) {
      saveItem(item);
      renderItem(item);
      if (index < ready.length - 1)
        await new Promise((resolve) => setTimeout(resolve, SAVE_INTERVAL));
    }
    status.textContent = ready.length
      ? `${ready.length} 枚の保存を始めました。ブラウザーが複数のファイルのダウンロードを確かめたら、許可してください。`
      : '保存できる画像がありません。';
  } finally {
    renderSummary();
  }
}

function clearAll() {
  if (
    state.items.some((item) => !item.error && !item.saved) &&
    !window.confirm(
      '一覧の画像をすべて消しますか？保存していない変換結果は失われます。元のファイルは消えません。',
    )
  )
    return;
  for (const item of [...state.items]) removeItem(item);
  status.textContent = '';
}

// PDF にまとめる ------------------------------------------------------------

async function makePdf() {
  combined = null;
  const saveButton = button(pdfDialog, 'save-pdf');
  saveButton.disabled = true;
  pdfMessage.textContent = '変換が終わるのを待っています…';
  pdfDialog.showModal();
  try {
    await idle();
    const ready = readyItems();
    if (!ready.length) {
      pdfMessage.textContent = 'PDFにできる画像がありません。';
      return;
    }
    pdfMessage.textContent = `${ready.length} ページの PDF を作っています…`;
    const images = await Promise.all(
      ready.map(async (item) => ({
        data: await item.result!.blob.arrayBuffer(),
        type: mimeType(item.result!.format),
        width: item.result!.width,
        height: item.result!.height,
      })),
    );
    const content = await pdf().call('create', { images });
    if (!pdfDialog.open) return;
    combined = {
      blob: new Blob([content], { type: 'application/pdf' }),
      saved: false,
    };
    pdfMessage.textContent = `${ready.length} ページ・${formatBytes(content.byteLength)} の PDF ができました。`;
    saveButton.disabled = false;
  } catch (error) {
    pdfMessage.textContent = `PDFを作れませんでした。${message(error)}`;
  }
}

// PDF を小さくする ----------------------------------------------------------

function renderShrink() {
  shrinkName.textContent = shrinkFile
    ? `${shrinkFile.name}（${formatBytes(shrinkFile.size)}）`
    : '選ぶか、ここにドロップします';
  button(shrinkDialog, 'run-shrink').disabled = !shrinkFile || shrinking;
  button(shrinkDialog, 'choose-shrink').disabled = shrinking;
  shrinkPreset.disabled = shrinking;
  button(shrinkDialog, 'save-shrink').disabled = !shrunk || shrinking;
}

function setShrinkFile(file: File | undefined) {
  if (!file || shrinking) return;
  if (!isPdf(file)) {
    shrinkResult.textContent = 'PDF を選んでください。';
    return;
  }
  shrinkFile = file;
  shrunk = null;
  shrinkResult.textContent = '';
  renderShrink();
}

async function runShrink() {
  const file = shrinkFile;
  if (!file || shrinking) return;
  shrinking = true;
  shrunk = null;
  renderShrink();
  shrinkResult.textContent =
    '小さくしています…（ページや画像が多いと時間がかかります）';
  try {
    const result = await pdf().call('shrink', {
      content: await file.arrayBuffer(),
      options: SHRINK_PRESETS[shrinkPreset.value] ?? SHRINK_PRESETS.standard!,
    });
    const size = result.content.byteLength;
    const sizes = `${formatBytes(file.size)} → ${formatBytes(size)}`;
    if (!result.replaced)
      shrinkResult.textContent = result.images
        ? `縮められる画像がありませんでした（画像 ${result.images} 個）。透過のある画像や、すでに十分小さい画像は元のまま残します。`
        : 'ページに画像がないため、小さくできません。';
    else if (size >= file.size)
      shrinkResult.textContent = `${sizes}。小さくなりませんでした。`;
    else {
      shrunk = {
        blob: new Blob([result.content], { type: 'application/pdf' }),
        saved: false,
      };
      shrinkResult.textContent = `${sizes}（${Math.round((1 - size / file.size) * 100)}% 減）。画像 ${result.images} 個のうち ${result.replaced} 個を縮めました。`;
    }
  } catch (error) {
    shrinkResult.textContent = `小さくできませんでした。${message(error)}`;
  } finally {
    shrinking = false;
    renderShrink();
  }
}

// ファイルの受け付け ---------------------------------------------------------

let stopDrop = () => {};
/** ドロップを受け付ける場所を切り替える。zone がなければ受け付けない（落としても画面は離れない）。 */
function acceptDrop(zone?: Element, onDrop?: (files: File[]) => void) {
  stopDrop();
  stopDrop = watchFileDrop({
    zone,
    onDrop:
      onDrop &&
      ((files) => {
        if (files) onDrop(files);
        else
          status.textContent =
            'フォルダはドロップできません。ファイルを選んでください。';
      }),
  });
}
const acceptList = () => acceptDrop(main, addFiles);
acceptList();

fileInput.addEventListener('change', () => {
  addFiles(Array.from(fileInput.files ?? []));
  fileInput.value = '';
});
shrinkInput.addEventListener('change', () => {
  setShrinkFile(shrinkInput.files?.[0]);
  shrinkInput.value = '';
});
shrinkPreset.addEventListener('change', () => {
  shrunk = null;
  shrinkResult.textContent = '';
  renderShrink();
});

for (const dialog of [pdfDialog, shrinkDialog, about])
  dialog.addEventListener('close', acceptList);
shrinkDialog.addEventListener('cancel', (event) => {
  if (shrinking) event.preventDefault();
});

document.addEventListener('click', (event) => {
  const target = (event.target as Element).closest<HTMLElement>(
    '[data-action]',
  );
  if (!target || target.closest('#ic-detail')) return;
  const element = target.closest<HTMLLIElement>('.ic-item');
  const item = element
    ? [...elements].find(([, value]) => value === element)?.[0]
    : undefined;
  switch (target.dataset.action) {
    case 'add':
      fileInput.click();
      break;
    case 'open':
      if (item) {
        acceptDrop();
        void openDetail(item);
      }
      break;
    case 'save':
      if (item && saveItem(item)) renderItem(item);
      break;
    case 'remove':
      if (item) removeItem(item);
      break;
    case 'save-all':
      void saveAll();
      break;
    case 'clear':
      clearAll();
      break;
    case 'make-pdf':
      acceptDrop();
      void makePdf();
      break;
    case 'save-pdf':
      if (combined) {
        downloadBlob(combined.blob, '画像まとめ.pdf');
        combined.saved = true;
      }
      break;
    case 'close-pdf':
      pdfDialog.close();
      break;
    case 'open-shrink':
      shrinkDialog.showModal();
      acceptDrop(shrinkDialog, (files) => {
        if (files.length !== 1)
          shrinkResult.textContent = 'PDF を1つだけドロップしてください。';
        else setShrinkFile(files[0]);
      });
      renderShrink();
      break;
    case 'choose-shrink':
      shrinkInput.click();
      break;
    case 'run-shrink':
      void runShrink();
      break;
    case 'save-shrink':
      if (shrunk && shrinkFile) {
        downloadBlob(shrunk.blob, `${baseName(shrinkFile.name)}-縮小.pdf`);
        shrunk.saved = true;
      }
      break;
    case 'close-shrink':
      if (!shrinking) shrinkDialog.close();
      break;
    case 'about':
      $('#ic-licenses').textContent = licenses;
      acceptDrop();
      about.showModal();
      break;
    case 'close-about':
      about.close();
      break;
  }
});

setupDetail({
  onChange: (item) => {
    renderItem(item);
    renderSummary();
  },
  onClose: acceptList,
});
onConverted((item) => {
  renderItem(item);
  renderSummary();
  refreshDetail(item);
});

window.addEventListener('beforeunload', (event) => {
  if (hasUnsaved()) event.preventDefault();
});

showSettings(state.settings);
renderSummary();
