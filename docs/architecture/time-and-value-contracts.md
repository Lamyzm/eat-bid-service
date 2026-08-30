# 시간·정량 값·Zod 계약

이 문서는 [ADR 0021](../adr/0021-zod-portable-contract-hub.md)을 구현 가능한 경계로
풀어쓴다. 목표는 `string`과 `number`를 없애는 것이 아니라, **업무 의미와 단위가 지워진 원시값이
계층을 통과하지 못하게 하는 것**이다.

## 1. 하나의 진실 원천이 뜻하는 것

여기서 SSOT는 모든 계층을 한 schema 파일로 생성한다는 뜻이 아니다. **같은 질문에 답하는
권위가 둘이면 안 된다는 뜻**이다. canonical interchange와 공개 API JSON은 Zod, 업무 값의 의미와
불변식은 domain, 물리 DB 형식은 Drizzle, eaT 원본 응답 형식은 source Pydantic이 각각 하나의 권위를
가진다. 한 계층의 모델을 다른 계층에 그대로 노출하지 않고 명명한 adapter에서 변환한다.

```mermaid
flowchart TB
    source[eaT 원본 XML/JSON] --> pydantic[Pydantic source contract]
    pydantic --> normalize[normalize adapter]

    hub[Zod atoms / values] --> ingestion[Zod ingestion/v1 wire]
    hub --> apiwire[Zod api/v1 wire]
    ingestion --> jsonschema[versioned JSON Schema]
    jsonschema --> pygen[generated Pydantic v2 model]
    normalize --> pygen

    ddl[packages/db<br/>Drizzle DDL] --> migration[커밋된 SQL migration]
    migration --> pg[(PostgreSQL<br/>exact storage)]
    pygen -->|Argo dataplane publish| pg
    pg <--> row[Drizzle row adapter]
    row <--> domain[packages/domain<br/>의미 값과 불변식]

    apiwire <--> codec[Zod codec adapter]
    codec <--> domain
    apiwire --> openapi[OpenAPI]
    apiwire --> client[Web runtime parser<br/>z.input / z.output]

    fixture[canonical golden fixtures] -. 의미 일치 검증 .-> pydantic
    fixture -. 의미 일치 검증 .-> ddl
    fixture -. round trip .-> ingestion
    fixture -. round trip .-> apiwire
```

| 질문 | 유일한 권위 | 여기서 파생되는 것 | 여기서 파생하지 않는 것 |
|---|---|---|---|
| eaT가 실제로 보낸 모양은 무엇인가? | 손으로 작성한 Pydantic source contract | normalized input | interchange/API DTO, DDL |
| Python과 TypeScript가 교환하는 canonical JSON은 무엇인가? | Zod `ingestion/v1` wire schema | JSON Schema, generated Pydantic model | source parsing, DDL |
| 금액·비율·시간의 업무 의미는 무엇인가? | `packages/domain` | 불변식과 명명된 변환 | JSON field 이름, DB column |
| 어떤 API JSON을 공개하고 받는가? | Zod `api/v1` wire schema | `z.input`/`z.output`, OpenAPI, web parser | DDL |
| 어떻게 정확히 저장하는가? | `packages/db` Drizzle schema | SQL migration, row type | HTTP response |

쌍방향 화살표는 생성 관계가 아니라 명시적 encode/decode 경계다. OpenAPI나 Zod에서 DDL을 만들지
않고 Drizzle row를 HTTP DTO로 사용하지 않는다. source Pydantic은 독립 권위지만 normalized Pydantic은
Zod JSON Schema에서 생성한다. 각 권위 사이의 의미 보존은 canonical fixture와 integration test로
증명한다.

### 계약을 바꿀 때 시작할 곳

- normalized interchange field·null 의미·범위를 바꾸면 Zod `ingestion/v1`부터 바꾸고 JSON Schema와
  generated Pydantic model을 재생성한다.
- 공개 API JSON을 바꾸면 Zod `api/v1`부터 바꾸고 OpenAPI와 web 소비자 계약을 갱신한다.
- `BidRate`와 `FloorRate`를 섞을 수 없는 것처럼 업무 의미를 바꾸면 domain부터 바꾸고 codec과
  integration test로 전파한다.
- `numeric` precision, index, foreign key처럼 저장 제약을 바꾸면 Drizzle과 migration부터 바꾼다.
- eaT XML field나 원본 해석 규칙을 바꾸면 Pydantic source contract와 normalize adapter부터 바꾼다.

