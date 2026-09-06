# 정부 코드 release와 매핑 coverage

정부 공개 코드 release가 실제로 무엇을 실었고 eaT 지역 코드 중 몇 개가 그것에 연결되는지를 기록한다.
**100%가 아니면 숨기지 않는다.** 권위는 [ADR 0035](../adr/0035-administrative-region-canonical-and-mapping.md)이고
source 계약은 [`reference-source-contracts.json`](../audit-source/reference-source-contracts.json)이다.

- 상태: **실수집 전**. 아래 수치는 2026-09-06 공식 파일을 read-only로 관측해 저장소의 파서·매핑
  규칙에 그대로 통과시킨 결과이며, 운영 DB에 적재된 release의 값이 아니다.
- 첫 실제 release를 봉인한 뒤 이 문서에 release id·content hash·실측 행 수를 더한다. 그때까지
  `eatbid-reference-refresh` CronWorkflow는 `suspend: true`다.

## 1. 행안부 법정동코드 (`mois:administrative-region`)

| 값 | 실측 |
|---|---|
| 관측 일시 | 2026-09-06T03:19:24Z |
| 요청 | `POST https://www.code.go.kr/etc/codeFullDown.do` (`codeseId=법정동코드`) |
| 전달 형식 | zip 한 장 → CP949·탭·CRLF 텍스트, 컬럼 `법정동코드`·`법정동명`·`폐지여부` |
| 본문 sha256 | `8cfd829c797270b56243a46e9f1e4e95377c2135153c36909021a35a1e32966a` |
| 원본 행 수 | 53,387 |
| 승격 행 수 | **537** (시도 25, 시군구 512) |
| 제외 행 수 | 52,850 (읍면동·리) |
| 활성 member | 284 (시도 15, 시군구 269) |
| 상위를 얻지 못한 member | 33 |

승격 grain은 시도·시군구 두 단계뿐이다. 제품에 읍면동 축의 결정이 없고, 그 사실은 release 행의
`promoted_grain`·`excluded_row_count`가 기록한다.

### 상위가 비어 있는 33행

- 시도 25행은 정의상 상위가 없다.
- `3611000000 세종특별자치시`는 시군구 grain에만 있고 상위 시도 행(`3600000000`)이 파일에 없다.
- 창원시 산하 구 다섯(`4812100000`·`4812300000`·`4812500000`·`4812700000`·`4812900000`)과
  옛 마산시 산하 구 둘(`4815100000`·`4815300000`)은 상위 이름 경로가 유일하지 않다. 통폐합 전후의
  같은 이름 행이 함께 있기 때문이며, 후보가 둘 이상이면 행을 만들지 않는다는 규칙 그대로다.

### 유효기간

전체자료에 날짜 컬럼이 **하나도 없고**, 같은 화면이 변동내역 파일을 제공하지 않는다. 따라서 모든
member의 `valid_from`·`valid_to`는 null이다. 이는 "처음부터"가 아니라 "언제부터인지 모른다"이며,
폐지된 시도가 언제 사라졌는지를 이 release는 말하지 않는다.

## 2. 좌표 (`core.code_value_coordinate`)

첫 좌표 release는 아직 봉인하지 않았다. 계약(이름 경로 + exact decimal 위경도, `EPSG:4326`)과
"유일할 때만 붙이고 결측을 모구 좌표로 채우지 않는다"는 규칙만 코드로 닫혀 있다.
결측 시군구 목록은 첫 release 실행 결과에서 이 문서로 옮긴다.

## 3. eaT → 행안부 매핑률 (2026-09-06 재측정)

저장소의 매핑 규칙(정규화 라벨의 결정적 일치가 **양쪽 모두 유일**할 때만, 시도 토막은 승인된 별칭
표를 거쳐)을 위 release의 활성 member 284행과 `docs/audit-source/code-name-pairs.txt`·
`code-name-pairs2.txt`의 eaT 라벨에 그대로 적용한 결과다. 두 파일이 싣는 것은 189종 중 일부이므로
아래 수치는 **표본**이며 실수집 뒤 운영 DB 값으로 갱신한다.

