# 0033 — 투찰·낙찰·업체 core 테이블과 개찰 연도 range 파티션

- Status: Accepted
- Date: 2026-09-06
- Supersedes: 없음. [0029](0029-eat-v2-bid-list-contract.md)가 EAT-43으로 넘긴 후속 결정 넷을 닫는다.

## Context

`eat-v2` 상세 계약([ADR 0029](0029-eat-v2-bid-list-contract.md))이 `ds_bidList`·`ds_pList`·
`ds_bidHistory`를 정규화 모델에 들였지만 그 값을 받을 `core` 테이블이 없다. `PROJECTABLE_RECORD_TYPES`가
`auction.v1` 하나라서 v2 record는 발행 경로에 닿으면 typed 실패로 멈춘다
(`apps/dataplane/src/eatbid/core/record_types.py`). 결과적으로 명단·낙찰·업체는 격리·리포트용으로만
존재하고 제품이 읽을 권위 저장소에는 한 행도 없다.

`docs/architecture/domain-and-data.md` §3.3·§3.4가 요구하는 `SupplierParty`,
`SourceSupplierAccount`, `BidSubmission`, `AwardDecision`이 `packages/db/src/schema/core`에 없고,
§3.1이 요구하는 재입찰 관계도 `AuctionRelation` 이름으로만 문서에 있다.

규모는 추정이 아니라 실측이다. `docs/ARCH-DATA.md` §9는 5년 전국 적재를 492 B/행 · 41.4행/공고 ·
2,330만 행 · 약 14 GB로 재고, 레거시 적재가 724만→915만 행 구간에서 9분→27분으로 비선형이 되는 것을
같은 문서 §6·§7이 기록한다. `docs/evidence/normalization/2026-09-04-eat-v2-renormalization.md`
(계산 버전 `eat-v2-r3`, 표본 238,308)는 명단 행 총 11,080,463, 회차당 평균 46.5 · 중앙 15 · 최대 413,
개찰 기간 2023-09-01~2026-09-03을 준다. 한 테이블에 3천만 행을 쌓고 나서 나누는 것과 처음부터 나누는
것의 차이가 정확히 저 27분이다.

**결측도 실측했다**(계산 버전 `eat-v2-r4-eat43`, 레이크 전수 238,308 파일, 2026-09-06). 정규화에
성공한 238,300 회차 가운데 `schedule.openedAt`이 없는 회차는 **0건**이고, 명단 행 11,080,463 가운데
`BIZ_NO`를 관측하지 못한 행도 **0건**이다. 그럼에도 아래 3절의 `opened_at`은 nullable로 남기고 1절의
party 승격 규칙은 사업자번호 없는 계정 경로를 갖는다. 근거는 지금의 0건이 아니라 소스가 두 필드를
보장하지 않는다는 사실이며, 미래 관측 한 건의 결측이 발행 전체를 격리시키는 위험을 0건이 없애 주지
않는다(AGENTS 3).

동시에 지켜야 할 경계가 둘 있다.

- **원본 판정이 권위다.** `BID_STT`는 전수 11,080,463행에서 `002`(낙찰)와 `005`(낙찰실패) 둘뿐이고
  소스는 "무효"도 "하한 미달"도 판정하지 않는다(`domain-and-data.md` §3.4). 우리가 계산한 실효하한으로
  이 판정을 덮으면 관측이 아닌 것이 관측 자리에 앉는다.
- **projector는 봉인된 발행 manifest만 소비한다.** [ADR 0010](0010-append-only-observations-and-revisions.md)의
  원자 활성화와 [ADR 0015](0015-canonical-projection-lineage.md)의 lineage가 이미 그렇게 되어 있고,
  명단이 들어와도 그 경계는 넓히지 않는다.

