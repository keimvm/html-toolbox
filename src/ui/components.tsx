// 画面の共通部品。見た目は theme.css、開閉や操作は標準の dialog・popover に任せる。
import { signal } from '@preact/signals';
import type { ComponentChildren, JSX, Ref } from 'preact';
import { useEffect, useId, useLayoutEffect, useRef } from 'preact/hooks';
import { Icon, type IconName } from './icons';

const classes = (...names: (string | false | null | undefined)[]) =>
  names.filter(Boolean).join(' ');

type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger' | 'primary-danger';

export type ButtonProps = Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'icon' | 'size'> & {
  variant?: ButtonVariant;
  size?: 'small' | 'large';
  icon?: IconName;
  buttonRef?: Ref<HTMLButtonElement>;
};

export function Button({
  variant = 'secondary',
  size,
  icon,
  class: className,
  children,
  buttonRef,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      ref={buttonRef}
      type={type}
      class={classes(
        'tb-button',
        variant === 'primary' && 'tb-primary',
        variant === 'secondary' && 'tb-secondary',
        variant === 'danger' && 'tb-danger',
        variant === 'primary-danger' && 'tb-primary tb-danger',
        size && `tb-${size}`,
        className as string,
      )}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

/** アイコンだけのボタン。label を読み上げ名とツールチップにする。 */
export function IconButton({
  icon,
  label,
  class: className,
  variant = 'quiet',
  ...rest
}: Omit<ButtonProps, 'icon' | 'children'> & { icon: IconName; label: string }) {
  return (
    <Button
      variant={variant}
      class={classes('tb-icon-button', className as string)}
      icon={icon}
      aria-label={label}
      title={label}
      {...rest}
    />
  );
}

/** 標準の dialog をモーダルで開く。open が偽になるか、Escape・閉じるボタンで閉じる。 */
export function Dialog({
  open,
  onClose,
  title,
  children,
  actions,
  class: className,
  busy = false,
  labelledBy,
  initialFocus,
}: {
  open: boolean;
  onClose: () => void;
  title?: ComponentChildren;
  children?: ComponentChildren;
  actions?: ComponentChildren;
  class?: string;
  /** 処理中は Escape で閉じない。 */
  busy?: boolean;
  labelledBy?: string;
  /** 開いたときにフォーカスする要素の CSS セレクター。 */
  initialFocus?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      if (initialFocus) dialog.querySelector<HTMLElement>(initialFocus)?.focus();
    } else if (!open && dialog.open) dialog.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      class={classes('tb-dialog', className)}
      aria-labelledby={labelledBy ?? (title ? titleId : undefined)}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
    >
      {open && (
        <>
          {title && (
            <h2 class="tb-dialog-title" id={titleId}>
              {title}
            </h2>
          )}
          {children}
          {actions && <div class="tb-dialog-actions">{actions}</div>}
        </>
      )}
    </dialog>
  );
}

let anchors = 0;
/**
 * ボタンと、それで開くメニュー。開閉・排他・外側クリック・Escape は popover="auto"、配置は CSS のアンカー配置に任せる。
 * メニューの中のボタンを押したら閉じる。
 */
export function Menu({
  label,
  icon = 'more',
  text,
  children,
  class: className,
  buttonClass,
  disabled,
  variant = 'quiet',
  placement,
}: {
  label: string;
  icon?: IconName;
  /** ボタンに文字も出す。 */
  text?: ComponentChildren;
  children: ComponentChildren;
  class?: string;
  buttonClass?: string;
  disabled?: boolean;
  variant?: ButtonVariant;
  placement?: 'bottom-start' | 'bottom-end';
}) {
  const id = useId();
  const anchor = useRef(`--tb-menu-${++anchors}`);
  const panel = useRef<HTMLDivElement>(null);
  return (
    <>
      <Button
        variant={variant}
        class={classes(!text && 'tb-icon-button', buttonClass)}
        icon={icon}
        aria-label={text ? undefined : label}
        title={label}
        disabled={disabled}
        popovertarget={id}
        style={{ anchorName: anchor.current } as JSX.CSSProperties}
      >
        {text}
        {text && <Icon name="chevron-down" class="tb-menu-caret" />}
      </Button>
      <div
        ref={panel}
        id={id}
        popover="auto"
        class={classes('tb-popover', className)}
        style={
          {
            positionAnchor: anchor.current,
            positionArea: placement === 'bottom-start' ? 'bottom span-right' : undefined,
          } as JSX.CSSProperties
        }
        onClick={(event) => {
          if ((event.target as Element).closest('button:not([data-keep-open])'))
            panel.current?.hidePopover();
        }}
      >
        {children}
      </div>
    </>
  );
}

export function MenuItem({
  icon,
  children,
  note,
  ...rest
}: JSX.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName; note?: ComponentChildren }) {
  return (
    <button type="button" class="tb-menu-item" {...rest}>
      {icon ? <Icon name={icon} /> : <span class="tb-icon" />}
      <span>{children}</span>
      {note && <span class="tb-menu-note">{note}</span>}
    </button>
  );
}

export const MenuSeparator = () => <hr class="tb-menu-separator" />;
export const MenuLabel = ({ children }: { children: ComponentChildren }) => (
  <div class="tb-menu-label">{children}</div>
);

