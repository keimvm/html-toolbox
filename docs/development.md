# toolbox の開発・リリース手順

開発・保守・配布を行う人向けの手順です。利用方法は [README](../README.md) を参照してください。

目的と要件は [requirements.md](requirements.md)、[software-requirements.md](software-requirements.md)、[software-stack.md](software-stack.md) を参照してください。以下のコマンドとパスは、特に記載がなければリポジトリ直下を基準にしています。

## 構成

| 場所                            | 役割                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `tools.json`                    | zip に入れるツールの一覧。書いた順に入口ページへ並ぶ                             |
| `tools/<フォルダ名>/`           | 各ツール。依存関係・ロックファイル・Node.js の版指定はツールごとに持つ           |
| `ui/`                           | 全ツールと入口ページで共通の配色・部品・ヘッダー・ダークモード、D&D・ダウンロードの処理。npm の依存なし |
| `scripts/toolbox.mjs`           | 一覧の検査、ビルド済み HTML の収集、入口ページ（ツールのカード一覧）の生成、戻るリンク・版番号の追加、zip 作成 |
| `scripts/index-cards.js`        | 入口ページに埋め込む、カードの並べ替え・表示の切り替え（ブラウザーで動く処理） |
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

### 実装方針

なるべく OS 標準の仕組みを使い、ライブラリと共通部品を積極的に活用します。追加・改修・レビューのすべてで、次を確認してください。

1. **標準機能を確認する。** 配布 HTML から使えるブラウザーのファイル選択・保存・印刷・フォーム・`dialog`・`popover`・CSS、開発用の Node.js 標準 API や OS のコマンドを優先します。独自のファイル選択画面、印刷処理、メニューの開閉などを作り直しません。Windows・Mac、Chrome・Edge、オフライン・`file://` の条件を満たす範囲で選びます。
2. **既存部品とライブラリを使う。** まず `ui/` と対象ツールの依存関係・公開 API・公式の拡張点を調べます。PDF処理は EmbedPDF/PDFium、Markdown の解析・出力は markdown-it、文書編集・選択・取り消し・表操作は ProseMirror を利用します。共通部品があれば必ずそれを取り込みます。
3. **不足する場合はライブラリを検討する。** 同じ役割を自作する前に、要件に合うライブラリを検討します。既存機能では不足する点、保守状況、ライセンス、配布サイズ、単一 HTML への埋め込み、外部通信の有無を確認し、採用理由を技術文書に残します。版・ロックファイル・ライセンス表記は各ツール内で管理します。
4. **自前実装は固有要件に絞る。** 標準機能やライブラリで満たせない部分だけを実装し、不足点と担当範囲を関連する仕様・技術文書に記録します。現在必要なものだけを作り、一般化のための独自基盤や不要な互換層を増やしません。
5. **同じ部品は共通化して使う。** 複数ツールで役割・振る舞いが同じ処理は `ui/` にまとめ、既存の利用箇所も置き換えます。共通 CSS は配色・部品、ツール側の CSS は画面配置や固有の調整を担当します。データ形式や保存方針が異なる処理まで統合しません。`ui/` と `scripts/` の npm 依存なしという制約を守ります。

