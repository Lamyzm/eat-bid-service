---
id: PRODUCT-DECISION-SUPPORT
status: active
canonical_for: analysis-evidence-cohort-and-candidate-replay-contract
last_reviewed: 2026-08-31
review_trigger: analysis-method-cohort-policy-or-recommendation-boundary-change
---

# eatbid 판단 지원·분석 계약

이 문서는 eatbid가 사용자에게 어떤 분석 근거를 어떤 조건과 언어로 제공하는지 정의한다.
구체적인 delivery 상태와 담당자는 Linear가, 원본·canonical·사용자·파생 데이터의 권위는
아키텍처 문서와 Accepted ADR이 소유한다.

## 1. 제품 질문과 경계

첫 분석 제품은 다음 질문에 답한다.

> 이번 공고와 비교 가능한 과거 회차에서 source가 직접 관측한 낙찰 투찰률은 어떻게 분포했으며,
> 사용자가 직접 적은 후보는 확정 가능한 규칙 사실과 그 과거 관측에서 어디에 놓이는가?

답하지 않는 질문은 다음과 같다.

- 얼마를 써야 하는가?
- 어느 구간이 안전하거나 유리한가?
- 이번 공고의 낙찰 확률은 얼마인가?
- 예정가격이나 경쟁자의 값을 어떻게 예측하는가?

시스템은 후보를 만들거나 순위를 정하지 않는다. 사용자가 만든 후보를 관측 사실과 비교하고,
당시 확인한 근거를 재생 가능하게 보존한다.

## 2. 첫 개발 순서

분석을 먼저 개발하되 하나의 거대한 분석실을 만들지 않는다.

```text
ComparableOutcomeDistribution/v1
  → ReplayEvaluator/v1
  → AnalysisEvidenceContract/v1
  → BidWorkItem에서 target이 고정된 분석 상세 화면
  → 판단 도크 임베드
```

### 2.1 ComparableOutcomeDistribution/v1

PostgreSQL `mart`가 소유하는 첫 versioned product다. 동일한 비교계약에 포함되는 과거
`AuctionAttempt`의 직접 관측 결과, 포함·제외 이유, 분포와 품질 판정을 materialize한다.
사용자 후보나 메모는 포함하지 않는다.

같은 결과 안에 다음 member set을 서로 다른 이름과 count로 보존한다.

- `organization_history_members`: target의 exact `Organization`과 사전 등록 품목·하한·기간 scope에
  해당하는 시간순 source fact. 기관 이력 산점도와 표가 같은 ID 목록을 소비한다.
- `requested_cohort_members`: 요청한 exact L0 비교계약의 member와 exclusion.
- `selected_cohort_members`: sample gate에 따라 실제 분포 summary에 선택된 level의 member와 exclusion.

mart member는 `core`의 `AuctionAttempt`와 selected revision ID를 참조할 뿐 기관명·금액·낙찰업체 같은
source fact의 두 번째 권위가 아니다. 화면의 사실 필드는 참조된 verified `core` publication에서 읽는다.

L0 표본이 부족해 L1을 선택해도 exact 기관 이력을 버리거나 L1 member와 합치지 않는다. 각 집합은
자신의 `n`, 기간, `as_of`, freshness와 source release/run set을 가진다. V1의 기관 이력 scope는 target에서
결정되는 한 종류로 고정하며 UI에서 임의 query를 만들지 않는다.

고객 노출 이름은 `과거 관측 분포`다.

### 2.2 ReplayEvaluator/v1

`ReplayEvaluator/v1`은 `app`의 사용자 후보 **revision**과 이미 발행된 분석 결과를 읽는 server
application service다. 입력은 `workspace_id`, `supplier_party_id`, `auction_attempt_id`,
`auction_revision_id`, `candidate_revision_id`, `analysis_result_id`와 그 결과가 참조하는 `mart_build_id`,
`cohort_policy_id`, `computation_version`, `as_of`, `rule_evaluator_version`이다. target revision과
build는 호출 중에 active/current로 치환하지 않는다. 후보를 mart aggregate에 복사하지 않으며 UI가
즉석 계산하지 않는다.

결정 전 replay는 위 입력으로 재현 가능한 read result다. 정정으로 target revision이 바뀌면 새
revision·새 build를 명시적으로 선택해 다시 계산한다. `결정 기록` 시 API는 위 입력과 replay 출력
payload/hash·`evaluated_at`을 `app`의 append-only decision revision에 봉인한다. 이 snapshot은
사용자가 당시 본 증거의 보존본이지 현재 cohort의 두 번째 권위가 아니며, 다른 공고의 분석이나
current mart 응답에 재사용하지 않는다.

