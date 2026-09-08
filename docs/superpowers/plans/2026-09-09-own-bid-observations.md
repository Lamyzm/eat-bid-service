# 실제 내 투찰 조회 backend — 2026-09-09 (EAT-40)

## 문제

차트 위의 "실제 내 투찰" 점을 그리려면 세 가지가 지금 없다.

1. 공개 회차 이력이 `mart.org_round_summary.auction_revision_id`를 응답에 싣지 않는다. 화면은 어느
   해석(revision)의 명단에 점을 찍어야 하는지 말할 수 없다.
2. 회차 이력의 build 고정은 HTTP 한 요청 안에서만 성립한다(`8345cf5`). 다음 페이지를 받는 사이에
   mart가 발행되면 두 페이지가 다른 build의 회차를 섞고, `opened=only`의 기준 시각이 매번
   `clock.now()`라 같은 build에서도 집합이 바뀐다.
3. 개인 투찰 기록을 읽는 계약 자체가 없다. 회차마다 명단 endpoint를 부르면 60회차 화면이
   60번의 HTTP N+1이 된다.

## 범위

- 이번에 닫는 것: 회차 이력의 revision 노출(opt-in), 페이지 사이 build·시간 경계 고정, 개인
  투찰 관측 batch operation 하나와 그 서버 구현.
- 이번에 하지 않는 것: 웹 소비(차트·표), `BidWorkItem`, 성적표 mart, DDL, 배포.
- 웹 파일은 이 단계에서 고치지 않는다.

## 결정

### 1. `revisionId`는 명시적 opt-in projection이다

`organizationAuctionAttemptSchema`는 `strictObject`이고 web은 같은 schema로 응답을 `parse`한다.
새 key를 무조건 실으면 배포 순서에 따라 서버가 먼저 새 key를 보내고 구 web이 그 응답을 통째로
거부한다. 그래서 `includeItemLabel`과 같은 좁은 opt-in을 쓴다(`includeRevision=true`).

`nullable`로 만들지 않는다. `mart.org_round_summary.auction_revision_id`는 not null이므로 "미관측"이
없고, 필드 부재는 오직 "이 소비자가 요청하지 않았다"만 뜻한다. nullable로 열면 없는 상태를 하나
지어내는 것이다(AGENTS 3).

### 2. 페이지 사이 고정은 `expectedBuildId` + `asOf` 한 쌍이다

- 다음 페이지 요청은 첫 응답 `meta.buildId`와 `meta.asOf`를 그대로 되돌려 보낸다.
- 활성 build가 그 값과 다르거나 하나도 없으면 `409`다. 과거 build를 다시 읽는 새 보존 정책을
  만들지 않고(ADR 0034가 소유), 소비자는 누적 목록과 그 위의 개인 결과를 함께 버리고 처음부터
  다시 조회한다.
- 같은 build 안에서 cursor가 조건 밖이거나 남의 기관이면 기존대로 `400`이다.
- `asOf` 없이 `expectedBuildId`만으로는 `opened=only`의 집합이 고정되지 않는다. 두 값은 한 쌍이며
  반쪽 요청은 `400`이다. `opened=any`는 비교 기준 자체가 없으므로 `asOf`를 받지 않는다.
- 미래 `asOf`는 첫 페이지가 결코 볼 수 없었던 경계라 `400`이다. 판정은 주입된 clock으로 한다.

### 3. 개인 조회는 `me` family의 batch operation 하나다

`POST /api/v1/me/businesses/{businessId}/bid-observations`.

- 읽기인데 POST인 이유: 최대 200개의 `(attemptId, revisionId)` 조합을 URL에 실을 수 없다. 대신
  `me` prefix의 private middleware가 성공·401·403·503 모두에 `private, no-store`를 붙인다.
- 요청은 `organizationId`, `buildId`, 중복 없는 조합 목록이다. 각 조합이 그 build·그 기관의 mart에
  실제로 있는지 검증하고, 없으면 `400`이다. 최신 revision으로 자동 치환하지 않는다.
