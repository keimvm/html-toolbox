import { describe, expect, test } from 'vitest';
import {
  addPrompt,
  emptyLibrary,
  filterByTags,
  LibraryFormatError,
  normalizeInput,
  parseLibrary,
  parseTags,
  removePrompt,
  serializeLibrary,
  sortPrompts,
  updatePrompt,
  usedTags,
  type Library,
  type Prompt,
} from './library';

const prompt = (id: string, title: string, tags: string[] = []): Prompt => ({
  id,
  title,
  body: `${title}の本文`,
  tags,
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

  test('一覧はタイトル順で、数字は数の大きさで並べる', () => {
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
    expect(normalizeInput({ title: '  要約 ', body: 'a\r\nb\rc', tags: ['x'] })).toEqual({
      title: '要約',
      body: 'a\nb\nc',
      tags: ['x'],
    });
  });

  test('本文の前後の空白や改行は、貼り付けた結果を変えないよう残す', () => {
    expect(normalizeInput({ title: 't', body: '\n  〇〇\n', tags: [] })).toEqual({
      title: 't',
      body: '\n  〇〇\n',
      tags: [],
    });
  });

  test('タイトル・本文が空なら理由を返す。タグはなくてもよい', () => {
    expect(normalizeInput({ title: ' ', body: 'b', tags: [] })).toMatch(/タイトル/u);
    expect(normalizeInput({ title: 't', body: ' \n', tags: [] })).toMatch(/本文/u);
  });
});

describe('追加・編集・削除', () => {
  const library: Library = { ...emptyLibrary(), prompts: sample };

  test('追加は末尾に足し、元の内容を変えない', () => {
    const next = addPrompt(library, { title: '新規', body: '本文', tags: [] }, 'new');
    expect(next.prompts.at(-1)).toEqual({
      id: 'new',
      title: '新規',
      body: '本文',
      tags: [],
    });
    expect(library.prompts).toHaveLength(4);
  });

  test('編集は同じ id の項目だけを置き換え、ない id なら undefined', () => {
    const input = { title: '要約（改）', body: '新しい本文', tags: ['文章'] };
    const next = updatePrompt(library, '1', input);
    expect(next?.prompts[0]).toEqual({ id: '1', ...input });
    expect(next?.prompts.slice(1)).toEqual(sample.slice(1));
    expect(updatePrompt(library, 'missing', input)).toBeUndefined();
  });

  test('削除は同じ id の項目だけを除く', () => {
    expect(removePrompt(library, '2').prompts.map((p) => p.id)).toEqual(['1', '3', '4']);
  });
});

describe('保存ファイルの形', () => {
  test('書き出した内容を読み戻すと同じになる', () => {
    const library: Library = {
      ...emptyLibrary(),
      prompts: [{ ...sample[0]!, body: '1行目\n「〇〇」について\t"引用"' }],
    };
    const text = serializeLibrary(library);
    expect(text.endsWith('\n')).toBe(true);
    expect(parseLibrary(text)).toEqual(library);
    expect(JSON.parse(text)).toMatchObject({
      format: 'toolbox-prompt-library',
      version: 1,
    });
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
      [JSON.stringify({ ...valid, version: 2 }), /新しい版/u],
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
