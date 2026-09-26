# toolbox 技術構成

元の企画書：[requirements.md](requirements.md)。何を満たすかは [software-requirements.md](software-requirements.md) を参照。

## 採用する技術と役割

| 技術 | 役割 | 採用理由 |
| --- | --- | --- |
| GitHub（private リポジトリ1つ） | 全ツールのソースと履歴の管理 | 既に使っている。1つにまとめることで、版を出す操作と版番号が1つで済む。private のまま、ほかのリポジトリを読むための鍵も要らない |
| GitHub Releases | 版の記録と zip の置き場 | 画面からリリースを作る操作が、版を出す操作になる。過去の版の zip も残る |
| GitHub Actions（`release` の `published` イベント、Linux ランナー） | リリース時の検査・ビルド・zip 作成・添付 | 手元の PC に何も入れずに、手作業をなくせる。GitHub Free なら private リポジトリで月2,000分まで無料（[公式](https://docs.github.com/en/billing/concepts/product-billing/github-actions)） |
| 各ツールの既存のビルド環境（pdf-edit では Node.js・pnpm・Vite・vite-plugin-singlefile） | 各ツールを1ファイルの HTML にする | ツールの作り方を変えずに toolbox へ移せる |

## 構成

### リポジトリ
```
tools.json            ← zip に入れるツールの一覧（フォルダ名・表示名・説明、並び順）
tools/
  pdf-edit/           ← 各ツール。今の pdf-edit と同じ形（package.json、ロックファイル、テスト、Node.js の版指定）
.github/workflows/    ← リリース時の自動処理
（入口ページの生成と zip 作成のスクリプト）
```

### 各ツールに求める形
- 自分のフォルダの中だけで、依存関係の取得・検査・ビルドができる。依存関係とロックファイルはツールごとに持ち、ほかのツールと共有しない。
- ビルドの結果は、外部に何も読み込まない1ファイルの HTML になる。
- 検査とビルドを、決まった方法で呼べる（pdf-edit では `pnpm check` が検査とビルドを兼ねる）。

### リリース時の処理
1. GitHub の画面でリリースが公開されると動く。版番号はそのリリースのタグから取る。
2. `tools.json` のツールごとに、そのツールの Node.js・pnpm の版で `pnpm install --frozen-lockfile` → 検査 → ビルドを行う。1つでも失敗したら、そこで止めて zip は添付しない。
3. ビルドされた HTML を `tools/<フォルダ名>.html` として集め、画面の隅に版番号を書き足す。
4. `tools.json` から入口ページ `index.html` を作る。一覧・版番号・注意書きを HTML の中に直接書き込む。
5. `toolbox-<版>/` にまとめて `toolbox-<版>.zip` を作り、リリースに添付する。

## 選定に関わる制約
- `file://` で開いた HTML からは、ほかのファイルを `fetch` で読めない（Chrome・Edge）。そのため入口ページは実行時に `tools.json` を読むのではなく、ビルド時に一覧を書き込んだ静的な HTML にする。
- 各ツールへの版番号の書き足しは、そのツールのセキュリティ設定（CSP）の中で表示できる形にする。pdf-edit の CSP は外部の読み込みを禁じ、インラインの style と script を許している。
- zip の中の名前は英数字（と `-` `.`）だけにする。pdf-edit のビルド出力 `PDF編集.html` は、集めるときに `pdf-edit.html` へ名前を変える。

## 未決事項・未検証事項
- 会社の PC の設定で、`file://` の HTML や、pdf-edit が使う WebAssembly・Worker が制限されないか（未検証）。pdf-edit でも、Windows・Edge での `file://` 起動は未確認のまま。
- 版ごとに解凍先のフォルダが変わり、ツールのファイル名も変わる。そのため、pdf-edit のブラウザ内の復元データは版をまたいで引き継がれない見込み（未検証）。
- Windows 標準の解凍機能が、日本語のファイル名を正しく扱えるか（未検証）。zip の中を英数字だけにすることで、この問題は避けている。
- 作る人の GitHub のプラン（未確認）。Free なら無料枠は上記のとおり。
- 手で書いた（ビルドのない）HTML のツールを入れる場合の扱い（未決。[software-requirements.md](software-requirements.md) を参照）。

## 実装時に委ねること
- リリース用のワークフローと、入口ページ生成・zip 作成のスクリプトの書き方。既存のツールが使う Node.js で書き、新しい依存はなるべく足さない。
- 各ツールのビルド出力の見つけ方。`tools.json` に書くか、決まった場所（`dist/` の HTML 1つ）から探すか。
- タグが日付形式でないときに処理を止めるかどうかと、その方法。
- pdf-edit の CI（push ごとに Linux・macOS・Windows で `pnpm check` を行う）を toolbox でどう続けるか。リリースの処理は Linux だけで行う。
- pdf-edit の `release.yml` を外すことと、移したあとの README・AGENTS.md・docs の整理。
