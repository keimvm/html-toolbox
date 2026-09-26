import '../../../ui/theme.css';
import './style.css';
import { setupToolHeader } from '../../../ui/header.js';
import { createFolderMemory } from './folder-memory';
import {
  addPrompt,
  filterByTags,
  formatTags,
  LIBRARY_FILE,
  LibraryFormatError,
  normalizeInput,
  parseTags,
  removePrompt,
  sortPrompts,
  updatePrompt,
  usedTags,
  type Library,
  type Prompt,
} from './library';
import {
  changeLibrary,
  openLibraryFile,
  readLibrary,
  type FileHandle,
} from './storage';

function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`画面の要素が見つかりません: ${selector}`);
  return element;
}
// 保存した配色を最初に反映する。
setupToolHeader($('.pl-header'));

const supported =
  window.isSecureContext &&
  typeof window.showDirectoryPicker === 'function' &&
  typeof window.FileSystemFileHandle?.prototype.createWritable === 'function' &&
  typeof window.FileSystemHandle?.prototype.requestPermission === 'function';
const memory = createFolderMemory(window);

const headerEnd = $('#pl-header-end');
const menu = $('#pl-menu');
const start = $('#pl-start');
const startText = $('#pl-start-text');
const startError = $('#pl-start-error');
const openLastButton = $<HTMLButtonElement>('#pl-open-last');
const retryButton = $<HTMLButtonElement>('#pl-retry');
const pickButton = $<HTMLButtonElement>('#pl-pick');
const libraryView = $('#pl-library');
const filter = $('#pl-filter');
const tagList = $('#pl-tags');
const clearButton = $<HTMLButtonElement>('#pl-clear');
const count = $('#pl-count');
const list = $('#pl-list');
const empty = $('#pl-empty');
const toast = $('#pl-toast');
const editor = $<HTMLDialogElement>('#pl-editor');
const editorForm = $<HTMLFormElement>('#pl-editor-form');
const titleInput = $<HTMLInputElement>('#pl-title');
const bodyInput = $<HTMLTextAreaElement>('#pl-body');
const tagInput = $<HTMLInputElement>('#pl-tag-input');
const tagChoices = $('#pl-tag-choices');
const editorError = $('#pl-editor-error');
const deleteButton = $<HTMLButtonElement>('#pl-delete');
const saveButton = $<HTMLButtonElement>('#pl-save');
const confirmDialog = $<HTMLDialogElement>('#pl-confirm');

interface OpenLibrary {
  folder: FileSystemDirectoryHandle;
  file: FileHandle;
  library: Library;
}

/** 開いている保存ファイル。画面の一覧は常にこの内容から作る。 */
let current: OpenLibrary | undefined;
/** 前回開いたフォルダ（IndexedDB の記録）。 */
let remembered: FileSystemDirectoryHandle | undefined;
/** 絞り込みに選んでいるタグ。 */
const selected = new Set<string>();
/** 編集中のプロンプト。新しく追加する場合は undefined。 */
let editing: Prompt | undefined;
/** 書き込み中は次の書き込みを受け付けない。 */
let busy = false;

/** 編集対象がほかの画面で削除されていた。 */
class PromptMissingError extends Error {
  override name = 'PromptMissingError';
}

// ── 知らせ ──

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function notify(message: string, state?: 'error') {
  clearTimeout(toastTimer);
  toast.textContent = message;
  if (state) toast.dataset.state = state;
  else delete toast.dataset.state;
  toast.dataset.visible = '';
  toastTimer = setTimeout(
    () => delete toast.dataset.visible,
    state ? 8000 : 2500,
  );
}

function showMessage(element: HTMLElement, message = '') {
  element.textContent = message;
  element.hidden = message === '';
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : '';
}

/** 開く・読み込むときの失敗の案内。 */
function describeOpenError(error: unknown, folder: FileSystemHandle): string {
  if (error instanceof LibraryFormatError) {
    return `「${folder.name}」の ${LIBRARY_FILE} を開けませんでした。理由：${error.message}ファイルは変更していません。`;
  }
  return describeFileError(error);
}

