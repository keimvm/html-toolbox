// 画面の配色（ライト・ダーク）。選ばない間は OS の設定に従う。
// 選んだ配色は localStorage の toolbox-theme に残し、ホームと全ツール・ほかの版で共有する。
// OS と同じ配色に戻したら記録を消し、以後は OS の設定に従う。
import { computed, signal } from '@preact/signals';
import { storedSignal } from './storage';

export const THEME_KEY = 'toolbox-theme';
export type Theme = 'light' | 'dark';

const system = matchMedia('(prefers-color-scheme: dark)');
const systemTheme = signal<Theme>(system.matches ? 'dark' : 'light');
system.addEventListener('change', () => {
  systemTheme.value = system.matches ? 'dark' : 'light';
});

const chosen = storedSignal<Theme | null>(
  THEME_KEY,
  (text) => (text === 'light' || text === 'dark' ? text : null),
  (value) => value,
);

/** 今の配色。 */
export const theme = computed<Theme>(() => chosen.value ?? systemTheme.value);

/** color-scheme を上書きし、light-dark() の配色を切り替える（theme.css）。 */
export function applyTheme(root = document.documentElement) {
  const value = chosen.value;
  if (value) root.dataset.tbTheme = value;
  else delete root.dataset.tbTheme;
}

export function toggleTheme() {
  const next: Theme = theme.value === 'dark' ? 'light' : 'dark';
  chosen.set(next === systemTheme.value ? null : next);
  applyTheme();
}

chosen.subscribe(() => applyTheme());
