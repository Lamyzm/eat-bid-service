/** @module 책임: 열린 공고 목록 조회(listOpenAuctions) 하나만 재현하는 브라우저 검증 전용 fixture 응답기다.
 * 표본 행과 거르기는 open-auction-rows.ts가 소유하고 이 모듈은 목록 봉투와 400 분기만 소유한다. */
import { auctionV1Operations, openAuctionListV1ResponseSchema } from '@eatbid/contracts/api/v1/auctions';

import {
  filterOpenAuctionRows,
  instantSecondsIso,
  lineage,
  matchesEligibilityArea,
  STALE_CURSOR
} from './open-auction-rows';

export { STALE_CURSOR } from './open-auction-rows';

const operation = auctionV1Operations.listOpen;

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

  // query string은 값 하나와 값 여럿을 구분하지 못한다. 계약이 배열로 받는 필터만 `getAll`로 편다.
  const parameters: Record<string, string | string[]> = Object.fromEntries(url.searchParams);
  const selectedAreas = url.searchParams.getAll('eligibilityArea');
  if (selectedAreas.length > 0) parameters.eligibilityArea = selectedAreas;

  let query: ReturnType<typeof operation.querySchema.parse>;
  try {
    query = operation.querySchema.parse(parameters);
  } catch {
    return problemResponse(400, 'VALIDATION_ERROR', 'query가 유효하지 않음');
  }
  if (query.cursor === STALE_CURSOR) {
    return problemResponse(400, 'VALIDATION_ERROR', 'query가 유효하지 않음');
  }

  const now = Date.now();
  const areaFilter = query.eligibilityArea ?? null;
  // 표본 수는 거른 뒤의 전체 수다. `limit`은 그 뒤에서 한 판을 끊을 뿐이라 둘을 같은 수로 두지 않는다.
  const filtered = filterOpenAuctionRows(now, query);

  const body = openAuctionListV1ResponseSchema.parse({
    auctions: filtered.slice(0, query.limit),
    nextCursor: null,
    meta: {
      sampleCount: filtered.length,
      asOf: instantSecondsIso(now),
      sido: query.sido ?? null,
      sigungu: query.sigungu === undefined ? null : [...query.sigungu],
      regionUnknown: query.regionUnknown ?? null,
      closesOn: query.closesOn ?? null,
      announcedOn: query.announcedOn ?? null,
      eligibilityArea: areaFilter,
      // 합은 언제나 sampleCount다. 매칭과 미관측을 하나로 합치면 화면이 확인되지 않은 행을 "고른 지역의
      // 공고"라고 말하게 된다.
      eligibilityMatchedCount: areaFilter === null
        ? null
        : filtered.filter((row) => matchesEligibilityArea(row, areaFilter)).length,
      eligibilityUnobservedCount: areaFilter === null
        ? null
        : filtered.filter((row) => row.eligibilityAreas === null).length,
      items: query.items === undefined ? null : [...query.items],
      itemUnknown: query.itemUnknown ?? null,
      q: query.q ?? null,
      bidState: query.bidState ?? null,
      closesWithinHours: query.closesWithinHours ?? null,
      baseAmountMin: query.baseAmountMin ?? null,
      baseAmountMax: query.baseAmountMax ?? null,
      openAuctionSnapshotBuild: lineage('mart-r2', 'eat:auction-location-sigungu'),
      orgRoundSummaryBuild: lineage('mart-r1', null)
    }
  });
  return Response.json(body);
}
