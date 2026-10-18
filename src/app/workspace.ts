// 開いているツールと、今見ている画面。
// 画面は URL の #/<ツール名> で表し、ブラウザーの戻る・進むでも移れる（file:// でも使える）。
// 一度開いたツールは、ほかの画面に移っても作業内容を持ったまま残す。
import { batch, computed, signal } from '@preact/signals';
import { errorText } from '../lib/files';
import { prefersReducedMotion } from '../lib/platform';
import { toast } from '../ui/components';
import { allTools, toolById } from './registry';
import type { Incoming, ToolDefinition, ToolInstance } from './tool';

export type Route = { kind: 'home' } | { kind: 'tool'; id: string };

function parseRoute(hash: string): Route {
  const id = /^#\/([\w-]+)$/.exec(hash)?.[1];
  return id && toolById(id) ? { kind: 'tool', id } : { kind: 'home' };
}

export const route = signal<Route>({ kind: 'home' });
export const instances = signal<ReadonlyMap<string, ToolInstance>>(new Map());

/** 画面の書き換えが済んだら呼ぶ（画面の切り替えの動き用）。App が呼ぶ。 */
let rendered: (() => void) | null = null;
export function routeRendered() {
  rendered?.();
  rendered = null;
}

function show(next: Route) {
  const update = () => {
    route.value = next;
  };
  const transition = (
    document as Document & { startViewTransition?: (callback: () => Promise<void>) => unknown }
  ).startViewTransition;
  if (!transition || prefersReducedMotion.matches || document.visibilityState !== 'visible') {
    update();
    return;
  }
  // ホームのタイルのアイコンが、ツールの見出しのアイコンへ移るように見せる（View Transitions API）。
  transition.call(
    document,
    () =>
      new Promise<void>((resolve) => {
        rendered = resolve;
        update();
        setTimeout(resolve, 300);
      }),
  );
}

// 戻る・進む・アドレス欄で、まだ開いていないツールへ移ったときも、そのツールを用意してから見せる。
addEventListener('hashchange', () => {
  const next = parseRoute(location.hash);
  if (next.kind === 'tool') instance(toolById(next.id)!);
  show(next);
});

function instance(tool: ToolDefinition) {
  let created = instances.value.get(tool.id);
  if (!created) {
    created = tool.create();
    const next = new Map(instances.value);
    next.set(tool.id, created);
    instances.value = next;
  }
  return created;
}

/** 渡したものを受け取らせる。受け取りに失敗しても、開いた画面はそのまま使えるようにして知らせる。 */
async function hand(tool: ToolDefinition, created: ToolInstance, intent: string, input: Incoming) {
  try {
    await created.receive?.(intent, input);
  } catch (error) {
    console.error(error);
    toast(`${tool.name}で受け取れませんでした。${errorText(error)}`, { tone: 'error' });
  }
}

/** ツールを開く。intent と input を渡すと、開いたツールに受け取らせる。 */
export function openTool(id: string, delivery?: { intent: string; input: Incoming }) {
  const tool = toolById(id);
  if (!tool) return;
  batch(() => {
    const created = instance(tool);
    if (location.hash !== `#/${id}`) location.hash = `/${id}`;
    else show({ kind: 'tool', id });
    if (delivery) void hand(tool, created, delivery.intent, delivery.input);
  });
}

export function goHome() {
  if (route.value.kind === 'home') return;
  // file:// では pushState で URL を変えられない場合があるため、ハッシュだけで移る。
  location.hash = '/';
}

/** 作業中のツール（保存していない作業・閉じると失うもの）。 */
export const statuses = computed(() =>
  allTools().map((tool) => ({ tool, status: instances.value.get(tool.id)?.status.value })),
);

/** 画面を閉じる前に確かめる理由があるか。 */
export const guarded = computed(() => statuses.value.some(({ status }) => status?.guard));

/** 起動時に呼ぶ。ツールの URL を直接開いたときは、そのツールを用意する。 */
export function startWorkspace() {
  route.value = parseRoute(location.hash);
  const current = route.value;
  if (current.kind === 'tool') instance(toolById(current.id)!);
}
