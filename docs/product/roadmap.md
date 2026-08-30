---
id: PRODUCT-ROADMAP
status: active
canonical_for: product-direction-and-capability-gates
last_reviewed: 2026-08-31
review_trigger: product-scope-or-roadmap-gate-change
---

# eatbid 제품 로드맵

이 문서는 eatbid의 **유일한 제품 방향·capability 순서·outcome gate 원천**이다. 현재 작업의
담당·상태·blocker를 관리하거나 기능 구현 명세와 기술 설계를 대신하지 않는다. 실제 delivery
상태는 Linear issue와 project가 소유하며, 제품 경계 또는 데이터 소유권을 바꾸는 항목은 구현
전에 공유 변경 계약과 필요한 ADR을 통과해야 한다.

현재 제품 경계의 권위는 [`product-and-quality.md`](../architecture/product-and-quality.md)와
Accepted ADR에 있다. 이 roadmap의 확장 가설은 그 경계를 자동으로 넓히지 않으며, delivery로
승격하려면 사용자 evidence와 필요한 대체 ADR이 먼저다.

## 1. 제품 정의

eatbid의 **현재 핵심 제품은 EAT 공급업체의 공고 발견·판단·제출 대조·결과 복기를 연결하는
근거 재현형 투찰 사이클 운영 워크스페이스**다. 낙찰 이후 발주·납품 연결은 유료 고객의 실제
문서와 반복 비용을 확인한 뒤 확정할 장기 확장 가설이다.

```text
공고 발견 → 검토·후보 비교 → 사용자 결정 → NeaT 입력 확인 → 제출·개찰 대조
                                                          ↓
낙찰 → 발주 수신 → 품목 정리 → 문서 생성 → 납품 관리 → 정산·실적
```

분석이 사용자의 첫 가치가 되고, 투찰 준비 자동화가 반복 사용을 만들며, 발주문서·납품 자동화가
지속 사용과 상위 요금제의 근거가 된다는 것이 현재 성장 가설이다. 외부 유료 evidence 전에는 이를
검증된 funnel로 표현하지 않는다.

### 제품이 약속하는 것

1. 검토해야 할 공고와 변경·재입찰을 놓치지 않게 한다.
2. 확정 사실과 과거 관측을 근거로 사용자가 자신의 후보값을 비교하게 한다.
3. 사용자 결정값·NeaT 사용자 확인값·source-observed 제출값·개찰 결과를 분리해서 연결한다.
4. 모든 분석과 자동화 결과를 원본·표본·기간·기준시각·버전까지 역추적할 수 있게 한다.

발주·납품 확장 가설이 사용자 evidence와 대체 ADR을 통과하면 낙찰 후 발주자료를 구조화하고
반복 문서·집계·납품 준비를 줄이는 약속을 추가한다. 승인 전에는 현재 제품의 약속으로 판매하거나
delivery acceptance로 사용하지 않는다.

### 제품이 약속하지 않는 것

- 특정 투찰가 추천, 예정가 예측, 낙찰 보장
- 사용자를 대신한 NeaT 입력 또는 자동 제출
- 작은 표본에서 만든 전략 순위나 AI 정확도
- 확인하지 못한 자격·품목·문서 값을 추측으로 확정하는 것

현재 Accepted ADR에 따라 추천가·예측가·자동 투찰은 시스템 경계 밖이다. 사용자 후보의
과거 replay와 중립적 관측 분포만 제공한다.

## 2. 핵심 사용자와 사용 맥락

초기 핵심 사용자는 월 30건 이상 EAT 공고를 검토하고 1~3개 법적 사업자를 운영하는
급식 납품업체의 대표 또는 소규모 실무팀이다. 아버지의 경험은 중요한 설계 입력이지만 제품의
유일한 방법론이나 유일한 사용자는 아니다.

