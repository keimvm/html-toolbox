import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createSessionStore, readSession, sessionKey } from '../src/session-store.js';
import { setup, MemoryDirectory, MemoryFile, MemorySessionStore, bytes, failure, tick } from './helpers.js';

const record = (root, selectedPath = null, expandedPaths = ['']) => ({ version: 1, root, selectedPath, expandedPaths });
const directoryRow = ($, path) => [...$('tree').querySelectorAll('[data-directory]')].find(row => row.dataset.directory === path);

test('IndexedDB は配置場所別に記録し、別の接続から確定済みの値を読み出せる', async () => {
  const indexedDB = new IDBFactory();
  const store = href => createSessionStore({ indexedDB, location: { href } });
  const first = store('file:///notes/index.html?x=1#note');
  assert.equal(await first.load(), undefined);
  const value = { version: 1, root: { name: '日本語', kind: 'directory' }, selectedPath: '仕事/a.MD', expandedPaths: ['', '仕事'] };
  await first.save(value);
  assert.deepEqual(await store('file:///notes/index.html').load(), value);
  assert.equal(await store('file:///other/index.html').load(), undefined);
  assert.equal(sessionKey('https://example.test/app/index.html?q=1#note'), 'https://example.test/app/index.html');
  // fake-indexeddb でネイティブの FileSystemHandle 自体を再現したとは扱わない。
});

test('IndexedDB の不在・例外・構造化複製失敗でも拒否を返し、後続の保存を妨げない', async () => {
  const location = { href: 'file:///index.html' };
  await assert.rejects(createSessionStore({ location }).load());
  await assert.rejects(createSessionStore({ location, get indexedDB() { throw failure('SecurityError'); } }).load());
  const store = createSessionStore({ location, indexedDB: new IDBFactory() });
  await assert.rejects(store.save({ invalid() {} }), { name: 'DataCloneError' });
  assert.equal(await store.load(), undefined);
  await store.save({ ok: true });
  assert.deepEqual(await store.load(), { ok: true });
});

test('IndexedDB の停止・ブロック・transaction 中断で起動を待ち続けない', async () => {
  const location = { href: 'file:///index.html' };
  await assert.rejects(createSessionStore({ location, indexedDB: { open: () => ({}) } }, { timeoutMs: 10 }).load(), /Timeout/);
  const blocked = { open() { const request = {}; queueMicrotask(() => request.onblocked()); return request; } };
  await assert.rejects(createSessionStore({ location, indexedDB: blocked }).load(), /Blocked/);
  const aborted = { open() {
    const transaction = { objectStore: () => ({ put: () => ({}) }), abort() {} };
    const request = { result: { close() {}, transaction() {
      queueMicrotask(() => transaction.onabort()); return transaction;
    } } };
    queueMicrotask(() => request.onsuccess()); return request;
  } };
  await assert.rejects(createSessionStore({ location, indexedDB: aborted }).save({}), /Aborted/);
});

test('記録の形式とルート内のパスを検証し、不正なパスや未知の形式でアクセスしない', () => {
  const root = new MemoryDirectory('root');
  for (const value of [record(root, '../a.md'), record(root, '/a.md'), record(root, 'a.txt'), record(root, 'a.md', ['../outside']), record(root, 'a.md', ['a\\b']), { ...record(root), version: 2 }, record({ kind: 'directory', name: 'invalid' })]) {
    assert.throws(() => readSession(value), /InvalidSession/);
  }
  assert.equal(readSession(null), null);
  assert.deepEqual([...readSession(record(root, '日本語/同名.MD', ['', '日本語'])).expanded], ['', '日本語']);
});

