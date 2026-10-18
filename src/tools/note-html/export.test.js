import { test } from 'vitest';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { setup, MemoryDirectory, MemoryFile, tick } from './helpers.test-support.js';

const pngBytes = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yG7sAAAAASUVORK5CYII=', 'base64'));
async function open(source = '# 本文', name = 'note.md') {
  const file = new MemoryFile(name, source); const png = new MemoryFile('image.png', pngBytes);
  const context = await setup(new MemoryDirectory('root', [file, png]));
  await context.app.openNote(name);
  const downloads = [];
  // ファイル境界は Node の Blob、FileReader は jsdom の実装を使う。
  const { FileReader, Blob: DOMBlob } = context.window;
  context.window.FileReader = class extends FileReader {
    async readAsDataURL(blob) { super.readAsDataURL(new DOMBlob([await blob.arrayBuffer()], { type: blob.type })); }
  };
  context.window.Blob = Blob;
  context.window.URL.createObjectURL = blob => { const url = URL.createObjectURL(blob); if (blob.type.startsWith('text/html')) downloads.push({ url, blob }); return url; };
  context.window.HTMLAnchorElement.prototype.click = function () {
    const download = downloads.find(entry => entry.url === this.href);
    if (download) download.name = this.download;
  };
  return { ...context, file, png, downloads };
}
async function downloaded(context) { return new JSDOM(await context.downloads.at(-1).blob.text()).window.document; }

test('HTMLは未保存のソース・文字サイズ・画像を含む単独文書で、原ファイルを書き換えない', async () => {
  const context = await open(); const { app, edit, $, window, downloads, file } = context;
  const draft = '---\ntitle: テスト\n---\n\n# 見出し\n\n- [x] **完了** [Web](https://example.com/)\n  - [ ] 未完了の子\n\n![画像](image.png)\n\n[添付](.assets/doc.pdf) [別ノート](other.md) [見出しへ](#見出し)\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n<script>alert(1)</script>\n\n![外部](https://example.com/image.png)\n\n[危険](javascript:alert(1))';
  edit(draft); $('font-size').value = '20'; $('font-size').dispatchEvent(new window.Event('change'));
  const editor = app.richEditor;
  assert.equal(await app.exportNote('html'), true);
  const doc = await downloaded(context);
  assert.equal(downloads.at(-1).name, 'note.html');
  assert.equal(doc.querySelector('article').style.getPropertyValue('--note-font-size'), '20px');
  assert.match(doc.querySelector('style').textContent, /--completed-ink/);
  // 画面のダークモード用の共通配色を持ち込まず、出力は常にライトの本文にする。
  assert.doesNotMatch(doc.querySelector('style').textContent, /--tb-|color-scheme/);
  assert.equal(doc.querySelector('input').checked, true); assert.equal(doc.querySelector('input').disabled, true);
  assert.equal(doc.querySelectorAll('[data-checked=false]').length, 1);
  assert.match(doc.querySelector('.raw-block').textContent, /title: テスト/);
  assert.equal(doc.querySelector('img').src, `data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}`);
  assert.equal(doc.querySelectorAll('img').length, 1);
  assert.equal(doc.querySelectorAll('script, iframe, button, [contenteditable]').length, 0);
  assert.equal(doc.querySelectorAll('[src^="blob:"]').length, 0);
  assert.match(doc.body.textContent, /添付（\.assets\/doc.pdf）/); assert.match(doc.body.textContent, /別ノート（other.md）/);
  assert.ok(doc.getElementById('note-export-見出し'));
  assert.ok(doc.querySelector(`a[href="#${encodeURIComponent('note-export-見出し')}"]`));
  assert.equal(doc.querySelector('a[href^="javascript:"]'), null);
  assert.equal(app.richEditor, editor); assert.equal(app.state.draft, draft); assert.ok(app.dirty()); assert.equal(app.state.mode, 'source');
  assert.equal(file.writes, 0); assert.equal(file.closes, 0);
});

test('直接編集のチェック・Undo・Redoが淡色表示の状態と出力へ反映される', async () => {
  const context = await open('- [ ] 作業\n  - [x] 子タスク'); const { app, $ } = context;
  const editor = app.richEditor;
  const item = () => $('rich-editor').querySelector('.task-item');
  item().querySelector('input').click(); assert.equal(item().dataset.checked, 'true');
  editor.run('undo'); assert.equal(item().dataset.checked, 'false');
  editor.run('redo'); assert.equal(item().dataset.checked, 'true');
  const selection = editor.view.state.selection; const draft = app.state.draft;
  await app.exportNote('html'); const doc = await downloaded(context);
  assert.equal(doc.querySelectorAll('input:checked').length, 2);
  assert.equal(editor.view.state.selection, selection); assert.equal(app.state.draft, draft);
  editor.run('undo'); assert.equal(item().dataset.checked, 'false');
});

