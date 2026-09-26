import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { renderMarkdown } from '../src/markdown.js';
import { MemoryDirectory, MemoryFile } from './helpers.js';

function render(source, extras = {}) {
  const { window } = new JSDOM('<article></article>');
  const container = window.document.querySelector('article');
  const output = renderMarkdown({ document: window.document, container, source, path: '仕事/a.md', root: new MemoryDirectory('root'), onNote() {}, onError() {}, ...extras });
  return { container, output, window };
}
test('対象の Markdown 記法を安全な DOM に変換する', async () => {
  const { container, output } = render('# 見出し\n\n**太字** *強調* `inline`\n\n- 項目\n- [x] 完了\n- [ ] 未完了\n\n1. 番号\n\n> 引用\n\n---\n\n```js\n<script>alert(1)</script>\n```\n\n| 項目 | 状態 |\n|---|---|\n| a | b |');
  for (const tag of ['h1', 'strong', 'em', 'code', 'ul', 'ol', 'blockquote', 'hr', 'pre', 'table']) assert.ok(container.querySelector(tag), tag);
  assert.equal(container.querySelectorAll('input:disabled').length, 2); assert.ok(container.querySelector('input').checked); assert.equal(container.querySelectorAll('script').length, 0); await output.ready;
});
test('HTML・危険 URL・外部画像を実行も自動取得もしない', async () => {
  const { container, output } = render('<img src="https://example.com/pixel" onerror="alert(1)">\n\n<script>alert(1)</script>\n\n[危険](javascript:alert(1))\n\n![外部](https://example.com/a.png)\n\n![埋込](data:image/png;base64,AAAA)\n\n[外部リンク](https://example.com/)\n\n[範囲外](../../x.md)');
  await output.ready;
  assert.equal(container.querySelectorAll('img,script,iframe').length, 0);
  assert.match(container.textContent, /<script>/); assert.match(container.textContent, /参照できません/);
  for (const a of container.querySelectorAll('a[href]')) { assert.ok(a.href.startsWith('https://')); assert.equal(a.rel, 'noopener noreferrer'); assert.equal(a.target, '_blank'); }
});
test('相対ノートリンクはリンク元から解決してアプリ内で開く', () => {
  let received;
  const { container, window } = render('[別のノート](../日本語%20メモ.MD)', { onNote: (...args) => { received = args; } });
  const event = new window.MouseEvent('click', { bubbles: true, cancelable: true }); container.querySelector('a').dispatchEvent(event);
  assert.ok(event.defaultPrevented); assert.deepEqual(received, ['日本語 メモ.MD', '']);
});
test('ローカル画像だけを blob URL で表示し、終了時に解放する', async () => {
  const png = new MemoryFile('a.png', new Uint8Array([137, 80, 78, 71]));
  const root = new MemoryDirectory('root', [new MemoryDirectory('仕事', [png])]);
  const { container, output } = render('![ローカル](a.png)', { root }); await output.ready;
  const img = container.querySelector('img'); assert.ok(img); assert.match(img.src, /^blob:/); assert.equal(png.reads, 1); output.dispose();
});
