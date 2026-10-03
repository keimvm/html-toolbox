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
// 入口ページにも各ツールと同じ配色・部品と、配色の切り替えを使う。
const themePath = new URL('../ui/theme.css', import.meta.url);
const themeTogglePath = new URL('../ui/theme-toggle.js', import.meta.url);
// 入口ページ専用の、カードの並べ替え・表示の切り替え。
const indexCardsPath = new URL('./index-cards.js', import.meta.url);
const toolboxIconPath = new URL('../ui/toolbox-icon.png', import.meta.url);

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
    for (const file of ['package.json', 'pnpm-lock.yaml', '.node-version', 'src/icon.png']) {
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

/**
 * 配布用のHTMLにトップへのリンク（ホームのアイコン）と右下の版番号を追加する。
 * リンクの見た目はツールが読み込む ui/theme.css の共通ヘッダーに従う。版番号は配色の指定（ライト・ダーク）に従う。
 */
export function decorateToolHtml(html, version) {
  const homeSlot = '<template id="toolbox-home"></template>';
  const home = html.indexOf(homeSlot);
  if (home === -1 || home !== html.lastIndexOf(homeSlot)) {
    throw new Error(`ツールのHTMLには ${homeSlot} をヘッダー内に1つだけ置いてください。`);
  }
  html = html.replace(
    homeSlot,
    '<a id="toolbox-home" class="tb-button tb-icon-button" href="../index.html" aria-label="トップへ戻る" title="トップへ戻る"></a>',
  );
  const end = html.lastIndexOf('</body>');
  if (end === -1) {
    throw new Error('ツールのHTMLに </body> がありません。');
  }
  const badge =
    '<style>#toolbox-version{all:initial;color-scheme:inherit;position:fixed;right:2px;bottom:2px;' +
    'z-index:2147483647;pointer-events:none;padding:0 5px;border-radius:3px;' +
    'background:light-dark(rgba(253,252,249,.88),rgba(23,26,24,.88));color:light-dark(#67655e,#a29e94);' +
    'box-shadow:0 0 0 1px light-dark(rgba(42,36,24,.12),rgba(255,255,255,.12));' +
    'font:10px/1.5 system-ui,sans-serif;letter-spacing:.04em}</style>' +
    `<div id="toolbox-version" aria-hidden="true">toolbox ${escapeHtml(version)}</div>`;
  return html.slice(0, end) + badge + html.slice(end);
}

/** PNG を HTML に埋め込む data URL にする。 */
export function iconDataUrl(png) {
  return `data:image/png;base64,${png.toString('base64')}`;
}

/**
 * tools の各要素は tools.json の内容に、icon（iconDataUrl の結果）を加えたもの。
 * theme は ui/theme.css、themeToggle は ui/theme-toggle.js、indexCards は scripts/index-cards.js の内容。
 * favicon は ui/toolbox-icon.png の data URL。
 */
export function renderIndex(tools, version, { theme, themeToggle, indexCards, favicon }) {
  const v = escapeHtml(version);
  const items = tools
    .map((tool) => {
      const name = escapeHtml(tool.name);
      return `      <li data-dir="${escapeHtml(tool.dir)}">
        <a class="card" href="tools/${escapeHtml(tool.dir)}.html">
          <img class="icon" src="${escapeHtml(tool.icon)}" alt="">
          <span class="name">${name}</span>
          <span class="description">${escapeHtml(tool.description)}</span>
          <span class="open" aria-hidden="true">開く</span>
        </a>
        <div class="controls">
          <label class="show"><input type="checkbox" checked aria-label="${name}を表示">表示</label>
          <button type="button" class="tb-button tb-secondary" data-move="-1" aria-label="${name}を前へ移動">前へ</button>
          <button type="button" class="tb-button tb-secondary" data-move="1" aria-label="${name}を後へ移動">後へ</button>
        </div>
      </li>`;
    })
    .join('\n');
  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>toolbox ${v}</title>
    <link rel="icon" type="image/png" href="${escapeHtml(favicon)}" />
    <style>
${theme}
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--tb-bg);
        color: var(--tb-ink);
        font: 15px/1.75 var(--tb-font);
        -webkit-font-smoothing: antialiased;
      }
      main { max-width: 1040px; margin: 0 auto; padding: clamp(40px, 8vw, 88px) 24px 64px; }
      header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; flex-wrap: wrap; }
      h1 {
        margin: 0;
        font: 400 clamp(36px, 6vw, 52px)/1.1 var(--tb-font-display);
        letter-spacing: .03em;
      }
      .lead { margin: 16px 0 0; color: var(--tb-muted); font-size: 14px; letter-spacing: .06em; }
      .lead::before {
        content: '';
        display: block;
        width: 40px;
        height: 1px;
        margin-bottom: 16px;
        background: var(--tb-gold);
      }
      .meta { display: flex; align-items: center; gap: 6px; }
      .version {
        margin: 0;
        padding: 3px 12px;
        border: 1px solid var(--tb-line);
        border-radius: 999px;
        color: var(--tb-muted);
        font-size: 12px;
        letter-spacing: .04em;
        font-variant-numeric: tabular-nums;
      }
      .version strong { color: var(--tb-ink); font-weight: 600; }
      .toolbar { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; gap: 8px 12px; margin-top: 40px; }
      .hint { margin: 0 auto 0 0; color: var(--tb-muted); font-size: 13px; }
      .toolbar .tb-button { font-size: 13px; }
      /* 共通ボタンの display が hidden 属性より優先されるため、改めて隠す。 */
      .toolbar [hidden] { display: none; }
      ul {
        list-style: none;
        margin: 16px 0 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(min(300px, 100%), 1fr));
        gap: 20px;
      }
      li { position: relative; display: flex; }
      li[hidden] { display: none; }
      .card {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        padding: 28px 28px 24px;
        border: 1px solid var(--tb-line);
        border-radius: var(--tb-radius-large);
        background: var(--tb-surface);
        color: inherit;
        text-decoration: none;
        transition: border-color var(--tb-transition), box-shadow var(--tb-transition), translate var(--tb-transition);
      }
      .card:hover {
        border-color: color-mix(in srgb, var(--tb-gold) 55%, var(--tb-line));
        box-shadow: var(--tb-elevation);
        translate: 0 -2px;
      }
      .icon { width: 48px; height: 48px; flex: none; border-radius: 12px; box-shadow: 0 2px 6px var(--tb-shadow); }
      .name {
        margin-top: 22px;
        font: 500 22px/1.4 var(--tb-font-display);
        letter-spacing: .04em;
      }
      .description { display: block; margin-top: 10px; color: var(--tb-muted); font-size: 14px; line-height: 1.85; }
      .open {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-top: auto;
        padding-top: 22px;
        color: var(--tb-accent);
        font-size: 13px;
        font-weight: 600;
        letter-spacing: .08em;
      }
      .open::after {
        content: '';
        width: 18px;
        height: 1px;
        background: currentColor;
        transition: width var(--tb-transition);
      }
      .card:hover .open::after { width: 30px; }
      /* 並べ替え・表示の編集中は、カードを開かずに「開く」の位置へ操作を出す。 */
      .controls { display: none; }
      [data-editing] li { cursor: grab; }
      [data-editing] .card { border-style: dashed; }
      [data-editing] .open { visibility: hidden; }
      [data-editing] .controls {
        position: absolute;
        right: 20px;
        bottom: 16px;
        left: 28px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .controls .tb-button { --tb-control-height: 32px; padding-block: 4px; font-size: 13px; }
      .show { display: inline-flex; align-items: center; gap: 6px; margin-right: auto; font-size: 13px; cursor: pointer; }
      .show input { width: 16px; height: 16px; margin: 0; accent-color: var(--tb-accent); }
      [data-hidden] .card > * { opacity: .4; }
      [data-dragging] { opacity: .5; }
      .empty { margin: 24px 0 0; color: var(--tb-muted); font-size: 14px; }
      @media (prefers-reduced-motion: reduce) {
        .card, .open::after { transition: none; }
        .card:hover { translate: none; }
      }
    </style>
    <script type="module">
${themeToggle}
setupThemeToggle(document.getElementById('theme-toggle'));
    </script>
    <script type="module">
${indexCards}
setupCards({
  list: document.getElementById('cards'),
  edit: document.getElementById('cards-edit'),
  reset: document.getElementById('cards-reset'),
  hint: document.getElementById('cards-hint'),
  empty: document.getElementById('cards-empty'),
});
    </script>
  </head>
  <body>
    <main>
      <header>
        <div>
          <h1>toolbox</h1>
          <p class="lead">PC の中で完結する、便利ツール集</p>
        </div>
        <div class="meta">
          <p class="version">版 <strong>${v}</strong></p>
          <button type="button" id="theme-toggle" class="tb-button tb-icon-button tb-theme-toggle"></button>
        </div>
      </header>
      <div class="toolbar">
        <p id="cards-hint" class="hint" hidden>カードをドラッグするか「前へ」「後へ」で並べ替えます。「表示」を外したツールは一覧に出ません。</p>
        <button type="button" id="cards-reset" class="tb-button" hidden>元の並びに戻す</button>
        <button type="button" id="cards-edit" class="tb-button tb-secondary">並べ替え・表示</button>
      </div>
      <ul id="cards">
${items}
      </ul>
      <p id="cards-empty" class="empty" hidden>表示するツールがありません。「並べ替え・表示」から選んでください。</p>
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
  // トップへのリンクと版番号を付けられることを通常の CI でも確かめる。
  decorateToolHtml(await readFile(source, 'utf8'), '2000.01.01');
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

  const cards = [];
  for (const tool of tools) {
    const { dir } = tool;
    const source = join(buildDir, `${dir}.html`);
    const html = await readFile(source, 'utf8').catch(() => {
      throw new Error(`build/${dir}.html がありません。先に collect を実行してください。`);
    });
    await writeFile(join(target, 'tools', `${dir}.html`), decorateToolHtml(html, version));
    const icon = await readFile(join(rootDir, 'tools', dir, 'src', 'icon.png'));
    cards.push({ ...tool, icon: iconDataUrl(icon) });
  }
  const [theme, themeToggle, indexCards, toolboxIcon] = await Promise.all([
    readFile(themePath, 'utf8'),
    readFile(themeTogglePath, 'utf8'),
    readFile(indexCardsPath, 'utf8'),
    readFile(toolboxIconPath),
  ]);
  await writeFile(join(target, 'index.html'), renderIndex(cards, version, {
    theme, themeToggle, indexCards, favicon: iconDataUrl(toolboxIcon),
  }));

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
