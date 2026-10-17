import { signal } from '@preact/signals';
import type { ToolDefinition } from '../../app/tool';
import { ToolFrame } from '../../app/frame';
import icon from './icon.png';

export const noteHtml: ToolDefinition = {
  id: 'note-html',
  name: 'ローカルノート',
  description: 'PCのフォルダにあるMarkdownを閲覧・編集し、元のファイルに保存できます。',
  icon,
  intents: [],
  create: () => ({
    status: signal({}),
    View: () => <ToolFrame>準備中</ToolFrame>,
  }),
};
