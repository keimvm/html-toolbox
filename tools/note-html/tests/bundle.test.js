import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';
import { IDBFactory } from 'fake-indexeddb';
import { createLayoutStore } from '../src/session-store.js';

test('配布 HTML が単独で起動し、クリックからピッカーと保存権限要求を開始する', async () => {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', error => errors.push(error));
  let data = new TextEncoder().encode('\ufeff# 初期本文\r\n');
  let picked = 0; let permissionRequests = 0; let closes = 0; let prints = 0;
  const file = {
    kind: 'file', name: '日本語 ノート.MD',
    async getFile() { return new File([data], this.name); },
    async isSameEntry(other) { return other === this; },
    async requestPermission() { permissionRequests++; return 'granted'; },
    async createWritable() {
      let pending;
      return { async write(value) { pending = value; }, async close() { data = pending; closes++; }, async abort() {} };
    },
  };
  const root = { name: 'test folder', async *values() { yield file; }, async getFileHandle() { return file; } };
  assert.deepEqual(await readdir(new URL('../dist/', import.meta.url)), ['index.html']);
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, {
    url: 'https://unit-test.invalid/', runScripts: 'dangerously', virtualConsole,
    // resources を有効にせず、通信も実ファイル API も使わない。
    beforeParse(window) {
      window.TextDecoder = TextDecoder; window.TextEncoder = TextEncoder; window.isSecureContext = true;
      window.FileSystemHandle = class {}; window.FileSystemHandle.prototype.requestPermission = function () {};
      window.FileSystemFileHandle = class {}; window.FileSystemFileHandle.prototype.createWritable = function () {};
      window.showDirectoryPicker = async () => { picked++; return root; };
      window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
      window.HTMLDialogElement.prototype.close = function () { this.open = false; };
      window.print = () => {
        prints++;
        const article = window.document.getElementById('print-document');
        assert.equal(article.querySelector('h1').textContent, '保存後');
        assert.equal(article.style.getPropertyValue('--note-font-size'), '20px');
        assert.equal(closes, 0);
      };
    },
  });
  const $ = id => dom.window.document.getElementById(id);
  assert.equal(dom.window.document.querySelectorAll('#toolbox-home').length, 1);
  assert.equal(dom.window.document.querySelector('.note-toolbar').firstElementChild, $('toolbox-home'));
  assert.equal($('toolbox-home').tagName, 'TEMPLATE');
  assert.equal(dom.window.document.querySelectorAll('script[src], link[rel="stylesheet"], img[src]').length, 0);
  assert.match(dom.window.document.querySelector('meta[http-equiv="Content-Security-Policy"]').content, /connect-src 'none'/);
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  await tick(); $('open-folder').click(); await tick();
  dom.window.document.querySelector('[data-file]').click(); await tick();
  assert.equal($('rich-editor').querySelector('h1').textContent, '初期本文');
  $('source-mode').click(); $('editor').value = '# 保存後\n'; $('editor').dispatchEvent(new dom.window.Event('input'));
  const unsaved = new dom.window.Event('beforeunload', { cancelable: true });
  dom.window.dispatchEvent(unsaved); assert.ok(unsaved.defaultPrevented);
  $('font-size').value = '20'; $('font-size').dispatchEvent(new dom.window.Event('change'));
  $('export').click(); dom.window.document.querySelector('[data-choice=pdf]').click(); await tick();
  assert.equal(prints, 1); assert.equal($('print-document'), null); assert.equal($('save-status').textContent, '未保存');
  $('save').click(); await tick();
  assert.equal(picked, 1); assert.equal(permissionRequests, 1); assert.equal(closes, 1);
  assert.equal(new TextDecoder('utf-8', { ignoreBOM: true }).decode(data), '\ufeff# 保存後\r\n');
  assert.equal($('save-status').textContent, '保存済み'); assert.deepEqual(errors, []);
  const saved = new dom.window.Event('beforeunload', { cancelable: true });
  dom.window.dispatchEvent(saved); assert.ok(!saved.defaultPrevented);
  dom.window.dispatchEvent(new dom.window.Event('pagehide'));
  assert.equal(dom.window.document.scripts.length, 1);
  assert.match($('third-party-licenses').content.textContent, /markdown-it 14\.2\.0/);
  assert.equal($('about-dialog'), null);
  assert.equal($('about-button'), null);
  assert.equal($('note-footer'), null);
  dom.window.close();
});

