import { describe, expect, test } from 'vitest';
import {
  decodeUtf8,
  formatField,
  parseBytes,
  parseCodePoints,
  parseField,
  parseUtf16,
} from '../src/codec';
import { ShiftJisTable } from '../src/sjis';

const sjis = new ShiftJisTable();

const all = (text: string) =>
  Object.fromEntries(
    (['codepoint', 'utf8', 'utf16', 'sjis'] as const).map((field) => [
      field,
      formatField(field, text, sjis),
    ]),
  );

describe('文字 → 各欄', () => {
  test('代表的な文字の値', () => {
    expect(all('あ')).toEqual({
      codepoint: { value: 'U+3042' },
      utf8: { value: 'E3 81 82' },
      utf16: { value: '3042' },
      sjis: { value: '82 A0' },
    });
    expect(all('ｱ①髙')).toEqual({
      codepoint: { value: 'U+FF71 U+2460 U+9AD9' },
      utf8: { value: 'EF BD B1 E2 91 A0 E9 AB 99' },
      utf16: { value: 'FF71 2460 9AD9' },
      sjis: { value: 'B1 87 40 FB FC' },
    });
    expect(all('A\n')).toMatchObject({
      codepoint: { value: 'U+0041 U+000A' },
      sjis: { value: '41 0A' },
    });
  });

  test('Shift_JIS で表せない文字は値を出さず、何文字目かを示す', () => {
    expect(all('𠮷野家😀')).toEqual({
      codepoint: { value: 'U+20BB7 U+91CE U+5BB6 U+1F600' },
      utf8: { value: 'F0 A0 AE B7 E9 87 8E E5 AE B6 F0 9F 98 80' },
      utf16: { value: 'D842 DFB7 91CE 5BB6 D83D DE00' },
      sjis: {
        value: '',
        problem: '𠮷（1文字目）、😀（4文字目）は Shift_JIS で表せません。',
      },
    });
    expect(formatField('sjis', '〜〜〜〜〜', sjis).problem).toBe(
      '〜（1文字目）、〜（2文字目）、〜（3文字目）ほか2文字は Shift_JIS で表せません。',
    );
  });

  test('単独のサロゲートは UTF-8 で表せない', () => {
    expect(formatField('utf8', 'a\ud842', sjis)).toEqual({
      value: '',
      problem: 'U+D842（2文字目）は UTF-8 で表せません。',
    });
  });
});

describe('各欄 → 文字', () => {
  test('書き方の幅', () => {
    for (const input of ['U+3042', 'u+3042', '3042', '0x3042', ' U+3042 ']) {
      expect(parseField('codepoint', input, sjis)).toEqual({
        ok: true,
        value: 'あ',
      });
    }
    expect(parseField('codepoint', 'U+3042U+3044, U+20BB7', sjis)).toEqual({
      ok: true,
      value: 'あい𠮷',
    });
    for (const input of [
      'E3 81 82',
      'e38182',
      '%E3%81%82',
      '0xE3 0x81 0x82',
      '\\xE3\\x81\\x82',
    ]) {
      expect(parseField('utf8', input, sjis)).toEqual({
        ok: true,
        value: 'あ',
      });
    }
    for (const input of [
      'D842 DFB7',
      'D842DFB7',
      '\\uD842\\uDFB7',
      '0xD842 0xDFB7',
    ]) {
      expect(parseField('utf16', input, sjis)).toEqual({
        ok: true,
        value: '𠮷',
      });
    }
    expect(parseField('sjis', '82A0 B1 87 40', sjis)).toEqual({
      ok: true,
      value: 'あｱ①',
    });
    // NEC選定IBM拡張文字のコードからも引ける。
    expect(parseField('sjis', 'ED 40', sjis)).toEqual({
      ok: true,
      value: '纊',
    });
    expect(parseField('sjis', '', sjis)).toEqual({ ok: true, value: '' });
  });

  test('形式の誤りを示す', () => {
    expect(parseBytes('E3 8')).toEqual({
      ok: false,
      error:
        '「8」は読めません。16進数を2桁ずつ（例：E3 81 82）書いてください。',
    });
    expect(parseBytes('GG')).toMatchObject({ ok: false });
    expect(parseCodePoints('U+D800')).toEqual({
      ok: false,
      error: 'U+D800 はサロゲートのため、単独では文字になりません。',
    });
    expect(parseCodePoints('U+110000')).toEqual({
      ok: false,
      error: '「U+110000」は U+10FFFF を超えています。',
    });
    expect(parseCodePoints('あ')).toMatchObject({ ok: false });
    expect(parseUtf16('304')).toMatchObject({ ok: false });
    expect(parseUtf16('3042 D842')).toEqual({
      ok: false,
      error:
        '2つ目の D842（上位サロゲート）の後に、下位サロゲート（DC00〜DFFF）が必要です。',
    });
    expect(parseUtf16('DFB7')).toEqual({
      ok: false,
      error:
        '1つ目の DFB7（下位サロゲート）の前に、上位サロゲートがありません。',
    });
  });

  test('UTF-8 の読めない並びは始まりの位置を示し、推測で補わない', () => {
    expect(decodeUtf8([0x41, 0xe3, 0x41])).toEqual({
      ok: false,
      error: '2バイト目（E3）から UTF-8 として読めません。',
    });
    expect(decodeUtf8([0x80])).toEqual({
      ok: false,
      error: '1バイト目（80）から UTF-8 として読めません。',
    });
    // サロゲートの符号化（CESU-8）と冗長な表現は読まない。
    expect(decodeUtf8([0xed, 0xa0, 0x80])).toMatchObject({ ok: false });
    expect(decodeUtf8([0xc0, 0x80])).toMatchObject({ ok: false });
    expect(decodeUtf8([0x41, 0xe3, 0x81])).toEqual({
      ok: false,
      error: '2バイト目（E3）から始まる文字が途中で切れています。',
    });
    expect(decodeUtf8([0xef, 0xbb, 0xbf, 0x41])).toEqual({
      ok: true,
      value: '﻿A',
    });
  });
});
