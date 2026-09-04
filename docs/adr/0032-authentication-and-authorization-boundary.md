# 0032 — 인증·인가 경계와 화면 권한 매트릭스

- Status: Proposed
- Date: 2026-09-04
- 관계: `0018`(application identity와 bigint wire)의 `identity_subject → principal_id` 해소를 런타임
  경계로 구체화한다. `0023`(web 모듈 경계)의 "shell은 session endpoint를 직접 읽지 않고 상위 layout이
  검증해 전달한다"를 실제 layout 규칙으로 확정한다. `0028`(Cache Components)의 Suspense·`use cache`
  제약은 그대로 구속한다. `0031`(결정 화면 렌더링)이 정한 상태 소유를 바꾸지 않는다.
- 근거: Linear EAT-47(현황 조사·권한 매트릭스 초안), EAT-48(진입 화면 분리),
  `docs/architecture/domain-and-data.md` §3.3·§3.6, `docs/product/decision-screen-v2/pages-endpoints-load.md`,
  사용자 결정 2026-09-04(게스트 모드 폐기, 권한별 화면 분리)

## Context

현재 저장소에는 인증 경계가 없다. canonical route `app/(workspace)/*`와 공개 API `findAuction`,
`listOrganizationAuctionAttempts`는 누구나 부를 수 있고, `apps/web/src/proxy.ts`는 모든 요청을
그대로 통과시키는 no-op이며 `(workspace)/layout.tsx`는 `ApplicationShell`만 감싼다.

web에는 Better Auth 클라이언트(`apps/web/src/lib/auth-client.ts`, basePath `/api/auth`)만 남아 있고
그 경로를 서빙하는 서버 코드는 Nest 전환(`91aa2f6`)에서 삭제됐다. `better-auth` 의존성도 아직
`apps/web/package.json`에만 있다. 즉 클라이언트는 존재하지 않는 endpoint를 향해 배선돼 있다.

`app.principal`, `app.identity_subject`, `app.workspace`, `app.workspace_membership`은 마이그레이션까지
있으나 읽고 쓰는 코드가 없다. `workspace_membership.role`은 `varchar(32)`로 열려 있어 어떤 문자열도
들어간다. `WorkspaceSupplier`는 `domain-and-data.md` §3.3에 문장으로만 있고 DDL이 없다.

레거시 `packages/shared/src/db/schema/auth.ts`의 주석은 "게스트 모드 유지: 로그인 없이도 전 기능 동작"을
원칙으로 적어 두었고 `apps/web/src/lib/session.ts`는 localStorage를 게스트의 진실 원천으로 삼는다.
2026-09-04 사용자 결정은 이 원칙을 폐기한다. eatbid는 1,000명 규모의 유료 전국 서비스이며, 성적표와
내 기록은 워크스페이스가 소유한 사업자에 묶인 사실이므로 익명 브라우저가 진실 원천일 수 없다.

앞으로 만들 계약 대부분이 사용자별이다. `listBidWorkItems`/`putBidWorkItem`은 `app` 소유 상태를 쓰고,
`findSupplierRecord`는 "워크스페이스가 등록한 사업자만" 조회 가능해야 한다고
`pages-endpoints-load.md`가 이미 못박았다. 이 경계를 계약이 생긴 뒤에 붙이면 각 endpoint가 자기만의
권한 규칙을 갖게 된다.

## Decision

### 1. 인증은 Nest가 마운트하고 세션 쿠키로 web과 공유한다

- Better Auth 서버 인스턴스는 `apps/server/src/platform/auth`가 소유하고 `/api/auth/*`를 Nest ingress에
  마운트한다. `better-auth` 의존성은 `apps/server`로 옮기고 web에는 클라이언트만 남긴다.
  근거: `AGENTS.md` 19항에서 `/api/**`는 Nest ingress이며, Next Route Handler는 두 번째 업무 진실
  원천이 될 수 없다(`0023`).
