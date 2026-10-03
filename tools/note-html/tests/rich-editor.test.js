import test from 'node:test';
import assert from 'node:assert/strict';
import { TextSelection } from 'prosemirror-state';
import { parseMarkdown } from '../src/markdown-document.js';
import { setup, MemoryDirectory, MemoryFile, tick, bytes } from './helpers.js';

// keymap と同じくモジュール読み込み時の OS で判定する（setup は navigator を jsdom に替える）。
const selectAllKeys = /Mac|iP(hone|[oa]d)/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };

async function open(source) {
  const file = new MemoryFile('note.md', source);
  const context = await setup(new MemoryDirectory('root', [file]));
  await context.app.openNote(file.name);
  assert.ok(context.app.richEditor, context.$('format-warning').textContent);
  return { ...context, file, editor: context.app.richEditor, view: context.app.richEditor.view };
}
function selection(view, from, to = from) { view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to))); }
function findText(view, text) {
  let found;
  view.state.doc.descendants((node, pos) => { if (found === undefined && node.isText && node.text.includes(text)) found = pos + node.text.indexOf(text); });
  assert.notEqual(found, undefined, text); return found;
}
function typeText(view, text) {
  for (const character of text) {
    const { from, to } = view.state.selection;
    if (!view.someProp('handleTextInput', handler => handler(view, from, to, character))) view.dispatch(view.state.tr.insertText(character, from, to));
  }
}
function press(view, window, key, options = {}) {
  const event = new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  view.dom.dispatchEvent(event);
  // jsdomにはブラウザ既定の文字削除がないため、未処理のBackspaceだけ補う。
  if (key === 'Backspace' && !event.defaultPrevented) {
    const { from, to } = view.state.selection;
    view.dispatch(view.state.tr.delete(from === to ? from - 1 : from, to));
  }
}

test('末尾のコードでEnterを2回押すと本文へ戻り、取り消し・やり直し・保存できる', async () => {
  const { app, editor, view, window, $ } = await open('```js\nconst a = 1;\n```\n');
  selection(view, view.state.doc.content.size - 1);
  press(view, window, 'Enter');
  assert.equal(view.state.doc.childCount, 1); assert.equal(view.state.doc.firstChild.textContent, 'const a = 1;\n');
  press(view, window, 'Enter');
  assert.equal(view.state.selection.$from.parent.type.name, 'paragraph');
  assert.equal(view.state.doc.firstChild.textContent, 'const a = 1;');
  editor.run('undo'); assert.equal(view.state.doc.childCount, 1); assert.equal(view.state.doc.firstChild.textContent, 'const a = 1;\n');
  editor.run('redo'); typeText(view, '通常の本文');
  assert.equal(view.state.doc.lastChild.textContent, '通常の本文');
  await app.save(); await app.reload();
  assert.equal($('rich-editor').querySelector('pre').textContent, 'const a = 1;');
  assert.equal($('rich-editor').querySelector('p').textContent, '通常の本文');
});

