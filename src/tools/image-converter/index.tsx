// 画像変換。写真・スクリーンショットの大きさ・容量・形式を、仕上がりを確かめながら変える。
// PDF は、ページを画像にする・一覧の画像をまとめて1つの PDF にする・PDF のまま小さくする（共有の PDF エンジン）。
// 元のファイルは読むだけで、結果はすべてダウンロードで別のファイルとして保存する。作業内容はブラウザーに残さない。
import { computed, signal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { ToolFrame } from '../../app/frame';
import type { Incoming, ToolDefinition } from '../../app/tool';
import { openTool } from '../../app/workspace';
import { pdfEngine } from '../../engine/pdf/client';
import type { Rotation, ShrinkOptions } from '../../engine/pdf/types';
import { downloadBlob } from '../../lib/download';
import { isImage, isPdf, pickFiles } from '../../lib/files';
import { baseName, formatBytes } from '../../lib/format';
import {
  Button,
  confirmAction,
  Dialog,
  EmptyState,
  IconButton,
  Segmented,
  toast,
} from '../../ui/components';
import { useDropZone } from '../../ui/drop';
import { Icon } from '../../ui/icons';
import { createDetail } from './detail';
import { createItems, isPending, type Item } from './items';
import { mimeType, parseLimit, parseLongSide, type Format, type LimitUnit } from './settings';
import icon from './icon.png';
import './style.css';

/** PDF のページを画像にするときの細かさ。長い辺の設定で、ここから縮める。 */
const PAGE_DPI = 200;
/** 「すべて保存」で、ダウンロードを始める間隔（ミリ秒）。 */
const SAVE_INTERVAL = 300;
const SHRINK_PRESETS = {
  high: { dpi: 200, quality: 0.85 },
  standard: { dpi: 150, quality: 0.75 },
  small: { dpi: 100, quality: 0.6 },
} satisfies Record<string, ShrinkOptions>;
type Preset = keyof typeof SHRINK_PRESETS;
const LONG_SIDES = [800, 1280, 1600, 1920, 2560, 3840];
const COMBINED_NAME = '画像まとめ.pdf';

const message = (error: unknown) => (error instanceof Error ? error.message : '');
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const editable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

interface Made {
  blob: Blob;
  saved: boolean;
}
interface Combine {
  busy: boolean;
  message: string;
  result: (Made & { pages: number }) | null;
}
interface Shrink {
  file: File | null;
  preset: Preset;
  running: boolean;
  message: string;
  result: Made | null;
}

function create() {
  const store = createItems();
  const notice = signal('');
  const combine = signal<Combine | null>(null);
  const shrink = signal<Shrink | null>(null);
  const limitText = signal('1');
  const limitUnit = signal<LimitUnit>('MB');
  const longText = signal('1920');
  let active = false;
  let settingsTimer = 0;
  let pasted = 0;
  const detail = createDetail(store, {
    onSave: (item) => {
      if (store.save(item)) toast(`「${item.name}」の保存を始めました。`, { tone: 'success' });
    },
  });

  const status = computed(() => {
    void store.revision.value;
    const items = store.items.value;
    const unsaved = items.filter((item) => !item.error && !item.saved).length;
    const made =
      Boolean(combine.value?.result && !combine.value.result.saved) ||
      Boolean(shrink.value?.result && !shrink.value.result.saved);
    return {
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

  // ── 一覧に加える ──

  async function addPdf(file: File) {
    const id = `image-converter-${crypto.randomUUID()}`;
    const label = `「${file.name}」`;
    notice.value = `${label}を読み込んでいます…`;
    try {
      const engine = pdfEngine();
      const doc = await engine.call('open', { id, content: await file.arrayBuffer() });
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
          store.add(blob, `${base}.png`, `${file.name} の ${index + 1} ページ`, base);
        }
      } finally {
        await engine.call('close', { id }).catch(() => false);
      }
      notice.value = `${label}の ${count} ページを一覧に加えました。`;
    } catch (error) {
      notice.value = `${label}を開けません。${message(error)}`;
    }
  }

  let adding: Promise<void> = Promise.resolve();
  function addFiles(files: File[]) {
    adding = adding.then(async () => {
      for (const file of files) {
        if (isPdf(file)) await addPdf(file);
        else {
          notice.value = '';
          store.add(file, file.name, file.name, `${baseName(file.name)}-変換`);
        }
      }
    });
    return adding;
  }

  async function chooseFiles() {
    const files = await pickFiles({ accept: 'image/*,.heic,.heif,application/pdf,.pdf' });
    if (files.length) void addFiles(files);
  }

  async function saveAll() {
    notice.value = '変換が終わるのを待っています…';
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
        '保存していない変換結果は失われます。元のファイルは消えません。',
        { ok: 'すべて消す', danger: true },
      ))
    )
      return;
    detail.close();
    store.clear();
    notice.value = '';
  }

  // ── PDF にまとめる ──

  async function makePdf() {
    combine.value = { busy: true, message: '変換が終わるのを待っています…', result: null };
    const update = (next: Partial<Combine>) => {
      if (combine.value) combine.value = { ...combine.value, ...next };
    };
    try {
      await store.idle();
      const ready = store.ready();
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
        message: `${ready.length} ページ・${formatBytes(content.byteLength)} の PDF ができました。ページの順は一覧の順です。`,
        result: {
          blob: new Blob([content], { type: 'application/pdf' }),
          saved: false,
          pages: ready.length,
        },
      };
    } catch (error) {
      if (combine.value)
        combine.value = { busy: false, message: `PDFを作れませんでした。${message(error)}`, result: null };
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

  // ── PDF を小さくする ──

  function openShrink(file?: File) {
    shrink.value = {
      file: null,
      preset: shrink.value?.preset ?? 'standard',
      running: false,
      message: '',
      result: null,
    };
    if (file) setShrinkFile(file);
  }

  function setShrinkFile(file: File | undefined) {
    const state = shrink.value;
    if (!file || !state || state.running) return;
    if (!isPdf(file)) {
      shrink.value = { ...state, message: 'PDF を選んでください。' };
      return;
    }
    shrink.value = { ...state, file, result: null, message: '' };
  }

  async function runShrink() {
    const state = shrink.value;
    const file = state?.file;
    if (!state || !file || state.running) return;
    shrink.value = {
      ...state,
      running: true,
      result: null,
      message: '小さくしています…（ページや画像が多いと時間がかかります）',
    };
    const finish = (next: Partial<Shrink>) => {
      if (shrink.value) shrink.value = { ...shrink.value, running: false, ...next };
    };
    try {
      const result = await pdfEngine().call('shrink', {
        content: await file.arrayBuffer(),
        options: SHRINK_PRESETS[state.preset],
      });
      const size = result.content.byteLength;
      const sizes = `${formatBytes(file.size)} → ${formatBytes(size)}`;
      if (!result.replaced)
        finish({
          message: result.images
            ? `縮められる画像がありませんでした（画像 ${result.images} 個）。透過のある画像や、すでに十分小さい画像は元のまま残します。`
            : 'ページに画像がないため、小さくできません。',
        });
      else if (size >= file.size) finish({ message: `${sizes}。小さくなりませんでした。` });
      else
        finish({
          result: { blob: new Blob([result.content], { type: 'application/pdf' }), saved: false },
          message: `${sizes}（${Math.round((1 - size / file.size) * 100)}% 減）。画像 ${result.images} 個のうち ${result.replaced} 個を縮めました。文字は選択・検索できるまま残っています。`,
        });
    } catch (error) {
      finish({ message: `小さくできませんでした。${message(error)}` });
    }
  }

  async function closeShrink() {
    const state = shrink.value;
    if (!state || state.running) return;
    if (
      state.result &&
      !state.result.saved &&
      !(await confirmAction('保存せずに閉じますか？', '小さくした PDF はまだ保存していません。', {
        ok: '閉じる',
      }))
    )
      return;
    shrink.value = null;
  }

  const dialogOpen = () =>
    Boolean(detail.current.value || combine.value || shrink.value) ||
    Boolean(document.querySelector('dialog[open]:not(.ic-detail)'));

  // 画面を見ている間に貼り付けた画像を、一覧に加える。
  document.addEventListener('paste', (event) => {
    if (!active || dialogOpen() || editable(event.target)) return;
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

  // ── 画面 ──

  function Card({ item }: { item: Item }) {
    const pending = isPending(item);
    const result = item.result;
    const over = !pending && !item.error && result?.fits === false;
    const ready = !pending && result && !item.error;
    return (
      <li
        class="ic-item"
        data-over={over ? '' : undefined}
        data-error={item.error ? '' : undefined}
        data-pending={pending ? '' : undefined}
      >
        <button
          type="button"
          class="ic-thumb"
          disabled={Boolean(item.error)}
          aria-label={`「${item.name}」を確かめる・直す`}
          onClick={() => void detail.open(item)}
        >
          {item.thumbnailUrl ? (
            <img src={item.thumbnailUrl} alt="" />
          ) : item.error ? (
            <Icon name="image" class="ic-thumb-icon" />
          ) : (
            <span class="tb-spinner" />
          )}
          {pending && item.thumbnailUrl && <span class="tb-spinner ic-thumb-spinner" />}
        </button>
        <div class="ic-item-body">
          <p class="ic-item-name" title={item.source}>
            {item.name}
          </p>
          <p class="ic-item-line">
            元 {item.size ? `${item.size.width} × ${item.size.height} px・` : ''}
            {formatBytes(item.file.size)}
          </p>
          <p class="ic-item-line ic-item-result">
            {item.error
              ? item.error
              : pending || !result
                ? '計算しています…'
                : `→ ${result.width} × ${result.height} px・${formatBytes(result.blob.size)}・${result.quality === null ? 'PNG' : `JPEG ${result.quality}`}`}
          </p>
          <div class="ic-item-badges">
            {over && (
              <span class="tb-badge" data-tone="warning">
                上限を超えています
              </span>
            )}
            {ready && result.fits === true && <span class="tb-badge">上限内</span>}
            {ready && item.saved && (
              <span class="tb-badge" data-tone="success">
                保存済み
              </span>
            )}
            {(item.edits.crop || item.edits.redactions.length > 0 || item.edits.rotation !== 0) && (
              <span class="tb-badge" data-tone="accent">
                編集あり
              </span>
            )}
          </div>
        </div>
        <div class="ic-item-actions">
          <Button size="small" disabled={Boolean(item.error)} onClick={() => void detail.open(item)}>
            確かめる・直す
          </Button>
          <Button size="small" icon="download" disabled={!ready} onClick={() => store.save(item)}>
            保存
          </Button>
          <IconButton
            icon="x"
            label={`「${item.name}」を一覧から外す`}
            class="ic-remove tb-small"
            onClick={() => {
              if (detail.current.value === item) detail.close();
              store.remove(item);
            }}
          />
        </div>
      </li>
    );
  }

  function Work() {
    void store.revision.value;
    const items = store.items.value;
    const settings = store.settings.value;
    const usable = items.filter((item) => !item.error);
    const ready = store.ready();
    const waiting = items.filter(isPending).length;
    const over = ready.filter((item) => item.result?.fits === false).length;
    const errors = items.length - usable.length;
    const total = ready.reduce((sum, item) => sum + item.result!.blob.size, 0);
    const original = usable.reduce((sum, item) => sum + item.file.size, 0);
    return (
      <div class="ic-work">
        <form
          class="ic-settings"
          aria-label="全体の設定"
          onSubmit={(event) => {
            event.preventDefault();
            applySettings();
          }}
        >
          <div class="ic-field">
            <span>出力形式</span>
            <Segmented<Format>
              label="出力形式"
              value={settings.format}
              onChange={(format) => store.setSettings({ ...store.settings.value, format })}
              options={[
                { value: 'jpeg', label: 'JPEG', title: '写真向き。容量の上限に合わせて画質を自動で選びます。' },
                { value: 'png', label: 'PNG', title: '画面・図向き。画質の段階はありません。' },
              ]}
            />
          </div>
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
          <p class="ic-settings-note">
            上限は 1 KB = 1,000 バイトで数えます（添付先の数え方より少し小さめに収まります）。空にすると上限なし・元の大きさのままです。
          </p>
        </form>
        <div class="ic-bar">
          <p class="ic-summary" aria-live="polite">
            <span>
              {items.length} 枚・{formatBytes(original)} → <strong>{formatBytes(total)}</strong>
            </span>
            {waiting > 0 && (
              <span>
                <span class="tb-spinner" /> {waiting} 枚を計算中
              </span>
            )}
            {over > 0 && <span class="ic-warning">上限を超えた画像 {over} 枚</span>}
            {errors > 0 && <span class="ic-warning">開けないファイル {errors} 件</span>}
          </p>
          <div class="ic-bar-actions">
            <Button icon="plus" onClick={() => void chooseFiles()}>
              追加
            </Button>
            <Button icon="pdf" disabled={!usable.length} onClick={() => void makePdf()}>
              PDFにまとめる
            </Button>
            <Button
              variant="primary"
              icon="download"
              disabled={!usable.length}
              onClick={() => void saveAll()}
            >
              すべて保存
            </Button>
            <Button variant="danger" onClick={() => void clearAll()}>
              すべて消す
            </Button>
          </div>
        </div>
        {notice.value && (
          <p class="ic-notice" role="status">
            {notice.value}
          </p>
        )}
        <ul class="ic-list">
          {items.map((item) => (
            <Card key={item.id} item={item} />
          ))}
        </ul>
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
                        files: [new File([result.blob], COMBINED_NAME, { type: 'application/pdf' })],
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

  function ShrinkDialog({ open }: { open: boolean }) {
    const state = shrink.value;
    const zone = useDropZone<HTMLDivElement>({
      enabled: () => open && Boolean(shrink.value) && !shrink.value!.running,
      label: () => 'ここにドロップして、小さくする PDF にする',
      onDrop: (dropped) => {
        if (dropped.files.length !== 1) {
          if (shrink.value)
            shrink.value = { ...shrink.value, message: 'PDF を1つだけドロップしてください。' };
          return;
        }
        setShrinkFile(dropped.files[0]);
      },
    });
    return (
      <Dialog
        open={open && Boolean(state)}
        onClose={() => void closeShrink()}
        title="PDFを小さくする"
        class="ic-shrink"
        busy={state?.running}
        actions={
          state && (
            <>
              <Button disabled={state.running} onClick={() => void closeShrink()}>
                閉じる
              </Button>
              {state.result ? (
                <Button
                  variant="primary"
                  icon="download"
                  onClick={() => {
                    if (!state.result || !state.file) return;
                    downloadBlob(state.result.blob, `${baseName(state.file.name)}-縮小.pdf`);
                    shrink.value = { ...state, result: { ...state.result, saved: true } };
                  }}
                >
                  {state.result.saved ? 'もう一度保存' : '保存'}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  icon="shrink"
                  disabled={!state.file || state.running}
                  onClick={() => void runShrink()}
                >
                  小さくする
                </Button>
              )}
            </>
          )
        }
      >
        {state && (
          <div class="ic-dialog-body" ref={zone}>
            <p class="tb-dialog-text">
              PDF の中の写真・スキャン画像だけを縮め、JPEG にし直します。文字・図形はそのまま残すので、選択・検索できます。元の PDF は変更しません。
            </p>
            <div class="ic-shrink-file">
              <Icon name="pdf" />
              <span class="ic-shrink-name">
                {state.file
                  ? `${state.file.name}（${formatBytes(state.file.size)}）`
                  : 'PDF を選ぶか、ここにドロップします'}
              </span>
              <Button
                size="small"
                disabled={state.running}
                onClick={async () => {
                  const [file] = await pickFiles({ accept: 'application/pdf,.pdf', multiple: false });
                  setShrinkFile(file);
                }}
              >
                {state.file ? '選び直す' : 'PDFを選ぶ'}
              </Button>
            </div>
            <div class="ic-field">
              <span>仕上がり</span>
              <Segmented<Preset>
                label="仕上がり"
                value={state.preset}
                disabled={state.running}
                onChange={(preset) =>
                  (shrink.value = { ...state, preset, result: null, message: '' })
                }
                options={[
                  { value: 'high', label: 'きれいめ', title: '200 dpi・画質 85' },
                  { value: 'standard', label: '標準', title: '150 dpi・画質 75' },
                  { value: 'small', label: '小さめ', title: '100 dpi・画質 60' },
                ]}
              />
            </div>
            {state.running && <div class="tb-progress" />}
            {state.message && (
              <p class="ic-shrink-result" role="status" data-done={state.result ? '' : undefined}>
                {state.message}
              </p>
            )}
          </div>
        )}
      </Dialog>
    );
  }

  function View({ active: visible }: { active: boolean }) {
    active = visible;
    const items = store.items.value;
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
    return (
      <ToolFrame
        actions={
          <>
            {items.length > 0 && (
              <Button icon="plus" class="ic-header-add" onClick={() => void chooseFiles()}>
                画像・PDFを追加
              </Button>
            )}
            <Button icon="shrink" onClick={() => openShrink()}>
              PDFを小さくする
            </Button>
          </>
        }
      >
        <div class="ic tb-scroll" ref={zone}>
          {items.length ? (
            <Work />
          ) : (
            <EmptyState
              icon="images"
              title="画像の大きさ・容量・形式を変える"
              actions={
                <>
                  <Button variant="primary" size="large" icon="plus" onClick={() => void chooseFiles()}>
                    画像・PDFを選ぶ
                  </Button>
                  <Button size="large" icon="shrink" onClick={() => openShrink()}>
                    PDFを小さくする
                  </Button>
                </>
              }
              note="ドロップ・貼り付けでも加えられます。元のファイルは変更しません。"
            >
              <p>
                写真やスクリーンショットを、添付できる容量に収めます。変換後の容量と仕上がりを確かめてから保存でき、位置情報などの付加情報は残しません。PDF を選ぶと、各ページを画像として一覧に並べます。
              </p>
              {notice.value && <p class="ic-notice">{notice.value}</p>}
            </EmptyState>
          )}
        </div>
        <datalist id="ic-long-list">
          {LONG_SIDES.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <detail.View active={visible} />
        <CombineDialog open={visible} />
        <ShrinkDialog open={visible} />
      </ToolFrame>
    );
  }

  return {
    View,
    status,
    async receive(intent: string, input: Incoming) {
      if (input.kind !== 'files') return;
      if (intent === 'shrink') {
        openShrink(input.files[0]);
        return;
      }
      if (intent === 'combine') {
        await addFiles(input.files);
        await makePdf();
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
    '写真やスクリーンショットの大きさ・容量・形式を、仕上がりを確かめながら変えられます。PDFとの相互変換や、重いPDFの縮小もできます。',
  icon,
  intents: [
    {
      id: 'add',
      label: '容量・大きさを変える',
      detail: '画像変換：一覧に加えて、容量・大きさ・形式を変える（PDF はページを画像に）',
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
    {
      id: 'shrink',
      label: 'PDFを小さくする',
      detail: '画像変換：PDF の中の写真・スキャン画像を縮める。文字はそのまま',
      icon: 'shrink',
      accepts: (input) =>
        input.kind === 'files' && input.files.length === 1 && isPdf(input.files[0]!),
      mayAccept: (hint) => hint.count === 1 && hint.types[0] === 'application/pdf',
    },
  ],
  create,
};
