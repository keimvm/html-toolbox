// 文章比較。2つの文章を貼ると、違う箇所を色分けして示す。
// 行ごとに差分を取り、変わった行の中を文字ごとに比べ直す（compare.ts）。貼った文章も結果も保存しない。
import { batch, computed, effect, signal } from '@preact/signals';
import { Fragment, type ComponentChildren } from 'preact';
import { ToolFrame } from '../../app/frame';
import type { Incoming, ToolDefinition } from '../../app/tool';
import { loadDiff } from '../../engine/diff';
import { isTextFile } from '../../lib/files';
import { isEditable, prefersReducedMotion } from '../../lib/platform';
import { Button, EmptyState, IconButton, Segmented, toast } from '../../ui/components';
import { useDropZone } from '../../ui/drop';
import { compare, type Block, type Comparison, type Part } from './compare';
import icon from './icon.png';
import './style.css';

type Side = 'before' | 'after';
/** split：前と後を左右に並べる、inline：1つの文章に削除と追加を差し込む。 */
type Layout = 'split' | 'inline';

const LABELS: Record<Side, string> = { before: '前の文章', after: '後の文章' };
/** 変わらない行のうち、違いの前後に見せておく行数。残りは畳む。 */
const CONTEXT = 3;
/** 打っている間は比べず、手を止めてからこの時間（ミリ秒）で比べる。 */
const DELAY = 200;

/** empty：両方とも空、waiting：片方だけ、loading：読み込み中、failed：読み込めない、overflow：比べきれない。 */
type Outcome =
  | { kind: 'empty' | 'waiting' | 'loading' | 'failed' | 'overflow' }
  | { kind: 'done'; comparison: Comparison };

const isBlankText = (text: string) => !text.trim();
/** 改行・空白を除いた文字（コードポイント）の数。 */
const countChars = (text: string) => [...text.replace(/\s/gu, '')].length;

