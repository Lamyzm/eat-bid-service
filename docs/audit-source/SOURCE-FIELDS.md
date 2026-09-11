# 소스 필드 사전 — 판단

**2026-09-11 · EAT-182**

필드 이름 하나로 그 필드가 무엇인지 찾기 위한 사전이다. 두 파일로 나뉜다.

| 파일 | 무엇이 들어 있나 | 누가 쓰나 |
|---|---|---|
| [`docs/audit-source/generated/source-field-index.md`](generated/source-field-index.md) | (dataset, 필드)마다 행수·채움률·고유값·값 예시·코드 함수성·파서 소비 | **생성기.** `pnpm source-fields:write` |
| 이 파일 | 계산되지 않는 판단 — 같은 이름 다른 어휘, 축 구분, 모르는 채로 남은 것 | **사람.** 리뷰 대상이다 |

## 0. 이 파일의 규칙

**이 파일에는 세는 값을 적지 않는다.** 건수·채움률·고유값·값 예시는 생성된 색인과
[`AUDIT-SOURCE.md`](../AUDIT-SOURCE.md)가 소유한다. 여기 숫자를 옮겨 적는 순간 그 숫자는 썩고,
사전은 두 번째로 죽는다.

같은 이름의 파일이 `docs/SOURCE-FIELDS.md`에 한 번 있었고 사라졌다. 손으로 유지하는 189필드
문서였기 때문이다. 우리가 통제하지 않는 소스를 필드 단위로 서술하면 소스가 바뀔 때마다 문서가
조용히 거짓말을 한다. 그래서 **세는 것은 생성기가 만들고 판단만 여기 남긴다.**

**옛 참조 주의.** `ARCH-DATA.md`·`ARCH-DELIVERY.md`·`docs/superpowers/plans/`가 `SOURCE-FIELDS.md §8`이나
`SOURCE-FIELDS.md:55` 같은 줄 번호로 인용하는 것은 **그 지워진 옛 파일**이고 이 파일의 절 번호가 아니다.
그래서 이 사전은 옛 경로를 되쓰지 않고 증거 옆(`docs/audit-source/`)에 두었다 — 옛 인용이 새 문서의
엉뚱한 절로 이어지지 않게 하려는 것이다. 그 인용이 가리키던 측정은
[`AUDIT-SOURCE.md`](../AUDIT-SOURCE.md)가 전수로 다시 쟀다.

찾는 순서.

1. 필드 이름을 안다 → 생성된 색인에서 그 이름을 찾는다. 같은 이름이 여러 dataset에 있으면 붙어 나온다.
2. 색인 줄의 `함정` 칸에 `T*`가 있다 → **먼저 여기를 읽는다.** 그 칸이 비어 있어야 그대로 써도 된다.
3. 원본 측정의 맥락이 필요하다 → 각 항목이 단 `AUDIT-SOURCE.md` 절 번호로 간다.

## 1. 같은 이름 다른 어휘 — 먼저 볼 것

이 절이 이 사전에서 값이 가장 큰 부분이다. 아래 함정은 전부 **이름이 비슷해서 같은 축으로 착각한**
사고이며, 2026-09-11 한 세션에서 실제로 네 번 일어났다.

### T1. 지역은 두 축이다 — 학교 위치와 공급사 참가자격

- 걸린 자리: `ds_info.SIDO_CD`, `ds_info.SIGUNGU_CD`, `ds_info.DOG_ADDR`, `ds_areaList.CTPV_CD`, `ds_areaList.PDLC_CD`, `ds_areaList.PDLC_NM`, `ds_areaList.SGG_CD`, `ds_areaList.SGG_NM`
- 근거: `AUDIT-SOURCE.md` §8.5 · §8.3 · §10.1

`ds_info`의 `SIDO_CD`·`SIGUNGU_CD`·`DOG_ADDR`은 **급식을 먹는 학교가 어디 있는가**이고,
`ds_areaList`의 `CTPV_CD`·`PDLC_CD`는 **어느 지역 업체가 응찰할 수 있는가**다. 서로 다른 질문이다.

경기 공고의 첫 참가제한지역이 서울인 건이 실제로 있다(§8.5). 두 축을 같은 "지역"으로 묶으면
자격 판정이 틀리고, "이 지역 학교 공고"와 "이 지역 업체가 들어갈 수 있는 공고"가 뒤섞인다.

