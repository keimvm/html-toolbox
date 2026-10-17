# 作り直しの引き継ぎ（2026-10-18 時点）

toolbox を「過去の設計からは使う人の価値観だけを残し、あとは作り直す」作業の途中経過と、残りの作業をまとめる。次に作業する人（エージェント）は、[AGENTS.md](../AGENTS.md) の次にこの文書を読み、ここに書いた順で進める。作業が終わったら、この文書の「状態」と「残りの作業」を更新し、全部終わったら文書を消すか検証記録へ移す。

依頼の言葉：「このコードベースを書き直して。過去の設計からユーザの価値観だけ残し、あとはユーザが想像もできないほど素晴らしいプロダクトにしてほしい。限界を超えて」。この作業に限り、テスト・ビルド・ブラウザーでの確認を作業者が自分で実行してよく、区切りごとに `update` ブランチへ日本語でコミットしてよい（push はしない）。

## 1. 残す価値観（判断に迷ったらここに戻る）

- **手軽さ**：インストール不要。zip を解凍して `index.html` を Chrome・Edge で開くだけ。Windows・Mac。ネットなし・`file://` で動く。Safari は対象外。
- **手元で完結**：扱うファイル・入力を外部へ送らない。CDN・外部サイトを読み込まない。
- **元を壊さない**：PDF・画像は別ファイルとしてダウンロード保存。ノート・プロンプトは使う人が選んだフォルダのファイルが正本で、保存を確定した時だけ書く。保存前の外部変更検知・文字コード／改行の保持（ノート）、書き込み直前の読み直し・読めないファイルを上書きしない（プロンプト集）。
- **値の正しさ**：文字コードは Windows と同じ値。判定・変換は推測で補わない。
- **必要なものだけ**：各「企画書（requirements.md・RFP.md）」の「今は扱わない」を実装しない（カテゴリ・検索・更新履歴・自動更新・通知、タイピングの速さの目安・履歴、プロンプトの穴埋めなど）。
- **標準機能とライブラリを使う**：dialog・popover・File System Access・Canvas・DecompressionStream・View Transitions など標準機能、PDFium（EmbedPDF）・ProseMirror・markdown-it・jsdiff を使い、同じ役割を自作しない。共通にできるものは共通にする。
- **静かな上質**：アイボリー×エバーグリーン（ダークはシャンパン）、差し色の真鍮、見出しは OS の明朝体。動きは控えめで、`prefers-reduced-motion` で止める。読み上げ・キーボードで使える。
- **日本語**：画面の文言・説明・コミットは日本語。丁寧で具体的に。
- **版を出す手間をなくす**：日付形式の版（`YYYY.MM.DD`、同日2回目以降 `.2`）。リリースを作ると zip が自動で添付される。

## 2. 決めた設計（変える場合は理由を残す）

