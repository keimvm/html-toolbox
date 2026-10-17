import { signal } from '@preact/signals';
import type { ToolDefinition } from '../../app/tool';
import { ToolFrame } from '../../app/frame';
import icon from './icon.png';

export const mojicodeConverter: ToolDefinition = {
  id: 'mojicode-converter',
  name: '文字コード変換',
  description: '文字とコードの値（Unicode・UTF-8・UTF-16・Shift_JIS）を、どちら向きにも変換して確かめられます。',
  icon,
  intents: [],
  create: () => ({
    status: signal({}),
    View: () => <ToolFrame>準備中</ToolFrame>,
  }),
};
