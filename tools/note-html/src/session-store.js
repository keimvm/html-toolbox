import { createRecordStore } from '../../../ui/idb-record.js';
import { sessionKey } from '../../../ui/session-key.js';

const DATABASE = 'local-notes-session';
const STORE = 'sessions';

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
  return createRecordStore(window, { database: DATABASE, store: STORE, key, timeoutMs });
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
