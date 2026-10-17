// ファイルのドラッグ＆ドロップ。ページ内の要素のドラッグ（ファイル以外）には関わらない。
// 受け付ける場所（zone）を登録しておき、画面全体で1か所がドラッグを見張る。
// どの zone にも入らない場所に落としたファイルで、ブラウザーが作業中の画面から離れないようにする。
import { useEffect, useRef } from 'preact/hooks';
import { hasFiles, readDrop, type Dropped } from '../lib/files';

export interface DropZone {
  element: () => Element | null;
  /** 受け付けるか。見えていない画面・処理中は偽にする。 */
  enabled: () => boolean;
  onDrop: (dropped: Dropped, event: DragEvent) => void;
  /** ドラッグ中に重ねる文言。null なら重ねない（zone の側で表示する）。 */
  label?: () => string | null;
  /** ドラッグ中の印を付ける要素。省略すると element。 */
  marker?: () => Element | null;
}

const zones = new Set<DropZone>();
let active: DropZone | null = null;
let installed = false;

function zoneAt(target: EventTarget | null) {
  if (!(target instanceof Node)) return null;
  let found: DropZone | null = null;
  for (const zone of zones) {
    const element = zone.element();
    if (!element || !zone.enabled() || !element.contains(target)) continue;
    // 入れ子の zone は内側を優先する。
    if (!found || found.element()?.contains(element)) found = zone;
  }
  return found;
}

function mark(zone: DropZone | null) {
  if (zone === active) return;
  if (active) {
    const element = active.marker?.() ?? active.element();
    element?.removeAttribute('data-tb-file-drag');
    element?.removeAttribute('data-tb-drop-label');
  }
  active = zone;
  if (zone) {
    const element = zone.marker?.() ?? zone.element();
    const label = zone.label?.();
    element?.setAttribute('data-tb-file-drag', '');
    if (label) element?.setAttribute('data-tb-drop-label', label);
  }
}

function install() {
  if (installed) return;
  installed = true;
  addEventListener('dragover', (event) => {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    const zone = zoneAt(event.target);
    event.dataTransfer!.dropEffect = zone ? 'copy' : 'none';
    mark(zone);
  });
  addEventListener('dragleave', (event) => {
    // ウィンドウの外へ出たときだけ relatedTarget が空になる。
    if (!event.relatedTarget) mark(null);
  });
  addEventListener('drop', (event) => {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    const zone = zoneAt(event.target);
    mark(null);
    if (zone) void readDrop(event.dataTransfer!).then((dropped) => zone.onDrop(dropped, event));
  });
  addEventListener('dragend', () => mark(null));
}

export function registerDropZone(zone: DropZone) {
  install();
  zones.add(zone);
  return () => {
    if (active === zone) mark(null);
    zones.delete(zone);
  };
}

/** 画面の要素をドロップの受け付け場所にする。最新の引数を毎回読む。 */
export function useDropZone<T extends Element>(
  options: Omit<DropZone, 'element'> & { element?: () => Element | null },
) {
  const ref = useRef<T>(null);
  const latest = useRef(options);
  latest.current = options;
  useEffect(
    () =>
      registerDropZone({
        element: () => latest.current.element?.() ?? ref.current,
        enabled: () => latest.current.enabled(),
        onDrop: (dropped, event) => latest.current.onDrop(dropped, event),
        label: () => latest.current.label?.() ?? null,
        marker: () => latest.current.marker?.() ?? null,
      }),
    [],
  );
  return ref;
}
