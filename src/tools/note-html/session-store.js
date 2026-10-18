// ローカルノートの復元情報（前回のフォルダ・ノート・展開）、レイアウト、表示設定を IndexedDB に置く。
// 版（解凍先のフォルダ）をまたいで読めるよう、配置 URL ではなく固定のキーで持つ。本文は入れない。
import { createRecordStore } from '../../lib/idb';

const DATABASE = 'local-notes-session';
const STORE = 'sessions';
export const SESSION_KEY = 'toolbox#session';
export const LAYOUT_KEY = 'toolbox#layout';
export const DISPLAY_KEY = 'toolbox#display';

export function createSessionStore(window, { timeoutMs = 3000 } = {}) {
  return createStore(window, SESSION_KEY, timeoutMs);
}

export function createLayoutStore(window, { timeoutMs = 3000 } = {}) {
  return createStore(window, LAYOUT_KEY, timeoutMs);
}

export function createDisplayStore(window, { timeoutMs = 3000 } = {}) {
  return createStore(window, DISPLAY_KEY, timeoutMs);
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