test('PDFは画像のデコード完了後の本文を印刷し、操作状態・タイトル・一時DOMを戻す', async () => {
  const context = await open('# 本文\n\n![画像](image.png)'); const { app, $, window, file } = context;
  let release; const gate = new Promise(resolve => { release = resolve; });
  window.HTMLImageElement.prototype.decode = () => gate;
  let prints = 0; let printedUrl; const title = window.document.title;
  window.print = () => {
    prints++; const article = $('print-document');
    assert.ok(window.document.body.classList.contains('note-printing'));
    assert.equal(window.document.title, 'note'); assert.equal(article.querySelector('h1').textContent, '本文');
    assert.match(article.querySelector('img').src, /^blob:/);
    printedUrl = article.querySelector('img').src;
    assert.equal(article.querySelector('button'), null);
    window.dispatchEvent(new window.Event('afterprint'));
  };
  const exporting = app.exportNote('pdf'); await tick();
  assert.equal(prints, 0); assert.equal($('export').disabled, true); assert.equal(app.richEditor.view.editable, false);
  assert.equal(await app.exportNote('html'), false); assert.equal(await app.save(), false);
  release(); assert.equal(await exporting, true);
  assert.equal(prints, 1); assert.equal($('print-document'), null); assert.equal(window.document.title, title);
  assert.equal(window.document.body.classList.contains('note-printing'), false); assert.equal($('export').disabled, false);
  assert.equal(file.writes, 0); assert.equal(app.dirty(), false);
  await assert.rejects(fetch(printedUrl));
});

test('印刷キャンセル・例外後も未保存本文と履歴を保持し、再出力できる', async () => {
  const context = await open(); const { app, window, edit, $ } = context;
  edit('# 編集後'); const title = window.document.title;
  window.print = () => { throw new Error('Print failed'); };
  assert.equal(await app.exportNote('pdf'), false); assert.match($('notice-text').textContent, /エクスポートできません/);
  assert.equal(window.document.title, title); assert.equal($('print-document'), null); assert.equal(app.state.busy, '');
  window.print = () => {}; assert.equal(await app.exportNote('pdf'), true);
  assert.equal(app.state.draft, '# 編集後'); assert.ok(app.dirty()); assert.equal(app.state.mode, 'source');
  assert.equal(await app.exportNote('html'), true);
});

test('画像の取得・デコード失敗は本文へ案内を残して出力を続ける', async () => {
  const context = await open('# 本文\n\n![欠落](missing.png)\n\n![破損](image.png)');
  context.window.HTMLImageElement.prototype.decode = async () => { throw new Error('Decode failed'); };
  assert.equal(await context.app.exportNote('html'), true);
  const doc = await downloaded(context);
  assert.equal(doc.querySelector('img'), null);
  assert.match(doc.body.textContent, /欠落（画像を取得できません/);
  assert.match(doc.body.textContent, /破損（画像を表示できません/);
  assert.match(context.$('notice-text').textContent, /一部の画像を出力できません/);
});

test('出力メニューはキャンセル可能で、未選択・IME変換・読み込み中は出力しない', async () => {
  const context = await open(); const { app, $, window, choose, downloads } = context;
  $('export').click(); assert.ok($('confirm-dialog').open); choose('cancel'); await tick(); assert.equal(downloads.length, 0);
  $('source-mode').click(); $('editor').dispatchEvent(new window.CompositionEvent('compositionstart'));
  assert.equal($('export').disabled, true); assert.equal(await app.exportNote('html'), false);
  $('editor').dispatchEvent(new window.CompositionEvent('compositionend'));
  $('export').click(); choose('html'); await tick(); assert.equal(downloads.length, 1);
  const empty = await setup(null, { autoOpen: false }); assert.equal(empty.$('export').disabled, true); assert.equal(await empty.app.exportNote('html'), false);
  let release; context.file.readGate = new Promise(resolve => { release = resolve; });
  const reloading = app.reload(); await tick(); assert.equal(await app.exportNote('html'), false); release(); await reloading;
});

test('画像取得中に終了しても印刷・ダウンロードせず、遅い結果を破棄する', async () => {
  const context = await open('# 本文'); const { app, png, edit, window, downloads } = context;
  let release; png.readGate = new Promise(resolve => { release = resolve; });
  edit('![画像](image.png)');
  let prints = 0; window.print = () => { prints++; };
  const exporting = app.exportNote('pdf'); await tick(); app.dispose();
  assert.equal(await exporting, false); release(); await tick();
  assert.equal(prints, 0); assert.equal(downloads.length, 0); assert.equal(context.$('print-document'), null);
});

test('空のノートと特殊文字を含む名前も安全なHTMLとして出力する', async () => {
  const context = await open('', '日本語 <img onerror=alert(1)>.MD');
  await context.app.exportNote('html'); const doc = await downloaded(context);
  assert.equal(doc.title, '日本語 <img onerror=alert(1)>'); assert.equal(doc.querySelector('img'), null);
  assert.match(doc.body.textContent, /このノートは空です/);
  assert.equal(context.downloads.at(-1).name, '日本語 <img onerror=alert(1)>.html');
});

test('HTMLの生成失敗後も再出力でき、終了時にはダウンロード用URLを解放する', async () => {
  const context = await open('![画像](image.png)'); const { app, window, downloads, $ } = context;
  const FileReader = window.FileReader;
  window.FileReader = class extends FileReader { readAsDataURL() {
    Object.defineProperty(this, 'error', { value: new window.DOMException('Reading failed', 'NotReadableError') });
    this.dispatchEvent(new window.Event('error'));
  } };
  assert.equal(await app.exportNote('html'), false); assert.equal(downloads.length, 0);
  assert.equal(app.state.busy, ''); assert.equal($('export').disabled, false);
  window.FileReader = FileReader; assert.equal(await app.exportNote('html'), true);
  const url = downloads.at(-1).url; assert.equal((await fetch(url)).status, 200);
  app.dispose(); await assert.rejects(fetch(url));
});
