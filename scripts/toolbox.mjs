// toolbox の一覧読み込み・ビルド済みHTMLの収集・zip の作成を行う。
//
//   node scripts/toolbox.mjs list               tools.json のフォルダ名をJSON配列で出力
//   node scripts/toolbox.mjs check [フォルダ名]  依存取得・検査・ビルド・収集（省略時は全ツール）
//   node scripts/toolbox.mjs release <版>        全ツールを check して zip を作る
//   node scripts/toolbox.mjs check-version <版> 版番号の形式を検査
//   node scripts/toolbox.mjs collect <フォルダ名> tools/<名>/dist の HTML を build/<名>.html へ集める
//   node scripts/toolbox.mjs package <版>       build/ から out/toolbox-<版>/ と out/toolbox-<版>.zip を作る
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const DIR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.-]*$/;

/** tools.json の内容を検査し、そのまま返す。 */
export function validateTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error('tools.json はツールを1つ以上含む配列にしてください。');
  }
  const seen = new Set();
  for (const [i, tool] of tools.entries()) {
    const where = `tools.json の${i + 1}番目`;
    if (typeof tool !== 'object' || tool === null) {
      throw new Error(`${where}がオブジェクトではありません。`);
    }
    if (typeof tool.dir !== 'string' || !DIR_PATTERN.test(tool.dir)) {
      throw new Error(`${where}の dir は英数字・-・. だけで書いてください。`);
    }
    for (const key of ['name', 'description']) {
      if (typeof tool[key] !== 'string' || tool[key].trim() === '') {
        throw new Error(`${where}（${tool.dir}）の ${key} が空です。`);
      }
    }
    if (seen.has(tool.dir)) {
      throw new Error(`tools.json に ${tool.dir} が重複しています。`);
    }
    seen.add(tool.dir);
  }
  return tools;
}

export async function readTools(rootDir = root) {
  const tools = validateTools(JSON.parse(await readFile(join(rootDir, 'tools.json'), 'utf8')));
  for (const { dir } of tools) {
    const toolDir = join(rootDir, 'tools', dir);
    for (const file of ['package.json', 'pnpm-lock.yaml', '.node-version']) {
      const info = await stat(join(toolDir, file)).catch(() => null);
      if (!info?.isFile()) {
        throw new Error(`tools/${dir}/${file} がありません。`);
      }
    }
    const pkg = JSON.parse(await readFile(join(toolDir, 'package.json'), 'utf8'));
    if (!/^pnpm@\d+\.\d+\.\d+(?:\+.+)?$/.test(pkg.packageManager ?? '')) {
      throw new Error(
        `tools/${dir}/package.json の packageManager に pnpm の版を固定してください。`,
      );
    }
    if (typeof pkg.scripts?.check !== 'string' || !pkg.scripts.check.trim()) {
      throw new Error(`tools/${dir}/package.json に scripts.check が必要です。`);
    }
    const nodeVersion = (await readFile(join(toolDir, '.node-version'), 'utf8')).trim();
    if (!/^\d+\.\d+\.\d+$/.test(nodeVersion)) {
      throw new Error(
        `tools/${dir}/.node-version に Node.js の版を x.y.z 形式で固定してください。`,
      );
    }
  }
  return tools;
}

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

function assertVersion(version) {
  if (!isValidVersion(version ?? '')) {
    throw new Error(
      `版番号「${version ?? ''}」は日付形式ではありません。YYYY.MM.DD（同じ日の2回目以降は YYYY.MM.DD.2 など）にしてください。`,
    );
  }
}

