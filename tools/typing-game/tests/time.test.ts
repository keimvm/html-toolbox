import { expect, test } from 'vitest';
import { formatClock, formatSpoken } from '../src/time';

test('打っている間は秒まで、切り捨てで出す', () => {
  expect(formatClock(0)).toBe('0:00');
  expect(formatClock(7999)).toBe('0:07');
  expect(formatClock(754_500)).toBe('12:34');
  expect(formatClock(3_723_400)).toBe('1:02:03');
  expect(formatClock(-5)).toBe('0:00');
});

test('結果は0.1秒まで出す', () => {
  expect(formatClock(7999, { tenths: true })).toBe('0:07.9');
  expect(formatClock(754_500, { tenths: true })).toBe('12:34.5');
  expect(formatClock(3_723_400, { tenths: true })).toBe('1:02:03.4');
});

test('読み上げ用の表記', () => {
  expect(formatSpoken(7000)).toBe('7.0秒');
  expect(formatSpoken(754_500)).toBe('12分34.5秒');
  expect(formatSpoken(3_600_000)).toBe('1時間0分0.0秒');
  expect(formatSpoken(3_723_400)).toBe('1時間2分3.4秒');
});