test('前にブロックがある空のコードはBackspaceで取り除き、前の行の末尾へ移る', async () => {
  const { app, editor, view, window } = await open('本文\n\n```js\n```\n\n```\na\n```\n');
  selection(view, view.state.doc.child(0).nodeSize + 1);
  press(view, window, 'Backspace');
  assert.deepEqual(view.state.doc.content.content.map(node => node.type.name), ['paragraph', 'code_block']);
  assert.equal(view.state.selection.$from.parent.textContent, '本文'); assert.equal(view.state.selection.$from.parentOffset, 2);
  editor.run('undo'); assert.equal(view.state.doc.child(1).type.name, 'code_block'); assert.equal(view.state.doc.child(1).attrs.params, 'js');
  editor.run('redo'); assert.doesNotMatch(app.state.draft, /```js/);
});

test('コード途中の改行と選択の置換はコード内に残る', async () => {
  const { view, window } = await open('```\na\nb\n```');
  selection(view, 3); press(view, window, 'Enter');
  assert.equal(view.state.doc.childCount, 1); assert.equal(view.state.doc.firstChild.textContent, 'a\n\nb');
  selection(view, 1, view.state.doc.content.size - 1); press(view, window, 'Enter');
  assert.equal(view.state.doc.childCount, 1); assert.equal(view.state.doc.firstChild.textContent, '\n');
});

test('末尾のコードから下矢印・Shift+Enterでも本文を作れる', async () => {
  const { editor, view, window } = await open('```\ncode\n```');
  selection(view, view.state.doc.content.size - 1); press(view, window, 'ArrowDown');
  assert.equal(view.state.selection.$from.parent.type.name, 'paragraph');
  assert.equal(view.state.doc.firstChild.textContent, 'code');
  editor.setMarkdown('```\ncode\n```\n'); selection(view, 3); press(view, window, 'Enter', { shiftKey: true });
  assert.equal(view.state.selection.$from.parent.type.name, 'paragraph');
  assert.equal(view.state.doc.firstChild.textContent, 'code');
});

test('コード内の全選択（Mac は Cmd+A、Windows は Ctrl+A）はそのブロックだけを選び、繰り返し・置換・取り消しにも対応する', async () => {
  const source = '前の本文\n\n```js\nfirst\nsecond\n```\n\n```\nother\n```\n\n後の本文';
  const { app, editor, view, window } = await open(source);
  const from = findText(view, 'first'), to = findText(view, 'second') + 6;
  selection(view, from + 2);
  for (let i = 0; i < 2; i++) {
    press(view, window, 'a', selectAllKeys);
    assert.equal(view.state.selection.from, from); assert.equal(view.state.selection.to, to);
  }
  assert.equal(app.dirty(), false);
  typeText(view, 'replacement');
  assert.equal(view.state.doc.child(1).textContent, 'replacement');
  assert.equal(view.state.doc.child(2).textContent, 'other');
  assert.equal(view.state.doc.firstChild.textContent, '前の本文');
  assert.equal(view.state.doc.lastChild.textContent, '後の本文');
  editor.run('undo'); assert.equal(app.state.draft, source);
  selection(view, from + 1); press(view, window, 'a', selectAllKeys);
  assert.equal(view.state.selection.from, from); assert.equal(view.state.selection.to, to);
  selection(view, from, findText(view, 'other'));
  press(view, window, 'a', selectAllKeys);
  assert.equal(view.state.selection.from, 0); assert.equal(view.state.selection.to, view.state.doc.content.size);
  selection(view, 1); press(view, window, 'a', selectAllKeys);
  assert.equal(view.state.selection.from, 0); assert.equal(view.state.selection.to, view.state.doc.content.size);
});

test('空のコード内の全選択でも周囲の本文を選ばない', async () => {
  const { view, window } = await open('```\n```\n\n本文');
  selection(view, 1); press(view, window, 'a', selectAllKeys);
  assert.equal(view.state.selection.from, 1); assert.equal(view.state.selection.to, 1);
});

test('Mac のコード内のCtrl+A / Ctrl+Eはブロック全体ではなく今の行の先頭・末尾へ移る', { skip: !selectAllKeys.metaKey }, async () => {
  const { app, view, window } = await open('```js\n\nfirst\nsecond\n```\n\n後の本文');
  const first = findText(view, 'first'), second = findText(view, 'second');
  selection(view, first + 1); press(view, window, 'e', { ctrlKey: true });
  assert.equal(view.state.selection.empty, true); assert.equal(view.state.selection.from, first + 5);
  selection(view, second + 1, second + 3); press(view, window, 'e', { ctrlKey: true });
  assert.equal(view.state.selection.empty, true); assert.equal(view.state.selection.from, second + 6);
  selection(view, second + 3); press(view, window, 'a', { ctrlKey: true });
  assert.equal(view.state.selection.empty, true); assert.equal(view.state.selection.from, second);
  selection(view, first + 2); press(view, window, 'a', { ctrlKey: true });
  assert.equal(view.state.selection.from, first);
  // 先頭の空行では、前の行がなくてもブロックの先頭で止まる。
  selection(view, first - 1); press(view, window, 'a', { ctrlKey: true });
  assert.equal(view.state.selection.from, first - 1);
  assert.equal(app.dirty(), false);
});

test('連続するコードの間へ下矢印で本文を挿入し、履歴・保存・再読み込みを保つ', async () => {
  const source = '```js\nfirst\n```\n\n```python\nsecond\n```';
  const { app, editor, view, window, $ } = await open(source);
  selection(view, findText(view, 'first') + 5); press(view, window, 'ArrowDown');
  assert.equal(view.state.doc.childCount, 3);
  assert.equal(view.state.doc.child(1).type.name, 'paragraph');
  assert.equal(view.state.selection.$from.parent, view.state.doc.child(1));
  editor.run('undo'); assert.equal(app.state.draft, source);
  editor.run('redo'); typeText(view, '間の本文');
  assert.equal(view.state.doc.firstChild.attrs.params, 'js');
  assert.equal(view.state.doc.lastChild.attrs.params, 'python');
  assert.ok(await app.save()); await app.reload();
  assert.deepEqual([...$('rich-editor').querySelectorAll('pre')].map(node => node.textContent), ['first', 'second']);
  assert.equal($('rich-editor').querySelector('p').textContent, '間の本文');
});

test('下矢印で作った空の段落は何も入力せずに離れると消え、入力・改行した段落は残す', async () => {
  const source = '```js\nfirst\n```\n\n```python\nsecond\n```';
  const { app, editor, view, window } = await open(source);
  const down = () => { selection(view, findText(view, 'first') + 5); press(view, window, 'ArrowDown'); };
  // jsdomには矢印キーの既定のカーソル移動がないため、次のコードの先頭への移動で代える。
  const leave = () => selection(view, findText(view, 'second'));
  down(); leave();
  assert.equal(view.state.doc.childCount, 2);
  assert.equal(view.state.selection.$from.parent.textContent, 'second');
  assert.equal(app.state.draft, source); assert.equal(app.dirty(), false);
  editor.run('undo'); assert.equal(view.state.doc.childCount, 2); assert.equal(app.state.draft, source);
  down(); selection(view, findText(view, 'first')); assert.equal(view.state.doc.childCount, 2);
  down(); typeText(view, '間の本文'); leave();
  assert.equal(view.state.doc.child(1).textContent, '間の本文');
  editor.setMarkdown(source); down(); press(view, window, 'Enter'); leave();
  assert.equal(view.state.doc.childCount, 4);
});

test('連続するコードの先頭で上矢印を押すと間に本文を作り、入力せずに離れると消える', async () => {
  const source = '```js\nfirst\n```\n\n```python\nsecond\n```';
  const { app, editor, view, window, $ } = await open(source);
  const up = () => { selection(view, findText(view, 'second')); press(view, window, 'ArrowUp'); };
  up();
  assert.equal(view.state.doc.child(1).type.name, 'paragraph');
  assert.equal(view.state.selection.$from.parent, view.state.doc.child(1));
  editor.run('undo'); assert.equal(app.state.draft, source);
  up(); selection(view, findText(view, 'first') + 5);
  assert.equal(view.state.doc.childCount, 2); assert.equal(app.state.draft, source);
  up(); typeText(view, '間の本文'); selection(view, findText(view, 'first'));
  assert.equal(view.state.doc.child(1).textContent, '間の本文');
  assert.ok(await app.save()); await app.reload();
  assert.deepEqual([...$('rich-editor').querySelectorAll('pre')].map(node => node.textContent), ['first', 'second']);
  assert.equal($('rich-editor').querySelector('p').textContent, '間の本文');
});

test('上矢印ではコードの途中・既存本文の後ろに段落を増やさず、先頭のコードの前には作れる', async () => {
  const { editor, view, window } = await open('```\nfirst\n```\n\n```\nsecond\nthird\n```');
  const before = view.state.doc;
  selection(view, findText(view, 'third')); press(view, window, 'ArrowUp'); assert.equal(view.state.doc, before);
  selection(view, findText(view, 'second'), findText(view, 'second') + 2); press(view, window, 'ArrowUp'); assert.equal(view.state.doc, before);
  editor.setMarkdown('本文\n\n```\ncode\n```');
  selection(view, findText(view, 'code')); press(view, window, 'ArrowUp'); assert.equal(view.state.doc.childCount, 2);
  editor.setMarkdown('```\ncode\n```');
  selection(view, 1); press(view, window, 'ArrowUp');
  assert.equal(view.state.doc.firstChild.type.name, 'paragraph'); assert.equal(view.state.selection.from, 1);
  selection(view, findText(view, 'code')); assert.equal(view.state.doc.childCount, 1);
});

test('下矢印では途中・選択中・既存本文の前に段落を増やさず、引用内の連続コードでも挿入できる', async () => {
  const { editor, view, window } = await open('```\nfirst\n```\n\n```\nsecond\n```');
  const before = view.state.doc;
  selection(view, 3); press(view, window, 'ArrowDown'); assert.equal(view.state.doc, before);
  selection(view, 1, 6); press(view, window, 'ArrowDown'); assert.equal(view.state.doc, before);
  editor.setMarkdown('```\nfirst\n```\n\n本文');
  selection(view, 6); press(view, window, 'ArrowDown'); assert.equal(view.state.doc.childCount, 2);
  editor.setMarkdown('> ```\n> first\n> ```\n>\n> ```\n> second\n> ```');
  selection(view, findText(view, 'first') + 5); press(view, window, 'ArrowDown');
  assert.equal(view.state.doc.firstChild.child(1).type.name, 'paragraph');
  assert.equal(view.state.selection.$from.parent.type.name, 'paragraph');
});

test('バッククォート・チルダ3個と言語名をEnterで確定するとコードになり、空のコードはBackspaceで本文へ戻る', async () => {
  const { app, editor, view, window } = await open('');
  typeText(view, '~~~ python '); assert.equal(view.state.doc.firstChild.type.name, 'paragraph');
  press(view, window, 'Enter');
  assert.equal(view.state.doc.firstChild.type.name, 'code_block'); assert.equal(view.state.doc.firstChild.attrs.params, 'python');
  assert.equal(view.state.doc.textContent, ''); assert.equal(view.state.selection.$from.parent.type.name, 'code_block');
  press(view, window, 'Backspace'); assert.equal(view.state.doc.firstChild.type.name, 'paragraph'); assert.equal(view.state.doc.textContent, '');
  editor.run('undo'); assert.equal(view.state.doc.firstChild.type.name, 'code_block');
  editor.run('undo'); assert.equal(view.state.doc.firstChild.type.name, 'paragraph'); assert.equal(view.state.doc.textContent, '~~~ python ');
  editor.setMarkdown(''); typeText(view, '```'); assert.equal(view.state.doc.firstChild.type.name, 'paragraph');
  typeText(view, 'js'); press(view, window, 'Enter'); typeText(view, 'const x = 1;');
  assert.equal(view.state.doc.firstChild.attrs.params, 'js'); assert.match(app.state.draft, /```js\nconst x = 1;\n```/);
});

test('区切り線の記法はEnterで確定し、後続の本文を作って履歴で戻せる', async () => {
  const { editor, view, window, app } = await open('');
  typeText(view, '---'); assert.equal(view.state.doc.firstChild.type.name, 'paragraph');
  press(view, window, 'Enter');
  assert.equal(view.state.doc.firstChild.type.name, 'horizontal_rule'); assert.equal(view.state.selection.$from.parent.type.name, 'paragraph');
  editor.run('undo'); assert.equal(view.state.doc.firstChild.type.name, 'paragraph'); assert.equal(view.state.doc.textContent, '---');
  editor.run('redo'); assert.equal(view.state.doc.firstChild.type.name, 'horizontal_rule');
  typeText(view, '続き'); assert.equal(view.state.doc.lastChild.textContent, '続き');
  assert.deepEqual(parseMarkdown(app.state.draft).toJSON(), view.state.doc.toJSON());
  for (const rule of ['***', '___']) {
    editor.setMarkdown(''); typeText(view, rule); press(view, window, 'Enter');
    assert.equal(view.state.doc.firstChild.type.name, 'horizontal_rule', rule);
  }
});

test('本文内のコードは閉じるバッククォートで変換し、後続本文に書式を残さない', async () => {
  const { editor, view, window, app } = await open('');
  typeText(view, '本文 `日本語 + 1'); assert.equal(view.dom.querySelector('code'), null);
  typeText(view, '`'); assert.equal(view.dom.querySelector('code').textContent, '日本語 + 1');
  press(view, window, 'Backspace'); assert.equal(view.dom.querySelector('code'), null); assert.equal(view.state.doc.textContent, '本文 `日本語 + 1`');
  press(view, window, 'Backspace'); typeText(view, '`'); typeText(view, ' 続き');
  assert.equal(view.dom.querySelector('code').textContent, '日本語 + 1'); assert.equal(view.state.doc.firstChild.lastChild.marks.length, 0);
  assert.match(app.state.draft, /本文 `日本語 \+ 1` 続き/);
  editor.run('undo'); editor.run('redo'); assert.equal(view.dom.querySelector('code').textContent, '日本語 + 1');
});

test('エスケープ・途中の区切り記号・コード内の記号は自動変換しない', async () => {
  const { editor, view } = await open('');
  typeText(view, '\\`literal`'); assert.equal(view.dom.querySelector('code'), null);
  editor.setMarkdown('本文'); selection(view, 3); typeText(view, '---'); assert.equal(view.dom.querySelector('hr'), null);
  editor.setMarkdown('後ろの本文'); selection(view, 1); typeText(view, '---'); assert.equal(view.dom.querySelector('hr'), null); assert.match(view.state.doc.textContent, /後ろの本文/);
  editor.setMarkdown('```\ncode\n```'); selection(view, view.state.doc.content.size - 1); typeText(view, '\n---\n`literal`\n```');
  assert.equal(view.state.doc.childCount, 1); assert.equal(view.state.doc.firstChild.textContent, 'code\n---\n`literal`\n```');
});

test('表セルでは本文内コードだけを変換し、ブロックの記号を文字のまま残す', async () => {
  const { view } = await open('| 項目 |\n| --- |\n| 内容 |');
  selection(view, findText(view, '内容'), findText(view, '内容') + 2); typeText(view, '---');
  assert.equal(view.dom.querySelector('hr'), null); assert.equal(view.dom.querySelector('td').textContent, '---');
  selection(view, findText(view, '---'), findText(view, '---') + 3); typeText(view, '```');
  assert.equal(view.dom.querySelector('pre'), null);
  selection(view, findText(view, '```'), findText(view, '```') + 3); typeText(view, '`inline`');
  assert.equal(view.dom.querySelector('td code').textContent, 'inline');
});

test('開いただけ・選択・ソース往復で原文を変更せず、直接編集と取り消しを同期する', async () => {
  const original = '#   見出し\n\n*  項目\n\n';
  const { app, $, editor, view, file } = await open(original);
  assert.equal(view.dom.getAttribute('contenteditable'), 'true');
  const position = findText(view, '見出し'); selection(view, position);
  for (let i = 0; i < 2; i++) { $('source-mode').click(); assert.equal($('editor').value, original); $('source-mode').click(); }
  assert.equal(app.richEditor, editor); assert.equal(app.dirty(), false); assert.equal(file.writes, 0);
  view.dispatch(view.state.tr.insertText('新しい', position));
  assert.equal(app.dirty(), true); assert.match(app.state.draft, /新しい見出し/);
  assert.equal(editor.run('undo'), true); assert.equal(app.state.draft, original); assert.equal(app.dirty(), false);
  assert.equal(editor.run('redo'), true); assert.match(app.state.draft, /新しい見出し/);
});

test('ソースの変更を同じエディタへ取り込み、取り消し可能なまま保持する', async () => {
  const { app, edit, $, editor } = await open('# 最初\n');
  edit('#   ソースから\n\n**太字**\n'); $('source-mode').click();
  assert.equal(app.richEditor, editor); assert.equal(editor.getMarkdown(), '#   ソースから\n\n**太字**\n');
  assert.equal($('rich-editor').querySelector('strong').textContent, '太字');
  editor.run('undo'); assert.equal(app.state.draft, '# 最初\n');
  editor.run('redo'); assert.equal(app.state.draft, '#   ソースから\n\n**太字**\n');
});

test('空ノートに書き、太字を適用して保存・再読み込みできる', async () => {
  const { app, editor, view, file, $ } = await open('');
  view.dispatch(view.state.tr.insertText('日本語 📝', 1));
  selection(view, 1, 4); assert.equal(editor.run('strong'), true);
  assert.equal($('rich-editor').querySelector('strong').textContent, '日本語');
  assert.ok(await app.save()); assert.match(new TextDecoder().decode(file.bytes), /\*\*日本語\*\* 📝/);
  await app.reload(); assert.equal($('rich-editor').querySelector('strong').textContent, '日本語');
  assert.equal(app.dirty(), false);
});

test('直接編集でBOM・CRLFを維持し、保存後に取り消すと未保存になる', async () => {
  const { app, editor, view, file } = await open('\ufeff# 本文\r\n');
  view.dispatch(view.state.tr.insertText('追記', 1));
  await app.save();
  assert.match(new TextDecoder('utf-8', { ignoreBOM: true }).decode(file.bytes), /^\ufeff# 追記本文\r\n$/);
  assert.equal(app.dirty(), false); editor.run('undo'); assert.equal(app.dirty(), true);
  editor.run('redo'); assert.equal(app.dirty(), false);
});

test('チェック操作とタスク追加がMarkdownに反映され、取り消せる', async () => {
  const { app, $, window, editor, view } = await open('- [ ] 作業\n\n本文');
  const checkbox = $('rich-editor').querySelector('input[type=checkbox]'); checkbox.click();
  assert.match(app.state.draft, /- \[x\] 作業/); editor.run('undo'); assert.match(app.state.draft, /- \[ \] 作業/);
  const position = findText(view, '本文'); selection(view, position);
  assert.equal(editor.run('task'), true); assert.match(app.state.draft, /- \[ \] 本文/);
  selection(view, findText(view, '本文') + 2);
  view.dom.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.equal($('rich-editor').querySelectorAll('input[type=checkbox]:not([hidden])').length, 3);
});

test('ToDo記法の入力でチェックボックスを表示し、クリック・次項目・保存・再読み込みに対応する', async () => {
  const { app, view, window, $ } = await open('');
  typeText(view, '- [ ] ');
  const checkbox = view.dom.querySelector('input[type=checkbox]:not([hidden])');
  assert.ok(checkbox); assert.equal(checkbox.checked, false);
  typeText(view, '作業'); checkbox.click();
  assert.match(app.state.draft, /- \[x\] 作業/);
  press(view, window, 'Enter'); typeText(view, '次の作業');
  assert.deepEqual([...view.dom.querySelectorAll('input[type=checkbox]:not([hidden])')].map(input => input.checked), [true, false]);
  assert.ok(await app.save()); await app.reload();
  assert.deepEqual([...$('rich-editor').querySelectorAll('input[type=checkbox]:not([hidden])')].map(input => input.checked), [true, false]);
  assert.match($('rich-editor').textContent, /次の作業/);
});

test('ToDoへの変換はBackspace・Undo・Redoで戻せ、空の項目も保存後に残る', async () => {
  const { app, view, window, editor, $ } = await open('');
  typeText(view, '- [ ] '); press(view, window, 'Backspace');
  assert.equal(view.dom.querySelector('input[type=checkbox]:not([hidden])'), null);
  assert.equal(view.state.doc.textContent, '[ ] ');
  press(view, window, 'Backspace'); typeText(view, ' ');
  editor.run('undo'); assert.equal(view.dom.querySelector('input[type=checkbox]:not([hidden])'), null);
  editor.run('redo'); assert.ok(view.dom.querySelector('input[type=checkbox]:not([hidden])'));
  assert.ok(await app.save()); await app.reload();
  assert.ok($('rich-editor').querySelector('input[type=checkbox]:not([hidden])'));
  assert.equal($('rich-editor').querySelector('input').checked, false);
});

test('完了済み・番号付き・入れ子のToDoを入力でき、本文・コード・表・エスケープは変換しない', async () => {
  const { view, editor } = await open('');
  for (const marker of ['- [x] ', '* [X] ', '1. [x] ']) {
    editor.setMarkdown(''); typeText(view, marker);
    assert.equal(view.dom.querySelector('input[type=checkbox]:not([hidden])').checked, true);
  }
  editor.setMarkdown('- 親\n  - 子'); selection(view, findText(view, '子')); typeText(view, '[ ] ');
  assert.equal(view.dom.querySelectorAll('input[type=checkbox]:not([hidden])').length, 1);
  for (const source of ['本文', '```\n本文\n```', '| 列 |\n| --- |\n| 本文 |', '- 項目\n\n  本文']) {
    editor.setMarkdown(source); selection(view, findText(view, '本文')); typeText(view, '[ ] ');
    assert.equal(view.dom.querySelector('input[type=checkbox]:not([hidden])'), null, source);
  }
  editor.setMarkdown(''); typeText(view, '- \\[ ] ');
  assert.equal(view.dom.querySelector('input[type=checkbox]:not([hidden])'), null);
});

test('表のセル・行列を編集して保存し、先頭行削除後もヘッダーを保つ', async () => {
  const { app, editor, view, $ } = await open('| 項目 | 状態 |\n|:---|---:|\n| a | b |\n');
  selection(view, findText(view, 'a')); view.dispatch(view.state.tr.insertText('新', findText(view, 'a')));
  assert.equal(editor.run('addRow'), true); assert.equal($('rich-editor').querySelectorAll('tr').length, 3);
  assert.equal(editor.run('addColumn'), true); assert.equal($('rich-editor').querySelectorAll('tr')[0].children.length, 3);
  selection(view, findText(view, '項目')); editor.run('deleteRow');
  assert.equal(view.state.doc.firstChild.firstChild.firstChild.type.name, 'table_header');
  assert.deepEqual(parseMarkdown(app.state.draft).toJSON(), view.state.doc.toJSON());
  await app.save(); await app.reload(); assert.match($('rich-editor').textContent, /新a/);
});

test('保存中は直接編集・チェック操作・ソース切り替えを止める', async () => {
  const { app, view, $, file } = await open('- [ ] 作業');
  view.dispatch(view.state.tr.insertText('新', findText(view, '作業'))); const expected = app.state.draft;
  let release; file.writeGate = new Promise(resolve => { release = resolve; });
  const saving = app.save(); await tick();
  assert.equal(view.editable, false); assert.ok($('source-mode').disabled); assert.ok($('rich-editor').querySelector('input').disabled);
  view.dispatch(view.state.tr.insertText('割り込み', findText(view, '作業'))); assert.equal(app.state.draft, expected);
  release(); await saving; assert.equal(view.editable, true);
});

test('直接編集で保存失敗・外部競合が起きても文書と履歴を保持する', async () => {
  const { app, view, editor, file, choose } = await open('元の本文');
  view.dispatch(view.state.tr.insertText('変更', 1)); const draft = app.state.draft;
  file.writeError = 'NotAllowedError'; assert.equal(await app.save(), false); assert.equal(app.richEditor, editor); assert.equal(app.state.draft, draft);
  delete file.writeError; file.bytes = bytes('外部更新');
  const saving = app.save(); await tick(); choose('cancel'); await saving;
  assert.equal(app.richEditor, editor); assert.equal(app.state.mode, 'rich'); assert.equal(app.state.draft, draft);
  editor.run('undo'); assert.equal(app.state.draft, '元の本文');
});

test('IME変換中は保存せず、確定後の本文を保存する', async () => {
  const { app, view, file, window, $ } = await open('');
  view.dom.dispatchEvent(new window.CompositionEvent('compositionstart', { bubbles: true }));
  view.dispatch(view.state.tr.insertText('日本語', 1));
  assert.equal(await app.save(), false); assert.equal(file.writes, 0); assert.equal($('save').disabled, true);
  view.dom.dispatchEvent(new window.CompositionEvent('compositionend', { bubbles: true })); await tick();
  assert.ok(await app.save()); assert.match(new TextDecoder().decode(file.bytes), /日本語/);
});

test('相対リンクは通常クリックで移動せず、修飾キーでアプリ内に開く', async () => {
  const { app, $, window } = await setup(new MemoryDirectory('root', [new MemoryFile('a.md', '[移動](b.md)'), new MemoryFile('b.md', '# 次')]));
  await app.openNote('a.md'); const link = $('rich-editor').querySelector('[data-md-link]');
  link.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); await tick(); assert.equal(app.state.current.path, 'a.md');
  link.dispatchEvent(new window.MouseEvent('click', { ctrlKey: true, bubbles: true, cancelable: true })); await tick(); assert.equal(app.state.current.path, 'b.md');
});

test('危険なリンク・HTML・外部画像は実行も自動取得もせず、原参照を保持する', async () => {
  const source = '<script>alert(1)</script>\n\n![外部](https://example.com/a.png)\n\n![範囲外](../a.png)\n\n[危険](javascript:alert(1))';
  const { app, $, view } = await open(source);
  assert.equal($('rich-editor').querySelectorAll('script, iframe, img, a[href]').length, 0);
  view.dispatch(view.state.tr.insertText('本文 ', 1));
  assert.match(app.state.draft, /https:\/\/example.com\/a.png/); assert.match(app.state.draft, /\.\.\/a.png/);
  assert.match($('rich-editor').textContent, /<script>/);
});

test('ローカル画像のBlob URLを保存せず、ノート切り替えで解放する', async () => {
  const png = new MemoryFile('a.png', new Uint8Array([137, 80, 78, 71]));
  const { app, $, window } = await setup(new MemoryDirectory('root', [new MemoryFile('a.md', '![画像](a.png)'), new MemoryFile('b.md', ''), png]));
  const revoked = []; const revoke = window.URL.revokeObjectURL; window.URL.revokeObjectURL = url => { revoked.push(url); revoke(url); };
  await app.openNote('a.md'); await tick(); const url = $('rich-editor').querySelector('img').src;
  assert.match(url, /^blob:/); assert.equal(app.state.draft, '![画像](a.png)');
  await app.openNote('b.md'); assert.deepEqual(revoked, [url]); assert.equal(png.reads, 1);
});

test('リンクダイアログは選択を保ち、安全な参照だけを適用する', async () => {
  const { app, view, window, $ } = await open('選択する文字'); selection(view, 1, 3);
  $('format-toolbar').querySelector('[data-command=link]').click();
  const dialog = window.document.querySelector('.link-dialog'); const [label, url] = dialog.querySelectorAll('input'); const apply = dialog.querySelector('.tb-primary');
  assert.equal(app.state.asking, true); url.value = 'javascript:alert(1)'; apply.click(); assert.equal(dialog.open, true); assert.equal(app.dirty(), false);
  label.value = 'ノート'; url.value = 'other.md'; apply.click();
  assert.equal(app.state.asking, false); assert.match(app.state.draft, /\[ノート\]\(other.md\)する文字/);
});

test('貼り付けは対応する書式を保ち、HTMLのイベント属性・実行可能な参照をDOMに置かない', async () => {
  const { view, $, app } = await open('');
  view.pasteHTML('<p><strong>太字</strong>と<em>斜体</em><img src="https://example.com/pixel" onerror="alert(1)"><a href="javascript:alert(1)">参照</a></p>');
  assert.equal($('rich-editor').querySelector('strong').textContent, '太字');
  assert.equal($('rich-editor').querySelector('em').textContent, '斜体');
  assert.equal($('rich-editor').querySelectorAll('[onerror],img,a[href]').length, 0);
  assert.match(app.state.draft, /\*\*太字\*\*/);
  assert.match(app.state.draft, /https:\/\/example.com\/pixel/);
});

test('結合セルの貼り付けを止めて元の本文を保持する', async () => {
  const { view, app, $ } = await open('元の本文');
  view.pasteHTML('<table><tr><th colspan="2">結合</th></tr><tr><td>a</td><td>b</td></tr></table>');
  assert.equal(app.state.draft, '元の本文');
  assert.match($('notice-text').textContent, /貼り付けには対応していません/);
});

test('表の最後のセルでTabを押すと次の行を作り、改行キーでセルを壊さない', async () => {
  const { view, window, $ } = await open('| a | b |\n|---|---|\n| c | d |');
  selection(view, findText(view, 'd'));
  view.dom.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  assert.equal($('rich-editor').querySelectorAll('tr').length, 3);
  view.dom.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }));
  assert.equal(view.state.selection.$from.parent.childCount, 0);
});

