# 0023 — Next.js Web 모듈 경계와 계약 소비

- Status: Accepted
- Date: 2026-08-31
- Supersedes: 없음

## Context

ADR 0008은 Web, Server, Dataplane의 세 deployable을, ADR 0021은 Nest와 Next가 공유하는 Zod public
wire 권위를 확정했다. 그러나 `apps/web` 내부의 route, shell, 사용자 흐름, 재사용 가능한 resource,
범용 UI/transport 소유권과 상태 경계는 정하지 않았다.

현재 Web은 route component와 `components/hooks/lib/types`에 직접 `fetch`, 수동 response type, client
calculation과 persistence를 섞는다. 같은 endpoint가 여러 화면에 필요할 때 화면별 service를 복사하거나
다른 화면의 code를 역참조하게 된다. 새 Server와 호환되는 공개 제품 계약은 canonical auction 단건
조회뿐이므로, 폴더 이동이나 legacy endpoint 포장으로 완성된 전환을 주장할 수도 없다.

## Decision

`apps/web`은 하나의 Next.js modular-monolith deployable로 유지하고 다음 경계를 둔다.

- `app`: Next route graph, metadata, loading/error/not-found, RSC composition
- `shell`: provider, navigation과 application chrome
- `capabilities`: 사용자가 수행하는 독립 흐름
- `api`: 계약 기반 resource request, Query Options와 server-state public entry
- `routing`: 반복되는 동적 Next 화면 URL의 generated-route-checked builder
- `shared`: 범용 config/lib/UI primitive

한 route에서만 쓰는 presentation과 interactive leaf는 route segment의 private `_model`/`_ui`/`_lib`가
소유한다. 단순 조회 화면을 capability로 포장하지 않는다. capability는 독립된 사용자 intent,
command/permission/feedback lifecycle 또는 여러 resource orchestration이 실제로 있을 때만 만든다.

실제 내부 의존 방향은 다음과 같다.

- `app → shell + capability public entry + api resource public/server entry`
- `app route-private code → api resource public/server entry + shared`
- `shell → shared`
- `capability → api resource public entry + shared`
- `app + shell + capability → routing`
- `api resource → api/_transport + shared + @eatbid/contracts`
- `routing → Next Route type + @eatbid/contracts identifier atom`
- `api/_transport → external HTTP library + common Problem Details contract`
- `shared → external library`

위 목록은 내부 project edge를 제한한다. 각 layer는 자신의 책임에 필요한 승인된 framework/toolkit을
직접 import할 수 있다. 예를 들어 shell provider는 TanStack Query/next-themes를, API resource의
`queries.ts`는 TanStack Query를 사용할 수 있지만 이를 이유로 다른 내부 layer를 역참조할 수는 없다.

shell과 capability는 형제 경계다. shell이 capability를 소유하거나 capability가 다른 capability 내부를
import하지 않는다. cross-slice import는 client-safe `index.ts` 또는 명시적 `server.ts`를 통과한다.
같은 endpoint의 consumer adapter와 `queryOptions()`는 해당 API resource가 한 번 소유하며 capability는
여러 resource를 조합한다. API resource끼리 직접 import하지 않는다.

operation method/path와 request/response schema의 권위는 `packages/contracts`, endpoint 구현과 업무
use case 권위는 Nest module에 남는다. Web API resource가 소유하는 것은 fetch/mutation adapter, query
key/options와 capability-neutral selector의 배치다. 화면별 presentation, form, 권한·피드백과 여러
resource orchestration은 capability가 소유한다. Web은 browser-safe contract resource subpath만 소비하고
package root나 generator/ingestion export를 client graph에 넣지 않는다.

canonical operation은 method, version, semantic path segment/parameter, path/query/body schema, status별
response/Problem Details, implementation owner와 `operationId`를 한 registry entry로 묶는다. 같은
framework-neutral path definition에서 Nest adapter path/version, OpenAPI template와 encoded Web request path를 파생한다. frontend `ENDPOINTS`
mirror와 Nest/Web의 `/api/v1/...` literal 중복을 허용하지 않는다. API origin은 operation에 넣지 않고
runtime config가 소유한다. cross-file endpoint lint를 Web strict lint, Server architecture check와 root CI에서
같이 실행해 이 규칙을 선언이 아니라 merge gate로 만든다.

route는 metadata, RSC read/prefetch와 shell model 주입에 한해 API resource server entry를 사용할 수
있다. shell은 session/workspace endpoint를 직접 읽지 않고 상위 layout이 검증해 전달한 serializable
view만 렌더링한다.

