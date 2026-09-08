# 로그인·내 사업자 기반 — 2026-09-09

Linear EAT-47. base `be1e52c`. writer는 worktree
`.worktrees/eat-47-account-foundation`의 단일 세션이다.

## 문제와 범위

지금 canonical Nest에는 Better Auth 인스턴스도, principal resolver도, session guard도, 내 사업자 저장도
없다. 있는 것은 `create-app.ts`의 파서 앞 raw transport slot과 전역 prefix 제외 규칙, 그리고 존재하지 않는
`/api/auth`를 향해 배선된 web 클라이언트뿐이다. `app.principal`·`identity_subject`·`workspace`·
`workspace_membership`은 DDL만 있고 읽고 쓰는 코드가 없다.

사용자가 승인한 결과 하나는 다음이다: **로그인한다 → 내 사업자번호를 넣는다 → 위치를 직접 적는다 →
기존 결정 화면 차트에서 실제 내 투찰을 본다.** 이 계획은 그 흐름 중 앞 세 단계를 만들고 마지막 단계는
계약 모양만 닫아 EAT-40에 넘긴다. 공고 상세는 지금처럼 route가 소유하고 오른쪽 slot은 배치만 맡는다.
로그인이 생겼다는 이유로 상태를 shell에 모으거나 화면을 새로 복제하지 않는다.

경계 결정의 권위는 [ADR 0032](../../adr/0032-authentication-and-authorization-boundary.md)다.
이 계획은 그 ADR을 실행 단계로 펼칠 뿐 새 경계를 만들지 않는다. ADR은 2026-09-09 개정으로 `Accepted`가
됐고 backend 1~4단계는 구현·검증이 끝났다. 계약의 최종 모양은 `packages/contracts`의 operation과 ADR
0032이며, 이 계획 본문과 어긋나는 곳이 있으면 그쪽이 옳다.

## 승인된 제품 동작

- 로그인은 기존 Better Auth와 Google 선택을 재사용한다. 새 인증 서비스도 별도 Next API도 만들지 않는다.
- 사업자번호 입력은 내 분석 기준 등록이지 법적 소유권 인증이 아니다. 먼저 넣은 타인이 실사용자의 등록을
  막지 못한다(ADR 0032 §7).
- 관측되지 않은 번호도 등록은 성공하고 “아직 관측되지 않음”으로 보존된다. 자료 없음을 미참여로 바꾸지
  않는다.
- 최초 개인 사용자는 조직 생성 화면을 거치지 않는다. 첫 저장이 개인 워크스페이스를 만든다(§8).
- 위치는 사용자가 적은 주소 문장 하나이고 미설정을 지원한다. 좌표·행정코드·GPS·자격 판정은 없다.
- “내 값”(사용자 입력)과 “실제 내 투찰”(원본 관측)은 끝까지 다른 이름의 다른 값이다.

## 확정된 설계 결정

### 1. auth 런타임과 principal 수명주기

- **버전**: lock의 `better-auth@1.7.2`를 그대로 쓴다. schema conformance CLI(`auth`)도 같은 exact
  version으로 `apps/server`에 devDependency로 넣는다(ADR 0018). web에는 client만 남긴다.
- **마운트 지점**: `createApp`의 `mountPreParserRawTransport`. Better Auth handler는 원문 body를 스스로
  읽으므로 `express.json()` 앞이어야 하고, 그 자리는 이미 helmet·CORS 뒤로 고정돼 있다. 이 slot은
  `main.ts`가 채우고 `createApp`은 계속 주입만 받는다. 그래야 e2e가 fake resolver를 넣을 수 있고
  production 코드에는 인증 우회 분기가 생기지 않는다.
- **DDL**: provider table(user·session·account·verification·rate limit)은 `packages/db`의 Drizzle schema에
  손으로 두고 pinned CLI의 offline 생성 결과와 table/column/index/relation 수준에서 대조한다. CLI가
  migration을 적용하는 경로(`better-auth migrate`)와 `db:push`는 어느 환경에서도 쓰지 않는다.
- **세션 저장**: DB 세션 하나만 쓴다. 별도 캐시나 secondary storage를 지금 붙이지 않는다. 요청당 조회
  2회(세션 1, identity_subject 1)는 현재 부하에서 감당 가능한 비용이다.
- **principal 생성은 로그인 경로 한 곳**, guard는 읽기 전용. 해소 실패는 `500`과 `principal_unresolved`
  로그다(ADR 0032 §2).
- **1단계에서 실제로 확인할 것**: pinned 1.7.2의 사용자 생성 hook이 adapter transaction 안에서 도는지.
  돈다면 principal 삽입을 그 hook에 둔다. 돌지 않으면 대안 B로 간다 — 로그인 콜백 직후 web이 부르는
  명시적 provision command 하나를 두고, 그 command만 쓰기 권한을 갖는다. 어느 쪽이든 guard는 읽기
  전용이며, 선택 근거를 이 문서에 한 문장으로 남긴다.
