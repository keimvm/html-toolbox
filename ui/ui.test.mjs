import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { downloadBlob, RELEASE_DELAY } from './download.js';
import { droppedFiles, hasFiles, watchFileDrop } from './file-drop.js';
import { setupThemeToggle, THEME_KEY } from './theme-toggle.js';

function fakeWindow() {
  const clicked = [];
  const revoked = [];
  const timers = new Map();
  let nextUrl = 0;
  let nextTimer = 0;
  const body = { children: [], append: (node) => body.children.push(node) };
  const win = new EventTarget();
  Object.assign(win, {
    URL: {
      createObjectURL: () => `blob:test/${++nextUrl}`,
      revokeObjectURL: (url) => revoked.push(url),
    },
    setTimeout: (callback, delay) => (timers.set(++nextTimer, { callback, delay }), nextTimer),
    clearTimeout: (id) => timers.delete(id),
    document: {
      body,
      createElement: () => ({
        click() {
          clicked.push({ href: this.href, download: this.download });
        },
        remove() {
          body.children.splice(body.children.indexOf(this), 1);
        },
      }),
    },
  });
  return { win, clicked, revoked, timers, body };
}

test('downloadBlob はリンクを一度クリックし、待ってから URL を解放する', () => {
  const { win, clicked, revoked, timers, body } = fakeWindow();
  downloadBlob(new Blob(['a']), '結果.pdf', { window: win });
  assert.deepEqual(clicked, [{ href: 'blob:test/1', download: '結果.pdf' }]);
  assert.equal(body.children.length, 0);
  assert.deepEqual(revoked, []);
  const [timer] = timers.values();
  assert.equal(timer.delay, RELEASE_DELAY);
  timer.callback();
  assert.deepEqual(revoked, ['blob:test/1']);
});

test('downloadBlob は signal の中断で待たずに解放する', () => {
  const { win, revoked, timers } = fakeWindow();
  const controller = new AbortController();
  downloadBlob(new Blob(['a']), 'a.txt', { window: win, signal: controller.signal });
  controller.abort();
  assert.deepEqual(revoked, ['blob:test/1']);
  assert.equal(timers.size, 0);
});

test('downloadBlob はクリックに失敗したら解放して例外を伝える', () => {
  const { win, revoked, body } = fakeWindow();
  win.document.createElement = () => ({
    click() {
      throw new Error('blocked');
    },
    remove() {
      body.children.pop();
    },
  });
  assert.throws(() => downloadBlob(new Blob(['a']), 'a.txt', { window: win }), /blocked/);
  assert.deepEqual(revoked, ['blob:test/1']);
  assert.equal(body.children.length, 0);
});

function transfer({ types = ['Files'], files = [], directory = false } = {}) {
  return {
    types,
    files,
    dropEffect: 'none',
    items: files.map(() => ({ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: directory }) })),
  };
}

function fakeZone() {
  const inside = { id: 'inside' };
  return {
    inside,
    attributes: new Set(),
    contains: (node) => node === inside,
    toggleAttribute(name, force) {
      if (force) this.attributes.add(name);
      else this.attributes.delete(name);
    },
  };
}

