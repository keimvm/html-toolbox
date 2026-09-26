# toolbox の開発・リリース手順

開発・保守・配布を行う人向けの手順です。利用方法は [README](../README.md) を参照してください。

目的と要件は [requirements.md](requirements.md)、[software-requirements.md](software-requirements.md)、[software-stack.md](software-stack.md) を参照してください。以下のコマンドとパスは、特に記載がなければリポジトリ直下を基準にしています。

## 構成

| 場所                            | 役割                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `tools.json`                    | zip に入れるツールの一覧。書いた順に入口ページへ並ぶ                             |
| `tools/<フォルダ名>/`           | 各ツール。依存関係・ロックファイル・Node.js の版指定はツールごとに持つ           |
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

各ツールの依存関係は、そのフォルダの中だけに置きます。直下の workspace や共通の npm 依存はありません。日常の開発サーバーや個別テストは、各ツールの README を参照してください。

リポジトリ直下から、登録済みのツールを検証できます。依存取得、`pnpm check`、配布用 HTML の構成確認と収集までを順に実行します。

```bash
node scripts/toolbox.mjs check pdf-edit
```

ツール名を省略すると、`tools.json` の全ツールを検証します。スクリプトは Node.js 24.21.0 以降で動かし、各ツールの Node.js の対応範囲も満たしてください。ローカルでは Node.js を自動で切り替えません。CI はツールごとの `.node-version` を使用します。pnpm は各ツールの `packageManager` の版を使います。

### CI の検証対象

| 変更・操作 | 検証するツール |
| --- | --- |
| `tools/<名前>/` のコード・設定・テスト | 変更した登録済みツールだけを 3 OS で検証 |
| 直下と各ツールの `README.md`・`AGENTS.md`・`docs/` だけ | ツールのビルドは省略。直下スクリプトのテストと一覧の検査は実行 |
| `tools.json`・`scripts/`・ワークフローなど共通部分 | 登録済みの全ツールを 3 OS で検証 |
| Check の「Run workflow」 | 登録済みの全ツールを 3 OS で検証 |
| リリース公開 | 登録済みの全ツールを Linux で検証して zip 化 |

Check は PR と main への push で動きます。作業ブランチへの push だけでは動かさず、PR を作って検証します。PR があるブランチで push と PR の二重実行は発生しません。改名・削除も変更に含め、比較に失敗したときは CI を失敗させます。

ブランチ保護を設定する場合、必須チェックは固定名の **Check result** を指定します。ツールごとのジョブは、文書だけの変更では省略されるため必須にはしません。設定自体は GitHub のリポジトリ設定で行います。

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
3. `tools.json` に追加する。

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

版番号は、各ツールの `</body>` の直前へ、右下に固定表示する小さな要素（`#toolbox-version`）として書き足します。戻るリンクと版番号のスタイルもインラインの `<style>` で追加するため、ツールの CSP ではインラインの style を許可してください。加工は配布用のコピーにだけ行い、元のソース・`dist/`・`build/` は変えません。

## 手元で zip を作る

macOS または Linux で、Node.js・pnpm・`zip` コマンドを用意します。

```bash
node scripts/toolbox.mjs release 2026.09.26
```

全ツールの依存取得・検査・ビルド・収集を行い、`out/toolbox-2026.09.26.zip` と、同じ中身の `out/toolbox-2026.09.26/` を作ります。公開やアップロードは行いません。古い `build/` と同じ版の出力を消してから作り直すため、途中で失敗しても同じ版の古い zip は残りません。`build/` と `out/` は Git の管理対象外です。

`collect <フォルダ名>` と `package <版>` は、CI が検証済み HTML を集めて梱包するための個別コマンドです。`package` 自体は再ビルドしないため、手元で配布物を作るときは `release` を使います。

スクリプトのテストは次のとおりです。Git と `zip`・`unzip` が必要です。複数ツールの収集・zip の中身・失敗時の停止・変更対象の判定まで検査します。

```bash
node --test 'scripts/*.test.mjs'
```

## 未確認のこと

- 会社の PC（Windows・Edge、Mac・Chrome）で、ネットにつながない状態で zip を解凍し、`file://` で入口ページとツールが動くこと。
- GitHub 上での Release ワークフローの実行。

開発・リリース手順の検証結果は [verification.md](verification.md) を参照してください。
