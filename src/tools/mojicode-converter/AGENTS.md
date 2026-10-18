# 文字コード変換の作業ガイド

直下の [AGENTS.md](../../../AGENTS.md) に加える、このツール固有の約束です。最初に [README](README.md)、[要件](docs/software-requirements.md)、[技術構成](docs/software-stack.md)、[検証記録](docs/verification.md) を読む。

- 迷ったときの軸は、出てくる値が Windows と同じになること。Shift_JIS の値を変える変更では、`tests/sjis.test.ts` の CP932 対応表との全件の突き合わせを、次にテストを指示されたときの必須確認に含める。テストの期待値を記憶で書かず、`tests/fixtures/` の表で確かめる。
- Shift_JIS はブラウザー標準の `TextDecoder('shift_jis')` で表を作る。対応表のデータを配布物に埋め込まない（`tests/fixtures/` はテスト専用）。1バイトの文字は WHATWG の定義どおり計算で求める（Node.js の ICU は `1A`・`1C`・`7F` と `80` の扱いがブラウザーと異なるため）。
- 欄ごとに文字コードを決め、入力の意味を推測しない。読めない値は推測で別の文字にせず、どこが読めないかを示す。
- 入力した文字を外部へ送信しない。ホームから受け取る文章は、長すぎる文章（400文字を超えるもの）を受け取らない。
- 自動テストは Node.js の `TextDecoder` で表を作るため、ブラウザーの `TextDecoder` での一致は [検証記録](docs/verification.md) の手順で確かめ、結果を記録する。
