# 文章比較の作業ガイド

直下の [AGENTS.md](../../../AGENTS.md) に加える、このツール固有の約束です。最初に [README](README.md)、[企画書](docs/requirements.md)、[要件](docs/software-requirements.md)、[技術構成](docs/software-stack.md)、[検証記録](docs/verification.md) を読む。

- 差分は共通部品の `src/engine/diff`（Rust の WebAssembly）の `diffTokens` で取り、ツール側で差分の計算を作り直さない。行の差分 → 変わった行のまとまりの中の書記素の差分、の2段にする。書記素の分け方はブラウザーの標準機能（`Intl.Segmenter`）に任せる。
- 差分は画面の処理の中で同期で計算する。全体の期限（`timeout`）で必ず打ち切り、行の差分が終わらなければ結果を出さず、まとまりの中の差分が終わらなければ行ごと入れ替わったものとして示す（`rough`）。
- 比べ方を変えたら `compare.test.ts` に例を足す。結果から前と後の文章をそのまま組み立て直せることを保つ。
- 貼った文章と結果は保存しない（localStorage・IndexedDB などに入れない）。外部へも送らない。
- 要件の「今は扱わない」（空白・全角半角を無視する比較、単語ごとの比較、結果の書き出し・印刷、3つ以上の比較、Word・PDF の読み込み）を実装しない。