レビューでは、独自処理の必要性、共通部品の重複・利用漏れ、ライブラリの公開 API で置き換えられる処理を確認します。標準 API の対応ブラウザーを変える場合は利用条件も更新し、自動テストと実ブラウザーでの操作確認を分けて記録します。

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
| `theme.css` | 配色・文字・角丸などのトークン（`--tb-*`）と、ボタン（`.tb-button` に `.tb-primary`・`.tb-secondary`・`.tb-danger`・`.tb-icon-button` を組み合わせる）、入力欄（`.tb-input`）、ダイアログ（`.tb-dialog`）、操作欄（`.tb-dialog-actions`、縦並びは `.tb-stack` を追加）、ポップオーバー（`.tb-popover`）、フォーカス枠、ファイルのドロップ中の表示、共通ヘッダー（下記）、戻るリンク（`#toolbox-home`、ホームのアイコン）と切り替えボタン（`.tb-theme-toggle`）の見た目 |
| `header.js` | `setupToolHeader(header)`。共通ヘッダーのアイコン（`.tb-header-icon`）を favicon にも使い、`.tb-theme-toggle` に表示の切り替えを設定する。どちらかがなければ例外 |
| `theme-toggle.js` | `setupThemeToggle(button)`。ボタンの押下でライト・ダークを切り替え、`localStorage` の `toolbox-theme` に残す。OS と同じ表示に戻すと記録を消す。ボタンのアイコンと読み上げ名を今の表示に合わせる。入口ページはこれを直接埋め込む |
| `download.js` | `downloadBlob(blob, ファイル名, { signal })`。blob URL とリンクでダウンロードさせ、60秒後か `signal` の中断で URL を解放する |
| `file-drop.js` | `watchFileDrop({ zone, onDrop, enabled })`。`zone` の外に落としたファイルでブラウザーが画面を離れないようにする。受け付ける間は `zone` に `data-tb-file-drag` を付け、`data-tb-drop-label` の文言を重ねて表示する。フォルダを含む場合は `onDrop` に `null` を渡す。`hasFiles`・`droppedFiles` も使える |
| `idb-record.js` | `createRecordStore(window, { database, store, key, timeoutMs })`。IndexedDB の1つのキーに値を1つ置き、`load()`・`save(値)` で読み書きする。transaction の確定を待ち、停止・ブロック・中断では待ち続けず拒否する。ローカルノートの復元情報とプロンプト集の保存先の記録に使う。DB名・キー・値の形と検査は各ツールで管理する |
| `session-key.js` | `sessionKey(href)`。クエリーとフラグメントを除いた HTML の配置 URL。両ツールの復元情報の保存先に使い、従来のキーを維持する。DB名・形式・保存処理は各ツールで管理する |

- 配色は、ライトがアイボリーの地に深いエバーグリーン（`--tb-accent`）、ダークが黒に近い地にシャンパン色（同）です。真鍮色の `--tb-gold` は選択中の細い縁・区切りの短い線・フォーカス枠など細部の差し色に限り、文字色には使いません。大きな見出しは OS の明朝体（`--tb-font-display`）、それ以外は `--tb-font` を使います。浮いた面の影は `--tb-elevation` です。
- 色はすべて `light-dark()` で持ち、OS のダークモード設定に従います。切り替えボタンで選んだ表示は `:root[data-tb-theme]` で `color-scheme` を上書きします。印刷は常にライトです。ツールの CSS で `prefers-color-scheme` を使うと切り替えが効かないため、色は `--tb-*` か `light-dark()` で書きます。
- 共通ヘッダーは次の形で書き、`setupToolHeader()` をツールの起動処理の最初に呼びます（保存した表示を早く反映するため）。左上の一角は全ツールで同じ中身・順序にし、ツール固有の操作は右側に置きます。ファイル名など中央に置く要素は一角と右側の間に書きます。

  ```html
  <header class="tb-header">
    <div class="tb-header-start">
      <template id="toolbox-home"></template>
      <span class="tb-header-brand"><img class="tb-header-icon" src="（src/icon.png の data URL）" alt="">ツール名</span>
      <button type="button" class="tb-button tb-icon-button tb-theme-toggle"></button>
    </div>
    <div class="tb-header-end">ツール固有のボタン・メニュー</div>
  </header>
  ```

