export const FONT_SIZES = [14, 16, 18, 20, 24];
const defaults = { fontSize: 16, uiFont: '' };
const validFont = value => typeof value === 'string' && value.length <= 100 && !/[\u0000-\u001f\u007f"\\;{}]/.test(value);

export function readDisplay(value) {
  if (value == null) return { ...defaults };
  if (![1, 2].includes(value.version) || !FONT_SIZES.includes(value.fontSize) || value.version === 2 && !validFont(value.uiFont)) throw new Error('InvalidDisplay');
  return { fontSize: value.fontSize, uiFont: value.version === 2 ? value.uiFont : '' };
}

export function createDisplay(window, { store, onError }) {
  const document = window.document;
  const select = document.getElementById('font-size');
  const font = document.getElementById('ui-font');
  const dialog = document.getElementById('settings-dialog');
  const open = document.getElementById('settings-open');
  const close = document.getElementById('settings-close');
  let settings = { ...defaults };
  let interacted = false;
  let disposed = false;
  let reported = false;
  let writes = Promise.resolve();
  const events = new window.AbortController();
  function on(target, type, listener) { target.addEventListener(type, listener, { signal: events.signal }); }
  function render() {
    select.value = String(settings.fontSize); font.value = settings.uiFont;
    document.documentElement.style.setProperty('--note-font-size', `${settings.fontSize}px`);
    if (settings.uiFont) document.documentElement.style.setProperty('--ui-font-family', `"${settings.uiFont}", var(--default-font-family)`);
    else document.documentElement.style.removeProperty('--ui-font-family');
  }
  function report() {
    if (disposed || reported) return;
    reported = true;
    onError('表示設定を記憶できません。このまま利用できます。');
  }
  function change() {
    const fontSize = Number(select.value), uiFont = font.value.trim();
    if (!FONT_SIZES.includes(fontSize)) return;
    if (!validFont(uiFont)) { font.setCustomValidity('フォント名を100文字以内で入力してください。記号の一部は使えません。'); font.reportValidity(); return; }
    font.setCustomValidity('');
    interacted = true; settings = { fontSize, uiFont }; render();
    const record = { version: 2, ...settings };
    writes = writes.then(() => store.save(record)).catch(report);
  }
  on(select, 'change', change); on(font, 'change', change);
  on(font, 'input', () => font.setCustomValidity(''));
  on(open, 'click', () => { dialog.showModal(); font.focus(); });
  on(close, 'click', () => { change(); if (!font.checkValidity()) return; dialog.close(); document.getElementById('options-toggle').focus(); });
  on(dialog, 'cancel', event => { event.preventDefault(); close.click(); });
  render();
  const ready = (async () => {
    try {
      const stored = readDisplay(await store.load());
      if (disposed || interacted) return;
      settings = stored; render();
    } catch { report(); }
  })();
  return { ready, get fontSize() { return settings.fontSize; }, flush: () => writes,
    dispose() { disposed = true; events.abort(); if (dialog.open) dialog.close(); } };
}
