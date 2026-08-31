# 프론트엔드 아키텍처 기반 구현 계획

> **에이전트 작업자 필수:** 각 작업을 구현할 때 `superpowers:subagent-driven-development`(권장) 또는
> `superpowers:executing-plans` 스킬을 사용한다. 진행 상태는 체크박스(`- [ ]`)로 추적한다.

**목표:** 제품 화면을 임의로 재설계하거나 없는 백엔드 계약을 발명하지 않고, 강제 가능한 Web 모듈 경계,
계약 검증 resource API, 기존 동작을 보존하는 shell과 첫 canonical 공고 조회 slice를 구축한다.

**아키텍처:** `app`은 Next lifecycle과 route-private presentation, `shell`은 provider/chrome,
`capabilities`는 재사용 사용자 intent와 orchestration, `api/<resource>`는 consumer adapter와 Query Options,
`shared`는 범용 UI/lib를 소유한다. `packages/contracts`의 resource operation descriptor 하나에서 Nest,
OpenAPI와 인코딩된 Web request path를 파생한다. Browser와 RSC entry는 같은 계약 decode를 사용하되 import
graph는 분리한다. 첫 실행 slice는 기존 Nest V1 operation을 사용하는 `/auctions/[auctionId]`다.

**기술 스택:** Next.js 16.3.4 App Router/RSC, React 19.2.8, `@eatbid/contracts` Zod 4 schema,
TanStack Query 5.102.8 `queryOptions`, nuqs, TanStack Form 1.33.5, Tailwind CSS 4.3.3 semantic token,
Base UI/shadcn primitive, 첫 client async panel에서 도입할 Suspensive React 3.21.3, Bun component test,
Playwright 1.62.1 browser test와 Node architecture gate.

**명세:** [프론트엔드 모듈 아키텍처 설계](../specs/2026-08-31-frontend-modular-architecture-design.md)

## 전역 제약

- 저장소 전체 통합 순서상 EAT-9를 canonical branch에 병합하기 전에 `main` PR gate와 ingestion spine
  hardening이 선행돼야 한다. worktree 준비는 가능하지만 통합 시 선행 작업을 우회하지 않는다.
- [프론트엔드 runtime 업그레이드](2026-08-31-frontend-runtime-upgrade.md)를 먼저 실행한다. 이 계획은 해당
  문서의 exact dependency lane과 deterministic typecheck를 전제로 한다.
- claim한 EAT-9 worktree에서만 작업하고 writing owner 한 명을 유지한다. review agent는 read-only다.
- 사람이 읽는 문서, UI 문구, 테스트명, 커밋 메시지와 이유 주석은 한국어로 작성한다. 코드 식별자,
  라이브러리 고유명, CLI 명령, 외부 공식 인용과 원문 오류만 정확성에 필요한 범위에서 영문을 유지한다.
- 이 branch에서 EAT-5 소유 product/domain roadmap 파일이나 임시 frontend 보류 문구를 수정하지 않는다.
- `packages/contracts`가 operation method/version, semantic path/input builder와 wire schema를 소유하고 Nest가
  endpoint 동작, Web이 consumer adapter/query 배치만 소유한다.
- API origin은 runtime config가 소유한다. Next 화면 route는 `app/`과 generated route type이 소유하며 둘 다
  public HTTP operation registry에 넣지 않는다.
- Server 계약이 생기기 전에 market, analysis, work-item, candidate, auth, school API를 Web에서 만들지 않는다.
- 테스트를 먼저 작성하고 신규·변경 테스트명은 모두 한국어로 쓴다.
- 모든 Query `AbortSignal`을 `fetch`까지 전달하고 public 2xx body는 `unknown`에서 operation response schema로
  parse한다.
- `src/api/_transport/**`만 raw `fetch`를 호출하거나 `Response` body를 decode한다. resource module은 주입된
  contract transport를 사용한다.
- `res.json() as T`, 미검증 `res.json()`, 수동 public DTO, ID의 `Number` 변환, capability 간 import,
  API resource 간 import와 product Route Handler를 금지한다.
- `/api/**`는 Nest 소유다. Server Action은 progressive enhancement, RSC invalidation 또는 server-only cookie
  조합이 필요할 때만 같은 resource `server.ts`를 호출하는 얇은 Zod 검증 adapter로 허용하며 DB/domain
  logic이나 별도 command 계약을 소유하지 않는다.
- 300줄을 넘는 source는 분리하거나 이유, owner와 다음 분리 조건이 있는 명시적 검토 waiver를 둔다.
- 기존 theme mode/palette control과 공통 Button press feedback을 보존하고 base Button에 auth/logging을 넣지 않는다.
- motion duration은 semantic CSS token으로 press 70ms, state 110ms, enter 150ms, panel 240ms다. component-local
  millisecond literal, `transition-all`, bounce와 반복 업무 motion의 400ms 초과를 금지한다.
- `shared/ui/Button`이 기본 press feedback을 소유하고 stable link/navigation/popup/toolbar wrapper가 quiet 예외를
  한 번 소유한다. 화면 호출부는 press class를 직접 추가하지 않는다.
- `shared/ui/LoadingButton`은 pending geometry와 접근성만 소유하며 session, permission, command와 telemetry를
  import하지 않는다.
- 이 계획에는 session/permission Server 계약이 없다. 사용되지 않는 `shared/action`, 가짜 permission catalog나
  client-only 보안 추상화를 만들지 않고 첫 contract-backed protected command에서 승인된 action 합성을 구현한다.
- `loading.tsx`는 route 소유 `ScreenSkeleton` 하나만 반환하고 Skeleton markup을 포함하지 않는다. refetch는 기존
  데이터를 유지하고 mutation feedback은 실행 control에 남기며 abort는 error UI를 만들지 않는다.
- `@suspensive/react-query`, React canary `ViewTransition`, Motion alpha API와 현재 사용되지 않는 `motion` package는
  foundation dependency가 아니다.
- 각 task의 검사가 통과한 뒤에만 task 단위로 커밋한다.

---

## 보호된 action의 후속 구현 조건

Server가 canonical session, permission 또는 protected command operation을 아직 공개하지 않았으므로 이 계획은
auth/permission action runtime을 미리 만들지 않는다. 첫 보호 operation은 별도 vertical-slice 계획에서 shared
action port, capability policy/component, Nest Guard/application policy와 server audit를 하나의 검토 가능한
변경으로 만든다. Server 강제 없이 안전해 보이기만 하는 Web 전용 `AuthorizedAction`은 허용하지 않는다.

