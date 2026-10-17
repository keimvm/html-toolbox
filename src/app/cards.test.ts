import { expect, test } from 'vitest';
import { arrangeCards, savedCards } from './cards';

const ids = ['a', 'b', 'c'];

test('保存がなければ既定の順で全部表示する', () => {
  expect(arrangeCards(ids, null)).toEqual({ order: ids, hidden: new Set() });
  expect(arrangeCards(ids, 'x' as never)).toEqual({ order: ids, hidden: new Set() });
});

test('保存した並びと非表示を使い、なくなったツールは無視、増えたツールは最後に表示する', () => {
  const { order, hidden } = arrangeCards(ids, { order: ['c', 'x', 'a', 'c'], hidden: ['b', 'y'] });
  expect(order).toEqual(['c', 'a', 'b']);
  expect([...hidden]).toEqual(['b']);
});

test('並べ替えていなければ、非表示だけを保存して以後の一覧の順に従う', () => {
  const { order } = arrangeCards(['a', 'b', 'new', 'c'], { hidden: ['b'] });
  expect(order).toEqual(['a', 'b', 'new', 'c']);
});

test('既定と同じなら保存を消し、違う部分だけを残す（旧 toolbox と同じ形）', () => {
  expect(savedCards(ids, ids, new Set())).toBeNull();
  expect(savedCards(ids, ids, new Set(['c', 'a']))).toEqual({ hidden: ['a', 'c'] });
  expect(savedCards(ids, ['b', 'a', 'c'], new Set())).toEqual({ order: ['b', 'a', 'c'] });
});
