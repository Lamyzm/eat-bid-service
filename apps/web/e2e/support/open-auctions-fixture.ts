/** @module 책임: 열린 공고 목록 조회(listOpenAuctions) 하나만 재현하는 브라우저 검증 전용 fixture 응답기다.
 * auction-contract-fixture-server.ts가 300줄을 넘지 않도록 목록 응답만 이 모듈이 소유한다. */
import { auctionV1Operations, openAuctionListV1ResponseSchema } from '@eatbid/contracts/api/v1/auctions';

import { activatedBuildId } from './cache-observability';

const operation = auctionV1Operations.listOpen;
const BASE_BUILD_ID = '601';
const HOUR = 60 * 60 * 1_000;
// build 전환으로 사라진 cursor를 재현하는 값이다. 화면은 400을 받아 cursor 없이 다시 조회해야 한다.
export const STALE_CURSOR = '9007199254740990';

// `Date#toISOString()`의 밀리초가 0으로 끝나면 instantTextSchema가 트레일링 제로를 거부하므로 초 단위로 내린다.
function instantSecondsIso(millis: number): string {
  return new Date(Math.floor(millis / 1_000) * 1_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const lineage = (calcVersion: string, regionScheme: string | null) => ({
  buildId: activatedBuildId(BASE_BUILD_ID),
  sourceReleaseId: '0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f',
  calcVersion,
  computedAt: '2026-09-07T01:00:00Z',
  coverage: 'unknown',
  regionScheme
});

const region = {
  sido: { codeValueId: '41', code: '48', scheme: 'eat:auction-location-sido', label: '경상남도' },
  sigungu: { codeValueId: '43', code: '48120', scheme: 'eat:auction-location-sigungu', label: '창원시' }
};

const summary = {
  attemptCount: 17,
  medianListCount: 5,
  listCountSampleCount: 12,
  lastRound: {
    auctionAttemptId: '5780681',
    openedAt: '2026-09-02T02:00:00Z',
    awardedBidRate: { value: '88.3020', unit: 'percentage-points' },
    dayFloorBidRate: { value: '88.0350', unit: 'percentage-points' },
    listCount: 17,
    belowDayFloorCount: 2
  }
};

// 마감은 요청 시각 기준 상대 오프셋이라 실행 날짜와 무관하게 오늘·내일·사흘 뒤 행이 늘 재현된다.
// 긴 기관명·여러 품목 라벨은 운영에서 헤더 칩 줄을 밀었던 재료(EAT-82)와 같은 모양이다.
function rows(now: number) {
  const observedAt = instantSecondsIso(now - 30 * 60 * 1_000);
  const base = { termsRevisionId: '5796469', observedAt, sourceLastChangedAt: null, region, orgSummary: summary };
  return [
    {
      ...base,
      auctionAttemptId: '5796468',
      organization: { organizationId: '3101', label: '창원 남산초등학교', type: 'unknown' },
      itemLabel: '축산',
      floorRate: { value: '90.000', unit: 'percentage-points' },
      closesAt: instantSecondsIso(now + 2 * HOUR),
      baseAmount: { amount: '2761700.00', currency: 'KRW' },
      bidCount: 5
    },
    {
      ...base,
      auctionAttemptId: '5796470',
      organization: { organizationId: '3102', label: '금정구종합사회복지관식자재납품업체선정입찰공고기관', type: 'unknown' },
      itemLabel: '농산물 , 수산물 , 육류 , 가공식품 , 김치류 , 곡류 , 가금류',
      floorRate: { value: '88.000', unit: 'percentage-points' },
      closesAt: instantSecondsIso(now + 26 * HOUR),
      baseAmount: { amount: '150000000.00', currency: 'KRW' },
      bidCount: null,
      orgSummary: { attemptCount: 3, medianListCount: null, listCountSampleCount: 0, lastRound: null }
    },
    {
      ...base,
      auctionAttemptId: '5796471',
      organization: null,
      itemLabel: null,
      floorRate: null,
      region: null,
      termsRevisionId: null,
      closesAt: instantSecondsIso(now + 3 * 24 * HOUR),
      baseAmount: null,
      bidCount: 0,
      orgSummary: null
    },
    {
      ...base,
      auctionAttemptId: '5796472',
      organization: { organizationId: '3103', label: null, type: 'school' },
      itemLabel: '김치',
      floorRate: { value: '90.000', unit: 'percentage-points' },
      closesAt: null,
      baseAmount: { amount: '980200.00', currency: 'KRW' },
      bidCount: 4
    }
  ];
}

function problemResponse(status: 400 | 503, code: string, title: string): Response {
  const problem = operation.problemResponses[status].schema.parse({
    type: `https://eatbid.dev/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title,
    status,
    code,
    requestId: `fixture-request-open-auctions-${status}`
  });
  return Response.json(problem, { status });
}

/** 이 operation 경로가 아니면 null을 돌려줘 호출부가 다음 route로 넘어가게 한다. */
export function openAuctionsResponse(request: Request): Response | null {
  const url = new URL(request.url);
  if (url.pathname !== operation.openApiPath) return null;

  let query: ReturnType<typeof operation.querySchema.parse>;
  try {
    query = operation.querySchema.parse(Object.fromEntries(url.searchParams));
  } catch {
    return problemResponse(400, 'VALIDATION_ERROR', 'query가 유효하지 않음');
  }
  if (query.cursor === STALE_CURSOR) {
    return problemResponse(400, 'VALIDATION_ERROR', 'query가 유효하지 않음');
  }

  const now = Date.now();
  // 서버와 같은 순서로 거른다: 품목 라벨 완전일치 → 지역 id → 기간. 표본 수는 거른 뒤의 전체 수다.
  const filtered = rows(now)
    .filter((row) => query.item === undefined || row.itemLabel === query.item)
    .filter((row) => query.region === undefined || row.region?.sido.codeValueId === query.region || row.region?.sigungu.codeValueId === query.region)
    .filter((row) => query.closesWithinHours === undefined
      || (row.closesAt !== null && Date.parse(row.closesAt) <= now + query.closesWithinHours * HOUR));

  const body = openAuctionListV1ResponseSchema.parse({
    auctions: filtered.slice(0, query.limit),
    nextCursor: null,
    meta: {
      sampleCount: filtered.length,
      asOf: instantSecondsIso(now),
      region: query.region ?? null,
      item: query.item ?? null,
      closesWithinHours: query.closesWithinHours ?? null,
      baseAmountMin: query.baseAmountMin ?? null,
      baseAmountMax: query.baseAmountMax ?? null,
      openAuctionSnapshotBuild: lineage('mart-r2', 'eat:auction-location-sigungu'),
      orgRoundSummaryBuild: lineage('mart-r1', null)
    }
  });
  return Response.json(body);
}
