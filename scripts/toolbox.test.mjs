import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  decorateToolHtml,
  build,
  checkTools as runCheckTools,
  collect,
  iconDataUrl,
  isValidVersion,
  packageRelease,
  readTools,
  release as runRelease,
  testTools,
  renderIndex,
  validateTools,
} from './toolbox.mjs';

// テスト内では共通テストの再帰実行を避け、子プロセスの境界だけを差し替える。
const skipShared = () => {};
const checkTools = (dir, root, run) => runCheckTools(dir, root, run, skipShared);
const release = (version, root, run) => runRelease(version, root, run, skipShared);

test('版番号は日付形式と同じ日の連番だけを受け付ける', () => {
  for (const version of ['2026.09.26', '2026.09.26.2', '2026.09.26.10', '2024.02.29']) {
    assert.equal(isValidVersion(version), true, version);
  }
  for (const version of [
    'v2026.09.26',
    '2026.9.26',
    '2026.09.26.1',
    '2026.09.26.02',
    '2026.13.01',
    '2026.02.30',
    '2025.02.29',
    '2026.09.26-rc',
    '',
  ]) {
    assert.equal(isValidVersion(version), false, version);
  }
});

test('tools.json の不正な内容を拒否する', () => {
  const ok = { dir: 'pdf-edit', name: 'PDF編集', description: '説明' };
  assert.deepEqual(validateTools([ok]), [ok]);
  assert.throws(() => validateTools([]));
  assert.throws(() => validateTools({ tools: [ok] }));
  assert.throws(() => validateTools([{ ...ok, dir: 'PDF編集' }]));
  assert.throws(() => validateTools([{ ...ok, dir: '../x' }]));
  assert.throws(() => validateTools([{ ...ok, name: ' ' }]));
  assert.throws(() => validateTools([{ ...ok, description: undefined }]));
  assert.throws(() => validateTools([ok, ok]));
});

test('リポジトリの tools.json は有効で、各フォルダがある', async () => {
  const tools = await readTools();
  assert.ok(tools.length > 0);
});

const homeSlot = '<template id="toolbox-home"></template>';
const toolHtml = (text) => `<html><body><header>${homeSlot}<h1>${text}</h1></header></body></html>`;

const homeLink =
  '<a id="toolbox-home" class="tb-button tb-icon-button" href="../index.html" aria-label="トップへ戻る" title="トップへ戻る"></a>';

const fixtureIcon = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=',
  'base64',
);

