import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { assertDistribution, isValidVersion, packageRelease } from './toolbox.mjs';

const temps = [];
afterEach(async () => {
  for (const dir of temps.splice(0)) await rm(dir, { recursive: true, force: true });
});

test('版は実在する日付で、同じ日の2回目以降は .2 からの枝番', () => {
  for (const ok of ['2026.10.18', '2024.02.29', '2026.10.18.2', '2026.10.18.12'])
    expect(isValidVersion(ok)).toBe(true);
  for (const ng of [
    '2026.10.1',
    '2026.13.01',
    '2025.02.29',
    '2026.10.18.1',
    '2026.10.18.02',
    'v2026.10.18',
    '',
  ])
    expect(isValidVersion(ng)).toBe(false);
});

const sample = (version) =>
  `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'"></head>` +
  `<body><script>const v=${JSON.stringify(version)}</script>` +
  `<script type="application/octet-stream" id="tb-payload-pdfium">AA==</script>` +
  `<script type="application/octet-stream" id="tb-payload-font-jp">AA==</script></body></html>`;

test('配布物は CSP・版・PDF のデータを持つ必要がある', () => {
  expect(() => assertDistribution(sample('2026.10.18'), '2026.10.18')).not.toThrow();
  expect(() => assertDistribution(sample('dev'), '2026.10.18')).toThrow(/版/);
  expect(() =>
    assertDistribution(sample('2026.10.18').replace('Content-Security-Policy', 'x'), '2026.10.18'),
  ).toThrow(/CSP/);
  expect(() =>
    assertDistribution(sample('2026.10.18').replace('tb-payload-pdfium', 'x'), '2026.10.18'),
  ).toThrow(/pdfium/);
});

test('zip の中は版の名前のフォルダと index.html だけで、英数字の名前になる', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'toolbox-'));
  temps.push(dir);
  await mkdir(join(dir, 'dist'));
  await writeFile(join(dir, 'dist', 'index.html'), sample('2026.10.18'));
  await packageRelease('2026.10.18', dir);
  const listing = execFileSync('unzip', ['-Z1', join(dir, 'out', 'toolbox-2026.10.18.zip')], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n');
  expect(listing.sort()).toEqual(['toolbox-2026.10.18/', 'toolbox-2026.10.18/index.html']);
  for (const name of listing) expect(name).toMatch(/^[A-Za-z0-9.\-/]+$/);
  expect(await readFile(join(dir, 'out', 'toolbox-2026.10.18', 'index.html'), 'utf8')).toBe(
    sample('2026.10.18'),
  );
});

test('版を付けずに作った配布物は梱包しない', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'toolbox-'));
  temps.push(dir);
  await mkdir(join(dir, 'dist'));
  await writeFile(join(dir, 'dist', 'index.html'), sample('dev'));
  await expect(packageRelease('2026.10.18', dir)).rejects.toThrow(/版/);
  await expect(packageRelease('2026.10.1', dir)).rejects.toThrow(/日付形式/);
});
