import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  addVersionBadge,
  isValidVersion,
  readTools,
  renderIndex,
  validateTools,
} from './toolbox.mjs';

test('版番号は日付形式と同じ日の連番だけを受け付ける', () => {
  for (const version of ['2026.09.26', '2026.09.26.2', '2026.09.26.10', '2024.02.29']) {
    assert.equal(isValidVersion(version), true, version);
  }
  for (const version of [
    'v2026.09.26',
    '2026.9.26',
    '2026.09.26.1',
    '2026.09.26.02',
    '2026.13.01',
    '2026.02.30',
    '2025.02.29',
    '2026.09.26-rc',
    '',
  ]) {
    assert.equal(isValidVersion(version), false, version);
  }
});

test('tools.json の不正な内容を拒否する', () => {
  const ok = { dir: 'pdf-edit', name: 'PDF編集', description: '説明' };
  assert.deepEqual(validateTools([ok]), [ok]);
  assert.throws(() => validateTools([]));
  assert.throws(() => validateTools({ tools: [ok] }));
  assert.throws(() => validateTools([{ ...ok, dir: 'PDF編集' }]));
  assert.throws(() => validateTools([{ ...ok, dir: '../x' }]));
  assert.throws(() => validateTools([{ ...ok, name: ' ' }]));
  assert.throws(() => validateTools([{ ...ok, description: undefined }]));
  assert.throws(() => validateTools([ok, ok]));
});

test('リポジトリの tools.json は有効で、各フォルダがある', async () => {
  const tools = await readTools();
  assert.ok(tools.some((tool) => tool.dir === 'pdf-edit'));
});

test('版番号の表示は最後の </body> の直前に入る', () => {
  const html = '<html><body><script>"</body>"</script><p>x</p></body></html>';
  const result = addVersionBadge(html, '2026.09.26');
  assert.ok(result.startsWith('<html><body><script>"</body>"</script><p>x</p><style>'));
  assert.ok(result.endsWith('>toolbox 2026.09.26</div></body></html>'));
  assert.throws(() => addVersionBadge('<html></html>', '2026.09.26'));
});

test('入口ページに一覧・版番号・注意書きが入り、外部を読み込まない', () => {
  const html = renderIndex(
    [
      { dir: 'a-tool', name: '<ツールA>', description: '説明 & 注意' },
      { dir: 'b.tool', name: 'ツールB', description: '説明B' },
    ],
    '2026.09.26.2',
  );
  assert.ok(html.includes('<strong>2026.09.26.2</strong>'));
  assert.ok(html.includes('Chrome または Edge で開いてください'));
  assert.ok(html.includes('href="tools/a-tool.html"'));
  assert.ok(html.includes('&lt;ツールA&gt;'));
  assert.ok(html.includes('説明 &amp; 注意'));
  assert.ok(html.indexOf('a-tool') < html.indexOf('b.tool'), 'tools.json の順に並ぶ');
  assert.equal(/\b(?:src|href)="(?:https?:)?\/\//.test(html), false);
  assert.equal(/<script\b/.test(html), false);
});
