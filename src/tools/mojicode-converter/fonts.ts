// フォントの選択。一覧は Local Font Access API（queryLocalFonts）で取得し、表示は CSS の font-family に任せる。

interface LocalFontData {
  family: string;
}

declare global {
  interface Window {
    queryLocalFonts?: () => Promise<LocalFontData[]>;
  }
}

export function canListFonts(win: Window = window): boolean {
  return typeof win.queryLocalFonts === 'function';
}

/** PC に入っているフォントのファミリー名（重複なし・名前順）。初回は利用者の許可が要る。 */
export async function listFontFamilies(
  win: Window = window,
): Promise<string[]> {
  if (!win.queryLocalFonts) throw new Error('フォントの一覧を使えません。');
  const fonts = await win.queryLocalFonts();
  return [...new Set(fonts.map((font) => font.family))].sort((a, b) =>
    a.localeCompare(b, 'ja'),
  );
}

/** 入力されたフォント名を font-family の値にする。空なら undefined（標準の書体）。 */
export function fontFamilyValue(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  const quoted = trimmed.replace(/[\\"]/gu, '\\$&').replace(/[\n\r\f]/gu, ' ');
  return `"${quoted}", var(--tb-font)`;
}
