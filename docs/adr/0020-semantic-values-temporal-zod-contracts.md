# 0020 — 의미 있는 값 타입, Temporal, Zod wire 계약

- Status: Accepted
- Date: 2026-08-30
- Supersedes: 없음

## Context

입찰 분석은 시각, 금액, 투찰률, 표본 수, 바이트 길이, 좌표처럼 단위가 다른 값을 결합한다.
그런데 일반 `number`, `string`, `Date`만 사용하면 `90.1`이 퍼센트포인트인지 비율인지,
`30`이 초인지 밀리초인지, 금액 문자열의 통화와 소수 자릿수가 무엇인지 타입과 계약이 설명하지
못한다. 실제 레거시에는 `double precision` 비율, `bigint`의 JavaScript `number` mapping,
수동 KST offset, `Date.now()`, 기초금액과 투찰률을 부동소수점으로 곱하는 코드가 공존한다.

Node `24.20.0`에는 전역 Temporal이 없지만 Temporal은 Stage 4이고 Node 26부터 기본 제공된다.
브라우저 지원이 모두 같지 않으므로 지금 `Date`를 계속 확산시키거나 전역 polyfill에 애플리케이션을
묶지 않고, 삭제 가능한 호환 경계가 필요하다. HTTP 계약은 이미 Zod 4와 Nest Standard Schema를
권위로 사용하므로 값의 wire 표현도 같은 계약에서 검증해야 한다.

## Decision

### 값의 소유권

- `packages/domain`이 framework-free 의미 타입과 불변식, 계산 정책을 소유한다. Nest, Effect,
  Drizzle, Zod, HTTP를 import하지 않는다.
- `packages/contracts`가 공개 HTTP의 Zod wire schema를 소유한다. TypeScript wire type은
  `z.input`/`z.output`에서만 파생하고 같은 interface를 손으로 다시 쓰지 않는다.
- `packages/db`는 Drizzle DDL과 DB 표현을 소유한다. Zod에서 DDL을 생성하지 않고 DB row schema를
  HTTP 계약으로 공개하지 않는다.
- Python dataplane은 source/normalized 경계의 Pydantic 모델과 `Decimal`, timezone-aware `datetime`을
  소유한다. TypeScript schema를 생성해 이 권위를 대체하지 않는다.
- 언어 간 일치는 canonical JSON fixture와 DB/API integration test로 증명한다.

### 시간

- 절대 시점은 `Temporal.Instant`, 업무상 달력 날짜는 `Temporal.PlainDate`, 지역 시각이 실제 의미일
  때만 `Temporal.ZonedDateTime`을 사용한다. calendar 기간은 `Temporal.Duration`이다.
- 타임아웃·재시도 간격처럼 경과 시간은 calendar duration과 분리한 branded
  `ElapsedMilliseconds`다. `milliseconds()`, `seconds()`, `minutes()`, `hours()` factory로만 만든다.
- 현재 Node/browser 호환 경계는 exact `temporal-polyfill@1.0.4`의 side-effect-free import 하나다.
  global monkey patch를 하지 않는다. 이 import는 native Temporal이 있으면 native를 사용하므로
  Node 26 LTS 전환 뒤 consumer API를 바꾸지 않는다.
- 현재 시각은 application에 주입한 `Clock`만 읽는다. domain/application에서 `Temporal.Now`,
  `Date.now()`, `new Date()`를 직접 호출하지 않는다.
- HTTP timestamp는 UTC `Z`가 붙은 canonical ISO 8601 문자열, 업무 날짜는 `YYYY-MM-DD`, PostgreSQL은
  `timestamptz`/`date`를 사용한다. source 지역 시각은 IANA `Asia/Seoul`로 해석한 뒤 Instant로 바꾼다.
- Drizzle이나 UI 라이브러리가 `Date`를 요구하는 경계는 명명한 adapter에서 즉시 변환하고 정적
  예외 ledger에 이유와 제거 조건을 남긴다.

### 정량 값

- 금액은 `{ amount, currency }` 쌍이다. 1차 currency는 source가 증명하는 `KRW`만 허용하고 amount는
  지수 표기 없는 canonical nonnegative decimal string이다. PostgreSQL `numeric`과 Python `Decimal`이
  정확 계산의 권위이며 TypeScript `number`로 금액 계산을 하지 않는다.
- `BidRate`, `FloorRate`, `PercentagePoints`, `Ratio`, `SharePercent`를 구분한다. 퍼센트포인트와
  0..1 비율을 암묵 변환하지 않고 PostgreSQL `numeric`/canonical decimal string으로 보존한다.
