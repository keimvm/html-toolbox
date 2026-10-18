// プロンプト集。よく使うプロンプトを、使う人が選んだフォルダの prompt-library.json に置き、タグで絞り込んでコピーする。
// 正本はフォルダのファイル。追加・編集・削除・並び替え・表示の切り替え・インポートを確定した時だけ、
// 直前に読み直した内容に当てて書く（changeLibrary）。
// ブラウザーの中（IndexedDB）にはフォルダの記録だけを置き、プロンプトの本文は入れない。
import { batch, computed, signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { ToolFrame } from '../../app/frame';
import type { Incoming, ToolDefinition } from '../../app/tool';
import { copyText } from '../../lib/clipboard';
import { downloadBlob } from '../../lib/download';
import { canUseFolders, errorName, pickFiles } from '../../lib/files';
import { hasMod, isEditable, modKey } from '../../lib/platform';
import {
  ask,
  Button,
  confirmAction,
  Dialog,
  EmptyState,
  Field,
  IconButton,
  Menu,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  toast,
} from '../../ui/components';
import { Icon } from '../../ui/icons';
import { createFolderMemory } from './folder-memory';
import {
  addPrompt,
  exportFileName,
  filterByTags,
  formatTags,
  LIBRARY_FILE,
  LibraryFormatError,
  mergePrompts,
  movePrompt,
  normalizeInput,
  parseLibrary,
  parseTags,
  removePrompt,
  replacePrompts,
  serializeLibrary,
  setHidden,
  sortByTitle,
  updatePrompt,
  usedTags,
  type Library,
  type Prompt,
} from './library';
import { changeLibrary, openLibraryFile, readLibrary, type FileHandle } from './storage';
import icon from './icon.png';
import './style.css';

interface Opened {
  folder: FileSystemDirectoryHandle;
  file: FileHandle;
}

/** loading：前回のフォルダを確かめている間、start：フォルダを選ぶ画面、library：一覧。 */
type Screen =
  | { kind: 'loading' }
  | {
      kind: 'start';
      error?: string;
      /** 案内（失敗ではないもの）。 */
      notice?: string;
      /** 読めない保存ファイルを直したあとや、許可を得て開き直すフォルダ。 */
      retry?: FileSystemDirectoryHandle;
      retryLabel?: string;
    }
  | { kind: 'library' };

interface Draft {
  /** 編集するプロンプト。新しく追加する場合は undefined。 */
  target?: Prompt;
  title: string;
  summary: string;
  body: string;
  tags: string;
  error?: string;
  /** 開いたときの内容。閉じる前の確認に使う。 */
  initial: string;
}

type DraftFields = Pick<Draft, 'title' | 'summary' | 'body' | 'tags'>;
const snapshot = (draft: DraftFields) =>
  JSON.stringify([draft.title, draft.summary, draft.body, draft.tags]);

/** 並び替えのドラッグで運ぶデータの種類。ファイルのドロップと区別する。 */
const DRAG_TYPE = 'application/x-toolbox-prompt';
const isDirty = (draft: Draft) => snapshot(draft) !== draft.initial;

/** 編集対象がほかの画面で削除されていた。 */
class PromptMissingError extends Error {
  override name = 'PromptMissingError';
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

async function ensureWritable(folder: FileSystemHandle): Promise<boolean> {
  if ((await folder.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
  return (await folder.requestPermission({ mode: 'readwrite' })) === 'granted';
}

function create() {
  const supported = canUseFolders();
  const memory = createFolderMemory(window);
  const screen = signal<Screen>({ kind: 'loading' });
  /** 開いている保存ファイル。一覧は常に library の内容から作る。 */
  const opened = signal<Opened | null>(null);
  const library = signal<Library | null>(null);
  /** 前回開いたフォルダ（IndexedDB の記録）。 */
  const remembered = signal<FileSystemDirectoryHandle | undefined>(undefined);
  const selected = signal<ReadonlySet<string>>(new Set());
  const draft = signal<Draft | null>(null);
  /** 書き込み中は次の書き込みを受け付けない。 */
  const busy = signal(false);
  const copied = signal<string | null>(null);
  /** フォルダを開いたら、新しいプロンプトの本文にする文章（ホームから受け取ったもの）。 */
  const pending = signal<string | null>(null);
  /** 並び替え・表示の切り替えの画面。非表示のプロンプトも出す。 */
  const arranging = signal(false);
  let active = false;
  let copiedTimer = 0;
  /** 並び替え・表示の切り替えの書き込みを、操作した順に1つずつ行う。 */
  let arrangeQueue = Promise.resolve();

  /** 保存ファイルの順。一覧もこの順に出す。 */
  const prompts = computed(() => library.value?.prompts ?? []);
  const visible = computed(() => prompts.value.filter((prompt) => !prompt.hidden));
  const listed = computed(() => (arranging.value ? prompts.value : visible.value));
  const tags = computed(() => usedTags(listed.value));
  /** 編集画面の候補には、非表示のプロンプトのタグも出す。 */
  const allTags = computed(() => usedTags(prompts.value));
  /** 選んだタグのうち、まだ使われているもの。 */
  const chosen = computed(
    () => new Set([...selected.value].filter((tag) => tags.value.includes(tag))),
  );
  const shown = computed(() => filterByTags(listed.value, chosen.value));

  const status = computed(() => {
    const open = opened.value;
    const dirty = draft.value ? isDirty(draft.value) : false;
    return {
      summary: open && library.value ? `${prompts.value.length}件・${open.folder.name}` : undefined,
      unsaved: dirty,
      guard: dirty || busy.value,
    };
  });

  function showStart(state: Omit<Extract<Screen, { kind: 'start' }>, 'kind'> = {}) {
    batch(() => {
      opened.value = null;
      library.value = null;
      arranging.value = false;
      screen.value = { kind: 'start', ...state };
    });
  }

  async function openFolder(folder: FileSystemDirectoryHandle) {
    let result: Awaited<ReturnType<typeof openLibraryFile>>;
    try {
      result = await openLibraryFile(folder);
    } catch (error) {
      showStart({
        error: describeOpenError(error, folder),
        retry: error instanceof LibraryFormatError ? folder : undefined,
      });
      return;
    }
    batch(() => {
      if (opened.value?.folder !== folder) {
        selected.value = new Set();
        arranging.value = false;
      }
      opened.value = { folder, file: result.file };
      library.value = result.library;
      screen.value = { kind: 'library' };
    });
    if (pending.value !== null) {
      const body = pending.value;
      pending.value = null;
      openEditor(undefined, body);
    }
    const last = remembered.value;
    if (last === folder || (last && (await last.isSameEntry(folder).catch(() => false)))) return;
    remembered.value = folder;
    try {
      await memory.save(folder);
    } catch {
      toast('保存先のフォルダを覚えられませんでした。次回もフォルダを選んでください。', {
        tone: 'error',
      });
    }
  }

  /** 記録したフォルダ・置いたフォルダは、書き込みの許可を得てから開く。 */
  async function openWithPermission(folder: FileSystemDirectoryHandle) {
    try {
      if (!(await ensureWritable(folder))) {
        showStart({
          error: describeFileError(new DOMException('', 'NotAllowedError')),
          retry: folder === remembered.value ? undefined : folder,
        });
        return;
      }
    } catch (error) {
      showStart({ error: describeFileError(error), retry: folder });
      return;
    }
    await openFolder(folder);
  }

  async function pickFolder() {
    let folder: FileSystemDirectoryHandle;
    try {
      folder = await window.showDirectoryPicker!({ id: 'prompt-library', mode: 'readwrite' });
    } catch (error) {
      // 選択の取り消しは失敗として扱わない。
      if (errorName(error) === 'AbortError') return;
      toast(describeFileError(error), { tone: 'error' });
      return;
    }
    await openFolder(folder);
  }

  /** ほかのタブや別のアプリで変えた内容を、この画面に戻ったときに反映する。 */
  async function refresh({ announce = false } = {}) {
    const open = opened.value;
    if (!open || busy.value || draft.value) return;
    try {
      const next = await readLibrary(open.file);
      if (opened.value !== open || busy.value) return;
      library.value = next;
      if (announce) toast(`${LIBRARY_FILE} を読み直しました。`);
    } catch (error) {
      if (opened.value !== open || draft.value) return;
      showStart({ error: describeOpenError(error, open.folder), retry: open.folder });
    }
  }

  async function copy(prompt: Prompt) {
    if (!(await copyText(prompt.body))) {
      toast('コピーできませんでした。「編集」で本文を開き、選択してコピーしてください。', {
        tone: 'error',
      });
      return;
    }
    clearTimeout(copiedTimer);
    copied.value = prompt.id;
    copiedTimer = window.setTimeout(() => (copied.value = null), 1600);
    toast(`「${prompt.title}」をコピーしました。`, { tone: 'success' });
  }

  function toggleTag(tag: string) {
    const next = new Set(chosen.value);
    if (!next.delete(tag)) next.add(tag);
    selected.value = next;
  }

  // ── 追加・編集・削除 ──

  function openEditor(prompt?: Prompt, body?: string) {
    const fields: DraftFields = prompt
      ? {
          title: prompt.title,
          summary: prompt.summary,
          body: prompt.body,
          tags: formatTags(prompt.tags),
        }
      : // 絞り込んでいるタグを最初から付け、追加したプロンプトが今の一覧に出るようにする。
        { title: '', summary: '', body: body ?? '', tags: formatTags([...chosen.value]) };
    draft.value = { target: prompt, ...fields, initial: snapshot(fields) };
  }

  function editDraft(change: Partial<DraftFields>) {
    if (draft.value) draft.value = { ...draft.value, ...change, error: undefined };
  }

  async function closeEditor() {
    const current = draft.value;
    if (!current || busy.value) return;
    if (
      isDirty(current) &&
      !(await confirmAction(
        '入力した内容を捨てますか？',
        current.target
          ? 'プロンプトの変更はまだ保存していません。'
          : '新しいプロンプトはまだ追加していません。',
        { ok: '捨てる', danger: true },
      ))
    )
      return;
    if (draft.value !== current) return;
    draft.value = null;
    void refresh();
  }

  /** 保存ファイルの最新の内容に変更を当てて書き込み、一覧を更新する。失敗したら編集画面に理由を出す。 */
  async function save(
    change: (library: Library) => Library,
    /** 書き込めたときの知らせ。関数なら書き込んだ後に文言を作る。省略すると知らせない。 */
    done?: string | (() => string),
    permission?: Promise<boolean>,
  ): Promise<boolean> {
    const open = opened.value;
    if (!open || busy.value) return false;
    busy.value = true;
    try {
      // 許可の確認は、利用者の操作の直後に行う必要があるため最初に行う。
      if (!(await (permission ?? ensureWritable(open.folder))))
        throw new DOMException('', 'NotAllowedError');
      library.value = await changeLibrary(open.file, change);
      if (done) toast(typeof done === 'string' ? done : done(), { tone: 'success' });
      return true;
    } catch (error) {
      const message =
        error instanceof PromptMissingError
          ? 'このプロンプトはほかの画面で削除されています。残したい場合は、本文をコピーしてから「新しいプロンプト」で追加してください。'
          : error instanceof LibraryFormatError
            ? `${describeOpenError(error, open.folder)}入力した内容は保存していません。`
            : describeFileError(error);
      if (draft.value) draft.value = { ...draft.value, error: message };
      else toast(message, { tone: 'error' });
      return false;
    } finally {
      busy.value = false;
    }
  }

  async function submit() {
    const current = draft.value;
    if (!current || busy.value) return;
    const input = normalizeInput({
      title: current.title,
      summary: current.summary,
      body: current.body,
      tags: parseTags(current.tags),
    });
    if (typeof input === 'string') {
      draft.value = { ...current, error: input };
      return;
    }
    const target = current.target;
    const saved = await save(
      (library) => {
        if (!target) return addPrompt(library, input, crypto.randomUUID());
        const next = updatePrompt(library, target.id, input);
        if (!next) throw new PromptMissingError();
        return next;
      },
      target ? `「${input.title}」を保存しました。` : `「${input.title}」を追加しました。`,
    );
    if (saved && draft.value === current) draft.value = null;
  }

  async function remove() {
    const target = draft.value?.target;
    const open = opened.value;
    if (!target || !open || busy.value) return;
    const { value, detail } = await ask(
      'プロンプトを削除しますか？',
      `「${target.title}」を保存ファイルから削除します。元に戻せません。`,
      [
        {
          value: 'delete',
          label: '削除する',
          variant: 'primary-danger',
          // 許可の要求は、押した直後に始める。
          start: () => ensureWritable(open.folder).catch(() => false),
        },
        { value: 'cancel', label: 'キャンセル' },
      ],
    );
    if (value !== 'delete') return;
    const deleted = await save(
      (library) => removePrompt(library, target.id),
      `「${target.title}」を削除しました。`,
      detail as Promise<boolean>,
    );
    if (deleted) draft.value = null;
  }

  // ── 並び替え・表示の切り替え ──

  /**
   * すぐ画面に反映してから、操作した順に書き込む。続けて押しても取りこぼさない。
   * 書き込めなかったら、ファイルの内容で一覧を戻す。
   */
  function rearrange(change: (library: Library) => Library, done?: string) {
    const open = opened.value;
    const current = library.value;
    if (!open || !current) return;
    library.value = change(current);
    // 許可の要求は、押した直後に始める。
    const permission = ensureWritable(open.folder).catch(() => false);
    arrangeQueue = arrangeQueue.then(async () => {
      if (opened.value !== open) return;
      if (!(await save(change, done, permission))) await refresh();
    });
  }

  function step(prompt: Prompt, direction: -1 | 1) {
    const list = shown.value;
    const index = list.findIndex((item) => item.id === prompt.id);
    const target = index === -1 ? undefined : list[index + direction];
    if (!target) return;
    rearrange((library) =>
      movePrompt(library, prompt.id, target.id, direction < 0 ? 'before' : 'after'),
    );
    // 並びが変わっても、同じプロンプトの移動ボタンにフォーカスを残す。端に着いたら逆向きのボタンへ。
    requestAnimationFrame(() => {
      const row = document.querySelector(`.pl-row[data-id="${CSS.escape(prompt.id)}"]`);
      (
        row?.querySelector<HTMLElement>(`[data-move="${direction}"]:not(:disabled)`) ??
        row?.querySelector<HTMLElement>('[data-move]:not(:disabled)')
      )?.focus();
    });
  }

  function toggleHidden(prompt: Prompt) {
    rearrange((library) => setHidden(library, prompt.id, !prompt.hidden) ?? library);
  }

  async function arrangeByTitle() {
    if (
      !(await confirmAction('タイトル順に並べ直しますか？', '今の並び順には戻せません。', {
        ok: '並べ直す',
      }))
    )
      return;
    rearrange(sortByTitle, 'タイトル順に並べ直しました。');
  }

  // ── エクスポート・インポート ──

  function exportFile() {
    const current = library.value;
    if (!current) return;
    const name = exportFileName(new Date());
    downloadBlob(new Blob([serializeLibrary(current)], { type: 'application/json' }), name);
    toast(`${current.prompts.length}件のプロンプトを ${name} としてダウンロードしました。`, {
      tone: 'success',
    });
  }

  async function importFile() {
    const open = opened.value;
    if (!open || busy.value) return;
    const [file] = await pickFiles({ accept: 'application/json,.json', multiple: false });
    if (!file) return;
    let incoming: Library;
    try {
      incoming = parseLibrary(await file.text());
    } catch (error) {
      toast(
        `「${file.name}」を読み込めませんでした。${error instanceof LibraryFormatError ? `理由：${error.message}` : ''}`,
        { tone: 'error' },
      );
      return;
    }
    const count = incoming.prompts.length;
    if (!count) {
      toast(`「${file.name}」にはプロンプトがありません。`, { tone: 'error' });
      return;
    }
    const current = prompts.value.length;
    // 許可の要求は、押した直後に始める。
    const permit = () => ensureWritable(open.folder).catch(() => false);
    const { value, detail } = await ask<'add' | 'replace' | 'cancel'>(
      'プロンプトをインポートしますか？',
      current
        ? `「${file.name}」の${count}件を、今の${current}件に追加するか、今のプロンプトと置き換える（上書き）かを選んでください。上書きすると、今のプロンプトは元に戻せません。`
        : `「${file.name}」の${count}件を追加します。`,
      [
        { value: 'add', label: '追加する', variant: 'primary', start: permit },
        ...(current
          ? [
              {
                value: 'replace' as const,
                label: '上書きする',
                variant: 'danger' as const,
                start: permit,
              },
            ]
          : []),
        { value: 'cancel', label: 'キャンセル' },
      ],
    );
    if (value === 'cancel' || opened.value !== open) return;
    let merged = { added: 0, skipped: 0 };
    await save(
      (latest) => {
        if (value === 'replace') return replacePrompts(latest, incoming.prompts);
        const result = mergePrompts(latest, incoming.prompts, () => crypto.randomUUID());
        merged = result;
        return result.library;
      },
      () =>
        value === 'replace'
          ? `「${file.name}」の${count}件で上書きしました。`
          : `${merged.added}件を追加しました。${merged.skipped ? `同じ内容がすでにある${merged.skipped}件は追加していません。` : ''}`,
      detail as Promise<boolean>,
    );
  }

  // 数字キー 1〜9 で、一覧の上から n 番目をコピーする。
  document.addEventListener('keydown', (event) => {
    if (
      !active ||
      screen.value.kind !== 'library' ||
      arranging.value ||
      draft.value ||
      event.repeat ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      isEditable(event.target) ||
      document.querySelector('dialog[open], :popover-open')
    )
      return;
    const index = /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : -1;
    const prompt = shown.value[index];
    if (!prompt) return;
    event.preventDefault();
    void copy(prompt);
  });
  document.addEventListener('visibilitychange', () => {
    if (active && document.visibilityState === 'visible') void refresh();
  });

  async function startUp() {
    if (!supported) {
      showStart();
      return;
    }
    const last = await memory.load().catch(() => undefined);
    remembered.value = last;
    const permission = await last
      ?.queryPermission({ mode: 'readwrite' })
      .catch(() => 'prompt' as const);
    // ほかの操作で先にフォルダを開いていたら、そちらを優先する。
    if (screen.value.kind !== 'loading') return;
    // 許可が残っていれば、ボタンを押さずに一覧を出す。
    if (last && permission === 'granted') await openFolder(last);
    else showStart();
  }
  void startUp();

  // ── 画面 ──

  function StartScreen({ state }: { state: Extract<Screen, { kind: 'start' }> }) {
    if (!supported)
      return (
        <EmptyState icon="folder" title="このブラウザーではフォルダを使えません">
          <p>
            プロンプトは PC のフォルダにファイルとして保存します。Chrome または Edge（129
            以降）で開いてください。
          </p>
        </EmptyState>
      );
    const retry = state.retry;
    const last = remembered.value && remembered.value !== retry ? remembered.value : undefined;
    const first = !retry && !last;
    return (
      <EmptyState
        icon="folder"
        title={first ? 'プロンプトを置くフォルダを選ぶ' : '保存先のフォルダを開く'}
        actions={
          <>
            {retry && (
              <Button
                variant="primary"
                icon="refresh"
                onClick={() => void openWithPermission(retry)}
              >
                {state.retryLabel ?? `「${retry.name}」をもう一度開く`}
              </Button>
            )}
            {last && (
              <Button
                variant={retry ? 'secondary' : 'primary'}
                icon="folder-open"
                onClick={() => void openWithPermission(last)}
              >
                前回のフォルダ「{last.name}」を開く
              </Button>
            )}
            <Button
              variant={first ? 'primary' : 'secondary'}
              icon={first ? 'folder-open' : undefined}
              onClick={() => void pickFolder()}
            >
              {first ? '保存先のフォルダを選ぶ' : '別のフォルダを選ぶ'}
            </Button>
          </>
        }
        note="ホームにフォルダを置いても、保存先にできます。"
      >
        <p>
          選んだフォルダに <code class="pl-code">{LIBRARY_FILE}</code>{' '}
          を作り、プロンプトをそこに保存します。ブラウザーの中には残さないので、PC
          のファイルとして手元に残ります。一度選べば、次からは自動で開きます。
        </p>
        {pending.value !== null && (
          <p class="pl-notice">
            フォルダを開くと、受け取った文章を本文にして新しいプロンプトを作ります。
          </p>
        )}
        {state.notice && <p class="pl-notice">{state.notice}</p>}
        {state.error && (
          <p class="pl-alert" role="alert">
            {state.error}
          </p>
        )}
      </EmptyState>
    );
  }

  function Card({ prompt, index }: { prompt: Prompt; index: number }) {
    const done = copied.value === prompt.id;
    return (
      <li class="pl-card" data-copied={done ? '' : undefined}>
        <div class="pl-card-head">
          <h3 class="pl-card-title">{prompt.title}</h3>
          {index < 9 && (
            <kbd class="pl-key" title={`${index + 1} キーでもコピーできます`} aria-hidden="true">
              {index + 1}
            </kbd>
          )}
        </div>
        {prompt.summary ? (
          <p class="pl-card-summary">{prompt.summary}</p>
        ) : (
          // 概要がなければ、本文の先頭で見分けられるようにする。
          <p class="pl-card-body">{prompt.body}</p>
        )}
        {prompt.tags.length > 0 && (
          <ul class="pl-card-tags" aria-label="タグ">
            {prompt.tags.map((tag) => (
              <li key={tag}>
                <button
                  type="button"
                  class="pl-card-tag"
                  aria-pressed={chosen.value.has(tag)}
                  title={
                    chosen.value.has(tag) ? `「${tag}」の絞り込みを外す` : `「${tag}」で絞り込む`
                  }
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div class="pl-card-actions">
          <Button
            variant="primary"
            icon={done ? 'check' : 'copy'}
            class="pl-copy"
            aria-label={`「${prompt.title}」をコピー`}
            onClick={() => void copy(prompt)}
          >
            {done ? 'コピーしました' : 'コピー'}
          </Button>
          <Button
            variant="quiet"
            icon="pencil"
            aria-label={`「${prompt.title}」を編集`}
            onClick={() => openEditor(prompt)}
          >
            編集
          </Button>
        </div>
      </li>
    );
  }

  /** 並び替え・表示の切り替えの1行。行をドラッグするか、↑↓のボタンで動かす。 */
  function ArrangeRow({ prompt, index, last }: { prompt: Prompt; index: number; last: number }) {
    const placeAt = (event: DragEvent) => {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
    };
    return (
      <li
        class="pl-row"
        data-id={prompt.id}
        data-hidden={prompt.hidden ? '' : undefined}
        draggable
        onDragStart={(event) => {
          event.dataTransfer?.setData(DRAG_TYPE, prompt.id);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'move';
          (event.currentTarget as HTMLElement).dataset.drop = placeAt(event);
        }}
        onDragLeave={(event) => {
          const element = event.currentTarget as HTMLElement;
          if (!element.contains(event.relatedTarget as Node | null)) delete element.dataset.drop;
        }}
        onDrop={(event) => {
          const element = event.currentTarget as HTMLElement;
          delete element.dataset.drop;
          const id = event.dataTransfer?.getData(DRAG_TYPE);
          if (!id) return;
          event.preventDefault();
          const place = placeAt(event);
          if (id !== prompt.id) rearrange((library) => movePrompt(library, id, prompt.id, place));
        }}
        onDragEnd={() => {
          for (const row of document.querySelectorAll<HTMLElement>('.pl-row[data-drop]'))
            delete row.dataset.drop;
        }}
      >
        <Icon name="grip" class="pl-row-grip" />
        <div class="pl-row-text">
          <span class="pl-row-title">{prompt.title}</span>
          <span class="pl-row-summary">{prompt.summary || prompt.body}</span>
        </div>
        <Button
          variant="quiet"
          size="small"
          icon={prompt.hidden ? 'eye-off' : 'eye'}
          class="pl-row-visibility"
          aria-pressed={!prompt.hidden}
          aria-label={`「${prompt.title}」を一覧に表示`}
          title={prompt.hidden ? '一覧に表示する' : '一覧に出さない'}
          onClick={() => toggleHidden(prompt)}
        >
          {prompt.hidden ? '非表示' : '表示'}
        </Button>
        <IconButton
          icon="arrow-up"
          label={`「${prompt.title}」を上へ`}
          data-move="-1"
          disabled={index === 0}
          onClick={() => step(prompt, -1)}
        />
        <IconButton
          icon="arrow-down"
          label={`「${prompt.title}」を下へ`}
          data-move="1"
          disabled={index === last}
          onClick={() => step(prompt, 1)}
        />
        <IconButton
          icon="pencil"
          label={`「${prompt.title}」を編集`}
          onClick={() => openEditor(prompt)}
        />
      </li>
    );
  }

  function LibraryScreen() {
    const all = prompts.value;
    const list = shown.value;
    const total = listed.value.length;
    const hiddenCount = all.length - visible.value.length;
    if (!all.length)
      return (
        <EmptyState
          icon="clipboard"
          title="まだプロンプトがありません"
          actions={
            <Button variant="primary" icon="plus" onClick={() => openEditor()}>
              新しいプロンプト
            </Button>
          }
          note={`保存先：${opened.value?.folder.name ?? ''}／${LIBRARY_FILE}`}
        >
          <p>
            よく使うプロンプトを追加しておくと、ここからすぐにコピーできます。ホームに文章を貼り付けて「プロンプトとして残す」を選んでも追加できます。
          </p>
        </EmptyState>
      );
    return (
      <div class="pl-main">
        {tags.value.length > 0 && (
          <div class="pl-filter" role="group" aria-label="タグで絞り込む">
            <span class="pl-filter-label">
              <Icon name="tag" />
              タグ
            </span>
            <div class="pl-tags">
              {tags.value.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  class="tb-chip pl-tag"
                  aria-pressed={chosen.value.has(tag)}
                  onClick={() => toggleTag(tag)}
                >
                  {chosen.value.has(tag) && <Icon name="check" />}
                  {tag}
                </button>
              ))}
            </div>
            {chosen.value.size > 0 && (
              <Button variant="quiet" size="small" onClick={() => (selected.value = new Set())}>
                絞り込みを解除
              </Button>
            )}
          </div>
        )}
        {arranging.value ? (
          <div class="pl-arrange-bar">
            <p class="pl-arrange-note">
              行をドラッグするか ↑↓
              で並べ替え、「表示」「非表示」で一覧に出すかを切り替えます。変更はすぐ保存します。
            </p>
            <div class="pl-arrange-actions">
              <Button variant="quiet" size="small" onClick={() => void arrangeByTitle()}>
                タイトル順に並べ直す
              </Button>
              <Button
                variant="primary"
                size="small"
                icon="check"
                onClick={() => (arranging.value = false)}
              >
                完了
              </Button>
            </div>
          </div>
        ) : (
          <div class="pl-count-row">
            <p class="pl-count" aria-live="polite">
              {chosen.value.size === 0 ? `${total}件` : `${total}件中 ${list.length}件`}
              {hiddenCount > 0 && `（非表示 ${hiddenCount}件）`}
            </p>
            {list.length > 0 && (
              <p class="pl-keys">
                数字キー <kbd>1</kbd>〜<kbd>{Math.min(list.length, 9)}</kbd> でもコピーできます
              </p>
            )}
            <Button
              variant="quiet"
              size="small"
              icon="sliders"
              class="pl-arrange-open"
              onClick={() => (arranging.value = true)}
            >
              並び替え・表示
            </Button>
          </div>
        )}
        {list.length ? (
          arranging.value ? (
            <ul class="pl-rows" aria-label="並び替え・表示の切り替え">
              {list.map((prompt, index) => (
                <ArrangeRow key={prompt.id} prompt={prompt} index={index} last={list.length - 1} />
              ))}
            </ul>
          ) : (
            <ul class="pl-list">
              {list.map((prompt, index) => (
                <Card key={prompt.id} prompt={prompt} index={index} />
              ))}
            </ul>
          )
        ) : (
          <p class="pl-empty">
            {total === 0
              ? 'すべてのプロンプトを非表示にしています。「並び替え・表示」から一覧に戻せます。'
              : '選んだタグをすべて含むプロンプトはありません。'}
          </p>
        )}
      </div>
    );
  }

  function Editor({ open }: { open: boolean }) {
    const current = draft.value;
    const choices = allTags.value;
    const picked = current ? parseTags(current.tags) : [];
    const verb = current?.target ? '保存' : '追加';
    return (
      <Dialog
        open={open && Boolean(current)}
        onClose={() => void closeEditor()}
        title={current?.target ? 'プロンプトを編集' : '新しいプロンプト'}
        class="pl-editor"
        busy={busy.value}
        initialFocus={current?.title ? '#pl-body' : '#pl-title'}
        actions={
          current && (
            <>
              {current.target && (
                <Button
                  variant="danger"
                  icon="trash"
                  class="pl-delete"
                  disabled={busy.value}
                  onClick={() => void remove()}
                >
                  削除
                </Button>
              )}
              <Button disabled={busy.value} onClick={() => void closeEditor()}>
                キャンセル
              </Button>
              <Button variant="primary" type="submit" form="pl-form" disabled={busy.value}>
                {busy.value && <span class="tb-spinner" />}
                {verb}
              </Button>
            </>
          )
        }
      >
        {current && (
          <form
            id="pl-form"
            class="pl-form"
            aria-busy={busy.value || undefined}
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && hasMod(event) && !event.isComposing) {
                event.preventDefault();
                void submit();
              }
            }}
          >
            <Field label="タイトル">
              <input
                id="pl-title"
                class="tb-input"
                autocomplete="off"
                value={current.title}
                onInput={(event) => editDraft({ title: (event.target as HTMLInputElement).value })}
              />
            </Field>
            <Field label="概要" hint="一覧のカードに出します。空なら本文の先頭を出します。">
              <textarea
                class="tb-input pl-summary"
                rows={2}
                placeholder="例：会議のメモを箇条書きに要約する"
                value={current.summary}
                onInput={(event) =>
                  editDraft({ summary: (event.target as HTMLTextAreaElement).value })
                }
              />
            </Field>
            <Field label="本文" hint={`${modKey}+Enter で${verb}します。`}>
              <textarea
                id="pl-body"
                class="tb-input pl-body"
                rows={10}
                spellcheck={false}
                value={current.body}
                onInput={(event) =>
                  editDraft({ body: (event.target as HTMLTextAreaElement).value })
                }
              />
            </Field>
            <Field label="タグ" hint="空白・カンマ・読点で区切ります。">
              <input
                class="tb-input"
                autocomplete="off"
                placeholder="例：要約 文章"
                value={current.tags}
                onInput={(event) => editDraft({ tags: (event.target as HTMLInputElement).value })}
              />
            </Field>
            {choices.length > 0 && (
              <div class="pl-tag-choices" role="group" aria-label="使っているタグから選ぶ">
                {choices.map((tag) => {
                  const on = picked.includes(tag);
                  return (
                    <button
                      key={tag}
                      type="button"
                      class="tb-chip pl-tag"
                      aria-pressed={on}
                      onClick={() => {
                        const next = parseTags(current.tags);
                        const at = next.indexOf(tag);
                        if (at === -1) next.push(tag);
                        else next.splice(at, 1);
                        editDraft({ tags: formatTags(next) });
                      }}
                    >
                      {on && <Icon name="check" />}
                      {tag}
                    </button>
                  );
                })}
              </div>
            )}
            {current.error && (
              <p class="pl-alert" role="alert">
                {current.error}
              </p>
            )}
          </form>
        )}
      </Dialog>
    );
  }

  function View({ active: visible }: { active: boolean }) {
    active = visible;
    useEffect(() => {
      if (visible) void refresh();
    }, [visible]);
    const state = screen.value;
    const open = opened.value;
    return (
      <ToolFrame
        actions={
          state.kind === 'library' &&
          open && (
            <>
              <Menu
                label="保存先のフォルダ・エクスポート・インポート"
                icon="folder"
                text={<span class="pl-folder-name">{open.folder.name}</span>}
                buttonClass="pl-folder"
              >
                <MenuLabel>保存先</MenuLabel>
                <p class="pl-menu-file">
                  {open.folder.name}/{LIBRARY_FILE}
                </p>
                <MenuSeparator />
                <MenuItem icon="refresh" onClick={() => void refresh({ announce: true })}>
                  ファイルを読み直す
                </MenuItem>
                <MenuItem icon="folder-open" onClick={() => void pickFolder()}>
                  別のフォルダを選ぶ
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon="download" onClick={exportFile}>
                  エクスポート（JSON をダウンロード）
                </MenuItem>
                <MenuItem icon="file" onClick={() => void importFile()}>
                  インポート（JSON から読み込む）
                </MenuItem>
              </Menu>
              <Button variant="primary" icon="plus" onClick={() => openEditor()}>
                <span class="pl-new-label">新しいプロンプト</span>
              </Button>
            </>
          )
        }
      >
        <div class="pl tb-scroll">
          {state.kind === 'start' && <StartScreen state={state} />}
          {state.kind === 'library' && <LibraryScreen />}
        </div>
        {/* 見えていない間は閉じておき、ほかの画面を操作できなくしない。戻ったら開き直す。 */}
        <Editor open={visible} />
      </ToolFrame>
    );
  }

  return {
    View,
    status,
    async receive(intent: string, input: Incoming) {
      if (intent === 'new-from-text' && input.kind === 'text') {
        if (draft.value) {
          toast('編集中のプロンプトがあります。保存するか閉じてから、もう一度渡してください。', {
            tone: 'error',
          });
          return;
        }
        if (screen.value.kind === 'library') openEditor(undefined, input.text);
        else pending.value = input.text;
        return;
      }
      if (intent === 'use-folder' && input.kind === 'folder') {
        if (draft.value) {
          toast('編集中のプロンプトがあります。保存するか閉じてから、フォルダを置いてください。', {
            tone: 'error',
          });
          return;
        }
        const folder = input.folder;
        // 置いたフォルダへの書き込みは、ボタンを押して許可してもらう（置いただけでは許可を求められない）。
        const granted = await folder
          .queryPermission({ mode: 'readwrite' })
          .then((state) => state === 'granted')
          .catch(() => false);
        if (granted) {
          await openFolder(folder);
          return;
        }
        try {
          if (await ensureWritable(folder)) {
            await openFolder(folder);
            return;
          }
        } catch {
          // 利用者の操作の直後でないと許可を求められない。下のボタンから求める。
        }
        showStart({
          retry: folder,
          retryLabel: `「${folder.name}」を保存先にする`,
          notice: `フォルダ「${folder.name}」にプロンプトを保存するには、書き込みの許可が必要です。ボタンを押して許可してください。`,
        });
      }
    },
  };
}

export const promptLibrary: ToolDefinition = {
  id: 'prompt-library',
  name: 'プロンプト集',
  description:
    'よく使うAIチャットのプロンプトをPCのフォルダに保存し、タグで絞り込んでコピーできます。',
  icon,
  intents: [
    {
      id: 'new-from-text',
      label: 'プロンプトとして残す',
      detail: 'プロンプト集：この文章を本文にして、新しいプロンプトを作る',
      icon: 'clipboard',
      accepts: (input) => input.kind === 'text' && input.text.trim() !== '',
    },
    {
      id: 'use-folder',
      label: 'プロンプトの保存先にする',
      detail: `プロンプト集：このフォルダに ${LIBRARY_FILE} を置いて使う`,
      icon: 'folder',
      accepts: (input) => input.kind === 'folder' && canUseFolders(),
      // フォルダはドラッグ中に種類（MIME）が空になる。
      mayAccept: (hint) => hint.count === 1 && hint.types[0] === '' && canUseFolders(),
    },
  ],
  create,
};
