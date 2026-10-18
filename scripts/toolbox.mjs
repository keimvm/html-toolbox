// toolbox のテスト・ビルド・総合検証・zip 作成。Node.js の標準機能と OS の zip コマンドだけを使う。
//
//   node scripts/toolbox.mjs test               依存取得とソースのテスト（ビルドなし）
//   node scripts/toolbox.mjs build <版>          版を付けてビルドし、zip を作る（テスト・lint なし）
//   node scripts/toolbox.mjs check              依存取得・整形・lint・テスト・ビルド・配布物のテスト
//   node scripts/toolbox.mjs release <版>        check のあと、版を付けてビルドし、zip を作る
//   node scripts/toolbox.mjs check-version <版> 版番号の形式を検査
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** YYYY.MM.DD または YYYY.MM.DD.N（N は2以上）で、実在する日付か。 */
export function isValidVersion(version) {
  const match = /^(\d{4})\.(\d{2})\.(\d{2})(?:\.([2-9]|[1-9]\d+))?$/.exec(version);
  if (!match) return false;
  const [year, month, day] = match.slice(1, 4).map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

export function assertVersion(version) {
  if (!isValidVersion(version ?? '')) {
    throw new Error(
      `版番号「${version ?? ''}」は日付形式ではありません。YYYY.MM.DD（同じ日の2回目以降は YYYY.MM.DD.2 など）にしてください。`,
    );
  }
}

/** ビルドした HTML が、指定の版で作られた1つのファイルか。 */
export function assertDistribution(html, version) {
  if (!html.includes('http-equiv="Content-Security-Policy"'))
    throw new Error('配布物に通信を止める CSP がありません。');
  // 縮めた JavaScript は文字列をバッククォートで書くことがあるため、引用符の種類を問わない。
  const literal = new RegExp(`[\`'"]${version.replaceAll('.', '\\.')}[\`'"]`);
  if (!literal.test(html))
    throw new Error(
      `配布物に版「${version}」が埋め込まれていません。版を付けてビルドし直してください。`,
    );
  for (const name of ['pdfium', 'font-jp'])
    if (!html.includes(`id="tb-payload-${name}"`))
      throw new Error(`配布物に PDF の処理に必要なデータ（${name}）がありません。`);
}

function run(command, args, { env } = {}) {
  // Windows の pnpm.cmd は cmd.exe 経由で呼ぶ。引数は下の固定コマンドだけ。
  const windows = process.platform === 'win32' && command === 'pnpm';
  execFileSync(
    windows ? 'cmd.exe' : command,
    windows ? ['/d', '/s', '/c', command, ...args] : args,
    {
      cwd: root,
      stdio: 'inherit',
      env: { ...process.env, ...env },
    },
  );
}

const install = () => run('pnpm', ['install', '--frozen-lockfile']);

async function buildVersion(version) {
  assertVersion(version);
  await rm(join(root, 'dist'), { recursive: true, force: true });
  run('pnpm', ['build'], { env: { TOOLBOX_VERSION: version } });
}

/** dist/index.html を out/toolbox-<版>/index.html に置き、out/toolbox-<版>.zip にまとめる。 */
export async function packageRelease(version, rootDir = root) {
  assertVersion(version);
  const source = join(rootDir, 'dist', 'index.html');
  const html = await readFile(source, 'utf8').catch(() => {
    throw new Error('dist/index.html がありません。先にビルドしてください。');
  });
  assertDistribution(html, version);
  const outDir = join(rootDir, 'out');
  const name = `toolbox-${version}`;
  const target = join(outDir, name);
  // 途中で失敗しても、同じ版の古い zip を残さない。
  await rm(target, { recursive: true, force: true });
  await rm(`${target}.zip`, { force: true });
  await mkdir(target, { recursive: true });
  await writeFile(join(target, 'index.html'), html);
  // -X で OS 固有の拡張属性を入れない。中の名前は英数字だけなので文字コードの問題は起きない。
  execFileSync('zip', ['-qrX', `${name}.zip`, name], { cwd: outDir, stdio: 'inherit' });
  const { size } = await stat(`${target}.zip`);
  console.log(`out/${name}.zip（${(size / 1e6).toFixed(1)} MB）`);
}

async function main([command, arg, ...extra]) {
  if (extra.length) throw new Error('引数が多すぎます。');
  switch (command) {
    case 'check-version':
      assertVersion(arg);
      break;
    case 'test':
      install();
      run('pnpm', ['test']);
      break;
    case 'check':
      install();
      run('pnpm', ['check']);
      break;
    case 'build':
      assertVersion(arg);
      install();
      await buildVersion(arg);
      await packageRelease(arg);
      break;
    case 'release':
      assertVersion(arg);
      install();
      run('pnpm', ['check']);
      await buildVersion(arg);
      await packageRelease(arg);
      break;
    default:
      throw new Error(
        '使い方: node scripts/toolbox.mjs <test|build|check|release|check-version> [版]',
      );
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`エラー: ${error.message}`);
    process.exit(1);
  });
}
