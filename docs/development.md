# toolbox の開発・リリース手順

開発・保守・配布を行う人向けの手順です。利用方法は [README](../README.md) を参照してください。

目的と要件は [requirements.md](requirements.md)（企画書）、[software-requirements.md](software-requirements.md)、技術構成と採用理由は [software-stack.md](software-stack.md) を参照してください。以下のコマンドとパスは、特に記載がなければリポジトリ直下を基準にしています。

## 構成

toolbox は、全ツールを1つの HTML に入れた1つのアプリです。配布物は `toolbox-<版>/index.html` の1ファイルだけです。

| 場所 | 役割 |
| --- | --- |
| `index.html`・`src/main.tsx` | アプリの入口。保存した配色を反映し、ツールを登録して画面を作る |
| `src/app/` | アプリの枠：ホーム（`Home.tsx`）、ツールの枠（`frame.tsx` の `ToolFrame`）、画面の切り替えと開いているツール（`workspace.ts`）、受け渡し（`deliver.ts`・`Chooser.tsx`）、このアプリについて（`About.tsx`）、ツールの約束事（`tool.ts`） |
| `src/tools/<id>/` | 各ツール。`index.tsx` に定義（`ToolDefinition`）、処理・テスト・文書・アイコン（`icon.png`）を同じフォルダに置く |
| `src/tools/index.ts` | 配布物に入れるツールの一覧。この順にホームへ並ぶ |
| `src/ui/` | 共通の見た目と部品：配色と部品の CSS（`theme.css`）、ボタン・ダイアログ・メニュー・知らせ・確認（`components.tsx`）、アイコン（`icons.tsx`）、ファイルのドロップ（`drop.ts`） |
| `src/lib/` | 共通の処理：ファイルの受け取りと判定（`files.ts`）、ダウンロード（`download.ts`）、IndexedDB の1件の記録（`idb.ts`）、`localStorage`（`storage.ts`）、配色（`theme.ts`）、クリップボード・数や大きさの表示・OS の違い |
| `src/engine/pdf/` | PDF エンジン。PDF編集と画像変換が同じ Worker（PDFium）を使う |
| `vite/toolbox.ts` | 1つの HTML にまとめる Vite のプラグイン（重いデータの埋め込み・ライセンスの収集・CSP） |
| `scripts/toolbox.mjs` | テスト・ビルド・総合検証・zip の作成（Node.js の標準機能だけ） |
| `scripts/cdp.mjs` | `file://` の画面を確かめるための、Chrome を操作する小さな道具（自動テストには含めない） |
| `tests/dist/` | ビルドした配布物のテスト |
| `.github/workflows/` | `check.yml`（main への push・PR で3 OS の総合検証）、`release.yml`（リリースの公開で検証・ビルドし zip を添付） |

`tools/` には、作り直す前の構成で作った検証画像などが Git 管理外で残っている場合があります。使いません。

## 開発する

Node.js（`.node-version`、24.21.0 以降）と pnpm（`package.json` の `packageManager`）を使います。依存関係は直下の `package.json` に1つにまとめ、版を固定しています。

```bash
pnpm install --frozen-lockfile
pnpm dev
```

開発サーバーは `http://127.0.0.1:5173/` で開きます。CSP と重いデータの埋め込みは配布物にだけ付き、開発中の版の表示は「開発版」です。ツールを直接開くには `#/<ツールの id>`（例：`#/pdf-edit`）を付けます。

### コマンド

