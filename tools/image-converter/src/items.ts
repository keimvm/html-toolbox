import { downloadBlob } from '../../../ui/download.js';
import { convert, decode, type Converted } from './convert';
import { noEdits, type Edits, type Size } from './geometry';
import {
  defaultSettings,
  effective,
  extension,
  type GlobalSettings,
  type Overrides,
} from './settings';

/** 一覧の1枚。元のファイルは読むだけで、変換結果は別に持つ。 */
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
  edits: Edits;
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

export const state = {
  items: [] as Item[],
  settings: defaultSettings() as GlobalSettings,
  /** 個別の画面で開いている画像。先に変換する。 */
  current: null as Item | null,
};

let sequence = 0;
export function createItem(
  file: Blob,
  name: string,
  source: string,
  outputBase: string,
): Item {
  return {
    id: ++sequence,
    file,
    name,
    source,
    outputBase,
    size: null,
    edits: noEdits(),
    overrides: {},
    version: 0,
    done: -1,
    result: null,
    error: null,
    saved: false,
    thumbnailUrl: null,
  };
}

export const isPending = (item: Item) =>
  !item.error && item.done !== item.version;

/** 変換が済み、保存・PDF に使える画像。 */
export const readyItems = () =>
  state.items.filter((item) => item.result && !item.error && !isPending(item));

export const outputName = (item: Item) =>
  `${item.outputBase}.${extension(item.result?.format ?? 'jpeg')}`;

export function saveItem(item: Item) {
  if (!item.result || isPending(item) || item.error) return false;
  downloadBlob(item.result.blob, outputName(item));
  item.saved = true;
  return true;
}

const listeners: ((item: Item) => void)[] = [];
/** 変換が済んだ・失敗したときに呼ばれる。 */
export function onConverted(listener: (item: Item) => void) {
  listeners.push(listener);
}

class Stale extends Error {}

function unsupported(item: Item) {
  return /\.(heic|heif)$/iu.test(item.source) ||
    /hei[cf]/iu.test(item.file.type)
    ? 'この形式は開けません。HEIC（iPhone の写真）は、JPEG に書き出してから選んでください。'
    : 'この形式は開けません。JPEG・PNG・WebP・GIF・BMP などの画像を選んでください。';
}

async function process(item: Item) {
  const version = item.version;
  const checkStale = () => {
    if (item.version !== version || !state.items.includes(item))
      throw new Stale();
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
        effective(state.settings, item.overrides),
        checkStale,
      );
      checkStale();
      if (item.thumbnailUrl) URL.revokeObjectURL(item.thumbnailUrl);
      item.thumbnailUrl = URL.createObjectURL(result.thumbnail);
      item.result = result;
      item.saved = false;
    }
  } catch (error) {
    if (error instanceof Stale) return;
    item.error = `変換できません。${error instanceof Error ? error.message : ''}`;
  } finally {
    bitmap?.close();
  }
  item.done = version;
  if (state.items.includes(item))
    listeners.forEach((listener) => listener(item));
}

let running = false;
let waiting: (() => void)[] = [];

function next() {
  const { current, items } = state;
  if (current && items.includes(current) && isPending(current)) return current;
  return items.find(isPending);
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

/** 設定・編集を変えた画像を変換し直す。一度に1枚ずつ、開いている画像を先に変換する。 */
export function schedule(item: Item) {
  item.version++;
  // 読み込めた画像の失敗（メモリー不足など）は、設定を変えたら試し直す。
  if (item.size) item.error = null;
  void pump();
}

/** 変換待ちがなくなるまで待つ。 */
export function idle(): Promise<void> {
  if (!running && !state.items.some(isPending)) return Promise.resolve();
  const settled = new Promise<void>((resolve) => waiting.push(resolve));
  void pump();
  return settled;
}
