import { signal } from '@preact/signals';
import type { ToolDefinition } from '../../app/tool';
import { ToolFrame } from '../../app/frame';
import icon from './icon.png';

export const typingGame: ToolDefinition = {
  id: 'typing-game',
  name: 'タイピングゲーム',
  description: '好きな文章を貼り付けて日本語入力で打ち、かかった時間と見本と違う箇所を確かめられます。',
  icon,
  intents: [],
  create: () => ({
    status: signal({}),
    View: () => <ToolFrame>準備中</ToolFrame>,
  }),
};
