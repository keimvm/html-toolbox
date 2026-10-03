export const FONT_SIZES = [14, 16, 18, 20, 24];
// UIの文字の大きさは標準に対する百分率。画面用の font-size は style.css で --ui-scale を掛ける。
export const UI_SCALES = [90, 100, 110, 120, 130];
const defaults = { fontSize: 16, uiFont: '', uiScale: 100 };
const validFont = value => typeof value === 'string' && value.length <= 100 && !/[\u0000-\u001f\u007f"\\;{}]/.test(value);

export function readDisplay(value) {
  if (value == null) return { ...defaults };
  if (![1, 2, 3].includes(value.version) || !FONT_SIZES.includes(value.fontSize) || value.version >= 2 && !validFont(value.uiFont) || value.version === 3 && !UI_SCALES.includes(value.uiScale)) throw new Error('InvalidDisplay');
  return { fontSize: value.fontSize, uiFont: value.version >= 2 ? value.uiFont : '', uiScale: value.version === 3 ? value.uiScale : 100 };
}

export function createDisplay(window, { store, onError }) {
  const document = window.document;
  const select = document.getElementById('font-size');
  const font = document.getElementById('ui-font');
  const scale = document.getElementById('ui-font-size');
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
    select.value = String(settings.fontSize); font.value = settings.uiFont; scale.value = String(settings.uiScale);
    document.documentElement.style.setProperty('--note-font-size', `${settings.fontSize}px`);
    document.documentElement.style.setProperty('--ui-scale', String(settings.uiScale / 100));
    if (settings.uiFont) document.documentElement.style.setProperty('--ui-font-family', `"${settings.uiFont}", var(--tb-font)`);
    else document.documentElement.style.removeProperty('--ui-font-family');
  }
  function report() {
    if (disposed || reported) return;
    reported = true;
    onError('表示設定を記憶できません。このまま利用できます。');
  }
  function change() {
    const fontSize = Number(select.value), uiFont = font.value.trim(), uiScale = Number(scale.value);
    if (!FONT_SIZES.includes(fontSize) || !UI_SCALES.includes(uiScale)) return;
    if (!validFont(uiFont)) { font.setCustomValidity('フォント名を100文字以内で入力してください。記号の一部は使えません。'); font.reportValidity(); return; }
    font.setCustomValidity('');
    interacted = true; settings = { fontSize, uiFont, uiScale }; render();
    const record = { version: 3, ...settings };
    writes = writes.then(() => store.save(record)).catch(report);
  }
  on(select, 'change', change); on(font, 'change', change); on(scale, 'change', change);
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
