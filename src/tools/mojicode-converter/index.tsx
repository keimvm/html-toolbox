// 文字コード変換。文字を入れるとコードの値が分かり、コードの値を入れるとどの文字か分かる。
// 欄ごとに文字コードを決め、入力の意味を推測しない。読めない値は推測で別の文字にせず、どこが読めないかを示す。
// 入力した内容は保存しない。
import { computed, signal } from '@preact/signals';
import { ToolFrame } from '../../app/frame';
import type { Incoming, ToolDefinition } from '../../app/tool';
import { copyText } from '../../lib/clipboard';
import { Button, IconButton, toast } from '../../ui/components';
import { codePoints, formatField, parseField, type CodeField } from './codec';
import { canListFonts, fontFamilyValue, listFontFamilies } from './fonts';
import { ShiftJisTable } from './sjis';
import icon from './icon.png';
import './style.css';

/** 調べる文字の数の目安。長い文章は欄が読みにくくなるため、ホームからは受け取らない。 */
const MAX_INSPECT = 400;

const FIELDS: { field: CodeField; label: string; note?: string; placeholder: string }[] = [
  { field: 'codepoint', label: 'Unicode の番号', placeholder: '例：U+3042' },
  { field: 'utf8', label: 'UTF-8', note: 'バイト', placeholder: '例：E3 81 82' },
  { field: 'utf16', label: 'UTF-16', note: '符号単位', placeholder: '例：3042' },
  { field: 'sjis', label: 'Shift_JIS', note: 'Windows（CP932）', placeholder: '例：82 A0' },
];

