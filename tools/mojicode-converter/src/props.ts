// 文字の素性（種類・全角半角・機種依存文字か・Shift_JIS で表せるか）。
import { vendorArea, type ShiftJisTable } from './sjis';

export interface CharTraits {
  kind: string;
  /** 制御文字・結合文字などの幅を持たない文字では undefined。 */
  width?: '全角' | '半角';
  /** Shift_JIS の代表のコード。表せない文字では undefined。 */
  sjis?: number;
  /** 代表のほかに同じ文字を表す Shift_JIS のコード。 */
  sjisOthers: number[];
  /** 機種依存文字・外字の区分（NEC特殊文字など）。 */
  vendor?: string;
}

const KINDS: [RegExp, string][] = [
  [/\p{Cs}/u, 'サロゲート（単独）'],
  [/\p{Cn}/u, '未割り当て'],
  [/\p{Co}/u, '私用領域'],
  [/\p{Cc}/u, '制御文字'],
  [/\p{Zs}/u, '空白'],
  [/\p{Z}/u, '区切り'],
  [/\p{Variation_Selector}/u, '異体字セレクター'],
  [/\p{Cf}/u, '書式文字'],
  [/\p{M}/u, '結合文字'],
  [/\p{Emoji_Presentation}/u, '絵文字'],
  [/(?=\p{scx=Hiragana})\p{scx=Katakana}/u, 'かな共通の記号'],
  [/\p{scx=Hiragana}/u, 'ひらがな'],
  [/\p{scx=Katakana}/u, 'カタカナ'],
  [/\p{sc=Han}/u, '漢字'],
  [/\p{Nd}/u, '数字'],
  [/\p{N}/u, '数を表す記号'],
  [/\p{sc=Latin}/u, '英字'],
  [/\p{sc=Greek}/u, 'ギリシャ文字'],
  [/\p{sc=Cyrillic}/u, 'キリル文字'],
  [/\p{sc=Hangul}/u, 'ハングル'],
  [/\p{P}/u, '句読点・括弧'],
  [/\p{S}/u, '記号'],
  [/\p{L}/u, 'その他の文字'],
];

export function kindOf(codePoint: number): string {
  const char = String.fromCodePoint(codePoint);
  return KINDS.find(([pattern]) => pattern.test(char))?.[1] ?? 'その他';
}

/**
 * Unicode の East Asian Width が全角（W・F）の主な範囲。Shift_JIS で表せない文字の幅の目安に使う。
 * 絵文字は Emoji_Presentation で別に判定する。
 */
const WIDE_RANGES: [number, number][] = [
  [0x1100, 0x115f],
  [0x2e80, 0x303e],
  [0x3041, 0x33ff],
  [0x3400, 0x4dbf],
  [0x4e00, 0x9fff],
  [0xa000, 0xa4cf],
  [0xa960, 0xa97f],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe10, 0xfe19],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1b000, 0x1b2ff],
  [0x20000, 0x2fffd],
  [0x30000, 0x3fffd],
];

function widthOf(
  codePoint: number,
  kind: string,
  sjis: number | undefined,
): CharTraits['width'] {
  if (
    [
      '制御文字',
      '書式文字',
      '結合文字',
      '異体字セレクター',
      'サロゲート（単独）',
      '未割り当て',
    ].includes(kind)
  ) {
    return undefined;
  }
  // Shift_JIS で表せる文字は、Windows の慣習どおり1バイトを半角、2バイトを全角とする。
  if (sjis !== undefined) return sjis > 0xff ? '全角' : '半角';
  const wide =
    WIDE_RANGES.some(([from, to]) => codePoint >= from && codePoint <= to) ||
    /\p{Emoji_Presentation}/u.test(String.fromCodePoint(codePoint));
  return wide ? '全角' : '半角';
}

export function traitsOf(codePoint: number, table: ShiftJisTable): CharTraits {
  const kind = kindOf(codePoint);
  const sjis = table.encode(codePoint);
  return {
    kind,
    width: widthOf(codePoint, kind, sjis),
    sjis,
    sjisOthers: table.codesOf(codePoint).filter((code) => code !== sjis),
    vendor: sjis === undefined ? undefined : vendorArea(sjis),
  };
}
