# テスト用の CP932 対応表

Shift_JIS（Windows 版＝CP932）の値が Windows と一致することを確かめるための正解データです。テストでだけ読み、配布物には入れません。入手したままのバイト列で保つため、`.gitattributes` で改行の変換を止めています。

| ファイル | 入手元 | SHA-256 | 使い方 |
| --- | --- | --- | --- |
| `CP932.TXT` | https://www.unicode.org/Public/MAPPINGS/VENDORS/MICSFT/WINDOWS/CP932.TXT | `c9bc0b0cd42e0fbcb82a09635bb5abed86afbdd4abc9e76fa5716638217cb59f` | コード → 文字の全件の正解 |
| `bestfit932.txt` | https://www.unicode.org/Public/MAPPINGS/VENDORS/MICSFT/WindowsBestFit/bestfit932.txt | `2614cfea35c3c86c41d33198793a84ca44edee3cf0ee0013a61a43fba4ece331` | Windows の変換表。MBTABLE・DBCSTABLE（コード → 文字）と、WCTABLE（文字 → コード）のうち往復できる対応を、代表の選び方の正解に使う |

2026年9月26日に取得。どちらも Microsoft が作成し、Unicode Consortium のサイトで公開されている表です。利用条件は [Unicode Terms of Use](https://www.unicode.org/copyright.html) を参照してください。
