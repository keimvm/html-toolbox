import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const read = () => readFile(`${dist}/タイピングゲーム.html`, 'utf8');

test('配布物はタイピングゲーム.htmlの1ファイルだけになる', async () => {
  expect(await readdir(dist)).toEqual(['タイピングゲーム.html']);
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
});

test('貼った文章・打った文章をブラウザー内に保存しない', async () => {
  // 配色の記録（ui/theme-toggle.js の localStorage）以外の保存はない。
  const html = await read();
  expect(html).not.toMatch(/sessionStorage|indexedDB/u);
  const src = fileURLToPath(new URL('../src/', import.meta.url));
  for (const file of await readdir(src)) {
    if (!file.endsWith('.ts')) continue;
    const code = await readFile(`${src}/${file}`, 'utf8');
    expect(code, file).not.toMatch(/localStorage|sessionStorage|indexedDB/u);
  }
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
  expect(corner).toMatch(/alt=""\s*\/>タイピングゲーム/u);
  expect(corner).toContain('tb-theme-toggle');
  // 切り替えが効くよう、light-dark() を OS の設定だけに従う形へ変換しない。
  expect(html.includes('light-dark(')).toBe(true);
  expect(html.includes('lightningcss-dark')).toBe(false);
});