**code scheme 이름은 EAT-61이 이미 정했다.** 소스 column명(`BID_STT`·`SHIPPER_CD`)이 아니라 의미
이름이 namespace이고, column명은 관측 위치를 말하는 메타데이터로
`apps/dataplane/src/eatbid/source/eat/code_schemes.py`가 갖는다([ADR 0006](0006-identifiers-and-code-schemes.md),
AGENTS 2). 이 ADR이 쓰는 이름은 `eat:supplier-account`(`SHIPPER_CD`),
`eat:business-number`(`BIZ_NO`), `eat:bid-status`(`BID_STT`), `eat:withdrawal-flag`(`WITHDRAWAL_YN`),
`eat:attempt-status`(`ETN_BID_STT`)이며 권위는 `packages/db/src/seeds/code-schemes.ts`의
`builtinCodeSchemes`와 위 Python 표다.

**아직 열려 있는 것 하나.** 남산초 회차의 원본 XML을 저장소에 커밋해 CI에서도 실데이터 대조를 할지는
**사용자 결정 대기**다. 그 XML에는 실제 사업자등록번호와 업체명이 들어 있다. 기본값은 커밋하지 않는
것이고, 그러면 CI 대조는 합성 fixture(`apps/dataplane/tests/fixtures/eat/bid-detail-roster.xml`)로 하고
실데이터 대조는 레이크가 있는 기계의 `-m lake` 테스트 전용으로 남는다. 이 ADR의 나머지 결정은 그 답과
무관하게 성립한다.

## Decision

### 1. 다섯 테이블

모든 PK/FK는 PostgreSQL `bigint`이고 시간은 전부 `timestamptz`(UTC 저장)다. 외부 코드는 어디서도
문자열로 조인하지 않고 `(source_system, code_scheme, code)`로 수신해 `core.code_value`의 내부 id로
해소한다(AGENTS 2, [ADR 0006](0006-identifiers-and-code-schemes.md)).

#### `core.supplier_party`

법적 사업자 정체성이다. `core.organization`과 같은 모양을 쓴다.

| 열 | 타입 | 비고 |
|---|---|---|
| `supplier_party_id` | `bigint` identity PK | |
| `type` | `varchar(32)` not null | 신규는 `'unknown'`. 라벨에서 승격하지 않는다 |
| `canonical_name` | `text` null | 관측 업체명은 여기가 아니라 code label observation이다 |
| `business_number_code_value_id` | `bigint` null, unique, FK `code_value` | `eat:business-number` 관측이 있을 때의 법적 정체성 |
| `created_at` | `timestamptz` not null default now() | |

업체명(`SHIPPER_NM`)은 `core.code_label_observation`에 `language='und'`로 남는다. 기관과 같은 규칙이며
이름 변경이 정체성 변경이 아니다.

#### `core.source_supplier_account`

소스별 참여 계정이다. `core.organization_identifier`와 같은 역할을 한다.

| 열 | 타입 | 비고 |
|---|---|---|
| `source_supplier_account_id` | `bigint` identity PK | |
| `supplier_party_id` | `bigint` not null FK | |
| `source_system` | `varchar(64)` not null | |
| `account_code_value_id` | `bigint` not null, unique, FK `code_value` | `eat:supplier-account` |
| `observation_id` | `bigint` not null FK `ingest.raw_observation` | 승격 근거 |

추가로 `unique(source_supplier_account_id, supplier_party_id)`를 둔다. 명단 행이 party를 비정규화해
들고 있어도 계정과 party의 짝이 흔들리지 않게 복합 FK의 대상이 되기 위해서다.

**party 승격 규칙.** 레이크 전수에서 `BIZ_NO` 결측은 **0건**이지만(위 Context) 아래 규칙은 결측 경로를
그대로 갖는다. `eat:business-number` 관측이 있으면 그 code value가 party의 유일 키이고, 같은
사업자번호를 가진 여러 `eat:supplier-account` 계정은 한 party에 붙는다. 사업자번호가 없으면 그 계정이
자기 party를 갖는다. 나중에 사업자번호가 관측되어 둘이 같은 사업자로 밝혀져도 **자동 병합하지 않는다.**
병합은 `code_mapping`과 같은 급의 명시적 reconciliation이며 이 ADR의 범위 밖이다(AGENTS 3).