- **기존 provider 계정 보존**: 새 auth table은 지금 운영 DB에 없다. 이번 검증은 전부 일회용 로컬
  PostgreSQL에서 하고, 운영 전환은 migration Job으로 표를 만드는 별도 단계다. 운영 DB·DDL·권한·비밀을
  이 작업에서 바꾸지 않는다.

### 2. 계약: session·내 사업자·위치

> **2026-09-09 갱신.** 아래 표와 목록은 구현된 계약이다. 이 절의 초안이 적었던 operation 넷,
> `authenticated` boolean union, 세션 응답에 실리는 등록 사업자 요약, `link.kind`는 모두 폐기됐다.
> web writer는 초안 어휘가 아니라 이 절과 `packages/contracts`를 그대로 소비한다.

새 operation 여섯을 `packages/contracts`가 소유한다. method·path·`operationId`·상태별 schema는 여기서만
정의하고 Nest decorator와 web 요청 경로를 그로부터 파생한다(AGENTS 19).

| operationId | method·path | 입력 | 성공 | 실패 |
| --- | --- | --- | --- | --- |
| `getCurrentSession` | `GET /api/v1/session` | 없음 | 200 | 500·503 |
| `initializeCurrentAccount` | `POST /api/v1/me/initialization` | 없음 | 200 | 401·403·500·503 |
| `listMyBusinesses` | `GET /api/v1/me/businesses` | 없음 | 200 | 401·403·500·503 |
| `registerMyBusiness` | `POST /api/v1/me/businesses` | `{ businessNumber }` | 201 | 400·401·403·409·500·503 |
| `setMyBusinessLocation` | `PUT /api/v1/me/businesses/{businessId}/location` | `{ addressText }` | 200 | 400·401·403·404·500·503 |
| `clearMyBusinessLocation` | `DELETE /api/v1/me/businesses/{businessId}/location` | 없음 | 200 | 400·401·403·404·500·503 |

- `getCurrentSession` 응답은 `state`로 갈라지는 discriminated union이고 값은
  `unauthenticated`·`uninitialized`·`active` 셋이다. `authenticated: boolean` 하나로 줄이지 않는 이유는
  “로그인하지 않았다”와 “로그인했지만 app 계정 초기화가 아직 안 됐다”가 화면이 서로 다른 행동을 해야 하는
  서로 다른 사실이기 때문이다. `unauthenticated`는 그 값 하나뿐이고, `uninitialized`는 계정 라벨만,
  `active`는 라벨과 `principalId`·`workspace`를 담는다.
- **세션 응답에 등록 사업자를 싣지 않는다.** 목록은 `listMyBusinesses`가 소유한다. 두 곳이 같은 목록을
  실으면 등록 직후 두 응답이 서로 다른 값을 말한다.
- **초기화는 조회가 아니라 `initializeCurrentAccount` command다.** `uninitialized` 상태의 사용자는 이
  command를 부른 뒤에야 `active`가 된다. 그 전의 `me` 자원 요청은 401이 아니라 403이다.
- **계정 라벨에 원본 이메일을 싣지 않는다.** 계정 전환 확인에 필요한 최소값은 표시 이름과 마스킹된
  이메일이며 마스킹은 서버 presentation이 한다. 전체 주소를 응답에 실으면 화면 캡처·로그·오류 보고에
  그대로 따라다닌다.
- **표시 라벨의 길이·빈값 정책도 서버 presentation이 정한다.** provider가 소유한 이름에는 길이 제한이
  없으므로 계약 상한을 넘으면 잘라서 싣고, 공백뿐이거나 표시할 수 없는 값은 `null`이다. web은 라벨을
  다시 자르지 않고 `null`을 빈 문자열로 바꾸지 않는다.
- **사업자번호는 path·query에 넣지 않는다.** `businessId`는 `registered_business_id`의 decimal string이다.
  번호는 요청 body와 응답 본문에만 나타난다. 요청 경로는 접근 로그와 referrer에 남는다.
- **형식 검증은 `packages/domain`이 소유한다.** 하이픈·공백 제거 → 숫자 10자리 → 국세청 체크디짓.
  이 값은 오타 차단이며 실재·소유 증명이 아니다. 검증 fixture는 `core.code_value`의
  `eat:business-number` 실제 관측값에서 뽑아 우리 구현이 진짜 번호를 거부하지 않음을 증명한다.
- **대조는 정확 일치 하나다.** `eat:business-number` scheme의 code value를 찾고 그 party를 연결한다.
  연결은 저장된 FK가 아니라 조회가 파생하며, 실패하면 응답이 `supplier: { kind: "unobserved" }`로 말한다.
  사용자 입력으로 `core` 행을 만들지 않는다.