- 요청 `buildId`가 활성 build와 다르면 `409`다. 목록 조회와 같은 재조회 계약을 쓴다.
- 상한 200은 `pages-endpoints-load.md`의 기관 회차 점 조회 상한과 같다. 기본 12(표 한 화면)와
  화면 60(차트)은 이 상한과 다른 값이며 계약이 그 둘을 알 필요가 없다.

### 4. 응답은 다섯 상태를 이름으로 구분한다

최상위:

- `supplier-unobserved`: 등록 번호를 원본이 아직 관측하지 않았다. 미참여가 아니다.
- `supplier-evidence-conflict`: 한 번호가 서로 다른 `SupplierParty` 둘을 가리킨다. 하나를 고르지
  않는다(ADR 0032 §7, ADR 0033 §1).
- `observed`: 연결된 party와 회차별 결과 목록.

회차별:

- `submitted`: 그 명단에 내 party의 실제 행이 있다. 여러 source 계정·여러 제출을 모두 보존한다.
- `absent-from-roster`: 명단은 관측됐고 내 행만 없다.
- `roster-not-observed`: 그 revision의 명단 블록 자체가 없다. 참여 기록 미확인이며 미참여가 아니다.
- `evidence-conflict`: 명단 수·좌표·행 관측·관측 시각 근거가 어긋난다. 그 회차만 격리하고 나머지
  회차의 정상 결과를 빈 배열로 덮지 않는다.

행 관측 대조를 넣는 이유: 발행 경로는 명단 행의 `observation_id`를 그 revision과 같은 관측으로 앉히는데
(`RosterProjectionWriter`), DB의 FK는 그 관측이 실재하는지만 보고 같은 관측인지는 보지 않는다. 대조가
없으면 상태 라벨은 제출 행의 관측에서 읽고 응답 `provenance`는 revision의 관측을 싣는 응답이 만들어져,
서로 다른 두 관측이 한 사실처럼 보인다. 대조는 내 party 행이 아니라 명단 전체에 건다 — 내 행만 보면
남의 행이 어긋난 회차를 근거로 `absent-from-roster`를 확정하게 된다.

금액과 비율은 ADR 0041을 그대로 따른다. `submittedAmount`는 `EFT_ALL_AMT` 관측 하나이고 없으면
`null`, `sourceCalculatedAmount`는 `BID_CALC_AMT`(자리표시자 가능), `bidRate`는 예정가격 분모의
원천 `SAJEONG_PCT` 소수 셋째 자리이며 100 초과를 보존한다. 사업자등록번호·상호·주소는 싣지 않는다.

### 5. 한 응답의 검증은 같은 스냅샷을 읽는다

권한(등록 사업자 소유)·party 해소·활성 build·revision 존재·명단 완전성이 서로 모순되지 않아야
하므로 use case가 읽기 전용 `repeatable read` 트랜잭션 하나를 열고 두 port를 그 안에서 부른다.
새 framework를 만들지 않고 이미 있는 `UnitOfWork` handle을 그대로 쓴다.

명단 완전성은 회차마다 전체 명단을 세어 확인한 뒤 내 party 행만 고른다. 회차별 상한 2048은
그대로 두고 batch 전체에 `limit 2049`를 복제하지 않는다. 전체는 집합 SQL 한 번이다.

## 검증

- 계약 단위: opt-in projection, 한 쌍 규칙, 중복 조합 거부, 100 초과 비율, null 실제 금액.
- 어댑터 통합(실제 PostgreSQL): 여러 source 계정·여러 제출 보존, 낙찰 없는 회차의 내 행,
  최신 core revision이 바뀌어도 mart 고정 revision 대조, 회차별 상한, 명단 수·좌표·관측 시각이 정상인
  채 제출 한 행만 다른 유효 관측을 가리키는 회차(내 행이 어긋난 경우와 남의 행만 어긋난 경우).
- HTTP 통합(실제 서명 쿠키): 타 계정·타 워크스페이스 businessId 차단, 모든 응답 `no-store`,
  build 전환 409, 60회차 batch 1회.
- 좁은 검사 → typecheck → `pnpm quality:check` → architecture/contracts drift → `pnpm review:ai`.
