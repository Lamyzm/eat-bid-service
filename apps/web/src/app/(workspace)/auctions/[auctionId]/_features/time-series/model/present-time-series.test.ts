import { describe, expect, test } from 'bun:test';
import type {
  AnalysisFilterValue,
  AnalysisMeta,
  AnalysisTimeSeriesV1Response
} from '@eatbid/contracts/api/v1/analysis';
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
  itemFilter: { kind: 'all' },
  overlayOrganizationIds: []
} satisfies AnalysisFilterValue;

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

/** 겹쳐 찍은 기관은 이 표시 모델의 관심사가 아니라 기본값으로 채운다. 그 갈래는 차트 쪽 시험이 본다. */
function series(response: Omit<AnalysisTimeSeriesV1Response, 'overlays'>) {
  return presentTimeSeries({ kind: 'series', response: { ...response, overlays: [] } });
}

describe('분석 시간축 표시 모델', () => {
  test('없는 모집단은 표본 0이 아니라 조건을 고치라는 갈래로 온다', () => {
    expect(presentTimeSeries({ kind: 'cohort-not-found' })).toEqual({ kind: 'cohort-not-found' });
  });

  test('조회가 실패한 것과 자료가 아직 없는 것을 다른 갈래로 말한다', () => {
    // 서버가 "아직 발행 안 됐다"고 말해 준 것과, 우리가 아무것도 못 들은 것은 사용자가 할 일이 다르다.
    expect(presentTimeSeries({ kind: 'read-failed' })).toEqual({ kind: 'read-failed' });
    expect(presentTimeSeries({ kind: 'cohort-not-found' })).not.toEqual({ kind: 'read-failed' });
  });

  test('자료가 아직 없으면 사용자가 할 일을 말하는 문구를 갖는다', () => {
    const view = series({
      axis: null,
      target: null,
      targetTruncated: false,
      comparison: null,
      meta: { state: 'unavailable', effectiveFilter: filter, reason: 'snapshot-unavailable' }
    });
    expect(view).toEqual({
      kind: 'unavailable',
      reason: '이 조건의 분석 자료가 아직 만들어지지 않았어요.'
    });
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
    // 그린 것이 없어도 "조건에 맞는 관측이 0건"은 사실이다. 수가 없으면 화면이 미발행과 같게 말한다.
    if (view.kind !== 'empty') throw new Error('empty여야 한다');
    expect(view.targetCount).toBe(0);
    expect(view.comparisonCount).toBe(0);
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

  test('전체 축은 두 집단의 관측을 모두 덮는다', () => {
    const view = series({
      axis,
      target: [point('12', '2026-08-03T15:00:00Z', '90.000')],
      targetTruncated: false,
      comparison: {
        kind: 'density',
        cells: [
          {
            fromAt: '2026-08-03T15:00:00Z',
            toAt: '2026-08-04T15:00:00Z',
            rateFrom: { value: '95.000', unit: 'percentage-points' },
            rateTo: { value: '95.100', unit: 'percentage-points' },
            count: 7
          }
        ],
        truncated: false
      },
      meta: readyMeta
    });
    if (view.kind !== 'plot') throw new Error('plot이어야 한다');
    // 비교군의 극단값이 그림 밖으로 나가면 "범위 밖 극단값을 숨기지 않는다"는 약속이 깨진다.
    expect(view.plot.fullDomain.yFrom).toBeLessThan(90_000);
    expect(view.plot.fullDomain.yTo).toBeGreaterThan(95_100);
    expect(view.plot.comparison.kind).toBe('density');
  });

  test('기본 축은 가운데 덩어리에 맞추고 벗어난 관측은 수로 센다', () => {
    // 한쪽으로 크게 벗어난 값 하나가 축을 늘리면 나머지 전부가 한 줄로 뭉개진다. 기본 축은 가운데에
    // 맞추되 밀려난 관측은 숫자로 남아야 한다.
    const crowd = Array.from({ length: 60 }, (_, index) =>
      point(`c${index}`, '2026-08-10T01:00:00Z', '95.000')
    );
    const view = series({
      axis,
      target: [
        point('12', '2026-08-03T15:00:00Z', '90.000'),
        point('13', '2026-08-20T01:00:00Z', '130.000')
      ],
      targetTruncated: false,
      comparison: { kind: 'points', points: crowd, truncated: false },
      meta: readyMeta
    });
    if (view.kind !== 'plot') throw new Error('plot이어야 한다');
    expect(view.plot.domain.yTo).toBeLessThan(130_000);
    expect(view.plot.domain.yFrom).toBeGreaterThan(90_000);
    expect(view.plot.outsideTarget).toEqual({ above: 1, below: 1 });
    expect(view.plot.outsideComparison).toEqual({ above: 0, below: 0 });
    // 전체 축으로 바꾸면 밀려난 것이 없다.
    expect(view.plot.fullDomain.yTo).toBeGreaterThan(130_000);
    expect(view.plot.fullDomain.yFrom).toBeLessThan(90_000);
    expectRoundTicks(view.plot.fullYTicks, view.plot.fullDomain);
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
    // 0.1%p 칸 열 개가 최소 폭이다. 더 좁히면 눈금 다섯 개가 아무 차이도 아닌 간격을 큰 차이처럼
    // 보이게 만들고, 그 점이 축의 어디쯤인지도 알 수 없다.
    expect(view.plot.domain.yTo - view.plot.domain.yFrom).toBeGreaterThanOrEqual(1_000);
    expect(view.plot.domain.yFrom).toBeLessThan(90_000);
    expect(view.plot.domain.yTo).toBeGreaterThan(90_000);
    expectRoundTicks(view.plot.yTicks, view.plot.domain);
  });

  test('눈금은 사람이 읽는 자리(0.1%p 등)에 서고 축 양끝도 눈금이다', () => {
    // 범위를 다섯 등분하면 88.504·88.852 같은 값에 눈금이 선다(2026-09-25 dev 실측). 점의 값을 읽을 기준이 없다.
    const view = series({
      axis,
      target: [
        point('12', '2026-08-03T15:00:00Z', '88.504'),
        point('13', '2026-08-20T01:00:00Z', '89.896')
      ],
      targetTruncated: false,
      comparison: { kind: 'points', points: [], truncated: false },
      meta: readyMeta
    });
    if (view.kind !== 'plot') throw new Error('plot이어야 한다');
    expectRoundTicks(view.plot.yTicks, view.plot.domain);
    expect(view.plot.yTicks.map((tick) => tick.label)).toEqual([
      '88.0',
      '88.5',
      '89.0',
      '89.5',
      '90.0',
      '90.5'
    ]);
  });

  test('하한은 축 범위를 늘리지 않고 표시 모델에 따로 실린다', () => {
    const view = presentTimeSeries(
      {
        kind: 'series',
        response: {
          axis,
          target: [point('12', '2026-08-03T15:00:00Z', '90.010')],
          targetTruncated: false,
          comparison: { kind: 'points', points: [], truncated: false },
          meta: readyMeta,
          overlays: []
        }
      },
      '87.500'
    );
    if (view.kind !== 'plot') throw new Error('plot이어야 한다');
    expect(view.plot.floor).toEqual({ y: 87_500, label: '하한 87.500' });
    // 하한을 담으려고 축을 늘리면 낙찰점이 한 줄로 뭉친다. 범위 밖이라는 사실은 화면이 글로 말한다.
    expect(view.plot.domain.yFrom).toBeGreaterThan(87_500);
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

/** 모든 눈금이 한 간격의 배수이고 축 양끝이 눈금과 같으며, 라벨이 읽을 만큼만 촘촘하다. */
function expectRoundTicks(
  ticks: readonly { readonly y: number; readonly label: string }[],
  domain: { readonly yFrom: number; readonly yTo: number }
): void {
  expect(ticks.length).toBeGreaterThanOrEqual(2);
  expect(ticks.length).toBeLessThanOrEqual(8);
  const step = ticks[1]!.y - ticks[0]!.y;
  expect([10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000]).toContain(step);
  for (const tick of ticks) expect(tick.y % step).toBe(0);
  expect(ticks[0]!.y).toBe(domain.yFrom);
  expect(ticks.at(-1)!.y).toBe(domain.yTo);
}
