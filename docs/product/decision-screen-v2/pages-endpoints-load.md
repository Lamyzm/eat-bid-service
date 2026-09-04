# 페이지·컴포넌트별 엔드포인트 계약, 백엔드 부하, 아키텍처 결정

- 상태: 승인 (2026-09-04, 사용자). 계약 세부는 `packages/contracts` 구현 시 이 표를 기준으로 만들고, 표와
  다르게 만들면 이 문서를 같은 변경에서 고친다.
- 전제: 동시 사용자 1,000명, 규모는 `architecture.md` §2 실측. 부하 열의 "행"은 PostgreSQL이
  실제로 읽는 행 수이며 "요청/초"는 아침 개찰 직전 피크 가정(사용자 1,000명 × 시간당 새로고침 10회
  ≈ 3 req/s, 결정 화면은 사용자당 하루 열람 공고 20건).
- 상태 소유와 렌더 방식은 ADR 0031(Accepted)을 따른다. 필터는 URL(nuqs), 첫 화면은 RSC, 사용자
  행위 갱신만 TanStack Query.
- 모든 집계 응답은 `meta { sampleCount, 코호트, 기간, martRelease, computedAt, calcVersion }`을
  가진다(AGENTS 7항). 이 문서에서는 반복하지 않는다. 코호트와 기간의 필드 이름은 그 엔드포인트가
  실제로 받는 필터를 따른다. 예로 `listOrganizationAuctionAttempts`의 코호트는 `meta.item`이고
  기간은 달력 구간이 아니라 최근 `limit`회 창이다.

## 공통 결정

| 항목 | 결정 | 이유 |
| -- | -- | -- |
| 캐시 키 | 응답 헤더 `ETag = martRelease + 요청 파라미터 해시`, web은 `use cache` + `cacheTag('mart:<release>')` | 같은 mart release면 DB를 다시 읽지 않는다. release 전환 시 태그 하나로 무효화. **web `use cache`·`cacheTag` 적용은 EAT-45로 분리했다**(ADR 0028 무효화 owner 미결). EAT-37은 캐시 없이 매 요청 조회한다 |
| 페이지네이션 | cursor(정수 ID 기반) + `limit ≤ 200` | offset은 대형 표에서 비선형. 문자열 키 금지(규칙 2) |
| ID wire | bigint는 decimal string (ADR 0018) | JS number 손실 방지 |
| 에러 | Problem Details 400/404/409/500/503 | 기존 `findAuction`과 동일 |
| 원본 직접 읽기 | 점 조회 3종만: 공고 1, 기관 회차 ≤ 200, 명단 1회차 ≤ 200 | 나머지는 전부 mart |

## 1. 결정 화면 `/auctions/[auctionId]`

디자인: Merged1440 / Real1440 / Merged1440Firm / LargeCohort.

