// @vitest-environment jsdom
// IME 自体ではなく、ブラウザーから届くイベントと画面の更新を確かめる。
import { render, type ComponentChildren } from 'preact';
import { act } from 'preact/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';
import type { ToolInstance } from '../../app/tool';
import { loadDiff } from '../../engine/diff';

vi.mock('../../app/frame', () => ({
  ToolFrame: ({ children }: { children: ComponentChildren }) => children,
}));

// jsdom 用の Vite モジュールはブラウザーの URL を返すため、WASM だけ Node.js で読む。
// 差分の本体と TypeScript の受け渡しは実物を使う。
vi.mock('../../engine/diff/wasm/target/wasm32-unknown-unknown/release/text_diff.wasm?init', () => ({
  default: async (imports: WebAssembly.Imports) => {
    const { readFile } = await import('node:fs/promises');
    const { join } = await import('node:path');
    const bytes = await readFile(
      join(
        process.cwd(),
        'src/engine/diff/wasm/target/wasm32-unknown-unknown/release/text_diff.wasm',
      ),
    );
    const { instance } = await WebAssembly.instantiate(new Uint8Array(bytes), imports);
    return instance;
  },
}));

let typingGame: typeof import('./index').typingGame;
let game: ToolInstance;
let host: HTMLDivElement;
let typed: HTMLTextAreaElement;

beforeAll(async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  ({ typingGame } = await import('./index'));
  await loadDiff();
});

beforeEach(async () => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  game = typingGame.create();
  await game.receive!('sample', { kind: 'text', text: '今日はいい天気' });
  const { View } = game;
  act(() => render(<View active={true} />, host));
  act(() => host.querySelector<HTMLButtonElement>('.tg-start')!.click());
  act(() => {
    vi.advanceTimersByTime(3000);
  });
  typed = host.querySelector<HTMLTextAreaElement>('textarea[aria-labelledby="tg-input-title"]')!;
});

afterEach(() => {
  const { View } = game;
  act(() => render(<View active={false} />, host));
  act(() => render(null, host));
  host.remove();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterAll(() => vi.unstubAllGlobals());

test.each(['before', 'after'] as const)(
  '確定の input が compositionend の %s に届いても、追加の Enter なしで進む',
  (order) => {
    act(() => {
      typed.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      typed.value = 'きょう';
      typed.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
    });
    expect(host.querySelectorAll('.tg-ch.is-done')).toHaveLength(0);
    expect(host.querySelector('.tg-esc-hint')!.hasAttribute('data-composing')).toBe(true);

    act(() => {
      typed.value = '今日';
      if (order === 'before')
        typed.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
      typed.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '今日' }));
      if (order === 'after')
        typed.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: false }));
    });
    expect(host.querySelectorAll('.tg-ch.is-done')).toHaveLength(2);
    expect(host.querySelector('.tg-esc-hint')!.hasAttribute('data-composing')).toBe(false);

    // 次の変換でも確定するまで進めず、isComposing のない input でも同じ扱いにする。
    act(() => {
      typed.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
      typed.value = '今日は';
      typed.dispatchEvent(new InputEvent('input', { bubbles: true }));
      typed.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(host.querySelectorAll('.tg-ch.is-done')).toHaveLength(2);
    expect(host.querySelector('.tg')!.getAttribute('data-state')).toBe('typing');
    act(() => {
      typed.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    });
    expect(host.querySelectorAll('.tg-ch.is-done')).toHaveLength(3);
  },
);

test('IME を使わない確定済みの入力も、その input だけで進む', () => {
  act(() => {
    typed.value = '今日';
    typed.dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  expect(host.querySelectorAll('.tg-ch.is-done')).toHaveLength(2);
});
