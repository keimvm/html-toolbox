import { test } from 'vitest';
import assert from 'node:assert/strict';
import { TextSelection } from 'prosemirror-state';
import { assetName, assetReference, saveAssets, createAssetOpener, previewMime } from './assets.js';
import { resolveReference } from './core.js';
import { parseMarkdown } from './markdown-document.js';
import { renderMarkdown } from './markdown.js';
import {
  setup,
  MemoryDirectory,
  MemoryFile,
  bytes,
  tick,
  failure,
} from './helpers.test-support.js';

const file = (name, content = 'data', type = '') => new File([content], name, { type });
async function open(source = '前後', path = 'note.md', extras = []) {
  const note = new MemoryFile(path.split('/').at(-1), source);
  const root = new MemoryDirectory('root', extras);
  let parent = root;
  for (const name of path.split('/').slice(0, -1)) {
    const child = new MemoryDirectory(name);
    parent.children.set(name, child);
    parent = child;
  }
  parent.children.set(note.name, note);
  root.children.set('other.md', new MemoryFile('other.md', '別の本文'));
  const context = await setup(root);
  await context.app.openNote(path);
  return {
    ...context,
    root,
    note,
    editor: context.app.richEditor,
    view: context.app.richEditor.view,
  };
}
function references(doc) {
  const refs = [];
  doc.descendants((node) => {
    if (node.type.name === 'image') refs.push(node.attrs.src);
    for (const mark of node.marks) if (mark.type.name === 'link') refs.push(mark.attrs.href);
  });
  return refs;
}
function drag(window, target, type, files, extra = {}) {
  const event = new window.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: 30,
    clientY: 40,
  });
  Object.defineProperty(event, 'dataTransfer', {
    value: {
      files,
      types: ['Files'],
      items: files.map(() => ({ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: false }) })),
      ...extra,
    },
  });
  target.dispatchEvent(event);
  return event;
}

test('初回だけ.assetsを作成し、ファイルのバイト列をそのまま保存する', async () => {
  const root = new MemoryDirectory('root');
  const content = new Uint8Array([0, 255, 12, 137]);
  const first = await saveAssets(root, 'note.md', [file('画像.png', content)], {
    createId: () => 'first',
  });
  const assets = root.children.get('.assets');
  assert.deepEqual(assets.children.get('画像-first.png').bytes, content);
  assert.equal(first.added[0].image, true);
  assert.equal(first.failed.length, 0);
  await saveAssets(root, 'note.md', [file('資料.pdf')], { createId: () => 'second' });
  assert.equal(root.children.get('.assets'), assets);
  assert.equal(assets.children.size, 2);
});

test('衝突時は再採番し、同名のファイルやフォルダを変更しない', async () => {
  const existing = new MemoryFile('a-same.pdf', 'original');
  const assets = new MemoryDirectory('.assets', [existing, new MemoryDirectory('a-dir.pdf')]);
  const ids = ['same', 'dir', 'new'];
  const result = await saveAssets(new MemoryDirectory('root', [assets]), 'n.md', [file('a.pdf')], {
    createId: () => ids.shift(),
  });
  assert.equal(result.added[0].path, '.assets/a-new.pdf');
  assert.equal(existing.writes, 0);
  assert.deepEqual(existing.bytes, bytes('original'));
});

