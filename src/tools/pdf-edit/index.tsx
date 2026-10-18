// PDF編集。ページの削除・並べ替え・回転・結合と、画像・文字の取り出し、ページの要素の削除を行う。
// 元の PDF には手を加えず、ページの並び・回転だけを持つ（Editor）。保存すると新しい PDF をダウンロードする。
// 再読み込みに備え、開いた PDF と編集の状態をブラウザーの中（IndexedDB）に残し、「閉じる」で消す。
import type { PdfDocumentObject } from '@embedpdf/models';
import { computed, signal } from '@preact/signals';
import type { JSX } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { ToolFrame } from '../../app/frame';
import type { Incoming, ToolDefinition } from '../../app/tool';
import { openTool } from '../../app/workspace';
import { pdfEngine } from '../../engine/pdf/client';
import type { Inspection, PageElement, PageRef } from '../../engine/pdf/types';
import { copyText } from '../../lib/clipboard';
import { downloadBlob, safeFileName } from '../../lib/download';
import { isPdf, pickFiles } from '../../lib/files';
import { baseName, formatBytes, number } from '../../lib/format';
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
  MenuSeparator,
  Segmented,
  toast,
} from '../../ui/components';
import { useDropZone } from '../../ui/drop';
import { Icon } from '../../ui/icons';
import { Editor, type EditorPage } from './editor';
import {
  currentPreviewPage,
  isPreviewZoom,
  previewWidth,
  stepZoom,
  ZOOM_LEVELS,
  type PreviewZoom,
} from './preview';
import { SessionStore } from './session-store';
import icon from './icon.png';
import './style.css';

/** この大きさを超える PDF は読み込まない（ブラウザーのメモリーを使い切らないため）。 */
const MAX_FILE_SIZE = 150 * 1024 * 1024;
/** ページ一覧の見本の長い辺（CSS px）。 */
const THUMBNAIL_SIDE = 110;

interface Source {
  doc: PdfDocumentObject;
  name: string;
  data: Blob;
}
type Kind = 'images' | 'text' | 'elements';
type SaveFormat = 'PDF' | 'PNG' | 'JPEG';

const KIND_LABELS: Record<PageElement['kind'], string> = {
  text: '文字',
  path: '図形',
  image: '画像',
  shading: 'グラデーション',
  form: 'グループ',
  other: 'その他',
};

const refOf = ({ sourceId, sourceIndex, rotation }: EditorPage): PageRef => ({
  sourceId,
  sourceIndex,
  rotation,
});
const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : 'PDFを処理できませんでした。';

