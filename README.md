# PDF編集

ブラウザーで直接開ける単一HTMLのPDF編集・変換ツールです。PDFとその内容を外部へ送信せず、初回からオフラインで利用できる構成を目指します。

ページ一覧・プレビュー・画像と文字の取り出しパネルを備えた試作版です。実際のPDFを読み込み、ページを編集して別のPDFに保存できます。PDFium・Worker・日本語フォントをHTML内に埋め込み、配布版ではCSPで外部通信も禁止します。`file://`・完全オフライン・Windows・Edgeでの受入は未完了です。

## ダウンロード

**[PDF編集をダウンロード（HTML）](https://github.com/keimvm/pdf-edit/releases/latest/download/pdf-edit.html)**

保存した`pdf-edit.html`をChromeまたはEdgeで開くと使えます。インストールやビルドは不要です。Mac・Windows向けに同じファイルを配布します。

[リリース一覧](https://github.com/keimvm/pdf-edit/releases)から過去の版も取得できます。リポジトリが非公開の場合は、アクセス権のあるGitHubアカウントでログインしてください。

## 使い方

1. 上のリンクからダウンロードしたHTMLをChromeかEdgeで開く。
2. 「PDFを開く」かドラッグ＆ドロップで文書を読み込む。「サンプルで試す」では合成PDFを使用する。
3. 中央のプレビューを縦にスクロールして読み進める。表示位置に合わせて左のページ選択も切り替わる。左のページ一覧や下部の前後ボタンからも移動できる。上部の「−／＋」と倍率選択で25〜300%に拡大・縮小でき、「幅に合わせる」では表示領域に収める。拡大してはみ出した部分は横にもスクロールできる。
4. 選択中のページを回転・削除・ドラッグまたは矢印ボタンで並べ替える。「元に戻す」（⌘/Ctrl+Z）で直前の操作を取り消せる。
5. 「PDFを追加」で別のPDFを末尾に結合する。複数ファイルも選択できる。
6. 「PDFを保存」から全ページのPDF、または選択中ページのPNG・JPEGをダウンロードする。
7. 「画像・文字」を開くと、選択中ページの画像情報・文字・要素一覧を確認できる。画像はPNG、文字はUTF-8のテキストとして保存する。

元ファイルは上書きしません。PDF本体と編集状態は復元用としてブラウザー内に自動保存します。「再読み込みに対応」と表示されたら、画面を再読み込みしてもPDF、ページ順・回転・削除、選択ページ、倍率、直近50操作の取り消し履歴を復元できます。ページ内の細かなスクロール位置や、画像・文字パネルの状態は復元しません。

「閉じる」を押すと復元用データも削除します。PDFとして手元に残す場合は「PDFを保存」を使ってください。復元用の保存中や保存失敗時は、再読み込み・画面を離れる前の確認を残します。

復元先は同じブラウザー・プロファイル・HTMLの配置場所です。HTMLの移動・改名、プライベートブラウズの終了、ブラウザーの保存データ削除などでは復元できない場合があります。同じHTMLを複数のタブで開くと、最後に保存したタブの状態が復元対象になります。復元用データは外部へ送信しません。`file://`での復元は対象ブラウザーでの受入が未完了です。

ダウンロードの完了・キャンセルはアプリから確認できないため、ダウンロード後も「未保存の変更」の表示と、閉じる前の確認を残します。保存したファイルを確認してから閉じてください。編集を取り消して読み込み時の内容に戻すと「変更なし」になります。

### 現時点の対応範囲

- 要素一覧と画像の個別抽出はページ直下の要素が対象。グループ（Form XObject）内の画像は対象外です。
- 画像情報はピクセル数、配置サイズ（mm）、縦横それぞれの実効解像度（dpi）。配置サイズは画像の変換行列から求めます。
- 個別画像は元の画素数でPNGにします。マスク・切り抜き・複雑な色空間の見た目は、元PDFと一致しない場合があります。
- 文字はPDFに含まれる文字情報を抽出します。段組みの読み順・表の復元・OCRは扱いません。
- PDF保存はページを組み直す方式です。しおり、電子署名、文書単位の付加情報の保持は保証しません。
- パスワードが必要なPDFには未対応です。1ファイル150 MBまで。ページ描画は最大1,600万画素、個別画像は3,200万画素までです。大容量PDFでの負荷試験は未実施です。
- 日本語の代替フォントとしてNoto Sans JP Regularを内蔵しています。未埋め込みフォントの字形や太さが元文書と異なる場合があります。

画像・文字・図形の個別削除、Markdown変換、OCRは保留のままです。

## 開発を始める

必要なものはGit、Node.js、pnpmです。APIキー、外部サービス、環境変数の設定は不要です。

- Node.js：24.21.0以降の24系を推奨。CIは[.node-version](.node-version)の24.21.0を使用します。26.9.0以降の26系も許可しています。
- pnpm：12.4.2。[package.json](package.json)の`packageManager`で固定しています。

macOSでまだ入っていない場合は、Homebrewで導入できます。

```sh
brew install node@24 pnpm
export PATH="$(brew --prefix node@24)/bin:$PATH"
```

リポジトリ内で実行します。

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm dev
```

開発画面は[http://127.0.0.1:5173](http://127.0.0.1:5173)で開けます。サーバーはローカルPCからだけ接続できる設定です。同じポートが使われている場合はエラーになります。別ポートを使う場合は`pnpm dev --port 5174`などと指定してください。

依存パッケージの初回取得にはネット接続が必要です。利用者に配布するHTMLのオフライン動作とは別の条件です。

## コマンド

| コマンド            | 内容                                                     |
| ------------------- | -------------------------------------------------------- |
| `pnpm dev`          | 開発サーバーを起動                                       |
| `pnpm build`        | 型検査後、`dist/PDF編集.html`を生成                      |
| `pnpm preview`      | ビルド済みHTMLをHTTPで確認（127.0.0.1:4173）             |
| `pnpm typecheck`    | ブラウザー用コードと開発用コードを型検査                 |
| `pnpm lint`         | ESLintで検査。警告も失敗として扱う                       |
| `pnpm format`       | Prettierで整形                                           |
| `pnpm format:check` | 整形状態を変更せず検査                                   |
| `pnpm test`         | ビルドを作り直してVitestを実行                           |
| `pnpm check`        | 整形・Lint・型・ビルド・テスト・差分の空白をまとめて検査 |

`dist/`は生成物としてGit管理から除外しています。配布するファイルは`pnpm build`で生成する`dist/PDF編集.html`だけです。起動確認には、このファイルをChromeまたはEdgeで直接開いてください。`preview`で表示できても、`file://`での動作確認の代わりにはなりません。

開発用の入口は`index.html`のまま、ビルド時に配布ファイル名を`PDF編集.html`へ変更します。`pnpm preview`で確認する場合は[PDF編集.html](http://127.0.0.1:4173/PDF編集.html)を開いてください。

## 配布版の公開

公開するコミットに`v`で始まるタグを付けてGitHubへpushすると、[Releaseワークフロー](.github/workflows/release.yml)が`pnpm check`を実行し、生成したHTMLをGitHub Releasesへ添付します。たとえば、最初の配布版は次のように公開します。

```sh
git tag v0.1.0
git push origin v0.1.0
```

GitHubでは添付ファイル名が補正されることがあるため、`dist/PDF編集.html`を内容を変えずに`pdf-edit.html`という名前で添付します。[GitHubのファイル名に関する仕様](https://docs.github.com/en/rest/releases/assets#upload-a-release-asset)を参照してください。`dist/`は引き続きGit管理対象外です。

公開したリリースをLatestに設定するため、READMEのダウンロードリンクは次の公開時もそのまま使えます。初回のリリースが成功するまでは、このリンクからダウンロードできません。リリース本文には試作版であることと、未確認の環境を記載します。

## 構成

| 場所                                             | 役割                                                |
| ------------------------------------------------ | --------------------------------------------------- |
| `src/`、`index.html`                             | TypeScript・HTML・CSSの画面コード                   |
| `vite.config.ts`                                 | Viteとvite-plugin-singlefileによる配布用ビルド      |
| `tests/`                                         | Vitest。ページ操作・実PDFの保存再読込・配布物を検査 |
| `.github/workflows/check.yml`                    | Linux・macOS・Windowsで`pnpm check`を実行するCI     |
| `.github/workflows/release.yml`                  | タグから検査・ビルドし、配布HTMLをReleasesへ添付    |
| [AGENTS.md](AGENTS.md)                           | エージェント向けの作業手順と実装上の制約            |
| [docs/software-stack.md](docs/software-stack.md) | 初版の合意範囲、技術候補、採用前の検証事項          |
| [docs/RFP.md](docs/RFP.md)                       | 当初の目的と要望                                    |
| [docs/verification.md](docs/verification.md)     | 検証手順、結果、未確認事項                          |

試作には`@embedpdf/engines`・`@embedpdf/pdfium`・`@embedpdf/models`の2.15.0と、日本語フォント1.0.0を固定しています。読み込み・描画・文字抽出・ページ結合には公開の高水準APIを使い、回転の保存・要素一覧・個別画像にはPDFiumの公開APIを使います。WorkerはViteの`?worker&inline`、WASMとフォントは`?url&inline`で埋め込みます。ライセンスは`src/licenses.txt`から配布HTML内の「このアプリについて」に収録します。

配布HTMLは約18.8 MBです。対象環境での受入が済むまでは、PDFエンジンの正式採用・安定性の確認完了とは扱いません。

## ブラウザーでの確認

PlaywrightスキルとPlaywright CLIは、ユーザーが使用を明示的に指示した場合に限って使用します。通常の開発では使用しません。CLIは開発依存として固定しており、以下は使用を指示された場合に既存のChromeで確認する例です。

```sh
pnpm exec playwright-cli -s=pdf-edit open http://127.0.0.1:5173 --browser=chrome
pnpm exec playwright-cli -s=pdf-edit snapshot
pnpm exec playwright-cli -s=pdf-edit console
pnpm exec playwright-cli -s=pdf-edit close
```

配布HTMLの直接起動・オフライン確認の手順は[検証記録](docs/verification.md)を参照してください。ブラウザーの実機確認は`pnpm check`には含まれません。

個人・業務用のPDFはGit管理対象外の`local-samples/`に置きます。共有テストには合成データを使い、内容を外部サービスへ送信しないでください。