후속 계획은 다음 승인된 조립 방향을 유지한다.

```text
capability command component
  → capability policy + resource mutation + typed telemetry event
  → resource-neutral action state/port
  → shared LoadingButton → shared Button
  → Nest Guard/application policy + server audit
```

기본 UX는 비로그인 사용자에게 discoverable action을 보여 주고 로그인 prompt를 요청하며, 로그인했지만 권한이
없는 사용자에게 안전한 사유와 focus 가능한 disabled control을 제공한다. 기능 존재 자체가 민감할 때만
숨긴다. render 뒤 401은 인증을 다시 열고 403은 재시도하지 않는다. 고위험 후보값과 향후 투찰 action은
optimistic success를 표시하지 않는다.

---

## 작업 1: legacy 부채를 고정하고 신규 import graph를 강제한다

**대상 파일:**

- 생성: `tools/architecture/check-web-boundaries.mjs`
- 생성: `tools/architecture/check-web-boundaries.test.mjs`
- 생성: `tools/architecture/web-boundaries/policy.mjs`
- 생성: `tools/architecture/web-boundaries/inspect.mjs`
- 생성: `tools/architecture/web-boundary-legacy-baseline.json`
- 수정: `package.json`

- [ ] 다음 규칙을 검증하는 한국어 이름의 실패 `node:test` fixture를 작성한다.
  - `shell`이 `api`나 `capabilities`를 import하면 실패한다.
  - 한 capability가 다른 capability internal을 import하면 실패한다.
  - API resource가 다른 API resource를 import하면 실패한다.
  - `@/api/auctions`, `@/api/auctions/server`는 통과하고 `@/api/auctions/get-auction` deep import는 실패한다.
  - `src/api/_transport/**` 밖의 직접 `fetch`나 `Response.json()`은 실패한다. plain
    `await response.json()`으로 `_transport`를 우회하는 resource module도 포함한다.
  - 검증하지 않은 `.json() as`와 수동 public response interface는 실패한다.
  - resource 내부에서 `browser-request`는 `index.ts`만, `server-request.server`는 `server.ts`만 import할 수 있고
    transport neutral operation 파일은 `ContractRequest` type만 import할 수 있다.
  - route `error.tsx`는 허용하지만 `page.tsx`나 `layout.tsx`의 `'use client'`는 실패한다.
  - ID를 `Number`/`parseInt`에 전달하면 실패한다.
  - 완전한 waiver 없이 source가 300줄을 넘으면 실패한다.
  - 정확한 legacy baseline fingerprint는 통과하지만 위반을 삭제하지 않고 내용을 바꾸면 실패한다.
- [ ] `inspectWebBoundaries({ sourceRoot, baselinePath })`와 검사 전용 CLI를 구현한다. 삭제만 허용하는 legacy
  항목에는 정규화된 path와 SHA-256 fingerprint를 함께 사용하며 path만으로 일치시키지 않는다.
- [ ] `--write-baseline`은 최초 검토 inventory에만 허용한다. 각 항목은 `rule`, `path`, `sha256`, `reason`,
  `owner`, `splitTrigger`를 기록한다.
- [ ] runtime upgrade 이후 legacy tree에서 baseline을 한 번 생성해 모든 항목을 검토하고, 이후에는
  `--write-baseline` 없이 checker를 실행한다.
- [ ] Web runtime 검사 다음에 `node tools/architecture/check-web-boundaries.mjs`를 root
  `architecture:check`에 추가한다.
- [ ] 실행한다.

```text
node --test tools/architecture/check-web-boundaries.test.mjs
node tools/architecture/check-web-boundaries.mjs
```

- [ ] 커밋한다.

```text
test(architecture): Web 모듈 경계를 강제한다
```

## 작업 2: public HTTP operation descriptor를 경로 권위로 만든다

**대상 파일:**

- 생성: `packages/contracts/src/api/operation.ts`
- 생성: `packages/contracts/src/api/operation.test.ts`
- 생성: `packages/contracts/src/api/v1/auctions/index.ts`
- 생성: `tools/architecture/check-contract-client-exports.mjs`
- 생성: `tools/architecture/check-contract-client-exports.test.mjs`
- 생성: `tools/architecture/check-http-operations.mjs`
- 생성: `tools/architecture/check-http-operations.test.mjs`
- 수정: `packages/contracts/src/api/v1/auctions/operations.ts`
- 수정: `packages/contracts/src/operations/health.ts`
- 수정: `packages/contracts/src/index.ts`
- 수정: `packages/contracts/package.json`
- 수정: `packages/contracts/tsconfig.json`
- 수정: `apps/server/src/modules/procurement/presentation/http/auction.controller.ts`
- 수정: `apps/server/src/bootstrap/openapi.ts`
- 수정: `apps/server/src/bootstrap/openapi.test.ts`
- 수정: `apps/server/package.json`
- 수정: `apps/web/package.json`
- 수정: `package.json`
- 수정: `turbo.json`

- [ ] 다음을 증명하는 RED 테스트를 작성한다.
  - operation descriptor 하나가 method, versioning policy, semantic path segment, path/query/body schema, status별
    response schema, Problem Details status, implementation owner와 `operationId`를 소유한다.
  - `buildPath({ path, query })`는 interpolation 전에 검증하고 dynamic value를 정확히 한 번 percent encode하며
    origin은 받지 않는다.
  - framework neutral semantic path 정의 하나에서 auction operation의 Nest adapter는 controller/handler/version,
    OpenAPI adapter는 template, Web은 `/api/v1/auctions/<encoded-id>`를 파생한다.
  - 잘못된 bigint text는 path 생성 전에 거부되고 signed bigint 최댓값 text는 그대로 유지된다.
  - registry 조립 시 중복 operation ID와 중복 method+OpenAPI path pair를 거부한다.
  - Nest decorator path와 generated OpenAPI는 수동 `/api/v1/...` equality check 없이 파생 field를 사용한다.
  - metadata object 비교에 그치지 않고 실제 Nest route discovery가 operation method/version/path와 일치한다.
  - health operation은 명시적으로 unversioned이며 기존 public path를 유지한다.
