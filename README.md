# PDF編集

ブラウザーで直接開ける単一HTMLのPDF編集・変換ツールです。PDFとその内容を外部へ送信せず、初回からオフラインで利用できる構成を目指します。

現在は開発環境と起動確認用の画面までを用意しています。PDFの読み込み・編集・変換は未実装です。

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
| `pnpm build`        | 型検査後、`dist/index.html`を生成                        |
| `pnpm preview`      | ビルド済みHTMLをHTTPで確認（127.0.0.1:4173）             |
| `pnpm typecheck`    | ブラウザー用コードと開発用コードを型検査                 |
| `pnpm lint`         | ESLintで検査。警告も失敗として扱う                       |
| `pnpm format`       | Prettierで整形                                           |
| `pnpm format:check` | 整形状態を変更せず検査                                   |
| `pnpm test`         | ビルドを作り直してVitestを実行                           |
| `pnpm check`        | 整形・Lint・型・ビルド・テスト・差分の空白をまとめて検査 |

`dist/`は生成物としてGit管理から除外しています。配布するファイルは`pnpm build`で生成する`dist/index.html`だけです。起動確認には、このファイルをChromeまたはEdgeで直接開いてください。`preview`で表示できても、`file://`での動作確認の代わりにはなりません。

## 構成

| 場所                                             | 役割                                            |
| ------------------------------------------------ | ----------------------------------------------- |
| `src/`、`index.html`                             | TypeScript・HTML・CSSの画面コード               |
| `vite.config.ts`                                 | Viteとvite-plugin-singlefileによる配布用ビルド  |
| `tests/`                                         | Vitest。現在は配布物が単一HTMLになることを検査  |
| `.github/workflows/check.yml`                    | Linux・macOS・Windowsで`pnpm check`を実行するCI |
| [AGENTS.md](AGENTS.md)                           | エージェント向けの作業手順と実装上の制約        |
| [docs/software-stack.md](docs/software-stack.md) | 初版の合意範囲、技術候補、採用前の検証事項      |
| [docs/RFP.md](docs/RFP.md)                       | 当初の目的と要望                                |
| [docs/verification.md](docs/verification.md)     | 検証手順、結果、未確認事項                      |

PDFエンジンの採用は未決定です。EmbedPDF v2を第一候補として検証する方針ですが、開発環境の構築時点では依存関係に追加していません。WebAssembly・Worker・フォントの埋め込みは、エンジンの検証時に扱います。

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
