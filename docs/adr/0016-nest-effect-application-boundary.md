# 0016 — NestJS application shell과 Effect 실행 경계

- Status: Accepted
- Date: 2026-08-30
- Supersedes: 없음

## Context

`apps/server`는 현재 1,000줄이 넘는 root module 안에서 controller, SQL, cache, 인증,
응답 조립을 함께 수행한다. bootstrap은 환경 설정을 직접 읽고, CORS를 무제한으로 열며,
구조화 로그·OpenAPI·health·종료 처리가 없다. 이 구조에 Effect, Swagger, guard,
interceptor를 단순 추가하면 책임 경계가 생기는 대신 두 번째 추상화 층만 늘어난다.

NestJS 12는 Standard Schema 기반 요청 검증·응답 직렬화·OpenAPI projection과 구조화
logger를 framework 경계로 제공한다. 한편 Effect는 예상 가능한 실패와 retry/timeout/concurrency를
값으로 다루는 데 유용하지만, Nest DI와 Effect Layer를 동시에 애플리케이션 전역 컨테이너로
운영하면 provider 소유권과 resource lifecycle이 이중화된다. Drizzle v1 release lane의 native
Effect adapter도 Effect 4 계열을 요구하며 아직 foundation의 필수 경계로 채택할 만큼 안정화되지
않았다.

## Decision

### Runtime ownership

- NestJS는 HTTP adapter, dependency injection, application bootstrap/shutdown과 provider lifecycle의
  유일한 소유자다.
- domain은 Nest, Effect, Drizzle, HTTP를 import하지 않는 순수 TypeScript다.
- application use case는 Nest provider로 주입되고 완전히 의존성이 제공된
  `Effect<Output, ApplicationError, never>`를 반환할 수 있다.
- 하나의 singleton `EffectRunner`만 Effect를 Promise로 실행한다. Controller, guard, repository가
  `Effect.runPromise`를 직접 호출하지 않는다.
- foundation에서는 Effect Layer/ManagedRuntime을 두 번째 DI container로 사용하지 않는다. Effect가
  서버의 주 runtime이 될 측정 근거가 생기면 별도 ADR로 재검토한다.
- 2026-08-30 compatibility candidate `effect@4.0.0-rc.112`를 정확히 고정하고 spike를 통과한 뒤
  도입한다. RC 변경은
  일반 semver range로 자동 수신하지 않는다. stable 4가 나오면 migration note와 전체 gate를 확인한
  별도 dependency change로 올린다.

### Module and dependency direction

각 bounded module은 필요한 계층만 만들며 다음 방향만 허용한다.

```text
presentation/http -> application -> domain
                         |
                         v
              infrastructure/drizzle
```

- Controller는 wire input을 받고 한 use case를 호출해 wire output을 반환한다.
- application은 orchestration, authorization policy 호출, transaction boundary를 소유한다.
- domain은 entity/value/policy/error를 소유한다.
- infrastructure는 Drizzle repository와 외부 adapter를 구현한다.
- root `AppModule`은 platform/feature module을 import만 한다. provider, route, SQL을 직접 정의하지 않는다.
- module public application interface가 아닌 다른 module의 controller, repository, 내부 파일을 import하지
  않는다.

### Drizzle boundary

- `packages/db`만 Drizzle schema와 migration을 소유한다.
- `drizzle-orm/zod`는 실제 repository의 DB row/insert/update 경계에서만 사용할 수 있다. DB schema나
  inferred row를 HTTP DTO로 노출하지 않는다.
- repository는 목적별 interface를 구현한다. generic `BaseRepository`와 controller의 query builder 접근을
  금지한다.
- transaction은 명시적 `UnitOfWork.run(callback)` 경계로 전달한다. 숨은 AsyncLocalStorage transaction과
  함수 내부의 임의 nested transaction을 기본값으로 만들지 않는다.
- native `drizzle-orm/effect-postgres`와 `@effect/sql-pg`는 foundation에서 보류한다. 초기 adapter는
  `postgres-js`/Drizzle Promise를 typed Effect로 한 번 감싸고 DB 오류를 좁은 repository error로 번역한다.

### HTTP cross-cutting concerns

