import test from 'node:test';
import assert from 'node:assert/strict';
import { TextSelection } from 'prosemirror-state';
import { parseMarkdown } from '../src/markdown-document.js';
import { setup, MemoryDirectory, MemoryFile, tick, bytes } from './helpers.js';

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

test('3個のバッククォートで即座にコードへ変換し、Backspaceで記号に戻せる', async () => {
  const { app, view, window } = await open('');
  typeText(view, '``'); assert.equal(view.state.doc.firstChild.type.name, 'paragraph');
  typeText(view, '`'); assert.equal(view.state.doc.firstChild.type.name, 'code_block'); assert.equal(view.state.doc.textContent, '');
  press(view, window, 'Backspace'); assert.equal(view.state.doc.firstChild.type.name, 'paragraph'); assert.equal(view.state.doc.textContent, '```');
  press(view, window, 'Backspace'); typeText(view, '`'); typeText(view, 'const x = 1;');
  assert.equal(view.state.doc.firstChild.type.name, 'code_block'); assert.match(app.state.draft, /```\nconst x = 1;/);
});

test('ハイフン3個で区切り線と後続の本文を作り、Backspaceと履歴で戻せる', async () => {
  const { editor, view, window, app } = await open('');
  typeText(view, '---');
  assert.equal(view.state.doc.firstChild.type.name, 'horizontal_rule'); assert.equal(view.state.selection.$from.parent.type.name, 'paragraph');
  press(view, window, 'Backspace'); assert.equal(view.state.doc.textContent, '---'); assert.equal(view.state.doc.childCount, 1);
  press(view, window, 'Backspace'); typeText(view, '-');
  editor.run('undo'); assert.equal(view.state.doc.firstChild.type.name, 'paragraph');
  editor.run('redo'); assert.equal(view.state.doc.firstChild.type.name, 'horizontal_rule');
  typeText(view, '続き'); assert.equal(view.state.doc.lastChild.textContent, '続き');
  assert.deepEqual(parseMarkdown(app.state.draft).toJSON(), view.state.doc.toJSON());
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
  assert.equal($('rich-editor').querySelectorAll('input:not([hidden])').length, 3);
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
