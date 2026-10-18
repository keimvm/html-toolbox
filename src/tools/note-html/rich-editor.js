import { EditorState, TextSelection, Plugin, PluginKey } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { Fragment, Slice } from 'prosemirror-model';
import { history, undo, redo, closeHistory } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import {
  baseKeymap,
  toggleMark,
  setBlockType,
  wrapIn,
  lift,
  chainCommands,
  exitCode,
} from 'prosemirror-commands';
import { wrapInList, splitListItem, sinkListItem, liftListItem } from 'prosemirror-schema-list';
import {
  InputRule,
  inputRules,
  wrappingInputRule,
  textblockTypeInputRule,
  undoInputRule,
} from 'prosemirror-inputrules';
import {
  tableEditing,
  addRowAfter,
  addColumnAfter,
  deleteRow,
  deleteColumn,
  deleteTable,
  goToNextCell,
  isInTable,
} from 'prosemirror-tables';
import { gapCursor } from 'prosemirror-gapcursor';
import { dropCursor } from 'prosemirror-dropcursor';
import { editorSchema as schema, parseMarkdown, serializeMarkdown } from './markdown-document.js';
import { markdownParser } from './markdown.js';
import { getHandle, resolveReference } from './core.js';
import { hasFiles, droppedFiles } from '../../lib/files';

// prosemirror-keymap と同じく読み込み時の OS で判定し、Typora の Mac / Windows の割り当てに合わせる。
const mac = typeof navigator !== 'undefined' && /Mac|iP(hone|[oa]d)/.test(navigator.platform);
const codeIndent = '    ';
// 上下の矢印でコードの前後に作った一時的な空段落の位置。
const pendingParagraph = new PluginKey('pendingParagraph');