test('名前と相対参照は長さ・日本語・空白・括弧・パーセントを扱う', () => {
  const name = assetName('文書 # [%](1)?:*.pdf', 'id');
  assert.ok(!/[?:*]/.test(name));
  assert.ok(bytes(assetName('あ'.repeat(200) + '.png', 'id')).length < 255);
  for (const path of ['note.md', '日本語/仕事/note.md', 'a/b/c/d.md']) {
    const href = assetReference(path, name);
    assert.equal(resolveReference(href, path).path, `.assets/${name}`);
    assert.equal(resolveReference(href, path).kind, 'attachment');
    assert.ok(!/[ ()#]/.test(href));
  }
});

test('.assets内の.mdは添付、画像は画像、ルート外は参照不可に分類する', () => {
  assert.equal(resolveReference('../.assets/file.md', 'sub/n.md').kind, 'attachment');
  assert.equal(resolveReference('.assets/file.PNG', 'n.md').kind, 'image');
  for (const raw of [
    '../.assets/a.pdf',
    '.assets/../../outside.pdf',
    '.assets/%2e%2e/%2e%2e/a.pdf',
    '.assets/a%00.pdf',
    'file:///.assets/a.pdf',
  ])
    assert.equal(resolveReference(raw, 'n.md').kind, 'blocked');
  assert.equal(resolveReference('ordinary.pdf', 'n.md').kind, 'blocked');
});

test('.assetsが通常ファイルの場合とフォルダ作成拒否では本文を変えない', async () => {
  for (const mode of ['file', 'denied']) {
    const context = await open(
      '元の本文',
      'note.md',
      mode === 'file' ? [new MemoryFile('.assets', 'keep')] : [],
    );
    if (mode === 'denied') context.root.createDirectoryError = 'NotAllowedError';
    await context.app.addFiles([file('x.pdf')], 1);
    assert.equal(context.app.state.draft, '元の本文');
    assert.equal(context.app.dirty(), false);
    assert.equal(context.$('notice').hidden, false);
    if (mode === 'file')
      assert.deepEqual(context.root.children.get('.assets').bytes, bytes('keep'));
  }
});

test('複数追加は位置と順序を保ち、一回のUndoで参照だけを戻す', async () => {
  const { app, root, editor, view, note } = await open();
  await app.addFiles([file('画像.png'), file('資料.pdf'), file('別.md')], 2);
  const refs = references(view.state.doc);
  assert.equal(refs.length, 3);
  assert.match(refs[0], /\.png$/);
  assert.match(refs[1], /\.pdf$/);
  assert.match(refs[2], /\.md$/);
  assert.ok(app.state.draft.startsWith('前!['));
  assert.ok(app.state.draft.trimEnd().endsWith('後'));
  assert.equal(note.writes, 0);
  assert.equal(root.children.get('.assets').children.size, 3);
  const added = app.state.draft;
  editor.run('undo');
  assert.equal(app.state.draft, '前後');
  assert.equal(root.children.get('.assets').children.size, 3);
  editor.run('redo');
  assert.equal(app.state.draft, added);
  view.dispatch(view.state.tr.insertText('追記'));
  editor.run('undo');
  assert.equal(app.state.draft, added);
});

test('表・リスト・ブロック境界へ挿入でき、ソース往復と保存後も参照を解決できる', async () => {
  for (const [source, inText] of [
    ['| a |\n| --- |\n| CELL |', 'CELL'],
    ['- ITEM', 'ITEM'],
    ['本文\n\n次', null],
  ]) {
    const { app, root, view, $ } = await open(source, '仕事/深い階層/note.md');
    let pos = 0;
    if (inText)
      view.state.doc.descendants((node, at) => {
        if (node.isText && node.text === inText) pos = at;
      });
    await app.addFiles([file('資料 [1].pdf'), file('画 #%.PNG')], pos);
    const refs = references(view.state.doc);
    assert.equal(refs.length, 2);
    for (const ref of refs) {
      assert.ok(ref.startsWith('../../.assets/'));
      assert.ok(
        root.children
          .get('.assets')
          .children.has(resolveReference(ref, app.state.current.path).path.split('/').at(-1)),
      );
    }
    const draft = app.state.draft;
    $('source-mode').click();
    $('source-mode').click();
    assert.equal(app.state.draft, draft);
    assert.deepEqual(references(parseMarkdown(draft)), refs);
    assert.ok(await app.save());
    await app.reload();
    assert.deepEqual(references(app.richEditor.view.state.doc), refs);
    assert.equal($('tree').querySelector('[data-directory=".assets"]'), null);
  }
});

test('本文を破棄して切り替えても添付の実体を残す', async () => {
  const { app, root, choose } = await open();
  await app.addFiles([file('資料.pdf')], 1);
  const switching = app.openNote('other.md');
  await tick();
  choose('discard');
  await switching;
  assert.equal(root.children.get('.assets').children.size, 1);
  await app.openNote('note.md');
  assert.equal(app.state.draft, '前後');
});

test('権限は必要時だけクリックから要求し、拒否・取消では何も作成しない', async () => {
  for (const outcome of ['granted', 'denied', 'cancel', 'throw']) {
    const { app, root, choose, $ } = await open();
    root.permission = 'prompt';
    let calls = 0;
    root.requestPermission = (options) => {
      assert.deepEqual(options, { mode: 'readwrite' });
      calls++;
      return outcome === 'throw'
        ? Promise.reject(failure('SecurityError'))
        : Promise.resolve(outcome);
    };
    const pending = app.addFiles([file('a.pdf')], 1);
    await tick();
    assert.equal(calls, 0);
    assert.equal($('confirm-dialog').open, true);
    choose(outcome === 'cancel' ? 'cancel' : 'allow-assets');
    assert.equal(calls, outcome === 'cancel' ? 0 : 1);
    await pending;
    assert.equal(root.children.has('.assets'), outcome === 'granted');
    assert.equal(app.state.busy, '');
    if (outcome !== 'granted') assert.equal(app.state.draft, '前後');
  }
});

test('一部のwrite/close失敗では成功分だけを挿入し、途中ファイルを削除する', async () => {
  for (const error of ['createError', 'writeError', 'closeError']) {
    const assets = new MemoryDirectory('.assets');
    const created = [];
    assets.onCreateFile = (handle) => {
      if (handle.name.startsWith('bad-')) handle[error] = 'NotAllowedError';
      created.push(handle);
    };
    const { app, $, view } = await open('保持', 'note.md', [assets]);
    await app.addFiles([file('ok.pdf'), file('bad.pdf'), file('last.pdf')], 1);
    assert.equal(assets.children.size, 2);
    assert.equal(references(view.state.doc).length, 2);
    assert.match($('notice-text').textContent, /2件追加.*bad.pdf/);
    assert.equal(created[1].aborted, error === 'createError' ? 0 : 1);
    assert.ok(app.state.draft.includes('保持'));
  }
});

test('途中ファイルを消せない場合は残存パスを案内し、リンクを挿入しない', async () => {
  const assets = new MemoryDirectory('.assets');
  assets.removeError = 'NotAllowedError';
  assets.onCreateFile = (handle) => {
    handle.closeError = 'NotAllowedError';
  };
  const { app, $ } = await open('維持', 'note.md', [assets]);
  await app.addFiles([file('bad.pdf')], 1);
  assert.equal(app.state.draft, '維持');
  assert.match($('notice-text').textContent, /作成途中.*\.assets\//);
  assert.equal(assets.children.size, 1);
});

test('追加中の編集・保存・切り替え・連続追加を停止し、成功前は本文に参照を置かない', async () => {
  const assets = new MemoryDirectory('.assets');
  let release;
  assets.onCreateFile = (handle) => {
    handle.writeGate = new Promise((resolve) => {
      release = resolve;
    });
  };
  const { app, view, $, window } = await open('本文', 'note.md', [assets]);
  const pending = app.addFiles([file('a.pdf')], 1);
  await tick();
  assert.equal($('save-status').textContent, 'ファイルを追加中…');
  assert.equal(view.editable, false);
  view.dispatch(view.state.tr.insertText('禁止'));
  await app.addFiles([file('b.pdf')], 1);
  assert.equal(await app.save(), false);
  await app.openNote('other.md');
  app.toggleSource();
  assert.equal(app.state.current.path, 'note.md');
  assert.equal(app.state.mode, 'rich');
  assert.equal(app.state.draft, '本文');
  const unload = new window.Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  assert.ok(unload.defaultPrevented);
  release();
  await pending;
  assert.equal(references(view.state.doc).length, 1);
  assert.equal(assets.children.size, 1);
});

test('コード・閲覧専用・ソース・IME・ノート未選択ではファイルを書かない', async () => {
  for (const mode of ['code', 'readonly', 'source', 'ime', 'empty']) {
    const { app, root, window, $ } = await open(
      mode === 'code' ? '```\ncode\n```' : mode === 'readonly' ? 'a\r\nb\n' : '本文',
    );
    if (mode === 'source') app.toggleSource();
    if (mode === 'ime')
      $('rich-editor')
        .querySelector('.ProseMirror')
        .dispatchEvent(new window.Event('compositionstart', { bubbles: true }));
    if (mode === 'empty') app.state.current = null;
    await app.addFiles([file('a.pdf')], 1);
    assert.equal(root.children.has('.assets'), false);
  }
});

test('ファイルドロップは座標から挿入し、通常のドラッグには介入しない', async () => {
  const { app, view, window, $ } = await open();
  let received;
  view.posAtCoords = (coords) => {
    received = coords;
    return { pos: 2 };
  };
  view.coordsAtPos = () => ({ left: 30, top: 40, bottom: 60 });
  const over = drag(window, view.dom, 'dragover', [file('a.pdf')]);
  assert.ok(over.defaultPrevented);
  assert.equal(over.dataTransfer.dropEffect, 'copy');
  assert.equal(window.document.querySelector('.asset-drop-cursor').hidden, false);
  const dropped = drag(window, view.dom, 'drop', [file('a.pdf')]);
  assert.ok(dropped.defaultPrevented);
  await tick();
  assert.deepEqual(received, { left: 30, top: 40 });
  assert.ok(
    app.state.draft.startsWith('前['),
    JSON.stringify({
      draft: app.state.draft,
      busy: app.state.busy,
      notice: $('notice-text').textContent,
    }),
  );
  assert.equal(window.document.querySelector('.asset-drop-cursor').hidden, true);
  const plain = drag(window, $('editor'), 'drop', [], { types: ['text/plain'] });
  assert.equal(plain.defaultPrevented, false);
});

test('本文外のドロップは遷移を防ぎ、フォルダ・無効な位置では保存しない', async () => {
  const { root, view, window, $, app } = await open();
  for (const target of [window.document.body, $('tree'), $('editor')])
    assert.ok(drag(window, target, 'drop', [file('a.pdf')]).defaultPrevented);
  view.posAtCoords = () => ({ pos: 1 });
  drag(window, view.dom, 'drop', [], {
    items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) }],
  });
  assert.match($('notice-text').textContent, /フォルダは追加できません/);
  view.posAtCoords = () => null;
  drag(window, view.dom, 'drop', [file('a.pdf')]);
  assert.match($('notice-text').textContent, /この位置/);
  await tick();
  assert.equal(root.children.has('.assets'), false);
  assert.equal(app.dirty(), false);
});

