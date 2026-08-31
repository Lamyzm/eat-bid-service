---
status: accepted
date: 2026-08-31
linear_issue: EAT-9
canonical_for: frontend-modular-architecture-design
---

# eatbid 프론트엔드 모듈 아키텍처 설계

## 1. 목적

`apps/web`을 화면 파일과 직접 `fetch`의 집합이 아니라, 입찰 탐색에서 공고 검토와 분석으로 이어지는
하나의 Next.js 모듈러 애플리케이션으로 다시 세운다. 이 단계의 산출물은 제품 화면 재기획이 아니라
앞으로의 화면이 같은 계약, 같은 상태 소유권, 같은 의존 방향을 따르게 만드는 기반이다.

완료 후에도 Web은 하나의 deployable이다. 폴더 경계는 마이크로프론트엔드나 별도 런타임을 만들기 위한
것이 아니라 변경 이유와 소유자를 드러내기 위한 컴파일·리뷰 경계다.

## 2. 현재 관측

- `src/app`, `components`, `hooks`, `lib`, `types`에 업무 로직과 화면, 네트워크가 수평으로 흩어져 있다.
- Web은 `/api/open`, `/api/market`, `/api/schools`, `/api/rounds` 같은 폐기 예정 endpoint를 직접 호출한다.
- `packages/contracts`를 import하지 않고 `res.json() as T`, 수동 interface와 `any`로 응답을 신뢰한다.
- TanStack Query는 provider만 있고 제품 query option이나 hydration 경로는 없다.
- TanStack Form은 context만 있고 실제 제품 form은 없다. 문서는 제거된 template 예시를 설명한다.
- 분석 보드 1,017줄, 오늘 화면 656줄, 공고 상세 437줄처럼 view, 계산, network, persistence가 한 파일에
  결합돼 있다.
- 기존 `[bidNo]`, `{시군구}|{학교명}` route identity와 localStorage mark는 canonical bigint ID와
  `Workspace × SupplierParty × AuctionAttempt` grain을 표현하지 못한다.
- 현재 새 Server의 실행 가능한 공개 제품 계약은 `GET /api/v1/auctions/{auctionId}` 하나다. 시장 목록,
  분석 근거, work item과 후보값 command 계약은 아직 없다.
- 기존 전체 typecheck/lint는 이미 실패한다. 이 변경은 실패를 숨기지 않고 legacy baseline으로 동결해
  새 코드가 부채를 늘리지 못하게 한다.

## 3. 목표와 비목표

### 목표

1. route graph, app shell, 사용자 capability, resource별 API와 범용 shared code의 소유권을 나눈다.
2. 공용 Zod 계약을 실제 network fetch boundary에서 runtime parse한다.
3. 같은 endpoint를 여러 화면이 써도 capability끼리 역참조하지 않는 resource API와 Query Options를 둔다.
4. RSC, TanStack Query, URL, form, local UI state의 역할을 질문별로 고정한다.
5. import graph, 깊은 참조, 300줄 검토와 unchecked JSON을 기계적으로 막는다.
6. 현재 디자인 토큰과 shadcn/Base UI 자산을 보존하면서 행동·인증·로깅은 capability에서 합성한다.

### 비목표

- 없는 시장·분석·work-item Server 계약을 Web에서 추측해 만들지 않는다.
- Next Route Handler를 업무 BFF나 두 번째 진실 원천으로 만들지 않는다.
- 기존 이름 기반 좌표 상수를 canonical 위치 정보로 승격하지 않는다.
- 추천 투찰가, 자동 후보값 적용, 실제 NeaT 제출을 구현하지 않는다.
- 모든 legacy 화면을 폴더 이동만으로 한 번에 target-compliant라고 부르지 않는다.
- 마이크로프론트엔드, 별도 디자인 시스템 package, 전역 event bus를 도입하지 않는다.

## 4. 구조

