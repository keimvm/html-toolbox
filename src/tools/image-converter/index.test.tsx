// @vitest-environment jsdom
// 画像の描画・変換は模擬し、文字入力からツールの未保存状態への受け渡しを確かめる。
import { render, type ComponentChildren } from 'preact';
import { act } from 'preact/test-utils';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';

vi.mock('../../app/frame', () => ({
  ToolFrame: ({ children }: { children: ComponentChildren }) => children,
}));
vi.mock('../../engine/pdf/client', () => ({ pdfEngine: vi.fn() }));
vi.mock('../../lib/download', () => ({ downloadBlob: vi.fn() }));
vi.mock('./paint', () => ({
  MARK_FONT: 'sans-serif',
  measureLine: (line: string, size: number) => line.length * size,
  paintMarks: vi.fn(),
}));
vi.mock('./convert', () => ({
  decode: async () => ({ width: 2000, height: 1000, close() {} }),
  drawEdited: (_source: unknown, _edits: unknown, size: { width: number; height: number }) => size,
  convert: async () => ({
    blob: new Blob(['png']),
    thumbnail: new Blob(['thumbnail']),
    format: 'png',
    auto: true,
    quality: null,
    fits: true,
    width: 1920,
    height: 960,
  }),
}));

let imageConverter: typeof import('./index').imageConverter;

beforeAll(async () => {
  // jsdom には Pointer Events の属性がないため、Preact がブラウザーと同じ小文字のイベントを登録できるようにする。
  for (const type of ['pointerdown', 'pointerup'])
    Object.defineProperty(HTMLElement.prototype, `on${type}`, { configurable: true, value: null });
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL() {
        return 'blob:example';
      }
      static revokeObjectURL() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(644);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(344);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  ({ imageConverter } = await import('./index'));
});

afterAll(() => {
  for (const type of ['pointerdown', 'pointerup'])
    Reflect.deleteProperty(HTMLElement.prototype, `on${type}`);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('保存済みの画像に入力した文字は、確定する前から未保存と終了時の確認に反映する', async () => {
  const tool = imageConverter.create();
  const { View } = tool;
  const host = document.createElement('div');
  document.body.append(host);
  try {
    act(() => render(<View active={true} />, host));
    await act(async () => {
      await tool.receive!('add', {
        kind: 'files',
        files: [new File(['image'], 'example.png', { type: 'image/png' })],
      });
    });
    const save = () => host.querySelector<HTMLButtonElement>('.ic-panel-actions .tb-primary')!;
    await vi.waitFor(() => expect(save().disabled).toBe(false));
    act(() => save().click());
    expect(tool.status.value).toMatchObject({ unsaved: false, guard: false });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 't' }));
    });
    const frame = host.querySelector<HTMLDivElement>('.ic-frame')!;
    frame.setPointerCapture = vi.fn();
    act(() => {
      frame.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      frame.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    });
    const input = host.querySelector<HTMLTextAreaElement>('.ic-text-input')!;
    expect(input).not.toBeNull();
    const type = (text: string) =>
      act(() => {
        input.value = text;
        input.dispatchEvent(new InputEvent('input', { bubbles: true }));
      });
    expect(tool.status.value).toMatchObject({ unsaved: false, guard: false });
    type('追記');
    expect(tool.status.value).toMatchObject({ unsaved: true, guard: true });
    expect(tool.status.value.summary).toContain('未保存 1枚');
    type('');
    expect(tool.status.value).toMatchObject({ unsaved: false, guard: false });
    type('追記');
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(tool.status.value).toMatchObject({ unsaved: true, guard: true });
    await vi.waitFor(() => expect(save().disabled).toBe(false));
    act(() => save().click());
    expect(tool.status.value).toMatchObject({ unsaved: false, guard: false });

    // 保存した文字を開いただけなら未保存にせず、書き換えを元に戻したときも確認を外す。
    act(() => {
      frame.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    const reopened = host.querySelector<HTMLTextAreaElement>('.ic-text-input')!;
    expect(reopened.value).toBe('追記');
    expect(tool.status.value).toMatchObject({ unsaved: false, guard: false });
    act(() => {
      reopened.value = '書き換え';
      reopened.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    expect(tool.status.value).toMatchObject({ unsaved: true, guard: true });
    act(() => {
      reopened.value = '追記';
      reopened.dispatchEvent(new InputEvent('input', { bubbles: true }));
    });
    expect(tool.status.value).toMatchObject({ unsaved: false, guard: false });
  } finally {
    act(() => render(<View active={false} />, host));
    act(() => render(null, host));
    host.remove();
  }
});