허용 출력 예시는 다음과 같다.

- `확정된 원천 사실의 명시 하한 미달`
- `확정된 원천 사실만으로 규칙상 위치를 확정할 수 없음`
- `확정된 원천 사실의 명시 하한 이상`
- `낮은 관측 17 · 같은 관측 1 · 높은 관측 10`
- `계산 자료 부족`
- `비교 불가`

`가상 낙찰`, `과거 승률`, `추천 위치`는 참가자격·경쟁자·동가·원천 finality까지 같은
조건으로 재현 가능한 별도 계약이 생기기 전에는 출력하지 않는다.

규칙 판정은 target revision의 source operand와 `rule_evaluator_version`이 완전할 때만 제공한다.
V1은 복수예가 조합 열거, 난수 시뮬레이션 또는 미관측 예정가격 계산으로 규칙 위치를 만들지 않는다.

### 2.3 AnalysisEvidenceContract/v1

판단 도크와 독립 분석 화면이 함께 소비하는 read contract다. 두 화면은 밀도만 다르고 숫자,
cohort와 품질 상태가 달라서는 안 된다. 두 화면은 같은 `analysis_result_id`와 그 결과가 참조하는
`mart_build_id`의 read contract를 소비한다. `decision evidence snapshot`은 그 결과를 참조·보존하는
`app` 기록이며 current
analysis를 대체하지 않는다.

contract는 exact 기관 이력과 selected cohort 분포를 함께 반환하지만 둘의 member identity, scope,
count와 freshness를 분리한다. 시간 chart와 기관 이력 표는 같은 ordered `auction_attempt_id` 목록이어야
하고, 선택한 chart point와 표 행은 같은 selected revision으로 resolve되어야 한다.

## 3. 데이터 권위와 수명주기

| 정보 | 권위 | 분석에서의 사용 |
|---|---|---|
| 원본 응답·문서 | R2 immutable raw object | lineage와 재생 입력 |
| 공고·revision·submission·award | PostgreSQL `core` | 분석의 source fact |
| 후보·결정·NeaT 사용자 확인 | PostgreSQL `app` | replay 입력과 decision snapshot |
| cohort·분포·품질 gate | PostgreSQL `mart` | 재생성 가능한 versioned 결과 |

분석 build는 검증된 core publication만 읽는다. 부분 수집 raw, quarantine, 아직 발행되지 않은
normalized row를 UI나 API가 직접 집계하지 않는다. 새 build는 완성·검증 후 원자적으로
활성화하고 마지막 검증 snapshot을 부분 결과로 덮어쓰지 않는다.

## 4. 비교계약

모든 분석 요청은 임의 SQL 조건이 아니라 versioned `cohort_policy_id`를 사용한다.

```text
L0  동일 조직·검증된 품목 코드·조달/가격/방식 조건
L1  동일 조직유형·품목군·금액대·방식·시간창
L2  명시적 매핑이 있는 지역·조직유형·품목군·금액대·방식
L3  탐색용 넓은 시장 관측군
```

- 사용자가 요청한 level과 실제 선택된 level을 모두 남긴다.
- level을 조용히 넓히지 않는다.
- 완화한 차원, 거절한 fallback과 이유를 결과에 포함한다.
- 지역·기관·품목은 검증된 `CodeScheme` mapping만 사용한다.
- 이름, 주소, 화면 라벨, 문자열 유사도로 cohort를 만들지 않는다.
- exact cohort와 expanded cohort를 합쳐 하나의 분포처럼 표시하지 않는다.

각 measure는 자신의 denominator를 가진다.

```text
cohort_candidate_n  → 비교계약에 들어온 과거 관측 후보 전체
eligible_n   → measure 계산 가능성 검사를 통과한 후보
included_n   → 최종 분포에 포함된 관측
exclusions   → reason_code별 제외 건수
```

`unknown`을 0, 평균, 가장 흔한 값으로 채우지 않는다.

### 4.1 사용자 필터는 cohort 편집기가 아니다

분석 화면의 필터는 이미 검증·발행된 evidence result를 선택하는 UI다. 브라우저가 현재 행을
임의로 걸러 histogram, `n`, quantile 또는 후보 위치를 다시 계산하지 않는다. 필터 변경은 항상
`target revision + analysis_result_id + mart_build_id + cohort_policy_id + filter contract`가 고정된
완전한 새 응답을 조회하며, trust strip·chart·분포·연결 표·선택 회차 inspector는 그 응답의 동일
member identity를 소비한다.

