import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  setup,
  MemoryDirectory,
  MemoryFile,
  bytes,
  tick,
  failure,
} from './helpers.test-support.js';
import { noteDocument } from './helpers.test-support.js';

const fixtures = () => {
  const first = new MemoryFile('週次メモ.md', '# 週次メモ\n\n内容\n');
  const second = new MemoryFile('企画.md', '# 企画\n');
  const root = new MemoryDirectory('マイ ノート', [
    first,
    second,
    new MemoryDirectory('仕事', [new MemoryFile('企画.md', '別の本文')]),
  ]);
  return { root, first, second };
};

test('選択・編集・未保存プレビュー・保存・ショートカット', async () => {
  const { root, first } = fixtures();
  const { app, $, edit, window } = await setup(root);
  await app.openNote(first.name);
  assert.equal(first.writes, 0);
  edit('# 変更後\n\n日本語 📝\n');
  $('source-mode').click();
  assert.equal($('rich-editor').querySelector('h1').textContent, '変更後');
  assert.equal($('save-status').textContent, '未保存');
  const event = new window.KeyboardEvent('keydown', { key: 's', metaKey: true, cancelable: true });
  window.dispatchEvent(event);
  assert.ok(event.defaultPrevented);
  await tick();
  assert.equal(new TextDecoder().decode(first.bytes), '# 変更後\n\n日本語 📝\n');
  assert.equal(first.closes, 1);
  assert.equal($('save-status').textContent, '保存済み');
});
test('別フォルダの同名ファイルは異なる保存先を使用する', async () => {
  const { root, second } = fixtures();
  const { app, edit } = await setup(root);
  await app.openNote('仕事/企画.md');
  edit('サブフォルダの変更');
  await app.save();
  assert.equal(
    new TextDecoder().decode(root.children.get('仕事').children.get('企画.md').bytes),
    'サブフォルダの変更',
  );
  assert.equal(new TextDecoder().decode(second.bytes), '# 企画\n');
});
test('未保存の切り替えでキャンセル・破棄・保存を選べる', async () => {
  for (const choice of ['cancel', 'discard', 'save']) {
    const { root, first, second } = fixtures();
    const { app, edit, choose } = await setup(root);
    await app.openNote(first.name);
    edit('編集内容');
    const next = app.openNote(second.name);
    await tick();
    choose(choice);
    await next;
    assert.equal(app.state.current.path, choice === 'cancel' ? first.name : second.name);
    assert.equal(
      new TextDecoder().decode(first.bytes),
      choice === 'save' ? '編集内容' : '# 週次メモ\n\n内容\n',
    );
    if (choice === 'cancel') assert.equal(app.state.draft, '編集内容');
  }
});
test('フォルダピッカーのキャンセルで編集中の状態を変えない', async () => {
  const { root, first } = fixtures();
  const { app, edit, window } = await setup(root);
  await app.openNote(first.name);
  edit('変更');
  window.showDirectoryPicker = async () => {
    throw failure('AbortError');
  };
  await app.openFolder();
  assert.equal(app.state.root, root);
  assert.equal(app.state.draft, '変更');
  assert.ok(app.dirty());
});
test('フォルダ切り替えと再読込にも未保存確認を適用する', async () => {
  for (const operation of ['folder', 'reload']) {
    const { root, first } = fixtures();
    const { app, edit, choose, window } = await setup(root);
    await app.openNote(first.name);
    edit('維持する');
    const other = new MemoryDirectory('other');
    window.showDirectoryPicker = async () => other;
    const next = operation === 'folder' ? app.openFolder() : app.reload();
    await tick();
    choose('cancel');
    await next;
    assert.equal(app.state.root, root);
    assert.equal(app.state.draft, '維持する');
  }
});
test('書込許可拒否・write/close エラーでも未保存内容を保持し、再試行できる', async () => {
  for (const error of ['permission', 'createError', 'writeError', 'closeError']) {
    const { root, first, second } = fixtures();
    const { app, $, edit, choose } = await setup(root);
    await app.openNote(first.name);
    edit('維持する本文');
    first[error] = error === 'permission' ? 'denied' : 'NotAllowedError';
    const next = app.openNote(second.name);
    await tick();
    choose('save');
    await next;
    assert.equal(app.state.current.path, first.name);
    assert.equal(app.state.draft, '維持する本文');
    assert.ok(app.dirty());
    assert.equal($('save-status').textContent, '未保存');
    assert.ok(!$('notice-action').hidden);
    assert.equal(first.aborted, ['writeError', 'closeError'].includes(error) ? 1 : 0);
    if (error === 'permission') first.permission = 'granted';
    else delete first[error];
    assert.equal(await app.save(), true);
    assert.equal(new TextDecoder().decode(first.bytes), '維持する本文');
  }
});
test('同じサイズの外部変更も検出し、上書きせず編集へ戻れる', async () => {
  const file = new MemoryFile('a.md', 'abcd');
  const { app, edit, choose, $ } = await setup(new MemoryDirectory('root', [file]));
  await app.openNote('a.md');
  edit('draft');
  file.bytes = bytes('efgh');
  const saving = app.save();
  await tick();
  assert.match($('confirm-title').textContent, /外部で変更/);
  choose('cancel');
  assert.equal(await saving, false);
  assert.equal(file.writes, 0);
  assert.equal(app.state.draft, 'draft');
  assert.equal(app.state.mode, 'source');
});
test('競合時の明示的な破棄で最新の外部本文を読み直す', async () => {
  const file = new MemoryFile('a.md', 'original');
  const { app, edit, choose } = await setup(new MemoryDirectory('root', [file]));
  await app.openNote('a.md');
  edit('draft');
  file.bytes = bytes('external');
  const saving = app.save();
  await tick();
  choose('reload');
  assert.equal(await saving, false);
  assert.equal(app.state.draft, 'external');
  assert.ok(!app.dirty());
  assert.equal(file.writes, 0);
});
test('削除された保存対象を再作成せず、再読込でも本文を保持する', async () => {
  const { root, first } = fixtures();
  const { app, edit, choose, $ } = await setup(root);
  await app.openNote(first.name);
  edit('保持');
  root.children.delete(first.name);
  assert.equal(await app.save(), false);
  assert.equal(first.writes, 0);
  const refreshing = app.reload();
  await tick();
  choose('discard');
  await refreshing;
  assert.equal(app.state.draft, '保持');
  assert.ok(app.dirty());
  assert.match($('notice-text').textContent, /削除・移動/);
  assert.ok(!$('tree').querySelector(`[data-file="${first.name}"]`));
});
test('同じパスに別ファイルが作られた場合も競合として停止する', async () => {
  const { root, first } = fixtures();
  const { app, edit, choose } = await setup(root);
  await app.openNote(first.name);
  edit('保持');
  root.children.set(first.name, new MemoryFile(first.name, first.bytes));
  const saving = app.save();
  await tick();
  choose('cancel');
  await saving;
  assert.equal(first.writes, 0);
  assert.ok(app.dirty());
});
test('保存直後の外部変更を比較基準に取り込まない', async () => {
  const { root, first } = fixtures();
  const { app, edit, choose } = await setup(root);
  await app.openNote(first.name);
  edit('保存内容');
  first.afterClose = () => {
    first.bytes = bytes('直後の外部更新');
  };
  assert.ok(await app.save());
  edit('次の変更');
  const saving = app.save();
  await tick();
  choose('cancel');
  await saving;
  assert.equal(first.writes, 1);
});
test('保存中の編集・対象切り替え・保存連打を防ぐ', async () => {
  const { root, first, second } = fixtures();
  const { app, edit, $ } = await setup(root);
  await app.openNote(first.name);
  edit('一度だけ保存');
  let release;
  first.writeGate = new Promise((resolve) => {
    release = resolve;
  });
  const saving = app.save();
  await tick();
  assert.ok($('editor').readOnly);
  assert.ok($('save').disabled);
  assert.equal(await app.save(), false);
  await app.openNote(second.name);
  assert.equal(app.state.current.path, first.name);
  release();
  await saving;
  assert.equal(first.writes, 1);
  assert.equal(first.closes, 1);
});
test('連続選択は最後のファイルを表示し、古い読込結果を捨てる', async () => {
  const { root, first, second } = fixtures();
  const { app, $ } = await setup(root);
  let release;
  first.readGate = new Promise((resolve) => {
    release = resolve;
  });
  const slow = app.openNote(first.name);
  await tick();
  await app.openNote(second.name);
  release();
  await slow;
  assert.equal(app.state.current.path, second.name);
  assert.equal($('rich-editor').querySelector('h1').textContent, '企画');
  assert.equal(app.state.busy, '');
});
test('非対応形式は閲覧に限定して元バイト列を守る', async () => {
  const file = new MemoryFile('a.md', bytes('a\r\nb\n'));
  const { app, $ } = await setup(new MemoryDirectory('root', [file]));
  await app.openNote('a.md');
  assert.equal(app.richEditor.view.editable, false);
  assert.ok(!$('format-warning').hidden);
  assert.equal(await app.save(), false);
  assert.equal(file.writes, 0);
});
test('beforeunload は未保存時だけ離脱確認を要求する', async () => {
  const { root, first } = fixtures();
  const { app, edit, window } = await setup(root);
  await app.openNote(first.name);
  let event = new window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  assert.ok(!event.defaultPrevented);
  edit('変更');
  event = new window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  assert.ok(event.defaultPrevented);
});
test('フォルダを展開して初めて列挙し、一部の失敗から再試行できる', async () => {
  const nested = new MemoryDirectory('.hidden', [new MemoryFile('sub.MD')]);
  nested.error = 'NotAllowedError';
  const { $, window } = await setup(
    new MemoryDirectory('root', [nested, new MemoryDirectory('empty')]),
  );
  assert.equal(nested.enumerations, 0);
  $('tree').querySelector('[data-directory=".hidden"]').click();
  await tick();
  assert.match($('tree').textContent, /許可がありません/);
  delete nested.error;
  $('tree').querySelector('.tree-retry').click();
  await tick();
  assert.ok($('tree').querySelector('[data-file=".hidden/sub.MD"]'));
  $('tree').querySelector('[data-directory="empty"]').click();
  await tick();
  assert.match($('tree').textContent, /Markdown ファイルはありません/);
  window.close();
});
test('別ルートの取得失敗後も元のツリーを展開できる', async () => {
  const { root } = fixtures();
  const { app, $, window } = await setup(root);
  const bad = new MemoryDirectory('bad');
  bad.error = 'NotReadableError';
  window.showDirectoryPicker = async () => bad;
  await app.openFolder();
  $('tree').querySelector('[data-directory="仕事"]').click();
  await tick();
  assert.ok($('tree').querySelector('[data-file="仕事/企画.md"]'));
});
test('非対応ブラウザには理由を表示して操作を無効にする', async () => {
  const { $ } = await setup(null, { supported: false });
  assert.ok($('open-folder').disabled);
  assert.match($('notice-text').textContent, /Chrome/);
});
test('画面の骨組みは外部の読み込みを含まない（通信の禁止は配布物の CSP で確かめる）', () => {
  const html = noteDocument();
  assert.doesNotMatch(html, /(?:src|href)=["']https?:/i);
  assert.doesNotMatch(html, /<script/i);
});
