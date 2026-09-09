# 0032 — 인증·인가 경계와 등록된 사업자

- Status: Accepted
- Date: 2026-09-04 (2026-09-09 개정·확정, 2026-09-10 로그인 게이트 개정)
- 관계: `0018`(application identity와 bigint wire)의 `identity_subject → principal_id` 해소를 런타임
  경계로 구체화한다. `0023`(web 모듈 경계)의 "shell은 session endpoint를 직접 읽지 않고 상위 layout이
  검증해 전달한다"를 실제 layout 규칙으로 확정한다. `0028`(Cache Components)의 Suspense·`use cache`
  제약은 그대로 구속한다. `0031`(결정 화면 렌더링)이 정한 상태 소유를 바꾸지 않는다.
  `0033`(SupplierParty core)의 사업자번호 승격 규칙을 소비할 뿐 바꾸지 않는다.
- 근거: Linear EAT-47(인증 경계), EAT-48(진입 화면 분리), EAT-54(사업자별 내 위치),
  EAT-40(사업자번호 대조와 성적표), `docs/architecture/domain-and-data.md` §3.3·§3.6,
  `docs/product/decision-screen-v2/pages-endpoints-load.md`,
  사용자 결정 2026-09-04(게스트 모드 폐기, 권한별 화면 분리),
  사용자 결정 2026-09-09(로그인 → 내 사업자번호 → 직접 입력 위치 → 기존 차트의 실제 내 투찰),
  Linear EAT-138(로그인 게이트와 세션 쿠키 캐시), 사용자 결정 2026-09-10(공개 화면 없음),
  `docs/notes/2026-09-10-web-walkthrough.md` §0·§4

## 2026-09-09 개정 요지

이 ADR의 2026-09-04 초안은 네 가지를 잘못 정했고 이번 개정이 그것을 되돌린 뒤 backend 구현으로 확정했다.

1. **사업자번호 전역 배타 선점을 "실질적 방어"라고 적었다.** 사업자등록번호는 공개 정보이므로
   먼저 넣은 사람이 이기는 규칙은 방어가 아니라 비용 없는 서비스 거부다(§7).
2. **로그인 경계를 세우는 변경에서 모든 공개 read를 함께 잠그도록 적었다.** 그것은 인증 기반과 별개인
   제품·요금 결정이며 같은 변경에 묶을 근거가 없다(§5).
3. **provider 사용자 생성 hook을 원자 경계로 썼다.** pinned Better Auth 1.7.2의
   `queueAfterTransactionHook`은 commit 뒤에 hook을 돌린다. 계정 생성은 명시적 command가 한다(§2).
4. **가입 방법을 이메일·비밀번호까지 열어 두었다.** 이번 범위의 가입은 Google 하나이고, 메일 발송·재설정·
   비밀번호 저장은 이 슬라이스의 보안 표면이 아니다(§1).

이 개정은 backend 경계까지 구현·검증했으므로 `Accepted`다. 화면 연결은 다음 작업이며 이 문서가 정한 계약을
그대로 소비한다.

## 2026-09-10 개정 요지

제품 결정이 이 ADR의 유보 하나를 지웠다. eatbid에는 공개 화면이 없고 공고 데이터는 로그인해야 본다.
§5가 "기존 공개 read의 요구 수준은 이번 변경에서 바꾸지 않는다"로 미뤄 둔 이유는 무료/유료 경계가 아직
정해지지 않아 인증 배포를 요금제에 묶고 싶지 않다는 것이었는데, 이제 그 경계가 "전부 로그인 뒤"로
정해졌으므로 유보의 전제가 없다. 새 §12가 그 줄과 화면 route 표를 대체하고, 2026-09-04 초안의
"`proxy.ts`는 계속 no-op으로 두거나 삭제한다"를 함께 철회한다. 철회하는 것은 no-op 결정 하나이며
"middleware를 유일한 인가 지점으로 삼지 않는다"는 판단은 그대로다.

## Context

현재 저장소에는 인증 경계가 없다. canonical route `app/(workspace)/*`와 공개 API `findAuction`,
`listOrganizationAuctionAttempts`는 누구나 부를 수 있고, `apps/web/src/proxy.ts`는 모든 요청을
그대로 통과시키는 no-op이며 `(workspace)/layout.tsx`는 `ApplicationShell`만 감싼다.

web에는 Better Auth 클라이언트(`apps/web/src/lib/auth-client.ts`, basePath `/api/auth`)만 남아 있고
그 경로를 서빙하는 서버 코드는 Nest 전환(`91aa2f6`)에서 삭제됐다. `better-auth` 의존성도 아직
`apps/web/package.json`에만 있다(`^1.7.2`, lock은 1.7.2). 즉 클라이언트는 존재하지 않는 endpoint를
향해 배선돼 있다. `apps/server/src/bootstrap/create-app.ts`에는 `/api/auth/{*path}`를 전역 prefix에서
제외하는 규칙과 파서 앞 raw transport slot(`mountPreParserRawTransport`)만 미리 있다.

`app.principal`, `app.identity_subject`, `app.workspace`, `app.workspace_membership`은 마이그레이션까지
있으나 읽고 쓰는 코드가 없다. `workspace_membership.role`은 `varchar(32)`로 열려 있어 어떤 문자열도
들어간다. `WorkspaceSupplier`는 `domain-and-data.md` §3.3에 문장으로만 있고 DDL이 없다.

레거시 `packages/shared/src/db/schema/auth.ts`의 주석은 "게스트 모드 유지: 로그인 없이도 전 기능 동작"을
원칙으로 적어 두었고 `apps/web/src/lib/session.ts`는 localStorage를 게스트의 진실 원천으로 삼는다.
2026-09-04 사용자 결정은 이 원칙을 폐기한다. eatbid는 유료 전국 서비스이며, 성적표와 내 기록은
워크스페이스가 등록한 사업자에 묶인 사실이므로 익명 브라우저가 진실 원천일 수 없다. 이 legacy store는
새 canonical 경로에서 import하지 않으며 자동 이전도 하지 않는다.

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
- 마운트 지점은 이미 있는 `mountPreParserRawTransport` slot이다. Better Auth handler는 원문 body를
  스스로 읽으므로 `express.json()` **앞**에 서야 한다. 이 순서를 바꾸면 서명·상태 검증이 이미 소비된
  stream을 만난다.