test('引用の解除と装飾をまたぐリンク全体の編集ができる', async () => {
  const { view, editor, app, $, window } = await open('> [前**中**後](other.md)');
  selection(view, findText(view, '中'));
  editor.run('quote'); assert.doesNotMatch(app.state.draft, /^>/);
  $('format-toolbar').querySelector('[data-command=link]').click();
  const dialog = window.document.querySelector('.link-dialog');
  assert.equal(dialog.querySelector('input').value, '前中後');
  [...dialog.querySelectorAll('button')].find(button => button.textContent === 'キャンセル').click();
});

test('空白と日本語を含む参照先をリンク編集で入力しても保存後に同じノートを指す', async () => {
  const { view, $, window, app } = await open('リンク'); selection(view, 1, 4);
  $('format-toolbar').querySelector('[data-command=link]').click();
  const dialog = window.document.querySelector('.link-dialog'); dialog.querySelectorAll('input')[1].value = '日本語 ノート.md'; dialog.querySelector('.tb-primary').click();
  const doc = parseMarkdown(app.state.draft);
  assert.equal(decodeURIComponent(doc.firstChild.firstChild.marks[0].attrs.href), '日本語 ノート.md');
});

test('先に打ったバッククォートの間で続けて入力するとインラインコードになり、保存・Undoに対応する', async () => {
  const { view, editor, app, $ } = await open('');
  typeText(view, '``'); selection(view, 2); typeText(view, 'abc日本語');
  assert.equal($('rich-editor').querySelector('code').textContent, 'abc日本語');
  assert.equal(view.state.doc.firstChild.textContent, 'abc日本語');
  assert.match(app.state.draft, /`abc日本語`/);
  assert.ok(await app.save()); editor.run('undo'); assert.ok(app.dirty()); editor.run('redo');
  assert.equal($('rich-editor').querySelector('code').textContent, 'abc日本語');
  await app.reload(); assert.equal($('rich-editor').querySelector('code').textContent, 'abc日本語');
});

