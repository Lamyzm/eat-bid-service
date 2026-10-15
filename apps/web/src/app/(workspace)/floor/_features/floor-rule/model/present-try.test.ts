import { describe, expect, test } from 'bun:test';

import { QUANTILES } from '@/app/(workspace)/floor/__fixtures__/floor-lines';
import { presentTry, tryValueBasePercent } from './present-try';

describe('이 값으로 넣으면', () => {
  test('사정률과 기초금액 대비 % 어느 쪽으로 넣어도 같은 값으로 읽고 범위 밖은 오타로 본다', () => {
    expect(tryValueBasePercent('100.000', 'rate')).toBeCloseTo(90, 9);
    expect(tryValueBasePercent('90.000', 'base')).toBe(90);
    expect(tryValueBasePercent('', 'rate')).toBeNull();
    expect(tryValueBasePercent('9000', 'base')).toBeNull();
    expect(tryValueBasePercent('abc', 'rate')).toBeNull();
  });

  test('하한 미달 확률을 20번 중 몇 번으로 말하고 고른 지역 실제 기록을 나란히 둔다', () => {
    const points = [89.5, 89.8, 90.2, 90.6].map((floor, index) => ({
      attemptId: String(index + 1),
      t: index,
      month: '2026-09',
      opened: '',
      date: '2026.9.1',
      floor,
      organization: null,
      baseAmount: 10_000_000
    }));
    const view = presentTry({ basePercent: 90, quantiles: QUANTILES.map(Number), points, place: '경남 김해시', rounds: 108126 });
    expect(view.lead).toBe('사정률 100.000(기초금액의 90.000%)로 넣으면 하한 미달이 되는 건 ');
    // 20번 중 몇 번은 확률을 반올림한 값이라 퍼센트와 어긋나 보이지 않게 '약'을 붙인다.
    expect(view.strong).toMatch(/^20번 중 약 \d+번\(\d+%\)$/);
    expect(view.detail).toContain('경남 김해시 고른 기간 실제 4건에서는 50%(2건)');
    expect(view.detail).toContain('기초금액 1억이면 이 값은 9,000만 원이에요.');
  });
});
