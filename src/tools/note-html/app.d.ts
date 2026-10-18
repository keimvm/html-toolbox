// app.js（旧 note-html から移した JavaScript）のうち、index.tsx が使う部分の型。
export interface NoteStatus {
  /** 開いているフォルダの名前。 */
  root: string;
  /** 開いているノートのフォルダ内のパス。 */
  path: string;
  dirty: boolean;
  /** 処理中の内容（'saving'・'adding'・'managing' など）。何もしていなければ空。 */
  busy: string;
}

export interface NoteApp {
  ready: Promise<void>;
  openFolderHandle(handle: FileSystemDirectoryHandle): Promise<void>;
  dirty(): boolean;
  dispose(): void;
}

export function createApp(
  window: Window & typeof globalThis,
  options?: {
    onStatus?: (status: NoteStatus) => void;
    isActive?: () => boolean;
    documentStyles?: string;
  },
): NoteApp;
