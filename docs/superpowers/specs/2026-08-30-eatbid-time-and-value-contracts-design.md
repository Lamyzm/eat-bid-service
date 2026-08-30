# Eatbid 시간·단위·Zod 계약 설계 스펙

- Date: 2026-08-30
- Status: Approved; implementation authorized
- Approval: 사용자가 시간뿐 아니라 금액·비율·수량·용량·좌표를 1차 기반 범위로 승인하고
  Zod 계약을 명시적으로 요구함
- Scope: 신규 backend/domain/contracts/db/dataplane 기반과 정적 품질 gate. frontend 동작 변경은 제외.

## 1. 문제

Eatbid의 분석 정확성은 값의 단위와 관측 의미에 달려 있다. 현재 레거시와 신규 기반에는 다음 위험이
공존한다.

- `Date`, timestamp string, epoch millisecond와 수동 KST offset이 섞인다.
- timeout, interval, TTL이 일반 숫자와 raw literal로 전달된다.
- 금액은 `numeric` string인 신규 경로와 JavaScript number인 레거시 경로가 갈린다.
- 투찰률·하한율·점유율·ratio·건/업체/년이 모두 `number` 또는 `double precision`이다.
- DB bigint ID/count/byte length 일부가 Drizzle `mode: "number"`로 축소된다.
- 좌표가 naked latitude/longitude number이고 CRS와 provenance가 계약에 없다.
- HTTP schema와 TypeScript interface를 별도로 유지하면 단위와 bounds가 drift할 수 있다.

이 기반을 그대로 두고 크롤러·Argo·분석·frontend를 올리면 같은 필드명이 서로 다른 의미를 갖거나
잘못된 산술이 조용히 성공한다.

## 2. 승인된 목표

> 시간·금액·비율·수량·바이트·좌표를 의미가 있는 domain value로 표현하고, 공개 JSON 표현은
> Zod wire schema 하나에서 검증·타입 파생·OpenAPI 투영한다.

완료 후 다음이 성립해야 한다.

1. 신규 domain/application code는 ambient clock과 legacy `Date`를 사용하지 않는다.
2. timeout/interval/TTL은 branded elapsed duration factory를 거친다.
3. 금액/비율 canonical 사실은 floating-point로 계산하거나 저장하지 않는다.
4. 퍼센트포인트, ratio, 점유율, 합성 rate가 타입과 field name에서 구분된다.
5. DB bigint가 JavaScript number로 축소되지 않는다.
6. 좌표는 CRS와 provenance를 잃지 않는다.
7. HTTP wire type은 Zod에서만 파생하고 DB/source model과 분리된다.
8. TypeScript/Python/PostgreSQL 변환은 cross-language fixture로 같은 canonical 결과를 증명한다.
9. legacy frontend debt는 증가하지 않고 별도 공동 기획 전까지 동작을 바꾸지 않는다.

## 3. 기술 기준

- Node: exact `24.20.0`
- TypeScript: exact `5.9.3`
- Temporal compatibility: exact `temporal-polyfill@1.0.4`, side-effect-free local import
- Zod: exact `4.5.4`를 모든 직접 사용 workspace에 통일
- PostgreSQL: `timestamptz`, `date`, `numeric`, `bigint`
- Python: timezone-aware `datetime`, `zoneinfo.ZoneInfo`, `Decimal`, unbounded `int`
- Test: Bun test, pytest, Hypothesis, PostgreSQL integration, AST mutation fixture

Stage-4 Temporal은 Node 26에서 기본 제공되지만 2026-08-30 기준 repository runtime은 Node 24이고
브라우저 지원도 균일하지 않다. polyfill import는 native implementation을 우선하므로 Node 26 LTS 전환
후 consumer API를 바꾸지 않는다. 전역 polyfill은 사용하지 않는다.

## 4. 책임 경계

| 계층 | 권위 | 허용되는 변환 | 금지 |
|---|---|---|---|
| `packages/domain` | semantic type, invariant, named conversion | primitive/Temporal ↔ domain value | Zod, Nest, Effect, Drizzle, HTTP import |
| `packages/contracts` | bounded serializable Zod wire schema | wire schema ↔ domain codec | DDL 생성, DB row 공개, 수동 duplicate interface |
| `packages/db` | Drizzle DDL/row representation | exact DB primitive ↔ repository adapter | HTTP schema 권위, bigint→number |
| `apps/server` | use case와 transport mapping | repository domain value ↔ Zod wire | controller 산술, ambient time, direct DB row response |
| `apps/dataplane` | source/Pydantic normalized authority | source text ↔ aware datetime/Decimal/int | naive datetime, float money/rate |
| `apps/web` | validated wire 소비와 presentation | chart/map library용 명시적 근사 adapter | canonical 판단/금액 산술에 근사값 재사용 |