- **1つの HTML に全ツール**：配布物は `toolbox-<版>/index.html` の1ファイルだけ（約 8 MB）。旧構成は6つの HTML で約 38 MB（PDF編集と画像変換が PDFium を別々に持ち、さらに wasm が二重に入っていた）。
- **重いバイナリは HTML の末尾**：PDFium の wasm と Noto Sans JP を gzip＋Base64 にして `<script type="application/octet-stream" id="tb-payload-…">` に置き、PDF を使うときに Worker の中で `DecompressionStream` で展開する（[vite/toolbox.ts](../vite/toolbox.ts)、[src/engine/pdf/payload.ts](../src/engine/pdf/payload.ts)）。本体の script は普通の script にして重いデータの前に置き、画面を先に出す。実測：画面の準備 約10ms、読み込み完了 約40ms、PDFium 起動 約45ms（`file://`・ネット遮断・ヘッドレス Chrome 155）。
- **CSP**：`connect-src 'none'` で通信そのものを止める（[vite/toolbox.ts](../vite/toolbox.ts) の `CONTENT_SECURITY_POLICY`）。Worker は blob:、wasm は `'wasm-unsafe-eval'`。
- **ライセンス**：配布物に実際に入ったパッケージ（本体と Worker のモジュール＋埋め込んだバイナリ）のライセンス文を自動で集めて HTML 末尾に置き、「このアプリについて」で表示する。
- **ツールチェーンは直下の1つ**：pnpm 12.4.2・Vite 8.3.0（Rolldown）・TypeScript 6.0.3・Preact 10.29.8＋@preact/signals 2.11.3・Vitest 5.0.1。旧構成の「ツールごとに npm の依存を閉じる」はやめた（共通化の価値観を優先。代わりに全ツールのテストを毎回回す）。この理由は `docs/software-stack.md` の書き直しで残すこと（未）。
- **PDF エンジンは1つ**：[src/engine/pdf/](../src/engine/pdf/) の `runtime.ts` が旧 PDF編集と旧画像変換の処理を合わせたもの。`pdfEngine()` で全ツールが同じ Worker を使う。文書 id は `crypto.randomUUID()` などで重ならないようにする。要素の削除は `removeElements`（要素を除いた1ページの PDF を新しい元ファイルとして開く。取り消し・復元・保存はページの差し替えだけで済む）。
- **シェル**：[src/app/](../src/app/)。URL は `#/<ツールの id>`（`file://` で pushState を使わない）。一度開いたツールは画面を移っても生かしておく（作業が消えない）。ホームのタイルの並び・表示は旧と同じ `localStorage` の `toolbox-cards`、配色は `toolbox-theme`、背景の流れは `toolbox-flow`。
- **ツールの約束事**：[src/app/tool.ts](../src/app/tool.ts)。各ツールは `src/tools/<id>/index.tsx` で `ToolDefinition` を書き、[src/tools/index.ts](../src/tools/index.ts) に並べる。id は旧フォルダ名と同じ。
  - `intents`：ホームに置いた・貼り付けたもの（ファイル・フォルダ・文章）を受け取れるか。`mayAccept` はドラッグ中（MIME と数だけ分かる）の判定で、受け取れるタイルだけが光る。受け取れるのが2つ以上なら「何をしますか？」を出す（[src/app/deliver.ts](../src/app/deliver.ts)）。
  - `status`：`summary`（ホームのタイル・切り替えメニュー）、`unsaved`（作業中の印）、`guard`（閉じる前の確認）、`title`（タブの題名）。
  - 画面は `ToolFrame`（[src/app/frame.tsx](../src/app/frame.tsx)）で包む。左上は全ツール共通（ホーム・アイコンと名前＝ほかのツールへ移るメニュー・配色の切り替え）、`actions` に固有の操作。右下に版番号。
  - `View` は `active` を受け取る。見えていない間はキー操作・貼り付け・ドロップに反応しない。
- **共通部品**：[src/ui/](../src/ui/)（theme.css・components.tsx・icons.tsx・drop.ts）、[src/lib/](../src/lib/)（保存・配色・ダウンロード・ファイル・IndexedDB・クリップボード）。ドロップは `useDropZone` に登録し、画面全体で1か所が見張る。確認は `ask()`／`confirmAction()`（押した直後に同期で呼ぶ `start` で権限要求ができる）、知らせは `toast()`。
- **版とリリース**：[scripts/toolbox.mjs](../scripts/toolbox.mjs)（`test`・`build <版>`・`check`・`release <版>`・`check-version`）。版は環境変数 `TOOLBOX_VERSION` でビルドに埋め込む（未指定は「開発版」）。CI は [.github/workflows/](../.github/workflows/)（check：3 OS、release：Linux で検証→ビルド→zip 添付）。

## 3. 状態

| 部分 | 状態 | コミット |
| --- | --- | --- |
| 土台（ビルド・CSP・埋め込み・ライセンス・シェル・ホーム・CI・リリース処理） | できた。ホーム・ツールの枠を `file://` で撮影して確認 | e1fd2a6 |
| 文字コード変換 | できた。旧テスト（CP932 全件）を移して成功。`file://` で表示を確認 | dbc1a0e |
| タイピングゲーム | できた。旧テストを移して成功（揺らぐテストを修正）。`file://` で貼り付け〜結果まで操作して確認 | dbc1a0e |
| プロンプト集 | 未（仮の画面「準備中」） | |
| 画像変換 | 未（仮の画面） | |
| PDF編集 | 未（仮の画面）。エンジン（runtime.ts）だけ先に書いた。テスト未移行 | |
| ローカルノート | 未（仮の画面） | |
| 文書（README・AGENTS・docs・各ツールの文書） | 未。旧構成のまま（下の「注意」） | |

`pnpm check` は成功（単体テスト 45件・配布物のテスト 5件）。

## 4. 残りの作業（この順で）

各ツールの旧コードは、作り直し前のコミットから読む：`git show b78c8ce:tools/<id>/src/<ファイル>`（一覧は `git ls-tree -r --name-only b78c8ce tools/<id>`）。中核の処理（データの形・保存・判定・変換）は、その正しさが価値観そのものなので、テストごとほぼそのまま移す。画面は新しい部品で作り直す。

