import assert from 'node:assert/strict';
import { test } from 'node:test';
import { arrangeCards, savedCards } from './index-cards.js';

const dirs = ['a', 'b', 'c'];

test('保存がなければ tools.json の順で全部表示する', () => {
  assert.deepEqual(arrangeCards(dirs, null), { order: dirs, hidden: new Set() });
  assert.deepEqual(arrangeCards(dirs, 'x'), { order: dirs, hidden: new Set() });
});

test('保存した並びと非表示を使い、なくなったツールは無視、増えたツールは最後に表示する', () => {
  const { order, hidden } = arrangeCards(dirs, { order: ['c', 'x', 'a', 'c'], hidden: ['b', 'y'] });
  assert.deepEqual(order, ['c', 'a', 'b']);
  assert.deepEqual([...hidden], ['b']);
});

test('並べ替えていなければ、非表示だけを保存して以後の一覧の順に従う', () => {
  const { order } = arrangeCards(['a', 'b', 'new', 'c'], { hidden: ['b'] });
  assert.deepEqual(order, ['a', 'b', 'new', 'c']);
});

test('既定と同じなら保存を消し、違う部分だけを残す', () => {
  assert.equal(savedCards(dirs, dirs, new Set()), null);
  assert.deepEqual(savedCards(dirs, dirs, new Set(['c', 'a'])), { hidden: ['a', 'c'] });
  assert.deepEqual(savedCards(dirs, ['b', 'a', 'c'], new Set()), { order: ['b', 'a', 'c'] });
});
