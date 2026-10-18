const MIN_WIDTH = 220;
const MAX_WIDTH = 600;
const MIN_EDITOR_WIDTH = 360;

export function readLayout(value) {
  if (value == null) return null;
  if (
    value.version !== 1 ||
    !Number.isFinite(value.sidebarWidth) ||
    value.sidebarWidth < MIN_WIDTH ||
    value.sidebarWidth > MAX_WIDTH ||
    typeof value.sidebarCollapsed !== 'boolean'
  )
    throw new Error('InvalidLayout');
  return { sidebarWidth: value.sidebarWidth, sidebarCollapsed: value.sidebarCollapsed };
}

export function createLayout(window, { store, onError }) {
  const document = window.document;
  const workspace = document.querySelector('.workspace');
  const sidebar = document.getElementById('sidebar');
  const splitter = document.getElementById('sidebar-resizer');
  const toggle = document.getElementById('sidebar-toggle');
  const events = new window.AbortController();
  let preferredWidth = null;
  let collapsed = false;
  let currentWidth;
  let drag = null;
  let interacted = false;
  let disposed = false;
  let reported = false;
  let writes = Promise.resolve();

  function bounds() {
    const style = window.getComputedStyle(workspace);
    const available =
      workspace.getBoundingClientRect().width -
      (parseFloat(style.paddingLeft) || 0) -
      (parseFloat(style.paddingRight) || 0);
    const gap = parseFloat(style.getPropertyValue('--splitter-width')) || 0;
    return {
      compact: window.innerWidth <= 680,
      initial: parseFloat(style.getPropertyValue('--sidebar-default-width')) || 292,
      max: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(available - gap - MIN_EDITOR_WIDTH))),
    };
  }
  function render() {
    const limits = bounds();
    currentWidth = Math.round(
      Math.max(MIN_WIDTH, Math.min(limits.max, preferredWidth ?? limits.initial)),
    );
    workspace.style.setProperty('--sidebar-width', `${currentWidth}px`);
    workspace.classList.toggle('sidebar-collapsed', collapsed);
    if (
      (collapsed && sidebar.contains(document.activeElement)) ||
      ((collapsed || limits.compact) && document.activeElement === splitter)
    )
      toggle.focus();
    sidebar.hidden = collapsed;
    splitter.hidden = collapsed || limits.compact;
    splitter.setAttribute('aria-valuemin', String(MIN_WIDTH));
    splitter.setAttribute('aria-valuemax', String(Math.floor(limits.max)));
    splitter.setAttribute('aria-valuenow', String(currentWidth));
    splitter.setAttribute('aria-valuetext', `${currentWidth}ピクセル`);
    const label = collapsed ? 'ファイルナビゲーションを開く' : 'ファイルナビゲーションを閉じる';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-label', label);
    toggle.title = label;
  }
  function reportError() {
    if (disposed || reported) return;
    reported = true;
    onError('レイアウトを記憶できません。このまま利用できます。');
  }
  function remember() {
    preferredWidth ??= bounds().initial;
    const record = { version: 1, sidebarWidth: preferredWidth, sidebarCollapsed: collapsed };
    // 操作時の値を順番に保存し、遅い書き込みで新しい操作が巻き戻らないようにする。
    writes = writes.then(() => store.save(record)).catch(reportError);
  }
  function endDrag(commit = false) {
    if (!drag) return;
    const previous = drag;
    drag = null;
    const changed = currentWidth !== previous.startWidth;
    if (!commit || !changed) preferredWidth = previous.preferredWidth;
    workspace.classList.remove('resizing-sidebar');
    if (splitter.hasPointerCapture?.(previous.id)) splitter.releasePointerCapture(previous.id);
    render();
    if (commit && changed) remember();
  }
  function moveDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    preferredWidth = Math.round(
      Math.max(MIN_WIDTH, Math.min(bounds().max, drag.startWidth + event.clientX - drag.startX)),
    );
    render();
  }
  function on(target, type, listener) {
    target.addEventListener(type, listener, { signal: events.signal });
  }
  on(toggle, 'click', () => {
    endDrag();
    interacted = true;
    collapsed = !collapsed;
    render();
    remember();
  });
  on(splitter, 'pointerdown', (event) => {
    if (event.button !== 0 || event.isPrimary === false || drag || collapsed || bounds().compact)
      return;
    event.preventDefault();
    interacted = true;
    drag = { id: event.pointerId, startX: event.clientX, startWidth: currentWidth, preferredWidth };
    splitter.setPointerCapture(event.pointerId);
    workspace.classList.add('resizing-sidebar');
  });
  on(splitter, 'pointermove', moveDrag);
  on(splitter, 'pointerup', (event) => {
    if (event.pointerId !== drag?.id) return;
    moveDrag(event);
    endDrag(true);
  });
  for (const type of ['pointercancel', 'lostpointercapture'])
    on(splitter, type, (event) => {
      if (event.pointerId === drag?.id) endDrag();
    });
  on(window, 'blur', () => endDrag());
  on(window, 'keydown', (event) => {
    if (drag && event.key === 'Escape') {
      event.preventDefault();
      endDrag();
    }
  });
  on(splitter, 'keydown', (event) => {
    if (drag || collapsed || bounds().compact || event.ctrlKey || event.metaKey || event.altKey)
      return;
    const step = event.shiftKey ? 50 : 10;
    const values = {
      ArrowLeft: currentWidth - step,
      ArrowRight: currentWidth + step,
      Home: MIN_WIDTH,
      End: bounds().max,
    };
    if (!Object.hasOwn(values, event.key)) return;
    event.preventDefault();
    interacted = true;
    const width = Math.round(Math.max(MIN_WIDTH, Math.min(bounds().max, values[event.key])));
    if (width === currentWidth) return;
    preferredWidth = width;
    render();
    remember();
  });
  function resize() {
    endDrag();
    render();
  }
  on(window, 'resize', resize);
  const observer = window.ResizeObserver ? new window.ResizeObserver(resize) : null;
  observer?.observe(workspace);
  render();
  const ready = (async () => {
    try {
      const value = readLayout(await store.load());
      if (!value || disposed || interacted) return;
      preferredWidth = value.sidebarWidth;
      collapsed = value.sidebarCollapsed;
      render();
    } catch {
      reportError();
    }
  })();
  return {
    ready,
    flush: () => writes,
    dispose() {
      disposed = true;
      endDrag();
      events.abort();
      observer?.disconnect();
    },
  };
}
