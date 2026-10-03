import '../../../ui/theme.css';
import './style.css';
import { setupToolHeader } from '../../../ui/header.js';
import { countChars, graphemes, isBlank, judge, type Judgement } from './judge';
import { formatClock, formatSpoken } from './time';

function $<T extends Element = HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`画面の要素が見つかりません: ${selector}`);
  return element;
}
// 保存した配色を最初に反映する。
setupToolHeader($('.tg-header'));

/** setup：文章を貼る、countdown：3秒、typing：打っている間、judging：判定中、result：結果。 */
type State = 'setup' | 'countdown' | 'typing' | 'judging' | 'result';

const COUNT_FROM = 3;

const main = $('#tg-main');
const samplePane = $('#tg-sample-pane');
const source = $<HTMLTextAreaElement>('#tg-source');
const sampleView = $('#tg-sample');
const count = $('#tg-count');
const progress = $('#tg-progress');
const ready = $('#tg-ready');
const startButton = $<HTMLButtonElement>('#tg-start');
const note = $('#tg-note');
const typed = $<HTMLTextAreaElement>('#tg-typed');
const escHint = $('#tg-esc-hint');
const elapsedView = $('#tg-elapsed');
const countdown = $('#tg-countdown');
const countNumber = $('#tg-count-number');
const ringBar = $<SVGCircleElement>('#tg-ring-bar');
const judging = $('#tg-judging');
const resultView = $('#tg-result');
const timeView = $('#tg-time');
const diffsStat = $('#tg-diffs-stat');
const diffsView = $('#tg-diffs');
const legend = $('#tg-legend');
const resultNote = $('#tg-result-note');
const diffView = $('#tg-diff');
const retryButton = $<HTMLButtonElement>('#tg-retry');
const newButton = $<HTMLButtonElement>('#tg-new');
const announce = $('#tg-announce');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const motion = () => !reducedMotion.matches;

$('#tg-modifier').textContent = /Mac|iPhone|iPad/u.test(navigator.userAgent)
  ? '⌘'
  : 'Ctrl';

let state: State = 'setup';
/** 打っている見本（前後の改行・空白を除いたもの）。 */
let sampleText = '';
/** 見本の文字（改行・空白を除く）の要素。確定した数だけ先頭から色を変える。 */
let chars: HTMLElement[] = [];
/** 色を変えた文字の数。 */
let done = 0;
let composing = false;
let startedAt = 0;
let clockTimer: number | undefined;
let countdownTimer: number | undefined;
let goTimer: number | undefined;
/** 1回ごとに増やし、前の回の判定結果やタイマーを無視する。 */
let attempt = 0;

function setState(next: State) {
  state = next;
  main.dataset.state = next;
  source.hidden = next !== 'setup';
  ready.hidden = next !== 'setup';
  sampleView.hidden = next === 'setup';
  typed.hidden = !['countdown', 'typing', 'judging'].includes(next);
  escHint.hidden = next !== 'typing';
  elapsedView.hidden = !['countdown', 'typing', 'judging'].includes(next);
  judging.hidden = next !== 'judging';
  resultView.hidden = next !== 'result';
  if (next !== 'typing') countdown.hidden = next !== 'countdown';
}

function stopTimers() {
  clearTimeout(countdownTimer);
  clearTimeout(goTimer);
  clearInterval(clockTimer);
  countdownTimer = goTimer = clockTimer = undefined;
}

// ── 文章を貼る ──

function updateSourceCount() {
  const total = countChars(source.value);
  count.textContent = total ? `${total.toLocaleString()} 文字` : '';
  startButton.disabled = total === 0;
}

function toSetup({ message = '', select = false } = {}) {
  attempt++;
  stopTimers();
  composing = false;
  typed.value = '';
  delete main.dataset.complete;
  setState('setup');
  note.textContent = message;
  updateSourceCount();
  if (select) {
    source.focus();
    source.select();
    source.scrollTop = 0;
  } else if (startButton.disabled) {
    source.focus();
  } else {
    startButton.focus();
  }
}

/** 貼り付けを受け取ったことを、見本の枠を一瞬光らせて知らせる。 */
function acknowledgePaste() {
  if (!motion()) return;
  samplePane.animate(
    [
      {
        boxShadow:
          '0 0 0 4px color-mix(in srgb, var(--tb-gold) 32%, transparent)',
      },
      { boxShadow: '0 0 0 4px transparent' },
    ],
    { duration: 700, easing: 'ease-out' },
  );
}

