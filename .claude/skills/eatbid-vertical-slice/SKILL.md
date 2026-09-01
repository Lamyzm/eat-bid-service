---
name: eatbid-vertical-slice
description: versioned API, 서버 module, database adapter와 선택적 Next.js consumer를 가로지르는 Eatbid 첫 기능 또는 다음 end-to-end 기능을 추가할 때 사용한다.
---

# Eatbid 수직 슬라이스

기존 modular monolith 경계를 따라 관측 가능한 사용자 동작 하나를 전달한다. 빈 계층을 미리 만들거나 인접 모델을 추측으로 재설계하지 않는다.

## 좁게 시작하기

1. root `AGENTS.md`, `ARCHITECTURE.md`와 관련 아키텍처 절을 읽는다.
2. mutation 전에 Linear issue, 현재 lease와 의도한 owned path를 확인한다.
3. 입력 하나, 성공 결과 하나와 예상 실패 상태를 적는다.
4. 파일이나 dependency 이름을 정하기 전에 가장 가까운 기존 slice를 추적한다.

동작이 아키텍처 경계를 바꾸면 먼저 멈추고 관련 ADR을 갱신하거나 supersede한다.

## 권위에서 adapter 순서로 구현하기

동작에 필요한 단계만 사용한다.

1. **공개 계약** — `packages/contracts`에 versioned Zod request/response와 안정적인 operation metadata를 정의한다. bigint ID는 범위가 제한된 decimal string으로 인코딩하고 입력과 출력을 모두 검증한다.
2. **Domain/application** — 실제 불변식을 소유할 때만 framework-free identity나 policy를 추가한다. 목적별 port와 use case를 정의하고 예상 가능한 실패를 typed error로 만든다. 내부 record는 DB row도 HTTP DTO도 아니다.
3. **Infrastructure** — Drizzle로 port를 구현한다. driver type과 row mapping은 adapter 안에 둔다. 권위 있는 `core`/`mart` 사실만 조회하고 누락된 provenance나 `unknown` 값을 만들어내지 않는다.
4. **Presentation** — Nest controller는 parse, 경계 변환, `EffectRunner`를 통한 단일 use case 호출, response schema serialization, Problem Details error mapping만 담당한다.
5. **Composition/OpenAPI** — 두 번째 runtime이나 transport를 만들지 않고 Nest module과 결정적인 OpenAPI artifact를 연결한다.
6. **Web consumer(요청된 경우)** — export된 Zod schema로 server JSON을 검증하고 안정적인 TanStack `queryOptions`를 노출하며 ID를 문자열로 유지한 뒤 loading/error/unknown/success 상태를 명시적으로 render한다.

## 지름길 금지

- `InferSelectModel`, Drizzle row, application record를 공개 DTO로 노출하지 않는다.
- 반복 필요가 입증되기 전에 generic repository, 형식적인 CQRS class, custom query hook, barrel, 새 module을 만들지 않는다.
- Next Route Handler proxy를 두 번째 API 진실 원천으로 추가하지 않는다. Nest API를 사용하고 same-origin proxy가 필요하면 별도 platform 결정으로 다룬다.
- 측정된 필요 없이 Kafka, microservice, cache, search service, scheduler를 추가하지 않는다.
- organization subtype, label, address, composite string을 identity로 만들지 않는다.

## 완료 전 증거

계약 edge case, domain 불변식, use-case 성공·실패, 필요한 PostgreSQL adapter mapping, Nest HTTP와 Problem Details, OpenAPI drift, 실제 web 상태 전환을 테스트한다. 테스트 제목은 한글 음절을 포함해야 한다.

좁은 테스트부터 실행한 뒤 `pnpm architecture:check`, `pnpm test:quality`, `pnpm contracts:check`, `pnpm contracts:python:check`를 실행한다. 영향받는 package의 typecheck, lint, build도 추가한다.
