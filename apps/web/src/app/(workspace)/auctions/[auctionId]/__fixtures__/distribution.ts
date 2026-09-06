/**
 * 호가창 테스트가 공유하는 낙찰률 분포 fixture다. `attempts.ts`와 달리 **이 숫자는 실측**이다.
 * `docs/product/decision-screen-v2/design-generators/namsan.json`의 창원 남산초등학교 실관측 92회차를
 * 하한율 코호트로 나눠(90: 82건 24칸, 88: 10건 5칸) 0.01칸으로 센 값이며, 서버의
 * `distribution-statistics.test.ts`·통합 test와 같은 숫자여야 세 층이 같은 계산을 한다는 것이 닫힌다.
 *
 * 칸 목록을 tuple 표로 두고 계약 형태는 `bin()`이 만든다. 24칸을 통째로 펼치면 어느 숫자가 실측이고
 * 어느 것이 봉투인지 읽히지 않으며, 표를 두 파일로 나누면 같은 표본을 두 곳에서 맞춰야 한다(AGENTS 18).
 */
import type { WinRateDistributionV1Response } from '@eatbid/contracts/api/v1/win-rate-distribution';

type BinRow = readonly [from: string, to: string, count: number];

const FLOOR_90_BINS: readonly BinRow[] = [
  ['90.000', '90.010', 20], ['90.010', '90.020', 8], ['90.020', '90.030', 8],
  ['90.030', '90.040', 8], ['90.040', '90.050', 4], ['90.050', '90.060', 3],
  ['90.060', '90.070', 3], ['90.070', '90.080', 2], ['90.080', '90.090', 4],
  ['90.100', '90.110', 5], ['90.110', '90.120', 2], ['90.140', '90.150', 1],
  ['90.150', '90.160', 2], ['90.160', '90.170', 2], ['90.190', '90.200', 1],
  ['90.210', '90.220', 1], ['90.270', '90.280', 1], ['90.430', '90.440', 1],
  ['90.530', '90.540', 1], ['90.550', '90.560', 1], ['90.560', '90.570', 1],
  ['90.700', '90.710', 1], ['90.760', '90.770', 1], ['91.070', '91.080', 1]
];

const FLOOR_88_BINS: readonly BinRow[] = [
  ['88.000', '88.010', 4], ['88.020', '88.030', 1], ['88.030', '88.040', 2],
  ['88.040', '88.050', 2], ['88.060', '88.070', 1]
];

const rate = (value: string) => ({ value, unit: 'percentage-points' }) as const;

const bin = ([from, to, count]: BinRow) => ({ from: rate(from), to: rate(to), count });

const LINEAGE = {
  buildId: '601',
  sourceReleaseId: '00000000-0000-0000-0000-000000000241',
  calcVersion: 'mart-r1',
  computedAt: '2026-09-06T00:10:00Z',
  coverage: 'unknown',
  regionScheme: 'eat:auction-location-sigungu'
} as const;

/** 남산초 하한율 90 코호트. 최빈 `[90.000, 90.010)` 20건(24.3902%), 중앙 칸 `[90.030, 90.040)`. */
export const floor90DistributionFixture: WinRateDistributionV1Response = {
  bins: FLOOR_90_BINS.map(bin),
  medianBin: { from: rate('90.030'), to: rate('90.040') },
  modeRange: { from: rate('90.000'), to: rate('90.010'), count: 20, share: { value: '0.243902', unit: 'ratio' } },
  months: [
    { month: '2026-08', sampleCount: 41, coverage: 'complete', bins: null },
    { month: '2026-09', sampleCount: 41, coverage: 'unknown', bins: null }
  ],
  meta: {
    sampleCount: 82,
    item: null,
    scope: 'national',
    regionCodeValueId: null,
    organizationId: null,
    floorRate: rate('90.000'),
    awardMethod: '31',
    binWidth: rate('0.010'),
    period: { from: '2026-08', to: '2026-09' },
    ...LINEAGE
  }
};

/** 남산초 하한율 88 코호트. 90 코호트와 겹치지 않는 자리에 산다(설계 §2.1). */
export const floor88DistributionFixture: WinRateDistributionV1Response = {
  bins: FLOOR_88_BINS.map(bin),
  medianBin: { from: rate('88.030'), to: rate('88.040') },
  modeRange: { from: rate('88.000'), to: rate('88.010'), count: 4, share: { value: '0.400000', unit: 'ratio' } },
  months: [{ month: '2026-09', sampleCount: 10, coverage: 'unknown', bins: null }],
  meta: {
    ...floor90DistributionFixture.meta,
    sampleCount: 10,
    floorRate: rate('88.000'),
    period: { from: '2026-09', to: '2026-09' }
  }
};

/** 활성 build가 아직 없는 상태. 오류가 아니라 파생물이 만들어지지 않은 정상 상태다. */
export const emptyDistributionFixture: WinRateDistributionV1Response = {
  bins: [],
  medianBin: null,
  modeRange: null,
  months: [],
  meta: {
    ...floor90DistributionFixture.meta,
    sampleCount: 0,
    buildId: null,
    sourceReleaseId: null,
    calcVersion: null,
    computedAt: null,
    coverage: null,
    regionScheme: null
  }
};