- middleware: request/correlation ID와 raw transport concern만 담당한다.
- pipe: Nest 12 Standard Schema와 Zod 4로 param/query/body를 검증·변환한다.
- guard: authentication, workspace membership, role/permission만 결정한다.
- interceptor: route-template 기반 요청 완료 로그, timing, response schema serialization, 명시적
  idempotency 같은 전후처리만 담당한다.
- exception filter: typed application error, `HttpException`, 예상하지 못한 defect를 RFC 9457
  `application/problem+json`으로 변환한다.
- validation, authorization, business rule, error mapping을 controller마다 복제하지 않는다. guard나
  interceptor 안에 업무 command/query를 숨기지 않는다.

### Contract, operations, and security baseline

- 새 canonical API는 URI versioning을 사용해 `/api/v1` 아래에 둔다. health와 Better Auth transport
  endpoint는 version-neutral이다.
- HTTP authority는 `packages/contracts`의 bounded Zod 4 schema다. Nest 12 native Standard Schema를
  사용하고 `nestjs-zod`는 제거한다.
- 첫 artifact는 Nest의 공식 Zod converter가 실제로 생성·검증하는 OpenAPI 3.0.3으로 고정한다.
  문서 필드만 3.1로 바꾸지 않는다. 3.1은 native emission/conformance가 증명된 뒤 별도 변경한다.
- deterministic `openapi.json`, stable `operationId`, request/response/error examples와 artifact diff test를
  둔다. Swagger UI는 개발 환경에서만 기본 활성화하며 운영에서는 비활성 또는 별도 인증한다.
- `@nestjs/config`가 Zod Standard Schema로 시작 시 환경을 검증한다. production에는 database URL,
  auth secret, origin의 fallback이 없다. bootstrap/config module 밖의 `process.env` 접근을 금지한다.
- Nest 12 built-in JSON logger를 우선 사용한다. Authorization, Cookie, share token, 사업자 식별정보,
  request/response body, raw query string은 기본 로그 대상이 아니다.
- Helmet, exact-origin credentialed CORS, 정확한 proxy trust, payload limit, Better Auth trusted origin/secure
  cookie/CSRF와 선택 endpoint throttling을 적용한다. 현재 Nest 12 peer를 선언하지 않는
  `@nestjs/throttler`를 override 설치하지 않는다.
- `/health/live`는 process 생존만, `/health/ready`는 PostgreSQL과 기대 migration version만 확인한다.
  현재 Nest 12 peer를 선언하지 않는 `@nestjs/terminus` 대신 작은 명시적 health module로 시작한다.
  source/R2/dataplane 상태를 server readiness에 넣지 않는다. shutdown hook은 readiness를 먼저 내리고
  DB client를 닫는다.

## Consequences

- Effect의 typed failure와 동시성 도구를 사용하면서도 Nest와 resource ownership을 이중화하지 않는다.
- controller 수와 파일 수는 늘 수 있지만 각 파일의 변경 이유와 dependency direction이 명확해진다.
- 기존 endpoint는 한 번에 재작성하지 않고 `LegacyApiModule`에 격리할 수 있다. 새 기능과 dual-write는
  legacy module에 추가하지 않으며 canonical API가 같은 기능을 대체한 뒤 삭제한다.
- OpenAPI 3.1과 Effect/Drizzle native adapter를 당장 쓰지 않는 대신, 검증된 공식 Nest 12 경계와
  현재 release-lane의 설치 일관성을 우선한다.
- Nest 12 CLI가 지원하는 exact Node 24 LTS patch로 CI/container/dev runtime을 맞춰야 한다.

## Rejected alternatives

- Effect Layer와 Nest provider를 모두 전역 DI로 사용: ownership과 shutdown 순서가 모호해진다.
- Effect를 controller decorator처럼 전면 노출: HTTP framework와 application semantics가 결합된다.
- controller에서 Drizzle 직접 호출: transaction, tenant policy, error translation이 route마다 복제된다.
- 모든 기능에 CQRS/event bus/microservice 도입: 현재 workload에 비해 ceremony와 failure mode가 크다.
- Nest 12와 peer range가 맞지 않는 logging/auth wrapper 강제 도입: foundation부터 unsupported 조합이 된다.
- OpenAPI 문서의 version만 3.1로 변경: 실제 schema dialect와 artifact가 일치하지 않는다.
