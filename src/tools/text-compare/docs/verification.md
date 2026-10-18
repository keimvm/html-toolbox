# 文章比較 検証記録

要件は [software-requirements.md](software-requirements.md)、技術構成は [software-stack.md](software-stack.md) を参照してください。

## 追加（2026-10-18）

文章比較を追加し、タイピングゲームの差分（Rust の WebAssembly）を共通部品 `src/engine/diff/` に移した。比べ方のテスト（`compare.test.ts`）を追加した。

| 確認 | 結果 |
| --- | --- |
| 型チェック（`tsc --noEmit`） | 成功 |
| `node scripts/toolbox.mjs test`（`compare.test.ts` 10件を含む全296件） | 成功 |
| `src/engine/diff/wasm/` で `cargo test`（7件） | 成功 |
| `node scripts/toolbox.mjs build 2026.10.18` | 成功 |
| lint・整形チェック・総合検証・配布物のテスト | 未実行 |
| 画面（開発サーバー・配布物・`file://`）、Windows の Edge・Mac の Chrome | 未確認 |
