// toolbox の画面全体。ホームと、一度開いたツールの画面を並べ、今見ている画面だけを出す。
import type { ComponentChildren } from 'preact';
import { useEffect, useErrorBoundary, useLayoutEffect, useRef } from 'preact/hooks';
import { AskHost, Button, Toasts } from '../ui/components';
import { Icon } from '../ui/icons';
import { About } from './About';
import { Chooser } from './Chooser';
import { ToolContext, versionLabel } from './frame';
import { allTools } from './registry';
import { Home } from './Home';
import toolboxIcon from './toolbox-icon.png';
import type { ToolDefinition } from './tool';
import { goHome, guarded, instances, route, routeRendered } from './workspace';

/** 1つのツールの不具合で、ほかのツールやホームを止めない。 */
function Boundary({ tool, children }: { tool: ToolDefinition; children: ComponentChildren }) {
  const [error, reset] = useErrorBoundary((caught) => console.error(caught));
  if (error)
    return (
      <div class="tb-empty tool-crash">
        <div class="tb-empty-mark">
          <Icon name="info" />
        </div>
        <h2 class="tb-empty-title">{tool.name}で問題が起きました</h2>
        <p class="tb-empty-text">
          ほかのツールはそのまま使えます。もう一度試すか、保存していない作業を保存してから、ページを再読み込みしてください。
          <br />
          <small>{error instanceof Error ? error.message : String(error)}</small>
        </p>
        <div class="tb-empty-actions">
          <Button variant="primary" onClick={reset}>
            もう一度表示する
          </Button>
          <Button onClick={goHome}>ホームへ戻る</Button>
        </div>
      </div>
    );
  return <>{children}</>;
}

function setFavicon(href: string) {
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
  if (!link) {
    link = document.createElement('link');
    link.rel = 'icon';
    document.head.append(link);
  }
  if (link.href !== href) link.href = href;
}

export function App() {
  const current = route.value;
  const first = useRef(true);
  const activeTool =
    current.kind === 'tool' ? allTools().find((tool) => tool.id === current.id) : undefined;
  const status = activeTool ? instances.value.get(activeTool.id)?.status.value : undefined;

  // タブの題名とアイコン。ツールではそのツールのアイコン、保存していない作業があれば ● を付ける。
  useEffect(() => {
    if (!activeTool) {
      document.title = `toolbox ${versionLabel}`;
      setFavicon(toolboxIcon);
      return;
    }
    const name = status?.title ? `${status.title} — ${activeTool.name}` : activeTool.name;
    document.title = `${status?.unsaved ? '● ' : ''}${name} — toolbox`;
    setFavicon(activeTool.icon);
  });

  // 画面を移ったら、移った先の見出しへフォーカスを移す（読み上げで場所が分かるように）。
  useLayoutEffect(() => {
    routeRendered();
    if (first.current) {
      first.current = false;
      return;
    }
    const heading =
      current.kind === 'home'
        ? document.querySelector<HTMLElement>('.home-title')
        : document.querySelector<HTMLElement>(`[data-tool-view="${current.id}"] h1`);
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    window.scrollTo(0, 0);
  }, [current.kind === 'tool' ? current.id : '']);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (guarded.value) event.preventDefault();
    };
    addEventListener('beforeunload', beforeUnload);
    return () => removeEventListener('beforeunload', beforeUnload);
  }, []);

  return (
    <>
      <div class="home-view" hidden={current.kind !== 'home'}>
        <Home active={current.kind === 'home'} />
      </div>
      {allTools().map((tool) => {
        const instance = instances.value.get(tool.id);
        if (!instance) return null;
        const active = current.kind === 'tool' && current.id === tool.id;
        const View = instance.View;
        return (
          <section
            key={tool.id}
            class="tool-view"
            data-tool-view={tool.id}
            hidden={!active}
            aria-label={tool.name}
          >
            <ToolContext.Provider value={tool}>
              <Boundary tool={tool}>
                <View active={active} />
              </Boundary>
            </ToolContext.Provider>
          </section>
        );
      })}
      <Chooser />
      <About />
      <AskHost />
      <Toasts />
    </>
  );
}