- `/api/auth/*`의 요청·응답 본문은 Better Auth 라이브러리 계약을 그대로 유지한다. canonical
  `/api/v1/**` operation의 RFC 9457 계약과 섞지 않는다(`0018`).
- 세션은 same-origin 쿠키(`HttpOnly`, `Secure`, `SameSite=Lax`)다. web과 server가 같은 origin 뒤에
  있으므로 브라우저 요청과 RSC 요청 모두 같은 쿠키를 쓴다.
- `apps/web/src/proxy.ts`는 세션을 검증하지 않는다. 이유는 두 가지다. 첫째, `0028`이 요구하는 static
  shell을 위해서는 요청마다 쿠키를 읽는 전역 경계를 두지 않는 편이 낫다. 둘째, Next middleware를
  유일한 인가 지점으로 두는 구조는 헤더 조작으로 우회된 전례가 있고(CVE-2025-29927,
  `x-middleware-subrequest`) Next 공식 문서도 middleware를 단독 인증 경계로 쓰지 말라고 적는다.
  `proxy.ts`는 계속 no-op으로 두거나 삭제한다.
- 화면 판정은 `(workspace)/layout.tsx`의 Suspense 안 loader가 `getCurrentSession` 서버 계약으로 한다.
  layout 최상위에서 `cookies()`를 await하면 모든 canonical route의 shell이 dynamic이 된다(`0028` 2항).
- **web guard는 UX이고 권위는 Nest guard다.** Next layout은 자식 page의 렌더 시작을 막지 못하므로
  세션 없는 요청에서 page loader가 API를 먼저 부를 수 있다. 그때 데이터가 새지 않는 이유는 layout의
  redirect가 아니라 Nest가 401을 돌려주기 때문이다. 두 겹을 모두 둔다.
- `getCurrentSession`의 web server entry는 들어온 요청의 세션 쿠키를 Nest로 전달해야 한다. 현재
  `apps/web/src/api/_transport/server-request.server.ts`는 쿠키를 전달하지 않으므로, cookie를 실어
  보내는 별도의 authenticated server entry를 같은 변경에서 추가한다. 이 함수에는 `use cache`를 쓰지
  않는다(`0028` 4항: 세션 의존 함수에 `use cache` 금지).

### 2. principal 해소는 요청마다 명시적으로 한다

- guard는 세션에서 `(provider, issuer, subject)`를 얻어 `app.identity_subject`로 `principal_id bigint`를
  해소한다. Better Auth의 문자열 user id는 `identity_subject.subject`에만 남고 어떤 application FK도
  되지 않는다(`0018`).
- `provider`/`issuer` 값은 고정한다. 자체 이메일 로그인은 `('credential', 'eatbid')`, Google은
  `('google', 'https://accounts.google.com')`. 새 provider는 이 ADR을 갱신해서만 추가한다.
- 최초 로그인은 `app.principal` 삽입과 `app.identity_subject` 삽입을 한 트랜잭션에서 수행하고
  `identity_subject_provider_issuer_subject_key`에 대한 upsert로 멱등하게 만든다. 동시 첫 로그인 두
  건이 principal 두 개를 만들지 않는다.
- provider가 소유한 세션 테이블에 `principal_id`를 비정규화하지 않는다. `0018`의 Better Auth CLI
  schema conformance gate를 깨뜨리기 때문이다. 요청당 조회 2회(세션 1, identity_subject 1)를 받아들인다.
- 해소된 principal은 `RequestContextStore`에 넣지 않는다. 그 store는 상관관계 ID만 담고 인증 정보를
  숨겨 전달하는 service locator로 쓰지 않는다고 이미 선언돼 있다
  (`apps/server/src/platform/request-context/request-context.middleware.ts`). principal은 Nest
  `ExecutionContext`에 실어 param decorator로 controller에 명시적으로 주입한다.