#### `core.bid_submission` (개찰 연도 range 파티션)

| 열 | 타입 | 비고 |
|---|---|---|
| `bid_submission_id` | `bigint` generated always as identity | 파티션 전체가 한 sequence를 공유한다 |
| `auction_revision_id` | `bigint` not null FK | 관측 단위. append-only grain의 주인 |
| `auction_attempt_id` | `bigint` not null | 복합 FK로 revision의 attempt와 일치를 강제 |
| `opened_at` | `timestamptz` null | **파티션 키.** revision의 개찰 시각을 복사한다 |
| `roster_ordinal` | `integer` not null | `ds_bidList` 관측 행 순서(0-based) |
| `source_supplier_account_id` | `bigint` not null | |
| `supplier_party_id` | `bigint` not null | 복합 FK로 계정과의 짝을 강제 |
| `submitted_at` | `timestamptz` null | `BID_DT` |
| `amount` | `numeric(18,2)` not null | `BID_CALC_AMT` 관측 그대로. 44%가 자리표시자다 |
| `effective_amount` | `numeric(18,2)` null | `EFT_ALL_AMT` |
| `currency` | `char(3)` not null | |
| `bid_rate` | `numeric(15,3)` not null | `ObservedBidRate`. 아래 2절 |
| `rank` | `integer` null | `RNK` |
| `source_status_code_value_id` | `bigint` not null FK `code_value` | `eat:bid-status` |
| `withdrawal_code_value_id` | `bigint` null FK `code_value` | `eat:withdrawal-flag` |
| `draw_numbers` | `text[]` not null default `'{}'` | `DRAW_NO`. 조인 키가 아닌 관측값 |
| `observed_roster_size` | `integer` null | `TOTAL_NUM` |
| `observation_id` | `bigint` not null FK | |

제약:

- `unique nulls not distinct (auction_revision_id, roster_ordinal, opened_at)` — 발행 grain
- `unique nulls not distinct (bid_submission_id, opened_at)` — 대리키의 유일성
- `foreign key (auction_revision_id, auction_attempt_id) references core.auction_revision (auction_revision_id, auction_attempt_id)`
  (그 대상 unique를 `auction_revision`에 새로 만든다)
- `foreign key (source_supplier_account_id, supplier_party_id) references core.source_supplier_account (...)`
- 인덱스 `(auction_attempt_id)`, `(supplier_party_id, opened_at)`

**`won boolean`도, 계산된 실효하한도, "무효" 컬럼도 두지 않는다.** 그날 하한과 하한 미만 수는 하한율과
추첨 결과에서 나오는 파생 계산이며 `mart`가 표본 수·코호트·계산 버전과 함께 발표한다
(`domain-and-data.md` §3.4, AGENTS 7·8). 이 금지는 문장이 아니라 열 목록 테스트로 고정한다.

#### `core.award_decision`

| 열 | 타입 | 비고 |
|---|---|---|
| `award_decision_id` | `bigint` identity PK | |
| `auction_revision_id` | `bigint` not null, **unique**, FK | revision당 낙찰 판정 0 또는 1 |
| `auction_attempt_id` | `bigint` not null | 복합 FK |
| `awarded_roster_ordinal` | `integer` not null | 같은 revision의 명단 행 좌표. FK가 아니다(4절) |
| `supplier_party_id` / `source_supplier_account_id` | `bigint` not null | |
| `awarded_at` | `timestamptz` null | `SUCBD_DT`는 **날짜 정밀도**다. 같은 날 안의 선후를 이 값으로 판단하지 않는다 |
| `awarded_amount` | `numeric(18,2)` not null | |
| `currency` | `char(3)` not null | |
| `awarded_rate` | `numeric(15,3)` not null | |
| `runner_up_rate` | `numeric(15,3)` null | 원본 `RNK=2` 행의 값이지 "유효 투찰 중 2등"이 아니다 |
| `source_status_code_value_id` | `bigint` not null FK | `eat:bid-status` = `002` |
| `observation_id` | `bigint` not null FK | |