낙찰이 0건인 달에도 공고 탐색, 변경 감지, 검토 기록, 제출 대조에서 유지 가치가 있어야 한다.
발주·납품 확장 가설이 승격된 이후에는 낙찰이 발생한 달의 반복 업무 감소도 별도로 검증한다.

## 3. 제품 정보구조

### 3.1 투찰 업무

**한 가지 질문:** 지금 무엇을 검토하거나 확인해야 하는가?

- 신규·변경·재입찰·마감순 업무 대기열
- `AuctionAttempt` 행 × 사업자별 `BidWorkItem` 셀 matrix
- 기본 saved view `오늘/마감`, 사업자별 `검토 필요 | 결정 완료 | NeaT 확인 필요 | 제출 대조 필요`
- 확인 가능한 자격의 `matched | not_matched | unknown`
- 주 행동: `검토 시작`

### 3.2 판단 도크와 분석 상세

**한 가지 질문:** 이 공고에 어떤 값을 왜 선택할 것인가?

- 기관·금액·하한·지역·차수 등 확정 공고 사실
- source-observed `award_bid_rate`의 versioned 비교 분포
- requested/selected cohort, 표본·제외 수·기간·`as_of`·freshness·계산 버전
- 같은 measure로 사용자가 직접 입력한 최대 3개 후보의 기술적 위치 비교
- 결과 표현: `낮은 관측 N | 같은 관측 N | 높은 관측 N | 비교 불가`
- 표본 부족·다봉·stale·unknown과 원자료 lineage
- 주 행동: `결정 기록`

첫 구현은 정확한 `BidWorkItem`에서 여는 분석 상세이며 주 행동은 `후보 저장`이다. 같은 contract를
판단 도크에 임베드한 뒤에 `결정 기록`으로 연결한다. 시스템이 후보구간을 기본 선택하거나 과거
관측을 후보 입력란에 자동 적용하지 않는다.

### 3.3 결과 복기

**한 가지 질문:** 당시 판단과 실제 제출·결과는 어떻게 달랐는가?

- 개찰 전 저장한 결정값과 근거 snapshot
- 사용자가 확인한 NeaT 입력값
- source-observed submission과 개찰 결과
- 불일치·미확인 상태 분리
- 주 행동: `복기 완료`

### 3.4 발주·납품 확장 가설

**한 가지 질문:** 낙찰 이후 무엇을 준비하고 어떤 문서를 만들어야 하는가?

- EAT·Excel·PDF 등 발주자료 수신과 원본 보존
- 학교·납품일·배송지·품목·규격·단위·수량 구조화
- 거래처·품목 master와 매칭
- `확정 | 추정 | 미확인` 행 검토
- 학교·사업자별 문서 template
- 발주서·거래명세서·납품서·품목 집계표 생성 후보
- 여러 학교의 동일 품목 매입 필요량 합산
- 학교별 피킹·배송 목록 재분배
- 변경 발주 비교와 문서 revision
- 주 행동: `문서 생성`

정확한 입력 형식과 생성 문서 목록은 실제 업무자료 inventory 후 기능 명세에서 확정한다.
사용자 업로드 원본과 생성 문서의 저장 권위·보존정책은 현재 아키텍처에 아직 확정되지 않았으므로
구현 전에 별도 ADR이 필요하다.

### 3.5 성과판

**한 가지 질문:** 결과가 아니라 업무와 판단 품질이 어떻게 축적되고 있는가?

- 대상 공고·결정 기록·제출 대조·결과 연결 건수
- 사업자별 누락과 완결률
- 실제 낙찰 결과
- 발주문서 처리량·미확인 행·변경 대응 시간
- 충분한 개찰 전 기록이 생기기 전 전략 leaderboard는 노출하지 않음

## 4. 화면·신뢰 디자인 원칙

디자인 방향은 `calm density`, 즉 토스식 인지 명료성과 전문 업무도구의 정보 밀도를 결합한다.