- **빈 설정과 미연결을 응답이 구분한다.** 등록 0건(`businesses: []`), 등록은 있으나 미연결
  (`supplier.kind = "unobserved"`), 등록되고 연결됨(`supplier.kind = "linked"`),
  위치 미설정(`location: null`)은 각각 다른 상태이며 화면이 다른 문장을 쓴다.
- 계약 조립은 atom → value → resource → versioned endpoint 순서를 지킨다. ingestion·command·public
  response·DB row family를 서로 `pick`하지 않는다. 이 API 계약은 portable registry에 들어가지 않는다.
  그 registry는 ingestion 교환 계약만 담는다.

### 3. 브라우저 경계

무엇이 무엇을 보장하는지 한 줄씩 못 박는다. 상세 근거는 ADR 0032 §6·§9다.

| 위험 | 보장하는 것 |
| --- | --- |
| CSRF | `SameSite=Lax` 쿠키 + 상태 변경 method에 대한 `Origin` 정확 일치 검사. 허용 목록은 기존 `CORS_ORIGINS` 하나를 재사용하고 `Origin` 없는 상태 변경은 거부 |
| 세션 탈취 | `HttpOnly`·`Secure` 쿠키, same-origin, JS가 토큰을 만지지 않음 |
| 열린 리디렉션 | `next`는 `/`로 시작하고 `//`·`/\`·scheme·authority·제어문자가 없는 값만. web과 auth 콜백이 같은 함수 하나를 쓴다 |
| 계정 탈취(이메일 재사용) | provider 자동 계정 연결 비활성. Google과 이메일은 다른 principal이며 로그인 화면이 그 사실을 문장으로 알린다 |
| 타 workspace ID 주입 | membership 조회 실패 시 `403`. 본문에 대상 존재 여부를 적지 않음 |
| 로그아웃·계정 전환 뒤 자료 혼선 | 세션 무효화 + TanStack Query 캐시 전체 비움. 사용자별 query key에 workspace·business ID 포함. legacy localStorage는 읽지도 쓰지도 않음 |
| 중복 저장 | `(workspace_id, business_number) where revoked_at is null` 부분 unique → `409` |
| 동시 첫 초기화 | `(principal_id) where role = 'owner'` 부분 unique. 진 쪽은 충돌을 잡아 이긴 워크스페이스를 다시 읽는다 |
| 테스트 auth bypass | fake principal resolver는 `createApp` 주입 인자로만 존재. 환경변수·헤더로 인증을 건너뛰는 분기를 production 코드에 만들지 않는다 |

로그에는 `principal_id`만 남긴다. 이메일·세션 토큰·쿠키·사업자등록번호는 남기지 않는다.

### 4. web 화면 경계

토스의 선언적 기준을 적용한다. 페이지는 사용자 intent의 조합이고, 컴포넌트는 “같은 이유로 바뀌는”
역할 하나를 갖는다. 숨은 부작용, 중복 state, 동작을 뒤집는 generic flag를 만들지 않는다.

- **capability 승격**: 로그인·첫 사업자 등록·위치 입력·계정 허브는 독립된 사용자 intent이고
  command/권한/피드백 lifecycle이 있으므로 `capabilities/account`로 올린다. 단순 조회 화면이라는 이유로
  capability를 만들지 않는다는 규칙의 반대쪽 조건을 실제로 만족한다.
- **shell은 그대로 둔다.** `ApplicationShell`은 이미 `sidebarFooter` slot을 갖고 있다. session을 읽는
  것은 `(workspace)/layout.tsx`의 Suspense 안 loader이고, shell은 받은 serializable view를 렌더링만 한다.
  layout 최상위에서 `cookies()`를 await하지 않는다(ADR 0028).
- **transport 재사용**: 기존 `request-contract.ts`에 operation을 주입하는 방식을 그대로 쓴다. 추가되는
  것은 세션 쿠키를 내부 origin 호출에 실어 보내는 authenticated server entry 하나뿐이며, 여기에
  `use cache`를 쓰지 않는다. 요청 헤더 전체를 relay하지 않고 auth가 소유한 쿠키 이름만 고른다.
- **form**: 등록·위치는 TanStack Form v1과 command Zod schema로 만든다. 입력 기본값은 비어 있다.
  추천값처럼 읽히는 기본값을 넣지 않는다.
- **UI**: 기존 shadcn primitive를 쓴다. Button은 시각·접근성만 갖고 인증 요구와 command는 capability의
  action component가 주입한다. 새 아이콘이 필요하면 `shared/ui`로 옮긴 뒤 쓴다.
- **선택된 사업자**는 URL 상태다. 중앙 current auction, 선택된 과거 회차와 서로 다른 상태이며 한
  store로 합치지 않는다. `listMyBusinesses` 결과에 없는 값이면 무시하고 기본값으로 돌아간다.
- **로그인 화면 하나, 설정 화면 하나만** 만든다. 랜딩·가격·`signup` 분리는 EAT-48이 소유한다. 기존
  legacy `/welcome`은 건드리지 않는다.

### 5. 실제 내 투찰과 EAT-40 연결

이번 phase에서 `flow-series.ts`에 계열을 추가하지 않는다. 사업자 등록만으로 차트에 선이 생기면 사용자는
그 선을 자기 제출로 믿고, 그 순간 등록은 소유권 증명이 된다. 대신 EAT-40이 만들 계약의 모양을 여기서
닫는다.

- 실제 내 투찰은 `core.bid_submission`의 관측이다. 등록된 사업자의 `supplier_party_id`가 있어야만
  조회할 수 있고, 미연결 등록에는 이 값이 없다.
- 흐름 차트와 같은 눈금에 올리려면 **같은 회차 revision, 같은 낙찰 방식 코호트, 같은 분모(예정가격 기준
  사정률)** 로 조회해야 한다. 그러므로 EAT-40의 응답은 기관 회차 이력과 같은 회차 키로 값을 돌려주는
  형태여야 하고, 회차 목록과 별도 요청으로 가져오되 같은 revision을 명시적으로 받는다.
- 화면 어휘는 “내 값”(사용자 입력)과 “실제 내 투찰”(관측)을 이름·범례·각주에서 끝까지 구분한다. 관측이
  없는 회차는 선을 끊고 “해당 회차에 내 제출 관측 없음”이라고 말한다. 0으로 잇지 않는다.
- 이 계약이 도착하기 전까지 결정 화면은 지금 동작 그대로다.

## 단계별 실행

각 단계는 그 자체로 커밋 가능하고, 앞 단계의 인수 조건을 통과한 뒤에만 다음으로 간다.

### 1단계 — auth 런타임과 principal 경계

새로 만드는 경로:

```text
packages/db/src/schema/app/auth.ts                       provider-owned table (CLI 대조 대상)
packages/db/src/schema/app/auth.test.ts
packages/db/drizzle/<ts>_auth_provider_tables/           생성 migration
apps/server/src/platform/auth/auth-instance.ts           betterAuth() 조립과 provider 설정
apps/server/src/platform/auth/auth-transport.ts          mountPreParserRawTransport에 넘길 함수
apps/server/src/platform/auth/principal-resolver.ts      port + typed 실패
apps/server/src/platform/auth/drizzle-principal-resolver.ts
apps/server/src/platform/auth/session.guard.ts
apps/server/src/platform/auth/principal.decorator.ts
apps/server/src/platform/auth/origin.guard.ts            상태 변경 method의 Origin 검사
apps/server/src/platform/auth/auth.module.ts
```

고치는 경로: `apps/server/src/platform/config/environment.ts`(auth secret·OAuth key 필수화),
`apps/server/src/main.ts`(mount 주입), `apps/server/src/app.module.ts`, `apps/server/package.json`,
`apps/web/package.json`(server로 이동), `packages/db/src/schema/app/index.ts`.

인수 조건:

- pinned CLI 생성 schema와 committed Drizzle schema가 table/column/index/relation에서 일치한다.
- 일회용 PostgreSQL에 커밋된 migration을 적용하고 배포되는 provisioning SQL을 실행한 뒤,
  `eatbid_api` 역할로 auth table을 읽고 쓸 수 있으며 schema 생성은 거부된다.
- 유효 세션 요청이 `principal_id`를 해소하고, 세션 없는 요청은 `401 UNAUTHENTICATED`,
  세션은 있으나 `identity_subject`가 없는 요청은 `500`과 `principal_unresolved` 로그로 끝난다.
- 같은 subject의 동시 첫 로그인 두 건이 principal을 하나만 만든다.
- `Origin`이 허용 목록과 다르거나 없는 상태 변경 요청이 `403`이다.
- 로그 한 줄에 이메일·토큰·쿠키가 없다.

### 2단계 — 세션 조회 계약

```text
packages/contracts/src/api/v1/session/session.resource.ts
packages/contracts/src/api/v1/session/get-current-session.response.ts
packages/contracts/src/api/v1/session/operations.ts
packages/contracts/src/api/v1/session/index.ts
apps/server/src/modules/account/account.module.ts
apps/server/src/modules/account/application/get-current-session.ts
apps/server/src/modules/account/application/session-reader.ts
apps/server/src/modules/account/infrastructure/drizzle/drizzle-session-reader.ts
apps/server/src/modules/account/presentation/http/session.controller.ts
```

고치는 경로: `packages/contracts/src/api/registry.ts`, `packages/contracts/src/index.ts`,
`apps/server/src/app.module.ts`.

인수 조건: 미로그인 200 + `state: "unauthenticated"`, 초기화 전 로그인 200 + `state: "uninitialized"`,
초기화 뒤 200 + `state: "active"`와 principal·workspace, 인증 의존성 미설정 배포는 200이 아니라 503,
OpenAPI에 `getCurrentSession`이 계약대로 나타난다.

### 3단계 — 내 사업자 등록·조회

```text
packages/domain/src/identity/business-number.ts          정규화 + 체크디짓 semantic value
packages/domain/src/identity/business-number.test.ts
packages/contracts/src/api/v1/me/business.resource.ts
packages/contracts/src/api/v1/me/register-my-business.command.ts
packages/contracts/src/api/v1/me/list-my-businesses.response.ts
packages/contracts/src/api/v1/me/operations.ts
packages/db/src/schema/app/workspace-suppliers.ts
packages/db/drizzle/<ts>_workspace_supplier/             + role check·owner 부분 unique
apps/server/src/modules/account/application/register-my-business.ts
apps/server/src/modules/account/application/list-my-businesses.ts
apps/server/src/modules/account/application/workspace-supplier-repository.ts
apps/server/src/modules/account/infrastructure/drizzle/drizzle-workspace-supplier-repository.ts
apps/server/src/modules/account/presentation/http/my-businesses.controller.ts
```

인수 조건:

- 관측된 번호는 조회가 party를 찾아 `supplier.kind = "linked"`와 `supplierPartyId`를 돌려준다.
  등록 행에는 그 파생 FK를 저장하지 않는다.
- 미관측 번호도 201이며 `supplier.kind = "unobserved"`다. `core` 행은 늘지
  않는다(등록 전후 `core.supplier_party`·`core.code_value` 카운트 동일).
- **다른 워크스페이스가 같은 번호를 등록해도 성공한다.** 이 검사가 철회된 전역 선점 규칙의 회귀 방지다.
- 같은 워크스페이스의 같은 번호 재등록은 `409 CONFLICT`.
- 형식 위반은 `400 VALIDATION_ERROR`이고 응답·로그에 입력 번호가 남지 않는다.
- 워크스페이스가 없는 principal의 첫 등록이 workspace 1 + `owner` membership 1을 만든다.
- 같은 principal의 동시 첫 등록 두 건이 워크스페이스를 하나만 만든다.
- `role`에 `owner|member` 외 문자열을 넣는 삽입이 DB에서 거부된다.

### 4단계 — 사업자별 위치

```text
packages/contracts/src/api/v1/me/set-my-business-location.command.ts
packages/db/src/schema/app/workspace-supplier-locations.ts
packages/db/drizzle/<ts>_workspace_supplier_location/
apps/server/src/modules/account/application/set-my-business-location.ts
```

인수 조건: 저장 전 조회는 `location: null`, 저장 후 사용자가 적은 문장이 그대로 돌아온다.
다른 워크스페이스의 `businessId`는 `403`, 없는 ID는 `404`. 좌표·행정코드 열이 schema에 없다는 것을
열 목록 검사가 확인한다. 사업자가 둘일 때 각 위치가 섞이지 않는다.

### 5단계 — web 로그인·설정 화면

```text
apps/web/src/api/_transport/authenticated-server-request.server.ts
apps/web/src/api/session/{index.ts,server.ts,get-current-session.ts,queries.ts}
apps/web/src/api/me-businesses/{index.ts,server.ts,list-my-businesses.ts,
                                register-my-business.ts,set-my-business-location.ts,queries.ts}
