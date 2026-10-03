# 画像変換ツール 技術構成

元の企画書：[requirements.md](requirements.md)。満たす要件は [software-requirements.md](software-requirements.md) を参照。

## 選定に関わる制約

- toolbox 共通の制約（[要件の制約](software-requirements.md#制約)）と[ツール追加の手順](../../../docs/development.md#ツールを追加する)に従う。
- 標準機能・既存ライブラリ・`ui/` を優先し、自前実装は固有要件に絞る（[実装方針](../../../docs/development.md#実装方針)）。PDF の処理は EmbedPDF/PDFium を使う。
- 元のファイルを書き換えない。保存はダウンロードだけで行う。

## 採用する技術

| 担当 | 技術 | 役割・採用理由 |
| --- | --- | --- |
| 画面・処理 | TypeScript ＋ HTML ＋ CSS | 他ツールと同じ構成。UI フレームワークは使わない |
| ビルド | Vite ＋ vite-plugin-singlefile | 単一 HTML にまとめる。PDF編集の WASM・Worker・フォントの埋め込み方を流用できる |
| PDF の読み書き・描画 | `@embedpdf/engines`・`@embedpdf/pdfium`・`@embedpdf/models`（2.15.0） | PDF編集と同じ版。PDF → 画像はエンジンの描画、画像 → PDF と PDF 内の画像の差し替えは PDFium の公開 API を使う |
| 日本語フォント | `@embedpdf/fonts-jp`（1.0.0、Noto Sans JP Regular） | フォントを含まない PDF を画像にしたとき、日本語が欠けないようにする。配布 HTML が約 6MB 増える（PDF編集の配布 HTML は約 19MB） |
| 共通 UI | `ui/`（`theme.css`・`header.js`・`file-drop.js`・`download.js`） | 共通ヘッダー、ドロップの受け付け、ダウンロード |
| 自動テスト | Vitest | 容量合わせ・付加情報の削除・PDF の作成と縮小の検査 |
| 依存管理 | pnpm（`packageManager` で固定）、Node.js（`.node-version` で固定） | ツール追加の手順に従う |

以下はブラウザーの標準機能でまかない、ライブラリを追加しない。

| 役割 | 標準機能 | 補足 |
| --- | --- | --- |
| 画像の読み込み・向きの補正 | `createImageBitmap`（`imageOrientation: 'from-image'`） | Exif の回転指定どおりの向きで読む。HEIC は読めないため案内を出す |
| リサイズ・切り抜き・回転・塗りつぶし | Canvas（`OffscreenCanvas` を含む） | 描画し直した画素だけを書き出す |
| JPEG・PNG の書き出し | `convertToBlob`・`toBlob` | JPEG は画質（0〜1）を指定できる。書き出し直すため付加情報は残らない |
| 容量の上限合わせ | 上記の書き出しの繰り返し | 画質を変えて書き出しを繰り返し、上限以下で最も高い画質を選ぶ |
| 画面を離れるときの確認 | `beforeunload` | 未保存の作業があるときだけ確認を出す |

使わないもの：Exif の読み書き、zip 作成、HEIC の読み込み、WebP・AVIF の書き出しのためのライブラリ。いずれも要件で扱わないと決めたため。

## PDF の処理

- **PDF → 画像**：PDF編集と同じく、エンジンの公開 API でページを描画し、Canvas で JPEG・PNG に書き出す。
- **画像 → PDF**：PDFium の `FPDF_CreateNewDocument`・`FPDFPage_New`・`FPDFPageObj_NewImageObj`・`FPDFImageObj_LoadJpegFileInline`（JPEG）・`FPDFImageObj_SetBitmap`（PNG）・`FPDFImageObj_SetMatrix`・`FPDFPage_InsertObject`・`FPDFPage_GenerateContent`・`FPDF_SaveAsCopy` を使う。ページの大きさは画像に合わせる。
- **重い PDF を小さくする**：ページの画像オブジェクトを列挙し、描画結果（`FPDFImageObj_GetBitmap` など）を Canvas で縮めて JPEG にし、`FPDFImageObj_LoadJpegFileInline` で差し替えて保存する。文字・図形のオブジェクトには触れない。
- EmbedPDF の高水準 API には、文書の作成（`createDocument`）はあるが、画像の追加は注釈向けの非公開関数だけで、画像の差し替えはない。そのため PDF編集と同様に、PDFium の公開 API を直接使う。上の関数が PDFium 2.15.0 の型定義にあることは、PDF編集の依存パッケージで確認した。
- 配布 HTML の CSP は `connect-src 'none'` などで外部通信を禁止する（PDF編集と同じ）。

## 未決事項・未検証事項

- 重い PDF の画像を差し替えて保存したとき、容量が実際に減り、文字の選択・検索が保たれるか（未検証）。透過（SMask）付き・特殊な色空間の画像、グループ内の画像、複数ページで共有される画像の扱い。採用前に実際の PDF で確かめる。
- `FPDFImageObj_LoadJpegFileInline` は読み込み用のコールバック構造を要する。WASM 版で使えるか（未検証）。
- Chrome・Edge の Canvas が JPEG・PNG を書き出せ、AVIF・HEIC に対応しないこと（既知の仕様。この環境での実機確認はまだ）。
- `file://` で「すべて保存」したとき、複数ダウンロードの許可の確認が出て、許可後に全件保存されるか（未検証）。
- 十数枚の高解像度写真（例：1200 万画素 × 15 枚）を同時に扱うときのメモリーと処理時間（未検証）。
- 切り抜き範囲の選択に、ライブラリ（例：Cropper.js）を使うか。実装方針に従って比較し、採否と理由をこの文書に残す。

## 実装時に委ねること

- ファイル構成、関数・型の分け方、TypeScript・ESLint・Prettier などの設定（PDF編集の設定を参考にする）。
- 書き出しや PDF 処理を Worker で行うかどうか、と並列数。
- 容量の上限合わせの探し方（試す回数・画質の刻み）。
- 採用する pnpm・Node.js・各開発用パッケージの版。
