# ローカルノートの作業ガイド

直下の [AGENTS.md](../../../AGENTS.md) に加える、このツール固有の約束です。最初に [README](README.md)、[仕様書](docs/SPEC.md)、[検証記録](docs/VERIFICATION.md) を読む。

- 振る舞いは旧 note-html の JavaScript（`app.js`・`rich-editor.js` など）とテストをそのまま移したもの。利用者が決めてきた仕様の塊なので、振る舞いを変えるときはテストを先に直し、TypeScript への書き換えは振る舞いを変えない範囲で行う。
- 既存の markdown-it・ProseMirror と公開 API を使う。メニューの基本動作は Popover API、画像の data URL 化は FileReader を使う。
- 画面の骨組みは `markup.js` に置き、`index.tsx` は Preact に一度だけ描かせる（`Static`）。中身の書き換えは `app.js` などが id で行うため、Preact に描き直させない。テストも同じ骨組みで jsdom の文書を作る。
- 1つの HTML に同居するため、画面の CSS は `.nh` の中に閉じる。本文の配色は `document.css` の変数をライトの値で持ち、画面用に `style.css` で `--tb-*` へ置き換える。`document.css` は本文の要素（`.markdown`・`.export-document`）にだけ効かせ、`:root`・`body` に書かない。エクスポートの HTML には `document.css` だけを入れ、常にライトにする。
- ボタンには `tb-button` を付ける。外部フォント・外部通信を追加しない。
- 共通ヘッダーの左上の一角は toolbox の `ToolFrame` が描く。ノート固有の操作はその右側（`markup.js` の `HEADER_CENTER`・`HEADER_END`）に置く。
- Markdown の正本は利用者が選んだローカルファイル。保存前の外部変更検知、文字コード・改行の保持、未保存時の離脱確認を維持する。本文の自動保存や下書き復元は追加しない。
- 復元情報・レイアウト・表示設定は固定のキー（`toolbox#session` など）で持ち、版をまたいで読めるようにする。配置 URL をキーにしない。
- ほかのツールを見ている間は、⌘S・⌘/ に反応しない（`createApp` の `isActive`）。
- 検証専用データを使い、個人・業務ノートは `local-samples/` に置いてコミットしない。検証画像などは Git 管理外の `output/` に保存する。
- 利用者向けの説明と開発情報はこのツールの README、機能要件は `docs/SPEC.md`、検証結果は `docs/VERIFICATION.md` に反映する。
