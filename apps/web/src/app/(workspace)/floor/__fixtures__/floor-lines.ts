import type { FloorLineRegionsV1Response, FloorLinesV1Response, MyFloorBidsV1Response } from '@/api/floor-lines';

// 합성 표본이다. 기관·업체 이름과 하한선 값은 지어낸 것이고 실제 공고가 아니다. 지역 이름은 공개된 행정구역이다.

const rate = (value: number) => ({ value: value.toFixed(4), unit: 'percentage-points' as const });

/** 평균 89.91, 표준편차 약 0.69의 로지스틱 분위수다. 실제 분포 판의 모양만 흉내 낸다. */
export function syntheticQuantile(p: number): number {
  return 89.91 + 0.381 * Math.log(p / (1 - p));
}

export const QUANTILES: readonly string[] = Array.from({ length: 199 }, (_, index) => syntheticQuantile((index + 1) * 0.005).toFixed(4));

export const regionsResponse: FloorLineRegionsV1Response = {
  groups: [
    {
      sido: { codeValueId: '40', label: '경남' },
      sigungu: [
        { region: { codeValueId: '459', label: '김해시' }, pointCount: 240 },
        { region: { codeValueId: '460', label: '창원시' }, pointCount: 310 }
      ]
    },
    { sido: { codeValueId: '20', label: '부산' }, sigungu: [{ region: { codeValueId: '301', label: '해운대구' }, pointCount: 90 }] }
  ],
  meta: {
    build: { buildId: '901', sourceReleaseId: null, calcVersion: null, computedAt: '2026-10-15T00:30:00Z', coverage: null, regionScheme: 'eat:auction-location-sigungu' },
    period: { from: '2025-10-01', to: '2026-10-15' },
    floorRate: { value: '90.000', unit: 'percentage-points' }
  }
};

const MONTHS = ['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'] as const;

/** 달마다 20건, 이번 달(10월)에 3건이다. 하한선은 분위수를 고르게 돌아 달마다 모양이 같다. */
function syntheticPoints(): FloorLinesV1Response['points'] {
  const points: FloorLinesV1Response['points'] = [];
  let id = 1000;
  MONTHS.forEach((month, monthIndex) => {
    for (let k = 0; k < 20; k += 1) {
      const p = ((k * 7 + monthIndex * 3) % 20 + 0.5) / 20;
      id += 1;
      points.push({
        attemptId: String(id),
        revisionId: String(id + 50_000),
        openedAt: `${month}-${String(2 + k).padStart(2, '0')}T01:00:00Z`,
        organizationName: k % 5 === 0 ? null : `가상초등학교${k % 4}`,
        baseAmount: { amount: '10000000.00', currency: 'KRW' },
        floor: rate(syntheticQuantile(p))
      });
    }
  });
  for (const [day, value] of [['02', 89.6], ['08', 90.12], ['13', 89.737]] as const) {
    id += 1;
    points.push({
      attemptId: String(id),
      revisionId: String(id + 50_000),
      openedAt: `2026-10-${day}T01:00:00Z`,
      organizationName: `가상중학교${day}`,
      baseAmount: { amount: '8000000.00', currency: 'KRW' },
      floor: rate(value)
    });
  }
  return points;
}

export function linesResponse(options: { readonly ranks: boolean } = { ranks: false }): FloorLinesV1Response {
  const points = syntheticPoints();
  return {
    points,
    ladders: options.ranks
      ? points.slice(0, 40).map((point) => ({
          attemptId: point.attemptId,
          validBidderCount: 12,
          lowest: {
            unit: 'percentage-points',
            denominator: 'base-amount',
            values: Array.from({ length: 10 }, (_, index) => (Number(point.floor.value) + 0.05 + index * 0.03).toFixed(4))
          }
        }))
      : null,
    rule: { version: '2026-10-10', sourceRounds: 108126, quantiles: { unit: 'percentage-points', denominator: 'base-amount', values: [...QUANTILES] } },
    meta: {
      build: { buildId: '901', sourceReleaseId: null, calcVersion: null, computedAt: '2026-10-15T00:30:00Z', coverage: null, regionScheme: 'eat:auction-location-sigungu' },
      region: { codeValueId: '459', label: '김해시' },
      period: { from: '2025-10-01', to: '2026-10-15' },
      floorRate: { value: '90.000', unit: 'percentage-points' },
      pointCount: points.length
    }
  };
}

const supplier = (id: string, name: string) => ({ supplierPartyId: id, name });

/** 합성 사업자 둘의 투찰이다. 하나는 하한 미달, 하나는 하한 위 3등, 하나는 낙찰이다. */
export function myBidsResponse(): MyFloorBidsV1Response {
  const points = syntheticPoints();
  const at = (index: number) => points[index]!;
  return {
    bids: [
      { attemptId: at(0).attemptId, supplier: supplier('7701', '가나상회'), rate: rate(Number(at(0).floor.value) - 0.2), outcome: { kind: 'below-floor' } },
      {
        attemptId: at(1).attemptId,
        supplier: supplier('7702', '다라유통'),
        rate: rate(Number(at(1).floor.value) + 0.3),
        outcome: { kind: 'valid', rank: 3, validBidderCount: 12, won: false }
      },
      {
        attemptId: at(2).attemptId,
        supplier: supplier('7701', '가나상회'),
        rate: rate(Number(at(2).floor.value) + 0.01),
        outcome: { kind: 'valid', rank: 1, validBidderCount: 9, won: true }
      }
    ],
    meta: {
      region: { codeValueId: '459', label: '김해시' },
      period: { from: '2025-10-01', to: '2026-10-15' },
      floorRate: { value: '90.000', unit: 'percentage-points' },
      linkedBusinessCount: 2,
      unlinkedBusinessCount: 0
    }
  };
}
