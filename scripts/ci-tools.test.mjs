import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { affectedTools, changedPaths, comparisonRange } from './ci-tools.mjs';

const tools = [{ dir: 'alpha' }, { dir: 'beta' }];

test('ツールの変更だけを検証し、文書・未登録ツールはビルドしない', () => {
  assert.deepEqual(affectedTools(tools, ['tools/beta/src/main.ts']), ['beta']);
  assert.deepEqual(affectedTools(tools, ['tools/beta/src/a.md']), ['beta']);
  assert.deepEqual(
    affectedTools(tools, [
      'README.md',
      'AGENTS.md',
      'docs/software-stack.md',
      'tools/alpha/README.md',
      'tools/alpha/AGENTS.md',
      'tools/beta/docs/test.md',
      'tools/draft/src/main.ts',
    ]),
    [],
  );
  assert.deepEqual(affectedTools(tools, []), []);
  assert.deepEqual(
    affectedTools(tools, [
      'tools/beta/.node-version',
      'tools/alpha/pnpm-lock.yaml',
      'tools/beta/package.json',
    ]),
    ['alpha', 'beta'],
  );
});

test('一覧や共通処理の変更は全ツールを検証する', () => {
  for (const path of [
    'tools.json',
    'scripts/toolbox.mjs',
    'scripts/ci-tools.mjs',
    '.github/workflows/tool.yml',
    '.node-version',
    '.gitattributes',
    'new-shared-config',
  ]) {
    assert.deepEqual(affectedTools(tools, [path]), ['alpha', 'beta'], path);
  }
});

test('PR は分岐点から、push は直前から比較し、手動・初回 push は全件にする', () => {
  const base = 'a'.repeat(40);
  const head = 'b'.repeat(40);
  assert.equal(
    comparisonRange('pull_request', {
      pull_request: { base: { sha: base }, head: { sha: head } },
    }),
    `${base}...${head}`,
  );
  assert.equal(comparisonRange('push', { before: base }, head), `${base}..${head}`);
  assert.equal(comparisonRange('push', { before: '0'.repeat(40) }, head), null);
  assert.equal(comparisonRange('workflow_dispatch', {}), null);
  assert.throws(() => comparisonRange('push', { before: '--bad' }, head), /SHA/);
  assert.throws(() => comparisonRange('release', {}), /未対応/);
});

test('実際の Git 差分で、改名の旧側と新側・削除・改行入りのファイル名を検出する', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'toolbox-git-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = (...args) =>
    execFileSync(
      'git',
      [
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      { cwd: root, encoding: 'utf8' },
    ).trim();
  git('init', '-q');
  for (const dir of ['alpha', 'beta']) await mkdir(join(root, 'tools', dir), { recursive: true });
  await writeFile(join(root, 'tools/alpha/source.ts'), 'code');
  await writeFile(join(root, 'tools/alpha/deleted.ts'), 'delete');
  git('add', '.');
  git('commit', '-qm', '初期状態');
  const before = git('rev-parse', 'HEAD');
  await rename(join(root, 'tools/alpha/source.ts'), join(root, 'tools/beta/source.ts'));
  await rm(join(root, 'tools/alpha/deleted.ts'));
  await writeFile(join(root, 'tools/beta/line\nbreak.ts'), 'code');
  git('add', '.');
  git('commit', '-qm', '変更');
  const paths = changedPaths(`${before}..HEAD`, root);
  assert.deepEqual(paths.sort(), [
    'tools/alpha/deleted.ts',
    'tools/alpha/source.ts',
    'tools/beta/line\nbreak.ts',
    'tools/beta/source.ts',
  ]);
  assert.deepEqual(affectedTools(tools, paths), ['alpha', 'beta']);
  assert.throws(() => changedPaths(`${'c'.repeat(40)}..HEAD`, root), /git diff/);
});
