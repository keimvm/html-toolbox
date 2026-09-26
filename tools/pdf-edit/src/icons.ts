const paths: Record<string, string> = {
  files:
    '<path d="M15 2H6a2 2 0 0 0-2 2v13m6-11h6l4 4v10a2 2 0 0 1-2 2h-8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z"/><path d="M16 6v4h4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M5 16v4h14v-4"/>',
  'arrow-up': '<path d="m5 12 7-7 7 7M12 5v14"/>',
  'arrow-down': '<path d="m5 12 7 7 7-7M12 5v14"/>',
  'rotate-cw': '<path d="M20 7v5h-5M20 12a8 8 0 1 0-2 5"/>',
  'trash-2': '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  'undo-2':
    '<path d="M3 10h11a7 7 0 0 1 0 14M3 10l5-5m-5 5 5 5" transform="translate(0 -3)"/>',
  'scan-text':
    '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M7 8h10M7 12h10M7 16h6"/>',
  'chevron-left': '<path d="m15 5-7 7 7 7"/>',
  'chevron-right': '<path d="m9 5 7 7-7 7"/>',
  x: '<path d="m6 6 12 12M6 18 18 6"/>',
  'file-text': '<path d="M14 2H5v20h14V7ZM14 2v5h5M8 12h8M8 16h8"/>',
  type: '<path d="M4 5V3h16v2M12 3v18M8 21h8"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1"/><path d="m3 16 5-5 6 6m-3-3 5-5 5 5"/>',
  shapes: '<circle cx="8" cy="8" r="5"/><path d="M14 13h7v8h-8v-7"/>',
};

export function renderIcons(root: ParentNode = document) {
  root.querySelectorAll<HTMLElement>('[data-lucide]').forEach((placeholder) => {
    const name = placeholder.dataset.lucide ?? '';
    placeholder.outerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? ''}</svg>`;
  });
}
