// 各コード欄の読み取りと表示。欄ごとに文字コードが決まっており、入力の意味を推測しない。
import { formatCodePoint, hexByte, type Result } from './result';
import type { ShiftJisTable } from './sjis';

export type CodeField = 'codepoint' | 'utf8' | 'utf16' | 'sjis';

/** 欄に出す値。表せない文字があるときは値を空にし、problem で理由を示す。 */
export interface FieldValue {
  value: string;
  problem?: string;
}

const utf8Encoder = new TextEncoder();

/** 区切り（空白・カンマ）で分けた書き方の単位。 */
function tokens(input: string): string[] {
  return input.split(/[\s,、]+/u).filter(Boolean);
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

export function isSurrogate(codePoint: number): boolean {
  return codePoint >= 0xd800 && codePoint <= 0xdfff;
}

/** 文字列を1文字（コードポイント）ずつに分ける。対になっていないサロゲートも1つとして数える。 */
export function codePoints(text: string): number[] {
  return Array.from(text, (char) => char.codePointAt(0)!);
}

/** 16進数のバイト列。E3 81 82・E38182・%E3%81%82・0xE3 0x81・\xE3 を受け付ける。 */
export function parseBytes(input: string): Result<number[]> {
  const bytes: number[] = [];
  for (const token of tokens(input)) {
    if (!/^(?:(?:0x|\\x|%)?[0-9a-f]{2})+$/iu.test(token)) {
      return fail(
        `「${token}」は読めません。16進数を2桁ずつ（例：E3 81 82）書いてください。`,
      );
    }
    for (const [pair] of token.replace(/0x|\\x|%/giu, '').matchAll(/../gu)) {
      bytes.push(Number.parseInt(pair, 16));
    }
  }
  return { ok: true, value: bytes };
}

export function formatBytes(bytes: Iterable<number>): string {
  return Array.from(bytes, hexByte).join(' ');
}

/** U+番号の並び。U+3042・3042・0x3042 を受け付け、U+3042U+3044 のように続けてもよい。 */
export function parseCodePoints(input: string): Result<number[]> {
  const values: number[] = [];
  for (const token of tokens(input.replace(/(?=U\+)/giu, ' '))) {
    const match = /^(?:U\+|0x)?([0-9a-f]{1,6})$/iu.exec(token);
    if (!match) {
      return fail(
        `「${token}」は Unicode の番号として読めません（例：U+3042）。`,
      );
    }
    const codePoint = Number.parseInt(match[1]!, 16);
    if (codePoint > 0x10ffff) {
      return fail(`「${token}」は U+10FFFF を超えています。`);
    }
    if (isSurrogate(codePoint)) {
      return fail(
        `${formatCodePoint(codePoint)} はサロゲートのため、単独では文字になりません。`,
      );
    }
    values.push(codePoint);
  }
  return { ok: true, value: values };
}

/** UTF-8 のバイト列を読む。読めない並びは推測で補わず、その始まりの位置を返す。 */
export function decodeUtf8(bytes: readonly number[]): Result<string> {
  // BOM（EF BB BF）も U+FEFF として残す。
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  let text = '';
  // 読み途中の文字の始まり。1バイトずつ渡し、例外が出た時点の並びを読めない位置とする。
  let start = 0;
  for (let index = 0; index < bytes.length; index++) {
    let part: string;
    try {
      part = decoder.decode(Uint8Array.of(bytes[index]!), { stream: true });
    } catch {
      return fail(
        `${start + 1}バイト目（${hexByte(bytes[start]!)}）から UTF-8 として読めません。`,
      );
    }
    if (part) {
      text += part;
      start = index + 1;
    }
  }
  try {
    text += decoder.decode();
  } catch {
    return fail(
      `${start + 1}バイト目（${hexByte(bytes[start]!)}）から始まる文字が途中で切れています。`,
    );
  }
  return { ok: true, value: text };
}

/** UTF-16 の符号単位（4桁の16進数）の並び。あ・0x3042 も受け付ける。 */
export function parseUtf16(input: string): Result<string> {
  const units: number[] = [];
  for (const token of tokens(input)) {
    if (!/^(?:(?:\\u|0x)?[0-9a-f]{4})+$/iu.test(token)) {
      return fail(
        `「${token}」は読めません。16進数を4桁ずつ（例：D842 DFB7）書いてください。`,
      );
    }
    for (const [unit] of token.replace(/\\u|0x/giu, '').matchAll(/.{4}/gu)) {
      units.push(Number.parseInt(unit, 16));
    }
  }
  for (let index = 0; index < units.length; index++) {
    const unit = units[index]!;
    const label = `${index + 1}つ目の ${unit.toString(16).toUpperCase()}`;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = units[index + 1];
      if (next === undefined || next < 0xdc00 || next > 0xdfff) {
        return fail(
          `${label}（上位サロゲート）の後に、下位サロゲート（DC00〜DFFF）が必要です。`,
        );
      }
      index += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return fail(
        `${label}（下位サロゲート）の前に、上位サロゲートがありません。`,
      );
    }
  }
  return { ok: true, value: String.fromCharCode(...units) };
}