function create() {
  // ブラウザー標準の TextDecoder('shift_jis') で、最初に開いたときに表を作る。
  const sjis = new ShiftJisTable();
  const text = signal('');
  /** 書き換え中の欄。書き方を保つため、ほかの欄だけを更新する。読めないときは error を持つ。 */
  const editing = signal<{ field: CodeField; raw: string; error?: string } | null>(null);
  const font = signal('');
  const fonts = signal<Set<string> | null>(null);
  const fontMessage = signal(
    canListFonts()
      ? ''
      : 'このブラウザーではフォントの一覧を使えません。フォント名を入力して切り替えてください。',
  );
  const status = computed(() => {
    const chars = codePoints(text.value);
    if (!chars.length) return {};
    const shown = [...text.value].slice(0, 10).join('');
    return { summary: `「${shown}${chars.length > 10 ? '…' : ''}」（${chars.length}文字）` };
  });

  function edit(field: CodeField, raw: string) {
    const result = parseField(field, raw, sjis);
    if (!result.ok) {
      editing.value = { field, raw, error: result.error };
      return;
    }
    text.value = result.value;
    editing.value = { field, raw };
  }

  async function loadFonts() {
    try {
      const families = await listFontFamilies();
      fonts.value = new Set(families);
      fontMessage.value = `${families.length}個のフォントを一覧にしました。フォント欄から選べます。`;
    } catch {
      fontMessage.value =
        'フォントの一覧を読み込めませんでした。フォント名を入力して切り替えてください。';
    }
  }

  function View() {
    const current = editing.value;
    const stale = Boolean(current?.error);
    const fontName = font.value.trim();
    const unknownFont = fonts.value && fontName && !fonts.value.has(fontName);
    return (
      <ToolFrame>
        <div class="mc">
          <section class="mc-panel mc-codes" aria-labelledby="mc-codes-title">
            <h2 id="mc-codes-title" class="mc-title">
              文字と文字コード
            </h2>
            <label class="mc-text-label" for="mc-text">
              文字
            </label>
            <textarea
              id="mc-text"
              class="tb-input mc-text"
              rows={2}
              placeholder="例：あ"
              spellcheck={false}
              autocomplete="off"
              data-stale={stale ? '' : undefined}
              value={text.value}
              onInput={(event) => {
                text.value = (event.target as HTMLTextAreaElement).value;
                editing.value = null;
              }}
            />
            <div class="mc-fields">
              {FIELDS.map(({ field, label, note, placeholder }) => {
                const own = current?.field === field;
                const formatted = formatField(field, text.value, sjis);
                const value = own ? current.raw : formatted.value;
                const message = own ? current.error : formatted.problem;
                return (
                  <div class="mc-field" key={field}>
                    <label for={`mc-${field}`}>
                      {label}
                      {note && <span>{note}</span>}
                    </label>
                    <div class="mc-field-row">
                      <input
                        id={`mc-${field}`}
                        class="tb-input mc-code"
                        placeholder={placeholder}
                        spellcheck={false}
                        autocomplete="off"
                        value={value}
                        aria-invalid={own && current.error ? 'true' : undefined}
                        aria-describedby={`mc-${field}-status`}
                        data-stale={stale && !own ? '' : undefined}
                        onInput={(event) => edit(field, (event.target as HTMLInputElement).value)}
                        // 書き終えたら、読めた値を決まった書き方にそろえる。
                        onChange={() => {
                          if (editing.value?.field === field && !editing.value.error)
                            editing.value = null;
                        }}
                      />
                      <IconButton
                        icon="copy"
                        label={`${label}の値をコピー`}
                        disabled={!value || (own && Boolean(current.error))}
                        onClick={async () => {
                          if (await copyText(value))
                            toast(`${label}の値をコピーしました。`, { tone: 'success' });
                          else
                            toast('コピーできませんでした。欄を選択してコピーしてください。', {
                              tone: 'error',
                            });
                        }}
                      />
                    </div>
                    <p
                      class="mc-status"
                      id={`mc-${field}-status`}
                      data-state={own && current.error ? 'error' : message ? 'problem' : undefined}
                    >
                      {message}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>

          <section
            class="mc-panel mc-view"
            aria-labelledby="mc-view-title"
            data-stale={stale ? '' : undefined}
          >
            <div class="mc-view-head">
              <h2 id="mc-view-title" class="mc-title">
                大きく表示
              </h2>
              <div class="mc-font">
                <label for="mc-font" class="tb-sr">
                  フォント
                </label>
                <input
                  id="mc-font"
                  class="tb-input"
                  list="mc-font-list"
                  placeholder={
                    fonts.value ? '標準（一覧から選ぶか入力）' : '標準（フォント名を入力）'
                  }
                  spellcheck={false}
                  autocomplete="off"
                  aria-describedby="mc-font-status"
                  value={font.value}
                  onInput={(event) => (font.value = (event.target as HTMLInputElement).value)}
                />
                <datalist id="mc-font-list">
                  {[...(fonts.value ?? [])].map((family) => (
                    <option key={family} value={family} />
                  ))}
                </datalist>
                {canListFonts() && !fonts.value && (
                  <Button variant="quiet" onClick={loadFonts}>
                    PCのフォントを一覧にする
                  </Button>
                )}
              </div>
            </div>
            <p class="mc-status" id="mc-font-status">
              {unknownFont
                ? '一覧にないフォント名です。PCに入っていないフォントは標準の書体で表示します。'
                : fontMessage.value}
            </p>
            <div
              class="mc-preview"
              lang="ja"
              style={{ fontFamily: fontFamilyValue(font.value) ?? undefined }}
              data-empty={text.value ? undefined : ''}
            >
              {text.value || '文字を入れると、ここに大きく表示します'}
            </div>
          </section>
        </div>
      </ToolFrame>
    );
  }

  return {
    View,
    status,
    receive(_intent: string, input: Incoming) {
      if (input.kind === 'text') {
        text.value = input.text;
        editing.value = null;
      }
    },
  };
}

export const mojicodeConverter: ToolDefinition = {
  id: 'mojicode-converter',
  name: '文字コード変換',
  description:
    '文字とコードの値（Unicode・UTF-8・UTF-16・Shift_JIS）を、どちら向きにも変換して確かめられます。',
  icon,
  intents: [
    {
      id: 'inspect',
      label: '文字コードを調べる',
      detail: '文字コード変換：Unicode・UTF-8・UTF-16・Shift_JIS の値',
      icon: 'type',
      accepts: (input) =>
        input.kind === 'text' &&
        input.text.trim() !== '' &&
        codePoints(input.text).length <= MAX_INSPECT,
    },
  ],
  create,
};
