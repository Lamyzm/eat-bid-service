---
id: PRODUCT-ANALYSIS-COMMON-CONTRACTS
status: active
canonical_for: analysis-common-filter-sample-and-snapshot-contract
last_reviewed: 2026-09-14
review_trigger: analysis-filter-observation-or-snapshot-contract-change
---

# 상세 MVP 공통 분석 계약

EAT-213 · 2026-09-14. 이 문서는 EAT-176의 승인된 공통 입력을 구현하는 기준이다.
wire의 권위는 `packages/contracts/src/api/v1/analysis`, 의미 검증은
`packages/contracts/src/codecs/analysis.ts`와 `packages/domain/src/analysis/cohort-bounds.ts`다.
페이지 DTO·endpoint·집계기를 한 번에 만들지 않는다. 제품 결정은 [PDR-0006](decisions/0006-institution-and-regional-analysis.md)을 따른다.

## 컴포넌트와 값

| 컴포넌트 | 공통 계약에서 소비할 값 | 이 슬라이스 밖의 값 |
|---|---|---|
| 공통 비교조건 | `AnalysisFilterValue`, `AnalysisFilterOptions` | URL, 입력 중 문자열, 프리셋, 펼침 상태 |
| 기관/지역 범례 | 기관 ID·비교 범위, target/comparisonSampleCount, overlapCount | 표시 이름·색·범례 토글 |
| 추이·분포·전체 개찰 이력 | effectiveFilter, snapshot | 점·밀도·bin·페이지 행은 각각 후속 resource |
| 자료 상태 | 준비 상태, periodCoverage, freshness | 상태 표시 문구 |
| 전체보기 | 같은 filter/snapshot 유지 | EAT-214의 전체 뷰포트 프레임. 전용 API 없음 |

기준 시안은 `g-methods/?revision=region-comparison-2`다. 시안의 공고 정보 → 스티키 조건 →
추이/분포 → 전체 이력 → 선택 회차 명단 흐름을 지원하는 공통 데이터만 정의한다.
시안 품목 문자열/가상 점과 임의 표본 수는 생산 계약으로 옮기지 않았다.

## 필터와 지원 여부

- 공고 상세는 조회된 공고의 기관 ID를 target으로, 현재 attempt ID를 exclude로 초기화한다.
  기관 상세는 exclude가 null이다. 제외는 두 집단 모두에 적용하며 다른 revision으로 우회해 포함하지 않는다.
- 기간은 실제 KST 달력일의 양끝을 포함한다. `2024-02-29` 하루는 UTC
  `[2024-02-28T15:00:00Z, 2024-02-29T15:00:00Z)`다. 날짜 역전과 `2026-02-30`은 거부한다.
  날짜 기준 opened/announced는 기간과 추이 X축에 함께 적용한다.
- 비교는 전국 또는 eaT 공고지역 시도/시군구다. 행안부·참가제한지역 코드로 대신하지 않는다.
  기관 자체에는 비교지역 조건을 걸지 않는다. 지역 전체에는 조건에 맞는 기관 기록도 포함한다.
- 같은 하한율·낙찰방식을 유지한다. 현재 공고의 값이 미확인이면 임의의 90%/대표 방식을 넣지 않는다.
  유효한 필터가 생기기 전에는 분석 요청을 만들지 않으며, 화면은 기존 공고 사실의 null을 보여 준다.
- 명단 수는 철회 행 포함 관측 명단 행 수다. 고유 업체 수나 유효 경쟁자 수로 바꾸지 않는다.
  min/max 양끝 포함, 한쪽 null은 그쪽 제한 없음, 둘 다 null은 전체다. `0~0`과 전체는 다르다.
  미관측 명단은 전체 조건에서만 다른 요건을 만족하면 포함하고 범위 활성 시 제외한다.
