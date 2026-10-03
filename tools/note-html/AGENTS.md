# ローカルノートの作業ガイド

直下の [AGENTS.md](../../AGENTS.md) に加える、このツール固有の約束です。最初に [README](README.md)、[仕様書](docs/SPEC.md)、[検証記録](docs/VERIFICATION.md) を読む。

- 編集対象は `src/`、ビルドは `scripts/build.mjs`、検証は `tests/`。`dist/index.html` は生成物であり、直接編集・コミットしない。
- 既存の esbuild・markdown-it・ProseMirror と公開 API を使う。新しいビルド基盤を持ち込まない。メニューの基本動作は Popover API、画像の data URL 化は FileReader、復元用の配置 URL は `ui/session-key.js` を使う。
- ボタンには `tb-button` を付ける。本文の配色は `document.css` の変数をライトの値で持ち、画面用に `style.css` で `--tb-*` へ置き換える。エクスポートの HTML には `document.css` だけを入れ、常にライトにする。
- ビルド後の `dist/` は HTML 1ファイルだけにし、JS・CSS・ライセンスを内包する。非表示の `template#third-party-licenses` を保持し、外部フォント・外部通信を追加しない。
- 共通ヘッダーの左上の一角（`<template id="toolbox-home"></template>` を1つだけ含む）は toolbox 共通の形を保ち、ノート固有の操作はその右側に置く。
- Markdown の正本は利用者が選んだローカルファイル。保存前の外部変更検知、文字コード・改行の保持、未保存時の離脱確認を維持する。本文の自動保存や下書き復元は追加しない。
- 実装の中心は `app.js`。ファイル操作は `file-operations.js`、復元情報は `session-store.js`、直接編集は `rich-editor.js`、添付は `assets.js`、出力は `export.js` を確認する。
- 検証専用データを使い、個人・業務ノートは `local-samples/` に置いてコミットしない。検証画像などは Git 管理外の `output/` に保存する。
- 利用者向けの説明と開発手順はこのツールの README、機能要件は `docs/SPEC.md`、検証結果は `docs/VERIFICATION.md` に反映する。
