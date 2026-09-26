export interface ToolHeaderOptions {
  /** 既定は実行中のページの window。テストでは差し替える。 */
  window?: Window;
}

/** 共通ヘッダー（.tb-header）のアイコンを favicon にし、配色の切り替えを設定する。 */
export function setupToolHeader(
  header: Element,
  options?: ToolHeaderOptions,
): void;
