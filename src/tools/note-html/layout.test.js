import { test } from 'vitest';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createLayoutStore, createSessionStore } from './session-store.js';
import { readLayout } from './layout.js';
import { setup, MemoryDirectory, MemoryFile, MemorySessionStore, MemoryLayoutStore, layoutViewport, tick } from './helpers.test-support.js';

const record = (sidebarWidth = 420, sidebarCollapsed = false) => ({ version: 1, sidebarWidth, sidebarCollapsed });
const width = $ => Number($('sidebar-resizer').getAttribute('aria-valuenow'));
function key(context, key, options = {}) {
  const event = new context.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  context.$('sidebar-resizer').dispatchEvent(event); return event;
}
function pointer(context, type, clientX = 300, options = {}) {
  const event = new context.window.MouseEvent(type, { clientX, button: 0, bubbles: true, cancelable: true, ...options });
  Object.defineProperties(event, { pointerId: { value: options.pointerId ?? 1 }, isPrimary: { value: options.isPrimary ?? true } });
  context.$('sidebar-resizer').dispatchEvent(event); return event;
}

test('レイアウトは固定のキーで保存して版（解凍先）をまたいで読み、フォルダ記録と共存する', async () => {
  const indexedDB = new IDBFactory();
  const env = href => ({ indexedDB, location: { href } });
  const original = { version: 1, root: { name: 'ノート' }, selectedPath: 'a.md', expandedPaths: [''] };
  const session = createSessionStore(env('file:///notes/index.html'));
  await session.save(original);
  await createLayoutStore(env('file:///notes/index.html?x=1#heading')).save(record(550, true));
  assert.deepEqual(await session.load(), original);
  assert.deepEqual(await createLayoutStore(env('file:///notes/index.html')).load(), record(550, true));
  assert.deepEqual(await createLayoutStore(env('file:///other/toolbox-2026.10.18/index.html')).load(), record(550, true));
  await session.save({ ...original, selectedPath: 'b.md' });
  assert.deepEqual(await createLayoutStore(env('file:///notes/index.html')).load(), record(550, true));
});

test('画面幅に応じた初期幅と上下限を使い、縮小しても記憶した幅を失わない', async () => {
  for (const [viewport, expected] of [[980, 250], [1440, 292], [1600, 320]]) {
    const context = await setup(null, { autoOpen: false, viewport });
    assert.equal(width(context.$), expected);
  }
  const context = await setup(null, { autoOpen: false });
  const { $, window, app, layoutStore } = context;
  key(context, 'End'); await app.flushLayout(); assert.equal(width($), 600);
  layoutViewport(window, 681); assert.equal(width($), 267);
  assert.equal($('sidebar-resizer').getAttribute('aria-valuemax'), '267');
  layoutViewport(window, 680); assert.equal($('sidebar-resizer').hidden, true);
  assert.equal(key(context, 'Home').defaultPrevented, false);
  layoutViewport(window, 1440); assert.equal(width($), 600);
  await app.flushLayout(); assert.equal(layoutStore.saves.length, 1);
  key(context, 'Home'); assert.equal(width($), 220);
  assert.equal(key(context, 'ArrowLeft').defaultPrevented, true); assert.equal(width($), 220);
});

test('ドラッグは終了時に確定し、左右の上限とポインターを区別する', async () => {
  const context = await setup(null, { autoOpen: false });
  const { $, app, layoutStore } = context;
  pointer(context, 'pointerdown', 300, { button: 2 });
  pointer(context, 'pointermove', 600); assert.equal(width($), 292);
  assert.equal(pointer(context, 'pointerdown').defaultPrevented, true);
  pointer(context, 'pointermove', 400, { pointerId: 2 }); assert.equal(width($), 292);
  pointer(context, 'pointermove', 510); assert.equal(width($), 502);
  await app.flushLayout(); assert.equal(layoutStore.saves.length, 0);
  pointer(context, 'pointerup', 530); await app.flushLayout(); assert.deepEqual(layoutStore.record, record(522));
  assert.equal($('sidebar-resizer').hasPointerCapture(1), false);
  pointer(context, 'pointerdown'); pointer(context, 'pointerup', -300); assert.equal(width($), 220);
  pointer(context, 'pointerdown'); pointer(context, 'pointerup', 2000); assert.equal(width($), 600);
});