test('メニューのファイル選択は選択前のカーソル位置へ挿入する', async () => {
  const { view, $, window, app } = await open();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
  const input = $('format-toolbar').querySelector('input[type=file]');
  let opened = 0;
  input.click = () => {
    opened++;
  };
  $('format-toolbar').querySelector('[data-command=assets]').click();
  assert.equal(opened, 1);
  Object.defineProperty(input, 'files', { value: [file('選択.pdf')] });
  input.dispatchEvent(new window.Event('change'));
  await tick();
  assert.ok(app.state.draft.startsWith('前['));
});

test('添付リンクを編集でき、読み取り専用レンダラーでも開ける', async () => {
  const { app, view, $, window } = await open('参照');
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
  $('format-toolbar').querySelector('[data-command=link]').click();
  const dialog = window.document.querySelector('.link-dialog');
  dialog.querySelectorAll('input')[1].value = '.assets/添付.pdf';
  dialog.querySelector('.tb-primary').click();
  assert.match(app.state.draft, /\.assets/);
  let opened;
  const container = window.document.createElement('article');
  const renderer = renderMarkdown({
    document: window.document,
    container,
    source: app.state.draft,
    path: 'note.md',
    root: new MemoryDirectory('root'),
    onError() {},
    onNote() {},
    onAsset: (path) => {
      opened = path;
    },
  });
  container.querySelector('a').click();
  assert.equal(opened, '.assets/添付.pdf');
  renderer.dispose();
});