function describeFileError(error: unknown): string {
  switch (errorName(error)) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'フォルダへのアクセスが許可されませんでした。もう一度操作して許可するか、別のフォルダを選んでください。';
    case 'NotFoundError':
      return 'フォルダまたは保存ファイルが見つかりません。移動・削除した場合は、保存先のフォルダを選び直してください。';
    case 'TypeMismatchError':
      return `フォルダ内の ${LIBRARY_FILE} がファイルではありません。別のフォルダを選んでください。`;
    case 'NoModificationAllowedError':
    case 'InvalidStateError':
    case 'InvalidModificationError':
      return 'ファイルに書き込めませんでした。ほかのアプリで開いていないか、書き込みが禁止されていないかを確認してください。';
    case 'QuotaExceededError':
      return 'ディスクの空きが足りず、書き込めませんでした。';
    default:
      return `ファイルを読み書きできませんでした（${errorName(error) || '不明なエラー'}）。`;
  }
}

// ── 保存先のフォルダ ──

async function ensureWritable(folder: FileSystemHandle): Promise<boolean> {
  if ((await folder.queryPermission({ mode: 'readwrite' })) === 'granted') {
    return true;
  }
  return (await folder.requestPermission({ mode: 'readwrite' })) === 'granted';
}

/** 開けない場合の画面。retry は、読めない保存ファイルを直したあとに読み直すフォルダ。 */
function showStart({
  error = '',
  retry,
}: { error?: string; retry?: FileSystemDirectoryHandle } = {}) {
  current = undefined;
  start.hidden = false;
  libraryView.hidden = true;
  headerEnd.hidden = true;
  showMessage(startError, error);
  if (!supported) {
    startText.textContent =
      'このブラウザーでは保存先のフォルダを使えません。Chrome または Edge（129 以降）で開いてください。';
    for (const button of [openLastButton, retryButton, pickButton]) {
      button.hidden = true;
    }
    return;
  }
  retryTarget = retry;
  retryButton.hidden = !retry;
  const last = remembered !== retry ? remembered : undefined;
  openLastButton.hidden = !last;
  openLastButton.classList.toggle('tb-primary', !retry);
  if (last) openLastButton.textContent = `前回のフォルダ「${last.name}」を開く`;
  pickButton.hidden = false;
  const first = !retry && !last;
  pickButton.classList.toggle('tb-primary', first);
  pickButton.classList.toggle('tb-secondary', !first);
  pickButton.textContent = first
    ? '保存先のフォルダを選ぶ'
    : '別のフォルダを選ぶ';
}
let retryTarget: FileSystemDirectoryHandle | undefined;

async function openFolder(folder: FileSystemDirectoryHandle) {
  let opened: Awaited<ReturnType<typeof openLibraryFile>>;
  try {
    opened = await openLibraryFile(folder);
  } catch (error) {
    showStart({
      error: describeOpenError(error, folder),
      retry: error instanceof LibraryFormatError ? folder : undefined,
    });
    return;
  }
  if (current?.folder !== folder) selected.clear();
  current = { folder, ...opened };
  showLibrary();
  if (remembered === folder) return;
  remembered = folder;
  try {
    await memory.save(folder);
  } catch {
    notify(
      '保存先のフォルダを覚えられませんでした。次回もフォルダを選んでください。',
      'error',
    );
  }
}

/** 記録したフォルダは、書き込みの許可を得てから開く。 */
async function openWithPermission(folder: FileSystemDirectoryHandle) {
  try {
    if (!(await ensureWritable(folder))) {
      showStart({
        error: describeFileError(new DOMException('', 'NotAllowedError')),
        retry: folder === remembered ? undefined : folder,
      });
      return;
    }
  } catch (error) {
    showStart({ error: describeFileError(error) });
    return;
  }
  await openFolder(folder);
}

async function pickFolder() {
  let folder: FileSystemDirectoryHandle;
  try {
    folder = await window.showDirectoryPicker!({
      id: 'prompt-library',
      mode: 'readwrite',
    });
  } catch (error) {
    // 選択の取り消しは失敗として扱わない。
    if (errorName(error) === 'AbortError') return;
    notify(describeFileError(error), 'error');
    return;
  }
  await openFolder(folder);
}

openLastButton.addEventListener('click', () => {
  if (remembered) void openWithPermission(remembered);
});
retryButton.addEventListener('click', () => {
  if (retryTarget) void openWithPermission(retryTarget);
});
pickButton.addEventListener('click', () => void pickFolder());
$('#pl-change-folder').addEventListener('click', () => {
  menu.hidePopover();
  void pickFolder();
});

// ── 一覧 ──

