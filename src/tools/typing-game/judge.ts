// 見本と入力の照らし合わせ。違う箇所の判定は打ち終えた後に1回だけ行い、
// 打っている間は確定のたびに、入力の末尾が見本のどこに当たるかだけを求める。
// 改行・空白を除き、NFKC で全角・半角をそろえてから文字単位の差分（Rust の WebAssembly、diff.ts）を取り、
// 結果は打ったままの文字（正規化前）に戻して示す。
import { diffChars, loadDiff, type Run } from './diff';

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

/** 文字数。改行・空白は数えない。 */
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

/**
 * 差分（見本→入力）を、入力の元の文字に当てはめる。続いている違いは追加が削除より先に来るため、
 * 置き換えは打った文字のあとに本来の文字を置く形になる。
 */
function compose(sample: Normalized, input: Normalized, runs: readonly Run[]): Judgement {
  const expected = sample.source;
  const actual = input.source;
  const wrong = new Set<number>();
  /** 入力の何文字目の前に、どの見本の文字を差し込むか。 */
  const inserts = new Map<number, string[]>();
  let s = 0;
  let t = 0;
  let differences = 0;
  let inDifference = false;
  for (const run of runs) {
    if (run.kind === 'equal') {
      s += run.count;
      t += run.count;
      inDifference = false;
      continue;
    }
    if (!inDifference) differences++;
    inDifference = true;
    if (run.kind === 'added') {
      for (let k = t; k < t + run.count; k++) wrong.add(actual[k]!);
      t += run.count;
    } else {
      // 直前に打った文字のすぐ後ろへ差し込む。見本側の間の改行・空白も含めて示す。
      const at = t > 0 ? actual[t - 1]! + 1 : 0;
      const first = expected[s]!;
      const last = expected[s + run.count - 1]!;
      const text = sample.units.slice(first, last + 1).join('');
      inserts.set(at, [...(inserts.get(at) ?? []), text]);
      s += run.count;
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
 * 見本と入力を照らし合わせる。差分は同期で計算するため、画面を止める時間の上限として timeout ミリ秒で打ち切る。
 * 見本と大きく違い計算しきれない場合と、WebAssembly を使えない場合は undefined。
 */
export async function judge(
  sample: string,
  input: string,
  { timeout = 1000 }: { timeout?: number } = {},
): Promise<Judgement | undefined> {
  try {
    await loadDiff();
  } catch (error) {
    console.error(error);
    return undefined;
  }
  const expected = normalize(sample);
  const actual = normalize(input);
  const runs = diffChars(expected.text, actual.text, { timeout });
  return runs && compose(expected, actual, runs);
}

/** 見本の、入力の文字数より先まで照らし合わせる文字数。大きく飛ばした箇所はこの範囲でだけ追いつく。 */
const LOOKAHEAD = 200;

/**
 * 打っている間の見本の進み具合を求める関数を作る。返す関数は、確定した入力を受け取り、
 * 見本の先頭から何文字目（改行・空白を除く）まで進んだかを返す。
 * 余分に打った文字・抜かした文字があっても、見本と一致した箇所に合わせて位置を戻す。
 * 一致した箇所より後に打った文字は、見本の文字と同じ数だけ進んだものとする（打ち間違いも進む）。
 * 差分の WebAssembly は先に loadDiff() で読み込んでおく。読み込む前は、確定した文字数で進める。
 */
export function createLocator(
  sample: string,
  { timeout = 50 }: { timeout?: number } = {},
): (input: string) => number {
  const expected = normalize(sample);
  /** 見本の元の文字の、改行・空白を除いた何文字目か。 */
  const rank: number[] = [];
  let total = 0;
  for (const unit of expected.units) rank.push(isBlank(unit) ? total : total++);
  /** 見本の正規化した文字の何文字目まで進んだかを、元の文字の数に戻す。 */
  const toChars = (position: number) =>
    position <= 0
      ? 0
      : position >= expected.source.length
        ? total
        : rank[expected.source[position - 1]!]! + 1;

  const sampleChars = [...expected.text];
  return (input) => {
    const actual = normalize(input).text;
    const length = [...actual].length;
    if (!length) return 0;
    const window = sampleChars.slice(0, length + LOOKAHEAD).join('');
    const runs = diffChars(window, actual, { timeout });
    // 計算しきれないとき（読み込む前を含む）は、確定した文字数で進める。
    if (!runs) return Math.min(countChars(input), total);
    // 位置を合わせる目印にした一致箇所の、見本側と入力側の終わり（正規化した文字の数）。
    let sampleAt = 0;
    let inputAt = 0;
    let s = 0;
    let t = 0;
    for (const run of runs) {
      if (run.kind === 'added') {
        t += run.count;
      } else if (run.kind === 'removed') {
        s += run.count;
      } else {
        // 打った文字より多く見本を飛ばした先の一致は、飛ばした数より長いときだけ目印にする。
        // 打ち間違えた「の」が、ずっと先の「の」に一致して見本が飛ぶのを防ぐ。
        const skipped = s - sampleAt - (t - inputAt);
        s += run.count;
        t += run.count;
        if (run.count > skipped) {
          sampleAt = s;
          inputAt = t;
        }
      }
    }
    return toChars(sampleAt + (length - inputAt));
  };
}
