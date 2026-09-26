# favicon の生成記録

2026年9月26日。内蔵の image_gen を使用し、背景透過を指定して各ツールの画像を生成した。PDF編集は、先に完成したローカルノートの画像をスタイルの参考として再生成したものを採用。

生成後に macOS 標準の `sips -Z 128` で128×128の PNG に縮小した。新しい npm 依存は不要。各ツールの `src/icon.png` を favicon・ヘッダー・入口のカードに共用し、配布時は画像を HTML に埋め込む。

採用画像の最終プロンプト全文は次のとおり。

## pdf-edit

保存先：`tools/pdf-edit/src/icon.png`

```text
Use case: logo-brand
Asset type: favicon for a PDF editing app.
Input image: STYLE REFERENCE ONLY, the companion notebook app icon. Generate a new PDF app icon with the same palette, scale, rounded-square proportions and bold flat graphic style.
Subject: Two overlapping warm ivory document sheets with one simple brass folded corner, centered, recognizable at 16px. Large and bold.
Backdrop: A completely clean solid opaque evergreen rounded-square tile, same tone as the reference. The tile must be solid and uninterrupted behind the symbol, with no holes, no transparent patches and no dark marks. Only the area OUTSIDE the tile is transparent.
Constraints: No notebook rings, no pencil, no text. Single square icon, no mockup, no texture, no shadow, no lighting effects, no gradients. Clean flat app icon.
```

## note-html

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