- 학교 위치축에는 **이름 필드가 없다.** `SIDO_NM`·`SIGUNGU_NM`은 상세 응답에 아예 오지 않는다.
  "소스가 지역 이름을 안 준다"는 말은 이 축에서만 맞다.
- 참가자격축에는 이름이 있다(`CTPV_NM`·`PDLC_NM`). **한쪽에 이름이 없다고 다른 쪽도 없다고 하지 마라.**
- **`SIGUNGU_CD`는 진짜 시군구 코드다.** 이름표가 없어 주소로 검증했고, 한 코드 값이 두 시도에 걸치는
  일이 없다(§8.3). 단 소수의 주소 불일치가 있고 **어느 쪽이 틀렸는지는 모른다**(§8.3).
- **`PDLC_CD`도 진짜 코드다.** 색인의 `이름다중`이 0이 아닌 것은 같은 지역을 `경기/광주`와 `경기/광주시`로
  적은 표기 변이 때문이고, 정규화하면 실질적으로 사라진다. 역방향은 깨끗하다(§8.2).
  **`이름다중`이 0이 아니라는 이유만으로 코드가 아니라고 판정하지 마라.**
- 참가자격축 안에서도 `PDLC_CD`가 시군구 코드이고 `SGG_CD`는 아니다 → T3.
- `SIGUNGU_CD`(학교 위치)와 `PDLC_CD`(참가자격)는 **서로 다른 어휘다.** 종수도 다르다. 섞지 마라(§8.3).

### T2. 시도 코드는 세 어휘다 — 형식도 값 집합도 다르다

- 걸린 자리: `ds_info.SIDO_CD`, `ds_areaList.CTPV_CD`
- 근거: `AUDIT-SOURCE.md` §8.4 · §10.1

셋이 돌아다닌다. `ds_info.SIDO_CD`(무패딩), `ds_areaList.CTPV_CD`(2자리 0패딩),
그리고 목록 질의 파라미터 `P_CTPV_CD`다. **자릿수만 맞춰서 같다고 보면 안 된다** —
`CTPV_CD`에만 있는 시도가 있고 질의 코드에는 또 없다(§8.4).

행정안전부 행정구역 코드와도 별개 체계다. 명시적 매핑 없이 같다고 보지 마라(AGENTS 6).

### T3. `SGG_CD`는 세 곳에서 서로 다른 값 공간을 쓴다

- 걸린 자리: `ds_areaList.SGG_CD`, `ds_areaList.SGG_NM`, `ds_compList.SGG_CD`, `ds_areaList.PDLC_CD`, `ds_info.SIGUNGU_CD`
- 근거: `AUDIT-SOURCE.md` §8.1 · §8.4 · §10.1

`ds_areaList`, `ds_compList`, 그리고 계약현황 API가 각각 `SGG_CD`라는 이름을 쓰는데 **셋의 값 집합이
다르다**(§8.4). 필드 이름만 보고 조인하면 세 어휘가 한 칸에 섞인다.

그 위에 두 가지가 더 있다.

1. **`ds_areaList.SGG_CD`는 시군구 코드가 아니다.** 전국 시군구 수보다 훨씬 적은 값으로 뭉쳐 있고,
   한 코드가 여러 이름을 갖는다(§8.1). 시군구 축이 필요하면 참가자격에서는 `PDLC_CD`,
   학교 위치에서는 `SIGUNGU_CD`다.
2. **`SGG_NM`은 절단과 온전이 섞인다.** 두 글자로 잘린 이름과 온전한 이름이 같은 열에 있어
   이름 기준 매칭이 깨진다(§8.1).

계약현황 API 쪽 값은 표본 1페이지에서 본 것이라 값 공간의 크기를 주장할 근거가 없다.
**셋이 다르다는 것까지가 관측이고, 계약현황 `SGG_CD`가 무엇인지는 모른다.**

### T4. `PLNPRCE_SUCBD_STD`는 상세와 목록이 여집합이다

- 걸린 자리: `ds_info.PLNPRCE_SUCBD_STD`, `ds_list.PLNPRCE_SUCBD_STD`, `ds_bidHistory.PLNPRCE_SUCBD_STD`
- 근거: `AUDIT-SOURCE.md` §4 · §7 · §8.4