```text
apps/web/src/
├─ app/                       # Next route graph와 route lifecycle만
│  └─ (workspace)/
│     ├─ market/page.tsx
│     ├─ auctions/[auctionId]/
│     │  ├─ _model/
│     │  ├─ _ui/
│     │  └─ page.tsx
│     └─ work-items/[workItemId]/analysis/page.tsx
├─ shell/                     # provider, navigation, chrome
│  ├─ providers/
│  ├─ navigation/
│  └─ ui/
├─ capabilities/              # 사용자가 수행하는 흐름
│  ├─ analyze-auction/
│  ├─ record-candidate/
│  └─ submit-bid/
├─ api/                       # Nest public API의 resource별 server-state 경계
│  ├─ _transport/             # status/problem/parse와 browser·server ingress
│  ├─ auctions/
│  │  ├─ get-auction.ts
│  │  ├─ queries.ts
│  │  ├─ index.ts             # client-safe public entry
│  │  └─ server.ts            # server-only public entry
│  ├─ analyses/
│  ├─ work-items/
│  └─ suppliers/
├─ routing/                   # 반복 동적 Next 화면 URL builder; API endpoint 아님
│  ├─ auctions.ts
│  └─ work-items.ts
└─ shared/                    # 범용 config, lib, UI primitive
   ├─ config/
   ├─ lib/
   └─ ui/
```

`api`는 Nest public API의 server-state client이지 업무 권위가 아니다. 업무 불변식과 계산 권위는 계속
`packages/domain`, Nest application과 versioned mart에 있다. `packages/domain`과 혼동되는 frontend
`domains` layer는 만들지 않는다. 한 route에만 필요한 presentation model과 UI는 해당 segment의
`_model`/`_ui`가 소유한다. 독립된 사용자 intent와 여러 resource orchestration을 가진 흐름만 capability로
승격하고, 여러 소비자에 정말 공통인 resource selector만 해당 `api/<resource>`에 승격한다.

### 4.1 의존 방향

```mermaid
flowchart TD
    app[app\nroute composition] --> shell[shell\nproviders + chrome]
    app --> local[route-private\n_model + _ui + _lib]
    app --> capabilities[capabilities\nreusable user intents + orchestration]
    app --> api[api\nresource requests + Query Options]
    app --> routing[routing\ntyped screen path builders]
    local --> api
    local --> shared
    local --> routing
    shell --> routing
    capabilities --> routing
    shell --> shared[shared\ngeneric platform + UI]
    capabilities --> api
    capabilities --> shared
    api --> transport[api/_transport]
    api --> contracts[packages/contracts]
    routing --> contracts
    api --> shared
    transport --> contracts
```

| 소유자 | 허용하는 내부 import | 금지 |
|---|---|---|
| `app` | `shell`, capability public entry, API resource public/server entry, 같은 route의 `_model`/`_ui`/`_lib` | API deep import, 업무 권위 계산 |
| `shell` | `shared`와 app이 주입한 serializable shell model | capability/API 소유, 제품 query |
| `capabilities/<x>` | `api/*` public entry, `shared` | 다른 capability 내부, `app`, `shell` |
| `api/<resource>` | `_transport`, `shared`, `@eatbid/contracts`, Query option API | 다른 resource 내부, `app`, `shell`, capability |
| `api/_transport` | 외부 HTTP 도구와 공통 Problem Details 계약 | 제품 endpoint, UI, query key |
| `routing/<resource>` | Next `Route` type과 `@eatbid/contracts` identifier atom | API operation path, network, UI, server state |
| `shared` | 외부 라이브러리 | 상위 layer와 제품 endpoint 소유 |

표는 내부 project import를 제한한다. 각 layer는 자기 책임에 필요한 승인된 외부 toolkit을 직접 사용할 수
있지만 외부 package를 핑계로 내부 역방향 edge를 만들 수 없다.

cross-slice import는 resource `index.ts` 또는 명시적 `server.ts`만 통과한다. `index.ts`는 client-safe
공개 표면이며 `server.ts`를 재수출하지 않는다. 큰 barrel이 아니라 소비자가 필요한 작은 안정 표면으로
유지하고 같은 slice 내부는 실제 파일을 직접 import한다.

route는 metadata, RSC read/prefetch와 shell model 주입에 한해 API resource server entry를 직접 사용할 수
있다. 응답을 결합해 업무 판단을 하거나 화면 행동을 구현하면 capability로 옮긴다. shell은 session이나
workspace endpoint를 직접 읽지 않고 상위 layout이 검증해 전달한 serializable view만 렌더링한다.

### 4.2 route-local ownership

route에만 필요한 presentation, 조합과 interactive leaf는 해당 segment의 `_model`/`_ui`/`_lib`에 둔다.
두 route에서 쓰인다는 사실만으로 capability를 만들지 않는다. 독립된 사용자 intent, command/permission/
feedback lifecycle 또는 여러 resource orchestration을 가지면 capability로 승격하고, resource-neutral
utility는 `shared`, server-state selector는 `api/<resource>`로 옮긴다. 상위 layout으로 옮기는 기준도
“여러 곳에서 쓴다”가 아니라 shell이 소유해야 할 lifecycle인가다.

