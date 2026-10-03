import { describe, expect, test } from 'vitest';
import { countChars, graphemes, judge } from '../src/judge';

describe('countChars', () => {
  test('改行・空白（全角・半角・タブ）は数えない', () => {
    expect(countChars('今日は\n いい　天気\t')).toBe(7);
    expect(countChars(' \n　\t')).toBe(0);
  });

  test('補助面の文字・濁点つきの半角カナは1文字と数える', () => {
    expect(countChars('𠮷野家')).toBe(3);
    expect(countChars('ｶﾞｲﾄﾞ')).toBe(3);
    expect(graphemes('ｶﾞｲ')).toEqual(['ｶﾞ', 'ｲ']);
  });
});

describe('judge', () => {
  test('抜けと打ち間違いだけを違いとし、前後の一致している文字は違いにしない', async () => {
    const result = await judge('今日はいい天気', '今日いい転気');
    expect(result).toEqual({
      pieces: [
        { kind: 'typed', text: '今日' },
        { kind: 'missing', text: 'は' },
        { kind: 'typed', text: 'いい' },
        { kind: 'wrong', text: '転' },
        { kind: 'missing', text: '天' },
        { kind: 'typed', text: '気' },
      ],
      differences: 2,
    });
  });

  test('一致していれば違いはなく、打ったままの文字を返す', async () => {
    expect(await judge('今日はいい天気', '今日はいい天気')).toEqual({
      pieces: [{ kind: 'typed', text: '今日はいい天気' }],
      differences: 0,
    });
  });

  test('改行・空白の有無は違いにせず、打った改行・空白はそのまま残す', async () => {
    expect(await judge('今日は\nいい 天気', '今日は　いい\n天気\n')).toEqual({
      pieces: [{ kind: 'typed', text: '今日は　いい\n天気\n' }],
      differences: 0,
    });
  });

  test('全角・半角の違いは違いにせず、打ったまま（正規化前）で返す', async () => {
    expect(await judge('2026年ABC', '２０２６年ＡＢＣ')).toEqual({
      pieces: [{ kind: 'typed', text: '２０２６年ＡＢＣ' }],
      differences: 0,
    });
    expect((await judge('ガイド', 'ｶﾞｲﾄﾞ'))?.differences).toBe(0);
  });

  test('NFKC で文字数が変わる文字も、元の文字との対応を保つ', async () => {
    expect(await judge('平成元年', '㍻元年')).toEqual({
      pieces: [{ kind: 'typed', text: '㍻元年' }],
      differences: 0,
    });
    expect(await judge('平静', '㍻')).toEqual({
      pieces: [
        { kind: 'wrong', text: '㍻' },
        { kind: 'missing', text: '静' },
      ],
      differences: 1,
    });
  });

  test('余分に打った文字は wrong になる', async () => {
    expect(await judge('あいう', 'あいXYう')).toEqual({
      pieces: [
        { kind: 'typed', text: 'あい' },
        { kind: 'wrong', text: 'XY' },
        { kind: 'typed', text: 'う' },
      ],
      differences: 1,
    });
  });

  test('先頭の抜けは先頭に、途中で終えた残りは最後に差し込む', async () => {
    expect((await judge('あいう', 'いう'))?.pieces).toEqual([
      { kind: 'missing', text: 'あ' },
      { kind: 'typed', text: 'いう' },
    ]);
    expect((await judge('あいうえお', 'あい'))?.pieces).toEqual([
      { kind: 'typed', text: 'あい' },
      { kind: 'missing', text: 'うえお' },
    ]);
  });

  test('抜けは直前に打った文字の後ろ（打った改行より前）に、見本の改行・空白も含めて差し込む', async () => {
    expect((await judge('あいう', 'あい\n'))?.pieces).toEqual([
      { kind: 'typed', text: 'あい' },
      { kind: 'missing', text: 'う' },
      { kind: 'typed', text: '\n' },
    ]);
    expect((await judge('あい\nうえ', 'あ'))?.pieces).toEqual([
      { kind: 'typed', text: 'あ' },
      { kind: 'missing', text: 'い\nうえ' },
    ]);
  });

  test('補助面の文字を1文字として比べる', async () => {
    expect(await judge('𠮷野家', '吉野家')).toEqual({
      pieces: [
        { kind: 'wrong', text: '吉' },
        { kind: 'missing', text: '𠮷' },
        { kind: 'typed', text: '野家' },
      ],
      differences: 1,
    });
  });

  test('計算が打ち切りの時間を超えたら undefined を返す', async () => {
    const sample = 'あいうえおかきくけこ'.repeat(500);
    const input = 'アイウエオカキクケコ'.repeat(500);
    expect(await judge(sample, input, { timeout: 1 })).toBeUndefined();
  });
});
