// Blob をファイルとしてダウンロードさせる。file:// でも動くよう、blob URL とリンクのクリックを使う。

/** ダウンロード開始直後には解放せず、Chrome が取得し終える時間を確保する。 */
export const RELEASE_DELAY = 60_000;

export function downloadBlob(blob, filename, { window: win = globalThis.window, signal } = {}) {
  const url = win.URL.createObjectURL(blob);
  let timer;
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