function create() {
  const editor = new Editor();
  /** ページの並び・選択を変えたら増やす。画面はこれを読んで描き直す。 */
  const revision = signal(0);
  const sources = new Map<string, Source>();
  const session = new SessionStore();
  const filename = signal('');
  const zoom = signal<PreviewZoom>(100);
  const busy = signal(false);
  const recovery = signal<'none' | 'saving' | 'saved' | 'error'>('none');
  const inspecting = signal(false);
  const kind = signal<Kind>('images');
  /** 選んでいるページの画像・文字・要素。 */
  const inspection = signal<
    | { pageId: string; state: 'loading' }
    | { pageId: string; state: 'error' }
    | { pageId: string; state: 'done'; result: Inspection }
    | null
  >(null);
  /** 要素の一覧で選んだ要素（取り除く対象）。 */
  const chosen = signal<ReadonlySet<number>>(new Set());
  /** 画像の欄で選んだ画像の要素番号。 */
  const imageIndex = signal<number | undefined>(undefined);
  const saving = signal<{ format: SaveFormat; name: string; error?: string } | null>(null);
  /** 選んだページへプレビューを動かす求め。 */
  const scrollRequest = signal(0);
  let restoring = true;
  let recoveryRevision = 0;
  let active = false;
  let inspectVersion = 0;
  const thumbnails = new Map<string, string>();
  const thumbnailJobs = new Map<string, Promise<string>>();
  const stage: { element: HTMLDivElement | null; selectedScrollTop?: number } = { element: null };
  let zoomAnchor: { id: string; x: number; y: number } | null = null;

  const pages = () => {
    void revision.value;
    return editor.pages;
  };
  const base = () => baseName(filename.value) || 'PDF';
  const size = (page: EditorPage) => {
    const original = sources.get(page.sourceId)!.doc.pages[page.sourceIndex]!;
    // 読み込み時に回転を正規化し、表示には元の回転と追加分を使う。
    return page.rotation % 180
      ? { width: original.size.height, height: original.size.width }
      : original.size;
  };

  const status = computed(() => {
    void revision.value;
    const count = editor.pages.length;
    return {
      title: count ? filename.value : undefined,
      summary: count ? `${filename.value}・${count}ページ` : undefined,
      unsaved: count > 0 && editor.changed,
      // 復元用の保存が済むまでは、閉じると失う。
      guard: busy.value || (count > 0 && recovery.value !== 'saved'),
    };
  });

  // ── 復元用データ ──

  function rememberSession() {
    if (restoring || !editor.pages.length) return;
    const current = ++recoveryRevision;
    recovery.value = 'saving';
    session
      .save(
        {
          version: 1,
          filename: filename.value,
          editor: editor.snapshot(),
          zoom: zoom.value,
          sourceIds: [...sources.keys()],
        },
        [...sources].map(([id, source]) => ({ id, name: source.name, data: source.data })),
      )
      .then(() => {
        if (current === recoveryRevision) recovery.value = 'saved';
      })
      .catch(() => {
        if (current !== recoveryRevision) return;
        recovery.value = 'error';
        toast(
          '復元用データをブラウザーに保存できません。画面を再読み込みする前に「保存」で残してください。',
          { tone: 'error' },
        );
      });
  }

  /** ページの並び・選択を変えたあとに呼ぶ。 */
  function changed({ scroll = true } = {}) {
    revision.value++;
    if (scroll) scrollRequest.value++;
    rememberSession();
    if (inspecting.value) void loadInspection();
  }

  async function task(operation: () => Promise<void>) {
    if (busy.value) return;
    busy.value = true;
    try {
      await operation();
    } catch (error) {
      toast(errorMessage(error), { tone: 'error' });
    } finally {
      busy.value = false;
    }
  }

  async function restoreSession() {
    await task(async () => {
      try {
        const saved = await session.load();
        if (!saved) return;
        for (const source of saved.sources) {
          const content = await source.data.arrayBuffer();
          const doc = await pdfEngine().call('open', { id: source.id, content }, [content]);
          sources.set(source.id, { doc, name: source.name, data: source.data });
        }
        const state = saved.state.editor;
        const all = [
          ...state.pages,
          ...state.initialPages,
          ...state.history.flatMap((entry) => entry.pages),
        ];
        if (all.some((page) => !sources.get(page.sourceId)?.doc.pages[page.sourceIndex]))
          throw new Error('復元用データのページが一致しません。');
        editor.restore(state);
        filename.value = saved.state.filename;
        zoom.value = saved.state.zoom;
        recovery.value = 'saved';
        revision.value++;
        scrollRequest.value++;
        toast(`前回の「${saved.state.filename}」を開き直しました。`);
      } catch (error) {
        for (const id of sources.keys())
          await pdfEngine()
            .call('close', { id })
            .catch(() => {});
        sources.clear();
        editor.open([]);
        revision.value++;
        recovery.value = 'error';
        toast(
          `前回のPDFを復元できませんでした。PDFを開き直してください。${error instanceof Error ? error.message : ''}`,
          { tone: 'error' },
        );
      } finally {
        restoring = false;
      }
    });
  }

  // ── 開く・閉じる ──

  async function openBuffer(content: ArrayBuffer, name: string) {
    const id = crypto.randomUUID();
    // Blob が中身を写し取るため、元の配列は複製せずに Worker へ転送する（大きな PDF の複製を増やさない）。
    const data = new Blob([content], { type: 'application/pdf' });
    const doc = await pdfEngine().call('open', { id, content }, [content]);
    sources.set(id, { doc, name, data });
    const added: EditorPage[] = doc.pages.map((page) => ({
      id: `${id}-${page.index}`,
      sourceId: id,
      sourceIndex: page.index,
      rotation: ((page.rotation * 90) % 360) as EditorPage['rotation'],
    }));
    if (editor.pages.length) editor.append(added);
    else {
      editor.open(added);
      filename.value = name;
    }
    changed();
    return added.length;
  }

  async function openFiles(files: File[]) {
    await task(async () => {
      for (const file of files) {
        if (!isPdf(file)) {
          toast(`${file.name} はPDFではありません。`, { tone: 'error' });
          continue;
        }
        if (file.size > MAX_FILE_SIZE)
          throw new Error(`${formatBytes(MAX_FILE_SIZE)}を超えるPDFは読み込めません。`);
        const appending = editor.pages.length > 0;
        const count = await openBuffer(await file.arrayBuffer(), file.name);
        if (appending) toast(`「${file.name}」の ${count} ページを末尾に加えました。`);
      }
    });
  }

  async function chooseFiles() {
    const files = await pickFiles({ accept: 'application/pdf,.pdf' });
    if (files.length) await openFiles(files);
  }

  async function closeDocument({ confirm = true } = {}) {
    if (
      confirm &&
      editor.changed &&
      !(await confirmAction(
        '保存せずに閉じますか？',
        '並べ替え・回転・削除はまだ保存していません。閉じると、ブラウザーに残した復元用データも消します。',
        { ok: '閉じる', danger: true },
      ))
    )
      return false;
    await task(async () => {
      await session.flush();
      if (session.hasData) await session.clear();
      recoveryRevision++;
      inspectVersion++;
      for (const id of sources.keys())
        await pdfEngine()
          .call('close', { id })
          .catch(() => {});
      sources.clear();
      editor.open([]);
      filename.value = '';
      zoom.value = 100;
      recovery.value = 'none';
      inspection.value = null;
      inspecting.value = false;
      chosen.value = new Set();
      thumbnails.forEach((url) => URL.revokeObjectURL(url));
      thumbnails.clear();
      thumbnailJobs.clear();
      revision.value++;
    });
    return true;
  }

  // ── ページの操作 ──

  function select(id: string, { scroll = true } = {}) {
    if (id === editor.selectedId) {
      if (scroll) scrollRequest.value++;
      return;
    }
    editor.select(id);
    chosen.value = new Set();
    imageIndex.value = undefined;
    changed({ scroll });
  }

  /** 前後のページを選ぶ。一覧にフォーカスがあれば、選んだページへ移す。 */
  function selectAdjacent(step: number) {
    const page = editor.pages[editor.selectedIndex + step];
    if (!page) return;
    const focused = document.activeElement?.closest('[data-page]');
    select(page.id);
    if (focused)
      queueMicrotask(() =>
        document
          .querySelector<HTMLElement>(`[data-page="${page.id}"]`)
          ?.focus({ preventScroll: true }),
      );
  }

  const edit = (operation: () => boolean) => {
    if (busy.value || !operation()) return;
    chosen.value = new Set();
    changed();
  };
  const rotate = () => edit(() => editor.rotate());
  const remove = () => edit(() => editor.remove());
  const undo = () => edit(() => editor.undo());
  const move = (id: string, target: number) => edit(() => editor.move(id, target));

  // ── 倍率 ──

  function effectiveZoom() {
    const element = stage.element?.querySelector<HTMLElement>(
      `[data-preview-page="${editor.selectedId}"] .pe-paper`,
    );
    const page = editor.selected;
    if (zoom.value !== 'fit') return zoom.value;
    return element && page ? (element.clientWidth / ((size(page).width * 96) / 72)) * 100 : 100;
  }

  function setZoom(value: PreviewZoom) {
    if (busy.value || !editor.pages.length || value === zoom.value) return;
    const paper = stage.element?.querySelector<HTMLElement>(
      `[data-preview-page="${editor.selectedId}"] .pe-paper`,
    );
    if (paper && stage.element) {
      const bounds = paper.getBoundingClientRect();
      const viewport = stage.element.getBoundingClientRect();
      const centerX = viewport.left + stage.element.clientWidth / 2;
      zoomAnchor = {
        id: editor.selectedId,
        y: (viewport.top - bounds.top) / bounds.height,
        x: (centerX - bounds.left) / bounds.width,
      };
    }
    zoom.value = value;
    rememberSession();
  }

  // ── 画像・文字 ──

  async function loadInspection() {
    const page = editor.selected;
    if (!page) return;
    const version = ++inspectVersion;
    inspection.value = { pageId: page.id, state: 'loading' };
    try {
      const result = await pdfEngine().call('inspect', { page: refOf(page) });
      if (version !== inspectVersion) return;
      inspection.value = { pageId: page.id, state: 'done', result };
    } catch (error) {
      if (version !== inspectVersion) return;
      inspection.value = { pageId: page.id, state: 'error' };
      toast(errorMessage(error), { tone: 'error' });
    }
  }

  function toggleInspector(open = !inspecting.value) {
    inspecting.value = open;
    if (open) void loadInspection();
    else inspectVersion++;
  }

  /** 選んだ要素を取り除いたページを、新しい元ファイルとして開いて差し替える。 */
  async function removeChosen() {
    const page = editor.selected;
    const indices = [...chosen.value];
    if (!page || !indices.length) return;
    await task(async () => {
      const id = crypto.randomUUID();
      const { doc, content } = await pdfEngine().call('removeElements', {
        page: refOf(page),
        indices,
        id,
      });
      const source = sources.get(page.sourceId)!;
      sources.set(id, {
        doc,
        name: source.name,
        data: new Blob([content], { type: 'application/pdf' }),
      });
      editor.replace(page.id, {
        id: `${id}-0`,
        sourceId: id,
        sourceIndex: 0,
        rotation: page.rotation,
      });
      chosen.value = new Set();
      changed({ scroll: false });
      toast(`${indices.length}個の要素を取り除きました。`, {
        tone: 'success',
        action: { label: '元に戻す', run: undo },
      });
    });
  }

  // ── 保存 ──

  function openSave() {
    saving.value = { format: 'PDF', name: `${base()}_編集.pdf` };
  }

  function setSaveFormat(format: SaveFormat) {
    const state = saving.value;
    if (!state) return;
    const stem = state.name.replace(/\.(pdf|png|jpe?g)$/i, '');
    saving.value = { format, name: `${stem}.${format.toLowerCase()}` };
  }

  async function save() {
    const state = saving.value;
    if (!state) return;
    const stem = safeFileName(state.name, '').replace(/\.(pdf|png|jpe?g)$/i, '');
    if (!stem) {
      saving.value = { ...state, error: 'ファイル名を入力してください。' };
      return;
    }
    saving.value = null;
    await task(async () => {
      const blob =
        state.format === 'PDF'
          ? new Blob([await pdfEngine().call('export', { pages: editor.pages.map(refOf) })], {
              type: 'application/pdf',
            })
          : await pdfEngine().call('render', {
              page: refOf(editor.selected!),
              scale: 2,
              type: state.format === 'PNG' ? 'image/png' : 'image/jpeg',
            });
      const name = `${stem}.${state.format.toLowerCase()}`;
      downloadBlob(blob, name);
      // ダウンロードの完了・キャンセルは確かめられないため、変更ありの状態は保つ。
      toast(`「${name}」の保存を始めました。`, { tone: 'success' });
    });
  }

  /** 今のページの並びで書き出した PDF を、画像変換へ渡す。 */
  async function handOff(intent: 'add' | 'shrink') {
    await task(async () => {
      const content = await pdfEngine().call('export', { pages: editor.pages.map(refOf) });
      const file = new File([content], `${base()}.pdf`, { type: 'application/pdf' });
      openTool('image-converter', { intent, input: { kind: 'files', files: [file] } });
    });
  }

  // ── キーボード ──

  document.addEventListener('keydown', (event) => {
    if (!active || busy.value || document.querySelector('dialog[open]') || isEditable(event.target))
      return;
    if (!editor.pages.length) return;
    if (hasMod(event) && event.key.toLowerCase() === 'z' && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      undo();
      return;
    }
    if (event.key === 'Escape' && inspecting.value) {
      toggleInspector(false);
      return;
    }
    if (!(event.target as Element).closest?.('.pe-rail')) return;
    if (event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
    // 左のページ一覧では、縦並び・横並びのどちらでも矢印キーで前後のページを選ぶ。
    const step = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[event.key];
    if (step) {
      event.preventDefault();
      selectAdjacent(step);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      remove();
      queueMicrotask(() =>
        document
          .querySelector<HTMLElement>(`[data-page="${editor.selectedId}"]`)
          ?.focus({ preventScroll: true }),
      );
    }
  });

  /** 前回の復元が済むまで、受け取った PDF を開かない（復元と重ならないように）。 */
  const restored = restoreSession();

  // ── 画面 ──

  function thumbnailKey(page: EditorPage) {
    return `${page.sourceId}:${page.sourceIndex}:${page.rotation}`;
  }
  function loadThumbnail(page: EditorPage) {
    const key = thumbnailKey(page);
    const cached = thumbnails.get(key);
    if (cached) return Promise.resolve(cached);
    let job = thumbnailJobs.get(key);
    if (!job) {
      const dims = size(page);
      job = pdfEngine()
        .call('render', {
          page: refOf(page),
          scale:
            (THUMBNAIL_SIDE * Math.min(devicePixelRatio, 2)) / Math.max(dims.width, dims.height),
        })
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          thumbnails.set(key, url);
          return url;
        })
        .finally(() => thumbnailJobs.delete(key));
      thumbnailJobs.set(key, job);
    }
    return job;
  }

  // Editor はページを直接書き換えるため、props が同じでも revision を読んで描き直す
  // （@preact/signals は props の変わらない部品の描き直しを省く）。
  function Thumbnail({ page, index }: { page: EditorPage; index: number }) {
    void revision.value;
    const ref = useRef<HTMLButtonElement>(null);
    const [url, setUrl] = useState(() => thumbnails.get(thumbnailKey(page)));
    const key = thumbnailKey(page);
    useEffect(() => {
      const cached = thumbnails.get(key);
      if (cached) {
        setUrl(cached);
        return;
      }
      setUrl(undefined);
      let alive = true;
      const observer = new IntersectionObserver(
        (entries) => {
          if (!entries.some((entry) => entry.isIntersecting)) return;
          observer.disconnect();
          loadThumbnail(page)
            .then((next) => alive && setUrl(next))
            .catch(() => {});
        },
        { rootMargin: '120px' },
      );
      if (ref.current) observer.observe(ref.current);
      return () => {
        alive = false;
        observer.disconnect();
      };
    }, [key]);
    const dims = size(page);
    const selected = page.id === editor.selectedId;
    const source = sources.get(page.sourceId)!;
    return (
      <button
        ref={ref}
        type="button"
        class="pe-thumb"
        data-page={page.id}
        draggable={!busy.value}
        aria-pressed={selected}
        aria-label={`${index + 1}ページ目`}
        title={`${source.name} の ${page.sourceIndex + 1}ページ目`}
        disabled={busy.value}
        onClick={(event) => {
          select(page.id);
          (event.currentTarget as HTMLButtonElement).focus({ preventScroll: true });
        }}
        onDragStart={(event) => {
          event.dataTransfer?.setData('application/x-toolbox-page', page.id);
          if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
        }}
        onDragOver={(event) => {
          if (!event.dataTransfer?.types.includes('application/x-toolbox-page')) return;
          event.preventDefault();
          (event.currentTarget as HTMLElement).dataset.dropTarget = '';
        }}
        onDragLeave={(event) => delete (event.currentTarget as HTMLElement).dataset.dropTarget}
        onDrop={(event) => {
          const element = event.currentTarget as HTMLElement;
          delete element.dataset.dropTarget;
          const id = event.dataTransfer?.getData('application/x-toolbox-page');
          if (!id) return;
          event.preventDefault();
          move(id, index);
        }}
      >
        <span
          class="pe-mini"
          style={
            {
              '--pe-w': dims.width / Math.max(dims.width, dims.height),
              '--pe-h': dims.height / Math.max(dims.width, dims.height),
            } as JSX.CSSProperties
          }
          aria-hidden="true"
        >
          {url && <img src={url} alt="" draggable={false} />}
        </span>
        <span class="pe-thumb-number">{index + 1}</span>
      </button>
    );
  }

  function Rail() {
    const list = pages();
    const selectedRef = useRef<HTMLDivElement>(null);
    // 選んだページが一覧の外にあれば、一覧の中だけを動かして見せる（画面全体は動かさない）。
    useLayoutEffect(() => {
      const rail = selectedRef.current;
      const button = rail?.querySelector<HTMLElement>(`[data-page="${editor.selectedId}"]`);
      if (!rail || !button) return;
      const bounds = button.getBoundingClientRect();
      const box = rail.getBoundingClientRect();
      if (bounds.top < box.top) rail.scrollTop += bounds.top - box.top - 8;
      else if (bounds.bottom > box.bottom) rail.scrollTop += bounds.bottom - box.bottom + 8;
      if (bounds.left < box.left) rail.scrollLeft += bounds.left - box.left - 8;
      else if (bounds.right > box.right) rail.scrollLeft += bounds.right - box.right + 8;
    }, [editor.selectedId, revision.value]);
    return (
      <nav class="pe-rail" aria-label="ページ一覧">
        <div class="pe-rail-head">
          <span>ページ</span>
          <span class="pe-rail-count">{list.length}</span>
        </div>
        <div class="pe-rail-list tb-scroll" ref={selectedRef}>
          {list.map((page, index) => (
            <Thumbnail key={page.id} page={page} index={index} />
          ))}
        </div>
        <p class="pe-rail-hint">ドラッグで並べ替え・矢印キーで移動</p>
      </nav>
    );
  }

  function PreviewPage({
    page,
    index,
    width,
    highlights,
  }: {
    page: EditorPage;
    index: number;
    width: number;
    highlights: PageElement['bounds'][];
  }) {
    void revision.value;
    const ref = useRef<HTMLElement>(null);
    const [visible, setVisible] = useState(false);
    const [image, setImage] = useState<{ url: string; key: string } | null>(null);
    const [failed, setFailed] = useState(false);
    const dims = size(page);
    const key = `${thumbnailKey(page)}@${Math.round(width)}`;
    useEffect(() => {
      const element = ref.current;
      if (!element) return;
      const observer = new IntersectionObserver(
        (entries) => setVisible(entries.some((entry) => entry.isIntersecting)),
        { root: stage.element, rootMargin: '600px 0px' },
      );
      observer.observe(element);
      return () => observer.disconnect();
    }, []);
    useEffect(() => {
      if (!visible) {
        setImage(null);
        return;
      }
      let alive = true;
      let url: string | undefined;
      setFailed(false);
      pdfEngine()
        .call('render', {
          page: refOf(page),
          scale: Math.min(4, (width / dims.width) * Math.min(devicePixelRatio, 2)),
        })
        .then((blob) => {
          if (!alive) return;
          url = URL.createObjectURL(blob);
          setImage({ url, key });
        })
        .catch(() => alive && setFailed(true));
      return () => {
        alive = false;
        if (url) URL.revokeObjectURL(url);
      };
    }, [visible, key]);
    const selected = page.id === editor.selectedId;
    return (
      <section
        ref={ref}
        class="pe-page"
        data-preview-page={page.id}
        aria-label={`${index + 1}ページ目`}
        aria-current={selected ? 'page' : undefined}
        style={{ width: `${width}px` }}
        onClick={() => !busy.value && select(page.id, { scroll: false })}
      >
        <div class="pe-page-meta">
          <span>{index + 1}ページ目</span>
          <span>
            {Math.round((dims.width * 25.4) / 72)} × {Math.round((dims.height * 25.4) / 72)} mm
          </span>
        </div>
        <div class="pe-paper" style={{ aspectRatio: `${dims.width} / ${dims.height}` }}>
          {image ? (
            <img class="pe-rendered" src={image.url} alt={`${index + 1}ページ目のプレビュー`} />
          ) : (
            <span class="pe-loading">
              {failed ? 'ページを表示できませんでした。' : 'ページを表示しています…'}
            </span>
          )}
          {image &&
            highlights.map((bounds, at) => (
              <div
                key={at}
                class="pe-highlight"
                aria-hidden="true"
                style={{
                  left: `${bounds.x * 100}%`,
                  top: `${bounds.y * 100}%`,
                  width: `${bounds.width * 100}%`,
                  height: `${bounds.height * 100}%`,
                }}
              />
            ))}
        </div>
      </section>
    );
  }

  const highlights = computed(() => {
    const result = inspection.value;
    if (!inspecting.value || result?.state !== 'done' || result.pageId !== editor.selectedId)
      return [];
    const elements = result.result.elements;
    if (kind.value === 'elements')
      return elements.filter((item) => chosen.value.has(item.index)).map((item) => item.bounds);
    if (kind.value === 'images') {
      const images = elements.filter((item) => item.image);
      const target = images.find((item) => item.index === imageIndex.value) ?? images[0];
      return target ? [target.bounds] : [];
    }
    return [];
  });

  function Stage() {
    const list = pages();
    const ref = useRef<HTMLDivElement>(null);
    const [available, setAvailable] = useState(0);
    const frame = useRef(0);
    useLayoutEffect(() => {
      stage.element = ref.current;
      const element = ref.current;
      if (!element) return;
      const measure = () => {
        const style = getComputedStyle(element);
        setAvailable(
          element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        );
      };
      measure();
      // スクロールバーの出入りで領域が変わるため、同じ通知内で寸法を変えない。
      let pending = 0;
      const observer = new ResizeObserver(() => {
        cancelAnimationFrame(pending);
        pending = requestAnimationFrame(measure);
      });
      observer.observe(element);
      return () => {
        observer.disconnect();
        cancelAnimationFrame(pending);
        if (stage.element === element) stage.element = null;
      };
    }, []);
    // 選んだページの上端へ動かす。
    useLayoutEffect(() => {
      const element = ref.current;
      const target = element?.querySelector<HTMLElement>(
        `[data-preview-page="${editor.selectedId}"]`,
      );
      if (!element || !target) return;
      element.scrollTop +=
        target.getBoundingClientRect().top -
        element.getBoundingClientRect().top -
        parseFloat(getComputedStyle(element).paddingTop);
      // 末尾で位置が制限されても、一覧や送りボタンで選んだページを保つ。
      stage.selectedScrollTop = element.scrollTop;
    }, [scrollRequest.value, available > 0]);
    // 倍率を変えたら、選んだページの同じ場所を表示し続ける。
    useLayoutEffect(() => {
      const element = ref.current;
      const anchor = zoomAnchor;
      zoomAnchor = null;
      const paper = anchor
        ? element?.querySelector<HTMLElement>(`[data-preview-page="${anchor.id}"] .pe-paper`)
        : null;
      if (!element || !anchor || !paper) return;
      const bounds = paper.getBoundingClientRect();
      const viewport = element.getBoundingClientRect();
      const centerX = viewport.left + element.clientWidth / 2;
      element.scrollTop += bounds.top + bounds.height * anchor.y - viewport.top;
      element.scrollLeft += bounds.left + bounds.width * anchor.x - centerX;
      stage.selectedScrollTop = element.scrollTop;
    }, [zoom.value, available]);

    function syncSelection() {
      const element = ref.current;
      if (busy.value || !element || !editor.pages.length) return;
      if (element.scrollTop === stage.selectedScrollTop) return;
      stage.selectedScrollTop = undefined;
      const items = [...element.querySelectorAll<HTMLElement>('[data-preview-page]')];
      const index = currentPreviewPage(
        items.map((item) => item.getBoundingClientRect()),
        element.getBoundingClientRect(),
        element.scrollTop > 0 &&
          element.scrollTop + element.clientHeight >= element.scrollHeight - 1,
      );
      const id = items[index]?.dataset.previewPage;
      if (id && id !== editor.selectedId) select(id, { scroll: false });
    }

    const marks = highlights.value;
    return (
      <div
        class="pe-stage tb-scroll"
        ref={ref}
        onScroll={() => {
          if (frame.current) return;
          frame.current = requestAnimationFrame(() => {
            frame.current = 0;
            syncSelection();
          });
        }}
      >
        {available > 0 &&
          list.map((page, index) => (
            <PreviewPage
              key={page.id}
              page={page}
              index={index}
              width={previewWidth(size(page).width, available, zoom.value)}
              highlights={page.id === editor.selectedId ? marks : []}
            />
          ))}
      </div>
    );
  }

  function Toolbar() {
    void revision.value;
    const index = editor.selectedIndex;
    const count = editor.pages.length;
    const off = busy.value;
    const percent = effectiveZoom();
    return (
      <div class="pe-toolbar" role="toolbar" aria-label="ページの操作">
        <div class="pe-tool-group">
          <Button icon="rotate-cw" disabled={off} onClick={rotate} title="右に90度回す">
            回転
          </Button>
          <Button
            icon="trash"
            disabled={off || count < 2}
            onClick={remove}
            title="選んだページを削除（一覧で Delete キー）"
          >
            削除
          </Button>
          <IconButton
            icon="arrow-up"
            label="前へ移動"
            disabled={off || index <= 0}
            onClick={() => move(editor.selectedId, index - 1)}
          />
          <IconButton
            icon="arrow-down"
            label="後ろへ移動"
            disabled={off || index >= count - 1}
            onClick={() => move(editor.selectedId, index + 1)}
          />
          <span class="pe-tool-divider" aria-hidden="true" />
          <IconButton
            icon="undo"
            label={`元に戻す（${modKey}+Z）`}
            disabled={off || !editor.canUndo}
            onClick={undo}
          />
        </div>
        <div class="pe-tool-group pe-pager">
          <IconButton
            icon="chevron-up"
            label="前のページ"
            disabled={off || index <= 0}
            onClick={() => selectAdjacent(-1)}
          />
          <span class="pe-position" aria-live="polite">
            {index + 1} / {count}
          </span>
          <IconButton
            icon="chevron-down"
            label="次のページ"
            disabled={off || index >= count - 1}
            onClick={() => selectAdjacent(1)}
          />
        </div>
        <div class="pe-tool-group pe-zoom">
          <IconButton
            icon="zoom-out"
            label="縮小"
            disabled={off || percent <= 25}
            onClick={() => setZoom(stepZoom(effectiveZoom(), -1))}
          />
          <select
            class="tb-input pe-zoom-select"
            aria-label="表示倍率"
            disabled={off}
            value={String(zoom.value)}
            onChange={(event) => {
              const value = (event.target as HTMLSelectElement).value;
              const next = value === 'fit' ? value : Number(value);
              if (isPreviewZoom(next)) setZoom(next);
            }}
          >
            <option value="fit">幅に合わせる</option>
            {ZOOM_LEVELS.map((level) => (
              <option key={level} value={String(level)}>
                {level}%
              </option>
            ))}
          </select>
          <IconButton
            icon="zoom-in"
            label="拡大"
            disabled={off || percent >= 300}
            onClick={() => setZoom(stepZoom(effectiveZoom(), 1))}
          />
          <span class="pe-tool-divider" aria-hidden="true" />
          <Button
            icon="scan-text"
            aria-expanded={inspecting.value}
            aria-pressed={inspecting.value}
            onClick={() => toggleInspector()}
          >
            画像・文字
          </Button>
        </div>
      </div>
    );
  }

  function Inspector() {
    void revision.value;
    const result = inspection.value;
    const loading = !result || result.state === 'loading' || result.pageId !== editor.selectedId;
    const content = result?.state === 'done' && !loading ? result.result : null;
    const position = editor.selectedIndex + 1;
    return (
      <aside class="pe-inspector tb-scroll" aria-labelledby="pe-inspector-title">
        <div class="pe-inspector-head">
          <h2 id="pe-inspector-title">画像・文字</h2>
          <span class="pe-inspector-page">{position}ページ目</span>
          <IconButton
            icon="x"
            label="閉じる（Esc）"
            class="tb-small"
            onClick={() => toggleInspector(false)}
          />
        </div>
        <Segmented<Kind>
          label="表示する内容"
          value={kind.value}
          onChange={(value) => (kind.value = value)}
          options={[
            { value: 'images', label: '画像' },
            { value: 'text', label: '文字' },
            { value: 'elements', label: '要素' },
          ]}
        />
        {loading ? (
          result?.state === 'error' ? (
            <p class="pe-caption">このページの情報を取得できませんでした。</p>
          ) : (
            <p class="pe-caption">
              <span class="tb-spinner" /> 画像・文字を確認しています…
            </p>
          )
        ) : content ? (
          kind.value === 'text' ? (
            <TextPanel text={content.text} position={position} />
          ) : kind.value === 'images' ? (
            <ImagePanel elements={content.elements} position={position} />
          ) : (
            <ElementPanel elements={content.elements} />
          )
        ) : null}
      </aside>
    );
  }

  function TextPanel({ text, position }: { text: string; position: number }) {
    if (!text.trim())
      return (
        <p class="pe-caption">
          取り出せる文字の情報がありません。スキャンした画像の文字の読み取り（OCR）には対応していません。
        </p>
      );
    return (
      <>
        <p class="pe-caption">このページの文字</p>
        <textarea class="tb-input pe-text" aria-label="取り出した文字" readOnly value={text} />
        <div class="pe-panel-actions">
          <Button
            icon="copy"
            onClick={async () => {
              if (await copyText(text)) toast('文字をコピーしました。', { tone: 'success' });
              else
                toast('コピーできませんでした。欄を選択してコピーしてください。', {
                  tone: 'error',
                });
            }}
          >
            コピー
          </Button>
          <Button
            icon="download"
            onClick={() =>
              downloadBlob(
                new Blob([text], { type: 'text/plain;charset=utf-8' }),
                `${base()}_${position}.txt`,
              )
            }
          >
            テキストを保存
          </Button>
        </div>
      </>
    );
  }

  function ImagePanel({ elements, position }: { elements: PageElement[]; position: number }) {
    const images = elements.filter((item) => item.image);
    const element = images.find((item) => item.index === imageIndex.value) ?? images[0];
    const [preview, setPreview] = useState<{ url: string; index: number } | string | null>(null);
    const page = editor.selected;
    useEffect(() => {
      if (!element || !page) return;
      let alive = true;
      let url: string | undefined;
      setPreview(null);
      pdfEngine()
        .call('image', { page: refOf(page), index: element.index })
        .then((blob) => {
          if (!alive) return;
          url = URL.createObjectURL(blob);
          setPreview({ url, index: element.index });
        })
        .catch((error) => alive && setPreview(errorMessage(error)));
      return () => {
        alive = false;
        if (url) URL.revokeObjectURL(url);
      };
    }, [element?.index, page?.id]);
    if (!element?.image)
      return (
        <p class="pe-caption">
          ページ直下に取り出せる画像がありません。グループの中の画像は対象外です。
        </p>
      );
    const info = element.image;
    return (
      <>
        <p class="pe-caption">このページの画像 {images.length}点</p>
        {images.length > 1 && (
          <Field label="画像">
            <select
              class="tb-input"
              value={String(element.index)}
              onChange={(event) =>
                (imageIndex.value = Number((event.target as HTMLSelectElement).value))
              }
            >
              {images.map((item, at) => (
                <option key={item.index} value={String(item.index)}>
                  画像 {at + 1}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div class="pe-image-preview">
          {typeof preview === 'string' ? (
            preview
          ) : preview ? (
            <img src={preview.url} alt="選んだ画像" />
          ) : (
            <span class="tb-spinner" />
          )}
        </div>
        <dl class="pe-details">
          <div>
            <dt>画素数</dt>
            <dd>
              {number(info.width)} × {number(info.height)} px
            </dd>
          </div>
          <div>
            <dt>配置の大きさ</dt>
            <dd>
              {number(info.widthMm, 1)} × {number(info.heightMm, 1)} mm
            </dd>
          </div>
          <div>
            <dt>実効解像度</dt>
            <dd>
              {number(info.dpiX, 1)} × {number(info.dpiY, 1)} dpi
            </dd>
          </div>
        </dl>
        <Button
          icon="download"
          disabled={busy.value}
          onClick={() =>
            void task(async () => {
              const blob = await pdfEngine().call('image', {
                page: refOf(editor.selected!),
                index: element.index,
              });
              downloadBlob(blob, `${base()}_${position}_画像${images.indexOf(element) + 1}.png`);
            })
          }
        >
          この画像を保存（PNG）
        </Button>
      </>
    );
  }

  function ElementPanel({ elements }: { elements: PageElement[] }) {
    const count = chosen.value.size;
    const toggle = (index: number) => {
      const next = new Set(chosen.value);
      if (!next.delete(index)) next.add(index);
      chosen.value = next;
    };
    return (
      <>
        <p class="pe-caption">
          ページ直下の要素です。選ぶとプレビューに枠を出します。取り除いても元の PDF
          は変わらず、元に戻せます。グループは中身ごと取り除きます（グループの中の要素だけは選べません）。
        </p>
        {elements.length ? (
          <ul class="pe-elements">
            {elements.map((element) => (
              <li key={element.index}>
                <label
                  class="pe-element"
                  data-chosen={chosen.value.has(element.index) ? '' : undefined}
                >
                  <input
                    type="checkbox"
                    checked={chosen.value.has(element.index)}
                    onChange={() => toggle(element.index)}
                  />
                  <span class="pe-element-number">{element.index + 1}</span>
                  <span class="pe-element-kind">{KIND_LABELS[element.kind]}</span>
                  {element.image && (
                    <span class="pe-element-note">
                      {number(element.image.width)} × {number(element.image.height)} px
                    </span>
                  )}
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <p class="pe-caption">要素が見つかりませんでした。</p>
        )}
        <div class="pe-panel-actions">
          <Button
            variant="danger"
            icon="trash"
            disabled={!count || busy.value}
            onClick={() => void removeChosen()}
          >
            選んだ要素を取り除く{count ? `（${count}個）` : ''}
          </Button>
          {count > 0 && (
            <Button variant="quiet" onClick={() => (chosen.value = new Set())}>
              選択を解除
            </Button>
          )}
        </div>
      </>
    );
  }

  function SaveDialog({ open }: { open: boolean }) {
    const state = saving.value;
    void revision.value;
    return (
      <Dialog
        open={open && Boolean(state)}
        onClose={() => (saving.value = null)}
        title="保存"
        initialFocus="#pe-save-name"
        actions={
          <>
            <Button onClick={() => (saving.value = null)}>キャンセル</Button>
            <Button variant="primary" icon="download" type="submit" form="pe-save-form">
              保存
            </Button>
          </>
        }
      >
        {state && (
          <form
            id="pe-save-form"
            class="pe-save-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div class="tb-field">
              <span class="tb-label">形式</span>
              <Segmented<SaveFormat>
                label="形式"
                value={state.format}
                onChange={setSaveFormat}
                options={[
                  { value: 'PDF', label: 'PDF' },
                  { value: 'PNG', label: 'PNG' },
                  { value: 'JPEG', label: 'JPEG' },
                ]}
              />
              <span class="tb-hint">
                {state.format === 'PDF'
                  ? `全${editor.pages.length}ページを、今の並び・回転で1つの PDF にします。`
                  : `選んでいる${editor.selectedIndex + 1}ページ目を画像にします（約144 dpi、最大1,600万画素）。`}
              </span>
            </div>
            <Field label="ファイル名" error={state.error}>
              <input
                id="pe-save-name"
                class="tb-input"
                autocomplete="off"
                value={state.name}
                onInput={(event) =>
                  (saving.value = {
                    ...state,
                    name: (event.target as HTMLInputElement).value,
                    error: undefined,
                  })
                }
              />
            </Field>
            <p class="tb-hint">
              元の PDF は変更しません。ダウンロードの保存先は、ブラウザーの設定に従います。
            </p>
          </form>
        )}
      </Dialog>
    );
  }

  function Header() {
    void revision.value;
    const count = editor.pages.length;
    const state = recovery.value;
    return (
      <div class="pe-file">
        <Icon name="pdf" class="pe-file-icon" />
        <span class="pe-file-name" title={filename.value}>
          {filename.value}
        </span>
        <span class="pe-file-meta">{count}ページ</span>
        <span class="tb-badge" data-tone={editor.changed ? 'accent' : undefined}>
          {busy.value ? '処理中…' : editor.changed ? '未保存の変更' : '変更なし'}
        </span>
        {state !== 'none' && (
          <span
            class="pe-recovery"
            data-state={state}
            title="ブラウザーの中に復元用データを残し、再読み込みやタブを閉じても続きから開けます。「閉じる」で消します。"
          >
            <Icon name={state === 'error' ? 'info' : 'shield'} />
            {state === 'saving'
              ? '復元用に保存中…'
              : state === 'saved'
                ? '再読み込みに対応'
                : '復元用の保存に失敗'}
          </span>
        )}
      </div>
    );
  }

  function View({ active: visible }: { active: boolean }) {
    active = visible;
    const count = pages().length;
    const zone = useDropZone<HTMLDivElement>({
      enabled: () => active && !busy.value && !document.querySelector('dialog[open]'),
      label: () =>
        editor.pages.length ? 'ここにドロップして末尾に加える' : 'ここにドロップして開く',
      onDrop: (dropped) => {
        if (dropped.files.length) void openFiles(dropped.files);
        else if (dropped.hasFolder)
          toast('フォルダは開けません。PDFファイルをドロップしてください。');
      },
    });
    const body: JSX.Element = count ? (
      <div
        class="pe-workbench"
        data-inspecting={inspecting.value ? '' : undefined}
        aria-busy={busy.value}
      >
        <Rail />
        <div class="pe-main">
          <Toolbar />
          {busy.value && <div class="tb-progress pe-progress" />}
          <Stage />
        </div>
        {inspecting.value && <Inspector />}
      </div>
    ) : (
      <EmptyState
        icon="pdf"
        title="PDFのページを並べ替える・回す・消す"
        actions={
          <Button
            variant="primary"
            size="large"
            icon="folder-open"
            disabled={busy.value}
            onClick={() => void chooseFiles()}
          >
            PDFを選ぶ
          </Button>
        }
        note="ドロップでも開けます。元の PDF は変更しません。"
      >
        <p>
          ページの削除・並べ替え・回転、ほかの PDF
          の結合ができます。ページの画像や文字を取り出したり、ページの中の要素（画像・図形・文字）を取り除いたりもできます。保存すると、新しい
          PDF をダウンロードします。
        </p>
      </EmptyState>
    );
    return (
      <ToolFrame
        center={count ? <Header /> : undefined}
        actions={
          count > 0 && (
            <>
              <Button
                icon="plus"
                class="pe-add"
                disabled={busy.value}
                onClick={() => void chooseFiles()}
              >
                PDFを追加
              </Button>
              <Button variant="primary" icon="download" disabled={busy.value} onClick={openSave}>
                保存
              </Button>
              <Menu label="ほかの操作" disabled={busy.value}>
                <MenuItem icon="images" onClick={() => void handOff('add')}>
                  画像変換でページを画像にする
                </MenuItem>
                <MenuItem icon="shrink" onClick={() => void handOff('shrink')}>
                  画像変換で小さくする
                </MenuItem>
                <MenuSeparator />
                <MenuItem icon="x" onClick={() => void closeDocument()}>
                  閉じる（復元用データも消す）
                </MenuItem>
              </Menu>
            </>
          )
        }
      >
        <div class="pe" ref={zone}>
          {body}
        </div>
        <SaveDialog open={visible} />
      </ToolFrame>
    );
  }

  return {
    View,
    status,
    async receive(intent: string, input: Incoming) {
      if (intent !== 'open' || input.kind !== 'files') return;
      await restored;
      if (editor.pages.length) {
        const { value } = await ask(
          `${input.files.length === 1 ? `「${input.files[0]!.name}」` : `${input.files.length}個のPDF`}をどう開きますか？`,
          `いま「${filename.value}」（${editor.pages.length}ページ）を開いています。`,
          [
            { value: 'append', label: '末尾に加える（結合）', variant: 'primary' },
            { value: 'replace', label: '今のPDFを閉じて開く' },
            { value: 'cancel', label: 'キャンセル' },
          ],
          { stack: true },
        );
        if (value === 'cancel') return;
        if (value === 'replace' && !(await closeDocument())) return;
      }
      await openFiles(input.files);
    },
  };
}

export const pdfEdit: ToolDefinition = {
  id: 'pdf-edit',
  name: 'PDF編集',
  description: 'PDFのページの削除・並べ替え・回転・結合と、画像・文字の取り出しができます。',
  icon,
  intents: [
    {
      id: 'open',
      label: 'ページを編集する',
      detail: 'PDF編集：ページの削除・並べ替え・回転・結合、画像・文字の取り出し',
      icon: 'pdf',
      accepts: (input) =>
        input.kind === 'files' && input.files.length > 0 && input.files.every(isPdf),
      mayAccept: (hint) => hint.count > 0 && hint.types.every((type) => type === 'application/pdf'),
    },
  ],
  create,
};
