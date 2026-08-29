# 0018 — application identity와 bigint HTTP 표현

- Status: Accepted
- Date: 2026-08-30
- Supersedes: 없음

## Context

eatbid의 내부 관계는 bigint ID를 사용하지만 인증 제공자는 문자열 subject를 요구할 수 있고 JSON은
JavaScript `bigint`를 직접 직렬화할 수 없다. 이 차이를 정의하지 않으면 Better Auth의 문자열 user ID가
workspace FK로 전염되거나, `Number` 직렬화가 `MAX_SAFE_INTEGER`를 넘는 ID를 조용히 손상시킨다.

현재 `packages/shared`의 auth/user-data schema는 문자열 user/workspace/business key를 직접 관계에 사용한다.
이는 보존 대상 구현이 아니라 전환 조사 자료다. 새 `app` schema와 HTTP contract에는 별도 경계가 필요하다.

## Decision

### Application identity

- `app.principal`, `app.workspace`, `app.workspace_membership`은 bigint PK/FK를 사용한다.
- 인증 제공자의 subject는 `app.identity_subject`에 `(provider, issuer, subject)`로 보존하고
  `principal_id bigint`에 명시적으로 연결한다. application table은 provider subject를 FK로 사용하지 않는다.
- provider-owned Better Auth table은 라이브러리 계약상 문자열 ID를 가질 수 있다. 이 문자열은 인증 transport
  내부 식별자이며, domain/application query는 `identity_subject → principal_id` 해소 후에만 실행한다.
- workspace membership과 이후 workspace-supplier 관계는 내부 bigint만 사용한다.

### HTTP wire format

- 내부 bigint ID는 JSON과 path parameter에서 정규화된 양의 10진 문자열로 표현한다.
- wire schema는 `^[1-9][0-9]*$`를 만족해야 한다. 부호, 공백, 소수, 지수 표기, 선행 0을 거부한다.
- presentation boundary가 path string을 `bigint`로 변환하고 application/domain은 문자열 ID를 받지 않는다.
- response boundary가 bigint를 다시 10진 문자열로 변환한다. `Number` 경유는 금지하며
  `MAX_SAFE_INTEGER`보다 큰 fixture를 contract/e2e test에 포함한다.
- 이 문자열은 JSON의 무손실 인코딩일 뿐 업무 식별자나 DB 관계키가 아니다.

### Auth schema conformance

- `better-auth`와 독립 CLI package `auth`를 같은 exact version으로 고정한다.
- pinned CLI의 offline Drizzle generation 결과를 table/column/index/relation 수준에서 committed modular
  `packages/db` auth schema와 비교한다. byte formatting이나 한 파일 출력 형태를 권위로 삼지 않는다.
- Better Auth CLI는 schema 계약을 생성할 뿐 migration을 적용하지 않는다. Drizzle Kit이 검토 가능한 SQL
  migration을 생성하고 `packages/db` migrator만 적용한다.
- auth brute-force 보호는 Better Auth의 database-backed rate limiter를 사용하며 generated rate-limit table도
  같은 conformance와 migration gate에 포함한다.

## Consequences

- provider가 문자열 ID를 요구해도 제품 관계와 URL 의미는 내부 bigint identity를 유지한다.
- HTTP consumer는 ID를 숫자가 아니라 decimal string으로 다뤄야 하지만 정밀도 손실이 없다.
- Better Auth upgrade는 package bump만으로 끝나지 않고 CLI schema conformance와 Drizzle migration review를
  함께 통과해야 한다.
- provider raw transport의 동적 auth endpoint/error body는 Better Auth 계약을 유지한다. canonical
  `/api/v1` endpoint의 RFC 9457/OpenAPI 계약과 섞지 않는다.

## Rejected alternatives

- JSON number로 bigint 반환: JavaScript 정밀도 손실을 감지할 수 없다.
- provider user ID를 workspace FK로 사용: 인증 기술 선택이 application identity SSOT가 된다.
- Better Auth schema를 문서만 보고 손으로 유지: plugin/version 변경 시 필수 column/index drift를 놓친다.
- Better Auth `migrate`로 운영 DB 변경: Drizzle 단일 DDL/migration 권위를 깨뜨린다.