Parallel Route `@slot`은 독립 panel이 한 URL에서 동시에 보이고 각 panel이 별도 loading/error/URL
lifecycle을 가질 때만 쓴다. 코드 분류를 위해 slot을 만들지 않으며 모든 slot에는 `default.tsx`를 둔다.

## 5. 데이터와 계약

### 5.1 Web consumer adapter 배치

operation method/path와 request/response schema의 권위는 `packages/contracts`, endpoint 구현 권위는
Nest module에 있다. Web은 package root가 아니라 browser-safe resource subpath만 import한다. 같은 canonical
auction endpoint를 여러 capability가 호출할 수 있으므로 Web의
`api/auctions`는 다음 consumer adapter를 한 번만 배치·소유한다.

- `auctionV1Operations.find`가 단일 semantic path에서 파생한 browser path builder
- `auctionIdPathSchema`의 route/argument 검증
- `auctionV1ResponseSchema`의 runtime parse
- browser same-origin과 RSC internal origin이 같은 parser를 쓰는 `getAuction`
- `auctionQueries.detail(auctionId)` Query Options와 canonical query key

command adapter와 `mutationOptions()`도 해당 resource API가 소유한다. form draft, 권한 확인, 사용자
피드백과 여러 resource를 묶는 action orchestration은 capability가 소유한다. capability A의 query를
capability B가 import하지 않고 API resource끼리도 직접 import하지 않는다.

operation descriptor는 method, version, path segment/parameter, path/query/body schema, status별 response와
Problem Details, implementation owner와 `operationId`를 함께 소유한다. 하나의 framework-neutral path
definition에서 Nest adapter path/version, OpenAPI template와 encoded Web request path를 파생한다. frontend 전용 `ENDPOINTS` object와
`apps/server`/`apps/web`의 `/api/v1/...` literal은 만들지 않는다.

현재 CommonJS root barrel과 ignored build output은 client 계약 경계로 간주하지 않는다. client-safe ESM
subpath, server/generator export와 clean-checkout dev/typecheck/build lane을 먼저 만들고 client graph에
ingestion registry, Node generator나 `@eatbid/domain` runtime이 섞이지 않는지 검사한다.

### 5.2 transport

`api/_transport`만 raw `fetch`와 `Response` body decode를 수행하며 HTTP status, RFC 9457 Problem Details,
JSON decode, `AbortSignal` 전달을 담당한다. endpoint path나 product DTO를 알지 못한다. resource는 raw
network API를 우회하지 않고 승인된 request adapter에 operation descriptor의 Zod schema를 주입해
`unknown` response를 parse한다. malformed 2xx는 empty state가 아니라 계약 오류다.

브라우저는 same-origin `/api/v1` ingress를 사용한다. RSC는 Git의 환경별 runtime topology가 주입하고 Zod가
검증한 non-secret `API_URL`의 내부 Server origin을 사용한다. Infisical은 여기에 필요한 인증 secret만 소유한다.
두 경로 모두 같은 operation descriptor와 response schema를 사용한다. client-safe `index.ts`와
`server-only`인 `server.ts`를 분리하고 server origin, cookie 전달과 Next cache option을 client graph에
재수출하지 않는다.

### 5.3 Next 화면 route

Next 화면 URL의 권위는 `app/` file-system route다. `typedRoutes: true`와 clean checkout의
`next typegen && tsc --noEmit`으로 생성한 `Route`, `PageProps`, `LayoutProps`, `RouteContext`를 사용한다.
정적 one-off path는 typed literal을 직접 사용하고 반복되는 동적 path만 `src/routing/<resource>.ts`의 작은
builder로 추출한다. exhaustive `ROUTES` mirror, route group/slot 이름의 URL 노출, 존재하지 않는 placeholder,
`as Route` cast를 금지한다.

`/api/**` ingress는 Nest 전용이므로 신규 Next `route.ts`는 기본 금지한다. Web-owned public handler가 실제로
필요하면 별도 ADR, `implementationOwner: 'web'`, `/api`와 겹치지 않는 prefix와 ingress rule을 같은 변경에서
둔다. Server Action의 opaque POST transport는 URL 상수로 취급하지 않는다.

