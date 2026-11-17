import { describe, expect, test } from 'bun:test';

import { formatCount, formatPercent, formatWon, groupDigits } from './number-format';

describe('숫자 표기 주인(number-format)', () => {
  test('세 자리마다 쉼표를 넣고 소수부·부호는 그대로 둔다', () => {
    expect(groupDigits('1234567')).toBe('1,234,567');
    expect(groupDigits('-1234.5678')).toBe('-1,234.5678');
    expect(groupDigits(BigInt('12345678901234567890'))).toBe('12,345,678,901,234,567,890');
    expect(groupDigits(999)).toBe('999');
  });

  test('숫자가 아닌 글은 손대지 않는다', () => {
    expect(groupDigits('—')).toBe('—');
  });

  test('건·원·% 단위를 붙인다', () => {
    expect(formatCount(1200)).toBe('1,200건');
    expect(formatCount(3, '곳')).toBe('3곳');
    expect(formatWon('7761885')).toBe('7,761,885원');
    expect(formatPercent('89.685')).toBe('89.685%');
  });
});
