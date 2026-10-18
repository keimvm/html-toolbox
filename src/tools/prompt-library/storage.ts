import {
  emptyLibrary,
  LIBRARY_FILE,
  parseLibrary,
  serializeLibrary,
  type Library,
} from './library';

/** テストで模擬できるよう、使う File System Access API だけを型にする。 */
export type FileHandle = Pick<
  FileSystemFileHandle,
  'getFile' | 'createWritable'
>;
export type FolderHandle = Pick<FileSystemDirectoryHandle, 'name'> & {
  getFileHandle(
    name: string,
    options?: FileSystemGetFileOptions,
  ): Promise<FileHandle>;
};

export async function readLibrary(file: FileHandle): Promise<Library> {
  return parseLibrary(await (await file.getFile()).text());
}

/**
 * 保存ファイルを丸ごと書き込む。createWritable() は一時ファイルに書き、close() で置き換えるため、
 * 途中で失敗しても元の内容は残る。
 */
export async function writeLibrary(
  file: FileHandle,
  library: Library,
): Promise<void> {
  const writable = await file.createWritable();
  try {
    await writable.write(serializeLibrary(library));
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
}

/** フォルダの保存ファイルを開く。なければ作る。読めない保存ファイルは上書きせず例外にする。 */
export async function openLibraryFile(
  folder: FolderHandle,
): Promise<{ file: FileHandle; library: Library }> {
  const file = await folder.getFileHandle(LIBRARY_FILE, { create: true });
  const text = await (await file.getFile()).text();
  const library = parseLibrary(text);
  if (text.trim() === '') await writeLibrary(file, emptyLibrary());
  return { file, library };
}

/**
 * 書き込む直前に保存ファイルを読み直し、変更を当てて書き込む。
 * ほかのタブでの変更を消さないよう、画面に持っている一覧ではなくファイルの最新の内容に当てる。
 */
export async function changeLibrary(
  file: FileHandle,
  change: (library: Library) => Library,
): Promise<Library> {
  const next = change(await readLibrary(file));
  await writeLibrary(file, next);
  return next;
}
