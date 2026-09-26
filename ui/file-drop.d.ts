export function hasFiles(transfer: DataTransfer | null | undefined): boolean;

/** 落とされたファイルの配列。フォルダを含む場合は null。 */
export function droppedFiles(
  transfer: DataTransfer | null | undefined,
): File[] | null;

export interface FileDropOptions {
  /** 既定は実行中のページの window。テストでは差し替える。 */
  window?: Window;
  /** ファイルを受け付ける要素。受け付ける間 data-tb-file-drag が付く。 */
  zone?: Element;
  /** 落とされたファイル。フォルダを含む場合は null。 */
  onDrop?: (files: File[] | null, event: DragEvent) => void;
  /** 偽のあいだは受け付けない（落としても画面は離れない）。 */
  enabled?: () => boolean;
}

/** 戻り値の関数で見張りをやめる。 */
export function watchFileDrop(options?: FileDropOptions): () => void;
