// ホームのタイルの並び順と表示・非表示。使う人が変えられ、localStorage の toolbox-cards に残す。
// file:// の Chrome・Edge は版をまたいで保存領域を共有するため、新しい版でも引き継ぐ（旧 toolbox と同じキー・形）。
import { computed } from '@preact/signals';
import { storedSignal } from '../lib/storage';

export const CARDS_KEY = 'toolbox-cards';

export interface SavedCards {
  order?: string[];
  hidden?: string[];
}

/**
 * 保存した内容を今の一覧（ids は既定の順）に当てはめる。
 * 一覧にないツールは無視し、並べ替えた後に増えたツールは最後に表示する。
 */
export function arrangeCards(ids: readonly string[], saved: SavedCards | null) {
  const order = [...new Set(Array.isArray(saved?.order) ? saved.order : [])].filter((id) =>
    ids.includes(id),
  );
  order.push(...ids.filter((id) => !order.includes(id)));
  const hidden = new Set(Array.isArray(saved?.hidden) ? saved.hidden : []);
  return { order, hidden: new Set(ids.filter((id) => hidden.has(id))) };
}

/** 保存する内容。既定と同じ並び・全部表示なら null（記録を消し、以後の一覧の変更に従う）。 */
export function savedCards(
  ids: readonly string[],
  order: readonly string[],
  hidden: ReadonlySet<string>,
): SavedCards | null {
  const saved: SavedCards = {};
  if (order.some((id, i) => id !== ids[i])) saved.order = [...order];
  if (hidden.size) saved.hidden = ids.filter((id) => hidden.has(id));
  return Object.keys(saved).length ? saved : null;
}

function parse(text: string | null): SavedCards | null {
  if (text === null) return null;
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' ? (value as SavedCards) : null;
  } catch {
    return null;
  }
}

export function createCards(ids: readonly string[]) {
  const stored = storedSignal(CARDS_KEY, parse, (value) => (value ? JSON.stringify(value) : null));
  const arranged = computed(() => arrangeCards(ids, stored.value));
  return {
    arranged,
    /** 並びと非表示を保存する。既定と同じなら記録を消す。 */
    save(order: readonly string[], hidden: ReadonlySet<string>) {
      stored.set(savedCards(ids, order, hidden));
    },
    get customized() {
      const { order, hidden } = arranged.value;
      return savedCards(ids, order, hidden) !== null;
    },
    reset() {
      stored.set(null);
    },
  };
}
