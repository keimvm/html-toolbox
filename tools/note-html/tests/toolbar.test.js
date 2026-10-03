import test from 'node:test';
import assert from 'node:assert/strict';
import { TextSelection } from 'prosemirror-state';
import { setup, MemoryDirectory, MemoryFile } from './helpers.js';

test('書式メニューから空のチェックボックスを追加し、入力・チェック・保存・再読み込みできる', async () => {
  const file = new MemoryFile('note.md', '');
  const { app, $, popovers } = await setup(new MemoryDirectory('root', [file]));
  await app.openNote(file.name);
  const editor = app.richEditor;
  const view = editor.view;
  const button = $('format-toolbar').querySelector('[data-command=task]');
  assert.equal(button.textContent, 'チェックボックス');
  assert.equal(button.getAttribute('aria-label'), 'チェックボックス');
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  assert.equal(button.disabled, false);
  $('format-panel').showPopover(); button.click();
  assert.equal(popovers.isOpen($('format-panel')), false);
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.ok($('rich-editor').querySelector('input[type=checkbox]:not([hidden])'));
  assert.equal(view.hasFocus(), true);
  editor.run('undo');
  assert.equal(app.state.draft, '');
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  editor.run('redo');
  assert.equal(button.getAttribute('aria-pressed'), 'true');
  assert.ok(await app.save()); await app.reload();
  assert.ok($('rich-editor').querySelector('input[type=checkbox]:not([hidden])'));
  app.richEditor.view.dispatch(app.richEditor.view.state.tr.insertText('確認する'));
  $('rich-editor').querySelector('input[type=checkbox]').click();
  assert.match(app.state.draft, /- \[x\] 確認する/);
  assert.ok(await app.save()); await app.reload();
  assert.equal($('rich-editor').querySelector('input[type=checkbox]').checked, true);
  assert.match($('rich-editor').textContent, /確認する/);
});

test('書式メニューで本文・リストにチェックボックスを付け外しし、本文と完了状態を取り消しで戻す', async () => {
  for (const source of ['本文', '- 本文', '1. 本文', '- [x] 本文']) {
    const file = new MemoryFile('note.md', source);
    const { app, $ } = await setup(new MemoryDirectory('root', [file]));
    await app.openNote(file.name);
    const editor = app.richEditor;
    const button = $('format-toolbar').querySelector('[data-command=task]');
    const wasTask = source.includes('[x]');
    $('format-panel').showPopover(); button.click();
    assert.equal(button.getAttribute('aria-pressed'), String(!wasTask), source);
    assert.equal($('rich-editor').querySelectorAll('input[type=checkbox]:not([hidden])').length, wasTask ? 0 : 1, source);
    assert.equal(editor.view.state.doc.textContent, '本文');
    editor.run('undo'); assert.equal(app.state.draft, source);
    assert.equal(button.getAttribute('aria-pressed'), String(wasTask), source);
    if (wasTask) assert.equal($('rich-editor').querySelector('input').checked, true);
    assert.equal(file.writes, 0);
  }
});

test('書式メニューの開閉・書式変更で選択と未保存本文と履歴を保持する', async () => {
  const file = new MemoryFile('note.md', '選択した本文\n');
  const { app, $, popovers } = await setup(new MemoryDirectory('root', [file]));
  await app.openNote(file.name);
  const editor = app.richEditor;
  const view = editor.view;
  view.dispatch(view.state.tr.insertText('追記', 7));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 4)));
  const draft = app.state.draft;
  $('format-panel').showPopover();
  assert.equal(popovers.isOpen($('format-panel')), true);
  $('format-panel').hidePopover();
  assert.equal(app.richEditor, editor);
  assert.equal(app.state.draft, draft);
  assert.equal(view.state.selection.from, 1); assert.equal(view.state.selection.to, 4);
  $('format-panel').showPopover();
  $('format-toolbar').querySelector('[data-command=strong]').click();
  assert.match(app.state.draft, /\*\*選択し\*\*/);
  assert.equal(popovers.isOpen($('format-panel')), false);
  editor.run('undo'); assert.equal(app.state.draft, draft);
  editor.run('redo'); assert.match(app.state.draft, /\*\*選択し\*\*/);
  assert.equal(file.writes, 0);
  $('options-panel').showPopover(); $('source-mode').click();
  assert.equal(app.state.mode, 'source');
  assert.equal(popovers.isOpen($('options-panel')), false);
  assert.equal($('return-to-note').hidden, false);
  const changed = app.state.draft;
  $('return-to-note').click();
  assert.equal(app.state.mode, 'rich'); assert.equal(app.state.draft, changed);
  assert.ok(app.dirty());
});

test('操作後・フォーカス移動・編集不可への切替で閉じ、次回へ挿入メニューの展開を残さない', async () => {
  const file = new MemoryFile('note.md', '本文\n');
  const { app, $, window, popovers } = await setup(new MemoryDirectory('root', [file]));
  await app.openNote(file.name);
  $('options-panel').showPopover(); $('settings-open').focus();
  assert.equal(popovers.isOpen($('options-panel')), true);
  $('sidebar-toggle').focus();
  assert.equal(popovers.isOpen($('options-panel')), false);
  assert.equal(window.document.activeElement, $('sidebar-toggle'));
  $('format-panel').showPopover();
  const details = $('format-panel').querySelector('details'); details.open = true;
  $('source-mode').click();
  assert.equal(popovers.isOpen($('format-panel')), false);
  assert.equal(details.open, false);
  assert.equal(app.state.draft, '本文\n'); assert.equal(file.writes, 0);
});