1. 한 페이지에는 하나의 주요 행동만 둔다.
2. 1층은 지금 할 일과 확정 사실, 2층은 직접 비교 하나, 3층은 원자료·산식·revision이다.
3. 표와 숫자는 충분히 보여주되 카드·색·배지를 권위 연출에 사용하지 않는다.
4. 관측값, 분석값, 사용자 작성 상태를 시각적으로 구분한다.
5. stale·부분수집·unknown·계산 버전 변경을 숨기지 않는다.
6. 상태는 색만으로 표현하지 않고 텍스트와 함께 표시한다.

## 5. 단계별 로드맵

로드맵은 날짜 약속보다 **검증 가능한 outcome gate**로 움직인다. `R0`~`R5`는 capability의
의존 순서이지 현재 sprint 상태가 아니다.

### R0 — 데이터 신뢰 기반

- `AuctionAttempt` 중심 canonical 모델
- raw → ingest → core → mart 권위 사슬
- 원자적 공개, 재현 가능한 계산, unknown 격리
- 사업자·기관·지역·코드의 내부 identity
- 사용자 상태와 source-observed fact 분리

**통과 조건:** 같은 raw·코드 버전으로 같은 canonical/분석 결과가 재현되고, 부분 실행이
현재 공개 snapshot을 덮어쓰지 않으며, UI가 신선도와 unknown을 표현할 수 있다.

### R1 — 유료 투찰 decision loop

R1은 화면 수가 아니라 다음 capability 순서로 진행한다.

1. **분석 기반:** 전체 검증 corpus profiling → 사전등록 cohort policy →
   `ComparableOutcomeDistribution/v1` → `ReplayEvaluator/v1` → `AnalysisEvidenceContract/v1`
2. **분석 첫 slice:** 정확한 `Workspace × SupplierParty × AuctionAttempt × revision`에서 분석을 열고
   후보 revision을 evidence result/build와 함께 저장한다.
3. **투찰 업무:** 공고 행 × 사업자 셀 목록과 persistent 판단 도크를 연결한다.
4. **결정 journal:** 후보와 선택값·근거를 개찰 전 append-only decision revision으로 봉인한다.
5. **대조·복기:** NeaT 사용자 확인, source submission, 개찰 결과, reconciliation을 서로 다른
   사실로 연결한다.
6. **유료 cycle:** 가족 외 사용자가 두 번째 실제 투찰 cycle에도 자발적으로 사용하고 결제한다.

분석 계약은 [`decision-support.md`](decision-support.md), 화면 계약은
[`screen-system.md`](screen-system.md)가 소유한다. 51,793건 legacy model cache는 live corpus의
22%인 stale subset이므로 threshold·표시 통계·OOS baseline의 권위로 사용하지 않는다.

다음 숫자는 아직 **초기 검증 가설**이다. 모집단·측정 기간·다음 투자 판단 이유를 discovery
Linear discovery issue에서 확정하기 전에는 canonical exit gate로 사용하지 않는다.

**시장 게이트 가설:** 가족 외 20곳 인터뷰, 8곳 실제 업무 관찰, 5곳 유료 design partner.

**사용 게이트 가설:** 같은 build/policy로 분석·decision snapshot 100% 재현, 잘못된
workspace/attempt/revision/supplier 기록 0건, 결정→NeaT 확인→source 대조 60% 이상 연결, 실제
cycle time 20% 이상 감소 또는 동등한 오류·근거회상 개선, 두 번째 유료 cycle 재사용을 확인한다.
이 시장의 공고가 월 7~9일에 몰리는 관측 때문에 임의의 `주 3일 접속`을 성공 gate로 쓰지 않는다.

### R2 — 발주문서 자동화 가설

- 실제 발주자료·사용 문서 inventory
- 입력 parser와 품목·단위 matching review
- template 기반 문서 생성과 revision
- 품목 합산, 피킹·배송 목록
- 원본/사용자 수정/생성물의 데이터 권위 ADR