| 컴포넌트 | 엔드포인트 (operationId) | 요청 | 응답 핵심 | 저장소·행 | 부하 (피크) | 렌더·상태 |
| -- | -- | -- | -- | -- | -- | -- |
| 헤더(기관·품목·하한율·정정 차수) + 상태 배너(기초·마감·개찰·공고 시각) | `findAuction` GET `/api/v1/auctions/{auctionId}` (있음, 확장) | path id | organization{id,name,type,region}, items[], floorRate, baseAmount, schedule, revision{no,supersedes} | `core.auction_revision` PK 1행 + 코드 조인 | 1,000명 × 20건/일 ≈ 0.3 req/s. PK 조회, 무시 가능 | RSC. 캐시 태그 `auction:<id>`; 정정 공고 ingest publish 때만 무효화 |
| 배너 참여 수 추이(마감 전 BID_CNT) | `findAuctionParticipation` GET `/api/v1/auctions/{auctionId}/participation` | path id | points[{observedAt, bidCount}] ≤ 96점(15분 폴링 × 24h) | `mart.open_auction_snapshot` 공고별 ≤ 96행 | 열린 공고만. 0.3 req/s. 인덱스 (auction_id, observed_at) | RSC. 태그 `auction:<id>`; poll-open 실행마다 무효화. 닫힌 공고는 마지막 스냅샷만 |
| 호가창(낙찰률 분포 ladder) | `findWinRateDistribution` GET `/api/v1/win-rate-distribution` | query: scope(nation/sido/sigungu/org), regionCode?, itemCode, floorRate, period(1m/3m/12m/60m), center?(선택, 기본 최빈) | bins[{rate(0.01 단위), count, isMode}] ≤ 25단(중심 ±12), sampleCount, modeRate, unknownCount | `mart.win_rate_distribution_monthly` (scope, region, item, floor, month, bin) → 기간 합산. 12m: 12월 × 80칸 = 960행, 60m: 4,800행 | 요청당 ≤ 4,800행 인덱스 range scan ≈ 2–5 ms. 키 조합 실측 상한 96k, 실제 활성 조합 수천. mart release당 1회만 DB 도달 | RSC → inline HTML ladder(ADR 0031-3). 필터는 URL. 태그 `mart:<release>`. **결정:** 60m처럼 큰 기간도 mart에 rolling window 열을 두지 않고 월 합산으로 간다. 4,800행 range scan은 캐시 뒤에서 충분하며 mart 테이블을 두 벌 유지하는 비용이 더 크다 |
| 흐름(회차별 낙찰률 선) + 과거 회차 표 | `listOrganizationAuctionAttempts` GET `/api/v1/organizations/{organizationId}/auction-attempts` | path org id; query: `item?`(품목 codeValueId), `cursor?`, `limit`(기본 12, ≤ 200) | attempts[{attemptId, announcedAt, openedAt, item{codeValueId,label}, floorRate, baseAmount, winRate, secondRate, dayFloorRate, listCount, invalidCount, winnerSupplierPartyId, supersedesAttemptId}], nextCursor, meta{sampleCount, item, martRelease, computedAt, calcVersion} | `mart.org_round_summary` (org_id, announced_at desc) 인덱스, 기관당 5년 ≤ 200행 | 0.3 req/s × 12행. 무시 가능. 흐름은 첫 페이지를 한 번에 받아 같은 응답으로 표와 차트를 그린다(요청 2개 금지) | RSC → 흐름 inline SVG, 표 TanStack Table headless. 페이지 cursor는 URL. 태그 `org:<id>` + `mart:<release>` |
| 투찰 레일(스텝·금액) | 없음 | — | — | — | — | client. 금액 계산은 `_model/bid-rate.ts` BigInt. 서버 왕복 없음 |
| 레일 "이 값이면"(지난 N회 낙찰됐을·무효였을 회차, 보통 참여 수) | 없음 (**결정:** 별도 엔드포인트 만들지 않음) | — | — | 위 `auction-attempts` 응답 ≤ 200행을 브라우저에서 비교 | 스텝마다 서버를 부르면 사용자당 수백 req. 클라이언트 계산으로 0 | client 순수 함수 `_model/rehearsal.ts`(입력: 투찰률, attempts[]). 200행 비교 < 1 ms |
| 내 기록 (rail 하단 + 과거 회차 "내 기록" 열) | `listBidWorkItems` GET `/api/v1/workspaces/{workspaceId}/bid-work-items?auctionId=` / `putBidWorkItem` PUT `/api/v1/workspaces/{workspaceId}/bid-work-items/{attemptId}` | body {rateMilli, amountCents, note?}; recordedAt은 서버 시각 | item{attemptId, rateMilli, amount, recordedAt, updatedAt} | `app.bid_work_item` PK (workspace_id, attempt_id) upsert | 쓰기 사용자당 하루 ≤ 20. 읽기는 결정 화면 로드마다 1 PK | client TanStack Query(mutation + invalidate). 권위는 `app`. 낙관적 갱신 허용, 실패 시 되돌림. 로컬 임시 상태는 저장 성공 전까지만 |
| 업체 탭(반복 참여 업체·회차별 자리) | `listOrganizationSuppliers` GET `/api/v1/organizations/{organizationId}/suppliers` | path org id; query: period(12m/60m), cursor?, limit ≤ 100 | suppliers[{supplierPartyId, name, participations, wins, lastRank, lastRate}] | `core.bid_submission` 기관 회차 ≤ 200 × 명단 평균 55 = 1.1만 행 group by. p95 197곳 × 200회차 = 4만 행 | 탭 열 때만. 사용자 10%가 연다고 보면 0.03 req/s × 1.1만 행 ≈ 20–40 ms. 태그 캐시 뒤에서 release당 1회 | client 탭 → TanStack Query lazy. **결정:** 지금은 요청 시 group by. 실측 p95 > 100 ms면 `mart.org_supplier_summary` 추가(EAT-44 후속). 표는 TanStack Table, 100행 초과 확인 시 virtual |
| 대형 코호트(학교 회차 60회+ 압축 뷰) | 위 `auction-attempts` limit 200 | — | — | 같은 mart 200행 | 같음 | RSC. 60행 초과면 SVG는 점 대신 월 집계로 접는다(디자인 LargeCohort). 서버 계약 추가 없음 |
| 원문과 추적 정보(disclosure) | `findAuction` 응답의 provenance{rawObjectKey, ingestRunId, parserVersion} | — | — | 같은 1행 | 없음 | RSC. R2 raw 링크는 서명 URL을 서버가 만든다(별도 op `findAuctionRawLink`, 클릭 시) |

