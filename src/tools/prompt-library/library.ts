/** 保存ファイルの名前。選んだフォルダの直下に置く。 */
export const LIBRARY_FILE = 'prompt-library.json';
/** 保存ファイルの形式の名前と版。形を変えるときは版を上げ、読み込みで区別する。 */
export const LIBRARY_FORMAT = 'toolbox-prompt-library';
export const LIBRARY_VERSION = 2;

export interface Prompt {
  /** 追加時に決め、以後変えない。編集・削除の対象を保存ファイルの中で探すのに使う。 */
  id: string;
  title: string;
  /** 一覧のカードに出す概要。空なら本文の先頭を出す。 */
  summary: string;
  body: string;
  tags: string[];
  /** 一覧に出さない。並び替え・表示の画面でだけ出す。 */
  hidden: boolean;
}

export interface Library {
  format: typeof LIBRARY_FORMAT;
  version: typeof LIBRARY_VERSION;
  prompts: Prompt[];
}

/** 編集画面で入れる項目。表示・非表示は並び替え・表示の画面で切り替える。 */
export type PromptInput = Pick<Prompt, 'title' | 'summary' | 'body' | 'tags'>;

/** 保存ファイルを読めない理由。画面にそのまま出す。 */
export class LibraryFormatError extends Error {
  override name = 'LibraryFormatError';
}

export function emptyLibrary(): Library {
  return { format: LIBRARY_FORMAT, version: LIBRARY_VERSION, prompts: [] };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * 保存ファイルの中身を検査して読む。読めない場合は上書きしないよう、推測で直さず例外にする。
 * 版1（概要・非表示・並び順を持たない）は、概要なし・表示・タイトル順にして読む。書き込むと版2になる。
 */
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
  const version = value.version;
  if ((version !== 1 && version !== LIBRARY_VERSION) || !Array.isArray(value.prompts)) {
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
      !item.tags.every((tag) => typeof tag === 'string') ||
      (version === LIBRARY_VERSION &&
        (typeof item.summary !== 'string' || typeof item.hidden !== 'boolean'))
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
      summary: version === 1 ? '' : (item.summary as string),
      body: item.body,
      tags: item.tags as string[],
      hidden: version === 1 ? false : (item.hidden as boolean),
    };
  });
  return {
    format: LIBRARY_FORMAT,
    version: LIBRARY_VERSION,
    // 版1は一覧をタイトル順に出していたため、その順を並び順として引き継ぐ。
    prompts: version === 1 ? sortPrompts(prompts) : prompts,
  };
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

/** タイトル順に並べる（同じタイトルは保存ファイルの順）。一覧は保存ファイルの順に出す。 */
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
  const summary = input.summary.replace(/\r\n?/gu, '\n').trim();
  const body = input.body.replace(/\r\n?/gu, '\n');
  if (title === '') return 'タイトルを入力してください。';
  if (body.trim() === '') return '本文を入力してください。';
  return { title, summary, body, tags: input.tags };
}

/** 追加は末尾に足す。 */
export function addPrompt(library: Library, input: PromptInput, id: string): Library {
  return { ...library, prompts: [...library.prompts, { id, ...input, hidden: false }] };
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
    prompts: library.prompts.map((prompt) => (prompt.id === id ? { ...prompt, ...input } : prompt)),
  };
}

/** 対象が保存ファイルにない（ほかの画面で削除された）場合は undefined。 */
export function setHidden(library: Library, id: string, hidden: boolean): Library | undefined {
  if (!library.prompts.some((prompt) => prompt.id === id)) return undefined;
  return {
    ...library,
    prompts: library.prompts.map((prompt) => (prompt.id === id ? { ...prompt, hidden } : prompt)),
  };
}

/**
 * id のプロンプトを、target の前か後ろへ動かす。位置ではなく相手の id で指すため、
 * ほかの画面で並びが変わっていても、見ていた並びのとおりに動かせる。どちらかがなければ変えない。
 */
export function movePrompt(
  library: Library,
  id: string,
  target: string,
  place: 'before' | 'after',
): Library {
  const moving = library.prompts.find((prompt) => prompt.id === id);
  if (!moving || id === target) return library;
  const rest = library.prompts.filter((prompt) => prompt.id !== id);
  const at = rest.findIndex((prompt) => prompt.id === target);
  if (at === -1) return library;
  rest.splice(place === 'before' ? at : at + 1, 0, moving);
  return { ...library, prompts: rest };
}

export function sortByTitle(library: Library): Library {
  return { ...library, prompts: sortPrompts(library.prompts) };
}

const sameContent = (a: Prompt, b: Prompt) =>
  a.title === b.title &&
  a.summary === b.summary &&
  a.body === b.body &&
  a.tags.join('\n') === b.tags.join('\n');

/**
 * 読み込んだプロンプトを末尾に足す。同じ内容（タイトル・概要・本文・タグ）がすでにあるものは足さない。
 * id が重なるものは新しい id にする。
 */
export function mergePrompts(
  library: Library,
  incoming: readonly Prompt[],
  newId: () => string,
): { library: Library; added: number; skipped: number } {
  const prompts = [...library.prompts];
  const ids = new Set(prompts.map((prompt) => prompt.id));
  let skipped = 0;
  for (const prompt of incoming) {
    if (prompts.some((existing) => sameContent(existing, prompt))) {
      skipped += 1;
      continue;
    }
    let id = prompt.id;
    while (ids.has(id)) id = newId();
    ids.add(id);
    prompts.push({ ...prompt, id });
  }
  return {
    library: { ...library, prompts },
    added: prompts.length - library.prompts.length,
    skipped,
  };
}

/** 今のプロンプトをすべて、読み込んだものに置き換える。 */
export function replacePrompts(library: Library, incoming: readonly Prompt[]): Library {
  return { ...library, prompts: [...incoming] };
}

/** エクスポートするファイルの名前。日付を入れ、何度書き出しても見分けられるようにする。 */
export function exportFileName(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `prompt-library-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

export function removePrompt(library: Library, id: string): Library {
  return {
    ...library,
    prompts: library.prompts.filter((prompt) => prompt.id !== id),
  };
}