test('トップへのリンクは指定位置に入り、版番号は最後の </body> の直前に入る', () => {
  const html = toolHtml('PDF編集').replace('</header>', '</header><script>"</body>"</script><p>x</p>');
  const result = decorateToolHtml(html, '2026.09.26');
  // 文言は表示せず、アイコン（ui/theme.css）と読み上げ名・ツールチップだけにする。
  assert.ok(result.includes(`<header>${homeLink}<h1>PDF編集</h1>`));
  assert.ok(result.includes('<script>"</body>"</script><p>x</p><style>'));
  assert.ok(result.endsWith('>toolbox 2026.09.26</div></body></html>'));
  assert.equal(result.includes(homeSlot), false);
  assert.equal(/\b(?:target|onclick)=/.test(result), false);
  assert.equal(/\b(?:src|href)="(?:https?:)?\/\//.test(result), false);
  assert.ok(html.includes(homeSlot));
  assert.equal(html.includes('href="../index.html"'), false);
});

test('配布加工はトップへのリンクの挿入位置の不足・重複と body の閉じ忘れを拒否する', () => {
  for (const html of [
    toolHtml('x').replace(homeSlot, ''),
    toolHtml('x').replace(homeSlot, homeSlot.repeat(2)),
  ]) {
    assert.throws(() => decorateToolHtml(html, '2026.09.26'), /toolbox-home/);
  }
  assert.throws(
    () => decorateToolHtml(toolHtml('x').replace('</body>', ''), '2026.09.26'),
    /<\/body>/,
  );
});

test('入口ページにカードの一覧・版番号と共通の配色・切り替えが入り、外部を読み込まない', async () => {
  const theme = await readFile(new URL('../ui/theme.css', import.meta.url), 'utf8');
  const themeToggle = await readFile(new URL('../ui/theme-toggle.js', import.meta.url), 'utf8');
  const indexCards = await readFile(new URL('./index-cards.js', import.meta.url), 'utf8');
  const icon = iconDataUrl(fixtureIcon);
  assert.equal(icon.startsWith('data:image/png;base64,'), true);
  assert.deepEqual(Buffer.from(icon.split(',')[1], 'base64'), fixtureIcon);
  const html = renderIndex(
    [
      { dir: 'a-tool', name: '<ツールA>', description: '説明 & 注意', icon },
      { dir: 'b.tool', name: 'ツールB', description: '説明B', icon },
    ],
    '2026.09.26.2',
    { theme, themeToggle, indexCards, favicon: icon },
  );
  assert.ok(html.includes(theme));
  assert.ok(html.includes(themeToggle));
  assert.ok(html.includes('class="tb-button tb-icon-button tb-theme-toggle"'));
  assert.ok(html.includes('<strong>2026.09.26.2</strong>'));
  assert.ok(html.includes('<a class="card" href="tools/a-tool.html">'));
  assert.ok(html.includes(indexCards));
  assert.ok(html.includes('<ul id="cards">'));
  assert.ok(html.includes('<li data-dir="b.tool">'));
  assert.ok(html.includes('aria-label="&lt;ツールA&gt;を前へ移動"'));
  assert.equal(html.match(/data-move="1" aria-label/g).length, 2);
  assert.ok(html.includes(`<img class="icon" src="${icon.replaceAll("'", '&#39;')}" alt="">`));
  assert.ok(html.includes('&lt;ツールA&gt;'));
  assert.ok(html.includes('説明 &amp; 注意'));
  assert.ok(html.indexOf('a-tool') < html.indexOf('b.tool'), 'tools.json の順に並ぶ');
  assert.equal(/\b(?:src|href)="(?:https?:)?\/\//.test(html), false);
  assert.equal(html.match(/<script\b[^>]*>/g).join(), '<script type="module">,<script type="module">');
});

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'toolbox-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tools = ['alpha', 'beta'].map((dir) => ({ dir, name: dir, description: '説明' }));
  await writeFile(join(root, 'tools.json'), JSON.stringify(tools));
  for (const { dir } of tools) {
    const cwd = join(root, 'tools', dir);
    await mkdir(join(cwd, 'dist'), { recursive: true });
    await writeFile(
      join(cwd, 'package.json'),
      JSON.stringify({
        packageManager: 'pnpm@12.4.2',
        scripts: {
          test: 'node test.mjs',
          'test:dist': 'node dist-test.mjs',
          build: 'node build.mjs',
          check: 'node check.mjs',
        },
      }),
    );
    await writeFile(join(cwd, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
    await writeFile(join(cwd, '.node-version'), '24.21.0\n');
    await mkdir(join(cwd, 'src'));
    await writeFile(join(cwd, 'src', 'icon.png'), fixtureIcon);
    await writeFile(join(cwd, 'dist', '配布.html'), toolHtml(dir));
  }
  return root;
}

test('ツールの設定漏れは依存取得の前に検出する', async (t) => {
  const root = await fixture(t);
  const cwd = join(root, 'tools', 'alpha');
  const file = join(cwd, 'package.json');
  const original = await readFile(file, 'utf8');
  for (const patch of [{ packageManager: 'npm@12.4.2' }, { scripts: {} }]) {
    await writeFile(file, JSON.stringify({ ...JSON.parse(original), ...patch }));
    await assert.rejects(readTools(root), /package.json/);
  }
  await writeFile(file, original);
  await writeFile(join(cwd, '.node-version'), 'lts/*');
  await assert.rejects(readTools(root), /Node.js/);
  await writeFile(join(cwd, '.node-version'), '24.21.0');
  await rm(join(cwd, 'src', 'icon.png'));
  await assert.rejects(readTools(root), /icon.png/);
  await rm(join(cwd, 'pnpm-lock.yaml'));
  await assert.rejects(readTools(root), /pnpm-lock.yaml/);
});

test('収集は単一 HTML 以外や配布加工できない出力を拒否し、古い収集結果を消す', async (t) => {
  const root = await fixture(t);
  const dist = join(root, 'tools', 'alpha', 'dist');
  await assert.rejects(collect('unknown', root), /tools.json/);
  for (const invalid of [
    'extra.js', 'second.html', 'directory.html', 'missing-body',
    'missing-home', 'duplicate-home', 'empty',
  ]) {
    await rm(dist, { recursive: true, force: true });
    await mkdir(dist);
    await mkdir(join(root, 'build'), { recursive: true });
    await writeFile(join(root, 'build', 'alpha.html'), '古い出力');
    if (invalid === 'missing-body') {
      await writeFile(join(dist, 'index.html'), toolHtml('最新').replace('</body>', ''));
    } else if (invalid === 'missing-home') {
      await writeFile(join(dist, 'index.html'), toolHtml('最新').replace(homeSlot, ''));
    } else if (invalid === 'duplicate-home') {
      await writeFile(
        join(dist, 'index.html'),
        toolHtml('最新').replace(homeSlot, homeSlot.repeat(2)),
      );
    } else if (invalid === 'directory.html') {
      await mkdir(join(dist, invalid));
    } else if (invalid !== 'empty') {
      await writeFile(join(dist, 'index.html'), toolHtml('最新'));
      await writeFile(join(dist, invalid), '');
    }
    await assert.rejects(collect('alpha', root), /HTML/);
    await assert.rejects(access(join(root, 'build', 'alpha.html')));
  }
});

test('check は指定ツールだけを取得・検証し、作り直した HTML を収集する', async (t) => {
  const root = await fixture(t);
  const calls = [];
  await checkTools('beta', root, async (args, cwd) => {
    calls.push([basename(cwd), args]);
    if (args[0] === 'check') {
      await assert.rejects(access(join(cwd, 'dist')));
      await mkdir(join(cwd, 'dist'));
      await writeFile(join(cwd, 'dist', '最新.html'), toolHtml('最新'));
    }
  });
  assert.deepEqual(calls, [
    ['beta', ['install', '--frozen-lockfile']],
    ['beta', ['check']],
  ]);
  assert.deepEqual(await readdir(join(root, 'build')), ['beta.html']);
  assert.equal(await readFile(join(root, 'build', 'beta.html'), 'utf8'), toolHtml('最新'));
  await assert.rejects(checkTools('unknown', root), /tools.json/);
});

test('test は dist なしで指定または全ツールのソースだけを検証し、配布物を変更しない', async (t) => {
  const root = await fixture(t);
  for (const dir of ['alpha', 'beta']) {
    await rm(join(root, 'tools', dir, 'dist'), { recursive: true });
  }
  await mkdir(join(root, 'build'));
  await writeFile(join(root, 'build', 'alpha.html'), '前回の収集物');
  await mkdir(join(root, 'out'));
  await writeFile(join(root, 'out', 'toolbox-2026.10.03.zip'), '前回の zip');
  for (const [dir, names] of [['beta', ['beta']], [undefined, ['alpha', 'beta']]]) {
    const calls = [];
    await testTools(dir, root, async (args, cwd) => {
      calls.push([basename(cwd), args]);
      await assert.rejects(access(join(cwd, 'dist')));
    }, (cwd) => {
      assert.equal(cwd, root);
      calls.push('shared');
    });
    assert.deepEqual(calls, ['shared', ...names.flatMap((name) => [
      [name, ['install', '--frozen-lockfile']], [name, ['test']],
    ])]);
  }
  assert.equal(await readFile(join(root, 'build', 'alpha.html'), 'utf8'), '前回の収集物');
  assert.equal(await readFile(join(root, 'out', 'toolbox-2026.10.03.zip'), 'utf8'), '前回の zip');
  assert.deepEqual((await readdir(join(root, 'tools', 'alpha'))).sort(), [
    '.node-version', 'package.json', 'pnpm-lock.yaml', 'src',
  ]);
});

test('不明なツール名では共通テストも依存取得も始めない', async (t) => {
  const root = await fixture(t);
  const unexpected = () => assert.fail('子プロセスを実行してはいけない');
  for (const command of [testTools, runCheckTools]) {
    await assert.rejects(command('unknown', root, unexpected, unexpected), /tools.json/);
  }
});

test('ソースのテスト失敗は後続ツールを止め、ビルドに進まない', async (t) => {
  const root = await fixture(t);
  const calls = [];
  await assert.rejects(testTools(undefined, root, (args, cwd) => {
    calls.push([basename(cwd), args[0]]);
    if (args[0] === 'test') throw new Error('ソースのテスト失敗');
  }, skipShared), /ソースのテスト失敗/);
  assert.deepEqual(calls, [['alpha', 'install'], ['alpha', 'test']]);
  assert.equal(await readFile(join(root, 'tools', 'alpha', 'dist', '配布.html'), 'utf8'), toolHtml('alpha'));
});

test('release は共通テストに失敗しても同じ版の古い zip を残さない', async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, 'out'));
  const zip = join(root, 'out', 'toolbox-2026.10.03.zip');
  await writeFile(zip, '前回の zip');
  await assert.rejects(runRelease('2026.10.03', root,
    () => assert.fail('ツールを実行してはいけない'),
    () => { throw new Error('共通テスト失敗'); },
  ), /共通テスト失敗/);
  await assert.rejects(access(zip));
});