| 축 | eaT 코드 | reviewed | label_verified | 미매핑 | 모호 | 매핑률 |
|---|---|---|---|---|---|---|
| `eat:eligibility-area` (`PDLC_CD`, audit 표본 40) | 40 | 4 | 36 | 0 | 0 | **100.0%** |
| `eat:eligibility-area` (두 표본 합집합 101) | 101 | 4 | 88 | 9 | 0 | **91.1%** |
| eaT 공고지역 시도 (`CTPV_CD`) | 18 | 15 | 0 | 3 | 0 | **83.3%** |
| `eat:auction-location-sido` (`SIDO_CD`) | — | 0 | 0 | — | — | **라벨 관측 없음** |
| `eat:auction-location-sigungu` (`SIGUNGU_CD`) | — | 0 | 0 | — | — | **라벨 관측 없음** |

`reviewed` 4행은 시도 자체를 가리키는 `{시도}/전체` 행이고, 그 근거는
`apps/dataplane/src/eatbid/core/region_label_aliases.py`의 승인된 축약명 표다. `label_verified`는 그
시도 안에서 시군구 이름이 유일하게 일치한 행이다.

### 남은 미매핑은 전부 같은 사건이다

합집합 표본의 미매핑 9행과 시도 축의 미매핑 3행(`광주`·`전남`·`전남광주`)은 모두 2026 vintage의
전남·광주 통합에서 나온다. 행안부 파일이 `광주광역시`·`전라남도`를 **폐지**로 내리고
`1200000000 전남광주통합특별시`를 새로 실었는데, 원본이 그 둘과 새 시도의 대조표를 주지 않는다.
축약 `전남광주`를 별칭 표에 넣으면 그 판정을 우리가 하는 것이므로 넣지 않는다. 이 부류는
`relation='overlaps'` 행을 사람이 만드는 자리다(아래 §`SIDO_CD=18`).

### 두 체계는 여전히 라벨을 관측하지 못한다

`ds_info` 전수 181,150행에 `SIDO_NM`·`SIGUNGU_NM`이 **없다**
(`docs/audit-source/census-detail.txt` §ds_info). 이름을 붙이려면 배송 주소를 쪼개거나 `PDLC_CD`
자릿수를 분해해야 하는데 둘 다 기각된 경로다(PDR-0001, ADR 0035 Rejected alternatives). 그래서
`eat:auction-location-sido`·`eat:auction-location-sigungu`는 라벨 column을 선언하지 않고, 매핑 결과는
이 부류를 `without_label`로 따로 센다 — 조용히 0이 되지 않는다.

지역 축이 실제로 서는 곳은 `eat:eligibility-area`다. `PDLC_NM`은 전수 327,168행에 100% 채워져 있고
`{시도 축약}/{시군구|전체}` 경로를 그대로 준다.

### 이 수치가 뜻하는 것

- 자동 매핑 경로는 규칙을 느슨하게 하지 않고도 표본에서 91~100%를 만든다. 열린 문은 **시도 토막
  하나**뿐이고, 시군구는 여전히 그 시도 안에서 유일 일치일 때만 행이 된다.
- 남은 미매핑은 결함이 아니라 **정부 파일이 대조표를 주지 않은 구간**이다. 숨기지 않고 센다.
- 운영 DB의 매핑률은 아직 0이다. 정규화 수집 계약(`eatbid.ingestion.auction.v1`/`v2`)이 봉인된 payload
  모양을 갖고 있어 `PDLC_NM`을 실을 자리가 없기 때문이다(ADR 0025 sealed membership). 관측된 라벨을
  `core.code_label_observation`까지 옮기려면 새 수집 계약 버전이 필요하며, 그전까지 이 표의 수치는
  저장소 규칙을 audit 표본에 적용한 값이다.

### `SIDO_CD=18`

eaT `18 → 전남광주`는 행안부 2026 vintage의 `1200000000 전남광주통합특별시`와 같은 사건으로 보이지만
원본이 대조표를 주지 않는다. 이 코드는 `relation='overlaps'` 두 행(`전라남도`·`광주광역시`)을 사람이
만들며 자동 경로는 이 관계를 만들지 않는다. `overlaps`는 등가가 아니므로 mart 번역에서 쓰지 않고
미매핑으로 센다.

