// 文字単位の差分（見本 → 入力）。Rust で書いた WebAssembly（wasm/src/lib.rs）を呼ぶ。
// cargo でのビルドは vite/rust.ts が行い、配布物では Vite が wasm を Base64 で JavaScript に埋め込む。
import initWasm from './wasm/target/wasm32-unknown-unknown/release/typing_diff.wasm?init';

/** 差分の1区切り。equal は両方にある文字、added は入力にだけある文字、removed は見本にだけある文字。数はコードポイントの数。 */
export interface Run {
  kind: 'equal' | 'added' | 'removed';
  count: number;
}

interface DiffExports {
  memory: WebAssembly.Memory;
  alloc(length: number): number;
  dealloc(pointer: number, length: number): void;
  diff(
    sample: number,
    sampleLength: number,
    input: number,
    inputLength: number,
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
 * 見本と入力の、文字（コードポイント）単位の差分。編集（追加と削除）の数が最小になる。
 * 続いている違いは、入力にだけある文字を先、見本にだけある文字を後に並べる。
 * 同期で計算する。timeout ミリ秒で計算しきれない場合と、まだ読み込んでいない場合は undefined。
 */
export function diffChars(
  sample: string,
  input: string,
  { timeout }: { timeout: number },
): Run[] | undefined {
  if (!wasm) return undefined;
  const { alloc, dealloc, diff, memory } = wasm;
  const store = (text: string) => {
    const codes = Uint32Array.from(text, (char) => char.codePointAt(0)!);
    const pointer = alloc(codes.length);
    // 確保でメモリーが広がると前の ArrayBuffer は使えなくなるため、確保のあとで作る。
    new Uint32Array(memory.buffer, pointer, codes.length).set(codes);
    return [pointer, codes.length] as const;
  };
  const [samplePointer, sampleLength] = store(sample);
  const [inputPointer, inputLength] = store(input);
  try {
    const result = diff(
      samplePointer,
      sampleLength,
      inputPointer,
      inputLength,
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
    dealloc(samplePointer, sampleLength);
    dealloc(inputPointer, inputLength);
  }
}
