// 2つの並びの差分（前 → 後）。Rust で書いた WebAssembly（wasm/src/lib.rs）を呼ぶ。
// タイピングゲーム（見本と入力の文字）と文章比較（行・書記素）が使う。
// cargo でのビルドは vite/rust.ts が行い、配布物では Vite が wasm を Base64 で JavaScript に埋め込む。
import initWasm from './wasm/target/wasm32-unknown-unknown/release/text_diff.wasm?init';

/** 差分の1区切り。equal は両方にあるもの、added は後にだけあるもの、removed は前にだけあるもの。数は要素の数。 */
export interface Run {
  kind: 'equal' | 'added' | 'removed';
  count: number;
}

interface DiffExports {
  memory: WebAssembly.Memory;
  alloc(length: number): number;
  dealloc(pointer: number, length: number): void;
  diff(
    before: number,
    beforeLength: number,
    after: number,
    afterLength: number,
    deadline: number,
  ): number;
}

/** Rust の区切りの種類（`数 << 2 | 種類`）の順。 */
const KINDS = ['equal', 'added', 'removed'] as const;

let wasm: DiffExports | undefined;
let loading: Promise<void> | undefined;

/** WebAssembly を読み込む。何度呼んでも読み込むのは1回だけ。 */
export function loadDiff(): Promise<void> {
  // 期限は Rust から Date.now() を呼んで確かめる。テストで時刻を差し替えられるよう、呼ぶたびに引く。
  loading ??= initWasm({ env: { now: () => Date.now() } }).then((instance) => {
    wasm = instance.exports as unknown as DiffExports;
  });
  return loading;
}

/**
 * 2つの数の並びの差分。編集（追加と削除）の数が最小になる。
 * 続いている違いは、後にだけあるもの（added）を先、前にだけあるもの（removed）を後に並べる。
 * 同期で計算する。timeout ミリ秒で計算しきれない場合と、まだ読み込んでいない場合は undefined。
 */
export function diffCodes(
  before: ArrayLike<number>,
  after: ArrayLike<number>,
  { timeout }: { timeout: number },
): Run[] | undefined {
  if (!wasm) return undefined;
  const { alloc, dealloc, diff, memory } = wasm;
  const store = (codes: ArrayLike<number>) => {
    const pointer = alloc(codes.length);
    // 確保でメモリーが広がると前の ArrayBuffer は使えなくなるため、確保のあとで作る。
    new Uint32Array(memory.buffer, pointer, codes.length).set(codes);
    return [pointer, codes.length] as const;
  };
  const [beforePointer, beforeLength] = store(before);
  const [afterPointer, afterLength] = store(after);
  try {
    const result = diff(
      beforePointer,
      beforeLength,
      afterPointer,
      afterLength,
      Date.now() + timeout,
    );
    if (!result) return undefined;
    const length = new Uint32Array(memory.buffer, result, 1)[0]!;
    const runs = Array.from(new Uint32Array(memory.buffer, result + 4, length), (run) => ({
      kind: KINDS[run & 3]!,
      count: run >>> 2,
    }));
    dealloc(result, length + 1);
    return runs;
  } finally {
    dealloc(beforePointer, beforeLength);
    dealloc(afterPointer, afterLength);
  }
}

/** 文字（コードポイント）単位の差分。数はコードポイントの数。 */
export function diffChars(
  before: string,
  after: string,
  options: { timeout: number },
): Run[] | undefined {
  const codes = (text: string) => Uint32Array.from(text, (char) => char.codePointAt(0)!);
  return diffCodes(codes(before), codes(after), options);
}

/** 文字列の並び（行・書記素など）の差分。同じ文字列を同じものとして比べる。数は要素の数。 */
export function diffTokens(
  before: readonly string[],
  after: readonly string[],
  options: { timeout: number },
): Run[] | undefined {
  const ids = new Map<string, number>();
  const codes = (tokens: readonly string[]) =>
    Uint32Array.from(tokens, (token) => {
      let id = ids.get(token);
      if (id === undefined) ids.set(token, (id = ids.size));
      return id;
    });
  return diffCodes(codes(before), codes(after), options);
}