test('既存バッククォート間の日本語確定も変換し、エスケープ・複数記号・コードブロックは変換しない', async () => {
  const { view, editor, $, window } = await open('``');
  selection(view, 2);
  view.dispatch(view.state.tr.insertText('日本語', 2));
  view.someProp('handleDOMEvents', handlers => handlers.compositionend?.(view, new window.CompositionEvent('compositionend')));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal($('rich-editor').querySelector('code').textContent, '日本語');
  editor.setMarkdown(''); typeText(view, '\\``'); selection(view, 3); typeText(view, 'x');
  assert.equal($('rich-editor').querySelectorAll('code').length, 0);
  for (const source of ['', '```\n``\n```']) {
    editor.setMarkdown(source);
    if (!source) view.dispatch(view.state.tr.insertText('````', 1));
    const start = findText(view, '``'); selection(view, start + 1); typeText(view, 'x');
    assert.equal(view.state.doc.firstChild.type.name === 'code_block' ? $('rich-editor').querySelectorAll('p code').length : $('rich-editor').querySelectorAll('code').length, 0);
  }
});

test('先に囲んだコードから右矢印で抜け、直後のBackspaceでは元の記号へ戻せる', async () => {
  const { view, editor, window, $ } = await open('');
  typeText(view, '``'); selection(view, 2); typeText(view, 'a');
  press(view, window, 'Backspace'); assert.equal(view.state.doc.firstChild.textContent, '`a`');
  editor.setMarkdown(''); typeText(view, '``'); selection(view, 2); typeText(view, 'code');
  press(view, window, 'ArrowRight'); typeText(view, ' 本文');
  assert.equal($('rich-editor').querySelector('code').textContent, 'code');
  assert.equal(view.state.doc.firstChild.textContent, 'code 本文');
});