function showLibrary() {
  if (!current) return;
  start.hidden = true;
  libraryView.hidden = false;
  headerEnd.hidden = false;
  $('#pl-folder-name').textContent = current.folder.name;
  renderLibrary();
}

function tagButton(tag: string, pressed: boolean, onClick: () => void) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tb-button tb-secondary pl-tag';
  button.textContent = tag;
  button.dataset.tag = tag;
  button.setAttribute('aria-pressed', String(pressed));
  button.addEventListener('click', onClick);
  return button;
}

function focusTag(container: HTMLElement, tag: string) {
  for (const button of container.querySelectorAll<HTMLElement>('[data-tag]')) {
    if (button.dataset.tag === tag) button.focus();
  }
}

function renderLibrary() {
  if (!current) return;
  const prompts = current.library.prompts;
  const tags = usedTags(prompts);
  for (const tag of selected) if (!tags.includes(tag)) selected.delete(tag);

  filter.hidden = tags.length === 0;
  tagList.replaceChildren(
    ...tags.map((tag) =>
      tagButton(tag, selected.has(tag), () => {
        if (!selected.delete(tag)) selected.add(tag);
        renderLibrary();
        focusTag(tagList, tag);
      }),
    ),
  );
  clearButton.hidden = selected.size === 0;

  const shown = sortPrompts(filterByTags(prompts, selected));
  count.hidden = prompts.length === 0;
  count.textContent =
    selected.size === 0
      ? `${prompts.length}件`
      : `${prompts.length}件中 ${shown.length}件`;
  list.replaceChildren(...shown.map(promptCard));
  showMessage(
    empty,
    prompts.length === 0
      ? 'まだプロンプトがありません。右上の「新しいプロンプト」から追加します。'
      : shown.length === 0
        ? '選んだタグをすべて含むプロンプトはありません。'
        : '',
  );
}

clearButton.addEventListener('click', () => {
  selected.clear();
  renderLibrary();
  tagList.querySelector<HTMLElement>('[data-tag]')?.focus();
});

function promptCard(prompt: Prompt) {
  const item = document.createElement('li');
  item.className = 'pl-card';
  const title = document.createElement('h3');
  title.textContent = prompt.title;
  const body = document.createElement('p');
  body.className = 'pl-card-body';
  body.textContent = prompt.body;
  const tags = document.createElement('ul');
  tags.className = 'pl-card-tags';
  tags.setAttribute('aria-label', 'タグ');
  tags.hidden = prompt.tags.length === 0;
  tags.replaceChildren(
    ...prompt.tags.map((tag) => {
      const li = document.createElement('li');
      li.textContent = tag;
      return li;
    }),
  );
  const actions = document.createElement('div');
  actions.className = 'pl-card-actions';
  const copyButton = document.createElement('button');
  copyButton.type = 'button';
  copyButton.className = 'tb-button tb-primary pl-copy';
  copyButton.textContent = 'コピー';
  copyButton.setAttribute('aria-label', `「${prompt.title}」をコピー`);
  copyButton.addEventListener('click', () => void copy(prompt, copyButton));
  const editButton = document.createElement('button');
  editButton.type = 'button';
  editButton.className = 'tb-button tb-secondary';
  editButton.textContent = '編集';
  editButton.setAttribute('aria-label', `「${prompt.title}」を編集`);
  editButton.addEventListener('click', () => openEditor(prompt));
  actions.append(copyButton, editButton);
  item.append(title, body, tags, actions);
  return item;
}

async function copy(prompt: Prompt, button: HTMLButtonElement) {
  try {
    await navigator.clipboard.writeText(prompt.body);
  } catch {
    notify(
      'コピーできませんでした。「編集」で本文を開き、選択してコピーしてください。',
      'error',
    );
    return;
  }
  button.textContent = 'コピーしました';
  button.dataset.copied = '';
  setTimeout(() => {
    button.textContent = 'コピー';
    delete button.dataset.copied;
  }, 1500);
  notify(`「${prompt.title}」をコピーしました。`);
}

/** ほかのタブで変えた内容を、この画面に戻ったときに反映する。 */
async function refresh() {
  const open = current;
  if (!open || busy || editor.open) return;
  try {
    const library = await readLibrary(open.file);
    if (current !== open || busy) return;
    open.library = library;
    renderLibrary();
  } catch (error) {
    if (current !== open || editor.open) return;
    showStart({
      error: describeOpenError(error, open.folder),
      retry: open.folder,
    });
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void refresh();
});

