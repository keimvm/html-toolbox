import { describe, expect, test } from 'vitest';
import {
  addPrompt,
  emptyLibrary,
  exportFileName,
  filterByTags,
  LIBRARY_VERSION,
  LibraryFormatError,
  mergePrompts,
  movePrompt,
  normalizeInput,
  parseLibrary,
  parseTags,
  removePrompt,
  replacePrompts,
  serializeLibrary,
  setHidden,
  sortByTitle,
  sortPrompts,
  updatePrompt,
  usedTags,
  type Library,
  type Prompt,
} from './library';

const prompt = (id: string, title: string, tags: string[] = []): Prompt => ({
  id,
  title,
  summary: '',
  body: `${title}の本文`,
  tags,
  hidden: false,
});

const sample: Prompt[] = [
  prompt('1', '要約', ['文章', '要約']),
  prompt('2', '翻訳', ['文章', '英語']),
  prompt('3', 'レビュー', ['コード']),
  prompt('4', 'タグなし'),
];

describe('タグでの絞り込み', () => {
  test('何も選ばなければ全件を返す', () => {
    expect(filterByTags(sample, new Set())).toEqual(sample);
  });

  test('選んだタグをすべて含むものだけを返し、選ぶほど減る（AND）', () => {
    expect(filterByTags(sample, new Set(['文章'])).map((p) => p.id)).toEqual(['1', '2']);
    expect(filterByTags(sample, new Set(['文章', '英語'])).map((p) => p.id)).toEqual(['2']);
    expect(filterByTags(sample, new Set(['英語', 'コード']))).toEqual([]);
  });

  test('使われているタグを名前順に重複なく並べる', () => {
    expect(usedTags(sample)).toEqual(
      ['コード', '英語', '文章', '要約'].sort(new Intl.Collator('ja', { numeric: true }).compare),
    );
    expect(usedTags([])).toEqual([]);
  });

  test('タイトル順では、数字は数の大きさで並べる', () => {
    const titles = ['手順10', '手順2', 'あいさつ'].map((title, i) => prompt(String(i), title));
    expect(sortPrompts(titles).map((p) => p.title)).toEqual(['あいさつ', '手順2', '手順10']);
  });
});

describe('タグの入力', () => {
  test('空白・全角空白・カンマ・読点で区切り、重複と空を除く', () => {
    expect(parseTags(' 要約,文章、英語　要約 ,, ')).toEqual(['要約', '文章', '英語']);
    expect(parseTags('')).toEqual([]);
  });
});

describe('入力の検査', () => {
  test('タイトルの前後の空白を除き、本文の改行をLFにそろえる', () => {
    expect(
      normalizeInput({
        title: '  要約 ',
        summary: ' 概要\r\n2行目 ',
        body: 'a\r\nb\rc',
        tags: ['x'],
      }),
    ).toEqual({
      title: '要約',
      summary: '概要\n2行目',
      body: 'a\nb\nc',
      tags: ['x'],
    });
  });

  test('本文の前後の空白や改行は、貼り付けた結果を変えないよう残す', () => {
    expect(normalizeInput({ title: 't', summary: '', body: '\n  〇〇\n', tags: [] })).toEqual({
      title: 't',
      summary: '',
      body: '\n  〇〇\n',
      tags: [],
    });
  });

  test('タイトル・本文が空なら理由を返す。概要・タグはなくてもよい', () => {
    expect(normalizeInput({ title: ' ', summary: '', body: 'b', tags: [] })).toMatch(/タイトル/u);
    expect(normalizeInput({ title: 't', summary: '', body: ' \n', tags: [] })).toMatch(/本文/u);
  });
});

