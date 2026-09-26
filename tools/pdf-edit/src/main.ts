import '../../../ui/theme.css';
import './style.css';
import { downloadBlob } from '../../../ui/download.js';
import { watchFileDrop } from '../../../ui/file-drop.js';
import { Editor, type EditorPage } from './editor';
import { renderIcons } from './icons';
import { PdfClient } from './pdf/client';
import type { Inspection, PageElement } from './pdf/types';
import type { PdfDocumentObject } from '@embedpdf/models';
import { createSamplePdf } from './sample';
import {
  currentPreviewPage,
  isPreviewZoom,
  previewWidth,
  stepZoom,
  type PreviewZoom,
} from './preview';
import { SessionStore } from './session-store';
import { sessionKey } from '../../../ui/session-key.js';
import licenses from './licenses.txt?raw';

function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`画面の要素が見つかりません: ${selector}`);
  return element;
}
const editor = new Editor();
let client: PdfClient | undefined;
const pdf = () => (client ??= new PdfClient());
const sources = new Map<
  string,
  { doc: PdfDocumentObject; name: string; data: Blob }
>();
const session = new SessionStore(sessionKey(location.href));
let restoring = true;
let recoveryReady = false;
let recoveryRevision = 0;
let zoom: PreviewZoom = 100;
let filename = '';
let busy = false;
let inspecting = false;
let kind = 'images';
let inspection: Inspection | undefined;
let selectedElement: number | undefined;
let inspectorVersion = 0;
let imageUrl: string | undefined;
const thumbnailUrls = new Map<string, string>();
const thumbnailPending = new Set<string>();
const input = $<HTMLInputElement>('#pc-file-input');
const saveDialog = $<HTMLDialogElement>('#pc-save-dialog');
const stage = $('.pc-stage');
interface PreviewPage {
  page: EditorPage;
  element: HTMLElement;
  paper: HTMLElement;
  visible: boolean;
  pending: boolean;
  revision: number;
  url?: string;
}
const previews = new Map<string, PreviewPage>();
let selectedScrollTop: number | undefined;

function notify(message: string) {
  $('#pc-notice').hidden = false;
  $('#pc-notice-text').textContent = message;
}
function fail(error: unknown) {
  notify(
    error instanceof Error ? error.message : 'PDFを処理できませんでした。',
  );
}
function recoveryStatus(state: 'saving' | 'saved' | 'error') {
  const status = $('#pc-session-status');
  status.dataset.state = state;
  status.textContent =
    state === 'saving'
      ? '復元用に保存中…'
      : state === 'saved'
        ? '再読み込みに対応'
        : '復元用の保存に失敗';
  status.title =
    'このブラウザー内に復元用データを保存します。「閉じる」で削除します。';
}
function rememberSession() {
  if (restoring || !editor.pages.length) return;
  const revision = ++recoveryRevision;
  recoveryReady = false;
  recoveryStatus('saving');
  void session
    .save(
      {
        version: 1,
        filename,
        editor: editor.snapshot(),
        zoom,
        sourceIds: [...sources.keys()],
      },
      [...sources].map(([id, source]) => ({
        id,
        name: source.name,
        data: source.data,
      })),
    )
    .then(() => {
      if (revision !== recoveryRevision) return;
      recoveryReady = true;
      recoveryStatus('saved');
    })
    .catch(() => {
      if (revision !== recoveryRevision) return;
      recoveryStatus('error');
      notify(
        '復元用データをブラウザーに保存できません。画面を再読み込みする前に「PDFを保存」で残してください。',
      );
    });
}

