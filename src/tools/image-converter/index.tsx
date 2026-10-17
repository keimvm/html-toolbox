import { signal } from '@preact/signals';
import type { ToolDefinition } from '../../app/tool';
import { ToolFrame } from '../../app/frame';
import icon from './icon.png';

export const imageConverter: ToolDefinition = {
  id: 'image-converter',
  name: '画像変換',
  description: '写真やスクリーンショットの大きさ・容量・形式を、仕上がりを確かめながら変えられます。PDFとの相互変換や、重いPDFの縮小もできます。',
  icon,
  intents: [],
  create: () => ({
    status: signal({}),
    View: () => <ToolFrame>準備中</ToolFrame>,
  }),
};