// ── 追加・編集・削除 ──

function renderTagChoices() {
  const tags = current ? usedTags(current.library.prompts) : [];
  const chosen = parseTags(tagInput.value);
  tagChoices.hidden = tags.length === 0;
  tagChoices.replaceChildren(
    ...tags.map((tag) =>
      tagButton(tag, chosen.includes(tag), () => {
        const next = parseTags(tagInput.value);
        const index = next.indexOf(tag);
        if (index === -1) next.push(tag);
        else next.splice(index, 1);
        tagInput.value = formatTags(next);
        renderTagChoices();
        focusTag(tagChoices, tag);
      }),
    ),
  );
}
tagInput.addEventListener('input', renderTagChoices);

function openEditor(prompt?: Prompt) {
  editing = prompt;
  $('#pl-editor-title').textContent = prompt
    ? 'プロンプトを編集'
    : '新しいプロンプト';
  titleInput.value = prompt?.title ?? '';
  bodyInput.value = prompt?.body ?? '';
  tagInput.value = prompt ? formatTags(prompt.tags) : '';
  deleteButton.hidden = !prompt;
  showMessage(editorError);
  renderTagChoices();
  editor.showModal();
  titleInput.focus();
}
$('#pl-new').addEventListener('click', () => openEditor());
$('#pl-cancel').addEventListener('click', () => editor.close());
editor.addEventListener('close', () => void refresh());

function setBusy(value: boolean) {
  busy = value;
  editorForm.toggleAttribute('aria-busy', value);
  saveButton.disabled = value;
  deleteButton.disabled = value;
}

/** 保存ファイルの最新の内容に変更を当てて書き込み、一覧を更新する。失敗したら編集画面に理由を出す。 */
async function save(
  change: (library: Library) => Library,
  done: string,
): Promise<boolean> {
  const open = current;
  if (!open || busy) return false;
  setBusy(true);
  showMessage(editorError);
  try {
    // 許可の確認は、利用者の操作の直後に行う必要があるため最初に行う。
    if (!(await ensureWritable(open.folder))) {
      throw new DOMException('', 'NotAllowedError');
    }
    open.library = await changeLibrary(open.file, change);
    renderLibrary();
    notify(done);
    return true;
  } catch (error) {
    showMessage(
      editorError,
      error instanceof PromptMissingError
        ? 'このプロンプトはほかの画面で削除されています。残したい場合は、本文をコピーしてから「新しいプロンプト」で追加してください。'
        : error instanceof LibraryFormatError
          ? `${describeOpenError(error, open.folder)}入力した内容は保存していません。`
          : describeFileError(error),
    );
    return false;
  } finally {
    setBusy(false);
  }
}

editorForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const input = normalizeInput({
    title: titleInput.value,
    body: bodyInput.value,
    tags: parseTags(tagInput.value),
  });
  if (typeof input === 'string') {
    showMessage(editorError, input);
    return;
  }
  const target = editing;
  void save(
    (library) => {
      if (!target) return addPrompt(library, input, crypto.randomUUID());
      const next = updatePrompt(library, target.id, input);
      if (!next) throw new PromptMissingError();
      return next;
    },
    target ? '保存しました。' : '追加しました。',
  ).then((saved) => {
    if (saved) editor.close();
  });
});

deleteButton.addEventListener('click', () => {
  if (!editing) return;
  $('#pl-confirm-text').textContent =
    `「${editing.title}」を保存ファイルから削除します。元に戻せません。`;
  confirmDialog.returnValue = '';
  confirmDialog.showModal();
});
confirmDialog.addEventListener('close', () => {
  const target = editing;
  if (confirmDialog.returnValue !== 'delete' || !target) return;
  void save(
    (library) => removePrompt(library, target.id),
    `「${target.title}」を削除しました。`,
  ).then((deleted) => {
    if (deleted) editor.close();
  });
});

// ── 起動 ──

async function startUp() {
  if (!supported) {
    showStart();
    return;
  }
  remembered = await memory.load().catch(() => undefined);
  const permission = await remembered
    ?.queryPermission({ mode: 'readwrite' })
    .catch(() => 'prompt' as const);
  // 許可が残っていれば、ボタンを押さずに一覧を出す。
  if (remembered && permission === 'granted') await openFolder(remembered);
  else showStart();
}
void startUp();
