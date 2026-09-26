import '../../../ui/theme.css';
import './style.css';
import { setupToolHeader } from '../../../ui/header.js';
import {
  codePoints,
  formatBytes,
  formatField,
  formatUtf16,
  parseField,
  utf8Of,
  type CodeField,
} from './codec';
import { canListFonts, fontFamilyValue, listFontFamilies } from './fonts';
import { notations } from './notation';
import { traitsOf, type CharTraits } from './props';
import { formatCodePoint } from './result';
import { formatShiftJisCode, ShiftJisTable } from './sjis';

function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`画面の要素が見つかりません: ${selector}`);
  return element;
}
// 保存した配色を最初に反映する。
setupToolHeader($('.mc-header'));

/** 一覧に並べる文字数の上限。長い文章でも画面が重くならないようにする。 */
const ROW_LIMIT = 1000;

const sjis = new ShiftJisTable();
const textInput = $<HTMLTextAreaElement>('#mc-text');
const fields = new Map(
  [...document.querySelectorAll<HTMLInputElement>('[data-field]')].map(
    (input) => [input.dataset.field as CodeField, input] as const,
  ),
);
const derived = $('#mc-derived');
const preview = $('#mc-preview');
const rows = $('#mc-rows');
const notationList = $('#mc-notations');
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

/** 文字列を全ての欄と一覧に反映する。except は利用者が書き換え中の欄で、書き方を保つため上書きしない。 */
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
  renderNotations();
  renderRows();
}

const notationInputs = notations('', sjis).map(({ label }) => {
  const row = document.createElement('label');
  row.className = 'mc-notation';
  const name = document.createElement('span');
  name.textContent = label;
  const input = document.createElement('input');
  input.className = 'tb-input mc-code';
  input.readOnly = true;
  input.addEventListener('focus', () => input.select());
  row.append(name, input);
  notationList.append(row);
  return input;
});

function renderNotations() {
  notations(text, sjis).forEach(({ value }, index) => {
    const input = notationInputs[index]!;
    input.value = value ?? '';
    input.placeholder =
      text && value === undefined ? '表せない文字を含みます' : '';
  });
}

function cell(
  content: string | Node,
  className?: string,
): HTMLTableCellElement {
  const td = document.createElement('td');
  if (className) td.className = className;
  td.append(content);
  return td;
}

function span(content: string, className: string): HTMLSpanElement {
  const element = document.createElement('span');
  element.className = className;
  element.textContent = content;
  return element;
}

const INVISIBLE: Record<number, string> = {
  0x09: 'タブ',
  0x0a: '改行（LF）',
  0x0d: '復帰（CR）',
  0x20: '半角空白',
  0x3000: '全角空白',
};

/** 見えない文字は名前で、結合文字は点線の丸に重ねて示す。 */
function glyph(codePoint: number, traits: CharTraits): HTMLElement {
  const label =
    INVISIBLE[codePoint] ??
    ([
      '制御文字',
      '書式文字',
      '異体字セレクター',
      'サロゲート（単独）',
      '未割り当て',
      '空白',
      '区切り',
    ].includes(traits.kind)
      ? traits.kind
      : undefined);
  if (label) return span(label, 'mc-invisible');
  const char = String.fromCodePoint(codePoint);
  return span(traits.kind === '結合文字' ? `◌${char}` : char, 'mc-glyph');
}

function traitChips(traits: CharTraits): HTMLElement {
  const chips = document.createElement('span');
  chips.className = 'mc-chips';
  const add = (label: string, warn = false) =>
    chips.append(span(label, warn ? 'mc-chip mc-chip-warn' : 'mc-chip'));
  add(traits.kind);
  if (traits.width) add(traits.width);
  if (traits.sjis === undefined) add('Shift_JIS で表せない', true);
  else if (traits.vendor === '外字') add('外字', true);
  else if (traits.vendor) add(`機種依存（${traits.vendor}）`, true);
  return chips;
}

function shiftJisCell(traits: CharTraits): HTMLTableCellElement {
  if (traits.sjis === undefined) return cell(span('表せない', 'mc-missing'));
  const td = cell(formatShiftJisCode(traits.sjis), 'mc-code');
  if (traits.sjisOthers.length) {
    td.append(
      span(
        `ほかに ${traits.sjisOthers.map(formatShiftJisCode).join('、')}`,
        'mc-others',
      ),
    );
  }
  return td;
}

function renderRows() {
  const points = codePoints(text);
  const fragment = document.createDocumentFragment();
  for (const codePoint of points.slice(0, ROW_LIMIT)) {
    const traits = traitsOf(codePoint, sjis);
    const utf8 = utf8Of(codePoint);
    const tr = document.createElement('tr');
    tr.append(
      cell(glyph(codePoint, traits), 'mc-char'),
      cell(formatCodePoint(codePoint), 'mc-code'),
      utf8
        ? cell(formatBytes(utf8), 'mc-code')
        : cell(span('表せない', 'mc-missing')),
      cell(formatUtf16(String.fromCodePoint(codePoint)), 'mc-code'),
      shiftJisCell(traits),
      cell(traitChips(traits)),
    );
    fragment.append(tr);
  }
  rows.replaceChildren(fragment);
  $('#mc-empty').hidden = points.length > 0;
  $('#mc-count').textContent =
    points.length > ROW_LIMIT
      ? `${points.length}文字（先頭${ROW_LIMIT}文字を表示）`
      : points.length
        ? `${points.length}文字`
        : '';
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