test('コード内のTabは字下げし、Enterは字下げを引き継ぎ、字下げだけの行のEnterで本文へ戻る', async () => {
  const { editor, view, window } = await open('```\nif (a) {\n```');
  const code = () => view.state.doc.firstChild.textContent;
  selection(view, view.state.doc.content.size - 1);
  press(view, window, 'Enter'); press(view, window, 'Tab'); typeText(view, 'run();');
  assert.equal(code(), 'if (a) {\n    run();');
  press(view, window, 'Enter'); assert.equal(code(), 'if (a) {\n    run();\n    ');
  press(view, window, 'Tab', { shiftKey: true }); typeText(view, '}');
  assert.equal(code(), 'if (a) {\n    run();\n}');
  selection(view, 1, view.state.doc.content.size - 1); press(view, window, 'Tab');
  assert.equal(code(), '    if (a) {\n        run();\n    }');
  press(view, window, 'Tab', { shiftKey: true }); assert.equal(code(), 'if (a) {\n    run();\n}');
  assert.equal(view.state.doc.childCount, 1);
  editor.setMarkdown('```\n  a\n```'); selection(view, view.state.doc.content.size - 1);
  press(view, window, 'Enter'); press(view, window, 'Enter');
  assert.equal(code(), '  a'); assert.equal(view.state.selection.$from.parent.type.name, 'paragraph');
});

