import { createRecordStore } from '../../lib/idb';

/**
 * 選んだフォルダの記録。プロンプトの本文は入れない。
 * 新しい版（解凍先のフォルダ）でも読めるよう、配置 URL（解凍先） ではなく固定のキーで持つ。
 */
const DATABASE = 'toolbox-prompt-library';
const STORE = 'folders';
const KEY = 'library-folder';

interface FolderRecord {
  version: 1;
  folder: FileSystemDirectoryHandle;
}

export function createFolderMemory(window: Pick<Window, 'indexedDB'>) {
  const store = createRecordStore<unknown>(window, {
    database: DATABASE,
    store: STORE,
    key: KEY,
  });
  return {
    /** 記録がない・形式が違う場合は undefined。 */
    async load(): Promise<FileSystemDirectoryHandle | undefined> {
      return readFolderRecord(await store.load());
    },
    save(folder: FileSystemDirectoryHandle): Promise<void> {
      const record: FolderRecord = { version: 1, folder };
      return store.save(record);
    },
  };
}

export function readFolderRecord(value: unknown): FileSystemDirectoryHandle | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const { version, folder } = value as Partial<FolderRecord>;
  if (
    version !== 1 ||
    folder?.kind !== 'directory' ||
    typeof folder.name !== 'string' ||
    typeof folder.getFileHandle !== 'function' ||
    typeof folder.queryPermission !== 'function' ||
    typeof folder.requestPermission !== 'function'
  ) {
    return undefined;
  }
  return folder;
}