source.addEventListener('input', updateSourceCount);
source.addEventListener('paste', () => {
  // 貼り付けた内容が反映されてから数える。
  requestAnimationFrame(() => {
    updateSourceCount();
    acknowledgePaste();
  });
});
// 欄の外にいても、そのまま貼り付けられるようにする。
document.addEventListener('paste', (event) => {
  if (state !== 'setup' || event.target === source) return;
  const text = event.clipboardData?.getData('text/plain');
  if (!text) return;
  event.preventDefault();
  source.value = text;
  source.focus();
  source.setSelectionRange(0, 0);
  source.scrollTop = 0;
  updateSourceCount();
  acknowledgePaste();
});
startButton.addEventListener('click', () => startCountdown());

// ── カウントダウン ──

function renderSample(text: string) {
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
  sampleView.replaceChildren(fragment);
  sampleView.scrollTop = 0;
  done = 0;
  chars[0]?.classList.add('is-next');
  renderProgress();
}

function showCount(n: number) {
  countNumber.textContent = String(n);
  if (!motion()) return;
  countNumber.animate(
    [
      { transform: 'scale(1.6)', opacity: 0, filter: 'blur(6px)' },
      { transform: 'scale(1)', opacity: 1, filter: 'blur(0)' },
    ],
    { duration: 420, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  );
  ringBar.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
    duration: 1000,
    easing: 'cubic-bezier(0.4, 0, 0.6, 1)',
    fill: 'forwards',
  });
}

function startCountdown() {
  const text = state === 'setup' ? source.value.trim() : sampleText;
  if ((state !== 'setup' && state !== 'result') || countChars(text) === 0) {
    return;
  }
  attempt++;
  stopTimers();
  sampleText = text;
  renderSample(sampleText);
  typed.value = '';
  typed.disabled = true;
  typed.readOnly = false;
  composing = false;
  delete escHint.dataset.composing;
  delete main.dataset.complete;
  delete resultView.dataset.perfect;
  note.textContent = '';
  elapsedView.textContent = formatClock(0);
  countdown.classList.remove('is-go');
  setState('countdown');
  // ボタンが消えてもフォーカスが迷子にならないよう、入力欄の枠へ置いておく。
  countdown.tabIndex = -1;
  countdown.focus({ preventScroll: true });

  const begin = performance.now();
  const tick = (n: number) => {
    if (n === 0) {
      startTyping();
      return;
    }
    showCount(n);
    const next = begin + (COUNT_FROM - n + 1) * 1000;
    countdownTimer = window.setTimeout(
      () => tick(n - 1),
      next - performance.now(),
    );
  };
  tick(COUNT_FROM);
}

function startTyping() {
  setState('typing');
  typed.disabled = false;
  typed.focus();
  startedAt = performance.now();
  clockTimer = window.setInterval(updateClock, 250);
  // 「スタート」を一瞬見せて消す。重ねている間も入力の邪魔はしない。
  countNumber.textContent = 'スタート';
  countdown.classList.add('is-go');
  goTimer = window.setTimeout(
    () => {
      countdown.hidden = true;
      countdown.classList.remove('is-go');
    },
    motion() ? 800 : 400,
  );
}

function updateClock() {
  elapsedView.textContent = formatClock(performance.now() - startedAt);
}

// ── 打っている間 ──

function renderProgress() {
  const total = chars.length;
  progress.style.setProperty('--tg-progress', String(total ? done / total : 0));
  count.textContent = `${done.toLocaleString()} / ${total.toLocaleString()} 文字`;
  main.toggleAttribute('data-complete', total > 0 && done === total);
}

/** 次に打つ文字が見本の枠の上のほうに来るよう、見本をスクロールする。 */
function keepInView() {
  const target = chars[done] ?? chars.at(-1);
  if (!target) return;
  const top = target.offsetTop;
  const height = sampleView.clientHeight;
  if (
    top < sampleView.scrollTop + height * 0.15 ||
    top > sampleView.scrollTop + height * 0.6
  ) {
    sampleView.scrollTo({
      top: top - height * 0.35,
      behavior: motion() ? 'smooth' : 'auto',
    });
  }
}

/** 確定した文字の数まで見本の色を変える。まとめて確定した文字は、少しずつずらして波のように変える。 */
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
  if (forward && motion()) {
    progress.animate(
      [
        { transform: 'scale(2.4)', opacity: 1 },
        { transform: 'scale(1)', opacity: 0.85 },
      ],
      { duration: 520, easing: 'ease-out', pseudoElement: '::after' },
    );
  }
}

/** 変換中の文字は数えない。確定のたびにまとめて進む。 */
function updateProgress() {
  if (state !== 'typing') return;
  setDone(Math.min(countChars(typed.value), chars.length));
}

typed.addEventListener('compositionstart', () => {
  composing = true;
  escHint.dataset.composing = '';
});
typed.addEventListener('compositionend', () => {
  composing = false;
  delete escHint.dataset.composing;
  updateProgress();
});
typed.addEventListener('input', (event) => {
  if ((event as InputEvent).isComposing) return;
  updateProgress();
});