- 저장은 Drizzle adapter를 쓰고 auth table은 `packages/db`의 committed schema에서만 나온다.
  Better Auth CLI는 schema 계약을 생성할 뿐 migration을 적용하지 않는다(`0018` Auth schema conformance).
  `better-auth migrate`, `db:push`, 수기 DDL은 어떤 환경에서도 쓰지 않는다(`AGENTS.md` 10항).
- `/api/auth/*`의 요청·응답 본문은 Better Auth 라이브러리 계약을 그대로 유지한다. canonical
  `/api/v1/**` operation의 RFC 9457 계약과 섞지 않는다(`0018`).
- **가입 방법은 Google 하나다.** `emailAndPassword`는 끈다. 메일 발송·재설정·비밀번호 저장은 각각 별도의
  보안 표면이고 지금 필요한 것은 기존 Better Auth/Google 선택의 재사용뿐이다.
- 세션은 same-origin 쿠키(`HttpOnly`, `Secure`, `SameSite=Lax`)다. web과 server가 같은 origin 뒤에
  있으므로 브라우저 요청과 RSC 요청 모두 같은 쿠키를 쓴다. `Secure`를 붙일 수 없는 배포는 시작 시점에
  막는다. production은 https base URL만 허용하고, http는 개발자 기기의 loopback host에서만 허용한다.
  검사를 뒤로 미루면 로그인은 되는데 쿠키가 평문으로 오가는 배포가 정상처럼 동작한다.
- **세션 갱신은 브라우저가 한다.** provider의 `session.deferSessionRefresh`를 켜고, 서버가 부르는 검증은
  `disableRefresh`·`disableCookieCache`로 읽기만 한다. 이 옵션이 없으면 GET 하나가 DB 만료를 연장하며
  `Set-Cookie`를 만드는데, RSC와 서버 간 조회는 그 헤더를 브라우저에 전달하지 못해 DB 수명과 쿠키 수명이
  갈라진다. 만료 세션의 DB 삭제도 GET에서 일어나지 않으므로 읽기 한 번이 로그아웃을 확정하지 않는다.
  실제 갱신은 브라우저가 provider endpoint에 POST해 `Set-Cookie`를 직접 받는다.
- **provider 로그는 저장소의 안전한 로그 경계를 지난다.** 기본 logger는 `console.error(message, error)`로
  driver 예외를 그대로 쏟고, 그 예외의 message·params에는 세션 토큰이 들어 있다. provider logger를 주입해
  고정 event와 분류형 오류만 남기고 원문 문자열을 복사하지 않는다.
- **사용자별 응답은 캐시하지 않는다.** 개인 operation 경로에는 guard보다 앞선 middleware가
  `Cache-Control: private, no-store`와 `Vary: cookie`를 붙인다. guard가 끊는 401·403과 의존성 장애 503에도
  같은 헤더가 남아야 하므로 controller나 interceptor가 아니라 그 앞자리에 둔다.
- `apps/web/src/proxy.ts`는 세션을 **검증하지** 않는다. Next middleware를 유일한 인가 지점으로 두는
  구조는 헤더 조작으로 우회된 전례가 있고(CVE-2025-29927, `x-middleware-subrequest`) Next 공식 문서도
  middleware를 단독 인증 경계로 쓰지 말라고 적는다. 2026-09-10 개정은 여기에 검증이 아닌 **쿠키 유무
  판정**을 둔다(§12). 그 판정은 네트워크를 부르지 않으므로 `0028`의 static shell과 요청당 비용을 건드리지
  않고, 위조한 쿠키로 얻을 수 있는 것은 401을 받는 화면뿐이다.
- 화면 판정은 `(workspace)/layout.tsx`의 Suspense 안 loader가 `getCurrentSession` 서버 계약으로 한다.
  layout 최상위에서 `cookies()`를 await하면 모든 canonical route의 shell이 dynamic이 된다(`0028` 2항).
- **web guard는 UX이고 권위는 Nest guard다.** Next layout은 자식 page의 렌더 시작을 막지 못하므로
  세션 없는 요청에서 page loader가 API를 먼저 부를 수 있다. 그때 데이터가 새지 않는 이유는 layout의
  redirect가 아니라 Nest가 401을 돌려주기 때문이다. 두 겹을 모두 둔다.
- `getCurrentSession`의 web server entry는 들어온 요청의 세션 쿠키를 Nest로 전달해야 한다. 현재
  `apps/web/src/api/_transport/server-request.server.ts`는 쿠키를 전달하지 않으므로, cookie를 실어
  보내는 별도의 authenticated server entry를 같은 변경에서 추가한다. 이 함수에는 `use cache`를 쓰지
  않는다(`0028` 4항: 세션 의존 함수에 `use cache` 금지). 전달하는 쿠키는 auth가 소유한 이름만 고른다.
  요청 헤더 전체를 그대로 relay하면 내부 origin 호출에 사용자 헤더가 섞인다.

### 2. principal 해소는 요청마다 명시적으로 한다

- guard는 세션에서 `(provider, issuer, subject)`를 얻어 `app.identity_subject`로 `principal_id bigint`를
  해소한다. Better Auth의 문자열 user id는 `identity_subject.subject`에만 남고 어떤 application FK도
  되지 않는다(`0018`).
- **`subject`는 provider의 `sub`가 아니라 이 인증 시스템이 만든 사용자 식별자다.** 설치된 1.7.2의 OAuth
  연결 경로는 provider가 준 id를 버리고(`const { id: _id, ... } = userInfo`) 자기 user 행을 새로 만든 뒤
  외부 subject를 `account.accountId`/`account.issuer`에만 남긴다. 그래서 `identity_subject`의 좌표는
  `('better-auth', 'urn:eatbid:auth', user.id)`다.
- **`issuer`는 배포 origin이 아니라 고정 namespace다.** origin을 쓰면 포트 하나만 바뀌어도 같은 사람이
  다른 principal이 되고 이미 저장된 워크스페이스가 통째로 보이지 않는다. 새 provider namespace는 이 ADR을
  갱신해서만 추가한다.
- **행을 만드는 곳은 명시적 초기화 command 하나다.** provider hook을 쓰지 않는 이유는 설치본의
  `queueAfterTransactionHook`이 provider transaction commit 뒤에 hook을 실행하기 때문이다. hook에서
  principal을 만들면 hook 실패가 "계정은 있는데 app 관계가 없는" 상태로 굳고, 이미 존재하는 user라
  재로그인해도 hook이 다시 돌지 않아 사용자가 스스로 복구할 수 없다. `initializeCurrentAccount`는 몇 번을
  불러도 같은 결과이고 그 자체가 복구 경로다.