- [ ] Nest/Web source의 신규 canonical `/api/v1/...` literal, frontend `ENDPOINTS` mirror와 검토된 단일 contract
  정의 밖의 수동 operation path를 거부하는 RED architecture lint fixture를 작성한다. commit된 OpenAPI artifact,
  test/fixture, 문서와 격리된 legacy fingerprint는 명시적으로 예외 처리하되 신규 legacy literal까지 통과시키는
  광범위한 directory 예외를 쓰지 않는다.
- [ ] `@eatbid/contracts/api/v1/auctions`가 browser-safe ESM import를 제공하고 Node generator, portable ingestion,
  server-only export를 transitive graph에서 제외하며 `@eatbid/domain` runtime을 load하지 않음을 증명하는 RED
  package/export fixture를 작성한다. 기존 package root는 Server/generator 호환 표면으로 남을 수 있지만 Web
  source는 import하지 않는다.
- [ ] filtered Web dev startup, root `turbo dev`, Web typecheck와 production build의 clean-checkout process test를
  작성한다. Contract source 수정은 검증된 source/watch 경로로 dev graph에 도달해야 하며 오래된 ignored `dist`
  directory나 개발자의 사전 manual build가 숨은 선행 조건이 되어서는 안 된다.
- [ ] 저장소가 소유하는 작은 `defineOperation()` helper를 구현한다. 두 번째 RPC framework를 도입하거나 metadata로
  Nest controller를 생성하지 않는다.
- [ ] descriptor를 portable하게 유지하고 Nest, Next, React, environment origin과 transport state를 넣지 않는다.
  Zod schema와 pure path builder는 허용한다.
- [ ] transport가 올바른 runtime schema를 고를 수 있도록 성공 응답을 status별로 표현한다. 공유 RFC 9457 schema는
  contract package에 두고 thrown Nest class를 contract metadata로 바꾸지 않는다.
- [ ] uniqueness test와 OpenAPI 생성이 쓰는 검토된 operation registry를 export한다. resource scoped export가
  일반 consumer entry다.
- [ ] 명시적인 client-safe ESM subpath export와 분리된 Server/generator surface를 추가한다. bundler가 tree-shake할
  것처럼 보인다는 이유로 root barrel 전체를 Web에 공개하지 말고 emitted/import graph를 검증한다.
- [ ] `/api/**`는 `implementationOwner: 'server'`에 예약한다. 신규 `app/**/route.ts`는 기본 거부하며 Web 소유
  public handler에는 non-`/api` prefix, 명시적 ingress rule과 같은 변경의 ADR이 필요하다.
- [ ] checker용 root `lint:endpoints`를 추가한다. root `architecture:check`, Web `lint:strict`, Server
  `architecture:check`와 protected branch CI에서 실행해 editor/package lint와 monorepo CI가 같은 규칙을 강제한다.
  Oxlint는 AST/style 규칙을 담당하고 이 저장소 checker가 cross-file uniqueness와 Nest/OpenAPI/Web drift를 소유한다.
- [ ] 실행한다.

```text
node --test tools/architecture/check-http-operations.test.mjs
node --test tools/architecture/check-contract-client-exports.test.mjs
pnpm lint:endpoints
pnpm --filter @eatbid/contracts test
pnpm --filter @eatbid/server test
pnpm --filter @eatbid/server openapi:check
pnpm --filter @eatbid/web lint:strict
pnpm --filter @eatbid/server architecture:check
pnpm architecture:check
pnpm --filter @eatbid/web typecheck
pnpm --filter @eatbid/web build
```

- [ ] 커밋한다.

```text
refactor(contracts): 공개 operation 경로 권위를 통합한다
```

## 작업 3: 범용 contract transport와 명시적인 ingress 분리를 만든다

**대상 파일:**

- 생성: `apps/web/src/api/_transport/http-problem.ts`
- 생성: `apps/web/src/api/_transport/request-contract.ts`
- 생성: `apps/web/src/api/_transport/browser-request.ts`
- 생성: `apps/web/src/api/_transport/server-request.server.ts`
- 생성: `apps/web/src/api/_transport/request-contract.test.ts`
- 생성: `apps/web/config/api-rewrites.ts`
- 생성: `apps/web/config/api-rewrites.test.ts`
- 수정: `apps/web/next.config.ts`

- [ ] 주입된 `fetch` 구현으로 다음을 검증하는 RED 테스트를 작성한다.
  - 유효한 JSON은 주입된 Zod schema로 parse한다.
  - 잘못된 2xx JSON은 `ContractResponseError`로 거부하고 반환하지 않는다.
  - 유효한 RFC 9457 non-2xx는 status/code/requestId를 가진 `HttpProblemError`로 mapping한다.
  - 잘못되거나 JSON이 아닌 non-2xx는 raw response text 없이 정제된 `HttpStatusError`로 mapping한다.
  - 입력받은 바로 그 `AbortSignal`이 `fetch`에 도달하고 abort는 abort로 유지된다.
  - browser target은 same origin이고 server target은 검증된 `API_URL`을 쓴다.
  - server-only environment code를 browser module이 export하지 않는다.
  - API rewrite는 `NODE_ENV === 'development'`에서만 존재하고 production은 `[]`를 반환한다.
- [ ] 다음 형태의 transport neutral interface를 구현한다. 정확한 generic helper는 `defineOperation`에서 파생하고
  operation input을 다시 string으로 넓히지 않는다.

```ts
export interface ContractRequest {
  <Operation extends PublicHttpOperation>(input: {
    operation: Operation
    path: OperationPathInput<Operation>
    query?: OperationQueryInput<Operation>
    body?: OperationBodyInput<Operation>
    signal?: AbortSignal
  }): Promise<OperationSuccess<Operation>>
}
```

- [ ] `_transport`는 주입된 operation에 relative request 검증/build를 요청하고 runtime origin, status,
  Problem Details, JSON decode, status schema 호출, correlation-safe error와 signal 전달만 담당한다. auction operation,
  Query, React, toast, UI를 import하지 않고 resource caller의 임의 endpoint URL을 받지 않는다.
- [ ] `server-request.server.ts`에 `import 'server-only'`를 둔다. 호출 시점에 `API_URL`을 읽고 development 기본값은
  `http://localhost:4400`으로 하며 network I/O 전에 잘못된 origin을 거부한다.
- [ ] 테스트된 `createApiRewrites({ nodeEnv, apiUrl })` config helper를 추가한다. `/api/:path*` proxy는
  `development`에서만 반환하고 production/test에서는 `[]`를 반환한다. local browser code는 same-origin call을
  유지하고 production ingress가 `/api` routing을 소유한다. 이는 transport proxy이지 business BFF가 아니다.
