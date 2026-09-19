# ソフトウェアスタック検討

検討日：2026年9月19日

[RFP.md](RFP.md)をもとに、対話で合意した初版の範囲と、技術構成の検討結果を記録する。機能の範囲と制約は合意済み。以下の技術構成は検証の第一候補であり、採用は動作確認後に判断する。

## 合意した前提

- 必要なプログラムと補助データをすべて埋め込んだ、単一HTMLを配布する。
- 利用者はインストールせず、HTMLをブラウザーで直接開いて使う。
- 初回から外部サイトの読み込みに依存せず、PDFとその内容を外部に送信しない。
- Mac・WindowsのEdge・Chromeを対象とする。
- 無料で使え、安定性を確認できるライブラリを選ぶ。条件を満たせない機能は保留する。

開発時はソースを複数ファイルに分け、配布時に単一HTMLへまとめる。開発環境での依存パッケージ取得と、利用時のオフライン動作は分けて考える。

## 初版の範囲

| 扱い | 機能 |
| --- | --- |
| 初版で目指す | ページの削除・並べ替え・結合・回転、編集結果のPDF保存 |
| 初版で目指す | ページ全体のPNG・JPEG保存 |
| 初版で目指す | PDFに含まれる文字情報の取り出し・テキスト保存 |
| 初版で目指す | 要素一覧、画像の情報確認・個別抽出 |
| 保留 | 画像・ロゴ、文章、罫線・背景などの個別削除 |
| 保留 | Markdown変換、OCR |

画像の情報確認は、解像度やサイズを調べ、必要な画像を取り出して分析・再利用するために行う。確認する情報は、縦横のピクセル数、PDF上での配置サイズ、その配置サイズに対する実効解像度（dpi）とする。

要素一覧の単位や、個別抽出できる画像の対応範囲は未決。文字情報を持たないスキャンPDFの文字認識は、OCRを保留するため初版では扱わない。

RFPで未確認だったオフライン利用は上記の方針で具体化し、要素の個別削除とMarkdown変換は保留に変更した。

## 第一候補の構成

| 担当 | 技術候補 | 役割・選定理由 |
| --- | --- | --- |
| 画面・操作 | TypeScript＋HTML＋CSS | 標準の画面要素を使い、現在の要件に必要な構成から実装する |
| PDF表示・ページ編集・文字抽出 | `@embedpdf/engines`のv2系 | 既存の高水準APIを優先して利用し、PDF処理を同じエンジンにまとめる |
| 要素一覧・画像情報取得・個別抽出 | `@embedpdf/pdfium`のv2系 | 高水準APIで足りない操作に、PDFiumの公開APIを利用する |
| 開発・配布用ビルド | Vite＋vite-plugin-singlefile | 分割したJavaScriptとCSSを配布用HTMLへまとめる |
| 依存パッケージ管理 | pnpm | 開発環境でライブラリを管理し、検証したバージョンを固定する |

PDFiumはPDFの表示や編集を担う処理エンジンで、EmbedPDFはブラウザーから利用するためのWebAssembly版とAPIを提供する。WebAssemblyは、ブラウザー内で実行するプログラム形式の一つ。

