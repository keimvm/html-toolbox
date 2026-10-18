// 一覧の画像と、変換の順番待ち。元のファイルは読むだけで、変換結果は別に持つ。
// 変換は一度に1枚ずつ、個別の画面で開いている画像を先に行う。設定・編集を変えたら version を上げ、古い変換は途中で捨てる。
import { batch, signal } from '@preact/signals';
import { downloadBlob } from '../../lib/download';
import { errorText } from '../../lib/files';
import { convert, decode, type Converted } from './convert';
import { noEdits, type Edits, type Size } from './geometry';
import { emptyHistory, type History } from './history';
import {
  defaultSettings,
  effective,
  extension,
  type GlobalSettings,
  type Overrides,
} from './settings';

/** 一覧の1枚。画面は revision を読んで描き直す（Item は直接書き換える）。 */
export interface Item {
  id: number;
  file: Blob;
  /** 一覧に出す名前。 */
  name: string;
  /** 元の説明（ファイル名、PDF のページ）。 */
  source: string;
  /** 保存するファイルの名前（拡張子なし）。 */
  outputBase: string;
  /** 向きを直した元の大きさ。読み込むまでは null。 */
  size: Size | null;
  /** 回転・切り抜き・書き込み。取り消すと、写しに丸ごと置き換える。 */
  edits: Edits;
  /** edits の取り消し・やり直し。 */
  history: History;
  overrides: Overrides;
  /** 設定・編集を変えるたびに増やす。 */
  version: number;
  /** result を作ったときの version。 */
  done: number;
  result: Converted | null;
  error: string | null;
  /** 今の result を保存したか。 */
  saved: boolean;
  thumbnailUrl: string | null;
}

export const isPending = (item: Item) => !item.error && item.done !== item.version;

export const outputName = (item: Item) =>
  `${item.outputBase}.${extension(item.result?.format ?? 'jpeg')}`;

class Stale extends Error {}

function unsupported(item: Item) {
  return /\.(heic|heif)$/iu.test(item.source) || /hei[cf]/iu.test(item.file.type)
    ? 'この形式は開けません。HEIC（iPhone の写真）は、JPEG に書き出してから選んでください。'
    : 'この形式は開けません。JPEG・PNG・WebP・GIF・BMP などの画像を選んでください。';
}

export function createItems() {
  const items = signal<readonly Item[]>([]);
  const settings = signal<GlobalSettings>(defaultSettings());
  /** 画像の中身（変換結果・編集・保存済み）を変えたら増やす。 */
  const revision = signal(0);
  /** 個別の画面で開いている画像。先に変換する。 */
  let current: Item | null = null;
  let sequence = 0;
  let running = false;
  let waiting: (() => void)[] = [];
  const listeners = new Set<(item: Item) => void>();

  const touch = () => revision.value++;
  const has = (item: Item) => items.value.includes(item);

  async function process(item: Item) {
    const version = item.version;
    const checkStale = () => {
      if (item.version !== version || !has(item)) throw new Stale();
    };
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await decode(item.file).catch(() => null);
      if (!bitmap) item.error = unsupported(item);
      else {
        item.size = { width: bitmap.width, height: bitmap.height };
        checkStale();
        const result = await convert(
          bitmap,
          item.edits,
          effective(settings.value, item.overrides),
          checkStale,
        );
        checkStale();
        if (item.thumbnailUrl) URL.revokeObjectURL(item.thumbnailUrl);
        item.thumbnailUrl = URL.createObjectURL(result.thumbnail);
        item.result = result;
        item.saved = false;
      }
    } catch (error) {
      // 設定・編集を変えた後の失敗は、古い版のもの。新しい版の変換を待たせたままにしない。
      if (error instanceof Stale || item.version !== version) return;
      item.error = `変換できません。${errorText(error)}`;
    } finally {
      bitmap?.close();
    }
    item.done = version;
    if (!has(item)) return;
    touch();
    listeners.forEach((listener) => listener(item));
  }

  function next() {
    if (current && has(current) && isPending(current)) return current;
    return items.value.find(isPending);
  }

  async function pump() {
    if (running) return;
    running = true;
    try {
      for (let item = next(); item; item = next()) await process(item);
    } finally {
      running = false;
      const resolve = waiting;
      waiting = [];
      resolve.forEach((done) => done());
    }
  }

  /** 設定・編集を変えた画像を変換し直す。 */
  function schedule(item: Item) {
    item.version++;
    // 新しい編集・設定はまだ保存していない。変換が終わる前から終了時の確認を有効にする。
    item.saved = false;
    // 読み込めた画像の失敗（メモリー不足など）は、設定を変えたら試し直す。
    if (item.size) item.error = null;
    touch();
    void pump();
  }

  return {
    items,
    settings,
    revision,
    touch,
    schedule,
    setCurrent(item: Item | null) {
      current = item;
    },
    /** 変換が済んだ・失敗したときに呼ぶ。 */
    onConverted(listener: (item: Item) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    add(file: Blob, name: string, source: string, outputBase: string) {
      const item: Item = {
        id: ++sequence,
        file,
        name,
        source,
        outputBase,
        size: null,
        edits: noEdits(),
        history: emptyHistory(),
        overrides: {},
        version: 0,
        done: -1,
        result: null,
        error: null,
        saved: false,
        thumbnailUrl: null,
      };
      items.value = [...items.value, item];
      schedule(item);
      return item;
    },
    /** ほかの画像の並びの中で、index 番目（0 が先頭）へ動かす。PDF にまとめるページの順になる。 */
    move(item: Item, index: number) {
      const others = items.value.filter((other) => other !== item);
      if (others.length === items.value.length) return;
      const at = Math.min(Math.max(0, index), others.length);
      items.value = [...others.slice(0, at), item, ...others.slice(at)];
    },
    remove(item: Item) {
      items.value = items.value.filter((other) => other !== item);
      if (item.thumbnailUrl) URL.revokeObjectURL(item.thumbnailUrl);
    },
    clear() {
      batch(() => {
        for (const item of items.value)
          if (item.thumbnailUrl) URL.revokeObjectURL(item.thumbnailUrl);
        items.value = [];
      });
    },
    setSettings(next: GlobalSettings) {
      const previous = settings.value;
      if (
        next.format === previous.format &&
        next.limit === previous.limit &&
        next.longSide === previous.longSide
      )
        return;
      batch(() => {
        settings.value = next;
        for (const item of items.value) schedule(item);
      });
    },
    /** 変換が済み、保存・PDF に使える画像。 */
    ready: () => items.value.filter((item) => item.result && !item.error && !isPending(item)),
    save(item: Item) {
      if (!item.result || isPending(item) || item.error) return false;
      downloadBlob(item.result.blob, outputName(item));
      item.saved = true;
      touch();
      return true;
    },
    /** 変換待ちがなくなるまで待つ。 */
    idle(): Promise<void> {
      if (!running && !items.value.some(isPending)) return Promise.resolve();
      const settled = new Promise<void>((resolve) => waiting.push(resolve));
      void pump();
      return settled;
    },
  };
}

export type Items = ReturnType<typeof createItems>;
