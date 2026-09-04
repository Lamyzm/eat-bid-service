---
id: EVIDENCE-BID-ROSTER-2026-09-03
status: active
canonical_for: eat-detail-bid-roster
last_reviewed: 2026-09-03
review_trigger: eat-detail-contract-or-screen-scope-change
---

# 상세 응답의 입찰 명단 (2026-09-03 실측)

## 1. 결론

상세 응답의 `ds_bidList`가 그 공고에 들어온 **입찰자 전원의 명단과 금액**을 담는다. 목록만으로는
경쟁자 수까지만 알 수 있고 결과는 알 수 없다. 화면을 만들려면 상세가 필요하다.

## 2. 관측한 공고

`ELCTRN_BID_ID=5796614`, "2026년 9월 전주솔내유치원 육류 소액수의 [재입찰]".
기초금액 3,393,450원, 목록의 `BID_CNT`는 13이고 `ds_bidList`도 13행이다. 두 값이 일치한다.

| 순위 | `BID_STT_NM` | `BID_CALC_AMT` | `SAJEONG_PCT` | `SHIPPER_NM` |
|---|---|---|---|---|
| 1 | 낙찰 | 3,027,000 | 90.265 | Food For You |
| 2 | 낙찰실패 | 3,030,600 | 90.372 | 화산축산 |
| 3 | 낙찰실패 | 3,046,000 | 90.831 | 청정축산 |

1등과 2등의 차이가 사정률 0.107%p, 금액으로 3,600원이다.

## 3. `ds_bidList`의 55개 컬럼 중 제품에 직접 쓰이는 것

| 컬럼 | 의미 |
|---|---|
| `RNK` | 순위 |
| `BID_STT_NM` | 낙찰 / 낙찰실패 |
| `BID_CALC_AMT` | 투찰금액 |
| `SAJEONG_PCT` | 사정률. 예정가격 대비 비율이라 공고 규모와 무관하게 비교된다 |
| `SHIPPER_CD` / `SHIPPER_NM` / `BIZ_NO` | 참여 업체 정체성 |
| `BID_DT` | 투찰 시각 |
| `DRAW_NO` | 복수예정가격 추첨 번호 |
| `TOTAL_NUM` | 참여 수. 목록의 `BID_CNT`와 일치했다 |
| `WITHDRAWAL_YN` | 철회 여부 |

`SAJEONG_PCT`가 핵심이다. 낙찰 방식이 98.9% "예정가격의 []%이상 입찰가 중 최저가"이므로 모든 참여가
같은 축 위의 값 하나로 환원된다.

## 4. 상세 응답의 다른 dataset

| dataset | 행 | 비고 |
|---|---|---|
| `ds_info` | 1 | **116컬럼**. 검토된 계약이 아는 13개의 아홉 배다 |
| `ds_bidList` | 13 | 입찰 명단 |
| `ds_pList` | 15 | 복수예정가격 후보로 보인다. 확인하지 않았다 |
| `ds_bidHistory` | 2 | 재입찰 이력으로 보인다. 이 공고 제목에 [재입찰]이 있다 |
| `ds_itemList` | 1 | 품목 |
| `ds_areaList` | 1 | 참가제한지역. 8컬럼 |
| `ds_mlsrItemInfo` | 1 | |
| `ds_eftInfo` / `ds_mainItemlist` / `ds_SelectUnionPurceTgtListR` | 0 | 이 공고에서는 비어 있다 |

## 5. 제품 경계

`SAJEONG_PCT` 분포와 경쟁자 수는 판단 재료다. 이것으로 추천 투찰가나 예측가를 만들지 않는다.
AGENTS 규칙 8과 ADR 0030이 정한 경계다. 화면은 과거 분포를 보이고 입력과 결정은 사용자의 행위다.

## 6. 확인하지 않은 것

- `ds_pList`가 복수예정가격 후보가 맞는지.
- `ds_bidHistory`가 재입찰 이력이 맞는지. 재공고·차수 연결의 근거가 될 수 있다.
- `SAJEONG_PCT`의 분모가 예정가격인지 기초금액인지.
- 유찰·공고취소 공고의 `ds_bidList` 모양.
