// 再読み込み・タブを閉じたあとの復元用データ（IndexedDB）。開いた PDF の中身と、ページの並び・回転・取り消しの履歴を持つ。
// 版（解凍先のフォルダ）をまたいで復元できるよう、配置 URL ではなく固定のキーで持つ。
import { isEditorState, type EditorState } from './editor';
import { isPreviewZoom, type PreviewZoom } from './preview';

export interface SessionSource {
  id: string;
  name: string;
  data: Blob;
}
export interface SessionState {
  version: 1;
  filename: string;
  editor: EditorState;
  zoom: PreviewZoom;
  sourceIds: string[];
}
function isSession(value: unknown): value is SessionState {
  return (
    !!value &&
    typeof value === 'object' &&
    'version' in value &&
    value.version === 1 &&
    'filename' in value &&
    typeof value.filename === 'string' &&
    'editor' in value &&
    isEditorState(value.editor) &&
    value.editor.pages.length > 0 &&
    'zoom' in value &&
    isPreviewZoom(value.zoom) &&
    'sourceIds' in value &&
    Array.isArray(value.sourceIds) &&
    value.sourceIds.every((id: unknown) => typeof id === 'string')
  );
}
function completed(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () =>
      reject(
        transaction.error ?? new Error('復元用データを保存できませんでした。'),
      );
  });
}

/** 旧 PDF編集（pdf-edit-session）とは別のデータベースにする。 */
export const SESSION_DATABASE = 'toolbox-pdf-edit';
export const SESSION_KEY = 'current';

/** PDF本体は初回だけ保存し、その後は編集状態を小さな別レコードとして更新する。 */
export class SessionStore {
  private database?: Promise<IDBDatabase>;
  private queue: Promise<void> = Promise.resolve();
  hasData = false;

  constructor(
    private key: string = SESSION_KEY,
    private factory: () => IDBFactory = () => indexedDB,
  ) {}

  private open() {
    return (this.database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.factory().open(SESSION_DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore('sessions');
        request.result
          .createObjectStore('sources')
          .createIndex('session', 'session');
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          this.database = undefined;
        };
        resolve(db);
      };
      request.onerror = () => {
        this.database = undefined;
        reject(request.error);
      };
      request.onblocked = () =>
        reject(new Error('別の画面が復元用データを使用しています。'));
    }));
  }

  private enqueue(operation: () => Promise<void>) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  flush() {
    return this.queue;
  }

  async load() {
    const db = await this.open();
    const transaction = db.transaction(['sessions', 'sources']);
    const done = completed(transaction);
    const stateRequest = transaction.objectStore('sessions').get(this.key);
    const sourceRequest = transaction
      .objectStore('sources')
      .index('session')
      .getAll(this.key);
    await done;
    const state: unknown = stateRequest.result;
    this.hasData = state !== undefined;
    if (state === undefined) return undefined;
    if (!isSession(state))
      throw new Error(
        '復元用のデータが壊れています。PDFを開き直してください。',
      );
    const records = sourceRequest.result as unknown[];
    const sources = state.sourceIds.map((id) => {
      const source = records.find(
        (entry): entry is SessionSource =>
          !!entry &&
          typeof entry === 'object' &&
          'id' in entry &&
          entry.id === id &&
          'name' in entry &&
          typeof entry.name === 'string' &&
          'data' in entry &&
          entry.data instanceof Blob,
      );
      if (!source)
        throw new Error(
          '復元に必要なPDFが見つかりません。PDFを開き直してください。',
        );
      return source;
    });
    return { state, sources };
  }

  save(state: SessionState, sources: SessionSource[]) {
    const snapshot = structuredClone(state);
    const sourceCopies = sources.map((source) => ({ ...source }));
    return this.enqueue(async () => {
      const db = await this.open();
      const transaction = db.transaction(['sessions', 'sources'], 'readwrite');
      const done = completed(transaction);
      try {
        const store = transaction.objectStore('sources');
        for (const source of sourceCopies) {
          const key = [this.key, source.id];
          const existing = store.getKey(key);
          existing.onsuccess = () => {
            // 別の画面で「閉じる」が実行されても、本体のない記録を作らない。
            if (existing.result === undefined)
              store.put({ ...source, session: this.key }, key);
          };
        }
        transaction.objectStore('sessions').put(snapshot, this.key);
      } catch (error) {
        transaction.abort();
        await done.catch(() => {});
        throw error;
      }
      await done;
      this.hasData = true;
    });
  }

  clear() {
    return this.enqueue(async () => {
      const db = await this.open();
      const transaction = db.transaction(['sessions', 'sources'], 'readwrite');
      const done = completed(transaction);
      transaction.objectStore('sessions').delete(this.key);
      const cursor = transaction
        .objectStore('sources')
        .index('session')
        .openCursor(this.key);
      cursor.onsuccess = () => {
        if (!cursor.result) return;
        cursor.result.delete();
        cursor.result.continue();
      };
      await done;
      this.hasData = false;
    });
  }
}