test('起動をまたいでフォルダ・深い階層・選択ノートを復元し、本文は最新ファイルから読む', async () => {
  const note = new MemoryFile('同名.MD', '保存済み');
  const unread = new MemoryFile('未選択.md', '取得しない');
  const deep = new MemoryDirectory('深い 階層', [note, unread]);
  const unopened = new MemoryDirectory('未展開', [new MemoryFile('a.md')]);
  const root = new MemoryDirectory('マイ ノート', [new MemoryFile('同名.MD', 'ルートの本文'), new MemoryDirectory('仕事', [deep]), unopened]);
  const first = await setup(root);
  directoryRow(first.$, '仕事').click(); await tick();
  directoryRow(first.$, '仕事/深い 階層').click(); await tick();
  await first.app.openNote('仕事/深い 階層/同名.MD'); first.edit('保存していない本文');
  await first.app.flushSession();
  assert.deepEqual(Object.keys(first.sessionStore.record).sort(), ['expandedPaths', 'root', 'selectedPath', 'version']);
  first.app.dispose(); first.window.close(); note.bytes = bytes('外部で更新済み');
  const next = await setup(null, { sessionStore: first.sessionStore, autoOpen: false }); await tick();
  assert.equal(next.app.state.root, root);
  assert.equal(next.app.state.current.path, '仕事/深い 階層/同名.MD');
  assert.equal(next.app.state.draft, '外部で更新済み'); assert.equal(next.app.dirty(), false);
  assert.equal(next.app.state.mode, 'rich');
  assert.equal(directoryRow(next.$, '仕事/深い 階層').getAttribute('aria-expanded'), 'true');
  assert.equal(next.$('tree').querySelector('[aria-current="page"]').dataset.file, '仕事/深い 階層/同名.MD');
  assert.equal(unopened.enumerations, 0); assert.equal(unread.reads, 0);
  assert.equal(note.writes, 0); assert.equal(root.permissionRequests.length, 0);
});

test('親の折りたたみと非表示の子の展開状態を保持し、再展開まで列挙しない', async () => {
  const child = new MemoryDirectory('子', [new MemoryFile('a.md')]);
  const parent = new MemoryDirectory('親', [child]);
  const root = new MemoryDirectory('root', [parent]);
  const sessionStore = new MemorySessionStore(record(root, null, ['親', '親/子']));
  const { app, $ } = await setup(null, { sessionStore, autoOpen: false });
  assert.equal(directoryRow($, '').getAttribute('aria-expanded'), 'false');
  assert.equal(parent.enumerations, 0); assert.equal(child.enumerations, 0);
  await app.reload();
  assert.deepEqual([...app.state.expanded], ['親', '親/子']);
  directoryRow($, '').click(); await tick();
  assert.equal(directoryRow($, '親/子').getAttribute('aria-expanded'), 'true');
  directoryRow($, '親').click(); await app.flushSession();
  assert.deepEqual(new Set(sessionStore.record.expandedPaths), new Set(['', '親/子']));
});

test('復元中の遅い列挙を空の展開状態で上書きせず、別の操作後も保持する', async () => {
  let release;
  const child = new MemoryDirectory('子', []); child.enumerationGate = new Promise(resolve => { release = resolve; });
  const root = new MemoryDirectory('root', [child, new MemoryFile('a.md', '本文')]);
  const sessionStore = new MemorySessionStore(record(root, null, ['', '子', '子/未表示']));
  const { app } = await setup(null, { sessionStore, autoOpen: false });
  assert.equal(sessionStore.saves.length, 0);
  await app.openNote('a.md'); await app.flushSession();
  assert.deepEqual(sessionStore.record.expandedPaths, ['', '子', '子/未表示']);
  release(); await tick();
});

test('権限が必要な起動では自動要求せず、クリック直後の read 許可だけで復元する', async () => {
  const root = new MemoryDirectory('前回のフォルダ', [new MemoryFile('a.md', '本文')]); root.permission = 'prompt';
  const sessionStore = new MemorySessionStore(record(root, 'a.md'));
  const { app, $ } = await setup(null, { sessionStore, autoOpen: false });
  assert.equal(app.state.root, null); assert.equal(root.enumerations, 0); assert.equal(root.permissionRequests.length, 0);
  assert.match($('welcome-text').textContent, /前回のフォルダ/);
  assert.equal($('welcome-open').textContent, 'アクセスを許可して開く');
  root.permission = 'denied'; $('welcome-open').click();
  assert.deepEqual(root.permissionRequests, [{ mode: 'read' }]); await tick();
  assert.equal(app.state.root, null); assert.equal(sessionStore.record.root, root); assert.equal(sessionStore.saves.length, 0);
  root.permission = 'granted'; $('welcome-open').click(); await tick();
  assert.equal(app.state.current.path, 'a.md'); assert.equal(app.state.draft, '本文');
  assert.deepEqual(root.permissionRequests, [{ mode: 'read' }, { mode: 'read' }]);
});

test('記録取得中は操作を止め、破棄したアプリに遅い復元結果を反映しない', async () => {
  let release;
  const root = new MemoryDirectory('root');
  const sessionStore = new MemorySessionStore(record(root)); sessionStore.loadGate = new Promise(resolve => { release = resolve; });
  const { app, $ } = await setup(null, { sessionStore, autoOpen: false, waitReady: false });
  assert.ok($('open-folder').disabled); await app.openFolder(); assert.equal(app.state.root, null);
  app.dispose(); release(); await app.ready;
  assert.equal(app.state.root, null); assert.equal(root.enumerations, 0);
});