이 규칙 덕분에 한 변경이 어디서 시작되어야 하는지 결정할 수 있고, AI 세션이 편의상 controller,
DB row, crawler model에 같은 interface를 복사하는 것을 막는다.

## 2. 목표 파일 구조

```text
packages/domain/src/
├─ time/
│  ├─ temporal.ts
│  ├─ clock.ts
│  ├─ elapsed-duration.ts
│  └─ instant-text.ts
├─ decimal/
│  └─ canonical-decimal.ts
├─ money/
│  ├─ currency.ts
│  └─ money.ts
├─ rate/
│  ├─ percentage-points.ts
│  └─ ratio.ts
├─ quantity/
│  ├─ count.ts
│  └─ byte-length.ts
└─ geo/
   ├─ coordinate.ts
   └─ distance.ts

packages/contracts/src/
├─ atoms/
│  ├─ decimal.ts
│  ├─ identifier.ts
│  ├─ temporal.ts
│  └─ geo.ts
├─ values/
│  ├─ money.ts
│  ├─ rate.ts
│  ├─ coordinate.ts
│  └─ provenance.ts
├─ resources/procurement/
│  ├─ identity.ts
│  ├─ schedule.ts
│  ├─ pricing.ts
│  └─ restrictions.ts
├─ ingestion/v1/
├─ api/v1/
├─ codecs/
└─ registry.ts

packages/contracts/generated/
└─ ingestion-v1.schema.json

apps/dataplane/src/eatbid/generated/
└─ ingestion_v1.py
```

`index.ts`는 export만 한다. 포맷, 계산, validation, DB mapping을 한 파일에 모으지 않는다.

## 3. 시간 모델

| 의미 | 내부 타입 | wire | DB | 금지되는 대체 |
|---|---|---|---|---|
| 관측/공고/제출의 절대 시점 | `Temporal.Instant` | UTC ISO 8601 `...Z` | `timestamptz` | timezone 없는 문자열, `Date` |
| 영업일·개찰일·납품일 | `Temporal.PlainDate` | `YYYY-MM-DD` | `date` | UTC 자정 `Date` |
| 서울 기준 일정 표현 | `Temporal.ZonedDateTime` | instant + 명시된 zone | `timestamptz` + 정책상 zone | 수동 `+9h` |
| 달력 기간 | `Temporal.Duration` | ISO duration 또는 bounded fields | 목적별 | 고정 30일을 한 달로 취급 |
| timeout/retry/drain | `ElapsedMilliseconds` | 단위가 붙은 config field | 목적별 | 일반 `number` |

`Clock`은 `now(): Temporal.Instant`만 제공한다. 시스템 구현 한 곳만 `Temporal.Now.instant()`를
호출하고 test clock은 고정 Instant를 반환한다. source adapter는 `Asia/Seoul` IANA zone으로 입력을
해석한다. absolute timestamp를 표시할 때만 사용자의 zone으로 바꾸며 저장 의미를 바꾸지 않는다.

## 4. 금액과 비율

### 금액

```json
{ "amount": "123456789.00", "currency": "KRW" }
```

- `amount`는 부호·지수 표기·천 단위 구분자가 없는 canonical nonnegative decimal string이다.
- 1차 source 계약은 `KRW`만 허용한다. 다른 currency는 source와 scale 정책을 추가한 뒤 연다.
- PostgreSQL `numeric`과 Python `Decimal`이 계산한다. TypeScript는 exact string을 비교·전달하고,
  실제 업무 산술이 필요해질 때 별도 ADR로 decimal engine을 선택한다.
- 원본 `BID_CALC_AMT` 같은 관측 금액을 다른 금액×비율로 복원하지 않는다.

### 비율

| 타입 | 예 | 범위/의미 |
|---|---:|---|
| `PercentagePoints` | `90.125000` | 100을 기준으로 한 표시 단위 |
| `Ratio` | `0.901250` | 1을 기준으로 한 계산 단위 |
| `FloorRate` | `88.745000` | source가 제공한 낙찰하한 퍼센트포인트 |
| `BidRate` | `90.123000` | source가 관측한 투찰 퍼센트포인트 |
| `SharePercent` | `42.500000` | 0..100 점유율 |

`BidRate`와 `FloorRate`는 같은 표현이라도 서로 다른 업무 사실이다. `PercentagePoints ↔ Ratio`
변환은 명명한 함수만 허용한다. source 범위 밖 값은 raw에서 삭제하지 않고 validation/quarantine 상태로
남긴다. `double precision`은 canonical rate DDL에 사용하지 않는다.

## 5. 수량·용량·합성 단위

