// クリップボードへのコピー。file:// も Chrome・Edge では安全なコンテキストのため、標準の Clipboard API を使う。
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * 画像をクリップボードに入れる。Chrome・Edge が書き込める画像は PNG だけ。
 * 作るのに時間がかかっても操作の直後に書き込みを始められるよう、作っている途中の Promise のまま渡せる。
 */
export async function copyImage(png: Blob | Promise<Blob>): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  } catch {
    return false;
  }
}
