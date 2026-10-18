// 個別の編集（回転・切り抜き・書き込み）の取り消しとやり直し。画像ごとに、変える前の編集の写しを積む。
// 作業内容と同じく、ブラウザーには残さない。
import type { Edits } from './geometry';

/** 1枚の画像で取り消せる回数。 */
const LIMIT = 100;

export interface History {
  past: Edits[];
  future: Edits[];
}

export const emptyHistory = (): History => ({ past: [], future: [] });

export const snapshot = (edits: Edits): Edits => structuredClone(edits);

export const sameEdits = (a: Edits, b: Edits) => JSON.stringify(a) === JSON.stringify(b);

/** 変える前の編集を積む。新しく変えたら、やり直しの分は捨てる。 */
export function remember(history: History, before: Edits) {
  history.past.push(snapshot(before));
  if (history.past.length > LIMIT) history.past.shift();
  history.future = [];
}

/** 一つ前の編集を返す（今の編集はやり直しの分に積む）。取り消せなければ null。 */
export function undo(history: History, current: Edits): Edits | null {
  const previous = history.past.pop();
  if (!previous) return null;
  history.future.push(snapshot(current));
  return previous;
}

/** 取り消した編集を返す（今の編集は取り消しの分に積む）。やり直せなければ null。 */
export function redo(history: History, current: Edits): Edits | null {
  const next = history.future.pop();
  if (!next) return null;
  history.past.push(snapshot(current));
  return next;
}
