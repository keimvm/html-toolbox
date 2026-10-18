import { describe, expect, test, vi } from 'vitest';
import { countChars, createLocator, graphemes, judge } from './judge';

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

describe('createLocator', () => {
  const headline = '選挙控えるトランプ米政権、軽油で欧州に圧力　日本は国内精製で距離';

  test('合っていれば、確定した文字数だけ進む（改行・空白は数えない）', () => {
    const locate = createLocator('今日は\nいい 天気');
    expect(locate('')).toBe(0);
    expect(locate('今日は')).toBe(3);
    expect(locate('今日はいい　天')).toBe(6);
    expect(locate('今日はいい天気')).toBe(7);
  });

  test('余分に打った文字の分は進まない', () => {
    const locate = createLocator(headline);
    // 「を」が余分。次に打つ見本の文字は「精」。
    expect(locate('選挙を控えるトランプ米政権、経由で欧州に圧力　日本は国内')).toBe(26);
    expect(locate('選挙を')).toBe(3);
    expect(locate('選挙を控')).toBe(3);
  });

  test('抜かした文字の分は先へ進む', () => {
    const locate = createLocator('今日はいい天気です');
    expect(locate('今日いい天気')).toBe(7);
  });

  test('打ち間違えた文字も、見本の文字と同じ数だけ進む', () => {
    const locate = createLocator('今日はいい天気');
    expect(locate('今日はいい転')).toBe(6);
    expect(locate('今日はいい転気')).toBe(7);
    expect(locate('きょう')).toBe(3);
  });

  test('打ち間違えた1文字が、ずっと先の同じ文字に一致しても飛ばない', () => {
    const locate = createLocator('あいうえおかきくけこの');
    expect(locate('あいの')).toBe(3);
  });

  test('全角・半角の違い、NFKC で文字数が変わる文字は合っているものとする', () => {
    expect(createLocator('2026年ABCです')('２０２６年ＡＢＣ')).toBe(8);
    expect(createLocator('平成元年です')('㍻元年')).toBe(4);
    expect(createLocator('㍻元年です')('平成')).toBe(1);
  });

  test('見本の最後を越えて打っても、見本の文字数で止まる', () => {
    expect(createLocator('あいう')('あいうえお')).toBe(3);
  });

  test('計算しきれないときは、確定した文字数で進める', () => {
    const sample = 'あいうえ'.repeat(100);
    const input = 'あXいう'.repeat(50);
    // 計算しきれば、余分な「X」の分だけ確定した文字数より手前になる。
    expect(createLocator(sample, { timeout: 60_000 })(input)).toBeLessThan(200);
    // jsdiff は現在時刻が期限を過ぎたかで打ち切る。時刻を進め、計算の途中で必ず期限を過ぎるようにする。
    let now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => (now += 1000));
    try {
      expect(createLocator(sample, { timeout: 50 })(input)).toBe(200);
    } finally {
      clock.mockRestore();
    }
  });
});