- アイコンは各ツールの `src/icon.png`（128×128、角丸のエバーグリーン地にアイボリーの図柄と真鍮色の差し色）を正とし、ビルドで data URL として埋め込みます（PDF編集は Vite のアセット、ローカルノートは Node.js 標準の `Buffer.toString('base64')`）。favicon は `header.js` が同じ画像から設定するため、HTML に `link rel="icon"` を書きません。生成に使ったプロンプトと画像の処理は [favicon-prompts.md](favicon-prompts.md) に記録しています。
- 部品は `:where()` で詳細度を 0 にしているため、ツールの CSS で余白などを上書きできます。逆に、ツールの CSS でボタン全体に `color` や `font` を指定すると部品の指定も打ち消すため、`:where(:not(.tb-button))` のように部品を除外してください。
- 入口ページは `scripts/toolbox.mjs` が `theme.css` と `theme-toggle.js` を埋め込んで作り、版番号の右に切り替えボタンを置きます。ツールは `tools.json` の順にカードで並べ、カードには各ツールの `src/icon.png`（data URL）・表示名・説明を載せます。配布時に足す戻るリンクと版番号も、ページの配色とトークンに従います。
- 入口ページ専用の `scripts/index-cards.js`（`setupCards()`）も埋め込みます。「並べ替え・表示」の編集中だけ、各カードに表示のチェックボックスと「前へ」「後へ」を出し、標準のドラッグ＆ドロップでも並べ替えられるようにします。選んだ内容は `localStorage` の `toolbox-cards` に `{ "order": [フォルダ名…], "hidden": [フォルダ名…] }` で残し、`tools.json` と同じ並び・全部表示に戻したら記録を消します。一覧にないフォルダ名は無視し、並べ替えた後に増えたツールは最後に置きます。ツールだけで使わない処理なので `ui/` には置きません。
- 入口ページ専用の favicon は `ui/toolbox-icon.png`（128×128、道具箱の図柄）です。`scripts/toolbox.mjs` が既存の `iconDataUrl()` で変換し、`link rel="icon"` に直接埋め込みます。配布物へ画像ファイルを追加せず、オフラインでも表示できます。
- ローカルノートがエクスポートする HTML には本文用の `document.css` だけを入れるため、常にライトで出力されます。
- メニューは `<button popovertarget="対象ID">` と `<div id="対象ID" popover="auto" class="tb-popover">` を組み合わせます。開閉・排他表示・外側クリック・Escape・展開状態の支援技術への通知は [Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API/Using)、配置は CSS のアンカー配置に任せます。`hidden` や `aria-expanded` に開閉状態を重複して保持しません。ローカルノートの Tab による閉鎖・操作後の閉鎖は固有処理として残します。
- TypeScript からは同じ名前の `.d.ts` で型を参照します。Vite の開発サーバーでは、`server.fs.allow` に `../../ui` を加えます（PDF編集の `vite.config.ts`）。
- `ui/` を変えたら、`node --test 'scripts/*.test.mjs' 'ui/*.test.mjs'` と全ツールの `node scripts/toolbox.mjs check` を実行します。CI も `ui/` の変更で全ツールを検証します。

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
   - 画面上部に[共通ヘッダー](#共通-ui)を置き、`ui/header.js` の `setupToolHeader()` を呼ぶ。左上の一角の先頭に `<template id="toolbox-home"></template>` を1つ置き、ビルド後にもこの文字列を残す。アイコンは `src/icon.png` に置く（入口ページのカードにも使う）。画面が狭い場合はヘッダーを折り返せるようにする。
   - CSP を指定する場合は、`img-src` に `data:`（アイコン）を、`style-src` にインラインの style（版番号）を許可する。
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

追加後に `node scripts/toolbox.mjs check <フォルダ名>` を実行し、PR を作ります。ワークフローへのツール名の追記は不要です。`node scripts/toolbox.mjs list` で、一覧と必要な設定ファイル（`src/icon.png` を含む）だけを素早く検査できます。単一 HTML に収まることは共通処理が検査しますが、外部通信や `file://` での動作は各ツールで検証してください。

zip を作るときに、上記の空の `template` をトップへ戻るリンク（`#toolbox-home`、`class="tb-button tb-icon-button"`、`href="../index.html"`）に置き換えます。文言は表示せず、`ui/theme.css` がホームのアイコンを描きます。読み上げ名とツールチップは `aria-label`・`title` の「トップへ戻る」です。通常のリンクなので、同じタブで戻り、ツールの既存の離脱確認が働きます。作業状態の削除や独自の確認処理は追加しません。挿入位置が不足・重複している場合は収集・梱包を失敗させます。開発画面や加工前の HTML では `template` は表示されません。

版番号は、各ツールの `</body>` の直前へ、右下に固定表示する小さな要素（`#toolbox-version`）として書き足します。版番号のスタイルはインラインの `<style>` で追加するため、ツールの CSP ではインラインの style を許可してください。色はツールの配色（ライト・ダーク）に従います。加工は配布用のコピーにだけ行い、元のソース・`dist/`・`build/` は変えません。

## 手元で zip を作る

macOS または Linux で、Node.js・pnpm・`zip` コマンドを用意します。

```bash
node scripts/toolbox.mjs release 2026.09.26
```

版は今日の日付（`YYYY.MM.DD`）だけにします。同じ日に作り直すときも `2026.09.26.2` のような枝番を付けず、同じ版で上書きします。何か修正したら、検証が通った後に変更をコミットし、この手順で手元の配布物を作り直します。

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