- [ ] 실행한다.

```text
bun test apps/web/src/api/_transport/request-contract.test.ts apps/web/config/api-rewrites.test.ts
pnpm --dir apps/web exec oxlint src/api/_transport config/api-rewrites.ts next.config.ts --deny-warnings
pnpm --filter @eatbid/web typecheck
```

- [ ] 커밋한다.

```text
feat(web): 계약 검증 API transport를 추가한다
```

## 작업 4: canonical 공고 resource API와 Query Options를 추가한다

**대상 파일:**

- 생성: `apps/web/src/api/auctions/get-auction.ts`
- 생성: `apps/web/src/api/auctions/auction-resource-error.ts`
- 생성: `apps/web/src/api/auctions/queries.ts`
- 생성: `apps/web/src/api/auctions/index.ts`
- 생성: `apps/web/src/api/auctions/server.ts`
- 생성: `apps/web/src/api/auctions/get-auction.test.ts`
- 생성: `apps/web/src/api/auctions/queries.test.ts`

- [ ] 다음을 증명하는 RED 테스트를 작성한다.
  - `9007199254740993`, `9223372036854775807`은 URL과 query key에서 decimal string으로 유지된다.
  - 선행 0, 0, 음수, 소수와 overflow ID는 fetch 전에 `auctionIdPathSchema`에서 실패한다.
  - request는 `auctionV1Operations.find`와 검증된 path input을 transport에 전달하고 encoded path는 `buildPath`에서
    나오며 response parse는 status별 operation schema를 쓴다.
  - 유효한 response는 정확한 money string, nullable schedule field, revision identity와 provenance를 보존한다.
  - 잘못된 2xx는 반환 data에 들어가지 않는다.
  - Query 함수는 주입된 signal을 사용한다.
  - `auctionQueries.detail(id)`는 계층형 canonical key 하나를 만들며 third-party key factory가 필요 없다.
  - 정확한 404/`AUCTION_NOT_FOUND` problem은 resource level not found error로 mapping되고 500/503, malformed
    problem과 abort는 원래 typed failure로 유지된다.
  - `index.ts`는 server entry를 export하지 않고 consumer는 internal을 deep import할 수 없다.
- [ ] 내부 `getAuctionWith(request, { auctionId, signal })` 함수 하나를 구현한다. `index.ts`/`queries.ts`에는 browser
  request를, `server.ts`에는 server request를 bind한다. URL 대신 operation descriptor와 구조화된 path input을
  전달하고 path 구성이나 schema parse를 복제하지 않는다.
- [ ] `index.ts`에서 client-safe `getAuction`, `auctionQueries`와 contract inferred result type을 export한다.
  `getAuctionFromServer`, route ID parse와 `isAuctionNotFoundError`는 `server.ts`에서만 export해 route가 `_transport`
  또는 resource internal을 import하지 않게 한다.
- [ ] `src/api`에 React hook을 추가하지 않는다. interaction이 정당한 경우 capability Client Component가 직접
  `useQuery(auctionQueries.detail(id))`를 호출한다.
- [ ] 실행한다.

```text
bun test apps/web/src/api/auctions
node tools/architecture/check-web-boundaries.mjs
pnpm --dir apps/web exec oxlint src/api/auctions --deny-warnings
pnpm --filter @eatbid/web typecheck
```

- [ ] 커밋한다.

```text
feat(web): 공고 resource client를 추가한다
```

## 작업 5: provider와 theme 권위를 shell로 옮긴다

**대상 파일:**

- 생성: `apps/web/src/shell/providers/app-providers.tsx`
- 생성: `apps/web/src/shell/providers/query-client.ts`
- 생성: `apps/web/src/shell/providers/query-provider.tsx`
- 생성: `apps/web/src/shell/providers/query-policy.test.ts`
- 생성: `apps/web/src/shell/theme/active-theme.tsx`
- 생성: `apps/web/src/shell/theme/font.config.ts`
- 생성: `apps/web/src/shell/theme/theme.config.ts`
- 생성: `apps/web/src/shell/theme/theme-provider.tsx`
- 생성: `apps/web/src/shell/theme/theme-mode-toggle.tsx`
- 생성: `apps/web/src/shell/theme/theme-selector.tsx`
- 생성: `apps/web/src/shell/theme/theme-transition.ts`
- 생성: `apps/web/src/shell/index.ts`
- 생성: `apps/web/src/shared/lib/cn.ts`
- 생성: `apps/web/src/shared/lib/format-bytes.ts`
- 생성: `apps/web/src/shared/lib/format-bytes.test.ts`
- 생성: `apps/web/src/types/tanstack-query.d.ts`
- 수정: `apps/web/src/app/layout.tsx`
- 수정: `apps/web/src/components/layout/header.tsx`
- 수정: `apps/web/src/components/layout/header.test.tsx`
- 수정: `apps/web/src/components/command-palette/theme-actions.ts`(선행 runtime 계획에서 생성)
- 호환 re-export로 교체: `apps/web/src/lib/utils.ts`
- import 이동 후 삭제: `apps/web/src/components/layout/providers.tsx`
- import 이동 후 삭제: `apps/web/src/components/layout/query-provider.tsx`
- import 이동 후 삭제: `apps/web/src/lib/query-client.ts`
- import 이동 후 삭제: `apps/web/src/lib/theme-transition.ts`
- import 이동 후 삭제: `apps/web/src/components/themes/active-theme.tsx`
- import 이동 후 삭제: `apps/web/src/components/themes/font.config.ts`
- import 이동 후 삭제: `apps/web/src/components/themes/theme.config.ts`
- import 이동 후 삭제: `apps/web/src/components/themes/theme-provider.tsx`
- import 이동 후 삭제: `apps/web/src/components/themes/theme-mode-toggle.tsx`
- import 이동 후 삭제: `apps/web/src/components/themes/theme-selector.tsx`

**경계:**

- 입력: 선행 runtime 계획의 exact runtime version과 Web-local test bootstrap.
- 출력: `createQueryClient({ notify, report }): QueryClient`, `getQueryClient(): QueryClient`,
  `AppProviders({ activeThemeValue, children })`와 client-safe shell theme export.

Query error 정책은 임의 metadata가 아니라 닫힌 type이다.

