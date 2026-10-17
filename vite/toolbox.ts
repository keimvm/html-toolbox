// toolbox を1つの HTML にまとめる Vite のプラグイン。
//
// - 重いバイナリ（PDFium の WebAssembly と日本語フォント）は JavaScript に入れず、gzip と Base64 にして
//   HTML の末尾に「実行しない script 要素」として置く。画面の準備を待たせず、使うときにだけ展開する。
// - 配布物に入ったパッケージのライセンス文を集め、同じく HTML の末尾に置く（「このアプリについて」で表示）。
// - 外部と通信させない CSP を付ける。
// - 開発サーバーでは、同じ仮想モジュールがファイルの URL と依存関係のライセンスを返す。
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { Plugin } from 'vite';

/** HTML の末尾に置くバイナリ。名前は src/engine/pdf/payload.ts と合わせる。 */
const PAYLOADS = {
  pdfium: ['@embedpdf/pdfium', 'dist/pdfium.wasm'],
  'font-jp': ['@embedpdf/fonts-jp', 'fonts/NotoSansJP-Regular.otf'],
} as const;

/**
 * 配布物に入れる CSP。外部への通信と、外部のスクリプト・スタイル・フォントの読み込みをすべて禁止する。
 * Worker は blob: から作り、PDFium の WebAssembly は 'wasm-unsafe-eval' でだけ動かす。
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'unsafe-inline' 'wasm-unsafe-eval'",
  'worker-src blob:',
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src blob:',
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const PAYLOAD_MODULE = 'virtual:toolbox/payload';
const LICENSE_MODULE = 'virtual:toolbox/licenses';
const resolved = (id: string) => `\0${id}`;

function packageDir(root: string, name: string) {
  const dir = join(root, 'node_modules', ...name.split('/'));
  if (!existsSync(join(dir, 'package.json')))
    throw new Error(`${name} が見つかりません。pnpm install を実行してください。`);
  return dir;
}

/** モジュールのパスから、それを含むパッケージのフォルダと名前・版を求める。 */
function packageOf(file: string): { dir: string; id: string } | undefined {
  const marker = `${sep}node_modules${sep}`;
  const at = file.lastIndexOf(marker);
  if (at < 0) return undefined;
  // パッケージの中の package.json（preact/jsx-runtime など）ではなく、node_modules の直下を見る。
  const parts = file.slice(at + marker.length).split(sep);
  const depth = parts[0]?.startsWith('@') ? 2 : 1;
  const dir = file.slice(0, at + marker.length) + parts.slice(0, depth).join(sep);
  const meta = join(dir, 'package.json');
  if (!existsSync(meta)) return undefined;
  const pkg = JSON.parse(readFileSync(meta, 'utf8')) as { name?: string; version?: string };
  return pkg.name && pkg.version ? { dir, id: `${pkg.name} ${pkg.version}` } : undefined;
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)(\.|-|$)/i;

function licenseText(dir: string, id: string) {
  const files = readdirSync(dir)
    .filter((name) => LICENSE_FILE.test(name))
    .sort();
  if (!files.length) throw new Error(`${id} のライセンス文が見つかりません。`);
  return files.map((name) => readFileSync(join(dir, name), 'utf8').trim());
}

function renderLicenses(packages: Map<string, string>) {
  return [...packages]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, dir]) => [id, '', ...licenseText(dir, id)].join('\n'))
    .join('\n\n────────\n\n');
}

/** 開発サーバー用。dependencies とその依存をたどる（配布物より多めに並ぶ）。 */
function dependencyPackages(root: string) {
  const packages = new Map<string, string>();
  const visit = (name: string, from: string) => {
    let dir: string | undefined;
    for (let base = from; !dir; base = dirname(base)) {
      const candidate = join(base, 'node_modules', ...name.split('/'));
      // pnpm の依存は、実体のフォルダの隣にある。
      if (existsSync(join(candidate, 'package.json'))) dir = realpathSync(candidate);
      else if (dirname(base) === base) return;
    }
    const info = packageOf(join(dir, 'package.json'));
    if (!info || packages.has(info.id)) return;
    packages.set(info.id, info.dir);
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    for (const dependency of Object.keys(pkg.dependencies ?? {})) visit(dependency, dir);
  };
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    dependencies: Record<string, string>;
  };
  for (const name of Object.keys(pkg.dependencies)) visit(name, root);
  return packages;
}

const escapeText = (text: string) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;');

