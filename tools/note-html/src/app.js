import { decodeFile, encodeFile, equalBytes, getHandle, readBytes, listDirectory, errorMessage } from './core.js';
import { renderMarkdown } from './markdown.js';
import { createRichEditor } from './rich-editor.js';
import { createSessionStore, createLayoutStore, createDisplayStore, readSession } from './session-store.js';
import { createLayout } from './layout.js';
import { createDisplay } from './display.js';
import { createToolbar } from './toolbar.js';
import { createExporter } from './export.js';
import { saveAssets, createAssetOpener } from './assets.js';
import { watchFileDrop } from '../../../ui/file-drop.js';
import { setupToolHeader } from '../../../ui/header.js';
import { EntryError, entryName, parentPath, containsPath, entryAt, createEntry, snapshotEntry, countFiles, renameEntry, deleteEntry } from './file-operations.js';

export function createApp(window, { sessionStore = createSessionStore(window), layoutStore = createLayoutStore(window), displayStore = createDisplayStore(window) } = {}) {
  const document = window.document;
  const $ = id => document.getElementById(id);
  const ui = Object.fromEntries(['open-folder', 'welcome-open', 'reload', 'tree', 'file-name', 'file-path', 'source-mode', 'return-to-note', 'rich-editor', 'format-toolbar', 'format-toggle', 'save', 'save-status', 'notice', 'notice-text', 'notice-action', 'notice-close', 'format-warning', 'welcome', 'welcome-title', 'welcome-text', 'preview', 'editor', 'confirm-dialog', 'confirm-title', 'confirm-text', 'confirm-actions'].map(id => [id, $(id)]));
  ui.export = $('export'); ui['font-size'] = $('font-size');
  const toolbar = createToolbar(window);
  const welcomeDefaults = { title: [...ui['welcome-title'].childNodes].map(node => node.cloneNode(true)), text: [...ui['welcome-text'].childNodes].map(node => node.cloneNode(true)) };
  const supported = Boolean(window.isSecureContext && typeof window.showDirectoryPicker === 'function' && window.FileSystemFileHandle?.prototype.createWritable && window.FileSystemHandle?.prototype.requestPermission);
  const state = { root: null, current: null, expanded: new Set(['']), draft: '', mode: 'rich', richProblem: '', composing: false, busy: '', asking: false, sequence: 0, treeSequence: 0, saved: false };
  let renderer;
  let richEditor;
  let dialogResolve;
  let noticeAction;
  let pendingSession = null;
  let sessionWrites = Promise.resolve();
  let disposed = false;
  const assetOpener = createAssetOpener(window, notify);
  const exporter = createExporter(window, { onError: message => { if (!disposed) notify(message); } });

  function rememberSession() {
    if (!state.root || disposed || state.busy === 'restoring') return;
    const record = { version: 1, root: state.root, selectedPath: state.current?.path || null, expandedPaths: [...state.expanded] };
    // 呼び出し時の状態を順番に確定し、遅い書き込みが新しい選択を巻き戻すことを防ぐ。
    sessionWrites = sessionWrites.then(() => sessionStore.save(record)).catch(() => {
      if (!disposed && ui.notice.hidden) notify('次回の復元情報を記録できません。このままノートは利用できます。');
    });
  }

  function dirty() { return Boolean(state.current && state.draft !== state.current.baseText); }
  function locked() { return Boolean(state.busy || state.asking); }
  function icon(name, className = '') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', `icon ${className}`);
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#icon-${name}`); svg.append(use); return svg;
  }
  function clearNotice() { ui.notice.hidden = true; noticeAction = null; }
  function notify(message, label, action) {
    ui['notice-text'].textContent = message;
    ui['notice-action'].hidden = !action;
    ui['notice-action'].textContent = label || '';
    noticeAction = action;
    ui.notice.hidden = false;
  }
  function update() {
    const current = state.current;
    const changed = dirty();
    const disabled = locked();
    ui['open-folder'].disabled = !supported || disabled;
    ui['welcome-open'].disabled = !supported || disabled;
    ui.reload.disabled = !state.root || disabled;
    ui.save.disabled = !current || !changed || disabled || state.composing || Boolean(current.format.problem);
    ui['source-mode'].disabled = !current || disabled || state.composing;
    ui['return-to-note'].disabled = ui['source-mode'].disabled;
    ui['return-to-note'].hidden = state.mode !== 'source';
    ui['format-toggle'].hidden = state.mode === 'source';
    ui['format-toggle'].disabled = !current || disabled || state.composing || !richEditor || Boolean(current.format.problem);
    if (disabled || state.mode === 'source' || !current) toolbar.closeAll();
    ui.export.disabled = !current || disabled || state.composing;
    ui['font-size'].disabled = disabled || state.composing;
    $('settings-open').disabled = disabled || state.composing;
    ui['source-mode'].textContent = state.mode === 'source' ? '本文に戻る' : 'Markdownソース';
    richEditor?.setEditable(Boolean(current && !current.format.problem && !disabled && state.mode === 'rich'));
    ui.editor.readOnly = disabled || Boolean(current?.format.problem);
    ui['notice-action'].disabled = disabled;
    ui['save-status'].textContent = state.busy === 'managing' ? 'ファイルを更新中…' : state.busy === 'exporting' ? '出力を準備中…' : state.busy === 'adding' ? 'ファイルを追加中…' : state.busy === 'saving' ? '保存中…' : ['loading', 'reloading', 'restoring'].includes(state.busy) ? '読み込み中…' : changed ? '未保存' : current ? state.saved ? '保存済み' : '変更なし' : '';
    ui['save-status'].classList.toggle('dirty', changed);
    ui['source-mode'].setAttribute('aria-pressed', String(state.mode === 'source'));
    // ツール名は共通ヘッダーに出るため、ノートを開いている間だけファイル名を見出しにする。
    ui['file-name'].textContent = current ? current.path.split('/').at(-1) : '';
    ui['file-name'].hidden = !current;
    ui['file-path'].textContent = current ? `${state.root.name} / ${current.path}` : state.root ? state.root.name : 'Markdown を、いつものフォルダで。';
    ui['file-path'].title = ui['file-path'].textContent;
    ui['file-name'].title = ui['file-path'].textContent;
    ui.welcome.hidden = Boolean(current);
    ui.preview.hidden = !current || state.mode !== 'rich' || Boolean(richEditor);
    ui['rich-editor'].hidden = !current || state.mode !== 'rich' || !richEditor;
    ui['format-toolbar'].hidden = !current || state.mode !== 'rich' || !richEditor;
    ui.editor.hidden = !current || state.mode !== 'source';
    ui['format-warning'].hidden = !current?.format.problem && !state.richProblem;
    ui['format-warning'].textContent = current?.format.problem || state.richProblem;
    if (!current && state.root) {
      ui['welcome-title'].textContent = 'ノートを選んで、読み始める。';
      ui['welcome-text'].textContent = '左のフォルダを展開して、Markdown ファイルを選んでください。';
      ui['welcome-open'].hidden = true;
    } else if (!current && supported) {
      if (state.busy === 'restoring') ui['welcome-title'].textContent = '前回の状態を読み込み中…';
      else if (pendingSession) ui['welcome-title'].textContent = '前回のフォルダを開く。';
      else ui['welcome-title'].replaceChildren(...welcomeDefaults.title.map(node => node.cloneNode(true)));
      if (pendingSession) ui['welcome-text'].textContent = `「${pendingSession.root.name}」へのアクセスを許可してください。`;
      else ui['welcome-text'].replaceChildren(...welcomeDefaults.text.map(node => node.cloneNode(true)));
      ui['welcome-open'].hidden = false;
      ui['welcome-open'].querySelector('span').textContent = pendingSession ? 'アクセスを許可して開く' : 'フォルダを開く';
    }
    for (const row of ui.tree.querySelectorAll('button[data-file]')) {
      row.disabled = state.asking || Boolean(state.busy && (state.busy !== 'loading' || changed));
      if (row.dataset.file === current?.path) row.setAttribute('aria-current', 'page');
      else row.removeAttribute('aria-current');
    }
    for (const row of ui.tree.querySelectorAll('button[data-directory], .tree-retry')) row.disabled = state.asking || Boolean(state.busy && state.busy !== 'loading');
    for (const button of ui.tree.querySelectorAll('.tree-entry-menu')) button.disabled = disabled || state.composing;
    document.title = `${changed ? '● ' : ''}${current ? current.path.split('/').at(-1) + ' — ' : ''}ローカルノート`;
  }
  function render() {
    richEditor?.dispose(); richEditor = null;
    renderer?.dispose(); renderer = null;
    ui.preview.replaceChildren();
    state.richProblem = '';
    try {
      richEditor = createRichEditor({ window, container: ui['rich-editor'], toolbar: ui['format-toolbar'], source: state.draft, root: state.root, path: state.current.path,
        onAddFiles: addFiles, onAsset: path => void assetOpener.open(state.root, path),
        onChange: text => { state.draft = text; update(); },
        onNote: (path, fragment) => void openNote(path, fragment), onError: message => notify(message),
        onDialog: asking => { state.asking = asking; update(); },
        onComposition: composing => { state.composing = composing; update(); },
      });
    } catch {
      ui['rich-editor'].replaceChildren(); ui['format-toolbar'].replaceChildren();
      state.richProblem = 'この内容は直接編集できません。「Markdownソース」から編集できます。';
      renderer = renderMarkdown({ document, container: ui.preview, source: state.draft, root: state.root, path: state.current.path,
        onAsset: path => void assetOpener.open(state.root, path),
        onNote: (path, fragment) => void openNote(path, fragment), onError: message => notify(message) });
    }
  }
  function toggleSource() {
    if (!state.current || locked() || state.composing) return;
    if (state.mode === 'rich') {
      state.mode = 'source'; ui.editor.value = state.draft;
      update(); ui.editor.focus();
    } else {
      if (richEditor) {
        try { richEditor.setMarkdown(state.draft); }
        catch { render(); }
      } else render();
      if (!dirty()) richEditor?.markSaved(state.draft);
      state.mode = 'rich'; update(); richEditor?.focus();
    }
  }
  function focusEditor() { if (state.mode === 'source') ui.editor.focus(); else richEditor?.focus(); }
  async function exportNote(format) {
    if (!state.current || locked() || state.composing || disposed) return false;
    if (!format) format = await ask('エクスポート', '現在の本文を出力します。PDFは印刷画面で「PDFに保存」を選んでください。', [
      { value: 'html', label: 'HTMLをダウンロード' },
      { value: 'pdf', label: 'PDFに保存' },
      { value: 'cancel', label: 'キャンセル' },
    ]);
    if (!['html', 'pdf'].includes(format) || disposed || locked() || state.composing) return false;
    const snapshot = { format, source: state.draft, root: state.root, path: state.current.path, fontSize: display.fontSize };
    state.busy = 'exporting'; clearNotice(); update();
    try { return await exporter.run(snapshot); }
    finally { if (!disposed) { state.busy = ''; update(); } }
  }
  function anchor(fragment) { (richEditor || renderer)?.anchor(fragment); }
  function setCurrent(handle, path, bytes) {
    const format = decodeFile(bytes);
    state.current = { handle, path, baseBytes: bytes, baseText: format.text, format };
    state.draft = format.text; state.saved = false; state.mode = 'rich'; state.composing = false;
    ui.editor.value = state.draft;
    render(); update(); ui.preview.scrollTop = 0; ui['rich-editor'].scrollTop = 0;
  }
  function ask(title, message, choices, nameField) {
    if (dialogResolve) return Promise.resolve('cancel');
    state.asking = true; update();
    ui['confirm-title'].textContent = title;
    ui['confirm-text'].textContent = message;
    ui['confirm-actions'].replaceChildren();
    $('entry-name-label').hidden = !nameField;
    $('entry-name').value = nameField?.value || '';
    $('entry-error').hidden = true;
    return new Promise(resolve => {
      dialogResolve = result => { dialogResolve = null; state.asking = false; ui['confirm-dialog'].close(); update(); resolve(result); };
      for (const choice of choices) {
        const button = document.createElement('button');
        button.textContent = choice.label; button.dataset.choice = choice.value;
        button.className = choice.primary ? 'tb-button tb-primary' : 'tb-button tb-secondary';
        button.addEventListener('click', () => {
          let name;
          if (nameField && choice.start) {
            try { name = entryName($('entry-name').value, nameField.kind); }
            catch (error) { $('entry-error').textContent = error.message; $('entry-error').hidden = false; $('entry-name').focus(); return; }
          }
          // 保存の権限要求は、このクリックの user activation がある間に開始する。
          if (choice.start) {
            const finish = dialogResolve;
            try {
              const started = choice.start();
              finish(nameField ? Promise.resolve(started).then(permission => ({ permission, name })) : started);
            } catch (error) { finish(Promise.reject(error)); }
          } else if (choice.value === 'save') {
            const finish = dialogResolve;
            finish('saving');
          } else dialogResolve(choice.value);
        });
        ui['confirm-actions'].append(button);
      }
      ui['confirm-dialog'].showModal();
      if (nameField) { $('entry-name').focus(); $('entry-name').setSelectionRange(0, nameField.kind === 'file' ? $('entry-name').value.replace(/\.md$/i, '').length : $('entry-name').value.length); }
      else ui['confirm-actions'].querySelector('[data-choice="cancel"]')?.focus();
    });
  }
  async function allowLeave() {
    if (!dirty()) return true;
    const choice = await ask('変更を保存しますか？', `「${state.current.path}」に未保存の変更があります。`, [
      { value: 'save', label: '保存して続ける', primary: true },
      { value: 'discard', label: '変更を破棄して続ける' },
      { value: 'cancel', label: 'キャンセル' },
    ]);
    if (choice === 'saving') return save();
    return choice === 'discard';
  }
  let menuTarget;
  function closeEntryMenu() {
    $('entry-menu').close(); state.asking = false; update(); menuTarget?.button.focus();
  }
  function entryRow(row, path, kind) {
    const wrap = document.createElement('div'); wrap.className = 'tree-item-row';
    const button = document.createElement('button'); button.className = 'tb-button tree-entry-menu'; button.textContent = '⋯';
    button.setAttribute('aria-label', `${path || 'ルートフォルダ'}の操作`); button.setAttribute('aria-haspopup', 'dialog');
    button.addEventListener('click', () => {
      if (locked() || state.composing) return;
      menuTarget = { path, kind, button };
      $('entry-menu-title').textContent = path || state.root.name;
      for (const action of $('entry-menu').querySelectorAll('[data-entry-action]')) action.hidden = !path && ['rename', 'delete'].includes(action.dataset.entryAction);
      state.asking = true; update(); $('entry-menu').showModal();
    });
    wrap.append(row, button); return wrap;
  }
  async function manageEntry(action, path, kind) {
    if (!state.root || locked() || state.composing || disposed || !['create-file', 'create-directory', 'rename', 'delete'].includes(action)) return;
    if (!path && ['rename', 'delete'].includes(action)) return;
    const current = state.current;
    const affected = Boolean(current && path && containsPath(path, current.path));
    if (action === 'delete' && affected && !await allowLeave()) return;
    const root = state.root;
    let snapshot;
    try {
      state.busy = 'managing'; update();
      if (action === 'rename' || action === 'delete') {
        snapshot = await snapshotEntry(await entryAt(root, path, kind));
        if (affected) {
          let item = snapshot;
          for (const part of current.path.slice(path.length).split('/').filter(Boolean)) item = item?.children?.get(part);
          if (!item || !await item.handle.isSameEntry(current.handle) || !equalBytes(item.bytes, current.baseBytes)) throw new EntryError('開いているノートが外部で変更されています。本文を保持しています。再読み込みして確認してください。');
        }
      }
      if (disposed) return;
      const creating = action.startsWith('create-');
      const targetKind = creating ? action === 'create-file' ? 'file' : 'directory' : kind;
      const container = kind === 'directory' ? path : parentPath(path);
      const title = action === 'delete' ? '削除しますか？' : action === 'rename' ? '名前を変更' : targetKind === 'file' ? 'ファイルを追加' : 'フォルダを追加';
      const message = action === 'delete' ? `「${path}」${kind === 'directory' ? `と、その中の全ファイル（${countFiles(snapshot)}件、Markdown以外も含む）` : ''}を削除します。ゴミ箱には入りません。` : action === 'rename' ? `「${path}」の名前を変更します。他のノートからのリンクは自動更新されません。` : `追加先: ${root.name}${container ? ` / ${container}` : ''}`;
      const result = await ask(title, message, [
        { value: 'apply-entry', label: action === 'delete' ? '削除' : action === 'rename' ? '変更' : '追加', primary: true, start: () => root.requestPermission({ mode: 'readwrite' }) },
        { value: 'cancel', label: 'キャンセル' },
      ], action === 'delete' ? undefined : { kind: targetKind, value: action === 'rename' ? path.split('/').at(-1) : targetKind === 'file' ? '新しいノート.md' : '新しいフォルダ' });
      if (disposed || result === 'cancel') return;
      if ((action === 'delete' ? result : result.permission) !== 'granted') throw new window.DOMException('Permission denied', 'NotAllowedError');
      state.busy = '';
      if (action === 'create-file' && !await allowLeave()) return;
      if (disposed) return;
      state.busy = 'managing'; update();
      if (creating) {
        const added = await createEntry(root, container, result.name, targetKind);
        state.expanded.add(container);
        if (targetKind === 'directory') state.expanded.add(added.path);
        else setCurrent(added.handle, added.path, await readBytes(added.handle));
      } else if (action === 'rename') {
        const renamed = await renameEntry(root, path, result.name, snapshot);
        const remap = value => containsPath(path, value) ? renamed.path + value.slice(path.length) : value;
        state.expanded = new Set([...state.expanded].map(remap));
        if (affected) {
          current.path = remap(current.path);
          current.handle = await getHandle(root, current.path);
          if (richEditor) richEditor.setPath(current.path); else render();
        }
      } else {
        await deleteEntry(root, path, snapshot);
        state.expanded = new Set([...state.expanded].filter(value => !containsPath(path, value)));
        if (affected) {
          state.current = null; state.draft = ''; state.saved = false; state.mode = 'rich'; state.richProblem = '';
          richEditor?.dispose(); richEditor = null; renderer?.dispose(); renderer = null;
          ui['rich-editor'].replaceChildren(); ui.preview.replaceChildren(); ui.editor.value = '';
        }
      }
      rememberSession();
      await loadTree(root, new Set(state.expanded)); clearNotice();
    } catch (error) {
      if (!disposed) {
        notify(error instanceof EntryError ? error.message : errorMessage(error, 'ファイル操作'));
        try { await loadTree(root, new Set(state.expanded)); } catch { /* 本文を保持したまま、元のエラーを案内する。 */ }
      }
    } finally { if (!disposed) { state.busy = ''; update(); } }
  }
  async function loadTree(root, expanded = new Set([''])) {
    const topEntries = (await listDirectory(root)).filter(entry => entry.name !== '.assets');
    if (disposed) return;
    const version = ++state.treeSequence;
    const outer = document.createElement('ul'); outer.className = 'tree-list';
    const makeDirectory = (handle, path, depth, initialEntries) => {
      const li = document.createElement('li');
      const row = document.createElement('button'); row.className = `tb-button tree-row${!path ? ' root-row' : ''}`;
      row.dataset.directory = path; row.style.setProperty('--depth', depth);
      row.setAttribute('aria-expanded', 'false'); row.title = path || handle.name;
      row.append(icon('chevron', 'chevron'), icon('folder'));
      const name = document.createElement('span'); name.className = 'row-name'; name.textContent = handle.name; row.append(name);
      const list = document.createElement('ul'); list.className = 'tree-list'; list.hidden = true;
      li.append(entryRow(row, path, 'directory'), list);
      let loaded = false; let loading = false;
      const fill = async () => {
        if (loading || version !== state.treeSequence) return;
        loading = true; list.replaceChildren();
        const hint = document.createElement('li'); hint.className = 'tree-hint'; hint.style.setProperty('--depth', depth); hint.textContent = '読み込み中…'; list.append(hint);
        try {
          const entries = initialEntries || await listDirectory(handle); initialEntries = null;
          if (version !== state.treeSequence) return;
          const children = document.createDocumentFragment();
          for (const entry of entries) {
            const childPath = path ? `${path}/${entry.name}` : entry.name;
            if (entry.kind === 'directory') children.append(makeDirectory(entry, childPath, depth + 1));
            else {
              const item = document.createElement('li'); const button = document.createElement('button');
              button.className = 'tb-button tree-row file-row'; button.dataset.file = childPath; button.title = childPath; button.style.setProperty('--depth', depth + 1);
              const label = document.createElement('span'); label.className = 'row-name'; label.textContent = entry.name;
              button.append(icon('note'), label); button.addEventListener('click', () => void openNote(childPath));
              item.append(entryRow(button, childPath, 'file')); children.append(item);
            }
          }
          if (!entries.length) { hint.textContent = 'Markdown ファイルはありません'; children.append(hint); }
          list.replaceChildren(children); loaded = true; update();
        } catch (error) {
          if (version !== state.treeSequence) return;
          hint.textContent = errorMessage(error);
          const retry = document.createElement('button'); retry.className = 'tb-button tree-retry'; retry.textContent = '再試行'; retry.addEventListener('click', () => void fill()); hint.append(retry);
        } finally { loading = false; }
      };
      row.addEventListener('click', () => {
        if (version !== state.treeSequence || row.disabled) return;
        const open = row.getAttribute('aria-expanded') !== 'true';
        row.setAttribute('aria-expanded', String(open)); list.hidden = !open;
        if (open) expanded.add(path); else expanded.delete(path);
        rememberSession();
        if (open && !loaded) void fill();
      });
      if (expanded.has(path)) { row.setAttribute('aria-expanded', 'true'); list.hidden = false; void fill(); }
      return li;
    };
    outer.append(makeDirectory(root, '', 0, topEntries));
    state.expanded = expanded;
    ui.tree.replaceChildren(outer); update();
  }

  async function restoreFolder(session) {
    try {
      await loadTree(session.root, session.expanded);
      if (disposed) return;
      state.root = session.root; pendingSession = null; clearNotice();
    } catch {
      if (!disposed) notify('前回のフォルダを開けませんでした。「フォルダを開く」から選び直してください。', 'フォルダを開く', openFolder);
      return;
    }
    if (session.selectedPath) {
      try {
        const handle = await getHandle(session.root, session.selectedPath);
        const bytes = await readBytes(handle);
        if (!disposed) setCurrent(handle, session.selectedPath, bytes);
      } catch {
        if (!disposed) notify('前回のノートを開けませんでした。左のツリーからノートを選んでください。', '再試行', () => openNote(session.selectedPath));
      }
    }
  }
  async function restoreSession() {
    state.busy = 'restoring'; update();
    try {
      const session = readSession(await sessionStore.load());
      if (!session || disposed) return;
      pendingSession = session; update();
      const permission = await session.root.queryPermission({ mode: 'read' });
      if (!disposed && permission === 'granted') await restoreFolder(session);
    } catch {
      if (!disposed) notify('前回の状態を読み込めませんでした。「フォルダを開く」から開いてください。');
    } finally { if (!disposed) { state.busy = ''; update(); } }
  }
  async function reconnectFolder() {
    if (!pendingSession || locked() || disposed) return;
    const session = pendingSession;
    state.busy = 'restoring'; update();
    try {
      // IndexedDB の読み出しなどを挟まず、クリックの user activation 内で要求する。
      const permission = await session.root.requestPermission({ mode: 'read' });
      if (disposed) return;
      if (permission === 'granted') await restoreFolder(session);
      else notify('フォルダへのアクセスが許可されていません。再度許可するか、別のフォルダを開いてください。');
    } catch {
      if (!disposed) notify('フォルダへのアクセスを確認できませんでした。「フォルダを開く」から選び直してください。');
    } finally { if (!disposed) { state.busy = ''; update(); } }
  }
  async function openFolder() {
    if (!supported || locked() || disposed) return;
    state.sequence++; state.busy = 'picking'; update();
    let picked;
    try {
      // ピッカーを先に開き、キャンセル時は未保存内容も含めて現在の状態を維持する。
      picked = await window.showDirectoryPicker({ mode: 'read', id: 'local-notes' });
    } catch (error) {
      if (error.name !== 'AbortError') notify(errorMessage(error, 'フォルダの選択'), '再試行', openFolder);
    } finally { state.busy = ''; update(); }
    if (!picked || !await allowLeave()) return;
    state.busy = 'reloading'; update();
    try {
      await loadTree(picked);
      if (disposed) return;
      state.root = picked; state.current = null; state.draft = ''; state.saved = false; state.mode = 'rich';
      pendingSession = null;
      richEditor?.dispose(); richEditor = null; renderer?.dispose(); renderer = null; state.richProblem = '';
      ui.preview.replaceChildren(); ui.editor.value = ''; clearNotice(); rememberSession();
    } catch (error) { notify(errorMessage(error, 'フォルダの読み込み'), '再試行', openFolder); }
    finally { state.busy = ''; update(); }
  }
  async function openNote(path, fragment) {
    if (!state.root || state.asking || state.busy && (state.busy !== 'loading' || dirty())) return;
    if (state.current?.path === path && !state.busy) {
      if (fragment) { if (state.mode === 'source') toggleSource(); anchor(fragment); }
      return;
    }
    const ticket = ++state.sequence;
    if (!await allowLeave() || ticket !== state.sequence) return;
    state.busy = 'loading'; update();
    try {
      const handle = await getHandle(state.root, path);
      const bytes = await readBytes(handle);
      if (ticket !== state.sequence) return;
      setCurrent(handle, path, bytes); clearNotice(); rememberSession();
      if (fragment) anchor(fragment);
    } catch (error) {
      if (ticket === state.sequence) notify(errorMessage(error), '再試行', () => openNote(path, fragment));
    } finally { if (ticket === state.sequence) { state.busy = ''; update(); } }
  }
  async function reload() {
    if (!state.root || locked() || !await allowLeave()) return;
    state.sequence++; state.busy = 'reloading'; update();
    const expanded = new Set(state.expanded);
    try {
      // 本文の読み直しが失敗しても、列挙に成功したツリーは更新する。
      await loadTree(state.root, expanded);
      if (state.current) {
        const handle = await getHandle(state.root, state.current.path);
        const bytes = await readBytes(handle);
        setCurrent(handle, state.current.path, bytes);
      }
      clearNotice();
    } catch (error) { notify(errorMessage(error, '再読み込み'), '再試行', reload); }
    finally { state.busy = ''; update(); }
  }
  async function conflict() {
    notify('ファイルが外部で変更されています。編集内容を保持しています。');
    const choice = await ask('ファイルが外部で変更されています', '上書き保存を止めました。編集内容を残す場合は「編集に戻る」を選び、必要な本文をコピーしてください。', [
      { value: 'cancel', label: '編集に戻る', primary: true },
      { value: 'reload', label: '編集内容を破棄して再読み込み' },
    ]);
    if (choice === 'reload') {
      state.busy = 'reloading'; update();
      try {
        const handle = await getHandle(state.root, state.current.path);
        const bytes = await readBytes(handle);
        setCurrent(handle, state.current.path, bytes); clearNotice();
      } catch (error) { notify(errorMessage(error, '再読み込み'), '再試行', reload); }
      finally { state.busy = ''; update(); }
    } else { update(); focusEditor(); }
  }
  async function save() {
    if (!state.current || locked() || state.composing || state.current.format.problem) return false;
    if (!dirty()) return true;
    const current = state.current;
    const draft = state.draft;
    state.busy = 'saving'; update();
    let stream;
    let hasConflict = false;
    try {
      const permission = await current.handle.requestPermission({ mode: 'readwrite' });
      if (permission !== 'granted') throw new window.DOMException('Permission denied', 'NotAllowedError');
      const atPath = await getHandle(state.root, current.path);
      if (!await atPath.isSameEntry(current.handle)) hasConflict = true;
      else hasConflict = !equalBytes(await readBytes(atPath), current.baseBytes);
      if (!hasConflict) {
        const bytes = encodeFile(draft, current.format);
        stream = await current.handle.createWritable();
        await stream.write(bytes);
        await stream.close(); stream = null;
        // 保存後の再読込を基準にすると、直後の外部変更を見逃すため、書き込んだ内容を基準にする。
        current.baseBytes = bytes; current.baseText = draft; state.saved = true;
        if (state.mode === 'rich') richEditor?.markSaved(draft);
        clearNotice();
        return true;
      }
    } catch (error) {
      if (stream) { try { await stream.abort(); } catch { /* 本文を保持したまま保存失敗を案内する。 */ } }
      notify(`保存できませんでした。${errorMessage(error, '保存')}`, '再試行', save);
    } finally { state.busy = ''; update(); }
    if (hasConflict) await conflict();
    return false;
  }

  async function addFiles(files, position) {
    if (!files.length || disposed || locked() || state.composing || !state.current || state.current.format.problem || state.mode !== 'rich' || !richEditor) return;
    const editor = richEditor;
    if (!editor.canInsertAssets(position)) { notify('この位置には追加できません。本文の段落を選んでください。'); return; }
    const current = state.current, root = state.root, originalDoc = editor.view.state.doc;
    state.busy = 'adding'; clearNotice(); update();
    try {
      let permission = await root.queryPermission({ mode: 'readwrite' });
      if (disposed) return;
      if (permission !== 'granted') {
        permission = await ask('ファイルの追加を許可しますか？', '開いたフォルダの .assets にファイルをコピーします。', [
          { value: 'allow-assets', label: '許可して追加', primary: true, start: () => root.requestPermission({ mode: 'readwrite' }) },
          { value: 'cancel', label: 'キャンセル' },
        ]);
        if (permission === 'cancel' || disposed) return;
        if (permission !== 'granted') { notify('ファイルの追加が許可されていません。もう一度追加してアクセスを許可してください。'); return; }
      }
      const result = await saveAssets(root, current.path, files, { createId: () => window.crypto.randomUUID(), cancelled: () => disposed });
      if (disposed) return;
      if (result.added.length) editor.insertAssets(result.added, position, originalDoc);
      if (result.failed.length) {
        const names = result.failed.map(item => item.name).join('、');
        const remaining = result.failed.filter(item => item.remaining).map(item => item.remaining);
        notify(`${result.added.length}件追加しました。追加できなかったファイル: ${names}。${remaining.length ? `作成途中のファイルが残っています: ${remaining.join('、')}。` : ''}`);
      }
    } catch (error) { if (!disposed) notify(error.name === 'TypeMismatchError' ? '「.assets」と同名のファイルがあるため追加できません。' : errorMessage(error, '追加')); }
    finally { if (!disposed) { state.busy = ''; update(); editor.focus(); } }
  }

  ui['open-folder'].addEventListener('click', () => void openFolder());
  ui['welcome-open'].addEventListener('click', () => void (pendingSession ? reconnectFolder() : openFolder()));
  ui.reload.addEventListener('click', () => void reload());
  ui.save.addEventListener('click', () => void save());
  ui['source-mode'].addEventListener('click', toggleSource);
  ui['return-to-note'].addEventListener('click', toggleSource);
  ui.editor.addEventListener('input', () => { if (locked() || state.current?.format.problem) return; state.draft = ui.editor.value; update(); });
  ui.editor.addEventListener('compositionstart', () => { state.composing = true; update(); });
  ui.editor.addEventListener('compositionend', () => { state.composing = false; update(); });
  ui['notice-close'].addEventListener('click', clearNotice);
  ui['notice-action'].addEventListener('click', () => { if (!locked()) void noticeAction?.(); });
  ui['confirm-dialog'].addEventListener('cancel', event => { event.preventDefault(); dialogResolve?.('cancel'); });
  $('entry-name').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); ui['confirm-actions'].querySelector('[data-choice="apply-entry"]')?.click(); } });
  $('entry-menu-close').addEventListener('click', closeEntryMenu);
  $('entry-menu').addEventListener('cancel', event => { event.preventDefault(); closeEntryMenu(); });
  $('entry-menu').addEventListener('click', event => {
    const action = event.target.closest('[data-entry-action]');
    if (!action || !menuTarget) return;
    const { path, kind } = menuTarget; closeEntryMenu(); void manageEntry(action.dataset.entryAction, path, kind);
  });
  ui.export.addEventListener('click', () => void exportNote());
  ui.tree.addEventListener('keydown', event => {
    const row = event.target.closest('.tree-row');
    if (!row) return;
    const visible = [...ui.tree.querySelectorAll('.tree-row')].filter(button => !button.disabled && !button.closest('[hidden]'));
    const index = visible.indexOf(row);
    let target;
    if (event.key === 'ArrowDown') target = visible[index + 1];
    if (event.key === 'ArrowUp') target = visible[index - 1];
    if (event.key === 'Home') target = visible[0];
    if (event.key === 'End') target = visible.at(-1);
    if (event.key === 'ArrowRight' && row.hasAttribute('aria-expanded')) {
      if (row.getAttribute('aria-expanded') === 'false') row.click(); else target = visible[index + 1];
      event.preventDefault();
    }
    if (event.key === 'ArrowLeft') {
      if (row.getAttribute('aria-expanded') === 'true') row.click();
      else target = row.closest('li')?.parentElement.closest('li')?.querySelector(':scope > .tree-item-row > .tree-row');
      event.preventDefault();
    }
    if (target) { event.preventDefault(); target.focus(); }
  });
  window.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') { event.preventDefault(); if (!locked() && !document.querySelector('dialog[open]')) void save(); }
    // Typora と同じく Cmd / Ctrl+/ で Markdownソースと本文を切り替える。
    if ((event.metaKey || event.ctrlKey) && event.key === '/' && !event.isComposing) { event.preventDefault(); if (!document.querySelector('dialog[open]')) toggleSource(); }
  });
  // 本文への追加は rich-editor.js が受け付ける。それ以外の場所に落としたファイルで画面を離れないようにする。
  const stopFileDrop = watchFileDrop({ window });
  window.addEventListener('beforeunload', event => { if (dirty() || ['adding', 'managing'].includes(state.busy)) { event.preventDefault(); event.returnValue = ''; } });
  function dispose() { disposed = true; dialogResolve?.('cancel'); state.sequence++; state.treeSequence++; renderer?.dispose(); richEditor?.dispose(); toolbar.dispose(); layout.dispose(); display.dispose(); exporter.dispose(); assetOpener.dispose(); stopFileDrop(); }
  window.addEventListener('pagehide', event => { if (!event.persisted) dispose(); });
  if (!supported) {
    ui['welcome-title'].textContent = 'この環境ではフォルダを開けません。';
    ui['welcome-text'].textContent = window.isSecureContext ? '必要なファイル操作 API が利用できません。デスクトップ版 Google Chrome または Microsoft Edge で開いてください。' : '安全なコンテキストで開かれていません。デスクトップ版 Google Chrome または Microsoft Edge で、配布された HTML を直接開いてください。';
    notify(ui['welcome-text'].textContent);
  }
  update();
  const layout = createLayout(window, { store: layoutStore, onError: message => { if (ui.notice.hidden) notify(message); } });
  const display = createDisplay(window, { store: displayStore, onError: message => { if (ui.notice.hidden) notify(message); } });
  const ready = Promise.all([supported ? restoreSession() : Promise.resolve(), layout.ready, display.ready]).then(() => undefined);
  return { state, ready, flushSession: () => sessionWrites, flushLayout: layout.flush, flushDisplay: display.flush, openFolder, openNote, reload, save, addFiles, manageEntry, exportNote, dirty, toggleSource, get richEditor() { return richEditor; }, dispose };
}

if (typeof window !== 'undefined' && document.getElementById('open-folder')) {
  // 保存した配色を最初に反映する。
  setupToolHeader(document.querySelector('.tb-header'));
  createApp(window);
}