function create() {
  const texts = { before: signal(''), after: signal('') };
  const layout = signal<Layout>('split');
  const ready = signal<'loading' | 'ready' | 'failed'>('loading');
  const outcome = signal<Outcome>({ kind: 'empty' });
  /** 開いた「変わらない行」のまとまり（blocks の添字）。比べ直すと閉じる。 */
  const opened = signal<ReadonlySet<number>>(new Set());
  /** 前へ・次へで選んでいる違い。 */
  const current = signal(-1);
  let active = false;
  let resultBody: HTMLElement | null = null;

  loadDiff().then(
    () => (ready.value = 'ready'),
    (error: unknown) => {
      console.error(error);
      ready.value = 'failed';
    },
  );

  function run() {
    const before = texts.before.value;
    const after = texts.after.value;
    let next: Outcome;
    if (isBlankText(before) && isBlankText(after)) next = { kind: 'empty' };
    else if (isBlankText(before) || isBlankText(after)) next = { kind: 'waiting' };
    else if (ready.value !== 'ready') next = { kind: ready.value };
    else {
      const comparison = compare(before, after);
      next = comparison ? { kind: 'done', comparison } : { kind: 'overflow' };
    }
    batch(() => {
      outcome.value = next;
      opened.value = new Set();
      current.value = -1;
    });
  }

  let timer = 0;
  effect(() => {
    void texts.before.value;
    void texts.after.value;
    void ready.value;
    clearTimeout(timer);
    timer = window.setTimeout(run, DELAY);
  });

  const status = computed(() => {
    const result = outcome.value;
    if (result.kind === 'done') {
      const { changes } = result.comparison;
      return { summary: changes ? `違い ${changes.toLocaleString()} か所` : '違いなし' };
    }
    if (result.kind === 'waiting') return { summary: 'もう一方の文章を待っています' };
    return {};
  });

  function put(text: string, side: Side) {
    texts[side].value = text;
  }

  /** 空いている欄（前の文章から）に入れる。両方に入っていれば、後の文章を置き換える。 */
  function putFree(text: string) {
    if (isBlankText(texts.before.value)) {
      put(text, 'before');
      return;
    }
    if (!isBlankText(texts.after.value)) toast('後の文章を置き換えました。');
    put(text, 'after');
  }

  /** テキストファイルを1つか2つ読む。2つなら、更新日時の古いほうを前の文章にする。 */
  async function readFiles(files: File[], side?: Side) {
    if (!files.length || files.length > 2 || !files.every(isTextFile)) {
      toast('比べられるのは、テキストファイル（.txt・.md など）1つか2つです。', { tone: 'error' });
      return;
    }
    const sorted = [...files].sort(
      (a, b) =>
        a.lastModified - b.lastModified || a.name.localeCompare(b.name, 'ja', { numeric: true }),
    );
    let contents: string[];
    try {
      contents = await Promise.all(sorted.map((file) => file.text()));
    } catch {
      toast(`「${sorted.map((file) => file.name).join('」「')}」を読めませんでした。`, {
        tone: 'error',
      });
      return;
    }
    if (contents.length === 2) {
      batch(() => {
        put(contents[0]!, 'before');
        put(contents[1]!, 'after');
      });
    } else if (side) put(contents[0]!, side);
    else putFree(contents[0]!);
  }

  function swap() {
    const before = texts.before.value;
    batch(() => {
      texts.before.value = texts.after.value;
      texts.after.value = before;
    });
  }

  function clear() {
    batch(() => {
      texts.before.value = '';
      texts.after.value = '';
      run();
    });
  }

  /** 前・次の違いへ移り、見える位置までスクロールする。 */
  function go(step: 1 | -1) {
    const result = outcome.value;
    if (result.kind !== 'done' || !result.comparison.changes) return;
    const total = result.comparison.changes;
    const next =
      current.value < 0 ? (step > 0 ? 0 : total - 1) : (current.value + step + total) % total;
    current.value = next;
    resultBody?.querySelector(`[data-change="${next}"]`)?.scrollIntoView({
      block: 'center',
      behavior: prefersReducedMotion.matches ? 'auto' : 'smooth',
    });
  }

  // 欄の外で貼り付けても、空いている欄に入れる。
  document.addEventListener('paste', (event) => {
    if (!active || isEditable(event.target) || document.querySelector('dialog[open]')) return;
    const text = event.clipboardData?.getData('text/plain');
    if (!text || isBlankText(text)) return;
    event.preventDefault();
    putFree(text);
  });

  function View({ active: visible }: { active: boolean }) {
    active = visible;
    const drop = useDropZone<HTMLDivElement>({
      enabled: () => visible,
      label: () => 'テキストファイルを比べる',
      onDrop: ({ files }) => void readFiles(files),
    });
    const result = outcome.value;
    const changes = result.kind === 'done' ? result.comparison.changes : 0;
    const hasText = !isBlankText(texts.before.value) || !isBlankText(texts.after.value);
    return (
      <ToolFrame
        actions={
          <>
            <Segmented
              label="表示"
              value={layout.value}
              options={[
                { value: 'split', label: '並べる', title: '前と後を左右に並べる' },
                { value: 'inline', label: 'まとめる', title: '1つの文章に削除と追加を差し込む' },
              ]}
              onChange={(value) => (layout.value = value)}
            />
            <Button disabled={!hasText} onClick={swap} title="前の文章と後の文章を入れ替える">
              入れ替える
            </Button>
            <Button
              disabled={!texts.before.value && !texts.after.value}
              onClick={clear}
              title="前後の文章と比較結果をすべて消す"
            >
              すべてクリア
            </Button>
          </>
        }
      >
        <div class="tc" data-layout={layout.value} ref={drop}>
          <div class="tc-inputs">
            {(['before', 'after'] as const).map((side) => (
              <Pane
                key={side}
                side={side}
                text={texts[side].value}
                visible={visible}
                onText={(text) => put(text, side)}
                onFiles={(files) => void readFiles(files, side)}
              />
            ))}
          </div>
          <section class="tc-result" aria-labelledby="tc-result-title">
            <div class="tc-result-head">
              <h2 id="tc-result-title">違い</h2>
              {result.kind === 'done' && (
                <>
                  <span class="tc-summary" role="status">
                    {changes ? `${changes.toLocaleString()} か所` : 'なし'}
                  </span>
                  {changes > 0 && (
                    <p class="tc-legend">
                      <del class="tc-removed">削除</del>
                      <ins class="tc-added">追加</ins>
                    </p>
                  )}
                  {changes > 0 && (
                    <div class="tc-nav">
                      <span class="tc-position">
                        {current.value < 0
                          ? ''
                          : `${(current.value + 1).toLocaleString()} / ${changes.toLocaleString()}`}
                      </span>
                      <IconButton icon="chevron-up" label="前の違いへ" onClick={() => go(-1)} />
                      <IconButton icon="chevron-down" label="次の違いへ" onClick={() => go(1)} />
                    </div>
                  )}
                </>
              )}
            </div>
            <div
              class="tc-result-body tb-scroll"
              ref={(element) => {
                resultBody = element;
              }}
            >
              <ResultBody
                outcome={result}
                layout={layout.value}
                opened={opened.value}
                current={current.value}
                onOpen={(index) => (opened.value = new Set(opened.value).add(index))}
              />
            </div>
          </section>
        </div>
      </ToolFrame>
    );
  }

  return {
    View,
    status,
    async receive(_intent: string, input: Incoming) {
      if (input.kind === 'text') putFree(input.text);
      else if (input.kind === 'files') await readFiles(input.files);
    },
  };
}

