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
  note-html/          ← esbuild・Node.js のテストランナーを継続。依存関係は独立
ui/                  ← 全ツールと入口ページで共通の配色・部品（theme.css）、ダウンロード・D&D の処理。npm の依存なし
.github/workflows/    ← リリース時の自動処理
（入口ページの生成と zip 作成のスクリプト）
```

### 各ツールに求める形
- 自分のフォルダの中で、依存関係の取得・検査・ビルドができる。依存関係とロックファイルはツールごとに持ち、ほかのツールと共有しない。
- 見た目と共通処理は、直下の `ui/` のソースを相対パスで取り込む（`theme.css`、`download.js`、`file-drop.js`）。ツールのビルドが単一 HTML に埋め込む。
- ビルドの結果は、外部に何も読み込まない1ファイルの HTML になる。
- ヘッダーのツール名の手前に `<template id="toolbox-home"></template>` を1つ置く。共通の配布加工処理でトップへのリンクに置き換える。
- 検査とビルドを、決まった方法で呼べる（pdf-edit では `pnpm check` が検査とビルドを兼ねる）。

### 開発時の検証

- Check は main への push、PR、手動実行で動く。PR と作業ブランチへの push による二重実行を避ける。
- 通常は Git の差分から、変更した登録済みツールだけを Linux・macOS・Windows で検証する。直下と各ツールの README・AGENTS.md・docs だけの変更ではツールのビルドを省略する。ツール一覧・共通スクリプト・ワークフローなどの変更と手動実行は全ツールを検証する。
- 差分は push では直前のコミットとの比較、PR ではベースとの分岐点からの比較を使う。改名・削除も対象とし、比較失敗を「変更なし」にはしない。
- 通常 CI とリリースは `.github/workflows/tool.yml` を共用する。依存取得 → `pnpm check` → 単一 HTML の確認・収集まで同じ手順を実行し、リリース時だけ収集した HTML を artifact に保存する。[GitHub の再利用可能なワークフロー](https://docs.github.com/ja/actions/how-tos/reuse-automations/reuse-workflows)を使用する。
- 一覧の読み込み時に packageManager・scripts.check・ロックファイル・Node.js の版指定を検査する。ツールの追加時にワークフローを編集する必要はない。
- 直下スクリプトは Node.js の標準機能だけを使う。変更対象の選択や手元の一括実行のために、ルートの npm 依存や workspace は導入しない。
- 手元では `node scripts/toolbox.mjs check [ツール名]` で依存取得から収集まで実行できる。`release <版>` は全ツールを作り直し、zip まで生成する。ローカルの Node.js は自動切り替えしない。

### リリース時の処理
1. GitHub の画面でリリースが公開されると動く。版番号はそのリリースのタグから取る。
2. `tools.json` のツールごとに、そのツールの Node.js・pnpm の版で `pnpm install --frozen-lockfile` → 検査 → ビルドを行う。1つでも失敗したら、そこで止めて zip は添付しない。
3. ビルドされた HTML を `tools/<フォルダ名>.html` として集め、指定位置をトップへの相対リンクに置き換え、画面の隅に版番号を書き足す。
4. `tools.json` から入口ページ `index.html` を作る。一覧・版番号・注意書きを HTML の中に直接書き込む。
5. `toolbox-<版>/` にまとめて `toolbox-<版>.zip` を作り、リリースに添付する。

リリース時は差分にかかわらず全ツールを検証する。過去の CI のビルド成果物を流用せず、リリースのタグからビルドする。これによりタグのソースと配布物の対応を保つ。通常 CI で対象を絞ることと、依存キャッシュ・共通ワークフローの利用で開発時の待ち時間と保守の手間を抑える。

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

## 実装上の決定

- 入口ページ生成・zip 作成は Node.js の標準機能と OS の `zip` コマンドで行う。直下の npm 依存は追加しない。
- ビルド出力は `dist/` の HTML 1ファイルから取得する。他のファイル・フォルダがある場合、トップへのリンクの挿入位置が不足・重複している場合、版番号を付けられない場合は収集を失敗させる。
- タグが実在する日付の形式でないときは、ツールをビルドする前に停止する。
- pdf-edit の検証は上記の共通ワークフローで継続する。単体の `release.yml` は移動時に削除し、配布は toolbox に統一した。
- note-html は既存の esbuild で `dist/index.html` を生成し、収集時に `note-html.html` とする。Node.js・pnpm はツール内で固定し、CI・リリースは共通ワークフローを使う。生成物や検証画像は Git 管理に含めない。
- 共通 UI は npm パッケージや workspace にせず、直下の `ui/` のソースを各ツールが相対パスで取り込む。ツールごとのビルド基盤（Vite・esbuild）を変えずに使え、ツールの依存関係とロックファイルは独立したままにできるため。CI は `tools/` 以外の変更として全ツールを検証する。
- 配色は CSS の `light-dark()` と `color-scheme: light dark` で OS の設定に従わせ、印刷時は `color-scheme: light` にする。JavaScript や保存した設定を使わないため、`file://` でも入口ページ（スクリプトなし）でも同じ動きになる。PDF編集の Vite は古いブラウザー向けに変換した形で出力するが、動きは同じ。
- 共通部品の CSS は `:where()` で詳細度を 0 にし、ツールの CSS で調整できるようにする。入口ページは `scripts/toolbox.mjs` が `ui/theme.css` を埋め込んで生成する。
