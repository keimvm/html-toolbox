// Shift_JIS（Windows 版＝CP932）の対応表。ブラウザー標準の TextDecoder で全コードを一度読み、逆引きもその結果から作る。
import { hexByte, type Result } from './result';

/** 2バイト文字の1バイト目。 */
export function isLeadByte(byte: number): boolean {
  return (byte >= 0x81 && byte <= 0x9f) || (byte >= 0xe0 && byte <= 0xfc);
}

function isTrailByte(byte: number): boolean {
  return byte >= 0x40 && byte <= 0xfc && byte !== 0x7f;
}

/** NEC選定IBM拡張文字。同じ文字が IBM拡張文字（FA40〜）にもあり、Windows は文字 → コードで IBM 側を選ぶ。 */
function isNecSelectedIbm(code: number): boolean {
  return code >= 0xed40 && code <= 0xeefc;
}

/** 1バイトの文字。WHATWG の Shift_JIS と同じく、00〜80 はそのまま、A1〜DF は半角カタカナ。 */
function singleByte(byte: number): number | undefined {
  if (byte <= 0x80) return byte;
  if (byte >= 0xa1 && byte <= 0xdf) return byte - 0xa1 + 0xff61;
  return undefined;
}

export function formatShiftJisCode(code: number): string {
  return code > 0xff
    ? `${hexByte(code >> 8)} ${hexByte(code & 0xff)}`
    : hexByte(code);
}

export class ShiftJisTable {
  readonly #forward = new Map<number, number>();
  readonly #codes = new Map<number, number[]>();

  /** decoder は既定でブラウザー標準の Shift_JIS。テストでは同じ役割の decoder を渡せる。 */
  constructor(decoder: TextDecoder = new TextDecoder('shift_jis')) {
    for (let byte = 0; byte <= 0xff; byte++) {
      const codePoint = singleByte(byte);
      if (codePoint !== undefined) this.#add(byte, codePoint);
    }
    // 全ての2バイトの並びを改行で区切って一度に読む。読めない並びは U+FFFD（と後ろの ASCII）になり、1文字にならない。
    const codes: number[] = [];
    const bytes: number[] = [];
    for (let lead = 0x81; lead <= 0xfc; lead++) {
      if (!isLeadByte(lead)) continue;
      for (let trail = 0x40; trail <= 0xfc; trail++) {
        if (!isTrailByte(trail)) continue;
        codes.push((lead << 8) | trail);
        bytes.push(lead, trail, 0x0a);
      }
    }
    const parts = decoder.decode(Uint8Array.from(bytes)).split('\n');
    if (parts.length !== codes.length + 1) {
      throw new Error('Shift_JIS の対応表を作れませんでした。');
    }
    codes.forEach((code, index) => {
      const [char, ...rest] = parts[index]!;
      if (char && rest.length === 0 && char !== '�') {
        this.#add(code, char.codePointAt(0)!);
      }
    });
  }

  #add(code: number, codePoint: number) {
    this.#forward.set(code, codePoint);
    const codes = this.#codes.get(codePoint);
    if (codes) codes.push(code);
    else this.#codes.set(codePoint, [code]);
  }

  /** コード（1バイトは 0x00〜0xFF、2バイトは 0x8140 など）の文字。 */
  decode(code: number): number | undefined {
    return this.#forward.get(code);
  }

  /** 文字 → コード。同じ文字に複数のコードがあれば、Windows と同じくNEC選定IBM拡張文字を除いた最初のコード。 */
  encode(codePoint: number): number | undefined {
    return this.codesOf(codePoint).find((code) => !isNecSelectedIbm(code));
  }

  /** その文字を表す全てのコード（小さい順）。 */
  codesOf(codePoint: number): readonly number[] {
    return this.#codes.get(codePoint) ?? [];
  }

  /** 文字として読めるコードの一覧（小さい順）。 */
  codes(): number[] {
    return [...this.#forward.keys()];
  }

  /** バイト列を文字列にする。読めない位置があれば推測で補わず、その位置を返す。 */
  decodeBytes(bytes: readonly number[]): Result<string> {
    let text = '';
    for (let index = 0; index < bytes.length;) {
      const byte = bytes[index]!;
      const single = singleByte(byte);
      if (single !== undefined) {
        text += String.fromCodePoint(single);
        index += 1;
        continue;
      }
      if (!isLeadByte(byte)) {
        return {
          ok: false,
          error: `${index + 1}バイト目の ${hexByte(byte)} は Shift_JIS の文字になりません。`,
        };
      }
      const trail = bytes[index + 1];
      if (trail === undefined) {
        return {
          ok: false,
          error: `末尾の ${hexByte(byte)}（${index + 1}バイト目）は2バイト文字の途中で切れています。`,
        };
      }
      const codePoint = this.decode((byte << 8) | trail);
      if (codePoint === undefined) {
        return {
          ok: false,
          error: `${index + 1}バイト目からの ${hexByte(byte)} ${hexByte(trail)} に対応する文字はありません。`,
        };
      }
      text += String.fromCodePoint(codePoint);
      index += 2;
    }
    return { ok: true, value: text };
  }
}
