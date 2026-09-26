# toolbox の開発・リリース手順

開発・保守・配布を行う人向けの手順です。利用方法は [README](../README.md) を参照してください。

目的と要件は [requirements.md](requirements.md)、[software-requirements.md](software-requirements.md)、[software-stack.md](software-stack.md) を参照してください。以下のコマンドとパスは、特に記載がなければリポジトリ直下を基準にしています。

## 構成

| 場所                            | 役割                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `tools.json`                    | zip に入れるツールの一覧。書いた順に入口ページへ並ぶ                             |
| `tools/<フォルダ名>/`           | 各ツール。依存関係・ロックファイル・Node.js の版指定はツールごとに持つ           |
| `ui/`                           | 全ツールと入口ページで共通の配色・部品・ダークモード、D&D・ダウンロードの処理。npm の依存なし |
| `scripts/toolbox.mjs`           | 一覧の検査、ビルド済み HTML の収集、入口ページの生成、戻るリンク・版番号の追加、zip 作成 |
| `scripts/ci-tools.mjs`          | Git の差分から CI の検証対象を選ぶ |
| `.github/workflows/check.yml`   | main への push・PR でスクリプトと変更対象のツールを検証（Linux・macOS・Windows） |
| `.github/workflows/tool.yml`    | 通常 CI・リリース共通の依存取得・検証・ビルド・HTML 収集 |
| `.github/workflows/release.yml` | リリースの公開時に検査・ビルドし、`toolbox-<版>.zip` をリリースへ添付           |

zip の中身は次のとおりです。ファイル名は英数字と `-` `.` だけにしています。

```
toolbox-<版>/
  index.html
  tools/
    <フォルダ名>.html
```

## 開発する