같은 이름인데 상세는 하한율, 목록과 이력은 `100 −` 하한율이다. 예외 0으로 굳은 불변식이다(§4).
**"값이 완전히 달라 보인다"는 옛 판정은 틀렸다** — 다른 값이 아니라 뒤집힌 값이다.

두 응답의 값을 한 열에 그대로 쌓으면 하한율 분포가 두 봉우리로 갈라진다. 어느 응답에서 온
값인지를 함께 들고 다녀야 한다.

목록에서 하한율을 **텍스트로 복원하려 하지 마라.** 목록의 `SUCBD_DECISION_MTHD_NM`은 대괄호 안이
비어 있다(§7).

### T5. `CTDU_DTL_STAT_CD`는 상세와 계약현황의 값 범위가 다르다 — 같은 뜻인지 모른다

- 걸린 자리: `ds_info.CTDU_STAT_CD`, `ds_info.CTDU_DTL_STAT_CD`, `ds_info.CTDU_SN`
- 근거: `AUDIT-SOURCE.md` §6.1 · §8.4 · §10.1 · §10.7

상세의 값과 계약현황 API의 값이 다른 범위에 있다(§8.4). **같은 축인지 확인하지 않았다.**
상세에는 짝이 되는 이름 필드가 없고 계약현황에는 있지만, 그 이름을 상세 값에 붙일 근거가 없다.

`CTDU_SN`은 공고와 1:1이라 새 그룹핑을 주지 않는다. 계약현황 API의 같은 이름 필드와 값 공간이
같으면 조인 키가 될 수 있지만 **그것도 확인하지 않았다**(§10.1).

이 세 필드의 뜻은 모른다. 그 위에 아무것도 짓지 마라(AGENTS 3).

### T6. `MLFD_CLASS_CD`/`MLFD_CLASS_NM`은 분류가 아니라 자유 입력이다

- 걸린 자리: `ds_itemList.MLFD_CLASS_CD`, `ds_itemList.MLFD_CLASS_NM`, `ds_schList.MESG_CLSF_CD`, `ds_schList.MESG_CLSF_NM`, `ds_SelectUnionPurceTgtListR.S_MLFD_CLASS_NM`
- 근거: `AUDIT-SOURCE.md` §8.1 · §10.1 · §10.3

`_CD`로 끝나지만 코드가 아니다. 한 코드가 여러 이름을 갖고 양방향이 다 깨진다(§10.1).
실제 정체는 **공고 안 품목 줄의 순번**이다(§8.1).

짝인 이름 쪽은 학교 담당자가 친 문장이다. 같은 뜻을 여러 표기로 쓰고 월·용도까지 섞여 들어온다.
**품목 필터의 입력으로 쓸 수 없다.**

공고의 품목군은 `MAIN_ITEM_NM`/`MAIN_ITEMS`/`ITEM_GB_NM`의 닫힌 원자 어휘이며 **코드가 없다**(§10.3).
식재료 표준코드 API로 갈아타는 것도 안 된다 — 계층이 어긋나 함수 대응이 성립하지 않는다(§10.3).

### T7. `ds_itemList`는 품목 목록이 아니다

- 걸린 자리: `ds_itemList`, `ds_itemList.MLFD_NM`, `ds_itemList.MLFD_STT`, `ds_itemList.CNSLT_NO`, `ds_itemList.ETN_BID_LINE_ID`, `ds_mlsrItemInfo.MLSR_ITEM_YN`
- 근거: `AUDIT-SOURCE.md` §3 · §3.1 · §10.1

이름 때문에 "공고에 딸린 품목들"로 읽히지만 **급식 구매건 한 줄**이다. 이 블록은 한 응답에서
1행을 넘은 적이 없고(§3), 다수품목은 이 블록으로 표현되지 않는다.

- **`MLFD_NM`이 그 구매건의 이름이다.** 이 블록에서는 100% 채워져 있고 "2026년 6월 학교급식
  식재료(공산품) 구입" 같은 값이 온다.
  **같은 이름이 `ds_info`에도 선언되는데 그쪽은 전 코퍼스에서 한 번도 채워지지 않는다**(§3.1).
  `ds_info`에서 이 이름을 찾아 비어 있다고 "소스가 안 준다"로 결론 내면 틀린다 — 블록을 봐라.