- ID와 DB count/byte length는 `bigint`로 읽는다. Drizzle `mode: "number"`를 사용하지 않는다.
- safe integer가 계약으로 증명되는 page size, HTTP status, UI 표본 수만 bounded number를 허용한다.
- `ExpectedRecordCount`, `CapturedRecordCount`, `PublishedRecordCount`는 completeness 정책에서 이름과
  grain을 유지한다. 일반 `Count` 하나로 모든 값을 교환하지 않는다.
- `ByteLength`와 `PayloadByteLimit`은 별도 타입이다.
- `AwardsPerSupplierYear`, `AuctionsPerYear`, `WonAmountPerPeriod`처럼 분자/분모/기간이 있는 값은 그
  전체 의미를 타입·필드명·Zod metadata에 기록한다.

## 6. 좌표

```json
{
  "latitude": 37.566500,
  "longitude": 126.978000,
  "crs": "EPSG:4326"
}
```

latitude/longitude는 finite number와 법정 범위를 검증한다. 좌표만으로 기관 정체성을 만들지 않고,
기관 또는 지역 코드에 대한 `GeoPointObservation`이 source, method, observedAt, accuracy/resolution
상태를 가진다. 66개 좌표 누락은 이 계약과 provenance를 만든 뒤 별도 enrichment/backfill workflow로
해결한다. 임시 이름 lookup 결과를 `core`에 직접 채우지 않는다.

## 7. Zod 계약 규율

- `packages/contracts`의 interchange/public schema는 `z.strictObject`와 explicit bound를 사용한다.
- `z.infer`/`z.input`/`z.output`만 TypeScript wire type을 만든다.
- JSON은 identity/schedule/pricing/restrictions/provenance의 중첩 resource로 구성한다. 최종 DTO마다
  `.shape` spread를 반복하지 않는다.
- 같은 contract family는 `.pick()`/`.omit()`/`.safeExtend()`로 조립한다. ingestion/request/response/
  DB row 사이에는 `.pick()`을 사용하지 않는다. `z.intersection()`은 object DTO 조립에 사용하지 않는다.
- pagination/version처럼 반복되는 envelope만 작은 local generic factory로 만든다. 별도 contract
  framework와 Immer를 schema composition에 사용하지 않는다.
- domain conversion이 필요한 값은 `wireSchema` 옆에 `z.codec(wireSchema, domainSchema, ... )`를
  두되 OpenAPI에는 wire schema를 전달한다.
- response도 parse/encode 검증을 통과해야 하며 controller가 수동 object spread로 internal field를
  누락시키는 방식에 의존하지 않는다.
- Zod metadata의 description은 단위, scale, timezone/CRS, null 의미를 설명한다.
- nullable은 unknown, not-applicable, not-yet-observed를 한 값으로 숨기지 않는다. 업무상 구분이
  필요하면 discriminated union을 사용한다.
- portable registry는 JSON Schema로 표현 가능한 기능만 허용한다. versioned JSON Schema와 generated
  Pydantic model은 커밋하고 CI 재생성 diff로 drift를 차단한다.

### 한 값이 API를 통과하는 실제 흐름

공고 기초금액을 조회하는 경우를 예로 들면 다음 순서를 지킨다.

1. Drizzle adapter가 PostgreSQL `numeric`을 부동소수점으로 바꾸지 않고 canonical decimal
   string으로 읽는다.
2. adapter가 `Money` factory에 amount와 `KRW`를 전달한다. 여기서 domain 불변식을 통과하지
   못하면 use case로 값이 들어가지 않는다.
3. use case는 `Money`를 다루며 DB row나 HTTP object의 shape를 알지 못한다.
4. response codec이 `Money`를 `{ "amount": "123456789.00", "currency": "KRW" }`로 encode한다.
5. controller는 Zod response schema로 최종 출력을 검증한다. OpenAPI와 web parser도 바로 이 wire
   schema를 사용한다.

입력은 이 순서의 역방향이다. `schema.parse`만 통과한 원시 object를 application에 넘기지 않고,
codec의 decode가 domain factory까지 통과해야 유효한 입력이다. 반대로 DB row를 controller가 직접
반환하거나 type assertion으로 검증을 생략하는 것도 금지한다. `AuctionRecord`는 application 내부 port,
공개 wire는 Zod에서 추론한 `AuctionV1Response`다. 제거한 TypeScript-only `AuctionResponse`는 import할 수
없어야 하며 compile-time consumer fixture가 그 API surface를 고정한다.

