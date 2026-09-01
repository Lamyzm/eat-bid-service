---
name: eatbid-contract-change
description: Eatbid의 식별자, 시간, 금액, 비율, 수량, 출처 필드, canonical ingestion payload, 공개 API 형태 또는 데이터베이스 표현을 추가하거나 변경할 때 사용한다.
---

# Eatbid 계약 변경

모든 사실은 그 사실을 소유하는 권위에서 변경한다. 호환성부터 확인하지 않은 채 범용 모델을 만들거나 버전 상승을 추측하지 않는다.

## 편집 전 분류

다음을 먼저 적는다.

- 원천 관측값과 정확한 누락·빈 값·잘못된 값 형태
- 업무 의미와 단위
- `null`, `unknown`, `not-applicable`, parse 실패가 서로 구분되는지
- 영향을 받는 저장 데이터, replay, API consumer와 호환성 정책
- 변경이 additive, narrowing, semantic, breaking 중 무엇인지

`docs/architecture/time-and-value-contracts.md`, 관련 데이터/API 아키텍처 절과 가장 가까운 기존 계약 family를 읽는다.

## 권위 지도

| 관심사 | 권위 |
| --- | --- |
| eaT raw payload 형태 | 손으로 작성한 source Pydantic |
| canonical Python/TypeScript 교환 | ingestion Zod -> versioned JSON Schema -> generated normalized Pydantic |
| 업무 의미와 불변식 | `packages/domain` |
| 공개 HTTP wire 형태 | API Zod -> inferred TypeScript/OpenAPI/web parser |
| PostgreSQL 저장소와 DDL | `packages/db`의 Drizzle -> generated migration |
| 서버 orchestration | 목적별 내부 application port/record |

새 값을 추가하기 전에 기존 atom과 semantic value를 확인한다.

## 전파 순서

1. 추측하지 말고 raw source를 보존하고 모델링한다.
2. 정확한 domain value를 정의하거나 재사용한다. 시간은 Temporal, 금액은 통화를 동반한 exact decimal, 비율은 percentage-point와 ratio를 구분하고, 수량은 단위를 포함한다. 계층 사이에서 이를 일반 `number`, `Date`, 문자열로 넘기지 않는다.
3. atom -> value -> resource -> versioned endpoint 조합으로 해당 ingestion 또는 공개 Zod family를 변경한다.
4. 문서화된 호환성 계약과 실제 consumer를 근거로 versioning을 결정하고 이유를 기록한다.
5. JSON Schema, normalized Pydantic, OpenAPI, Drizzle migration은 해당 권위에서만 재생성한다.
6. normalization, persistence, application, response, web parse 경계에서 명시적으로 매핑한다. decimal 문자열과 bigint 정밀도를 보존한다.

## 구조 규칙

- 한 계약 family 안에서는 `pick`, `omit`, `safeExtend`를 사용할 수 있다.
- ingestion, command, 공개 response, DB row family 사이를 가로질러 pick하지 않는다.
- Zod에서 source Pydantic이나 DDL을 생성하지 않고, Drizzle에서 API DTO를 파생하지 않으며, generated Pydantic/OpenAPI/schema artifact를 직접 편집하지 않는다.
- portable registry node에는 codec, transform, overwrite, runtime custom predicate를 넣지 않는다. export된 registry와 최상위 `portableContracts` root를 유지한다.
- parse 실패는 quarantine 증거이지 `null`이 아니다. 누락값을 0이나 그럴듯한 기본값으로 바꾸지 않는다.

## 검증 증거

source variant, 정확한 decimal·단위 경계, null·unknown 의미, generated round trip, PostgreSQL 정밀도, 서버 mapping, response validation, OpenAPI drift와 consumer 상태를 테스트한다. 테스트 제목은 한글 음절을 포함한다.

현재 `package.json` script에서 좁은 생성·검사 명령을 찾아 실행한다. 최종 필수 gate는 `pnpm architecture:check`, `pnpm test:quality`, `pnpm contracts:check`, `pnpm contracts:python:check`이며, Drizzle migration 검토와 영향받는 package test/build도 포함한다.