test('添付プレビューは取得前にタブを確保し、閉じた後にBlob URLを解放する', async () => {
  const { window } = await open();
  const calls = [],
    urls = [],
    revoked = [],
    timers = [];
  const popup = {
    opener: 'parent',
    document: {},
    closed: false,
    close() {
      this.closed = true;
    },
    location: {
      replace(url) {
        calls.push('navigate');
        urls.push(url);
      },
    },
  };
  window.open = () => {
    calls.push('open');
    return popup;
  };
  window.URL.createObjectURL = (blob) => {
    assert.equal(blob.type, 'application/pdf');
    return 'blob:preview';
  };
  window.URL.revokeObjectURL = (url) => revoked.push(url);
  window.setInterval = (callback) => {
    timers.push(callback);
    return 1;
  };
  const attached = new MemoryFile('a.pdf', '%PDF');
  attached.getFile = async () => {
    calls.push('read');
    return file('a.pdf', '%PDF', 'text/html');
  };
  let notice;
  const opener = createAssetOpener(window, (...args) => {
    notice = args;
  });
  await opener.open(
    new MemoryDirectory('root', [new MemoryDirectory('.assets', [attached])]),
    '.assets/a.pdf',
  );
  assert.deepEqual(calls, ['open', 'read', 'navigate']);
  assert.equal(popup.opener, null);
  assert.equal(notice[1], 'ダウンロード');
  assert.deepEqual(revoked, []);
  popup.closed = true;
  timers[0]();
  assert.deepEqual(revoked, ['blob:preview']);
  opener.dispose();
});

