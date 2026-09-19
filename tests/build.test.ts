import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const dist = fileURLToPath(new URL('../dist/', import.meta.url));

test('配布物はindex.htmlの1ファイルだけになる', async () => {
  expect(await readdir(dist)).toEqual(['index.html']);
});

test('JavaScriptとCSSがHTML内に含まれる', async () => {
  const html = await readFile(`${dist}/index.html`, 'utf8');
  expect(html).toMatch(/<script\b[^>]*>\s*\S[\s\S]*?<\/script>/iu);
  expect(html).toMatch(/<style\b[^>]*>\s*\S[\s\S]*?<\/style>/iu);
  expect(html).not.toMatch(/<script\b[^>]*\bsrc\s*=/iu);
  expect(html).not.toMatch(
    /<link\b[^>]*\brel\s*=\s*["']?(?:stylesheet|modulepreload)\b/iu,
  );
});
