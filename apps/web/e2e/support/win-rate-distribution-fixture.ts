/** @module 책임: 낙찰률 분포 조회(findWinRateDistribution) 하나만 재현하는 브라우저 검증 전용 fixture 응답기다.
 * auction-contract-fixture-server.ts가 300줄을 넘지 않도록 분포 응답만 이 모듈이 소유한다. */
import {
  winRateDistributionV1Operations,
  winRateDistributionV1ResponseSchema
} from '@eatbid/contracts/api/v1/win-rate-distribution';

import { serveBuildId } from './cache-observability';

const operation = winRateDistributionV1Operations.find;

const BASE_BUILD_ID = '601';

// 남산초 실관측 92회차 중 하한율 90 코호트(82건)의 0.01칸 집계다. 화면 단위 test의 fixture와 같은
// 숫자여야 브라우저에서 보는 사다리가 test가 본 사다리와 같다.
const FLOOR_90_BINS: ReadonlyArray<readonly [string, number]> = [
  ['90.000', 20], ['90.010', 8], ['90.020', 8], ['90.030', 8], ['90.040', 4], ['90.050', 3],
  ['90.060', 3], ['90.070', 2], ['90.080', 4], ['90.100', 5], ['90.110', 2], ['90.140', 1],
  ['90.150', 2], ['90.160', 2], ['90.190', 1], ['90.210', 1], ['90.270', 1], ['90.430', 1],
  ['90.530', 1], ['90.550', 1], ['90.560', 1], ['90.700', 1], ['90.760', 1], ['91.070', 1]
];

const rate = (value: string) => ({ value, unit: 'percentage-points' }) as const;

function binOf([lower, count]: readonly [string, number]) {
  const upper = (Number(lower) + 0.01).toFixed(3);
  return { from: rate(lower), to: rate(upper), count };
}

export function winRateDistributionResponse(request: Request): Response | undefined {
  const { pathname, searchParams } = new URL(request.url);
  if (pathname !== operation.openApiPath) return undefined;

  const scope = searchParams.get('scope') ?? 'national';
  const granularity = searchParams.get('granularity') ?? 'total';
  const from = searchParams.get('from') ?? '2025-10';
  const to = searchParams.get('to') ?? '2026-09';
  const bins = FLOOR_90_BINS.map(binOf);
  // 달별 칸은 크게 보기에서만 실린다. 두 달로 나눠 히트맵이 실제로 두 행을 그리게 한다.
  const monthBins = granularity === 'month'
    ? [bins.slice(0, 12), bins.slice(12)]
    : [null, null];

  return Response.json(winRateDistributionV1ResponseSchema.parse({
    bins,
    medianBin: { from: rate('90.030'), to: rate('90.040') },
    modeRange: { from: rate('90.000'), to: rate('90.010'), count: 20, share: { value: '0.243902', unit: 'ratio' } },
    months: [
      { month: from, sampleCount: 41, coverage: 'complete', bins: monthBins[0] },
      { month: to, sampleCount: 41, coverage: 'unknown', bins: monthBins[1] }
    ],
    meta: {
      sampleCount: 82,
      item: null,
      scope,
      regionCodeValueId: searchParams.get('regionCodeValueId'),
      organizationId: searchParams.get('organizationId'),
      floorRate: rate(searchParams.get('floorRate') ?? '90.000'),
      awardMethod: searchParams.get('awardMethod') ?? '31',
      binWidth: rate(searchParams.get('binWidth') ?? '0.010'),
      period: { from, to },
      // 활성 build 전환을 재현할 수 있도록 요청 시점에 읽고, 그 값을 이 조회가 내준 계보로 남긴다(캐시 e2e).
      buildId: serveBuildId('winRateDistribution', BASE_BUILD_ID),
      sourceReleaseId: '0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f',
      calcVersion: 'mart-r1',
      computedAt: '2026-09-06T00:10:00Z',
      // 지금 수집 구간에는 시도 축이 없어 모집단 보유율을 그 grain으로 낼 수 없다(PDR-0003).
      coverage: 'unknown',
      regionScheme: 'eat:auction-location-sigungu'
    }
  }));
}
