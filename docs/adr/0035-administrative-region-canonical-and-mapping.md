# 0035 — 행정구역 코드 canonical과 매핑 정책

- Status: Proposed
- Date: 2026-09-06
- Refines: [0006](0006-identifiers-and-code-schemes.md) (내부 ID와 source-scoped code scheme)
- Relates: [0025](0025-source-release-manifest.md), [0034](0034-mart-build-identity-and-atomic-activation.md),
  [PDR-0001](../product/decisions/0001-region-is-user-set.md)

## Context

[PDR-0001](../product/decisions/0001-region-is-user-set.md)은 지역의 canonical이 행정안전부 코드라고
정했지만 **어느 정부 파일이 canonical인지**, **좌표를 어디에 두는지**, **eaT 지역 코드와의 대응을
무엇이 승인하는지**는 비어 있었다. 그 공백을 화면과 프론트 상수가 메우고 있었다 —
`apps/web/src/lib/region-coords.ts`는 `'{sido}|{sigungu}'` 문자열 키 136개로 표기 변이마다 같은 좌표를
2~4번 다시 선언하고, 소스 주석이 스스로 2017년 스냅샷이라고 적고 있다.

실측 근거는 셋이다.

1. `core.code_value`의 `mois:administrative-region` 행은 **0건**이다. scheme seed는 있지만 적재 경로가
   없다(`packages/db/src/seeds/code-schemes.ts`).
2. eaT 지역 축은 코드마다 성질이 다르다. `docs/audit-source/census-detail.txt` §3에서
   `ds_areaList.CTPV_CD → CTPV_NM`은 18코드·이름 다중 0건으로 코드지만,
   `SGG_CD → SGG_NM`은 33코드 중 15개(45.5%)가 여러 이름을 갖는다 — **`SGG_CD`는 코드가 아니다.**
   따라서 `PDLC_CD`(189종)의 뒤 세 자리를 시군구 코드로 읽으면 안 된다.
3. 2026-09-06 행정안전부 공식 전체자료 실측(`docs/audit-source/reference-source-contracts.json`)은
   53,387행·10자리 코드·CP949·탭 구분·컬럼 셋(`법정동코드`·`법정동명`·`폐지여부`)이었고
   **날짜 컬럼이 하나도 없다.** 같은 화면에서 변동내역 파일은 제공되지 않는다.

## Decision

1. canonical은 행정안전부 **법정동코드**이며 `mois:administrative-region` 하나로 적재한다.
   행정동코드는 적재하지 않는다. 제품의 가장 고운 지역 축은 시군구이고 두 체계는 시군구 위에서 같은
   구역을 가리키므로, 행정동을 고를 이유가 되는 차이가 우리 축에 없다.
2. canonical grain은 **시도·시군구 두 단계**다. `code_value.code`는 원본 10자리 문자열을 그대로
   보존한다(`1100000000` 서울특별시, `1111000000` 종로구). 5자리로 자르지 않는다.
   읍면동·리 행은 승격하지 않으며, **무엇을 뺐는지**를 `core.code_release`의 `promoted_grain`·
   `source_row_count`·`member_count`·`excluded_row_count`가 기록한다. 원본 파일 전체는 R2에 남는다.
3. 계층은 release별 사실이므로 `core.code_release_member.parent_code_value_id`가 갖는다.
   `core.code_value`는 시간축을 타지 않고, `core.code_mapping`은 **체계 간** 관계에만 쓴다.
   상위 코드는 코드 문자열을 잘라서 얻지 않고 원본이 준 계층 이름 경로(`경기도 수원시 장안구`의
   상위는 같은 release의 `경기도 수원시`)에서 **유일할 때만** 얻는다. 유일하지 않거나 없으면 null이다.
4. 유효기간은 원본이 준 만큼만 채우고 없으면 null이다. 2026-09-06 실측에서 전체자료에는 날짜가 없으므로
   `valid_from`·`valid_to`는 전부 null이고, `폐지여부`만 `active`로 옮긴다. `valid_from`이 null인 것은
   "언제부터인지 모른다"이지 "처음부터"가 아니며 API는 null을 그대로 싣는다.
5. 좌표는 코드의 속성이 아니라 **별도 source release의 관측**이며 `core.code_value_coordinate`가
   CRS와 근거 observation과 함께 갖는다. 저장은 `numeric`이고 결측은 결측으로 둔다 —
   모구 좌표로 메우면 영종구가 바다 건너에 찍힌다.
6. eaT ↔ 행안부 대응은 `core.code_mapping` 행으로만 성립하며 질의 시점 문자열 비교는 금지한다.
   자동 생성은 **정규화 라벨이 양쪽에서 유일할 때**만이고 그 행은 `status='label_verified'`다.
   다대다·모호·`overlaps`는 사람이 만들며 `status='reviewed'`다. 매핑 없음은 **행의 부재**로
   표현하고 수는 coverage 문서가 센다. `unresolved` 행은 만들지 않는다.