- **초기화는 하나의 app transaction이다.** identity가 없으면 principal·identity를, 기본 워크스페이스가
  없으면 워크스페이스·owner membership·기본 관계를 만든다. 두 unique 제약 중 하나라도 경쟁에서 지면
  트랜잭션 전체가 되돌아가므로 주인 없는 principal도 워크스페이스도 남지 않고, 그때는 이긴 쪽이 이미
  커밋돼 있으므로 한 번 더 읽으면 끝난다. Drizzle이 driver 오류를 감싸므로 이 재시도 판정은 원인 사슬의
  23505를 제한된 깊이까지 따라간다.
- **guard는 읽기 전용이다.** 요청 경로에서 계정을 다시 만들 수 있게 하면 회수된 계정이 조용히 되살아나고
  모든 읽기 endpoint가 쓰기 트랜잭션을 갖는다. 유효 세션인데 principal이 없으면 그것은 "초기화가 아직
  끝나지 않았다"이므로 401이 아니라 403이다(§6).
- provider가 소유한 세션 테이블에 `principal_id`를 비정규화하지 않는다. `0018`의 Better Auth CLI
  schema conformance gate를 깨뜨리기 때문이다. 요청당 조회 2회(세션 1, identity_subject 1)를 받아들인다.
- 해소된 principal은 `RequestContextStore`에 넣지 않는다. 그 store는 상관관계 ID만 담고 인증 정보를
  숨겨 전달하는 service locator로 쓰지 않는다고 이미 선언돼 있다
  (`apps/server/src/platform/request-context/request-context.middleware.ts`). principal은 Nest
  `ExecutionContext`에 실어 param decorator로 controller에 명시적으로 주입한다.

### 3. 역할은 두 값의 enum이고 운영자는 별도 grant 테이블이다

- `app.workspace_membership.role`은 `owner | member` 두 값으로 고정한다. `varchar(32)` 자유 문자열을
  check 제약으로 좁히는 마이그레이션을 첫 membership 행을 쓰는 변경과 같이 만든다. 값의 권위는
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
  돌릴 수 있으므로 그 부여 이력이 사고 조사의 1차 자료다(`0012` 보안·관측 기준선).
- **이 테이블은 운영자 권한을 실제로 요구하는 첫 endpoint와 같은 변경에서 만든다.** 지금은 그런
  endpoint가 없고, 읽지도 쓰지도 않는 표를 미리 만들면 권한 없는 표가 권한이 있는 것처럼 문서에 남는다.
- **운영자는 다른 수준의 상위집합이 아니다.** 운영자 권한은 수집 실행·mart 전환·워크스페이스 관리이며,
  자기가 구성원이 아닌 워크스페이스의 `BidWorkItem`이나 성적표를 읽을 수 없다. 지원 목적의 열람이
  필요해지면 별도 grant와 열람 로그를 같이 만드는 새 ADR을 쓴다.

### 4. 이번 인증 슬라이스의 범위

세운다:

- `/api/auth/*` 마운트와 Google·이메일 로그인, 세션 쿠키
- guard의 principal 해소와 `@Principal` param decorator
- `getCurrentSession`
- 내 등록 사업자 조회·등록과 사업자별 위치 저장
- 로그인 화면 하나, 첫 설정 화면 하나, sidebar 계정 허브

세우지 않는다(각각 별도 이슈):

- 랜딩·가격 등 `(marketing)` 분리와 `signup` 화면 분리 — EAT-48
- 성적표·회차별 결과·`findSupplierRecord`·`listSupplierAttempts` — EAT-40, EAT-65
- `BidWorkItem` 읽기·쓰기 — EAT-40
- 결제·구독 상태 — §10
- 운영자 UI와 `operator_grant` — §3
- 지도·좌표·행정코드 해석 — §8
- 기존 공개 read의 요구 수준 변경 — §5

### 5. 권한 수준과 endpoint·route 요구 표

수준 정의:

| 수준 | 판정 |
| --- | --- |
| `public` | 세션을 보지 않는다 |
| `provider_session` | 유효 provider 세션. app 관계를 전제하지 않는다 |
| `workspace_member` | principal 해소 성공 + 기본 워크스페이스 membership |
| `workspace_owner` | 그 membership의 `role = owner` |
| `registered_business` | 대상이 그 워크스페이스에 활성 등록된 `registered_business` |
| `subscription_active` | 유료 상태(§11에서 미룸) |
| `operator` | 회수되지 않은 `operator_grant` |

이번 변경이 추가하는 operation:

| operationId | method·path | 요구 수준 | 실패 |
| --- | --- | --- | --- |
| (Better Auth 전송) | `/api/auth/*` | `public` | provider 계약, 미설정 배포는 503 |
| `getCurrentSession` | `GET /api/v1/session` | `public` | 500·503 |
| `initializeCurrentAccount` | `POST /api/v1/me/initialization` | `provider_session` | 401·403·500·503 |
| `listMyBusinesses` | `GET /api/v1/me/businesses` | `workspace_member` | 401·403·500·503 |
| `registerMyBusiness` | `POST /api/v1/me/businesses` | `workspace_owner` | 400·401·403·409·500·503 |
| `setMyBusinessLocation` | `PUT /api/v1/me/businesses/{businessId}/location` | `workspace_owner` + `registered_business` | 400·401·403·404·500·503 |
| `clearMyBusinessLocation` | `DELETE /api/v1/me/businesses/{businessId}/location` | `workspace_owner` + `registered_business` | 400·401·403·404·500·503 |

`getCurrentSession`이 `public`인 것은 의도다. 미로그인에서 401을 던지면 진입 화면이 정상 흐름에서
오류를 렌더해야 한다. 세션 조회는 "너는 누구인가"의 답이지 보호 자원이 아니다. 그리고 **GET은 행을
만들지 않는다.** 워크스페이스 초기화는 §8의 명시적 저장 command에서만 일어난다.

**상태를 바꾸는 operation은 전부 403을 계약에 표현한다.** Origin 거절, 초기화 미완료, 남의 워크스페이스
자원, `owner` 권한 부족이 모두 403이다. 실제로 나오는 status를 계약이 숨기면 소비자가 처리할 수 없는
실패가 되고, 그것을 피하려고 401이나 500으로 바꾸면 화면이 잘못된 복구를 안내한다.