**통과 조건:** 실제 발주자료에서 미확인 값을 숨기지 않고 구조화하며, 사용자가 수작업으로
만드는 핵심 문서의 시간과 수정 오류를 측정 가능하게 줄인다.

### R3 — 투찰 준비·납품 운영 자동화 가설

- 신규·변경·재입찰 감지
- 저장 조건 기반 사업자별 분류
- 마감·변경·미검토 알림
- 다사업자 대량 검토와 제출 대조
- 변경 발주·납품 충돌·미완료 알림
- 월간 운영 review 자동 생성

### R4 — 검증된 인텔리전스

- 비교 전략을 개찰 전에 version·cohort·`as_of`와 함께 봉인
- 시간순 out-of-sample shadow 평가
- 단순 baseline과 같은 티켓 수로 비교
- 실패 전략을 포함한 전체 결과 보존

이 단계가 성공해도 추천가를 자동 출시하지 않는다. 고객에게 추천·예측 표현을 제공하려면
통계적 검증, 사용자 오해 테스트, 제품 결정, Accepted ADR 변경이 모두 필요하다.

### R5 — Team·Enterprise

- 담당자 배정, 승인·반려, 예외 처리
- 역할·권한과 다법인·다지점 계층
- 조직 공통 판단/문서 template
- 감사 로그와 변경 추적
- API·ERP 연동
- SSO와 운영 SLA

Team UI는 3개 독립 고객이 다사용자·승인 문제에 실제 비용을 지불할 때, Enterprise 기능은
2개 이상 고객이 계약 조건으로 요구할 때 구체화한다.

## 6. 가격 가설

가격은 확정표가 아니라 유료 pilot에서 검증할 가설이다.

| 요금제 | 월 가격 가설 | 대상 | 포함 가치 |
|---|---:|---|---|
| Starter | 39,000원 | 1개 사업자, 대표자 중심 | 핵심 투찰 decision loop |
| Pro | 129,000원 | 최대 3개 사업자 | 고급 비교, 자동 분류·알림·대조, 기본 발주문서 자동화 |
| Team | 390,000원부터 | 여러 담당자·사업자 | 배정·승인·권한·감사, 대량 문서 운영 |
| Enterprise | 연간 계약 | 다법인·대규모 조직 | 조직 정책, SSO, API/ERP, SLA |

초기 design partner도 월 39,000~49,000원의 실제 결제를 받는 가설을 검증한다. 무료 사용 의향을
수요로 판정하지 않는다. 0건 낙찰 월을 포함한 3개월 유료 유지율 60%는 모집단과 cohort를
확정하기 전까지 초기 유지 gate 가설로만 취급한다.

## 7. 분석 효능 표현 원칙

2026년 8월 김해 replay에서 실제 1건과 일부 가상 전략 3건이 관측됐지만, 전략이 사전등록되지
않았고 paired 불확실성이 0을 포함하므로 제품 효능의 증거가 아니다. 가설 생성 자료로만
취급한다.

고객에게 보여주는 분석은 다음 이름과 조건을 따른다.

- 근거가 약한 경우: `과거 관측 분포`
- 사용자가 입력한 값: `후보 replay`
- 충분한 사전등록·시간순 검증 전: `추천`, `예측`, `AI 정답` 표현 금지

## 8. Roadmap과 delivery의 경계

- 이 문서는 capability의 문제, 약속, 비목표와 통과 조건을 관리한다.
- 구체 기능의 우선순위·담당·진행 상태·blocker는 Linear project와 issue에서 관리한다.
- 모든 delivery issue는 `R0`~`R5` 중 하나의 outcome에 연결하거나 `Discovery | Debt | Ops`로
  이유를 명시한다.
- 중대형 행동 변경은 필요할 때만 OpenSpec delta를 만들고 이 문서에는 상태를 복사하지 않는다.
- PR이 병합됐다는 이유만으로 roadmap gate를 통과한 것으로 보지 않는다. 시장·사용·품질 gate의
  evidence가 각각 충족돼야 한다.