- 품목 조건은 기관·비교군·겹쳐 찍은 기관에 **같게** 적용한다(PDR-0007). 값은 `eatbid:auction-item` 원자
  여덟이며 OR이다. label·정규식으로 코드를 만들지 않고 묶음 이름(`축산`)도 받지 않는다.
  `품목 미확인`은 품목 다리 행이 없는 회차이고 **고를 수 있는 값**이다. 조건을 비운 전체에서만 자동으로
  포함되며, 원자를 고른 요청에는 `itemUnknown=include`로 함께 보거나 `only`로 그것만 볼 수 있다.
  둘을 함께 지정하는 요청은 400이다. 품목 선택지를 서버에 묻지 않는다 — 어휘가 계약 안에 있다.
- availablePeriods는 실제 관측의 양끝이지 중간 기간의 완전 수집 증명이 아니다. 사용자가 그 밖의 기간을
  선택했다고 보유 범위로 조용히 잘라내지 않는다. 빈 결과와 coverage로 설명한다.

`analysisFilterValueSchema.parse`는 wire 형태만 확인한다. 실제 읽기 adapter는
`parseAnalysisFilterValue`로 날짜·범위를 검증하고, 서버가 해소한 선택지에
`assertAnalysisFilterSupported`를 적용한다. 이 함수는 `parseAnalysisFilterOptions`로 선택지의
보유 날짜도 실제 달력일·순서에 맞는지 검사한다. 숫자 형태의 ID가 존재한다는 뜻은 아니다.
기관 존재·코드 체계 소속·활성 release·접근 권한은 실제 서버 조회에서 확인한다.
클라이언트가 제출한 선택지로 지원 여부를 검사하지 않는다.

## 낙찰 관측의 포함 단위 — awarded-attempt-v1

1. 공개가 검증된 한 AuctionAttempt의 스냅샷 기준 revision 하나를 사용한다. 최신 revision을 요청마다
   다시 조인하지 않는다. 재입찰은 독립 attempt이고 과거 회차를 문자열 번호로 합치지 않는다.
2. 실제 낙찰이 확인되고 낙찰 사정률을 관측한 회차만 점을 만든다. 진행·유찰·취소, 미확인 낙찰값은 제외한다.
   예정가격/낙찰가를 추측하거나 추천값을 관측처럼 넣지 않는다. 동일 회차에 서로 충돌하는 낙찰 관측이 있으면
   임의 하나를 고르지 않고 격리하며 이유를 남긴다. 업체 명단 행 수만큼 낙찰점을 중복 생성하지 않는다.
3. 선택한 날짜 기준의 관측일과 동일 하한율·낙찰방식이 있어야 한다. 공고일 기준이어도 실제 낙찰 요건은 같다.
   날짜/조건 미관측을 임의의 날짜나 코드로 채우지 않는다.
4. 공통 기간·하한율·방식·명단 범위·품목·현재 attempt 제외를 적용하고 기관/비교지역 소속을 판정한다.
   품목은 두 집단을 같이 좁힌다. 이 결과의 attempt/revision 쌍이 추이·분포·이력의 공통 관측 집합이다.
5. 사정률과 기초금액 대비 투찰률은 다른 의미 값이다. 사정률의 100 초과 관측도 보존하며,
   화면 범위를 벗어났다는 이유로 sampleCount에서 지우지 않는다.

포함·제외 이유와 정책 버전은 EAT-198의 재현 fixture/집계가 기록한다. 이 계약 추가가 현재의 서로 다른
이력·분포 builder를 같은 관측 집합으로 바꾼 것은 아니다.

## 표본과 수집 정도

- targetSampleCount/comparisonSampleCount는 필터에 맞는 전체 실제 낙찰 회차 수다. 반환 점 개수,
  밀도 칸 개수, 현재 페이지 행 수가 아니다. 임의 추출 표본을 전체 수로 반환하지 않는다.
- overlapCount는 두 집단에 함께 속한 attempt/revision 수다. 합집합을 표시할 때는 두 표본 합에서
  겹침을 뺀다. 기관이 선택 지역 밖이면 기관 결과는 유지되고 겹침은 0일 수 있다.
- 스냅샷이 있고 실제 결과가 0건이면 ready와 0을 반환한다. 스냅샷 미발행/만료/입력 조합 미확정은
  unavailable이며 표본 수 필드가 없다. 준비 불가를 빈 차트·0건으로 보이지 않게 한다.