회차 조회의 기간: 이 엔드포인트는 달력 기간(`until`·`period`)을 받지 않는다. 표본은 최신 회차부터
`limit`회를 잘라낸 창이며, 각 행의 `announcedAt`으로 그 창이 실제로 어느 구간이었는지 재현된다.
`meta.item`은 요청 품목을 그대로 되돌려 실어 `sampleCount`가 어느 코호트의 수인지 응답만으로 닫는다.

후속: `until`(공고 시각 기준 절단), 회차별 `auctionId`, `organization.region`은 이번 슬라이스에서
빼고 EAT-42/43의 품목·기관 정규화 뒤에 다시 넣는다.

결정 화면 합계: 첫 로드 RSC 요청 4개(공고·참여 추이·분포·회차), 클라이언트 요청 1개(내 기록).
같은 release 캐시 적중 시 DB 도달 0. 캐시 미스 시 읽는 행 ≤ 5,200, 예상 ≤ 10 ms.

## 2. 오늘 `/today`

디자인: Today1440.

| 컴포넌트 | 엔드포인트 | 요청 | 응답 핵심 | 저장소·행 | 부하 (피크) | 렌더·상태 |
| -- | -- | -- | -- | -- | -- | -- |
| 열린 공고 목록(기관·품목·마감·기초·참여 수·**기관 요약**: 최근 낙찰률·회차 수) | `listOpenAuctions` GET `/api/v1/auctions?state=open` | query: regionCode?(행안부 체계), itemCode?, closesWithin?(h), sort(closesAt/announcedAt), cursor?, limit ≤ 100 | auctions[{auctionId, organization{id,name,region}, items[], floorRate, baseAmount, closesAt, bidCount, orgSummary{lastWinRate, lastDayFloorRate, attemptCount, sampleCount}}], nextCursor, snapshotRelease | `mart.open_auction_snapshot` 최신 release ≤ 3,000행(열린 공고 상한 실측 필요, EAT-44) + `org_round_summary` 조인. **행마다 기관 요약 포함, N+1 금지** | 3 req/s가 전부 여기로 온다. 응답이 snapshot release로 ETag 되므로 같은 release면 304. poll-open 15분마다 release 1회 → DB 실제 조회 ≈ 필터 조합 수 × 15분당 1회 | RSC 목록, 필터·정렬·cursor는 URL. 태그 `snapshot:<release>`. 표는 TanStack Table headless, 100행 페이지라 virtual 없음 |
| "지금 값이면 무효였을 회차" 열 | 없음 (**결정:** 목록 응답의 orgSummary.lastDayFloorRate로 클라이언트 비교) | — | — | 같은 조인 | 0 | client 계산. 서버는 회차 값만 준다 |
| 내 기록 열 | `listBidWorkItems` GET `…/bid-work-items?state=open` | workspace | items[] ≤ 열린 공고 수 | `app.bid_work_item` (workspace_id) 인덱스 ≤ 수십 행 | 0.3 req/s PK range | client TanStack Query, 목록과 별도 요청(권위가 다른 저장소를 한 응답에 섞지 않는다) |
| 지역·품목 칩 | `listCodes` GET `/api/v1/code-schemes/{scheme}/codes` | scheme(mois-region / eat-item) | codes[{code, label, parent?}] | `core.code` 수백 행 | 정적. 태그 `codes:<scheme>` 무기한 | RSC. 선택값은 URL |

오늘 페이지 결정: 목록 응답 크기가 3,000행 × 300 B ≈ 1 MB라면 첫 페이지 100행으로 제한하고 지역
필터를 기본값(워크스페이스 사업자 소재지)으로 둔다. 전국 전체 스크롤은 cursor로 이어 받는다.

## 3. 복기 `/auctions/[auctionId]/bids` (개찰 후)

디자인: Real1440(닫힌 상태) + 명단 표.