현재 공고의 `Workspace × SupplierParty × AuctionAttempt × selected revision`은 필터 대상이 아니다.
사용자가 근거 렌즈를 바꿔도 target header와 작성 중인 candidate revision은 그대로 유지한다.

| 필터 축 | V1 선택 | 의미와 제한 |
|---|---|---|
| 근거 렌즈 | `정확한 기관 이력` / `대상 기관 소재 행정구역 맥락` | 두 member set을 합치지 않는다. 지역은 검증된 기관 소재지 행정코드로만 선택하며 eaT 공고지역·참가제한지역과 혼용하지 않는다. |
| 품목 | target의 검증 품목 코드 / 정책에 등록된 품목 코드 / `전체 품목 보기` | 기본은 target 품목이다. `전체`는 탐색용으로만 허용하며 품목별 panel/count로 분리하고 통합 대표구간·후보 위치·연결 추세선을 만들지 않는다. |
| 명시 하한 | target과 같은 exact measure / 정책에 등록된 다른 exact 값 | 서로 다른 하한을 한 summary로 합치지 않는다. 복수 선택이 필요하면 하한별 panel로 분리한다. |
| 기간 | 정책에 등록된 preset | V1은 예: `12개월 / 24개월 / 전체`처럼 사전 등록된 기간만 제공한다. 임의 기간을 반복 탐색해 유리한 표본을 고르는 UI를 만들지 않는다. |
| 비교 방식·금액대·기관유형 | target과 policy가 고정한 값 | 기본 화면에서 숨기지 않고 `비교 기준`으로 표시하되 V1 자유 편집 필터로 만들지 않는다. |
| 선택 사업자 | 전역/target supplier context | cohort를 바꾸지 않는다. source-observed submission을 같은 회차 위에 표시할지 결정할 뿐이다. |

`대상 기관 소재 행정구역 맥락`은 현재 target 기관과 명시적 행정구역 mapping이 있는 경우에만
사용할 수 있다. 예를 들어 화면에는 `김해시 소재 기관`으로 표시할 수 있지만, 결과 계약은 기관명이나
주소 문자열이 아니라 versioned 행정구역 `CodeScheme`과 mapping version을 가진다. mapping이 없으면
지역을 추측하지 않고 `지역 비교를 확정할 수 없음`을 반환한다.

필터 변경은 다음 규칙을 따른다.

1. 응답이 완성되기 전까지 이전 filter result를 새 label 아래 표시하지 않는다.
2. 표본이 0이면 이전 결과로 자동 fallback하지 않고 적용 조건과 제외 이유를 보여 준다.
3. exact 기관과 지역 맥락, 품목별 member와 전체 품목 탐색을 하나의 `n`으로 합산하지 않는다.
4. 선택된 chart point는 새 member set에 없으면 해제하고, candidate·decision은 변경하지 않는다.
5. target과 measure contract가 다른 필터에서는 후보 overlay와 replay를 비활성화하고 이유를 표시한다.
6. URL과 API에는 표시명 대신 내부 ID와 `(source_system, code_scheme, code)` 참조를 사용한다.
7. 사용자에게는 `원천 후보 → 계산 가능 → 포함 → 제외` funnel과 기간·`as_of`를 항상 함께 보여 준다.

## 5. V1 measure

첫 사용자-facing measure는 source에서 직접 관측된 낙찰 투찰률 `award_bid_rate`다. 원천에 없는
값을 역산해 직접 관측값처럼 표시하지 않는다. UI 축약 라벨은 `관측 낙찰 투찰률`이며 금액 measure가
별도 승인되기 전에는 이를 `낙찰금액` 또는 단위가 모호한 `낙찰값`으로 부르지 않는다.

각 결과는 `measure_id`, 단위, scale, denominator 의미, source precision을 포함한다. 후보를 같은
chart에 놓으려면 candidate와 distribution의 `measure_id`·단위·denominator가 완전히 같아야 한다.
공식 규칙 경계를 같은 축에 놓으려면 source operand와 `rule_evaluator_version`까지 호환돼야 한다.
하나라도 다르면 별도 panel로 분리하고 값↔금액 변환을 제공하지 않는다.

후속 measure 후보는 별도 정책과 검증을 통과한 뒤 추가한다.

- `floor_margin_pp`: 유효한 원천 operand와 versioned formula가 있을 때만
- `participant_count`: 직접 관측된 수 또는 완전한 bid-list에서만
- `planned_price_ratio`: 원천의 planned/base 값과 예정가격 유형을 보존할 때만
- `reconstructed_runner_up_bid_rate`: 완전한 참가 목록, 동가·무효·취소 처리와 source precision을
  검증하고 versioned formula를 발행한 경우에만. UI에는 `재구성 2등 투찰률`로 표시하며 직접 관측값처럼
  부르지 않는다.

