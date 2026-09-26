export function createToolbar(window) {
  const document = window.document;
  const events = new window.AbortController();
  const menus = ['format', 'options'].map(name => ({
    button: document.getElementById(`${name}-toggle`),
    panel: document.getElementById(`${name}-panel`),
  }));
  function close(menu, restoreFocus = false) {
    menu.panel.hidden = true;
    menu.button.setAttribute('aria-expanded', 'false');
    for (const details of menu.panel.querySelectorAll('details')) details.open = false;
    if (restoreFocus) menu.button.focus();
  }
  function closeAll() { menus.forEach(menu => close(menu)); }
  function on(target, type, listener) { target.addEventListener(type, listener, { signal: events.signal }); }
  for (const menu of menus) {
    on(menu.button, 'click', () => {
      const opening = menu.panel.hidden;
      closeAll();
      if (opening) {
        menu.panel.hidden = false;
        menu.button.setAttribute('aria-expanded', 'true');
      }
    });
    on(menu.panel, 'click', event => {
      if (event.target.closest('button')) close(menu);
    });
  }
  on(document, 'pointerdown', event => {
    for (const menu of menus) {
      if (!menu.panel.contains(event.target) && !menu.button.contains(event.target)) close(menu);
    }
  });
  on(document, 'focusin', event => {
    for (const menu of menus) {
      if (!menu.panel.contains(event.target) && event.target !== menu.button) close(menu);
    }
  });
  on(document, 'keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('dialog[open]')) return;
    const menu = menus.find(menu => !menu.panel.hidden);
    if (menu) { event.preventDefault(); close(menu, true); }
  });
  return { closeAll, dispose() { closeAll(); events.abort(); } };
}
