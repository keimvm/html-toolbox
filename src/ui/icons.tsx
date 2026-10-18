// 画面のアイコン。24×24 の線画を currentColor で描く（theme.css の .tb-icon）。
import type { JSX } from 'preact';

const paths = {
  home: '<path d="M3.5 10.5 12 3.5l8.5 7"/><path d="M5.5 9v10.5a1 1 0 0 0 1 1H10v-6h4v6h3.5a1 1 0 0 0 1-1V9"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2m0 15v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2.5 12h2m15 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  waves:
    '<path d="M3 7.5c3-2.5 6 2.5 9 0s6-2.5 9 0M3 12c3-2.5 6 2.5 9 0s6-2.5 9 0M3 16.5c3-2.5 6 2.5 9 0s6-2.5 9 0"/>',
  'waves-off':
    '<path d="M3 9.5c3-2.5 6 2.5 9 0s6-2.5 9 0M3 14.5c3-2.5 6 2.5 9 0s6-2.5 9 0M4 3l16 18"/>',
  'chevron-down': '<path d="m6 9.5 6 6 6-6"/>',
  'chevron-up': '<path d="m6 14.5 6-6 6 6"/>',
  'chevron-left': '<path d="m14.5 6-6 6 6 6"/>',
  'chevron-right': '<path d="m9.5 6 6 6-6 6"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  download: '<path d="M12 3.5v11m-4.5-4.5 4.5 4.5 4.5-4.5"/><path d="M4.5 16v3.5h15V16"/>',
  folder:
    '<path d="M3.5 6.5a1 1 0 0 1 1-1h4.6l2 2.2h8.4a1 1 0 0 1 1 1v9.8a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1Z"/>',
  'folder-open':
    '<path d="M3.5 18V6.5a1 1 0 0 1 1-1h4.6l2 2.2h7.4a1 1 0 0 1 1 1V10"/><path d="M3.5 18.5 6 11.2a1 1 0 0 1 .95-.7H21l-2.6 7.3a1 1 0 0 1-.95.7H3.5Z"/>',
  file: '<path d="M14 3H6.5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V7.5Z"/><path d="M14 3v4.5h4.5"/>',
  'file-text':
    '<path d="M14 3H6.5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V7.5Z"/><path d="M14 3v4.5h4.5M8.5 12.5h7m-7 3.5h7"/>',
  files:
    '<path d="M15.5 2.5h-8a1 1 0 0 0-1 1v12"/><path d="M16 6.5h-6a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8.5a1 1 0 0 0 1-1V10Z"/><path d="M16 6.5V10h3.5"/>',
  image:
    '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><circle cx="9" cy="9.5" r="1.5"/><path d="m3.5 17 5-5 4.5 4.5m-1.5-1.5 3-3 6 6"/>',
  images:
    '<rect x="6.5" y="3.5" width="14" height="12" rx="1.5"/><path d="M3.5 7v12.5h14"/><path d="m6.5 13 4-4 3.5 3.5m-1-1 2-2 4.5 4.5"/>',
  copy: '<rect x="8.5" y="8.5" width="12" height="12" rx="1.5"/><path d="M15.5 8.5v-4a1 1 0 0 0-1-1h-10a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h4"/>',
  pencil: '<path d="M15.5 4.5 19.5 8.5 8.5 19.5 3.5 20.5 4.5 15.5Z"/><path d="m13 7 4 4"/>',
  trash:
    '<path d="M4 6.5h16M9.5 6.5V4a.5.5 0 0 1 .5-.5h4a.5.5 0 0 1 .5.5v2.5M6 6.5l1 13.5a1 1 0 0 0 1 .9h8a1 1 0 0 0 1-.9l1-13.5M10 10.5v6.5m4-6.5v6.5"/>',
  'rotate-cw': '<path d="M20 4.5v5h-5"/><path d="M19.6 9.5A8 8 0 1 0 20 14"/>',
  'rotate-ccw': '<path d="M4 4.5v5h5"/><path d="M4.4 9.5A8 8 0 1 1 4 14"/>',
  undo: '<path d="M8.5 5 4 9.5 8.5 14"/><path d="M4 9.5h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15.5 5 20 9.5 15.5 14"/><path d="M20 9.5H10a6 6 0 0 0 0 12h3"/>',
  'arrow-up': '<path d="M12 19.5v-15m-6 6 6-6 6 6"/>',
  'arrow-down': '<path d="M12 4.5v15m-6-6 6 6 6-6"/>',
  'arrow-left': '<path d="M19.5 12h-15m6-6-6 6 6 6"/>',
  'arrow-right': '<path d="M4.5 12h15m-6-6 6 6-6 6"/>',
  more: '<circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/>',
  refresh:
    '<path d="M20 4.5v5h-5M4 19.5v-5h5"/><path d="M19.4 9.5A8 8 0 0 0 5 8.2M4.6 14.5a8 8 0 0 0 14.4 1.3"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.4"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.8v.5M12 16.8v.4"/>',
  sliders:
    '<path d="M4 7h9m4 0h3M4 17h3m4 0h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  tag: '<path d="M3.5 12.6V4.5a1 1 0 0 1 1-1h8.1l8 8a1 1 0 0 1 0 1.4l-7.1 7.1a1 1 0 0 1-1.4 0Z"/><circle cx="8.3" cy="8.3" r="1.4"/>',
  keyboard:
    '<rect x="2.5" y="6" width="19" height="12" rx="1.5"/><path d="M6 9.5h.01M9.3 9.5h.01M12.6 9.5h.01M15.9 9.5h.01M18 9.5h.01M6 12.5h.01M9.3 12.5h.01M12.6 12.5h.01M15.9 12.5h.01M18 12.5h.01M8 15.3h8"/>',
  type: '<path d="M5 6.5V4.5h14v2M12 4.5v15M9 19.5h6"/>',
  'scan-text':
    '<path d="M8 3.5H4.5a1 1 0 0 0-1 1V8m13-4.5h3.5a1 1 0 0 1 1 1V8M3.5 16v3.5a1 1 0 0 0 1 1H8m8.5 0H20a1 1 0 0 0 1-1V16M7.5 8.5h9m-9 3.5h9m-9 3.5h5.5"/>',
  layers:
    '<path d="m12 3.5 8.5 4.5L12 12.5 3.5 8Z"/><path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5"/>',
  crop: '<path d="M6.5 2.5v14a1 1 0 0 0 1 1h14"/><path d="M2.5 6.5h14a1 1 0 0 1 1 1v14"/>',
  cursor: '<path d="M6 3.5v15l4-3.8 2.7 6 2.6-1.2-2.7-5.9H18Z"/>',
  'arrow-mark': '<path d="M5 19 18 6"/><path d="M10 5.5h8.5V14"/>',
  square: '<rect x="4" y="5.5" width="16" height="13" rx="1.5"/>',
  circle: '<ellipse cx="12" cy="12" rx="8.5" ry="7.5"/>',
  number: '<circle cx="12" cy="12" r="8.5"/><path d="M10.3 9.3 12.6 8v8.3"/>',
  highlighter: '<path d="m14.8 4.2 5 5-7.3 7.3H7.5v-5Z"/><path d="m7.5 16.5-3 3h4.5M3.5 21h17"/>',
  redact:
    '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><rect x="7" y="9.5" width="10" height="5" fill="currentColor" stroke="none"/>',
  'zoom-in': '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M10.5 7.5v6m-3-3h6"/>',
  'zoom-out': '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5M7.5 10.5h6"/>',
  fit: '<path d="M8.5 3.5h-4a1 1 0 0 0-1 1v4m17 0v-4a1 1 0 0 0-1-1h-4m0 17h4a1 1 0 0 0 1-1v-4m-17 0v4a1 1 0 0 0 1 1h4"/>',
  sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M9.5 4.5v15"/>',
  save: '<path d="M4.5 4.5a1 1 0 0 1 1-1h10l4 4v12a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1Z"/><path d="M8 3.5v5h7.5v-5M7.5 20.5v-6.5h9v6.5"/>',
  'external-link':
    '<path d="M13.5 3.5h7v7M20.5 3.5 11 13"/><path d="M18.5 14v5.5a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1H10"/>',
  grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
  'eye-off':
    '<path d="M10 5.7A9 9 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16 16 0 0 1-2.6 3.4M6.6 6.6C3.9 8.3 2.5 12 2.5 12S6 18.5 12 18.5a9 9 0 0 0 5.4-1.8M3.5 3.5l17 17M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  sparkle:
    '<path d="M12 3.5c.6 4 2.3 6 6.5 6.5-4.2.5-5.9 2.5-6.5 6.5-.6-4-2.3-6-6.5-6.5 4.2-.5 5.9-2.5 6.5-6.5Z"/><path d="M18.5 15.5c.3 1.8 1 2.6 2.5 3-1.5.3-2.2 1.1-2.5 3-.3-1.9-1-2.7-2.5-3 1.5-.4 2.2-1.2 2.5-3Z"/>',
  shield:
    '<path d="M12 3 5 5.8v5.4c0 4.4 3 8.2 7 9.8 4-1.6 7-5.4 7-9.8V5.8Z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  inbox:
    '<path d="M3.5 13.5 6 5.5a1 1 0 0 1 1-.7h10a1 1 0 0 1 1 .7l2.5 8v5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1Z"/><path d="M3.5 13.5h5l1.5 2.5h4l1.5-2.5h5"/>',
  clipboard:
    '<rect x="5" y="4.5" width="14" height="16.5" rx="1.5"/><path d="M9 4.5V3.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M8.5 10.5h7m-7 3.5h7m-7 3.5h4"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01"/>',
  pdf: '<path d="M14 3H6.5a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V7.5Z"/><path d="M14 3v4.5h4.5"/><path d="M8.5 16.5v-4h1.3a1.2 1.2 0 0 1 0 2.4H8.5m4.5 1.6v-4h1a2 2 0 0 1 0 4Z"/>',
  shrink: '<path d="M4 9.5h5.5V4M20 9.5h-5.5V4M4 14.5h5.5V20M20 14.5h-5.5V20"/>',
  combine:
    '<rect x="3.5" y="3.5" width="7" height="9" rx="1"/><rect x="13.5" y="3.5" width="7" height="9" rx="1"/><path d="M7 15.5v2.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-2.5M12 12.5v8.5"/>',
  send: '<path d="M20.5 3.5 10 14M20.5 3.5 14 20.5l-4-6.5-6.5-4Z"/>',
  bold: '<path d="M7 4.5h6a3.75 3.75 0 0 1 0 7.5H7Zm0 7.5h7a3.75 3.75 0 0 1 0 7.5H7Z"/>',
  italic: '<path d="M14.5 4.5 9.5 19.5M10 4.5h8M6 19.5h8"/>',
  strike:
    '<path d="M4 12h16M16.5 7.5c-.8-1.8-2.5-3-4.6-3-2.7 0-4.4 1.6-4.4 3.5 0 1.6 1 2.6 3 3.3M7.5 16.5c.8 1.9 2.6 3 4.9 3 2.7 0 4.6-1.5 4.6-3.6 0-1.1-.5-2-1.5-2.7"/>',
  code: '<path d="m8.5 7.5-5 4.5 5 4.5m7-9 5 4.5-5 4.5"/>',
  quote:
    '<path d="M4.5 16.5c0-5 1.5-7.5 5-9M14.5 16.5c0-5 1.5-7.5 5-9M4.5 16.5a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0Zm10 0a2.5 2.5 0 1 0 5 0 2.5 2.5 0 0 0-5 0Z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
  table:
    '<rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/><path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10"/>',
  checkbox: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 3 3 5-6"/>',
  heading: '<path d="M5.5 4.5v15M15.5 4.5v15M5.5 12h10M18.5 19.5v-6l-2 1.5"/>',
  'list-ordered':
    '<path d="M10 6.5h10M10 12h10M10 17.5h10M4 4.8h1.2v4M4 9h2.4M4 15.4a1.2 1.2 0 1 1 2 .8L4 18.6h2.4"/>',
  rule: '<path d="M3.5 12h17"/>',
  print:
    '<path d="M6.5 8.5V3.5h11v5"/><rect x="3.5" y="8.5" width="17" height="8" rx="1.5"/><path d="M6.5 14.5h11v6h-11Z"/>',
  timer: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2.5M9.5 2.5h5"/>',
} as const;

export type IconName = keyof typeof paths;

export function Icon({
  name,
  label,
  class: className,
  ...rest
}: { name: IconName; label?: string; class?: string } & Omit<
  JSX.SVGAttributes<SVGSVGElement>,
  'name' | 'class' | 'label'
>) {
  return (
    <svg
      class={className ? `tb-icon ${className}` : 'tb-icon'}
      viewBox="0 0 24 24"
      aria-hidden={label ? undefined : 'true'}
      role={label ? 'img' : undefined}
      aria-label={label}
      dangerouslySetInnerHTML={{ __html: paths[name] }}
      {...rest}
    />
  );
}
