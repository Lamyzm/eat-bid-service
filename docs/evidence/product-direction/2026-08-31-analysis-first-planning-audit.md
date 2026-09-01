---
id: EVIDENCE-2026-08-31-ANALYSIS-FIRST-PLANNING-AUDIT
status: evidence
observed_at: 2026-08-31
linear_issue: EAT-5
supersedes: none
---

# 분석 우선 제품기획 심층검증

이 문서는 제품 방향을 결정할 때 사용한 증거, 반증과 미확정 가설을 한 시점에 보존한다. 현재
제품 계약은 [`../../product/decision-support.md`](../../product/decision-support.md)와
[`../../product/screen-system.md`](../../product/screen-system.md), capability 순서는
[`../../product/roadmap.md`](../../product/roadmap.md)가 권위다.

## 1. 이번에 채택한 방향

> eatbid는 EAT 공급업체가 여러 사업자의 공고를 빠르게 검토하고, 어떤 근거로 후보와 결정을
> 만들었는지 실제 제출 관측·결과까지 연결해 복기하는 **근거 재현형 투찰 사이클 운영
> 워크스페이스**다.

분석을 첫 개발 대상으로 삼지만 별도의 연구실을 만드는 것이 목표는 아니다. 첫 분석은
`과거 관측 분포 → 사용자 후보 replay → evidence snapshot → 판단 도크`로 이어져야 한다.

## 2. 증거 inventory

