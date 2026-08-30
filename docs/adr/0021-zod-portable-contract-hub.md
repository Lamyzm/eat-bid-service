# 0021 — Zod portable contract hub와 Python 생성 계약

- Status: Accepted
- Date: 2026-08-30
- Supersedes: 0020

## Context

ADR 0020은 시간·금액·비율·수량·좌표의 의미 타입과 Zod HTTP 계약을 확정했다. 그러나 Python
dataplane이 원본을 수집·정규화·발행하고 NestJS가 PostgreSQL을 통해 이를 읽어 Next.js에 제공하는
실제 언어 경계를 충분히 설명하지 못했다. Python normalized Pydantic 모델과 Zod API 모델을 각각
손으로 작성하면 같은 canonical JSON의 필드, null 의미, decimal 표현, 시간대가 drift할 수 있다.

반대로 Zod에서 Pydantic source model이나 Drizzle DDL까지 생성하면 서로 다른 질문의 권위가 한
meta-schema에 결합된다. eaT 원본 형식, eatbid가 정규화한 JSON, 관계형 저장 형식, 공개 API는 수명이
다르다. Argo의 대량 backfill/replay를 product server의 HTTP 가용성에 묶는 것도 바람직하지 않다.

## Decision

### 유지되는 의미 값 결정

ADR 0020의 Temporal, injected Clock, exact money/rate, bigint count/byte, coordinate/CRS/provenance,
framework-free `packages/domain`, named adapter와 정적 gate 결정은 그대로 유지한다. 이 ADR이 현재
결정의 전체 진입점이며 ADR 0020은 역사적 맥락으로만 남긴다.

### 계약 권위

- `packages/contracts`의 Zod **wire schema**가 eatbid 프로세스 사이를 통과하는 canonical JSON과
  NestJS↔Next.js API JSON의 권위다.
- Python의 손으로 작성한 Pydantic source model은 eaT XML/JSON 원본 형식과 source parsing의 권위다.
  이것은 canonical interchange 또는 public API DTO가 아니다.
- Python이 생산하는 normalized interchange Pydantic model은 Zod portable schema에서 생성한 JSON
  Schema artifact로부터 생성한다. 생성 파일은 수정하지 않는다.
- `packages/db`의 Drizzle schema는 관계형 저장 형식과 DDL의 권위다. Zod는 DDL을 생성하지 않고
  Drizzle row는 wire DTO가 아니다.
- `packages/domain`은 업무 의미와 불변식의 권위다. Zod, Pydantic, Drizzle을 import하지 않는다.

### 실행 경계

- Python dataplane은 Argo Workflow에서 raw를 R2에 보존하고 source model로 파싱한 뒤 생성된
  normalized contract를 만족하는 canonical JSON을 만든다.
- dataplane은 제한된 DB role로 `ingest`와 허용된 `core`/`mart` projection을 직접 발행한다. 모든
  normalized record를 NestJS HTTP endpoint로 보내지 않는다.
- NestJS product server는 `core`/`mart`를 읽어 domain value로 변환하고 public Zod response로
  encode한다. Next.js는 같은 public schema를 fetch boundary에서 runtime parse한다.
- 향후 실제 비동기 transport가 필요하면 동일 normalized wire artifact를 메시지나 object manifest에
  싣는다. transport 도입이 계약 소유권을 바꾸지는 않는다.

### Portable Zod subset과 생성 사슬

- Python으로 전달할 portable registry에는 JSON Schema로 표현되는 strict object, literal/enum,
  discriminated union, regex/format, length와 numeric bound만 허용한다.
- `z.codec`, transform, runtime brand, Temporal instance, opaque custom predicate는 portable registry에
  넣지 않는다. wire schema와 TypeScript-only codec을 별도 export한다.
- Zod registry의 안정된 schema ID와 metadata로 versioned JSON Schema artifact를 생성한다.
- pinned `datamodel-code-generator`가 artifact에서 Pydantic v2 model을 재현 가능하게 생성한다.
  timestamp 없는 deterministic preset을 사용하고 JSON field alias, strict nullability, unknown-field
  rejection을 contract test로 검증한다.
- JSON Schema와 생성된 Python model을 커밋한다. CI는 재생성 후 diff가 0인지 검사한다.
- canonical golden fixture는 Python generated model → JSON → Zod wire parse → domain decode → wire
  encode round trip을 통과해야 한다.