- `ETN_BID_LINE_ID`는 줄 번호지 코드가 아니다(§10.1).
- `STO_MNL_FILENAME`·`STO_MNL_FILEPATH`(현품설명서)도 항상 빈칸이다. 현품설명서는
  `ds_info.ATCHFL_ID` + 첨부 엔드포인트로만 닿는다(§3.1 · §1.1).

`MLSR_ITEM_YN`이 `N`이면 이 블록은 반드시 비어 있다(§4). 다만 **`MLSR_ITEM_YN`의 뜻 자체는 모른다**(§6.2).

### T8. `LIMIT_CONDITION_NM`은 상세와 목록이 다른 문자열이다

- 걸린 자리: `ds_info.LIMIT_CONDITION_NM`, `ds_list.LIMIT_CONDITION_NM`, `ds_bidHistory.LIMIT_CONDITION_NM`
- 근거: `AUDIT-SOURCE.md` §5 · §7 · §8.4

코드는 같은데 이름만 짧은 판과 긴 판이 따로 온다(§5). **이름으로 조인하면 깨진다.**
코드(`LIMIT_CONDITION`·`LMT_CNDTN_CD`)로 조인하고, 화면 라벨은 한쪽을 골라 쓴다.

같은 코드에 짧은 이름과 긴 이름이 따로 코드북 그룹으로 존재한다는 것까지 확인됐다(§5).

### T9. 자격제한 코드는 하나가 아니라 넷이다

- 걸린 자리: `ds_info.QLFC_LMT_ITM_CD`, `ds_info.QLFC_LMT_ITM_CD2`, `ds_info.QLFC_LMT_ITM_CD3`, `ds_info.QLFC_LMT_ITM_CD4`, `ds_info.QLFC_LMT_ITM_CD_NM`, `ds_info.ETC_QLFC_LMT_CN`, `ds_schList.QLFC_LMT_ITM_CD`, `ds_SelectUnionPurceTgtListR.QLF_LIMIT_ITEM`
- 근거: `docs/audit-source/census-detail.txt` §ds_info · `AUDIT-SOURCE.md` §8.2

`QLFC_LMT_ITM_CD` 하나만 보고 "자격제한 없음"으로 판정하면 2·3·4번 자리의 제한을 놓친다.
넷은 채움 분포가 서로 다르다(색인의 `고유`·`값 예시` 칸을 보라).

이름 필드는 `QLFC_LMT_ITM_CD_NM` 하나뿐이고 **짝 대조가 된 것은 첫 번째 코드뿐이다.** 2·3·4에 붙는
이름 필드는 없다. **나머지 셋이 무슨 제한을 뜻하는지, 첫 번째와 같은 값 어휘인지는 확인하지 않았다.**

이름은 세 축에 흩어져 있다. 공동구매 블록(`ds_SelectUnionPurceTgtListR`)은 같은 세 자리를
`QLF_LIMIT_ITEM`·`QLF_LIMIT_ITEM2`·`QLF_LIMIT_ITEM3`이라는 **또 다른 이름**으로 주고,
`ds_schList`는 `QLFC_LMT_ITM_CD` 계열 이름을 쓴다. **셋이 같은 축인지 모른다.**

기타 자격제한은 코드가 아니라 자유 텍스트(`ETC_QLFC_LMT_CN`)로 온다.

### T10. 업체 사업자번호는 블록마다 하이픈이 다르다

- 걸린 자리: `ds_bidList.BIZ_NO`, `ds_bidList.SHIPPER_BRNO`, `ds_compList.BRNO`, `ds_bidList.SHIPPER_CD`, `ds_bidList.SHIPPER_NM`
- 근거: `AUDIT-SOURCE.md` §10.1 · §10.2 · §10.6

`ds_compList.BRNO`에는 하이픈이 있고 `ds_bidList.BIZ_NO`에는 없다. **문자열 그대로 조인하면 한 건도
안 붙는다**(§10.6).

업체 정체성은 사업자번호도 이름도 아니고 `SHIPPER_CD`다. 이름으로 세면 서로 다른 업체가 합쳐지고
사업자번호로 세도 일부가 합쳐진다 — 셋 중 `SHIPPER_CD`가 가장 잘게 쪼갠다(§10.2).
`FRST_RGTR_ID`는 투찰자 로그인 계정이지 업체가 아니다(§10.1).