test('閉じ記号の入力で太字・斜体・取り消し線へ変換し、Backspaceで記号に戻せる', async () => {
  const { editor, view, window, app } = await open('');
  typeText(view, '本文 **太字** と *斜体* と ~~取消~~ と _下線_ 終わり');
  assert.equal(view.dom.querySelector('strong').textContent, '太字');
  assert.deepEqual([...view.dom.querySelectorAll('em')].map(node => node.textContent), ['斜体', '下線']);
  assert.equal(view.dom.querySelector('s').textContent, '取消');
  assert.equal(view.state.doc.textContent, '本文 太字 と 斜体 と 取消 と 下線 終わり');
  assert.match(app.state.draft, /^本文 \*\*太字\*\* と \*斜体\* と ~~取消~~ と \*下線\* 終わり/);
  editor.setMarkdown(''); typeText(view, '**a**'); press(view, window, 'Backspace');
  assert.equal(view.state.doc.textContent, '**a**'); assert.equal(view.dom.querySelector('strong'), null);
  for (const text of ['snake_case_name', '\\*\\*a**', '2 * 3 * 4', '****', '`**a**`']) {
    editor.setMarkdown(''); typeText(view, text);
    assert.equal(view.dom.querySelector('strong, em, s'), null, text);
  }
  assert.equal(view.dom.querySelector('code').textContent, '**a**');
});

