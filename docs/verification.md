# 検証手順と記録

## 自動検査

```sh
pnpm install --frozen-lockfile
pnpm check
```

`check`ではPrettier、ESLint、TypeScript、Viteビルド、Vitest、`git diff --check`を順に実行します。Vitestはページ編集の状態・実PDFの保存再読込・文字と画像の抽出、および作り直した配布物が`index.html`の1ファイルであること、JavaScript・CSS・WASM・日本語フォントが埋め込まれることを検査します。配布物の静的検査は、ブラウザーの動的通信を網羅して検出するものではありません。

GitHub ActionsでもLinux・macOS・Windowsで同じコマンドを実行する設定です。CIが実際に通ったことと、設定を追加したことは区別して記録します。

## ブラウザー確認

以下はブラウザー確認を行う際の手順です。エージェントがPlaywrightスキルやPlaywright CLIを使用するのは、ユーザーから明示的な使用指示があった場合だけとし、通常の開発では使用しません。

1. `pnpm dev`を起動し、ChromeまたはEdgeで`http://127.0.0.1:5173`を開く。起動メッセージ、表示崩れ、コンソールエラーを確認する。
2. `pnpm build`を実行する。新しいブラウザープロファイルで、生成した`dist/index.html`を直接開く。開発サーバーの起動は不要。
3. DevToolsのNetworkでオフラインにし、キャッシュを無効にして再読み込みする。起動メッセージが表示され、外部URLや別ファイルのリクエストが発生しないことを確認する。
4. PDF機能の追加後は、既知の合成PDFで読み込み・操作・保存も確認する。オフラインで起動できただけで、PDF機能の受入完了とはしない。

Playwright CLIでも専用セッションの新しいコンテキストを使って確認できます。リポジトリの絶対パスを指定します。WindowsのURLは`file:///C:/.../dist/index.html`の形式です。

```sh
pnpm exec playwright-cli -s=pdf-edit-offline open --browser=chrome --config=tests/browser-file.config.json
pnpm exec playwright-cli -s=pdf-edit-offline goto file:///絶対パス/pdf-edit/dist/index.html
pnpm exec playwright-cli -s=pdf-edit-offline snapshot
pnpm exec playwright-cli -s=pdf-edit-offline console
pnpm exec playwright-cli -s=pdf-edit-offline requests --static
pnpm exec playwright-cli -s=pdf-edit-offline close
```

この専用設定は新しいプロファイル・オフライン状態で起動します。CLIは標準で`file://`を拒否するため、この確認時に限って`allowUnrestrictedFileAccess`を有効にしています。対象は自分でビルドした`dist/index.html`とし、通常のWeb閲覧にはこの設定を使いません。操作対象のURLと結果を記録してください。

## 環境構築時点（2026年9月19日）

環境：macOS 27.0（arm64）、pnpm 12.4.2、Chrome 153.0.8010.53（Playwright CLIからヘッドレス起動）。

| 確認                             | 結果                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm install --frozen-lockfile` | 成功。ロックファイルから依存を復元可能                                                      |
| Node.js 24.21.0で`pnpm check`    | 成功。整形・Lint・型・ビルド・2件のテスト・差分の空白検査を通過                             |
| Node.js 26.9.0で`pnpm check`     | 成功。同じ検査を通過                                                                        |
| `pnpm dev`とChromeでの起動       | 成功。JavaScriptによる起動メッセージを確認。コンソールエラー・警告0件                       |
| 配布ファイル                     | `dist/index.html`のみ、1,601バイト                                                          |
| 配布HTMLを`file://`で直接起動    | 成功。新規プロファイル・オフライン状態（`navigator.onLine === false`）で確認                |
| 配布HTMLの通信                   | HTML自身の読み込み1件のみ。外部URL・別ファイルへのリクエストなし。コンソールエラー・警告0件 |
| GitHub Actions                   | 3 OS向けの設定を追加。リモート未登録のためCI自体は未実行                                    |
| Windows・Edgeでの実機確認        | 未実施                                                                                      |

Node.js 24.21.0は公式配布物のSHA-256を照合し、一時フォルダーに展開して検証した。PC全体のNode.js設定は変更していない。ブラウザーのスナップショット・通信結果はPlaywright CLIで確認し、画面はローカルの`output/playwright/offline-startup.png`にも保存した（Git管理対象外）。

環境構築時点では、PDFエンジン、WebAssembly・Workerの埋め込み、PDFの編集・抽出・保存は未実装・未検証でした。Mac・WindowsのChrome・Edgeでの受入は、PDFエンジンの採用前検証に含めます。

## 設定の参照元