エージェントの作業の進め方（テスト・ビルド・コミットは指示時のみ、テストの方針）は [AGENTS.md](../AGENTS.md#作業の流れ) に従います。

| 指示する操作 | リポジトリ直下のコマンド | 実行する内容 |
| --- | --- | --- |
| テスト | `node scripts/toolbox.mjs test` | 依存取得と単体テスト（`src/**/*.test.*`・`scripts/*.test.mjs`）。ビルドはしない |
| ローカルビルド | `node scripts/toolbox.mjs build <版>` | 依存取得・型チェック・版を付けたビルド・zip 作成。テスト・lint はしない |
| 総合検証 | `node scripts/toolbox.mjs check` | 依存取得・整形・lint・型チェック・単体テスト・ビルド・配布物のテスト・`git diff --check` |
| 検証付きの zip 作成 | `node scripts/toolbox.mjs release <版>` | 総合検証のあと、版を付けてビルドし zip を作る。GitHub には公開しない |

`package.json` のスクリプトも直接使えます：`pnpm test`（単体テスト）、`pnpm test:dist`（ビルド済みの配布物のテスト。ビルドは始めない）、`pnpm build`（型チェックとビルド。版は環境変数 `TOOLBOX_VERSION`）、`pnpm check`（総合検証）、`pnpm format`（整形）。整形は Prettier（printWidth 100）で、Markdown・`fixtures/`・`designs/` は対象外です。

### 実装方針

なるべく OS・ブラウザーの標準の仕組みを使い、ライブラリと共通部品を積極的に活用します。追加・改修・レビューのすべてで、次を確認してください。

1. **標準機能を確認する。** ブラウザーのファイル選択・保存・印刷、`dialog`・`popover`・CSS のアンカー配置、File System Access、Canvas・`OffscreenCanvas`、`DecompressionStream`、View Transitions、Node.js の標準 API を優先します。独自のファイル選択画面、印刷処理、メニューの開閉などを作り直しません。Windows・Mac、Chrome・Edge 129 以降、オフライン・`file://` の条件を満たす範囲で選びます。
2. **既存部品とライブラリを使う。** まず共通部品（`src/ui/`・`src/lib/`・`src/engine/`・`src/app/`）と依存関係の公開 API を調べます。PDF の処理は EmbedPDF/PDFium、Markdown の解析・出力は markdown-it、文書の編集・選択・取り消し・表は ProseMirror、差分は jsdiff、画面は Preact と @preact/signals を使います。
3. **不足する場合はライブラリを検討する。** 同じ役割を自作する前に、要件に合うライブラリを検討します。既存機能では不足する点、保守状況、ライセンス、配布サイズ、1つの HTML への埋め込み、外部通信の有無を確認し、採用理由を [software-stack.md](software-stack.md) に残します。
4. **自前実装は固有要件に絞る。** 標準機能やライブラリで満たせない部分だけを実装し、不足点と担当範囲を関連する仕様・技術文書に記録します。現在必要なものだけを作り、一般化のための独自基盤や不要な互換層を増やしません。
5. **同じ部品は共通化して使う。** 複数ツールで役割・振る舞いが同じ処理は共通部品にまとめ、既存の利用箇所も置き換えます。共通 CSS は配色・部品、ツール側の CSS は画面配置や固有の調整を担当します。データ形式や保存方針が異なる処理まで統合しません。

レビューでは、独自処理の必要性、共通部品の重複・利用漏れ、ライブラリの公開 API で置き換えられる処理を確認します。標準 API の対応ブラウザーを変える場合は利用条件も更新し、自動テストと実ブラウザーでの操作確認を分けて記録します。

## アプリの約束事

### ツールの定義

各ツールは `src/tools/<id>/index.tsx` で次の形の定義を書き、`src/tools/index.ts` に並べます（型は `src/app/tool.ts`）。

| 項目 | 内容 |
| --- | --- |
| `id` | URL（`#/<id>`）とホームの並び順の記録に使う名前。英数字と `-` だけ。旧構成のフォルダ名と同じにし、記録を引き継ぐ |
| `name`・`description`・`icon` | ホームのタイルとヘッダーに出す名前・説明・アイコン（128×128 の `icon.png`） |
| `intents` | ホームに置いた・貼り付けたもの、ほかのツールから渡したもの（`Incoming`：ファイル・フォルダ・文章）のうち、受け取れるもの。`accepts` で判定し、`mayAccept` でドラッグ中（種類と数だけ分かる）に受け取れそうかを返す |
| `create()` | 最初に開いたときに一度だけ呼ぶ。`View`（画面）、`status`（状態）、`receive(intent, input)`（受け取り）を返す |

- **画面（`View`）**：`active` を受け取ります。一度開いたツールは画面を移っても消さず、見えていない間は隠します。見えていない間はキー操作・貼り付け・ドロップに反応しないでください（`active` を見る）。モーダルの `dialog` は見えていない間は閉じておきます（隠れた画面のモーダルがほかの画面の操作を止めるため）。画面は `ToolFrame` で包みます。
- **状態（`status`）**：`title`（タブの題名にツール名と並べる）、`summary`（ホームのタイルと切り替えメニュー）、`unsaved`（保存していない作業の印）、`guard`（閉じる前にブラウザーの確認を出す）。
- **受け取り（`receive`）**：ホームやほかのツールから `openTool(id, { intent, input })`（`src/app/workspace.ts`）で渡されたものを受け取ります。受け取れるツールが2つ以上なら、ホームが「何をしますか？」で選ばせます（`src/app/deliver.ts`）。
- **ツールの枠（`ToolFrame`）**：左上の一角は全ツールで同じ（ホーム・アイコンと名前＝ほかのツールへ移るメニュー・配色の切り替え）。`center` にファイル名など、`actions` にツール固有の操作を置きます。右下に版番号を出します。
- **循環させない**：`src/app/` から `src/tools/` を import しません。ツールの一覧は `main.tsx` が `registerTools()` で登録し、`src/app/registry.ts` の `allTools()`・`toolById()` で読みます。モジュールの読み込み時に一覧を使う処理を書きません。

### 共通部品

| 部品 | 使い方 |
| --- | --- |
| `src/ui/theme.css` | 配色・文字・角丸のトークン（`--tb-*`）と部品のクラス（`.tb-button` に `.tb-primary`・`.tb-secondary`・`.tb-danger`・`.tb-icon-button`、`.tb-input`、`.tb-dialog`、`.tb-popover`、`.tb-chip`、`.tb-badge`、`.tb-empty`、`.tb-progress` など）。部品は `:where()` で詳細度を 0 にしているため、ツールの CSS で上書きできる |
| `src/ui/components.tsx` | `Button`・`IconButton`・`Dialog`（標準の `dialog`）・`Menu`／`MenuItem`（`popover` とアンカー配置）・`Field`・`Segmented`・`EmptyState`。知らせは `toast()`、確認は `ask()`・`confirmAction()`（選択肢の `start` は押した直後に同期で呼ぶため、ブラウザーの許可の要求に使える） |
| `src/ui/drop.ts` | `useDropZone()` で受け付ける場所を登録する。画面全体で1か所がドラッグを見張り、どの場所にも入らないファイルでブラウザーが画面を離れないようにする。入れ子は内側が優先 |
| `src/lib/files.ts` | `pickFiles()`（ファイル選択）、`readDrop()`（ドロップの中身。フォルダは File System Access のハンドル）、`droppedFiles()`、`canUseFolders()`、`isPdf()`・`isImage()`・`isTextFile()`、`errorName()`・`errorText()`（例外の名前・文言） |
| `src/lib/platform.ts` | `isMac`・`modKey`・`hasMod()`（⌘ と Ctrl の違い）、`isEditable()`（キー操作・貼り付けの対象が入力欄・編集領域か）、`prefersReducedMotion` |
| `src/lib/download.ts` | `downloadBlob(blob, ファイル名, { signal })`。blob URL とリンクでダウンロードさせ、60秒後か中断で解放する。`safeFileName()` |
| `src/lib/idb.ts` | `createRecordStore(window, { database, store, key })`。IndexedDB の1つのキーに値を1つ置く。停止・ブロック・中断では待ち続けず拒否する |
| `src/lib/storage.ts`・`theme.ts` | `localStorage` の読み書き（保存できない環境でも画面の中では覚える）と配色（`toolbox-theme`） |
| `src/engine/pdf/` | `pdfEngine().call(操作, 引数)`。開く・閉じる・描画・文字と要素の一覧・画像の取り出し・保存（結合と回転）・要素の削除・画像から PDF・PDF の縮小 |

- 配色は、ライトがアイボリーの地に深いエバーグリーン（`--tb-accent`）、ダークが黒に近い地にシャンパン色（同）です。真鍮色の `--tb-gold` は選択中の細い縁・区切りの短い線・フォーカス枠など細部の差し色に限ります。大きな見出しは OS の明朝体（`--tb-font-display`）です。
- 色はすべて `light-dark()` で持ちます。切り替えボタンで選んだ配色は `:root[data-tb-theme]` で `color-scheme` を上書きします。ツールの CSS で `prefers-color-scheme` を使うと切り替えが効かないため、色は `--tb-*` か `light-dark()` で書きます。印刷と、ツールが書き出す文書は常にライトです。
- 動きは控えめにし、`prefers-reduced-motion: reduce` では止めます（`theme.css` が全体で短くする）。
- 1つの HTML に同居するため、ツールの CSS はクラス名に接頭辞（`pl-`・`ic-`・`pe-` など）を付けるか、ツールの枠のクラス（ローカルノートは `.nh`）の中に閉じます。`body` や `:root` に直接書きません。

### 記録の置き場所

| 記録 | 置き場所 |
| --- | --- |
| 配色・ホームの並び・背景の流れ | `localStorage` の `toolbox-theme`・`toolbox-cards`・`toolbox-flow` |
| プロンプト集の保存先のフォルダ | IndexedDB `toolbox-prompt-library` |
| PDF編集の復元用データ | IndexedDB `toolbox-pdf-edit` |
| ローカルノートの前回のフォルダ・レイアウト・表示設定 | IndexedDB `local-notes-session`（キー `toolbox#session`・`toolbox#layout`・`toolbox#display`） |

`file://` の Chrome・Edge は保存領域を共有するため、どれも版（解凍先のフォルダ）をまたいで同じ記録を読みます。配置 URL をキーに含めません。

## 配布物の作り

- `vite build` は `vite-plugin-singlefile` で JavaScript と CSS を `dist/index.html` に入れます。本体の script は普通の script（IIFE）にし、重いデータより前に置いて画面を先に出します。
- PDFium の WebAssembly と Noto Sans JP は、gzip と Base64 にして HTML の末尾の `<script type="application/octet-stream" id="tb-payload-…">` に置きます。PDF を初めて使うとき、文書を読み終えてから Worker に渡し、Worker の中で `DecompressionStream` で展開します（`vite/toolbox.ts`・`src/engine/pdf/`）。
- CSP（`vite/toolbox.ts` の `CONTENT_SECURITY_POLICY`）で外部との通信と外部の読み込みを止めます。Worker は `blob:`、WebAssembly は `'wasm-unsafe-eval'` で動かします。
- 配布物に実際に入ったパッケージのライセンス文を集めて HTML の末尾に置き、「このアプリについて」で表示します。
- 配布物のテスト（`tests/dist/`）は、1ファイルであること・CSP・script の並び・埋め込み・ライセンスを確かめます。

## 画面を確かめる

`scripts/cdp.mjs` は、Node.js の標準機能だけでヘッドレス Chrome を操作し、配布物を本物の `file://`・ネット遮断で開いて、画面の撮影・操作・コンソールのエラー・外部への通信を確かめる道具です（macOS の Chrome の場所を前提にしています）。自動テストには含めません。

```js
import { launch } from './scripts/cdp.mjs';
const b = await launch({ offline: true, width: 1280, height: 800 });
await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
await b.goto('file:///<リポジトリ>/dist/index.html#/typing-game');
await b.waitFor(`!!document.querySelector('.tg-start')`);
await b.screenshot('shot.png');
console.log(b.logs); // コンソール・例外・外部への通信
await b.close();
```

- `Input.insertText`（確定した文字）、`Input.dispatchKeyEvent`（キー）、`Input.imeSetComposition`（変換中の模擬）が使えます。実際の日本語 IME の動きとは違う場面があります。
- `waitFor` に DOM の要素をそのまま返す式を渡さず、`!!` で真偽値にします（ProseMirror の要素などは値として返せません）。
- フォルダの選択は自動化できないため、`Page.addScriptToEvaluateOnNewDocument` でメモリー上のフォルダ（File System Access の模擬）を `showDirectoryPicker` に差し込んで確かめます。`file://` では OPFS は使えません。
- Claude の内蔵ブラウザーはローカルファイルを静的な写しで表示するため、`file://` の確認には使えません。

## CI

| 契機 | 内容 |
| --- | --- |
| main への push・PR、Check の「Run workflow」 | Linux・macOS・Windows で総合検証（`node scripts/toolbox.mjs check`） |
| リリースの公開 | Linux で版番号を検査し、総合検証・版を付けたビルド・zip 作成のあと、リリースに `toolbox-<版>.zip` を添付 |

ブランチ保護を設定する場合、必須チェックは固定名の **Check result** を指定します。pnpm は `pnpm/action-setup` が `packageManager` の版を、Node.js は `.node-version` を使います。

## GitHub に版を公開する

公開の指示を受けてから実行します。ローカルの `build`・`release` では公開しません。

1. push・マージの指示に従って対象の変更を GitHub の main に反映し、そのコミットの Check が成功していることを確認する。公開操作には push・マージを組み込まない。
2. 公開対象の push 済みコミットの完全な SHA、日付形式の版、日本語のリリース説明ファイルを指定する。

   ```sh
   gh release create <版> --target <公開対象SHA> --title <版> --notes-file <説明ファイル>
   ```

3. Release ワークフローの成功と、リリースへの `toolbox-<版>.zip` の添付を確認する。
4. zip をダウンロードして同僚に渡す。

GitHub の版は `2026.10.03` のような日付形式にします。同日の追加公開には `2026.10.03.2` のように枝番を付け、未使用のタグで公開します。既存タグを指定した場合は `--target` ではそのタグの参照先を変えられないため、別コミットの公開に既存タグを流用しません。

公開を契機に、タグのソースで総合検証・ビルドを行い、zip を添付します。リリースの作成と zip の添付は別の処理です。版番号・検証・ビルドが不正ならリリース自体は存在していても、zip は添付されません。コマンドの成功だけで完了扱いにせず、Actions と添付結果まで確認してください。修正後は新しい版で公開します。

## ツールを追加する

1. `src/tools/<id>/` を作る。`id` は英数字と `-` だけにする。
2. `index.tsx` に [ツールの定義](#ツールの定義) を書き、`icon.png`（128×128、角丸のエバーグリーン地にアイボリーの図柄と真鍮色の差し色）を置く。画面は `ToolFrame` で包み、配色は `--tb-*`、部品は共通部品を使う。ファイルの受け取り・ダウンロード・確認は共通部品を使う。
3. 受け取れるもの（`intents`）を決める。ホームに置いた・貼り付けたものを受け取れるなら、`accepts` と `mayAccept` を書く。
4. `src/tools/index.ts` に加える（この順にホームへ並ぶ）。新しい依存は直下の `package.json` に版を固定して加え、採用理由を [software-stack.md](software-stack.md) に残す。
5. テストは同じフォルダに `*.test.ts`（または `.tsx`・`.js`）で置く。直下の README に利用者向けの紹介を加え、ツールの README・AGENTS.md・`docs/` を書く。

追加後のコミット、総合検証、PR 作成は、それぞれ指示時に行います。CI・リリースの設定へのツール名の追記は不要です。

## 手元で zip を作る

ローカルビルドの指示を受けてから実行します。macOS または Linux で、Node.js・pnpm・`zip` コマンドを用意します。

```bash
node scripts/toolbox.mjs build 2026.10.18
```

版は今日の日付（`YYYY.MM.DD`）だけにします。同じ日に作り直すときも枝番を付けず、同じ版で上書きします。実装やコミットのたびには作り直しません。

`out/toolbox-2026.10.18.zip` と、同じ中身のフォルダ（`out/toolbox-2026.10.18/index.html`）を作ります。テスト未実行でも生成できるため、ビルド成功と検証成功は区別してください。全検証付きの zip 作成を指示された場合は `node scripts/toolbox.mjs release <版>` を使います。同じ版の古い出力は消してから作るため、途中で失敗しても同じ版の古い zip は残りません。`dist/` と `out/` は Git 管理対象外です。

## 未確認のこと

- 会社の PC（Windows・Edge、Mac・Chrome）で、ネットにつながない状態で zip を解凍し、`file://` でホームと全ツールが動くこと。最小の対応版（Chrome・Edge 129）そのもの。
- GitHub 上での Check・Release ワークフローの実行。

検証の結果は [verification.md](verification.md) を参照してください。