```ts
export interface RequestMeta extends Record<string, unknown> {
  errorPresentation: 'toast' | 'inline' | 'silent';
  successMessageId?: string;
  errorMessageId?: string;
}

export interface QueryClientPorts {
  notify: (messageId: string) => void;
  report: (error: unknown) => void;
}
```

- [ ] 다음을 검증하는 RED 테스트를 작성한다.
  - `meta.errorPresentation: 'toast'`인 Query/Mutation failure는 주입된 notifier를 한 번 호출한다.
  - `inline`, `silent` failure와 abort는 toast하지 않고 예상하지 못한 error는 telemetry callback에 도달한다.
  - React Query Devtools는 development에서만 mount된다.
  - QueryClient는 기본 stale time 60초와 dehydration의 pending query를 보존하고 server request마다 하나를
    생성하며 browser singleton 하나를 재사용한다.
  - header는 shell path의 `ThemeModeToggle`, `ThemeSelector`를 계속 render한다.
  - `formatBytes`는 호환 `@/lib/utils` path와 신규 shared path에서 같은 output으로 제공된다.
- [ ] TanStack `Register.queryMeta`와 `Register.mutationMeta`를 `errorPresentation: 'toast' | 'inline' | 'silent'`와
  선택적인 사용자 안전 success/error message ID를 가진 작은 `RequestMeta`로 정의한다. 임의 payload, bid value나
  PII를 meta에 허용하지 않는다.
- [ ] `createQueryClient({ notify, report })`를 테스트 가능하게 만든다. QueryCache/MutationCache callback은
  error를 전역 분류하고 capability는 typed meta로 표시 정책을 선택한다.
- [ ] 사용 가능한 palette, cookie name, keyboard 동작과 root hydration 동작을 바꾸지 않고 기존 theme logic을 옮긴다.
- [ ] `cn`과 `formatBytes`를 각각 집중된 shared module로 옮기고 legacy `src/lib/utils.ts`에서 둘 다 re-export한다.
  무관한 migration 없이 `file-uploader.tsx`가 계속 compile되어야 한다.
- [ ] 실행한다.

```text
pnpm --dir apps/web exec bun test src/shell src/shared src/components/layout/header.test.tsx
node tools/architecture/check-web-boundaries.mjs
pnpm --dir apps/web exec oxlint src/shell src/shared src/app/layout.tsx src/components/layout/header.tsx src/components/command-palette/theme-actions.ts --deny-warnings
pnpm --filter @eatbid/web typecheck
```

- [ ] 커밋한다.

```text
refactor(web): 셸 provider와 테마 권위를 정리한다
```

## 작업 6: motion token과 공통 action control을 확립한다

**대상 파일:**

- 생성: `apps/web/src/styles/tokens/motion.css`
- 생성: `apps/web/src/shared/ui/button.tsx`
- 생성: `apps/web/src/shared/ui/button.test.tsx`
- 생성: `apps/web/src/shared/ui/loading-button.tsx`
- 생성: `apps/web/src/shared/ui/loading-button.test.tsx`
- 생성: `apps/web/src/shared/ui/spinner.tsx`
- 수정: `apps/web/src/styles/globals.css`
- 수정: `apps/web/src/shell/theme/theme-transition.ts`
- 수정: `apps/web/src/package.json`
- 수정: `pnpm-lock.yaml`
- 수정: `tools/architecture/check-web-boundaries.mjs`
- 수정: `tools/architecture/check-web-boundaries.test.mjs`
- 호환 re-export로 교체: `apps/web/src/components/ui/button.tsx`
- 호환 re-export로 교체: `apps/web/src/components/ui/loading-button.tsx`
- 호환 re-export로 교체: `apps/web/src/components/ui/spinner.tsx`

**경계:**

- 입력: 작업 5의 `cn`과 기존 Base UI Button 조합.
- 출력: `@/shared/ui/*`의 `Button`, `buttonVariants`, `ButtonInteraction = 'press' | 'quiet'`, `LoadingButton`,
  `Spinner`. legacy path는 re-export로만 남긴다.
- 연기: 보호된 Server command contract가 생길 때까지 auth/session/permission/telemetry 조합을 만들지 않는다.

CSS token 파일이 유일한 runtime timing 권위다.

```css
:root {
  --motion-duration-press: 70ms;
  --motion-duration-state: 110ms;
  --motion-duration-enter: 150ms;
  --motion-duration-panel: 240ms;
  --motion-easing-standard: cubic-bezier(0.2, 0, 0.38, 0.9);
  --motion-easing-enter: cubic-bezier(0, 0, 0.38, 0.9);
  --motion-easing-exit: cubic-bezier(0.2, 0, 1, 0.9);
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --motion-duration-press: 0ms;
    --motion-duration-state: 0ms;
    --motion-duration-enter: 0ms;
    --motion-duration-panel: 0ms;
  }
}
```

public control type은 시각 표현에만 관여하며 resource neutral을 유지한다.

```ts
export type ButtonInteraction = 'press' | 'quiet';

export type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    interaction?: ButtonInteraction;
  };

export interface LoadingButtonProps extends Omit<ButtonProps, 'className'> {
  loading?: boolean;
  loadingLabel?: string;
  className?: string;
}
```

- [ ] **단계 1: RED component·architecture 테스트를 작성한다**

  기본 Button이 press interaction을 사용하고 link와 명시적 quiet interaction은 transform하지 않으며,
  `aria-haspopup` anchor가 움직이지 않고 focus style이 transition property 목록에 들어가지 않음을 한국어
  테스트로 증명한다. reduced motion은 transform을 제거하고 주입된 `onClick`은 계속 실행돼야 한다.
  LoadingButton은 label 공간, `aria-busy`, `focusableWhenDisabled`에 의한 focus를 보존하며 한국어 loading label을
  알리고 중복 click을 막아야 한다. 신규 `transition-all`, 화면 local `active:scale-*`/`active:translate-*`, raw
  duration literal과 shared control의 auth/session/telemetry import를 거부하는 architecture fixture를 추가한다.