apps/web/src/capabilities/account/{auth-client.ts,login-panel.tsx,account-hub.tsx,
                                   business-setup-form.tsx,business-location-form.tsx,
                                   safe-next-path.ts,index.ts}
apps/web/src/app/(auth)/login/{page.tsx,loading.tsx}
apps/web/src/app/(auth)/setup/{page.tsx,loading.tsx,error.tsx}
```

고치는 경로: `apps/web/src/app/(workspace)/layout.tsx`(Suspense loader + `sidebarFooter` 주입).
`apps/web/src/lib/auth-client.ts`와 `apps/web/src/lib/session.ts`는 새 경로가 import하지 않으며 삭제 전용
ledger 항목으로 남는다.

인수 조건:

- 미로그인으로 `/setup`에 가면 `/login?next=/setup`으로 가고, 로그인 뒤 원래 화면으로 돌아온다.
- `next=https://…`, `next=//evil`, `next=/\evil`은 기본 경로로 대체된다.
- 등록 0건·미연결·연결됨·위치 미설정이 각각 다른 문장으로 보인다.
- 로그아웃 뒤 사용자별 캐시가 비고, 다른 계정으로 로그인해도 이전 계정의 값이 보이지 않는다.
- `(workspace)` shell이 static prerender를 유지하고 canonical route에 `export const instant = false`가
  늘지 않는다.
