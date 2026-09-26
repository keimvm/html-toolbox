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
