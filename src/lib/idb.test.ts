import { IDBFactory } from 'fake-indexeddb';
import { expect, test } from 'vitest';
import { createRecordStore } from './idb';

test('1つのキーに値を置き、読み直し、消せる', async () => {
  const store = createRecordStore<{ n: number }>(
    { indexedDB: new IDBFactory() },
    { database: 'd', store: 's', key: 'k' },
  );
  expect(await store.load()).toBeUndefined();
  await store.save({ n: 1 });
  await store.save({ n: 2 });
  expect(await store.load()).toEqual({ n: 2 });
  await store.remove();
  expect(await store.load()).toBeUndefined();
});

test('IndexedDB が応答しないときは待ち続けずに失敗する', async () => {
  const stalled = { open: () => ({}) } as unknown as IDBFactory;
  const store = createRecordStore(
    { indexedDB: stalled },
    { database: 'd', store: 's', key: 'k', timeoutMs: 20 },
  );
  await expect(store.load()).rejects.toThrow('RecordStorageTimeout');
});