### 3. 역할은 두 값의 enum이고 운영자는 별도 grant 테이블이다

- `app.workspace_membership.role`은 `owner | member` 두 값으로 고정한다. `varchar(32)` 자유 문자열을
  PostgreSQL enum 또는 check 제약으로 좁히는 마이그레이션을 같은 변경에서 만든다. 값의 권위는
  `packages/contracts`의 Zod enum이고 DB 제약이 그 사본을 강제한다.
  - `owner`: 워크스페이스 이름·사업자 등록·구성원 초대·삭제
  - `member`: 조회와 자신의 `BidWorkItem` 작성
  - 워크스페이스에는 최소 한 명의 `owner`가 있어야 한다.
- 운영자는 `principal.is_operator boolean`이 아니라 **별도 `app.operator_grant` 테이블**로 표현한다.

  ```text
  app.operator_grant(
    operator_grant_id bigint pk,
    principal_id      bigint fk -> app.principal,
    granted_at        timestamptz not null,
    granted_by_principal_id bigint fk -> app.principal,
    revoked_at        timestamptz null,
    reason            text not null
  )
  ```

  근거: 운영자 권한은 사람의 속성이 아니라 **부여·회수되는 권한**이다. boolean 열은 누가 언제 왜
  줬는지를 남기지 못하고 한 번의 `UPDATE`로 흔적 없이 뒤집힌다. 운영자는 수집 실행과 mart 전환을
  돌릴 수 있으므로 그 부여 이력이 사고 조사의 1차 자료다(`0012` 보안·관측 기준선). 반대 논거는
  운영자가 한두 명뿐이라 테이블이 과하다는 것인데, 테이블 하나는 `AGENTS.md` 11항이 말하는 인프라
  추가가 아니고 나중에 이력을 되살릴 방법은 없다.
- **운영자는 다른 수준의 상위집합이 아니다.** 운영자 권한은 수집 실행·mart 전환·워크스페이스 관리이며,
  자기가 구성원이 아닌 워크스페이스의 `BidWorkItem`이나 성적표를 읽을 수 없다. 지원 목적의 열람이
  필요해지면 별도 grant와 열람 로그를 같이 만드는 새 ADR을 쓴다.

### 4. 권한 수준과 endpoint·route 요구 표

수준 정의:

| 수준 | 판정 |
| --- | --- |
| `public` | 세션을 보지 않는다 |
| `authenticated` | 유효 세션 → `principal_id` 해소 성공 |
| `workspace_member` | 요청의 `workspaceId`에 대한 `workspace_membership` 존재 |
| `workspace_owner` | 그 membership의 `role = owner` |
| `workspace_supplier` | 그 워크스페이스에 활성 등록된 `supplier_party_id`와 대상이 일치 |
| `subscription_active` | 유료 상태(§7에서 미룸) |
| `operator` | 회수되지 않은 `operator_grant` |

공개 API:

| operationId | method·path | 요구 수준 | 실패 | 비고 |
| --- | --- | --- | --- | --- |
| (Better Auth 전송) | `/api/auth/*` | `public` | provider 계약 | 라이브러리 본문 유지 |
| `checkHealth` | `GET /api/v1/health` | `public` | — | 기존 |
| `findAuction` | `GET /api/v1/auctions/{auctionId}` | `authenticated` | 401 | 게스트 열람 폐기 |
| `listOrganizationAuctionAttempts` | `GET /api/v1/organizations/{organizationId}/auction-attempts` | `authenticated` | 401 | 창 길이는 `subscription_active`가 조절 |
| `findWinRateDistribution` | `GET /api/v1/win-rate-distribution` | `authenticated` | 401 | `period=60m`는 `subscription_active` |
| `findAuctionParticipation` | `GET /api/v1/auctions/{auctionId}/participation` | `authenticated` | 401 | |
| `listOpenAuctions` | `GET /api/v1/auctions?state=open` | `authenticated` | 401 | 전국 조회는 `subscription_active`, 무료는 기본 지역 |
| `listAuctionBids` | `GET /api/v1/auctions/{auctionId}/bids` | `authenticated` | 401 | 명단은 eaT 공개 사실 |
| `listOrganizationSuppliers` | `GET /api/v1/organizations/{organizationId}/suppliers` | `authenticated` | 401 | |
| `listCodes` | `GET /api/v1/code-schemes/{scheme}/codes` | `authenticated` | 401 | 정적 기준정보 |
| `getCurrentSession` | `GET /api/v1/session` | `public` | — | 미로그인은 200 + `authenticated:false` |
| `createWorkspace` | `POST /api/v1/workspaces` | `authenticated` | 401 | 생성자가 `owner` |
| `listMyWorkspaces` | `GET /api/v1/workspaces` | `authenticated` | 401 | 내 membership만 |
| `registerWorkspaceSupplier` | `POST /api/v1/workspaces/{workspaceId}/suppliers` | `workspace_owner` | 401·403·409 | 409는 다른 워크스페이스 선점 |
| `listBidWorkItems` | `GET /api/v1/workspaces/{workspaceId}/bid-work-items` | `workspace_member` | 401·403 | |
| `putBidWorkItem` | `PUT /api/v1/workspaces/{workspaceId}/bid-work-items/{attemptId}` | `workspace_supplier` | 401·403 | 대상 사업자가 이 워크스페이스 소유여야 한다 |
| `findSupplierRecord` | `GET /api/v1/workspaces/{workspaceId}/suppliers/{supplierPartyId}/record` | `workspace_supplier` | 401·403 | 타 워크스페이스 사업자는 403 |
| `listSupplierAttempts` | `GET /api/v1/workspaces/{workspaceId}/suppliers/{supplierPartyId}/attempts` | `workspace_supplier` | 401·403 | 같음 |

`getCurrentSession`이 `public`인 것은 의도다. 미로그인에서 401을 던지면 진입 화면이 정상 흐름에서
오류를 렌더해야 한다. 세션 조회는 "너는 누구인가"의 답이지 보호 자원이 아니다.

화면 route:

| route group | route | 요구 수준 | 미충족 시 |
| --- | --- | --- | --- |
| `(marketing)` | `/`, `/pricing` | `public` | — |
| `(auth)` | `/login`, `/signup` | `public` | 이미 로그인이면 `next` 또는 `/today` |
| `(auth)` | `/welcome` | `authenticated` | `/login?next=/welcome` |
| `(workspace)` | `/today`, `/auctions/[auctionId]`, `/auctions/[auctionId]/bids` | `authenticated` | `/login?next=<현재 경로>` |
| `(workspace)` | `/record` | `workspace_supplier` | 워크스페이스 없으면 `/welcome`, 사업자 없으면 `/welcome?step=supplier` |
| 레거시 | `/s/[token]`, `/dashboard/**` | 판정 대상 아님 | legacy disposition Gate에서 제거 |

워크스페이스가 하나도 없는 로그인 사용자가 `(workspace)` route에 오면 `/welcome`으로 보낸다.
워크스페이스는 있으나 사업자가 없으면 결정 화면은 열리고 `/record`와 내 기록 저장만 막힌다.
이유: 사업자 등록 전에도 공고 판단 재료는 볼 수 있어야 제품 가치를 확인하고 결제한다.

### 5. 인가 실패의 wire 표현

- 세션이 없거나 만료: `401`, `code: UNAUTHENTICATED`.
- 세션은 있으나 대상에 대한 권한 없음: `403`, `code: FORBIDDEN`.
- 두 code는 `packages/contracts/src/common/problem-details.ts`의 `problemCodeSchema`에 이미 있고
  `ProblemDetailsFilter`가 이미 매핑한다. 새 code를 만들지 않는다.