measure를 추가했다는 이유로 서로 다른 denominator를 한 카드나 종합점수로 합치지 않는다.

선택 사업자의 실제 투찰률은 cohort aggregate가 아니라 `core`의 source-observed `BidSubmission`이다.
정확한 supplier와 회차가 연결될 때만 `내 실제 투찰`로 표시한다. `app`의 후보·결정·NeaT 사용자 확인값은
별도 행과 시각 문법을 사용하며 source-observed submission을 대신하지 않는다. source scope가 불완전하면
빈칸이나 `미제출`로 추정하지 않고 `관측 불가`로 표시한다.

## 6. 품질 gate

정책 값은 UI 상수나 문구가 아니라 `cohort_policy_id`와 `computation_version`에 동결한다.

| gate | 동작 |
|---|---|
| data contract | schema·formula·code mapping·원천 completeness가 호환되지 않으면 발행 차단 |
| sample sufficiency | 최소 표본 미달이면 quantile·대표구간을 발행하지 않고 관측점과 사유만 제공 |
| exclusion load | 사전 등록 상한을 넘으면 summary를 중단하고 제외 내역만 제공 |
| drift | measurement drift는 차단, population/composition drift는 기간을 나눠 표시 |
| multimodality | 다봉이면 단일 평균·중앙 band·대표구간을 금지하고 분포 자체를 표시 |
| freshness | 현재 공고 fact와 historical analysis의 freshness를 별도 판정 |

검사할 표본이 부족한 경우는 `drift 없음`, `단봉`이 아니라 `not_assessed`다.

최소 표본, 시간창, histogram bin, drift distance/effect, 다봉 판정과 임계값은 현재 문서에서
숫자로 고정하지 않는다. production 전체 corpus를 대상으로 다음 순서로 결정한다.

```text
exploratory profile
  → 정책·임계값 사전등록
  → 시간순 out-of-sample 검증
  → cohort-policy version 발행
  → validated build 원자 활성화
```

## 7. 기준시점과 누수 방지

모든 결과는 `as_of`를 가진다. 특정 시각의 build에 포함되려면 다음을 모두 만족해야 한다.

1. raw observation이 cutoff 이전에 관측됐다.
2. source release/canonical publication이 cutoff 이전에 검증·발행됐다.
3. 비교 결과가 cutoff 이전에 종료·확정됐다.

시간순 OOS에서는 target `AuctionAttempt`의 투찰 마감 이전 cutoff를 사용한다. 이후 결과가
추가돼도 과거 build와 decision snapshot이 바뀌지 않아야 한다. 정책 변경은 새
`computation_version`과 새 OOS run이며 실패 run도 보존한다.

OOS의 목적은 낙찰 예측 정확도를 홍보하는 것이 아니라 다음을 확인하는 것이다.

- publishable coverage와 gate 통과율
- cohort member와 raw lineage 완결성
- 동일 입력 재실행 hash의 결정성
- 미래 결과가 과거 build를 바꾸지 않는지
- baseline보다 폭만 넓히는 정책인지

## 8. 사용자 후보와 결정 snapshot

- 후보는 A/B/C 최대 3개다.
- 초기값, 추천 placeholder, 자동 snap이 없다.
- 차트 점·막대·표 행을 클릭해도 후보가 바뀌지 않는다.
- `후보 저장`과 `결정 기록`은 다른 행동이다.
- V1에서는 과거 관측 행을 후보로 복사하는 행동을 제공하지 않는다. 후보는 사용자가 직접 입력한다.
- 후보 revision은 `measure_id`, 단위, scale과 source precision을 함께 가지며 V1에서는
  `award_bid_rate`와 동일한 contract의 값만 분포에 겹친다.

후보는 version 가능한 `app` 객체이며, 최종 결정은 다음을 함께 봉인한다.

```text
Workspace + SupplierParty + AuctionAttempt + auction revision
+ BidWorkItem identity + 사용자 candidate revision과 선택값
+ evidence snapshot/result/build/policy
+ actor + recorded_at
```

수정은 과거 값을 덮어쓰지 않고 새 decision revision을 만든다. 정정공고가 오면 기존 결정을
보존하고 `재확인 필요`로 만든다. 재입찰은 연결된 새 `AuctionAttempt`와 새 work item이다.

