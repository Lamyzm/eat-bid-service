import { describe, expect, test } from 'bun:test';

import { decimalScale, scaledText, sumAtScale } from './decimal-sum';

describe('소수 문자열 합계', () => {
  test('가장 긴 소수 자릿수에 맞춰 정확히 더하고 천 단위로 끊는다', () => {
    const values = ['32.7', '39.6', '19.3', '3.4'];
    const scale = decimalScale(values);
    expect(scale).toBe(1);
    // Number로 더하면 95.00000000000001이 된다.
    expect(scaledText(sumAtScale(values, scale), scale)).toBe('95.0');
    expect(scaledText(sumAtScale(['1234.5', '0.25'], 2), 2)).toBe('1,234.75');
  });

  test('정수만 있으면 소수점 없이 쓰고 0보다 작은 소수도 앞자리 0을 붙인다', () => {
    expect(scaledText(sumAtScale(['634', '681', '450', '73'], 0), 0)).toBe('1,838');
    expect(scaledText(sumAtScale(['0.05'], 2), 2)).toBe('0.05');
  });
});
