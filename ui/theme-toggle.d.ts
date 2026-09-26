export const THEME_KEY: string;

export interface ThemeToggleOptions {
  /** 既定は実行中のページの window。テストでは差し替える。 */
  window?: Window;
}

/** ヘッダーの .tb-theme-toggle ボタンに、配色の切り替えと保存した配色の反映を設定する。 */
export function setupThemeToggle(
  button: HTMLElement,
  options?: ThemeToggleOptions,
): void;
