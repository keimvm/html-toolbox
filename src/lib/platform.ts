// OS の違い。キーボードの表記（⌘ と Ctrl）などに使う。
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
/** ⌘（Mac）または Ctrl（Windows）。 */
export const modKey = isMac ? '⌘' : 'Ctrl';
export const hasMod = (event: KeyboardEvent | MouseEvent) =>
  isMac ? event.metaKey : event.ctrlKey;
export const prefersReducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