### T11. `MAIN_ITEMS`와 `MAIN_ITEM_NM`은 공백만 다르다 — 그런데 그대로 비교하면 깨진다

- 걸린 자리: `ds_info.MAIN_ITEMS`, `ds_mainItemlist.MAIN_ITEM_NM`, `ds_SelectUnionPurceTgtListR.ITEM_GB_NM`, `ds_schList.ITEM_GB_NM`
- 근거: `AUDIT-SOURCE.md` §10.6 · §10.3 · §4

두 필드의 진짜 불일치는 없고 차이는 전부 콤마 앞뒤 공백이다(§10.6). 그런데 문자열을 그대로 비교하면
상당수가 다른 값으로 갈라져 **어휘가 두 벌이 된다.** 하나만 골라 쓰거나 공백을 정규화하라.

`MN_TRMT_LMT_YN`은 `MAIN_ITEMS` 존재 여부와 완전 동치다(§4). **"단독입찰 허용 여부"가 아니다** → T13.

### T12. 사실이 아닌 필드 — 저장하면 안 되는 것과 한 번도 안 채워지는 것

- 걸린 자리: `ds_info.DATD_DIF`, `ds_info.DATECOUNT5`, `ds_info.DATECOUNT6`, `ds_info.DATECOUNT7`, `ds_info.REM_HOUR`, `ds_info.REM_MIN`, `ds_info.REM_SEC`, `ds_info.TOTAL_SEC`, `ds_info.CANCEL_REASON`, `ds_info.BID_BGNG_DT1`, `ds_info.BID_END_DT1`, `ds_info.OPNG_DT1`, `ds_eftInfo`
- 근거: `AUDIT-SOURCE.md` §6.2 · §3.1 · §3

세 부류가 섞여 있다.

1. **요청 시각에 따라 값이 바뀌는 카운트다운.** 같은 공고를 다시 받으면 달라진다. 사실이 아니므로
   저장하면 안 된다(§6.2).
2. **선언은 되는데 전 코퍼스에서 한 번도 값이 안 오는 키.** `ds_info`의 `CANCEL_REASON`·`MLFD_NM`,
   `ds_itemList`의 `STO_MNL_FILENAME`·`STO_MNL_FILEPATH`(현품설명서), `ds_bidList`의 적격심사 점수
   필드들이 그렇다. 전체 목록은 §3.1이 소유한다.
   **"필드가 있다"와 "값이 온다"는 다르다.** 적격심사 점수는 비로그인 응답으로는 못 본다 —
   로그인하면 오는지는 모른다(§11).

   ⚠ **이 키들은 생성된 색인에 없다.** census 표가 값이 한 번이라도 온 키만 싣기 때문이다.
   색인에서 이름을 못 찾았다고 "소스에 그 필드가 없다"로 결론 내지 마라 — §3.1을 함께 봐야 한다.
   `ds_info.MLFD_NM`이 그 함정의 대표다. 같은 이름이 `ds_itemList`에서는 100% 채워진다(T7).
3. **초 없는 중복.** `..._DT1`은 `..._DT`의 절단본이다(§6.2).

`ds_eftInfo`는 전 코퍼스에서 컬럼 0개·행 0개다. 비어 있는 것이 정상이고 기다릴 것 없다(§3).

### T13. `RBID_YN`은 재입찰 신호가 아니다

- 걸린 자리: `ds_info.RBID_YN`, `ds_info.CHG_TP_NM`, `ds_info.PBANC_CHG_GB_CD`, `ds_info.UP_ELCTRN_BID_ID`, `ds_info.MN_TRMT_LMT_YN`
- 근거: `AUDIT-SOURCE.md` §9 · §6.1 · §10.4 · §4

이름이 "재입찰 여부"로 읽히지만 일반공고에서도 대부분 `Y`다(§9). 재입찰을 이 필드로 거르면
거의 전부가 통과한다.

재입찰 신호는 `CHG_TP_NM`이고, 그 짝 코드 `PBANC_CHG_GB_CD`가 있다(§10.4).
**이름으로 비교하지 말고 코드로 비교하라.** 사슬 연결은 `UP_ELCTRN_BID_ID`이며 `ds_bidHistory` 행의
존재와 동치다(§4).