function Pane({
  side,
  text,
  visible,
  onText,
  onFiles,
}: {
  side: Side;
  text: string;
  visible: boolean;
  onText: (text: string) => void;
  onFiles: (files: File[]) => void;
}) {
  const drop = useDropZone<HTMLElement>({
    enabled: () => visible,
    label: () => `${LABELS[side]}にする`,
    onDrop: ({ files }) => onFiles(files),
  });
  const id = `tc-${side}-title`;
  const count = countChars(text);
  return (
    <section class="tc-pane" aria-labelledby={id} ref={drop}>
      <div class="tc-pane-head">
        <h2 id={id}>{LABELS[side]}</h2>
        <span class="tc-count">{count ? `${count.toLocaleString()} 文字` : ''}</span>
        {text && (
          <IconButton
            icon="x"
            label={`${LABELS[side]}を消す`}
            class="tc-clear"
            onClick={() => onText('')}
          />
        )}
      </div>
      <textarea
        class="tb-input tc-field"
        aria-labelledby={id}
        placeholder={
          side === 'before'
            ? '元の文章（新旧の旧、書き直す前など）を貼り付けます。'
            : '比べる文章（新旧の新、書き直した後など）を貼り付けます。'
        }
        spellcheck={false}
        autocomplete="off"
        value={text}
        onInput={(event) => onText((event.target as HTMLTextAreaElement).value)}
      />
    </section>
  );
}

function ResultBody({
  outcome,
  layout,
  opened,
  current,
  onOpen,
}: {
  outcome: Outcome;
  layout: Layout;
  opened: ReadonlySet<number>;
  current: number;
  onOpen: (index: number) => void;
}) {
  if (outcome.kind !== 'done') return <Message kind={outcome.kind} />;
  const { blocks, changes, rough } = outcome.comparison;
  if (!changes) return <p class="tc-message">2つの文章は同じです。</p>;
  const split = layout === 'split';
  return (
    <>
      {rough && (
        <p class="tc-note">
          長く変わった箇所は文字ごとに比べきれなかったため、行ごと入れ替わったものとして示しています。
        </p>
      )}
      <div class="tc-rows">
        {blocks.map((block, index) =>
          block.kind === 'same' ? (
            <Same
              key={index}
              block={block}
              split={split}
              first={index === 0}
              last={index === blocks.length - 1}
              open={opened.has(index)}
              onOpen={() => onOpen(index)}
            />
          ) : (
            <Change key={index} block={block} split={split} current={current} />
          ),
        )}
      </div>
    </>
  );
}

function Message({ kind }: { kind: Exclude<Outcome['kind'], 'done'> }) {
  switch (kind) {
    case 'empty':
      return (
        <EmptyState icon="files" title="2つの文章を比べます">
          上の「前の文章」と「後の文章」に貼り付けると、違う箇所を色分けして示します。テキストファイルを置いても入ります。
        </EmptyState>
      );
    case 'waiting':
      return <p class="tc-message">もう一方の欄にも文章を貼ると、違いを示します。</p>;
    case 'loading':
      return <p class="tc-message">準備しています…</p>;
    case 'failed':
      return (
        <p class="tc-message">
          比べる処理を読み込めませんでした。ページを読み込み直してから、もう一度お試しください。
        </p>
      );
    case 'overflow':
      return (
        <p class="tc-message">
          2つの文章の違いが大きすぎて、比べきれませんでした。比べる範囲を短くしてお試しください。
        </p>
      );
  }
}

