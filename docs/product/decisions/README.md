---
id: PDR-INDEX
status: active
canonical_for: product-decision-record-index
last_reviewed: 2026-09-14
review_trigger: pdr-status-vocabulary-or-supersession-rule-change
---

# Product Decision Records

PDR은 이미 내린 **제품 기획 판단**과 그 판단을 되돌릴 조건을 보존한다. 목표 구조나 코드 경계를
바꾸는 결정은 여기가 아니라 [`../../adr/`](../../adr/)가 소유한다. 경계는 하나다 — **아키텍처를
바꾸면 ADR, 제품이 무엇을 하고 무엇을 하지 않을지를 정하면 PDR**이다.

Active PDR은 소급 수정해 결론을 뒤집지 않는다. 판단이 바뀌면 새 PDR을 쓰고 `Supersedes`로 대체를
선언하며, 원본에는 `Status: Superseded`와 `Superseded-by`를 함께 채운다(ADR과 같은 규율).

상태는 `Proposed`, `Active`, `Superseded` 중 하나다. `Proposed`인 행의 모음이 곧 **제품 기획 범위의
결정 대기 목록**이며, 이 목적으로 별도의 살아 있는 문서를 만들지 않는다.

| 번호 | 제목 | 상태 | 요약 | Linear |
|---|---|---|---|---|
| [0001](0001-region-is-user-set.md) | 업체 활동 지역은 사용자가 직접 설정한다 | Active | 사업자번호·참여 이력으로 유추하지 않는다. 지역 진실 원천은 `core` 코드 테이블 한 곳이고 canonical은 행정안전부 행정구역 코드, eaT 참가제한지역은 명시 매핑으로 잇는다 | EAT-54 |
| [0002](0002-day-floor-is-derived.md) | 그날 하한은 관측값이 아니라 파생값이다 | Active | 하한율 × 추첨 예정가격으로 계산한다. `BID_STT`에 하한 미달 판정이 없으므로 표본·코호트·계산 버전과 함께만 발표한다 | EAT-42 |
| [0003](0003-coverage-unknown.md) | 모집단 보유율은 모르면 `unknown`이라고 말한다 | Active | 지금 수집 구간에는 시도 축이 없어 그 grain의 분모를 낼 수 없다. `partial`로 뭉개면 화면이 "일부 수집됨"이라고 거짓말하므로 넷째 값을 둔다 | EAT-44 |
| [0004](0004-order-book-axis-is-assessment-rate.md) | 호가창의 눈금은 사정률이고 내 값도 사정률로 받는다 | Active | 남산초 실측에서 같은 92건이 사정률 축 29칸에 모이고 투찰률 축 83칸으로 흩어진다. 마감 전에는 두 축 사이 변환의 입력(예정가격)이 없으므로 레일 손잡이를 사다리에 꽂지 않고 기본값도 두지 않는다 | EAT-38 |
| [0005](0005-cohort-axis-is-floor-rate-and-list-size.md) | 비교집단을 가르는 축은 하한율과 명단 크기이고 품목이 아니다 | Superseded | 하한율·명단 규모 근거는 유지하고 기관 품목 조건의 금지는 PDR-0006으로 대체한다 | EAT-176 |
| [0006](0006-institution-and-regional-analysis.md) | 기관과 지역 전체를 같은 조건으로 비교한다 | Superseded | 임의 날짜·명단 범위와 동일 하한율·방식, 실제 build 참조와 공통 관측 집합은 PDR-0007이 이어받고, 기관에만 품목을 걸던 규칙은 대체된다 | EAT-213 |
| [0007](0007-item-condition-applies-to-every-population.md) | 품목 조건은 비교하는 모든 집단에 같게 적용한다 | Active | 조건 막대가 말하는 품목과 그린 구름이 어긋나지 않게 한다. 값은 원자 여덟이고 `품목 미확인`도 고르는 값이다 — 공고가 품목을 말하지 않은 회차가 33.4%라 자동으로 넣지도 빼지도 않는다 | EAT-176 |

## 문서 사이의 역할

- **Linear issue**: 무엇을 언제 만들 것인가. 담당·상태·blocker·acceptance의 유일한 동적 원천이다.
  결정 본문을 Linear에 복사하지 않고 `관련 PDR: docs/product/decisions/NNNN-슬러그.md`만 적는다.
- **PDR**: 왜 그렇게 하기로 했는가와 언제 다시 볼 것인가. 결정의 상태는 Linear가 아니라 PDR의
  `Status`가 원천이다.
- **영역 문서의 "미결" 절**: 예를 들어
  [`../decision-screen-v2/architecture.md`](../decision-screen-v2/architecture.md) §7은 그 문서
  범위의 결정 대기 항목을 1차로 보유한다. 답이 정해지는 순간 PDR로 옮겨 적고 원 절에는 PDR 링크
  한 줄만 더한다(내용은 지우지 않는다). 그래야 문서별로 흩어진 대기 항목을 이 색인에서 가로질러
  볼 수 있다.
- **[`../../PLANNING-LOG.md`](../../PLANNING-LOG.md)**: 세션 브레인스토밍 원본 기록이다. 결정으로
  승격된 항목은 PDR을 권위로 삼고 로그 항목에 승격 링크를 단다.

## 새 PDR 형식

`docs/product/decisions/NNNN-슬러그.md`로 만들고 번호는 ADR과 섞이지 않는 별도 시퀀스다.

```markdown
# PDR-NNNN — 제목

- Status: Proposed
- Date: YYYY-MM-DD
- Supersedes: 없음
- Superseded-by: 없음
- Linear: EAT-NN

## 결정
한두 문장. "무엇을 하지 않기로 했는가"도 결정이다.

## 배경
왜 이 질문이 생겼는가. 어떤 관측이나 사고 실험이 계기였는가.

## 대안과 기각 이유
고려했지만 채택하지 않은 안과 그 이유. 나중에 "왜 그때 이걸 안 했지"에 답한다.

## 되돌리기 조건
이 결정을 재검토해야 할 신호. **비워두지 않는다** — 재검토 시점이 서술에 묻히는 순간 결정
기록은 방치된다. 가능하면 관측 가능한 신호와 점검 지점을 함께 적는다.

## 영향
어느 화면·계약·ADR·Linear issue가 이 결정을 전제하는가.
```

ADR의 `Consequences` 대신 **되돌리기 조건**을 필수 필드로 둔다. 지표를 인용할 때는 규칙 7에 따라
표본 수·코호트·출처 문서·계산 버전을 함께 적는다.
