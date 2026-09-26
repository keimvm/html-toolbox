import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdown, serializeMarkdown } from '../src/markdown-document.js';

test('対応するMarkdownの文書構造を保存・再解析して維持する', () => {
  const sources = [
    '# 見出し\n\n## 次\n\n**太字** *斜体* ~~削除~~ `inline`\n\n通常の\n改行と  \n強制改行\n\n---',
    '3. 項目\n4. 次\n\n- [x] 完了\n- [ ] 未完了\n  - 入れ子\n\n    複数段落',
    '- \\[ \\] 普通の項目\n- \\[x\\] 文字列',
    '\\&copy; \\<https://example.com/>\n\n1\\) 普通の文字\n\n\\| a \\| b \\|\n\\|---\\|---\\|',
    '> 引用\n>\n> - 子\n>   - 孫\n>\n> ```js\n> const a = "```";\n> ```',
    '| 左 | 中 | 右 |\n|:---|:---:|---:|\n| a\\|b | `a\\|b` | **太字** [リンク](other.md) |',
    '![**画像**と説明](../画像.png "題名")\n\n[相対](../ノート.md#見出し) [外部](https://example.com/a?q=b)\n\n[参照][id]\n\n[id]: target.md "タイトル"',
    '<script>alert(1)</script>\n\n<img src="https://example.com/pixel" onerror="alert(1)">\n\n数式 $a$ と [[Wiki]] は文字列',
    '---\ntitle: 変えない\ntags: [one, two]\n---\n\n本文',
    '',
  ];
  for (const source of sources) {
    const doc = parseMarkdown(source);
    assert.deepEqual(parseMarkdown(serializeMarkdown(doc)).toJSON(), doc.toJSON(), source);
  }
});

test('タスクリストのチェックだけを状態として扱い、本文内の角括弧を保持する', () => {
  const doc = parseMarkdown('- [ ] 作業 [x] 本文\n- [X] 完了');
  assert.equal(doc.firstChild.firstChild.attrs.checked, false);
  assert.equal(doc.firstChild.child(1).attrs.checked, true);
  assert.equal(doc.firstChild.firstChild.textContent, '作業 [x] 本文');
  assert.match(serializeMarkdown(doc), /\[ \] 作業/);
});

test('画像とリンクの元参照およびコードの言語を保存する', () => {
  const source = '![日本語](../日本語%20画像.png "画像タイトル")\n\n[リンク](../日本語.md#節 "リンクタイトル")\n\n```javascript\nconst a = 1;\n```';
  const text = serializeMarkdown(parseMarkdown(source));
  assert.match(decodeURI(text), /\.\.\/日本語 画像.png/);
  assert.match(decodeURI(text), /日本語.md#節/);
  assert.match(text, /```javascript/);
  assert.doesNotMatch(text, /blob:/);
});