- 결정 화면의 오른쪽 상세와 차트 동작이 그대로다. 시안 대조 스크린샷을 배포 전에 확인한다.

## 검증 환경

- **새 기능 인수는 별도 로컬 PostgreSQL에서 한다.** 지금 dev(3002)와 server(4400)는 운영 PostgreSQL의
  `eatbid_api`로 붙고 그 역할은 `app` 쓰기가 가능하다. 새 migration·역할·권한을 그 DB에 대고 검증하면
  검증이 아니라 사고다. 운영 DB·DDL·권한·비밀은 이 작업에서 바꾸지 않는다.
- 재사용 대상은 `apps/server/fixtures/disposable-database.fixture.ts`다. 커밋된 migration과 배포되는
  `infra/product/db-provisioning.sql`을 그대로 실행하므로 권한 계약까지 같이 증명된다. 합성 roster
  fixture는 사업자번호 대조 검사의 관측 데이터로 쓴다.
- **정리 실패를 숨기지 않는다.** 그 fixture는 지금 `docker rm` 오류를 삼키고 본문이 성공한 경우에만
  정리를 확인한다(EAT-114). 이번 작업은 그 부채를 고치지 않지만 그것에 기대지도 않는다. 새 검사는
  본문 실패 여부와 무관하게 소유 container 정리를 확인하고, 실패하면 원래 오류와 정리 오류를 둘 다
  드러낸 뒤 실패로 끝낸다. 무관한 수정으로 EAT-114의 범위를 침범하지 않는다.