- periodCoverage는 요청 기간 전체를 겹침 없이 순서대로 나누고 두 집단의 판정을 각각 반환한다.
  complete/partial/none은 해당 scope의 검증된 수집 근거가 있을 때만 사용한다. 근거를 모르면 unknown이다.
  낙찰점이 0개라는 사실만으로 none, 몇 개 있다는 사실만으로 partial이라고 판단하지 않는다.
  공급자는 연결된 입력 release/검증 기록에서 판정 근거를 재현해야 한다(PDR-0003).
- 작은 표본의 관측과 건수는 숨기지 않는다. 분위수·추천구간·대표구간을 이 공통 DTO에 넣지 않는다.
  분포 bin은 `[from, to)`로 양쪽에 같은 경계를 사용하고 별도 바깥 범위 건수도 전체 합계에 포함한다.

## 스냅샷과 발행 지연

snapshot은 sourceCutoffAt, issuedAt, expiresAt, observationPolicyVersion과
관측 자료/분포의 이름 붙인 실제 martBuildLineage 참조를 가진다. 각 buildId는 달라도 된다.
공통 ready 스냅샷에는 두 역할이 정확히 하나씩 있어야 한다. 한쪽만 준비됐다면 발급하지 않는다.
sourceReleaseId와 calcVersion도 실제 값을 유지하며 같은 숫자로 치환하지 않는다.

**발급자의 필수 조건:** 같은 기준 입력에서 같은 포함 정책과 revision 집합을 읽는 조합임을
확인한 뒤 발급한다. 시각 문자열이 같거나 `parseAnalysisMeta`가 성공했다는 사실은 그 증명이 아니다.
이를 검증할 수 없는 기존 활성 build를 묶지 말고 input-unconfirmed를 반환한다. EAT-198은 공통
불변 관측 입력을, EAT-220은 조합 검증·활성 전환을 구현한다. 미확인 입력을 허용하는 예외는 없다.

후속 조회는 동일 snapshot을 그대로 참조한다. 서버는 build 존재·보존기간·권한·입력 조합을 다시
확인하고 클라이언트가 바꾼 cutoff/계보를 신뢰하지 않는다. 별도의 영구 분석 세션 테이블이나
문자열 복합키를 만들지 않는다. 만료하면 snapshot-expired로 차트·분포·이력을 함께 재조회한다.
검증된 기존 build를 찾지 못했다고 최신 build로 일부 컴포넌트만 바꾸지 않는다.

보존기간은 새 고정 TTL을 만들지 않는다. expiresAt은 참조 build들의 실제 retain_until 중 가장 이른
시각 이하여야 한다(ADR 0034). 발급 뒤에도 보존할 근거가 없으면 발급하지 않는다.
fixture의 하루 간격은 테스트 자료이며 운영 보존기간 약속이 아니다.

freshness의 current는 관련 미반영 DB 발행이 없음을 확인한 상태다. updating은 관련 발행을 반영 중이며
최초 미반영 발행부터 15분 이내, delayed는 15분 초과다. 판정할 수 없으면 unknown이다.
checkedAt과 oldestPendingPublicationAt을 기준으로 판단하며 computedAt이 오래됐다는 이유로 delayed로
바꾸지 않는다. 원천 수집 지연은 이 15분 목표와 별개다. 상태 공급·대기열 확인은 EAT-220 소유다.
공개 상태와 시각의 경계는 domain `analysisPublicationFreshness`를 통해 의미 parser에서도 검사한다.

## 호환성과 후속 연결

새 additive resource이며 기존 ingestion/public operation/DB 표현은 변경하지 않았다. production Web은
browser-safe `@eatbid/contracts/api/v1/analysis`만 소비한다. Temporal/domain을 쓰는 의미 parser는
server 계약 진입점에 남고 portable registry/클라이언트 graph에 들어가지 않는다.

새 endpoint의 method/path/status/operationId는 EAT-215~219가 실제 consumer에 맞춰 operation으로 정의한다.
이 문서는 URL 사본·완성형 PageDto·미사용 endpoint를 소유하지 않는다. 이 단계의 완료는 공통 계약과
경계 검증이며, 지역 데이터 조회·차트 구현·운영 성능 인수를 뜻하지 않는다.
