/** @module 책임: 분석 시간축 조회(findAnalysisTimeSeries) 하나만 재현하는 브라우저 검증 전용 fixture 응답기다.
 * auction-contract-fixture-server.ts가 300줄을 넘지 않도록 시간축 응답만 이 모듈이 소유한다. */
import {
  analysisV1Operations,
  analysisTimeSeriesV1ResponseSchema
} from '@eatbid/contracts/api/v1/analysis';

const operation = analysisV1Operations.findTimeSeries;

const rate = (value: string) => ({ value, unit: 'percentage-points' }) as const;

/**
 * 남산초 실관측을 닮은 다섯 회차다. 넷은 90.0 언저리에 모여 있고 하나(`91.870`)만 멀리 떨어져 있다 —
 * 가운데 값에 맞춘 기본 축과 `전체 값 보기`가 실제로 다른 그림을 그리는지 브라우저에서 보려면 축을
 * 끌고 갈 값 하나가 필요하다.
 */
const TARGET_POINTS: ReadonlyArray<readonly [string, string, string]> = [
  ['9101', '2026-03-12T01:30:00Z', '90.010'],
  ['9102', '2026-04-23T01:30:00Z', '90.080'],
  ['9103', '2026-05-28T01:30:00Z', '89.960'],
  ['9104', '2026-07-09T01:30:00Z', '90.120'],
  ['9105', '2026-08-20T01:30:00Z', '91.870']
];

/** 비교군은 좁은 기간이라 점으로 온다. 기관 점과 겹치는 둘을 포함해 `겹침` 수가 0이 아니게 둔다. */
const COMPARISON_POINTS: ReadonlyArray<readonly [string, string, string]> = [
  ['9101', '2026-03-12T01:30:00Z', '90.010'],
  ['9102', '2026-04-23T01:30:00Z', '90.080'],
  ['9201', '2026-03-20T01:30:00Z', '90.040'],
  ['9202', '2026-04-02T01:30:00Z', '89.990'],
  ['9203', '2026-05-15T01:30:00Z', '90.150'],
  ['9204', '2026-06-11T01:30:00Z', '90.030'],
  ['9205', '2026-07-24T01:30:00Z', '90.060'],
  ['9206', '2026-08-06T01:30:00Z', '89.940'],
  ['9207', '2026-09-02T01:30:00Z', '90.200']
];

function pointOf([attemptId, plottedAt, value]: readonly [string, string, string]) {
  return { attemptId, revisionId: attemptId, plottedAt, assessmentRate: rate(value) };
}

/**
 * 요청 query를 그대로 되돌려 `effectiveFilter`를 만든다. 화면의 맥락 줄과 조건 막대가 같은 값을
 * 말하는지 보려면 fixture가 자기 값을 고집하지 않고 사용자가 고른 조건을 비춰야 한다.
 */
function effectiveFilterOf(searchParams: URLSearchParams) {
  const scope = searchParams.get('comparisonScope') === 'region'
    ? {
        kind: 'region' as const,
        scheme: searchParams.get('comparisonRegionScheme') ?? 'eat:auction-location-sido',
        codeValueId: searchParams.get('comparisonRegionCodeValueId') ?? '41'
      }
    : { kind: 'national' as const };
  const item = searchParams.get('targetItemCodeValueId');
  const excludeAttemptId = searchParams.get('excludeAttemptId');
  const listCount = (key: string) => {
    const value = searchParams.get(key);
    return value === null ? null : Number(value);
  };
  return {
    targetOrganizationId: searchParams.get('organizationId') ?? '3101',
    excludeAttemptId,
    period: {
      from: searchParams.get('from') ?? '2025-10-01',
      to: searchParams.get('to') ?? '2026-09-18'
    },
    dateBasis: searchParams.get('dateBasis') ?? 'opened',
    comparisonScope: scope,
    floorRate: rate(searchParams.get('floorRate') ?? '90.000'),
    awardMethodCodeValueId: searchParams.get('awardMethodCodeValueId') ?? '31',
    listCountRange: { min: listCount('listCountMin'), max: listCount('listCountMax') },
    targetItemFilter: item === null ? { kind: 'all' as const } : { kind: 'code' as const, codeValueId: item }
  };
}

export function analysisTimeSeriesResponse(request: Request): Response | undefined {
  const { pathname, searchParams } = new URL(request.url);
  if (pathname !== operation.openApiPath) return undefined;

  const effectiveFilter = effectiveFilterOf(searchParams);
  // 명단 하한을 아주 높게 잡은 요청은 조건에 맞는 회차가 없는 상태다. 빈 배열과 0건은 `unavailable`과
  // 다른 갈래라 화면이 "조건을 풀어 보라"고 말해야 한다(AGENTS 3).
  const empty = (effectiveFilter.listCountRange.min ?? 0) > 100;
  const target = empty ? [] : TARGET_POINTS.map(pointOf);
  const comparison = empty ? [] : COMPARISON_POINTS.map(pointOf);

  return Response.json(analysisTimeSeriesV1ResponseSchema.parse({
    axis: {
      period: effectiveFilter.period,
      timeResolution: 'day',
      rateBinWidth: null
    },
    target,
    targetTruncated: false,
    comparison: { kind: 'points', points: comparison, truncated: false },
    meta: {
      state: 'ready',
      effectiveFilter,
      snapshot: {
        sourceCutoffAt: '2026-09-18T00:00:00Z',
        issuedAt: '2026-09-18T00:10:00Z',
        expiresAt: '2026-09-19T00:10:00Z',
        observationPolicyVersion: 'awarded-attempt-v1',
        builds: [{
          purpose: 'observations',
          lineage: {
            buildId: '701',
            sourceReleaseId: '0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f',
            calcVersion: 'mart-r10',
            computedAt: '2026-09-18T00:10:00Z',
            coverage: 'unknown',
            regionScheme: 'eat:auction-location-sido'
          }
        }]
      },
      targetSampleCount: target.length,
      comparisonSampleCount: comparison.length,
      overlapCount: empty ? 0 : 2,
      periodCoverage: [{ period: effectiveFilter.period, target: 'unknown', comparison: 'unknown' }],
      freshness: { state: 'unknown', checkedAt: null }
    }
  }));
}
