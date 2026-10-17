// クリップボードへのコピー。file:// も Chrome・Edge では安全なコンテキストのため、標準の Clipboard API を使う。
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
