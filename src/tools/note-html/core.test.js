import { test } from 'vitest';
import assert from 'node:assert/strict';
import { decodeFile, encodeFile, resolveReference, listDirectory } from './core.js';
import { bytes, MemoryDirectory, MemoryFile } from './helpers.test-support.js';

test('UTF-8 / BOM / LF / CRLF を日本語と絵文字を含めて維持する', () => {
  for (const bom of ['', '\ufeff']) for (const newline of ['\n', '\r\n']) {
    const input = bytes(`${bom}# 日本語${newline}ノート 📝${newline}`);
    const format = decodeFile(input);
    assert.equal(format.problem, '');
    assert.deepEqual(encodeFile(format.text, format), input);
    assert.equal(new TextDecoder('utf-8', { ignoreBOM: true }).decode(encodeFile(`${format.text}追記\n`, format)), `${bom}# 日本語${newline}ノート 📝${newline}追記${newline}`);
  }
});
test('非 UTF-8・改行混在・単独 CR・バイナリは保存対象にしない', () => {
  for (const data of [new Uint8Array([0x82, 0xa0]), bytes('a\r\nb\n'), bytes('a\rb'), bytes('a\0b'), new Uint8Array([0xff, 0xfe, 0x41, 0])]) {
    const format = decodeFile(data); assert.ok(format.problem); assert.throws(() => encodeFile(format.text, format));
  }
});
test('空ファイルと先頭二つの BOM を破壊しない', () => {
  for (const text of ['', '\ufeff', '\ufeff\ufeff本文']) {
    assert.deepEqual(encodeFile(decodeFile(bytes(text)).text, decodeFile(bytes(text))), bytes(text));
  }
});
test('相対リンクをリンク元から解決し、ルート外・危険 URL を拒否する', () => {
  assert.deepEqual(resolveReference('../メモ%20A.MD#見出し', '仕事/週次.md'), { kind: 'note', path: 'メモ A.MD', fragment: '見出し' });
  assert.equal(resolveReference('images/photo.JPG', '仕事/週次.md').kind, 'image');
  assert.deepEqual(resolveReference('#概要', 'a.md'), { kind: 'anchor', fragment: '概要' });
  for (const raw of ['../../outside.md', '%2e%2e/%2e%2e/a.md', '/tmp/a.md', '//example.com/a.md', '%2fetc/a.md', 'C:\\notes.md', 'javascript:alert(1)', 'data:text/html,x', 'file:///tmp/a.md', 'mailto:a@b.com', '%zz', 'a%00.md', 'a\\b.md', 'a.md?query', 'https://user:pass@example.com']) assert.equal(resolveReference(raw, 'dir/a.md').kind, 'blocked', raw);
  assert.equal(resolveReference('https://example.com/path', 'a.md').kind, 'external');
});
test('フォルダ優先で名前順に列挙し、本文も未展開フォルダも取得しない', async () => {
  const note = new MemoryFile('日本語.MD');
  const hidden = new MemoryDirectory('.hidden', [new MemoryFile('nested.md')]);
  const root = new MemoryDirectory('root', [note, new MemoryFile('photo.png'), new MemoryFile('a.md'), hidden]);
  assert.deepEqual((await listDirectory(root)).map(item => item.name), ['.hidden', 'a.md', '日本語.MD']);
  assert.equal(note.reads, 0); assert.equal(hidden.enumerations, 0);
});
