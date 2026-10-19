# パッケージに入っていないライセンス文

配布物に入るのに、npm のパッケージにライセンス文がないものの分です。ビルドで `vite/toolbox.ts` が、パッケージのライセンス文と一緒に「このアプリについて」へ入れます。

| ファイル | 対象 | 確かめた版 |
| --- | --- | --- |
| `pdfium-wasm.txt` | `@embedpdf/pdfium` の `pdfium.wasm` に入っている、PDFium 以外のライブラリ。PDFium 自身の分はパッケージの `LICENSE.pdfium` にある | `@embedpdf/pdfium` 2.15.0 |
| `rust-std.txt` | 差分の WebAssembly（`src/engine/diff/wasm/`）に入る Rust の標準ライブラリと、wasm32-unknown-unknown で使うメモリー確保（dlmalloc） | Rust 1.96.0 |

確かめた版は `vite/toolbox.ts` の `PACKAGE_NOTICES`・`RUST_NOTICE` にも書いてあります。`@embedpdf/pdfium` か、クレートの `rust-toolchain.toml` の Rust の版が変わると、ビルドが止まります。下の手順で確かめ直し、ファイルと版を更新してください。

## pdfium-wasm.txt

2026年10月19日に確かめました。

- `@embedpdf/pdfium` 2.15.0 は、embed-pdf-viewer の `v2.15.0` の `packages/pdfium/` でビルドされています。PDFium は embedpdf のフォーク（`https://github.com/embedpdf/pdfium.git` の `cb29e78f2ba00c9298714d5f4a8bf7765f1e802f`）で、GN の引数は `pdf_use_skia=false pdf_enable_xfa=false pdf_enable_v8=false pdf_use_partition_alloc=false`（`scripts/build.sh`）、リンクは Emscripten 3.1.70（`Dockerfile`・`build/compile.sh`）です。
- この設定でリンクされるライブラリを、PDFium の `BUILD.gn`（`core/fxcrt`・`core/fxcodec`・`core/fxge`・`fpdfsdk`・`third_party`）からたどりました。XFA・V8・Skia を使わないため、libtiff・HarfBuzz・V8 などは入りません。
- ライセンス文は、PDFium の `DEPS` が固定した版のものをそのまま使っています。

| ライブラリ | 入手元 |
| --- | --- |
| Anti-Grain Geometry 2.3 | PDFium の `third_party/agg23/copying` |
| FreeType 2.14.1 | `chromium/src/third_party/freetype2.git` の `b91f75bd…` の `docs/FTL.TXT`（FreeType License と GPLv2 から FreeType License を選ぶ。求められている謝辞の1行を先頭に置く） |
| Little CMS 2.15 | PDFium の `third_party/lcms/LICENSE` |
| OpenJPEG 2.5.4 | PDFium の `third_party/libopenjpeg/LICENSE` |
| libjpeg-turbo | `chromium/deps/libjpeg_turbo.git` の `6bb85251…` の `LICENSE.md` と `README.ijg` の LEGAL ISSUES（求められている IJG の1行を先頭に置く） |
| libpng | `chromium/src/third_party/libpng.git` の `172f8383…` の `LICENSE` |
| zlib | `chromium/src/third_party/zlib.git` の `980253c1…` の `LICENSE` |
| fast_float 7.0.0 | `external/github.com/fastfloat/fast_float.git` の `cb1d42aa…` の `LICENSE-MIT`（MIT を選ぶ） |
| Abseil | `chromium/src/third_party/abseil-cpp.git` の `675d3d37…` の `LICENSE` |
| ICU | `chromium/deps/icu.git` の `a86a32e6…` の `LICENSE` |
| Emscripten 3.1.70・musl | `emscripten-core/emscripten` の `3.1.70` の `LICENSE`・`system/lib/libc/musl/COPYRIGHT` |

入手元はどれも `https://chromium.googlesource.com/` の下にあります（Emscripten は GitHub）。Emscripten が入れる libc++・libc++abi・compiler-rt は Apache-2.0 WITH LLVM-exception で、コンパイルしたものだけを配るときは表示の義務がないため入れていません。dlmalloc（Emscripten の `malloc`）はパブリックドメインです。

## rust-std.txt

2026年10月19日に、Rust 1.96.0 に付いている `share/doc/rust/COPYRIGHT-library.html` と `share/doc/rust/licenses/MIT.txt`（`rustc --print sysroot` の下）から作りました。

- 標準ライブラリは Apache-2.0 OR MIT です。MIT を選び、著作権者の行を `COPYRIGHT-library.html` の記載（The Rust Project Developers）にしています。
- 標準ライブラリが使うクレートのうち、wasm32-unknown-unknown の差分に入るのは dlmalloc 0.2.11 だけです（`HashMap` などを使っていないため）。MIT を選び、`COPYRIGHT-library.html` の `LICENSE-MIT` をそのまま使っています。compiler-builtins は標準ライブラリと同じリポジトリにあり、`COPYRIGHT-library.html` でも別のライセンスとして挙がっていないため、標準ライブラリの記載に含まれます。

## 確かめ直す手順

1. `@embedpdf/pdfium` を上げたら、embed-pdf-viewer の同じ版のタグで `packages/pdfium/` の `pdfium-src`（PDFium の版）、`scripts/build.sh`（GN の引数）、`Dockerfile`（Emscripten の版）を見ます。
2. PDFium の `BUILD.gn` と `DEPS` から、リンクされるライブラリとその版を確かめ、上の表の入手元から文を取り直します。
3. Rust を上げたら、新しい版の `COPYRIGHT-library.html` で、標準ライブラリと dlmalloc の記載が変わっていないかを見ます。
4. ファイルを更新し、`vite/toolbox.ts` の `PACKAGE_NOTICES`・`RUST_NOTICE` の版と、この README の版・日付を合わせます。