## 4. mart 지역 축 전환 (EAT-57 lane B, 2026-09-06)

전환 자체는 **코드와 절차로 준비만 됐고 운영 기본값은 바꾸지 않았다.** 매핑률이 0인 상태에서 축을
옮기면 지역 모집단이 통째로 비고, 그것은 개선이 아니라 화면에서 지역이 사라지는 사건이다.

### 무엇이 코드로 닫혔나

| 사실 | 어디가 소유하나 |
|---|---|
| 관측된 eaT 지역 코드를 선언한 체계로 번역한다 | `apps/dataplane/src/eatbid/mart/region_axis.py`의 `REGION_TRANSLATION_CTE` |
| `relation='exact'`가 **유일할 때만** 번역한다 | 같은 CTE의 `having count(distinct ...) = 1` |
| `relation='overlaps'`는 번역하지 않고 미매핑으로 센다 | 같은 CTE의 `relation` 조건 |
| 번역되지 않은 코드는 지역 모집단에서 빠진다(전국·기관은 그대로) | `win_rate_distribution.py`의 `populations` |
| build가 선언한 체계 밖의 코드를 실으면 `verified`로 올라가지 않는다 | `assert_build_region_scheme`, `PsycopgMartBuildRepository.verify_build` |
| 번역되지 않는 관측 지역 코드 수 | `count_unmapped_region_codes` |

**강제 조건은 이름이 아니라 구조다.** 선언한 `region_scheme`에 `core.code_release`가 **있을 때만** 그
build의 지역 축을 그 체계로 강제한다. eaT 관측 축은 시도와 시군구가 서로 다른 `code_scheme`이라 한
이름으로 묶이지 않으므로, release가 없는 체계를 선언한 build는 전환 이전 상태이며 관측된 코드를 그대로
싣는다. 정부 release가 적재되고 그 체계를 선언한 build가 나오는 순간부터 번역과 검증이 함께 켜진다 —
전환이 침묵하지 않는다(ADR 0034·0035).

### 전환 절차

1. 행안부 release와 좌표 release를 봉인·투영한다(`reference-pipeline`, 지금 `suspend: true`).
2. 매핑을 만들고 이 문서 §3의 수치를 **운영 DB 실측으로** 갱신한다.
3. 새 `calc_version`(`mart-r2` → `mart-r3`)으로
   `build-marts --region-scheme mois:administrative-region`을 실행한다.
4. 빌더가 verified 승격 전에 체계를 질의로 확인한다. 실패하면 활성 포인터는 움직이지 않는다.
5. 되돌리기는 `mart-r2` build를 다시 활성으로 올리는 것이다. `mart-r2`는 지우지 않고 `superseded`로 남는다.

### 운영 현재 상태

- 활성 build의 `region_scheme`은 여전히 `eat:auction-location-sigungu`이고 `calc_version`은 `mart-r2`다.
  WorkflowTemplate 기본값도 그대로다(이번 변경은 `infra/**`를 만지지 않았다).
- **운영 DB의 eaT ↔ 행안부 매핑은 0행이다.** 원인은 매핑 규칙이 아니라 **라벨이 core에 없다**는 것이다.
  `eat:eligibility-area`의 `PDLC_NM`은 파서 표에 선언돼 있지만 봉인된 정규화 계약
  (`eatbid.ingestion.auction.v1`/`v2`)의 `normalizedLocation`에 라벨 자리가 없어
  `core.code_label_observation`까지 흐르지 않는다(ADR 0025 sealed membership).
  `eat:auction-location-sido/sigungu`는 소스에 이름 column 자체가 없어 `without_label`로 센다.
- 따라서 지금 3단계를 실행하면 모든 지역 코드가 미매핑이 되어 지역 모집단이 빈다. 전환은
  **라벨 수집 계약이 새 버전으로 열린 뒤**에 한다. 그 계약 변경은 이 작업의 범위 밖이며 별도 이슈다.
- §3의 매핑률 표는 그때까지 **audit 표본에 저장소 규칙을 적용한 값**이며 운영 실측이 아니다.