// ドラッグイベントの target を指定して配れる、最小限のウィンドウ。
function fakeDragWindow() {
  const listeners = new Map();
  return {
    addEventListener: (type, listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
    removeEventListener: (type, listener) =>
      listeners.set(type, (listeners.get(type) ?? []).filter((item) => item !== listener)),
    dispatch(type, target, dataTransfer, relatedTarget = target) {
      const event = {
        type,
        target,
        relatedTarget,
        dataTransfer,
        defaultPrevented: false,
        preventDefault() {
          this.defaultPrevented = true;
        },
      };
      for (const listener of listeners.get(type) ?? []) listener(event);
      return event;
    },
  };
}

test('hasFiles と droppedFiles はファイルとフォルダを区別する', () => {
  assert.equal(hasFiles(transfer()), true);
  assert.equal(hasFiles(transfer({ types: ['text/plain'] })), false);
  assert.equal(hasFiles(undefined), false);
  assert.deepEqual(droppedFiles(transfer({ files: ['a.pdf'] })), ['a.pdf']);
  assert.equal(droppedFiles(transfer({ files: ['フォルダ'], directory: true })), null);
});

test('watchFileDrop は zone の中だけ受け付け、外では画面を離れないようにする', () => {
  const win = fakeDragWindow();
  const zone = fakeZone();
  const dropped = [];
  let enabled = true;
  const stop = watchFileDrop({ window: win, zone, onDrop: (files) => dropped.push(files), enabled: () => enabled });

  const over = transfer({ files: ['a.pdf'] });
  const inside = win.dispatch('dragover', zone.inside, over);
  assert.equal(inside.defaultPrevented, true);
  assert.equal(over.dropEffect, 'copy');
  assert.equal(zone.attributes.has('data-tb-file-drag'), true);

  const outside = win.dispatch('dragover', { id: 'outside' }, over);
  assert.equal(outside.defaultPrevented, true);
  assert.equal(over.dropEffect, 'none');
  assert.equal(zone.attributes.has('data-tb-file-drag'), false);

  const outsideDrop = win.dispatch('drop', { id: 'outside' }, over);
  assert.equal(outsideDrop.defaultPrevented, true);
  assert.deepEqual(dropped, []);

  win.dispatch('drop', zone.inside, over);
  assert.deepEqual(dropped, [['a.pdf']]);

  enabled = false;
  const busy = win.dispatch('drop', zone.inside, over);
  assert.equal(busy.defaultPrevented, true);
  assert.equal(dropped.length, 1);

  stop();
  const stopped = win.dispatch('drop', zone.inside, over);
  assert.equal(stopped.defaultPrevented, false);
});

test('watchFileDrop はページ内の要素のドラッグに関わらず、ウィンドウの外で表示を消す', () => {
  const win = fakeDragWindow();
  const zone = fakeZone();
  watchFileDrop({ window: win, zone, onDrop: () => {} });
  const page = win.dispatch('dragover', zone.inside, transfer({ types: ['text/plain'] }));
  assert.equal(page.defaultPrevented, false);

  win.dispatch('dragover', zone.inside, transfer());
  win.dispatch('dragleave', zone.inside, transfer(), zone.inside);
  assert.equal(zone.attributes.has('data-tb-file-drag'), true);
  win.dispatch('dragleave', zone.inside, transfer(), null);
  assert.equal(zone.attributes.has('data-tb-file-drag'), false);
});

// 配色の切り替えに必要な部分だけを持つウィンドウ。storage が null なら保存できない環境。
function fakeThemeWindow({ dark = false, storage = new Map() } = {}) {
  const win = new EventTarget();
  const system = Object.assign(new EventTarget(), { matches: dark });
  const root = { dataset: {} };
  const localStorage = {
    getItem: (key) => (storage ? (storage.get(key) ?? null) : fail()),
    setItem: (key, value) => (storage ? storage.set(key, value) : fail()),
    removeItem: (key) => (storage ? storage.delete(key) : fail()),
  };
  function fail() {
    throw new Error('SecurityError');
  }
  Object.assign(win, {
    document: { documentElement: root },
    matchMedia: () => system,
    get localStorage() {
      return localStorage;
    },
  });
  const button = Object.assign(new EventTarget(), {
    dataset: {},
    title: '',
    setAttribute(name, value) {
      this[name] = value;
    },
  });
  setupThemeToggle(button, { window: win });
  return { win, system, root, button, storage };
}

test('setupThemeToggle は OS の設定に従い、切り替えた配色を保存する', () => {
  const { system, root, button, storage } = fakeThemeWindow();
  assert.equal(root.dataset.tbTheme, undefined);
  assert.equal(button.dataset.tbTheme, 'light');
  assert.equal(button['aria-label'], 'ダークモードにする');

  button.dispatchEvent(new Event('click'));
  assert.equal(root.dataset.tbTheme, 'dark');
  assert.equal(storage.get(THEME_KEY), 'dark');
  assert.equal(button['aria-label'], 'ライトモードにする');
  assert.equal(button.title, 'ライトモードにする');

  // OS と同じ配色に戻したら記録を消し、以後は OS に従う。
  button.dispatchEvent(new Event('click'));
  assert.equal(root.dataset.tbTheme, undefined);
  assert.equal(storage.has(THEME_KEY), false);
  system.matches = true;
  system.dispatchEvent(new Event('change'));
  assert.equal(button.dataset.tbTheme, 'dark');
  assert.equal(root.dataset.tbTheme, undefined);
});

test('setupThemeToggle は保存済みの配色と、別の画面での切り替えを反映する', () => {
  const { win, root, button, storage } = fakeThemeWindow({
    dark: true,
    storage: new Map([[THEME_KEY, 'light']]),
  });
  assert.equal(root.dataset.tbTheme, 'light');
  assert.equal(button.dataset.tbTheme, 'light');
  storage.delete(THEME_KEY);
  win.dispatchEvent(Object.assign(new Event('storage'), { key: THEME_KEY }));
  assert.equal(root.dataset.tbTheme, undefined);
  assert.equal(button.dataset.tbTheme, 'dark');
});

test('setupThemeToggle は保存できない環境でも画面の配色を切り替える', () => {
  const { root, button } = fakeThemeWindow({ storage: null });
  button.dispatchEvent(new Event('click'));
  assert.equal(root.dataset.tbTheme, 'dark');
  button.dispatchEvent(new Event('click'));
  assert.equal(root.dataset.tbTheme, undefined);
});

test('theme.css はダークモード・切り替え・印刷時のライト固定を持つ', async () => {
  const css = await readFile(new URL('theme.css', import.meta.url), 'utf8');
  assert.match(css, /color-scheme: light dark;/);
  assert.match(css, /:root\[data-tb-theme='dark'\] \{\s*color-scheme: dark;/);
  assert.match(css, /@media print \{\s*:root,\s*:root\[data-tb-theme\] \{\s*color-scheme: light;/);
  // 外部のフォントや画像を読み込まない。アイコンは data URL で持つ。
  assert.doesNotMatch(css, /url\((?!"data:image\/svg\+xml,)|@import/);
});
