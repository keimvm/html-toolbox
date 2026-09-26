// ファイルのドラッグ＆ドロップ。ページ内の要素のドラッグ（ファイル以外）には関わらない。

export const hasFiles = (transfer) => Array.from(transfer?.types ?? []).includes('Files');

/** 落とされたファイルの配列。フォルダを含む場合は null を返す。 */
export function droppedFiles(transfer) {
  const items = Array.from(transfer?.items ?? []).filter((item) => item.kind === 'file');
  if (items.some((item) => item.webkitGetAsEntry?.()?.isDirectory)) return null;
  return Array.from(transfer?.files ?? []);
}

/**
 * ページ全体でファイルのドラッグを見張る。
 * zone の外に落としたファイルをブラウザーが開いて、作業中の画面から離れないようにする。
 * zone の中で enabled() が真のときだけ受け付け、その間 zone に data-tb-file-drag を付ける。
 * 落とされたら droppedFiles() の結果を onDrop へ渡す。戻り値の関数で見張りをやめる。
 */
export function watchFileDrop({ window: win = globalThis.window, zone, onDrop, enabled = () => true } = {}) {
  const accepts = (event) => Boolean(zone && onDrop && zone.contains(event.target) && enabled());
  const setActive = (active) => zone?.toggleAttribute('data-tb-file-drag', active);
  function dragOver(event) {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    const active = accepts(event);
    event.dataTransfer.dropEffect = active ? 'copy' : 'none';
    setActive(active);
  }
  function dragLeave(event) {
    // ウィンドウの外へ出たときだけ relatedTarget が空になる。
    if (!event.relatedTarget) setActive(false);
  }
  function drop(event) {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    setActive(false);
    if (accepts(event)) onDrop(droppedFiles(event.dataTransfer), event);
  }
  const end = () => setActive(false);
  const listeners = { dragover: dragOver, dragleave: dragLeave, drop, dragend: end };
  for (const [type, listener] of Object.entries(listeners)) win.addEventListener(type, listener);
  return () => {
    for (const [type, listener] of Object.entries(listeners)) win.removeEventListener(type, listener);
    setActive(false);
  };
}
