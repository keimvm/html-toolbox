interface PageBounds {
  top: number;
  bottom: number;
}

export const ZOOM_LEVELS = [25, 50, 75, 100, 125, 150, 200, 300] as const;
export type PreviewZoom = 'fit' | (typeof ZOOM_LEVELS)[number];
export function isPreviewZoom(value: unknown): value is PreviewZoom {
  return value === 'fit' || ZOOM_LEVELS.some((level) => level === value);
}
export function previewWidth(
  pageWidth: number,
  available: number,
  zoom: PreviewZoom,
) {
  return zoom === 'fit'
    ? Math.max(1, available)
    : (pageWidth * (96 / 72) * zoom) / 100;
}
export function stepZoom(
  currentPercent: number,
  direction: -1 | 1,
): PreviewZoom {
  return direction === 1
    ? (ZOOM_LEVELS.find((level) => level > currentPercent + 0.1) ?? 300)
    : ([...ZOOM_LEVELS]
        .reverse()
        .find((level) => level < currentPercent - 0.1) ?? 25);
}

/** 上端付近で読んでいるページを選ぶ。余白では次のページ、末尾では最終ページ。 */
export function currentPreviewPage(
  pages: readonly PageBounds[],
  viewport: PageBounds,
  atEnd: boolean,
): number {
  if (!pages.length || viewport.bottom <= viewport.top) return -1;
  if (atEnd) return pages.length - 1;
  const readingLine =
    viewport.top + Math.min(24, (viewport.bottom - viewport.top) / 2);
  const index = pages.findIndex((page) => page.bottom > readingLine);
  return index < 0 ? pages.length - 1 : index;
}