export function formatUtf16(text: string): string {
  return Array.from({ length: text.length }, (_, index) =>
    text.charCodeAt(index).toString(16).toUpperCase().padStart(4, '0'),
  ).join(' ');
}

/** 1文字の UTF-8。単独のサロゲートは表せない。 */
export function utf8Of(codePoint: number): Uint8Array | undefined {
  return isSurrogate(codePoint)
    ? undefined
    : utf8Encoder.encode(String.fromCodePoint(codePoint));
}

/** 表せない文字の一覧を、何文字目かとともに示す。 */
function describeMissing(
  missing: { char: string; position: number }[],
  encoding: string,
): string {
  const shown = missing
    .slice(0, 3)
    .map(({ char, position }) => `${char}（${position}文字目）`)
    .join('、');
  const more = missing.length > 3 ? `ほか${missing.length - 3}文字` : '';
  return `${shown}${more}は ${encoding} で表せません。`;
}

/** 文字列の各文字をバイト列にする。表せない文字があれば値を空にする。 */
function encodeEach(
  text: string,
  encode: (codePoint: number) => Iterable<number> | undefined,
  encoding: string,
): FieldValue {
  const bytes: number[] = [];
  const missing: { char: string; position: number }[] = [];
  codePoints(text).forEach((codePoint, index) => {
    const encoded = encode(codePoint);
    if (encoded) bytes.push(...encoded);
    else missing.push({ char: displayChar(codePoint), position: index + 1 });
  });
  return missing.length
    ? { value: '', problem: describeMissing(missing, encoding) }
    : { value: formatBytes(bytes) };
}

/** 文言に埋め込む文字。単独のサロゲートは番号で示す。 */
export function displayChar(codePoint: number): string {
  return isSurrogate(codePoint)
    ? formatCodePoint(codePoint)
    : String.fromCodePoint(codePoint);
}

export function shiftJisBytes(
  sjis: ShiftJisTable,
  codePoint: number,
): number[] | undefined {
  const code = sjis.encode(codePoint);
  if (code === undefined) return undefined;
  return code > 0xff ? [code >> 8, code & 0xff] : [code];
}

/** 欄の入力を文字列にする。 */
export function parseField(
  field: CodeField,
  input: string,
  sjis: ShiftJisTable,
): Result<string> {
  if (field === 'utf16') return parseUtf16(input);
  if (field === 'codepoint') {
    const result = parseCodePoints(input);
    return result.ok
      ? { ok: true, value: String.fromCodePoint(...result.value) }
      : result;
  }
  const bytes = parseBytes(input);
  if (!bytes.ok) return bytes;
  return field === 'utf8'
    ? decodeUtf8(bytes.value)
    : sjis.decodeBytes(bytes.value);
}

/** 文字列を欄に出す値にする。 */
export function formatField(
  field: CodeField,
  text: string,
  sjis: ShiftJisTable,
): FieldValue {
  switch (field) {
    case 'codepoint':
      return { value: codePoints(text).map(formatCodePoint).join(' ') };
    case 'utf16':
      return { value: formatUtf16(text) };
    case 'utf8':
      return encodeEach(text, utf8Of, 'UTF-8');
    case 'sjis':
      return encodeEach(
        text,
        (codePoint) => shiftJisBytes(sjis, codePoint),
        'Shift_JIS',
      );
  }
}
