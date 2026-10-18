// ローカルノート。PC のフォルダにある Markdown を閲覧・編集し、元のファイルに保存する。
// 振る舞い（app.js・rich-editor.js など）は旧 note-html からテストごと移した。画面の骨組み（markup.js）を toolbox の枠の中に置き、
// Preact には一度だけ描かせて、以後の書き換えは app.js に任せる。
import 'prosemirror-view/style/prosemirror.css';
import 'prosemirror-gapcursor/style/gapcursor.css';
import 'prosemirror-tables/style/tables.css';
import './document.css';
import './style.css';
import { signal } from '@preact/signals';
import { Component } from 'preact';
import { useEffect } from 'preact/hooks';
import { ToolFrame } from '../../app/frame';
import type { Incoming, ToolDefinition, ToolStatus } from '../../app/tool';
import { canUseFolders } from '../../lib/files';
import { useDropZone } from '../../ui/drop';
import { createApp, type NoteApp } from './app.js';
import documentStyles from './document.css?raw';
import { BODY, DIALOGS, HEADER_CENTER, HEADER_END, ICONS } from './markup.js';
import icon from './icon.png';

/** 骨組みの HTML を一度だけ描き、以後は描き直さない（中身は app.js が書き換える）。 */
class Static extends Component<{ html: string }> {
  shouldComponentUpdate() {
    return false;
  }
  render() {
    return <div dangerouslySetInnerHTML={{ __html: this.props.html }} />;
  }
}

/** 保存・添付・ファイル操作の途中は、閉じると失う。 */
const BUSY_GUARDS = ['saving', 'adding', 'managing'];

function create() {
  const status = signal<ToolStatus>({});
  let app: NoteApp | null = null;
  let active = false;
  /** 骨組みを描く前に受け取ったフォルダ。 */
  let pendingFolder: FileSystemDirectoryHandle | null = null;

  function View({ active: visible }: { active: boolean }) {
    active = visible;
    useEffect(() => {
      const created = createApp(window, {
        documentStyles,
        isActive: () => active,
        onStatus: ({ root, path, dirty, busy }) => {
          const name = path.split('/').at(-1) ?? '';
          status.value = {
            title: name || undefined,
            summary: path ? `${root} / ${path}` : root || undefined,
            unsaved: dirty,
            guard: dirty || BUSY_GUARDS.includes(busy),
          };
        },
      });
      app = created;
      if (pendingFolder) {
        const folder = pendingFolder;
        pendingFolder = null;
        void created.ready.then(() => created.openFolderHandle(folder));
      }
      return () => {
        created.dispose();
        if (app === created) app = null;
      };
    }, []);
    // 置いたフォルダを開く。本文への画像・ファイルの追加は rich-editor.js が先に受け取る。
    const zone = useDropZone<HTMLDivElement>({
      enabled: () => active && canUseFolders() && !document.querySelector('dialog[open]'),
      label: () => 'ここにフォルダを置いて開く',
      onDrop: (dropped) => {
        if (dropped.folder) void app?.openFolderHandle(dropped.folder);
      },
    });
    return (
      <ToolFrame
        class="nh"
        center={<Static html={HEADER_CENTER} />}
        actions={<Static html={HEADER_END} />}
      >
        <div class="nh-body" ref={zone}>
          <Static html={ICONS + BODY + DIALOGS} />
        </div>
      </ToolFrame>
    );
  }

  return {
    View,
    status,
    async receive(intent: string, input: Incoming) {
      if (intent !== 'open-folder' || input.kind !== 'folder') return;
      if (app) {
        await app.ready;
        await app.openFolderHandle(input.folder);
      } else pendingFolder = input.folder;
    },
  };
}

export const noteHtml: ToolDefinition = {
  id: 'note-html',
  name: 'ローカルノート',
  description: 'PCのフォルダにあるMarkdownを閲覧・編集し、元のファイルに保存できます。',
  icon,
  intents: [
    {
      id: 'open-folder',
      label: 'ノートとして開く',
      detail: 'ローカルノート：このフォルダの Markdown を閲覧・編集する',
      icon: 'file-text',
      accepts: (input) => input.kind === 'folder' && canUseFolders(),
      // フォルダはドラッグ中に種類（MIME）が空になる。
      mayAccept: (hint) => hint.count === 1 && hint.types[0] === '' && canUseFolders(),
    },
  ],
  create,
};
