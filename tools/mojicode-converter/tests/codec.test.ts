import { describe, expect, test } from 'vitest';
import {
  decodeUtf8,
  formatField,
  parseBytes,
  parseCodePoints,
  parseField,
  parseUtf16,
} from '../src/codec';
import { notations } from '../src/notation';
import { traitsOf } from '../src/props';
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

describe('素性', () => {
  test('種類・全角半角・機種依存文字', () => {
    const traits = (char: string) => traitsOf(char.codePointAt(0)!, sjis);
    expect(traits('あ')).toEqual({
      kind: 'ひらがな',
      width: '全角',
      sjis: 0x82a0,
      sjisOthers: [],
    });
    expect(traits('ｱ')).toMatchObject({
      kind: 'カタカナ',
      width: '半角',
      sjis: 0xb1,
    });
    expect(traits('ー')).toMatchObject({
      kind: 'かな共通の記号',
      width: '全角',
    });
    expect(traits('①')).toMatchObject({
      kind: '数を表す記号',
      width: '全角',
      vendor: 'NEC特殊文字',
      sjisOthers: [],
    });
    expect(traits('髙')).toMatchObject({
      kind: '漢字',
      vendor: 'IBM拡張文字',
      sjisOthers: [0xeee0],
    });
    expect(traits('≒')).toMatchObject({
      kind: '記号',
      sjis: 0x81e0,
      sjisOthers: [0x8790],
    });
    expect(traits('≒').vendor).toBeUndefined();
    expect(traits('𠮷')).toMatchObject({
      kind: '漢字',
      width: '全角',
      sjis: undefined,
    });
    expect(traits('😀')).toMatchObject({
      kind: '絵文字',
      width: '全角',
      sjis: undefined,
    });
    expect(traits('é')).toMatchObject({
      kind: '英字',
      width: '半角',
      sjis: undefined,
    });
    expect(traits('Ａ')).toMatchObject({ kind: '英字', width: '全角' });
    expect(traits('1')).toMatchObject({ kind: '数字', width: '半角' });
    expect(traits('')).toMatchObject({
      kind: '私用領域',
      vendor: '外字',
      sjis: 0xf040,
    });
    expect(traits('\n')).toMatchObject({ kind: '制御文字', width: undefined });
    expect(traits('　')).toMatchObject({ kind: '空白', width: '全角' });
    expect(traits('́')).toMatchObject({ kind: '結合文字', width: undefined });
    expect(traits('️')).toMatchObject({ kind: '異体字セレクター' });
    expect(traits('‍')).toMatchObject({ kind: '書式文字' });
  });
});

test('表記の形', () => {
  const values = (text: string) =>
    Object.fromEntries(
      notations(text, sjis).map(({ label, value }) => [label, value]),
    );
  expect(values('あ')).toEqual({
    'プログラム（\\u）': '\\u3042',
    'プログラム（\\u{}）': '\\u{3042}',
    'URL（UTF-8）': '%E3%81%82',
    'URL（Shift_JIS）': '%82%A0',
    'HTML（10進）': '&#12354;',
    'HTML（16進）': '&#x3042;',
  });
  expect(values('a 𠮷')).toEqual({
    'プログラム（\\u）': '\\u0061\\u0020\\uD842\\uDFB7',
    'プログラム（\\u{}）': '\\u{61}\\u{20}\\u{20BB7}',
    'URL（UTF-8）': 'a%20%F0%A0%AE%B7',
    'URL（Shift_JIS）': undefined,
    'HTML（10進）': '&#97;&#32;&#134071;',
    'HTML（16進）': '&#x61;&#x20;&#x20BB7;',
  });
});
