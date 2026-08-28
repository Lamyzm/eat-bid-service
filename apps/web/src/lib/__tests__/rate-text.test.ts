// 막는 사고: 투찰률이 조용히 다른 값이 되던 것.
// 90.06 → 9006 (점 소실), 90.099 → 90.09 (절삭). 아버지가 엉뚱한 금액으로 투찰한다.
import { expect, test } from 'bun:test';
import { nextRateText, commitRateText } from '../rate-text';

const text = (raw: string) => {
  const e = nextRateText(raw);
  return e.kind === 'reject' ? 'REJECT' : e.text;
};
const value = (raw: string) => {
  const e = nextRateText(raw);
  return e.kind === 'reject' ? 'REJECT' : e.value;
};

test('타이핑 중 점이 사라지지 않는다', () => {
  expect(text('90.')).toBe('90.');      // 점을 남긴다
  expect(value('90.')).toBeUndefined(); // 아직 부모에 넘기지 않는다
  expect(value('90.0')).toBe(90.0);
  expect(value('90.06')).toBe(90.06);
});

test('소수 3~4자리를 자르지 않는다', () => {
  expect(value('90.099')).toBe(90.099);
  expect(value('87.7459')).toBe(87.7459);
  expect(value('90.999')).toBe(90.999);
});

test('5번째 소수 자리는 무시한다 (자르지 않는다)', () => {
  expect(text('87.74591')).toBe('REJECT');
});

test('숫자와 점만 받는다', () => {
  expect(text('9O.06')).toBe('REJECT');
  expect(text('90..1')).toBe('REJECT');
  expect(text('-90')).toBe('REJECT');
});

test('경계값', () => {
  expect(value('100')).toBe(100);
  expect(value('89.5')).toBe(89.5); // 하한 아래도 입력은 된다. 경고는 화면이 한다
  expect(value('')).toBeUndefined();
});

test('포커스가 빠져도 값이 바뀌지 않는다', () => {
  expect(commitRateText('90.099')).toEqual({ text: '90.099', value: 90.099 });
  expect(commitRateText('')).toEqual({ text: '', value: undefined });
});
