import { test } from 'vitest';
import assert from 'node:assert/strict';
import { TextSelection } from 'prosemirror-state';
import {
  createEntry,
  entryName,
  snapshotEntry,
  renameEntry,
  deleteEntry,
} from './file-operations.js';
import { setup, MemoryDirectory, MemoryFile, bytes, tick } from './helpers.test-support.js';

async function apply(context, name) {
  await tick();
  assert.ok(context.$('confirm-dialog').open);
  if (name !== undefined) context.$('entry-name').value = name;
  context.choose('apply-entry');
}

test('Markdownとフォルダを追加し、同名・ルート逸脱・予約名を拒否する', async () => {
  const root = new MemoryDirectory('root', [new MemoryFile('既存.md', '元の内容')]);
  const folder = await createEntry(root, '', '仕事', 'directory');
  const note = await createEntry(root, folder.path, '議事録', 'file');
  assert.equal(note.path, '仕事/議事録.md');
  assert.equal((await note.handle.getFile()).size, 0);
  await assert.rejects(createEntry(root, '', '既存.md', 'file'), /同じ名前/);
  assert.equal(new TextDecoder().decode(root.children.get('既存.md').bytes), '元の内容');
  for (const name of ['', '..', '../escape', 'a/b', 'a\\b', '.assets', 'a\u0000b', 'a.'])
    assert.throws(() => entryName(name, 'directory'));
  assert.equal(entryName('日本語 ノート.MD', 'file'), '日本語 ノート.MD');
});

test('フォルダの名前変更はバイナリ・隠しファイル・空フォルダを含めて内容を保持する', async () => {
  const file = new MemoryFile('ノート.md', '\ufeff# 内容\r\n');
  const folder = new MemoryDirectory('前', [
    file,
    new MemoryFile('.hidden', new Uint8Array([0, 1, 255])),
    new MemoryDirectory('空'),
  ]);
  const root = new MemoryDirectory('root', [folder]);
  const result = await renameEntry(root, '前', '後', await snapshotEntry(folder));
  assert.equal(root.children.has('前'), false);
  assert.equal(result.path, '後');
  assert.deepEqual(result.handle.children.get('ノート.md').bytes, file.bytes);
  assert.deepEqual(result.handle.children.get('.hidden').bytes, new Uint8Array([0, 1, 255]));
  assert.equal(result.handle.children.get('空').kind, 'directory');
});

test('名前変更で同名・コピー失敗・検証失敗・削除失敗があっても既存ファイルを上書きしない', async () => {
  for (const mode of ['duplicate', 'write', 'close', 'corrupt', 'delete', 'external']) {
    const file = new MemoryFile('前.md', '原文'),
      root = new MemoryDirectory('root', [file]);
    if (mode === 'duplicate') root.children.set('後.md', new MemoryFile('後.md', '既存'));
    root.onCreateFile = (target) => {
      if (mode === 'write') target.writeError = 'QuotaExceededError';
      if (mode === 'close') target.closeError = 'NotAllowedError';
      if (mode === 'corrupt')
        target.afterClose = () => {
          target.bytes = bytes('不一致');
        };
      if (mode === 'external')
        target.afterClose = () => {
          file.bytes = bytes('外部更新');
        };
    };
    if (mode === 'delete') root.removeError = 'NotAllowedError';
    await assert.rejects(renameEntry(root, '前.md', '後.md', await snapshotEntry(file)));
    assert.equal(root.children.get('前.md'), file);
    assert.equal(new TextDecoder().decode(file.bytes), mode === 'external' ? '外部更新' : '原文');
    if (mode === 'duplicate')
      assert.equal(new TextDecoder().decode(root.children.get('後.md').bytes), '既存');
  }
});

test('確認後に外部変更・差し替え・追加があれば削除を止める', async () => {
  for (const mode of ['content', 'replace', 'child']) {
    const file = new MemoryFile('note.md', '原文'),
      folder = new MemoryDirectory('folder', [file]);
    const root = new MemoryDirectory('root', [folder]),
      snapshot = await snapshotEntry(folder);
    if (mode === 'content') file.bytes = bytes('外部');
    if (mode === 'replace') folder.children.set('note.md', new MemoryFile('note.md', '原文'));
    if (mode === 'child') folder.children.set('new.pdf', new MemoryFile('new.pdf', 'pdf'));
    await assert.rejects(deleteEntry(root, 'folder', snapshot), /外部で変更/);
    assert.equal(root.children.get('folder'), folder);
  }
});

test('ナビゲーションの操作から追加でき、名前の検証・キャンセル・権限拒否では状態を保つ', async () => {
  const root = new MemoryDirectory('root'),
    context = await setup(root),
    { app, $, window } = context;
  await tick();
  $('tree').querySelector('.tree-entry-menu').click();
  assert.ok($('entry-menu').open);
  assert.ok(window.document.querySelector('[data-entry-action=rename]').hidden);
  window.document.querySelector('[data-entry-action=create-file]').click();
  await tick();
  $('entry-name').value = '../invalid';
  context.choose('apply-entry');
  assert.equal($('entry-error').hidden, false);
  assert.equal(root.children.size, 0);
  $('entry-name').value = '新規';
  context.choose('apply-entry');
  await tick();
  await tick();
  assert.equal(app.state.current.path, '新規.md');
  assert.ok($('tree').querySelector('[data-file="新規.md"]'));
  const cancel = app.manageEntry('create-directory', '', 'directory');
  await tick();
  context.choose('cancel');
  await cancel;
  assert.equal(root.children.size, 1);
  root.permission = 'denied';
  const deny = app.manageEntry('create-directory', '', 'directory');
  await apply(context, '追加');
  await deny;
  assert.equal(root.children.size, 1);
  assert.match($('notice-text').textContent, /許可がありません/);
});

