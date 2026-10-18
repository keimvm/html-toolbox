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
    auto: false,
    quality: 80,
    fits: null,
    thumbnail: new Blob(['thumbnail']),
  };
  conversions[1]!.resolve(result);
  await store.idle();
  expect(item.error).toBeNull();
  expect(item.result).toBe(result);
  expect(isPending(item)).toBe(false);

  // 保存後に編集したら、新しい変換が終わる前から未保存に戻す。
  item.saved = true;
  store.schedule(item);
  expect(item.saved).toBe(false);
  expect(isPending(item)).toBe(true);
  await vi.waitFor(() => expect(conversions).toHaveLength(3));
  conversions[2]!.resolve(result);
  await store.idle();
  expect(item.saved).toBe(false);
});

test('一覧の中で画像を動かすと、PDF にまとめる順もその順になる', () => {
  const store = createItems();
  const [a, b, c] = ['a', 'b', 'c'].map((name) =>
    store.add(new Blob([name]), `${name}.png`, `${name}.png`, name),
  );
  store.move(c!, 0);
  expect(store.items.value).toEqual([c, a, b]);
  store.move(c!, 5);
  expect(store.items.value).toEqual([a, b, c]);
  store.move(a!, 1);
  expect(store.items.value).toEqual([b, a, c]);
});
