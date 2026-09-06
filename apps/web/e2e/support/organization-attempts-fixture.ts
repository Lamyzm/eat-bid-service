/** @module 책임: 기관 회차 이력 조회(listOrganizationAuctionAttempts) 하나만 재현하는 브라우저 검증 전용 fixture 응답기다.
 * auction-contract-fixture-server.ts가 300줄을 넘지 않도록 회차 응답만 이 모듈이 소유한다. */
import { organizationAuctionAttemptsV1ResponseSchema, organizationV1Operations } from '@eatbid/contracts/api/v1/organizations';

import namsanAttemptsFixture from './fixtures/namsan-attempts.json';

const ORGANIZATION_ID = '3101';
const operation = organizationV1Operations.listAuctionAttempts;

// buildPath는 querySchema 기본값(limit) 때문에 query 없이 불러도 항상 `?limit=` 꼬리가 붙는다. 경로
// 매칭에는 pathname만 필요하므로 openApiPath에서 직접 정규식을 뽑아 쓴다. 이렇게 하면 organizationId
// 자리표시자 위치가 계약에서 바뀌어도 이 fixture가 따로 어긋나지 않는다.
const ORGANIZATION_ATTEMPTS_PATH_PATTERN = new RegExp(`^${operation.openApiPath.replace('{organizationId}', '([^/]+)')}$`);

const NAMSAN_ATTEMPTS = (namsanAttemptsFixture as { readonly attempts: readonly unknown[] }).attempts;

// 실데이터 12회 + 합성 48회가 60행이지만, meta.sampleCount는 그보다 표본이 더 있었다는 것을 보여주는
// 예시 값이다(창원 남산초 실제 표본 수와는 무관하다).
const META = {
  sampleCount: 92,
  buildId: '501',
  sourceReleaseId: '0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f',
  calcVersion: 'mart-r1',
  computedAt: '2026-09-04T00:10:00Z',
  // 지금 수집 구간에는 시도 축이 없어 모집단 보유율을 그 grain으로 낼 수 없다(PDR-0003).
  coverage: 'unknown',
  regionScheme: 'eat:auction-location-sigungu'
} as const;

function organizationProblemResponse(status: 400 | 404, code: string, title: string): Response {
  const schema = operation.problemResponses[status].schema;
  const problem = schema.parse({
    type: `https://eatbid.dev/problems/${code.toLowerCase().replaceAll('_', '-')}`,
    title,
    status,
    code,
    requestId: `fixture-request-organization-${status}`
  });
  return Response.json(problem, { status });
}

function hasCodeValueId(item: unknown, codeValueId: string): boolean {
  return typeof item === 'object' && item !== null && 'item' in item
    && (item as { item: { codeValueId: string } | null }).item?.codeValueId === codeValueId;
}

/**
 * 이 operation 경로가 아니면 null을 돌려줘 호출부가 다음 route로 넘어가게 한다. 이 슬라이스는
 * cursor 페이지네이션을 쓰지 않으므로 cursor가 실려 오면 400으로 막는다.
 */
export function organizationAttemptsResponse(request: Request): Response | null {
  const url = new URL(request.url);
  const match = url.pathname.match(ORGANIZATION_ATTEMPTS_PATH_PATTERN);
  if (!match) return null;

  const requestedOrganizationId = decodeURIComponent(match[1]!);
  if (requestedOrganizationId !== ORGANIZATION_ID) {
    return organizationProblemResponse(404, 'ORGANIZATION_NOT_FOUND', '기관을 찾을 수 없음');
  }

  let query: ReturnType<typeof operation.querySchema.parse>;
  try {
    query = operation.querySchema.parse(Object.fromEntries(url.searchParams));
  } catch {
    return organizationProblemResponse(400, 'VALIDATION_ERROR', '기관 ID 또는 query가 유효하지 않음');
  }
  if (query.cursor !== undefined) {
    return organizationProblemResponse(400, 'VALIDATION_ERROR', '기관 ID 또는 query가 유효하지 않음');
  }

  const scoped = query.item === undefined
    ? NAMSAN_ATTEMPTS
    : NAMSAN_ATTEMPTS.filter((attempt) => hasCodeValueId(attempt, query.item!));

  const body = organizationAuctionAttemptsV1ResponseSchema.parse({
    organizationId: ORGANIZATION_ID,
    attempts: scoped.slice(0, query.limit),
    nextCursor: null,
    // 서버와 같이 요청 품목을 그대로 되돌려 실어야 화면이 fixture에서도 같은 코호트를 읽는다.
    meta: { ...META, item: query.item ?? null }
  });
  return Response.json(body);
}