`unique(auction_revision_id)`의 근거는 전수 리포트의 `multiple_award_rows = 0`이다. 위반이 관측되면
격리이지 두 행이 아니다.

#### `core.auction_attempt_link`

`domain-and-data.md` §3.1이 `AuctionRelation`으로 부르던 재입찰 관계다. **DDL과 문서가 한 이름을 쓰도록
테이블 이름을 `core.auction_attempt_link`로 확정하고 §3.1의 `AuctionRelation`을 같은 이름으로 고친다.**
그리고 **이 ADR이 EAT-43의 열린 결정 `AttemptLink.externalBidId` 타입을 닫는다: core에서는 외부 문자열을
관계 키로 쓰지 않고 내부 attempt id로만 잇는다.**

| 열 | 타입 | 비고 |
|---|---|---|
| `auction_attempt_link_id` | `bigint` identity PK | |
| `auction_revision_id` | `bigint` not null FK | 이 관계를 관측한 revision |
| `from_auction_attempt_id` | `bigint` not null FK | revision의 attempt |
| `to_auction_attempt_id` | `bigint` not null FK | 사슬 상대 |
| `relation` | `varchar(32)` not null | check `in ('parent','chain_member')` |
| `display_bid_no` | `text` null | 표시값. 접미사를 차수로 읽지 않는다 |
| `source_status_code_value_id` | `bigint` null FK | `eat:attempt-status` |
| `bid_opened_from` / `bid_closed_at` | `timestamptz` null | |
| `base_amount` / `planned_amount` | `numeric(18,2)` null | |
| `currency` | `char(3)` null | 금액이 있으면 not null인 check |
| `observation_id` | `bigint` not null FK | |
| | `unique(auction_revision_id, to_auction_attempt_id, relation)` | |

**아직 수집하지 않은 상대 공고는 `core.auction_attempt`에 identity 전용 행(`source_system`,
`external_bid_id`만)으로 먼저 만든다.** `auction_attempt`은 이미 revision 없이 존재할 수 있는 모양이고,
사슬의 상대를 문자열로 들고 있다가 나중에 잇는 것보다 지금 내부 id를 발급하는 편이 낫다.

**그래서 "revision이 0개인 `auction_attempt`"는 유효한 상태다.** "관계로만 알려진 공고"라는 뜻이며 오류가
아니다(AGENTS 3). 대신 **공고 수를 세는 질의와 공개 API는 revision의 존재를 조건으로 삼는다.**
`auction_attempt`을 그냥 세면 아직 관측하지 못한 사슬 상대까지 공고로 발표하게 된다. 이 규칙은
`domain-and-data.md` §3.1이 함께 소유한다.

### 2. `ObservedBidRate`의 DB 표현: `numeric(15,3)`

`SAJEONG_PCT`는 정수부 최대 12자리 · 소수 3자리이고 상한이 없다
(`docs/architecture/time-and-value-contracts.md` §4, 관측 최대 44,477,738.05). `numeric(6,3)`에 들어가지
않는다. `core`와 `mart` 모두 `numeric(15,3)`을 쓴다. 공개 API의 `BidRate`(0~100, `numeric(6,3)`)는
그대로 두며, 낙찰 행의 사정률이 100을 넘는 공고가 전수에서 0건이라는 관측이 그 근거다. **이 결정이
ADR 0029가 EAT-43에 넘긴 "ObservedBidRate의 mart 표현"을 닫는다.**

### 3. 파티션

**PostgreSQL 16에서 실제로 검증한 제약 위에 설계한다**(`postgres:16-alpine` 일회용 인스턴스, 2026-09-06).