- 화면 인수는 dev 브라우저 확인과 `test:e2e:foundation` fixture 검증을 별개로 보고한다. 같은 viewport의
  캡처 두 장은 fixture 비교를 대신하지 않는다.

## gate 영향

- `pnpm lint:endpoints`: 새 operation은 registry 등록만으로 통과한다. Server/Web source에 canonical
  `/api/v1/...` literal이나 frontend `ENDPOINTS` mirror를 만들지 않는다. `/api/auth`는 canonical `/api/vN`
  패턴이 아니라 이 검사 대상이 아니며 Nest 전역 prefix 제외로만 존재한다. baseline 예외를 넓히지 않는다.
- `check-web-boundaries`: 새 `capabilities/account`는 이미 canonical layer다. **다만
  `CANONICAL_LAYER_PATH`가 `app/(workspace)`만 포함하고 `app/(auth)`를 포함하지 않는다.** 새 route group을
  만드는 같은 변경에서 이 정규식에 `app/\(auth\)`를 더한다. 이것은 검사 범위를 넓히는 방향이며 예외
  확대가 아니다. `use cache`는 새 session 경로에 쓰지 않으므로 `use-cache-user-data`는 그대로 통과한다.
- `pnpm quality:check`: 새 production 모듈에 `@module 책임:` 한국어 한 문장, 테스트 제목에 한글.
  ledger는 삭제 방향으로만 바꾼다.
- `pnpm architecture:check`, `pnpm contracts:check`, `pnpm contracts:python:check`: 계약을 바꾼 단계마다
  check mode로 실행한다. 새 API 계약은 portable registry에 들어가지 않으므로 Python 생성물은 바뀌지
  않아야 한다. 바뀌면 계약을 잘못 놓은 것이다.
- `packages/db` migration은 `db:generate`로 만들고 커밋한다. `db:push`와 수기 SQL은 쓰지 않는다.
- 단계별 좁은 검사를 먼저 돌리고, 출력 축약 pipe의 성공을 원래 검사의 exit code로 쓰지 않는다.

## 하지 않는 것

성적표·회차별 결과·`BidWorkItem`·지도·결제·운영자 UI·구독 분기·`operator_grant` 테이블·
`SubscriptionPolicy` port는 이번 작업에서 만들지 않는다. 기존 공개 read의 요구 수준도 바꾸지 않는다.
`flow-series.ts`에 실제 투찰 계열을 추가하지 않는다. legacy `lib/session.ts`의 기록을 계정으로 이전하지
않는다. git push, 운영 DB 변경, container mutation, Infisical secret dump를 하지 않는다.

## backend 구현 결과 (2026-09-09)

계획의 1~4단계를 backend로 구현했고 5단계 web은 다음 작업이다. 설계와 달라진 결정과 그 근거는 다음과 같다.

- **provider hook을 쓰지 않는다.** 설치본의 `queueAfterTransactionHook`이 commit 뒤 hook을 돌리는 것을
  소스에서 확인했다. 그래서 A안(hook 트랜잭션)을 버리고 명시적 `initializeCurrentAccount` command로 갔다.
  계정 초기화 실패는 같은 command 재호출로 복구된다.
