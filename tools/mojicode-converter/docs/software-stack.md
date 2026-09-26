# 文字コード変換・確認ツール 技術構成

元の企画書：[requirements.md](requirements.md)。満たす要件は [software-requirements.md](software-requirements.md) を参照。

## 選定に関わる制約
- 単一 HTML で配り、オフライン・`file://`・Windows/Mac の Chrome・Edge で動かす。外部を読み込まない。
- 依存関係は `tools/mojicode-converter/` の中で閉じる。共通の見た目・ヘッダー・ダークモードは `ui/` を取り込む（[開発・リリース手順](../../../docs/development.md)）。
- 値の正しさ（Windows と同じ値）を最優先する。

## 採用する技術
| 担当 | 技術 | 役割・採用理由 |
|---|---|---|
| 画面・処理 | TypeScript ＋ HTML ＋ CSS | バイト列・数値の変換が中心のため、型の検査で取り違えを防ぐ |
| ビルド | Vite ＋ vite-plugin-singlefile | 単一 HTML にまとめる。PDF編集と同じ構成で、設定と `ui/` の取り込み方を流用できる |
| 自動テスト | Vitest | 既知の値・CP932 対応表との突き合わせ |
| 依存管理 | pnpm（版は `packageManager` で固定）、Node.js（`.node-version` で固定） | toolbox のツール追加の手順に従う |

実行時のライブラリは追加しない。以下はブラウザーの標準機能でまかなう。

| 役割 | 標準機能 | 補足 |
|---|---|---|
| UTF-8 / UTF-16 / U+番号 | `TextEncoder`・`TextDecoder`・文字列のコードポイント操作 | |
| Shift_JIS（CP932） | `TextDecoder('shift_jis')` | 全コードを一度読み、逆引きの表を実行時に作る。両方向が同じ表に基づくので食い違わない。同じ文字に二つのコードがある場合の代表は Windows に合わせる |
| 文字の種類・全角半角 | 正規表現の Unicode プロパティ（`\p{Script=...}` など）、`String.prototype.normalize` など | 機種依存文字かどうかは Shift_JIS の表（NEC・IBM 拡張の範囲）から判定する |
| 表記の形 | 文字列処理、`encodeURIComponent` など | |
| フォントの一覧 | Local Font Access API（`window.queryLocalFonts()`） | 初回に利用者の許可が要る。使えない・拒否されたときはフォント名の手入力に切り替え、CSS の `font-family` で表示する |

## テスト用の外部データ
- Microsoft が公開している CP932 の対応表（Unicode Consortium の MAPPINGS に掲載の `CP932.TXT`、文字 → コードの向きは `bestfit932.txt` の WCTABLE のうち往復できるもの、を候補とする）を、テストの正解として使う。配布物には入れない。ライセンス表記の要否は取り込み時に確認する。

## 未検証事項
- `file://` で開いたページで Local Font Access API が使えるか（安全な文脈として扱われるか）。会社の PC のブラウザー設定（管理ポリシー）で止められていないか。
- ブラウザー標準の Shift_JIS と CP932 対応表の差。WHATWG の Shift_JIS は `0x80` や外字領域（F040〜F9FC を私用領域へ対応）など、CP932.TXT と扱いが異なる箇所がある見込み。差は突き合わせで洗い出して記録する。
- 同じ文字に二つのコードがある場合の代表の選び方が、Windows と一致するか。上記の突き合わせで確かめる。
- 利用するテスト用対応表のファイルと入手元の最終確認。

## 実装時に委ねること
- ファイル構成、関数・型の分け方、TypeScript・ESLint・Prettier などの細かな設定（PDF編集の設定を参考にする）。
- 逆引き表を作る時機（起動時か初回使用時か）と保持のしかた。
- 採用する pnpm・Node.js・各開発用パッケージの版。
