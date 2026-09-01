import { auctionV1Operations, auctionV1ResponseSchema } from '@eatbid/contracts/api/v1/auctions';

const HOSTNAME = '127.0.0.1';
const PORT = 4410;
const SUCCESS_AUCTION_ID = '9007199254740993';
const FAILURE_AUCTION_ID = '9007199254740994';
const MISSING_AUCTION_ID = '9007199254740996';
const REDUCED_MOTION_AUCTION_ID = '9007199254741000';
const SUCCESS_RESPONSE_DELAY_MILLISECONDS = 350;
const REDUCED_MOTION_RESPONSE_DELAY_MILLISECONDS = 5_000;

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
    if (pathname === auctionPath(FAILURE_AUCTION_ID)) return problemResponse(503);
    if (pathname === auctionPath(MISSING_AUCTION_ID)) return problemResponse(404);
    return new Response(null, { status: 404 });
  }
});
