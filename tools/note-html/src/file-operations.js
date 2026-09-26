import { equalBytes, readBytes, isMarkdown } from './core.js';

export class EntryError extends Error {
  constructor(message) { super(message); this.name = 'EntryError'; }
}
export const containsPath = (parent, path) => path === parent || path.startsWith(`${parent}/`);
export const parentPath = path => path.split('/').slice(0, -1).join('/');
export const joinPath = (parent, name) => parent ? `${parent}/${name}` : name;

export function entryName(raw, kind) {
  let name = raw.trim();
  if (!name || name === '.' || name === '..' || /[\\/:*?"<>|\u0000-\u001f\u007f]/.test(name) || /[. ]$/.test(name)) throw new EntryError('名前に使えない文字が含まれています。');
  if (name.toLowerCase() === '.assets') throw new EntryError('「.assets」は添付ファイル用のため使えません。');
  if (kind === 'file' && !isMarkdown(name)) name += '.md';
  if (new TextEncoder().encode(name).length > 240) throw new EntryError('名前が長すぎます。短い名前にしてください。');
  return name;
}
export async function directoryAt(root, path) {
  let handle = root;
  if (!path) return handle;
  for (const part of path.split('/')) {
    if (!part || part === '.' || part === '..' || part.includes('\\')) throw new EntryError('この場所は操作できません。');
    handle = await handle.getDirectoryHandle(part);
  }
  return handle;
}
export async function entryAt(root, path, kind) {
  const parent = await directoryAt(root, parentPath(path));
  const name = path.split('/').at(-1);
  return kind === 'directory' ? parent.getDirectoryHandle(name) : parent.getFileHandle(name);
}
async function requireAvailable(parent, name) {
  // 大文字・小文字とUnicode正規化だけの変更も、既存項目の上書きを避けるため止める。
  const key = value => value.normalize('NFC').toLocaleLowerCase('en-US');
  for await (const entry of parent.values()) if (key(entry.name) === key(name)) throw new EntryError('同じ名前のファイルまたはフォルダがあります。');
  // 列挙直後に作られた同名項目も確認する。APIには排他的作成がない。
  for (const kind of ['file', 'directory']) {
    try {
      await (kind === 'file' ? parent.getFileHandle(name) : parent.getDirectoryHandle(name));
      throw new EntryError('同じ名前のファイルまたはフォルダがあります。');
    } catch (error) { if (!['NotFoundError', 'TypeMismatchError'].includes(error.name)) throw error; }
  }
}
export async function createEntry(root, path, raw, kind) {
  const name = entryName(raw, kind), parent = await directoryAt(root, path);
  await requireAvailable(parent, name);
  const handle = await (kind === 'directory' ? parent.getDirectoryHandle(name, { create: true }) : parent.getFileHandle(name, { create: true }));
  return { path: joinPath(path, name), handle };
}

// 非表示ファイルや空フォルダも含め、確認時の実体と内容を記録する。
export async function snapshotEntry(handle) {
  if (handle.kind === 'file') return { handle, kind: 'file', bytes: await readBytes(handle) };
  const children = new Map();
  for await (const child of handle.values()) children.set(child.name, await snapshotEntry(child));
  return { handle, kind: 'directory', children };
}
export function countFiles(snapshot) {
  return snapshot.kind === 'file' ? 1 : [...snapshot.children.values()].reduce((sum, child) => sum + countFiles(child), 0);
}
export async function verifySnapshot(handle, snapshot, identity = true) {
  if (handle.kind !== snapshot.kind || identity && !await handle.isSameEntry(snapshot.handle)) throw new EntryError('対象が外部で変更されています。再読み込みして確認してください。');
  if (handle.kind === 'file') {
    if (!equalBytes(await readBytes(handle), snapshot.bytes)) throw new EntryError('対象が外部で変更されています。再読み込みして確認してください。');
    return;
  }
  const children = new Map();
  for await (const child of handle.values()) children.set(child.name, child);
  if (children.size !== snapshot.children.size) throw new EntryError('フォルダの内容が外部で変更されています。再読み込みして確認してください。');
  for (const [name, child] of snapshot.children) {
    if (!children.has(name)) throw new EntryError('フォルダの内容が外部で変更されています。再読み込みして確認してください。');
    await verifySnapshot(children.get(name), child, identity);
  }
}
async function writeCopy(handle, snapshot) {
  if (snapshot.kind === 'directory') {
    for (const [name, child] of snapshot.children) {
      await requireAvailable(handle, name);
      const target = await (child.kind === 'directory' ? handle.getDirectoryHandle(name, { create: true }) : handle.getFileHandle(name, { create: true }));
      await writeCopy(target, child);
    }
    return;
  }
  let stream;
  try {
    stream = await handle.createWritable();
    await stream.write(snapshot.bytes); await stream.close(); stream = null;
  } finally { if (stream) { try { await stream.abort(); } catch { /* 元データを残し、呼び出し元で失敗を表示する。 */ } } }
}
export async function deleteEntry(root, path, snapshot) {
  if (!path || path.split('/')[0] === '.assets') throw new EntryError('この場所は削除できません。');
  const parent = await directoryAt(root, parentPath(path));
  await verifySnapshot(await entryAt(root, path, snapshot.kind), snapshot);
  await parent.removeEntry(path.split('/').at(-1), { recursive: snapshot.kind === 'directory' });
}
export async function renameEntry(root, path, raw, snapshot) {
  if (!path || path.split('/')[0] === '.assets') throw new EntryError('この場所の名前は変更できません。');
  const name = entryName(raw, snapshot.kind);
  if (name === path.split('/').at(-1)) return { path, handle: snapshot.handle };
  const parent = await directoryAt(root, parentPath(path));
  await verifySnapshot(await entryAt(root, path, snapshot.kind), snapshot);
  await requireAvailable(parent, name);
  let target;
  try {
    target = await (snapshot.kind === 'directory' ? parent.getDirectoryHandle(name, { create: true }) : parent.getFileHandle(name, { create: true }));
    await writeCopy(target, snapshot);
    await verifySnapshot(target, snapshot, false);
    // 全コピーの完了後に元データを再確認し、変更があれば削除を止める。
    await deleteEntry(root, path, snapshot);
    return { path: joinPath(parentPath(path), name), handle: target };
  } catch (error) {
    if (target) throw new EntryError(`名前を変更できませんでした。元の場所と「${name}」を確認してください。新しい場所にコピーが残っている可能性があります。`);
    throw error;
  }
}
