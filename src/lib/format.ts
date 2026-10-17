// 数・大きさの表示。1 KB を 1,000 バイトとして数える（添付先の 1,024 バイト単位より小さめになり、収まる側にずれる）。

export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} KB`;
  const mb = bytes / 1_000_000;
  return `${mb < 10 ? mb.toFixed(2) : mb < 100 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** 拡張子を除いた名前。 */
export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

export const number = (value: number, digits = 0) =>
  value.toLocaleString('ja-JP', { maximumFractionDigits: digits });
