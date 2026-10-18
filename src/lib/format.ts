// 数・大きさの表示。1 KB を 1,000 バイトとして数える（添付先の 1,024 バイト単位より小さめになり、収まる側にずれる）。

export function formatBytes(bytes: number): string {
  if (bytes < 1_000) return `${bytes} B`;
  const kb = Math.round(bytes / 1_000);
  if (kb < 1_000) return `${kb} KB`;
  // 桁は丸めた後の値で決め、「1000 KB」「10.00 MB」「100.0 MB」のような表示にしない。
  const mb = bytes / 1_000_000;
  if (Number(mb.toFixed(2)) < 10) return `${mb.toFixed(2)} MB`;
  if (Number(mb.toFixed(1)) < 100) return `${mb.toFixed(1)} MB`;
  return `${Math.round(mb)} MB`;
}

/** 拡張子を除いた名前。 */
export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}

export const number = (value: number, digits = 0) =>
  value.toLocaleString('ja-JP', { maximumFractionDigits: digits });
