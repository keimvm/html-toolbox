import { beforeAll, describe, expect, test, vi } from 'vitest';
import { loadDiff } from '../../engine/diff';
import { compare, splitLines, type Block } from './compare';

// 差分は共通部品の Rust の WebAssembly（src/engine/diff/wasm/）。Vite の起動時に cargo でビルドしたものを読み込む。
beforeAll(() => loadDiff());

/** 変わったまとまりを、前と後の文章に組み立て直す。 */
function rebuild(blocks: Block[]) {
  let before = '';
  let after = '';
  for (const block of blocks) {
    if (block.kind === 'same') {
      before += block.lines.join('');
      after += block.lines.join('');
      continue;
    }
    for (const part of block.parts) {
      if (part.kind !== 'added') before += part.text;
      if (part.kind !== 'removed') after += part.text;
    }
  }
  return { before, after };
}

describe('splitLines', () => {
  test('行の末尾の改行を含めて分け、改行コードをそろえる', () => {
    expect(splitLines('一\r\n二\r三\n')).toEqual(['一\n', '二\n', '三\n']);
    expect(splitLines('一\n\n二')).toEqual(['一\n', '\n', '二']);
    expect(splitLines('')).toEqual([]);
  });
});

describe('compare', () => {
  test('変わらない行はまとめ、変わった行の中を文字ごとに示す', () => {
    const result = compare(
      '第1条 目的\n甲は乙に支払う。\n第2条 期間\n',
      '第1条 目的\n甲は丙に支払う。\n第2条 期間\n',
    );
    expect(result).toEqual({
      blocks: [
        { kind: 'same', lines: ['第1条 目的\n'] },
        {
          kind: 'change',
          parts: [
            { kind: 'same', text: '甲は' },
            { kind: 'removed', text: '乙', change: 0 },
            { kind: 'added', text: '丙', change: 0 },
            { kind: 'same', text: 'に支払う。\n' },
          ],
        },
        { kind: 'same', lines: ['第2条 期間\n'] },
      ],
      changes: 1,
      rough: false,
    });
  });

  test('行の追加・削除と、違う箇所の数', () => {
    const result = compare('一\n二\n三\n', '一\n三\n四\n')!;
    expect(result.changes).toBe(2);
    expect(result.blocks).toEqual([
      { kind: 'same', lines: ['一\n'] },
      { kind: 'change', parts: [{ kind: 'removed', text: '二\n', change: 0 }] },
      { kind: 'same', lines: ['三\n'] },
      { kind: 'change', parts: [{ kind: 'added', text: '四\n', change: 1 }] },
    ]);
  });

  test('違いに挟まれた短い一致は、1つの違いにまとめる', () => {
    const result = compare('契約の解除\n', '合意の終了\n')!;
    expect(result.changes).toBe(1);
    expect(result.blocks).toEqual([
      {
        kind: 'change',
        parts: [
          { kind: 'removed', text: '契約の解除', change: 0 },
          { kind: 'added', text: '合意の終了', change: 0 },
          { kind: 'same', text: '\n' },
        ],
      },
    ]);
  });

  test('長い一致は残し、違いを分けて数える', () => {
    const result = compare('甲は本契約を解除できる。\n', '乙は本契約を解除できない。\n')!;
    expect(result.changes).toBe(2);
    expect(rebuild(result.blocks)).toEqual({
      before: '甲は本契約を解除できる。\n',
      after: '乙は本契約を解除できない。\n',
    });
  });

  test('書記素を分けない', () => {
    const result = compare('𠮷野家と👨‍👩‍👧\n', '吉野家と👨‍👩‍👦\n')!;
    const changed = result.blocks.flatMap((block) =>
      block.kind === 'change' ? block.parts.filter((part) => part.kind !== 'same') : [],
    );
    expect(changed.map((part) => part.text)).toEqual(['𠮷', '吉', '👨‍👩‍👧', '👨‍👩‍👦']);
  });

  test('同じ文章・改行コードだけ違う文章は、違いなし', () => {
    expect(compare('一\n二', '一\n二')?.changes).toBe(0);
    expect(compare('一\r\n二\r\n', '一\n二\n')?.changes).toBe(0);
  });

  test('末尾の改行の有無も違いとして示す', () => {
    const result = compare('一\n二', '一\n二\n')!;
    expect(result.changes).toBe(1);
    expect(rebuild(result.blocks)).toEqual({ before: '一\n二', after: '一\n二\n' });
  });

  test('結果から前と後の文章を組み立て直せる', () => {
    const before =
      '吾輩は猫である。\n名前はまだ無い。\nどこで生れたかとんと見当がつかぬ。\n何でも薄暗い所で泣いていた。\n';
    const after =
      '吾輩は犬である。\n名前はもうある。\nどこで生まれたか、よく覚えている。\n明るい所で笑っていた。\n最後の行。';
    const result = compare(before, after)!;
    expect(rebuild(result.blocks)).toEqual({ before, after });
    expect(result.rough).toBe(false);
  });

  test('行の差分が期限内に終わらなければ undefined', () => {
    const before = Array.from({ length: 200 }, (_, i) => `前の${i}行目\n`).join('');
    const after = Array.from({ length: 200 }, (_, i) => `後の${i}行目\n`).join('');
    expect(compare(before, after)).toBeDefined();
    // 差分の WebAssembly は Date.now() で期限を過ぎたかを確かめる。時刻を進め、計算の途中で必ず期限を過ぎるようにする。
    let now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => (now += 1000));
    try {
      expect(compare(before, after)).toBeUndefined();
    } finally {
      clock.mockRestore();
    }
  });
});