- [Node.jsのリリース方針](https://nodejs.org/en/about/previous-releases)：推奨Node.jsには24系LTSを選択。
- [vite-plugin-singlefile](https://github.com/richardtallent/vite-plugin-singlefile)：推奨設定を利用。public資産など、自動埋め込みの対象外に注意。
- [ViteのWorker対応](https://vite.dev/guide/features.html#web-workers)：Workerの追加時には埋め込み方式を検証。

## 画面案・PDF機能の試作（2026年9月19日）

環境：macOS、Node.js 26.9.0、pnpm 12.4.2。画面確認にはComputer Useで通常のChromeを操作した。今回、Playwrightスキル・Playwright CLI・Playwright APIは使用していない。

### 自動検査

`pnpm check`：整形、ESLint、TypeScript、配布用ビルド、Vitest **15件**、`git diff --check`を通過。

- `tests/editor.test.ts`（6件）：移動後の選択・取り消し、末尾削除、最後の1ページの保護、回転と結合の連続取り消し、保存基準との差分、無効な移動、文書を閉じたときの初期化。
- `tests/pdf.test.ts`（6件）：実際のPDFium WASMで合成PDFを開く。文字と日本語の抽出、画像の寸法・配置サイズ・dpi・画素、ページの描画、削除・並べ替え・回転・結合後の保存再読込を確認。保存前後の描画バイトが一致し、元から90度回転したページを再保存しても回転が二重に加わらない。空の保存と壊れたPDFは失敗として扱い、元の文書は保持する。テスト中の`fetch`は例外に置き換え、外部通信を必要としないことを確認。
- `tests/build.test.ts`（3件）：単一HTML、JS/CSSの埋め込み、WASM・日本語フォントのdata URL、Workerコード、ライセンスと配布版CSPの存在を静的に検査。

配布物は`dist/index.html`のみ、約18.8 MB。WASM・日本語フォントを含む大きなHTMLに対応するため、ビルドテストのscript/style本文検査を文字列位置の検査に変更した。script/styleの本文全体を長い正規表現で走査しない。

Viteビルドでは、EmbedPDF modelsのNode.js向け`crypto`をブラウザー互換用に外部化する警告が1件出る。ブラウザー側では標準の`crypto`を使い、確認した操作では実行時のエラー・警告は出ていない。これをWindows・Edgeを含む全環境での成功とは扱わない。

### ブラウザー確認

| 確認                                                     | 結果                                                                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `http://127.0.0.1:5173/`で起動                           | 成功。サンプルPDFの読み込み、ページ選択、画像情報の表示を確認                                                                |
| `http://127.0.0.1:4173/`で配布版を起動                   | 成功。HTMLに埋め込まれたWorker・WASM・日本語フォントで描画                                                                   |
| ページの回転・削除・取り消し                             | 成功。4→3→4ページに戻り、回転状態も保持                                                                                      |
| 画像・文字パネル                                         | 成功。画像の160×82 px、160×82 mm、25.4×25.4 dpiを表示。回転後の画像位置にハイライト。日本語を含む抽出テキストも表示          |
| PDFのダウンロード                                        | 成功。生成ファイルをディスクから再読込し、4ページ、回転角`[0,90,0,0]`、日本語文字、画像1点を照合                             |
| PNGのダウンロード                                        | 成功。PNG署名と1684×1191 pxを保存ファイルから確認                                                                            |
| 実ファイルの選択・追加                                   | 成功。macOSのファイル選択で保存済み合成PDFを選び、末尾に追加して8ページになることを確認                                      |
| コンソール                                               | 確認したChrome操作でエラー・警告0件                                                                                          |
| 配布HTMLの`file://`起動                                  | 未確認。Computer UseのURL安全ポリシーがアクセスを拒否した。別経路での迂回はしていない                                        |
| ネット切断・キャッシュ無効での実行、通信履歴の網羅的確認 | 未確認。配布版はCSPで外部通信を禁止し、WASM・フォントの復号にfetchを使用しないが、これだけで完全オフライン受入完了とはしない |
| Windows・Edge・CI                                        | 今回は未実施                                                                                                                 |

### 合成PDFと期待結果

`src/sample.ts`の`createSamplePdf()`が、個人情報を含まない4ページのPDFを生成する。標準Helveticaの英語と、フォントを埋め込まない日本語を含む。日本語の表示にはHTMLに内蔵したNoto Sans JP Regularを使う。

- 全ページ：A4（595.276×841.89 pt）。日本語の「企画チーム / サンプル文書」を抽出できる。
- 2ページ目：RGB画像1点、160×82 px。配置行列の幅453.5433 pt・高さ232.4409 ptで、160×82 mm、縦横25.4 dpiになる。先頭画素はRGBA `[211,224,201,255]`。
- 各ページの英語見出しでページの順序を区別し、結合・削除・並べ替え後の保存結果と照合する。

### 残る受入確認

1. 新規プロファイルのChrome・Edgeで`dist/index.html`を直接開き、キャッシュを無効にしネット接続なしで、日本語PDFの読み込みから編集・抽出・保存まで行う。Networkで外部URLや別ファイルへのリクエストがないことを確認する。
2. Mac・Windowsでファイル選択・ドラッグ＆ドロップ・ページのドラッグ移動、JPEG・個別PNG・テキスト保存、ダウンロードのキャンセル、小さいウィンドウとキーボード操作を確認する。
3. 保存したPDFを別のPDF閲覧ソフトで開き、混在サイズ、CropBox、縦横回転、注釈、フォームを含む文書の見た目とページ構成を照合する。
4. 画像の透過・マスク・色空間、グループを含むPDF、大容量・多数ページの処理時間とメモリ使用量を確認し、対応範囲の記述と実際が一致しているか見直す。

ページ直下の要素のみを扱うこと、個別画像のPNG形式、パスワード非対応、文書単位の付加情報の保持未保証など、現在の制約は[README](../README.md)と[software-stack.md](software-stack.md)を参照する。
