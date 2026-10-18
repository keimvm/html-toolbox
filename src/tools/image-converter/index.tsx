// 画像変換。写真・スクリーンショットの大きさ・容量・形式を、仕上がりを確かめながら変える。矢印・枠・文字などを書き込める。
// 画面は1つ：左に画像の列、中央に開いた画像の編集（editor.tsx）、右に仕上がり（すべての画像の条件と、この画像の容量・保存）。
// PDF は、ページを画像にする・一覧の画像をまとめて1つの PDF にする（共有の PDF エンジン）。PDF を小さくするのは PDF編集で行う。
// 元のファイルは読むだけで、結果はすべてダウンロードで別のファイルとして保存する。作業内容はブラウザーに残さない。
import { computed, signal } from '@preact/signals';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { ToolFrame } from '../../app/frame';
import type { Incoming, ToolDefinition } from '../../app/tool';
import { openTool } from '../../app/workspace';
import { pdfEngine } from '../../engine/pdf/client';
import type { Rotation } from '../../engine/pdf/types';
import { downloadBlob } from '../../lib/download';
import { errorText, isImage, isPdf, pickFiles } from '../../lib/files';
import { baseName, formatBytes } from '../../lib/format';
import { hasMod, isEditable, modKey } from '../../lib/platform';
import {
  Button,
  confirmAction,
  Dialog,
  EmptyState,
  IconButton,
  Menu,
  MenuItem,
  Segmented,
  toast,
} from '../../ui/components';
import { useDropZone } from '../../ui/drop';
import { Icon } from '../../ui/icons';
import { createEditor } from './editor';
import { createItems, isPending, type Item } from './items';
import { mimeType, parseLimit, parseLongSide, type FormatChoice, type LimitUnit } from './settings';
import icon from './icon.png';
import './style.css';

