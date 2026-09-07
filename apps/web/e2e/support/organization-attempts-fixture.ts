/** @module 책임: 기관 회차 이력 조회(listOrganizationAuctionAttempts) 하나만 재현하는 브라우저 검증 전용 fixture 응답기다.
 * auction-contract-fixture-server.ts가 300줄을 넘지 않도록 회차 응답만 이 모듈이 소유한다. */
import { organizationAuctionAttemptsV1ResponseSchema, organizationV1Operations } from '@eatbid/contracts/api/v1/organizations';

import { activatedBuildId } from './cache-observability';
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
const BASE_BUILD_ID = '501';

// 개찰 기준 시각이다. fixture 회차는 전부 이보다 앞서 개찰됐으므로 `opened=only`가 행을 줄이지 않는다.
const FIXTURE_AS_OF = '2026-09-06T00:00:00Z';

// 한 페이지 상한. 계약 상한(200)보다 낮은 이유는 60행 fixture로 keyset 페이지네이션(크게 보기 "더 불러오기")을
// 재현하기 위해서다 — 첫 화면이 limit 60을 요청해도 40행 뒤에 nextCursor가 붙어 다음 페이지가 실제로 있다.
// 40 아래로 내리면 손잡이 90.000→90.001에서 판정이 갈리는 회차(그날 하한 90.0010, 35번째)가 첫 페이지에서
// 빠져 손잡이 e2e가 "이 값이면"의 변화를 볼 수 없다.
const FIXTURE_PAGE_LIMIT = 40;

const META = {
  sampleCount: 92,
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

function openedAtOrBefore(attempt: unknown, asOf: string): boolean {
  if (typeof attempt !== 'object' || attempt === null || !('openedAt' in attempt)) return false;
  const openedAt = (attempt as { openedAt: string | null }).openedAt;
  return openedAt !== null && openedAt <= asOf;
}

function hasCodeValueId(item: unknown, codeValueId: string): boolean {
  return typeof item === 'object' && item !== null && 'item' in item
    && (item as { item: { codeValueId: string } | null }).item?.codeValueId === codeValueId;
}

function attemptIdOf(attempt: unknown): string | null {
  if (typeof attempt !== 'object' || attempt === null || !('attemptId' in attempt)) return null;
  return String((attempt as { attemptId: string }).attemptId);
}

/**
 * 이 operation 경로가 아니면 null을 돌려줘 호출부가 다음 route로 넘어가게 한다. cursor는 서버와 같이
 * "이 회차 다음부터"의 keyset이며(drizzle-organization-attempt-reader.ts), 이 기관에 없는 회차를 가리키면
 * 서버처럼 400으로 답한다.
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

  // 서버와 같은 순서로 거른다: 개찰 여부(기본 only) → 품목. 표본 수는 응답 예시 값이라 그대로 둔다.
  const opened = query.opened === 'only'
    ? NAMSAN_ATTEMPTS.filter((attempt) => openedAtOrBefore(attempt, FIXTURE_AS_OF))
    : NAMSAN_ATTEMPTS;
  const scoped = query.item === undefined
    ? opened
    : opened.filter((attempt) => hasCodeValueId(attempt, query.item!));

  let start = 0;
  if (query.cursor !== undefined) {
    const cursorIndex = scoped.findIndex((attempt) => attemptIdOf(attempt) === query.cursor);
    if (cursorIndex < 0) {
      return organizationProblemResponse(400, 'VALIDATION_ERROR', '기관 ID 또는 query가 유효하지 않음');
    }
    start = cursorIndex + 1;
  }
  const pageEnd = start + Math.min(query.limit, FIXTURE_PAGE_LIMIT);
  const page = scoped.slice(start, pageEnd);

  const body = organizationAuctionAttemptsV1ResponseSchema.parse({
    organizationId: ORGANIZATION_ID,
    attempts: page,
    nextCursor: pageEnd < scoped.length ? attemptIdOf(page[page.length - 1]) : null,
    // 서버와 같이 요청 품목·개찰 필터를 그대로 되돌려 실어야 화면이 fixture에서도 같은 코호트를 읽는다.
    // buildId는 활성 build 전환을 재현할 수 있도록 요청 시점에 읽는다(캐시 e2e).
    meta: {
      ...META,
      buildId: activatedBuildId(BASE_BUILD_ID),
      item: query.item ?? null,
      opened: query.opened,
      asOf: query.opened === 'only' ? FIXTURE_AS_OF : null
    }
  });
  return Response.json(body);
}