function Row({ split, children }: { split: boolean; children: ComponentChildren }) {
  return (
    <div class="tc-row">
      <div class="tc-cell">{children}</div>
      {split && (
        <div class="tc-cell" aria-hidden="true">
          {children}
        </div>
      )}
    </div>
  );
}

/** 変わらない行。長いときは、違いの前後の数行だけを見せて間を畳む。 */
function Same({
  block,
  split,
  first,
  last,
  open,
  onOpen,
}: {
  block: Extract<Block, { kind: 'same' }>;
  split: boolean;
  first: boolean;
  last: boolean;
  open: boolean;
  onOpen: () => void;
}) {
  const { lines } = block;
  const head = first ? 0 : CONTEXT;
  const tail = last ? 0 : CONTEXT;
  const hidden = lines.length - head - tail;
  if (open || hidden <= 2) return <Row split={split}>{lines.join('')}</Row>;
  return (
    <>
      {head > 0 && <Row split={split}>{lines.slice(0, head).join('')}</Row>}
      <div class="tc-fold">
        <button type="button" class="tb-button tc-fold-button" onClick={onOpen}>
          変わらない {hidden.toLocaleString()} 行を表示
        </button>
      </div>
      {tail > 0 && <Row split={split}>{lines.slice(-tail).join('')}</Row>}
    </>
  );
}

function Change({
  block,
  split,
  current,
}: {
  block: Extract<Block, { kind: 'change' }>;
  split: boolean;
  current: number;
}) {
  const render = (parts: Part[]) =>
    parts.map((part, index) => <PartView key={index} part={part} current={current} />);
  if (!split)
    return (
      <div class="tc-row tc-change">
        <div class="tc-cell">{render(block.parts)}</div>
      </div>
    );
  const before = block.parts.filter((part) => part.kind !== 'added');
  const after = block.parts.filter((part) => part.kind !== 'removed');
  return (
    <div class="tc-row tc-change">
      <div class={before.length ? 'tc-cell' : 'tc-cell is-empty'}>{render(before)}</div>
      <div class={after.length ? 'tc-cell' : 'tc-cell is-empty'}>{render(after)}</div>
    </div>
  );
}

function PartView({ part, current }: { part: Part; current: number }) {
  if (part.kind === 'same') return <>{part.text}</>;
  const removed = part.kind === 'removed';
  const Tag = removed ? 'del' : 'ins';
  // 改行の削除・追加は見えないため、改行の前に印を出す。
  const lines = part.text.split('\n');
  return (
    <Tag
      class={`${removed ? 'tc-removed' : 'tc-added'}${part.change === current ? ' is-current' : ''}`}
      data-change={part.change}
    >
      {lines.map((line, index) =>
        index < lines.length - 1 ? (
          <Fragment key={index}>
            {line}
            <span class="tc-break" aria-hidden="true">
              ↵
            </span>
            {'\n'}
          </Fragment>
        ) : (
          line
        ),
      )}
    </Tag>
  );
}

export const textCompare: ToolDefinition = {
  id: 'text-compare',
  name: '文章比較',
  description: '2つの文章を貼り付けて、違う箇所を色分けして確かめられます。',
  icon,
  intents: [
    {
      id: 'compare',
      label: '別の文章と比べる',
      detail: '文章比較：この文章と、もう1つの文章の違いを見る',
      icon: 'files',
      accepts: (input) =>
        (input.kind === 'text' && !isBlankText(input.text)) ||
        (input.kind === 'files' &&
          input.files.length >= 1 &&
          input.files.length <= 2 &&
          input.files.every(isTextFile)),
      mayAccept: (hint) =>
        hint.count >= 1 && hint.count <= 2 && hint.types.some((type) => type.startsWith('text/')),
    },
  ],
  create,
};