export function Field({
  label,
  hint,
  error,
  children,
  class: className,
}: {
  label: ComponentChildren;
  hint?: ComponentChildren;
  error?: ComponentChildren;
  children: ComponentChildren;
  class?: string;
}) {
  return (
    <label class={classes('tb-field', className)}>
      <span class="tb-label">{label}</span>
      {children}
      {hint && <span class="tb-hint">{hint}</span>}
      {error && (
        <span class="tb-error" role="alert">
          {error}
        </span>
      )}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  name,
  disabled,
}: {
  value: T;
  options: readonly { value: T; label: ComponentChildren; title?: string }[];
  onChange: (value: T) => void;
  label: string;
  name?: string;
  disabled?: boolean;
}) {
  const group = useId();
  return (
    <div class="tb-segmented" role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <label key={option.value} title={option.title}>
          <input
            type="radio"
            name={name ?? group}
            value={option.value}
            checked={option.value === value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}

/** 何もないときの案内。大きな見出しと説明、操作のボタンを中央に置く。 */
export function EmptyState({
  icon,
  title,
  children,
  actions,
  note,
}: {
  icon: IconName;
  title: ComponentChildren;
  children?: ComponentChildren;
  actions?: ComponentChildren;
  note?: ComponentChildren;
}) {
  return (
    <div class="tb-empty">
      <div class="tb-empty-mark">
        <Icon name={icon} />
      </div>
      <h2 class="tb-empty-title">{title}</h2>
      {children && <div class="tb-empty-text">{children}</div>}
      {actions && <div class="tb-empty-actions">{actions}</div>}
      {note && <p class="tb-empty-note">{note}</p>}
    </div>
  );
}

// ── 知らせ ──

export interface ToastOptions {
  tone?: 'info' | 'error' | 'success';
  action?: { label: string; run: () => void };
  /** 表示しておくミリ秒。0 なら閉じるまで出す。 */
  duration?: number;
}
interface ToastItem extends ToastOptions {
  id: number;
  message: string;
}
const toastItems = signal<ToastItem[]>([]);
let toastSequence = 0;

/** 画面の下に短い知らせを出す。読み上げにも伝える。 */
export function toast(message: string, options: ToastOptions = {}) {
  const id = ++toastSequence;
  const duration = options.duration ?? (options.tone === 'error' || options.action ? 8000 : 3200);
  // 同じ文言が続いたら、重ねずに出し直す。
  toastItems.value = [
    ...toastItems.value.filter((item) => item.message !== message).slice(-2),
    { id, message, ...options },
  ];
  if (duration) setTimeout(() => dismissToast(id), duration);
  return id;
}
export function dismissToast(id: number) {
  toastItems.value = toastItems.value.filter((item) => item.id !== id);
}

export function Toasts() {
  return (
    <div class="tb-toasts" role="status" aria-live="polite">
      {toastItems.value.map((item) => (
        <div key={item.id} class="tb-toast" data-tone={item.tone}>
          <span class="tb-toast-text">{item.message}</span>
          {item.action && (
            <Button
              variant="secondary"
              onClick={() => {
                dismissToast(item.id);
                item.action!.run();
              }}
            >
              {item.action.label}
            </Button>
          )}
          <IconButton
            icon="x"
            label="閉じる"
            class="tb-small"
            onClick={() => dismissToast(item.id)}
          />
        </div>
      ))}
    </div>
  );
}

// ── 確認のダイアログ ──

export interface Choice<T extends string> {
  value: T;
  label: string;
  variant?: ButtonVariant;
  /**
   * 押した直後に同期で呼ぶ処理。ブラウザーの許可の要求など、利用者の操作の直後に始める必要がある処理に使う。
   * 戻り値は ask() の結果の detail になる。
   */
  start?: () => unknown;
}
interface AskState {
  title: string;
  text?: ComponentChildren;
  choices: Choice<string>[];
  stack?: boolean;
  resolve: (result: { value: string; detail?: unknown }) => void;
}
const asking = signal<AskState | null>(null);

/** 選択肢を出して選ばせる。Escape は最後の選択肢（ふつうは「キャンセル」）。 */
export function ask<T extends string>(
  title: string,
  text: ComponentChildren,
  choices: Choice<T>[],
  { stack = false } = {},
): Promise<{ value: T; detail?: unknown }> {
  asking.value?.resolve({ value: asking.value.choices.at(-1)!.value });
  return new Promise((resolve) => {
    asking.value = {
      title,
      text,
      choices: choices as Choice<string>[],
      stack,
      resolve: resolve as AskState['resolve'],
    };
  });
}

/** 「よろしいですか」の確認。進めるなら true。 */
export async function confirmAction(
  title: string,
  text: ComponentChildren,
  { ok = 'OK', danger = false } = {},
) {
  const { value } = await ask(title, text, [
    { value: 'ok', label: ok, variant: danger ? 'primary-danger' : 'primary' },
    { value: 'cancel', label: 'キャンセル' },
  ]);
  return value === 'ok';
}

export function AskHost() {
  const state = asking.value;
  const finish = (value: string, detail?: unknown) => {
    if (asking.value !== state || !state) return;
    asking.value = null;
    state.resolve({ value, detail });
  };
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // 取り消し・キャンセルの選択肢にフォーカスし、うっかり Enter で進めないようにする。
    ref.current?.querySelector<HTMLElement>('[data-default]')?.focus();
  }, [state]);
  return (
    <Dialog
      open={Boolean(state)}
      onClose={() => state && finish(state.choices.at(-1)!.value)}
      title={state?.title}
    >
      {state && (
        <div ref={ref}>
          {state.text && <div class="tb-dialog-text">{state.text}</div>}
          <div class={classes('tb-dialog-actions', state.stack && 'tb-stack')}>
            {state.choices.map((choice, index) => (
              <Button
                key={choice.value}
                variant={choice.variant ?? 'secondary'}
                data-default={index === state.choices.length - 1 ? '' : undefined}
                onClick={() => finish(choice.value, choice.start?.())}
              >
                {choice.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </Dialog>
  );
}