export function createRichEditor({
  window,
  container,
  toolbar,
  source,
  root,
  path,
  onChange,
  onError,
  onNote,
  onAsset = () => {},
  onAddFiles = () => {},
  onDialog = () => {},
  onComposition = () => {},
}) {
  const document = window.document;
  const checkpoints = [];
  let editable = true;
  let replacing = false;
  let insertingAssets = false;
  let disposed = false;
  let currentSource = source;
  let view;
  const element = (tag, text) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const remember = (text, doc) => {
    checkpoints.unshift({ text, doc });
    // 原文の追跡はメモリ内だけで行う。各ソース編集・保存の直近20状態を保持する。
    if (checkpoints.length > 20) checkpoints.pop();
  };
  const initialDoc = parseMarkdown(source);
  const original = { text: source, doc: initialDoc };
  let saved = original;
  remember(source, initialDoc);

  function ancestor(state, name) {
    const { $from } = state.selection;
    for (let depth = $from.depth; depth > 0; depth--)
      if ($from.node(depth).type.name === name)
        return { node: $from.node(depth), pos: $from.before(depth) };
    return null;
  }
  const inTable = (state) => isInTable(state);
  const toggleList = (name) => (state, dispatch) => {
    if (inTable(state)) return false;
    const list = ancestor(state, 'bullet_list') || ancestor(state, 'ordered_list');
    if (list?.node.type.name === name) return liftListItem(schema.nodes.list_item)(state, dispatch);
    if (list) {
      if (dispatch)
        dispatch(
          state.tr.setNodeMarkup(list.pos, schema.nodes[name], { tight: list.node.attrs.tight }),
        );
      return true;
    }
    return wrapInList(schema.nodes[name], { tight: true })(state, dispatch);
  };
  const task = (state, dispatch) => {
    if (inTable(state)) return false;
    const item = ancestor(state, 'list_item');
    if (item) {
      if (dispatch)
        dispatch(
          state.tr.setNodeMarkup(item.pos, null, {
            checked: item.node.attrs.checked === null ? false : null,
          }),
        );
      return true;
    }
    return wrapInList(schema.nodes.bullet_list, { tight: true })(
      state,
      dispatch &&
        ((tr) => {
          tr.doc.nodesBetween(tr.selection.from, tr.selection.to, (node, pos) => {
            if (node.type === schema.nodes.list_item)
              tr.setNodeMarkup(pos, null, { checked: false });
          });
          dispatch(tr);
        }),
    );
  };
  const insert = (name) => (state, dispatch) => {
    if (inTable(state) || state.selection.$from.parent.type === schema.nodes.code_block)
      return false;
    const node = schema.nodes[name].createAndFill();
    if (dispatch) dispatch(state.tr.replaceSelectionWith(node).scrollIntoView());
    return true;
  };
  const insertTable = (state, dispatch) => {
    if (inTable(state) || ancestor(state, 'code_block')) return false;
    const paragraph = () => schema.nodes.paragraph.create();
    const row = (header) =>
      schema.nodes.table_row.create(
        null,
        Array.from({ length: 2 }, () =>
          schema.nodes[header ? 'table_header' : 'table_cell'].create(null, paragraph()),
        ),
      );
    if (dispatch)
      dispatch(
        state.tr
          .replaceSelectionWith(schema.nodes.table.create(null, [row(true), row(false)]))
          .scrollIntoView(),
      );
    return true;
  };
  const outsideTable = (command) => (state, dispatch) =>
    !inTable(state) && command(state, dispatch);
  // Typora と同じく、同じ見出しをもう一度選ぶと標準テキストへ戻す。
  const heading = (level) =>
    outsideTable((state, dispatch) => {
      const parent = state.selection.$from.parent;
      if (parent.type === schema.nodes.heading && parent.attrs.level === level)
        return setBlockType(schema.nodes.paragraph)(state, dispatch);
      return setBlockType(schema.nodes.heading, { level })(state, dispatch);
    });
  const commands = {
    paragraph: outsideTable(setBlockType(schema.nodes.paragraph)),
    ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`h${i + 1}`, heading(i + 1)])),
    undo,
    redo,
    strong: toggleMark(schema.marks.strong),
    em: toggleMark(schema.marks.em),
    strike: toggleMark(schema.marks.strike),
    code: toggleMark(schema.marks.code),
    bullet: toggleList('bullet_list'),
    ordered: toggleList('ordered_list'),
    task,
    quote: outsideTable((state, dispatch) =>
      (ancestor(state, 'blockquote') ? lift : wrapIn(schema.nodes.blockquote))(state, dispatch),
    ),
    codeBlock: outsideTable(setBlockType(schema.nodes.code_block)),
    rule: insert('horizontal_rule'),
    table: insertTable,
    addRow: addRowAfter,
    addColumn: addColumnAfter,
    deleteRow,
    deleteColumn,
    deleteTable,
  };
  function run(name) {
    if (!editable || view.composing) return false;
    const result = commands[name]?.(view.state, view.dispatch, view);
    view.focus();
    return Boolean(result);
  }
  function anchor(fragment) {
    const counts = new Map();
    let found;
    view.state.doc.descendants((node, pos) => {
      if (node.type !== schema.nodes.heading) return;
      const slug = node.textContent
        .toLowerCase()
        .replace(/[^\p{L}\p{N}_\s-]/gu, '')
        .trim()
        .replace(/\s/g, '-');
      const count = counts.get(slug) || 0;
      counts.set(slug, count + 1);
      if ((count ? `${slug}-${count}` : slug) === fragment) found = pos;
    });
    if (found !== undefined) view.nodeDOM(found)?.scrollIntoView({ block: 'start' });
    else onError('リンク先の見出しが見つかりません。');
  }
  function openReference(raw) {
    const ref = resolveReference(raw, path);
    if (ref.kind === 'note') onNote(ref.path, ref.fragment);
    else if (ref.kind === 'anchor') anchor(ref.fragment);
    else if (ref.kind === 'attachment' || ref.kind === 'image') onAsset(ref.path);
    else if (ref.kind === 'external') {
      const link = element('a');
      link.href = ref.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.referrerPolicy = 'no-referrer';
      link.click();
    } else onError('この参照先は開けません。');
  }
  function imageView(node) {
    const dom = element('span');
    dom.className = 'image-node';
    dom.contentEditable = 'false';
    const raw = node.attrs.src;
    const alt = node.attrs.alt || '画像';
    const ref = resolveReference(raw, path);
    let url;
    let gone = false;
    if (ref.kind === 'image') {
      dom.textContent = `${alt}（画像を読み込み中）`;
      void (async () => {
        try {
          const file = await (await getHandle(root, ref.path)).getFile();
          if (gone) return;
          const mime = /\.png$/i.test(ref.path)
            ? 'image/png'
            : /\.jpe?g$/i.test(ref.path)
              ? 'image/jpeg'
              : /\.gif$/i.test(ref.path)
                ? 'image/gif'
                : 'image/webp';
          url = window.URL.createObjectURL(file.slice(0, file.size, mime));
          const img = element('img');
          img.alt = alt;
          img.src = url;
          if (node.attrs.title) img.title = node.attrs.title;
          img.addEventListener('error', () => {
            dom.textContent = `${alt}（画像を表示できません）`;
          });
          dom.replaceChildren(img);
        } catch {
          if (!gone) dom.textContent = `${alt}（画像を取得できません: ${raw}）`;
        }
      })();
    } else if (ref.kind === 'external') {
      dom.classList.add('image-placeholder');
      dom.append(document.createTextNode(`${alt} — `));
      const link = element('button', '外部画像を開く');
      link.className = 'tb-button text-button';
      link.type = 'button';
      link.addEventListener('click', () => openReference(raw));
      dom.append(link);
    } else {
      dom.classList.add('image-placeholder');
      dom.textContent = `${alt}（参照できません: ${raw}）`;
    }
    return {
      dom,
      stopEvent: (event) => event.target.closest('button'),
      ignoreMutation: () => true,
      destroy() {
        gone = true;
        if (url) window.URL.revokeObjectURL(url);
      },
    };
  }
  function listItemView(node, _view, getPos) {
    const dom = element('li');
    const checkbox = element('input');
    checkbox.type = 'checkbox';
    checkbox.contentEditable = 'false';
    const contentDOM = element('div');
    contentDOM.className = 'list-content';
    dom.append(checkbox, contentDOM);
    const refresh = (next) => {
      if (next.type !== schema.nodes.list_item) return false;
      node = next;
      dom.classList.toggle('task-item', node.attrs.checked !== null);
      checkbox.hidden = node.attrs.checked === null;
      checkbox.checked = Boolean(node.attrs.checked);
      checkbox.disabled = !editable;
      checkbox.setAttribute('aria-label', node.attrs.checked ? '完了' : '未完了');
      if (node.attrs.checked === null) delete dom.dataset.checked;
      else dom.dataset.checked = String(node.attrs.checked);
      return true;
    };
    refresh(node);
    checkbox.addEventListener('change', () => {
      const pos = getPos();
      if (!editable || view.composing || typeof pos !== 'number') {
        refresh(node);
        return;
      }
      view.dispatch(
        closeHistory(view.state.tr).setNodeMarkup(pos, null, { checked: checkbox.checked }),
      );
    });
    return {
      dom,
      contentDOM,
      update: refresh,
      stopEvent: (event) => event.target === checkbox,
      ignoreMutation: (mutation) =>
        mutation.type !== 'selection' && !contentDOM.contains(mutation.target),
    };
  }
  function codeBlockView(node, _view, getPos) {
    // Typora と同じく、コードの右下で言語（フェンスの情報文字列）を確認・変更できるようにする。
    const dom = element('div');
    dom.className = 'code-block';
    const pre = element('pre');
    const code = element('code');
    pre.append(code);
    const field = element('span');
    field.className = 'code-language';
    field.contentEditable = 'false';
    const input = element('input');
    input.type = 'text';
    input.placeholder = '言語';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'コードの言語');
    field.append(input);
    dom.append(pre, field);
    const refresh = (next) => {
      if (next.type !== schema.nodes.code_block) return false;
      node = next;
      if (document.activeElement !== input) input.value = node.attrs.params;
      input.disabled = !editable;
      dom.classList.toggle('has-language', Boolean(node.attrs.params));
      return true;
    };
    refresh(node);
    const commit = () => {
      const pos = getPos();
      // 情報文字列に改行は入らず、バッククォートのフェンスではバッククォートも使えない。
      const params = input.value.replace(/[`\r\n]/g, '').trim();
      if (!editable || view.composing || typeof pos !== 'number' || params === node.attrs.params) {
        input.value = node.attrs.params;
        return;
      }
      view.dispatch(closeHistory(view.state.tr).setNodeMarkup(pos, null, { params }));
    };
    input.addEventListener('change', commit);
    input.addEventListener('keydown', (event) => {
      if (event.isComposing || !['Enter', 'Escape'].includes(event.key)) return;
      event.preventDefault();
      if (event.key === 'Escape') input.value = node.attrs.params;
      else commit();
      const pos = getPos();
      if (typeof pos === 'number')
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)));
      view.focus();
    });
    return {
      dom,
      contentDOM: code,
      update: refresh,
      stopEvent: (event) => event.target === input,
      ignoreMutation: (mutation) =>
        mutation.type !== 'selection' && !code.contains(mutation.target),
    };
  }

  const buttons = new Map();
  toolbar.replaceChildren();
  const blockSelect = element('select');
  blockSelect.setAttribute('aria-label', '段落の書式');
  for (const [value, label] of [
    ['paragraph', '標準テキスト'],
    ...Array.from({ length: 6 }, (_, i) => [`h${i + 1}`, `見出し ${i + 1}`]),
    ['code_block', 'コードブロック'],
  ]) {
    const option = element('option', label);
    option.value = value;
    blockSelect.append(option);
  }
  toolbar.append(blockSelect);
  const addButton = (parent, name, label, title = label) => {
    const button = element('button', label);
    button.className = 'tb-button';
    button.type = 'button';
    button.dataset.command = name;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () =>
      name === 'link' ? openLinkDialog() : name === 'assets' ? pickAssets() : run(name),
    );
    parent.append(button);
    buttons.set(name, button);
  };
  for (const [name, label, title] of [
    ['strong', 'B', '太字（⌘ / Ctrl+B）'],
    ['em', 'I', '斜体（⌘ / Ctrl+I）'],
    ['strike', 'S', '取り消し線'],
    ['bullet', '箇条書き'],
    ['ordered', '番号'],
    ['task', 'チェックボックス'],
    ['link', 'リンク'],
  ])
    addButton(toolbar, name, label, title);
  const more = element('details');
  more.className = 'format-more';
  more.append(element('summary', '挿入・操作'));
  const menu = element('div');
  menu.className = 'format-menu';
  more.append(menu);
  toolbar.append(more);
  addButton(menu, 'assets', '画像・ファイルを追加');
  for (const [name, label] of [
    ['quote', '引用'],
    ['code', 'インラインコード'],
    ['codeBlock', 'コードブロック'],
    ['rule', '区切り線'],
    ['table', '表を挿入'],
    ['addRow', '行を下に追加'],
    ['addColumn', '列を右に追加'],
    ['deleteRow', '行を削除'],
    ['deleteColumn', '列を削除'],
    ['deleteTable', '表を削除'],
    ['undo', '取り消す'],
    ['redo', 'やり直す'],
  ])
    addButton(menu, name, label);
  menu.addEventListener('click', (event) => {
    if (event.target.closest('button')) more.open = false;
  });
  more.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      more.open = false;
      more.querySelector('summary').focus();
    }
  });
  blockSelect.addEventListener('change', () => {
    if (!editable || view.composing) return;
    const value = blockSelect.value;
    const type = value.startsWith('h') ? schema.nodes.heading : schema.nodes[value];
    setBlockType(type, value.startsWith('h') ? { level: Number(value.slice(1)) } : null)(
      view.state,
      view.dispatch,
    );
    view.focus();
  });
  function updateToolbar() {
    if (!view) return;
    const state = view.state;
    const parent = state.selection.$from.parent;
    blockSelect.value =
      parent.type === schema.nodes.heading ? `h${parent.attrs.level}` : parent.type.name;
    blockSelect.disabled = !editable || inTable(state);
    const marks = state.storedMarks || state.selection.$from.marks();
    for (const [name, button] of buttons) {
      button.disabled =
        !editable ||
        (name === 'assets'
          ? view.composing || !canInsertAssets(state.selection.from)
          : name === 'link'
            ? !state.selection.$from.parent.type.allowsMarkType(schema.marks.link)
            : !commands[name](state));
      if (schema.marks[name])
        button.setAttribute(
          'aria-pressed',
          String(
            state.selection.empty
              ? Boolean(schema.marks[name].isInSet(marks))
              : state.doc.rangeHasMark(
                  state.selection.from,
                  state.selection.to,
                  schema.marks[name],
                ),
          ),
        );
      if (name === 'task')
        button.setAttribute(
          'aria-pressed',
          String(ancestor(state, 'list_item')?.node.attrs.checked != null),
        );
    }
    for (const checkbox of container.querySelectorAll('.task-item > input'))
      checkbox.disabled = !editable;
    const activeCode =
      parent.type === schema.nodes.code_block ? view.nodeDOM(state.selection.$from.before()) : null;
    for (const block of container.querySelectorAll('.code-block')) {
      block.classList.toggle('is-active', block === activeCode);
      block.querySelector('.code-language > input').disabled = !editable;
    }
  }

  const dialog = element('dialog');
  dialog.className = 'tb-dialog link-dialog';
  dialog.setAttribute('aria-label', 'リンクの編集');
  const title = element('h2', 'リンク');
  const labelField = element('label', '表示する文字');
  const labelInput = element('input');
  labelInput.className = 'tb-input';
  labelInput.type = 'text';
  labelField.append(labelInput);
  const urlField = element('label', 'URL またはノートの相対パス');
  const urlInput = element('input');
  urlInput.className = 'tb-input';
  urlInput.type = 'text';
  urlInput.spellcheck = false;
  urlField.append(urlInput);
  const error = element('p');
  error.setAttribute('role', 'alert');
  const actions = element('div');
  actions.className = 'tb-dialog-actions';
  const cancel = element('button', 'キャンセル'),
    remove = element('button', 'リンクを解除'),
    apply = element('button', '適用');
  cancel.className = 'tb-button tb-secondary';
  remove.className = 'tb-button tb-secondary';
  apply.className = 'tb-button tb-primary';
  actions.append(cancel, remove, apply);
  dialog.append(title, labelField, urlField, error, actions);
  document.body.append(dialog);
  let linkSelection;
  function closeLinkDialog() {
    dialog.close();
    onDialog(false);
    view.focus();
  }
  function openLinkDialog() {
    if (!editable || view.composing) return;
    let { from, to, $from } = view.state.selection;
    const mark =
      schema.marks.link.isInSet($from.marks()) ||
      schema.marks.link.isInSet(view.state.doc.nodeAt(from)?.marks || []);
    if (from === to && mark) {
      let offset = $from.start();
      let runStart = null;
      const cursor = from;
      $from.parent.forEach((child) => {
        const end = offset + child.nodeSize;
        if (mark.isInSet(child.marks)) {
          if (runStart === null) runStart = offset;
          if (runStart <= cursor && end >= cursor) {
            from = runStart;
            to = end;
          }
        } else runStart = null;
        offset = end;
      });
    }
    linkSelection = { from, to, text: view.state.doc.textBetween(from, to) };
    labelInput.value = linkSelection.text;
    urlInput.value = mark?.attrs.href || '';
    error.textContent = '';
    dialog.showModal();
    onDialog(true);
    urlInput.focus();
  }
  cancel.addEventListener('click', closeLinkDialog);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeLinkDialog();
  });
  apply.addEventListener('click', () => {
    const href = markdownParser.normalizeLink(urlInput.value.trim());
    if (
      !['external', 'note', 'anchor', 'attachment', 'image'].includes(
        resolveReference(href, path).kind,
      )
    ) {
      error.textContent =
        '開ける URL、ノート・画像・.assets 内の添付の相対パスを入力してください。';
      return;
    }
    const { from, to, text } = linkSelection;
    const label = labelInput.value || href;
    const tr = closeHistory(view.state.tr);
    if (label !== text) tr.insertText(label, from, to);
    tr.addMark(from, from + label.length, schema.marks.link.create({ href }));
    closeLinkDialog();
    view.dispatch(tr.scrollIntoView());
  });
  remove.addEventListener('click', () => {
    const { from, to } = linkSelection;
    const tr = closeHistory(view.state.tr).removeMark(from, to, schema.marks.link);
    closeLinkDialog();
    view.dispatch(tr);
  });

  function assetTarget(position) {
    if (!Number.isInteger(position) || position < 0 || position > view.state.doc.content.size)
      return null;
    const at = view.state.doc.resolve(position);
    if (at.parent.inlineContent) {
      return !at.parent.type.spec.code &&
        at.parent.type.allowsMarkType(schema.marks.link) &&
        at.parent.canReplaceWith(at.index(), at.index(), schema.nodes.image)
        ? { block: false }
        : null;
    }
    return at.parent.canReplaceWith(at.index(), at.index(), schema.nodes.paragraph)
      ? { block: true }
      : null;
  }
  function canInsertAssets(position) {
    return !disposed && Boolean(assetTarget(position));
  }
  function insertAssets(assets, position, expectedDoc) {
    if (disposed || view.state.doc !== expectedDoc) throw new Error('AssetTargetChanged');
    const target = assetTarget(position);
    if (!target || !assets.length) return;
    const nodes = [];
    for (const asset of assets) {
      if (nodes.length) nodes.push(schema.text(' '));
      nodes.push(
        asset.image
          ? schema.nodes.image.create({ src: asset.href, alt: asset.name })
          : schema.text(asset.name || '添付ファイル', [
              schema.marks.link.create({ href: asset.href }),
            ]),
      );
    }
    const content = target.block
      ? schema.nodes.paragraph.create(null, nodes)
      : Fragment.fromArray(nodes);
    const tr = closeHistory(view.state.tr).insert(position, content);
    const end = position + (target.block ? content.nodeSize : content.size);
    tr.setSelection(TextSelection.near(tr.doc.resolve(end))).scrollIntoView();
    insertingAssets = true;
    try {
      view.dispatch(tr);
      view.dispatch(closeHistory(view.state.tr));
    } finally {
      insertingAssets = false;
    }
  }
  const fileInput = element('input');
  fileInput.type = 'file';
  fileInput.multiple = true;
  fileInput.hidden = true;
  fileInput.setAttribute('aria-label', '追加する画像・ファイル');
  toolbar.append(fileInput);
  let pickedPosition, pickedDoc;
  function pickAssets() {
    if (!editable || view.composing || !canInsertAssets(view.state.selection.from)) return;
    pickedPosition = view.state.selection.from;
    pickedDoc = view.state.doc;
    fileInput.value = '';
    fileInput.click();
  }
  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = '';
    if (!editable || view.composing || !files.length || disposed) return;
    if (view.state.doc !== pickedDoc) {
      onError('本文が変わりました。追加する位置を選び直してください。');
      return;
    }
    void onAddFiles(files, pickedPosition);
  });

  const fileCursor = element('div');
  fileCursor.className = 'asset-drop-cursor';
  fileCursor.hidden = true;
  fileCursor.setAttribute('aria-hidden', 'true');
  document.body.append(fileCursor);
  function dropPosition(event) {
    if (!editable || view.composing || event.target.closest?.('.raw-block, pre, .code-block'))
      return null;
    const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos;
    return canInsertAssets(position) ? position : null;
  }
  function fileDragOver(event) {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const position = dropPosition(event);
    event.dataTransfer.dropEffect = position === null ? 'none' : 'copy';
    fileCursor.hidden = position === null;
    if (position !== null) {
      const coords = view.coordsAtPos(position);
      Object.assign(fileCursor.style, {
        left: `${coords.left}px`,
        top: `${coords.top}px`,
        height: `${Math.max(16, coords.bottom - coords.top)}px`,
      });
    }
  }
  function fileDrop(event) {
    if (!hasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    fileCursor.hidden = true;
    if (!editable || view.composing) return;
    const position = dropPosition(event);
    if (position === null) {
      onError('この位置には追加できません。本文の段落を選んでください。');
      return;
    }
    const files = droppedFiles(event.dataTransfer);
    if (files === null) {
      onError('フォルダは追加できません。ファイルを選んで追加してください。');
      return;
    }
    void onAddFiles(files, position);
  }
  const clearFileCursor = () => {
    fileCursor.hidden = true;
  };
  container.addEventListener('dragover', fileDragOver, true);
  container.addEventListener('drop', fileDrop, true);
  container.addEventListener('dragleave', clearFileCursor);
  window.addEventListener('dragend', clearFileCursor);
  window.addEventListener('drop', clearFileCursor);
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing && event.target.tagName === 'INPUT') {
      event.preventDefault();
      apply.click();
    }
  });

  const tableNext = (state, dispatch) => {
    if (!inTable(state)) return false;
    if (goToNextCell(1)(state, dispatch)) return true;
    return addRowAfter(
      state,
      dispatch &&
        ((tr) => {
          goToNextCell(1)(state.apply(tr), (move) => tr.setSelection(move.selection));
          dispatch(tr.scrollIntoView());
        }),
    );
  };
  const hardBreak = (state, dispatch) => {
    if (inTable(state)) return true;
    if (dispatch)
      dispatch(state.tr.replaceSelectionWith(schema.nodes.hard_break.create()).scrollIntoView());
    return true;
  };
  const codeEnd = (state) => {
    const { empty, $from } = state.selection;
    return (
      empty &&
      $from.parent.type === schema.nodes.code_block &&
      $from.parentOffset === $from.parent.content.size
    );
  };
  const inCode = (state) => {
    const { $from, $to } = state.selection;
    return $from.parent.type === schema.nodes.code_block && $from.sameParent($to);
  };
  const lineBefore = (state) => {
    const { $from } = state.selection;
    const before = $from.parent.textBetween(0, $from.parentOffset);
    return before.slice(before.lastIndexOf('\n') + 1);
  };
  const exitCodeOnEmptyLine = (state, dispatch) => {
    if (!codeEnd(state)) return false;
    const { $from } = state.selection;
    const text = $from.parent.textContent;
    const lineStart = text.lastIndexOf('\n');
    if (lineStart < 0 || text.slice(lineStart + 1).trim()) return false;
    return exitCode(
      state,
      dispatch &&
        ((tr) => {
          // 本文へ戻るための空行（引き継いだ字下げを含む）だけを除き、コードと新しい段落を一度に取り消せるようにする。
          dispatch(closeHistory(tr.delete($from.start() + lineStart, state.selection.from)));
        }),
    );
  };
  const codeNewline = (state, dispatch) => {
    if (!inCode(state)) return false;
    // Typora と同じく、改行後も今の行の字下げを引き継ぐ。
    if (dispatch)
      dispatch(state.tr.insertText(`\n${lineBefore(state).match(/^[ \t]*/)[0]}`).scrollIntoView());
    return true;
  };
  const indentCode = (outdent) => (state, dispatch) => {
    if (!inCode(state)) return false;
    if (!dispatch) return true;
    const { $from, from, to, empty } = state.selection;
    if (!outdent && empty) {
      dispatch(state.tr.insertText(codeIndent).scrollIntoView());
      return true;
    }
    // 範囲選択中の Tab と Shift+Tab は、選択した行をまとめて字下げ・字上げする。
    const start = $from.start(),
      text = $from.parent.textContent;
    const last = to > from && text[to - start - 1] === '\n' ? to - start - 1 : to - start;
    const lines = [];
    for (
      let offset = from === start ? 0 : text.lastIndexOf('\n', from - start - 1) + 1;
      offset <= last;
    ) {
      lines.push(offset);
      const next = text.indexOf('\n', offset);
      if (next < 0) break;
      offset = next + 1;
    }
    const tr = state.tr;
    for (const offset of lines.reverse()) {
      if (!outdent) {
        tr.insertText(codeIndent, start + offset);
        continue;
      }
      const width = text.slice(offset).match(/^(?:\t| {1,4})/)?.[0].length || 0;
      if (width) tr.delete(start + offset, start + offset + width);
    }
    if (tr.docChanged) dispatch(tr.scrollIntoView());
    return true;
  };
  const exitCodeDown = (state, dispatch) => {
    if (!codeEnd(state)) return false;
    const { $from } = state.selection;
    const next = $from.node(-1).maybeChild($from.indexAfter(-1));
    return (
      (!next || next.type === schema.nodes.code_block) &&
      exitCode(
        state,
        dispatch &&
          ((tr) => {
            dispatch(tr.setMeta(pendingParagraph, tr.selection.$from.before()));
          }),
      )
    );
  };
  const exitCodeUp = (state, dispatch) => {
    const { empty, $from } = state.selection;
    if (!empty || $from.parent.type !== schema.nodes.code_block || $from.parentOffset) return false;
    const index = $from.index(-1),
      previous = index ? $from.node(-1).child(index - 1) : null;
    if (
      (previous && previous.type !== schema.nodes.code_block) ||
      !$from.node(-1).canReplaceWith(index, index, schema.nodes.paragraph)
    )
      return false;
    if (dispatch) {
      const pos = $from.before(),
        tr = state.tr.insert(pos, schema.nodes.paragraph.create());
      dispatch(
        tr
          .setSelection(TextSelection.create(tr.doc, pos + 1))
          .setMeta(pendingParagraph, pos)
          .scrollIntoView(),
      );
    }
    return true;
  };
  const selectCode = (state, dispatch) => {
    if (!inCode(state)) return false;
    const { $from } = state.selection;
    if (dispatch)
      dispatch(state.tr.setSelection(TextSelection.create(state.doc, $from.start(), $from.end())));
    return true;
  };
  // Mac の Ctrl+A / Ctrl+E は baseKeymap でテキストブロックの先頭・末尾へ移るため、コード内では本文の段落と同じく今の行の先頭・末尾で止める。
  const codeLineSide = (side) => (state, dispatch) => {
    const { $from, $to } = state.selection,
      $pos = side < 0 ? $from : $to;
    if ($pos.parent.type !== schema.nodes.code_block) return false;
    const text = $pos.parent.textContent,
      end = text.indexOf('\n', $pos.parentOffset);
    const offset =
      side < 0
        ? text.slice(0, $pos.parentOffset).lastIndexOf('\n') + 1
        : end < 0
          ? text.length
          : end;
    if (dispatch)
      dispatch(
        state.tr
          .setSelection(TextSelection.create(state.doc, $pos.start() + offset))
          .scrollIntoView(),
      );
    return true;
  };
  const exitInlineCode = (state, dispatch) => {
    const { empty, $from } = state.selection;
    const code = schema.marks.code;
    if (
      !empty ||
      !code.isInSet(state.storedMarks || $from.marks()) ||
      code.isInSet($from.nodeAfter?.marks || [])
    )
      return false;
    if (dispatch) dispatch(state.tr.removeStoredMark(code));
    return true;
  };
  // Typora と同じく、記法だけの段落は Enter で確定してブロックへ変換する。表セル・リスト先頭など置けない位置では通常の Enter にする。
  const typedBlock = (state) => {
    const { empty, $from } = state.selection;
    if (
      !empty ||
      inTable(state) ||
      $from.parent.type !== schema.nodes.paragraph ||
      $from.parentOffset !== $from.parent.content.size
    )
      return null;
    let plain = true;
    $from.parent.forEach((child) => {
      if (!child.isText) plain = false;
    });
    return plain ? $from.parent.textContent : null;
  };
  const replaceParagraph = (state, dispatch, content, cursor) => {
    const { $from } = state.selection;
    if (!$from.node(-1).canReplace($from.index(-1), $from.indexAfter(-1), Fragment.from(content)))
      return false;
    if (dispatch) {
      const from = $from.before();
      // 変換を単独の履歴にし、取り消すと入力した記法の文字へ戻るようにする。
      const tr = closeHistory(state.tr).replaceWith(from, $from.after(), content);
      dispatch(tr.setSelection(TextSelection.create(tr.doc, from + cursor)).scrollIntoView());
    }
    return true;
  };
  const fenceEnter = (state, dispatch) => {
    const match = typedBlock(state)?.match(/^ {0,3}(?:`{3,}([^`]*)|~{3,}(.*))$/);
    return (
      Boolean(match) &&
      replaceParagraph(
        state,
        dispatch,
        schema.nodes.code_block.create({ params: (match[1] ?? match[2]).trim() }),
        1,
      )
    );
  };
  const ruleEnter = (state, dispatch) =>
    /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/.test(typedBlock(state) ?? '') &&
    replaceParagraph(
      state,
      dispatch,
      Fragment.fromArray([schema.nodes.horizontal_rule.create(), schema.nodes.paragraph.create()]),
      2,
    );
  const tableEnter = (state, dispatch) => {
    const text = typedBlock(state);
    if (!text || !/^\|.*\|[ \t]*$/.test(text)) return false;
    // 入力済みの書式を保ったまま、縦棒の間をセルにする。
    const paragraph = state.selection.$from.parent;
    const pipes = [...text.matchAll(/\|/g)].map((match) => match.index);
    const cells = pipes.slice(1).map((pipe, index) => {
      let from = pipes[index] + 1,
        to = pipe;
      while (from < to && /\s/.test(text[from])) from++;
      while (to > from && /\s/.test(text[to - 1])) to--;
      return paragraph.content.cut(from, to);
    });
    if (!cells.some((cell) => cell.size)) return false;
    const row = (type, contents) =>
      schema.nodes.table_row.create(
        null,
        contents.map((content) =>
          schema.nodes[type].create(null, schema.nodes.paragraph.create(null, content)),
        ),
      );
    const head = row('table_header', cells);
    return replaceParagraph(
      state,
      dispatch,
      schema.nodes.table.create(null, [
        head,
        row(
          'table_cell',
          cells.map(() => Fragment.empty),
        ),
      ]),
      head.nodeSize + 4,
    );
  };
  const backspaceBlock = (state, dispatch) => {
    const { empty, $from } = state.selection;
    const parent = $from.parent;
    if (!empty || $from.parentOffset !== 0) return false;
    // 空のコードは空の段落と同じく、前にブロックがあれば取り除いて前の行の末尾へ移る。
    if (parent.type === schema.nodes.code_block && !parent.content.size && $from.index(-1) > 0) {
      if (dispatch) {
        const tr = closeHistory(state.tr.delete($from.before(), $from.after()));
        dispatch(
          tr.setSelection(TextSelection.near(tr.doc.resolve($from.before()), -1)).scrollIntoView(),
        );
      }
      return true;
    }
    // Typora と同じく、見出しと、入れ物の先頭にある空のコードは先頭の Backspace で標準テキストへ戻す。
    if (
      parent.type !== schema.nodes.heading &&
      !(parent.type === schema.nodes.code_block && !parent.content.size)
    )
      return false;
    return setBlockType(schema.nodes.paragraph)(
      state,
      dispatch && ((tr) => dispatch(closeHistory(tr))),
    );
  };
  const escaped = ($pos) =>
    ($pos.parent.textBetween(0, $pos.parentOffset).match(/\\+$/)?.[0].length || 0) % 2 === 1;
  // 閉じていないバッククォートの後ろは、インラインコードの入力途中とみなして書式へ変換しない。
  const inOpenCode = ($pos) =>
    ($pos.parent.textBetween(0, $pos.parentOffset, null, '\ufffc').replace(/\\./g, '').match(/`/g)
      ?.length || 0) %
      2 ===
    1;
  const taskInput = new InputRule(
    /^\[([ xX])\]\s$/,
    (state, match, start, end) => {
      const $start = state.doc.resolve(start);
      if (
        $start.parent.type !== schema.nodes.paragraph ||
        $start.depth < 2 ||
        $start.index(-1) !== 0
      )
        return null;
      const item = $start.node(-1);
      if (item.type !== schema.nodes.list_item || item.attrs.checked !== null) return null;
      return state.tr
        .delete(start, end)
        .setNodeMarkup($start.before(-1), null, { checked: match[1] !== ' ' });
    },
    { inCodeMark: false },
  );
  const inlineCodeInput = new InputRule(
    /(^|[^`])`([^`\n]+)`$/,
    (state, match, start, end) => {
      start += match[1].length;
      const $start = state.doc.resolve(start);
      if (escaped($start) || !$start.parent.type.allowsMarkType(schema.marks.code)) return null;
      return state.tr
        .replaceWith(start, end, schema.text(match[2], [schema.marks.code.create()]))
        .removeStoredMark(schema.marks.code);
    },
    { inCodeMark: false },
  );
  const pairedCodeInput = new InputRule(
    /(^|[^`])`([^`\n]+)$/,
    (state, match, start, end) => {
      start += match[1].length;
      const $start = state.doc.resolve(start),
        $end = state.doc.resolve(end);
      const after = $end.parent.textBetween(
        $end.parentOffset,
        $end.parent.content.size,
        '\n',
        '\ufffc',
      );
      if (
        !after.startsWith('`') ||
        after.startsWith('``') ||
        escaped($start) ||
        !$start.parent.type.allowsMarkType(schema.marks.code)
      )
        return null;
      const mark = schema.marks.code.create();
      const tr = state.tr.replaceWith(start, end + 1, schema.text(match[2], [mark]));
      // 先に打った閉じ記号まで置換し、続けて入力する文字もコード内に置く。
      return tr
        .setSelection(TextSelection.create(tr.doc, start + match[2].length))
        .setStoredMarks([mark]);
    },
    { inCodeMark: false },
  );
  // 閉じ記号の入力で強調・取り消し線へ変換する。中の既存の書式は保つ。
  const markInput = (pattern, name, size) =>
    new InputRule(
      pattern,
      (state, match, start, end) => {
        start += match[1].length;
        const $start = state.doc.resolve(start),
          mark = schema.marks[name];
        if (escaped($start) || inOpenCode($start) || !$start.parent.type.allowsMarkType(mark))
          return null;
        // 入力中の最後の文字はまだ本文にない。日本語の変換確定後は閉じ記号まで本文にある。
        const contentEnd = start + match[0].length - match[1].length - size;
        return state.tr
          .delete(contentEnd, end)
          .addMark(start + size, contentEnd, mark.create())
          .delete(start, start + size)
          .removeStoredMark(mark);
      },
      { inCodeMark: false },
    );
  const linkInput = new InputRule(
    /(^|[^!])\[([^[\]\n]+)\]\(([^()\s]+)(?:\s+"([^"\n]*)")?\)$/,
    (state, match, start, end) => {
      start += match[1].length;
      const $start = state.doc.resolve(start),
        link = schema.marks.link;
      const href = markdownParser.normalizeLink(match[3]);
      if (
        escaped($start) ||
        inOpenCode($start) ||
        !$start.parent.type.allowsMarkType(link) ||
        !markdownParser.validateLink(href)
      )
        return null;
      const labelEnd = start + 1 + match[2].length;
      return state.tr
        .delete(labelEnd, end)
        .addMark(start + 1, labelEnd, link.create({ href, title: match[4] || null }))
        .delete(start, start + 1)
        .removeStoredMark(link);
    },
    { inCodeMark: false },
  );
  const imageInput = new InputRule(
    /!\[([^[\]\n]*)\]\(([^()\s]+)(?:\s+"([^"\n]*)")?\)$/,
    (state, match, start, end) => {
      const $start = state.doc.resolve(start);
      const src = markdownParser.normalizeLink(match[2]);
      if (
        escaped($start) ||
        inOpenCode($start) ||
        !markdownParser.validateLink(src) ||
        !$start.parent.canReplaceWith($start.index(), $start.index(), schema.nodes.image)
      )
        return null;
      return state.tr.replaceWith(
        start,
        end,
        schema.nodes.image.create({ src, alt: match[1], title: match[3] || null }),
      );
    },
    { inCodeMark: false },
  );
  const pickAssetsKey = () => {
    pickAssets();
    return true;
  };
  // Typora の既定のショートカット。ブラウザーが先に使うキー（Windows の Ctrl+T など）は割り当てない。
  const shortcuts = {
    'Mod-0': commands.paragraph,
    ...Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [`Mod-${i + 1}`, commands[`h${i + 1}`]]),
    ),
    'Shift-Mod-`': commands.code,
    ...(mac
      ? {
          'Mod-Alt-c': commands.codeBlock,
          'Mod-Alt-o': commands.ordered,
          'Mod-Alt-u': commands.bullet,
          'Mod-Alt-q': commands.quote,
          'Mod-Alt-t': commands.table,
          'Ctrl-Shift-`': commands.strike,
          'Ctrl-Mod-i': pickAssetsKey,
        }
      : {
          'Shift-Mod-k': commands.codeBlock,
          'Shift-Mod-[': commands.ordered,
          'Shift-Mod-]': commands.bullet,
          'Shift-Mod-q': commands.quote,
          'Alt-Shift-5': commands.strike,
          'Shift-Mod-i': pickAssetsKey,
        }),
  };
  view = new EditorView(container, {
    state: EditorState.create({
      schema,
      doc: initialDoc,
      plugins: [
        inputRules({
          rules: [
            wrappingInputRule(/^\s*>\s$/, schema.nodes.blockquote),
            wrappingInputRule(/^\s*([-+*])\s$/, schema.nodes.bullet_list, { tight: true }),
            wrappingInputRule(/^(\d+)\.\s$/, schema.nodes.ordered_list, (match) => ({
              order: Number(match[1]),
              tight: true,
            })),
            textblockTypeInputRule(/^(#{1,6})\s$/, schema.nodes.heading, (match) => ({
              level: match[1].length,
            })),
            taskInput,
            inlineCodeInput,
            pairedCodeInput,
            imageInput,
            linkInput,
            markInput(/(^|[^*])\*\*([^*\s](?:[^*]*[^*\s])?)\*\*$/, 'strong', 2),
            markInput(/(^|[^_\p{L}\p{N}])__([^_\s](?:[^_]*[^_\s])?)__$/u, 'strong', 2),
            markInput(/(^|[^*])\*([^*\s](?:[^*]*[^*\s])?)\*$/, 'em', 1),
            markInput(/(^|[^_\p{L}\p{N}])_([^_\s](?:[^_]*[^_\s])?)_$/u, 'em', 1),
            markInput(/(^|[^~])~~([^~\s](?:[^~]*[^~\s])?)~~$/, 'strike', 2),
          ],
        }),
        // prosemirror-keymap は Shift 付きの文字キーに合う割り当てがないと Shift なしでも探すため、Ctrl+Shift+K が先に Mod-k（リンク）にならないよう Typora のショートカットを先に置く。
        history(),
        keymap(shortcuts),
        keymap({
          'Mod-z': undo,
          'Shift-Mod-z': redo,
          'Mod-y': redo,
          'Mod-b': commands.strong,
          'Mod-i': commands.em,
          'Mod-`': commands.code,
          'Mod-a': selectCode,
          ...(mac ? { 'Ctrl-a': codeLineSide(-1), 'Ctrl-e': codeLineSide(1) } : {}),
          'Mod-k': () => {
            openLinkDialog();
            return true;
          },
          Backspace: chainCommands(undoInputRule, backspaceBlock),
          Enter: chainCommands(
            tableNext,
            fenceEnter,
            ruleEnter,
            tableEnter,
            exitCodeOnEmptyLine,
            codeNewline,
            (state, dispatch) =>
              splitListItem(schema.nodes.list_item, {
                checked: ancestor(state, 'list_item')?.node.attrs.checked == null ? null : false,
              })(state, dispatch),
          ),
          ArrowDown: exitCodeDown,
          ArrowUp: exitCodeUp,
          ArrowRight: exitInlineCode,
          Tab: chainCommands(indentCode(false), tableNext, sinkListItem(schema.nodes.list_item)),
          'Shift-Tab': chainCommands(
            indentCode(true),
            (state, dispatch) => inTable(state) && goToNextCell(-1)(state, dispatch),
            liftListItem(schema.nodes.list_item),
          ),
          'Shift-Enter': chainCommands(exitCode, hardBreak),
          'Mod-Enter': exitCode,
        }),
        keymap(baseKeymap),
        gapCursor(),
        dropCursor(),
        tableEditing(),
        new Plugin({
          key: pendingParagraph,
          state: {
            init: () => null,
            // 入力・改行・書式変更など本文を変えたら、通常の段落として残す。
            apply: (tr, pos) => {
              const meta = tr.getMeta(pendingParagraph);
              return meta !== undefined ? meta : tr.docChanged ? null : pos;
            },
          },
          appendTransaction(_transactions, _old, state) {
            const pos = pendingParagraph.getState(state);
            const { from, to } = state.selection;
            if (pos == null || (from === pos + 1 && to === pos + 1)) return null;
            // 何も入力せずに離れたら、矢印キーで作った空段落を取り除く。履歴には残さない。
            return state.tr
              .delete(pos, pos + state.doc.nodeAt(pos).nodeSize)
              .setMeta(pendingParagraph, null)
              .setMeta('addToHistory', false);
          },
        }),
        new Plugin({
          appendTransaction(transactions, _old, state) {
            if (!transactions.some((tr) => tr.docChanged)) return null;
            const tr = state.tr;
            // GFMの先頭行は常にヘッダー。列の配置を新規行にも引き継ぐ。
            state.doc.descendants((table, tablePos) => {
              if (table.type !== schema.nodes.table) return;
              table.forEach((row, rowOffset, rowIndex) =>
                row.forEach((cell, cellOffset, column) => {
                  const type = rowIndex === 0 ? schema.nodes.table_header : schema.nodes.table_cell;
                  const align = table.firstChild.child(column).attrs.align;
                  if (cell.type !== type || cell.attrs.align !== align)
                    tr.setNodeMarkup(tablePos + rowOffset + cellOffset + 2, type, {
                      ...cell.attrs,
                      align,
                    });
                }),
              );
            });
            return tr.docChanged ? tr : null;
          },
        }),
      ],
    }),
    attributes: {
      class: 'markdown rich-document',
      role: 'textbox',
      'aria-label': 'ノート本文',
      'aria-multiline': 'true',
      spellcheck: 'false',
    },
    editable: () => editable,
    nodeViews: { image: imageView, list_item: listItemView, code_block: codeBlockView },
    dispatchTransaction(transaction) {
      if (disposed || (!editable && transaction.docChanged && !replacing && !insertingAssets))
        return;
      const previous = view.state.doc;
      view.updateState(view.state.applyTransaction(transaction).state);
      if (!replacing && !previous.eq(view.state.doc)) {
        currentSource = getMarkdown();
        onChange(currentSource);
      }
      updateToolbar();
    },
    handleDOMEvents: {
      compositionstart() {
        onComposition(true);
        return false;
      },
      compositionend() {
        window.setTimeout(() => {
          if (!disposed) onComposition(false);
        }, 0);
        return false;
      },
      click(_view, event) {
        const link = event.target.closest('[data-md-link]');
        if (!link) return false;
        if (event.metaKey || event.ctrlKey) {
          event.preventDefault();
          openReference(link.dataset.mdLink);
          return true;
        }
        return false;
      },
      keydown(_view, event) {
        if (event.target.matches('[data-md-link]') && event.key === 'Enter') {
          event.preventDefault();
          openReference(event.target.dataset.mdLink);
          return true;
        }
        return false;
      },
    },
    clipboardTextParser(text, _$context, plain) {
      // Typora と同じく、文字だけの貼り付けは Markdown として書式に変換する。Shift付きの貼り付けは文字のまま。
      if (plain) return null;
      try {
        return Slice.maxOpen(parseMarkdown(text.replace(/\r\n?/g, '\n')).content);
      } catch {
        return null;
      }
    },
    handlePaste(_view, event, slice) {
      if (!editable) return true;
      // 通常はスキーマで許可した書式を貼る。GFMで表現できないセル内容・結合セルだけは拒否する。
      let unsupportedTable = false;
      slice.content.descendants((node) => {
        if (
          ['table_cell', 'table_header'].includes(node.type.name) &&
          (node.attrs.colspan !== 1 || node.attrs.rowspan !== 1)
        )
          unsupportedTable = true;
        if (
          inTable(view.state) &&
          (node.type === schema.nodes.hard_break || node.type === schema.nodes.table)
        )
          unsupportedTable = true;
      });
      if (unsupportedTable) {
        onError('この表の貼り付けには対応していません。Markdownソースから調整してください。');
        return true;
      }
      if (inTable(view.state) && /[\r\n]/.test(event.clipboardData?.getData('text/plain') || '')) {
        onError('セルには1行ずつ貼り付けてください。');
        return true;
      }
      return false;
    },
  });
  function getMarkdown() {
    const checkpoint = [...checkpoints, saved, original].find((entry) =>
      entry.doc.eq(view.state.doc),
    );
    if (checkpoint) return checkpoint.text;
    const text = serializeMarkdown(view.state.doc);
    return text && !text.endsWith('\n') ? `${text}\n` : text;
  }
  updateToolbar();
  return {
    get view() {
      return view;
    },
    getMarkdown,
    setPath(nextPath) {
      path = nextPath;
    },
    canInsertAssets,
    insertAssets,
    setMarkdown(text) {
      if (text === currentSource) return;
      const doc = parseMarkdown(text);
      remember(text, doc);
      currentSource = text;
      if (doc.eq(view.state.doc)) return;
      replacing = true;
      try {
        const tr = closeHistory(view.state.tr).replaceWith(
          0,
          view.state.doc.content.size,
          doc.content,
        );
        view.dispatch(tr.setSelection(TextSelection.atStart(tr.doc)));
      } finally {
        replacing = false;
      }
    },
    markSaved(text) {
      saved = { text, doc: view.state.doc };
      remember(text, view.state.doc);
      currentSource = text;
    },
    setEditable(value) {
      if (editable === value) return;
      editable = value;
      view.setProps({ editable: () => editable });
      updateToolbar();
    },
    focus() {
      view.focus();
    },
    anchor,
    run,
    dispose() {
      disposed = true;
      view.destroy();
      toolbar.replaceChildren();
      dialog.remove();
      fileCursor.remove();
      container.removeEventListener('dragover', fileDragOver, true);
      container.removeEventListener('drop', fileDrop, true);
      container.removeEventListener('dragleave', clearFileCursor);
      window.removeEventListener('dragend', clearFileCursor);
      window.removeEventListener('drop', clearFileCursor);
    },
  };
}