| 검증한 것 | 결과 |
|---|---|
| 파티션 테이블의 `generated always as identity` | 동작한다. sequence는 파티션 전체가 공유한다 |
| 파티션 키를 뺀 PK/unique | 거부. `unique constraint on partitioned table must include all partitioning columns` |
| 파티션 키가 NULL인 행 | `DEFAULT` 파티션으로 라우팅된다 |
| `unique nulls not distinct` + 파티션 키 포함 | 동작하고 NULL 중복도 막는다 |
| 부모 arbiter로 `on conflict ... do nothing` | 동작한다 |
| 부모에 만든 인덱스 | 자식으로 전파된다 |
| `DEFAULT`에 해당 연도 행이 있는 상태의 연도 파티션 추가 | **거부된다.** detach → create → 이동 → reattach 필요 |
| `(bid_submission_id, opened_at)`을 참조하는 FK | 동작한다(파티션 키가 nullable이어도) |

**파티션 키는 `opened_at`이고 nullable이며 `DEFAULT` 파티션을 둔다.** 개찰 시각이 관측되지 않은 명단이
한 건이라도 있으면 `not null`은 그 발행 전체를 격리시킨다. ADR 0029가 `required` 집합을 좁게 잡은 것과
같은 이유이며, 관측하지 못한 것을 이유로 관측한 것을 버리지 않는다(AGENTS 3). `DEFAULT`는 미래 연도가
파티션보다 먼저 도착하는 경우도 함께 받는다.

레이크 전수의 개찰 시각 결측은 **0건**이다(위 Context, 정규화 성공 238,300 회차). **결측이 0건으로
나왔지만 `not null`로 좁히지 않는다.** 미래 관측 한 건의 결측이 발행 전체를 격리시키는 위험이
PK 예외 하나보다 크다는 판단이며, 이 판단은 지금 측정한 숫자가 아니라 소스가 그 필드를 보장하지
않는다는 사실에 근거한다.

**PK를 두지 않는다.** nullable 파티션 키는 PK가 될 수 없고, PK를 위해 `opened_at`을 `not null`로
만들면 위 결정을 뒤집는다. 대신 `unique nulls not distinct` 둘이 대리키와 발행 grain을 각각 지킨다.
`packages/db/src/schema/core/canonical.test.ts`의 "독립 identity가 있는 모든 fact에 generated bigint
primary key" 규칙에 파티션 테이블 예외를 **명시적으로** 적고, 그 예외가 이 테이블 하나임을 같은
테스트가 고정한다.

**경계는 KST 연도다.** `from ('2025-01-01 00:00:00+09') to ('2026-01-01 00:00:00+09')`. 개찰 연도는
업무 개념이고 한국 시간으로 센다. 저장은 UTC이므로 경계 문자열에 offset을 적어 UTC 자정과 9시간
어긋나는 것을 의도로 남긴다.

**초기 커버리지**는 2023~2027 다섯 연도 + `DEFAULT`다. 레이크 개찰 기간이 2023-09-01부터이고
(전수 리포트) 앞으로 한 해를 미리 연다.

**Drizzle과의 공존.** Drizzle 1.0-rc는 `PARTITION BY`를 표현하지 못한다. 그래서:

1. TypeScript schema는 `core.bid_submission`을 **평범한 테이블**로 선언한다. 열·FK·인덱스·unique는
   전부 Drizzle이 소유한다.
2. `drizzle-kit generate`가 만든 `migration.sql`의 `CREATE TABLE` 문 끝에 `PARTITION BY RANGE ("opened_at")`를
   붙이고, 그 뒤에 `CREATE TABLE ... PARTITION OF ...`를 손으로 잇는다.
3. `snapshot.json`은 손대지 않는다. 이미 `20260901063015_source_release_seal_guards`가 trigger·function을
   같은 방식으로 얹었고, Drizzle은 DB를 읽지 않으므로 snapshot과 실제 DDL의 이 차이가 다음 generate를
   오염시키지 않는다.
4. 손으로 얹은 부분이 조용히 사라지지 않도록, 마이그레이션 SQL 자체를 읽어 `PARTITION BY RANGE`와
   연도 파티션 목록을 단언하는 테스트를 `packages/db/src`에 둔다.

