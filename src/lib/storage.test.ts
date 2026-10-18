import { afterEach, expect, test, vi } from 'vitest';
import { readStored, storedSignal } from './storage';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 読めるが、容量不足で書き込めない localStorage。 */
function fullStorage(values: Record<string, string>) {
  const full = () => {
    throw new DOMException('容量不足', 'QuotaExceededError');
  };
  return { getItem: (key: string) => values[key] ?? null, setItem: full, removeItem: full };
}

const flowSignal = (key: string) =>
  storedSignal(
    key,
    (text) => text !== 'off',
    (value) => (value ? null : 'off'),
  );

test('書き込みだけが失敗しても、開いている画面の中では新しい値を使う', () => {
  vi.stubGlobal('localStorage', fullStorage({ 'test-a': 'off' }));
  vi.stubGlobal('addEventListener', () => {});
  const flow = flowSignal('test-a');
  expect(flow.value).toBe(false);
  flow.set(true);
  expect(flow.value).toBe(true);
  expect(readStored('test-a')).toBeNull();
});

test('別のタブが保存した値には追従する', () => {
  const values: Record<string, string> = {};
  const listeners: ((event: { key: string | null }) => void)[] = [];
  vi.stubGlobal('localStorage', fullStorage(values));
  vi.stubGlobal('addEventListener', (_type: string, listener: (typeof listeners)[number]) =>
    listeners.push(listener),
  );
  const flow = flowSignal('test-b');
  flow.set(false);
  expect(flow.value).toBe(false);
  values['test-b'] = 'on';
  listeners.forEach((listener) => listener({ key: 'test-b' }));
  expect(flow.value).toBe(true);
});
