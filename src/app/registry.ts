// 登録したツールの一覧。src/tools/index.ts の一覧を、起動時に main.tsx が登録する。
// ツールは app/ の部品（ToolFrame など）を使うため、app/ から src/tools/ を直接読み込まない（循環させない）。
import type { ToolDefinition } from './tool';

let registered: readonly ToolDefinition[] = [];

export function registerTools(tools: readonly ToolDefinition[]) {
  registered = tools;
}

export const allTools = () => registered;
export const toolById = (id: string) => registered.find((tool) => tool.id === id);
