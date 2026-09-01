---
name: effect-ts
description: typed failure, Promise 경계, retry, timeout, cancellation, concurrency 또는 Effect 4 API를 포함해 apps/server의 Effect 코드를 작성·검토·디버깅할 때 사용한다.
license: MIT
metadata:
  source: Effect-TS/skills
  adapted-for: eat-bid-service
---

# Eatbid 서버의 Effect

Nest를 application owner로 유지하면서 설치된 Effect version을 API 권위로 사용한다.

## 필수 읽기

Effect 코드를 변경하기 전에 다음을 수행한다.

1. `apps/server/node_modules/effect/AGENTS.md`를 끝까지 읽고 현재 작업에 필요한 topic만 따라간다.
2. `docs/adr/0016-nest-effect-application-boundary.md`와 `docs/architecture/backend-application-foundation.md`의 관련 절을 읽는다.
3. API가 여전히 불명확하면 `apps/server/node_modules/effect/src` 또는 `dist/*.d.ts`를 검색한다. 다른 Effect release의 예시를 기억에 의존해 적용하지 않는다.

일반 Effect guidance와 저장소 ADR이 다르면 저장소에서 승인된 ADR이 우선한다.

## Eatbid 경계

- Nest가 dependency injection, lifecycle, configuration, transaction, composition을 소유한다.
- Effect는 typed expected failure, 제한된 retry, timeout, cancellation, concurrency를 위한 application-layer execution model이다.
- application use case는 `Effect.Effect<Output, ApplicationError, never>`를 반환할 수 있다.
- singleton `EffectRunner`만 Effect를 Promise로 변환한다. Controller, guard, repository, adapter는 `Effect.runPromise*`를 직접 호출하지 않는다.
- domain code는 framework-free로 유지한다. Repository port는 목적별 Promise 기반으로 두고 use case에서 Promise를 Effect로 한 번만 변환한다.
- 새 ADR이 현재 경계를 대체하지 않는 한 Nest/Drizzle/Zod 옆에 global `Layer`, `ManagedRuntime`, Effect service graph, Effect SQL, Effect HttpApi를 도입하지 않는다.

## Retry와 timeout 점검표

다음 조건을 모두 만족할 때만 retry한다.

- 연산이 idempotent다.
- 실패가 transient로 명시적으로 typed되어 있다.
- 시도 횟수와 전체 deadline이 제한되어 있다.
- 지원되는 경우 `AbortSignal`을 통해 cancellation이 실제 I/O까지 전달된다.

계약 위반, authorization·configuration 실패, unknown defect 또는 모든 database error를 retry하지 않는다. `catchAll`로 defect를 business failure처럼 숨기지 않는다.

조합하기 전에 설치된 `Effect.tryPromise`, `Effect.retry`, `Schedule`, `Effect.timeoutOrElse` signature를 확인한다. 한국어 테스트 제목으로 retry 횟수, permanent failure short circuit, deadline, cancellation, defect 보존을 검증한다.

## 완료 검사

좁은 server 테스트부터 실행한 뒤 `pnpm architecture:check`와 `pnpm test:quality`를 실행한다. 계약 변경이면 root `AGENTS.md`가 지정한 contract check도 수행한다.
