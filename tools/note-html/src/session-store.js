const DATABASE = 'local-notes-session';
const STORE = 'sessions';

// file:// では別の HTML と保存領域を共有し得るため、配置場所ごとに記録する。
export function sessionKey(href) {
  const url = new URL(href);
  url.search = ''; url.hash = '';
  return url.href;
}

export function createSessionStore(window, { timeoutMs = 3000 } = {}) {
  return createStore(window, sessionKey(window.location.href), timeoutMs);
}

export function createLayoutStore(window, { timeoutMs = 3000 } = {}) {
  // セッションのキーはフラグメントを除くため、既存の記録と衝突しない。
  return createStore(window, `${sessionKey(window.location.href)}#layout`, timeoutMs);
}

export function createDisplayStore(window, { timeoutMs = 3000 } = {}) {
  return createStore(window, `${sessionKey(window.location.href)}#display`, timeoutMs);
}

function createStore(window, key, timeoutMs) {
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
      const timer = setTimeout(() => finish(new Error('SessionStorageTimeout')), timeoutMs);
      try {
        const request = window.indexedDB.open(DATABASE, 1);
        request.onblocked = () => finish(new Error('SessionStorageBlocked'));
        request.onerror = () => finish(request.error);
        request.onupgradeneeded = () => {
          if (settled) { request.transaction.abort(); return; }
          request.result.createObjectStore(STORE);
        };
        request.onsuccess = () => {
          db = request.result;
          if (settled) { db.close(); return; }
          db.onversionchange = () => db.close();
          try {
            transaction = db.transaction(STORE, mode);
            const store = transaction.objectStore(STORE);
            const operation = mode === 'readonly' ? store.get(key) : store.put(value, key);
            // request の成功だけでは書き込み完了ではない。transaction の確定を待つ。
            transaction.oncomplete = () => finish(null, mode === 'readonly' ? operation.result : undefined);
            transaction.onabort = () => finish(transaction.error || new Error('SessionStorageAborted'));
            transaction.onerror = () => finish(transaction.error || new Error('SessionStorageError'));
          } catch (error) { finish(error); }
        };
      } catch (error) { finish(error); }
    });
  }
  return { load: () => run('readonly'), save: value => run('readwrite', value) };
}

function validPath(path) {
  return typeof path === 'string' && path.length > 0 && !path.includes('\0') &&
    path.split('/').every(part => part && part !== '.' && part !== '..' && !part.includes('\\'));
}

export function readSession(value) {
  if (value == null) return null;
  const root = value.root;
  if (value.version !== 1 || root?.kind !== 'directory' || typeof root.name !== 'string' ||
      !['queryPermission', 'requestPermission', 'values', 'getDirectoryHandle', 'getFileHandle'].every(key => typeof root[key] === 'function') ||
      !(value.selectedPath === null || validPath(value.selectedPath) && /\.md$/i.test(value.selectedPath)) ||
      !Array.isArray(value.expandedPaths) || !value.expandedPaths.every(path => path === '' || validPath(path))) {
    throw new Error('InvalidSession');
  }
  return { root, selectedPath: value.selectedPath, expanded: new Set(value.expandedPaths) };
}
