/** @module 책임: 캐시 무효화 요청의 인증·본문 검증과 의미 범위→resource 라우팅을 순수하게 판정한다. */
import { createHash, timingSafeEqual } from 'node:crypto';

import { internalOperations } from '@eatbid/contracts/api/internal';
import type { MartName } from '@eatbid/contracts/values/cache-tag';
import { problemDetailsSchema, type ProblemDetails } from '@eatbid/contracts/api';

/**
 * mart 이름을 어느 resource 무효화 함수로 보낼지의 표다. 이것은 태그 문자열이 아니라 resource
 * 라우팅이라 dispatcher의 정당한 책임이다. 태그를 만드는 자리는 각 `server.ts`뿐이다(ADR 0028-4).
 */
export type CacheRevalidators = Readonly<{
  auctions: (scope: {
    readonly auctionIds?: readonly string[];
    readonly allAuctions?: boolean;
  }) => void;
  orgRoundSummary: () => void;
  winRateDistributionMonthly: () => void;
}>;

export type DispatchInput = Readonly<{
  request: Request;
  /** 매 요청 시점에 읽은 값이다. 배포 runtime 주입과 test 격리를 module load 시점이 가로채지 않는다. */
  expectedToken: string | undefined;
  revalidators: CacheRevalidators;
  requestId: string;
}>;

// web은 Nest의 Problem taxonomy를 import할 수 없으므로 이 경로가 낼 세 상태만 같은 slug 규칙으로
// 적고, 최종 본문은 공개 계약 schema가 검증한다. 새 오류 모양을 만들지 않는 것이 이 표의 목적이다.
const PROBLEMS = {
  400: { slug: 'validation-error', title: 'Request validation failed', code: 'VALIDATION_ERROR' },
  401: { slug: 'unauthenticated', title: 'Authentication required', code: 'UNAUTHENTICATED' },
  500: { slug: 'internal-error', title: 'Internal server error', code: 'INTERNAL_ERROR' }
} as const;

type ProblemStatus = keyof typeof PROBLEMS;

function problem(status: ProblemStatus, requestId: string): ProblemDetails {
  const definition = PROBLEMS[status];
  return problemDetailsSchema.parse({
    type: `https://eatbid.dev/problems/${definition.slug}`,
    title: definition.title,
    status,
    code: definition.code,
    requestId
  });
}

function problemResponse(status: ProblemStatus, requestId: string): Response {
  return new Response(JSON.stringify(problem(status, requestId)), {
    status,
    headers: { 'content-type': 'application/problem+json' }
  });
}

/**
 * 토큰 길이가 다르면 `timingSafeEqual`이 던지고 그 예외 자체가 길이를 흘린다. 양쪽을 먼저 같은
 * 길이로 해시해 길이와 내용 모두 상수 시간으로 비교한다.
 */
function tokenMatches(presented: string, expected: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(presented).digest(),
    createHash('sha256').update(expected).digest()
  );
}

function bearerToken(request: Request): string | undefined {
  const header = request.headers.get('authorization');
  if (header === null) return undefined;
  const [scheme, ...rest] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || rest.length !== 1 || !rest[0]) return undefined;
  return rest[0];
}

async function parsedBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

type MartRevalidator = 'orgRoundSummary' | 'winRateDistributionMonthly';

const MART_ROUTES: Readonly<Record<MartName, MartRevalidator | undefined>> = {
  org_round_summary: 'orgRoundSummary',
  win_rate_distribution_monthly: 'winRateDistributionMonthly',
  // 오늘 목록(EAT-39)이 이 mart를 읽기 시작하면 그때 무효화 대상을 더한다. 지금 읽는 쪽이 없으므로
  // 이름을 받아들이되 아무것도 지우지 않는다 — 400으로 막으면 dataplane이 셋을 한 번에 못 보낸다.
  open_auction_snapshot: undefined
};

/**
 * 토큰 미설정은 "인증 없음"으로 열지 않고 500이다. 설정 누락이 조용히 공개 표면을 만드는 것이
 * 이 경로에서 가장 나쁜 실패다.
 */
export async function dispatchRevalidate(input: DispatchInput): Promise<Response> {
  const { request, expectedToken, revalidators, requestId } = input;
  if (expectedToken === undefined || expectedToken === '') {
    return problemResponse(500, requestId);
  }
  const presented = bearerToken(request);
  if (presented === undefined || !tokenMatches(presented, expectedToken)) {
    return problemResponse(401, requestId);
  }
  const body = internalOperations.revalidateWebCache.bodySchema.safeParse(await parsedBody(request));
  if (!body.success) return problemResponse(400, requestId);

  const { marts, auctionIds, allAuctions } = body.data;
  if (auctionIds !== undefined || allAuctions === true) {
    revalidators.auctions({ auctionIds, allAuctions });
  }
  for (const martName of marts ?? []) {
    const route = MART_ROUTES[martName];
    if (route !== undefined) revalidators[route]();
  }
  return new Response(null, { status: 204 });
}
