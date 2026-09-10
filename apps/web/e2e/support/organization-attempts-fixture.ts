/** @module 책임: 기관 회차 이력 조회(listOrganizationAuctionAttempts) 하나만 재현하는 브라우저 검증 전용 fixture 응답기다.
 * auction-contract-fixture-server.ts가 300줄을 넘지 않도록 회차 응답만 이 모듈이 소유한다. */
import { Temporal } from '@eatbid/domain';
import { organizationAuctionAttemptsV1ResponseSchema, organizationV1Operations } from '@eatbid/contracts/api/v1/organizations';

import { activatedBuildId, serveBuildId } from './cache-observability';
import namsanAttemptsFixture from './fixtures/namsan-attempts.json';

const ORGANIZATION_ID = '3101';
const operation = organizationV1Operations.listAuctionAttempts;

// buildPath는 querySchema 기본값(limit) 때문에 query 없이 불러도 항상 `?limit=` 꼬리가 붙는다. 경로
// 매칭에는 pathname만 필요하므로 openApiPath에서 직접 정규식을 뽑아 쓴다. 이렇게 하면 organizationId
// 자리표시자 위치가 계약에서 바뀌어도 이 fixture가 따로 어긋나지 않는다.
const ORGANIZATION_ATTEMPTS_PATH_PATTERN = new RegExp(`^${operation.openApiPath.replace('{organizationId}', '([^/]+)')}$`);

type FixtureAttempt = {
  readonly attemptId: string;
  readonly openedAt: string | null;
  readonly floorRate: { readonly value: string } | null;
  readonly awardMethodCodeValueId: string | null;
  readonly item: { readonly codeValueId: string } | null;
};

const NAMSAN_ATTEMPTS = (namsanAttemptsFixture as { readonly attempts: readonly FixtureAttempt[] }).attempts;

const BASE_BUILD_ID = '501';

// 개찰 기준 시각이다. fixture 회차는 전부 이보다 앞서 개찰됐으므로 `opened=only`가 행을 줄이지 않는다.
const FIXTURE_AS_OF = '2026-09-06T00:00:00Z';

// 한 페이지 상한. 계약 상한(200)보다 낮은 이유는 60행 fixture로 keyset 페이지네이션("더 불러오기")을
// 재현하기 위해서다 — 5년 조회가 limit 60을 요청해도 40행 뒤에 nextCursor가 붙어 다음 페이지가 실제로 있다.
// 40 아래로 내리면 손잡이 90.000→90.001에서 판정이 갈리는 회차(그날 하한 90.0010, 35번째)가 첫 페이지에서
// 빠져 손잡이 e2e가 "이 값이면"의 변화를 볼 수 없다.
const FIXTURE_PAGE_LIMIT = 40;

const LINEAGE = {
  sourceReleaseId: '0f5f5d3c-6a1b-4f2e-9c8d-1a2b3c4d5e6f',
  calcVersion: 'mart-r1',
  computedAt: '2026-09-04T00:10:00Z',
  // 지금 수집 구간에는 시도 축이 없어 모집단 보유율을 그 grain으로 낼 수 없다(PDR-0003).
  coverage: 'unknown',
  regionScheme: 'eat:auction-location-sigungu'
} as const;