앵커링 pilot용 화면 열람 사실은 `app`의 append-only `AnalysisViewEvent`와 `CandidateRevision`으로만
기록한다. 각 event는 workspace·supplier·attempt·selected revision·analysis result와 그 결과가 참조한
mart build·actor·`occurred_at`을 가진다. 이 event는 UX/감사와 사전등록된 pilot 평가에만 쓰며 V1 cohort member,
mart aggregate, 추천 또는 순위 입력으로 사용하지 않는다.

## 9. 화면 언어

허용:

- `과거 관측 분포`
- `과거 관측의 중간 50%`
- `이번 공고와 비교한 과거 회차`
- `비교 기준`
- `자료 품질`
- `후보 위치 비교`
- `표본 부족`
- `여러 군집 가능`
- `비교 집단을 확정할 수 없음`

금지:

- `추천범위`, `안전구간`, `적정 구간`, `유리한 구간`, `잘 나온 구간`
- `추천값`, `AI 정답`, `기대낙찰`, `낙찰 가능성`
- `이 값이면 N회 낙찰`
- 표본·기간·기준시점·버전이 없는 분석 숫자
- 분석 결과와 붙은 `이 값으로 투찰` CTA
- 사용자 값이 주어인 반사실 서술(`~ 썼다면`, `그때 냈다면`, `~였을 회차`). 내가 들어가 명단이 달라진 세계의 회차는
  관측한 적이 없다(단독입찰 허용안함이 29/30). 같은 셈은 과거 회차를 주어로 쓴다 — `낙찰값이 이 값 이상이었던 회차`
  (EAT-236)

이 목록의 어휘와 반사실 주어는 `tools/architecture/check-decision-vocabulary.mjs`가 web의 문자열·JSX 텍스트에서 막고,
렌더된 화면 문장은 `apps/web/.../__fixtures__/banned-copy.ts`가 문형으로 검사한다.

과거 분포의 안팎을 성공/실패 색으로 평가하지 않는다. 규칙상 확정 가능한 위반만 오류 색을 쓴다.

## 10. 결과와 lineage 최소 계약

제품 계약은 다음 정보를 함께 전달해야 한다. 실제 DTO와 테이블은 구현 issue에서
`packages/contracts`와 `packages/db`에 중복 권위 없이 정의한다.

```text
result/build identity
target attempt/revision
requested/selected cohort level와 predicate fingerprint
period/as_of
measure별 candidate/eligible/included n와 exclusion breakdown
histogram/summary와 gate 결과
raw hash·run·publication·selected revision·code/formula version lineage
사용자에게 표시할 versioned notice
```

API는 active 또는 명시 build 결과를 읽고 filter/sort/pagination만 한다. API와 UI가 percentile,
binning, cohort fallback, mapping, drift, multimodality, active build 선택을 다시 계산하지 않는다.

## 11. 첫 slice 성공·폐기 조건

첫 유료 pilot에서 다음을 검증한다.

- 같은 build·정책·raw로 result와 snapshot이 100% 재현된다.
- 부분수집 또는 unvalidated data가 현재 분석으로 한 번도 공개되지 않는다.
- 잘못된 공고·revision·사업자에 후보/결정이 기록된 사례가 없다.
- 사용자가 replay를 추천값이나 미래 낙찰확률로 해석하지 않는다.
- 분석을 보느라 전체 판단시간이 증가한다면 오류 감소·근거 회상 개선으로 상쇄된다.
- 실제 사이클에서 후보와 evidence snapshot이 결정·복기로 연결된다.

다음 조건이 반복되면 첫 slice를 폐기하거나 재정의한다.

- 정직한 gate를 적용하면 대부분의 대상에서 비교 근거를 제공할 수 없다.
- 사용자 다수가 `그냥 과거 낙찰표`라고 평가하고 두 번째 공고에 자발적으로 쓰지 않는다.
- 화면을 상품처럼 보이게 하려면 `unknown`, 표본 부족, 다봉성을 숨겨야 한다.
- 후보가 표시 분포의 중앙으로 기계적으로 수렴하는 앵커링을 완화할 수 없다.
- source fact와 결정론적 하한·금액 계산이 일치하지 않는다.

## 12. 레거시 데이터 판정

`F:/Project/eat-bid/analysis/bidmodel/cache/features.parquet` 51,793건은 라이브 233,336개
distinct bid ID의 22%인 오래된 `parquet_v2` 부분집합이다. 레거시 가설, 회귀 fixture,
실패 사례 발굴에는 사용할 수 있지만 production cohort 정책·표본 임계값·OOS baseline의
권위가 아니다.

첫 production policy는 목표 raw→core publication에서 다시 만든 전체 검증 corpus로 보정한다.
