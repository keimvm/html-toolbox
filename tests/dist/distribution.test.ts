// ビルドした配布物（dist/index.html）の検査。pnpm build のあとに実行する（pnpm test:dist）。
import { readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { CONTENT_SECURITY_POLICY } from '../../vite/toolbox.ts';

const dist = new URL('../../dist/', import.meta.url);
const html = readFileSync(new URL('index.html', dist), 'utf8');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map(
  ([, attributes, body]) => ({
    attributes: attributes!,
    body: body!,
  }),
);

test('配布物は HTML 1ファイルだけ', () => {
  expect(readdirSync(dist)).toEqual(['index.html']);
});

test('外部と通信しない CSP を付け、外部のファイルを読み込まない', () => {
  expect(html).toContain(
    `<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
  );
  expect(CONTENT_SECURITY_POLICY).toContain("connect-src 'none'");
  expect(CONTENT_SECURITY_POLICY).toContain("default-src 'none'");
  // src・href に外部の URL や別ファイルを置かない（data: と # だけ）。
  for (const [, , value] of html.matchAll(/\s(src|href)="([^"]*)"/g))
    expect(value).toMatch(/^(data:|#|$)/);
  expect(scripts.every((script) => !/\bsrc=/.test(script.attributes))).toBe(true);
  expect(html).not.toMatch(/<link\b[^>]*rel="stylesheet"/);
});

test('本体は普通の script で、重いデータより前に置く', () => {
  const main = scripts.findIndex((script) => script.attributes.trim() === '');
  const payload = scripts.findIndex((script) => script.attributes.includes('tb-payload-'));
  expect(main).toBeGreaterThanOrEqual(0);
  expect(main).toBeLessThan(payload);
  expect(scripts.some((script) => script.attributes.includes('type="module"'))).toBe(false);
});

function payload(name: string) {
  const script = scripts.find((item) => item.attributes.includes(`id="tb-payload-${name}"`));
  if (!script) throw new Error(name);
  return gunzipSync(Buffer.from(script.body.trim(), 'base64'));
}

test('PDFium と日本語フォントを gzip で1つずつ埋め込む', () => {
  const wasm = payload('pdfium');
  expect([...wasm.subarray(0, 4)]).toEqual([0x00, 0x61, 0x73, 0x6d]);
  expect(payload('font-jp').subarray(0, 4).toString('latin1')).toBe('OTTO');
  // wasm を JavaScript の側にも二重に埋め込まない。
  const main = scripts.find((script) => script.attributes.trim() === '')!;
  expect(main.body.length).toBeLessThan(wasm.length / 2);
});

test('配布物に入れたライブラリのライセンス文を持つ', () => {
  const script = scripts.find((item) => item.attributes.includes('id="tb-licenses"'))!;
  expect(script.attributes).toContain('type="application/json"');
  // script の中身は文字参照を解かないため、JSON の文字列として読み、< や & をそのまま表示する。
  expect(script.body).not.toContain('<');
  const licenses = JSON.parse(script.body) as string;
  for (const name of ['@embedpdf/pdfium', '@embedpdf/fonts-jp', 'preact', '@preact/signals-core'])
    expect(licenses).toContain(`${name} `);
  expect(licenses).toContain('SIL OPEN FONT LICENSE');
  // パッケージに入っていない分（vite/licenses/）：PDFium の wasm の中のライブラリと、Rust の標準ライブラリ。
  expect(licenses).toContain('The FreeType Project');
  expect(licenses).toContain('based in part on the work of the Independent JPEG Group');
  expect(licenses).toMatch(/^Rust standard library \S+$/m);
  expect(licenses).toMatch(/<[^<>\s]+@[^<>\s]+>/);
  expect(licenses).not.toMatch(/&(lt|amp);/);
});
