# ローカルノートの作業ガイド

最初に [README](README.md)、[仕様書](docs/SPEC.md)、[検証記録](docs/VERIFICATION.md)、リポジトリ共通の [開発・リリース手順](../../docs/development.md) を読む。

- 編集対象は `src/`、ビルドは `scripts/build.mjs`、検証は `tests/`。`dist/index.html` は生成物であり、直接編集・コミットしない。
- 既存の esbuild・markdown-it・ProseMirror と公開 API を使う。依存関係とロックファイルをこのフォルダ内に閉じ、新しいビルド基盤や共通 npm 依存を持ち込まない。
- 配色・ボタン等の部品・ダウンロード・ファイルのドロップ判定は、リポジトリ直下の `ui/` を使う（[共通 UI](../../docs/development.md#共通-ui)）。ボタンには `tb-button` を付ける。本文の配色は `document.css` の変数をライトの値で持ち、画面用に `style.css` で `--tb-*` へ置き換える。エクスポートの HTML には `document.css` だけを入れ、常にライトにする。
- ビルド後の `dist/` は HTML 1ファイルだけにする。JS・CSS・ライセンスを内包し、CDN・外部フォント・外部通信を追加しない。非表示の `template#third-party-licenses` を保持する。
- ヘッダー先頭の `<template id="toolbox-home"></template>` を1つだけ保持する。戻るリンクと版番号は toolbox の共通処理が付ける。
- Markdown の正本は利用者が選んだローカルファイル。保存前の外部変更検知、文字コード・改行の保持、未保存時の離脱確認を維持する。本文の自動保存や下書き復元は追加しない。
- 実装の中心は `app.js`。ファイル操作は `file-operations.js`、復元情報は `session-store.js`、直接編集は `rich-editor.js`、添付は `assets.js`、出力は `export.js` を確認する。
- 変更後はリポジトリ直下で `node scripts/toolbox.mjs check note-html` を実行する。配布の変更は `node scripts/toolbox.mjs release <版>` で最新ソースから zip まで検証する。
- 自動テストの模擬 API と、実フォルダの読み書き・権限・`file://`・完全オフラインの確認を区別する。検証専用データを使い、個人・業務ノートは `local-samples/` に置いてコミットしない。
- Playwright スキル・CLI はユーザーが明示的に使用を指示した場合だけ使う。検証画像などは Git 管理外の `output/` に保存し、未実施の確認は `docs/VERIFICATION.md` に残す。
- 手順は共通の `docs/development.md`、利用者向けの説明はこのツールの README、機能要件は `docs/SPEC.md` に反映する。