### 5.4 Query Options와 mutation transport

별도 Query Key Factory package는 추가하지 않는다. TanStack Query의 `queryOptions()`로 key와 fetcher를
같이 정의한다.

```ts
export const auctionQueries = {
  all: () => ['auction'] as const,
  detail: (auctionId: string) => queryOptions({
    queryKey: [...auctionQueries.all(), 'detail', { auctionId }] as const,
    queryFn: ({ signal }) => getAuction({ auctionId, signal })
  })
};
```

invalid response는 cache에 들어가지 않는다. mutation은 해당 resource key를 invalidate/update하며 화면
문자열 key를 직접 만들지 않는다.

interactive client cache, optimistic update나 취소가 중심인 command는 resource `mutationOptions()`로
browser→Nest를 사용한다. progressive enhancement, RSC cache invalidation 또는 server-only cookie 조합이
필요할 때만 Server Action이 같은 resource `server.ts`를 호출한다. Action은 Zod input/output, serializable
result와 성공 뒤 invalidation만 소유하며 DB/domain/business logic이나 별도 command DTO를 두지 않는다.

## 6. 렌더링과 상태 소유권

| 질문 | 소유자 |
|---|---|
| route, metadata, loading/error/not-found, RSC composition | Next `app` |
| 최초 read와 정적/서버 중심 화면 | RSC + API resource server entry |
| 상호작용 중 refetch/cache/hydration | TanStack Query |
| 공유 가능한 filter/sort/pagination/tab | `nuqs` URL state |
| command draft와 validation | TanStack Form + Zod command contract |
| 잠깐 열린 popover/hover/선택 | local React state |
| theme, query client, toaster, navigation chrome | shell |
| 인증된 사용자·workspace 권위 | Nest API; shell은 검증된 session view만 제공 |
| 깊은 client-owned 편집 state | 실제 필요가 입증된 capability-local Zustand |

Server Component를 기본으로 하고 browser API, event handler, form 또는 Query subscription이 필요한
leaf만 Client Component로 만든다. Server→Client props는 public wire 또는 작은 serializable
presentation model만 허용한다. Date, bigint, class instance를 넘기지 않는다.

`useEffect`는 외부 시스템 동기화에만 쓴다. interaction은 event handler, derived state는 render에서
계산한다. React `useEffectEvent`는 effect 안의 최신 비반응 로직에만 쓰며 dependency를 숨기는 도구로
사용하지 않는다.

## 7. UI, theme, 인증과 로깅

- 기존 Tailwind CSS semantic token, theme CSS와 shadcn/Base UI primitive를 보존한다.
- token 값의 runtime 권위는 CSS custom property다. JSON과 CSS를 사람이 이중 관리하지 않는다.
  외부 디자인 도구용 JSON이 실제 필요해지면 JSON→CSS 단방향 생성과 drift gate를 먼저 만든다.
- `shared/ui/Button`은 시각, 접근성, disabled/focus와 공통 press motion만 소유한다.
- 인증, 권한 확인, analytics/logging은 base Button에 넣지 않는다. capability의 `AuthorizedAction` 또는
  명시적 command component가 policy와 typed action descriptor를 합성한다.
- Query/Mutation 전역 오류는 QueryClient cache callback과 `meta` 정책으로 toaster/Sentry에 연결한다.
  사용자에게 보여야 하는 실패를 무조건 전역 toast로 바꾸지 않는다.
- telemetry에는 사업자등록번호, 투찰 후보값, query string과 원본 payload를 기본 수집하지 않는다.
  Sentry `sendDefaultPii`와 sampling은 운영·개인정보 결정 전까지 보수적으로 설정한다.

## 8. 도구 선택

