# 画像変換の作業ガイド

直下の [AGENTS.md](../../../AGENTS.md) に加える、このツール固有の約束です。最初に [README](README.md)、[企画書](docs/requirements.md)、[要件](docs/software-requirements.md)、[技術構成](docs/software-stack.md)、[検証記録](docs/verification.md) を読む。

- 元のファイルは読むだけにする。保存はすべて `src/lib/download.ts` のダウンロードで、別のファイルとして作る。クリップボードへのコピーは `src/lib/clipboard.ts` の `copyImage()`（PNG）を使う。
- 画像は `createImageBitmap`（`imageOrientation: 'from-image'`）で向きを直して読み、Canvas に描き直して書き出す。付加情報（Exif）を読み書きするライブラリや、元のバイト列をそのまま書き出す近道を足さない。付加情報が残らないことと、黒塗りした範囲の元の画素が残らないこと（元の大きさで塗ってから縮める）は、描画の順番（黒塗り → 切り抜き → 回転 → 縮小 → 書き込み）で守っている。黒塗りの範囲は `settleRedaction()` で画素の境目まで外側へ広げる。
- 切り抜き・書き込みの位置は、向きを直した元の画像の画素の座標で持ち、回転は最後に当てる。画面の座標との行き来は `geometry.ts`（`viewTransform` など）の関数を使い、ここを変えたら `geometry.test.ts` に例を足す。書き込みの形・当たり判定・重ねる順は `marks.ts` に置き、`marks.test.ts` で確かめる。
- 書き込みは `paint.ts` の `paintMarks()` だけで描き、保存する画像（`convert.ts`）と編集の画面（`editor.tsx`）で描き方を分けない。編集の画面は、画像のキャンバスに蛍光ペン用（CSS で色を掛け合わせる）とそのほか用の2枚を重ねる。
- 書き込みの太さ・大きさは、描いたときの画像の長い辺（`unit`）に対する割合で決める。保存する画像では縮めた後の画素に直接描き、線と文字をぼかさない。
- 編集の取り消しは `history.ts` で、画像ごとに変える前の編集の写しを積む。編集を変える処理は `editor.tsx` の `change()`・`commit()` を通し、取り消しに積み忘れない。
- 出力は JPEG・PNG だけ。WebP・AVIF の出力、HEIC の読み込み、zip での保存、作業状態の保存・復元は要件で扱わないと決めている。作業内容（書き込み・道具の色や大きさの選択を含む）を localStorage・IndexedDB などに入れない。
- PDF の処理は toolbox の共有の PDF エンジン（`src/engine/pdf/`、PDF編集と同じ Worker）を使う。画像の埋め込みは `EPDFImageObj_SetJpeg`・`EPDFImageObj_SetPng`。理由と確かめた範囲は [技術構成](docs/software-stack.md#pdf-の処理) に書く。PDF を小さくするのは PDF編集で行い、このツールに戻さない。
- 共有テストの画像・PDF は `src/engine/pdf/samples.test-support.ts` の合成データを使う。個人の写真・業務の PDF をコミットしない。
- WASM・Worker・フォントの埋め込みと `file://` での動作は、実機での確認を [検証記録](docs/verification.md) に分けて記録する。Canvas の描画・書き出し、クリップボード、ポインター操作は Node.js の自動テストで模擬できない。
