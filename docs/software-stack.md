# toolbox 技術構成

元の企画書：[requirements.md](requirements.md)。何を満たすかは [software-requirements.md](software-requirements.md) を参照。

## 採用する技術と役割

選定の基準は [開発手順の実装方針](development.md#実装方針) に従う。

| 技術 | 役割 | 採用理由 |
| --- | --- | --- |
| GitHub（private リポジトリ1つ） | 全ツールのソースと履歴の管理 | 既に使っている。1つにまとめることで、版を出す操作と版番号が1つで済む。private のまま、ほかのリポジトリを読むための鍵も要らない |
| GitHub Releases | 版の記録と zip の置き場 | CLI または画面からリリースを作る操作が、版を出す操作になる。過去の版の zip も残る |
| GitHub Actions（`release` の `published` イベント、Linux ランナー） | リリース時の検査・ビルド・zip 作成・添付 | 手元の PC に何も入れずに、手作業をなくせる。GitHub Free なら private リポジトリで月2,000分まで無料（[公式](https://docs.github.com/en/billing/concepts/product-billing/github-actions)） |
| 各ツールの既存のビルド環境（pdf-edit では Node.js・pnpm・Vite・vite-plugin-singlefile） | 各ツールを1ファイルの HTML にする | ツールの作り方を変えずに toolbox へ移せる |

## 構成

リポジトリの構成は [development.md の構成](development.md#構成)、各ツールに求める形は [ツールを追加する](development.md#ツールを追加する)、CI の検証対象と手元のコマンドは [CI の検証対象](development.md#ci-の検証対象)・[コマンド](development.md#コマンド) を参照。

### CI の設計

- 差分は push では直前のコミットとの比較、PR ではベースとの分岐点からの比較を使う。改名・削除も対象とし、比較失敗を「変更なし」にはしない。
- 通常 CI とリリースは `.github/workflows/tool.yml` を共用する。依存取得 → `pnpm check` → 単一 HTML の確認・収集まで同じ手順を実行し、リリース時だけ収集した HTML を artifact に保存する。[GitHub の再利用可能なワークフロー](https://docs.github.com/ja/actions/how-tos/reuse-automations/reuse-workflows)を使用する。
- 一覧の読み込み時に packageManager・scripts.test / test:dist / build / check・ロックファイル・Node.js の版指定・アイコン（`src/icon.png`）を検査する。ツールの追加時にワークフローを編集する必要はない。

### リリース時の処理
1. `gh release create <版> --target <公開対象SHA> --title <版> --notes-file <説明ファイル>` または GitHub の画面でリリースが公開されると動く。公開対象は push 済み・Check 成功済みのコミットにする。版番号はそのリリースのタグから取る。
2. `tools.json` のツールごとに、そのツールの Node.js・pnpm の版で `pnpm install --frozen-lockfile` → 検査 → ビルドを行う。1つでも失敗したら、そこで止めて zip は添付しない。
3. ビルドされた HTML を `tools/<フォルダ名>.html` として集め、指定位置をトップへの相対リンクに置き換え、画面の隅に版番号を書き足す。
4. `tools.json` から入口ページ `index.html` を作る。一覧・版番号を HTML の中に直接書き込む。
5. `toolbox-<版>/` にまとめて `toolbox-<版>.zip` を作り、リリースに添付する。

公開後にワークフローが失敗した場合、リリース自体は存在していてもzipは添付されない（公開後の確認は [development.md](development.md#github-に版を公開する)）。

リリース時は共通スクリプト・UI と、差分にかかわらず全ツールを検証する。過去の CI のビルド成果物を流用せず、リリースのタグからビルドする。これによりタグのソースと配布物の対応を保つ。通常 CI で対象を絞ることと、依存キャッシュ・共通ワークフローの利用で開発時の待ち時間と保守の手間を抑える。

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

- 入口ページ生成・zip 作成・CI の対象選択は Node.js の標準機能と OS の `zip` コマンドで行う。直下の npm 依存や workspace は導入しない。
- ビルド出力は `dist/` の HTML 1ファイルから取得する。他のファイル・フォルダがある場合、トップへのリンクの挿入位置が不足・重複している場合、版番号を付けられない場合は収集を失敗させる。
- タグが実在する日付の形式でないときは、ツールをビルドする前に停止する。
- pdf-edit の検証は上記の共通ワークフローで継続する。単体の `release.yml` は移動時に削除し、配布は toolbox に統一した。
- note-html は既存の esbuild で `dist/index.html` を生成し、収集時に `note-html.html` とする。Node.js・pnpm はツール内で固定し、CI・リリースは共通ワークフローを使う。生成物や検証画像は Git 管理に含めない。
- 共通 UI は npm パッケージや workspace にせず、直下の `ui/` のソースを各ツールが相対パスで取り込む。ツールごとのビルド基盤（Vite・esbuild）を変えずに使え、ツールの依存関係とロックファイルは独立したままにできるため。CI は `tools/` 以外の変更として全ツールを検証する。
- 配色は CSS の `light-dark()` と `color-scheme: light dark` で OS の設定に従わせ、印刷時は `color-scheme: light` にする。画面の切り替えは `ui/theme-toggle.js` が `:root` に `data-tb-theme` を付けて `color-scheme` だけを上書きするため、配色トークンを二重に持たない。選んだ表示は標準の `localStorage`（キー `toolbox-theme`）に残す。Chrome・Edge は `file://` のページで保存領域を共有するため、入口ページ・全ツール・別の版で同じ表示になる。保存できない環境ではその画面の中だけで切り替える。入口ページも同じ処理をインラインの script で埋め込む。
- PDF編集の Vite（Lightning CSS）は、対象ブラウザーが古いと `light-dark()` を OS の設定だけに従う変数へ変換し、切り替えが効かない。対象の Chrome・Edge 129 は `light-dark()` に対応するため、`build.cssTarget` を Chrome・Edge 129 にして変換させない。
- ツールのアイコンは各ツールの `src/icon.png` 1つを正とし、ヘッダーと入口のカードに data URL で埋め込む。ユーザー指定の imagegen で生成し、macOS 標準の `sips` で128×128へ縮小する。PDF編集は既存の Vite のアセット埋め込み、ノートと入口は Node.js 標準の `Buffer.toString('base64')` を利用する。`ui/header.js` がヘッダーと同じ画像を favicon にも使うため、独自の設定処理や新しい依存は追加しない。CSP の `img-src` は `data:` を許可する。
- 入口ページのカードの並べ替えは、標準の HTML ドラッグ＆ドロップ（`draggable`・`dragover`・`dragend`）と、キーボード・タッチ用の「前へ」「後へ」ボタンで行う。並べ替えライブラリ（SortableJS など）は、`scripts/` と入口ページに npm の依存を持たない方針と、カード数件の入れ替えに必要な処理が少ないことから採用しない。編集中はカードのリンクに標準の `inert` を付け、開かずにドラッグを受ける。並び・非表示は配色と同じく `localStorage`（キー `toolbox-cards`）に残し、版をまたいで共有する。処理は `scripts/index-cards.js` に分け、保存内容の当てはめを Node.js のテストで確かめる。
- 入口ページの背景の流れ（`scripts/index-flow.js`）は標準の Canvas 2D と `requestAnimationFrame` で描く。流れは、ゆっくり形を変える波を重ねた関数の回転（curl）を速さにし、カーソルの周りに渦・中心の押しのけ・動かした向きへの引きずりを足す。描画ライブラリ（p5.js・three.js など）やノイズのライブラリは、入口ページに npm の依存を持たない方針と、必要な処理が線数百本の移動と描画に限られることから採用しない。線は透明度の段階ごとに `Path2D` へまとめて描き、履歴は 1/60 秒ごとに記録して画面の書き換えの速さによらず尾の長さを揃える。描画ループはタブが隠れている間はブラウザーが止める。
- 共通部品の CSS は `:where()` で詳細度を 0 にし、ツールの CSS で調整できるようにする。入口ページは `scripts/toolbox.mjs` が `ui/theme.css` を埋め込んで生成する。
- ノートのメニューには標準の Popover API と CSS アンカー配置を使う。独自の開閉状態・外側クリック・Escape 処理を持たず、操作後・Tab 移動時の閉鎖だけを補う。[Chrome 129 で導入された `position-area`](https://developer.chrome.com/blog/anchor-syntax-changes) を含め、対応は Chrome・Edge 129 以降とし、最新の安定版を推奨する。
- HTML エクスポートの画像埋め込みは [FileReader.readAsDataURL](https://developer.mozilla.org/en-US/docs/Web/API/FileReader/readAsDataURL) を使い、バイト列から Base64 を組み立てる処理を持たない。
- 復元情報の配置 URL とダイアログ操作欄を共通化する。IndexedDB の構造と保存方法は、PDF 本体を保持する PDF編集と、ファイルハンドル・表示設定だけを記録するノートで異なるため、各ツールが管理する。
- 自前処理として残すのは、ノートの外部変更検知・原文保持・添付の参照制約、PDF の編集状態と保存対象の選択など、標準 API やライブラリを利用するための固有要件。PDF の処理エンジン、Markdown パーサー、文書編集・履歴・表の仕組みは既存ライブラリに任せる。今回、新しい npm 依存は必要ない。
