# 페이지·컴포넌트별 엔드포인트 계약, 백엔드 부하, 아키텍처 결정

- 상태: 승인 (2026-09-04, 사용자). 계약 세부는 `packages/contracts` 구현 시 이 표를 기준으로 만들고, 표와
  다르게 만들면 이 문서를 같은 변경에서 고친다.
- 전제: 동시 사용자 1,000명, 규모는 `architecture.md` §2 실측. 부하 열의 "행"은 PostgreSQL이
  실제로 읽는 행 수이며 "요청/초"는 아침 개찰 직전 피크 가정(사용자 1,000명 × 시간당 새로고침 10회
  ≈ 3 req/s, 결정 화면은 사용자당 하루 열람 공고 20건).
- 상태 소유와 렌더 방식은 ADR 0031(Accepted)을 따른다. 필터는 URL(nuqs), 첫 화면은 RSC, 사용자
  행위 갱신만 TanStack Query.
- 모든 집계 응답은 `meta { sampleCount, 코호트, 기간, buildId, sourceReleaseId, calcVersion,
  computedAt, coverage, regionScheme }`을 가진다(AGENTS 7항). 이 문서에서는 반복하지 않는다.
  코호트와 기간의 필드 이름은 그 엔드포인트가 실제로 받는 필터를 따른다. 예로
  `listOrganizationAuctionAttempts`의 코호트는 `meta.item`이고 기간은 달력 구간이 아니라 최근
  `limit`회 창이다. 계보는 행이 아니라 `mart.build` 한 행이 갖는다(ADR 0034) — `martRelease`라는
  자유 문자열은 삭제됐다. 활성 build가 아직 없으면 계보 필드가 모두 null이며 그것은 오류가 아니다.
  `coverage`는 그 코호트에 걸린 `mart.build_coverage` 행 가운데 가장 나쁜 값이다
  (`none` > `unknown` > `partial` > `complete`, PDR-0003).

## 공통 결정

