# 文字コード変換の作業ガイド

最初に [README](README.md)、[要件](docs/software-requirements.md)、[技術構成](docs/software-stack.md)、[検証記録](docs/verification.md)、リポジトリ共通の [開発・リリース手順](../../docs/development.md) を読む。

- 迷ったときの軸は、出てくる値が Windows と同じになること。Shift_JIS の値を変える変更では、`tests/sjis.test.ts` の CP932 対応表との全件の突き合わせを必ず通す。テストの期待値を記憶で書かず、`tests/fixtures/` の表で確かめる。
- Shift_JIS はブラウザー標準の `TextDecoder('shift_jis')` で表を作る。対応表のデータを配布物に埋め込まない（`tests/fixtures/` はテスト専用）。1バイトの文字は WHATWG の定義どおり計算で求める（Node.js の ICU は `1A`・`1C`・`7F` と `80` の扱いがブラウザーと異なるため）。
- 欄ごとに文字コードを決め、入力の意味を推測しない。読めない値は推測で別の文字にせず、どこが読めないかを示す。
- 配色・ヘッダー左上の共通部品と表示の切り替えは直下の `ui/` を取り込み、複製しない。
- 配布物は `dist/文字コード変換.html` の1ファイル。外部を読み込まず、入力した文字を外部へ送信しない。
- 要件の「今は扱わない」（ファイルの読み直し・保存、EUC-JP・JIS、文字の名前、文字コードの推測）を実装しない。
- 変更後は `pnpm check`、またはリポジトリ直下で `node scripts/toolbox.mjs check mojicode-converter` を実行する。自動テストは Node.js の `TextDecoder` で表を作るため、ブラウザーの `TextDecoder` での一致は [検証記録](docs/verification.md) の手順で確かめ、結果を記録する。
- Playwright スキル・CLI はユーザーが明示的に使用を指示した場合だけ使う。未実施の確認は `docs/verification.md` に残す。
