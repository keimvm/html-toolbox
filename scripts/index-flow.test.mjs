import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FLOW_KEY, setupFlowToggle } from './index-flow.js';

function fakeFlowToggle({ storage = new Map() } = {}) {
  const win = new EventTarget();
  function fail() {
    throw new Error('SecurityError');
  }
  win.localStorage = {
    getItem: (key) => (storage ? (storage.get(key) ?? null) : fail()),
    setItem: (key, value) => (storage ? storage.set(key, value) : fail()),
    removeItem: (key) => (storage ? storage.delete(key) : fail()),
  };
  const button = Object.assign(new EventTarget(), {
    title: '',
    setAttribute(name, value) {
      this[name] = value;
    },
  });
  const changes = [];
  setupFlowToggle(button, (on) => changes.push(on), { window: win });
  return { win, button, storage, changes };
}

test('setupFlowToggle は既定で流し、止めたことを保存し、動かしたら記録を消す', () => {
  const { button, storage, changes } = fakeFlowToggle();
  assert.deepEqual(changes, [true]);
  assert.equal(button['aria-pressed'], 'true');
  assert.equal(button.title, '背景の流れを止める');

  button.dispatchEvent(new Event('click'));
  assert.deepEqual(changes, [true, false]);
  assert.equal(storage.get(FLOW_KEY), 'off');
  assert.equal(button['aria-pressed'], 'false');
  assert.equal(button.title, '背景の流れを動かす');

  button.dispatchEvent(new Event('click'));
  assert.deepEqual(changes, [true, false, true]);
  assert.equal(storage.has(FLOW_KEY), false);
});

test('setupFlowToggle は保存済みの停止と、別の画面での切り替えを反映する', () => {
  const { win, button, storage, changes } = fakeFlowToggle({
    storage: new Map([[FLOW_KEY, 'off']]),
  });
  assert.deepEqual(changes, [false]);
  assert.equal(button['aria-pressed'], 'false');
  storage.delete(FLOW_KEY);
  win.dispatchEvent(Object.assign(new Event('storage'), { key: FLOW_KEY }));
  assert.deepEqual(changes, [false, true]);
});

test('setupFlowToggle は保存できない環境でも画面の中で切り替える', () => {
  const { button, changes } = fakeFlowToggle({ storage: null });
  button.dispatchEvent(new Event('click'));
  button.dispatchEvent(new Event('click'));
  assert.deepEqual(changes, [true, false, true]);
});
