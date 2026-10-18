// 2つの文章の照らし合わせ。行ごとに差分を取り、変わった行のまとまりの中だけを文字（書記素）ごとに比べ直す。
// 差分の本体は共通部品の Rust の WebAssembly（src/engine/diff）。
import { diffTokens } from '../../engine/diff';

const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });

/** 画面で1文字として扱う単位（書記素）に分ける。「𠮷」や濁点つきの半角カナも1文字になる。 */
const graphemes = (text: string) => Array.from(segmenter.segment(text), (part) => part.segment);

/** 行に分ける。各行は末尾の改行を含む。改行コードは \n にそろえる。 */
export function splitLines(text: string): string[] {
  return text.replace(/\r\n?/gu, '\n').match(/[^\n]*\n|[^\n]+$/gu) ?? [];
}

/** 文章の1区切り。same は両方にある、removed は前にだけある、added は後にだけある部分。 */
export interface Part {
  kind: 'same' | 'removed' | 'added';
  text: string;
  /** removed・added が何か所目の違いか（0から）。 */
  change?: number;
}

/** same は変わらない行、change は変わった行のまとまり（文字ごとの区切り）。 */
export type Block = { kind: 'same'; lines: string[] } | { kind: 'change'; parts: Part[] };

export interface Comparison {
  blocks: Block[];
  /** 違う箇所の数。続いている違い（削除と追加）は1か所と数える。 */
  changes: number;
  /** 文字ごとに比べきれず、行ごと入れ替わったものとして示したまとまりがある。 */
  rough: boolean;
}

type Group = { same: string } | { removed: string; added: string };

/** 計算を打ち切られても、小さなまとまりは比べられるよう、まとまりごとに残す時間。 */
const MIN_BLOCK_TIMEOUT = 5;

/**
 * 前と後の文章を比べる。差分は同期で計算するため、画面を止める時間の上限として timeout ミリ秒で打ち切る。
 * 行の差分を計算しきれない場合と、WebAssembly をまだ読み込んでいない場合は undefined。
 * 行の中の文字の差分が時間内に終わらないまとまりは、行ごと入れ替わったものとして示す（rough）。
 */
export function compare(
  before: string,
  after: string,
  { timeout = 500 }: { timeout?: number } = {},
): Comparison | undefined {
  const deadline = Date.now() + timeout;
  const a = splitLines(before);
  const b = splitLines(after);
  const runs = diffTokens(a, b, { timeout });
  if (!runs) return undefined;

  const result: Comparison = { blocks: [], changes: 0, rough: false };
  let removed = '';
  let added = '';
  const flush = () => {
    if (!removed && !added) return;
    const parts: Part[] = [];
    for (const group of refine(removed, added, deadline, result)) {
      if ('same' in group) {
        parts.push({ kind: 'same', text: group.same });
        continue;
      }
      const change = result.changes++;
      if (group.removed) parts.push({ kind: 'removed', text: group.removed, change });
      if (group.added) parts.push({ kind: 'added', text: group.added, change });
    }
    result.blocks.push({ kind: 'change', parts });
    removed = added = '';
  };
  let i = 0;
  let j = 0;
  for (const { kind, count } of runs) {
    if (kind === 'equal') {
      flush();
      result.blocks.push({ kind: 'same', lines: a.slice(i, i + count) });
      i += count;
      j += count;
    } else if (kind === 'removed') {
      removed += a.slice(i, (i += count)).join('');
    } else {
      added += b.slice(j, (j += count)).join('');
    }
  }
  flush();
  return result;
}

/** 変わった行のまとまりの中を、文字ごとに比べる。 */
function refine(before: string, after: string, deadline: number, result: Comparison): Group[] {
  if (!before || !after) return [{ removed: before, added: after }];
  const a = graphemes(before);
  const b = graphemes(after);
  const runs = diffTokens(a, b, {
    timeout: Math.max(deadline - Date.now(), MIN_BLOCK_TIMEOUT),
  });
  if (!runs) {
    result.rough = true;
    return [{ removed: before, added: after }];
  }
  const groups: Group[] = [];
  let i = 0;
  let j = 0;
  for (const { kind, count } of runs) {
    if (kind === 'equal') {
      groups.push({ same: a.slice(i, (i += count)).join('') });
      j += count;
      continue;
    }
    let last = groups.at(-1);
    if (!last || 'same' in last) groups.push((last = { removed: '', added: '' }));
    if (kind === 'removed') last.removed += a.slice(i, (i += count)).join('');
    else last.added += b.slice(j, (j += count)).join('');
  }
  return merge(groups);
}

const size = (text: string) => graphemes(text).length;
const editSize = (group: { removed: string; added: string }) =>
  Math.max(size(group.removed), size(group.added));

/**
 * 違いに挟まれた短い一致（両側の違いのどちらより長くないもの）を、違いにまとめる。
 * 書き換えた文の中で「の」「は」だけが一致して細切れに示されるのを防ぐ。
 */
function merge(groups: Group[]): Group[] {
  const merged: Group[] = [];
  for (const group of groups) {
    merged.push(group);
    while (merged.length >= 3) {
      const [first, middle, last] = merged.slice(-3) as [Group, Group, Group];
      if ('same' in first || !('same' in middle) || 'same' in last) break;
      const length = size(middle.same);
      if (length > editSize(first) || length > editSize(last)) break;
      merged.splice(-3, 3, {
        removed: first.removed + middle.same + last.removed,
        added: first.added + middle.same + last.added,
      });
    }
  }
  return merged;
}