### 4.1 プロンプト集（`src/tools/prompt-library/`）

- 移す：`library.ts`・`storage.ts`・`folder-memory.ts`（IndexedDB は `src/lib/idb.ts` の `createRecordStore`。DB 名 `toolbox-prompt-library`・ストア `folders`・キー `library-folder` を変えず、旧版で選んだフォルダを引き継ぐ）、テスト `library.test.ts`・`storage.test.ts`。
- 画面：保存先の選択（前回のフォルダ／許可）、タグの絞り込み（AND・名前順）、カードの「コピー」「編集」、編集ダイアログ（タイトル・本文・タグ、使っているタグの候補）、削除の確認。追加・編集・削除の確定時に `changeLibrary()`（直前に読み直す）で書く。タブに戻ったら読み直す。読めないファイルは上書きせず理由と「もう一度読み込む」。
- intents：`new-from-text`（ホームに貼った文章を本文にして新しいプロンプトの編集画面を開く）、`use-folder`（置いたフォルダを保存先にする）。
- status：`summary` は「12件・フォルダ名」など。
- 完了条件：旧テストが成功。`file://` で表示・ダイアログ・コピーを確認（フォルダ選択の実操作は自動化できないため未確認として記録）。

### 4.2 PDF エンジンのテスト（`src/engine/pdf/`）

- 旧 `pdf-edit/tests/pdf.test.ts`・`sample-pdf.ts` と旧 `image-converter/tests/pdf.test.ts`・`samples.ts` を、新しい `PdfRuntime`（`PageRef` は `{ sourceId, sourceIndex, rotation }`、`inspect` の要素は `kind` が英語の種類名に変わった）に合わせて移す。`removeElements` のテスト（取り除いた要素が消え、残りと文字が保たれ、元の PDF は変わらない）を足す。
- テストで wasm は `node_modules/@embedpdf/pdfium/dist/pdfium.wasm`、フォントは `node_modules/@embedpdf/fonts-jp/fonts/NotoSansJP-Regular.otf` を読む。`fetch` を禁止してネット通信がないことも確かめる（旧テストと同じ）。

### 4.3 画像変換（`src/tools/image-converter/`）

- 移す：`settings.ts`・`fit.ts`・`geometry.ts`・`convert.ts`・`items.ts`（ダウンロードは `src/lib/download.ts`）・テスト（`geometry`・`settings`）。PDF は共有エンジン（`render` は `scale = dpi / 72`、`create`、`shrink`）。
- 画面：一覧（見本・元と変換後の大きさ・容量・上限超えの印）、全体の設定（形式・上限・長い辺）、個別の画面（見比べ全体／100%／200% とスクロール同期、切り抜き・塗りつぶし・回転、個別の設定、前後の画像）、PDF にまとめる、PDF を小さくする、すべて保存。旧 `detail.ts` の座標・スクロール同期の処理は細かいので丁寧に移す。
- intents：`add`（画像・PDF を一覧に加える）、`combine`（画像を2枚以上置いたとき「まとめて1つのPDFにする」＝一覧に加えて PDF のダイアログを開く）、`shrink`（PDF 1つを「小さくする」で開く）。
- status：`unsaved`＝保存していない変換結果がある、`guard` も同じ（作業内容はブラウザーに残さないため）。
- 新しい受け渡し：まとめた PDF のダイアログに「PDF編集で開く」を足す（`openTool('pdf-edit', { intent: 'open', input: { kind: 'files', files: [new File(...)] } })`）。

### 4.4 PDF編集（`src/tools/pdf-edit/`）

