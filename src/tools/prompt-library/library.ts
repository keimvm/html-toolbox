/** 保存ファイルの名前。選んだフォルダの直下に置く。 */
export const LIBRARY_FILE = 'prompt-library.json';
/** 保存ファイルの形式の名前と版。形を変えるときは版を上げ、読み込みで区別する。 */
export const LIBRARY_FORMAT = 'toolbox-prompt-library';
export const LIBRARY_VERSION = 1;

export interface Prompt {
  /** 追加時に決め、以後変えない。編集・削除の対象を保存ファイルの中で探すのに使う。 */
  id: string;
  title: string;
  body: string;
  tags: string[];
}

export interface Library {
  format: typeof LIBRARY_FORMAT;
  version: typeof LIBRARY_VERSION;
  prompts: Prompt[];
}

export type PromptInput = Omit<Prompt, 'id'>;

/** 保存ファイルを読めない理由。画面にそのまま出す。 */
export class LibraryFormatError extends Error {
  override name = 'LibraryFormatError';
}

export function emptyLibrary(): Library {
  return { format: LIBRARY_FORMAT, version: LIBRARY_VERSION, prompts: [] };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 保存ファイルの中身を検査して読む。読めない場合は上書きしないよう、推測で直さず例外にする。 */
export function parseLibrary(text: string): Library {
  // 作成直後に書き込みが止まった空のファイルは、失う内容がないため新しい保存ファイルとして扱う。
  if (text.trim() === '') return emptyLibrary();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new LibraryFormatError('JSON として読めません。');
  }
  if (!isRecord(value) || value.format !== LIBRARY_FORMAT) {
    throw new LibraryFormatError('プロンプト集の保存ファイルではありません。');
  }
  if (typeof value.version !== 'number' || value.version > LIBRARY_VERSION) {
    throw new LibraryFormatError(
      '新しい版のツールで保存された形式です。新しい版の toolbox で開いてください。',
    );
  }
  if (value.version !== LIBRARY_VERSION || !Array.isArray(value.prompts)) {
    throw new LibraryFormatError('形式が正しくありません。');
  }
  const ids = new Set<string>();
  const prompts = value.prompts.map((item: unknown, index): Prompt => {
    const where = `${index + 1}件目のプロンプト`;
    if (
      !isRecord(item) ||
      typeof item.id !== 'string' ||
      item.id === '' ||
      typeof item.title !== 'string' ||
      typeof item.body !== 'string' ||
      !Array.isArray(item.tags) ||
      !item.tags.every((tag) => typeof tag === 'string')
    ) {
      throw new LibraryFormatError(`${where}の形式が正しくありません。`);
    }
    if (ids.has(item.id)) {
      throw new LibraryFormatError(`${where}の id が重複しています。`);
    }
    ids.add(item.id);
    return {
      id: item.id,
      title: item.title,
      body: item.body,
      tags: item.tags as string[],
    };
  });
  return { format: LIBRARY_FORMAT, version: LIBRARY_VERSION, prompts };
}

export function serializeLibrary(library: Library): string {
  return `${JSON.stringify(library, null, 2)}\n`;
}

/** タグの入力欄の文字列を、空白・カンマ・読点で区切ったタグの並びにする。重複は最初の1つだけ残す。 */
export function parseTags(text: string): string[] {
  return [
    ...new Set(
      text
        .normalize('NFC')
        .split(/[\s,，、]+/u)
        .filter((tag) => tag !== ''),
    ),
  ];
}

export function formatTags(tags: readonly string[]): string {
  return tags.join(' ');
}

const collator = new Intl.Collator('ja', { numeric: true });

/** 一覧はタイトル順に並べる（同じタイトルは保存ファイルの順）。 */
export function sortPrompts(prompts: readonly Prompt[]): Prompt[] {
  return [...prompts].sort((a, b) => collator.compare(a.title, b.title));
}

/** 使われているタグを、名前順に重複なく並べる。 */
export function usedTags(prompts: readonly Prompt[]): string[] {
  return [...new Set(prompts.flatMap((prompt) => prompt.tags))].sort(collator.compare);
}

/** 選んだタグをすべて含むプロンプトだけを返す（AND）。何も選ばなければ全件。 */
export function filterByTags(prompts: readonly Prompt[], selected: ReadonlySet<string>): Prompt[] {
  return prompts.filter((prompt) => [...selected].every((tag) => prompt.tags.includes(tag)));
}

/** 入力を保存できる形に整える。タイトルと本文が空なら理由を返す。 */
export function normalizeInput(input: PromptInput): PromptInput | string {
  const title = input.title.trim();
  const body = input.body.replace(/\r\n?/gu, '\n');
  if (title === '') return 'タイトルを入力してください。';
  if (body.trim() === '') return '本文を入力してください。';
  return { title, body, tags: input.tags };
}

export function addPrompt(library: Library, input: PromptInput, id: string): Library {
  return { ...library, prompts: [...library.prompts, { id, ...input }] };
}

/** 対象が保存ファイルにない（ほかの画面で削除された）場合は undefined。 */
export function updatePrompt(
  library: Library,
  id: string,
  input: PromptInput,
): Library | undefined {
  if (!library.prompts.some((prompt) => prompt.id === id)) return undefined;
  return {
    ...library,
    prompts: library.prompts.map((prompt) => (prompt.id === id ? { id, ...input } : prompt)),
  };
}

export function removePrompt(library: Library, id: string): Library {
  return {
    ...library,
    prompts: library.prompts.filter((prompt) => prompt.id !== id),
  };
}