Zod는 HTTP 계약의 SSOT이지 모든 데이터 계층을 생성하는 meta-schema가 아니다. Pydantic과 Drizzle은
각자의 경계에서 독립 권위이며 fixture와 integration test로 합치한다.

## 5. TypeScript domain API

### 5.1 시간

```ts
export { Temporal } from "temporal-polyfill";

export interface Clock {
  now(): Temporal.Instant;
}

declare const elapsedMillisecondsBrand: unique symbol;
export type ElapsedMilliseconds = number & {
  readonly [elapsedMillisecondsBrand]: "ElapsedMilliseconds";
};

export function milliseconds(value: number): ElapsedMilliseconds;
export function seconds(value: number): ElapsedMilliseconds;
export function minutes(value: number): ElapsedMilliseconds;
export function hours(value: number): ElapsedMilliseconds;
export function toMilliseconds(value: ElapsedMilliseconds): number;
```

factory는 finite, nonnegative, safe integer millisecond를 보장한다. `Temporal.Duration`은 달력 계산에만
사용하고 Node timeout에 자동 변환하지 않는다. `systemClock` 한 곳만 `Temporal.Now.instant()`를 호출한다.

### 5.2 exact decimal과 금액

```ts
export type CanonicalDecimal = string & { readonly __brand: "CanonicalDecimal" };
export type Currency = "KRW";
export type Money = Readonly<{ amount: CanonicalDecimal; currency: Currency }>;

export function canonicalDecimal(value: string, scale: number): CanonicalDecimal;
export function krw(amount: CanonicalDecimal): Money;
```

1차 계약은 nonnegative amount와 exact two-decimal wire/storage 표현을 사용한다. TypeScript에서 금액
산술을 구현하지 않는다. 분석 계산은 PostgreSQL numeric 또는 Python Decimal이 수행하고 결과를 다시
canonical decimal로 직렬화한다. 다른 currency/scale은 실제 source가 등장할 때 확장한다.

### 5.3 비율

```ts
export type PercentagePoints = CanonicalDecimal & { readonly __unit: "PercentagePoints" };
export type Ratio = CanonicalDecimal & { readonly __unit: "Ratio" };
export type BidRate = PercentagePoints & { readonly __meaning: "BidRate" };
export type FloorRate = PercentagePoints & { readonly __meaning: "FloorRate" };
export type SharePercent = PercentagePoints & { readonly __meaning: "SharePercent" };
```

실제 구현은 충돌 없는 `unique symbol` brand를 사용한다. `BidRate`, `FloorRate`, `SharePercent`는
같은 문자열 표현이어도 암묵 대입되지 않는다. `PercentagePoints ↔ Ratio`는 named exact conversion만
허용하며 반올림 mode와 scale을 호출자가 숨기지 않는다.

### 5.4 수량과 byte

DB persisted count/byte는 bigint 기반이다. payload limit처럼 Node API가 요구하고 schema가 safe bound를
가진 값만 branded number다. `ExpectedRecordCount`, `CapturedRecordCount`, `PublishedRecordCount`,
`SampleCount`, `ByteLength`, `PayloadByteLimit`을 목적에 따라 분리한다.

### 5.5 좌표

```ts
export type Latitude = number & { readonly __unit: "Latitude" };
export type Longitude = number & { readonly __unit: "Longitude" };
export type Meters = number & { readonly __unit: "Meters" };
export type Wgs84Coordinate = Readonly<{
  latitude: Latitude;
  longitude: Longitude;
  crs: "EPSG:4326";
}>;
```

factory는 finite/range를 검증한다. canonical 위치에는 별도 `GeoPointObservation`이 source/method/
observedAt/accuracy/resolution state를 보존한다. 이번 gate는 타입과 계약 기반만 만들고 66개 좌표를
즉시 이름 추측으로 채우지 않는다.

## 6. Zod wire 계약

`packages/contracts/src/primitives`의 각 파일은 다음 세 층을 같은 위치에서 정의한다.

1. serializable atomic wire schema
2. 그 schema를 조합한 strict public object schema
3. 필요할 때만 domain constructor와 연결한 bidirectional codec

예시:

```ts
export const instantTextSchema = z.iso.datetime({ offset: false }).endsWith("Z").meta({
  id: "InstantText",
  description: "UTC instant encoded as canonical ISO 8601 text ending in Z.",
});

export const instantCodec = z.codec(
  instantTextSchema,
  z.custom<Temporal.Instant>((value) => value instanceof Temporal.Instant),
  {
    decode: (value) => Temporal.Instant.from(value),
    encode: (value) => value.toString(),
  },
);
```