- 移す：`editor.ts`（ページの順・回転・削除・結合・取り消し50件）、`preview.ts`、`session-store.ts`（復元用。キーは配置 URL ではなく固定のキーにして版をまたいで復元する。DB 名は新しくしてよい）、テスト（`editor`・`preview`・`session-store`、fake-indexeddb）。
- 画面：左のページ一覧（サムネイル・矢印キー・ドラッグで並べ替え）、中央の縦スクロールのプレビュー（遅延描画・倍率 25〜300%・幅に合わせる・スクロールに合わせた選択）、回転・削除・前後へ移動・元に戻す（⌘/Ctrl+Z）、PDF を追加（結合）、保存（PDF 全体／選択ページを PNG・JPEG）、「画像・文字」パネル（画像の情報と PNG 保存・文字の表示と保存・要素一覧）、閉じる（復元用データも消す）、復元の状態表示（「再読み込みに対応」）。
- **要素の削除（新規）**：旧企画書（`docs/RFP.md`）の「扱うもの」にあったが保留されていた。要素一覧で選んだページ直下の要素を `removeElements` で取り除き、新しい元ファイルのページに差し替える（取り消し可能、復元用データにも新しい元ファイルを保存）。グループ（Form XObject）内は対象外と画面で示す。OCR と Markdown 変換は引き続き扱わない。
- intents：`open`（PDF を開く。開いていれば末尾に結合するか選ぶ）。
- 新しい受け渡し：「このPDFを画像変換で画像にする」「小さくする」（今のページ構成で書き出した PDF を渡す）。
- status：`title` はファイル名、`summary` は「報告書.pdf・12ページ」、`unsaved`＝変更あり、`guard`＝復元用データの保存が済んでいない間。

### 4.5 ローカルノート（`src/tools/note-html/`、最大の作業）

- 旧コードは JavaScript で約 140 KB と密。`core.js`・`markdown.js`・`markdown-document.js`・`rich-editor.js`（Typora 互換の操作が詰まっている）・`file-operations.js`・`assets.js`・`export.js` の振る舞いは利用者が決めてきた仕様なので、テスト（旧 `tests/*.test.js`、jsdom＋fake-indexeddb）ごと移すことを最優先にする。TypeScript 化は振る舞いを変えない範囲で行い、無理なら `.js` のまま移してよい。
- 画面（`app.js`・`layout.js`・`display.js`・`toolbar.js`・`index.html`・`style.css`・`document.css`）は新しい枠と部品で作り直す。左のツリー（展開・キー操作・⋯メニューで追加／名前変更／削除）、幅の調整と開閉、書式メニュー（Popover）、Markdown ソースの切り替え（⌘/Ctrl+/）、保存（⌘/Ctrl+S）と状態表示、添付（`.assets` へコピー）、エクスポート（HTML・PDF 印刷）、設定（本文の文字サイズ・UI フォント・UI の大きさ）、復元（前回のフォルダ・ノート・展開）。
- 1つの HTML に同居するため注意：印刷時は本文以外を隠す CSS、ProseMirror の CSS（`prosemirror-view/style/prosemirror.css` など）を取り込む、`document.css`（本文の配色をライトで持つ）は HTML エクスポートにだけ入れる。
- intents：`open-folder`（置いたフォルダを開く。ドロップの `getAsFileSystemHandle` で受け取れる）。
- status：`title` はファイル名、`unsaved`＝未保存、`guard`＝未保存・添付中・ファイル操作中。

### 4.6 仕上げ

1. **ホームの磨き込み**：ドラッグ中のタイルの光り方・「何をしますか？」の文言を全ツールで見直す。貼り付けた画像（クリップボード）が画像変換へ渡ることを確認。
2. **文書の書き直し**（[AGENTS.md](../AGENTS.md) の「文書」の方針に従う）：
   - 直下 `README.md`（使う人向け：1ファイルになったこと、ホームに置く・貼る、ツール間の受け渡し、データの扱い、新しい版への切り替え）。
   - `AGENTS.md`（新しい構成・コマンド・作業の流れ。ツール追加の手順は `src/tools/index.ts` と `tool.ts`）。
   - `docs/development.md`（コマンド・構成・共通部品・ツールを追加する・リリース）、`docs/software-requirements.md`・`docs/software-stack.md`（新しい設計と採用理由。Preact・1ファイル化・依存の一本化の理由）。`docs/requirements.md`（企画書）は書き換えない。
   - 各ツールの `README.md`・`AGENTS.md`・`docs/software-requirements.md`・`docs/software-stack.md` を新しい作りに合わせる。企画書（`requirements.md`・`RFP.md`）と検証記録の過去の記述は書き換えず、新しい記録を足す。
   - `docs/verification.md` に今回の作り直しの検証記録を足す（自動テスト、ヘッドレス Chrome の `file://`・ネット遮断での確認、未確認のこと）。
   - この文書（rewrite-handoff.md）を消す。
3. **総合確認**：`node scripts/toolbox.mjs release <今日の日付>` で zip を作り、`out/toolbox-<版>/index.html` を `scripts/cdp.mjs` で開いて、全ツールの表示・ライト／ダーク・375px 幅・`prefers-reduced-motion`・コンソールのエラー0・外部通信0を確かめる。
4. **最終報告**：未コミットの有無、実行したテスト、未確認のこと（下の5章）を明記する。