| 항목 | 결정 |
|---|---|
| Next.js | `16.3.3` exact로 올리고 `typedRoutes: true` 채택 |
| React | 호환 stable `19.2.8` exact |
| Tailwind | v5를 기다리지 않고 현재 stable v4 lane 유지; manifest를 resolved v4.3.3과 일치 |
| TanStack Query | `5.102.8`, resource API 소유 `queryOptions()`와 signal 전달 |
| TanStack Form | v2 `2.0.0-alpha.2`는 foundation 기본값으로 채택하지 않음; stable v1 `1.33.5` 유지 |
| React Compiler | `babel-plugin-react-compiler@1.0.0`, annotation mode와 opt-in 0개로 시작; 첫 후보부터 동작·비교 성능 gate |
| Component interaction tests | Testing Library + user-event + Happy DOM을 Web-local Bun preload로 고정; keyboard/focus를 실제 동작으로 검증 |
| Rust React Compiler | experimental이므로 보류 |
| Cache Components | route/Suspense/self-host cache audit 전 전역 활성화 보류 |
| Immer | 반복되는 깊은 client-owned 편집 state가 확인될 때만 capability-local 도입 |
| es-toolkit | 실제 반복 utility와 bundle 근거가 있을 때 좁게 도입; native/기존 helper 대체 자체가 목표가 아님 |

TanStack Form v2 alpha에는 persistence와 submit meta가 아직 없으므로, 사용자 후보값처럼 장기 draft와
여러 submit intent가 필요한 핵심 form의 기반으로 쓰지 않는다. 실험하려면 별도 issue에서 adapter 뒤에
exact pin하고 v1과의 rollback seam을 둔다.

## 9. 전환 순서

1. 새 import/size/unchecked-fetch gate와 현재 legacy baseline을 만든다.
2. `api/_transport`와 `api/auctions`에 canonical 단건 공고 fetch/query path를 만든다.
3. `/auctions/[auctionId]`의 얇은 RSC route와 route-local `_model`/`_ui` walking skeleton을 만든다.
4. provider, theme, toaster와 navigation chrome을 동작 보존 상태로 `shell`에 옮긴다.
5. market list 계약이 생기면 `browse-market`을 연결하고 link identity를 `auctionId`로 바꾼다.
6. versioned analysis evidence 계약 뒤 `analyze-auction`을 연결한다.
7. workspace/supplier/work-item/candidate command 계약 뒤 빈 후보값 form과 mutation을 연결한다.
8. slice가 대체될 때마다 retired fetch, composite route ID, local mark와 `@eatbid/shared` 소비를 삭제한다.

기존 화면을 새 폴더로 이동하는 것만으로 migration 완료라고 판정하지 않는다. 각 slice는 public contract,
runtime parse, identity, error/empty/stale UI, import gate와 검증 evidence를 함께 통과해야 한다.

## 10. 품질과 완료 조건

- 신규·변경 테스트명은 한국어다.
- 300줄 초과 source는 responsibility split 또는 이유·owner·다음 split trigger가 있는 waiver를 요구한다.
- 신규 `res.json() as T`, public 응답 수동 interface, `any`, client-side domain calculation authority를 거부한다.
- contract fixture, malformed 2xx, Problem Details, abort, bigint 최대값/overflow를 테스트한다.
- route hard navigation, loading/error/not-found와 hydration을 검증한다.
- 기존 전체 lint/typecheck 실패는 별도 debt ledger로 남기되 변경 파일과 새 architecture gate는 green이어야 한다.
- protected branch의 full typecheck/lint/build가 green이 되기 전 production-ready라고 주장하지 않는다.

## 11. 검토한 대안

### Full Feature-Sliced Design

layer 사고방식은 유용하지만 Next `app`과 FSD `pages`, `widgets`, `features`를 모두 도입하면 현재 규모에서
용어와 public barrel이 늘어난다. route graph는 Next에 두고 capability/resource API 경계만 채택한다.

### route/parallel slot이 곧 module

URL lifecycle과 코드 소유권이 결합돼 hard navigation, default slot, 재사용에서 문제가 생긴다. slot은
동시 panel UI가 실제로 필요한 마지막 routing primitive로만 쓴다.

### 전역 store와 Query로 모든 상태 통일

URL, server cache, form draft, hover state의 수명과 권위가 다르다. 하나로 합치면 invalidation과 persistence가
숨은 진실 원천이 되므로 상태 종류별 owner를 유지한다.

### 화면별 `api/types/service/queries`

같은 endpoint가 여러 화면에서 중복되거나 feature 간 역참조가 생긴다. canonical resource gateway는
top-level `api/<resource>`가 한 번 소유하고 capability는 조합만 한다.

### 별도 frontend `domains` layer

resource ownership 사고방식은 유효하지만 이미 `packages/domain`이 업무 불변식의 권위라 같은 이름이
두 번째 domain authority로 오해되기 쉽다. `api/<resource>`를 server-state 소비 경계로 명명하고 업무
권위는 만들지 않는다.
