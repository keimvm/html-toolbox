// タイピングゲーム。貼り付けた文章を見本にして、いつもの日本語入力（IME）で打つ。
// 打っている間は違う箇所を判定・表示せず、確定のたびに見本の進み具合だけを差分で求める（createLocator）。
// 違う箇所の判定は終了時の1回だけ（judge）。貼った文章・打った文章・結果は保存しない。
import { batch, computed, signal } from '@preact/signals';
import { Component } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { ToolFrame } from '../../app/frame';
import type { Incoming, ToolDefinition } from '../../app/tool';
import { isTextFile } from '../../lib/files';
import { hasMod, modKey, prefersReducedMotion } from '../../lib/platform';
import { Button, toast } from '../../ui/components';
import { useDropZone } from '../../ui/drop';
import { loadDiff } from '../../engine/diff';
import { countChars, createLocator, graphemes, isBlank, judge, type Judgement } from './judge';
import { formatClock, formatSpoken } from './time';
import icon from './icon.png';
import './style.css';

/** setup：文章を貼る、countdown：3秒、typing：打っている間、judging：判定中、result：結果。 */
type Phase = 'setup' | 'countdown' | 'typing' | 'judging' | 'result';
const COUNT_FROM = 3;
const motion = () => !prefersReducedMotion.matches;

/** 見本の文字の要素は、確定のたびに直接書き換える。Preact に描き直させない。 */
class Host extends Component<{ hostRef: (element: HTMLDivElement | null) => void }> {
  shouldComponentUpdate() {
    return false;
  }
  render() {
    return <div class="tg-text tg-sample" ref={this.props.hostRef} />;
  }
}