| 항목 | 결정 | 이유 |
| -- | -- | -- |
| 캐시 키 | web `use cache` + 안정 태그(`mart:<mart_name>`·`auction:<id>`·`org:<id>`·`allAuctions`)와 유계 `cacheLife`(stale 300 / revalidate 900 / expire 3600). 무효화는 dataplane이 발행·활성 전환 뒤 `POST /internal/cache/revalidate`로 push한다 | 같은 build면 DB를 다시 읽지 않고, 전환 뒤 첫 열람은 새 값이다(EAT-45, ADR 0036). `mart:<buildId>`는 쓸 수 없다 — 지우는 쪽이 아는 id와 캐시 항목에 붙은 id가 정의상 다르다 |
| 서버 캐시 헤더 | 내지 않는다. buildId 기반 ETag와 304 협상은 채택하지 않았다 | 304는 본문이 없어 "unknown 응답을 계약 schema로 parse한다"는 transport 불변식과 충돌하고, Express 기본 weak ETag는 본문 해시라 DB 읽기를 줄이지 못한다. 절약 대상도 클러스터 내부 바이트뿐이다. 공개 CDN이 mart 응답을 직접 받는 날 다시 검토한다 |
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
| 호가창(낙찰률 분포 ladder) | `findWinRateDistribution` GET `/api/v1/win-rate-distribution` (구현됨, EAT-38) | query: `scope`(national/province/district/organization), `regionCodeValueId?`, `organizationId?`, `floorRate`(필수), `awardMethod`(필수, codeValueId), `from`/`to`(YYYY-MM, 양끝 함께·최대 12개월), `binWidth`(기본 0.010), `granularity`(total/month) | `bins[{from,to,count}]`(횟수>0인 칸만, 오름차순), `medianBin`, `modeRange{from,to,count,share}`, `months[{month,sampleCount,coverage,bins}]`, `meta` | `mart.win_rate_distribution_monthly` (scope, region, org, item, floor, award_method, month, bin) → 기간 합산 | **실측**(2026-09-06, 38,050행 표): 읽은 행 37, shared hit 7, 0.175 ms, `win_rate_distribution_monthly_cohort_key` index scan. `granularity=month` 12개월 응답 8.6 KB. 새 index 없음 | RSC → inline HTML ladder(ADR 0031-3). 필터는 URL. 태그 `mart:<buildId>`. **결정:** 큰 기간도 mart에 rolling window 열을 두지 않고 월 합산으로 간다 |
| 흐름(회차별 낙찰률 선) + 과거 회차 표 | `listOrganizationAuctionAttempts` GET `/api/v1/organizations/{organizationId}/auction-attempts` | path org id; query: `item?`(품목 codeValueId), `cursor?`, `limit`(기본 12, ≤ 200), `opened`(기본 `only`: 서버 clock 기준 `openedAt <= now`인 개찰 회차만, `any`: 전부, EAT-81) | attempts[{attemptId, announcedAt, openedAt, item{codeValueId,label}, floorRate, baseAmount, winRate(사정률 축 3자리), secondRate(사정률 축), awardedBidRate(투찰률 축 4자리, EAT-71), dayFloorRate(투찰률 축 4자리), listCount, belowDayFloorCount, winnerSupplierPartyId, supersedesAttemptId}], nextCursor, meta{sampleCount, item, opened, asOf(only일 때 비교한 시각, any면 null), buildId, sourceReleaseId, calcVersion, computedAt, coverage, regionScheme} | `mart.org_round_summary` (org_id, announced_at desc) 인덱스, 기관당 5년 ≤ 200행 | 0.3 req/s × 12행. 무시 가능. 흐름은 첫 페이지를 한 번에 받아 같은 응답으로 표와 차트를 그린다(요청 2개 금지) | RSC → 흐름 inline SVG, 표 TanStack Table headless. 페이지 cursor는 URL. 태그 `org:<id>` + `mart:<buildId>` |
| 투찰 레일(스텝·금액) | 없음 | — | — | — | — | client. 금액 계산은 `_model/bid-rate.ts` BigInt. 서버 왕복 없음 |
| 레일 "이 값이면"(지난 N회 낙찰됐을·무효였을 회차, 보통 참여 수) | 없음 (**결정:** 별도 엔드포인트 만들지 않음) | — | — | 위 `auction-attempts` 응답 ≤ 200행을 브라우저에서 비교 | 스텝마다 서버를 부르면 사용자당 수백 req. 클라이언트 계산으로 0 | client 순수 함수 `_model/rehearsal.ts`(입력: 투찰률, attempts[]). 200행 비교 < 1 ms |
| 내 기록 (rail 하단 + 과거 회차 "내 기록" 열) | `listBidWorkItems` GET `/api/v1/workspaces/{workspaceId}/bid-work-items?auctionId=` / `putBidWorkItem` PUT `/api/v1/workspaces/{workspaceId}/bid-work-items/{attemptId}` | body {rateMilli, amountCents, note?}; recordedAt은 서버 시각 | item{attemptId, rateMilli, amount, recordedAt, updatedAt} | `app.bid_work_item` PK (workspace_id, attempt_id) upsert | 쓰기 사용자당 하루 ≤ 20. 읽기는 결정 화면 로드마다 1 PK | client TanStack Query(mutation + invalidate). 권위는 `app`. 낙관적 갱신 허용, 실패 시 되돌림. 로컬 임시 상태는 저장 성공 전까지만 |
| 업체 탭(반복 참여 업체·회차별 자리) | `listOrganizationSuppliers` GET `/api/v1/organizations/{organizationId}/suppliers` | path org id; query: period(12m/60m), cursor?, limit ≤ 100 | suppliers[{supplierPartyId, name, participations, wins, lastRank, lastRate}] | `core.bid_submission` 기관 회차 ≤ 200 × 명단 평균 55 = 1.1만 행 group by. p95 197곳 × 200회차 = 4만 행 | 탭 열 때만. 사용자 10%가 연다고 보면 0.03 req/s × 1.1만 행 ≈ 20–40 ms. 태그 캐시 뒤에서 release당 1회 | client 탭 → TanStack Query lazy. **결정:** 지금은 요청 시 group by. 실측 p95 > 100 ms면 `mart.org_supplier_summary` 추가(EAT-44 후속). 표는 TanStack Table, 100행 초과 확인 시 virtual |
| 대형 코호트(학교 회차 60회+ 압축 뷰) | 위 `auction-attempts` limit 200 | — | — | 같은 mart 200행 | 같음 | RSC. 60행 초과면 SVG는 점 대신 월 집계로 접는다(디자인 LargeCohort). 서버 계약 추가 없음 |
| 원문과 추적 정보(disclosure) | `findAuction` 응답의 provenance{rawObjectKey, ingestRunId, parserVersion} | — | — | 같은 1행 | 없음 | RSC. R2 raw 링크는 서명 URL을 서버가 만든다(별도 op `findAuctionRawLink`, 클릭 시) |

