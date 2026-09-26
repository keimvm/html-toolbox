// ヘッダーのボタンで画面の配色（ライト・ダーク）を切り替える。
// 選ばない間は OS の設定に従う。選んだ配色は localStorage に残し、file:// の入口ページ・全ツールで共有する。

export const THEME_KEY = 'toolbox-theme';

export function setupThemeToggle(button, { window: win = globalThis.window } = {}) {
  const root = win.document.documentElement;
  const system = win.matchMedia('(prefers-color-scheme: dark)');
  // 保存できない環境でも、開いている画面の中では切り替えられるようにする。
  let unsaved = null;
  const systemTheme = () => (system.matches ? 'dark' : 'light');
  function chosenTheme() {
    try {
      const value = win.localStorage.getItem(THEME_KEY);
      return value === 'light' || value === 'dark' ? value : null;
    } catch {
      return unsaved;
    }
  }
  function render() {
    const chosen = chosenTheme();
    // color-scheme を上書きし、light-dark() の配色を切り替える（ui/theme.css）。
    if (chosen) root.dataset.tbTheme = chosen;
    else delete root.dataset.tbTheme;
    const theme = chosen ?? systemTheme();
    const label = theme === 'dark' ? 'ライトモードにする' : 'ダークモードにする';
    button.dataset.tbTheme = theme;
    button.setAttribute('aria-label', label);
    button.title = label;
  }
  button.addEventListener('click', () => {
    const next = button.dataset.tbTheme === 'dark' ? 'light' : 'dark';
    // OS と同じ配色に戻したら、以後は OS の設定に従う。
    unsaved = next === systemTheme() ? null : next;
    try {
      if (unsaved) win.localStorage.setItem(THEME_KEY, unsaved);
      else win.localStorage.removeItem(THEME_KEY);
    } catch {
      // 保存できなくても、この画面の表示は切り替える。
    }
    render();
  });
  system.addEventListener('change', render);
  // 別のタブで開いている入口ページ・ツールで切り替えた配色に合わせる。
  win.addEventListener('storage', (event) => {
    if (event.key === THEME_KEY || event.key === null) render();
  });
  render();
}
