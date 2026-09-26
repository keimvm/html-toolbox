import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const read = () => readFile(`${dist}/プロンプト集.html`, 'utf8');

test('配布物はプロンプト集.htmlの1ファイルだけになる', async () => {
  expect(await readdir(dist)).toEqual(['プロンプト集.html']);
});

test('JavaScriptとCSSがHTML内に含まれ、外部を読み込まない', async () => {
  const html = await read();
  expect(html).toMatch(/<script\b[^>]*>[\s\S]*?\S[\s\S]*?<\/script>/u);
  expect(html).toMatch(/<style\b[^>]*>[\s\S]*?\S[\s\S]*?<\/style>/u);
  expect(/<script\b[^>]*\bsrc\s*=/iu.test(html)).toBe(false);
  expect(
    /<link\b[^>]*\brel\s*=\s*["']?(?:stylesheet|modulepreload)\b/iu.test(html),
  ).toBe(false);
  expect(html.replaceAll('&#39;', "'")).toContain("connect-src 'none'");
  // フォルダの記録は版をまたいで読めるよう固定のキーで持ち、配置 URL を使わない。
  expect(html).toContain('toolbox-prompt-library');
  expect(html).not.toMatch(/location\.href/u);
});

test('共通ヘッダーの左上に戻るリンクの位置・アイコンとツール名・配色の切り替えを置く', async () => {
  const html = await read();
  const start = html.indexOf('<div class="tb-header-start">');
  expect(start).toBeGreaterThan(-1);
  const corner = html.slice(start, html.indexOf('</div>', start));
  expect(
    corner.match(/<template id="toolbox-home"><\/template>/gu),
  ).toHaveLength(1);
  const icon = await readFile(new URL('../src/icon.png', import.meta.url));
  expect(corner).toContain(
    `src="data:image/png;base64,${icon.toString('base64')}"`,
  );
  expect(corner).toMatch(/alt=""\s*\/>プロンプト集/u);
  expect(corner).toContain('tb-theme-toggle');
  // 切り替えが効くよう、light-dark() を OS の設定だけに従う形へ変換しない。
  expect(html.includes('light-dark(')).toBe(true);
  expect(html.includes('lightningcss-dark')).toBe(false);
});
