import { auctionV1Operations, auctionV1ResponseSchema } from '@eatbid/contracts/api/v1/auctions';

const HOSTNAME = '127.0.0.1';
const PORT = 4410;
const SUCCESS_AUCTION_ID = '9007199254740993';
const FAILURE_AUCTION_ID = '9007199254740994';
const MISSING_AUCTION_ID = '9007199254740996';
const REDUCED_MOTION_AUCTION_ID = '9007199254741000';
const OPEN_AUCTION_ID = '5796468';
const SUCCESS_RESPONSE_DELAY_MILLISECONDS = 350;
const REDUCED_MOTION_RESPONSE_DELAY_MILLISECONDS = 5_000;
const OPEN_DEADLINE_OFFSET_MILLISECONDS = 24 * 60 * 60 * 1_000;
const OPEN_OPENED_OFFSET_MILLISECONDS = 27 * 60 * 60 * 1_000;

function auctionResponse(auctionId: string) {
  return auctionV1ResponseSchema.parse({
    identity: {
      auctionId,
      revisionId: '9007199254740995',
      externalBidId: 'fixture-opaque-id',
      displayBidNumber: null,
      title: '급식 식재료',
      status: 'OPEN'
    },
    schedule: {
      announcedAt: '2026-08-30T00:00:00Z',
      deadlineAt: null,
      openedAt: null
    },
    pricing: {
      baseAmount: { amount: '1234567890.50', currency: 'KRW' },
      plannedAmount: null
    },
    provenance: {
      sourceSystem: 'eat',
      observationId: '9007199254740997',
      normalizedRecordId: '9007199254740999',
      contentSha256: 'a'.repeat(64)
    }
  });
}

// rail 상태(진행 중)는 응답 시각과 마감·개찰의 상대 위치로만 판정된다(EAT-36). 고정 시각을 쓰면 테스트를
// 실행하는 날짜가 마감을 지나는 순간부터 배너 문장이 바뀌어 폭 검사가 흔들린다. 요청을 받은 순간 기준
// +1일(마감)·+1일 3시간(개찰)으로 매번 다시 계산해 진행 중 상태를 항상 재현한다.
function openAuctionResponse(auctionId: string) {
  const now = Date.now();
  return auctionV1ResponseSchema.parse({
    identity: {
      auctionId,
      revisionId: '5796469',
      externalBidId: 'fixture-open-opaque-id',
      displayBidNumber: null,
      title: '창원 남산초등학교 축산물 구매',
      status: 'OPEN'
    },
    schedule: {
      announcedAt: '2026-09-01T00:00:00Z',
      deadlineAt: new Date(now + OPEN_DEADLINE_OFFSET_MILLISECONDS).toISOString(),
      openedAt: new Date(now + OPEN_OPENED_OFFSET_MILLISECONDS).toISOString()
    },
    pricing: {
      baseAmount: { amount: '2761700.00', currency: 'KRW' },
      plannedAmount: null
    },
    provenance: {
      sourceSystem: 'eat',
      observationId: '9007199254740997',
      normalizedRecordId: '9007199254740999',
      contentSha256: 'a'.repeat(64)
    }
  });
}

function auctionPath(auctionId: string): string {
  return auctionV1Operations.find.buildPath({ path: { auctionId } });
}

function problemResponse(status: 404 | 503): Response {
  const problem = auctionV1Operations.find.problemResponses[status].schema.parse(
    status === 404
      ? {
          type: 'https://eatbid.dev/problems/auction-not-found',
          title: '공고를 찾을 수 없음',
          status,
          code: 'AUCTION_NOT_FOUND',
          requestId: 'fixture-request-404'
        }
      : {
          type: 'https://eatbid.dev/problems/dependency-unavailable',
          title: '의존성을 사용할 수 없음',
          status,
          code: 'DEPENDENCY_UNAVAILABLE',
          requestId: 'fixture-request-503'
        }
  );
  return Response.json(problem, { status });
}

/** 공개 operation만 재현하며 제품 코드에서 import하지 않는 브라우저 검증 전용 서버다. */
Bun.serve({
  hostname: HOSTNAME,
  port: PORT,
  async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === '/health') return new Response('ok');
    if (request.method !== 'GET') return new Response(null, { status: 405 });

    if (pathname === auctionPath(SUCCESS_AUCTION_ID)) {
      await Bun.sleep(SUCCESS_RESPONSE_DELAY_MILLISECONDS);
      return Response.json(auctionResponse(SUCCESS_AUCTION_ID));
    }
    if (pathname === auctionPath(REDUCED_MOTION_AUCTION_ID)) {
      await Bun.sleep(REDUCED_MOTION_RESPONSE_DELAY_MILLISECONDS);
      return Response.json(auctionResponse(REDUCED_MOTION_AUCTION_ID));
    }
    if (pathname === auctionPath(OPEN_AUCTION_ID)) return Response.json(openAuctionResponse(OPEN_AUCTION_ID));
    if (pathname === auctionPath(FAILURE_AUCTION_ID)) return problemResponse(503);
    if (pathname === auctionPath(MISSING_AUCTION_ID)) return problemResponse(404);
    return new Response(null, { status: 404 });
  }
});
