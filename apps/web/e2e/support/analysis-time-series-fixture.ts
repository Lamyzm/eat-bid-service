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
type FixturePoint = readonly [string, string, string, string | null];

/** 네 번째 자리가 품목이다. `null`은 공고가 품목을 말하지 않은 회차(`품목 미확인`)다. */
const TARGET_POINTS: readonly FixturePoint[] = [
  ['9101', '2026-03-12T01:30:00Z', '90.010', '육류'],
  ['9102', '2026-04-23T01:30:00Z', '90.080', '육류'],
  ['9103', '2026-05-28T01:30:00Z', '89.960', '농산물'],
  ['9104', '2026-07-09T01:30:00Z', '90.120', null],
  ['9105', '2026-08-20T01:30:00Z', '91.870', '육류']
];

/** 비교군은 좁은 기간이라 점으로 온다. 기관 점과 겹치는 둘을 포함해 `겹침` 수가 0이 아니게 둔다. */
const COMPARISON_POINTS: readonly FixturePoint[] = [
  ['9101', '2026-03-12T01:30:00Z', '90.010', '육류'],
  ['9102', '2026-04-23T01:30:00Z', '90.080', '육류'],
  ['9201', '2026-03-20T01:30:00Z', '90.040', '농산물'],
  ['9202', '2026-04-02T01:30:00Z', '89.990', null],
  ['9203', '2026-05-15T01:30:00Z', '90.150', '육류'],
  ['9204', '2026-06-11T01:30:00Z', '90.030', '수산물'],
  ['9205', '2026-07-24T01:30:00Z', '90.060', null],
  ['9206', '2026-08-06T01:30:00Z', '89.940', '김치류'],
  ['9207', '2026-09-02T01:30:00Z', '90.200', '육류']
];

/** 겹쳐 찍은 기관의 점이다. 기관 점과 겹치지 않는 자리에 둬 고리와 점이 따로 보이는지 확인한다. */
const OVERLAY_POINTS: readonly FixturePoint[] = [
  ['9301', '2026-03-30T01:30:00Z', '90.230', '육류'],
  ['9302', '2026-06-18T01:30:00Z', '89.880', '육류']
];

function pointOf([attemptId, plottedAt, value]: FixturePoint) {
  return { attemptId, revisionId: attemptId, plottedAt, assessmentRate: rate(value) };
}

/**
 * 품목 조건을 **두 집단에 같게** 적용한다(PDR-0007). fixture가 기관 점만 거르면 브라우저에서
 * "조건 막대는 육류인데 구름은 전체"인 상태가 통과해 버린다 — 고치려던 결함이 그것이다.
 */
function keptBy(filter: ReturnType<typeof effectiveFilterOf>['itemFilter']) {
  return (point: FixturePoint): boolean => {
    const item = point[3];
    if (filter.kind === 'all') return true;
    if (filter.kind === 'unknown') return item === null;
    return item === null ? filter.unknown : filter.atoms.includes(item);
  };
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
  const atoms = searchParams.getAll('items');
  const unknown = searchParams.get('itemUnknown');
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
    // 요청이 실은 표시 축을 그대로 비춘다. 빈 배열이면 고른 기관이 없다는 뜻이다.
    overlayOrganizationIds: searchParams.getAll('overlayOrganizationIds'),
    itemFilter: atoms.length === 0
      ? (unknown === 'only' ? { kind: 'unknown' as const } : { kind: 'all' as const })
      : { kind: 'atoms' as const, atoms, unknown: unknown === 'include' }
  };
}

export function analysisTimeSeriesResponse(request: Request): Response | undefined {
  const { pathname, searchParams } = new URL(request.url);
  if (pathname !== operation.openApiPath) return undefined;

  const effectiveFilter = effectiveFilterOf(searchParams);
  /*
    명단 상한 503은 "이 조회를 실패시켜 달라"는 표식이다. 조회 실패 갈래는 서버 렌더가 실제로 실패해야
    나오는데, 그 호출은 RSC에서 일어나므로 브라우저 가로채기로는 만들 수 없다. 숫자를 status와 같게 둔
    이유는 시험을 읽는 사람이 무엇을 흉내 내는지 바로 알게 하려는 것이다.
  */
  if (effectiveFilter.listCountRange.max === 503) return new Response(null, { status: 503 });
  // 명단 하한을 아주 높게 잡은 요청은 조건에 맞는 회차가 없는 상태다. 빈 배열과 0건은 `unavailable`과
  // 다른 갈래라 화면이 "조건을 풀어 보라"고 말해야 한다(AGENTS 3).
  const empty = (effectiveFilter.listCountRange.min ?? 0) > 100;
  const kept = keptBy(effectiveFilter.itemFilter);
  const target = empty ? [] : TARGET_POINTS.filter(kept).map(pointOf);
  const comparison = empty ? [] : COMPARISON_POINTS.filter(kept).map(pointOf);

  return Response.json(analysisTimeSeriesV1ResponseSchema.parse({
    axis: {
      period: effectiveFilter.period,
      timeResolution: 'day',
      rateBinWidth: null
    },
    target,
    targetTruncated: false,
    comparison: { kind: 'points', points: comparison, truncated: false },
    // 겹쳐 찍은 기관은 요청한 순서로 온다. 화면의 번호 배지가 사용자가 고른 순서를 말하기 때문이다.
    overlays: searchParams.getAll('overlayOrganizationIds').map((organizationId, index) => ({
      organizationId,
      name: `겹쳐 찍은 기관 ${index + 1}`,
      points: empty ? [] : OVERLAY_POINTS.map(pointOf),
      truncated: false
    })),
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
      overlapCount: comparison.filter((point) => Number(point.attemptId) < 9200).length,
      periodCoverage: [{ period: effectiveFilter.period, target: 'unknown', comparison: 'unknown' }],
      freshness: { state: 'unknown', checkedAt: null }
    }
  }));
}
