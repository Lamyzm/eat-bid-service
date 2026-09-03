import { describe, expect, test } from 'bun:test';

import { bidAmount, formatWon, parseBidRate, stepBidRate } from './bid-rate';

describe('투찰률 산술', () => {
  test('손잡이는 소수 셋째 자리에서 정확히 더하고 뺀다', () => {
    expect(stepBidRate('90.309', '+0.001')).toBe('90.310');
    expect(stepBidRate('90.309', '-0.01')).toBe('90.299');
    expect(stepBidRate('89.999', '+0.001')).toBe('90.000');
  });

  test('0 미만이나 100 초과로는 움직이지 않는다', () => {
    expect(stepBidRate('0.005', '-0.01')).toBe('0.000');
    expect(stepBidRate('99.995', '+0.01')).toBe('100.000');
  });

  test('직접 입력은 셋째 자리로 고정하고 잘못된 값은 null이다', () => {
    expect(parseBidRate('90.3')).toBe('90.300');
    expect(parseBidRate(' 90.3091 ')).toBe('90.309');
    expect(parseBidRate('abc')).toBeNull();
    expect(parseBidRate('101')).toBeNull();
  });

  test('넣을 금액은 기초금액 × 투찰률을 원 단위로 내림하며 Number를 거치지 않는다', () => {
    expect(bidAmount('2761700.00', '90.309')).toBe('2494064');
    expect(bidAmount('9007199254740993.50', '90.000')).toBe('8106479329266894');
    expect(formatWon('2494064')).toBe('2,494,064');
  });
});
