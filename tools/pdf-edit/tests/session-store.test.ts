import { beforeEach, expect, test, vi } from 'vitest';
import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { Editor } from '../src/editor';
import {
  SessionStore,
  sessionKey,
  type SessionState,
  type SessionSource,
} from '../src/session-store';
import { createSamplePdf } from '../src/sample';

let factory: IDBFactory;
beforeEach(() => {
  factory = new IDBFactory();
});
function data() {
  const editor = new Editor();
  editor.open(
    [0, 1, 2, 3].map((index) => ({
      id: `a-${index}`,
      sourceId: 'a',
      sourceIndex: index,
      rotation: 0,
    })),
  );
  editor.select('a-1');
  editor.rotate();
  const state: SessionState = {
    version: 1,
    filename: 'サンプル.pdf',
    editor: editor.snapshot(),
    zoom: 150,
    sourceIds: ['a'],
  };
  const sources: SessionSource[] = [
    {
      id: 'a',
      name: 'サンプル.pdf',
      data: new Blob([createSamplePdf()], { type: 'application/pdf' }),
    },
  ];
  return { state, sources };
}
const store = (key = 'file:///PDF編集.html') =>
  new SessionStore(key, () => factory);

test('PDFのバイト列・編集履歴・倍率を保存し、別インスタンスから復元する', async () => {
  const original = data();
  await store().save(original.state, original.sources);
  const saved = await store().load();
  expect(saved?.state).toEqual(original.state);
  expect(await saved?.sources[0]?.data.arrayBuffer()).toEqual(
    await original.sources[0]!.data.arrayBuffer(),
  );
  const editor = new Editor();
  editor.restore(saved!.state.editor);
  expect(editor.changed).toBe(true);
  editor.undo();
  expect(editor.changed).toBe(false);
});

test('連続した保存は順序を保ち、呼び出し後の状態変更を混入させない', async () => {
  const session = store();
  const { state, sources } = data();
  const first = session.save(state, sources);
  state.zoom = 200;
  state.editor.selectedId = 'a-3';
  const second = session.save(state, sources);
  state.zoom = 25;
  await Promise.all([first, second]);
  expect((await store().load())?.state).toMatchObject({
    zoom: 200,
    editor: { selectedId: 'a-3' },
  });
});

test('PDF本体は編集状態を更新するたびには書き直さない', async () => {
  const session = store();
  const { state, sources } = data();
  const put = vi.spyOn(IDBObjectStore.prototype, 'put');
  try {
    await session.save(state, sources);
    state.zoom = 200;
    await session.save(state, sources);
    expect(
      put.mock.contexts.filter(
        (context) =>
          context instanceof IDBObjectStore && context.name === 'sources',
      ),
    ).toHaveLength(1);
    expect(
      put.mock.contexts.filter(
        (context) =>
          context instanceof IDBObjectStore && context.name === 'sessions',
      ),
    ).toHaveLength(2);
  } finally {
    put.mockRestore();
  }
});

test('閉じる処理は保存待ちの後に実行され、別のHTMLの記録を消さない', async () => {
  const session = store();
  const other = store('file:///別のPDF編集.html');
  const { state, sources } = data();
  await other.save(state, sources);
  const saving = session.save(state, sources);
  const clearing = session.clear();
  await Promise.all([saving, clearing]);
  expect(await store().load()).toBeUndefined();
  expect((await other.load())?.state).toEqual(state);
  const db = await new Promise<IDBDatabase>((resolve) => {
    const request = factory.open('pdf-edit-session', 1);
    request.onsuccess = () => resolve(request.result);
  });
  const count = await new Promise<number>((resolve) => {
    const request = db
      .transaction('sources')
      .objectStore('sources')
      .index('session')
      .count('file:///PDF編集.html');
    request.onsuccess = () => resolve(request.result);
  });
  expect(count).toBe(0);
  db.close();
});

test('保存失敗で前の記録を失わず、以後の保存も再試行できる', async () => {
  const session = store();
  const { state, sources } = data();
  await session.save(state, sources);
  const originalPut = IDBObjectStore.prototype.put;
  const put = vi
    .spyOn(IDBObjectStore.prototype, 'put')
    .mockImplementation(function (this: IDBObjectStore, ...args) {
      if (this.name === 'sessions')
        throw new DOMException('容量不足', 'QuotaExceededError');
      return originalPut.apply(this, args);
    });
  state.zoom = 300;
  try {
    await expect(session.save(state, sources)).rejects.toThrow('容量不足');
  } finally {
    put.mockRestore();
  }
  expect((await store().load())?.state.zoom).toBe(150);
  await session.save(state, sources);
  expect((await store().load())?.state.zoom).toBe(300);
});

test('保存領域を利用できない場合は成功扱いしない', async () => {
  const session = new SessionStore('test', () => {
    throw new DOMException('使用不可', 'SecurityError');
  });
  await expect(session.load()).rejects.toThrow('使用不可');
  const { state, sources } = data();
  await expect(session.save(state, sources)).rejects.toThrow('使用不可');
  await session.flush();
  expect(session.hasData).toBe(false);
});

test('別の画面が記録を削除した後の保存でもPDF本体を欠落させない', async () => {
  const session = store();
  const { state, sources } = data();
  await session.save(state, sources);
  await store().clear();
  state.zoom = 200;
  await session.save(state, sources);
  const restored = await store().load();
  expect(restored?.state.zoom).toBe(200);
  expect(await restored?.sources[0]?.data.arrayBuffer()).toEqual(
    await sources[0]!.data.arrayBuffer(),
  );
});

test('対応外の復元形式や欠けたPDFを検出する', async () => {
  const session = store();
  const { state, sources } = data();
  await session.save(
    { ...state, version: 2 } as unknown as SessionState,
    sources,
  );
  await expect(store().load()).rejects.toThrow('復元用のデータが壊れています');
  await session.save({ ...state, sourceIds: ['missing'] }, sources);
  await expect(store().load()).rejects.toThrow('復元に必要なPDF');
});

test('復元用のキーはHTMLの配置場所を区別し、クエリーやハッシュには依存しない', () => {
  expect(sessionKey('file:///a/PDF.html?x=1#p2')).toBe('file:///a/PDF.html');
  expect(sessionKey('http://127.0.0.1:5173/?test=1')).toBe(
    'http://127.0.0.1:5173/',
  );
  expect(sessionKey('file:///a/PDF.html')).not.toBe(
    sessionKey('file:///b/PDF.html'),
  );
});