test('リンク・画像の記法を閉じ括弧で変換し、開けないURLは文字のまま残す', async () => {
  const { editor, view, app } = await open('');
  typeText(view, '参照 [資料](https://example.com/a "題") と ![図](.assets/a.png) 続き');
  const link = view.dom.querySelector('[data-md-link]');
  assert.equal(link.textContent, '資料'); assert.equal(link.dataset.mdLink, 'https://example.com/a');
  let image;
  view.state.doc.descendants(node => { if (node.type.name === 'image') image = node; });
  assert.equal(image.attrs.src, '.assets/a.png'); assert.equal(image.attrs.alt, '図');
  assert.match(app.state.draft, /\[資料\]\(https:\/\/example\.com\/a "題"\) と !\[図\]\(\.assets\/a\.png\) 続き/);
  editor.setMarkdown(''); typeText(view, '[x](javascript:alert) と \\[y](https://example.com)');
  assert.equal(view.dom.querySelector('[data-md-link]'), null);
});

test('縦棒で区切った見出し行をEnterで確定すると表になり、最初のセルへ移動する', async () => {
  const { editor, view, window, app } = await open('');
  typeText(view, '| 項目 | **状態** |'); press(view, window, 'Enter');
  assert.deepEqual([...view.dom.querySelectorAll('th')].map(node => node.textContent), ['項目', '状態']);
  assert.equal(view.dom.querySelector('th strong').textContent, '状態');
  typeText(view, 'a'); assert.equal(view.dom.querySelector('td').textContent, 'a');
  assert.match(app.state.draft, /^\| 項目 \| \*\*状態\*\* \|\n\| --- \| --- \|\n\| a \| {2}\|/);
  editor.setMarkdown(''); typeText(view, '| 列'); press(view, window, 'Enter');
  assert.equal(view.dom.querySelector('table'), null);
});