// ── 終了と結果 ──

async function finish() {
  const elapsed = performance.now() - startedAt;
  stopTimers();
  countdown.hidden = true;
  const input = typed.value;
  if (countChars(input) === 0) {
    toSetup({
      message: '1文字も確定していなかったため、結果は出さずに戻りました。',
    });
    return;
  }
  elapsedView.textContent = formatClock(elapsed, { tenths: true });
  typed.readOnly = true;
  setState('judging');
  const current = attempt;
  const judgement = await judge(sampleText, input);
  if (current !== attempt || state !== 'judging') return;
  showResult(elapsed, input, judgement);
}

/** かかった時間を、0から数え上げるように出す。 */
function countUp(elapsed: number) {
  const final = formatClock(elapsed, { tenths: true });
  if (!motion()) {
    timeView.textContent = final;
    return;
  }
  const duration = Math.min(900, 360 + elapsed / 200);
  const begin = performance.now();
  const current = attempt;
  const frame = (now: number) => {
    if (current !== attempt) return;
    const t = Math.min(1, (now - begin) / duration);
    const eased = 1 - (1 - t) ** 3;
    timeView.textContent =
      t < 1 ? formatClock(elapsed * eased, { tenths: true }) : final;
    if (t < 1) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

/** 違いがなかったときに、数字のまわりへ小さな光を散らす。 */
function celebrate() {
  if (!motion()) return;
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
    diffsStat.append(spark);
  }
}

function renderDiff(input: string, judgement: Judgement | undefined) {
  if (!judgement) {
    diffView.textContent = input;
    return;
  }
  const fragment = document.createDocumentFragment();
  let mark = 0;
  for (const piece of judgement.pieces) {
    if (piece.kind === 'typed') {
      fragment.append(piece.text);
      continue;
    }
    const element = document.createElement(
      piece.kind === 'wrong' ? 'del' : 'ins',
    );
    element.className = piece.kind === 'wrong' ? 'tg-wrong' : 'tg-missing';
    element.title =
      piece.kind === 'wrong' ? '見本と違う・余分な文字' : '抜けた文字（見本）';
    element.textContent = piece.text;
    element.style.setProperty('--tg-order', String(Math.min(mark++, 24)));
    fragment.append(element);
  }
  diffView.replaceChildren(fragment);
}

function showResult(
  elapsed: number,
  input: string,
  judgement: Judgement | undefined,
) {
  setState('result');
  countUp(elapsed);
  renderDiff(input, judgement);
  diffView.scrollTop = 0;
  const differences = judgement?.differences;
  legend.hidden = !differences;
  resultNote.hidden = differences !== undefined;
  const small = (text: string) =>
    Object.assign(document.createElement('small'), { textContent: text });
  if (differences === undefined) {
    diffsView.dataset.kind = 'unknown';
    diffsView.replaceChildren(small('判定できませんでした'));
  } else if (differences === 0) {
    diffsView.dataset.kind = 'none';
    diffsView.replaceChildren('なし');
    resultView.dataset.perfect = '';
    celebrate();
  } else {
    diffsView.dataset.kind = 'some';
    diffsView.replaceChildren(differences.toLocaleString(), small('か所'));
  }
  announce.textContent =
    `終了しました。かかった時間は${formatSpoken(elapsed)}。` +
    (differences === undefined
      ? '見本と大きく違うため、違う箇所を判定できませんでした。'
      : differences === 0
        ? '見本との違いはありません。'
        : `見本との違いは${differences}か所です。`);
  retryButton.focus();
}

retryButton.addEventListener('click', () => startCountdown());
newButton.addEventListener('click', () => toSetup({ select: true }));

// ── キー操作 ──

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    // 変換中の Esc は日本語入力の取り消しに任せる。確定した後の Esc だけを終了にする。
    if (event.isComposing || composing || event.keyCode === 229) return;
    if (state === 'countdown') {
      event.preventDefault();
      toSetup();
    } else if (state === 'typing') {
      event.preventDefault();
      void finish();
    }
    return;
  }
  if (
    state === 'setup' &&
    event.key === 'Enter' &&
    (event.metaKey || event.ctrlKey)
  ) {
    event.preventDefault();
    startCountdown();
    return;
  }
  // 入力欄の外をクリックした後でも、打ち始めれば入力欄に戻る。
  if (
    state === 'typing' &&
    document.activeElement !== typed &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !['Tab', 'Shift'].includes(event.key)
  ) {
    typed.focus();
  }
});

setState('setup');
updateSourceCount();
source.focus();
