// ファイルの受け取り（ドロップ・貼り付け・選択）と種類の判定。

export const hasFiles = (transfer: DataTransfer | null | undefined) =>
  Array.from(transfer?.types ?? []).includes('Files');

/** ブラウザーが「フォルダの読み書き」（File System Access API）を使えるか。file:// でも安全なコンテキストになる。 */
export const canUseFolders = () =>
  window.isSecureContext &&
  typeof window.showDirectoryPicker === 'function' &&
  typeof window.FileSystemFileHandle?.prototype.createWritable === 'function' &&
  typeof window.FileSystemHandle?.prototype.requestPermission === 'function';

export const isPdf = (file: Blob & { name?: string }) =>
  file.type === 'application/pdf' || /\.pdf$/iu.test(file.name ?? '');

/** ブラウザーで開けるかもしれない画像。開けるかは読み込んで確かめる（HEIC などは失敗する）。 */
export const isImage = (file: Blob & { name?: string }) =>
  file.type.startsWith('image/') ||
  /\.(jpe?g|png|gif|webp|bmp|avif|heic|heif|tiff?)$/iu.test(file.name ?? '');

export const isTextFile = (file: Blob & { name?: string }) =>
  file.type.startsWith('text/') || /\.(txt|md|markdown|csv|log)$/iu.test(file.name ?? '');

export interface Dropped {
  files: File[];
  /** フォルダを1つだけ落とした場合の、そのフォルダ。 */
  folder?: FileSystemDirectoryHandle;
  /** フォルダが混じっていた（files には含まない）。 */
  hasFolder: boolean;
}

/**
 * ドロップされた内容を取り出す。drop イベントの中で同期的に呼ぶ（DataTransfer はイベントの後に空になる）。
 * フォルダは File System Access API のハンドルとして受け取れる場合だけ folder に入れる。
 */
export function readDrop(transfer: DataTransfer): Promise<Dropped> {
  const items = Array.from(transfer.items).filter((item) => item.kind === 'file');
  const entries = items.map((item) => item.webkitGetAsEntry?.());
  const hasFolder = entries.some((entry) => entry?.isDirectory);
  const files = Array.from(transfer.files).filter((_, index) => !entries[index]?.isDirectory);
  const handles =
    hasFolder && items.length === 1 && items[0]!.getAsFileSystemHandle
      ? items[0]!.getAsFileSystemHandle().catch(() => null)
      : Promise.resolve(null);
  return handles.then((handle) => ({
    files,
    hasFolder,
    folder: handle?.kind === 'directory' ? (handle as FileSystemDirectoryHandle) : undefined,
  }));
}

/** ファイルを選ぶ画面を開く。キャンセルしたら空の配列。 */
export function pickFiles({
  accept,
  multiple = true,
}: { accept?: string; multiple?: boolean } = {}): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = multiple;
    if (accept) input.accept = accept;
    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])), { once: true });
    input.addEventListener('cancel', () => resolve([]), { once: true });
    input.click();
  });
}

export const errorName = (error: unknown) =>
  error instanceof Error || error instanceof DOMException ? error.name : '';
export const errorText = (error: unknown) => (error instanceof Error ? error.message : '');
