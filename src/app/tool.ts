// ツールの約束事。各ツールは src/tools/<id>/index.tsx でこの形の定義を書き、src/tools/index.ts に並べる。
import type { ReadonlySignal } from '@preact/signals';
import type { FunctionComponent } from 'preact';
import type { IconName } from '../ui/icons';

/** ホームに置いた・貼り付けた・ほかのツールから渡したもの。 */
export type Incoming =
  | { kind: 'files'; files: File[] }
  | { kind: 'folder'; folder: FileSystemDirectoryHandle }
  | { kind: 'text'; text: string };

/** ドラッグ中に分かること。ファイル名は落とすまで分からず、種類（MIME）と数だけが分かる。 */
export interface DragHint {
  types: string[];
  count: number;
}

/** ツールが受け取れるもの。ホームのドロップ・貼り付けと、ツールの間の受け渡しに使う。 */
export interface Intent {
  /** ツールの中で一意な名前。receive() に渡す。 */
  id: string;
  /** 「PDF編集で開く」のような、選択肢の文言。 */
  label: string;
  detail?: string;
  icon?: IconName;
  accepts(input: Incoming): boolean;
  /** ドラッグ中に、受け取れそうか。 */
  mayAccept?(hint: DragHint): boolean;
}

export interface ToolStatus {
  /** タブの題名にツール名と並べて出すもの（開いているファイル名など）。 */
  title?: string;
  /** 作業中の内容の短い説明。ホームのタイルと切り替えのメニューに出す。 */
  summary?: string;
  /** 保存していない作業がある。 */
  unsaved?: boolean;
  /** 画面を閉じる・再読み込みすると失うものがある（閉じる前に確認する）。 */
  guard?: boolean;
}

export interface ToolInstance {
  /** ツールの画面。ほかのツールに移っても消さず、active が偽の間は隠す。 */
  View: FunctionComponent<{ active: boolean }>;
  status: ReadonlySignal<ToolStatus>;
  /** ホームやほかのツールから渡されたものを受け取る。 */
  receive?(intent: string, input: Incoming): void | Promise<void>;
}

export interface ToolDefinition {
  /** URL（#/<id>）と保存する並び順に使う名前。英数字と - だけ。 */
  id: string;
  name: string;
  /** ホームのタイルに出す説明。 */
  description: string;
  /** 128×128 の PNG（data URL）。 */
  icon: string;
  intents: Intent[];
  /** 最初に開いたときに一度だけ呼ぶ。 */
  create(): ToolInstance;
}