各ツールの依存関係は、そのフォルダの中だけに置きます。直下の workspace や共通の npm 依存はありません。見た目と一部の処理は、直下の `ui/` のソースを各ツールのビルドで取り込みます（[共通 UI](#共通-ui)）。日常の開発サーバーや個別テストは、各ツールの README を参照してください。

リポジトリ直下から、登録済みのツールを検証できます。依存取得、`pnpm check`、配布用 HTML の構成確認と収集までを順に実行します。

```bash
node scripts/toolbox.mjs check pdf-edit
node scripts/toolbox.mjs check note-html
```

ツール名を省略すると、`tools.json` の全ツールを検証します。スクリプトは Node.js 24.21.0 以降で動かし、各ツールの Node.js の対応範囲も満たしてください。ローカルでは Node.js を自動で切り替えません。CI はツールごとの `.node-version` を使用します。pnpm は各ツールの `packageManager` の版を使います。

### CI の検証対象

| 変更・操作 | 検証するツール |
| --- | --- |
| `tools/<名前>/` のコード・設定・テスト | 変更した登録済みツールだけを 3 OS で検証 |
| 直下と各ツールの `README.md`・`AGENTS.md`・`docs/` だけ | ツールのビルドは省略。直下スクリプトのテストと一覧の検査は実行 |
| `tools.json`・`scripts/`・`ui/`・ワークフローなど共通部分 | 登録済みの全ツールを 3 OS で検証 |
| Check の「Run workflow」 | 登録済みの全ツールを 3 OS で検証 |
| リリース公開 | 登録済みの全ツールを Linux で検証して zip 化 |

Check は PR と main への push で動きます。作業ブランチへの push だけでは動かさず、PR を作って検証します。PR があるブランチで push と PR の二重実行は発生しません。改名・削除も変更に含め、比較に失敗したときは CI を失敗させます。

ブランチ保護を設定する場合、必須チェックは固定名の **Check result** を指定します。ツールごとのジョブは、文書だけの変更では省略されるため必須にはしません。設定自体は GitHub のリポジトリ設定で行います。

### 共通 UI

`ui/` には全ツールと入口ページで揃える見た目と処理を置きます。各ツールはビルド時に相対パス（`tools/<フォルダ名>/src/` からは `../../../ui/`）でソースを取り込み、単一 HTML に埋め込みます。npm の依存は持たず、パッケージとしても登録しません。

| ファイル | 内容 |
| --- | --- |
| `theme.css` | 配色・文字・角丸などのトークン（`--tb-*`）と、ボタン（`.tb-button` に `.tb-primary`・`.tb-secondary`・`.tb-danger`・`.tb-icon-button` を組み合わせる）、入力欄（`.tb-input`）、ダイアログ（`.tb-dialog`）、フォーカス枠、ファイルのドロップ中の表示 |
| `download.js` | `downloadBlob(blob, ファイル名, { signal })`。blob URL とリンクでダウンロードさせ、60秒後か `signal` の中断で URL を解放する |
| `file-drop.js` | `watchFileDrop({ zone, onDrop, enabled })`。`zone` の外に落としたファイルでブラウザーが画面を離れないようにする。受け付ける間は `zone` に `data-tb-file-drag` を付け、`data-tb-drop-label` の文言を重ねて表示する。フォルダを含む場合は `onDrop` に `null` を渡す。`hasFiles`・`droppedFiles` も使える |

- 色はすべて `light-dark()` で持ち、OS のダークモード設定に従います。画面での切り替えはありません。印刷は常にライトです。
- 部品は `:where()` で詳細度を 0 にしているため、ツールの CSS で余白などを上書きできます。逆に、ツールの CSS でボタン全体に `color` や `font` を指定すると部品の指定も打ち消すため、`:where(:not(.tb-button))` のように部品を除外してください。
- 入口ページは `scripts/toolbox.mjs` が `theme.css` を埋め込んで作ります。配布時に足す戻るリンクと版番号も、ページの配色とトークンに従います。
- ローカルノートがエクスポートする HTML には本文用の `document.css` だけを入れるため、常にライトで出力されます。
- TypeScript からは同じ名前の `.d.ts` で型を参照します。Vite の開発サーバーでは、`server.fs.allow` に `../../ui` を加えます（PDF編集の `vite.config.ts`）。
- `ui/` を変えたら、`node --test 'ui/*.test.mjs'` と全ツールの `node scripts/toolbox.mjs check` を実行します。CI も `ui/` の変更で全ツールを検証します。

## 版を出す

1. 変更を main へ push し、Check ワークフローが通っていることを確かめる。
2. GitHub の Releases で「Draft a new release」を開き、タグに今日の日付の版（例：`2026.09.26`）を新しく作って公開する。同じ日の2回目以降は `2026.09.26.2` のように末尾に番号を付ける。
3. Release ワークフローが終わると、そのリリースに `toolbox-<版>.zip` が添付される。
4. zip をダウンロードして同僚に渡す。

タグが日付形式でない場合や、どれか1つのツールで検査かビルドが失敗した場合は、ワークフローが失敗し zip は添付されません。失敗は Actions の画面で確認できます。ワークフローはタグの時点のソースを使うため、直したあとは新しい版（例：`2026.09.26.2`）でリリースを作ってください。失敗したリリースとタグは削除して構いません。

## ツールを追加する

1. `tools/<フォルダ名>/` を作る。フォルダ名は英数字と `-` `.` だけにする。
2. そのフォルダの中だけで次のことができるようにする。
   - `package.json` の `packageManager` で pnpm の版（`pnpm@x.y.z`）を、`.node-version` で Node.js の版（`x.y.z`）を固定する。
   - `pnpm install --frozen-lockfile` で依存関係を取得できる。
   - `pnpm check` で検査とビルドを行い、`dist/` に外部を何も読み込まない HTML を1つだけ出力する。別のファイルやフォルダは残さない。
   - ヘッダー左端、ツール名の手前に `<template id="toolbox-home"></template>` を1つ置く。ビルド後にもこの文字列を残し、画面が狭い場合はヘッダーを折り返せるようにする。
   - `ui/theme.css` を読み込み、配色は `--tb-*`、ボタン・入力欄・ダイアログは共通部品のクラスを使う。ファイルのドラッグ＆ドロップとダウンロードは `ui/` の処理を使う（[共通 UI](#共通-ui)）。
3. `tools.json` に追加し、直下の README に利用者向けの紹介を加える。

```json
[
  {
    "dir": "pdf-edit",
    "name": "PDF編集",
    "description": "入口ページに表示する説明"
  }
]
```

`tools.json` に書いていないフォルダ（作りかけ・個人用）は zip にも CI にも入りません。

追加後に `node scripts/toolbox.mjs check <フォルダ名>` を実行し、PR を作ります。ワークフローへのツール名の追記は不要です。`node scripts/toolbox.mjs list` で、一覧と必要な設定ファイルだけを素早く検査できます。単一 HTML に収まることは共通処理が検査しますが、外部通信や `file://` での動作は各ツールで検証してください。

zip を作るときに、上記の空の `template` を「← トップへ戻る」のリンク（`#toolbox-home`、`href="../index.html"`）に置き換えます。通常のリンクなので、同じタブで戻り、ツールの既存の離脱確認が働きます。作業状態の削除や独自の確認処理は追加しません。挿入位置が不足・重複している場合は収集・梱包を失敗させます。開発画面や加工前の HTML では `template` は表示されません。

版番号は、各ツールの `</body>` の直前へ、右下に固定表示する小さな要素（`#toolbox-version`）として書き足します。戻るリンクと版番号のスタイルもインラインの `<style>` で追加するため、ツールの CSP ではインラインの style を許可してください。色はツールの配色（ライト・ダーク）に従います。加工は配布用のコピーにだけ行い、元のソース・`dist/`・`build/` は変えません。

## 手元で zip を作る

macOS または Linux で、Node.js・pnpm・`zip` コマンドを用意します。

```bash
node scripts/toolbox.mjs release 2026.09.26
```

全ツールの依存取得・検査・ビルド・収集を行い、`out/toolbox-2026.09.26.zip` と、同じ中身の `out/toolbox-2026.09.26/` を作ります。公開やアップロードは行いません。古い `build/` と同じ版の出力を消してから作り直すため、途中で失敗しても同じ版の古い zip は残りません。`build/` と `out/` は Git の管理対象外です。

`collect <フォルダ名>` と `package <版>` は、CI が検証済み HTML を集めて梱包するための個別コマンドです。`package` 自体は再ビルドしないため、手元で配布物を作るときは `release` を使います。

スクリプトと共通 UI のテストは次のとおりです。Git と `zip`・`unzip` が必要です。複数ツールの収集・zip の中身・失敗時の停止・変更対象の判定、共通のダウンロード・D&D の処理まで検査します。

```bash
node --test 'scripts/*.test.mjs' 'ui/*.test.mjs'
```

## ローカルノートの開発

`tools/note-html/` は既存の esbuild と Node.js のテストランナーを使います。Node.js は `.node-version` の24.21.0、対応範囲は `package.json` の24.21.0以降の24系または26.9.0以降の26系です。pnpm は11.15.0に固定し、PDF編集とは独立して管理します。ライブラリとロックファイルは移行前のものを維持しています。

日常の変更では `tools/note-html/` で実行します。

```sh
pnpm install --frozen-lockfile
pnpm check
```

| コマンド | 内容 |
| --- | --- |
| `pnpm build` | `dist/` を作り直し、JS・CSS・ライセンスを内包した `dist/index.html` を生成 |
| `pnpm test` | ビルド済み HTML とソースを Node.js・jsdom で検証。先に `pnpm build` が必要 |
| `pnpm check` | ビルド、全テスト、`git diff --check` を実行 |

編集対象は `src/` です。`src/index.html` はテンプレートなので直接開かず、生成した `dist/index.html` を Chrome または Edge で開きます。生成物は直接編集しません。`dist/` と検証記録の `output/` は Git 管理対象外です。

toolbox の戻るリンク・版番号を含む確認には、リポジトリ直下で `node scripts/toolbox.mjs release <版>` を実行し、`out/toolbox-<版>/index.html` を開きます。共通処理が `dist/index.html` を `tools/note-html.html` として収集・梱包します。

自動テストはファイル API を模擬しており、実ノートを読み書きしません。実機では検証専用のフォルダを使い、通常の編集・保存、未保存時のトップへの移動とキャンセル、保存後の往復、狭い画面の折り返しを確認します。`file://`、オフライン、OS・ブラウザー別の受入は区別して [ツールの検証記録](../tools/note-html/docs/VERIFICATION.md) に残します。Playwright スキル・CLI は明示的な使用依頼がある場合に限って使います。

## 未確認のこと

- 会社の PC（Windows・Edge、Mac・Chrome）で、ネットにつながない状態で zip を解凍し、`file://` で入口ページとツールが動くこと。
- GitHub 上での Release ワークフローの実行。

開発・リリース手順の検証結果は [verification.md](verification.md) を参照してください。
