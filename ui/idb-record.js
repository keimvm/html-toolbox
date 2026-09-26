// IndexedDB の1つのキーに値を1つ置き、読み書きする。DB名・ストア名・キーと値の形は各ツールで決める。
export const DEFAULT_TIMEOUT = 3000;

/** 読み書きのたびに接続し、transaction の確定を待って閉じる。停止・ブロック・中断では待ち続けず拒否する。 */
export function createRecordStore(window, { database, store, key, timeoutMs = DEFAULT_TIMEOUT }) {
  function run(mode, value) {
    return new Promise((resolve, reject) => {
      let db; let transaction; let settled = false;
      const finish = (error, result) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        if (error) { try { transaction?.abort(); } catch { /* 完了済みの処理は中断不要。 */ } }
        db?.close();
        if (error) reject(error); else resolve(result);
      };
      const timer = setTimeout(() => finish(new Error('RecordStorageTimeout')), timeoutMs);
      try {
        const request = window.indexedDB.open(database, 1);
        request.onblocked = () => finish(new Error('RecordStorageBlocked'));
        request.onerror = () => finish(request.error);
        request.onupgradeneeded = () => {
          if (settled) { request.transaction.abort(); return; }
          request.result.createObjectStore(store);
        };
        request.onsuccess = () => {
          db = request.result;
          if (settled) { db.close(); return; }
          db.onversionchange = () => db.close();
          try {
            transaction = db.transaction(store, mode);
            const objects = transaction.objectStore(store);
            const operation = mode === 'readonly' ? objects.get(key) : objects.put(value, key);
            // request の成功だけでは書き込み完了ではない。transaction の確定を待つ。
            transaction.oncomplete = () => finish(null, mode === 'readonly' ? operation.result : undefined);
            transaction.onabort = () => finish(transaction.error || new Error('RecordStorageAborted'));
            transaction.onerror = () => finish(transaction.error || new Error('RecordStorageError'));
          } catch (error) { finish(error); }
        };
      } catch (error) { finish(error); }
    });
  }
  return { load: () => run('readonly'), save: value => run('readwrite', value) };
}