| 컴포넌트 | 엔드포인트 | 요청 | 응답 핵심 | 저장소·행 | 부하 (피크) | 렌더·상태 |
| -- | -- | -- | -- | -- | -- | -- |
| 명단 표(순위·업체·투찰률·금액·판정) + 그날 하한 선 | `listAuctionBids` GET `/api/v1/auctions/{auctionId}/bids` | path id; query: cursor?, limit ≤ 200 | bids[{rank, supplierPartyId, name, rateMilli, amount, status(valid/invalid/unknown), isWinner}], dayFloorRate, drawnPrices[] (ds_pList), sampleCount | `core.bid_submission` (attempt_id) 연도 파티션 prune, ≤ 200행 + `core.supplier_party` 조인 | 개찰 직후 몰림. 사용자 1,000명이 같은 상위 50공고를 보면 공고당 20 req → 태그 캐시로 DB 1회 | RSC → TanStack Table. 명단 p95 197행이라 virtual 없음, 200 초과는 cursor. 태그 `attempt:<id>`; 판정 결과 ingest publish 시 1회 무효화 후 불변 |
| 내 자리·2등과 차이 | 없음 | — | — | 위 응답 + 워크스페이스 사업자 id | 0 | client 계산(사업자 id 일치 행 강조) |
| 회차 이동(재공고 관계) | `findAuction` revision.supersedes | — | — | 1행 | 0 | RSC 링크 |

## 4. 성적표 `/record`

디자인: Scorecard1440.

| 컴포넌트 | 엔드포인트 | 요청 | 응답 핵심 | 저장소·행 | 부하 (피크) | 렌더·상태 |
| -- | -- | -- | -- | -- | -- | -- |
| 월별 투찰·낙찰·무효·2등 차이 | `findSupplierRecord` GET `/api/v1/workspaces/{workspaceId}/suppliers/{supplierPartyId}/record` | query: period(12m/60m) | months[{month, bids, wins, invalids, avgGapToSecondMilli}], totals, sampleCount | `mart.supplier_monthly_record` (supplier_party_id, month) ≤ 60행 | 사용자당 하루 1–2회. 무시 가능 | RSC → inline SVG 막대. 태그 `supplier:<id>` + `mart:<release>`. **워크스페이스가 등록한 사업자만** 빌드·조회 가능(권한 검사 server) |
| 회차별 결과 목록 | `listSupplierAttempts` GET `…/suppliers/{supplierPartyId}/attempts` | query: cursor?, limit ≤ 100 | attempts[{attemptId, organization, openedAt, myRateMilli, winRate, rank, status}] | `core.bid_submission` (supplier_party_id, opened_at) 인덱스 ≤ 수천 행, 페이지 100 | 0.05 req/s | RSC → TanStack Table, cursor URL |

## 5. 부하 총괄과 병목 후보

| 경로 | 캐시 적중 시 DB | 미스 시 행 | 병목 여부 |
| -- | -- | -- | -- |
| 오늘 목록 | 0 (ETag/태그) | ≤ 3,000 + 조인 | **후보 1.** release 전환 직후 필터 조합마다 재계산. EAT-44 acceptance에서 1,000명 동시 새로고침 실측 |
| 결정 분포 | 0 | ≤ 4,800 | 아님. 캐시 키 카디널리티만 관리 |
| 결정 회차 | 0 | ≤ 200 | 아님 |
| 업체 탭 | 0 | ≤ 4만 group by | **후보 2.** p95 > 100 ms면 mart 승격 |
| 복기 명단 | 0 | ≤ 200 | 아님 |
| 내 기록 쓰기 | — | 1 upsert | 아님 |

병목이 아닌 것에 mart나 캐시 계층을 더 만들지 않는다(규칙 11). 후보 1·2만 실측 후 결정한다.

## 6. 계약 구현 순서 (Linear 대응)

1. EAT-37: `listOrganizationAuctionAttempts` (흐름·과거 회차·레일 계산·대형 코호트가 전부 이 하나에 의존)
2. EAT-38: `findWinRateDistribution`
3. EAT-40: `listBidWorkItems` / `putBidWorkItem`
4. EAT-39: `listOpenAuctions`(+ `findAuctionParticipation`), `listAuctionBids`, `listOrganizationSuppliers`, `findSupplierRecord`, `listSupplierAttempts`, `listCodes`

각 계약은 `packages/contracts` operation → Nest → web 순서(eatbid-vertical-slice)로 하나씩 닫는다.
