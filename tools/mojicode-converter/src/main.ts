import '../../../ui/theme.css';
import './style.css';
import { setupToolHeader } from '../../../ui/header.js';
import { formatField, parseField, type CodeField } from './codec';
import { canListFonts, fontFamilyValue, listFontFamilies } from './fonts';
import { ShiftJisTable } from './sjis';

function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`画面の要素が見つかりません: ${selector}`);
  return element;
}
// 保存した配色を最初に反映する。
setupToolHeader($('.mc-header'));

const sjis = new ShiftJisTable();
const textInput = $<HTMLTextAreaElement>('#mc-text');
const fields = new Map(
  [...document.querySelectorAll<HTMLInputElement>('[data-field]')].map(
    (input) => [input.dataset.field as CodeField, input] as const,
  ),
);
const derived = $('#mc-derived');
const preview = $('#mc-preview');
let text = '';

function setStatus(
  field: CodeField,
  message = '',
  state?: 'error' | 'problem',
) {
  const status = $(`#mc-${field}-status`);
  status.textContent = message;
  if (state) status.dataset.state = state;
  else delete status.dataset.state;
  const input = fields.get(field)!;
  if (state === 'error') input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

/** 読めない入力の間は、ほかの欄を前の値のまま薄く表示する。 */
function setStale(except: CodeField | undefined) {
  for (const [field, input] of fields) {
    input.toggleAttribute(
      'data-stale',
      except !== undefined && field !== except,
    );
  }
  textInput.toggleAttribute('data-stale', except !== undefined);
  derived.toggleAttribute('data-stale', except !== undefined);
}

/** 文字列を全ての欄と大きな表示に反映する。except は利用者が書き換え中の欄で、書き方を保つため上書きしない。 */
function render(except?: CodeField | 'text') {
  if (except !== 'text') textInput.value = text;
  for (const [field, input] of fields) {
    if (field === except) {
      setStatus(field);
      continue;
    }
    const { value, problem } = formatField(field, text, sjis);
    input.value = value;
    setStatus(field, problem, problem ? 'problem' : undefined);
  }
  setStale(undefined);
  preview.textContent = text;
}

textInput.addEventListener('input', () => {
  text = textInput.value;
  render('text');
});

for (const [field, input] of fields) {
  input.addEventListener('input', () => {
    const result = parseField(field, input.value, sjis);
    if (!result.ok) {
      setStatus(field, result.error, 'error');
      setStale(field);
      return;
    }
    text = result.value;
    render(field);
  });
  // 書き終えたら、読めた値を決まった書き方にそろえる。
  input.addEventListener('change', () => {
    if (!input.hasAttribute('aria-invalid')) {
      input.value = formatField(field, text, sjis).value;
    }
  });
}

const fontInput = $<HTMLInputElement>('#mc-font');
const fontLoad = $<HTMLButtonElement>('#mc-font-load');
const fontStatus = $('#mc-font-status');
let installedFonts: Set<string> | undefined;
const fontHint = canListFonts()
  ? ''
  : 'このブラウザーではフォントの一覧を使えません。フォント名を入力して切り替えてください。';

function applyFont() {
  const value = fontFamilyValue(fontInput.value);
  if (value) derived.style.setProperty('--mc-font', value);
  else derived.style.removeProperty('--mc-font');
  const name = fontInput.value.trim();
  fontStatus.textContent =
    installedFonts && name && !installedFonts.has(name)
      ? '一覧にないフォント名です。PCに入っていないフォントは標準の書体で表示します。'
      : fontHint;
}
fontInput.addEventListener('input', applyFont);

if (canListFonts()) {
  fontLoad.hidden = false;
  fontLoad.addEventListener('click', async () => {
    fontLoad.disabled = true;
    try {
      const families = await listFontFamilies();
      $('#mc-font-list').replaceChildren(
        ...families.map((family) => new Option(family, family)),
      );
      installedFonts = new Set(families);
      fontLoad.hidden = true;
      fontInput.placeholder = '標準（一覧から選ぶか入力）';
      fontStatus.textContent = `${families.length}個のフォントを一覧にしました。フォント欄から選べます。`;
      fontInput.focus();
    } catch {
      fontStatus.textContent =
        'フォントの一覧を読み込めませんでした。フォント名を入力して切り替えてください。';
    } finally {
      fontLoad.disabled = false;
    }
  });
}
fontStatus.textContent = fontHint;

render();
