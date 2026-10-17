/** 配布の版（YYYY.MM.DD）。開発中は 'dev'。vite.config.ts が埋め込む。 */
declare const __TOOLBOX_VERSION__: string;

declare module 'virtual:toolbox/payload' {
  export type PayloadName = 'pdfium' | 'font-jp';
  export type PayloadSource = { kind: 'gzip-base64'; text: string } | { kind: 'url'; url: string };
  /** HTML の末尾に埋め込んだバイナリ（開発中はファイルの URL）。vite/toolbox.ts が作る。 */
  export function payloadSource(name: PayloadName): PayloadSource;
}

declare module 'virtual:toolbox/licenses' {
  /** 配布物に入ったライブラリのライセンス文。 */
  export function licenses(): string;
}