EmbedPDFの公式リポジトリは、v3を開発中として、安定版にはv2を案内している。本検討はv2系を対象とする。v2のパッケージはMITライセンスとして公開されている。採用する版に含まれるPDFiumと依存ライブラリのライセンス・必要な表示も確認する。[公式リポジトリ](https://github.com/embedpdf/embed-pdf-viewer)、[v2の説明](https://github.com/embedpdf/embed-pdf-viewer/tree/v2)

## PDF.js＋pdf-lib案との比較

| 観点 | PDF.js＋pdf-lib | PDFium系（EmbedPDF v2） |
| --- | --- | --- |
| 基本構成 | PDF.jsで表示・文字抽出、pdf-libでページ編集を分担 | 表示・文字抽出・ページ編集を同じエンジンで扱う構成を検証できる |
| 画像の分析・抽出 | PDF.jsの描画命令や画像データを扱う追加実装が必要になる | 画像の寸法・dpi・データを取得する専用APIがある |
| 保守面 | pdf-libは新しい公開版が長期間出ていない点を考慮する | 公式が案内するv2系の安定版と、ブラウザー向けパッケージの動作を確認する |
| 単一HTML化 | PDF.jsの補助プログラム・データを含めた埋め込みが必要 | WebAssembly本体と補助プログラムを含めた埋め込みが必要 |

画像の解像度・サイズの確認と個別抽出を重視するため、PDFium系の検証を先に行う。EmbedPDF v2のAPI定義には、画像情報取得、画像データ取得、要素列挙、ページ操作に対応する関数が含まれている。ただし、APIの存在だけでは今回の構成での安定動作を保証できない。[PDFium公式API](https://pdfium.googlesource.com/pdfium/+/refs/heads/main/public/fpdf_edit.h)、[EmbedPDF v2のAPI定義](https://github.com/embedpdf/embed-pdf-viewer/blob/v2/packages/pdfium/src/vendor/functions.ts)

比較に用いた資料：[PDF.jsのページAPI](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html)、[pdf-libの機能](https://pdf-lib.js.org/)、[pdf-libの公開状況](https://www.npmjs.com/package/pdf-lib)。

## 単一HTMLへのまとめ方

- Viteとvite-plugin-singlefileで、画面のJavaScriptとCSSをHTML内にまとめる。
- PDF処理のWebAssembly本体も埋め込み、外部URLから取得せずに初期化する。
- 画面操作を止めないために使うWeb Workerも、配布物に埋め込む。
- その他の必要なフォントや補助データも、外部ファイル参照が残らないように扱う。

ViteにはWorkerを埋め込む機能があり、EmbedPDFにはWebAssemblyのデータを直接渡して初期化するAPIがある。この組み合わせで単一HTML化する案だが、まだ動作検証はしていない。vite-plugin-singlefileだけで全種類のファイルが自動的に埋め込まれるとは扱わない。[ViteのWorker対応](https://vite.dev/guide/features.html#web-workers)、[単一HTML化プラグイン](https://github.com/richardtallent/vite-plugin-singlefile)、[EmbedPDFの初期化方法](https://www.embedpdf.com/docs/engines/introduction)

## 採用前に確認すること

1. **配布形態とオフライン動作**：生成したHTMLを直接開き、キャッシュに頼らず、ネット接続なしで必要な機能が使える。外部通信が発生しない。
2. **ページ編集**：削除・並べ替え・結合・回転後のPDFを保存し、別のPDF閲覧ソフトでも表示とページ構成が正しい。
3. **画像情報・抽出**：寸法と配置サイズが既知のPDFで、ピクセル数・実効解像度・保存した画像を確認する。同じ画像が異なるサイズで配置される場合も確認する。
4. **要素一覧と文字抽出**：日本語を含むPDFで、一覧と抽出結果を確認し、対応できる単位・範囲を明示する。
5. **対象環境**：Mac・WindowsのEdge・Chromeで確認する。開発用サーバーでの成功だけでは、配布HTMLの受入完了としない。
6. **運用上の安定性**：利用するPDFで処理時間・メモリ使用量・配布HTMLのサイズを確認し、採用版を固定する。

## 現在の状態と未決事項

- 確認済みなのは公式資料とAPI定義。試作、単一HTMLでの起動、対象環境での実機確認、PDFの編集・抽出結果の検証は未実施。
- スタックの正式採用と具体的なバージョンは、上記の確認後に決める。
- 要素一覧の表示単位、画像抽出の保存形式、透過や複雑な構成を持つ画像への対応範囲は未決。
- PDFium系で安定性や配布条件を満たせない場合は、PDF.js＋pdf-lib案と機能範囲を再検討する。条件を満たすことが確認できるまで、該当機能の実装を確約しない。
