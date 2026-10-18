import { test } from 'vitest';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { createDisplayStore, createLayoutStore, createSessionStore } from './session-store.js';
import { readDisplay } from './display.js';
import {
  setup,
  MemoryDirectory,
  MemoryFile,
  MemoryLayoutStore,
  tick,
} from './helpers.test-support.js';

function change({ $, window }, size) {
  $('font-size').value = String(size);
  $('font-size').dispatchEvent(new window.Event('change'));
}

test('文字サイズの記録は固定のキーで版（解凍先）をまたいで読み、フォルダ・レイアウト記録と共存する', async () => {
  const indexedDB = new IDBFactory();
  const env = (href) => ({ indexedDB, location: { href } });
  const source = env('file:///notes/index.html');
  await createLayoutStore(source).save({ version: 1, sidebarWidth: 400, sidebarCollapsed: true });
  await createSessionStore(source).save({ example: 'session' });
  await createDisplayStore(source).save({ version: 1, fontSize: 20 });
  assert.deepEqual(await createDisplayStore(env('file:///notes/index.html?test#anchor')).load(), {
    version: 1,
    fontSize: 20,
  });
  assert.deepEqual(
    await createDisplayStore(env('file:///other/toolbox-2026.10.18/index.html')).load(),
    { version: 1, fontSize: 20 },
  );
  assert.deepEqual(await createSessionStore(source).load(), { example: 'session' });
  assert.equal((await createLayoutStore(source).load()).sidebarWidth, 400);
});

test('本文・ソースでサイズを変更しても文書・履歴・未保存状態を維持し、次回に復元する', async () => {
  const file = new MemoryFile('note.md', '# 元の本文');
  const context = await setup(new MemoryDirectory('root', [file]));
  const { app, $, edit, displayStore } = context;
  await app.openNote(file.name);
  const editor = app.richEditor;
  edit('# 未保存の本文');
  for (const size of [14, 16, 18, 20, 24]) {
    change(context, size);
    assert.equal(
      context.window.document.documentElement.style.getPropertyValue('--note-font-size'),
      `${size}px`,
    );
    assert.equal(app.richEditor, editor);
    assert.equal(app.state.draft, '# 未保存の本文');
    assert.ok(app.dirty());
  }
  $('source-mode').click();
  const selection = editor.view.state.selection;
  change(context, 20);
  assert.equal(editor.view.state.selection, selection);
  await app.flushDisplay();
  assert.equal(file.writes, 0);
  const next = await setup(null, { autoOpen: false, displayStore });
  assert.equal(next.$('font-size').value, '20');
  editor.run('undo');
  assert.equal(app.state.draft, '# 元の本文');
});

test('遅い設定の読み出しで操作を巻き戻さず、連続変更を順番に記録する', async () => {
  const store = new MemoryLayoutStore({ version: 1, fontSize: 14 });
  let load;
  store.loadGate = new Promise((resolve) => {
    load = resolve;
  });
  const context = await setup(null, { autoOpen: false, waitReady: false, displayStore: store });
  let save;
  store.saveGate = new Promise((resolve) => {
    save = resolve;
  });
  change(context, 24);
  change(context, 18);
  load();
  await context.app.ready;
  assert.equal(context.$('font-size').value, '18');
  save();
  await context.app.flushDisplay();
  assert.deepEqual(
    store.saves.map((value) => value.fontSize),
    [24, 18],
  );
});

test('壊れた記録と保存障害でも標準表示・サイズ変更を利用できる', async () => {
  for (const value of [
    { version: 2, fontSize: 16 },
    { version: 3, fontSize: 16, uiFont: '' },
    { version: 3, fontSize: 16, uiFont: '', uiScale: 75 },
    { version: 1, fontSize: 999 },
    { version: 1, fontSize: '18' },
  ])
    assert.throws(() => readDisplay(value));
  assert.deepEqual(readDisplay({ version: 2, fontSize: 18, uiFont: 'Meiryo' }), {
    fontSize: 18,
    uiFont: 'Meiryo',
    uiScale: 100,
  });
  const store = new MemoryLayoutStore({ version: 1, fontSize: 999 });
  const context = await setup(null, { autoOpen: false, displayStore: store });
  assert.equal(context.$('font-size').value, '16');
  assert.match(context.$('notice-text').textContent, /表示設定を記憶できません/);
  store.saveError = 'QuotaExceededError';
  change(context, 24);
  await context.app.flushDisplay();
  assert.equal(context.$('font-size').value, '24');
  delete store.saveError;
  change(context, 18);
  await context.app.flushDisplay();
  assert.equal(store.record.fontSize, 18);
});

test('終了後に戻った文字サイズの記録を画面へ反映しない', async () => {
  const store = new MemoryLayoutStore({ version: 1, fontSize: 24 });
  let release;
  store.loadGate = new Promise((resolve) => {
    release = resolve;
  });
  const context = await setup(null, { autoOpen: false, waitReady: false, displayStore: store });
  context.app.dispose();
  release();
  await tick();
  assert.equal(context.$('font-size').value, '16');
});

test('設定でUIフォントとUIフォントサイズを指定・解除し、旧サイズ設定を移行して本文と履歴を維持する', async () => {
  const context = await setup(new MemoryDirectory('root', [new MemoryFile('note.md', '本文')]), {
    displayStore: new MemoryLayoutStore({ version: 1, fontSize: 20 }),
  });
  const { app, $, window, displayStore } = context;
  await app.openNote('note.md');
  const editor = app.richEditor;
  editor.view.dispatch(editor.view.state.tr.insertText('追記', 1));
  const draft = app.state.draft;
  $('options-toggle').click();
  $('settings-open').click();
  assert.ok($('settings-dialog').open);
  $('ui-font').value = 'Hiragino Sans';
  $('ui-font').dispatchEvent(new window.Event('change'));
  assert.equal($('ui-font-size').value, '100');
  $('ui-font-size').value = '120';
  $('ui-font-size').dispatchEvent(new window.Event('change'));
  assert.equal(window.document.documentElement.style.getPropertyValue('--ui-scale'), '1.2');
  change(context, 24);
  $('settings-close').click();
  await app.flushDisplay();
  assert.deepEqual(displayStore.record, {
    version: 3,
    fontSize: 24,
    uiFont: 'Hiragino Sans',
    uiScale: 120,
  });
  assert.equal(app.richEditor, editor);
  assert.equal(app.state.draft, draft);
  assert.ok(app.dirty());
  assert.equal(window.document.activeElement, $('options-toggle'));
  const next = await setup(null, { autoOpen: false, displayStore });
  assert.equal(next.$('ui-font').value, 'Hiragino Sans');
  assert.equal(next.$('font-size').value, '24');
  assert.equal(next.$('ui-font-size').value, '120');
  assert.equal(next.window.document.documentElement.style.getPropertyValue('--ui-scale'), '1.2');
  assert.match(
    next.window.document.documentElement.style.getPropertyValue('--ui-font-family'),
    /Hiragino Sans/,
  );
  next.$('ui-font').value = '';
  next.$('ui-font').dispatchEvent(new next.window.Event('change'));
  assert.equal(next.window.document.documentElement.style.getPropertyValue('--ui-font-family'), '');
  editor.run('undo');
  assert.equal(app.state.draft, '本文');
});
