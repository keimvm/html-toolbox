// ツール画面の共通ヘッダー（ui/theme.css の .tb-header）を動かす。
import { setupThemeToggle } from './theme-toggle.js';

/** ヘッダーのアイコンをタブのアイコン（favicon）にも使い、配色の切り替えを設定する。 */
export function setupToolHeader(header, { window: win = globalThis.window } = {}) {
  const icon = header.querySelector('.tb-header-icon');
  const toggle = header.querySelector('.tb-theme-toggle');
  if (!icon || !toggle) {
    throw new Error('共通ヘッダーに .tb-header-icon と .tb-theme-toggle が必要です。');
  }
  const { document } = win;
  let favicon = document.querySelector('link[rel="icon"]');
  if (!favicon) {
    favicon = document.createElement('link');
    favicon.rel = 'icon';
    document.head.append(favicon);
  }
  favicon.href = icon.getAttribute('src');
  setupThemeToggle(toggle, { window: win });
}
