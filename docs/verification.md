# 検証手順と記録

## 自動検査

```sh
pnpm install --frozen-lockfile
pnpm check
```

`check`ではPrettier、ESLint、TypeScript、Viteビルド、Vitest、`git diff --check`を順に実行します。Vitestは作り直した配布物が`index.html`の1ファイルであること、JavaScriptとCSSが埋め込まれていることを検査します。動的な読み込みや通信を検出するテストではありません。

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

PDFエンジン、WebAssembly・Workerの埋め込み、PDFの編集・抽出・保存は未実装・未検証です。Mac・WindowsのChrome・Edgeでの受入は、PDFエンジンの採用前検証に含めます。

## 設定の参照元

- [Node.jsのリリース方針](https://nodejs.org/en/about/previous-releases)：推奨Node.jsには24系LTSを選択。
- [vite-plugin-singlefile](https://github.com/richardtallent/vite-plugin-singlefile)：推奨設定を利用。public資産など、自動埋め込みの対象外に注意。
- [ViteのWorker対応](https://vite.dev/guide/features.html#web-workers)：Workerの追加時には埋め込み方式を検証。