async function restoreSession() {
  await task('前回のPDFを確認しています…', async () => {
    try {
      const saved = await session.load();
      if (!saved) {
        $('#pc-notice').hidden = true;
        return;
      }
      for (const source of saved.sources) {
        const doc = await pdf().call('open', {
          id: source.id,
          content: await source.data.arrayBuffer(),
        });
        sources.set(source.id, { doc, name: source.name, data: source.data });
      }
      const state = saved.state.editor;
      const pages = [
        ...state.pages,
        ...state.initialPages,
        ...state.history.flatMap((entry) => entry.pages),
      ];
      if (
        pages.some(
          (page) => !sources.get(page.sourceId)?.doc.pages[page.sourceIndex],
        )
      )
        throw new Error('復元用データのページが一致しません。');
      editor.restore(state);
      filename = saved.state.filename;
      zoom = saved.state.zoom;
      render();
      recoveryReady = true;
      recoveryStatus('saved');
      notify('前回のPDFと編集状態を復元しました。');
    } catch (error) {
      for (const id of sources.keys())
        await pdf()
          .call('close', { id })
          .catch(() => {});
      sources.clear();
      editor.open([]);
      render();
      recoveryStatus('error');
      notify(
        `前回のPDFを復元できませんでした。PDFを開き直してください。${error instanceof Error ? error.message : ''}`,
      );
    } finally {
      restoring = false;
    }
  });
}
function setDisabled(action: string, disabled: boolean) {
  const button = document.querySelector<HTMLButtonElement>(
    `[data-action="${action}"]`,
  );
  if (button) button.disabled = disabled || busy;
}
function updateControls() {
  const empty = !editor.pages.length;
  const index = editor.selectedIndex;
  $('#pc-workbench').hidden = empty;
  $('#pc-empty').hidden = !empty;
  $('.pc-file').hidden = empty;
  $('[data-action="close-document"]').hidden = empty;
  $('[data-action="add"]').hidden = empty;
  $('[data-action="save"]').hidden = empty;
  $('#pc-file-count').textContent = `${editor.pages.length}ページ`;
  $('#pc-rail-count').textContent = String(editor.pages.length);
  $('#pc-change-status').textContent = busy
    ? '処理中…'
    : editor.changed
      ? '未保存の変更'
      : '変更なし';
  $('#pc-change-status').classList.toggle('pc-unsaved', editor.changed);
  $('.pc-filename').textContent = filename;
  $('#pc-empty').setAttribute('aria-busy', String(busy));
  $('#pc-workbench').setAttribute('aria-busy', String(busy));
  for (const action of ['open', 'sample', 'add', 'close-document'])
    setDisabled(action, false);
  for (const action of ['save', 'rotate', 'inspect', 'confirm-save'])
    setDisabled(action, empty);
  setDisabled('delete', editor.pages.length < 2);
  setDisabled('undo', !editor.canUndo);
  for (const action of ['move-up', 'previous']) setDisabled(action, index <= 0);
  for (const action of ['move-down', 'next'])
    setDisabled(action, index >= editor.pages.length - 1);
  document
    .querySelectorAll<HTMLButtonElement>('[data-page]')
    .forEach((button) => (button.disabled = busy));
  updateZoomControls();
}
async function task(message: string, operation: () => Promise<void>) {
  if (busy) return;
  busy = true;
  updateControls();
  notify(message);
  try {
    await operation();
  } catch (error) {
    fail(error);
  } finally {
    busy = false;
    updateControls();
    syncPreviewSelection();
  }
}
function size(page: EditorPage) {
  const original = sources.get(page.sourceId)!.doc.pages[page.sourceIndex]!;
  // 読み込み時に回転を正規化し、表示には元の回転と追加分を使う。
  return page.rotation % 180
    ? { width: original.size.height, height: original.size.width }
    : original.size;
}
function thumbnailKey(page: EditorPage) {
  return `${page.id}:${page.rotation}`;
}
const thumbnailObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries)
      if (entry.isIntersecting) {
        thumbnailObserver.unobserve(entry.target);
        const button = entry.target as HTMLButtonElement;
        const page = editor.pages.find(
          (page) => page.id === button.dataset.page,
        );
        if (page) void loadThumbnail(page, button);
      }
  },
  { rootMargin: '80px' },
);
async function loadThumbnail(page: EditorPage, button: HTMLButtonElement) {
  const key = thumbnailKey(page);
  const cached = thumbnailUrls.get(key);
  if (cached) {
    fillThumbnail(button, cached);
    return;
  }
  if (thumbnailPending.has(key)) return;
  thumbnailPending.add(key);
  try {
    const blob = await pdf().call('render', {
      page,
      scale: 110 / Math.max(size(page).width, size(page).height),
    });
    if (!sources.has(page.sourceId)) return;
    const url = URL.createObjectURL(blob);
    thumbnailUrls.set(key, url);
    document
      .querySelectorAll<HTMLButtonElement>('[data-page]')
      .forEach((current) => {
        if (current.dataset.key === key) fillThumbnail(current, url);
      });
  } catch {
    button
      .querySelector('.pc-mini')
      ?.setAttribute('aria-label', 'プレビューを作成できません');
  } finally {
    thumbnailPending.delete(key);
  }
}
function fillThumbnail(button: HTMLButtonElement, url: string) {
  const image = document.createElement('img');
  image.src = url;
  image.alt = '';
  button.querySelector('.pc-mini')?.replaceChildren(image);
}
function renderPages() {
  const focusedId = (document.activeElement as HTMLElement | null)?.dataset
    .page;
  thumbnailObserver.disconnect();
  const fragment = document.createDocumentFragment();
  editor.pages.forEach((page, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pc-page';
    button.dataset.page = page.id;
    button.dataset.key = thumbnailKey(page);
    button.draggable = true;
    button.setAttribute('aria-pressed', String(page.id === editor.selectedId));
    button.setAttribute('aria-label', `${index + 1}ページ目`);
    const source = sources.get(page.sourceId)!;
    button.title = `${source.name} / 元の${page.sourceIndex + 1}ページ目`;
    button.innerHTML = `<span class="pc-mini" aria-hidden="true"></span><span class="pc-page-label"><span class="pc-page-number">${index + 1}</span><span class="pc-page-title">ページ</span></span>`;
    fragment.append(button);
    const cached = thumbnailUrls.get(thumbnailKey(page));
    if (cached) fillThumbnail(button, cached);
    else thumbnailObserver.observe(button);
  });
  $('#pc-pages').replaceChildren(fragment);
  if (focusedId)
    document
      .querySelector<HTMLButtonElement>(`[data-page="${editor.selectedId}"]`)
      ?.focus({ preventScroll: true });
}
function updateSelection() {
  updateControls();
  const page = editor.selected;
  inspectorVersion++;
  inspection = undefined;
  selectedElement = undefined;
  document.querySelectorAll<HTMLElement>('[data-page]').forEach((button) => {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.page === page?.id),
    );
  });
  for (const preview of previews.values())
    preview.element.setAttribute(
      'aria-current',
      preview.page.id === page?.id ? 'page' : 'false',
    );
  highlight();
  if (!page) return;
  $('#pc-page-position').textContent =
    `${editor.selectedIndex + 1} / ${editor.pages.length}`;
  if (inspecting) void loadInspection();
}
function scrollToSelectedPreview() {
  const preview = previews.get(editor.selectedId);
  if (!preview) return;
  stage.scrollTop +=
    preview.element.getBoundingClientRect().top -
    stage.getBoundingClientRect().top -
    parseFloat(getComputedStyle(stage).paddingTop);
  // 末尾で位置が制限されても、一覧や送りボタンで選んだページを保つ。
  selectedScrollTop = stage.scrollTop;
}
function selectPage(id: string, scroll = true) {
  if (id !== editor.selectedId) {
    editor.select(id);
    updateSelection();
    rememberSession();
    const button = document.querySelector<HTMLElement>(`[data-page="${id}"]`);
    if (button) {
      const rail = $('.pc-rail');
      const bounds = button.getBoundingClientRect();
      const railBounds = rail.getBoundingClientRect();
      if (bounds.top < railBounds.top)
        rail.scrollTop += bounds.top - railBounds.top;
      else if (bounds.bottom > railBounds.bottom)
        rail.scrollTop += bounds.bottom - railBounds.bottom;
      const pages = $('#pc-pages');
      const pagesBounds = pages.getBoundingClientRect();
      if (bounds.left < pagesBounds.left)
        pages.scrollLeft += bounds.left - pagesBounds.left;
      else if (bounds.right > pagesBounds.right)
        pages.scrollLeft += bounds.right - pagesBounds.right;
    }
  }
  if (scroll) scrollToSelectedPreview();
}
function effectiveZoom() {
  const preview = previews.get(editor.selectedId);
  return zoom === 'fit' && preview
    ? (preview.paper.clientWidth / ((size(preview.page).width * 96) / 72)) * 100
    : zoom === 'fit'
      ? 100
      : zoom;
}
function updateZoomControls() {
  const percent = effectiveZoom();
  setDisabled('zoom-out', !editor.pages.length || percent <= 25);
  setDisabled('zoom-in', !editor.pages.length || percent >= 300);
  const select = $<HTMLSelectElement>('#pc-zoom');
  select.value = String(zoom);
  select.disabled = busy || !editor.pages.length;
}
function layoutPreviews() {
  const style = getComputedStyle(stage);
  const available =
    stage.clientWidth -
    parseFloat(style.paddingLeft) -
    parseFloat(style.paddingRight);
  for (const preview of previews.values()) {
    const width = previewWidth(size(preview.page).width, available, zoom);
    if (Math.abs(parseFloat(preview.element.style.width) - width) < 0.1)
      continue;
    preview.element.style.width = `${width}px`;
    preview.revision++;
    clearPreviewImage(preview);
    if (preview.visible) void loadPreview(preview);
  }
  updateZoomControls();
}
function setZoom(value: PreviewZoom) {
  if (busy || !editor.pages.length || value === zoom) return;
  const preview = previews.get(editor.selectedId)!;
  const oldBounds = preview.paper.getBoundingClientRect();
  const viewport = stage.getBoundingClientRect();
  const y = (viewport.top - oldBounds.top) / oldBounds.height;
  const centerX = viewport.left + stage.clientWidth / 2;
  const x = (centerX - oldBounds.left) / oldBounds.width;
  zoom = value;
  layoutPreviews();
  const bounds = preview.paper.getBoundingClientRect();
  stage.scrollTop += bounds.top + bounds.height * y - viewport.top;
  stage.scrollLeft += bounds.left + bounds.width * x - centerX;
  selectedScrollTop = stage.scrollTop;
  rememberSession();
}
function clearPreviewImage(preview: PreviewPage) {
  if (preview.url) URL.revokeObjectURL(preview.url);
  preview.url = undefined;
  preview.paper.innerHTML =
    '<span class="pc-loading">ページを表示しています…</span>';
}
const previewObserver = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const id = (entry.target as HTMLElement).dataset.previewPage!;
      const preview = previews.get(id);
      if (!preview || preview.element !== entry.target) continue;
      preview.visible = entry.isIntersecting;
      if (preview.visible) void loadPreview(preview);
      else clearPreviewImage(preview);
    }
  },
  { root: stage, rootMargin: '600px 0px' },
);
async function loadPreview(preview: PreviewPage) {
  if (preview.url || preview.pending) return;
  preview.pending = true;
  const revision = preview.revision;
  try {
    const dimensions = size(preview.page);
    const blob = await pdf().call('render', {
      page: preview.page,
      scale: Math.min(
        4,
        (preview.paper.clientWidth / dimensions.width) *
          Math.min(devicePixelRatio, 2),
      ),
    });
    if (
      previews.get(preview.page.id) !== preview ||
      !preview.visible ||
      revision !== preview.revision
    )
      return;
    preview.url = URL.createObjectURL(blob);
    const image = document.createElement('img');
    image.src = preview.url;
    image.alt = preview.element.getAttribute('aria-label')! + 'のプレビュー';
    image.className = 'pc-rendered-page';
    preview.paper.replaceChildren(image);
    if (preview.page.id === editor.selectedId) highlight();
  } catch (error) {
    if (
      previews.get(preview.page.id) === preview &&
      preview.visible &&
      revision === preview.revision
    ) {
      preview.paper.textContent = 'ページを表示できませんでした。';
      fail(error);
    }
  } finally {
    preview.pending = false;
    if (
      previews.get(preview.page.id) === preview &&
      preview.visible &&
      revision !== preview.revision
    )
      void loadPreview(preview);
  }
}
function render() {
  renderPages();
  previewObserver.disconnect();
  for (const preview of previews.values()) clearPreviewImage(preview);
  previews.clear();
  const fragment = document.createDocumentFragment();
  editor.pages.forEach((page, index) => {
    const dimensions = size(page);
    const element = document.createElement('section');
    element.className = 'pc-preview-page';
    element.dataset.previewPage = page.id;
    element.setAttribute('aria-label', `${index + 1}ページ目`);
    const meta = document.createElement('div');
    meta.className = 'pc-view-meta';
    meta.innerHTML = `<span>${index + 1}ページ目</span><span>${Math.round((dimensions.width * 25.4) / 72)} × ${Math.round((dimensions.height * 25.4) / 72)} mm</span>`;
    const paper = document.createElement('div');
    paper.className = 'pc-preview';
    paper.style.aspectRatio = `${dimensions.width} / ${dimensions.height}`;
    element.append(meta, paper);
    const preview: PreviewPage = {
      page: { ...page },
      element,
      paper,
      visible: false,
      pending: false,
      revision: 0,
    };
    clearPreviewImage(preview);
    previews.set(page.id, preview);
    fragment.append(element);
  });
  stage.replaceChildren(fragment);
  updateSelection();
  layoutPreviews();
  scrollToSelectedPreview();
  for (const preview of previews.values())
    previewObserver.observe(preview.element);
  rememberSession();
}
let scrollFrame = 0;
function syncPreviewSelection() {
  if (busy || !editor.pages.length) return;
  if (stage.scrollTop === selectedScrollTop) return;
  selectedScrollTop = undefined;
  const entries = [...previews.values()];
  const index = currentPreviewPage(
    entries.map((preview) => preview.element.getBoundingClientRect()),
    stage.getBoundingClientRect(),
    stage.scrollTop > 0 &&
      stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 1,
  );
  const preview = entries[index];
  if (preview) selectPage(preview.page.id, false);
}
stage.addEventListener('scroll', () => {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    syncPreviewSelection();
  });
});
let resizeFrame = 0;
new ResizeObserver(() => {
  if (zoom !== 'fit' || resizeFrame) return;
  // スクロールバーの出入りで領域が変わるため、同じ通知内で寸法を変更しない。
  resizeFrame = requestAnimationFrame(() => {
    resizeFrame = 0;
    if (zoom !== 'fit') return;
    layoutPreviews();
    scrollToSelectedPreview();
  });
}).observe(stage);
async function loadInspection() {
  const page = editor.selected;
  if (!page) return;
  const version = ++inspectorVersion;
  $('#pc-inspector-content').textContent = '画像・文字を確認しています…';
  try {
    const result = await pdf().call('inspect', { page: { ...page } });
    if (version !== inspectorVersion || !inspecting) return;
    inspection = result;
    renderInspector();
  } catch (error) {
    if (version === inspectorVersion) {
      $('#pc-inspector-content').textContent =
        'このページの情報を取得できませんでした。';
      fail(error);
    }
  }
}
function number(value: number) {
  return value.toLocaleString('ja-JP', { maximumFractionDigits: 1 });
}
function renderInspector() {
  document
    .querySelectorAll<HTMLElement>('[data-kind]')
    .forEach((button) =>
      button.setAttribute('aria-pressed', String(button.dataset.kind === kind)),
    );
  const content = $('#pc-inspector-content');
  if (!inspection) return;
  const { elements, text } = inspection;
  if (kind === 'text') {
    selectedElement = undefined;
    content.innerHTML = text.trim()
      ? '<p class="pc-inspector-caption">このページの文字</p><textarea class="pc-text" id="pc-extracted-text" aria-label="取り出した文字" readonly></textarea><button type="button" class="tb-button tb-secondary pc-full" data-action="extract-text"><i data-lucide="download"></i>テキストを保存</button>'
      : '<p class="pc-inspector-caption">取り出せる文字情報がありません。スキャン画像の文字認識には対応していません。</p>';
    if (text.trim()) $<HTMLTextAreaElement>('#pc-extracted-text').value = text;
  } else if (kind === 'elements') {
    content.innerHTML =
      '<p class="pc-inspector-caption">ページ直下の要素。グループ内は含みません。</p><div class="pc-elements"></div>';
    const list = content.querySelector('.pc-elements')!;
    if (!elements.length) list.textContent = '要素が見つかりませんでした。';
    for (const element of elements) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pc-element';
      button.dataset.element = String(element.index);
      button.setAttribute(
        'aria-pressed',
        String(selectedElement === element.index),
      );
      button.textContent = `${element.index + 1} ${element.type}`;
      list.append(button);
    }
  } else {
    const images = elements.filter((element) => element.image);
    if (!images.some((image) => image.index === selectedElement))
      selectedElement = images[0]?.index;
    const element = images.find((image) => image.index === selectedElement);
    const info = element?.image;
    if (!element || !info) {
      content.innerHTML =
        '<p class="pc-inspector-caption">ページ直下に取り出せる画像がありません。グループ内の画像は対象外です。</p>';
      highlight();
      return;
    }
    content.innerHTML = `<p class="pc-inspector-caption">このページの画像 ${images.length}点</p><label class="pc-field">画像<select class="tb-input" id="pc-image-select">${images.map((image, index) => `<option value="${image.index}" ${image.index === selectedElement ? 'selected' : ''}>画像 ${index + 1}</option>`).join('')}</select></label><div class="pc-image-preview" id="pc-image-preview">プレビューを作成しています…</div><dl class="pc-details"><div><dt>ピクセル数</dt><dd>${number(info.width)} × ${number(info.height)} px</dd></div><div><dt>配置サイズ</dt><dd>${number(info.widthMm)} × ${number(info.heightMm)} mm</dd></div><div><dt>実効解像度</dt><dd>${number(info.dpiX)} × ${number(info.dpiY)} dpi</dd></div></dl><button type="button" class="tb-button tb-secondary pc-full" data-action="extract-image"><i data-lucide="download"></i>この画像を保存</button>`;
    void showImage(element);
  }
  renderIcons(content);
  highlight();
}
async function showImage(element: PageElement) {
  const page = editor.selected!;
  const version = inspectorVersion;
  try {
    const blob = await pdf().call('image', { page, index: element.index });
    if (
      version !== inspectorVersion ||
      !inspecting ||
      kind !== 'images' ||
      selectedElement !== element.index
    )
      return;
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = URL.createObjectURL(blob);
    const image = document.createElement('img');
    image.src = imageUrl;
    image.alt = '選択した画像';
    $('#pc-image-preview').replaceChildren(image);
  } catch (error) {
    if (
      version === inspectorVersion &&
      kind === 'images' &&
      selectedElement === element.index
    )
      $('#pc-image-preview').textContent =
        error instanceof Error ? error.message : 'プレビューを表示できません。';
  }
}
function highlight() {
  document.querySelector('.pc-element-highlight')?.remove();
  const preview = previews.get(editor.selectedId)?.paper;
  const element = inspection?.elements.find(
    (element) => element.index === selectedElement,
  );
  if (
    !element ||
    !inspecting ||
    kind === 'text' ||
    !preview?.querySelector('.pc-rendered-page')
  )
    return;
  const box = document.createElement('div');
  box.className = 'pc-element-highlight';
  box.setAttribute('aria-hidden', 'true');
  box.style.left = `${element.bounds.x * 100}%`;
  box.style.top = `${element.bounds.y * 100}%`;
  box.style.width = `${element.bounds.width * 100}%`;
  box.style.height = `${element.bounds.height * 100}%`;
  preview.append(box);
}
function toggleInspector(open: boolean) {
  inspecting = open;
  $('#pc-inspector').hidden = !open;
  $('#pc-workbench').classList.toggle('pc-inspecting', open);
  $('[data-action="inspect"]').setAttribute('aria-expanded', String(open));
  if (open) {
    void loadInspection();
    $('[data-action="inspect-close"]').focus();
  } else {
    inspectorVersion++;
    highlight();
    $('[data-action="inspect"]').focus();
  }
}
async function openBuffer(content: ArrayBuffer, name: string) {
  const id = crypto.randomUUID();
  const doc = await pdf().call('open', { id, content });
  sources.set(id, {
    doc,
    name,
    data: new Blob([content], { type: 'application/pdf' }),
  });
  const pages = doc.pages.map((page) => ({
    id: `${id}-${page.index}`,
    sourceId: id,
    sourceIndex: page.index,
    rotation: page.rotation * 90,
  }));
  if (editor.pages.length) editor.append(pages);
  else {
    editor.open(pages);
    filename = name;
  }
  render();
  notify(
    `${name} の${pages.length}ページを${sources.size > 1 ? '末尾に追加しました' : '読み込みました'}。`,
  );
}
async function openFiles(files: File[]) {
  await task('PDFを読み込んでいます…', async () => {
    for (const file of files) {
      if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') {
        notify(`${file.name} はPDFではありません。`);
        continue;
      }
      if (file.size > 150 * 1024 * 1024)
        throw new Error('150 MBを超えるPDFは、この版では読み込めません。');
      await openBuffer(await file.arrayBuffer(), file.name);
    }
  });
}
function baseName() {
  return filename.replace(/\.pdf$/i, '');
}
function format() {
  return $<HTMLInputElement>('input[name="format"]:checked').value;
}
function updateSaveName(reset = false) {
  const type = format();
  const name = $<HTMLInputElement>('#pc-save-name');
  name.value = `${reset ? `${baseName()}_編集` : name.value.replace(/\.(pdf|png|jpe?g)$/i, '')}.${type.toLowerCase()}`;
  $('#pc-save-scope').textContent =
    type === 'PDF'
      ? `全${editor.pages.length}ページを保存`
      : `選択中の${editor.selectedIndex + 1}ページ目を画像として保存（約144 dpi、最大1,600万画素）`;
}
async function save() {
  const name = $<HTMLInputElement>('#pc-save-name');
  if (!name.reportValidity()) return;
  // ファイル名に使えない制御文字も取り除く。
  // eslint-disable-next-line no-control-regex
  const cleaned = name.value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  if (!cleaned || /^\.(pdf|png|jpeg)$/i.test(cleaned)) {
    name.setCustomValidity('ファイル名を入力してください。');
    name.reportValidity();
    return;
  }
  const type = format();
  saveDialog.close();
  await task('保存するファイルを作っています…', async () => {
    let blob: Blob;
    if (type === 'PDF')
      blob = new Blob([await pdf().call('export', { pages: editor.pages })], {
        type: 'application/pdf',
      });
    else
      blob = await pdf().call('render', {
        page: editor.selected!,
        scale: 2,
        type: type === 'PNG' ? 'image/png' : 'image/jpeg',
      });
    const outputName = `${cleaned.replace(/\.(pdf|png|jpe?g)$/i, '')}.${type.toLowerCase()}`;
    downloadBlob(blob, outputName);
    // ダウンロードの完了・キャンセルは確認できないため、変更状態を保つ。
    notify(`${outputName} のダウンロードを開始しました。`);
  });
}
async function closeDocument() {
  if (
    editor.changed &&
    !window.confirm('未保存の変更を破棄して文書を閉じますか？')
  )
    return;
  await task('文書を閉じています…', async () => {
    await session.flush();
    if (session.hasData) await session.clear();
    recoveryRevision++;
    recoveryReady = false;
    inspectorVersion++;
    thumbnailObserver.disconnect();
    previewObserver.disconnect();
    for (const preview of previews.values()) clearPreviewImage(preview);
    previews.clear();
    stage.replaceChildren();
    for (const id of sources.keys()) await pdf().call('close', { id });
    sources.clear();
    editor.open([]);
    filename = '';
    zoom = 100;
    $('#pc-session-status').textContent = '';
    inspection = undefined;
    thumbnailUrls.forEach((url) => URL.revokeObjectURL(url));
    thumbnailUrls.clear();
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = undefined;
    $('#pc-inspector-content').replaceChildren();
    $('#pc-notice').hidden = true;
    render();
  });
}
function move(id: string, target: number) {
  if (editor.move(id, target)) {
    render();
    notify(`${target + 1}ページ目に移動しました。`);
  }
}

