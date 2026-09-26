import { build } from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
// 古い配布物や余分な資産を残さず、HTML 1ファイルだけを出力する。
await rm('dist', { recursive: true, force: true });
const result = await build({ entryPoints: ['src/app.js'], bundle: true, write: false, metafile: true, format: 'iife', target: 'chrome129', minify: true, legalComments: 'inline' });
// 実際に配布する依存関係からライセンスを列挙する。追加された間接依存も漏らさない。
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs).filter(path => path.includes('node_modules/'))) {
  let directory = dirname(resolve(input));
  while (true) {
    try {
      const meta = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      if (meta.name && meta.version) { packages.set(`${meta.name} ${meta.version}`, directory); break; }
    } catch { /* パッケージのルートまでたどる。 */ }
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Package not found: ${input}`);
    directory = parent;
  }
}
const licenses = [];
for (const [name, directory] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  let license;
  for (const file of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT.txt', 'LICENSE-MIT', 'license', 'license.md', 'license.txt']) {
    try { license = await readFile(join(directory, file), 'utf8'); break; } catch { /* 次のライセンス名を確認する。 */ }
  }
  if (!license) throw new Error(`License not found: ${name}`);
  licenses.push(`${name}\n${license}`);
}
const template = await readFile('src/index.html', 'utf8');
const libraryStyles = await Promise.all([
  ['prosemirror-view', 'prosemirror.css'], ['prosemirror-gapcursor', 'gapcursor.css'], ['prosemirror-tables', 'tables.css'],
].map(([name, file]) => readFile(join(dirname(require.resolve(name)), '../style', file), 'utf8')));
// toolbox 共通の配色・部品（ui/theme.css）の後に、このツールの画面の CSS を重ねる。
const theme = await readFile('../../ui/theme.css', 'utf8');
const css = [...libraryStyles, theme, await readFile('src/style.css', 'utf8')].join('\n');
const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const documentCss = await readFile('src/document.css', 'utf8');
// ヘッダーのアイコン。共通ヘッダーの処理が favicon にも使う。
const icon = `data:image/svg+xml,${encodeURIComponent((await readFile('src/icon.svg', 'utf8')).trim())}`;
const html = template.replace('"APP_ICON"', () => `"${icon}"`).replace('/* DOCUMENT_CSS */', () => documentCss).replace('/* APP_CSS */', () => css).replace('/* APP_SCRIPT */', () => result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')).replace('<!-- APP_LICENSES -->', () => escape(licenses.join('\n\n')));
await mkdir('dist', { recursive: true });
await writeFile('dist/index.html', html);
console.log(`dist/index.html を生成しました (${Math.round(Buffer.byteLength(html) / 1024)} KiB・${licenses.length} ライブラリ)`);