**등록과 위치 변경은 `owner`만 한다.** 조회는 `member`도 한다. 워크스페이스가 아직 없는 사용자는
§8의 초기화로 자기 워크스페이스의 `owner`가 되므로 첫 등록이 막히지 않는다. 이 판정은 use case 한
곳에 있고 화면이 버튼을 감추는 것으로 대신하지 않는다.

**기존 공개 read의 요구 수준은 §12가 `provider_session`으로 올린다.** 2026-09-04 초안이 `findAuction`,
`listOrganizationAuctionAttempts`, `findWinRateDistribution`, `listOpenAuctions`, `listCodes`를 `public`으로
남긴 이유는 "공개 관측 사실을 로그인 뒤로 숨긴다"가 무료/유료 경계를 함께 정해야 하는 제품 결정이라서였다
(§11). 2026-09-10 사용자 결정이 그 경계를 "전부 로그인 뒤"로 정했으므로 유보가 끝났다.

화면 route:

| route group | route | 요구 수준 | 미충족 시 |
| --- | --- | --- | --- |
| `(auth)` | `/login` | `public` | 이미 로그인이면 `next` 또는 `/today` |
| `(auth)` | `/setup` | `authenticated` | `/login?next=/setup` |
| `(workspace)` | `/today`, `/auctions/[auctionId]` | `workspace_member` | 쿠키 없음은 `/login?next=…`, 초기화 미완료는 `/setup?next=…`(§12) |
| 레거시 | `/s/[token]`, `/dashboard/**`, `/welcome` | 판정 대상 아님 | legacy disposition Gate에서 제거 |

등록된 사업자가 없는 로그인 사용자도 결정 화면은 그대로 열린다. 막히는 것은 사업자 축에 붙는
개인 자료(내 기록, 위치, 실제 내 투찰)뿐이다. 이유: 사업자 등록 전에도 공고 판단 재료는 볼 수 있어야
제품 가치를 확인하고 결제한다. 등록 없음과 초기화 미완료는 다른 상태다. 앞은 통과, 뒤는 `/setup`이다.

### 6. 인가 실패의 wire 표현

- 세션이 없거나 만료·로그아웃: `401`, `code: UNAUTHENTICATED`. 재로그인이 답이다.
- 세션은 유효하나 이 요청이 허용되지 않음: `403`, `code: FORBIDDEN`. 초기화 미완료, `owner` 권한 부족,
  남의 워크스페이스 자원, 신뢰하지 않는 `Origin`이 모두 여기다. 응답 본문은 넷 중 무엇인지 적지 않는다.
  어느 쪽인지는 `getCurrentSession`의 상태값이 말한다. 둘을 401 하나로 합치면 초기화 미완료 사용자가
  고칠 수 없는 로그인을 반복한다.
- 입력 형식 위반(사업자번호 형식 등): `400`, `code: VALIDATION_ERROR`.
- 같은 워크스페이스에 이미 활성 등록된 사업자: `409`, `code: CONFLICT`.
- 이 code들은 `packages/contracts/src/common/problem-details.ts`의 `problemCodeSchema`에 이미 있고
  `ProblemDetailsFilter`가 이미 매핑한다. 새 code를 만들지 않는다.
- **존재를 숨기려고 403을 404로 바꾸지 않는다.** 공고·기관·명단은 eaT 공개 사실이고,
  워크스페이스 자원은 ID가 bigint라 열거로 존재를 캐낼 실익이 없다. 대신 403 본문에 어떤 워크스페이스
  ·사업자인지 적지 않는다. `ProblemDetails`는 strict object라 추가 필드가 애초에 불가능하다.
