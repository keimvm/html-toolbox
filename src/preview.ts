interface PageBounds {
  top: number;
  bottom: number;
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