OpenAPI와 public response schema는 `instantTextSchema`를 사용한다. codec은 application/presentation
adapter의 양방향 변환용이다. 같은 regex/range를 codec에 복제하지 않는다.

금액 wire는 `{ amount: canonicalMoneyAmountSchema, currency: z.literal("KRW") }`, 비율은
canonical decimal string, potentially large count/byte는 canonical nonnegative bigint decimal string,
좌표는 CRS를 포함한 strict object다. TypeScript 공개 type은 전부 `z.infer` 또는 `z.input`/`z.output`이다.

## 7. 저장과 source 경계

- timestamp: PostgreSQL `timestamptz`; repository는 driver `Date|string`을 명명한 legacy adapter에서
  즉시 `Temporal.Instant`로 변환한다.
- business date: PostgreSQL `date`; `Temporal.PlainDate`로 mapping한다.
- money/rate: PostgreSQL `numeric`; Drizzle 기본 exact string mapping을 유지한다.
- ID/count/byte: PostgreSQL `bigint`; Drizzle `mode: "bigint"`를 사용한다.
- source time: Python `ZoneInfo("Asia/Seoul")`로 parse하고 UTC-aware datetime으로 canonicalize한다.
- source money/rate: `Decimal`; JSON은 canonical decimal string으로 serialize한다.
- source invalid/out-of-range 값은 raw evidence에서 지우지 않고 typed validation/quarantine으로 처리한다.

## 8. 정적 강제

새 `tools/architecture/check-semantic-values.mjs`는 TypeScript compiler AST/symbol을 사용해 최소 다음
mutation fixture를 fail시킨다.

- 허용된 adapter 밖 `new Date`, `Date.now`, `Date.parse`, `Temporal.Now`
- Day.js, date-fns, Moment, Luxon direct import
- `setTimeout(fn, 5000)`과 산술식 raw timer argument
- 단위 suffix/factory 없는 timeout/interval/TTL config
- canonical money/rate field의 `doublePrecision`/`real`
- Drizzle `bigint(..., { mode: "number" })`
- public HTTP response의 수동 parallel interface

Python gate는 naive datetime constructor/`datetime.now()` without timezone, float money/rate model, raw sleep
literal을 검사한다. type checker가 증명할 수 없는 dynamic/aliased form은 fail-closed fixture를 둔다.

기존 `apps/web`/`packages/shared` 위반은 exact AST fingerprint ledger에만 허용한다. ledger는 baseline
감소를 허용하지만 신규 항목과 fingerprint drift를 거부한다. backend/domain/contracts/db/dataplane은
명명한 adapter 외에 일반 예외를 추가할 수 없다.

## 9. migration 범위

이번 구현은 frontend 동작을 바꾸지 않는다.

- 신규 `packages/domain`과 Zod primitive contract를 만든다.
- 신규 server의 config, logging, shutdown, migration timestamp, procurement response를 전환한다.
- `packages/db`의 bigint TypeScript mapping을 exact bigint로 바꾸고 generated SQL no-diff를 증명한다.
- dataplane source time/Decimal/count canonicalization을 golden fixture로 정렬한다.
- frontend/legacy shared의 debt는 ledger로 동결하고 사용자 공동 기획 전까지 자동 변환하지 않는다.
- 좌표 66개 enrichment는 coordinate/provenance 계약 이후 별도 Argo workflow/backfill 계획으로 다룬다.

## 10. 완료 조건

- domain/contracts/server/db/dataplane focused test와 full repository test/build가 통과한다.
- Zod 4.5.4와 temporal-polyfill 1.0.4 exact frozen install이 통과한다.
- Node 24에서 polyfill path, 가능한 native Temporal runtime에서 facade conformance가 같은 fixture를 낸다.
- OpenAPI가 UTC instant, money, rate, count, coordinate wire schema를 정확히 설명하고 deterministic이다.
- Drizzle schema 변경 후 migration generation이 SQL zero-diff다.
- AST gate mutation suite와 legacy baseline 증가 금지가 통과한다.
- Korean test-spec quality gate가 통과한다.
- independent specification/code-quality review에 unresolved finding이 없다.
- main fast-forward/push 뒤 CI 성공을 확인한다. 현재 8081과 frontend 배포는 변경하지 않는다.

## 11. 비목표

- generic units-of-measure runtime framework
- TypeScript 금액/통계 계산 engine 도입
- 모든 currency/calendar/physical unit 선제 지원
- frontend 화면/상태/정보구조 자동 변경
- 이름 기반 좌표를 canonical 사실로 즉시 backfill
- Zod/Pydantic에서 DDL 생성 또는 DB row에서 HTTP schema 생성
