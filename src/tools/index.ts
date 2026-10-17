// toolbox に入れるツール。ここに並べたツールだけが配布物に入り、この順にホームへ並ぶ（使う人が並べ替えていない場合）。
// id は旧 toolbox のフォルダ名と同じにし、ホームの並び順の記録（toolbox-cards）を引き継ぐ。
import type { ToolDefinition } from '../app/tool';
import { imageConverter } from './image-converter';
import { mojicodeConverter } from './mojicode-converter';
import { noteHtml } from './note-html';
import { pdfEdit } from './pdf-edit';
import { promptLibrary } from './prompt-library';
import { typingGame } from './typing-game';

export const tools: readonly ToolDefinition[] = [promptLibrary, imageConverter, pdfEdit, noteHtml, mojicodeConverter, typingGame];

export const toolById = (id: string) => tools.find((tool) => tool.id === id);