`MN_TRMT_LMT_YN`도 이름과 뜻이 다르다 → T11. 단독입찰은 `SGNS_BID_PRCS_MTHD_CD` 쪽이다(§9).

### T14. `EFT_ALL_AMT`는 무효 투찰의 진짜 금액을 갖고 있다

- 걸린 자리: `ds_bidList.EFT_ALL_AMT`, `ds_bidList.BID_CALC_AMT`, `ds_bidList.SAJEONG_PCT`, `ds_info.EFT_ALL_AMT_ENC`
- 근거: `AUDIT-SOURCE.md` §10.5 · §6.2

`BID_CALC_AMT`는 하한 미달 투찰에서 sentinel 값으로 가려지는데 `EFT_ALL_AMT`에는 원래 금액이 남는다(§10.5).
"두 필드 값이 같아 보인다"는 옛 판정은 **틀렸다** — 표본이 정상 행에 몰려 있었다.

사정률(`SAJEONG_PCT`)로 금액을 되돌리려 하지 마라. 반올림 때문에 거의 복원되지 않는다(§10.5).

이름이 비슷한 `ds_info.EFT_ALL_AMT_ENC`는 **다른 블록의 다른 필드다.** 이름은 암호화를 뜻하는데 값은
평문 금액으로 보인다. **의미를 모른다**(§6.2).

### T15. `RNK`·`RNK2`·`RNK3`는 서로 다른 순위이고 차이를 모른다

- 걸린 자리: `ds_bidList.RNK`, `ds_bidList.RNK2`, `ds_bidList.RNK3`
- 근거: `AUDIT-SOURCE.md` §6.2 · §9

"전부 상수"라는 옛 판정은 틀렸다. 셋은 서로 다른 값을 갖고 1위 건수도 다르다(§6.2).
**무엇이 다른지는 모른다.** 순위를 쓰려면 어느 것인지 먼저 정하고 그 근거를 남겨라.

낙찰자 자체는 순위가 아니라 `BID_STT_NM`이 정한다 — 공고당 정확히 1행이며 예외가 없다(§4).

### T16. `SUCBD_DECISION_MTHD_NM`을 파싱하지 마라

- 걸린 자리: `ds_info.SUCBD_DECISION_MTHD_NM`, `ds_info.SUCBID_DCSN_MTH_CD`, `ds_list.SUCBD_DECISION_MTHD_NM`, `ds_info.TP_NM`
- 근거: `AUDIT-SOURCE.md` §10.4 · §7

이름 안에 하한율 숫자가 박혀 있어서 `ds_info`의 어떤 코드도 이 이름을 결정하지 못한다.
**낙찰자 결정 방법은 `SUCBID_DCSN_MTH_CD`와 `PLNPRCE_SUCBD_STD` 두 필드로만 결정된다**(§10.4).
문장에서 숫자를 뽑아내는 길로 가면 목록 응답에서 그 자리가 비어 있어 막힌다(§7 · T4).

`TP_NM`은 아예 짝 코드가 상세 응답에 없다. 코드북에 해당 어휘가 있지만 그 코드 컬럼이 응답에
오지 않는다(§10.4).

### T17. 통제 어휘는 손으로 적지 말고 코드북에서 받는다

- 걸린 자리: `ds_info.BID_TYPE_CD`, `ds_info.CNTRCT_FORM`, `ds_info.CTRT_LAW_CD`, `ds_info.PLNPRC_TYPE_CD`, `ds_info.LMT_CNDTN_CD`, `ds_list.ETN_BID_STT`, `ds_info.ELCTRN_BID_STT_NM`
- 근거: `AUDIT-SOURCE.md` §5 · §2 · §10.7

서버가 코드북 엔드포인트로 통제 어휘를 준다(§5). 우리가 손으로 열거하면 그 목록이 우리 것이 되고
소스가 늘릴 때 조용히 틀린다(AGENTS 6 · 22).

단서 셋.

