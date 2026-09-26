// jsdom にない API 境界だけを模擬する。クリック・Escape・排他表示は実ブラウザーで確認する。
export function installPopover(window) {
  const open = new WeakSet();
  function toggle(panel, newState) {
    const event = new window.Event('beforetoggle');
    Object.defineProperty(event, 'newState', { value: newState });
    panel.dispatchEvent(event);
    if (newState === 'open') open.add(panel); else open.delete(panel);
  }
  window.HTMLElement.prototype.showPopover = function () { toggle(this, 'open'); };
  window.HTMLElement.prototype.hidePopover = function () { if (open.has(this)) toggle(this, 'closed'); };
  return { isOpen: panel => open.has(panel) };
}
