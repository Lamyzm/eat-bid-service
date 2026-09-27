/** @module 책임: 분석 낙찰값 분포 조회(findAnalysisDistribution) 하나만 재현하는 브라우저 검증 전용 fixture 응답기다.
 * 새 상세는 시간축과 분포를 서버에서 함께 읽으므로, 이 응답이 없으면 화면 전체가 오류 경계에서 멈춘다. */
import {
  analysisV1Operations,
  analysisDistributionV1ResponseSchema
} from '@eatbid/contracts/api/v1/analysis';

const operation = analysisV1Operations.findDistribution;

const rate = (value: string) => ({ value, unit: 'percentage-points' }) as const;

/**
 * 시간축 fixture의 점을 하한 90.000부터 0.1 폭 열 칸에 나눠 센 값이다. 두 fixture가 같은 회차를 말해야
 * 그림과 분포가 서로 다른 표본을 보여 주는 상태가 브라우저에서 통과하지 않는다.
 * 기관 다섯: 90.0 칸 둘, 90.1 칸 하나, 아래 하나(89.960), 위 하나(91.870).
 * 비교 아홉: 90.0 칸 다섯, 90.1 칸 하나, 90.2 칸 하나, 아래 둘(89.990·89.940).
 */
const TARGET_COUNTS = [2, 1, 0, 0, 0, 0, 0, 0, 0, 0];
const COMPARISON_COUNTS = [5, 1, 1, 0, 0, 0, 0, 0, 0, 0];

function milliText(milli: number): string {
  return (milli / 1000).toFixed(3);
}

export function analysisDistributionResponse(request: Request): Response | undefined {
  const { pathname, searchParams } = new URL(request.url);
  if (pathname !== operation.openApiPath) return undefined;

  // 시간축 fixture와 같은 표식이다. 명단 하한을 아주 높게 잡으면 조건에 맞는 회차가 없다.
  const empty = Number(searchParams.get('listCountMin') ?? 0) > 100;
  const floorMilli = 90_000;
  const bins = empty ? [] : TARGET_COUNTS.map((targetCount, index) => ({
    from: rate(milliText(floorMilli + index * 100)),
    to: rate(milliText(floorMilli + (index + 1) * 100)),
    targetCount,
    comparisonCount: COMPARISON_COUNTS[index] ?? 0
  }));

  return Response.json(analysisDistributionV1ResponseSchema.parse({
    bins,
    targetOutside: empty ? { below: 0, above: 0 } : { below: 1, above: 1 },
    comparisonOutside: empty ? { below: 0, above: 0 } : { below: 2, above: 0 },
    meta: {
      targetTotal: empty ? 0 : 5,
      comparisonTotal: empty ? 0 : 9,
      build: {
        buildId: '701',
        sourceReleaseId: '0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f',
        calcVersion: 'mart-r10',
        computedAt: '2026-09-18T00:10:00Z',
        coverage: 'unknown',
        regionScheme: 'eat:auction-location-sido'
      }
    }
  }));
}
