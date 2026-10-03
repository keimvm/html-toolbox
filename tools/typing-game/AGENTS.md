# タイピングゲームの作業ガイド

最初に [README](README.md)、[企画書](docs/requirements.md)、[要件](docs/software-requirements.md)、[技術構成](docs/software-stack.md)、[検証記録](docs/verification.md)、リポジトリ共通の [開発・リリース手順](../../docs/development.md) を読む。

- 打っている間は違う箇所を判定・表示しない。見本の進み具合は、確定のたびに入力の末尾が見本のどこに当たるかだけを差分で求めて決める（`createLocator()`、改行・空白を除く）。違う箇所を色で示さない。違う箇所の判定は終了時の1回だけ（`judge()`）。進み具合の振る舞いを変えたら `tests/judge.test.ts` に例を足す。
- 変換中かどうかは `compositionstart`・`compositionend` と `isComposing`（`keyCode` 229 を含む）で見る。変換中の入力では進めず、変換中の Esc を終了にしない。この条件を緩める変更は、Windows の Edge（Microsoft IME）と Mac の Chrome の実機で確かめる。
- 判定は改行・空白を除き、NFKC でそろえてから jsdiff の `diffChars` で取る。結果は打ったまま（正規化前）の文字で示し、自前の変換表・差分の処理を足さない。判定の振る舞いを変えたら `tests/judge.test.ts` に例を足す。
- 貼った文章・打った文章・結果は保存しない（localStorage・IndexedDB などに入れない）。外部へも送らない。
- 動き（色の変化・カウントダウン・結果の光）は CSS と Web Animations API で付け、`prefers-reduced-motion` で止める。打つ邪魔をする動き（入力欄を覆う表示、入力の受け付けを遅らせる演出）は足さない。
- 配色・ヘッダー左上の共通部品・ボタン・入力欄は直下の `ui/` を使い、複製しない。
- 配布物は `dist/タイピングゲーム.html` の1ファイル。外部を読み込まない。
- 要件の「今は扱わない」（1分あたりの文字数などの速さ、結果の記録・比較、文章の保存、日本語以外への配慮、ローマ字の読みの練習、読み・改行・空白・全角半角の判定、画面上の終了ボタン）を実装しない。
- 変更後は `pnpm check`、またはリポジトリ直下で `node scripts/toolbox.mjs check typing-game` を実行する。自動テストは IME を模擬できないため、実機の日本語入力・`file://` での確認は [検証記録](docs/verification.md) に分けて記録する。
- Playwright スキル・CLI はユーザーが明示的に使用を指示した場合だけ使う。