```tsx
test('기본 버튼은 공통 press 피드백을 사용하고 클릭 행동을 주입받는다', async () => {
  const calls: string[] = [];
  const screen = render(<Button onClick={() => calls.push('실행')}>저장</Button>);
  const button = screen.getByRole('button', { name: '저장' });

  expect(button.getAttribute('data-interaction')).toBe('press');
  await userEvent.click(button);
  expect(calls).toEqual(['실행']);
});

test('처리 중 버튼은 크기와 focus를 보존하며 상태를 알린다', () => {
  const screen = render(<LoadingButton loading loadingLabel='후보 저장 중'>후보 저장</LoadingButton>);
  const button = screen.getByRole('button', { name: '후보 저장' });

  expect(button.getAttribute('aria-busy')).toBe('true');
  expect(screen.getByRole('status').textContent).toBe('후보 저장 중');
  expect(button.textContent).toContain('후보 저장');
});
```

- [ ] **단계 2: 집중 RED 테스트를 실행한다**

```text
pnpm --dir apps/web exec bun test src/shared/ui/button.test.tsx src/shared/ui/loading-button.test.tsx
node --test tools/architecture/check-web-boundaries.test.mjs
```

예상 결과: shared control/token과 신규 architecture rule이 아직 없으므로 새 case는 의도한 missing symbol 또는
허용된 위반 때문에 실패한다.

- [ ] **단계 3: token과 control을 최소 구현한다**

  `globals.css`에서 `tokens/motion.css`를 import한다. `transition-all`을 명시적인 color/background/border/
  opacity/transform property로 교체한다. link button은 `interaction='quiet'`, 기본값은 `press`로 해석하고 popup
  anchor는 움직이지 않게 한다. active 진입은 70ms, release/state change는 110ms를 사용하며 focus ring은 즉시
  표시한다. LoadingButton은 opacity로 숨긴 label을 layout에 남긴 채 Spinner를 overlay하고 loading 동안 Base UI
  `focusableWhenDisabled`를 설정한다. 세 legacy 구현은 두 번째 구현을 두지 말고 re-export로 교체한다.

- [ ] **단계 4: 사용하지 않는 Motion을 제거하고 theme transition을 제한한다**

  Web manifest에서 `motion`을 제거하고 pnpm으로 lockfile만 재생성한다. 기존 400ms root theme reveal을
  `var(--motion-duration-panel)`로 바꾸고 reduced motion에서는 완전히 끈다. 모든 theme color를 포괄하는 global
  transition을 추가하지 않는다.

```text
pnpm --filter @eatbid/web remove motion
```

- [ ] **단계 5: GREEN 검증을 실행한다**

```text
pnpm --dir apps/web exec bun test src/shared/ui/button.test.tsx src/shared/ui/loading-button.test.tsx
node --test tools/architecture/check-web-boundaries.test.mjs
node tools/architecture/check-web-boundaries.mjs
pnpm --dir apps/web exec oxlint src/shared/ui --deny-warnings
pnpm --filter @eatbid/web typecheck
git diff --check
```

예상 결과: 모든 집중 테스트가 통과하고 `motion`은 manifest/lock entry에서 사라지며 호환 path가 compile된다.

- [ ] **단계 6: 커밋한다**

```text
git add apps/web/src/styles apps/web/src/shared/ui apps/web/src/components/ui/button.tsx apps/web/src/components/ui/loading-button.tsx apps/web/src/components/ui/spinner.tsx apps/web/package.json pnpm-lock.yaml tools/architecture/check-web-boundaries.mjs tools/architecture/check-web-boundaries.test.mjs
git commit -m "feat(web): 공통 모션과 버튼 피드백 규약을 세운다"
```

## 작업 7: skeleton 소유권과 async boundary gate를 확립한다

**대상 파일:**

- 생성: `apps/web/src/shared/ui/skeleton.tsx`
- 생성: `apps/web/src/shared/ui/skeleton.test.tsx`
- 수정: `tools/architecture/check-web-boundaries.mjs`
- 수정: `tools/architecture/check-web-boundaries.test.mjs`
- 호환 re-export로 교체: `apps/web/src/components/ui/skeleton.tsx`

**경계:**

- 입력: 작업 6의 motion token.
- 출력: resource neutral `Skeleton` atom만 제공한다. `ScreenFrame`과 `ScreenSkeleton`은 route가 소유한다.
- 허용: 실제 client async panel이 import할 때만 `@suspensive/react` 3.21.3을 설치한다.
- 거부: `@suspensive/react-query`, 범용 `PageSkeleton`, 신규 `PageContainer isLoading`, `loading.tsx` 안의 직접
  Skeleton markup과 refetch/mutation 중 skeleton 교체.

```tsx
export function Skeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      aria-hidden='true'
      data-slot='skeleton'
      className={cn('animate-pulse rounded-md bg-muted motion-reduce:animate-none', className)}
      {...props}
    />
  );
}
```

- [ ] **단계 1: RED atom·boundary 테스트를 작성한다**

  `aria-hidden`, reduced motion과 class 주입을 한국어 테스트로 검증한다. `Skeleton`을 import하거나
  `animate-pulse`를 포함하거나 여러 fallback region을 만드는 `loading.tsx`는 실패하고 sibling `ScreenSkeleton`
  하나만 반환하는 `loading.tsx`는 통과함을 architecture fixture로 증명한다. 기존 `PageContainer isLoading`은
  정확한 삭제 전용 legacy fingerprint로만 고정한다.

- [ ] **단계 2: RED 테스트를 실행한다**

```text
pnpm --dir apps/web exec bun test src/shared/ui/skeleton.test.tsx
node --test tools/architecture/check-web-boundaries.test.mjs
```

예상 결과: shared Skeleton과 boundary rule이 아직 없으므로 실패한다.

- [ ] **단계 3: atom, 호환 export와 gate를 구현한다**

  Skeleton atom을 `shared/ui`로 옮기고 legacy re-export를 추가하며 광범위한 directory 예외 없이 기존
  AST/baseline checker를 확장한다. toolkit 표를 채우기 위해 Suspensive를 설치하지 않는다. exact
  `@suspensive/react@3.21.3` 설치는 client async panel을 처음 만드는 작업이 소유한다.

- [ ] **단계 4: GREEN 검증을 실행하고 커밋한다**

```text
pnpm --dir apps/web exec bun test src/shared/ui/skeleton.test.tsx
node --test tools/architecture/check-web-boundaries.test.mjs
node tools/architecture/check-web-boundaries.mjs
pnpm --dir apps/web exec oxlint src/shared/ui/skeleton.tsx --deny-warnings
pnpm --filter @eatbid/web typecheck
git diff --check
git add apps/web/src/shared/ui/skeleton.tsx apps/web/src/shared/ui/skeleton.test.tsx apps/web/src/components/ui/skeleton.tsx tools/architecture/check-web-boundaries.mjs tools/architecture/check-web-boundaries.test.mjs
git commit -m "feat(web): 화면별 로딩 경계의 기초를 세운다"
```

