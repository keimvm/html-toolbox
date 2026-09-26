// GitHub のイベントから、検証が必要な登録済みツールだけを選ぶ。
import { execFileSync } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { readTools } from './toolbox.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

function isDocumentation(path) {
  return path === 'README.md' || path === 'AGENTS.md' || path.startsWith('docs/');
}

export function affectedTools(tools, paths) {
  const dirs = tools.map((tool) => tool.dir);
  const changed = new Set();
  for (const path of paths) {
    if (isDocumentation(path)) continue;
    if (!path.startsWith('tools/')) return dirs;
    const [, dir, ...rest] = path.split('/');
    if (dirs.includes(dir) && !isDocumentation(rest.join('/'))) changed.add(dir);
  }
  return dirs.filter((dir) => changed.has(dir));
}

export function comparisonRange(eventName, event, sha) {
  if (eventName === 'workflow_dispatch') return null;
  let base;
  let head;
  let separator;
  if (eventName === 'pull_request') {
    base = event.pull_request.base.sha;
    head = event.pull_request.head.sha;
    separator = '...';
  } else if (eventName === 'push') {
    base = event.before;
    head = sha;
    separator = '..';
    if (/^0+$/.test(base)) return null; // ブランチの初回 push は全ツール。
  } else {
    throw new Error(`未対応のイベントです: ${eventName}`);
  }
  if (![base, head].every((ref) => typeof ref === 'string' && /^[a-f0-9]{40}$/.test(ref))) {
    throw new Error('変更対象の比較に必要なコミット SHA がありません。');
  }
  return `${base}${separator}${head}`;
}

export function changedPaths(range, rootDir = root) {
  // -z で改行を含む名前も区切り、改名は旧名・新名の両方を変更として扱う。
  return execFileSync('git', ['diff', '--name-only', '--no-renames', '-z', range, '--'], {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 16 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
}

async function main() {
  const tools = await readTools();
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const range = comparisonRange(process.env.GITHUB_EVENT_NAME, event, process.env.GITHUB_SHA);
  const selected = range
    ? affectedTools(tools, changedPaths(range))
    : tools.map((tool) => tool.dir);
  await appendFile(process.env.GITHUB_OUTPUT, `tools=${JSON.stringify(selected)}\n`);
  console.log(`検証対象: ${selected.join(', ') || 'なし（文書のみ、または未登録ツールの変更）'}`);
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(`エラー: ${error.message}`);
    process.exit(1);
  });
}