function organizationProblemResponse(status: 400 | 404 | 409, code: string, title: string): Response {
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

/**
 * 서버는 `opened_at`을 KST 달 경계 instant와 견준다(list-organization-auction-attempts.ts). 여기서는 같은
 * 경계를 달 텍스트로 옮겨 비교한다 — `YYYY-MM`은 사전순이 시간순과 같아 두 방식의 결과가 같고, fixture가
 * 경계 산술을 따로 구현해 서버와 갈라지지 않는다. 개찰 시각이 없는 회차는 어떤 달 조건에도 들지 않는다.
 */
function openedKstMonth(attempt: FixtureAttempt): string | null {
  if (attempt.openedAt === null) return null;
  const zoned = Temporal.Instant.from(attempt.openedAt).toZonedDateTimeISO('Asia/Seoul');
  return `${zoned.year.toString().padStart(4, '0')}-${zoned.month.toString().padStart(2, '0')}`;
}

type Query = ReturnType<typeof operation.querySchema.parse>;

// 서버 drizzle 술어와 같은 규약이다: 조건이 없거나 all이면 거르지 않고, unknown은 관측 없는 행하고만 맞는다.
function matchesExact(value: string | null, filter: string | undefined): boolean {
  if (filter === undefined || filter === 'all') return true;
  if (filter === 'unknown') return value === null;
  return value === filter;
}

function matchesQuery(attempt: FixtureAttempt, query: Query): boolean {
  if (query.opened === 'only' && !(attempt.openedAt !== null && attempt.openedAt <= FIXTURE_AS_OF)) return false;
  if (!matchesExact(attempt.floorRate?.value ?? null, query.floorRate)) return false;
  if (!matchesExact(attempt.awardMethodCodeValueId ?? null, query.awardMethod)) return false;
  if (query.item !== undefined && attempt.item?.codeValueId !== query.item) return false;
  if (query.from !== undefined || query.to !== undefined) {
    const month = openedKstMonth(attempt);
    if (month === null) return false;
    if (query.from !== undefined && month < query.from) return false;
    if (query.to !== undefined && month > query.to) return false;
  }
  return true;
}

/**
 * 서버 `cohortOf`와 같은 규칙이다: 조건이 하나라도 명시되면 적용 사실을 응답에 되돌리고, 하나도 없으면
 * 필드를 만들지 않는다. 이 값이 요청과 다르면 web wrapper가 "비교 조건의 적용 여부를 확인할 수 없습니다"로
 * 거절하므로, 실제로 거르지 않은 조건을 여기서 거짓으로 실어 통과시키면 안 된다.
 */
function cohortOf(query: Query) {
  if (query.floorRate === undefined && query.awardMethod === undefined && query.from === undefined && query.to === undefined) {
    return undefined;
  }
  const floor = query.floorRate ?? 'all';
  const method = query.awardMethod ?? 'all';
  return {
    floorRate: floor === 'all' || floor === 'unknown'
      ? { kind: floor }
      : { kind: 'exact', value: { value: floor, unit: 'percentage-points' } },
    awardMethod: method === 'all' || method === 'unknown'
      ? { kind: method }
      : { kind: 'exact', codeValueId: method },
    period: query.from === undefined || query.to === undefined ? null : { from: query.from, to: query.to }
  };
}

// 서버는 코호트 조회일 때만 회차의 낙찰방식을 싣고, revision은 opt-in 요청에만 싣는다. fixture 행은 낙찰방식을
// 항상 들고 있으므로 같은 규칙으로 덜어내고, revision은 회차 ID 뒤에 1을 붙인 규칙으로 만든다(명단 fixture와 같은 규칙).
function attemptResource(attempt: FixtureAttempt, includeCohort: boolean, includeRevision: boolean) {
  const { awardMethodCodeValueId, ...rest } = attempt;
  return {
    ...rest,
    ...(includeCohort ? { awardMethodCodeValueId } : {}),
    ...(includeRevision ? { revisionId: `${attempt.attemptId}1` } : {})
  };
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

  let query: Query;
  try {
    query = operation.querySchema.parse(Object.fromEntries(url.searchParams));
  } catch {
    return organizationProblemResponse(400, 'VALIDATION_ERROR', '기관 ID 또는 query가 유효하지 않음');
  }

  // 고정을 요청한 build가 활성 build와 다르면 서버처럼 409로 닫는다. 다음 페이지를 새 계보로 이어 주면 화면이
  // 두 build의 회차를 섞는다(ADR 0034).
  if (query.expectedBuildId !== undefined && query.expectedBuildId !== activatedBuildId(BASE_BUILD_ID)) {
    return organizationProblemResponse(409, 'CONFLICT', '고정을 요청한 mart build가 더 이상 활성이 아님');
  }

  // 표본 수는 페이지가 아니라 같은 술어를 통과한 전체 회차다. 페이지와 다른 집단을 세면 화면의
  // "표본 N회 중 M회 표시"가 재현 불가능한 숫자가 된다(AGENTS 7).
  const scoped = NAMSAN_ATTEMPTS.filter((attempt) => matchesQuery(attempt, query));

  let start = 0;
  if (query.cursor !== undefined) {
    const cursorIndex = scoped.findIndex((attempt) => attempt.attemptId === query.cursor);
    if (cursorIndex < 0) {
      return organizationProblemResponse(400, 'VALIDATION_ERROR', '기관 ID 또는 query가 유효하지 않음');
    }
    start = cursorIndex + 1;
  }
  const pageEnd = start + Math.min(query.limit, FIXTURE_PAGE_LIMIT);
  const page = scoped.slice(start, pageEnd);
  const cohort = cohortOf(query);

  const body = organizationAuctionAttemptsV1ResponseSchema.parse({
    organizationId: ORGANIZATION_ID,
    attempts: page.map((attempt) => attemptResource(attempt, cohort !== undefined, query.includeRevision === 'true')),
    nextCursor: pageEnd < scoped.length ? page[page.length - 1]?.attemptId ?? null : null,
    // 서버와 같이 적용한 조건을 그대로 되돌려야 화면이 fixture에서도 같은 코호트를 읽는다.
    // buildId는 활성 build 전환을 재현할 수 있도록 요청 시점에 읽고, 그 값을 이 조회가 내준 계보로 남긴다(캐시 e2e).
    meta: {
      ...LINEAGE,
      sampleCount: scoped.length,
      buildId: serveBuildId('organizationAttempts', BASE_BUILD_ID),
      item: query.item ?? null,
      opened: query.opened,
      asOf: query.opened === 'only' ? FIXTURE_AS_OF : null,
      cohort
    }
  });
  return Response.json(body);
}
