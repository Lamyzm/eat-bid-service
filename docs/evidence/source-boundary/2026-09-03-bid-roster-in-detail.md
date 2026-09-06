---
id: EVIDENCE-BID-ROSTER-2026-09-03
status: active
canonical_for: eat-detail-bid-roster
last_reviewed: 2026-09-04
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

## 6. `ds_pList`와 `SAJEONG_PCT`의 분모

`ds_pList`는 복수예정가격 후보다. `ELCTRN_BID_ID=5669410`(창원 남산초, 2025-11-20 개찰)에서
15행을 관측했다. 컬럼은 `CMNM_PLNPRC`(후보 예정가), `CMNM_PLNPRC_RT`(기준 대비 배율, 0.9701~1.0218
분포), `CMNM_PLNPRC_SN`(1~15 번호), `CHC_YN`(15행 중 4행이 `Y`)이다. `ds_info.PLNPRC_TYPE_CD=002`,
`PLNPRCE_TYPE_NM=복수예정가격`, `PLNPRCE_SUCBD_STD=90`과 함께 나타나 `docs/evidence/source-boundary/
2026-09-03-bid-roster-coverage.md` §7의 역산 결론(예정가격은 참여자 추첨으로 정해지고 `SAJEONG_PCT`는
기초금액이 아니라 그 예정가격 대비 비율)과 같은 모양이다.

### 6.1 전수로 확인된 것 (2026-09-04)

[전수 재정규화 리포트](../normalization/2026-09-04-eat-v2-renormalization.md)(계산 버전 `eat-v2-r3`,
표본 238,308)가 §6에서 미확인으로 남겼던 것을 닫았다.

- **`ds_pList`는 복수예정가격 후보 표가 맞다.** 보유율 99.925%.
- **집계 규칙은 "선택된 후보(`CHC_YN=Y`)의 산술 평균이 예정가격"이다.** §6에서 관측한 15행 중 4행이
  선택된 모양이며, 검사한 238,128회차 전부에서 위반이 0이다. 다만 그 평균은 `ELCTRN_BID_PLNPRC`가 원본에서 쓴 자릿수까지 ROUND_HALF_UP으로
  반올림해야 일치한다. 계약 `Money`가 소수 두 자리로 맞춘 값으로 검사하면 정상 회차 106건이 거짓
  위반으로 잡힌다. 최다 득표나 가중 평균이 아니다.
- **`SAJEONG_PCT`의 분모는 기초금액이 아니라 그 예정가격이다.** 위 불변식이 성립하는 회차에서 낙찰
  행의 사정률이 하한율 미만인 경우가 0건이라는 것이 같은 방향의 증거다.
- **`ds_bidHistory`는 재입찰 사슬이 맞다**(§7). 보유율은 3.314%뿐이라 대부분의 공고에서 비어 있다.
- **낙찰 방식은 `ds_info.SUCBID_DCSN_MTH_CD`가 코드 column이다.** 238,306건 전부에 있고 8종으로
  갈린다(`003`이 236,035건). `ds_bidList`·`ds_bidHistory`에 있는 `SUCBD_DECISION_MTHD`는 이름이
  비슷하지만 `ds_info`에는 없는 다른 column이고, `SUCBD_DECISION_MTHD_NM`은 라벨이지 코드가 아니다.

## 7. `ds_bidHistory`가 재입찰 이력이다

`ELCTRN_BID_ID=5306521`(완도 소안초·소안중, 2023-09-21 개찰, `RBID_YN=Y`)에서 `ds_bidHistory` 3행을
관측했다. `ETN_BID_ID` 기준 시간순으로 5301243(유찰) → 5306354(유찰) → 5306521(낙찰)이고, `BID_NM`은
첫 행에 "[재입찰]" 접미사가 없고 이후 두 행에는 있다 — 같은 공고가 유찰을 두 번 겪고 세 번째 차수에서
낙찰까지 간 재공고 사슬이다. `ds_info.UP_ELCTRN_BID_ID=5306354`는 `ds_bidHistory`의 직전 차수
`ETN_BID_ID`와 일치한다. 즉 `UP_ELCTRN_BID_ID`는 바로 앞 차수 하나만 가리키고, 전체 사슬(원 공고까지)은
`ds_bidHistory`가 담당한다. 재공고·차수 연결은 이 두 필드를 함께 읽어야 한다.

**`BID_NM`의 접미는 차수 신호가 아니다.** 위 표본에서 최초 공고에만 접미가 없었던 것은 우연이며,
[목록이 남긴 네 질문의 실측](2026-09-06-list-open-questions.md) §4.3이 1,000행에서 차수 ≥ 1인데
제목에 표시가 없는 행 68건과 차수 0인데 표시가 있는 행 3건을 관측했다. 차수는 `ELCTRN_BID_NO`
(목록에서는 `ETN_BID_NO`)의 `-N` 접미에서 읽는다. 레이크 12,000건에서 접미 ≥ 1 ⟺ `UP_ELCTRN_BID_ID`
있음 ⟺ `ds_bidHistory` 행 있음이 예외 0으로 성립하고, 접미 `N`이면 `ds_bidHistory` 행 수가 `N+1`이다.

## 8. 확인하지 않은 것

- 유찰·공고취소·개찰 전 공고의 `ds_bidList` 모양. §2·§6은 낙찰까지 간 공고만 봤고 2026-09-04 전수
  재정규화도 같다. `2026-09-03-bid-roster-coverage.md` §2는 목록 대조로 유찰·공고취소가 `ds_bidList`
  행 수 0을 낸다는 것만 확인했고, 그 공고들의 상세 응답 자체는 아직 열어보지 않았다. `eat-v2` 계약이
  새 블록을 `required`에 넣지 않은 이유가 이것이다([ADR 0029](../../adr/0029-eat-v2-bid-list-contract.md)).
- `WITHDRAWAL_YN`이 언제까지 채워지는지. 채움률이 수집 나이의 함수라 이 값으로 나눈 비율은 코호트
  성숙도를 병기해야 한다.

§6의 "복수예정가격 후보 표를 예정가격으로 집계하는 규칙"은 §6.1에서 닫혔다.
