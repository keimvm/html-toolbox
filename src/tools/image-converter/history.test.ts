import { expect, test } from 'vitest';
import { noEdits, type Edits } from './geometry';
import { emptyHistory, redo, remember, sameEdits, snapshot, undo } from './history';

const arrow = (id: number) =>
  ({
    id,
    kind: 'arrow',
    color: 'red',
    size: 'm',
    unit: 1000,
    from: [0, 0],
    to: [10, 10],
  }) as const;

test('取り消すと変える前の編集に戻り、やり直すと取り消す前に戻る', () => {
  const history = emptyHistory();
  let edits: Edits = noEdits();
  remember(history, edits);
  edits = { ...edits, rotation: 90 };
  remember(history, edits);
  edits = { ...edits, marks: [{ ...arrow(1), from: [0, 0], to: [10, 10] }] };

  edits = undo(history, edits)!;
  expect(edits).toEqual({ rotation: 90, crop: null, marks: [] });
  edits = undo(history, edits)!;
  expect(edits).toEqual(noEdits());
  expect(undo(history, edits)).toBeNull();

  edits = redo(history, edits)!;
  expect(edits.rotation).toBe(90);
  edits = redo(history, edits)!;
  expect(edits.marks).toHaveLength(1);
  expect(redo(history, edits)).toBeNull();
});

test('取り消したあとに別の変更をすると、やり直しの分は捨てる', () => {
  const history = emptyHistory();
  let edits: Edits = noEdits();
  remember(history, edits);
  edits = { ...edits, rotation: 90 };
  edits = undo(history, edits)!;
  remember(history, edits);
  edits = { ...edits, rotation: 270 };
  expect(redo(history, edits)).toBeNull();
  expect(undo(history, edits)).toEqual(noEdits());
});

test('積んだ編集は写しで、あとから編集を書き換えても変わらない', () => {
  const history = emptyHistory();
  const edits: Edits = { ...noEdits(), marks: [{ ...arrow(1), from: [0, 0], to: [10, 10] }] };
  remember(history, edits);
  edits.marks.push({ ...arrow(2), from: [1, 1], to: [2, 2] });
  (edits.marks[0] as { to: [number, number] }).to = [99, 99];
  expect(history.past[0]!.marks).toEqual([{ ...arrow(1), from: [0, 0], to: [10, 10] }]);
  expect(sameEdits(snapshot(edits), edits)).toBe(true);
  expect(sameEdits(history.past[0]!, edits)).toBe(false);
});

test('取り消せるのは1枚につき 100 回まで（古いものから捨てる）', () => {
  const history = emptyHistory();
  for (let rotation = 0; rotation < 105; rotation++)
    remember(history, { ...noEdits(), crop: { x: rotation, y: 0, width: 1, height: 1 } });
  expect(history.past).toHaveLength(100);
  expect(history.past[0]!.crop?.x).toBe(5);
});
