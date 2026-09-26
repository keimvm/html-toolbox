import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));

test('配布物はPDF編集.htmlの1ファイルだけになる', async () => {
  expect(await readdir(dist)).toEqual(['PDF編集.html']);
});

test('JavaScriptとCSSがHTML内に含まれる', async () => {
  const html = await readFile(`${dist}/PDF編集.html`, 'utf8');
  // WASM入りの大きなHTMLを、全体にまたがる正規表現で走査しない。
  for (const tag of ['script', 'style']) {
    const opening = new RegExp(`<${tag}\\b[^>]*>`, 'iu').exec(html);
    expect(opening).not.toBeNull();
    const start = opening!.index + opening![0].length;
    const end = html.indexOf(`</${tag}>`, start);
    expect(end).toBeGreaterThan(start);
    expect(html.slice(start, end).trim().length).toBeGreaterThan(0);
  }
  expect(/<script\b[^>]*\bsrc\s*=/iu.test(html)).toBe(false);
  expect(
    /<link\b[^>]*\brel\s*=\s*["']?(?:stylesheet|modulepreload)\b/iu.test(html),
  ).toBe(false);
});

test('PDFiumと日本語フォントのバイナリ、Workerのコードとライセンスを含む', async () => {
  const html = await readFile(`${dist}/PDF編集.html`, 'utf8');
  expect(html.includes('data:application/wasm;base64,AGFzbQ')).toBe(true);
  expect(html.includes('data:font/otf;base64,T1RUTw')).toBe(true);
  expect(html.includes('new Worker(')).toBe(true);
  expect(html.includes('Copyright 2014 PDFium Authors')).toBe(true);
  expect(html.includes('SIL OPEN FONT LICENSE')).toBe(true);
  expect(html.replaceAll('&#39;', "'").includes("connect-src 'none'")).toBe(
    true,
  );
});

test('共通ヘッダーの左上に戻るリンクの位置・アイコンとツール名・配色の切り替えを置く', async () => {
  const html = await readFile(`${dist}/PDF編集.html`, 'utf8');
  const start = html.indexOf('<div class="tb-header-start">');
  expect(start).toBeGreaterThan(-1);
  const corner = html.slice(start, html.indexOf('</div>', start));
  expect(
    corner.match(/<template id="toolbox-home"><\/template>/gu),
  ).toHaveLength(1);
  expect(corner).toMatch(
    /<img\s+class="tb-header-icon"\s+src="data:image\/png;base64,[^"]+"\s+alt=""\s*\/>PDF編集/u,
  );
  const icon = await readFile(new URL('../src/icon.png', import.meta.url));
  expect(corner).toContain(
    `src="data:image/png;base64,${icon.toString('base64')}"`,
  );
  expect(corner).toContain('tb-theme-toggle');
  // 切り替えが効くよう、light-dark() を OS の設定だけに従う形へ変換しない。
  expect(html.includes('light-dark(')).toBe(true);
  expect(html.includes('lightningcss-dark')).toBe(false);
});