function create() {
  const phase = signal<Phase>('setup');
  const source = signal('');
  const note = signal('');
  const countNumber = signal('');
  const going = signal(false);
  const elapsedText = signal('');
  const complete = signal(false);
  const composing = signal(false);
  const progress = signal({ done: 0, total: 0 });
  const result = signal<{
    elapsed: number;
    input: string;
    judgement: Judgement | undefined;
  } | null>(null);
  const announce = signal('');
  let active = false;
  // 打っている間の進み具合に使う差分の WebAssembly を、開いたときに読み込んでおく。
  // 使えない環境では進み具合を確定した文字数で進め、失敗は判定のとき（judge）に記録する。
  loadDiff().catch(() => {});

  /** 打っている見本（前後の改行・空白を除いたもの）。 */
  let sampleText = '';
  /** 見本の文字（改行・空白を除く）の要素。確定した入力が見本のどこまで進んだかに合わせ、先頭から色を変える。 */
  let chars: HTMLElement[] = [];
  let locate: (input: string) => number = () => 0;
  let done = 0;
  let startedAt = 0;
  let clockTimer = 0;
  let countdownTimer = 0;
  let goTimer = 0;
  /** 1回ごとに増やし、前の回の判定結果やタイマーを無視する。 */
  let attempt = 0;
  const elements: {
    sample?: HTMLDivElement | null;
    source?: HTMLTextAreaElement | null;
    typed?: HTMLTextAreaElement | null;
    start?: HTMLButtonElement | null;
    retry?: HTMLButtonElement | null;
    countdown?: HTMLDivElement | null;
    countNumber?: HTMLSpanElement | null;
    ring?: SVGCircleElement | null;
    progress?: HTMLSpanElement | null;
    samplePane?: HTMLElement | null;
    diffs?: HTMLElement | null;
  } = {};

  const status = computed(() => {
    const total = countChars(source.value);
    switch (phase.value) {
      case 'typing':
        return {
          summary: `打っている途中（${progress.value.done} / ${progress.value.total} 文字）`,
          unsaved: false,
        };
      case 'result':
        return result.value
          ? { summary: `前回 ${formatClock(result.value.elapsed, { tenths: true })}` }
          : {};
      default:
        return total ? { summary: `見本 ${total.toLocaleString()} 文字` } : {};
    }
  });

  function stopTimers() {
    clearTimeout(countdownTimer);
    clearTimeout(goTimer);
    clearInterval(clockTimer);
    countdownTimer = goTimer = clockTimer = 0;
  }

  function focusLater(element: () => HTMLElement | null | undefined, select = false) {
    requestAnimationFrame(() => {
      const target = element();
      if (!target || !active) return;
      target.focus({ preventScroll: true });
      if (select && target instanceof HTMLTextAreaElement) {
        target.select();
        target.scrollTop = 0;
      }
    });
  }

  function toSetup({ message = '', select = false } = {}) {
    attempt++;
    stopTimers();
    batch(() => {
      composing.value = false;
      complete.value = false;
      going.value = false;
      phase.value = 'setup';
      note.value = message;
    });
    if (elements.typed) elements.typed.value = '';
    focusLater(
      () => (select || !countChars(source.value) ? elements.source : elements.start),
      select,
    );
  }

  /** 貼り付けを受け取ったことを、見本の枠を一瞬光らせて知らせる。 */
  function acknowledge() {
    if (!motion()) return;
    elements.samplePane?.animate(
      [
        { boxShadow: '0 0 0 4px color-mix(in srgb, var(--tb-gold) 32%, transparent)' },
        { boxShadow: '0 0 0 4px transparent' },
      ],
      { duration: 700, easing: 'ease-out' },
    );
  }

  function setSample(text: string) {
    if (phase.value !== 'setup') toSetup();
    source.value = text;
    note.value = '';
    if (elements.source) {
      elements.source.value = text;
      elements.source.scrollTop = 0;
    }
    acknowledge();
    focusLater(() => elements.start);
  }

  // ── カウントダウン ──

  function renderSample(text: string) {
    const host = elements.sample;
    if (!host) return;
    const fragment = document.createDocumentFragment();
    chars = [];
    let blank = '';
    for (const unit of graphemes(text)) {
      if (isBlank(unit)) {
        blank += unit;
        continue;
      }
      if (blank) fragment.append(blank);
      blank = '';
      const span = document.createElement('span');
      span.className = 'tg-ch';
      span.textContent = unit;
      chars.push(span);
      fragment.append(span);
    }
    host.replaceChildren(fragment);
    host.scrollTop = 0;
    locate = createLocator(text);
    done = 0;
    chars[0]?.classList.add('is-next');
    renderProgress();
  }

  function showCount(n: number) {
    countNumber.value = String(n);
    if (!motion()) return;
    elements.countNumber?.animate(
      [
        { transform: 'scale(1.6)', opacity: 0, filter: 'blur(6px)' },
        { transform: 'scale(1)', opacity: 1, filter: 'blur(0)' },
      ],
      { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
    );
    elements.ring?.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
      duration: 1000,
      easing: 'cubic-bezier(0.4, 0, 0.6, 1)',
      fill: 'forwards',
    });
  }

  function startCountdown() {
    const text = phase.value === 'setup' ? source.value.trim() : sampleText;
    if ((phase.value !== 'setup' && phase.value !== 'result') || countChars(text) === 0) return;
    attempt++;
    stopTimers();
    sampleText = text;
    batch(() => {
      phase.value = 'countdown';
      going.value = false;
      complete.value = false;
      composing.value = false;
      note.value = '';
      result.value = null;
      elapsedText.value = formatClock(0);
    });
    if (elements.typed) {
      elements.typed.value = '';
      elements.typed.readOnly = false;
    }
    renderSample(sampleText);
    focusLater(() => elements.countdown);
    const begin = performance.now();
    const tick = (n: number) => {
      if (n === 0) {
        startTyping();
        return;
      }
      showCount(n);
      const next = begin + (COUNT_FROM - n + 1) * 1000;
      countdownTimer = window.setTimeout(() => tick(n - 1), next - performance.now());
    };
    tick(COUNT_FROM);
  }

  function startTyping() {
    phase.value = 'typing';
    startedAt = performance.now();
    clockTimer = window.setInterval(() => {
      elapsedText.value = formatClock(performance.now() - startedAt);
    }, 250);
    // 「スタート」を一瞬見せて消す。重ねている間も入力の邪魔はしない。
    countNumber.value = 'スタート';
    going.value = true;
    focusLater(() => elements.typed);
    goTimer = window.setTimeout(() => (going.value = false), motion() ? 800 : 400);
  }

  // ── 打っている間 ──

  function renderProgress() {
    const total = chars.length;
    progress.value = { done, total };
    complete.value = total > 0 && done === total;
  }

  /** 次に打つ文字が見本の枠の上のほうに来るよう、見本をスクロールする。 */
  function keepInView() {
    const host = elements.sample;
    const target = chars[done] ?? chars.at(-1);
    if (!host || !target) return;
    const top = target.offsetTop;
    const height = host.clientHeight;
    if (top < host.scrollTop + height * 0.15 || top > host.scrollTop + height * 0.6)
      host.scrollTo({ top: top - height * 0.35, behavior: motion() ? 'smooth' : 'auto' });
  }

  /** 見本の next 文字目まで色を変える。まとめて確定した文字は、少しずつずらして波のように変える。 */
  function setDone(next: number) {
    if (next === done) return;
    chars[done]?.classList.remove('is-next');
    if (next > done) {
      const added = next - done;
      const spread = Math.min(added * 34, 380);
      for (let k = done; k < next; k++) {
        const char = chars[k]!;
        const delay = added > 1 ? ((k - done) / (added - 1)) * spread : 0;
        char.style.setProperty('--tg-delay', `${Math.round(delay)}ms`);
        char.classList.add('is-done');
      }
    } else {
      for (let k = next; k < done; k++) chars[k]!.classList.remove('is-done');
    }
    const forward = next > done;
    done = next;
    chars[done]?.classList.add('is-next');
    renderProgress();
    keepInView();
    if (forward && motion())
      elements.progress?.animate(
        [
          { transform: 'scale(2.4)', opacity: 1 },
          { transform: 'scale(1)', opacity: 0.85 },
        ],
        { duration: 520, easing: 'ease-out', pseudoElement: '::after' },
      );
  }

  /** 変換中の文字は数えない。確定のたびに、余分に打った文字・抜かした文字の分を合わせてまとめて進む。 */
  function updateProgress() {
    if (phase.value !== 'typing' || !elements.typed) return;
    setDone(Math.min(locate(elements.typed.value), chars.length));
  }

  // ── 終了と結果 ──

  async function finish() {
    const elapsed = performance.now() - startedAt;
    stopTimers();
    going.value = false;
    const input = elements.typed?.value ?? '';
    if (countChars(input) === 0) {
      toSetup({ message: '1文字も確定していなかったため、結果は出さずに戻りました。' });
      return;
    }
    elapsedText.value = formatClock(elapsed, { tenths: true });
    if (elements.typed) elements.typed.readOnly = true;
    phase.value = 'judging';
    const current = attempt;
    const judgement = await judge(sampleText, input);
    if (current !== attempt || phase.value !== 'judging') return;
    batch(() => {
      result.value = { elapsed, input, judgement };
      phase.value = 'result';
    });
    const differences = judgement?.differences;
    announce.value =
      `終了しました。かかった時間は${formatSpoken(elapsed)}。` +
      (differences === undefined
        ? '見本と大きく違うため、違う箇所を判定できませんでした。'
        : differences === 0
          ? '見本との違いはありません。'
          : `見本との違いは${differences}か所です。`);
    if (differences === 0) requestAnimationFrame(celebrate);
    focusLater(() => elements.retry);
  }

  /** 違いがなかったときに、数字のまわりへ小さな光を散らす。 */
  function celebrate() {
    const stat = elements.diffs;
    if (!motion() || !stat) return;
    const sparks = 12;
    for (let i = 0; i < sparks; i++) {
      const spark = document.createElement('span');
      spark.className = 'tg-spark';
      const angle = (i / sparks) * Math.PI * 2 + (i % 2) * 0.25;
      const distance = 52 + (i % 3) * 18;
      spark.style.setProperty('--x', `${Math.cos(angle) * distance}px`);
      spark.style.setProperty('--y', `${Math.sin(angle) * distance * 0.7}px`);
      spark.style.setProperty('--d', `${180 + (i % 4) * 50}ms`);
      spark.addEventListener('animationend', () => spark.remove());
      stat.append(spark);
    }
  }

  // ── キー操作・貼り付け ──

  addEventListener('keydown', (event) => {
    if (!active || document.querySelector('dialog[open]')) return;
    if (event.key === 'Escape') {
      // 変換中の Esc は日本語入力の取り消しに任せる。確定した後の Esc だけを終了にする。
      if (event.isComposing || composing.value || event.keyCode === 229) return;
      if (phase.value === 'countdown') {
        event.preventDefault();
        toSetup();
      } else if (phase.value === 'typing') {
        event.preventDefault();
        void finish();
      }
      return;
    }
    if (phase.value === 'setup' && event.key === 'Enter' && hasMod(event)) {
      event.preventDefault();
      startCountdown();
      return;
    }
    // 入力欄の外をクリックした後でも、打ち始めれば入力欄に戻る。
    if (
      phase.value === 'typing' &&
      document.activeElement !== elements.typed &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !['Tab', 'Shift'].includes(event.key)
    )
      elements.typed?.focus();
  });
  // 欄の外にいても、そのまま貼り付けられるようにする。
  document.addEventListener('paste', (event) => {
    if (!active || phase.value !== 'setup' || event.target === elements.source) return;
    if (document.querySelector('dialog[open]')) return;
    const text = event.clipboardData?.getData('text/plain');
    if (!text) return;
    event.preventDefault();
    setSample(text);
  });

  async function readTextFile(file: File) {
    try {
      setSample(await file.text());
    } catch {
      toast(`「${file.name}」を読めませんでした。`, { tone: 'error' });
    }
  }

  function View({ active: visible }: { active: boolean }) {
    active = visible;
    useEffect(() => {
      const typed = elements.typed!;
      const start = () => (composing.value = true);
      const end = () => {
        composing.value = false;
        updateProgress();
      };
      // composition イベントには oncompositionend などの DOM プロパティがなく、
      // Preact の JSX ではイベント名の大文字・小文字が一致しない場合がある。
      // 最後の input が isComposing=true でも、確定の通知で必ず進み具合を更新する。
      typed.addEventListener('compositionstart', start);
      typed.addEventListener('compositionend', end);
      return () => {
        typed.removeEventListener('compositionstart', start);
        typed.removeEventListener('compositionend', end);
      };
    }, []);
    useEffect(() => {
      // カウントダウン中にほかの画面へ移ったら、開始をやめる。打っている間はそのまま時間を数える。
      if (!visible && phase.value === 'countdown') toSetup();
      if (visible && phase.value === 'setup') focusLater(() => elements.source);
    }, [visible]);
    const current = phase.value;
    const { done: doneCount, total } = progress.value;
    const sourceTotal = countChars(source.value);
    const drop = useDropZone<HTMLDivElement>({
      enabled: () => visible && phase.value === 'setup',
      label: () => 'テキストファイルを見本にする',
      onDrop: ({ files }) => {
        const file = files.find(isTextFile);
        if (file) void readTextFile(file);
        else toast('見本にできるのはテキストファイル（.txt・.md）です。', { tone: 'error' });
      },
    });
    return (
      <ToolFrame>
        <div
          class="tg"
          data-state={current}
          data-complete={complete.value ? '' : undefined}
          ref={drop}
        >
          <section
            class="tg-pane"
            aria-labelledby="tg-sample-title"
            ref={(element) => {
              elements.samplePane = element;
            }}
          >
            <div class="tg-pane-head">
              <h2 id="tg-sample-title">見本</h2>
              <span class="tg-count">
                {current === 'setup'
                  ? sourceTotal
                    ? `${sourceTotal.toLocaleString()} 文字`
                    : ''
                  : `${doneCount.toLocaleString()} / ${total.toLocaleString()} 文字`}
              </span>
              <span
                class="tg-progress"
                aria-hidden="true"
                ref={(element) => {
                  elements.progress = element;
                }}
                style={{ '--tg-progress': String(total ? doneCount / total : 0) }}
              />
            </div>
            <div class="tg-pane-body">
              <textarea
                ref={(element) => {
                  elements.source = element;
                }}
                class="tb-input tg-text"
                aria-labelledby="tg-sample-title"
                placeholder={
                  '練習したい文章を、ここに貼り付けます。\n\n漢字まじりの文章のままで構いません。いつもの日本語入力で、変換して確定しながら打ちます。'
                }
                spellcheck={false}
                autocomplete="off"
                hidden={current !== 'setup'}
                // 画面を描く前に受け取った見本（ホームから渡したもの）も、欄に出す。
                value={source.value}
                onInput={(event) => (source.value = (event.target as HTMLTextAreaElement).value)}
                onPaste={() => requestAnimationFrame(acknowledge)}
              />
              <div hidden={current === 'setup'} class="tg-sample-wrap">
                <Host
                  hostRef={(element) => {
                    elements.sample = element;
                  }}
                />
              </div>
            </div>
          </section>

          <section class="tg-pane" aria-labelledby="tg-input-title">
            <div class="tg-pane-head">
              <h2 id="tg-input-title">入力</h2>
              {current === 'typing' && (
                <p
                  class="tg-esc-hint"
                  id="tg-esc-hint"
                  data-composing={composing.value ? '' : undefined}
                >
                  確定後に <kbd>Esc</kbd> で終了
                </p>
              )}
              {(current === 'countdown' || current === 'typing' || current === 'judging') && (
                <span class="tg-elapsed">{elapsedText.value}</span>
              )}
            </div>
            <div class="tg-pane-body">
              {current === 'setup' && (
                <div class="tg-ready">
                  <button
                    type="button"
                    class="tb-button tb-primary tg-start"
                    ref={(element) => {
                      elements.start = element;
                    }}
                    disabled={sourceTotal === 0}
                    onClick={startCountdown}
                  >
                    開始
                  </button>
                  <p class="tg-shortcut">
                    <kbd>{modKey}</kbd> + <kbd>Enter</kbd> でも開始
                  </p>
                  {note.value && (
                    <p class="tg-note" role="status">
                      {note.value}
                    </p>
                  )}
                  <ol class="tg-steps">
                    <li>左の欄に文章を貼り付けます（テキストファイルを置いても入ります）</li>
                    <li>「開始」を押すと、3秒後にスタートします</li>
                    <li>いつもの日本語入力で打ち、確定後に Esc で終了します</li>
                  </ol>
                </div>
              )}
              <textarea
                ref={(element) => {
                  elements.typed = element;
                }}
                class="tb-input tg-text"
                aria-labelledby="tg-input-title"
                aria-describedby="tg-esc-hint"
                placeholder="ここに打ちます"
                spellcheck={false}
                autocomplete="off"
                autocapitalize="off"
                hidden={!['countdown', 'typing', 'judging'].includes(current)}
                disabled={current === 'countdown'}
                onInput={(event) => {
                  if (composing.value || (event as InputEvent).isComposing) return;
                  updateProgress();
                }}
              />
              <div
                class={going.value ? 'tg-countdown is-go' : 'tg-countdown'}
                tabIndex={-1}
                hidden={current !== 'countdown' && !going.value}
                ref={(element) => {
                  elements.countdown = element;
                }}
              >
                <svg class="tg-ring" viewBox="0 0 120 120" aria-hidden="true">
                  <circle class="tg-ring-track" cx="60" cy="60" r="56" />
                  <circle
                    class="tg-ring-bar"
                    cx="60"
                    cy="60"
                    r="56"
                    pathLength="1"
                    ref={(element) => {
                      elements.ring = element;
                    }}
                  />
                </svg>
                <span
                  class="tg-count-number"
                  role="status"
                  ref={(element) => {
                    elements.countNumber = element;
                  }}
                >
                  {countNumber.value}
                </span>
                <span class="tg-countdown-hint">
                  <kbd>Esc</kbd> でやめる
                </span>
              </div>
              {current === 'judging' && <p class="tg-judging">判定しています…</p>}
              {current === 'result' && result.value && (
                <Result
                  result={result.value}
                  diffsRef={(element) => {
                    elements.diffs = element;
                  }}
                  retryRef={(element) => {
                    elements.retry = element;
                  }}
                  onRetry={startCountdown}
                  onNew={() => toSetup({ select: true })}
                />
              )}
            </div>
          </section>
          <p class="tb-sr" role="status">
            {announce.value}
          </p>
        </div>
      </ToolFrame>
    );
  }

  return {
    View,
    status,
    async receive(_intent: string, input: Incoming) {
      if (input.kind === 'text') setSample(input.text);
      else if (input.kind === 'files' && input.files[0]) await readTextFile(input.files[0]);
    },
  };
}