- 로그인 만료로 401을 받은 web은 현재 경로를 `next`에 담아 `/login?next=<encodeURIComponent(경로)>`로
  보낸다. `next`는 같은 origin의 절대 경로만 허용한다. `/`로 시작하고, `//`나 `/\`로 시작하지 않으며,
  scheme·authority·개행 제어문자를 담지 않는 값만 통과시키고 그 외에는 기본 진입 경로로 대체한다.
  판정은 web과 auth callback 양쪽에서 같은 함수 하나를 쓴다. 열린 리디렉션을 만들지 않는다.
- 인증 실패 응답에도 `x-request-id`가 실린다. 로그에는 `principal_id`만 남기고 이메일·세션 토큰·쿠키·
  사업자등록번호를 남기지 않는다(`RedactingJsonLogger`, `runtime-and-deployment.md` §7).

### 7. 등록된 사업자는 내 분석 기준이지 소유권 증명이 아니다

사용자가 넣는 사업자등록번호는 **"내 화면의 기준을 이 사업자로 놓아 달라"**는 요청이다. 법적 소유권을
주장하거나 증명하는 행위가 아니다. 그러므로:

- **전역 배타 선점을 두지 않는다.** 2026-09-04 초안의 "`revoked_at is null`인 행에 대해
  `supplier_party_id` 부분 unique 인덱스를 걸고 선점 충돌은 409로 돌려주며 운영자가 해제한다"는
  규칙을 철회한다. 사업자등록번호는 공개 정보라 아무나 먼저 넣을 수 있고, 그러면 실제 사업자는
  가입 자체가 막힌 채 사람이 개입하는 해제 절차를 기다려야 한다. 공격자에게는 비용이 0이고
  피해자에게는 서비스 거부다. 그 규칙이 막으려던 열람 대상 — 개찰 명단과 낙찰 결과 — 은 애초에
  eaT 공개 사실이라 선점으로 지켜지는 비밀이 아니다.
- **활성 등록의 유일성은 워크스페이스 안에서만 강제한다.** `revoked_at is null`인 행에 대해
  `(workspace_id, business_number)` 부분 unique를 건다. 서로 다른 워크스페이스가 같은 번호를 등록하는
  것은 충돌이 아니다.
- **진짜 격리는 membership이 한다.** 비공개인 것은 워크스페이스가 작성한 자료(`BidWorkItem`, 위치, 메모)와
  그것으로 만든 파생물이며, 그 경계는 `workspace_membership`이다. 등록은 그 자료를 어느 사업자 축에
  붙일지의 라벨일 뿐이다. 남의 번호를 등록해도 남의 작성 자료는 보이지 않는다.
- **번호는 대조 키이지 식별자가 아니다.** 등록 입력은 문자열이지만 관계는 `supplier_party_id bigint`다
  (`AGENTS.md` 2항). 대조는 `eat:business-number` CodeScheme의 정확한 번호 일치 하나이며, 이름·유사도·
  부분 일치로 찾지 않는다. 소스가 표기를 보장하지 않으므로 숫자 표기와 하이픈 표기 두 값을 정확한
  값으로 열거해 대조한다. 이것은 표기 차이를 흡수할 뿐 일치 조건을 넓히지 않는다.
- **연결은 저장하지 않고 읽을 때 파생한다.** `app`에 `supplier_party_id`나 `linked_at`을 저장하면 나중에
  원본이 그 사업자를 처음 관측해도 저장된 `null`이 그대로 남아 영원히 미연결이 된다. 사용자 입력 등록은
  `app`의 권위이고 번호→`SupplierParty`는 `core`의 권위이므로, 조회가 그때의 `core` 사실로 연결을 만든다.
  background job도, GET에서의 `app` 쓰기도, 사용자 입력으로 만드는 `core` 행도 없다.
- **관측되지 않은 번호도 등록은 성공한다.** 대조 결과가 없으면 응답이 "아직 원본에서 관측되지 않았다"를
  명시한다. `core.supplier_party`나 `core.code_value`를 사용자 입력으로 만들지 않는다(`AGENTS.md` 1·3항).
  화면은 그것을 "참여 기록 없음"으로 바꿔 말하지 않는다. 자료 없음과 미참여는 다른 사실이다.
- **한 번호가 서로 다른 party 둘을 가리키면 연결을 고르지 않는다.** 원본은 사업자번호가 없던 계정과 있는
  계정을 자동 병합하지 않으므로(ADR 0033 §1) 같은 번호가 둘 이상의 party에 닿는 상태가 존재할 수 있다.
  하나를 고르면 남의 성적표를 내 것으로 붙이는 일이고, 미관측으로 낮추면 있는 증거를 감춘다. 조회는
  증거 불일치로 실패하고 그 회복은 `code_mapping`과 같은 급의 명시적 reconciliation이다.
- **활성 등록 수에는 상한이 있다.** 응답 계약의 배열 상한과 같은 값을 등록 시점이 강제하고, 그 검사는
  워크스페이스 행을 잠근 같은 트랜잭션 안에서 한다. 상한을 넘겨 저장하면 이미 저장된 정상 상태를
  그 다음 조회가 응답 검증에서 읽지 못한다.
- **검증 상태 열을 지금 만들지 않는다.** 어떤 권한도 승격시키지 않는 `verification_state`를 미리 두면
  값만 있고 절차가 없는 상태에서 그 값이 "검증됨"으로 읽힌다. 증빙 절차와 그 열은 절차를 정하는 이슈가
  같이 만든다.
- **형식 검증과 소유 증명을 구분한다.** 입력은 하이픈·공백을 걷어낸 숫자 10자리로 정규화하고 국세청
  체크디짓 규칙으로 오타를 거른다. 이것은 오타 차단이지 실재·소유 증명이 아니며 문서·화면·응답
  어디에서도 "확인된 사업자"로 부르지 않는다.

DDL(권위는 `packages/db`):

```text
app.registered_business(
  registered_business_id     bigint pk generated always as identity,
  workspace_id               bigint not null fk -> app.workspace,
  business_number            char(10) not null,          -- 정규화된 사용자 입력. 대조 키이지 식별자가 아니다
  registered_by_principal_id bigint not null fk -> app.principal,
  registered_at              timestamptz not null,
  revoked_at                 timestamptz null,
  unique (workspace_id, business_number) where revoked_at is null,
  check (business_number ~ '^[0-9]{10}$')
)

