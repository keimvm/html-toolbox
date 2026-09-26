# 文字コード変換 検証記録

自動テスト、ブラウザーでの確認、未確認のことを分けて記録する。

## 自動テスト（`pnpm check`）

2026年9月26日、macOS・Node.js 26.10.0・pnpm 12.4.2 で `node scripts/toolbox.mjs check mojicode-converter` と `node scripts/toolbox.mjs release 2026.09.26` が通った。

| テスト                | 確かめること                                                                                                                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/sjis.test.ts`  | Node.js の `TextDecoder` で作った Shift_JIS の表が、`CP932.TXT` の全7,915コードと一致し、ほかに読めるのは `80` と外字だけ。Windows の MBTABLE（代替の文字を除く）とも一致。文字 → コードの代表が WCTABLE の往復できる全対応と一致。読めない並びの位置の表示 |
| `tests/codec.test.ts` | あ・ｱ・①・髙・𠮷・絵文字などの各欄の値、書き方の幅、形式の誤り・読めない UTF-8 の位置、素性、表記の形                                                                                                                                                       |
| `tests/build.test.ts` | 配布物が HTML 1ファイルで外部を読み込まないこと、CSP、共通ヘッダー、対応表を埋め込んでいないこと                                                                                                                                                            |

## ブラウザーでの確認

2026年9月26日、Claude デスクトップアプリの内蔵ブラウザー（Chromium 152.0.7977.130、macOS）で確認した。Playwright は使っていない。

### Chromium の `TextDecoder` で作った表

開発サーバー（`pnpm dev`）のページで、開発者ツールのコンソールから次を実行し、表の要約値を出した。

```js
const { ShiftJisTable } = await import('/src/sjis.ts');
const t = new ShiftJisTable();
const sha = async (s) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
const codes = t.codes().sort((a, b) => a - b);
const cps = [...new Set(codes.map((c) => t.decode(c)))].sort((a, b) => a - b);
console.log(
  await sha(codes.map((c) => `${c}:${t.decode(c)}`).join(';')),
  await sha(cps.map((u) => `${u}:${t.encode(u)}`).join(';')),
  codes.length,
);
```

結果は、`CP932.TXT` に `80`・外字を加えた表と代表の規則から Node.js で計算した値と一致した（コード → 文字 `224e2830…ed5591`、文字 → コード `c640e8b8…e3fff7`、9,796コード）。別の OS・ブラウザーでも同じ手順で確かめられる。

### 画面

- 文字欄に「あｱ①髙𠮷≒😀」を入れると、各欄・大きく表示・表記の形・一覧が更新され、Shift_JIS 欄に「𠮷（5文字目）、😀（7文字目）は Shift_JIS で表せません。」と出た。一覧の髙に「ほかに EE E0」、≒に「ほかに 87 90」が出た。
- Shift_JIS 欄に `82A0 8790 ED40` を入れると、文字欄が「あ≒纊」になった。末尾に `85` を足すと「末尾の 85（7バイト目）は2バイト文字の途中で切れています。」と出て、ほかの欄と一覧が薄く表示された。
- フォント名に `Hiragino Mincho ProN` を入れると、大きく表示が明朝体になった。
- ライト・ダークの切り替え、幅375pxでの表示（横にはみ出さず、一覧だけ横にスクロール）を確認した。コンソールのエラーはなかった。
- `release` で作った `out/toolbox-2026.09.26/` を localhost で配信し、入口ページのカード、戻るリンク、版番号、配布版での変換を確認した。通信はページの HTML の取得だけだった。

## 未確認のこと

- `file://` で開いたときの動作（内蔵ブラウザーでは `file://` のページを操作できないため未確認）。
- 「PCのフォントを一覧にする」（Local Font Access API）の許可の流れと、`file://`・会社の PC の管理ポリシーでの可否。
- Windows の Edge、Mac の Chrome での `TextDecoder` の表の一致（上記の手順で確かめる）と画面の操作。
- ネットにつながない状態での動作。
- 日本語 IME での入力（確認は値の貼り付けと入力イベントで行った）。