## 작업 8: 첫 canonical RSC walking skeleton을 구현한다

**대상 파일:**

- 생성: `apps/web/src/app/(workspace)/auctions/[auctionId]/_model/present-auction.ts`
- 생성: `apps/web/src/app/(workspace)/auctions/[auctionId]/_model/present-auction.test.ts`
- 생성: `apps/web/src/app/(workspace)/auctions/[auctionId]/_ui/auction-screen-frame.tsx`
- 생성: `apps/web/src/app/(workspace)/auctions/[auctionId]/_ui/auction-screen.tsx`
- 생성: `apps/web/src/app/(workspace)/auctions/[auctionId]/_ui/auction-screen.test.tsx`
- 생성: `apps/web/src/app/(workspace)/auctions/[auctionId]/_ui/auction-screen-skeleton.tsx`
- 생성: `apps/web/src/app/(workspace)/auctions/[auctionId]/_ui/auction-screen-skeleton.test.tsx`
- 생성: `apps/web/src/app/(workspace)/auctions/[auctionId]/page.tsx`
- 생성: `apps/web/src/app/(workspace)/auctions/[auctionId]/loading.tsx`
- 생성: `apps/web/src/app/(workspace)/auctions/[auctionId]/loading.test.tsx`
- 생성: `apps/web/src/app/(workspace)/auctions/[auctionId]/error.tsx`
- 생성: `apps/web/src/app/(workspace)/auctions/[auctionId]/not-found.tsx`
- 생성: `apps/web/src/app/(workspace)/auctions/[auctionId]/page.test.tsx`

**경계:**

- 입력: 작업 4의 `getAuctionFromServer`, 작업 7의 `Skeleton`, generated
  `PageProps<'/auctions/[auctionId]'>`.
- 출력: `presentAuction(response): AuctionPresentation`, `AuctionScreenFrame`, `AuctionScreen`,
  `AuctionScreenSkeleton`. 실제 화면과 fallback은 `AuctionScreenFrame`을 공유하고 `loading.tsx`는
  `<AuctionScreenSkeleton />`만 반환한다.

```tsx
export function AuctionScreenFrame({ header, summary, details }: AuctionScreenFrameProps) {
  return (
    <main className='grid min-w-0 gap-6' aria-labelledby='auction-title'>
      <header>{header}</header>
      <section>{summary}</section>
      <section>{details}</section>
    </main>
  );
}

export default function Loading() {
  return <AuctionScreenSkeleton />;
}
```

- [ ] 다음을 검증하는 RED model/render 테스트를 작성한다.
  - float 변환 없이 정확한 decimal money text와 currency를 표시한다.
  - nullable schedule value는 0이나 발명한 날짜가 아니라 `미확인`으로 render한다.
  - identity/revision/source/provenance를 각각 분리해 render한다.
  - 추천 사정률, 예측값, 후보 기본값이나 client-side domain calculation을 만들지 않는다.
  - 완전히 유효한 contract fixture가 안정된 server-rendered markup을 만든다.
  - 실제 screen과 skeleton 모두 `AuctionScreenFrame`을 사용하고 같은 section 수와 순서를 유지하며 두 번째
    page container를 만들지 않는다.
  - `loading.tsx`에는 Skeleton markup이 없고 `aria-busy`, 한국어 status text와 숨겨진 내부 skeleton 조각을 가진
    loading region 하나를 render한다.
  - async params를 await하고 invalid ID는 network I/O 전에 중단하며 resource not found error는 `notFound()`를 호출한다.
  - dependency/internal 500/503 error는 404로 표시하지 않고 route error boundary로 다시 throw한다.
- [ ] `presentAuction(response)`를 pure route local presentation model로 구현한다. 표시를 위한 format은 가능하지만
  provenance에 필요한 canonical raw value를 보존하고 API나 business authority가 되어서는 안 된다.
- [ ] 구체 screen과 skeleton보다 `AuctionScreenFrame`을 먼저 구현한다. 두 조합이 같은 header/summary/details
  slot을 공급해 visual geometry가 서로 무관한 두 page layout으로 갈라지지 않게 한다.
- [ ] 모든 fallback 조합은 `AuctionScreenSkeleton`에 두고 `loading.tsx`는 한 줄짜리 route adapter로 유지한다.
  이 Server/route boundary에는 Suspensive나 `Delay`를 쓰지 않는다.
- [ ] `page.tsx`는 generated `PageProps<'/auctions/[auctionId]'>`를 쓰는 async Server Component로 유지한다.
  params를 await하고 `@/api/auctions/server`만 호출하며 `AUCTION_NOT_FOUND`와 invalid ID는 `notFound()`로,
  dependency/internal 실패는 route error boundary로 다시 throw한다.
- [ ] `error.tsx`를 segment의 유일한 Client Component로 유지한다. retry/correlation-safe 문구를 제공하되 raw
  error body를 노출하지 않는다.
- [ ] 아직 이 route를 제품 navigation에 추가하지 않는다. navigation/information architecture는 사용자와 함께
  결정할 frontend 기획 사항이다.
- [ ] 실행한다.

```text
pnpm --dir apps/web exec bun test 'src/app/(workspace)/auctions/[auctionId]' src/api/auctions src/shared/ui/skeleton.test.tsx
node tools/architecture/check-web-boundaries.mjs
pnpm --dir apps/web exec oxlint 'src/app/(workspace)/auctions' --deny-warnings
pnpm --filter @eatbid/web typecheck
pnpm --filter @eatbid/web build
```

- [ ] 커밋한다.

```text
feat(web): 계약 기반 공고 화면 골격을 연결한다
```

## 작업 9: legacy migration 완료를 과장하지 않고 browser 증거를 추가한다

**대상 파일:**

- 검증된 사실이 바뀐 경우에만 수정: `docs/architecture/frontend-application-foundation.md`
- 검증된 사실이 바뀐 경우에만 수정: `apps/web/AGENTS.md`
- 생성: `apps/web/playwright.config.ts`
- 생성: `apps/web/e2e/support/auction-contract-fixture-server.ts`
- 생성: `apps/web/e2e/frontend-foundation.spec.ts`
- 수정: `apps/web/package.json`
- 수정: `pnpm-lock.yaml`
- 생성: `apps/server/tools/find-verification-auction.ts`
- 생성: `apps/server/tools/find-verification-auction.test.ts`

