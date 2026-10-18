// OS の違いと、キー操作・貼り付けの受け取り。キーボードの表記（⌘ と Ctrl）などに使う。
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** ⌘（Mac）または Ctrl（Windows）。 */
export const modKey = isMac ? '⌘' : 'Ctrl';
export const hasMod = (event: KeyboardEvent | MouseEvent) =>
  isMac ? event.metaKey : event.ctrlKey;
/** キー操作・貼り付けの対象が入力欄・編集領域か。そうなら画面全体のショートカットや貼り付けの受け取りを譲る。 */
export const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
export const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