describe('追加・編集・削除', () => {
  const library: Library = { ...emptyLibrary(), prompts: sample };

  test('追加は表示する状態で末尾に足し、元の内容を変えない', () => {
    const next = addPrompt(
      library,
      { title: '新規', summary: '概要', body: '本文', tags: [] },
      'new',
    );
    expect(next.prompts.at(-1)).toEqual({
      id: 'new',
      title: '新規',
      summary: '概要',
      body: '本文',
      tags: [],
      hidden: false,
    });
    expect(library.prompts).toHaveLength(4);
  });

  test('編集は同じ id の項目だけを置き換えて非表示の状態を保ち、ない id なら undefined', () => {
    const input = {
      title: '要約（改）',
      summary: '新しい概要',
      body: '新しい本文',
      tags: ['文章'],
    };
    const hidden = setHidden(library, '1', true)!;
    const next = updatePrompt(hidden, '1', input);
    expect(next?.prompts[0]).toEqual({ id: '1', ...input, hidden: true });
    expect(next?.prompts.slice(1)).toEqual(sample.slice(1));
    expect(updatePrompt(library, 'missing', input)).toBeUndefined();
  });

  test('削除は同じ id の項目だけを除く', () => {
    expect(removePrompt(library, '2').prompts.map((p) => p.id)).toEqual(['1', '3', '4']);
  });
});

describe('並び替え・表示の切り替え', () => {
  const library: Library = { ...emptyLibrary(), prompts: sample };
  const ids = (next: Library) => next.prompts.map((p) => p.id);

  test('相手の前か後ろへ動かす', () => {
    expect(ids(movePrompt(library, '3', '1', 'before'))).toEqual(['3', '1', '2', '4']);
    expect(ids(movePrompt(library, '1', '3', 'after'))).toEqual(['2', '3', '1', '4']);
    expect(ids(movePrompt(library, '1', '4', 'after'))).toEqual(['2', '3', '4', '1']);
  });

  test('ほかの画面で並びが変わっていても、相手の隣へ動かす', () => {
    const changed: Library = {
      ...library,
      prompts: [sample[3]!, sample[0]!, sample[2]!, sample[1]!],
    };
    expect(ids(movePrompt(changed, '2', '1', 'before'))).toEqual(['4', '2', '1', '3']);
  });

  test('自分自身や、ない項目を指したら変えない', () => {
    expect(movePrompt(library, '1', '1', 'after')).toBe(library);
    expect(movePrompt(library, 'missing', '1', 'before')).toBe(library);
    expect(movePrompt(library, '1', 'missing', 'before')).toBe(library);
  });

  test('非表示を切り替えるのは同じ id の項目だけで、ない id なら undefined', () => {
    const next = setHidden(library, '2', true)!;
    expect(next.prompts.map((p) => p.hidden)).toEqual([false, true, false, false]);
    expect(setHidden(next, '2', false)?.prompts).toEqual(sample);
    expect(setHidden(library, 'missing', true)).toBeUndefined();
  });

  test('タイトル順に並べ直す', () => {
    expect(sortByTitle(library).prompts.map((p) => p.title)).toEqual(
      sortPrompts(sample).map((p) => p.title),
    );
  });
});

describe('インポート', () => {
  const library: Library = { ...emptyLibrary(), prompts: sample.slice(0, 2) };
  let sequence = 0;
  const newId = () => `new-${++sequence}`;

  test('追加では末尾に足し、同じ内容のものは足さず、id が重なるものは新しい id にする', () => {
    sequence = 0;
    const incoming: Prompt[] = [
      { ...sample[0]! }, // 同じ内容
      { ...sample[1]!, body: '直した本文' }, // id が重なるが内容が違う
      { ...prompt('9', '新規'), hidden: true },
    ];
    const result = mergePrompts(library, incoming, newId);
    expect(result.added).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.library.prompts.map((p) => p.id)).toEqual(['1', '2', 'new-1', '9']);
    expect(result.library.prompts[2]).toEqual({ ...sample[1]!, id: 'new-1', body: '直した本文' });
    expect(result.library.prompts[3]?.hidden).toBe(true);
    expect(library.prompts).toHaveLength(2);
  });

  test('読み込むものの中の同じ内容も1つだけ足す', () => {
    const result = mergePrompts(emptyLibrary(), [prompt('a', 'x'), prompt('b', 'x')], newId);
    expect(result.library.prompts.map((p) => p.id)).toEqual(['a']);
    expect(result.skipped).toBe(1);
  });

  test('上書きでは今のプロンプトをすべて読み込んだものに置き換える', () => {
    const incoming = [prompt('9', '新規')];
    expect(replacePrompts(library, incoming).prompts).toEqual(incoming);
  });

  test('エクスポートのファイル名に日付を入れる', () => {
    expect(exportFileName(new Date(2026, 9, 3))).toBe('prompt-library-2026-10-03.json');
  });
});