## 5. 未確認のこと（作り直しの最後まで残る見込み）

- Windows・Edge、会社の PC の管理設定、Chrome 129（最小の対応版）そのもの。確認は Mac の Chrome 155（ヘッドレス）だけ。
- 実際の日本語 IME での打鍵（CDP の変換の模擬は実際の IME と動きが違い、変換直後の確定で進み具合が増えない場面があった。実機で要確認）。
- File System Access のフォルダ選択・許可の流れ（自動化できない）。実フォルダへの保存。
- ファイルのドラッグ＆ドロップの実操作、ダウンロードの保存先、印刷画面。
- GitHub 上の CI・Release ワークフローの実行（`pnpm/action-setup@v6` が `packageManager` から pnpm の版を読む想定）。

## 6. 作業の手順とコマンド

```bash
pnpm install --frozen-lockfile
pnpm dev                       # http://127.0.0.1:5173/ （開発サーバー。CSP と埋め込みはない）
pnpm test                      # 単体テスト（src/**/*.test.ts(x)・scripts/*.test.mjs）
pnpm check                     # 整形・lint・型・テスト・ビルド・配布物のテスト
TOOLBOX_VERSION=2026.10.18 pnpm build   # 版を付けたビルド（dist/index.html）
node scripts/toolbox.mjs release 2026.10.18   # 検証付きの zip（out/）
```

`file://` での確認（ヘッドレス Chrome、ネット遮断）：

```js
import { launch } from './scripts/cdp.mjs';
const b = await launch({ offline: true, width: 1280, height: 800 });
await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await b.goto('file:///<リポジトリ>/dist/index.html#/typing-game');
await b.evaluate(`document.querySelector('.tg-start')?.click()`);
await b.screenshot('shot.png');      // 画像は Read で見られる
console.log(b.logs);                 // コンソール・例外・外部への通信
await b.close();
```

`Input.insertText`（確定した文字の入力）、`Input.dispatchKeyEvent`（キー）、`Input.imeSetComposition`（変換中の模擬）が使える。Claude の内蔵ブラウザーはローカルファイルを静的な写しで表示するため、`file://` の確認には使えない。

## 7. つまずきやすい点

- **循環参照**：`src/app/` から `src/tools/` を import しない。ツールの一覧は `main.tsx` が `registerTools()` で登録し、`src/app/registry.ts` の `allTools()`・`toolById()` で読む。モジュールの読み込み時に一覧を使う処理を書かない（IIFE の出力では `… is not a function` で起動が止まる）。
- **ref のコールバック**は値を返さない（`ref={(el) => { x = el; }}`）。Preact の型が後片付けの関数しか許さない。
- **直接書き換える DOM**（タイピングの見本の文字など）は、`shouldComponentUpdate() { return false }` の部品の中に置き、Preact に描き直させない。
- **見えていないツール**も生きている。グローバルなキー・貼り付けの処理は `active` を見る。`ResizeObserver` は隠れている間 0 を返す。
- 重いバイナリを JavaScript 側へ取り込まない。`?url&inline` を使わず、`virtual:toolbox/payload` の `payloadSource()` を Worker に渡す。`@embedpdf/pdfium` の `new URL('pdfium.wasm', import.meta.url)` は `dropPdfiumUrl()` で無効にしている。
- `@embedpdf/models` が `crypto` を import する警告（`Module "crypto" has been externalized`）は旧構成からある既知のもので、動作に影響しない。
- 整形は Prettier（printWidth 100）。Markdown・`fixtures/`・`designs/`・`tools/`（旧構成の検証画像が残っている Git 管理外のフォルダ）は整形の対象外。
- `src/tools/mojicode-converter/fixtures/` の対応表は入手したままのバイト列（CRLF）で保つ（`.gitattributes`）。

## 8. 注意：古いままの文書

次の文書はまだ旧構成（`tools/<フォルダ名>/` ごとの pnpm・`tools.json`・`ui/`）を前提に書かれている。作業の進め方は守り、構成とコマンドについてはこの文書を優先する。4.6 で書き直す。

- [AGENTS.md](../AGENTS.md)、[README.md](../README.md)、[docs/development.md](development.md)、[docs/software-requirements.md](software-requirements.md)、[docs/software-stack.md](software-stack.md)
- 各ツールの `src/tools/<id>/README.md`・`AGENTS.md`・`docs/`