test('削除ノートはフォルダを残し、削除フォルダは手動で選び直せる', async () => {
  const root = new MemoryDirectory('root', [new MemoryFile('別.md', '別の本文')]);
  const first = await setup(null, { sessionStore: new MemorySessionStore(record(root, '消えた.md')), autoOpen: false });
  assert.equal(first.app.state.root, root); assert.equal(first.app.state.current, null);
  assert.match(first.$('notice-text').textContent, /前回のノートを開けません/);
  await first.app.openNote('別.md'); assert.equal(first.app.state.draft, '別の本文');
  root.error = 'NotFoundError';
  const next = await setup(null, { sessionStore: new MemorySessionStore(record(root)), autoOpen: false });
  assert.equal(next.app.state.root, null); assert.ok(!next.$('open-folder').disabled);
  assert.match(next.$('notice-text').textContent, /前回のフォルダを開けません/);
  const other = new MemoryDirectory('新しいフォルダ'); next.window.showDirectoryPicker = async () => other;
  await next.app.openFolder(); await next.app.flushSession();
  assert.equal(next.sessionStore.record.root, other);
});

test('保存領域の障害や壊れた記録でも手動で開き、本文を保存できる', async () => {
  for (const kind of ['load', 'record', 'save']) {
    const file = new MemoryFile('a.md', '最初'); const root = new MemoryDirectory('root', [file]);
    const sessionStore = new MemorySessionStore(kind === 'record' ? { version: 9 } : undefined);
    if (kind === 'load') sessionStore.loadError = 'SecurityError';
    if (kind === 'save') sessionStore.saveError = 'QuotaExceededError';
    const { app, edit, $ } = await setup(root, { sessionStore }); await app.flushSession();
    assert.equal(app.state.root, root); assert.ok(!$('open-folder').disabled);
    if (kind === 'save') assert.match($('notice-text').textContent, /復元情報を記録できません/);
    await app.openNote('a.md'); edit('保存する本文'); assert.equal(await app.save(), true);
    assert.equal(new TextDecoder().decode(file.bytes), '保存する本文');
  }
});

test('フォルダ選択・未保存確認のキャンセルや取得失敗は復元記録を変更しない', async () => {
  const root = new MemoryDirectory('root', [new MemoryFile('a.md', '本文')]);
  const { app, window, edit, choose, sessionStore } = await setup(root);
  await app.openNote('a.md'); await app.flushSession(); const previous = sessionStore.record;
  edit('下書き'); window.showDirectoryPicker = async () => { throw failure('AbortError'); };
  await app.openFolder(); assert.equal(sessionStore.record, previous);
  window.showDirectoryPicker = async () => new MemoryDirectory('別');
  const picking = app.openFolder(); await tick(); choose('cancel'); await picking;
  assert.equal(sessionStore.record, previous); assert.equal(app.state.draft, '下書き');
  const missing = new MemoryDirectory('失敗'); missing.error = 'NotReadableError'; window.showDirectoryPicker = async () => missing;
  const failed = app.openFolder(); await tick(); choose('discard'); await failed;
  assert.equal(sessionStore.record, previous); assert.equal(app.state.root, root);
});

test('遅いノート読込と保存待ちがあっても、最後の選択と新しいルートを記録する', async () => {
  let releaseRead; let releaseSave;
  const slow = new MemoryFile('遅い.md', '遅い'); slow.readGate = new Promise(resolve => { releaseRead = resolve; });
  const root = new MemoryDirectory('root', [slow, new MemoryFile('速い.md', '速い')]);
  const sessionStore = new MemorySessionStore(); sessionStore.saveGate = new Promise(resolve => { releaseSave = resolve; });
  const { app, window } = await setup(root, { sessionStore });
  const reading = app.openNote('遅い.md'); await tick(); await app.openNote('速い.md');
  releaseRead(); await reading; releaseSave(); await app.flushSession();
  assert.equal(sessionStore.record.selectedPath, '速い.md');
  assert.ok(!sessionStore.saves.some(value => value.selectedPath === '遅い.md'));
  window.showDirectoryPicker = async () => new MemoryDirectory('新ルート'); await app.openFolder(); await app.flushSession();
  assert.equal(sessionStore.record.root.name, '新ルート'); assert.equal(sessionStore.record.selectedPath, null);
  assert.deepEqual(sessionStore.record.expandedPaths, ['']);
});