/** PDF のページを画像にするときの細かさ。長い辺の設定で、ここから縮める。 */
const PAGE_DPI = 200;
/** 「すべて保存」で、ダウンロードを始める間隔（ミリ秒）。 */
const SAVE_INTERVAL = 300;
const LONG_SIDES = [800, 1280, 1600, 1920, 2560, 3840];
const COMBINED_NAME = '画像まとめ.pdf';
/** 一覧の中で画像を並べ替えるドラッグの印。ファイルのドロップとは区別する。 */
const DRAG_TYPE = 'application/x-toolbox-image';
/** 左の列で前後の画像へ移るキー。縦並び・横並び（狭い画面）のどちらでも使う。 */
const RAIL_STEPS: Record<string, number> = {
  ArrowUp: -1,
  ArrowLeft: -1,
  ArrowDown: 1,
  ArrowRight: 1,
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Made {
  blob: Blob;
  saved: boolean;
}
interface Combine {
  busy: boolean;
  message: string;
  result: (Made & { pages: number }) | null;
}

function create() {
  const store = createItems();
  const notice = signal('');
  const combine = signal<Combine | null>(null);
  const limitText = signal('1');
  const limitUnit = signal<LimitUnit>('MB');
  const longText = signal('1920');
  let active = false;
  let settingsTimer = 0;
  let pasted = 0;
  const editor = createEditor(store, {
    onSave: (item) => {
      if (store.save(item)) toast(`「${item.name}」の保存を始めました。`, { tone: 'success' });
      else if (item.error) toast(item.error, { tone: 'error' });
      else toast('変換が終わってから保存してください。');
    },
  });

  const status = computed(() => {
    void store.revision.value;
    const items = store.items.value;
    const writing = editor.pendingText.value ? editor.current.value : null;
    const unsaved = items.filter((item) => !item.error && (!item.saved || item === writing)).length;
    const made = Boolean(combine.value?.result && !combine.value.result.saved);
    return {
      title: editor.current.value?.name,
      summary: items.length
        ? `${items.length}枚${unsaved ? `・未保存 ${unsaved}枚` : '・すべて保存済み'}`
        : undefined,
      unsaved: unsaved > 0 || made,
      // 作業内容はブラウザーに残さないため、閉じると失う。
      guard: unsaved > 0 || made,
    };
  });

  // ── 全体の設定 ──

  function applySettings() {
    clearTimeout(settingsTimer);
    store.setSettings({
      format: store.settings.value.format,
      limit: parseLimit(limitText.value, limitUnit.value),
      longSide: parseLongSide(longText.value),
    });
  }
  function applySoon() {
    clearTimeout(settingsTimer);
    settingsTimer = window.setTimeout(applySettings, 400);
  }

  // ── 一覧に加える・外す ──

  async function addPdf(file: File, reveal: (item: Item) => void) {
    const id = `image-converter-${crypto.randomUUID()}`;
    const label = `「${file.name}」`;
    const added: Item[] = [];
    notice.value = `${label}を読み込んでいます…`;
    try {
      const engine = pdfEngine();
      const content = await file.arrayBuffer();
      const doc = await engine.call('open', { id, content }, [content]);
      const count = doc.pages.length;
      try {
        const digits = Math.max(2, String(count).length);
        for (const [index, page] of doc.pages.entries()) {
          notice.value = `${label}のページを画像にしています（${index + 1} / ${count}）`;
          const blob = await engine.call('render', {
            page: {
              sourceId: id,
              sourceIndex: index,
              rotation: ((page.rotation * 90) % 360) as Rotation,
            },
            scale: PAGE_DPI / 72,
          });
          const base = `${baseName(file.name)}-p${String(index + 1).padStart(digits, '0')}`;
          const item = store.add(blob, `${base}.png`, `${file.name} の ${index + 1} ページ`, base);
          added.push(item);
          reveal(item);
        }
      } finally {
        await engine.call('close', { id }).catch(() => false);
      }
      notice.value = `${label}の ${count} ページを一覧に加えました。`;
    } catch (error) {
      notice.value = `${label}を開けません。${errorText(error)}`;
    }
    return added;
  }

  let adding: Promise<void> = Promise.resolve();
  /** 順番に一覧へ加え、加えた画像を返す。最初に加えた画像を開く。 */
  function addFiles(files: File[]) {
    const added = adding.then(async () => {
      const items: Item[] = [];
      let revealed = false;
      const reveal = (item: Item) => {
        if (revealed) return;
        revealed = true;
        void editor.open(item);
      };
      for (const file of files) {
        if (isPdf(file)) items.push(...(await addPdf(file, reveal)));
        else {
          notice.value = '';
          const item = store.add(file, file.name, file.name, `${baseName(file.name)}-変換`);
          items.push(item);
          reveal(item);
        }
      }
      return items;
    });
    // 順番待ちには完了だけを残し、一覧から消した画像を戻り値で保持し続けない。
    adding = added.then(() => {});
    return added;
  }

  async function chooseFiles() {
    const files = await pickFiles({ accept: 'image/*,.heic,.heif,application/pdf,.pdf' });
    if (files.length) void addFiles(files);
  }

  function remove(item: Item) {
    const items = store.items.value;
    if (editor.current.value === item) {
      const index = items.indexOf(item);
      void editor.open(items[index + 1] ?? items[index - 1] ?? null);
    }
    store.remove(item);
  }

  async function saveAll() {
    notice.value = '変換が終わるのを待っています…';
    editor.finishText();
    await store.idle();
    const ready = store.ready();
    for (const [index, item] of ready.entries()) {
      store.save(item);
      if (index < ready.length - 1) await wait(SAVE_INTERVAL);
    }
    notice.value = ready.length
      ? `${ready.length} 枚の保存を始めました。ブラウザーが複数のファイルのダウンロードを確かめたら、許可してください。`
      : '保存できる画像がありません。';
  }

  async function clearAll() {
    const unsaved = store.items.value.some((item) => !item.error && !item.saved);
    if (
      unsaved &&
      !(await confirmAction(
        '一覧の画像をすべて消しますか？',
        '保存していない変換結果と書き込みは失われます。元のファイルは消えません。',
        { ok: 'すべて消す', danger: true },
      ))
    )
      return;
    await editor.open(null);
    store.clear();
    notice.value = '';
  }

  // ── PDF にまとめる ──

  /** 一覧の画像（only を渡したらその画像だけ）を、一覧の順に1枚1ページの PDF にする。 */
  async function makePdf(only?: readonly Item[]) {
    editor.finishText();
    combine.value = { busy: true, message: '変換が終わるのを待っています…', result: null };
    const update = (next: Partial<Combine>) => {
      if (combine.value) combine.value = { ...combine.value, ...next };
    };
    try {
      await store.idle();
      const ready = store.ready().filter((item) => !only || only.includes(item));
      if (!ready.length) {
        update({ busy: false, message: 'PDFにできる画像がありません。' });
        return;
      }
      update({ message: `${ready.length} ページの PDF を作っています…` });
      const images = await Promise.all(
        ready.map(async (item) => ({
          data: await item.result!.blob.arrayBuffer(),
          type: mimeType(item.result!.format),
          width: item.result!.width,
          height: item.result!.height,
        })),
      );
      const content = await pdfEngine().call(
        'create',
        { images },
        images.map((image) => image.data),
      );
      if (!combine.value) return;
      combine.value = {
        busy: false,
        message: `${ready.length} ページ・${formatBytes(content.byteLength)} の PDF ができました。ページの順は左の一覧の順です。`,
        result: {
          blob: new Blob([content], { type: 'application/pdf' }),
          saved: false,
          pages: ready.length,
        },
      };
    } catch (error) {
      if (combine.value)
        combine.value = {
          busy: false,
          message: `PDFを作れませんでした。${errorText(error)}`,
          result: null,
        };
    }
  }

  async function closeCombine() {
    const state = combine.value;
    if (!state || state.busy) return;
    if (
      state.result &&
      !state.result.saved &&
      !(await confirmAction('保存せずに閉じますか？', 'まとめた PDF はまだ保存していません。', {
        ok: '閉じる',
      }))
    )
      return;
    combine.value = null;
  }

  const dialogOpen = () =>
    Boolean(combine.value) || Boolean(document.querySelector('dialog[open]'));

  // 画面を見ている間に貼り付けた画像を、一覧に加えて開く。
  document.addEventListener('paste', (event) => {
    if (!active || dialogOpen() || isEditable(event.target)) return;
    const files = Array.from(event.clipboardData?.files ?? []).filter(
      (file) => isImage(file) || isPdf(file),
    );
    if (!files.length) return;
    event.preventDefault();
    void addFiles(
      files.map((file) =>
        // スクリーンショットの貼り付けは、どれも image.png という名前になる。
        file.name === 'image.png'
          ? new File([file], `貼り付けた画像-${++pasted}.png`, { type: file.type })
          : file,
      ),
    );
  });

  // 編集のキー操作（道具の切り替え・取り消し・コピーなど）。入力欄では文字の入力を優先する。
  // 左の画像の列は自分で矢印キーを扱うため、⌘・Ctrl のショートカットだけを渡す。
  document.addEventListener('keydown', (event) => {
    if (!active || dialogOpen() || !store.items.value.length) return;
    const target = event.target as Element | null;
    const toggle =
      target instanceof HTMLInputElement && (target.type === 'radio' || target.type === 'checkbox');
    if ((isEditable(target) && !toggle) || document.querySelector('.tb-popover:popover-open'))
      return;
    if (target?.closest?.('.ic-rail') && !hasMod(event)) return;
    editor.handleKey(event);
  });

  // ── 画面 ──

  const draggedItem = (event: DragEvent) => {
    const id = Number(event.dataTransfer?.getData(DRAG_TYPE));
    return store.items.value.find((other) => other.id === id);
  };

  /** 左の列の1枚。押すと開き、ドラッグで並べ替える。 */
  function RailItem({ item, index }: { item: Item; index: number }) {
    // signal を読む部品は、props が同じなら親が描き直しても省かれる。item は直接書き換えるため、revision を読んで変換の済んだ画像を描き直す。
    void store.revision.value;
    const pending = isPending(item);
    const result = item.result;
    const over = !pending && !item.error && result?.fits === false;
    const current = editor.current.value === item;
    return (
      <li
        class="ic-rail-item"
        data-current={current ? '' : undefined}
        data-pending={pending ? '' : undefined}
        data-over={over ? '' : undefined}
        data-error={item.error ? '' : undefined}
        draggable
        onDragStart={(event) => {
          event.dataTransfer?.setData(DRAG_TYPE, String(item.id));
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return;
          event.preventDefault();
          (event.currentTarget as HTMLElement).dataset.dropTarget = '';
        }}
        onDragLeave={(event) => delete (event.currentTarget as HTMLElement).dataset.dropTarget}
        onDrop={(event) => {
          delete (event.currentTarget as HTMLElement).dataset.dropTarget;
          const dragged = draggedItem(event);
          if (!dragged) return;
          event.preventDefault();
          // 落とした画像の前に入れる。
          if (dragged !== item)
            store.move(
              dragged,
              store.items.value.filter((other) => other !== dragged).indexOf(item),
            );
        }}
      >
        <button
          type="button"
          class="ic-rail-thumb"
          data-item={item.id}
          aria-current={current ? 'true' : undefined}
          aria-label={`${index + 1}枚目「${item.name}」を開く`}
          title={item.source}
          onClick={() => void editor.open(item)}
        >
          <span class="ic-rail-image">
            {item.thumbnailUrl ? (
              <img src={item.thumbnailUrl} alt="" draggable={false} />
            ) : item.error ? (
              <Icon name="image" />
            ) : (
              <span class="tb-spinner" />
            )}
            {pending && item.thumbnailUrl && <span class="tb-spinner ic-rail-spinner" />}
          </span>
          <span class="ic-rail-name">{item.name}</span>
          <span class="ic-rail-size">
            {item.error ? (
              '開けません'
            ) : pending || !result ? (
              '計算中…'
            ) : (
              <>
                {formatBytes(result.blob.size)}
                {over && (
                  <span class="ic-rail-flag" data-tone="warning">
                    上限超え
                  </span>
                )}
                {item.saved && <Icon name="check" class="ic-rail-saved" label="保存済み" />}
              </>
            )}
          </span>
        </button>
        <IconButton
          icon="x"
          label={`「${item.name}」を一覧から外す`}
          class="ic-rail-remove tb-small"
          onClick={() => remove(item)}
        />
      </li>
    );
  }

  function Rail() {
    void store.revision.value;
    const items = store.items.value;
    const usable = items.filter((item) => !item.error);
    const ready = store.ready();
    const waiting = items.filter(isPending).length;
    const over = ready.filter((item) => item.result?.fits === false).length;
    const errors = items.length - usable.length;
    const total = ready.reduce((sum, item) => sum + item.result!.blob.size, 0);
    const original = usable.reduce((sum, item) => sum + item.file.size, 0);
    const list = useRef<HTMLOListElement>(null);
    const current = editor.current.value;
    // 開いた画像が列の外にあれば、列の中だけを動かして見せる（画面全体は動かさない）。
    useLayoutEffect(() => {
      const rail = list.current;
      const element = rail?.querySelector<HTMLElement>(`[data-item="${current?.id}"]`);
      if (!rail || !element) return;
      const bounds = element.getBoundingClientRect();
      const box = rail.getBoundingClientRect();
      if (bounds.top < box.top) rail.scrollTop += bounds.top - box.top - 8;
      else if (bounds.bottom > box.bottom) rail.scrollTop += bounds.bottom - box.bottom + 8;
      if (bounds.left < box.left) rail.scrollLeft += bounds.left - box.left - 8;
      else if (bounds.right > box.right) rail.scrollLeft += bounds.right - box.right + 8;
    }, [current]);
    return (
      <nav class="ic-rail" aria-label="画像の一覧">
        <div class="ic-rail-head">
          <span>画像</span>
          <span class="ic-rail-count">{items.length}</span>
        </div>
        <ol
          class="ic-rail-list tb-scroll"
          ref={list}
          onKeyDown={(event) => {
            const step = RAIL_STEPS[event.key];
            if (!step || hasMod(event) || event.altKey || !current) return;
            event.preventDefault();
            event.stopPropagation();
            const next = items[items.indexOf(current) + step];
            if (!next) return;
            void editor.open(next);
            queueMicrotask(() =>
              list.current?.querySelector<HTMLElement>(`[data-item="${next.id}"]`)?.focus(),
            );
          }}
        >
          {items.map((item, index) => (
            <RailItem key={item.id} item={item} index={index} />
          ))}
          <li
            class="ic-rail-add-item"
            onDragOver={(event) => {
              if (!event.dataTransfer?.types.includes(DRAG_TYPE)) return;
              event.preventDefault();
              (event.currentTarget as HTMLElement).dataset.dropTarget = '';
            }}
            onDragLeave={(event) => delete (event.currentTarget as HTMLElement).dataset.dropTarget}
            onDrop={(event) => {
              delete (event.currentTarget as HTMLElement).dataset.dropTarget;
              const dragged = draggedItem(event);
              if (!dragged) return;
              event.preventDefault();
              // 「追加」の上に落としたら、最後に動かす。
              store.move(dragged, items.length);
            }}
          >
            <button type="button" class="ic-rail-add" onClick={() => void chooseFiles()}>
              <Icon name="plus" />
              追加
            </button>
          </li>
        </ol>
        <div class="ic-rail-foot" aria-live="polite">
          {notice.value && <p class="ic-rail-notice">{notice.value}</p>}
          <p class="ic-rail-total">
            合計 <strong>{formatBytes(total)}</strong>
            <span class="ic-muted">（元 {formatBytes(original)}）</span>
          </p>
          {waiting > 0 && (
            <p class="ic-rail-line">
              <span class="tb-spinner" /> {waiting} 枚を計算中
            </p>
          )}
          {over > 0 && <p class="ic-rail-line ic-warning">上限を超えた画像 {over} 枚</p>}
          {errors > 0 && <p class="ic-rail-line ic-warning">開けないファイル {errors} 件</p>}
        </div>
      </nav>
    );
  }

  /** 右のパネルの「すべての画像」：形式・上限・長い辺。全部の画像に当たる。 */
  function Conditions() {
    const settings = store.settings.value;
    return (
      <section class="ic-section" aria-labelledby="ic-all-title">
        <h2 class="ic-section-title" id="ic-all-title">
          すべての画像
        </h2>
        <form
          class="ic-conditions"
          onSubmit={(event) => {
            event.preventDefault();
            applySettings();
          }}
        >
          <div class="ic-field">
            <span>形式</span>
            <Segmented<FormatChoice>
              label="形式"
              value={settings.format}
              onChange={(format) => store.setSettings({ ...store.settings.value, format })}
              options={[
                {
                  value: 'auto',
                  label: '自動',
                  title:
                    'スクリーンショット・図など、PNG でも小さく収まる画像は PNG、写真は JPEG にします。',
                },
                {
                  value: 'jpeg',
                  label: 'JPEG',
                  title: '写真向き。容量の上限に合わせて画質を自動で選びます。',
                },
                { value: 'png', label: 'PNG', title: '画面・図向き。画質の段階はありません。' },
              ]}
            />
          </div>
          <div class="ic-condition-row">
            <label class="ic-field">
              <span>1枚あたりの上限</span>
              <span class="ic-with-unit">
                <input
                  class="tb-input ic-number"
                  type="number"
                  min="0"
                  step="any"
                  inputmode="decimal"
                  placeholder="なし"
                  value={limitText.value}
                  onInput={(event) => {
                    limitText.value = (event.target as HTMLInputElement).value;
                    applySoon();
                  }}
                  onChange={applySettings}
                />
                <select
                  class="tb-input"
                  aria-label="上限の単位"
                  value={limitUnit.value}
                  onChange={(event) => {
                    limitUnit.value = (event.target as HTMLSelectElement).value as LimitUnit;
                    applySettings();
                  }}
                >
                  <option value="KB">KB</option>
                  <option value="MB">MB</option>
                </select>
              </span>
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
                  placeholder="元のまま"
                  value={longText.value}
                  onInput={(event) => {
                    longText.value = (event.target as HTMLInputElement).value;
                    applySoon();
                  }}
                  onChange={applySettings}
                />
                px
              </span>
            </label>
          </div>
          <p class="ic-note">
            上限は 1 KB = 1,000
            バイトで数えます（添付先の数え方より少し小さめに収まります）。空にすると上限なし・元の大きさのままです。
          </p>
        </form>
      </section>
    );
  }

  /** ヘッダーの中央：開いている画像の名前と位置。 */
  function Current() {
    const item = editor.current.value;
    const items = store.items.value;
    if (!item) return null;
    return (
      <div class="ic-current">
        <Icon name="image" />
        <span class="ic-current-name" title={item.source}>
          {item.name}
        </span>
        <span class="ic-current-position">
          {items.indexOf(item) + 1} / {items.length}
        </span>
      </div>
    );
  }

  function CombineDialog({ open }: { open: boolean }) {
    const state = combine.value;
    return (
      <Dialog
        open={open && Boolean(state)}
        onClose={() => void closeCombine()}
        title="PDFにまとめる"
        busy={state?.busy}
        actions={
          state && (
            <>
              {state.result && (
                <Button
                  icon="external-link"
                  onClick={() => {
                    const result = state.result!;
                    combine.value = null;
                    openTool('pdf-edit', {
                      intent: 'open',
                      input: {
                        kind: 'files',
                        files: [
                          new File([result.blob], COMBINED_NAME, { type: 'application/pdf' }),
                        ],
                      },
                    });
                  }}
                >
                  PDF編集で開く
                </Button>
              )}
              <Button disabled={state.busy} onClick={() => void closeCombine()}>
                閉じる
              </Button>
              <Button
                variant="primary"
                icon="download"
                disabled={!state.result}
                onClick={() => {
                  if (!state.result) return;
                  downloadBlob(state.result.blob, COMBINED_NAME);
                  combine.value = { ...state, result: { ...state.result, saved: true } };
                }}
              >
                {state.result?.saved ? 'もう一度保存' : '保存'}
              </Button>
            </>
          )
        }
      >
        {state && (
          <div class="ic-dialog-body">
            {state.busy && <div class="tb-progress" />}
            <p class="tb-dialog-text" role="status">
              {state.message}
            </p>
            {state.result?.saved && (
              <p class="tb-dialog-text">「{COMBINED_NAME}」の保存を始めました。</p>
            )}
          </div>
        )}
      </Dialog>
    );
  }

  function Empty() {
    return (
      <EmptyState
        icon="images"
        title="画像を整えて、添付できる大きさにする"
        actions={
          <Button variant="primary" size="large" icon="plus" onClick={() => void chooseFiles()}>
            画像・PDFを選ぶ
          </Button>
        }
        note={
          <>
            スクリーンショットは <kbd>{modKey}</kbd>
            <kbd>V</kbd> で貼り付け。ドロップでも加えられます。元のファイルは変更しません。
          </>
        }
      >
        <p>
          写真やスクリーンショットを、添付できる容量に収めます。矢印・枠・文字・番号を書き込んだり、見せたくない部分を黒く隠したりして、そのままコピー・保存できます。位置情報などの付加情報は残しません。PDF
          を選ぶと、各ページを画像として並べます。
        </p>
        {notice.value && <p class="ic-notice">{notice.value}</p>}
      </EmptyState>
    );
  }

  function View({ active: visible }: { active: boolean }) {
    active = visible;
    void store.revision.value;
    const items = store.items.value;
    const usable = items.filter((item) => !item.error);
    const zone = useDropZone<HTMLDivElement>({
      enabled: () => active && !dialogOpen(),
      label: () => 'ここにドロップして一覧に加える',
      onDrop: (dropped) => {
        if (dropped.files.length) void addFiles(dropped.files);
        else if (dropped.hasFolder)
          notice.value = 'フォルダは加えられません。中の画像を選んでください。';
      },
    });
    useEffect(() => () => clearTimeout(settingsTimer), []);
    // 見えなくなるときは、書いている途中の文字を確定しておく。
    useEffect(() => {
      if (!visible) editor.finishText();
    }, [visible]);
    return (
      <ToolFrame
        center={items.length ? <Current /> : undefined}
        actions={
          items.length > 0 ? (
            <>
              <Button icon="plus" class="ic-header-add" onClick={() => void chooseFiles()}>
                追加
              </Button>
              <Button icon="pdf" disabled={!usable.length} onClick={() => void makePdf()}>
                PDFにまとめる
              </Button>
              {usable.length > 1 && (
                <Button variant="primary" icon="download" onClick={() => void saveAll()}>
                  すべて保存
                </Button>
              )}
              <Menu label="ほかの操作">
                <MenuItem icon="trash" onClick={() => void clearAll()}>
                  一覧の画像をすべて消す
                </MenuItem>
              </Menu>
            </>
          ) : undefined
        }
      >
        <div class="ic" ref={zone}>
          {items.length ? (
            <div class="ic-bench">
              <Rail />
              <editor.Stage />
              <aside class="ic-panel tb-scroll" aria-label="仕上がり">
                <Conditions />
                <editor.ItemPanel />
              </aside>
            </div>
          ) : (
            <div class="ic-empty tb-scroll">
              <Empty />
            </div>
          )}
        </div>
        <datalist id="ic-long-list">
          {LONG_SIDES.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <CombineDialog open={visible} />
      </ToolFrame>
    );
  }

  return {
    View,
    status,
    async receive(intent: string, input: Incoming) {
      if (input.kind !== 'files') return;
      if (intent === 'combine') {
        // 一覧にすでにある画像は入れず、渡された画像だけをまとめる。
        await makePdf(await addFiles(input.files));
        return;
      }
      void addFiles(input.files);
    },
  };
}

const imageOrPdf = (file: File) => isImage(file) || isPdf(file);

export const imageConverter: ToolDefinition = {
  id: 'image-converter',
  name: '画像変換',
  description:
    '画像の大きさ・容量・形式を、仕上がりを確かめながら変えられます。矢印・枠・文字の書き込み、PDFとの相互変換もできます。',
  icon,
  intents: [
    {
      id: 'add',
      label: '整える・容量を変える',
      detail:
        '画像変換：矢印・枠・文字を書き込み、容量・大きさ・形式を変える（PDF はページを画像に）',
      icon: 'images',
      accepts: (input) =>
        input.kind === 'files' && input.files.length > 0 && input.files.every(imageOrPdf),
      mayAccept: (hint) =>
        hint.count > 0 &&
        hint.types.every((type) => type.startsWith('image/') || type === 'application/pdf'),
    },
    {
      id: 'combine',
      label: 'まとめて1つのPDFにする',
      detail: '画像変換：画像を1枚1ページにした PDF を作る',
      icon: 'combine',
      accepts: (input) =>
        input.kind === 'files' && input.files.length >= 2 && input.files.every(isImage),
      mayAccept: (hint) => hint.count >= 2 && hint.types.every((type) => type.startsWith('image/')),
    },
  ],
  create,
};