1. 코드북 그룹과 우리 필드의 대응은 **이름 유사성 기준 추정**이며 값까지 대조한 그룹은 일부뿐이다(§11).
2. **전체 그룹 목록을 모른다.** 그룹 id를 알아야만 받을 수 있고, 아는 id는 폼에서 긁은 것뿐이다(§10.7).
3. 상태 어휘는 12종인데 **우리 코퍼스에는 낙찰 한 종만 있다.** 수집이 그 상태로 고정돼 있기
   때문이며(§2), 그래서 `ELCTRN_BID_STT_NM`은 지금 코퍼스로는 잴 수 없다(§10.4).
   "값이 한 종뿐"을 "어휘가 한 종"으로 읽지 마라.

## 2. 모르는 채로 남은 것

추측으로 채우지 않는다(AGENTS 3). 아래는 원본 감사가 모른다고 적은 것을 그대로 옮긴 것이며
전체 목록과 맥락은 `AUDIT-SOURCE.md` §10.7과 §11이 소유한다.

| 무엇 | 어디까지 아나 | 근거 |
|---|---|---|
| `SIGUNGU_CD`의 공식 명칭 목록 | 코드가 시도 하나에만 나타난다는 것까지. 이름표는 원본에 없고 주소로 검증만 했다 | §8.3 · §10.7 |
| 창원·서초·사하 등 주소와 어긋나는 소수 건 | **어느 쪽이 틀렸는지는 모른다** | §8.3 |
| `CTDU_STAT_CD`·`CTDU_DTL_STAT_CD`의 뜻 | 값 분포만. 계약현황과 같은 축인지 모른다 | §10.7 → T5 |
| `MLSR_ITEM_YN`의 뜻 | `N`이면 `ds_itemList`가 빈다는 관계만 | §6.2 → T7 |
| `EFT_ALL_AMT_ENC`의 의미 | 이름과 값이 어긋난다는 것만 | §6.2 → T14 |
| `RNK`·`RNK2`·`RNK3`의 차이 | 셋이 다르다는 것만 | §6.2 → T15 |
| `BRNO`(기관)·`ORDR_ID`가 무엇의 축인가 | 카디널리티만 | §6.2 · §10.1 |
| `MESG_SN`과 `CNSLT_NO`의 관계 | 카디널리티가 같다는 것까지 | §10.7 |
| `ATCHFL_ID` 중복 1건 | 두 공고가 같은 첨부를 가리키는 이유를 모른다 | §10.7 |
| 로그인 뒤에 오는 4블록과 적격심사 점수 | 비로그인으로는 안 온다는 것까지 | §1.3 · §11 |
| `분석정보` 12개 화면의 데이터 출처 | 폼이 껍데기라는 것까지 | §1.4 · §11 |
| 계약현황의 날짜 필터 파라미터 이름 | 우리가 준 이름이 안 먹는다는 것까지 | §10.7 |
| 계약현황·발주계획·견적요청의 코드 함수성 | 안 쟀다. 표본 1페이지만 봤다 | §10.7 |
| `QLFC_LMT_ITM_CD2`~`CD4`의 값 어휘 | 넷이 따로 온다는 것까지 | T9 |
| 계약현황 `SGG_CD`의 값 공간 | `ds_areaList`·`ds_compList`와 다르다는 것까지 | §8.4 → T3 |
| `ds_info` 키 수가 안 맞는다 | §3.1이 적은 "값 등장" 키 수와 색인의 `ds_info` 줄 수가 하나 어긋난다. 어디서 갈리는지 **재보지 않았다.** 두 측정의 시점이 다른 것이 원인일 수 있으나 확인하지 않았다 | §3.1 |

## 3. 정정 이력 — 옛 문서가 틀렸던 것

`AUDIT-SOURCE.md` §9가 이 자리에 있던 옛 `docs/SOURCE-FIELDS.md`를 정정하고 있었다. 그 파일이
사라진 뒤에도 정정만 남아 고칠 대상이 없었다. **이제 그 정정을 여기가 이어받는다** — 각 줄을
지금 살아 있는 함정 항목과 짝짓는다.

**실측 숫자는 옮기지 않는다.** 숫자의 권위는 [`AUDIT-SOURCE.md` §9](../AUDIT-SOURCE.md)와 그 근거 절에
그대로 있고, 여기는 "무엇을 잘못 알고 있었나"만 적는다(§0 규칙).