describe('保存ファイルの形', () => {
  test('書き出した内容を読み戻すと同じになる', () => {
    const library: Library = {
      ...emptyLibrary(),
      prompts: [
        { ...sample[1]!, summary: '概要', hidden: true },
        { ...sample[0]!, body: '1行目\n「〇〇」について\t"引用"' },
      ],
    };
    const text = serializeLibrary(library);
    expect(text.endsWith('\n')).toBe(true);
    expect(parseLibrary(text)).toEqual(library);
    expect(JSON.parse(text)).toMatchObject({
      format: 'toolbox-prompt-library',
      version: 2,
    });
  });

  test('版1は概要なし・表示にし、それまでの一覧と同じタイトル順にして読む', () => {
    const old = (p: Prompt) => ({ id: p.id, title: p.title, body: p.body, tags: p.tags });
    const text = JSON.stringify({
      format: 'toolbox-prompt-library',
      version: 1,
      prompts: sample.map(old),
    });
    expect(parseLibrary(text)).toEqual({ ...emptyLibrary(), prompts: sortPrompts(sample) });
  });

  test('空のファイルは新しい保存ファイルとして扱う', () => {
    expect(parseLibrary('')).toEqual(emptyLibrary());
    expect(parseLibrary(' \n')).toEqual(emptyLibrary());
  });

  test('読めない・形式の違うファイルは推測で直さず、理由を示して例外にする', () => {
    const valid = JSON.parse(serializeLibrary(emptyLibrary()));
    const cases: [string, RegExp][] = [
      ['{', /JSON/u],
      ['[]', /保存ファイルではありません/u],
      [JSON.stringify({ prompts: [] }), /保存ファイルではありません/u],
      [JSON.stringify({ ...valid, version: LIBRARY_VERSION + 1 }), /新しい版/u],
      [JSON.stringify({ ...valid, version: 0 }), /形式/u],
      [JSON.stringify({ ...valid, prompts: {} }), /形式/u],
      [JSON.stringify({ ...valid, prompts: [{ id: '1', title: 't' }] }), /1件目/u],
      [
        JSON.stringify({
          ...valid,
          prompts: [{ ...sample[0], tags: [1] }],
        }),
        /1件目/u,
      ],
      [JSON.stringify({ ...valid, prompts: [sample[0], sample[0]] }), /重複/u],
      // 版2では概要と非表示の欄が要る。
      [JSON.stringify({ ...valid, prompts: [{ ...sample[0], summary: undefined }] }), /1件目/u],
      [JSON.stringify({ ...valid, prompts: [{ ...sample[0], hidden: 'no' }] }), /1件目/u],
    ];
    for (const [text, message] of cases) {
      expect(() => parseLibrary(text)).toThrow(LibraryFormatError);
      expect(() => parseLibrary(text)).toThrow(message);
    }
  });

  test('読み込んだ項目は決めた欄だけを持つ', () => {
    const text = JSON.stringify({
      ...emptyLibrary(),
      prompts: [{ ...sample[0], extra: true }],
    });
    expect(parseLibrary(text).prompts[0]).toEqual(sample[0]);
  });
});
