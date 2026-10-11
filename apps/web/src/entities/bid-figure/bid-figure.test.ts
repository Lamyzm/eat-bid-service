import { describe, expect, test } from 'bun:test';

import { assessmentRateText, bidFigure } from './bid-figure';

const position = (amount: string, baseRelative: string) => ({
  amount: { amount, currency: 'KRW' as const },
  baseRelativeRate: { value: baseRelative, unit: 'percentage-points' as const }
});

describe('eaT에 넣는 소수', () => {
  test('사정률은 기초금액 대비 %를 하한율로 나눈 값이고 소수 셋째 자리까지 정확히 쓴다', () => {
    // 7,761,885원 = 8,756,540 × 90% × 98.49% — 아버지가 eaT에 넣는 사정률이다.
    expect(assessmentRateText('88.6410', '90.000')).toBe('98.490');
    expect(assessmentRateText('86.5480', '88.000')).toBe('98.350');
    expect(assessmentRateText('90.0000', '90.000')).toBe('100.000');
  });

  test('나누어떨어지지 않는 조합은 사정률을 지어내지 않는다', () => {
    // 서버는 기초금액 대비 %가 소수 넷째 자리에서 끝나는 배수만 낸다. 그 전제가 깨진 값을 반올림해 보이면 틀린 소수를 넣게 된다.
    expect(assessmentRateText('88.6411', '90.000')).toBeNull();
    expect(assessmentRateText('88.6410', '0.000')).toBeNull();
  });

  test('한 자리를 사정률·기초금액 대비 %·확인용 금액으로 바꾸고 복사 값에는 쉼표와 단위가 없다', () => {
    expect(bidFigure(position('7761885.00', '88.6410'), '90.000')).toEqual({
      assessmentRate: '98.490',
      baseRelative: '88.641',
      amount: '7,761,885원',
      amountCopy: '7761885'
    });
  });

  test('하한율을 모르면 사정률 없이 기초금액 대비 %와 금액만 낸다', () => {
    expect(bidFigure(position('7761885.00', '88.6410'), null).assessmentRate).toBeNull();
  });
});
