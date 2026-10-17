import { describe, expect, test } from 'vitest';
import { ShiftJisTable } from './sjis';
import { readBestFit932, readCp932 } from './cp932.test-support';

// Node.js の TextDecoder（ICU）で表を作る。配布物ではブラウザーの TextDecoder を使う。
const table = new ShiftJisTable();
const cp932 = readCp932();
const { multiByte, wideChar } = readBestFit932();

/** 外字（利用者定義文字）の領域 F040〜F9FC。Windows は U+E000 から順に私用領域へ対応させる。 */
function userDefined(): Map<number, number> {
  const map = new Map<number, number>();
  let codePoint = 0xe000;
  for (let lead = 0xf0; lead <= 0xf9; lead++) {
    for (let trail = 0x40; trail <= 0xfc; trail++) {
      if (trail !== 0x7f) map.set((lead << 8) | trail, codePoint++);
    }
  }
  return map;
}

/** この表で読める全コード：CP932.TXT、0x80（制御文字 U+0080）、外字。 */
const expected = new Map([...cp932, [0x80, 0x80], ...userDefined()]);

const hex = (value: number | undefined) => value?.toString(16).toUpperCase();

describe('コード → 文字', () => {
  test('Microsoft の CP932.TXT の全コードと一致し、ほかに読めるのは 0x80 と外字だけ', () => {
    const mismatches = [...expected]
      .filter(([code, codePoint]) => table.decode(code) !== codePoint)
      .map(([code, codePoint]) => [
        hex(code),
        hex(codePoint),
        hex(table.decode(code)),
      ]);
    expect(mismatches).toEqual([]);
    expect(table.codes().filter((code) => !expected.has(code))).toEqual([]);
    expect(cp932.size).toBe(7915);
    expect(table.codes().length).toBe(expected.size);
  });

  test('Windows の MBTABLE と一致する（未定義の値に当てる代替の文字を除く）', () => {
    const differences = [...multiByte].filter(
      ([code, codePoint]) =>
        table.decode(code) !== codePoint &&
        // 未定義のリードバイト（85・86・EB・EC・EF）に当てる既定の文字 U+30FB と、A0・FD〜FF に当てる U+F8F0〜F8F3。
        !(codePoint === 0x30fb && !cp932.has(code)) &&
        !(codePoint >= 0xf8f0 && codePoint <= 0xf8f3),
    );
    expect(differences).toEqual([]);
    expect([...expected.keys()].filter((code) => !multiByte.has(code))).toEqual(
      [],
    );
  });

  test('読めない並びとその位置を示す', () => {
    expect(table.decodeBytes([0x82, 0xa0, 0x88, 0x9f])).toEqual({
      ok: true,
      value: 'あ亜',
    });
    expect(table.decodeBytes([0x41, 0xa0])).toEqual({
      ok: false,
      error: '2バイト目の A0 は Shift_JIS の文字になりません。',
    });
    expect(table.decodeBytes([0x41, 0x82])).toEqual({
      ok: false,
      error: '末尾の 82（2バイト目）は2バイト文字の途中で切れています。',
    });
    expect(table.decodeBytes([0x85, 0x40])).toEqual({
      ok: false,
      error: '1バイト目からの 85 40 に対応する文字はありません。',
    });
    expect(table.decodeBytes([0x82, 0x20])).toEqual({
      ok: false,
      error: '1バイト目からの 82 20 に対応する文字はありません。',
    });
  });
});

describe('文字 → コード', () => {
  test('Windows の WCTABLE のうち往復できる対応と、代表の選び方まで一致する', () => {
    const roundTrip = [...wideChar].filter(
      ([codePoint, code]) =>
        multiByte.get(code) === codePoint && expected.has(code),
    );
    const mismatches = roundTrip
      .filter(([codePoint, code]) => table.encode(codePoint) !== code)
      .map(([codePoint, code]) => [
        hex(codePoint),
        hex(code),
        hex(table.encode(codePoint)),
      ]);
    expect(mismatches).toEqual([]);
    // 読める文字は全て、往復できる対応として WCTABLE にある。
    const encodable = new Set([...expected.values()]);
    expect(encodable.size).toBe(roundTrip.length);
    for (const codePoint of encodable) {
      expect(table.encode(codePoint)).toBe(wideChar.get(codePoint));
    }
  });

  test('代表的な文字の値', () => {
    const cases: [string, number | undefined][] = [
      ['A', 0x41],
      ['\\', 0x5c],
      ['~', 0x7e],
      ['あ', 0x82a0],
      ['ｱ', 0xb1],
      ['ア', 0x8341],
      ['亜', 0x889f],
      ['①', 0x8740],
      ['㈱', 0x878a],
      ['㍾', 0x878d],
      ['Ⅰ', 0x8754],
      ['ⅰ', 0xfa40],
      ['髙', 0xfbfc],
      ['﨑', 0xfab1],
      ['≒', 0x81e0],
      ['∵', 0x81e6],
      ['￢', 0x81ca],
      ['¬', undefined],
      ['～', 0x8160],
      ['－', 0x817c],
      ['￠', 0x8191],
      ['', 0xf040],
      ['〜', undefined],
      ['¥', undefined],
      ['𠮷', undefined],
      ['😀', undefined],
    ];
    for (const [char, code] of cases) {
      expect([char, hex(table.encode(char.codePointAt(0)!))]).toEqual([
        char,
        hex(code),
      ]);
    }
  });

  test('同じ文字の別のコードも引ける', () => {
    expect(table.codesOf(0x2252)).toEqual([0x81e0, 0x8790]);
    expect(table.codesOf(0xffe2)).toEqual([0x81ca, 0xeef9, 0xfa54]);
    expect(table.codesOf(0x2170)).toEqual([0xeeef, 0xfa40]);
    expect(table.decode(0xeeef)).toBe(0x2170);
  });
});
