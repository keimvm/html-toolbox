// IndexedDB の1つのキーに値を1つ置き、読み書きする。DB 名・ストア名・キーと値の形は各ツールで決める。
export const DEFAULT_TIMEOUT = 3000;

export interface RecordStore<T> {
  load(): Promise<T | undefined>;
  save(value: T): Promise<void>;
  remove(): Promise<void>;
}

/** 読み書きのたびに接続し、transaction の確定を待って閉じる。停止・ブロック・中断では待ち続けず拒否する。 */
export function createRecordStore<T = unknown>(
  { indexedDB }: Pick<Window, 'indexedDB'>,
  {
    database,
    store,
    key,
    timeoutMs = DEFAULT_TIMEOUT,
  }: { database: string; store: string; key: IDBValidKey; timeoutMs?: number },
): RecordStore<T> {
  function run(
    mode: IDBTransactionMode,
    apply: (objects: IDBObjectStore) => IDBRequest,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let db: IDBDatabase | undefined;
      let transaction: IDBTransaction | undefined;
      let settled = false;
      const finish = (error: unknown, result?: unknown) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) {
          try {
            transaction?.abort();
          } catch {
            // 完了済みの処理は中断不要。
          }
        }
        db?.close();
        if (error) reject(error);
        else resolve(result);
      };
      const timer = setTimeout(() => finish(new Error('RecordStorageTimeout')), timeoutMs);
      try {
        const request = indexedDB.open(database, 1);
        request.onblocked = () => finish(new Error('RecordStorageBlocked'));
        request.onerror = () => finish(request.error);
        request.onupgradeneeded = () => {
          if (settled) {
            request.transaction?.abort();
            return;
          }
          request.result.createObjectStore(store);
        };
        request.onsuccess = () => {
          db = request.result;
          if (settled) {
            db.close();
            return;
          }
          db.onversionchange = () => db?.close();
          try {
            transaction = db.transaction(store, mode);
            const operation = apply(transaction.objectStore(store));
            // request の成功だけでは書き込み完了ではない。transaction の確定を待つ。
            transaction.oncomplete = () =>
              finish(null, mode === 'readonly' ? operation.result : undefined);
            transaction.onabort = () =>
              finish(transaction?.error ?? new Error('RecordStorageAborted'));
            transaction.onerror = () =>
              finish(transaction?.error ?? new Error('RecordStorageError'));
          } catch (error) {
            finish(error);
          }
        };
      } catch (error) {
        finish(error);
      }
    });
  }
  return {
    load: () => run('readonly', (objects) => objects.get(key)) as Promise<T | undefined>,
    save: (value) => run('readwrite', (objects) => objects.put(value, key)) as Promise<void>,
    remove: () => run('readwrite', (objects) => objects.delete(key)) as Promise<void>,
  };
}