$('#pdf-calm').addEventListener('click', (event) => {
  const preview = (event.target as Element).closest<HTMLElement>(
    '[data-preview-page]',
  );
  if (preview && !busy) selectPage(preview.dataset.previewPage!, false);
  const button = (event.target as Element).closest<HTMLButtonElement>('button');
  if (!button || button.disabled) return;
  if (button.dataset.page) {
    selectPage(button.dataset.page);
    return;
  }
  if (button.dataset.kind) {
    kind = button.dataset.kind;
    renderInspector();
    return;
  }
  if (button.dataset.element) {
    selectedElement = Number(button.dataset.element);
    if (
      inspection?.elements.find((item) => item.index === selectedElement)?.image
    )
      kind = 'images';
    renderInspector();
    return;
  }
  const action = button.dataset.action;
  if (busy && !['dismiss', 'close-save', 'close-about'].includes(action ?? ''))
    return;
  switch (action) {
    case 'zoom-in':
    case 'zoom-out':
      setZoom(stepZoom(effectiveZoom(), action === 'zoom-in' ? 1 : -1));
      break;
    case 'open':
    case 'add':
      input.click();
      break;
    case 'sample':
      void task('サンプルPDFを開いています…', () =>
        openBuffer(createSamplePdf(), 'ワークプレイス計画.pdf'),
      );
      break;
    case 'close-document':
      void closeDocument();
      break;
    case 'rotate':
      if (editor.rotate()) render();
      break;
    case 'delete':
      if (editor.remove()) {
        render();
        notify('ページを削除しました。「元に戻す」で戻せます。');
      }
      break;
    case 'undo':
      if (editor.undo()) {
        render();
        notify('直前の操作を元に戻しました。');
      }
      break;
    case 'move-up':
      move(editor.selectedId, editor.selectedIndex - 1);
      break;
    case 'move-down':
      move(editor.selectedId, editor.selectedIndex + 1);
      break;
    case 'previous':
    case 'next': {
      const page =
        editor.pages[editor.selectedIndex + (action === 'previous' ? -1 : 1)];
      if (page) selectPage(page.id);
      break;
    }
    case 'inspect':
      toggleInspector(!inspecting);
      break;
    case 'inspect-close':
      toggleInspector(false);
      break;
    case 'dismiss':
      $('#pc-notice').hidden = true;
      break;
    case 'save':
      $<HTMLInputElement>('input[name="format"][value="PDF"]').checked = true;
      updateSaveName(true);
      saveDialog.showModal();
      break;
    case 'close-save':
      saveDialog.close();
      break;
    case 'extract-text':
      if (inspection) {
        downloadBlob(
          new Blob([inspection.text], { type: 'text/plain;charset=utf-8' }),
          `${baseName()}_${editor.selectedIndex + 1}.txt`,
        );
        notify('テキストのダウンロードを開始しました。');
      }
      break;
    case 'extract-image':
      if (selectedElement !== undefined)
        void task('画像を保存しています…', async () => {
          const blob = await pdf().call('image', {
            page: editor.selected!,
            index: selectedElement!,
          });
          downloadBlob(
            blob,
            `${baseName()}_${editor.selectedIndex + 1}_画像${selectedElement! + 1}.png`,
          );
          notify('画像のダウンロードを開始しました。');
        });
      break;
    case 'about':
      $('#pc-licenses').textContent = licenses;
      $<HTMLDialogElement>('#pc-about-dialog').showModal();
      break;
    case 'close-about':
      $<HTMLDialogElement>('#pc-about-dialog').close();
      break;
  }
});
input.addEventListener('change', () => {
  const files = Array.from(input.files ?? []);
  input.value = '';
  if (files.length) void openFiles(files);
});
$('#pc-zoom').addEventListener('change', (event) => {
  const value = (event.target as HTMLSelectElement).value;
  const next = value === 'fit' ? value : Number(value);
  if (isPreviewZoom(next)) setZoom(next);
});
$('#pc-save-form').addEventListener('submit', (event) => {
  event.preventDefault();
  if (!busy) void save();
});
$('#pc-save-form').addEventListener('change', (event) => {
  if ((event.target as HTMLInputElement).name === 'format') updateSaveName();
});
$('#pc-save-name').addEventListener('input', () =>
  $<HTMLInputElement>('#pc-save-name').setCustomValidity(''),
);
$('#pc-inspector-content').addEventListener('change', (event) => {
  const select = event.target as HTMLSelectElement;
  if (select.id === 'pc-image-select') {
    selectedElement = Number(select.value);
    renderInspector();
  }
});
let draggedId: string | undefined;
document.addEventListener('dragstart', (event) => {
  const button = (event.target as Element).closest<HTMLElement>('[data-page]');
  if (!button || busy) {
    event.preventDefault();
    return;
  }
  draggedId = button.dataset.page;
  event.dataTransfer?.setData('text/plain', draggedId!);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragover', (event) => {
  if (busy) return;
  if (draggedId) {
    const page = (event.target as Element).closest('[data-page]');
    if (page) {
      event.preventDefault();
      page.classList.add('pc-drop');
    }
  }
});
function clearDrop() {
  document
    .querySelectorAll('.pc-drop')
    .forEach((element) => element.classList.remove('pc-drop'));
}
document.addEventListener('dragleave', (event) => {
  (event.target as Element).closest('[data-page]')?.classList.remove('pc-drop');
  if (!event.relatedTarget) clearDrop();
});
document.addEventListener('dragend', () => {
  draggedId = undefined;
  clearDrop();
});
document.addEventListener('drop', (event) => {
  event.preventDefault();
  clearDrop();
  if (busy) return;
  if (draggedId) {
    const target = (event.target as Element).closest<HTMLElement>(
      '[data-page]',
    );
    if (target)
      move(
        draggedId,
        editor.pages.findIndex((page) => page.id === target.dataset.page),
      );
    draggedId = undefined;
  }
});
watchFileDrop({
  zone: $('#pdf-calm'),
  enabled: () => !busy,
  onDrop: (files) => {
    if (files) void openFiles(files);
    else notify('フォルダは開けません。PDFファイルをドロップしてください。');
  },
});
document.addEventListener('keydown', (event) => {
  if (
    busy ||
    document.querySelector('dialog[open]') ||
    (event.target as Element).closest('input,textarea,select')
  )
    return;
  if (
    (event.metaKey || event.ctrlKey) &&
    event.key.toLowerCase() === 'z' &&
    !event.shiftKey
  ) {
    event.preventDefault();
    if (editor.undo()) render();
  }
  if (event.key === 'Escape' && inspecting) toggleInspector(false);
});
window.addEventListener('beforeunload', (event) => {
  if (busy || (editor.pages.length && !recoveryReady)) event.preventDefault();
});
renderIcons();
updateControls();
void restoreSession();
