import { describe, expect, test } from 'bun:test';
import type { AnalysisMeta, AnalysisTimeSeriesV1Response } from '@eatbid/contracts/api/v1/analysis';
import { presentTimeSeries } from './present-time-series';

const filter = {
  targetOrganizationId: '41',
  excludeAttemptId: null,
  period: { from: '2026-08-01', to: '2026-08-31' },
  dateBasis: 'opened',
  comparisonScope: { kind: 'national' },
  floorRate: { value: '90.000', unit: 'percentage-points' },
  awardMethodCodeValueId: '31',
  listCountRange: { min: null, max: null },
  targetItemFilter: { kind: 'all' }
} as const;

const lineage = {
  buildId: '501',
  sourceReleaseId: '00000000-0000-0000-0000-000000000141',
  calcVersion: 'mart-r10',
  computedAt: '2026-09-01T00:00:00Z',
  coverage: 'unknown',
  regionScheme: null
} as const;

const readyMeta = {
  state: 'ready',
  effectiveFilter: filter,
  snapshot: {
    sourceCutoffAt: '2026-09-01T00:00:00Z',
    issuedAt: '2026-09-02T00:00:00Z',
    expiresAt: '2026-09-03T00:00:00Z',
    observationPolicyVersion: 'awarded-attempt-v1',
    builds: [{ purpose: 'observations', lineage }]
  },
  targetSampleCount: 2,
  comparisonSampleCount: 40,
  overlapCount: 2,
  periodCoverage: [{ period: filter.period, target: 'unknown', comparison: 'unknown' }],
  freshness: { state: 'unknown', checkedAt: null }
} satisfies AnalysisMeta;

const axis = {
  period: filter.period,
  timeResolution: 'day',
  rateBinWidth: { value: '0.100', unit: 'percentage-points' }
} as const;

const point = (attemptId: string, plottedAt: string, rate: string) => ({
  attemptId,
  revisionId: attemptId,
  plottedAt,
  assessmentRate: { value: rate, unit: 'percentage-points' } as const
});

function series(response: AnalysisTimeSeriesV1Response) {
  return presentTimeSeries({ kind: 'series', response });
}

describe('분석 시간축 표시 모델', () => {
  test('없는 모집단은 표본 0이 아니라 조건을 고치라는 갈래로 온다', () => {
    expect(presentTimeSeries({ kind: 'cohort-not-found' })).toEqual({ kind: 'cohort-not-found' });
  });

  test('자료가 아직 없으면 사용자가 할 일을 말하는 문구를 갖는다', () => {
    const view = series({
      axis: null,
      target: null,
      targetTruncated: false,
      comparison: null,
      meta: { state: 'unavailable', effectiveFilter: filter, reason: 'snapshot-unavailable' }
    });
    expect(view).toEqual({ kind: 'unavailable', reason: '이 조건의 분석 자료가 아직 만들어지지 않았어요.' });
  });

  test('두 집단이 모두 비면 축을 만들지 않고 빈 상태로 말한다', () => {
    const view = series({
      axis,
      target: [],
      targetTruncated: false,
      comparison: { kind: 'points', points: [], truncated: false },
      meta: { ...readyMeta, targetSampleCount: 0, comparisonSampleCount: 0, overlapCount: 0 }
    });
    expect(view.kind).toBe('empty');
  });

  test('사정률 십진 문자열을 milli 정수로 옮기고 부동소수를 거치지 않는다', () => {
    const view = series({
      axis,
      target: [point('12', '2026-08-03T15:00:00Z', '90.123')],
      targetTruncated: false,
      comparison: { kind: 'points', points: [], truncated: false },
      meta: readyMeta
    });
    if (view.kind !== 'plot') throw new Error('plot이어야 한다');
    expect(view.plot.target[0]?.y).toBe(90_123);
    // 점의 이름은 KST 달력일이다. UTC로 읽으면 하루가 밀린다.
    expect(view.plot.target[0]?.label).toBe('2026-08-04 사정률 90.123%');
  });

  test('세로 범위는 두 집단의 관측을 모두 덮는다', () => {
    const view = series({
      axis,
      target: [point('12', '2026-08-03T15:00:00Z', '90.000')],
      targetTruncated: false,
      comparison: {
        kind: 'density',
        cells: [{
          fromAt: '2026-08-03T15:00:00Z',
          toAt: '2026-08-04T15:00:00Z',
          rateFrom: { value: '95.000', unit: 'percentage-points' },
          rateTo: { value: '95.100', unit: 'percentage-points' },
          count: 7
        }],
        truncated: false
      },
      meta: readyMeta
    });
    if (view.kind !== 'plot') throw new Error('plot이어야 한다');
    // 비교군의 극단값이 그림 밖으로 나가면 "범위 밖 극단값을 숨기지 않는다"는 약속이 깨진다.
    expect(view.plot.domain.yFrom).toBeLessThan(90_000);
    expect(view.plot.domain.yTo).toBeGreaterThan(95_100);
    expect(view.plot.comparison.kind).toBe('density');
  });

  test('관측이 한 점뿐이어도 눈금이 설 최소 폭을 준다', () => {
    const view = series({
      axis,
      target: [point('12', '2026-08-03T15:00:00Z', '90.000')],
      targetTruncated: false,
      comparison: { kind: 'points', points: [], truncated: false },
      meta: readyMeta
    });
    if (view.kind !== 'plot') throw new Error('plot이어야 한다');
    expect(view.plot.domain.yTo - view.plot.domain.yFrom).toBeGreaterThan(0);
    expect(view.plot.yTicks).toHaveLength(5);
  });

  test('잘린 사실은 그림이 아니라 글로 말하고 무엇을 하라고 적는다', () => {
    const truncated = series({
      axis,
      target: [point('12', '2026-08-03T15:00:00Z', '90.000')],
      targetTruncated: true,
      comparison: { kind: 'points', points: [], truncated: false },
      meta: readyMeta
    });
    if (truncated.kind !== 'plot') throw new Error('plot이어야 한다');
    expect(truncated.plot.truncation).toBe('기관 기록이 많아 일부만 그렸어요. 기간을 좁혀 주세요.');

    const whole = series({
      axis,
      target: [point('12', '2026-08-03T15:00:00Z', '90.000')],
      targetTruncated: false,
      comparison: { kind: 'points', points: [], truncated: false },
      meta: readyMeta
    });
    if (whole.kind !== 'plot') throw new Error('plot이어야 한다');
    expect(whole.plot.truncation).toBeNull();
  });

  test('표본 수는 그린 점 수가 아니라 meta의 전체 수를 그대로 쓴다', () => {
    const view = series({
      axis,
      target: [point('12', '2026-08-03T15:00:00Z', '90.000')],
      targetTruncated: true,
      comparison: { kind: 'points', points: [], truncated: false },
      meta: readyMeta
    });
    if (view.kind !== 'plot') throw new Error('plot이어야 한다');
    // 잘린 뒤의 수를 표본 수로 말하면 화면이 실제보다 작은 모집단을 말한다.
    expect(view.plot.targetCount).toBe(2);
    expect(view.plot.comparisonCount).toBe(40);
    expect(view.plot.target).toHaveLength(1);
  });
});