- **가입 방법은 Google 하나로 좁혔다.** 이메일·비밀번호는 범위 밖이다.
- **`app.registered_business`에 `supplier_party_id`·`linked_at`·`verification_state`를 두지 않는다.**
  저장된 파생 FK는 나중에 원본이 그 사업자를 관측해도 미연결로 남는다. 연결은 조회가 파생한다.
- **기본 워크스페이스는 `app.principal_default_workspace`가 소유한다.** membership에 owner 전역 unique를
  걸면 경쟁 방지가 아니라 도메인 권한 제한이 되어 초대와 다중 소유를 미리 막는다.
- **등록과 위치 변경은 `owner`만 한다.** 조회는 `member`도 한다.
- **개인 응답에는 guard 앞 middleware가 `Cache-Control: private, no-store`와 `Vary: cookie`를 붙인다.**
- **provider logger를 주입해** driver 예외의 원문 message·params가 로그에 남지 않게 했다.
- **schema conformance는 pinned `auth@1.7.2`의 `generateDrizzleSchema`를 실제 adapter 설정으로 실행**해
  구조를 대조한다. 허용한 차이는 밀리초 epoch 열의 JavaScript bigint mode와 시각 열의 timezone 둘뿐이다.
- **표시 라벨의 길이·빈값 정책을 `account-presentation.ts`가 소유한다.** provider가 소유한 이름에는 길이
  제한이 없고 `auth_user.name`은 `text`라, 계약 상한을 넘는 이름을 그대로 실으면 정상 세션이 응답 검증
  500으로 끊겨 온보딩 자체가 막혔다. 상한은 계약 schema에서 읽고 넘으면 잘라 싣는다. auth 원본 프로필과
  식별자는 바꾸지 않는다.

실행한 검증(모두 격리된 일회용 PostgreSQL):

- `apps/server/src/testing/account.integration.test.ts` — 초기화 멱등·동시 초기화 무고아·부분 실패 복구·
  타 워크스페이스 동일 번호 등록·중복·미관측 보존·후속 관측 연결·모호한 party 실패·등록 상한·위치 소유.
- `apps/server/src/testing/auth-session.integration.test.ts` — 실제 adapter 저장, rate limit 밀리초 왕복,
  canonical 검증의 무변경, 브라우저 POST 갱신의 `Set-Cookie`, 만료·로그아웃 거부, 로그 비노출.
  쿠키 서명 검사는 **살아 있는** 세션의 같은 토큰을 provider가 실제로 읽는 이름으로 실어 확인한다.
  서명 제거와 서명 한 자리 변조가 모두 미로그인이고, 같은 자리에서 정상 서명은 통과한다. 죽은 세션이나
  하드코딩한 쿠키 이름으로는 서명 검증이 사라져도 검사가 통과하므로 그렇게 쓰지 않는다.
- `apps/server/src/testing/account-http.integration.test.ts` — 미로그인·초기화 미완료 구분, Origin 거부,
  owner/member 403, 중복 409, 형식 400, 계정 간 격리, 인증 미설정 배포의 503, 캐시 헤더,
  계약 상한을 넘는 provider 표시 이름과 공백 이름의 세션 응답.

## 남은 확인

- Google OAuth client 발급과 redirect URI 등록은 사용자 계정 작업이다. 실제 Google 왕복은 네트워크가
  필요해 이번 검증에 포함하지 못했고 미검증으로 남는다. 세션 표·쿠키 서명·갱신 정책·adapter는 실제
  경로로 검증했다.
- pinned CLI generator가 Drizzle v0 시절의 `relations()` 헬퍼를 함께 내보내는데 이 저장소의 drizzle-orm
  1.0.0-rc.4 root에는 그 export가 없다. 우리는 관계 헬퍼를 선언하지 않고 adapter도 관계가 없으면 일반
  질의로 되돌아가므로 대조에서 그 자리만 대역으로 채웠다. 표·열·제약은 원문 그대로 평가한다.
- 세션 갱신은 브라우저 POST에만 있으므로 web이 그 갱신을 실제로 호출해야 한다. 화면 연결 작업이 닫는다.

## web 구현 결과 (2026-09-09)

5단계 web까지 구현했다. 계획과 달라졌거나 계획에 없던 결정은 다음과 같다.

- **전환 감지는 세션 hook 하나가 소유한다.** provider가 관측한 사용자 id를 세션 query key의 마지막 자리에
  담아 계정 전환을 캐시 항목 분리로 표현한다. `authenticated` boolean은 A→B 직접 전환을 알아채지 못한다.
  이 값은 전환 marker일 뿐이고 principal·워크스페이스의 권위는 세션 응답 union이 그대로 갖는다.