function Result({
  result,
  diffsRef,
  retryRef,
  onRetry,
  onNew,
}: {
  result: { elapsed: number; input: string; judgement: Judgement | undefined };
  diffsRef: (element: HTMLElement | null) => void;
  retryRef: (element: HTMLButtonElement | null) => void;
  onRetry: () => void;
  onNew: () => void;
}) {
  const { elapsed, input, judgement } = result;
  const differences = judgement?.differences;
  const time = useRef<HTMLSpanElement>(null);
  // かかった時間を、0から数え上げるように出す。
  useEffect(() => {
    const final = formatClock(elapsed, { tenths: true });
    const element = time.current;
    if (!element) return;
    if (!motion()) {
      element.textContent = final;
      return;
    }
    const duration = Math.min(900, 360 + elapsed / 200);
    const begin = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - begin) / duration);
      const eased = 1 - (1 - t) ** 3;
      element.textContent = t < 1 ? formatClock(elapsed * eased, { tenths: true }) : final;
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [result]);
  let mark = 0;
  return (
    <div class="tg-result" data-perfect={differences === 0 ? '' : undefined}>
      <div class="tg-summary">
        <div class="tg-stat">
          <span class="tg-stat-label">かかった時間</span>
          <span class="tg-stat-value" aria-hidden="true" ref={time} />
        </div>
        <div class="tg-stat" ref={diffsRef}>
          <span class="tg-stat-label">見本との違い</span>
          <span
            class="tg-stat-value tg-diffs"
            aria-hidden="true"
            data-kind={differences === undefined ? 'unknown' : differences === 0 ? 'none' : 'some'}
          >
            {differences === undefined ? (
              <small>判定できませんでした</small>
            ) : differences === 0 ? (
              'なし'
            ) : (
              <>
                {differences.toLocaleString()}
                <small>か所</small>
              </>
            )}
          </span>
        </div>
        <div class="tg-actions">
          <Button variant="primary" buttonRef={retryRef} onClick={onRetry}>
            もう一度
          </Button>
          <Button onClick={onNew}>別の文章を貼る</Button>
        </div>
      </div>
      {differences ? (
        <p class="tg-legend">
          <span>
            <del class="tg-wrong">転</del> 打ち間違い・余分な文字
          </span>
          <span>
            <ins class="tg-missing">天</ins> 抜けた文字（見本の文字）
          </span>
        </p>
      ) : null}
      {differences === undefined && (
        <p class="tg-result-note">
          見本と大きく違うため、違う箇所を示せませんでした。打った文章をそのまま表示しています。
        </p>
      )}
      <div class="tg-text tg-diff">
        {judgement
          ? judgement.pieces.map((piece, index) =>
              piece.kind === 'typed' ? (
                piece.text
              ) : piece.kind === 'wrong' ? (
                <del
                  key={index}
                  class="tg-wrong"
                  title="見本と違う・余分な文字"
                  style={{ '--tg-order': String(Math.min(mark++, 24)) }}
                >
                  {piece.text}
                </del>
              ) : (
                <ins
                  key={index}
                  class="tg-missing"
                  title="抜けた文字（見本）"
                  style={{ '--tg-order': String(Math.min(mark++, 24)) }}
                >
                  {piece.text}
                </ins>
              ),
            )
          : input}
      </div>
    </div>
  );
}

export const typingGame: ToolDefinition = {
  id: 'typing-game',
  name: 'タイピングゲーム',
  description:
    '好きな文章を貼り付けて日本語入力で打ち、かかった時間と見本と違う箇所を確かめられます。',
  icon,
  intents: [
    {
      id: 'sample',
      label: 'タイピングの見本にする',
      detail: 'タイピングゲーム：この文章を見本にして打つ練習',
      icon: 'keyboard',
      accepts: (input) =>
        (input.kind === 'text' && countChars(input.text) > 0) ||
        (input.kind === 'files' && input.files.length === 1 && isTextFile(input.files[0]!)),
      mayAccept: (hint) => hint.count === 1 && hint.types.some((type) => type.startsWith('text/')),
    },
  ],
  create,
};
