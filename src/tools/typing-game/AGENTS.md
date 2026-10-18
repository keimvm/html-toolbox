# タイピングゲームの作業ガイド

直下の [AGENTS.md](../../../AGENTS.md) に加える、このツール固有の約束です。最初に [README](README.md)、[企画書](docs/requirements.md)、[要件](docs/software-requirements.md)、[技術構成](docs/software-stack.md)、[検証記録](docs/verification.md) を読む。

- 打っている間は違う箇所を判定・表示しない。見本の進み具合は、確定のたびに入力の末尾が見本のどこに当たるかだけを差分で求めて決める（`createLocator()`、改行・空白を除く）。違う箇所を色で示さない。違う箇所の判定は終了時の1回だけ（`judge()`）。
- 変換中かどうかは `compositionstart`・`compositionend` と `isComposing`（`keyCode` 229 を含む）で見る。変換中の入力では進めず、変換中の Esc を終了にしない。この条件を緩める変更では、次に実機確認を指示されたときに Windows の Edge（Microsoft IME）と Mac の Chrome で確かめる。実行までは未確認とする。
- 判定は改行・空白を除き、NFKC でそろえてから文字単位の差分（`diff.ts` の `diffChars`、本体は Rust の WebAssembly `wasm/`）で取る。結果は打ったまま（正規化前）の文字で示し、自前の変換表を足さない。正規化・書記素の扱いはブラウザーの標準機能（`normalize`・`Intl.Segmenter`）に任せ、Rust 側はコードポイントの並びの差分だけを持つ。判定と進み具合の振る舞いを変えたら `judge.test.ts` に例を足し、差分の本体を変えたら `wasm/src/lib.rs` のテストも足す。
- 差分は画面の処理の中で同期で計算する。期限（`timeout`）で必ず打ち切れるようにし、WebAssembly を読み込めない環境でも打つこと・時間の計測は止めない（進み具合は確定した文字数、判定は違いを示さない結果にする）。
- 貼った文章・打った文章・結果は保存しない（localStorage・IndexedDB などに入れない）。外部へも送らない。
- 動き（色の変化・カウントダウン・結果の光）は CSS と Web Animations API で付け、`prefers-reduced-motion` で止める。打つ邪魔をする動き（入力欄を覆う表示、入力の受け付けを遅らせる演出）は足さない。
- 見本の文字の要素は打つたびに直接書き換えるため、Preact に描き直させない部品（`shouldComponentUpdate() { return false }`）の中に置く。
- 自動テストは IME を模擬できないため、実機の日本語入力・`file://` での確認は [検証記録](docs/verification.md) に分けて記録する。