test('配布 HTML の起動処理が記録から復元し、再許可のクリックにも接続されている', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  for (const permission of ['granted', 'prompt']) {
    let requests = 0; let picks = 0; let writes = 0;
    const errors = [];
    const file = { kind: 'file', name: '復元.md', async getFile() { return new File(['# 前回の本文'], this.name); } };
    const root = {
      kind: 'directory', name: '復元フォルダ', async *values() { yield file; },
      async getDirectoryHandle() { throw new Error('Unexpected directory'); }, async getFileHandle() { return file; },
      async queryPermission() { return permission; }, async requestPermission(options) {
        assert.equal(options.mode, 'read'); requests++; return 'granted';
      },
    };
    const stored = { version: 1, root, selectedPath: '復元.md', expandedPaths: [''] };
    const virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', error => errors.push(error));
    const dom = new JSDOM(html, {
      url: 'file:///bundle-test/index.html', runScripts: 'dangerously', virtualConsole,
      beforeParse(window) {
        window.TextDecoder = TextDecoder; window.TextEncoder = TextEncoder; window.isSecureContext = true;
        window.FileSystemHandle = class {}; window.FileSystemHandle.prototype.requestPermission = function () {};
        window.FileSystemFileHandle = class {}; window.FileSystemFileHandle.prototype.createWritable = function () {};
        window.showDirectoryPicker = async () => { picks++; return root; };
        // 配布コードの接続だけを検証する IndexedDB 境界。ネイティブハンドルの複製は実機確認で扱う。
        window.indexedDB = { open() {
          const request = { result: { close() {}, transaction() {
            const transaction = { objectStore: () => ({ get: key => ({ result: /#(layout|display)$/.test(key) ? undefined : stored }), put: () => { writes++; return {}; } }) };
            queueMicrotask(() => transaction.oncomplete()); return transaction;
          } } };
          queueMicrotask(() => request.onsuccess()); return request;
        } };
      },
    });
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const $ = id => dom.window.document.getElementById(id);
    await tick();
    if (permission === 'prompt') {
      assert.equal($('welcome-open').textContent, 'アクセスを許可して開く');
      assert.equal(requests, 0); $('welcome-open').click(); assert.equal(requests, 1); await tick();
    }
    assert.equal($('file-path').textContent, '復元フォルダ / 復元.md');
    assert.equal($('rich-editor').querySelector('h1').textContent, '前回の本文');
    assert.equal(picks, 0); assert.equal(writes, 0); assert.deepEqual(errors, []);
    dom.window.dispatchEvent(new dom.window.Event('pagehide')); dom.window.close();
  }
});

test('配布 HTML 単独でレイアウトの開閉を保存し、開き直して復元する', async () => {
  const html = await readFile(new URL('../dist/index.html', import.meta.url), 'utf8');
  const indexedDB = new IDBFactory();
  const href = 'file:///layout-bundle/index.html';
  const store = createLayoutStore({ indexedDB, location: { href } });
  await store.save({ version: 1, sidebarWidth: 470, sidebarCollapsed: true });
  const errors = [];
  const open = () => {
    const virtualConsole = new VirtualConsole(); virtualConsole.on('jsdomError', error => errors.push(error));
    return new JSDOM(html, { url: href, runScripts: 'dangerously', virtualConsole,
      beforeParse(window) {
        window.indexedDB = indexedDB; window.TextDecoder = TextDecoder; window.TextEncoder = TextEncoder;
        const original = window.HTMLElement.prototype.getBoundingClientRect;
        window.HTMLElement.prototype.getBoundingClientRect = function () { return this.classList.contains('workspace') ? { width: 1440 } : original.call(this); };
      } });
  };
  async function until(check) {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await check()) return;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    assert.fail('レイアウトの反映が完了しませんでした');
  }
  const first = open();
  try {
    await until(() => first.window.document.getElementById('sidebar').hidden);
    first.window.document.getElementById('sidebar-toggle').click();
    await until(async () => (await store.load()).sidebarCollapsed === false);
    assert.deepEqual(await store.load(), { version: 1, sidebarWidth: 470, sidebarCollapsed: false });
  } finally { first.window.dispatchEvent(new first.window.Event('pagehide')); first.window.close(); }
  const next = open();
  try {
    await until(() => next.window.document.getElementById('sidebar-resizer').getAttribute('aria-valuenow') === '470');
    assert.equal(next.window.document.getElementById('sidebar').hidden, false);
    assert.equal(next.window.document.getElementById('sidebar-toggle').getAttribute('aria-expanded'), 'true');
    assert.deepEqual(errors, []);
  } finally { next.window.dispatchEvent(new next.window.Event('pagehide')); next.window.close(); }
});