호가창 계약의 확정 사항(EAT-38, [PDR-0004](../decisions/0004-order-book-axis-is-assessment-rate.md)):

- **scope 이름은 mart의 `distributionScopes`를 그대로 쓴다**(`national|province|district|organization`).
  이 문서가 적었던 `nation/sido/sigungu/org`는 mart·빌더·DB check 제약과 달라 폐기했다. 이름이 두 벌이면
  어느 쪽이 모집단의 권위인지 알 수 없다.
- **지역은 문자열 코드가 아니라 `regionCodeValueId`(숫자 id)로 받는다**(AGENTS 2). 그 id가 어느 체계의
  것인지는 응답 `meta.regionScheme`이 말한다.
- **`floorRate`와 `awardMethod`는 필수다.** mart의 코호트 키가 not null이고, 합산하면 없는 두 봉우리가
  생긴다. 선택 값으로 두고 서버가 기본값을 고르면 그 선택이 숨은 제품 판단이 된다.
- **`itemCode`는 v1에 없다.** 분포 mart에 품목 축이 비어 있다(빌더가 항상 null을 넣는다). 응답 meta는
  `item: null`을 늘 명시적으로 실어 "품목으로 좁히지 않은 표본"임을 화면이 말하게 한다. EAT-66이 품목
  `CodeScheme`을 만든 뒤 새 `calc_version`의 build와 함께 선택 parameter로 더한다.
- **`center`와 `unknownCount`는 없다.** 창의 중심(최빈 칸 기준 25줄)은 화면이 정하고, 알 수 없는 상태는
  `coverage`와 계보 null이 이미 말한다. 표본 수는 `meta.sampleCount` 한 자리만 갖는다.
- **표본 부족 라벨(n<10, 10≤n<30)은 응답에 없다.** 임계값은 관측 사실이 아니라 제품 판단이라 web의 단일
  모듈이 소유한다.
- **기본 기간은 계약이 아니라 use case가 정한다.** "최근 12개월"은 현재 시각의 함수라 정적 schema에 넣을
  수 없다. 생략하면 주입된 clock으로 `[이번 KST 달 - 11, 이번 KST 달]`을 만들고 `meta.period`에 되돌려
  싣는다.

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
| 지역·품목 칩 | `listCodes` GET `/api/v1/code-schemes/{scheme}/codes` (**EAT-57 소유**) | path: scheme(코드 체계 namespace), query: grain? | codes[{codeValueId, scheme, code, label, parentCodeValueId, active, validFrom, validTo, coordinate}], meta{codeReleaseId, sourceVersion, publishedAt, promotedGrain, codesWithoutCoordinateCount} | 활성 `core.code_release`의 `code_release_member` 수백 행 + `code_value_coordinate` 좌조인 | 정적. 태그 `codes:<scheme>` 무기한 | RSC. 선택·링크는 `codeValueId`로만 하고 `label`은 표시에만 쓴다(AGENTS 2) |

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
| 월별 투찰·낙찰·무효·2등 차이 | `findSupplierRecord` GET `/api/v1/workspaces/{workspaceId}/suppliers/{supplierPartyId}/record` | query: period(12m/60m) | months[{month, bids, wins, invalids, avgGapToSecondMilli}], totals, sampleCount | `mart.supplier_monthly_record` (supplier_party_id, month) ≤ 60행 | 사용자당 하루 1–2회. 무시 가능 | RSC → inline SVG 막대. 태그 `supplier:<id>` + `mart:<buildId>`. **워크스페이스가 등록한 사업자만** 빌드·조회 가능(권한 검사 server) |
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
4. EAT-39: `listOpenAuctions`(+ `findAuctionParticipation`), `listAuctionBids`, `listOrganizationSuppliers`, `findSupplierRecord`, `listSupplierAttempts`
5. EAT-57: `listCodes` — 지역 어휘를 만드는 쪽이 그 어휘를 내보내는 계약도 갖는다

각 계약은 `packages/contracts` operation → Nest → web 순서(eatbid-vertical-slice)로 하나씩 닫는다.