export function toolbox({ root }: { root: string }): Plugin[] {
  let command: 'build' | 'serve' = 'serve';
  /** 本体と Worker の両方の、配布物に入ったパッケージ。 */
  const bundled = new Map<string, string>();
  const collect = (ids: Iterable<string>) => {
    for (const id of ids) {
      const info = packageOf(resolve(id.replace(/^\0/, '')));
      if (info) bundled.set(info.id, info.dir);
    }
  };

  const shared: Plugin = {
    name: 'toolbox:collect-licenses',
    apply: 'build',
    generateBundle() {
      collect(this.getModuleIds());
    },
  };

  const main: Plugin = {
    name: 'toolbox:single-file',
    enforce: 'post',
    configResolved(config) {
      command = config.command;
    },
    resolveId(id) {
      if (id === PAYLOAD_MODULE || id === LICENSE_MODULE) return resolved(id);
      return undefined;
    },
    load(id) {
      if (id === resolved(PAYLOAD_MODULE)) {
        if (command === 'build')
          return `export function payloadSource(name) {
  const element = document.getElementById('tb-payload-' + name);
  if (!element) throw new Error('PDFの処理に必要なデータが見つかりません。配布された HTML を開き直してください。');
  return { kind: 'gzip-base64', text: element.textContent };
}`;
        const urls = Object.fromEntries(
          Object.entries(PAYLOADS).map(([name, [pkg, file]]) => [
            name,
            `/@fs${join(packageDir(root, pkg), file)}`,
          ]),
        );
        return `const urls = ${JSON.stringify(urls)};
export function payloadSource(name) {
  return { kind: 'url', url: new URL(urls[name], location.href).href };
}`;
      }
      if (id === resolved(LICENSE_MODULE)) {
        if (command === 'build')
          return `export function licenses() {
  return document.getElementById('tb-licenses')?.textContent ?? '';
}`;
        const text = renderLicenses(dependencyPackages(root));
        return `export function licenses() { return ${JSON.stringify(text)}; }`;
      }
      return undefined;
    },
    generateBundle(_options, bundle) {
      collect(this.getModuleIds());
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset' || typeof html.source !== 'string')
        this.error('配布用の HTML が作られませんでした。');
      const rest = Object.keys(bundle).filter((name) => name !== 'index.html');
      if (rest.length)
        this.error(`HTML に埋め込まれなかったファイルがあります: ${rest.join(', ')}`);

      // 埋め込んだバイナリのパッケージもライセンスに含める。
      const payloads = Object.entries(PAYLOADS).map(([name, [pkg, file]]) => {
        const dir = packageDir(root, pkg);
        const info = packageOf(join(dir, 'package.json'))!;
        bundled.set(info.id, info.dir);
        const data = gzipSync(readFileSync(join(dir, file)), { level: 9 });
        return `<script type="application/octet-stream" id="tb-payload-${name}" data-encoding="gzip-base64">${data.toString('base64')}</script>`;
      });
      const licenses = `<script type="text/plain" id="tb-licenses">${escapeText(renderLicenses(bundled))}</script>`;

      let source = html.source;
      // 本体の script を、画面の要素の後・重いデータの前で実行する普通の script にする。
      // module の script は文書を最後まで読むまで待つため、末尾の重いデータを読む間も画面が出なくなる。
      const scripts = [...source.matchAll(/<script\b[^>]*>[\s\S]*?<\/script>/g)];
      if (scripts.length !== 1)
        this.error(`本体の script が1つではありません（${scripts.length}個）。`);
      const [tag] = scripts[0]!;
      const code = tag.replace(/^<script\b[^>]*>/, '').replace(/<\/script>$/, '');
      source = source.replace(tag, '');
      const end = source.lastIndexOf('</body>');
      if (end < 0) this.error('HTML に </body> がありません。');
      source =
        source.slice(0, end) +
        `<script>${code}</script>\n` +
        payloads.join('\n') +
        '\n' +
        licenses +
        '\n' +
        source.slice(end);
      source = source.replace(
        /<head>/,
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
      );
      html.source = source;
    },
  };
  return [shared, main];
}

/**
 * @embedpdf/pdfium は wasm を渡さなかったときの予備として `new URL('pdfium.wasm', import.meta.url)` を持つ。
 * Vite はこれを見て wasm を Base64 で JavaScript に埋め込むため、末尾の埋め込みと二重になる。
 * toolbox は常に wasm のバイト列を渡すので、この URL を使わない文字列に置き換える。
 */
export function dropPdfiumUrl(): Plugin {
  const pattern = "new URL('pdfium.wasm', import.meta.url).href";
  return {
    name: 'toolbox:drop-pdfium-url',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes(`${sep}@embedpdf${sep}pdfium${sep}`) || !code.includes(pattern))
        return undefined;
      return { code: code.replaceAll(pattern, "'pdfium.wasm'"), map: null };
    },
  };
}

/** Worker の別ビルドでもライセンスを集めるための、同じ収集処理。 */
export function workerLicenseCollector(plugins: Plugin[]): Plugin {
  const collector = plugins.find((plugin) => plugin.name === 'toolbox:collect-licenses');
  if (!collector) throw new Error('ライセンスの収集処理が見つかりません。');
  return collector;
}