test('開いているフォルダの名前変更で未保存本文・選択・Undo・展開・復元先を保つ', async () => {
  const file = new MemoryFile('note.md', '# 原文\n\n[次](next.md)');
  const folder = new MemoryDirectory('前', [file, new MemoryFile('next.md', '# 次')]),
    root = new MemoryDirectory('root', [folder]);
  const context = await setup(root),
    { app, $ } = context;
  await app.openNote('前/note.md');
  app.state.expanded.add('前');
  const editor = app.richEditor,
    view = editor.view;
  const tr = view.state.tr.insertText('追記', 1);
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, 3)));
  const draft = app.state.draft,
    selection = view.state.selection;
  const task = app.manageEntry('rename', '前', 'directory');
  await apply(context, '後');
  await task;
  assert.equal(app.state.current.path, '後/note.md');
  assert.equal(app.richEditor, editor);
  assert.equal(app.state.draft, draft);
  assert.equal(view.state.selection, selection);
  assert.ok(app.dirty());
  assert.ok(app.state.expanded.has('後'));
  assert.ok(!app.state.expanded.has('前'));
  await app.flushSession();
  assert.equal(context.sessionStore.record.selectedPath, '後/note.md');
  editor.run('undo');
  assert.equal(app.state.draft, '# 原文\n\n[次](next.md)');
  editor.run('redo');
  assert.ok(await app.save());
  assert.equal(
    new TextDecoder().decode(root.children.get('後').children.get('note.md').bytes),
    draft,
  );
  $('rich-editor')
    .querySelector('[data-md-link]')
    .dispatchEvent(
      new context.window.MouseEvent('click', { ctrlKey: true, bubbles: true, cancelable: true }),
    );
  await tick();
  assert.equal(app.state.current.path, '後/next.md');
});

test('削除のキャンセルと未保存ガードを保ち、確定後だけ本文と復元先を解除する', async () => {
  const folder = new MemoryDirectory('仕事', [
    new MemoryFile('note.md', '本文'),
    new MemoryFile('資料.pdf', 'pdf'),
  ]);
  const root = new MemoryDirectory('root', [folder]),
    context = await setup(root),
    { app, $, edit, choose } = context;
  await app.openNote('仕事/note.md');
  edit('未保存');
  const cancelled = app.manageEntry('delete', '仕事', 'directory');
  await tick();
  choose('cancel');
  await cancelled;
  assert.equal(app.state.draft, '未保存');
  assert.equal(root.children.size, 1);
  const task = app.manageEntry('delete', '仕事', 'directory');
  await tick();
  choose('discard');
  await tick();
  assert.match($('confirm-text').textContent, /2件、Markdown以外も含む/);
  assert.match($('confirm-text').textContent, /ゴミ箱/);
  choose('apply-entry');
  await task;
  assert.equal(root.children.size, 0);
  assert.equal(app.state.current, null);
  assert.equal(app.state.draft, '');
  await app.flushSession();
  assert.equal(context.sessionStore.record.selectedPath, null);
});

test('操作中は編集と再操作を止め、失敗しても未保存本文を維持する', async () => {
  const file = new MemoryFile('前.md', '原文'),
    root = new MemoryDirectory('root', [file]);
  const context = await setup(root),
    { app, $, edit } = context;
  await app.openNote('前.md');
  edit('未保存');
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  root.onCreateFile = (target) => {
    target.writeGate = gate;
    target.writeError = 'QuotaExceededError';
  };
  const task = app.manageEntry('rename', '前.md', 'file');
  await apply(context, '後.md');
  await tick();
  assert.ok($('editor').readOnly);
  assert.ok($('save').disabled);
  assert.ok($('tree').querySelector('.tree-entry-menu').disabled);
  await app.manageEntry('delete', '前.md', 'file');
  assert.equal($('confirm-dialog').open, false);
  release();
  await task;
  assert.equal(app.state.draft, '未保存');
  assert.equal(app.state.current.path, '前.md');
  assert.match($('notice-text').textContent, /コピーが残っている可能性/);
  assert.ok(root.children.has('前.md'));
});

test('書き込み許可を待つ間も対象を固定し、ノート切り替えと再操作を止める', async () => {
  const root = new MemoryDirectory('root', [
    new MemoryFile('a.md', 'A'),
    new MemoryFile('b.md', 'B'),
  ]);
  const context = await setup(root),
    { app, $ } = context;
  await app.openNote('a.md');
  let release;
  root.requestPermission = () =>
    new Promise((resolve) => {
      release = resolve;
    });
  const task = app.manageEntry('rename', 'a.md', 'file');
  await apply(context, 'after.md');
  await tick();
  assert.ok($('editor').readOnly);
  assert.ok($('tree').querySelector('[data-file="b.md"]').disabled);
  await app.openNote('b.md');
  assert.equal(app.state.current.path, 'a.md');
  release('granted');
  await task;
  assert.equal(app.state.current.path, 'after.md');
});