test('ドラッグの中断と破棄で開始幅と通常の操作状態に戻り、保存しない', async () => {
  for (const reason of ['pointercancel', 'lostpointercapture', 'escape', 'blur', 'resize', 'dispose']) {
    const context = await setup(null, { autoOpen: false });
    const { $, window, app, layoutStore } = context;
    pointer(context, 'pointerdown'); pointer(context, 'pointermove', 510); assert.equal(width($), 502);
    if (reason === 'escape') key(context, 'Escape');
    else if (reason === 'blur') window.dispatchEvent(new window.Event('blur'));
    else if (reason === 'resize') layoutViewport(window, 1440);
    else if (reason === 'dispose') app.dispose();
    else pointer(context, reason);
    assert.equal(width($), 292, reason);
    assert.equal(window.document.querySelector('.resizing-sidebar'), null, reason);
    assert.equal($('sidebar-resizer').hasPointerCapture(1), false, reason);
    await app.flushLayout(); assert.equal(layoutStore.saves.length, 0, reason);
  }
});

test('境界のキーボード操作と開閉のアクセシビリティ・フォーカスを保つ', async () => {
  const context = await setup(new MemoryDirectory('root', [new MemoryFile('note.md', '本文')]));
  const { $, window } = context;
  key(context, 'ArrowRight'); assert.equal(width($), 302);
  key(context, 'ArrowRight', { shiftKey: true }); assert.equal(width($), 352);
  key(context, 'ArrowLeft', { shiftKey: true }); assert.equal(width($), 302);
  key(context, 'ArrowLeft', { ctrlKey: true }); assert.equal(width($), 302);
  assert.equal($('sidebar-resizer').getAttribute('aria-valuetext'), '302ピクセル');
  $('tree').querySelector('button').focus(); $('sidebar-toggle').click();
  assert.equal(window.document.activeElement, $('sidebar-toggle'));
  assert.equal($('sidebar').hidden, true); assert.equal($('sidebar-resizer').hidden, true);
  assert.equal($('sidebar-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal($('sidebar-toggle').getAttribute('aria-label'), 'ファイルナビゲーションを開く');
  $('sidebar-toggle').click(); assert.equal($('sidebar').hidden, false); assert.equal(width($), 302);
  $('sidebar-resizer').focus(); layoutViewport(window, 680);
  assert.equal(window.document.activeElement, $('sidebar-toggle'));
  $('sidebar-toggle').click(); assert.equal($('sidebar').hidden, true);
  $('sidebar-toggle').click(); assert.equal($('sidebar').hidden, false); assert.equal($('sidebar-resizer').hidden, true);
});

test('フォルダ未選択でも起動をまたいで幅と開閉を復元し、幅制限中の開閉は希望幅を保つ', async () => {
  const initial = await setup(null, { autoOpen: false });
  initial.$('sidebar-toggle').click(); await initial.app.flushLayout();
  layoutViewport(initial.window, 980); initial.$('sidebar-toggle').click();
  assert.equal(width(initial.$), 292);
  const layoutStore = new MemoryLayoutStore(record(600));
  const context = await setup(null, { autoOpen: false, viewport: 681, layoutStore });
  pointer(context, 'pointerdown'); pointer(context, 'pointerup');
  context.$('sidebar-toggle').click(); await context.app.flushLayout();
  assert.deepEqual(layoutStore.record, record(600, true));
  const next = await setup(null, { autoOpen: false, layoutStore });
  assert.equal(next.app.state.root, null); assert.equal(width(next.$), 600); assert.equal(next.$('sidebar').hidden, true);
  next.$('sidebar-toggle').click(); assert.equal(width(next.$), 600);
});

test('フォルダの再許可待ちでもレイアウトを復元・変更し、既存記録を維持する', async () => {
  const root = new MemoryDirectory('ノート'); root.permission = 'prompt';
  const original = { version: 1, root, selectedPath: null, expandedPaths: [''] };
  const sessionStore = new MemorySessionStore(original);
  const context = await setup(null, { autoOpen: false, sessionStore, layoutStore: new MemoryLayoutStore(record(480, true)) });
  assert.equal(context.$('sidebar').hidden, true);
  assert.equal(context.$('welcome-open').textContent, 'アクセスを許可して開く');
  context.$('sidebar-toggle').click(); key(context, 'ArrowLeft'); await context.app.flushLayout();
  assert.equal(width(context.$), 470); assert.equal(sessionStore.record, original); assert.equal(root.permissionRequests.length, 0);
});

test('開閉と幅変更で本文・編集履歴・選択・ツリーを作り直さない', async () => {
  const file = new MemoryFile('a.md', '# 最初\n');
  const context = await setup(new MemoryDirectory('ノート', [file]));
  const { app, $, edit, sessionStore } = context;
  await app.openNote('a.md'); await app.flushSession(); const session = sessionStore.record;
  const editor = app.richEditor; const treeRow = $('tree').querySelector('[data-file]');
  edit('# 変更\n'); const draft = app.state.draft;
  for (const mode of ['source', 'rich']) {
    if (mode === 'rich') $('source-mode').click();
    const selection = editor.view.state.selection;
    $('sidebar-toggle').click(); key(context, 'End'); $('sidebar-toggle').click(); key(context, 'Home');
    assert.equal(app.richEditor, editor); assert.equal(editor.view.state.selection, selection);
    assert.equal($('tree').querySelector('[data-file]'), treeRow);
    assert.equal(app.state.draft, draft); assert.equal(app.state.mode, mode); assert.equal(app.dirty(), true);
  }
  assert.equal(sessionStore.record, session); assert.equal(file.writes, 0);
  const undo = $('format-toolbar').querySelector('[data-command="undo"]'); undo.click();
  assert.equal(app.state.draft, '# 最初\n');
});

test('遅い読み込みでユーザー操作を巻き戻さず、保存は操作順で確定する', async () => {
  let releaseLoad; let releaseSave;
  const layoutStore = new MemoryLayoutStore(record(590, true));
  layoutStore.loadGate = new Promise(resolve => { releaseLoad = resolve; });
  layoutStore.saveGate = new Promise(resolve => { releaseSave = resolve; });
  const context = await setup(null, { autoOpen: false, waitReady: false, layoutStore });
  key(context, 'ArrowRight'); context.$('sidebar-toggle').click(); context.$('sidebar-toggle').click();
  releaseLoad(); await context.app.ready;
  assert.equal(width(context.$), 302); assert.equal(context.$('sidebar').hidden, false);
  releaseSave(); await context.app.flushLayout();
  assert.deepEqual(layoutStore.saves, [record(302), record(302, true), record(302)]);
});

test('破棄後は遅い復元・イベントを反映せず、フォルダAPIがなくてもレイアウトは復元する', async () => {
  let release;
  const layoutStore = new MemoryLayoutStore(record(590, true));
  layoutStore.loadGate = new Promise(resolve => { release = resolve; });
  const context = await setup(null, { autoOpen: false, waitReady: false, layoutStore });
  context.app.dispose(); release(); await context.app.ready;
  context.$('sidebar-toggle').click(); key(context, 'End');
  assert.equal(width(context.$), 292); assert.equal(context.$('sidebar').hidden, false);
  const unsupported = await setup(null, { supported: false, layoutStore: new MemoryLayoutStore(record(430, true)) });
  assert.equal(width(unsupported.$), 430); assert.equal(unsupported.$('sidebar').hidden, true);
});

test('不正な記録・保存障害では一度だけ案内して編集と保存を継続できる', async () => {
  assert.equal(readLayout(null), null);
  for (const value of [{ ...record(), version: 2 }, record(NaN), record(Infinity), record('300'), record(219), record(601), record(300, 'false')]) assert.throws(() => readLayout(value), /InvalidLayout/);
  for (const kind of ['invalid', 'load', 'save']) {
    const layoutStore = new MemoryLayoutStore(kind === 'invalid' ? record(-1) : undefined);
    if (kind === 'load') layoutStore.loadError = 'SecurityError';
    layoutStore.saveError = 'QuotaExceededError';
    const file = new MemoryFile('a.md', '本文');
    const context = await setup(new MemoryDirectory('ノート', [file]), { autoOpen: false, layoutStore });
    key(context, 'End'); await context.app.flushLayout();
    assert.equal(context.$('notice-text').textContent, 'レイアウトを記憶できません。このまま利用できます。');
    context.$('notice-close').click(); key(context, 'Home'); await context.app.flushLayout();
    assert.equal(context.$('notice').hidden, true);
    await context.app.openFolder(); await context.app.openNote('a.md'); context.edit('変更'); await context.app.save();
    assert.equal(new TextDecoder().decode(file.bytes), '変更');
  }
  const layoutStore = new MemoryLayoutStore(); layoutStore.loadError = 'SecurityError';
  const unsupported = await setup(null, { supported: false, layoutStore }); await tick();
  assert.match(unsupported.$('notice-text').textContent, /Google Chrome/);
});
