# PDR-0003 — 모집단 보유율은 모르면 `unknown`이라고 말한다

- Status: Active
- Date: 2026-09-06
- Supersedes: 없음
- Superseded-by: 없음
- Linear: EAT-44

## 결정

집계 응답의 `coverage`는 `complete`·`partial`·`none` 셋이 아니라 **넷째 값 `unknown`을 갖는다.**
어떤 (지역, 달) 구간을 우리가 그 grain으로 나눠 수집하지 않았다면 그 구간의 보유율은 "일부"가 아니라
**모른다**이며, 화면은 그 사실을 그대로 말한다.

코호트에 여러 구간이 걸리면 가장 나쁜 값을 싣는다: `none` > `unknown` > `partial` > `complete`.

행이 하나도 걸리지 않는 것은 `none`이다. 빌더는 `none`을 쓰지 않는다 — (지역 × 달)의 전체 모집단을
열거해야 쓸 수 있는 값인데 그 모집단은 화면의 코호트가 정하지 우리가 정하지 않는다.

## 배경

`spec-cohort-v3.md` §6은 `coverage ∈ {complete, partial, none}`을 요구했고, 결정 화면 아키텍처
§3.3은 "시도별 보유율을 release manifest에서 계산"한다고 적었다. 둘 다 시도 축이 수집에 있다는 전제
위에 있다.

그 전제가 지금 저장소에서 참이 아니다. 시도별 분모가 실제로 사는 곳은 `ingest.request_unit`의 목록
요청 매개변수인데, `discover`의 `--region-code` 기본값이 빈 문자열이고 백필도 전국 단위 날짜 창으로
돌았다. **즉 지금 수집한 구간에는 시도 축이 아예 없다.** `ingest.source_release_dataset`은 grain이
`(source_release_id, dataset)`이라 애초에 지역으로 나뉘지 않는다.

이 상태를 `partial`로 적으면 화면이 "이 지역은 일부만 수집됐습니다"라고 말하게 된다. 그것은 거짓이다.
우리는 그 지역을 일부 수집한 것이 아니라 지역별로 나눠 수집하지 않았고, 그 지역에 무엇이 있었는지
모른다. `none`이라고 적으면 "그 지역에는 공고가 없었다"는 더 나쁜 거짓이 된다.

제품 입장에서 이 값은 사장이 "이 숫자를 얼마나 믿어도 되나"를 판단하는 재료다. 모르는 것을 아는 척한
숫자는 판단 재료가 아니라 함정이다. eatbid는 예측가나 추천가를 만들지 않는 대신 판단 재료의 지위를
정확히 말하기로 했으므로(AGENTS 3·8), 여기서도 모른다고 말하는 쪽을 고른다.

## 대안과 기각 이유

- **`partial`로 뭉갠다.** 기각. 화면이 "일부 수집됨"이라고 거짓말한다. `partial`은 그 구간을 실제로
  덮는 요청 단위가 있고 그 결과가 부족할 때의 값이다.
- **`none`으로 적는다.** 기각. 더 나쁘다. "그 구간에는 아무것도 없었다"로 읽힌다.
- **`coverage`를 아예 내리고 지역 모집단을 화면에서 감춘다.** 기각. 전국 모집단은 지역 축 없이도
  성립하므로 화면 전체를 끌 이유가 없다. 끄는 것은 지역 모집단뿐이고, 왜 껐는지를 말하려면 이 값이
  필요하다.
- **`coverage`를 숫자(보유율 %)로 바꾼다.** 기각. 분모를 낼 수 없다는 것이 문제인데 숫자는 분모가
  있다고 전제한다. 모르는 상태에 숫자를 붙이면 그 숫자가 근거가 된다.

## 되돌리기 조건

- **백필과 예약 수집이 시도 × 월로 나뉘면**(즉 `discover --region-code`가 채워져 돌면) 그 구간의
  시도 보유율은 `complete`/`partial`로 판정 가능해진다. 그때 `unknown`은 남지만 옛 구간에만 남는다.
  점검 지점은 `ingest.request_unit.request_params`의 `P_CTPV_CD`가 비어 있지 않은 실행의 비율이다.
- **화면에서 `unknown`이 사용자에게 아무 행동도 유발하지 않는다면**(예: 지역 탭이 늘 회색이라
  아무도 열지 않는다면) 값을 넷으로 나눈 값이 없어진 것이므로 표기 방식을 다시 정한다.
- **`unknown`이 전체 응답의 대부분을 차지하는 상태가 6개월 이상 지속되면** 이 값은 정보가 아니라
  배경 소음이다. 그때는 보유율 대신 "지역 코호트 미제공"이라는 기능 상태로 옮긴다.

## 영향

- [`spec-cohort-v3.md`](../decision-screen-v2/spec-cohort-v3.md) §6의 출력 계약이 넷째 값을 갖는다.
- [`pages-endpoints-load.md`](../decision-screen-v2/pages-endpoints-load.md) 공통 meta 표의
  `coverage` 필드.
- `packages/contracts`의 `MartCoverage` enum과 기관 회차 이력 응답 meta.
- `mart.build_coverage` 표의 `coverage` check 제약과
  `apps/dataplane/src/eatbid/mart/build_coverage.py`의 판정.
- ADR 0034: 지역 코드 체계를 build 속성으로 둔 결정과 짝이다. 체계를 모르는 것과 보유율을 모르는
  것은 다른 사실이며 응답 meta가 둘을 따로 싣는다.