### Zod composition

Zod schema는 다음 네 층으로 조립한다.

1. **Atoms:** canonical decimal, instant text, ID, source code, latitude처럼 의미가 있는 최소 schema
2. **Values:** money, coordinate, provenance처럼 원자들을 묶은 값 object
3. **Resources:** auction identity, schedule, pricing처럼 의미가 드러나는 중첩 object
4. **Contract families/endpoints:** `ingestion/v1`, `api/v1` 안의 최종 strict request/response schema

하나의 거대한 entity schema를 모든 경계의 기반으로 삼지 않는다. `.pick()`/`.omit()`은 같은 contract
family 안에서 필드 의미, visibility, null 정책이 동일한 read model을 축소할 때만 사용한다.
ingestion, command request, public response, DB row 사이에는 `.pick()`을 사용하지 않고 공통 atom/value를
중첩 resource로 조립한다. 확장은 `.safeExtend()`, 부분 입력은 `.partial()`/`.required()`, 상태 variant는
`z.discriminatedUnion()`을 사용한다. object DTO 조립에 `z.intersection()`을 쓰지 않는다.

최종 DTO마다 `.shape` spread를 반복하지 않는다. JSON 자체를 identity/schedule/pricing/restrictions/
provenance처럼 의미 있는 중첩 resource로 설계하고 같은 contract family 안에서는 Zod object API로
축소·확장한다. pagination/version envelope처럼 정말 반복되는 구조만 `pageOf()`/`versioned()` 같은
작고 타입이 보존되는 local factory로 만든다. 별도 contract framework는 도입하지 않는다.

Immer는 schema composition 도구가 아니므로 domain/contracts/server 기반 의존성에 넣지 않는다.
향후 공동 frontend 설계에서 깊은 client-owned 편집 상태와 반복되는 immutable update가 실제로
확인될 때만 별도 결정을 거쳐 선택적으로 사용한다.

### TypeScript와 OpenAPI

- hand-written public/interchange DTO interface를 만들지 않는다. `z.input`, `z.output`, `z.infer`만
  사용한다.
- Nest Standard Schema request와 response serializer가 최종 endpoint schema를 사용한다.
- OpenAPI는 serializable API wire schema에서 생성한다. codec output이나 domain object를 OpenAPI로
  투영하지 않는다.
- Next.js는 TypeScript type만 신뢰하지 않고 network fetch boundary에서 response schema를 parse한다.

## Consequences

- Python source parsing은 upstream 변화에 독립적으로 대응하면서 normalized JSON의 중복 계약은
  제거된다.
- Nest와 Next는 Zod를 직접 공유하고 Python은 생성된 Pydantic model로 같은 계약을 소비한다.
- Argo backfill/replay는 product HTTP server 가용성과 처리량에 결합되지 않는다.
- JSON Schema로 표현되지 않는 Zod 기능은 portable contract에 사용할 수 없으며 domain codec과
  semantic validation으로 분리해야 한다.
- generated artifact와 codegen drift gate가 추가되지만 사람이 동일 DTO를 세 언어/계층에 복사하는
  비용보다 작다.

## Rejected alternatives

- Python이 모든 normalized record를 Nest internal ingestion API로 전송: product server에 batch
  throughput, retry, idempotency, write credential과 가용성 결합이 생긴다.
- TypeSpec/OpenAPI를 새 최상위 IDL로 도입해 Zod와 Pydantic을 모두 생성: 언어 중립성은 높지만 현재
  규모에서 별도 schema 언어와 generator가 Zod-first Nest/Next 개발보다 큰 비용이다.
- Pydantic과 Zod normalized model을 각각 손으로 작성하고 fixture만 비교: 필드 추가·null 정책 변경을
  컴파일/생성 gate 전에 놓칠 수 있다.
- 하나의 `AuctionSchema`에서 ingestion/request/response를 모두 `.pick()`으로 파생: visibility, version,
  null 의미와 수명주기가 다른 계약이 entity shape에 결합된다.
- Immer를 schema/domain 기본 조립 도구로 사용: runtime proxy draft와 auto-freeze는 wire schema 조립이나
  명시적인 domain transition의 문제를 해결하지 않는다.
