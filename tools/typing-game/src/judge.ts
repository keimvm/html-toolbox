// 見本と入力の照らし合わせ。打ち終えた後に1回だけ行う。
// 改行・空白を除き、NFKC で全角・半角をそろえてから jsdiff の diffChars で文字単位の差分を取り、
// 結果は打ったままの文字（正規化前）に戻して示す。
import { diffChars, type Change } from 'diff';

const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
const BLANK = /^\s+$/u;
const SPACE = /\s/u;

/** 画面で1文字として扱う単位（書記素）に分ける。「𠮷」や濁点つきの半角カナも1文字になる。 */
export function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (part) => part.segment);
}

/** 改行・空白（全角・半角・タブ）だけの文字。数えず、判定もしない。 */
export function isBlank(grapheme: string): boolean {
  return BLANK.test(grapheme);
}

/** 進み具合に使う文字数。改行・空白は数えない。 */
export function countChars(text: string): number {
  let count = 0;
  for (const grapheme of graphemes(text)) if (!isBlank(grapheme)) count++;
  return count;
}

interface Normalized {
  /** 元の文字（書記素）。 */
  units: string[];
  /** 改行・空白を除いて NFKC にした文字列。 */
  text: string;
  /** text のコードポイントごとの、元の文字（graphemes の添字）。 */
  source: number[];
}

/** NFKC は「㍻」→「平成」のように文字数を変えるため、元の文字との対応を残す。 */
function normalize(original: string): Normalized {
  const units = graphemes(original);
  let text = '';
  const source: number[] = [];
  units.forEach((unit, index) => {
    if (isBlank(unit)) return;
    for (const char of unit.normalize('NFKC')) {
      // 空白でなくても、NFKC で空白を含む形になる文字がある（例：「¨」）。
      if (SPACE.test(char)) continue;
      text += char;
      source.push(index);
    }
  });
  return { units, text, source };
}

/** 結果の1区切り。typed は打ったまま（合っている文字・改行・空白）、wrong は打ち間違い・余分、missing は抜けた見本の文字。 */
export interface Piece {
  kind: 'typed' | 'wrong' | 'missing';
  text: string;
}

export interface Judgement {
  /** 入力を先頭から並べ、抜けた文字を差し込んだもの。 */
  pieces: Piece[];
  /** 違う箇所の数。続いている違い（抜け・打ち間違い・余分）は1か所と数える。 */
  differences: number;
}

/** 置き換えは、打った文字のあとに本来の文字を置くよう、追加を削除より先にする。 */
function inputFirst(changes: readonly Change[]): Change[] {
  const ordered = [...changes];
  for (let i = 0; i + 1 < ordered.length; i++) {
    const current = ordered[i]!;
    const next = ordered[i + 1]!;
    if (current.removed && next.added) {
      ordered[i] = next;
      ordered[i + 1] = current;
      i++;
    }
  }
  return ordered;
}

/** jsdiff の結果（見本→入力）を、入力の元の文字に当てはめる。 */
function compose(
  sample: Normalized,
  input: Normalized,
  changes: readonly Change[],
): Judgement {
  const expected = sample.source;
  const actual = input.source;
  const wrong = new Set<number>();
  /** 入力の何文字目の前に、どの見本の文字を差し込むか。 */
  const inserts = new Map<number, string[]>();
  let s = 0;
  let t = 0;
  let differences = 0;
  let inDifference = false;
  for (const change of inputFirst(changes)) {
    if (!change.added && !change.removed) {
      s += change.count;
      t += change.count;
      inDifference = false;
      continue;
    }
    if (!inDifference) differences++;
    inDifference = true;
    if (change.added) {
      for (let k = t; k < t + change.count; k++) wrong.add(actual[k]!);
      t += change.count;
    } else {
      // 直前に打った文字のすぐ後ろへ差し込む。見本側の間の改行・空白も含めて示す。
      const at = t > 0 ? actual[t - 1]! + 1 : 0;
      const first = expected[s]!;
      const last = expected[s + change.count - 1]!;
      const text = sample.units.slice(first, last + 1).join('');
      inserts.set(at, [...(inserts.get(at) ?? []), text]);
      s += change.count;
    }
  }

  const pieces: Piece[] = [];
  const push = (kind: Piece['kind'], text: string) => {
    const previous = pieces.at(-1);
    if (previous?.kind === kind && kind !== 'missing') previous.text += text;
    else pieces.push({ kind, text });
  };
  for (let i = 0; i <= input.units.length; i++) {
    for (const text of inserts.get(i) ?? []) push('missing', text);
    const unit = input.units[i];
    if (unit !== undefined) push(wrong.has(i) ? 'wrong' : 'typed', unit);
  }
  return { pieces, differences };
}

/**
 * 見本と入力を照らし合わせる。画面を止めないよう jsdiff の非同期モードで計算する。
 * 見本と大きく違い、timeout ミリ秒で計算しきれない場合は undefined。
 */
export function judge(
  sample: string,
  input: string,
  { timeout = 3000 }: { timeout?: number } = {},
): Promise<Judgement | undefined> {
  const expected = normalize(sample);
  const actual = normalize(input);
  return new Promise((resolve) => {
    diffChars(expected.text, actual.text, {
      timeout,
      callback: (changes) =>
        resolve(changes && compose(expected, actual, changes)),
    });
  });
}
