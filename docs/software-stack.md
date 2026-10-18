# toolbox 技術構成

元の企画書：[requirements.md](requirements.md)。何を満たすかは [software-requirements.md](software-requirements.md)、構成と手順は [development.md](development.md) を参照。

## 採用する技術と役割

選定の基準は [開発手順の実装方針](development.md#実装方針) に従う。npm の依存の版はすべて直下の `package.json` で固定する。Rust の版はクレートの `rust-toolchain.toml` で固定する。

| 技術 | 役割 | 採用理由 |
| --- | --- | --- |
| GitHub（private リポジトリ1つ）・Releases・Actions | ソースと履歴、版の記録と zip の置き場、検証と zip の自動作成 | 既に使っている。リリースを作る操作が版を出す操作になり、手元の PC に何も入れずに手作業をなくせる |
| Node.js 24・pnpm 12 | 開発・ビルド・テストの実行 | 旧構成から使っている。`scripts/` は Node.js の標準機能だけで書く |
| TypeScript 6 | アプリと共通部品・各ツールの型 | 6つのツールと共通部品の受け渡しの形（ツールの約束事・PDF エンジンの操作）を型で守る |
| Vite 8（Rolldown）・vite-plugin-singlefile | 1つの HTML へのビルド、開発サーバー | 旧 PDF編集・画像変換で使っていた。JavaScript・CSS・画像を1つの HTML に入れられ、Worker も `?worker&inline` で同じ HTML に入る |
| Preact 10・@preact/signals 2 | 画面の部品と状態 | 6つのツールとホームの画面を同じ部品（ボタン・ダイアログ・メニュー・知らせ）で作り、状態の変化を必要な部分だけに伝えるため。React と同じ書き方で、配布物への増加は数十 KB に収まる |
| EmbedPDF（`@embedpdf/engines`・`@embedpdf/pdfium`・`@embedpdf/fonts-jp`） | PDF の読み込み・描画・文字の取り出し・結合、PDFium の公開 API による回転の保存・要素の一覧と削除・画像からの PDF 作成・縮小 | 旧 PDF編集・画像変換で採用済み。PDFium を1つにし、両ツールで共有する |
| markdown-it・ProseMirror（`prosemirror-*`）・prosemirror-markdown | ローカルノートの Markdown の解析・表示・直接編集・取り消し・表 | 旧ローカルノートで採用済み |
| Rust 1.96（WebAssembly、wasm32-unknown-unknown） | タイピングゲームの見本と入力の文字単位の差分（`src/tools/typing-game/wasm/`） | 利用者の指示で、旧タイピングゲームの jsdiff から切り出した（2026-10-18）。打ち切りの期限を確かめる必要があり、依存なしの自前の差分にした。理由は [タイピングゲームの技術構成](../src/tools/typing-game/docs/software-stack.md#差分を-rust-の-webassembly-にする理由2026-10-18) |
| Vitest 5・jsdom・fake-indexeddb | 単体テスト（画面の振る舞いを含むローカルノートのテスト、IndexedDB の記録） | Vite と同じ設定で TypeScript・JavaScript のテストを動かせる。旧ローカルノートの `node --test` のテストはそのまま移せた |
| ESLint・Prettier | lint と整形 | 旧構成から使っている |

## 1つのアプリにした理由（2026-10-18）

旧構成は、ツールごとに1つの HTML（6ファイル）を作り、ツールごとに npm の依存とロックファイルを閉じ、入口ページを生成して zip にまとめていた。使う人の価値観（手軽さ・手元で完結・元を壊さない・値の正しさ・必要なものだけ・標準機能とライブラリ・静かな上質・日本語・版を出す手間をなくす）は変えず、次の理由で1つのアプリに作り直した。

- **配布物が小さくなる**：PDF編集と画像変換がそれぞれ PDFium を持ち、さらに wasm が二重に入っていたため、配布物は約 38 MB だった。PDF エンジンを1つにして、約 9 MB になった。
- **ツールの間で受け渡せる**：画像変換でまとめた PDF を PDF編集で開く、ホームに置いたファイルを使えるツールで開くなど、別々の HTML では `file://` の制約（ほかのファイルを読めない・ページの間で受け渡す手段が限られる）でできなかった流れを、同じページの中の受け渡しで行える。
- **作業が消えない**：ツールを移っても、開いたツールの作業内容を保てる（別の HTML へ移ると消えていた）。
- **共通部品を1つにする**：旧構成は共通部品（`ui/`）を相対パスで各ツールのビルドに取り込み、同じ見た目の部品を各ツールで組み立てていた。1つのアプリでは同じ部品をそのまま使え、配色の切り替え・ドロップ・確認・知らせの振る舞いが揃う。
- **依存を1つにまとめる**：旧構成の「ツールごとに依存を閉じ、あるツールの更新がほかに影響しない」利点は、共通化の価値を優先して手放した。代わりに、総合検証（`check`）で毎回全ツールのテストを実行し、影響を見逃さないようにする。

## 1つの HTML にまとめる仕組み

- **重いデータは HTML の末尾**：PDFium の wasm と Noto Sans JP（日本語のフォントを含まない PDF を描くため）を gzip と Base64 にし、実行しない script 要素として HTML の末尾に置く。本体の script（IIFE）はその前に置き、画面を先に出す。PDF を初めて使うとき、文書を読み終えてから Worker に渡し、Worker の中で標準の `DecompressionStream` で展開する。JavaScript の文字列として取り込まないため、起動時に読み込む量が増えない。実測（`file://`・ネット遮断・ヘッドレス Chrome 155）：画面の準備 約10ms、読み込み完了 約40ms、PDFium の起動 約45ms。
- **通信を止める**：CSP（`default-src 'none'`・`connect-src 'none'`）で外部との通信と外部の読み込みを止める。Worker は `blob:`、wasm は `'wasm-unsafe-eval'` だけを許す。
- **小さな WebAssembly は JavaScript の中**：タイピングゲームの差分（Rust、wasm は約20 KB）は、Vite の `?init` で Base64 にして本体の JavaScript に入れ、ツールを開いたときに読み込む。cargo でのビルドは `vite/rust.ts` が Vite の起動時に行う。
- **ライセンス**：ビルドの中で、配布物に実際に入ったパッケージ（本体と Worker のモジュール、埋め込んだバイナリ）を集め、そのライセンス文を HTML の末尾に置く。「このアプリについて」で表示する。Rust の WebAssembly に入る標準ライブラリのライセンス文は、まだ対象にしていない（未決）。
- **配色**：色は CSS の `light-dark()` で持ち、切り替えは `:root` の `data-tb-theme` で `color-scheme` を上書きする。Vite（Lightning CSS）が `light-dark()` を OS の設定だけに従う形へ変換しないよう、`build.cssTarget` を Chrome・Edge 129 にする。

## 選定に関わる制約

- `file://` で開いた HTML からは、ほかのファイルを `fetch` で読めない（Chrome・Edge）。そのため、必要なものはすべて1つの HTML に入れる。
- `file://` は `pushState` で URL を変えられない場合があるため、画面の移動は URL のハッシュで行う。
- `file://` の Chrome・Edge は `localStorage`・IndexedDB を全ページで共有する。記録のキーに配置 URL を含めなければ、版（解凍先のフォルダ）をまたいで同じ記録を読める。`file://` では OPFS は使えない。
- File System Access のフォルダの許可は、利用者の操作の直後にしか求められない。ホームに置いたフォルダは、「何をしますか？」で選んだ操作の直後に許可を求め、求められないときは画面のボタンから求める。
- 対象の Chrome・Edge 129 は、`light-dark()`、Popover API、CSS アンカー配置（`position-area`）、`DecompressionStream`、View Transitions に対応する。

## 実装上の決定

- 画面の移動は `src/app/workspace.ts` が持ち、View Transitions でホームのタイルのアイコンがツールの見出しへ移るように見せる（動きを減らす設定・タブが隠れているときは使わない）。
- ツールの約束事（`src/app/tool.ts`）は、ツールが受け取れるもの（`intents`）と状態（`status`）だけを外へ見せる。ホームはツールの中身を知らずに、受け渡しと作業中の表示ができる。
- 確認・知らせ・メニューは標準の `dialog`・`popover` と CSS のアンカー配置に任せ、開閉・外側クリック・Escape を自作しない。ブラウザーの許可の要求が要る確認は、押した直後に同期で処理を始める（`ask()` の `start`）。
- ファイルのドロップは画面全体で1か所が見張り（`src/ui/drop.ts`）、受け付ける場所を登録する。どの場所にも入らないファイルでブラウザーが画面を離れないようにする。
- PDF エンジンは旧 PDF編集と旧 画像変換の処理を合わせ（`src/engine/pdf/runtime.ts`）、全ツールが同じ Worker を使う。文書 id は重ならないよう `crypto.randomUUID()` で作る。ページの要素の削除は、要素を除いた1ページの PDF を新しい元の文書として開き、ページを差し替える（取り消し・復元・保存はページの差し替えだけで済む）。
- ローカルノートの振る舞い（約 140 KB の JavaScript）は、利用者が決めてきた仕様の塊のため、旧コードとテストをそのまま移した。画面の骨組みを toolbox の共通ヘッダーの中に置き、Preact には一度だけ描かせて以後は旧コードに任せる。CSS は `.nh` の中に閉じ、本文の CSS（`document.css`）は本文の要素にだけ効かせて画面とエクスポートで共用する。
- 旧構成の共通部品（`ui/header.js`・`theme-toggle.js`・`download.js`・`file-drop.js`・`idb-record.js`・`session-key.js`）は、`src/app/frame.tsx`・`src/lib/theme.ts`・`src/lib/download.ts`・`src/ui/drop.ts`・`src/lib/files.ts`・`src/lib/idb.ts` に置き換えた。配置 URL をキーにする `session-key.js` は、版をまたいで記録を読むため使わない。
- 画面の確認は Playwright を使わず、Node.js の標準機能（`child_process`・`WebSocket`）で Chrome DevTools Protocol を話す `scripts/cdp.mjs` で行う。自動テストには含めない。

## 未決事項・未検証事項

- 会社の PC の設定で、`file://` の HTML や WebAssembly・Worker・File System Access が制限されないか（未検証）。
- Windows・Edge、Chrome 129 そのものでの動作（確認は Mac の Chrome 155 だけ）。
- 作る人の GitHub のプラン（未確認）。
