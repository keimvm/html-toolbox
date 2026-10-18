import { describe, expect, test } from 'vitest';
import { readFolderRecord } from './folder-memory';
import {
  emptyLibrary,
  LIBRARY_FILE,
  LibraryFormatError,
  serializeLibrary,
  type Library,
} from './library';
import {
  changeLibrary,
  openLibraryFile,
  readLibrary,
  type FileHandle,
  type FolderHandle,
} from './storage';

/** File System Access API の模擬。close() まで書き込み内容を反映しない（ブラウザーの一時ファイルと同じ）。 */
class MemoryFile implements FileHandle {
  writes = 0;
  failWrite = false;
  constructor(public text = '') {}
  async getFile() {
    return new File([this.text], LIBRARY_FILE) as File;
  }
  async createWritable() {
    let pending = '';
    let aborted = false;
    const writable = {
      write: async (data: string) => {
        if (this.failWrite) throw new DOMException('', 'QuotaExceededError');
        pending += data;
      },
      close: async () => {
        this.text = pending;
        this.writes += 1;
      },
      abort: async () => {
        aborted = true;
      },
      get aborted() {
        return aborted;
      },
    };
    return writable as unknown as FileSystemWritableFileStream;
  }
}

class MemoryFolder implements FolderHandle {
  requests: { name: string; create?: boolean }[] = [];
  constructor(
    public file?: MemoryFile,
    public name = '保存先',
  ) {}
  async getFileHandle(name: string, options?: FileSystemGetFileOptions) {
    this.requests.push({ name, create: options?.create });
    if (!this.file) {
      if (!options?.create) throw new DOMException('', 'NotFoundError');
      this.file = new MemoryFile();
    }
    return this.file;
  }
}

const library = (titles: string[]): Library => ({
  ...emptyLibrary(),
  prompts: titles.map((title, i) => ({
    id: String(i + 1),
    title,
    body: `${title}の本文`,
    tags: [],
  })),
});

describe('保存ファイルを開く', () => {
  test('フォルダになければ prompt-library.json を作り、空の一覧を書き込む', async () => {
    const folder = new MemoryFolder();
    const opened = await openLibraryFile(folder);
    expect(folder.requests).toEqual([{ name: LIBRARY_FILE, create: true }]);
    expect(opened.library).toEqual(emptyLibrary());
    expect(folder.file?.text).toBe(serializeLibrary(emptyLibrary()));
  });

  test('あれば読み込み、書き込まない', async () => {
    const file = new MemoryFile(serializeLibrary(library(['要約'])));
    const opened = await openLibraryFile(new MemoryFolder(file));
    expect(opened.library).toEqual(library(['要約']));
    expect(file.writes).toBe(0);
  });

  test('読めない保存ファイルは上書きせず例外にする', async () => {
    const file = new MemoryFile('{"format": "other"}');
    await expect(openLibraryFile(new MemoryFolder(file))).rejects.toThrow(LibraryFormatError);
    expect(file.text).toBe('{"format": "other"}');
    expect(file.writes).toBe(0);
  });
});

describe('保存ファイルへの書き込み', () => {
  test('書き込む直前に読み直し、ほかの画面で足した項目を消さない', async () => {
    const file = new MemoryFile(serializeLibrary(library(['要約'])));
    const seen = await readLibrary(file);
    // ほかのタブで1件追加された。
    file.text = serializeLibrary(library(['要約', '翻訳']));
    const next = await changeLibrary(file, (latest) => ({
      ...latest,
      prompts: latest.prompts.filter((p) => p.id !== seen.prompts[0]!.id),
    }));
    expect(next.prompts.map((p) => p.title)).toEqual(['翻訳']);
    expect(await readLibrary(file)).toEqual(next);
  });

  test('変更の処理が例外なら書き込まない', async () => {
    const file = new MemoryFile(serializeLibrary(library(['要約'])));
    await expect(
      changeLibrary(file, () => {
        throw new Error('missing');
      }),
    ).rejects.toThrow('missing');
    expect(file.writes).toBe(0);
  });

  test('書き込みに失敗したら元の内容を残し、例外を伝える', async () => {
    const before = serializeLibrary(library(['要約']));
    const file = new MemoryFile(before);
    file.failWrite = true;
    await expect(changeLibrary(file, (l) => l)).rejects.toThrow();
    expect(file.text).toBe(before);
  });

  test('読めなくなった保存ファイルには書き込まない', async () => {
    const file = new MemoryFile('壊れた内容');
    await expect(changeLibrary(file, (l) => l)).rejects.toThrow(LibraryFormatError);
    expect(file.text).toBe('壊れた内容');
  });
});

describe('保存先の記録', () => {
  const handle = {
    kind: 'directory',
    name: 'プロンプト',
    getFileHandle() {},
    queryPermission() {},
    requestPermission() {},
  };

  test('版とフォルダの handle がそろった記録だけを読む', () => {
    expect(readFolderRecord({ version: 1, folder: handle })).toBe(handle);
    for (const value of [
      undefined,
      null,
      'folder',
      { version: 2, folder: handle },
      { version: 1 },
      { version: 1, folder: { ...handle, kind: 'file' } },
      { version: 1, folder: { name: 'a', kind: 'directory' } },
    ]) {
      expect(readFolderRecord(value)).toBeUndefined();
    }
  });
});
