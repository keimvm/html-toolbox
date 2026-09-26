# toolbox

1ファイルのHTMLで作った便利ツールをまとめ、版番号付きの zip として配るためのリポジトリです。使う人は zip を解凍して `index.html` を Chrome か Edge で開くだけで、インストールもネット接続も要りません。

目的と要件は [docs/requirements.md](docs/requirements.md)、[docs/software-requirements.md](docs/software-requirements.md)、[docs/software-stack.md](docs/software-stack.md) を参照してください。

## 構成

| 場所                            | 役割                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `tools.json`                    | zip に入れるツールの一覧。書いた順に入口ページへ並ぶ                             |
| `tools/<フォルダ名>/`           | 各ツール。依存関係・ロックファイル・Node.js の版指定はツールごとに持つ           |
| `scripts/toolbox.mjs`           | 一覧の検査、ビルド済み HTML の収集、入口ページの生成、版番号の書き足し、zip 作成 |
| `.github/workflows/check.yml`   | push ごとにスクリプトのテストと、各ツールの `pnpm check`（Linux・macOS・Windows） |
| `.github/workflows/release.yml` | リリースの公開時に検査・ビルドし、`toolbox-<版>.zip` をリリースへ添付           |

zip の中身は次のとおりです。ファイル名は英数字と `-` `.` だけにしています。

```
toolbox-<版>/
  index.html
  tools/
    <フォルダ名>.html
```

## 版を出す

1. 変更を main へ push し、Check ワークフローが通っていることを確かめる。
2. GitHub の Releases で「Draft a new release」を開き、タグに今日の日付の版（例：`2026.09.26`）を新しく作って公開する。同じ日の2回目以降は `2026.09.26.2` のように末尾に番号を付ける。
3. Release ワークフローが終わると、そのリリースに `toolbox-<版>.zip` が添付される。
4. zip をダウンロードして同僚に渡す。

タグが日付形式でない場合や、どれか1つのツールで検査かビルドが失敗した場合は、ワークフローが失敗し zip は添付されません。失敗は Actions の画面で確認できます。ワークフローはタグの時点のソースを使うため、直したあとは新しい版（例：`2026.09.26.2`）でリリースを作ってください。失敗したリリースとタグは削除して構いません。

## ツールを追加する

1. `tools/<フォルダ名>/` を作る。フォルダ名は英数字と `-` `.` だけにする。
2. そのフォルダの中だけで次のことができるようにする。
   - `package.json` の `packageManager` で pnpm の版を、`.node-version` で Node.js の版を指定する。
   - `pnpm install --frozen-lockfile` で依存関係を取得できる。
   - `pnpm check` で検査とビルドを行い、`dist/` に外部を何も読み込まない HTML を1つだけ出力する。
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

版番号は、zip を作るときに各ツールの `</body>` の直前へ、右下に固定表示する小さな要素（`#toolbox-version`、インラインの `<style>` 付き）として書き足します。ツールの CSP でインラインの style を許していない場合は表示されません。

## 手元で zip を作る

Node.js 24 以降と `zip` コマンドが必要です。

```bash
pnpm --dir tools/pdf-edit install --frozen-lockfile
```

```bash
pnpm --dir tools/pdf-edit check
```

```bash
node scripts/toolbox.mjs collect pdf-edit
```

```bash
node scripts/toolbox.mjs package 2026.09.26
```

`out/toolbox-2026.09.26.zip` と、同じ中身の `out/toolbox-2026.09.26/` ができます。`build/` と `out/` は Git の管理対象外です。

スクリプトのテストは次のとおりです。

```bash
node --test 'scripts/*.test.mjs'
```

## 未確認のこと

- 会社の PC（Windows・Edge、Mac・Chrome）で、ネットにつながない状態で zip を解凍し、`file://` で入口ページとツールが動くこと。
- GitHub 上での Release ワークフローの実行。