| 옛 서술 | 실측 | 근거 |
|---|---|---|
| `MN_TRMT_LMT_YN` = "단독입찰 허용 여부" | 아니다. `MAIN_ITEMS` 존재 여부와 완전 동치다. 단독입찰은 `SGNS_BID_PRCS_MTHD_CD` | §4 → T11 · T13 |
| `RBID_YN` = "재입찰 여부" | 오해를 부른다. 일반공고에서도 대부분 `Y`다. 재입찰 신호는 `CHG_TP_NM` | §6.1 → T13 |
| `RNK2`·`RNK3` = "전부 상수" | 아니다. 셋이 서로 다르다 | §6.2 → T15 |
| 목록의 `PLNPRCE_SUCBD_STD`는 "완전히 다른 값" | 여집합이다. 예외 0 | §4 → T4 |
| `ds_info` 키 수 · `ds_bidList` "22키 미사용" | 선언 키 수와 값이 오는 키 수가 다르다. 수는 §9·§3.1이, "우리가 읽는 키"는 색인의 `파서` 칸이 소유한다 | §3.1 → T12 |
| 블록 채움률(표본 추정) | 전수로 다시 쟀다. 수는 색인의 dataset 대장이 소유한다 | §3 |
| `SIGUNGU_CD` "사용 예정(지역 축)" | 맞다. 다만 `ds_areaList`와 **다른 축이다** | §8.5 → T1 |
| `EFT_ALL_AMT` "`BID_CALC_AMT`와 값이 같아 보인다" | 틀렸다. 무효 투찰의 진짜 금액을 담는다 | §10.5 → T14 |

마지막 줄은 옛 문서가 아니라 `AUDIT-SOURCE.md` §6.2가 자기 자신을 정정한 것이다(§10.5).
감사 문서도 중간에 판정을 뒤집었으므로 그 줄도 함께 이어받는다.

## 4. 왜 이번에 게이트를 걸지 않았나

새 필드를 쓸 때 이 사전을 읽었는지 검사하는 lint를 만들지 않았다. 세 가지 이유다(EAT-182 결정 6).

1. **표면이 작다.** 우리가 실제로 부르는 엔드포인트는 둘뿐이고, 새 필드를 붙이는 일은 아직 드물다.
2. **사전의 모양이 맞는지 아직 모른다.** 한 번도 쓰이지 않은 문서 형식에 강제를 걸면 형식을 바꿀 때마다
   강제를 함께 고쳐야 하고, 조사성 작업이 먼저 막힌다.
3. **검사할 대상이 판단이다.** "이 필드를 이 축에 넣어도 되는가"는 경로 규칙으로 판정되지 않는다.
   지금 걸 수 있는 것은 "생성물이 최신인가" 정도인데 그건 사전이 안 읽히는 문제를 풀지 못한다.

대신 구속력은 **코드 옆 주석**이 갖는다. 함정 필드를 읽는 dataplane source 모듈에는 한국어 이유
주석이 달려 있고 여기로 보낸다(AGENTS 13). 사전은 찾는 도구다.

강제하는 것은 하나뿐이다. **색인 생성물이 입력과 어긋나면 `pnpm test:quality`가 깨진다.**
이건 사전 사용을 강요하는 규칙이 아니라 생성물이 거짓말하지 않게 하는 검사이며, 이 파일의 함정을
고치고 생성기를 안 돌린 경우도 여기서 걸린다. 고치는 법은 실패 메시지가 적어 준다.

사전이 실제로 쓰이는 것을 본 뒤에 무엇을 강제할지 다시 정한다.

## 5. 생성기

```
pnpm source-fields:write
```

`tools/architecture/generate-source-field-index.mjs`가 `docs/audit-source/census-detail.txt`,
`census-list.txt`, `keys-ledger.txt`와 `apps/dataplane/src/eatbid/source/eat/`를 읽어
[`docs/audit-source/generated/source-field-index.md`](generated/source-field-index.md)를 만든다.
이 파일의 `### T*` 제목과 `걸린 자리:` 줄도 읽어 색인의 `함정` 칸을 만든다 —
**함정을 추가하면 생성기를 다시 돌려라.**

census 원자료가 새로 만들어지면 색인도 그때 갱신된다. census 자체를 다시 만드는 도구는 이 저장소에
없다(원본 조사 도구는 `AUDIT-SOURCE.md` 머리말이 위치를 적어 두었다).