- `sample_n`, 실행 completeness count처럼 의미가 다른 count는 목적별 타입을 사용한다. DB `bigint`는
  Drizzle `mode: "bigint"`로 읽고 잠재적으로 큰 HTTP 값은 ADR 0018과 같은 canonical decimal string으로
  표현한다. 안전한 UI count만 bounded safe integer number를 허용한다.
- byte length는 `ByteLength`, payload limit은 `PayloadByteLimit`으로 구분한다. Node API에 넘길 때만
  명시적으로 safe integer number로 변환한다.
- 좌표는 `Latitude`, `Longitude`, `Coordinate`와 CRS `EPSG:4326`을 함께 가진다. 거리는 `Meters`다.
  위치에는 출처, 관측 시각, 정확도/해소 상태를 함께 저장하며 이름 기반 좌표를 canonical 기관 사실로
  조용히 승격하지 않는다.
- `expWin`처럼 합성 단위는 일반 `Rate`가 아니라 `AwardsPerSupplierYear`처럼 분자와 분모를 이름과
  계약에 드러낸다.

### Zod 계약

- atomic wire schema는 `packages/contracts/src/primitives`에 시간, 금액, 비율, 수량, 좌표별 파일로
  나눈다. 모든 object는 bounded strict schema이고 metadata/example을 가져 OpenAPI로 투영된다.
- wire schema가 공개 직렬화 형태의 유일한 권위다. Zod codec은 그 wire schema와 domain constructor를
  결합한 인접 adapter이며 별도 regex/range를 복제하지 않는다.
- OpenAPI는 codec의 runtime object가 아니라 serializable wire schema에서 생성한다. controller는
  DB row나 Temporal instance를 JSON으로 직접 반환하지 않는다.
- exact `zod@4.5.4`를 workspace의 직접 사용처에 동일하게 고정하고 frozen lockfile과 Nest/OpenAPI
  compatibility test를 통과시킨다. 다음 patch도 자동 범위 수신하지 않는다.

### 강제와 전환

- AST gate가 새 코드의 `Date`/ambient clock, 금지된 date library import, raw timer literal, 금액/비율의
  부동소수점 DDL, `bigint mode: "number"`를 검사한다.
- legacy web/`packages/shared`의 기존 위반은 exact occurrence ledger로 동결한다. 새 예외는 ADR 또는
  명시된 adapter boundary 없이 추가할 수 없다.
- 신규 server와 `packages/domain`/`contracts`/`db`/dataplane을 먼저 전환한다. frontend 동작 변경과
  레거시 제거는 사용자와 별도 기획한 cutover에서 수행한다.

## Consequences

- API 소비자는 금액·비율·잠재적으로 큰 count를 number가 아닌 canonical 문자열/구조로 다루지만
  정밀도와 단위가 보존된다.
- DB, Python, TypeScript의 모델은 동일 파일을 공유하지 않지만 각 경계의 권위와 derivation 방향이
  명확해지고 golden fixture로 drift를 검출한다.
- polyfill 의존성은 한 package에 국한되고 native Temporal 전환이 소비자 변경을 요구하지 않는다.
- chart나 지도 library가 number/Date를 요구하면 presentation adapter에서 근사값을 만들 수 있으나
  그 값으로 canonical 판단이나 금액 계산을 하지 않는다.
- 초기 파일 수와 mapping 코드가 늘지만 서로 다른 단위가 우연히 계산되는 오류를 컴파일/계약/DB
  gate에서 더 일찍 막는다.

## Rejected alternatives

- `mw-auction`처럼 모든 시간 factory가 일반 millisecond `number`를 반환: 가독성은 좋아져도 단위 혼합을
  타입이 막지 못한다.
- `Date`, Day.js, date-fns, Moment, Luxon을 application 시간 권위로 사용: Temporal 전환 경계가 다시
  여러 곳에 생기고 달력 날짜/절대 시점/지역 시각이 섞인다.
- 전역 Temporal polyfill 설치: bootstrap 순서와 test/runtime global 상태에 숨은 결합이 생긴다.
- 모든 값을 하나의 generic unit runtime class로 감싸기: 현재 필요한 입찰 도메인보다 추상화가 크고
  직렬화/ORM 마찰을 늘린다.
- 금액과 비율을 JavaScript `number`로 계산: 부동소수점 오차와 단위 혼합을 canonical 사실에 전파한다.
- Zod/Pydantic에서 Drizzle DDL을 생성하거나 OpenAPI를 다시 코드 생성의 원본으로 사용: 권위 방향이
  순환하고 각 경계의 실제 제약이 사라진다.
