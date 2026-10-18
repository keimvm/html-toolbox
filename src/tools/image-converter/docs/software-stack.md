# 画像変換ツール 技術構成

元の企画書：[requirements.md](requirements.md)。満たす要件は [software-requirements.md](software-requirements.md) を参照。

## 選定に関わる制約

- toolbox 共通の制約（[要件の制約](software-requirements.md#制約)）と[ツール追加の手順](../../../../docs/development.md#ツールを追加する)に従う。
- 標準機能・既存ライブラリ・toolbox の共通部品を優先し、自前実装は固有要件に絞る（[実装方針](../../../../docs/development.md#実装方針)）。PDF の処理は EmbedPDF/PDFium を使う。
- 元のファイルを書き換えない。保存はダウンロードだけで行う。

## 採用する技術

| 担当                 | 技術                                                                  | 役割・採用理由                                                                                                                            |
| -------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 画面・処理           | TypeScript ＋ Preact ＋ CSS                                           | toolbox の1つのアプリの一部として、ほかのツールと同じ部品で作る。キャンバス・変換後の画像・囲んだ範囲は直接書き換える                       |
| ビルド               | Vite ＋ vite-plugin-singlefile（toolbox 全体）                        | toolbox の1つの HTML にまとめる                                                                                                           |
| PDF の読み書き・描画 | `@embedpdf/engines`・`@embedpdf/pdfium`・`@embedpdf/models`（2.15.0） | PDF編集と同じ版。PDF → 画像はエンジンの描画、画像 → PDF と PDF 内の画像の差し替えは PDFium の API を直接使う（[PDF の処理](#pdf-の処理)） |
| 日本語フォント       | `@embedpdf/fonts-jp`（1.0.0、Noto Sans JP Regular）                   | フォントを含まない PDF を画像にしたとき、日本語が欠けないようにする。toolbox の配布物の末尾に gzip で1つだけ置き、PDF編集と共有する            |
| 共通部品             | `src/ui/`・`src/lib/`・`src/app/`                                     | 共通ヘッダー、ドロップの受け付け、ダウンロード、確認・知らせ                                                                              |
| 自動テスト           | Vitest                                                                | 容量合わせ・座標の計算・PDF の作成と縮小の検査。Canvas の書き出しは Node.js で模擬できないため、付加情報の削除は実機で確かめる            |

以下はブラウザーの標準機能でまかない、ライブラリを追加しない。

| 役割                                 | 標準機能                                                | 補足                                                                |
| ------------------------------------ | ------------------------------------------------------- | ------------------------------------------------------------------- |
| 画像の読み込み・向きの補正           | `createImageBitmap`（`imageOrientation: 'from-image'`） | Exif の回転指定どおりの向きで読む。HEIC は読めないため案内を出す    |
| リサイズ・切り抜き・回転・塗りつぶし | Canvas（`OffscreenCanvas` を含む）                      | 描画し直した画素だけを書き出す                                      |
| JPEG・PNG の書き出し                 | `convertToBlob`・`toBlob`                               | JPEG は画質（0〜1）を指定できる。書き出し直すため付加情報は残らない |
| 容量の上限合わせ                     | 上記の書き出しの繰り返し                                | 画質を変えて書き出しを繰り返し、上限以下で最も高い画質を選ぶ        |
| ページを閉じるときの確認             | `beforeunload`（toolbox の `status.guard`）             | 未保存の作業があるときだけ確認を出す                                |

使わないもの：Exif の読み書き、zip 作成、HEIC の読み込み、WebP・AVIF の書き出しのためのライブラリ。いずれも要件で扱わないと決めたため。

## PDF の処理

PDF の処理は toolbox の共有の PDF エンジン（`src/engine/pdf/`）で行う。Worker は最初に PDF を扱うときに作り、PDFium の WASM と日本語フォントは配布物の末尾から取り出す（[toolbox の技術構成](../../../../docs/software-stack.md#1つの-html-にまとめる仕組み)）。

- **PDF → 画像**：PDF編集と同じく、エンジンの公開 API（`openDocumentBuffer`・`renderPageRaw`）でページを 200 dpi 相当で描画し、Worker の `OffscreenCanvas` で PNG にして一覧に加える。フォントを含まない日本語は、エンジンのフォントの代替（`fontFallback`）で Noto Sans JP を使う。
- **画像 → PDF**：PDFium の `FPDF_CreateNewDocument`・`FPDFPage_New`・`FPDFPageObj_NewImageObj`・`FPDFImageObj_SetMatrix`・`FPDFPage_InsertObject`・`FPDFPage_GenerateContent` と、EmbedPDF が PDFium に加えた `EPDFImageObj_SetJpeg`（JPEG をそのまま DCTDecode で入れる）・`EPDFImageObj_SetPng`（PNG を展開して Flate で入れる、透過は SMask）を使い、`PDFiumExt_SaveAsCopy` で保存する。ページの大きさは画像に合わせる（1 px = 0.75 pt、一辺 14,400 pt まで）。
- **重い PDF を小さくする**：各ページの直下の画像オブジェクトを列挙し、条件に合う画像だけを `FPDFImageObj_GetBitmap` で読み、Worker の `OffscreenCanvas` で縮めて JPEG にし、`EPDFImageObj_SetJpeg` で差し替えてから `FPDFPage_GenerateContent` で保存する。文字・図形のオブジェクトには触れない。
  - 差し替えない画像：回転・傾け・反転して置かれたもの、1画素 8 bit 未満（白黒2値のスキャンなど）、透過・色抜きのあるもの（`FPDFImageObj_GetRenderedBitmap` の結果にアルファ値 255 未満がある）、JPEG にしても元のデータの9割以上の大きさになるもの、4,000 万画素を超えるもの、グループ（Form XObject）の中のもの。
  - 複数ページで共有する画像：PDFium は文書内で同じ画像を共有するため、差し替えた後のページでは同じ画像オブジェクトの中身が新しい JPEG になっている。中身が差し替えた JPEG と一致する画像は、`FPDFPageObj_Transform`（単位行列）で変更済みにしてからページの内容を作り直し、元の画像への参照を新しい画像に向ける。こうしないと元の画像が残り、容量が減らない（[検証記録](verification.md#実装前の-pdfium-の確認2026-10-03)）。
  - ページの内容を作り直すため、PDF の作りによってはしおり・フォーム・注釈などの残り方が元の PDF と変わる場合がある。
- 当初は JPEG の埋め込みに `FPDFImageObj_LoadJpegFileInline` を使う予定だったが、読み込み用のコールバック構造（`FPDF_FILEACCESS`）を WASM 側に作る必要がある。同じ PDFium の型定義にある `EPDFImageObj_SetJpeg` はバイト列を直接受け取り、EmbedPDF のエンジン自体も画像注釈に使っているため、こちらを採用した。PNG も同様に `FPDFImageObj_SetBitmap` ではなく `EPDFImageObj_SetPng` を使い、展開済みの画素ではなく PNG の予測付き Flate で入れる。
- EmbedPDF の高水準 API には、文書の作成（`createDocument`）はあるが、画像の追加は注釈向けの非公開関数だけで、画像の差し替えはない。そのため PDF編集と同様に、PDFium の公開 API を直接使う。
- 配布 HTML の CSP は `connect-src 'none'` などで外部通信を禁止する（PDF編集と同じ）。

## 画像の変換

- 画像の変換は画面側（メインスレッド）の `OffscreenCanvas` で、一覧の画像を1枚ずつ順に行う。個別の画面で開いている画像を先に変換する。読み込み（`createImageBitmap`）と書き出し（`convertToBlob`）はブラウザーが画面の処理とは別に進めるため、Worker には分けない。十数枚の高解像度写真を同時に展開しないよう、読み込んだ画像は変換が終わるたびに閉じる。
- 設定・編集を変えるたびに画像ごとの版番号を増やし、古い版の変換は書き出しの前後で打ち切る。
- 描画の順番は、塗りつぶし（元の大きさ）→ 切り抜き → 回転 → 縮小（`imageSmoothingQuality = 'high'`）。JPEG は先に白で塗ってから描く。
- 上限合わせは、画質 90 で収まればそれを使い、収まらなければ 30〜89 を二分探索する（1枚あたり最大8回の書き出し）。
- 切り抜き範囲の選択に Cropper.js などのライブラリは使わない。塗りつぶしにも同じ「ドラッグで長方形を囲む」操作が要り、切り抜き専用の部品では塗りつぶしをまかなえないため、Pointer Events で長方形を囲む処理を自前で持つ（`detail.tsx`）。範囲の座標の計算は `geometry.ts` に分け、自動テストで確かめる。

## toolbox の1つのアプリへの移行（2026-10-18）

- 設定・画質の選び方・座標・描画（`settings.ts`・`fit.ts`・`geometry.ts`・`convert.ts`）は旧コードとテストをそのまま移した。容量の表示（`formatBytes`）・名前（`baseName`）・PDF の判定は toolbox の共通部品（`src/lib/`）を使う。
- PDF の処理（旧 `src/pdf/runtime.ts`）は、PDF編集の処理と合わせて共有の PDF エンジン（`src/engine/pdf/runtime.ts`）にした。描画の引数は dpi ではなく倍率（`scale = dpi / 72`）、ページは `{ sourceId, sourceIndex, rotation }` で指す。
- 一覧と変換の順番待ち（旧 `items.ts`）は、変換結果を書き換えるたびに `revision` を増やして画面に伝える形にした。変換の手順と、古い変換を打ち切る仕組みは変えていない。
- 個別の画面（旧 `detail.ts`）は Preact の部品にし、座標の計算・スクロールの同期・切り抜きの操作は旧コードの処理を移した。
- 足したもの：画面での画像の貼り付け、ホームからの「まとめて1つのPDFにする」（`combine`）・「PDFを小さくする」（`shrink`）、まとめた PDF を「PDF編集で開く」。PDF編集からは今のページ構成で書き出した PDF を受け取る（`add`・`shrink`）。

## 未決事項・未検証事項

- 実際の写真・スキャンの多い PDF で、画像を差し替えて保存したとき、容量が減り、文字の選択・検索が保たれるか（合成 PDF では確認済み）。特殊な色空間・ICC プロファイル付きの画像の色、しおり・フォーム・注釈の残り方。
- Chrome・Edge の Canvas が JPEG・PNG を書き出せ、AVIF・HEIC に対応しないこと（既知の仕様。この環境での実機確認はまだ）。
- `file://` で「すべて保存」したとき、複数ダウンロードの許可の確認が出て、許可後に全件保存されるか（未検証）。
- 十数枚の高解像度写真（例：1200 万画素 × 15 枚）を扱うときのメモリーと処理時間（未検証）。

## 実装時に委ねること

- ファイル構成、関数・型の分け方。
- 書き出しや PDF 処理を Worker で行うかどうか、と並列数。
- 容量の上限合わせの探し方（試す回数・画質の刻み）。

ファイル構成は [README](../README.md#開発する)、Worker・並列数・上限合わせは[画像の変換](#画像の変換)と [PDF の処理](#pdf-の処理) を参照。