6-1. eaT는 시도를 축약명(`서울`, `경기`)으로, 행안부는 정식명(`서울특별시`, `경기도`)으로 부르므로
   경로 전체가 그냥은 맞지 않는다. 그래서 **시도 축약명 ↔ 정식명 대응 하나만** 승인된 선언 표
   (`apps/dataplane/src/eatbid/core/region_label_aliases.py`, 근거는 지방자치법·행정안전부 공식 약칭)로
   두고 매핑 생성기가 그 표를 읽는다. 표가 여는 문은 **시도 토막 하나**뿐이며 시군구 이름은 그 시도
   안에서 유일하게 일치할 때만 행이 된다. 표를 거쳐 만들어진 시도 행은 사람의 승인이 근거이므로
   `status='reviewed'`이고, 그 아래 시군구 행은 관측된 일치가 근거이므로 `label_verified`다.
   표에 없는 축약(`전남광주`)은 열리지 않는다 — 폐지된 시도와 새 시도의 대응은 정부가 주지 않았고
   그 판정을 우리가 하면 그것이 규칙이 된다. 개편으로 이름이 바뀐 시도(2023 강원, 2024 전북)는 옛
   이름과 새 이름을 함께 값으로 갖고, 어느 쪽이 활성인지는 release가 말한다.
7. mart의 체계 전환은 새 `calc_version`의 새 build다. 한 build는 한 체계이며 그 사실은
   `mart.build.region_scheme`이 기록한다(ADR 0034).

### 라벨 정규화의 범위

정규화는 **양끝 공백 제거와 연속 공백 축약, 슬래시 주변 공백 제거 하나뿐**이다.
실측에서 `PDLC_NM`의 이름 다중 79건은 전부 `서울 / 전체` vs `서울/전체` 변이였고,
전체자료 53,387행 중 4행(`경기도 부천시 원미구 ` 등)이 뒤에 공백을 달고 온다.
유사도·부분 문자열·주소 파싱은 쓰지 않는다.

## Consequences

- 지역 어휘가 코드·문서·프론트에 재선언되지 않고 저장소 린트가 그것을 지킨다.
- 좌표 소스를 교체해도 코드 표가 바뀌지 않는다. 좌표는 build마다가 아니라 좌표 release마다 바뀐다.
- 매핑이 없는 eaT 코드는 새 화면에서 보이지 않는다. 이는 결함이 아니라 표시해야 할 사실이며
  `docs/operations/reference-data-coverage.md`가 그 수를 센다.
- 행안부 release 갱신은 새 release이며 과거 build의 해석을 사후에 바꾸지 않는다.
  같은 파일 sha256이면 `source_release`의 manifest unique가 두 번째 봉인을 막는다.
- 전체자료에 날짜가 없으므로 **폐지 시점을 우리는 모른다.** 폐지된 시도(`전라남도`·`광주광역시`)가
  언제 사라졌는지는 이 release가 말하지 않으며, 그것을 알아야 하는 소비자가 생기면 변동내역 소스를
  따로 찾아 새 dataset으로 붙여야 한다.

## Rejected alternatives

- **법정동·행정동 병행 적재.** 어느 쪽이 진실인지의 판정이 화면으로 내려가고
  `mois:administrative-region` 하나가 두 의미를 갖는다(AGENTS 1·6).
- **`code_value`에 `latitude`/`longitude` 열.** 행안부가 주지 않은 값을 정부 코드 행이 들게 되고,
  `eat:bid-status`·`eat:business-number`까지 전 체계가 nullable 좌표 열을 갖는 범주 오류다.
- **좌표를 mart 열로 봉인.** 좌표의 권위가 파생물로 내려간다.
- **`PDLC_CD` 자릿수 분해로 시군구 도출.** 같은 자리에 있는 `SGG_CD`가 비함수임이 실측이다
  (`docs/audit-source/census-detail.txt` §3, 33코드 중 15개 45.5%가 다중 이름).
- **`code_value.parent_code_value_id`.** 정체성 표가 시간축을 타게 되고 개편이 과거 행을 덮어쓴다.
- **`code_mapping`의 `broader` 관계로 같은 체계 안의 포함관계 표현.** ADR 0006에서 mapping은 다른
  체계 사이의 추론이다. 같은 체계 안의 계층을 거기 넣으면 "매핑이 있다"의 의미가 둘이 된다.
- **라벨 유사도 자동 병합.** PDR-0001이 실측 오염(`급식소(경상남도`·`기해시`)으로 이미 기각했다.
