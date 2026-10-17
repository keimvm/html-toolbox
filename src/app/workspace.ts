// 開いているツールと、今見ている画面。
// 画面は URL の #/<ツール名> で表し、ブラウザーの戻る・進むでも移れる（file:// でも使える）。
// 一度開いたツールは、ほかの画面に移っても作業内容を持ったまま残す。
import { batch, computed, signal } from '@preact/signals';
import { tools, toolById } from '../tools';
import type { Incoming, ToolDefinition, ToolInstance } from './tool';

export type Route = { kind: 'home' } | { kind: 'tool'; id: string };

function parseRoute(hash: string): Route {
  const id = /^#\/([\w-]+)$/.exec(hash)?.[1];
  return id && toolById(id) ? { kind: 'tool', id } : { kind: 'home' };
}

export const route = signal<Route>(parseRoute(location.hash));
export const instances = signal<ReadonlyMap<string, ToolInstance>>(new Map());

/** 画面の書き換えが済んだら呼ぶ（画面の切り替えの動き用）。App が呼ぶ。 */
let rendered: (() => void) | null = null;
export function routeRendered() {
  rendered?.();
  rendered = null;
}

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

function show(next: Route) {
  const update = () => {
    route.value = next;
  };
  const transition = (
    document as Document & { startViewTransition?: (callback: () => Promise<void>) => unknown }
  ).startViewTransition;
  if (!transition || reducedMotion.matches || document.visibilityState !== 'visible') {
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

addEventListener('hashchange', () => show(parseRoute(location.hash)));

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

/** ツールを開く。intent と input を渡すと、開いたツールに受け取らせる。 */
export function openTool(id: string, delivery?: { intent: string; input: Incoming }) {
  const tool = toolById(id);
  if (!tool) return;
  batch(() => {
    const created = instance(tool);
    if (location.hash !== `#/${id}`) location.hash = `/${id}`;
    else show({ kind: 'tool', id });
    if (delivery) void created.receive?.(delivery.intent, delivery.input);
  });
}

export function goHome() {
  if (route.value.kind === 'home') return;
  // file:// では pushState で URL を変えられない場合があるため、ハッシュだけで移る。
  location.hash = '/';
}

/** 作業中のツール（保存していない作業・閉じると失うもの）。 */
export const statuses = computed(() =>
  tools.map((tool) => ({ tool, status: instances.value.get(tool.id)?.status.value })),
);

/** 画面を閉じる前に確かめる理由があるか。 */
export const guarded = computed(() => statuses.value.some(({ status }) => status?.guard));

// ホームの URL を開いた後に、存在しないツールの URL を開いたときも、ホームとして扱う。
if (route.value.kind === 'tool') instance(toolById(route.value.id)!);