`db:push`는 여전히 금지이고 `packages/db` 밖에서 DDL을 만들지 않는다([ADR 0009](0009-drizzle-owns-ddl.md)).

**연도 추가 절차**도 마이그레이션이다. 새 마이그레이션 폴더 하나가 한 트랜잭션에서 다음을 한다.

```sql
ALTER TABLE "core"."bid_submission" DETACH PARTITION "core"."bid_submission_unpartitioned";
CREATE TABLE "core"."bid_submission_2028" PARTITION OF "core"."bid_submission"
  FOR VALUES FROM ('2028-01-01 00:00:00+09') TO ('2029-01-01 00:00:00+09');
INSERT INTO "core"."bid_submission" OVERRIDING SYSTEM VALUE
  SELECT * FROM "core"."bid_submission_unpartitioned"
  WHERE "opened_at" >= '2028-01-01 00:00:00+09' AND "opened_at" < '2029-01-01 00:00:00+09';
DELETE FROM "core"."bid_submission_unpartitioned"
  WHERE "opened_at" >= '2028-01-01 00:00:00+09' AND "opened_at" < '2029-01-01 00:00:00+09';
ALTER TABLE "core"."bid_submission" ATTACH PARTITION "core"."bid_submission_unpartitioned" DEFAULT;
```

detach 없이 `CREATE TABLE ... PARTITION OF`만 하면 `DEFAULT`에 해당 연도 행이 하나라도 있을 때
PostgreSQL이 거부한다. 위에서 실측한 그대로다. 이 순서를 문서가 아니라 마이그레이션 파일이 소유한다.

### 4. 불변식

**(가) 원본 판정이 권위이고 우리 계산으로 덮지 않는다.**
`bid_submission.source_status_code_value_id`는 `eat:bid-status` scheme의 code value만 가리키고, `core`에는
"무효", "하한 미달", "실효하한", `won boolean` 중 무엇도 열로 존재하지 않는다. 하한율은
`auction_revision`의 조건이고 그날 하한은 `mart`의 파생 계산이다. 열 목록을 고정하는 테스트가 이
금지의 집행자다.

**(나) projector는 발행 manifest만 소비하고 한 트랜잭션에서 발행한다.**
명단·낙찰·사슬 행은 `ingest.publication_record`가 고정한 `normalized_record_id` 집합에서만 나온다.
`PsycopgCanonicalProjectionRepository._project_locked`가 이미 잡고 있는 잠금·검증 안에서 같은 커서로
쓰며, publication 상태 전이(`validated` → `published`)와 같은 트랜잭션이다
([ADR 0010](0010-append-only-observations-and-revisions.md) 원자 활성화).
`canonical_projection_fingerprint`의 정의는 바꾸지 않는다. 지문은
`(source_system, external_bid_id, raw_content_sha256, parser_version, normalized_payload_sha256)`만 쓰므로
명단을 더해도 이미 봉인된 `eat-v1` 발행물의 지문이 흔들리지 않는다.

**(다) 재발행은 upsert 멱등이고 삭제-재삽입이 아니다.**
`on conflict (auction_revision_id, roster_ordinal, opened_at) do nothing` 뒤 기존 행을 읽어 값이 같은지
검증하고 다르면 `ProjectionContractError`로 끊는다. 지금 `CanonicalProjectionWriter`가 revision·관계에
쓰는 insert-or-verify와 같은 모양이다. 삭제-재삽입을 고르지 않는 이유는 셋이다. 봉인된 발행물의
append-only 계약([ADR 0014](0014-normalization-attempt-lineage.md)·[0025](0025-source-release-manifest.md))과
어긋나고, `DEFAULT` 파티션 detach 중의 삭제는 원자성을 잃으며, 부분 삭제 후 실패하면 현재 공개 뷰가
비어 버려 AGENTS "부분 수집 결과로 현재 공개 뷰를 덮어쓰지 마라"를 정면으로 어긴다.