**경계:**

- 입력: canonical auction operation/response schema, 작업 8의 route, 작업 6~7의 motion/skeleton control.
- 출력: `pnpm --filter @eatbid/web test:e2e:foundation`의 결정적 Chromium 증거와 별도의 real dev 수동 검증
  보고서. 자동 fixture는 검토된 public operation만 구현하고 응답을 contract schema로 parse하며 제품 code에서는
  절대 import하지 않는다.

```ts
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://127.0.0.1:3001', trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'bun e2e/support/auction-contract-fixture-server.ts',
      port: 4410,
      reuseExistingServer: false,
    },
    {
      command: 'pnpm dev -- --port 3001',
      port: 3001,
      env: { ...process.env, API_URL: 'http://127.0.0.1:4410' },
      reuseExistingServer: false,
    },
  ],
});
```

- [ ] **단계 1: browser test runner를 설치하고 고정한다**

```text
pnpm --filter @eatbid/web add -D @playwright/test@1.62.1 --save-exact
pnpm --dir apps/web exec playwright install chromium
```

- [ ] **단계 2: contract-bound fixture server와 RED browser 테스트를 작성한다**

  operation에서 파생한 auction path를 `127.0.0.1:4410`에서 제공한다. route loading boundary를 관찰할 수 있도록
  성공 응답을 350ms 지연한다. contract test와 같은 strict response를 전송 전 parse해 반환한다.

```ts
const response = auctionV1ResponseSchema.parse({
  identity: {
    auctionId: '9007199254740993',
    revisionId: '9007199254740995',
    externalBidId: 'opaque',
    displayBidNumber: null,
    title: '급식 식재료',
    status: 'OPEN',
  },
  schedule: { announcedAt: '2026-08-30T00:00:00Z', deadlineAt: null, openedAt: null },
  pricing: { baseAmount: { amount: '1234567890.50', currency: 'KRW' }, plannedAmount: null },
  provenance: {
    sourceSystem: 'eat',
    observationId: '9007199254740997',
    normalizedRecordId: '9007199254740999',
    contentSha256: 'a'.repeat(64),
  },
});
```

  streamed `ScreenSkeleton` 뒤 실제 heading 표시, 정확한 money render, invalid/missing ID not found, 503 route error,
  navigation 뒤 shell/theme control 보존과 reduced motion에서 skeleton animation 억제를 한국어 Playwright 테스트로
  검증한다. 임의 sleep을 assert하지 말고 role과 contract-visible text를 기다린다.

```ts
test('공고 화면은 셸을 유지하고 화면 전용 skeleton 뒤 계약 응답을 표시한다', async ({ page }) => {
  await page.goto('/auctions/9007199254740993', { waitUntil: 'commit' });
  await expect(page.getByRole('status', { name: '공고 정보를 불러오는 중' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '급식 식재료' })).toBeVisible();
  await expect(page.getByText('1,234,567,890.50 KRW')).toBeVisible();
});
```

- [ ] **단계 3: 자동 browser 증거를 실행한다**

```text
pnpm --filter @eatbid/web test:e2e:foundation
```

예상 결과: 기존 dev server나 database 없이 모든 Chromium case가 통과한다. 실패 시 trace는 남기되 screenshot,
trace와 report는 ignored build artifact로 유지한다.

- [ ] 저장소 gate와 집중 gate를 실행한다.

```text
node tools/architecture/check-stack-docs.mjs
node tools/architecture/check-web-runtime.mjs
node tools/architecture/check-web-boundaries.mjs
node --test tools/architecture/check-stack-docs.test.mjs tools/architecture/check-web-runtime.test.mjs tools/architecture/check-web-boundaries.test.mjs
pnpm architecture:check
pnpm quality:check
pnpm --filter @eatbid/web test
pnpm --filter @eatbid/web test:e2e:foundation
pnpm --filter @eatbid/web typecheck
pnpm --dir apps/web exec oxlint src/api src/capabilities src/shell src/shared --deny-warnings
pnpm --filter @eatbid/web build
git diff --check
```

- [ ] dev data를 조회하기 전에 verification helper 집중 테스트와 Server tools architecture check를 실행한다.

```text
bun test apps/server/tools/find-verification-auction.test.ts
pnpm --filter @eatbid/server architecture:check
```

- [ ] 전체 Server e2e suite(procurement, operational HTTP, disposable database integration)를 실행하고 full Server
  evidence로 정확히 보고한다.

```text
pnpm --filter @eatbid/server test:e2e
```

- [ ] Server의 기존 `postgres` dependency를 쓰고 Infisical로 주입된 `DATABASE_URL`을 요구하며 최신 canonical
  auction/revision ID 하나를 선택해 decimal ID만 출력하는 read-only verification helper를 작성한다. dev database가
  비었으면 명확히 실패해야 한다. row 선택은 한국어 test name으로 unit test하고 seed, mutate, connection detail 출력은
  절대 하지 않는다.
- [ ] `infisical run --project-config-dir=<repo-root> --env=dev --path=/runtime/server --secret-overriding=false -- bun apps/server/tools/find-verification-auction.ts`로 실제 dev ID를 찾는다. test 전용 disposable ID
  `9007199254740993`가 dev에 있다고 가정하지 않는다.
- [ ] 같은 dev secret scope로 local Web은 3001, canonical Server는 4400 port에서 시작한다.
  `/auctions/<resolved-id>`를 열고 hard refresh, light/dark와 palette theme 변경, Button press feedback을 실행하며
  browser/server console의 hydration 또는 contract error를 확인한다.
- [ ] invalid ID와 missing ID도 확인해 not found/error 동작을 검증한다. product mock store로 대체하지 않는다.
  격리된 contract fixture는 자동 browser suite에만 허용하며 수동 검증은 canonical Server와 실제 dev data를 쓴다.
- [ ] 전체 legacy lint failure는 green target directory lint와 분리해 보고한다. 보고서를 green으로 만들 목적으로
  legacy baseline을 수정하지 않는다.
- [ ] `/dashboard/market`와 예전 bid-number/composite-school route는 명시적인 legacy로 남아 있으며 migrated로
  부르지 않음을 확인한다.
- [ ] 증거에 기반한 문서 변경만 커밋한다.

```text
test(web): 브라우저 기반 프론트 기반 증거를 고정한다
```
