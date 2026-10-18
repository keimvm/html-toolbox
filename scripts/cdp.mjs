// 開発時の確認用：ヘッドレス Chrome を Chrome DevTools Protocol で操作する最小のドライバー（Node.js 標準のみ）。
// 配布物を本物の file:// で開き、ネット遮断・CSP の下での動き、コンソールのエラー、外部への通信を確かめる。
// 自動テスト（pnpm check）には含めない。Playwright は使わない（AGENTS.md）。使い方は docs/development.md の「画面を確かめる」。
// macOS の Chrome の場所を前提にしている。
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function launch({
  headless = true,
  offline = false,
  width = 1280,
  height = 800,
} = {}) {
  const profile = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'cdp-'));
  const args = [
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-extensions',
    `--window-size=${width},${height}`,
    ...(headless ? ['--headless=new'] : []),
    'about:blank',
  ];
  const proc = spawn(CHROME, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    proc.stderr.on('data', (d) => {
      buf += d;
      const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
      if (m) resolve(m[1]);
    });
    proc.on('exit', () => reject(new Error('chrome exited\n' + buf)));
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    } else for (const l of listeners) l(msg);
  });
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const mid = ++id;
      pending.set(mid, { resolve, reject });
      ws.send(JSON.stringify({ id: mid, method, params, sessionId }));
    });
  const { targetInfos } = await send('Target.getTargets');
  const page = targetInfos.find((t) => t.type === 'page');
  const { sessionId } = await send('Target.attachToTarget', {
    targetId: page.targetId,
    flatten: true,
  });
  const s = (method, params) => send(method, params, sessionId);
  const logs = [];
  listeners.add((msg) => {
    if (msg.sessionId !== sessionId) return;
    if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push(
        `[${msg.params.type}] ` +
          msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '),
      );
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      logs.push('[exception] ' + (d.exception?.description || d.text));
    } else if (msg.method === 'Log.entryAdded') {
      logs.push(
        `[log:${msg.params.entry.level}] ${msg.params.entry.text} ${msg.params.entry.url || ''}`,
      );
    } else if (msg.method === 'Network.requestWillBeSent') {
      const url = msg.params.request.url;
      if (!/^(data|blob|file|about|chrome-extension):/.test(url)) logs.push('[network] ' + url);
    }
  });
  await s('Page.enable');
  await s('Runtime.enable');
  await s('Log.enable');
  await s('Network.enable');
  if (offline)
    await s('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
  await s('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
  });

  async function evaluate(expression, { awaitPromise = true } = {}) {
    const r = await s('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async function goto(url, { waitFor = 'load', timeout = 30000 } = {}) {
    const done = new Promise((resolve) => {
      const l = (msg) => {
        if (
          msg.sessionId === sessionId &&
          msg.method === (waitFor === 'load' ? 'Page.loadEventFired' : 'Page.domContentEventFired')
        ) {
          listeners.delete(l);
          resolve();
        }
      };
      listeners.add(l);
    });
    await s('Page.navigate', { url });
    await Promise.race([
      done,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + url)), timeout)),
    ]);
  }
  async function screenshot(path) {
    const { data } = await s('Page.captureScreenshot', { format: 'png' });
    const { writeFileSync } = await import('node:fs');
    writeFileSync(path, Buffer.from(data, 'base64'));
  }
  async function waitFor(expression, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      try {
        if (await evaluate(expression)) return true;
      } catch {
        // 画面の準備ができるまでの失敗は待つ。
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('waitFor timeout: ' + expression);
  }
  async function close() {
    ws.close();
    proc.kill();
    await new Promise((r) => setTimeout(r, 300));
    rmSync(profile, { recursive: true, force: true });
  }
  return { send: s, evaluate, goto, screenshot, waitFor, logs, close };
}