- **존재를 숨기려고 403을 404로 바꾸지 않는다.** 공고·기관·명단은 eaT 공개 사실이고,
  워크스페이스 자원은 ID가 bigint라 열거로 존재를 캐낼 실익이 없다. 대신 403 본문에 어떤 워크스페이스
  ·사업자인지 적지 않는다. `ProblemDetails`는 strict object라 추가 필드가 애초에 불가능하다.
- 로그인 만료로 401을 받은 web은 현재 경로를 `next`에 담아 `/login?next=<encodeURIComponent(경로)>`로
  보낸다. `next`는 같은 origin의 절대 경로만 허용하고(`/`로 시작하고 `//`로 시작하지 않음) 그 외에는
  기본 진입 경로로 대체한다. 열린 리디렉션을 만들지 않는다.
- 인증 실패 응답에도 `x-request-id`가 실린다. 로그에는 `principal_id`만 남기고 이메일·세션 토큰·쿠키를
  남기지 않는다(`RedactingJsonLogger`).

### 6. `workspace_supplier` 소유 규칙

```text
app.workspace_supplier(
  workspace_id      bigint fk -> app.workspace,
  supplier_party_id bigint fk -> core.supplier_party,
  registered_at     timestamptz not null,
  registered_by_principal_id bigint fk -> app.principal,
  verification_state text not null,   -- unverified | verified | disputed
  revoked_at        timestamptz null,
  primary key (workspace_id, supplier_party_id)
)
```

- **사업자등록번호는 대조 키이지 식별자가 아니다.** 등록 입력은 사업자등록번호 문자열이지만, 그 값은
  `core.supplier_party`를 찾는 데만 쓰이고 저장되는 관계는 `supplier_party_id bigint`다
  (`AGENTS.md` 2항, `domain-and-data.md` §3.3). 번호로 찾지 못하면 등록을 만들지 않고 "원본에서 아직
  관측되지 않은 사업자"로 응답한다. 이름 추측으로 `SupplierParty`를 만들지 않는다.
- **활성 등록은 사업자당 하나다.** `revoked_at is null`인 행에 대해 `supplier_party_id` 부분 unique
  인덱스를 건다. 사업자등록번호는 공개 정보라서 배타성이 없으면 누구나 남의 번호를 넣고 그 업체의
  성적표를 자기 화면에 띄운다. 선점 충돌은 `409 CONFLICT`로 돌려주고 운영자가 해제한다.
- `verification_state`의 초기값은 `unverified`다. 이번 슬라이스는 증빙 검증 절차를 만들지 않는다.
  배타 선점이 실질적 방어이고, 열람 대상인 개찰 명단 자체는 eaT 공개 사실이다. 검증 절차와
  `verified` 승격 조건은 후속 이슈에서 정한다.
- 한 워크스페이스는 여러 사업자를 등록할 수 있다(`product-and-quality.md` §1의 다사업자 운영).
- 인가 판정의 단위는 `Workspace × SupplierParty`다. `BidWorkItem`의 grain에 대해서는
  `domain-and-data.md` §3.5의 `unique(workspace_id, supplier_party_id, auction_attempt_id)`를 따른다.
  `pages-endpoints-load.md`가 적은 `PK (workspace_id, attempt_id)`와 다르므로 계약 구현 전에 한쪽으로
  맞춘다.

### 7. 구독 상태는 이 ADR이 정하지 않는다

`subscription_active`는 **판정 지점만** 여기서 정하고 상태의 저장·결제 연동·요금제 정의는 별도 ADR로
미룬다. 구현은 `SubscriptionPolicy` port 하나를 두고, 그 ADR이 나오기 전까지는 모든 로그인 principal에
대해 참을 돌려준다. 그래야 요금제가 정해질 때 바꿀 곳이 한 군데다. 이 port를 통과하지 않는 곳에
"무료/유료" 분기를 흩어 놓지 않는다.

## Consequences

