// Blob をファイルとしてダウンロードさせる。file:// でも動くよう、blob URL とリンクのクリックを使う。

/** ダウンロード開始直後には解放せず、ブラウザーが取得し終える時間を確保する。 */
export const RELEASE_DELAY = 60_000;

export function downloadBlob(
  blob: Blob,
  filename: string,
  {
    signal,
    window: win = globalThis.window,
  }: {
    signal?: AbortSignal;
    /** テストで別の window（jsdom）を渡す。 */
    window?: Window & typeof globalThis;
  } = {},
) {
  const url = win.URL.createObjectURL(blob);
  let timer = 0;
  function release() {
    win.clearTimeout(timer);
    signal?.removeEventListener('abort', release);
    win.URL.revokeObjectURL(url);
  }
  timer = win.setTimeout(release, RELEASE_DELAY);
  // 画面を閉じるときなどに、待たずに解放できるようにする。
  signal?.addEventListener('abort', release, { once: true });
  const link = win.document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  link.hidden = true;
  win.document.body.append(link);
  try {
    link.click();
  } catch (error) {
    release();
    throw error;
  } finally {
    link.remove();
  }
}

/** ファイル名に使えない文字（Windows・Mac）と制御文字を _ にする。 */
export function safeFileName(name: string, fallback = 'file') {
  const cleaned = name
    .trim()
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
    .replace(/[. ]+$/g, '');
  return cleaned || fallback;
}