export function escapeHtml(text) {
  return text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

/** ツールの画面の右下に版番号を表示する要素を、</body> の直前に書き足す。 */
export function addVersionBadge(html, version) {
  const end = html.lastIndexOf('</body>');
  if (end === -1) {
    throw new Error('ツールのHTMLに </body> がありません。');
  }
  const badge =
    '<style>#toolbox-version{all:initial;position:fixed;right:2px;bottom:2px;z-index:2147483647;' +
    'pointer-events:none;padding:0 5px;border-radius:3px;background:rgba(255,255,255,.85);' +
    'color:#555;box-shadow:0 0 0 1px rgba(0,0,0,.12);font:10px/1.5 system-ui,sans-serif}</style>' +
    `<div id="toolbox-version" aria-hidden="true">toolbox ${escapeHtml(version)}</div>`;
  return html.slice(0, end) + badge + html.slice(end);
}

export function renderIndex(tools, version) {
  const v = escapeHtml(version);
  const items = tools
    .map(
      (tool) => `      <li>
        <a href="tools/${escapeHtml(tool.dir)}.html">
          <span class="name">${escapeHtml(tool.name)}</span>
          <span class="description">${escapeHtml(tool.description)}</span>
        </a>
      </li>`,
    )
    .join('\n');
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>toolbox ${v}</title>
    <style>
      :root {
        color-scheme: light dark;
        --bg: #f6f7f5;
        --card: #ffffff;
        --text: #1f2a24;
        --muted: #5b665f;
        --border: #d9dfda;
        --accent: #355b49;
        --notice-bg: #fff6dc;
        --notice-border: #e7cf85;
      }
      @media (prefers-color-scheme: dark) {
        :root {
          --bg: #161a18;
          --card: #1f2522;
          --text: #e7ece9;
          --muted: #a5b0aa;
          --border: #34403a;
          --accent: #8cc3a7;
          --notice-bg: #33301f;
          --notice-border: #6b5d2b;
        }
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font: 15px/1.7 system-ui, -apple-system, "Segoe UI", "Hiragino Sans", "Yu Gothic UI", "Meiryo", sans-serif;
      }
      main { max-width: 760px; margin: 0 auto; padding: 32px 16px 48px; }
      header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
      h1 { margin: 0; font-size: 26px; letter-spacing: .02em; }
      .version { color: var(--muted); font-size: 14px; font-variant-numeric: tabular-nums; }
      .version strong { color: var(--text); }
      .notice {
        margin: 20px 0 24px;
        padding: 10px 14px;
        border: 1px solid var(--notice-border);
        border-radius: 8px;
        background: var(--notice-bg);
      }
      ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
      li a {
        display: block;
        padding: 16px 18px;
        border: 1px solid var(--border);
        border-radius: 10px;
        background: var(--card);
        color: inherit;
        text-decoration: none;
      }
      li a:hover { border-color: var(--accent); }
      li a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .name { display: block; color: var(--accent); font-weight: 700; font-size: 17px; }
      .description { display: block; color: var(--muted); }
    </style>
  </head>
  <body>
    <main>
      <header>
        <h1>toolbox</h1>
        <p class="version">版 <strong>${v}</strong></p>
      </header>
      <p class="notice">Chrome または Edge で開いてください。Safari では正しく動かない場合があります。</p>
      <ul>
${items}
      </ul>
    </main>
  </body>
</html>
`;
}

export async function collect(dir, rootDir = root) {
  const tools = await readTools(rootDir);
  if (!tools.some((tool) => tool.dir === dir)) {
    throw new Error(`${dir} は tools.json にありません。`);
  }
  const buildDir = join(rootDir, 'build');
  // 収集に失敗したとき、以前の成功結果を次の package で使わない。
  await rm(join(buildDir, `${dir}.html`), { force: true });
  const dist = join(rootDir, 'tools', dir, 'dist');
  const entries = await readdir(dist, { withFileTypes: true }).catch(() => []);
  if (entries.length !== 1 || !entries[0].isFile() || !entries[0].name.endsWith('.html')) {
    throw new Error(
      `tools/${dir}/dist/ は HTML 1ファイルだけにしてください。別ファイルやフォルダは zip に含められません。`,
    );
  }
  const source = join(dist, entries[0].name);
  // 版番号を付けられることを通常の CI でも確かめる。
  addVersionBadge(await readFile(source, 'utf8'), '2000.01.01');
  await mkdir(buildDir, { recursive: true });
  await copyFile(source, join(buildDir, `${dir}.html`));
  console.log(`tools/${dir}/dist/${entries[0].name} → build/${dir}.html`);
}

export async function packageRelease(version, rootDir = root) {
  assertVersion(version);
  const tools = await readTools(rootDir);
  const buildDir = join(rootDir, 'build');
  const outDir = join(rootDir, 'out');
  const name = `toolbox-${version}`;
  const target = join(outDir, name);
  await rm(target, { recursive: true, force: true });
  await rm(`${target}.zip`, { force: true });
  await mkdir(join(target, 'tools'), { recursive: true });

  for (const { dir } of tools) {
    const source = join(buildDir, `${dir}.html`);
    const html = await readFile(source, 'utf8').catch(() => {
      throw new Error(`build/${dir}.html がありません。先に collect を実行してください。`);
    });
    await writeFile(join(target, 'tools', `${dir}.html`), addVersionBadge(html, version));
  }
  await writeFile(join(target, 'index.html'), renderIndex(tools, version));

  // -X でOS固有の拡張属性を入れない。中の名前は英数字だけなので文字コードの問題は起きない。
  execFileSync('zip', ['-qrX', `${name}.zip`, name], { cwd: outDir, stdio: 'inherit' });
  console.log(`out/${name}.zip`);
}

function runPnpm(args, cwd) {
  // Windows の pnpm.cmd は cmd.exe 経由で呼ぶ。引数は下の固定コマンドだけ。
  const command = process.platform === 'win32' ? 'cmd.exe' : 'pnpm';
  const commandArgs = process.platform === 'win32' ? ['/d', '/s', '/c', 'pnpm', ...args] : args;
  execFileSync(command, commandArgs, { cwd, stdio: 'inherit' });
}

export async function checkTools(dir, rootDir = root, run = runPnpm) {
  const tools = await readTools(rootDir);
  const selected = dir ? tools.filter((tool) => tool.dir === dir) : tools;
  if (selected.length === 0) throw new Error(`${dir} は tools.json にありません。`);
  for (const tool of selected) {
    await rm(join(rootDir, 'build', `${tool.dir}.html`), { force: true });
  }
  for (const tool of selected) {
    const cwd = join(rootDir, 'tools', tool.dir);
    console.log(`\n${tool.dir}: 依存取得・検査・ビルド`);
    await rm(join(cwd, 'dist'), { recursive: true, force: true });
    await run(['install', '--frozen-lockfile'], cwd);
    await run(['check'], cwd);
    await collect(tool.dir, rootDir);
  }
}

export async function release(version, rootDir = root, run = runPnpm) {
  assertVersion(version);
  await rm(join(rootDir, 'build'), { recursive: true, force: true });
  const target = join(rootDir, 'out', `toolbox-${version}`);
  await rm(target, { recursive: true, force: true });
  await rm(`${target}.zip`, { force: true });
  await checkTools(undefined, rootDir, run);
  await packageRelease(version, rootDir);
}

async function main([command, arg, ...extra]) {
  if (extra.length || (command === 'list' && arg)) throw new Error('引数が多すぎます。');
  switch (command) {
    case 'list':
      console.log(JSON.stringify((await readTools()).map((tool) => tool.dir)));
      break;
    case 'check-version':
      assertVersion(arg);
      break;
    case 'check':
      await checkTools(arg);
      break;
    case 'release':
      await release(arg);
      break;
    case 'collect':
      await collect(arg);
      break;
    case 'package':
      await packageRelease(arg);
      break;
    default:
      throw new Error(
        '使い方: node scripts/toolbox.mjs <list|check|release|check-version|collect|package> [引数]',
      );
  }
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`エラー: ${error.message}`);
    process.exit(1);
  });
}
