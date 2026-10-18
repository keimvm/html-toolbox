// localStorage の読み書き。保存できない環境（プライベートウィンドウの制限など）でも、
// 開いている画面の中では値を覚えておき、操作を続けられるようにする。
// file:// の Chrome・Edge は保存領域を共有するため、版（解凍先のフォルダ）をまたいで同じ値になる。
import { signal, type Signal } from '@preact/signals';

/**
 * localStorage に書けなかった値。容量不足などで書き込みだけが失敗すると localStorage には古い値が残るため、
 * 読むときはこちらを先に使う。
 */
const memory = new Map<string, string | null>();

export function readStored(key: string): string | null {
  if (memory.has(key)) return memory.get(key) ?? null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    memory.delete(key);
  } catch {
    // 保存できなくても、この画面の中では切り替える。
    memory.set(key, value);
  }
}

/**
 * localStorage の1つのキーを signal にする。別のタブで変えた値にも追従する。
 * parse は保存された文字列（なければ null）を値にし、serialize は値を文字列（消すなら null）にする。
 */
export function storedSignal<T>(
  key: string,
  parse: (text: string | null) => T,
  serialize: (value: T) => string | null,
): Signal<T> & { set(value: T): void } {
  const state = signal(parse(readStored(key)));
  addEventListener('storage', (event) => {
    if (event.key !== key && event.key !== null) return;
    // 別のタブが保存した値に合わせる。
    memory.delete(key);
    state.value = parse(readStored(key));
  });
  return Object.assign(state, {
    set(value: T) {
      writeStored(key, serialize(value));
      state.value = parse(readStored(key));
    },
  });
}