여러 route에서 같은 코드를 사용한다는 이유만으로 capability로 승격하지 않는다. 공통 server-state
selector는 API resource, 범용 helper/primitive는 shared, 독립 사용자 행위만 capability가 소유한다.

Server Component를 기본으로 하고 browser API, event, form 또는 Query subscription이 필요한 leaf만
Client Component로 만든다. raw `fetch`와 `Response` body decode는 `api/_transport`만 수행하고 resource는
승인된 request adapter에 `@eatbid/contracts` operation schema를 주입해 `unknown` public response를
runtime parse한다. generic `res.json() as T`, transport 우회, 수동 public DTO, DB row/server internal type
소비를 금지한다.
browser same-origin entry와 `server-only` internal-origin entry는 같은 operation/schema parser를 공유하되
서로 다른 public entry로 분리해 server 환경·cookie/cache 의존성이 client bundle에 섞이지 않게 한다.

URL로 공유할 상태는 `nuqs`, interactive server cache는 TanStack Query, command draft는 TanStack Form,
일시적 UI는 local React state가 소유한다. Zustand와 browser storage는 입증된 client-owned state에만
사용하며 canonical facts, 분석 evidence, 후보값 또는 업무 상태의 권위가 될 수 없다.

Parallel Route는 같은 URL에 동시에 존재하며 독립 loading/error/URL lifecycle이 필요한 panel에만
사용한다. 코드 모듈 경계를 만들기 위해 `@slot`을 사용하지 않는다. Next Route Handler는 product
Server를 우회하는 BFF나 두 번째 업무 진실 원천이 될 수 없다.

Next 화면 route의 권위는 `app/` file-system이다. `typedRoutes`와 `next typegen`이 생성한 route type으로
Link/router/PageProps를 검사한다. 반복되는 동적 URL에만 작은 resource별 builder를 허용하고 전체 route
목록 mirror나 `as Route` cast를 만들지 않는다. `/api/**` ingress는 Nest 전용이라 신규 `route.ts`를 기본
금지한다. 예외는 별도 ADR, Web owner operation, non-`/api` prefix와 ingress rule을 요구한다. Server Action의
opaque transport는 화면 route registry와 같은 것으로 취급하지 않는다.

interactive cache/optimistic update가 중심인 command는 resource `mutationOptions()`로 browser→Nest를
호출한다. progressive enhancement, RSC invalidation 또는 server-only cookie composition이 필요한 경우에만
Server Action이 같은 resource server entry를 호출한다. Action에는 Zod input/output와 serializable result,
성공 후 invalidation만 두고 DB/domain/business logic을 금지한다.

전환은 canonical vertical slice 단위로 한다. 첫 실행 slice는 decimal bigint string으로 식별하는
`GET /api/v1/auctions/{auctionId}`와 `/auctions/[auctionId]`다. market, analysis, work item과 candidate
flow는 각각의 Server contract가 생길 때까지 연결을 추측하지 않는다.

## Consequences

- route가 얇아지고 endpoint ownership, 상태 수명과 RSC/client 경계를 기계적으로 검사할 수 있다.
- 같은 endpoint를 여러 capability가 써도 query key나 fetcher가 복제되지 않는다.
- `packages/domain`과 혼동되는 두 번째 frontend domain layer를 만들지 않는다.
- explicit adapter, public entry와 presentation mapping 파일 수가 늘어난다.
- legacy 화면은 전환 중 공존할 수 있지만 target-compliant로 간주되지 않는다.
- 시장·분석·work-item 계약 부재는 해당 연결 화면의 명시적 blocker가 된다.
- Web은 계속 한 번에 build/deploy하며 microfrontend 운영 비용은 생기지 않는다.

## Rejected alternatives

- Full FSD layer set: 현재 Next route graph와 중복되는 `pages/widgets` 용어와 barrel 비용이 더 크다.
- route 또는 `@slot`을 module 경계로 사용: URL lifecycle과 코드 소유권이 불필요하게 결합된다.
- capability별 `api/types/service/queries`: 공유 endpoint 중복과 capability 간 역참조가 생긴다.
- 별도 frontend `domains`: resource 경계는 유효하지만 `packages/domain`과 권위 명칭이 충돌한다.
- Query/Zustand 한 곳에 모든 상태 저장: URL, server cache, form draft, local UI의 권위와 수명을 지운다.
- Next Route Handler 업무 BFF: Nest public contract와 별개인 두 번째 API 권위를 만든다.
- 초기 microfrontend/디자인 시스템 package: 독립 배포·ownership 근거 없이 경계 비용만 늘린다.
