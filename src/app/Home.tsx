// ホーム。ツールのタイル（並べ替え・表示の切り替えができる）、版番号、背景の流れ。
// ファイル・フォルダを置くか貼り付けると、受け取れるツールを示して開く。
import { useComputed, useSignal, useSignalEffect } from '@preact/signals';
import type { JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { canUseFolders, hasFiles } from '../lib/files';
import { isEditable, isMac, prefersReducedMotion } from '../lib/platform';
import { Button, IconButton, toast } from '../ui/components';
import { Icon } from '../ui/icons';
import { useDropZone } from '../ui/drop';
import { aboutOpen } from './About';
import { createCards } from './cards';
import { allTools } from './registry';
import { deliver, mayAccept } from './deliver';
import { createFlow, flowEnabled } from './flow';
import { ThemeToggle, versionLabel } from './frame';
import type { DragHint, Incoming } from './tool';
import { instances, openTool, routeRendered } from './workspace';

let shared: ReturnType<typeof createCards> | undefined;
/** ホームのタイルの並び。ツールを登録した後（最初の表示のとき）に作る。 */
const useCards = () => (shared ??= createCards(allTools().map((tool) => tool.id)));

function dragHint(event: DragEvent): DragHint {
  const items = Array.from(event.dataTransfer?.items ?? []).filter((item) => item.kind === 'file');
  return { types: items.map((item) => item.type), count: items.length };
}

export function Home({ active }: { active: boolean }) {
  const cards = useCards();
  const tools = allTools();
  const editing = useSignal(false);
  const hint = useSignal<DragHint | null>(null);
  const over = useSignal<string | null>(null);
  const dragged = useRef<string | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const motion = useSignal(!prefersReducedMotion.matches);
  const activeSignal = useSignal(active);
  activeSignal.value = active;

  useEffect(() => {
    const listener = () => {
      motion.value = !prefersReducedMotion.matches;
    };
    prefersReducedMotion.addEventListener('change', listener);
    return () => prefersReducedMotion.removeEventListener('change', listener);
  }, []);

  // 背景の流れ。ホームが見えていて、止めておらず、動きを減らす設定でないときだけ動かす。
  const flow = useRef<ReturnType<typeof createFlow>>(null);
  useEffect(() => {
    flow.current = canvas.current ? createFlow(canvas.current) : null;
    return () => flow.current?.dispose();
  }, []);
  useSignalEffect(() => {
    flow.current?.set(flowEnabled.value && motion.value && activeSignal.value);
  });

  useEffect(() => {
    if (active) routeRendered();
  }, [active]);

  const zone = useDropZone<HTMLDivElement>({
    enabled: () => active && !editing.value,
    label: () => null,
    onDrop: (dropped, event) => {
      hint.value = null;
      over.value = null;
      const target = (event.target as Element | null)?.closest<HTMLElement>('[data-tool]')?.dataset
        .tool;
      let input: Incoming | null = null;
      if (dropped.folder) input = { kind: 'folder', folder: dropped.folder };
      else if (dropped.files.length) input = { kind: 'files', files: dropped.files };
      if (input) deliver(input, { only: target });
      // フォルダのハンドルを得られない（ブラウザーが対応していない、2つ以上置いた）とき。
      else if (dropped.hasFolder)
        toast(
          canUseFolders()
            ? 'フォルダは1つずつ置いてください。'
            : 'このブラウザーではフォルダを開けません。Chrome・Edge で開いてください。',
          { tone: 'error' },
        );
      else toast('PDF・画像・テキストのファイルか、フォルダを置いてください。', { tone: 'error' });
    },
  });

  // ドラッグ中の種類を覚え、受け取れるツールのタイルを光らせる。
  useEffect(() => {
    const clear = () => {
      hint.value = null;
      over.value = null;
    };
    const leave = (event: DragEvent) => {
      if (!event.relatedTarget) clear();
    };
    addEventListener('dragleave', leave);
    addEventListener('drop', clear);
    addEventListener('dragend', clear);
    return () => {
      removeEventListener('dragleave', leave);
      removeEventListener('drop', clear);
      removeEventListener('dragend', clear);
    };
  }, []);

  // 貼り付けた文章・画像を、受け取れるツールへ渡す。
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (
        !active ||
        editing.value ||
        isEditable(event.target) ||
        document.querySelector('dialog[open]')
      )
        return;
      const files = Array.from(event.clipboardData?.files ?? []);
      const text = event.clipboardData?.getData('text/plain') ?? '';
      if (files.length) deliver({ kind: 'files', files });
      else if (text.trim()) deliver({ kind: 'text', text });
      else return;
      event.preventDefault();
    };
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  }, [active]);

  const arranged = cards.arranged.value;
  const visible = arranged.order.filter((id) => editing.value || !arranged.hidden.has(id));

  function move(id: string, step: -1 | 1) {
    const order = [...arranged.order];
    const from = order.indexOf(id);
    const to = from + step;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to]!, order[from]!];
    cards.save(order, arranged.hidden);
  }

  const working = useComputed(() =>
    tools
      .filter((tool) => instances.value.get(tool.id)?.status.value.unsaved)
      .map((tool) => tool.name),
  );

  return (
    <div class="home" ref={zone} data-dragging={hint.value ? '' : undefined}>
      <canvas ref={canvas} class="home-flow" aria-hidden="true" />
      <main class="home-main">
        <header class="home-header">
          <div>
            <h1 class="home-title">toolbox</h1>
            <p class="home-lead">PC の中で完結する、便利ツール集</p>
          </div>
          <div class="home-meta">
            <p class="home-version">
              版 <strong>{versionLabel}</strong>
            </p>
            {motion.value && (
              <IconButton
                icon={flowEnabled.value ? 'waves' : 'waves-off'}
                label={flowEnabled.value ? '背景の流れを止める' : '背景の流れを動かす'}
                aria-pressed={String(flowEnabled.value) as 'true' | 'false'}
                class="home-flow-toggle"
                onClick={() => flowEnabled.set(!flowEnabled.value)}
              />
            )}
            <ThemeToggle />
            <IconButton
              icon="info"
              label="このアプリについて"
              onClick={() => (aboutOpen.value = true)}
            />
          </div>
        </header>

        <div class="home-toolbar">
          {editing.value ? (
            <p class="home-hint">
              カードをドラッグするか「前へ」「後へ」で並べ替えます。「表示」を外したツールは一覧に出ません。
            </p>
          ) : (
            <p class="home-hint home-drop-hint">
              <Icon name="inbox" />
              <span>
                ファイル・フォルダをここに置くか、文章や画像を貼り付ける（
                <kbd>{isMac ? '⌘' : 'Ctrl'}</kbd>+<kbd>V</kbd>）と、使えるツールで開きます。
              </span>
            </p>
          )}
          {editing.value && (
            <Button variant="quiet" disabled={!cards.customized} onClick={() => cards.reset()}>
              元の並びに戻す
            </Button>
          )}
          <Button variant="secondary" onClick={() => (editing.value = !editing.value)}>
            {editing.value ? '完了' : '並べ替え・表示'}
          </Button>
        </div>

        {working.value.length > 0 && !editing.value && (
          <p class="home-working">
            <span class="tb-dot" />
            {working.value.join('・')}に、保存していない作業があります。
          </p>
        )}

        <ul class="home-cards" data-editing={editing.value ? '' : undefined}>
          {visible.map((id, index) => {
            const tool = tools.find((item) => item.id === id)!;
            const status = instances.value.get(id)?.status.value;
            const hidden = arranged.hidden.has(id);
            const accepts = hint.value ? mayAccept(tool, hint.value) : null;
            const itemProps: JSX.HTMLAttributes<HTMLLIElement> = editing.value
              ? {
                  draggable: true,
                  onDragStart: (event) => {
                    dragged.current = id;
                    event.dataTransfer!.effectAllowed = 'move';
                    event.dataTransfer!.setData('text/plain', id);
                  },
                  onDragOver: (event) => {
                    if (!dragged.current || dragged.current === id) return;
                    event.preventDefault();
                    const order = [...arranged.order];
                    const from = order.indexOf(dragged.current);
                    const to = order.indexOf(id);
                    order.splice(to, 0, ...order.splice(from, 1));
                    cards.save(order, arranged.hidden);
                  },
                  onDrop: (event) => {
                    if (dragged.current) event.preventDefault();
                  },
                  onDragEnd: () => {
                    dragged.current = null;
                  },
                }
              : {};
            return (
              <li
                key={id}
                data-tool={id}
                data-hidden={hidden ? '' : undefined}
                data-accept={accepts === null ? undefined : accepts ? 'yes' : 'no'}
                data-over={over.value === id ? '' : undefined}
                onDragEnter={() => {
                  if (hint.value) over.value = id;
                }}
                {...itemProps}
              >
                <a
                  class="home-card"
                  href={`#/${id}`}
                  inert={editing.value}
                  onClick={(event) => {
                    event.preventDefault();
                    openTool(id);
                  }}
                >
                  <span class="home-card-top">
                    <img
                      class="home-card-icon"
                      src={tool.icon}
                      alt=""
                      style={
                        {
                          viewTransitionName: active ? `tool-${id}` : undefined,
                        } as JSX.CSSProperties
                      }
                    />
                    {status?.unsaved && (
                      <span class="tb-badge" data-tone="accent">
                        <span class="tb-dot" />
                        作業中
                      </span>
                    )}
                  </span>
                  <span class="home-card-name">{tool.name}</span>
                  <span class="home-card-description">{tool.description}</span>
                  {status?.summary && <span class="home-card-status">{status.summary}</span>}
                  <span class="home-card-open" aria-hidden="true">
                    {accepts ? 'ここに置いて開く' : status?.summary ? '続ける' : '開く'}
                  </span>
                </a>
                {editing.value && (
                  <div class="home-card-controls">
                    <label class="home-card-show">
                      <input
                        type="checkbox"
                        checked={!hidden}
                        aria-label={`${tool.name}を表示`}
                        onChange={(event) => {
                          const next = new Set(arranged.hidden);
                          if ((event.target as HTMLInputElement).checked) next.delete(id);
                          else next.add(id);
                          cards.save(arranged.order, next);
                        }}
                      />
                      表示
                    </label>
                    <Button
                      size="small"
                      disabled={index === 0}
                      aria-label={`${tool.name}を前へ移動`}
                      onClick={() => move(id, -1)}
                    >
                      前へ
                    </Button>
                    <Button
                      size="small"
                      disabled={index === visible.length - 1}
                      aria-label={`${tool.name}を後へ移動`}
                      onClick={() => move(id, 1)}
                    >
                      後へ
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {!editing.value && visible.length === 0 && (
          <p class="home-empty">
            表示するツールがありません。「並べ替え・表示」から選んでください。
          </p>
        )}
      </main>
      {/* ドラッグ中の種類を読む。受け付けるかの判断と印は ui/drop.ts が行う。 */}
      <DragWatcher active={active && !editing.value} onHint={(value) => (hint.value = value)} />
    </div>
  );
}

function DragWatcher({
  active,
  onHint,
}: {
  active: boolean;
  onHint: (hint: DragHint | null) => void;
}) {
  const last = useRef('');
  useEffect(() => {
    if (!active) return;
    const over = (event: DragEvent) => {
      if (!hasFiles(event.dataTransfer)) return;
      const hint = dragHint(event);
      const key = `${hint.count}:${hint.types.join(',')}`;
      if (key === last.current) return;
      last.current = key;
      onHint(hint);
    };
    const reset = () => {
      last.current = '';
    };
    const leave = (event: DragEvent) => {
      if (!event.relatedTarget) reset();
    };
    addEventListener('dragover', over);
    addEventListener('drop', reset);
    addEventListener('dragend', reset);
    addEventListener('dragleave', leave);
    return () => {
      removeEventListener('dragover', over);
      removeEventListener('drop', reset);
      removeEventListener('dragend', reset);
      removeEventListener('dragleave', leave);
    };
  }, [active]);
  return null;
}