**(라) 낙찰 행은 명단 행을 FK로 가리키지 않는다.**
`award_decision.awarded_roster_ordinal`은 같은 revision 명단의 관측 좌표이지 참조 무결성 관계가 아니다.
파티션 테이블을 참조하는 FK는 동작하지만(실측), 연도 추가 때마다 하는 `DETACH`/`ATTACH`가 그 FK와
씨름하게 된다. 운영 절차의 단순함을 참조 무결성보다 위에 둔다. 대신 projector가 같은 트랜잭션에서
좌표의 존재와 그 행의 판정 코드가 `002`인지 검증한다.

### 5. `auction.v2`를 발행 가능하게 연다

`PROJECTABLE_RECORD_TYPES`에 `auction.v2`를 더한다. v1 record에는 명단이 없으므로 v1 발행은 지금
그대로 `auction_attempt`/`auction_revision`만 쓰고, v2 발행만 다섯 테이블에 닿는다. 한 publication 안에
두 record type이 섞이는 것은 계약 위반이며 `run.parser_version`이 이미 그것을 막는다.

### 6. 후속 결정(2026-09-06) — 하한율과 공고 조건 코드를 `core`로 올린다

§4-가는 "하한율은 `auction_revision`의 조건"이라고 적었지만 이 ADR을 받은 시점의 저장소에서는 아직
참이 아니었다. 하한율(`PLNPRCE_SUCBD_STD`)과 낙찰 방식(`SUCBID_DCSN_MTH_CD`), 예정가격 방식
(`PLNPRC_TYPE_CD`)이 `auction_revision.source_payload` jsonb의 `terms` 경로에만 있었기 때문이다. 화면의
코호트 키가 jsonb 경로 문자열에 묶이면 계약이 바뀐 날 아무 제약도 그것을 막지 못한 채 조용히 null이
된다(AGENTS 3·15). 그래서 EAT-64에서 `core.auction_revision`에 `floor_rate numeric(6,3)`(null 허용, 관측
그대로) 열을 더하고, 낙찰 방식·예정가격 방식은 새 표 없이 기존 `core.auction_revision_code_value`의 role
`award_method`·`planned_price_method`로 잇는다(role check 제약 확장). 코드 체계는
`eat:award-method`·`eat:planned-price-type`이며 v2 projector가 `record.terms`에서 채운다. v1 record에는
`terms` 블록이 없으므로 v1 발행은 `floor_rate`가 null이고 두 role 관계를 만들지 않는다. 이 승격으로
§4-가의 문장이 참이 되며, 실효하한은 여전히 `mart`의 파생 계산으로 남아 `core`에 열로 존재하지 않는다.

## Consequences

- 2,330만 행이 개찰 연도로 나뉜다. 결정 화면의 주 질의(기관/업체의 최근 회차)가 연도 파티션 하나 또는
  둘만 훑는다. 백필 재적재도 연도 단위로 끊어진다.
- `DEFAULT` 파티션이 커지면 그것이 신호다. 개찰 시각을 관측하지 못한 명단이 쌓이고 있다는 뜻이므로
  행 수를 관측 대상으로 둔다(§8 단조성 단언과 같은 급).
- 연도 추가를 잊으면 데이터가 사라지지 않고 `DEFAULT`로 들어간다. 다만 그 뒤의 연도 파티션 추가는
  detach/이동/reattach가 되어 비싸진다. 미리 한 해를 여는 이유다.
- `bid_submission_id`에 구멍이 생긴다. 충돌로 건너뛴 insert도 sequence를 소비한다(실측). id는 순번이
  아니라 정체성이므로 문제가 아니다.
- revision-scoped grain이라 소스 정정으로 새 revision이 생기면 명단이 한 벌 더 쌓인다. 이것이
  append-only의 의도이고, 현재 뷰는 최신 revision을 고르는 질의가 만든다.
- `core.auction_attempt`에 revision 0개인 행이 생긴다. "관계로만 알려진 공고"를 세는 질의는 이 상태를
  알아야 하고, 공고 수 집계는 revision 존재를 조건으로 써야 한다.
