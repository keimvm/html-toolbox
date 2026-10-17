/** 読み取りの結果。読めないときは、どこが読めないかを示す文言を持つ。 */
export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

/** 2桁の大文字16進数。 */
export function hexByte(byte: number): string {
  return byte.toString(16).toUpperCase().padStart(2, '0');
}

/** U+3042 の形。4桁未満は0で埋める。 */
export function formatCodePoint(codePoint: number): string {
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}
