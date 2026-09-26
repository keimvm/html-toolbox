# favicon の生成記録

## toolbox の入口ページ

保存先：`ui/toolbox-icon.png`

2026年9月26日。内蔵の image_gen で道具箱の図柄を生成した。緑の地に透明部分のムラが出ないよう、入口ページ用は不透明な正方形として生成。macOS 標準の `sips -Z 128` で128×128の PNG に縮小し、入口ページの favicon として data URL で埋め込む。

採用画像の最終プロンプト全文：

```text
Use case: logo-brand
Asset type: tiny browser favicon for "toolbox", an offline HTML utility suite.
Create a single flat square app icon. Full canvas background is opaque solid dark evergreen #16302a edge to edge. Center a bold ivory #f3ecdc silhouette of a closed toolbox, front view, with a thick rectangular carrying handle on top, one horizontal green lid seam, and one small brass #c7ab74 center latch. Symbol fills 70% of canvas. Extremely clean, simple vector-like flat fills in only three colors. Uniform opaque colors, no textures, no gradients, no highlights, no shadows, no distress, no stains or marks. No text or letters. No tools protruding. No border. The result must be a completely opaque square icon with NO transparent regions. Clear recognizable silhouette at 16 pixels.
```

## 各ツール

2026年9月26日。内蔵の image_gen を使用し、背景透過を指定して各ツールの画像を生成した。PDF編集は、先に完成したローカルノートの画像をスタイルの参考として再生成したものを採用。

生成後に macOS 標準の `sips -Z 128` で128×128の PNG に縮小した。新しい npm 依存は不要。各ツールの `src/icon.png` を favicon・ヘッダー・入口のカードに共用し、配布時は画像を HTML に埋め込む。

採用画像の最終プロンプト全文は次のとおり。

### pdf-edit

保存先：`tools/pdf-edit/src/icon.png`

```text
Use case: logo-brand
Asset type: favicon for a PDF editing app.
Input image: STYLE REFERENCE ONLY, the companion notebook app icon. Generate a new PDF app icon with the same palette, scale, rounded-square proportions and bold flat graphic style.
Subject: Two overlapping warm ivory document sheets with one simple brass folded corner, centered, recognizable at 16px. Large and bold.
Backdrop: A completely clean solid opaque evergreen rounded-square tile, same tone as the reference. The tile must be solid and uninterrupted behind the symbol, with no holes, no transparent patches and no dark marks. Only the area OUTSIDE the tile is transparent.
Constraints: No notebook rings, no pencil, no text. Single square icon, no mockup, no texture, no shadow, no lighting effects, no gradients. Clean flat app icon.
```

### note-html

保存先：`tools/note-html/src/icon.png`

```text
Use case: logo-brand
Asset type: production favicon and small app icon for a local offline HTML utility suite.
Primary request: Create one simple, cool, refined app icon, readable at 16px and 32px. A single centered rounded-square tile filling 94% of a square canvas, with genuinely transparent area only outside the rounded tile.
Style/medium: immaculate flat geometric graphic, strong bold silhouette, restrained contemporary design, crisp smooth edges, generous clear negative space. Front view.
Color palette: existing app palette of deep evergreen #16302a tile and warm ivory #f3ecdc symbol, with one restrained brass #c7ab74 accent.
Constraints: one icon only, no lettering, no words, no watermark, no mockup, no surrounding frame or background scene. No gradients, no texture, no shadows, no 3D, no fine details, no hairline strokes, no ornamental borders. The symbol must occupy about 64% of canvas with strong contrast. Square image.
Subject: local notes and writing, expressed by a bold minimal notebook silhouette with a strong binding edge and one short diagonal brass pencil mark. No text lines or lettering. Keep the notebook geometry minimal and recognizable at favicon size.
```

### mojicode-converter

保存先：`tools/mojicode-converter/src/icon.png`

2026年9月26日。画像生成ではなく、ブラウザーの Canvas で上の2つと同じ配色・形に描いた。512×512 で描き、Canvas の縮小（`imageSmoothingQuality = 'high'`）で128×128の PNG にした。新しい npm 依存は不要。

- 地：エバーグリーン `#16302a` の角丸の正方形（キャンバスの94%、角の半径は一辺の20%）。外側は透明。
- 図柄：アイボリー `#f3ecdc` の「あ」（Hiragino Sans、太さ800、一辺の62%の大きさ）を中央に置く。
- 差し色：「あ」の下に、真鍮色 `#c7ab74` の短い角丸の横棒を3本並べる（バイト列の区切りを表す）。