test('別タブ拒否時のダウンロードとHTML・SVGの強制ダウンロード', async () => {
  const { window } = await open();
  let opens = 0;
  const downloads = [],
    revoked = [],
    timers = [];
  window.open = () => {
    opens++;
    return null;
  };
  window.URL.createObjectURL = (blob) => {
    assert.equal(blob.type, 'application/octet-stream');
    return `blob:${downloads.length}`;
  };
  window.URL.revokeObjectURL = (url) => revoked.push(url);
  window.setTimeout = (callback) => {
    timers.push(callback);
    return timers.length;
  };
  window.HTMLAnchorElement.prototype.click = function () {
    downloads.push(this.download);
  };
  let notice;
  const opener = createAssetOpener(window, (...args) => {
    notice = args;
  });
  const assets = new MemoryDirectory(
    '.assets',
    ['a.pdf', 'a.html', 'a.svg'].map((name) => new MemoryFile(name, '<script>bad</script>')),
  );
  const root = new MemoryDirectory('root', [assets]);
  await opener.open(root, '.assets/a.pdf');
  assert.equal(downloads.length, 0);
  notice[2]();
  await opener.open(root, '.assets/a.html');
  await opener.open(root, '.assets/a.svg');
  assert.equal(opens, 1);
  assert.deepEqual(downloads, ['a.pdf', 'a.html', 'a.svg']);
  assert.equal(previewMime('x.HTML'), '');
  assert.equal(previewMime('x.svg'), '');
  assert.equal(previewMime('x.mp4'), 'video/mp4');
  assert.equal(previewMime('x.txt'), 'text/plain;charset=utf-8');
  timers[0]();
  opener.dispose();
  assert.equal(revoked.length, 3);
});

test('添付の取得失敗・破棄後の遅い取得では空タブを閉じる', async () => {
  for (const disposeEarly of [false, true]) {
    const { window } = await open();
    const popup = {
      document: {},
      closed: false,
      close() {
        this.closed = true;
      },
    };
    window.open = () => popup;
    const attached = new MemoryFile('a.pdf');
    let release;
    if (disposeEarly)
      attached.readGate = new Promise((resolve) => {
        release = resolve;
      });
    else attached.readError = 'NotFoundError';
    let notice;
    const opener = createAssetOpener(window, (message) => {
      notice = message;
    });
    const pending = opener.open(
      new MemoryDirectory('root', [new MemoryDirectory('.assets', [attached])]),
      '.assets/a.pdf',
    );
    if (disposeEarly) {
      await tick();
      opener.dispose();
      release();
    }
    await pending;
    assert.equal(popup.closed, true);
    if (!disposeEarly) assert.match(notice, /取得できません/);
    opener.dispose();
  }
});
