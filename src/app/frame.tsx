// ツール画面の共通の枠。上部のヘッダーの左上の一角は全ツールで同じ中身・順序にする：
// ホームへ戻る・ツールのアイコンと名前（押すとほかのツールへ移るメニュー）・配色の切り替え。
// 右側にはツール固有の操作を置く。右下に版番号を出す。
import { createContext, type ComponentChildren } from 'preact';
import { useContext, useId, useRef } from 'preact/hooks';
import type { JSX } from 'preact';
import { theme, toggleTheme } from '../lib/theme';
import { IconButton } from '../ui/components';
import { Icon } from '../ui/icons';
import { tools } from '../tools';
import type { ToolDefinition } from './tool';
import { goHome, instances, openTool } from './workspace';

export const ToolContext = createContext<ToolDefinition | null>(null);
export const useTool = () => {
  const tool = useContext(ToolContext);
  if (!tool) throw new Error('ToolFrame はツールの画面の中で使ってください。');
  return tool;
};

export const VERSION = __TOOLBOX_VERSION__;
export const versionLabel = VERSION === 'dev' ? '開発版' : VERSION;

export function ThemeToggle() {
  const dark = theme.value === 'dark';
  return (
    <IconButton
      icon={dark ? 'sun' : 'moon'}
      label={dark ? 'ライトモードにする' : 'ダークモードにする'}
      class="tb-theme-toggle"
      onClick={toggleTheme}
    />
  );
}

/** ツール名のボタンと、ほかのツールへ移るメニュー。 */
function Switcher({ tool }: { tool: ToolDefinition }) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  const anchor = `--tb-switcher-${tool.id}`;
  return (
    <>
      <button
        type="button"
        class="tb-button tb-header-brand"
        popovertarget={id}
        title="ほかのツールへ移る"
        style={{ anchorName: anchor } as JSX.CSSProperties}
      >
        <img
          class="tb-header-icon"
          src={tool.icon}
          alt=""
          style={{ viewTransitionName: `tool-${tool.id}` } as JSX.CSSProperties}
        />
        <span class="tb-header-name">{tool.name}</span>
        <Icon name="chevron-down" class="tb-header-caret" />
      </button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        class="tb-popover tb-switcher"
        style={{ positionAnchor: anchor, positionArea: 'bottom span-right' } as JSX.CSSProperties}
      >
        <div class="tb-menu-label">ツールを切り替える</div>
        {tools.map((other) => {
          const status = instances.value.get(other.id)?.status.value;
          const current = other.id === tool.id;
          return (
            <button
              key={other.id}
              type="button"
              class="tb-menu-item tb-switcher-item"
              aria-current={current ? 'page' : undefined}
              onClick={() => {
                panel.current?.hidePopover();
                if (!current) openTool(other.id);
              }}
            >
              <img src={other.icon} alt="" />
              <span class="tb-switcher-text">
                <span class="tb-switcher-name">{other.name}</span>
                {status?.summary && <span class="tb-switcher-summary">{status.summary}</span>}
              </span>
              {status?.unsaved && <span class="tb-dot" title="保存していない作業があります" />}
            </button>
          );
        })}
        <hr class="tb-menu-separator" />
        <button
          type="button"
          class="tb-menu-item"
          onClick={() => {
            panel.current?.hidePopover();
            goHome();
          }}
        >
          <Icon name="home" />
          <span>ホーム</span>
        </button>
      </div>
    </>
  );
}

export function ToolFrame({
  children,
  actions,
  center,
  class: className,
}: {
  children: ComponentChildren;
  /** ヘッダーの右側に置く、ツール固有の操作。 */
  actions?: ComponentChildren;
  /** 左上の一角と右側の間に置くもの（ファイル名など）。 */
  center?: ComponentChildren;
  class?: string;
}) {
  const tool = useTool();
  return (
    <div class={className ? `tb-tool ${className}` : 'tb-tool'}>
      <h1 class="tb-sr">{tool.name}</h1>
      <header class="tb-header">
        <div class="tb-header-start">
          <IconButton icon="home" label="ホームへ戻る" class="tb-home" onClick={goHome} />
          <span class="tb-header-divider" aria-hidden="true" />
          <Switcher tool={tool} />
          <ThemeToggle />
        </div>
        {center !== undefined && <div class="tb-header-center">{center}</div>}
        {actions !== undefined && <div class="tb-header-end">{actions}</div>}
      </header>
      <div class="tb-tool-body">{children}</div>
      <div class="tb-version" aria-hidden="true">
        toolbox {versionLabel}
      </div>
    </div>
  );
}
