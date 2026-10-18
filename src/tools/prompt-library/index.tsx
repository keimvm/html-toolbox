// プロンプト集。よく使うプロンプトを、使う人が選んだフォルダの prompt-library.json に置き、タグで絞り込んでコピーする。
// 正本はフォルダのファイル。追加・編集・削除を確定した時だけ、直前に読み直した内容に当てて書く（changeLibrary）。
// ブラウザーの中（IndexedDB）にはフォルダの記録だけを置き、プロンプトの本文は入れない。
import { batch, computed, signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { ToolFrame } from '../../app/frame';
import type { Incoming, ToolDefinition } from '../../app/tool';
import { copyText } from '../../lib/clipboard';
import { canUseFolders, errorName } from '../../lib/files';
import { hasMod, isEditable, modKey } from '../../lib/platform';
import {
  ask,
  Button,
  confirmAction,
  Dialog,
  EmptyState,
  Field,
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
  body: string;
  tags: string;
  error?: string;
  /** 開いたときの内容。閉じる前の確認に使う。 */
  initial: string;
}

const snapshot = (draft: Pick<Draft, 'title' | 'body' | 'tags'>) =>
  JSON.stringify([draft.title, draft.body, draft.tags]);
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
  let active = false;
  let copiedTimer = 0;

  const prompts = computed(() => library.value?.prompts ?? []);
  const tags = computed(() => usedTags(prompts.value));
  /** 選んだタグのうち、まだ使われているもの。 */
  const chosen = computed(
    () => new Set([...selected.value].filter((tag) => tags.value.includes(tag))),
  );
  const shown = computed(() => sortPrompts(filterByTags(prompts.value, chosen.value)));

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
      if (opened.value?.folder !== folder) selected.value = new Set();
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
    const fields = prompt
      ? { title: prompt.title, body: prompt.body, tags: formatTags(prompt.tags) }
      : // 絞り込んでいるタグを最初から付け、追加したプロンプトが今の一覧に出るようにする。
        { title: '', body: body ?? '', tags: formatTags([...chosen.value]) };
    draft.value = { target: prompt, ...fields, initial: snapshot(fields) };
  }

  function editDraft(change: Partial<Pick<Draft, 'title' | 'body' | 'tags'>>) {
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
    done: string,
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
      toast(done, { tone: 'success' });
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

  // 数字キー 1〜9 で、一覧の上から n 番目をコピーする。
  document.addEventListener('keydown', (event) => {
    if (
      !active ||
      screen.value.kind !== 'library' ||
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
        <p class="pl-card-body">{prompt.body}</p>
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

  function LibraryScreen() {
    const all = prompts.value;
    const list = shown.value;
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
        <div class="pl-count-row">
          <p class="pl-count" aria-live="polite">
            {chosen.value.size === 0 ? `${all.length}件` : `${all.length}件中 ${list.length}件`}
          </p>
          {list.length > 0 && (
            <p class="pl-keys">
              数字キー <kbd>1</kbd>〜<kbd>{Math.min(list.length, 9)}</kbd> でもコピーできます
            </p>
          )}
        </div>
        {list.length ? (
          <ul class="pl-list">
            {list.map((prompt, index) => (
              <Card key={prompt.id} prompt={prompt} index={index} />
            ))}
          </ul>
        ) : (
          <p class="pl-empty">選んだタグをすべて含むプロンプトはありません。</p>
        )}
      </div>
    );
  }

  function Editor({ open }: { open: boolean }) {
    const current = draft.value;
    const choices = tags.value;
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
                label="保存先のフォルダ"
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
