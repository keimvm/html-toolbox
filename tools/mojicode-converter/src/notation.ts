// 表記の形（プログラム・URL・HTML での書き方）。
import { codePoints, isSurrogate, shiftJisBytes } from './codec';
import { hexByte } from './result';
import type { ShiftJisTable } from './sjis';

export interface Notation {
  label: string;
  /** 表せない文字を含むときは undefined。 */
  value?: string;
}

function hex(value: number): string {
  return value.toString(16).toUpperCase();
}

/** encodeURIComponent がそのまま残す文字。Shift_JIS の URL 表記でも同じにする。 */
const URL_UNRESERVED = /^[A-Za-z0-9\-_.!~*'()]$/u;

function shiftJisUrl(text: string, sjis: ShiftJisTable): string | undefined {
  let url = '';
  for (const codePoint of codePoints(text)) {
    const char = String.fromCodePoint(codePoint);
    if (URL_UNRESERVED.test(char)) {
      url += char;
      continue;
    }
    const bytes = shiftJisBytes(sjis, codePoint);
    if (!bytes) return undefined;
    url += bytes.map((byte) => `%${hexByte(byte)}`).join('');
  }
  return url;
}

export function notations(text: string, sjis: ShiftJisTable): Notation[] {
  const points = codePoints(text);
  const wellFormed = !points.some(isSurrogate);
  return [
    {
      label: 'プログラム（\\u）',
      value: Array.from(
        { length: text.length },
        (_, index) => `\\u${hex(text.charCodeAt(index)).padStart(4, '0')}`,
      ).join(''),
    },
    {
      label: 'プログラム（\\u{}）',
      value: points.map((codePoint) => `\\u{${hex(codePoint)}}`).join(''),
    },
    {
      label: 'URL（UTF-8）',
      value: wellFormed ? encodeURIComponent(text) : undefined,
    },
    { label: 'URL（Shift_JIS）', value: shiftJisUrl(text, sjis) },
    {
      label: 'HTML（10進）',
      value: wellFormed
        ? points.map((codePoint) => `&#${codePoint};`).join('')
        : undefined,
    },
    {
      label: 'HTML（16進）',
      value: wellFormed
        ? points.map((codePoint) => `&#x${hex(codePoint)};`).join('')
        : undefined,
    },
  ];
}
