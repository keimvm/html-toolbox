// ホームに置いた・貼り付けたもの、ほかのツールから渡したものを、受け取れるツールへ届ける。
// 受け取れるのが1つなら、そのツールを開いて渡す。2つ以上なら選んでもらう。
import { signal } from '@preact/signals';
import { allTools, toolById } from './registry';
import { toast } from '../ui/components';
import type { DragHint, Incoming, Intent, ToolDefinition } from './tool';
import { openTool } from './workspace';

export interface Option {
  tool: ToolDefinition;
  intent: Intent;
}

/** 選んでもらう間の、渡すものと選択肢。Chooser が表示する。 */
export const choosing = signal<{ input: Incoming; options: Option[]; title: string } | null>(null);

export function optionsFor(input: Incoming, only?: string): Option[] {
  return allTools()
    .filter((tool) => !only || tool.id === only)
    .flatMap((tool) =>
      tool.intents.filter((intent) => intent.accepts(input)).map((intent) => ({ tool, intent })),
    );
}

/** ドラッグ中に、そのツールが受け取れそうか。 */
export function mayAccept(tool: ToolDefinition, hint: DragHint) {
  return tool.intents.some((intent) => intent.mayAccept?.(hint) ?? false);
}

export function describe(input: Incoming) {
  if (input.kind === 'folder') return `フォルダ「${input.folder.name}」`;
  if (input.kind === 'text') return '貼り付けた文章';
  return input.files.length === 1
    ? `「${input.files[0]!.name}」`
    : `${input.files.length}個のファイル`;
}

export function deliverTo(option: Option, input: Incoming) {
  choosing.value = null;
  openTool(option.tool.id, { intent: option.intent.id, input });
}

/** 受け取れるツールへ渡す。only を指定すると、そのツールの中から選ぶ。 */
export function deliver(input: Incoming, { only }: { only?: string } = {}) {
  const options = optionsFor(input, only);
  if (!options.length) {
    const name = only ? toolById(only)?.name : undefined;
    toast(
      name
        ? `${describe(input)}は${name}では扱えません。`
        : input.kind === 'files' && input.files.length
          ? `${describe(input)}を扱えるツールがありません。PDF・画像・テキストのファイルか、フォルダを置いてください。`
          : `${describe(input)}を扱えるツールがありません。`,
      { tone: 'error' },
    );
    return;
  }
  if (options.length === 1) {
    deliverTo(options[0]!, input);
    return;
  }
  choosing.value = { input, options, title: `${describe(input)}で、何をしますか？` };
}