for (const [command, createZip] of [['build', build], ['check', release]]) {
  test(`${command} の zip に戻るリンクと版番号を追加し、登録順・英数字の名前・加工前HTMLを保持する`, async (t) => {
    const root = await fixture(t);
    await mkdir(join(root, 'build'));
    await writeFile(join(root, 'build', 'old.html'), '<body>削除済みツール</body>');
    const calls = [];
    await createZip('2026.09.26', root, async (args, cwd) => {
      calls.push([basename(cwd), args]);
      if (args[0] === command) {
        await mkdir(join(cwd, 'dist'));
        await writeFile(join(cwd, 'dist', '配布.html'), toolHtml(`最新 ${basename(cwd)}`));
      }
    });
    assert.deepEqual(calls, [
      ['alpha', ['install', '--frozen-lockfile']],
      ['alpha', [command]],
      ['beta', ['install', '--frozen-lockfile']],
      ['beta', [command]],
    ]);
    const target = join(root, 'out', 'toolbox-2026.09.26');
    const entries = execFileSync('unzip', ['-Z1', `${target}.zip`], { encoding: 'utf8' })
      .trim()
      .split('\n');
    assert.deepEqual(entries.filter((name) => !name.endsWith('/')).sort(), [
      'toolbox-2026.09.26/index.html',
      'toolbox-2026.09.26/tools/alpha.html',
      'toolbox-2026.09.26/tools/beta.html',
    ]);
    assert.ok(entries.every((name) => /^[A-Za-z0-9./-]+$/.test(name)));
    const index = await readFile(join(target, 'index.html'), 'utf8');
    assert.ok(index.indexOf('alpha.html') < index.indexOf('beta.html'));
    // カードのアイコンは各ツールの src/icon.png を埋め込む。
    for (const dir of ['alpha', 'beta']) {
      const png = await readFile(join(root, 'tools', dir, 'src', 'icon.png'));
      assert.ok(index.includes(`src="${iconDataUrl(png)}"`));
    }
    for (const dir of ['alpha', 'beta']) {
      const html = await readFile(join(target, 'tools', `${dir}.html`), 'utf8');
      assert.ok(html.includes(`最新 ${dir}`));
      assert.equal(html.match(/id="toolbox-version"/g).length, 1);
      assert.equal(html.split(homeLink).length, 2);
      assert.equal(html.includes(homeSlot), false);
      const homeHref = /<a id="toolbox-home" [^>]*href="([^"]+)"/.exec(html)[1];
      const toolUrl = pathToFileURL(join(target, 'tools', `${dir}.html`));
      assert.equal(new URL(homeHref, toolUrl).href, pathToFileURL(join(target, 'index.html')).href);
      assert.ok(html.includes('toolbox 2026.09.26'));
      const zipped = execFileSync(
        'unzip',
        ['-p', `${target}.zip`, `toolbox-2026.09.26/tools/${dir}.html`],
        { encoding: 'utf8' },
      );
      assert.equal(zipped, html);
      assert.equal(
        await readFile(join(root, 'tools', dir, 'dist', '配布.html'), 'utf8'),
        toolHtml(`最新 ${dir}`),
      );
      assert.equal(await readFile(join(root, 'build', `${dir}.html`), 'utf8'), toolHtml(`最新 ${dir}`));
    }
    assert.deepEqual(await readdir(join(root, 'build')), ['alpha.html', 'beta.html']);
  });

  test(`${command} 途中で失敗したら zip を作らず、同じ版の古い zip も残さない`, async (t) => {
    const root = await fixture(t);
    const zip = join(root, 'out', 'toolbox-2026.09.26.zip');
    await mkdir(join(root, 'out'));
    await writeFile(zip, '古い zip');
    const calls = [];
    await assert.rejects(
      createZip('2026.09.26', root, async (args, cwd) => {
        calls.push([basename(cwd), args[0]]);
        if (basename(cwd) === 'alpha' && args[0] === command) throw new Error('検証失敗');
      }),
      /検証失敗/,
    );
    assert.deepEqual(calls, [
      ['alpha', 'install'],
      ['alpha', command],
    ]);
    await assert.rejects(access(zip));
    await assert.rejects(packageRelease('2026.09.26', root), /build\/alpha.html/);
    await assert.rejects(access(zip));
    await assert.rejects(createZip('v1', root), /日付形式/);
    await writeFile(zip, '古い zip');
    await rm(join(root, 'tools', 'beta', 'pnpm-lock.yaml'));
    await assert.rejects(createZip('2026.09.26', root), /pnpm-lock.yaml/);
    await assert.rejects(access(zip));
  });
}