- **복귀 경로 판정은 `shell/auth/return-path` 하나다.** 로그인만 끝난 사용자를 설정으로 넘길 때도 같은
  `next` 값을 이어 나른다. 사업자등록번호처럼 사용자 자료는 이 parameter에 담지 않는다.
- **legacy `/dashboard/my`는 화면을 남기지 않고 `/setup`으로 영구 이동한다.** 같은 개념의 진실 원천이
  둘로 보이지 않게 하고, 브라우저에 남은 번호를 계정으로 옮기지 않는다.
- **개인 응답 transport를 `api/_transport/private-server-request.server.ts`로 나눴다.** 공개 read는 `use cache`
  경계 안에서 돌아 쿠키를 읽을 수 없으므로 adapter를 합치면 공개 read가 깨진다. 이 adapter는 resource
  `server.ts`의 exact runtime import만 허용하는 web boundary 규칙과 함께 들어왔다.
- **`app/(auth)`를 canonical layer 정규식에 넣었다(계획의 gate 영향 항목).** 그 결과 새 route group이 쓰던
  `alert`·`card`·`input`·`label`·`badge`를 `shared/ui`로 옮기고 `components/ui`의 같은 경로는 legacy 소비자를
  위한 재수출 barrel로만 남겼다. canonical UI는 `transition-all`을 쓸 수 없어 badge는 실제로 바뀌는 속성
  목록으로 고쳤다. 예외를 넓히지 않고 검사 범위를 넓히는 방향이다.
- **Nest `abortOnError`는 test runtime에서만 끈다.** `process.abort`는 finally를 건너뛰므로, 조립이 실패하면
  일회용 PostgreSQL container를 소유한 harness가 자기 자원을 정리하지 못한 채 사라진다. 운영은 그대로
  abort해 반쯤 산 프로세스가 트래픽을 받지 않게 한다. `create-app.test.ts`가 그 경계를 검사한다.

### 실행한 검증

- `pnpm lint:web-boundaries` 통과, `node --test tools/architecture/check-web-boundaries.test.mjs` 68 pass.
- `pnpm --filter @eatbid/web typecheck` 통과, 같은 filter `test` 473 pass/0 fail(84파일), `build` 성공.
  `/login`·`/setup`은 부분 prerender이고 `(workspace)` shell의 static은 그대로다.
- `pnpm quality:check`(테스트명 1663·module 주석 752)와 `pnpm architecture:check`(endpoint·contracts·
  contracts:python·skill projection 포함) 통과.
- 서버: `bun test src/bootstrap src/platform src/modules` 122 pass, `src/testing/account-http.integration.test.ts`
  6 pass(일회용 PostgreSQL), `src/bootstrap`+`operational-http.e2e` 18 pass. 모두 `apps/server` cwd에서 실행했다.
- 인증 E2E: `pnpm --filter @eatbid/web test:e2e:auth` 12 passed. 실제 migration DB·실제 Nest 조립·실제 서명
  세션·Chromium 경로이며 합성 세션이지 실제 Google 왕복이 아니다.
- canonical `pnpm review:ai -- --base HEAD~1`이 fragment만 붙은 복귀 경로가 기본 화면으로 바뀌는 결함을
  지적했다. 소스에서 근거를 확인해 pathname·query 분리를 한 함수로 모아 고치고, 같은 명령을 다시 돌려
  finding 0을 확인한 뒤 인증 E2E 12 passed를 재실행했다.

### 미검증과 알려진 관측

- 실제 Google OAuth 왕복은 client 발급과 redirect URI 등록이 사용자 계정 작업이라 여전히 미검증이다.
- 배포 전 시안 대조는 하지 않았다. 남은 캡처는 `test-results/auth/setup-registered.png` 한 장뿐이다.
- 서버 통합 스위트 전체(`src/testing`)는 다시 돌리지 않았다. 이번 변경과 관련된 파일만 재실행했다.
- `pnpm --filter @eatbid/web lint`와 `lint:strict`는 이번 변경 이전부터 legacy `app/dashboard`·`components/ui`
  스타터 파일 때문에 실패한다. 이번에 만들거나 고친 파일만 좁혀 돌린 `oxlint --deny-warnings`는 finding 0이다.
- 저장소 루트 cwd에서 `bun test`를 돌리면 root tsconfig에 `emitDecoratorMetadata`가 없어 Nest DI가 생성자
  타입을 잃고 무관한 실패가 난다. 서버 검사는 `apps/server` cwd에서 실행한다.
- dev 서버는 `/dashboard/my`의 영구 이동을 `instant`를 확인할 수 없다는 경고로 남긴다. 실제 이동은 E2E가
  확인했고 production build도 그 route를 부분 prerender로 만든다.
- 이전 세션이 turn 한도로 끝나면서 `eatbid-eat47-account-*` container 10개가 남아 있다. 이 작업의 범위는
  container mutation을 포함하지 않아 지우지 않았다.
