// @vitest-environment jsdom
// 画面の移動（URL のハッシュ）と、開いているツール。
import { signal } from '@preact/signals';
import { expect, test, vi } from 'vitest';
import type { ToolDefinition } from './tool';

window.matchMedia ??= (() => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
})) as unknown as typeof window.matchMedia;

const tool = (id: string): ToolDefinition => ({
  id,
  name: id,
  description: '',
  icon: '',
  intents: [],
  create: vi.fn(() => ({ View: () => null, status: signal({}) })),
});

test('戻る・進む・アドレス欄でまだ開いていないツールへ移っても、ツールを用意して見せる', async () => {
  const { registerTools } = await import('./registry');
  const { instances, route, startWorkspace } = await import('./workspace');
  const notes = tool('note-html');
  registerTools([tool('pdf-edit'), notes]);
  startWorkspace();
  expect(route.value).toEqual({ kind: 'home' });

  location.hash = '/note-html';
  window.dispatchEvent(new HashChangeEvent('hashchange'));

  expect(route.value).toEqual({ kind: 'tool', id: 'note-html' });
  expect(instances.value.has('note-html')).toBe(true);
  expect(notes.create).toHaveBeenCalledTimes(1);

  // ホームへ戻ってまた移っても、作り直さない（作業内容を保つ）。
  location.hash = '/';
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  location.hash = '/note-html';
  window.dispatchEvent(new HashChangeEvent('hashchange'));
  expect(notes.create).toHaveBeenCalledTimes(1);
});