| 증거 | 관측 | 무엇을 지지하는가 | 지지하지 않는 것 |
|---|---|---|---|
| legacy parquet 재감사와 [`SIM-USERFLOW.md`](../../SIM-USERFLOW.md) §0, §7.1 | source max 2026-08-26 기준 최근 365일: 가족 2사업자 1,285 투찰 entry, 675회차, 99 활동일, 26 낙찰; 610회차는 두 사업자 중복 참여(90.4%); 일 부하 중앙 8, p90 32.2, 최대 58 | 다사업자 matrix와 피크일 batch workflow | 외부 고객 수요, 분석 효능, 유료 유지 |
| 같은 문서의 3주 종단 실화면/DB 시뮬레이션 | 공고가 몰리는 월 7~9일의 도구이며 공고 없는 날은 알림 없이는 열 이유가 약함 | 매일 dashboard보다 work queue·알림·익일 대조 | 모든 고객의 사용 리듬 |
| [`ARCH-DATA.md`](../../ARCH-DATA.md) §`parquet_v2` 판정 | 모델 cache 51,793회차는 live 233,336 distinct bid ID의 22%인 3일 stale 부분집합 | legacy 분석 threshold 재보정 필요 | production cohort threshold와 OOS 성능 |
| [`SPEC-ANALYSIS.md`](../../SPEC-ANALYSIS.md) | 비드큐 방식과 레거시 분석 아이디어가 광범위하게 기록됨 | 실패 가설·경쟁 문법 inventory | 현재 제품 명세 |
| [비드큐 공식 홈페이지](https://www.bidq.co.kr/) | 공고/낙찰, 발주처·사정율·경쟁사 분석, 나의 투찰결과, report/계산기/알림을 공개 홍보 | 정보 밀도와 투찰 전반 지원 시장이 존재 | 추천 구간의 통계적 타당성, eatbid 고객의 지불 의사 |
| [EATGO 공식 랜딩](https://www.eatgo.kr/home/landing.php), [요금](https://eatgo.kr/home/pricing.php), [FAQ](https://eatgo.kr/home/faq_list.php) | 자동 상품 매칭·견적·시세·입찰가·분석을 묶고 월 55만~99만원 및 수수료형을 공개 | 높은 가격은 분석 단품보다 견적 자동화와 업무 대체에 결합됨 | 실제 고객 수·매출·주장된 수주율의 독립 검증, eatbid 가격 |
| [토스증권 WTS](https://www.tossinvest.com/) 공개 화면 관찰 | scan-first hierarchy, 맥락을 유지하는 pane/tab, 절제된 색과 숫자 계층 | calm density와 context preservation | 금융 feed·소셜·추천 문법을 조달 업무에 복제 |
| [Stripe report 문서](https://docs.stripe.com/revenue-recognition/reports) | summary에서 detail·source로 내려가고 기간/상태를 명시 | 요약→근거표→원자료의 신뢰 구조 | Stripe의 카드 스타일 자체 |

가족의 값은 실제 사용량을 보여 주지만 단일 household evidence다. 가족 외 유료 고객, 인터뷰,
shadowing은 이 판정 시점에 **0**이다. 따라서 `팔린다`, `월 39,000원이 적정하다`, `분석 때문에
낙찰이 늘어난다`는 아직 사실이 아니다.

### 2.1 최근 365일 재감사 provenance

```text
raw bids: F:/Project/eat-bid/data/parquet/bids/**/*.parquet
raw auctions: F:/Project/eat-bid/data/parquet/auctions/**/*.parquet
dedupe implementation: F:/Project/eat-bid/src/eatbid/lake.py
serving_crosscheck: Docker PostgreSQL eatbid.public.firm_bids
cohort biz_no: 7175001228, 3118152843
period: 2025-08-27..2026-08-26
as_of: source max opened_at 2026-08-26
entry grain: bid_id × biz_no
attempt grain: distinct bid_id
dedupe: lake.py 규칙의 최신 filename per identity
calculation_version: ad-hoc product audit query, 2026-08-31
```

낙찰 source `bid_amount` 합계는 295,740,150원이다. `round(base_price × bid_rate / 100.0)` 역산
합계는 296,472,688원으로 732,538원 차이가 나므로 정확 금액에는 원본 `bid_amount`만 사용한다.

기존 `SIM-USERFLOW.md`의 2026-08-28 snapshot은 1,275 entry·670회차·97일·중복 605회차로 기록돼
있다. 현재 원장은 같은 과거 기간에서 10 entry·5회차가 늘었지만 legacy lake에 source release/run
manifest가 없어 어느 ingest가 차이를 만들었는지 재현할 수 없다. 따라서 기존 숫자는 prior evidence,
현재 숫자는 `as_of`가 붙은 재감사 결과이며 어느 쪽도 새 production publication의 권위가 아니다.

## 3. 경쟁 화면 판정

### 3.1 비드큐

채택:

- 목록의 업무 밀도
- 공고 사실과 분석을 같은 판단 맥락에 둠
- chart에 대응하는 상세 근거 표
- 원공고·이력·알림·저장 조건으로 투찰 전반을 지원

거절:

- 추천/고확률 구간을 사실처럼 표시
- 사정률 추출과 투찰금액 자동 적용
- chart click으로 계산기에 값 주입
- 6~7개 분석 lens를 첫 핵심 화면에 모두 노출
- Excel·인쇄물을 신뢰의 대리물로 사용

보존한 화면은 [`../competitors/bidq-and-info21c/`](../competitors/bidq-and-info21c/)에 있다.
7개 모두 비드큐 공식 사용안내 원본과 hash가 일치한다. 인포21C 공개 가이드에도 동일한 발주처
심층분석 화면 내용이 별도 이미지 구성으로 노출된다. 모든 파일은 공개 안내 캡처이므로
authenticated live UI 전체와 현재 배치를 단정하지 않고 화면 문법의 evidence로 사용한다.

### 3.2 EATGO

EATGO가 높은 가격으로 묶는 핵심은 공고 분석 하나가 아니라 품목 표준코드 매칭, 자사/시장/도매
가격, 견적서 생성과 입찰가를 한 workflow로 줄이는 자동화다. eatbid가 그 가격을 따라 정할 근거는
없지만 장기 retention이 `분석 + 반복 업무 대체`에서 나온다는 경쟁 가설은 남긴다.

### 3.3 토스증권

가져올 것은 시각 스타일의 복제가 아니라 다음 원리다.

- 사용자의 현재 대상과 주요 행동이 먼저 읽힌다.
- 상세로 들어가도 선택한 대상과 filter가 유지된다.
- 숫자가 많아도 모든 값을 hero card로 만들지 않는다.
- 색은 상태와 행동을 구분하고 권위를 연출하지 않는다.

feed, 실시간 흥분도, 종목 추천, 사회적 증거는 eatbid의 업무와 맞지 않는다.

## 4. 심층검증 판정

| 검증 질문 | 판정 | 이유와 교정 |
|---|---|---|
| 아키텍처 경계와 맞는가 | PASS | raw/core/app/mart 권위와 versioned analytics를 유지한다. |
| 목록 + persistent 판단 도크가 맞는가 | CONDITIONAL PASS | 다사업자 batch에 맞지만 정확한 사업자 셀 선택과 inline 값 수정 금지가 필요하다. |
| `발견→기록→제출→대조` 단일 상태가 맞는가 | FAIL | source/data/decision/NeaT/submission/result/reconciliation을 직교 축으로 분리했다. |
| 분석이 제품 차별점으로 보이는가 | CONDITIONAL PASS | 도크 기본 상태에서 cohort·n·분포·freshness·warning을 즉시 보여야 한다. |
| 월 구독 지불 의사가 증명됐는가 | FAIL/UNPROVEN | 외부 유료 고객 evidence가 0이다. 경쟁사 가격은 우리 willingness-to-pay가 아니다. |
| Enterprise 목적지가 타당한가 | CONDITIONAL | grain과 lineage는 맞지만 권한·승인·SLA를 지금 빈 껍데기로 만들지 않는다. |
| 첫 분석 데이터가 production-ready인가 | FAIL/UNPROVEN | 51,793 legacy subset으로 threshold·OOS·표시 통계를 확정할 수 없다. |

## 5. 첫 분석 선택

네 후보를 비교했다.

| 후보 | 첫 slice 판정 | 이유 |
|---|---|---|
| 기관/품목 과거분포 | 보조 engine | 표본·혼합 위험이 있고 단독으로는 과거 낙찰표와 차별화가 약하다. |
| 사용자 후보 historical replay | **첫 사용자-facing slice** | 사용자 판단을 시스템 추천과 분리하고 결정 snapshot으로 이어진다. |
| 시장/경쟁강도 | 후순위 | 공고별 결정 loop와 연결이 약하고 종합점수로 오해될 위험이 크다. |
| 복수예가/하한 규칙 | 결정론적 규칙만 기반으로 포함 | 공식 사실·산식·하한 판정은 필요하지만 난수/예정가 예측은 제외한다. |

엔지니어링은 `ComparableOutcomeDistribution/v1`을 먼저 만들고, 첫 사용자 slice는 같은 build에
사용자 후보를 겹치는 `ReplayEvaluator/v1`으로 완결한다.

## 6. 데이터 감사에서 바뀐 결정

처음 분석에 사용한 `analysis/bidmodel/cache/features.parquet` 51,793건은 production 대표 corpus가
아니었다. [`ARCH-DATA.md`](../../ARCH-DATA.md)의 2026-08-29 측정에 따르면 live 233,336 distinct
bid ID의 완전한 22% 부분집합이며 마지막 write도 3일 전이었다.

따라서 다음을 금지한다.

- 51,793건에서 정한 최소 `n`을 production UI 상수로 사용
- 그 표본의 IQR/coverage를 고객 표시 대표값으로 사용
- 그 표본에서 얻은 OOS 결과를 제품 효능으로 홍보
- 기관명/품목 혼합을 정리하지 않은 cohort를 넓은 표본으로 포장

첫 policy는 새 raw→core publication의 전체 검증 corpus에서 exploratory profile, 사전등록,
시간순 OOS를 거쳐 version으로 발행한다.

## 7. 아직 모르는 것

1. 외부 EAT 공급업체가 후보 replay를 두 번째 공고에도 자발적으로 쓰는가?
2. 분석을 보여 준 뒤 후보가 분포의 중앙으로 기계적으로 이동하는가?
3. 정직한 gate를 적용해도 대상 공고의 충분한 비율에서 비교가 가능한가?
4. 사용자가 replay를 추천값이나 미래 낙찰확률로 읽지 않는가?
5. 0건 낙찰 월에도 업무 누락·대조·복기 가치로 결제를 유지하는가?
6. 분석과 알림/대량 검토/문서 자동화 중 실제 retention wedge는 무엇인가?

## 8. pilot gate

현재 수치는 검증 계획이며 달성된 성과가 아니다.

- 같은 raw/build/policy로 result와 decision snapshot 100% 재현
- 잘못된 attempt/revision/supplier에 후보나 결정이 기록된 사례 0
- 부분수집·quarantine 결과의 current 공개 0
- decision→NeaT 사용자 확인→source 대조 연결 60% 이상
- 기존 대비 전체 cycle time 20% 이상 감소 또는 그에 상응하는 오류·근거 회상 개선
- 외부 유료 design partner가 두 번째 실제 cycle에 재사용
- 사용자 오해 인터뷰에서 추천·확률로 읽는 사례를 사전 정의 상한 아래로 유지

반복 사용과 지불 evidence가 나오지 않으면 화면을 더 화려하게 만드는 대신 첫 slice를 Iterate 또는
Stop한다.
