# 画像変換の作業ガイド

直下の [AGENTS.md](../../../AGENTS.md) に加える、このツール固有の約束です。最初に [README](README.md)、[企画書](docs/requirements.md)、[要件](docs/software-requirements.md)、[技術構成](docs/software-stack.md)、[検証記録](docs/verification.md) を読む。

- 元のファイルは読むだけにする。保存はすべて `src/lib/download.ts` のダウンロードで、別のファイルとして作る。
- 画像は `createImageBitmap`（`imageOrientation: 'from-image'`）で向きを直して読み、Canvas に描き直して書き出す。付加情報（Exif）を読み書きするライブラリや、元のバイト列をそのまま書き出す近道を足さない。付加情報が残らないことと、塗りつぶした範囲の元の画素が残らないこと（元の大きさで塗ってから縮める）は、描画の順番（塗りつぶし → 切り抜き → 回転 → 縮小）で守っている。
- 切り抜き・塗りつぶしの範囲は、向きを直した元の画像の画素の座標で持ち、回転は最後に当てる。画面の座標との行き来は `geometry.ts` の関数を使い、ここを変えたら `geometry.test.ts` に例を足す。
- 出力は JPEG・PNG だけ。WebP・AVIF の出力、HEIC の読み込み、zip での保存、作業状態の保存・復元は要件で扱わないと決めている。作業内容を localStorage・IndexedDB などに入れない。
- PDF の処理は toolbox の共有の PDF エンジン（`src/engine/pdf/`、PDF編集と同じ Worker）を使う。画像の埋め込みは `EPDFImageObj_SetJpeg`・`EPDFImageObj_SetPng`、PDF を小さくする処理はページ直下の画像だけを差し替える。理由と確かめた範囲は [技術構成](docs/software-stack.md#pdf-の処理) に書く。
- 共有テストの画像・PDF は `src/engine/pdf/samples.test-support.ts` の合成データを使う。個人の写真・業務の PDF をコミットしない。
- WASM・Worker・フォントの埋め込みと `file://` での動作は、実機での確認を [検証記録](docs/verification.md) に分けて記録する。Canvas の書き出しは Node.js の自動テストで模擬できない。
