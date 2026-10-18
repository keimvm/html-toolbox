export function createToolbar(window) {
  const document = window.document;
  const events = new window.AbortController();
  const menus = ['format', 'options'].map((name) => ({
    button: document.getElementById(`${name}-toggle`),
    panel: document.getElementById(`${name}-panel`),
  }));
  // 開閉、排他表示、外側クリック、Escape、支援技術への展開状態は Popover API が扱う。
  function closeAll() {
    menus.forEach((menu) => menu.panel.hidePopover());
  }
  function on(target, type, listener) {
    target.addEventListener(type, listener, { signal: events.signal });
  }
  for (const menu of menus) {
    on(menu.panel, 'beforetoggle', (event) => {
      if (event.newState === 'closed') {
        for (const details of menu.panel.querySelectorAll('details')) details.open = false;
      }
    });
    on(menu.panel, 'click', (event) => {
      if (event.target.closest('button')) menu.panel.hidePopover();
    });
  }
  // Tab でメニュー外へ移った場合も閉じるという、このツールの操作要件。
  on(document, 'focusin', (event) => {
    for (const menu of menus) {
      if (!menu.panel.contains(event.target) && event.target !== menu.button)
        menu.panel.hidePopover();
    }
  });
  return {
    closeAll,
    dispose() {
      closeAll();
      events.abort();
    },
  };
}