- 파티션 자식 테이블도 `core` 스키마의 관계이므로 `infra/product/db-provisioning.sql`의 default
  privileges와 서버 readiness 계약(`relkind in ('r','p',...)`)이 함께 본다. 연도 파티션을 더하는
  마이그레이션은 권한도 함께 따라오는지 확인 대상이다.
- `packages/db/src/schema/core/procurement.ts`와 `core/canonical.test.ts`,
  `apps/dataplane/src/eatbid/core/postgres_projection_writer.py`가 AGENTS 18 경계를 넘는다. 새 기능을
  더하기 **전에** 나눈다.

## Rejected alternatives

- **파티션 없이 단일 테이블로 두고 나중에 나눈다** — 3천만 행을 옮기는 마이그레이션이 되고,
  `docs/ARCH-DATA.md` §6이 잰 27분짜리 재적재를 감수해야 한다. 나누는 비용은 지금이 가장 싸다.
- **`auction_attempt_id` 해시로 파티션한다** — 질의가 시간축이다. 해시는 모든 파티션을 훑게 만들고
  보존·아카이브 단위도 주지 않는다.
- **`opened_at`을 `not null`로 만들고 개찰 시각 없는 명단을 격리한다** — 관측하지 못한 필드 하나로
  관측한 명단 전체를 버린다. ADR 0029가 `required`를 좁게 잡은 판단과 같은 이유로 기각한다.
- **`opened_at` 대신 `opened_year smallint` 파생 열을 파티션 키로 둔다** — 여전히 개찰 시각이 없으면
  값이 없고, 원본에 없는 열을 하나 더 만들 뿐이다. 범위 질의도 `opened_at`으로 다시 써야 한다.
- **재발행을 publication 단위 삭제-재삽입으로 한다** — 봉인된 발행물의 append-only 계약과 어긋나고,
  부분 실패가 현재 공개 뷰를 비운다.
- **명단을 attempt-scoped로 두고 revision마다 덮어쓴다** — "소스가 바뀐 것"과 "우리 해석이 바뀐 것"을
  구분할 수 없게 된다. ADR 0010이 이미 기각한 모양이다.
- **`draw_numbers`를 자식 테이블로 정규화한다** — 파티션 부모를 참조하는 FK를 하나 더 만들고,
  관측 최대가 2개인 값을 위해 1,100만 행짜리 테이블을 추가한다. `mart`가 필요하면 거기서 푼다.
- **업체명을 `supplier_party.canonical_name`으로 승격한다** — 기관에서 이미 기각한 것과 같다.
  `PURR_NM`처럼 `SHIPPER_NM`도 라벨 관측이지 정체성이 아니다.
- **사슬 상대를 외부 문자열(`external_bid_id`)로 들고 있다가 나중에 잇는다** — 문자열을 관계 키로 쓰는
  것이고(AGENTS 2), 상대가 수집될 때까지 관계가 조인 불가능한 채로 남는다.
- **code scheme namespace를 소스 column명(`eat:BID_STT`)으로 둔다** — 소스가 column을 바꾸면 정체성이
  바뀐다. EAT-61이 의미 이름으로 이미 정리했다.

## 영향받는 문서

| 문서 | 무엇을 고치나 |
|---|---|
| `docs/architecture/domain-and-data.md` | §3.1 재입찰 관계 테이블 이름과 revision 0개 attempt 규칙, §3.3 party 승격 규칙, §3.4 확정된 열과 파티션 |
| `docs/architecture/time-and-value-contracts.md` | `ObservedBidRate`의 DB 표현 `numeric(15,3)` 확정 |
| `docs/architecture/runtime-and-deployment.md` | 연도 파티션 추가가 마이그레이션 lane임을 명시 |
| `docs/adr/README.md` | 0033 행 추가 |
| `docs/adr/0029-eat-v2-bid-list-contract.md` | 후속 목록의 EAT-43 항목 넷 해소 표시 |
| `packages/db/src/version.ts` | `expectedMigration` 갱신 |