### 이름 붙은 시간·DB adapter

- `packages/domain/src/time/clock.ts`의 exported top-level `systemClock`만 `Temporal.Now.instant()`를 호출한다.
- `apps/server/src/modules/procurement/infrastructure/drizzle/drizzle-auction-reader.ts`의 `AuctionRow`만
  PostgreSQL driver `Date | string`을 받고, top-level `postgresInstant`가 즉시 Temporal로 닫으며
  `mapAuctionRow`가 semantic `AuctionRecord`를 만든다.
- 위 경로와 symbol 이름은 exact exception이다. 디렉터리·substring·새 adapter 일반 예외가 아니다.

## 8. 정적 품질 gate와 예외

`tools/architecture/check-semantic-values.mjs`와 Python 동등 gate는 다음을 검사한다.

- 허용된 adapter 밖의 `Date`, ambient clock, Day.js/date-fns/Moment/Luxon import
- raw numeric timer argument와 단위 없는 timeout/interval/TTL constant
- canonical money/rate column의 floating-point DDL
- DB bigint의 JavaScript number mapping
- Zod 외부에 중복 작성한 public wire interface
- 사람이 중복 작성한 normalized Pydantic model과 generated contract drift
- portable registry의 codec/transform/overwrite/runtime custom predicate
- naive Python datetime과 float money/rate normalization

portable registry file과 exported const top-level `portableContracts` root는 필수다. registry entry에서
도달 가능한 schema graph는 호출한 schema factory body/return까지 검사한다. 따라서 alias나 조건부
branch/factory에 숨긴 codec·transform/overwrite·runtime custom predicate도 실패한다. Zod/schema origin을 증명해
동명이인 일반 `transform` helper를 오탐하지 않으며, registry 밖 adjacent codec이 guarded output을 위해
쓰는 `z.custom`까지 전역 금지하지는 않는다.

TypeScript gate는 `globalThis.Date`, namespace Temporal, `window` timer와 use-site 이전 assignment alias까지
compiler symbol로 추적한다. Python gate는 lexical scope와 사용 순서를 보존하고 local re-export를 따라가며
`builtins.float`, nested money/rate conversion, naive `utcfromtimestamp`, 실제 `timedelta.total_seconds()`를
구분한다. HTTP public boundary의 exported manual type/interface는 이름 suffix와 무관하게 금지하고 Zod
inferred type만 허용한다.

레거시 예외 ledger는 exact repository path, AST node kind, normalized node text SHA-256, 이유, 제거 gate와
동일 fingerprint의 multiplicity를 고정한다. line number만 기록해 이동으로 우회하지 않고 감소/삭제만
허용하며 추가·text drift·동일 node 복제를 거부한다. 신규 server/domain/contracts/db/dataplane에는 일반
예외를 허용하지 않는다.

CI와 로컬의 권위 명령은 다음과 같다.

```text
pnpm architecture:check
pnpm test:quality
pnpm contracts:check
pnpm contracts:python:check
```

두 contract check는 임시 생성물과 커밋 artifact를 비교할 뿐 추적 파일을 쓰지 않는다. CRLF/LF는
logical comparison에서 정규화한다. CI의 hosted Ubuntu publication lane과 hosted `windows-latest`
portability lane은 모두 pnpm/uv frozen install을 먼저 마친 뒤 drift gate를 실행하며 image build는 두
lane에 의존한다.

## 9. 단계적 전환

1. `packages/domain`과 Zod atom/value/resource, ingestion/API wire 계약을 만든다.
2. ingestion JSON Schema와 deterministic generated Pydantic lane, golden round trip을 만든다.
3. 신규 server의 config/shutdown/logging/auction read를 Clock·Temporal·semantic value로 전환한다.
4. `packages/db` bigint mapping과 canonical numeric 정책을 고친다.
5. dataplane의 source time/Decimal/count 변환을 generated model과 동일 fixture로 검증한다.
6. 정적 gate로 현재 상태를 동결하고 CI에 연결한다.
7. frontend는 사용자와 기능/정보 구조를 합의한 뒤 wire 계약 소비자로 전환한다.

frontend cutover 전에도 새 backend 계약은 단위를 잃지 않는다. web chart/map adapter가 일시적으로
number를 필요로 하면 근사 presentation value임을 명시하고 canonical 판단에는 재사용하지 않는다.
누락 좌표를 이름 lookup으로 canonical 위치에 채우는 것도 이 단계의 범위가 아니며, CRS/provenance
계약을 소비하는 별도 Argo enrichment/backfill이 필요하다.
