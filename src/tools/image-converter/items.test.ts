import { expect, test, vi } from 'vitest';
import type { Converted } from './convert';
import { createItems, isPending } from './items';

// 画像の読み込みと変換はブラウザーの機能を使うため、終わる時を決められる偽物にする。
const { conversions } = vi.hoisted(() => ({
  conversions: [] as { resolve: (value: Converted) => void; reject: (error: Error) => void }[],
}));
vi.mock('./convert', () => ({
  decode: async () => ({ width: 40, height: 30, close() {} }),
  convert: () => new Promise<Converted>((resolve, reject) => conversions.push({ resolve, reject })),
}));

test('変換中に設定を変えた直後に古い変換が失敗しても、新しい設定で変換し直す', async () => {
  const store = createItems();
  const item = store.add(new Blob(['image']), 'a.png', 'a.png', 'a-変換');
  await vi.waitFor(() => expect(conversions).toHaveLength(1));
  store.schedule(item);
  conversions[0]!.reject(new Error('メモリー不足'));
  await vi.waitFor(() => expect(conversions).toHaveLength(2));
  const result: Converted = {
    blob: new Blob(['jpeg']),
    width: 40,
    height: 30,
    format: 'jpeg',
    quality: 80,
    fits: null,
    thumbnail: new Blob(['thumbnail']),
  };
  conversions[1]!.resolve(result);
  await store.idle();
  expect(item.error).toBeNull();
  expect(item.result).toBe(result);
  expect(isPending(item)).toBe(false);
});