app.registered_business_location(
  registered_business_id  bigint pk fk -> app.registered_business,
  address_text            text not null,
  updated_at              timestamptz not null,
  updated_by_principal_id bigint not null fk -> app.principal,
  check (length(btrim(address_text)) > 0)
)
```

2026-09-04 초안의 `primary key (workspace_id, supplier_party_id)`와 저장된 `supplier_party_id`·`linked_at`·
`verification_state` 열을 없앤다. `core` 연결은 저장하지 않고 조회가 파생하며, 어떤 권한도 승격시키지 않는
`verification_state`는 값만 있고 절차가 없는 상태에서 "검증됨"으로 읽힌다. `businessId` path parameter는
대리키의 decimal string이며 사업자등록번호를 URL에 싣지 않는다. 요청 경로는 접근 로그와 referrer에 남는다.

한 워크스페이스는 여러 사업자를 등록할 수 있다(`product-and-quality.md` §1의 다사업자 운영).
인가 판정의 단위는 `Workspace × registered_business`다. `BidWorkItem`의 grain은
`domain-and-data.md` §3.5의 `unique(workspace_id, supplier_party_id, auction_attempt_id)`를 따르며
`pages-endpoints-load.md`가 적은 `PK (workspace_id, attempt_id)`와 다르므로 그 계약을 만드는 EAT-40이
한쪽으로 맞춘다. 미연결 등록에는 `supplier_party_id`가 없으므로 `BidWorkItem`은 연결된 등록에만 붙는다.

### 8. 첫 사용자는 조직을 만들지 않는다

혼자 쓰는 사용자에게 "조직 이름을 정하세요"를 먼저 묻지 않는다. 그 화면은 이 제품에서 아무 정보도
얻지 못하면서 가입을 한 단계 늘린다. 동시에 워크스페이스 관계 자체는 유지한다. 구성원 1~2명과
다사업자는 실제 요구사항이고, 나중에 도입하려면 이미 저장된 자료의 소유자를 옮겨야 한다.

- `initializeCurrentAccount`는 하나의 트랜잭션에서 principal·identity와 개인 워크스페이스·`owner`
  membership·기본 워크스페이스 관계를 만든다. 여러 번 불러도 같은 관계를 돌려준다.
- 새 워크스페이스의 `name`은 사용자에게 묻지 않고 서버가 정한 초기값을 넣는다. 이름 변경은 owner의
  나중 선택이지 가입 조건이 아니다.
- **기본 워크스페이스 관계를 따로 둔다.**

  ```text
  app.principal_default_workspace(
    principal_id   bigint pk fk -> app.principal,
    workspace_id   bigint not null fk -> app.workspace,
    initialized_at timestamptz not null
  )
  ```

  동시 초기화가 워크스페이스를 둘 만들지 않게 하는 데 필요한 것은 이 관계의 PK 하나다. `membership`에
  `(principal_id) where role = 'owner'` 전역 unique를 거는 대신 이 표를 쓰는 이유는, 그 제약이 경쟁 방지가
  아니라 "한 사람은 한 워크스페이스의 owner"라는 도메인 권한 제한이 되어 초대와 다중 소유를 미리 막기
  때문이다. 경쟁에서 진 트랜잭션은 통째로 되돌아가므로 주인 없는 워크스페이스도 남지 않는다.
- 같은 번호를 두 번 등록하면 `(workspace_id, business_number)` 부분 unique가 막고 `409 CONFLICT`가 된다.
  애플리케이션 선검사로만 막지 않는 이유는 두 트랜잭션이 서로의 미커밋 행을 보지 못하기 때문이다.

**위치는 사용자가 직접 쓰는 app 상태다.** DDL은 §7의 `app.registered_business_location`이다.

- 미설정은 **행이 없는 것**이다. 빈 문자열이나 기본 지역을 넣지 않는다(`AGENTS.md` 3항).
- 저장하는 것은 사용자가 적은 주소 문장 하나뿐이다. 행정구역 코드 열도 좌표 열도 지금 만들지 않는다.
  열이 있으면 언젠가 문자열을 파싱해 채우게 되고, 그 순간 추측이 `core`와 같은 급의 사실처럼 보인다.
  `AGENTS.md` 6항의 지역 코드 체계 분리는 명시적 매핑을 요구하며 주소 문장은 그 매핑이 아니다.
- 주소 검색·지도 위 점은 정확한 좌표 출처를 확인한 뒤 별도 이슈에서 열을 추가한다. 그때까지 이 값으로
  eaT 참가제한지역 자격을 판정하거나 사업장 소재지를 추정하지 않고 GPS를 요구하지 않는다.
- 위치는 등록된 사업자별로 소유한다. 워크스페이스에 매달면 다사업자 사용자의 서로 다른 사업장이 한
  값으로 섞인다.
- 소유 확인·쓰기·응답 조회는 한 트랜잭션이고 응답 조회는 그 등록 하나로 좁힌다. 나누면 다른 등록의
  증거 불일치가 이미 커밋된 변경을 사용자에게 실패로 보이게 만든다.

### 9. 세션 수명주기와 브라우저 경계

- **CSRF**: 상태를 바꾸는 요청은 `POST`/`PUT`이고 `SameSite=Lax` 쿠키는 cross-site 상태 변경 요청에
  실리지 않는다. 그 위에 Nest guard가 상태 변경 method에 대해 `Origin` 헤더를 확인하고 허용 목록과
  정확히 일치하지 않으면 `403`으로 끊는다. 허용 목록은 이미 있는 `CORS_ORIGINS` 환경 계약 하나를
  재사용하고 별도 목록을 만들지 않는다. `Origin`이 아예 없는 상태 변경 요청도 거부한다.
- **계정 연결을 자동으로 하지 않는다.** provider가 검증했다고 말하는 이메일을 그대로 믿고 계정을 합치면
  provider 쪽 이메일 변경이 곧 계정 탈취 경로가 된다. `accountLinking`을 끄고 암묵 연결도 막는다.
  두 번째 provider가 생기면 같은 사람이 다른 방법으로 로그인할 때 다른 principal이 되며, 명시적 연결
  기능은 재인증 요구와 함께 별도 이슈에서 만든다.
- **로그아웃**은 Better Auth의 세션 무효화를 먼저 부르고, 성공했을 때만 브라우저에 남은 계정 답을
  버린다. 버리는 범위는 개인 응답 하위 트리 전체와 세션 응답이다. 개인 자료는 규칙상 그 하위 트리
  아래에만 두므로 이 범위가 곧 "남은 개인 자료 없음"이고, 개인 자료가 없는 공개 read 캐시까지 지우면
  로그아웃이 느려질 뿐 안전해지지 않는다. 세션 답을 남기지 않는 이유는 provider 상태가 화면에 닿기
  전까지 이전 계정의 이름과 워크스페이스가 계속 보이기 때문이다. provider 호출이 실패하면 화면은
  로그아웃됐다고 말하지 않는다. 그 뒤 단계가 실패하면 로그아웃 여부를 확인하지 못했다고만 말한다.
  legacy localStorage는 새 경로가 읽지도 쓰지도 않으므로 지우지 않는다. 남의 PC에서 남의 기록이 섞이는
  경로를 만들지 않기 위해 로그인 시 기존 브라우저 로컬 기록을 계정으로 이전하지 않는다.
- **계정·사업자 전환에서 개인 자료 캐시를 섞지 않는다.** 사용자별 응답의 query key에는 `workspaceId`와
  `businessId`를 포함하고, 세션 principal이 바뀌면 캐시를 비운다. 선택된 사업자는 URL 상태로 두되
  세션 응답의 등록 목록에 없는 값이면 무시하고 기본값으로 돌아간다. URL은 공유·복원의 권위이지
  권한의 권위가 아니다.
- **전환은 provider가 관측한 주체로 알아채고 세션 query key로 표현한다.** "로그인했는가"라는 boolean은
  다른 탭에서 A가 나가고 B가 들어온 전환을 알아채지 못한다. 그래서 provider 사용자 id를 marker로 읽어
  세션 응답의 key 마지막 자리에 담는다. 캐시 항목이 갈라지므로 전환된 렌더가 곧 "아직 모른다"이고,
  이전 계정의 답이 남아 있는 중간 상태도 늦게 도착한 이전 계정의 응답도 새 화면에 닿지 못한다.
  이 값은 전환 감지에만 쓰며 app principal·워크스페이스의 권위는 세션 응답 union이 그대로 소유한다.
  세션 갱신마다 바뀌는 세션 id나 토큰은 marker로 쓰지 않는다. 갱신을 전환으로 오인한다.
  전환 처리는 세션 hook 하나가 소유하고 소비자별로 다시 만들지 않는다. 소비자마다 만들면 같은
  전환에서 화면끼리 다른 계정을 본다.
- **로그인 흐름은 보던 화면을 잃지 않는다.** 공고를 보다 로그인·설정으로 간 사용자는 같은 공고로
  돌아온다. 복귀 경로는 `next` query parameter 하나로 옮기고, 같은 앱의 상대 경로인지 판정하는 곳은
  `shell/auth/return-path` 하나다. 로그인만 끝난 사용자를 설정으로 보낼 때도 그 값을 이어 나른다.
  사업자등록번호처럼 사용자 자료를 이 parameter에 담지 않고 외부 origin으로는 열지 않는다.
- **다른 워크스페이스 ID를 넣은 요청**은 membership 조회 실패로 `403`이다. 응답 본문은 그 ID가 존재하는지
  말하지 않는다.
- **테스트용 대역은 주입 경계에만 둔다.** 서버는 이미 `createApp`이 port를 주입받는 구조이므로 같은
  방식으로 session authenticator를 주입한다. 환경변수나 헤더로 인증을 건너뛰는 분기를 production 코드에
  만들지 않는다. `NODE_ENV`를 보는 auth bypass는 한 번의 배포 설정 실수로 전면 개방이 된다.

### 10. provider schema conformance

- 표·열·index·참조는 pinned `auth` CLI generator가 **같은 adapter 설정으로** 만든 결과와 대조한다.
  `schemaName`·`camelCase`를 생성 전용 기본값으로 두면 검사는 통과하는데 실제 배포되는 표와 다른 모양을
  검증하게 되므로, runtime과 생성이 같은 adapter option 객체 하나를 읽는다.
- 대조는 byte 비교가 아니라 구조 비교다(ADR 0018). 생성 결과를 평가해 양쪽 모두 같은 Drizzle
  `getTableConfig`로 정규화한 뒤 물리 table 이름, adapter가 접근하는 property key, 물리 열 이름,
  JavaScript 매핑, PostgreSQL 타입, not null, primary key, 참조 대상과 `onDelete`, index를 비교한다.
- generator 결과와 다르게 둘 값은 정확한 예외 목록에만 적는다. 지금 둘은 두 가지다. 밀리초 epoch 열은
  물리 타입이 같은 bigint를 유지하되 JavaScript number mode를 쓰지 않고, 시각 열은 timezone을 갖는다.
  목록에 없는 차이는 전부 실패이고, 목록에 있는데 실제 차이가 사라진 항목도 실패로 드러낸다.
- 이 검사는 DB 연결도 비밀값도 요구하지 않는다. 검사 자체가 drift를 잡는지는 표 누락·이름 변경·property
  이름 변경·primary key 제거·타입 축소를 각각 실패시키는 테스트가 증명한다.

### 11. 구독 상태는 이 ADR이 정하지 않는다

`subscription_active`는 **판정 지점만** 여기서 정하고 상태의 저장·결제 연동·요금제 정의는 별도 ADR로
미룬다. 구현은 `SubscriptionPolicy` port 하나를 두고, 그 ADR이 나오기 전까지는 모든 로그인 principal에
대해 참을 돌려준다. 그래야 요금제가 정해질 때 바꿀 곳이 한 군데다. 이 port를 통과하지 않는 곳에
"무료/유료" 분기를 흩어 놓지 않는다. 이번 슬라이스는 이 port도 만들지 않는다. 분기가 아직 없기 때문이다.

### 12. 화면은 로그인해야 열리고 세션 확인은 요청마다 저장소를 읽지 않는다

**판정은 세 겹이고 권위는 한 겹이다.** 겹이 셋인 이유는 각 자리가 답할 수 있는 질문이 다르기 때문이지
같은 판정을 세 번 하려는 것이 아니다.

1. `proxy.ts`는 provider 세션 쿠키가 있는지만 본다. 없으면 `/login?next=<현재 경로>`로 보낸다. 서버에
   물어보지 않는 이유는 그 왕복이 모든 화면 요청에 하나씩 붙어 게이트 자체가 부하가 되기 때문이다.
   여는 경로를 적는 목록으로 판정해 새 업무 route가 기본으로 공개되지 않게 한다. 열려 있는 것은
   `/login`, `/setup`과 화면이 아닌 표면(`/api`, `/internal`, Sentry tunnel)뿐이다.
2. `(workspace)/layout.tsx`의 Suspense 안 loader가 `getCurrentSession`을 읽어 `unauthenticated`는
   `/login`, `uninitialized`는 `/setup`으로 보낸다. 쿠키는 "app 계정 초기화가 끝났는가"를 답할 수
   없으므로 이 판정은 계약을 읽는 자리에만 둘 수 있다. loader는 화면을 그리지 않고 자식과 나란히 서서
   page가 가진 static shell을 dynamic 경계 안으로 끌어들이지 않는다(`0028` 2항). 자식 page가 이 판정보다
   먼저 렌더를 시작할 수 있다는 §1의 사실은 그대로이며, 그때 데이터가 새지 않는 이유도 그대로 3번이다.
   복귀 경로는 layout이 자기 URL을 받지 못하므로 proxy가 요청 헤더로 실어 주고, 받는 쪽이
   `shell/auth/return-path`로 한 번 더 판정한다. 열린 리디렉션 판정 자리는 여전히 그 파일 하나다(§6).
3. **권위는 Nest guard다.** `listOpenAuctions`, `findAuction`, `getAuctionRoster`,
   `listOrganizationAuctionAttempts`, `findWinRateDistribution`, `listCodes`의 요구 수준을
   `provider_session`으로 올리고 계약의 `problemResponses`에 401을 선언한다. guard는 controller class에
   붙인다. handler마다 붙이면 새 handler 하나가 decorator를 빠뜨려 조용히 공개된다.

**이 여섯에 403을 만들지 않는다.** 요구 수준이 `provider_session`이므로 app 계정 초기화 여부를 보지
않는다. 초기화 미완료 사용자를 API에서 막으면 화면이 `/setup`으로 안내할 재료를 API 실패에서 다시 꺼내야
하고, 그 판정은 이미 세션 계약이 상태로 말한다.

**세션 쿠키 캐시를 켠다.** 게이트와 캐시는 한 쌍이다. 게이트를 세우면 화면 진입마다 세션 확인이 하나씩
늘고, 캐시가 없으면 그 확인이 그대로 DB 조회가 된다. `session.cookieCache`를 60초로 켜고 서버 검증에서
`disableCookieCache`를 뺀다. 서명된 사본이 실린 요청은 저장소를 읽지 않는다.

- 사본은 provider secret으로 서명되므로 브라우저가 고쳐 통과할 수 없고, 세션 토큰 쿠키가 없으면 사본
  단독으로는 주체가 되지 않는다.
- 대가는 회수된 세션이 최대 60초 더 통과한다는 것이다. 자기 로그아웃은 지연되지 않는다. 브라우저 POST가
  세션 쿠키와 사본을 함께 즉시 무효화하기 때문이다(§9). 남는 것은 "다른 기기에서 회수했을 때"의 60초다.
- 사본을 채우는 것은 서버 간 검증이 아니라 브라우저가 부르는 provider 세션 hook이다. 서버 검증은
  `disableRefresh`로 읽기만 하므로 `Set-Cookie`를 만들지 않고, 만들어도 그 헤더는 RSC 경로에서 버려진다.
  즉 사본 수명은 화면이 provider hook을 마운트하고 있다는 사실에 기대며, 그 hook은 §1이 이미 요구한다.
- 60초는 취소 반영 지연의 상한이다. 늘리면 회수가 늦어지고, 줄이면 저장소 조회가 늘어난다.

**앱 표면은 색인을 거부한다.** proxy가 통과·리디렉션 응답 모두에 `X-Robots-Tag: noindex, nofollow`를
붙인다. 사이트가 검색되는 것과 공고 데이터가 검색되는 것은 다른 일이고, 지금 이 앱에는 검색돼야 할
화면이 없다. 붙이는 자리를 게이트와 같게 두는 이유는 "무엇이 화면 표면인가"라는 같은 목록을 두 번
적지 않기 위해서다.

**틀렸을 때 비용.** 게이트만 세우고 캐시를 켜지 않으면 로그인 도입이 곧 DB 부하 증가로 나타나고, 그
증상은 인증 결함이 아니라 성능 문제로 보여 원인을 찾기 어렵다. 반대로 캐시만 켜고 게이트를 세우지
않으면 공고 데이터가 계속 공개된 채로 남는다.

## Consequences

- 게스트 모드가 사라진다. `apps/web/src/lib/session.ts`의 localStorage 진실 원천과
  `/api/me/*` PUT 동기화 경로는 legacy disposition 대상이 된다. 이 ADR은 자동 이전을 허용하지 않는다.
- 요청마다 조회 2회가 늘어난다. 피크 3 req/s 가정에서 무시할 수 있는 비용이며, 줄이려고 provider
  세션 테이블에 `principal_id`를 심는 것은 `0018` conformance gate가 막는다. §12의 쿠키 캐시가 그중
  세션 조회 1회를 사본 수명 동안 없앤다. `identity_subject` 조회 1회는 남는다.
- 세션 의존 함수는 `use cache`를 쓰지 못한다. `mart` 기반 집계만 태그 캐시의 이득을 본다.
- 자동 계정 연결을 끈 대가로, 두 번째 provider가 생기면 같은 사람이 두 계정을 가질 수 있다. 그 대신
  provider 이메일 변경이 탈취 경로가 되지 않는다.
- 세션 갱신이 브라우저 POST에만 있으므로 web은 그 갱신을 실제로 호출해야 한다. 서버 조회만 반복하는
  화면은 세션을 연장하지 못하고 만료 시점에 로그아웃된다. 이 경계는 화면 연결 작업이 닫는다.
- 인증 설정이 없는 배포에서 `/api/v1/session`과 `/api/auth/*`가 503이고, §12 이후에는 공유 read도 503이다.
  로그인할 수 없는 배포에서 업무 화면을 여는 방법은 없다는 뜻이며, 그것이 "미로그인"과 구분돼야 하므로
  401이 아니라 503으로 남는다. 인증을 켜지 않은 로컬·검사 실행은 `createApp`의 authenticator 주입 지점을
  쓴다. 환경변수나 헤더로 guard를 건너뛰는 분기는 만들지 않는다(§9).
- 브라우저로 화면을 검사하는 스위트는 로그인 상태에서 시작해야 한다. fixture 세션 쿠키와 세션 계약
  응답을 support fixture가 소유하고, 게이트 자체를 검사하는 스위트만 그 상태를 비운다.
- 권한 매트릭스가 문서와 guard 테스트 양쪽에 있으므로 둘이 어긋나면 테스트가 먼저 깨진다. 표의 한 줄을
  바꾸는 변경은 이 ADR과 테스트를 같이 고쳐야 한다.
- **잘못됐을 때 비용:** 인가 판정이 endpoint마다 흩어지면 새 계약 하나가 남의 워크스페이스 작성 자료를
  여는 사고가 나고, 그 사고는 로그에 정상 200으로 남아 사후에 찾기 어렵다.

## Rejected alternatives

- **사업자번호 전역 배타 선점**: 2026-09-04 초안의 결정이며 §7에서 철회했다. 공개 정보에 대한 선착순
  잠금은 방어가 아니라 서비스 거부이고, 지키려던 대상은 이미 공개 사실이다.
- **미관측 번호의 등록을 거부한다**: 사용자는 자기 번호가 왜 거부됐는지 알 수 없고, 수집이 아직 닿지
  않은 지역·기간의 사업자가 제품을 쓸 수 없다. 미연결 상태를 그대로 보존하고 말하는 편이 정확하다.
- **첫 로그인에서 워크스페이스를 자동 생성한다(GET 포함)**: 안전해야 할 세션 조회가 행을 만들게 되고,
  둘러보기만 한 사용자에게도 빈 워크스페이스가 쌓인다. 첫 저장 command 하나가 만드는 편이 낫다.
- **web middleware(`proxy.ts`)에서 세션을 검증한다**: 요청마다 세션 계약 왕복이 붙어 게이트 자체가
  부하가 되고, 헤더 조작 우회 전례(CVE-2025-29927)가 있어 단독 인가 지점으로 부적합하다. 무엇보다
  API 권위가 Nest에 있는데 인가 판정만 web에 두면 진실 원천이 둘이 된다. §12가 여기 두는 것은 검증이
  아니라 네트워크를 부르지 않는 쿠키 유무 판정이며, 그 결과로 열리는 화면도 Nest guard 앞에서는
  401을 받는다.
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
- **위치에 좌표·행정구역 코드 열을 미리 둔다**: 채울 출처가 없는 열은 결국 주소 문장 파싱으로 채워지고,
  그 추측이 `core`의 지역 사실과 같은 자리에 앉는다. 출처가 생길 때 열도 같이 만든다.
