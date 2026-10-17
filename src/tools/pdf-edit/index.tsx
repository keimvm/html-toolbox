import { signal } from '@preact/signals';
import type { ToolDefinition } from '../../app/tool';
import { ToolFrame } from '../../app/frame';
import icon from './icon.png';

export const pdfEdit: ToolDefinition = {
  id: 'pdf-edit',
  name: 'PDF編集',
  description: 'PDFのページの削除・並べ替え・回転・結合と、画像・文字の取り出しができます。',
  icon,
  intents: [],
  create: () => ({
    status: signal({}),
    View: () => <ToolFrame>準備中</ToolFrame>,
  }),
};
