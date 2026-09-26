export const RELEASE_DELAY: number;

export interface DownloadOptions {
  /** 既定は実行中のページの window。テストでは差し替える。 */
  window?: Window;
  /** abort されたら、待たずに blob URL を解放する。 */
  signal?: AbortSignal;
}

export function downloadBlob(
  blob: Blob,
  filename: string,
  options?: DownloadOptions,
): void;
