import { signal } from '@preact/signals';
import type { ToolDefinition } from '../../app/tool';
import { ToolFrame } from '../../app/frame';
import icon from './icon.png';

export const promptLibrary: ToolDefinition = {
  id: 'prompt-library',
  name: 'プロンプト集',
  description: 'よく使うAIチャットのプロンプトをPCのフォルダに保存し、タグで絞り込んでコピーできます。',
  icon,
  intents: [],
  create: () => ({
    status: signal({}),
    View: () => <ToolFrame>準備中</ToolFrame>,
  }),
};
