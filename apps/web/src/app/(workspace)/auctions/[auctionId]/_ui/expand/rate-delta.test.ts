import { describe, expect, test } from 'bun:test';

import { toMilli } from '../../_model/bid-rate';
import { rateDeltaText } from './rate-delta';

describe('낙찰 − 내 값 차이 문구', () => {
  test('낙찰이 내 값보다 높으면 + 부호, 낮으면 − 부호로 세 자리 %p를 적는다', () => {
    expect(rateDeltaText(toMilli('90.141'), toMilli('90.309'))).toBe('−0.168');
    expect(rateDeltaText(toMilli('90.894'), toMilli('90.309'))).toBe('+0.585');
  });

  test('같은 값은 부호 없이 0.000이다', () => {
    expect(rateDeltaText(toMilli('90.309'), toMilli('90.309'))).toBe('0.000');
  });

  test('정수부를 넘는 차이도 자리 잃지 않고 적는다', () => {
    expect(rateDeltaText(toMilli('92.005'), toMilli('90.309'))).toBe('+1.696');
    expect(rateDeltaText(toMilli('88.000'), toMilli('90.309'))).toBe('−2.309');
  });
});