test('Typoraと同じショートカットで見出し・段落・コード・ソース表示を切り替える', async () => {
  const { app, view, window } = await open('本文');
  const block = () => view.state.doc.firstChild;
  selection(view, 1);
  press(view, window, '2', selectAllKeys); assert.equal(block().type.name, 'heading'); assert.equal(block().attrs.level, 2);
  press(view, window, '2', selectAllKeys); assert.equal(block().type.name, 'paragraph');
  press(view, window, '3', selectAllKeys); press(view, window, '0', selectAllKeys); assert.equal(block().type.name, 'paragraph');
  press(view, window, '1', selectAllKeys); press(view, window, 'Backspace');
  assert.equal(block().type.name, 'paragraph'); assert.equal(block().textContent, '本文');
  press(view, window, ...(selectAllKeys.metaKey ? ['c', { metaKey: true, altKey: true }] : ['k', { ctrlKey: true, shiftKey: true }]));
  assert.equal(block().type.name, 'code_block');
  view.dom.dispatchEvent(new window.KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true, ...selectAllKeys }));
  assert.equal(app.state.mode, 'source');
  window.dispatchEvent(new window.KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true, ...selectAllKeys }));
  assert.equal(app.state.mode, 'rich');
});

test('コード右下の言語欄で言語を変更・取り消しでき、Enterでコードへ戻る', async () => {
  const { editor, view, window, app, $ } = await open('```js\ncode\n```\n');
  const input = () => $('rich-editor').querySelector('.code-language input');
  assert.equal(input().value, 'js');
  input().value = 'py`thon '; input().dispatchEvent(new window.Event('change'));
  assert.equal(view.state.doc.firstChild.attrs.params, 'python'); assert.match(app.state.draft, /^```python\ncode\n```/);
  editor.run('undo'); assert.equal(view.state.doc.firstChild.attrs.params, 'js'); assert.equal(input().value, 'js');
  input().value = 'ts'; input().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  assert.equal(view.state.doc.firstChild.attrs.params, 'ts'); assert.equal(view.state.selection.$from.parent.type.name, 'code_block');
  editor.setEditable(false); assert.equal(input().disabled, true);
});

test('文字だけの貼り付けはMarkdownとして書式にし、Shift付きでは文字のまま貼る', async () => {
  const { view } = await open('本文');
  const parse = (text, plain) => view.someProp('clipboardTextParser', parser => parser(text, view.state.selection.$from, plain, view));
  const blocks = parse('# 見出し\r\n\r\n- **項目**', false).content;
  assert.deepEqual([blocks.child(0).type.name, blocks.child(1).type.name], ['heading', 'bullet_list']);
  assert.ok(!parse('# 見出し', true));
  selection(view, 3); view.dispatch(view.state.tr.replaceSelection(parse('と **太字**', false)));
  assert.equal(view.state.doc.childCount, 1); assert.equal(view.state.doc.textContent, '本文と 太字');
  assert.equal(view.dom.querySelector('strong').textContent, '太字');
});
