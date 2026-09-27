import { describe, expect, test } from 'bun:test';
import type { AnalysisDistributionV1Response } from '@eatbid/contracts/api/v1/analysis';
import { presentDistribution } from './present-distribution';

const rate = (value: string) => ({ value, unit: 'percentage-points' as const });
const build = {
  buildId: '501',
  sourceReleaseId: null,
  calcVersion: null,
  computedAt: null,
  coverage: null,
  regionScheme: null
};

function response(
  overrides: Partial<AnalysisDistributionV1Response> = {}
): AnalysisDistributionV1Response {
  return {
    bins: [
      { from: rate('90.000'), to: rate('90.100'), targetCount: 2, comparisonCount: 60 },
      { from: rate('90.100'), to: rate('90.200'), targetCount: 1, comparisonCount: 20 }
    ],
    targetOutside: { below: 0, above: 1 },
    comparisonOutside: { below: 5, above: 15 },
    meta: { targetTotal: 4, comparisonTotal: 100, build },
    ...overrides
  };
}

describe('낙찰값 분포 표시', () => {
  test('위에서 아래로 높은 사정률이고 맨 위는 구간 이상, 맨 아래는 하한 미만이다', () => {
    const view = presentDistribution({ kind: 'distribution', response: response() });
    if (view.kind !== 'plot') throw new Error('plot이어야 한다');
    expect(view.rows.map((row) => row.label)).toEqual([
      '90.2↑',
      '90.1–90.2',
      '90.0–90.1',
      '하한 미만'
    ]);
  });

  test('비중의 분모는 구간 밖까지 포함한 집단 전체다', () => {
    // 보이는 칸만으로 나누면 밖의 회차가 없는 것처럼 100%가 된다.
    const view = presentDistribution({ kind: 'distribution', response: response() });
    if (view.kind !== 'plot') throw new Error('plot이어야 한다');
    const lowest = view.rows[2]!;
    expect(lowest.comparisonShareText).toBe('60.0%');
    expect(lowest.targetShareText).toBe('50.0%');
  });

  test('막대 길이는 두 집단이 같은 척도를 쓰고 가장 큰 비중이 끝까지 찬다', () => {
    const view = presentDistribution({ kind: 'distribution', response: response() });
    if (view.kind !== 'plot') throw new Error('plot이어야 한다');
    expect(view.rows[2]!.comparisonWidth).toBe(1);
    expect(view.rows[2]!.targetWidth).toBeCloseTo(0.5 / 0.6, 5);
  });

  test('자료가 없으면 0으로 채우지 않고 준비 전이라고 말한다', () => {
    const view = presentDistribution({
      kind: 'distribution',
      response: response({
        bins: [],
        meta: { targetTotal: 0, comparisonTotal: 0, build: { ...build, buildId: null } }
      })
    });
    expect(view.kind).toBe('unavailable');
  });
});