- 게스트 모드가 사라진다. `apps/web/src/lib/session.ts`의 localStorage 진실 원천과
  `/api/me/*` PUT 동기화 경로는 legacy disposition 대상이 된다. 로그인 전 브라우저에 남아 있던
  기록의 이전 정책은 별도로 정해야 하며, 이 ADR은 자동 이전을 허용하지 않는다(공용 PC에서 남의
  기록이 섞이는 경로다).
- 모든 canonical read가 세션을 요구하므로 `/auctions/[auctionId]`는 더 이상 익명 공유 링크로 열리지
  않는다. 공유가 필요하면 token-scoped 공개 operation을 별도 계약으로 만든다.
- 요청마다 조회 2회가 늘어난다. 피크 3 req/s 가정에서 무시할 수 있는 비용이며, 줄이려고 provider
  세션 테이블에 `principal_id`를 심는 것은 `0018` conformance gate가 막는다.
- `use cache`를 쓸 수 있는 read가 줄어든다. 세션 의존 함수는 캐시하지 못하므로 `mart` 기반 집계만
  태그 캐시의 이득을 본다.
- 권한 매트릭스가 문서와 guard 테스트 양쪽에 있으므로 둘이 어긋나면 테스트가 먼저 깨진다. 표의 한 줄을
  바꾸는 변경은 이 ADR과 테스트를 같이 고쳐야 한다.
- **잘못됐을 때 비용:** 인가 판정이 endpoint마다 흩어지면 새 계약 하나가 남의 워크스페이스 성적표를
  여는 사고가 나고, 그 사고는 로그에 정상 200으로 남아 사후에 찾기 어렵다.

## Rejected alternatives

- **web middleware(`proxy.ts`)에서 세션을 검증한다**: 요청마다 전역 dynamic 경계가 생겨 `0028`의 static
  shell이 사라지고, 헤더 조작 우회 전례(CVE-2025-29927)가 있어 단독 인가 지점으로 부적합하다. 무엇보다
  API 권위가 Nest에 있는데 인가 판정만 web에 두면 진실 원천이 둘이 된다.
- **Better Auth를 Next Route Handler에 마운트한다**: `AGENTS.md` 19항의 `/api/**` Nest ingress 규칙과
  `0023`의 "Route Handler는 두 번째 업무 진실 원천이 될 수 없다"를 동시에 깬다. Nest가 세션을 직접
  읽지 못해 server 쪽 guard가 web을 역참조해야 한다.
- **Clerk 등 외부 인증 SaaS**: `0018`이 이미 Better Auth 기준의 CLI schema conformance와 Drizzle
  migration gate를 확정했다. 사용자 계정 데이터가 외부로 나가고 월 비용이 사용자 수에 비례하는데,
  현재 필요한 것은 이메일과 Google 로그인 두 가지뿐이다.
- **stateless JWT bearer만 사용한다**: 세션 즉시 무효화(퇴사·기기 분실·운영자 회수)를 못 한다.
  브라우저가 토큰을 둘 안전한 곳은 결국 쿠키이므로 세션 대비 이득이 없고, RSC가 토큰을 다시 실어
  보내는 경로만 늘어난다.
- **`principal.is_operator boolean`**: 부여 시각·부여자·회수 이력을 남기지 못한다. 수집 실행과 mart
  전환을 돌리는 권한이라 사고 조사에서 이 이력이 1차 자료다.
- **역할을 세 값 이상으로 시작한다(`admin | editor | viewer` 등)**: 지금 필요한 구분은 "워크스페이스를
  바꿀 수 있는가" 하나뿐이다. 쓰이지 않는 역할은 화면과 guard에 죽은 분기만 남긴다.
- **403을 404로 위장한다**: 여기서 보호하는 자원의 존재 자체는 비밀이 아니고, 화면이 "권한 없음"과
  "없는 자원"을 구분하지 못하면 사용자가 자기 워크스페이스를 잘못 고른 상황을 안내할 수 없다.
