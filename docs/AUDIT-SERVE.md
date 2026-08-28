# AUDIT-SERVE — DB → API → 화면 오용 전수 (축 2)

조사자: audit-serve · 2026-08-28 · **코드 수정 없음. 조사와 판정만.**

측정 환경: 라이브 서버 `http://localhost:8081/api`, 라이브 DB(`kubectl -n eatbid exec deploy/postgres`).
모든 숫자는 이 문서를 쓴 시점의 **실측**이다. 추정에는 "추정"이라고 적었다.

**DB 규모(실측)**: `firm_bids` 7,919,833행 · `school_auctions` 147,633행 · `schools` 4,700행 ·
`open_auctions` 121행 · 시군구 144곳(그중 API가 내주는 건 113곳).

**조사 방법**: 전 25개 엔드포인트의 실제 응답을 받아 필드를 전수 추출 → 각 필드를
`apps/web/src` 전체에 `rg -w`로 세었다. **"타입 선언에만 있고 값으로 읽지 않는 것"은 0회로 센다** —
`allowedLabel`처럼 `type OpenRow`에 적혀만 있는 필드는 화면에 도달하지 않는다.

---

## 0. 이 문서가 DEBT.md에 더하는 것

DEBT.md에 이미 있는 항목은 다시 쓰지 않았다. 아래는 **새로 찾은 것**과 **기존 항목의 규모 정정**뿐이다.

| | 내용 |
|---|---|
| 신규 A급 | **S-1** `/api/firms/bids?summary=1` 이 라이브에서 100% HTTP 500 · **S-2** 웹이 `/api/open`에 `region`을 한 번도 안 보내 서버 자격판정이 죽어 있음(의정부 사용자에게 66건이 0건으로 보임) · **S-3** 학교명 단독 조인이 20,149개 사업자의 두 학교를 합침 · **S-4** 학교 찾기가 전국 상위 500만 받아 지역 필터를 걸어 4,200곳(89%)이 도달 불가 |
| 규모 정정 | DEBT가 "`bids.valid` 안 실어서 화면이 복원한다"고 쓴 자리 — **라이브 `firm_bids`에 `valid` 컬럼 자체가 없다**(10컬럼 전수 확인). 안 싣는 게 아니라 없는 것이고, 그래서 하한미달 규칙이 **서로 다른 두 규칙**으로 갈렸다(§3-1, 4,645행 불일치) |
| 규모 정정 | "S-1 처방이 적재만 되고 서빙이 안 된다"(DEBT §7-0) → **지금은 서빙까지 된다**. `byCat`이 `/api/open` 응답의 19.9%를 차지한다. 끊긴 자리는 **웹**이다 — `byCat` grep 0회, `roster?category` 호출 0회 |
| 규모 정정 | 하드코딩 "전국 137개 시군구 · 공고 10만 건 · 투찰 694만" — 세 숫자 **전부** 틀렸고 3개 파일에 복사돼 있다(§2-6) |

---

## 1. 미사용 — 서버가 싣는데 웹이 안 읽는 것

`rg -w`로 `apps/web/src` 전체를 세었다. "타입 선언만"은 값 읽기 0회로 판정한다.

| # | 필드 | 서버 위치 | 웹 읽기 | 규모 | 사용자에게 보이는 모습 | 처방 |
|---|---|---|---|---|---|---|
| U-1 | `byCat` (품목별 band/recent3/nSameFloor) | `app.module.ts:192-217` | **0회** | `/api/open` 응답 106,648B 중 **21,228B (19.9%)**. 6개 호출처가 매번 받아서 버린다 | 축산 사장이 보는 "잘 나온 구간"이 여전히 **전 품목 합산**이다. S-1 사고가 서버에서만 고쳐지고 화면은 그대로 | 카드·상세가 `byCat[선택품목]`을 쓰게 배선. 안 쓸 거면 응답에서 빼라 — 지금은 20%를 버리는 중 |
| U-2 | `bandBasis: "all-categories"` | `app.module.ts:215` | **0회** | 전 open 행 | 화면이 "이 구간은 전 품목 섞은 값"이라고 말하기로 한 재료. 아무 화면도 말하지 않는다 | U-1과 한 세트. 품목별로 못 가르면 최소한 이 라벨을 찍어라 |
| U-3 | `unrestricted` · `allowedLabel` · `allowedRegions` | `app.module.ts:205, 223-225` | `unrestricted`/`allowedLabel`은 `today/page.tsx:35` **타입 선언만**, `allowedRegions`는 전체 **0회** | 열린 공고 121건 중 **무제한 65건(54%)** | §7-1 참조. 라이브 최대 결함 | 웹의 `homes.includes(sigungu)`를 서버 판정으로 교체 |
| U-4 | `qualificationBasis` | `app.module.ts:229` | `today/page.tsx:329` **1회** — 단, 이 값을 읽기 전 `homes.includes(sigungu)`로 뱃지 표시 여부를 이미 결정한다 | 65건 | 뱃지가 아예 안 뜨는 자리에서는 근거 라벨도 무의미 | 판정 자체를 서버로 옮기면 자연히 해결 |
| U-5 | `mine` (그 회차에 내 투찰 있음) | `app.module.ts:370-374, 391` | **0회** | 서버가 `bizNos`를 받으면 계산하는데, **웹 3개 호출처 전부 `bizNos`를 안 보낸다**(`today:92`, `wins:60`, `welcome:96`) | 낙찰 속보에서 "내가 낸 판"이 표시되지 않는다. 대신 `wins/page.tsx:44`가 **내 투찰 2,000행을 따로 받아** Set을 만든다 — 2,000행 넘으면 옛 회차의 표시가 조용히 사라진다 | `/api/wins/recent`에 `bizNos` 전달 · `wins/page.tsx:42-49` 삭제 |
| U-6 | `nMulti` · `nAlsoIn` · `countBasis` (월별 보드) | `app.module.ts:418-452` | **0회** | 전 월×품목 칸 | 주석(`app.module.ts:418-423`)이 "필터 결과와 칸 합계의 차이를 화면이 스스로 설명하게 하는 재료"라고 못 박았는데, `wins/page.tsx:29`의 `MonthCell` 타입에 세 필드가 없다. 사장은 필터 8,462건과 칸 합계가 안 맞는 이유를 못 본다 | `MonthCell`에 추가하고 칸 툴팁에 "이 칸 대표 n건 · 다른 대표인데 이 품목 포함 m건" |
| U-7 | `basis` · `nRounds` (로스터) | `app.module.ts:124-125` | **0회** | 전 로스터 응답 | 지금 보는 단골 목록이 **전 품목 혼합**인지 특정 품목인지 화면이 말하지 않는다. 그리고 웹은 애초에 `category`를 안 보내므로 **항상 `all-categories`** | `roster?category=`를 보내고 `basis`를 표기 |
| U-8 | `schools.rsd` (예정가 출렁임 2sd) | `schools` 응답에 실림 | **0회** (`rsd` grep 전체 0) | 4,700행 | 값이 있는데 아무 화면도 안 쓴다. 그리고 `analysis-board.tsx:330-334`가 **같은 개념을 `plannedPrice/basePrice`에서 다시 계산**한다(p5/p95) | 둘 중 하나로. 서버 값을 쓰면 분석판이 회차 전량을 훑을 필요가 없다 |
| U-9 | `schools.byCatFloor` | `schools` 응답에 실림 | **0회** | 4,700행. 응답의 가장 큰 덩어리 | 학교 찾기가 500행 × byCatFloor 전체를 받아 버린다 | U-1과 한 세트 |
| U-10 | `schools.updatedAt` · `market_regions.updatedAt` | 응답에 실림 | **0회** | 4,700 + 시장 전 행 | "이 통계가 언제 계산된 건지"를 화면이 못 말한다. `fetchedAt`(공고)만 배선됐고 통계 쪽은 안 됐다 | 학교/시장 화면에도 같은 신선도 줄 |
| U-11 | `schools.winnerBizNo` (`/schools/:id/auctions`) · `winnerBiz` (`/rounds/school/:id`) | `app.module.ts:714` | `winnerBizNo` 0회 / `winnerBiz`는 `analysis-board.tsx:31` **타입 선언만** | 전 회차 | 화면은 `winnerName`만 쓴다. 이름이 null인 회차(=`firms`에 없는 사업자)에서 "—"만 뜨고 사업자번호는 못 본다 | `winnerName ?? winnerBiz` 폴백 |
| U-12 | `/api/firms/bids?summary=1` 전체 분기 (`winRatePct`·`winSum`·`runnerUp`·`below`·`pushed`) | `app.module.ts:483-513` (**31줄**) | **호출처 0곳** | 전량 | §7-2 참조. 만들어놓고 부르지 않는 데다 **부르면 500이 난다** | 고쳐서 배선하거나 지워라. 지금은 둘 다 아니다 |
| U-13 | `/api/results`의 `myRate`·`diff` | `app.module.ts:270-275` | **0회** | 투찰 표시한 전 회차 | `today/page.tsx:47`의 `ResultRow` 타입에 두 필드가 없다. `today:199-200`이 **`marks[].rate`(사용자가 기억해 적은 값)로 덮어쓰고 `diff`를 다시 계산**한다. 원장(`firm_bids.bid_rate`)의 실제 값 대신 사용자 기억이 채점된다 | §3-3 참조 |
| U-14 | `firms.first_seen` · `firms.last_seen` | **응답에 안 실림** | 0회 | 전 업체 | "이 업체가 언제부터/언제까지 활동했나"를 DB는 아는데 어느 화면도 못 보여준다. 업체 화면이 총계 2개(참여·낙찰)만 보여주는 이유 | `/firms/lookup`·`/firms/search`에 추가 |
| U-15 | `schools.purr_cd` | **응답에 안 실림** + DB에 **0/4,700 채워짐** | 0회 | 4,700행 전부 NULL | 스키마 주석(`auctions.ts:35-38`)이 "학교의 정체성 키"라 선언했지만 로더가 안 채운다. A-8/A-9(인천 개편)를 막을 열쇠가 빈 컬럼으로 남아 있다 | 로더에서 채우기 전까지 이 컬럼을 근거로 쓰는 설계를 세우지 마라 |
| U-16 | `events.meta` | **응답에 안 실림** | — | 이벤트 전량 | `track.ts`가 `bidNo`·`rate`·`from`·`regions`를 실어 보내는데 `/events/summary`(`app.module.ts:981-992`)는 day·screen·n·sessions만 낸다. **깔때기 화면이 "어디서 왔나"를 못 본다** | 게이트 측정이 목적이면 `meta->>'from'` 축을 추가 |
| U-17 | `user_mark.updated_at` | 응답에 안 실림 | — | 전 마크 | "이 값 언제 저장했더라"를 못 보여준다. 다기기 병합 충돌 시 어느 쪽이 최신인지도 못 가린다 | `groupMarks`에 `at` 추가 |

**서버 파라미터인데 웹이 한 번도 안 보내는 것** (= 서버 로직이 통째로 죽어 있음):

| 파라미터 | 서버 구현 | 웹 전송 | 결과 |
|---|---|---|---|
| `/api/open?region=` | `eligibleFor`·`isUnrestricted` `app.module.ts:144-161, 236-239` | **0/6 호출처** | 부분문자열→완전일치로 좁힌 그 수정(주석 `:157-159`)이 **한 번도 실행되지 않는다** |
| `/api/schools?sigungu=` | `app.module.ts:23` | **0/2 호출처** | §7-4 — 4,200곳 도달 불가 |
| `/api/schools?category=` | `app.module.ts:25` (`cat_counts ? cat` 포함 기준) | **0/2 호출처** | §7-5 — 품목당 1,700~2,398곳 소실 |
| `/api/schools/:id/roster?category=` | `school_roster_cat` `app.module.ts:99-102` | **0/2 호출처** | S-1 처방 테이블이 통째로 미조회 |
| `/api/wins/recent?bizNos=` | `app.module.ts:370-374` | **0/3 호출처** | U-5 |
| `/api/firms/bids?summary=1` | `app.module.ts:483-513` | **0곳** | U-12 |

---

## 2. 중복 — 같은 값을 두 곳 이상에서 만드는 곳

| # | 값 | 사본 위치 | 규모 | 사용자에게 보이는 모습 | 처방 |
|---|---|---|---|---|---|
| D-1 | **하한미달/밀림 판정** | 서버 5곳: `app.module.ts:273-275`(results, `<floorRate`) · `:493-494`(summary, `<winRate`) · `:581`(record, `<floorRate`) · `:743`(replay, `<winRate`) · `:946`(share, `<winRate`)<br>웹 6곳: `analysis-board.tsx:53-58` · `today/page.tsx:476-482` · `auction-detail.tsx:208-214` · `record/page.tsx:68, 133, 203, 253` | 11개 사본, **두 규칙** | §3-1 — 규칙이 갈려 라이브에서 **4,645행**이 다르게 세어진다. 게다가 `record/page.tsx` 한 페이지 안에서 같은 개념이 **'하한 아래 관찰' / '하한아래' / '하한미달' / '하한아래관찰'(CSV)** 네 이름으로 나온다 | 규칙 하나를 `packages/shared/domain`에 두고 전부 호출. 이름도 하나 |
| D-2 | `effFloor = floorRate × plannedPrice / basePrice` | `app.module.ts:533-534` · `app.module.ts:709-710` (문자 그대로 동일, `toFixed(4)`) | 서버 2곳 | 지금은 값이 같아 안 터졌다. 한쪽만 고치면 리허설(오늘)과 회차표(분석판)가 갈린다 | 함수 하나로 |
| D-3 | `dday` 마감 카운트다운 | `today/page.tsx:50-56` · `auction-detail.tsx:124-130` · `analysis-board.tsx:575-579` | 웹 3곳, **글자 단위 동일** (`36e5`, `h<24`) | 지금 일치. 서버가 안 주는 값이라 3곳이 각자 `Date.now()`를 본다 — **팀이 이미 겪은 "기준 시각 하나만 달라 D-day가 하루 어긋난" 사고의 재발 자리** | `shared/domain/date.ts`로 (이미 `kstDate`·`kstTime`이 거기 있다) |
| D-4 | 중앙값 `sorted[Math.floor(len/2)]` | 서버 4곳 `app.module.ts:63, 190, 447, 511` · 웹 4곳 `analysis-board.tsx:878`, `record/page.tsx:73`, `today/page.tsx:397`, `wins/page.tsx:75` | 8개 사본 | 짝수 표본에서 상위값을 쓰는 규약이 우연히 일치. 한 곳만 "평균" 방식으로 바꾸면 조용히 갈린다 | `shared`에 `median()` |
| D-5 | 추천 투찰값 `(floorRate ?? 90) + 0.05` | `today/page.tsx:384, 398` · `auction-detail.tsx:182` · `analysis-board.tsx:909` | 4곳. 매직넘버 **2개**(`90`, `0.05`) | `floorRate`가 null이면 **하한을 90이라고 지어내고** `auction-detail.tsx:193`이 "하한(90) 아래입니다"라고 단언한다. 모르는 값을 아는 것처럼 말하는 자리 | 상수화 + null이면 추천을 내지 마라 |
| D-6 | `사업자번호 replace(/-/g,'')` | 서버 6곳 `app.module.ts:132, 258, 370, 472, 638, 678` (`FirmsController.parse`가 있는데 3개 컨트롤러가 각자 인라인) · 웹 3곳 `my/page.tsx:42`, `welcome/page.tsx:112`, `workspace.ts:9` | 9곳 | 지금 일치 | 서버는 파이프/데코레이터 1개, 웹은 `lib` 함수 1개 |
| D-7 | `schoolId.split('\|')` | 서버 6곳 `app.module.ts:68, 134, 270, 382, 383, 443` · 웹 2곳 `analysis/[id]/page.tsx:18`, `use-breadcrumbs.tsx:36` | 8곳 | 학교명에 `\|`가 들어가면 전부 깨진다. §3-4의 이름 조인 사고가 여기서 나온다 | `parseSchoolId()` 하나 |
| D-8 | 캐시 `Map` + `600_000` TTL | `app.module.ts:33/40`(forecast) · `321/328`(crowd) · `400/407`(monthly) · `646/652`(top) | 4개 사본 | `crowd`의 사본은 버그다 — `app.module.ts:340`이 `this.crowdCache.set(key, data && {at,data})`로 **캐시 엔트리가 아니라 `{at,data}`를 값으로 저장**해서 다음 히트의 `hit.data`가 `{at,data}` 객체가 된다. 다만 `hit.at`이 `undefined`라 `Date.now()-undefined = NaN < 600000`이 false → **항상 캐시 미스**. 결과적으로 crowd는 캐시가 없다(느릴 뿐, 값은 옳다) | 캐시 데코레이터 1개. 이 4곳은 그때 함께 고쳐진다 |
| D-9 | `자주 걸린 값` (recur) | 서버: `schools.by_floor[f].recur` → `/api/open` `band.recur`로 실림<br>웹: `auction-detail.tsx:47-51`이 `/schools/:id/auctions`에서 **다시 계산** | 2곳 | 학교 찾기(`schools/page.tsx:213`)는 **서버 값**을, 공고 상세는 **웹 재계산**을 쓴다. 분모가 다르다(서버=하한별 사전집계, 웹=그 학교 전 회차 중 `floorRate===floor`). 두 화면의 "자주 걸린 값" 목록이 다를 수 있다 | 서버 `band.recur` 하나로 |
| D-10 | `계약액 = basePrice × bidRate / 100` | 서버 `app.module.ts:495, 659` · 웹 `today/page.tsx:407, 418, 424`, `record/page.tsx:74`, `delivery/page.tsx:69` | 7곳 | 지금 일치 | `shared`에 `bidAmount()` |
| D-11 | `rate` 미러 파생 | 서버 `groupMarks` `app.module.ts:796-808` (우선순위: **''(미지정) → 첫 키**)<br>웹 `primaryRate` `mark-rates.ts:59-64` (우선순위: **등록 사업자 순서 → 나머지**) | 2곳, **규칙이 다름** | `rates = {'':90.1, 'A':90.5}`인 사용자에게 서버 미러는 90.1, 웹 파생은 90.5. 지금은 `marks.ts:17-24`가 서버 미러를 **덮어써서** 화면에는 웹 값만 간다 → 서버 `groupMarks`의 미러 계산(13줄)은 **도달 불가 코드** | 미러를 서버에서 빼거나, 규칙을 맞춰라 |
| D-12 | 학교 "잘 나온 구간" band 선택 | `schools/page.tsx:29-33`(**n이 가장 큰 하한 버킷**) · `app.module.ts:177-181`(**그 공고의 floorRate**) · `analysis-board.tsx:286-290`(**사용자가 고른 하한 탭**) | 3개 규칙 | 같은 학교의 "잘 나온 구간"이 학교 찾기·공고 상세·분석판에서 서로 다른 하한을 근거로 나온다. 어느 화면도 어떤 하한을 골랐는지 밝히지 않는다 | 하한을 화면에 명시하거나 규칙 통일 |
| D-13 | 하드코딩 데이터 규모 문구 | `today/page.tsx:211` · `auction-detail.tsx:153` · `welcome/page.tsx:138` | 3곳 동일 문자열 | §7-6 — 세 숫자 전부 틀림 | `/api/wins/regions`와 `/healthz` 확장으로 실측값 배선 |
| D-14 | `/api/open` 전량 다운로드 | `today:120` · `auction-detail:60` · `analysis-board:357` · `region-status:16` · `region-switcher:15` · `welcome:94` | **6개 호출처 × 106.6 KB** | 대시보드 한 화면에서 같은 106 KB를 3~4번 받는다. 그중 `auction-detail:60`은 "같은 날 마감 건수" 하나 세려고, `analysis-board:357`은 `schoolId` 일치 몇 건 고르려고 전량을 받는다 | 서버에 `schoolId`·`deadline` 필터 추가, 또는 요약 엔드포인트 |

---

## 3. 다른 소스 — 같은 개념을 서로 다른 테이블/컬럼으로 읽는 곳

이 축은 "웹이 스스로 만드는가"를 보는 판정선이 **구조적으로 못 잡는다**. 양쪽 다 서버가 주기 때문이다.

| # | 개념 | 소스 A | 소스 B | 실측 불일치 | 사용자에게 보이는 모습 | 처방 |
|---|---|---|---|---|---|---|
| X-1 | **하한 미달 판정** | `bid_rate < floor_rate` — `/firms/record`(`app.module.ts:581`), `/results`(`:273`), `my-bids` 소비처(`auction-detail.tsx:84`) | `bid_rate < win_rate` — `/share/:token`(`:946`), `summary=1`(`:493`), `replay`(`:743`), 웹 `record/page.tsx:68` | **4,645행** (3,448,069 vs 3,452,714, 낙찰실패 7,761,430행 기준) | 같은 사업자의 **내 성적** KPI 타일(서버, floorRate 규칙)과 **공유 링크**(서버, winRate 규칙)가 다른 "하한미달" 수를 낸다. `record/page.tsx`는 서버 응답이 오면 A, 실패하면 **조용히 B로 바뀐다**(`:161-163`의 `agg ? … : …`) | 규칙 하나 확정 → `shared`. 원장에 `valid`가 없다는 사실을 화면 문구에 남겨라 |
| X-2 | **학교의 시군구/이름** | `firm_bids.sigungu` · `firm_bids.school_name` — 내 성적(`/firms/bids`), 납품, 동가 | `school_auctions.school_id`의 `split('\|')` — 낙찰 속보(`:383`), 회차(`:382`), 예보(`:68`) | 같은 `bid_id`로 이은 7,410,520행 중 **시군구 9,855행 · 학교명 22,561행 불일치** (9개 학교에 집중) | 같은 회차가 내 성적에서는 "A초등학교/의정부시", 낙찰 속보에서는 "B초등학교/다른구"로 나온다 | `school_auctions`를 원본으로 삼고 `firm_bids`의 두 컬럼은 조인 키로 쓰지 마라 |
| X-3 | **업체 상호** | `firms.name` — 속보·회차·리플레이·TOP·검색 | `school_roster.name` (적재 시점 사본) — 로스터 | **329행 불일치** / 707,917행 | 공고 상세의 "최다 낙찰 ○○상회"와 분석판 회차표의 낙찰자 이름이 다를 수 있다 | 로스터도 `firms`를 조인 |
| X-4 | **내 투찰값** | `firm_bids.bid_rate` → `/results`의 `myRate` (실제 원장) | `user_mark.rate` / localStorage `marks` (사용자가 적어둔 값) | 미측정(사용자 데이터) | `today/page.tsx:198-202`가 서버 `myRate`·`diff`를 **버리고** 마크 값으로 채점한다. 사장이 오타로 90.5를 90.05로 적었으면 화면은 원장의 90.5가 아니라 90.05로 "밀렸다"고 말한다 | 원장 값이 있으면 원장 우선, 없을 때만 마크. 둘이 다르면 그 사실을 보여라 |
| X-5 | **한 회차의 기초금액·하한율** | `firm_bids.base_price/floor_rate` — `/firms/bids` 응답의 표시값(`:538`) | `school_auctions.base_price/floor_rate` — 같은 응답의 `effFloor` 분모(`:533-534`) | **0행 불일치**(현재) | 지금은 같다. 같은 함수 안에 `r`과 `sa`가 둘 다 있고 필드마다 다른 쪽을 고르고 있다 — 재적재로 한쪽만 밀리면 `effFloor`가 표시값과 무관해진다 | 한쪽으로 통일 |
| X-6 | **품목** | `/wins/recent`는 `category` + `categories` 둘 다 | `/firms/bids`는 `sa?.category` **대표 하나만**(`:538`) | 학교 4,700곳 중 **3,899곳(83%)이 다품목** | 같은 회차가 낙찰 속보에서는 "종합 3품목", 내 성적 표·CSV에서는 "공산" 하나로 나온다 | `/firms/bids`도 `categories` 실어라 |
| X-7 | **선택 가능한 지역 목록** | `/wins/regions` — `school_auctions` 과거 이력 기반(형식 + n≥20) → **113곳** | `open_auctions.sigungu` — 지금 열린 공고의 실제 지역 → **144곳 중 8곳이 목록에 없음** | 열린 공고 **13건**의 지역(영종구 4·포항시 3·무주군·정선군·진안군·울주군·경주시 각 1)을 드롭다운에서 **고를 수 없다** | 영종구(2026-07 인천 개편 신설) 사업자는 자기 지역을 등록할 방법이 없고, 그 4건은 영원히 "전국 더 보기" 안에만 있다 | `/wins/regions`가 `open_auctions`의 지역도 합집합으로 내야 한다 |
| X-8 | **학교 동일성 판단** | `bid_id` 조인 — 회차·리플레이·속보 | **`school_name` 단독 조인** — `/schools/:id/my-bids`(`:139`), `/firms/badges`(`:623`) | 학교명이 2개 이상 시군구에 존재: **608개 이름 / 679개 학교**. 열린 공고 121건 중 **18건(15%)**이 해당 | §7-3 — **20,149개 사업자**의 두 학교가 합쳐진다 | 조인에 `sigungu`를 넣거나 `school_id`로 조인 |

---

## 4. 계약 불일치 — zod vs 실제 응답

**먼저, 가장 큰 사실**: `packages/shared/src/domain`의 응답 계약 **11개 중 런타임 검증에 쓰이는 것은 0개**다.
전 사용처가 `import type`이고, `createZodDto`는 **쿼리 스키마 2개**(`SchoolsQuery`·`OpenQuery`)에만 붙어 있다
(`app.module.ts:15-16`). 서버는 응답을 검증하지 않고 웹은 파싱하지 않는다.
그래서 아래 불일치는 **아무 데서도 오류를 내지 않는다** — 조용히 어긋난다.

| # | 계약 | 계약 필드 수 | 실제 응답 필드 수 | 차이 | 판정 |
|---|---|---|---|---|---|
| Z-1 | `OpenAuction` (`auction.ts:42-53`) | 9 | **25** | 계약에 없는데 서버가 보냄: `schoolId, categories, isMultiCategory, categorySrc, countBasis, bandBasis, byCat, catCounts, band, recent3, usualN, nSameFloor, unrestricted, allowedLabel, qualificationBasis, fetchedAt` (**16개**) | 커버리지 **36%**. 그래서 `today/page.tsx:28-46`이 자기 `OpenRow` 타입을 따로 선언했다 — 계약이 화면보다 뒤처져 쓸모를 잃었다 |
| Z-2 | `SchoolAuctionRow` (`auction.ts:32-39`) | 6 | **18** | 없는데 보냄: `schoolId, category, categories, categorySrc, winnerBizNo, winnerName, plannedPrice, dlvryStart, dlvryEnd, reserves` + 2 | 커버리지 **33%** |
| Z-3 | `SchoolSummary` (`auction.ts:19-29`) | 9 | **13** | 없는데 보냄: `rsd, catCounts, byCatFloor, updatedAt`. **계약에도 스키마에도 있는 `purrCd`는 응답에 없다** | 커버리지 69%. `purrCd` 누락은 배포된 서버 이미지가 `auctions.ts:38`보다 앞선다는 뜻 — **스키마와 배포본의 드리프트** |
| Z-4 | `MarketRegion` (`auction.ts:56-66`) | 8 | **19** | 없는데 보냄: `detail`(중첩 4단, 응답 184 KB의 대부분), `updatedAt` | 커버리지 42% |
| Z-5 | `ForecastRow` (`auction.ts:70-77`) | 6 | **7** | `lastWinRate`가 계약에 없는데 서버가 보내고 **웹이 읽는다**(`today/page.tsx:588`) | **계약이 부정하는 필드로 화면이 굴러간다.** `today/page.tsx:48`이 shared를 안 쓰고 로컬 타입을 다시 선언한 이유 |
| Z-6 | `FirmRecord`·`BidResult`·`MyBidRow`·`FirmTimelinePoint` | 7/7/6/3 | 동일 | 일치 ✓ | 이 4개는 맞다 |
| Z-7 | **계약 자체가 없는 엔드포인트** | — | — | `/wins/recent`, `/wins/monthly`, `/wins/crowd`, `/wins/regions`, `/rounds/school/:id`, `/rounds/:bidId`, `/schools/:id/roster`, `/firms/bids`, `/firms/ties`, `/firms/badges`, `/firms/search`, `/firms/top`, `/firms/lookup`, `/me`, `/share`, `/events/summary` | **25개 중 16개(64%)가 무계약**. 그중 `/rounds/school/:id`·`/firms/bids`는 판정의 원재료를 나르는 핵심 경로다 |
| Z-8 | 타입 일치 | — | — | `Category` enum 6종 — `open_auctions.category`·`schools.category` 라이브 값 전수 확인, **이탈 0건** ✓ · `FloorStat.p` 길이 5 — 4,700행 전수 **일치** ✓ | 여기는 문제 없다 |
| Z-9 | 응답 형태 불안정 | — | — | `/wins/recent`·`/firms/bids`는 `withTotal`/`summary` 유무에 따라 **배열 또는 객체**를 반환한다(`:394-396`, `:545`). 5개 호출처가 전부 `Array.isArray(d) ? d : (d.rows ?? [])`를 손으로 쓴다 | 항상 `{rows,total}`로 통일 |

---

## 5. 조용한 실패 — 각각이 화면에 무엇으로 보이는가

**측정** (전 `.ts`/`.tsx`를 12줄 창으로 스캔, `components/ui` 제외):
API `fetch` 호출처 **52곳** 중 — `.catch(() => {})`로 삼키는 것 **26곳**, `.catch`가 아예 없는 것 **24곳**,
**실패를 사용자에게 알리는 것은 2곳뿐**이다(`today/page.tsx:120` `openError`, `wins/page.tsx:60` `loadError`).

> **52곳 중 50곳(96%)이 실패를 화면에 말하지 않는다.** 아래 표는 그중 "실패가 사실 주장으로
> 렌더링되는" 자리를 추린 것이다 — 조용히 비는 것보다 이쪽이 위험하다.

| # | 위치 | 코드 | 실패 시 화면에 나오는 말 | 왜 위험한가 | 처방 |
|---|---|---|---|---|---|
| Q-1 | `today/page.tsx:158` | `.catch(() => {})` (`/rounds/school/:id`) | **"같은 하한 기록 0회 — 표본이 적습니다"** (`:474`) | `hist[sid]`가 비면 `same.length = 0 < 3`이라 이 문장이 뜬다. **네트워크 실패가 "데이터가 없다"는 사실 주장으로 렌더링된다.** 사장이 판단 근거로 읽는 바로 그 줄 | 실패와 0건을 구분: `undefined`(못 받음) vs `[]`(없음) |
| Q-2 | `today/page.tsx:176` | `.catch(() => {})` (`/schools/forecast`) | **"2주 내 발주 예정이 없습니다"** (`:576`) | 서버가 죽어도 "예정 없음"이라고 단언한다 | 동일 |
| Q-3 | `today/page.tsx:106` | `.catch(() => {})` (`/wins/recent`) | 하드코딩 문구 **"전국 137개 시군구 · 공고 10만 건 · 투찰 694만 데이터 기준."**(`:211`)으로 폴백 | 실패가 **틀린 숫자 3개**로 덮인다 (§7-6) | 폴백을 없애고 자리만 비워라 |
| Q-4 | `today/page.tsx:185-188` | `.catch` **없음** (`/api/results`) | 어제 채점 구역이 그냥 비어 있음 | unhandled rejection. "투찰 저장했는데 결과가 안 뜬다"로 신고된다 | catch + 재시도 |
| Q-5 | `today/page.tsx:194-195` | `.catch` **없음** (`/firms/badges`) | 카드의 "투찰 N회 · 낙찰 M회" 뱃지가 사라짐 | 실적이 있는데 없는 것처럼 보인다 | 동일 |
| Q-6 | `today/page.tsx:123` | `rows[0]?.fetchedAt` | **공고가 0건이면 신선도 줄이 통째로 사라진다** | 로더가 멈춰 `open_auctions`가 빈 날 = "오늘 자료가 아직 안 들어왔습니다" 경고가 **가장 필요한 날**에 안 뜬다. 첫 행 하나로 전체 신선도를 대표하는 것도 부정확 | `fetchedAt`을 목록과 분리해 내려라 |
| Q-7 | `record/page.tsx:58` | `.catch(() => {})` (`/firms/record`) | KPI 타일이 **서버 전체 집계 → 표에 불러온 300행 집계로 조용히 전환** (`:145-147, 161-163`) | 숫자가 작아지는데 라벨(`· 전체 기간`, `:149`)만 사라진다. 게다가 **판정 규칙까지 바뀐다**(X-1) | 실패를 표시하고 폴백하지 마라 |
| Q-8 | `wins/page.tsx:69` | `.catch` **없음** (`/wins/monthly`) | 월별 보드가 빈 표 | "이번 달 데이터가 없나 보다"로 읽힌다 | catch |
| Q-9 | `wins/page.tsx:48` | `.catch(() => {})` (`/firms/bids`) | "내 판" 하이라이트가 전부 사라짐 | 조용 | U-5로 함께 해소 |
| Q-10 | `auction-detail.tsx:73` | `.catch(() => {})` (`/rounds/school`) | 계산기 아래 "이 값이면 과거 N회 중…" **줄이 통째로 사라짐**(`:207` `same.length<3` → `null`) | Q-1과 같은 사고인데 여기서는 **아무 말도 안 한다**. 사장은 그 줄이 원래 없는 화면인 줄 안다 | 동일 |
| Q-11 | `auction-detail.tsx:81` | `.catch` **없음** (`/my-bids`) | "내 기록" 카드 없음 | `bizNos.length > 0 ? my.length > 0 && …`(`:381`) 구조라 실패와 무기록이 동일하게 보인다 | 동일 |
| Q-12 | `analysis-board.tsx:256, 321, 349, 358, 359, 371, 520` | `.catch(() => {})` **7개** | 렌즈별로 조용히 빈 상태 | 분석판은 요청 7개가 전부 조용히 실패할 수 있고 화면은 "표본이 없습니다"만 말한다 | 로드 상태를 한 곳에 모아라 |
| Q-13 | `analysis/[id]/page.tsx:25` | `schools.find(s => s.id === decoded) ?? null` | `school`이 null이면 **`byFloor` 없이 렌더** — "잘 나온 구간"이 사라짐 | `/api/schools?q=<이름>&limit=5`(`:18`)가 `sigungu`를 안 보낸다. 자기 이름 검색 상위 5에 자기가 없는 학교 **6곳**은 항상 이 상태(실측). `ilike '%이름%'`이라 부분일치도 경쟁한다 | `?sigungu=`를 함께 보내라 — `decoded.split('\|')[0]`이 바로 옆에 있다 |
| Q-14 | `market-map.tsx:50` | `.catch` **없음** | 지도에 원이 하나도 안 뜸 | "이 품목은 시장이 없다"로 읽힌다 | catch |
| Q-15 | `delivery/page.tsx:56` | `.catch` **없음** + `limit=2000` | 계약 표가 비거나 **오래된 계약이 조용히 잘림** | 서버가 `openedAt desc` 정렬이라 2,000건 넘는 업체는 옛 납품이 사라진다. 화면에 아무 고지가 없다 | `withTotal=1`로 잘림을 알려라 |
| Q-16 | `delivery/page.tsx:31` | `ym(d) = d.toISOString().slice(0,7)` | **UTC 기준 월** | 같은 파일이 `todayKST`를 import(`:12`)하면서 기본 월은 UTC로 잡는다. 매월 1일 **00:00~09:00 KST에 지난 달이 열린다** — `shared/domain/date.ts`가 죽이려던 바로 그 버그 | `kstDate().slice(0,7)` |
| Q-17 | `welcome/page.tsx:116-118` | `.catch` **없음** (온보딩 `lookup`+`record`) | 사업자 확인 버튼이 아무 반응 없이 끝남 | 첫 화면의 첫 동작이 조용히 죽는다 | try/catch + 토스트 |
| Q-18 | `region-status.tsx:20`, `region-switcher.tsx:20` | `.catch(() => {})` (`/api/open`) | 헤더 칩·상태줄의 공고 수가 **사라지거나 0** | §7-1과 겹쳐 "내 지역에 공고가 없다"는 인상을 강화한다 | 동일 |
| Q-19 | 서버 `app.module.ts:340` | `this.crowdCache.set(key, data && { at, data })` | 없음(값은 정상) | 캐시가 **영구 미스**. `/wins/crowd`가 매 요청 630만행 집계를 돈다. 호출처 3곳이 하한 바뀔 때마다 부른다 | `{ at: Date.now(), data }` |
| Q-20 | 서버 `app.module.ts:501` | `fb.biz_no = any(${bizNos})` | **HTTP 500** | §7-2 | 배열 바인딩 수정 |
| Q-21 | `schools/page.tsx:54` | `.catch` **없음** | 학교 목록이 빈 채로 **"0개 학교"**(`:100` 히어로 숫자) | §7-4의 지역 절단과 구분이 안 된다. 서버가 죽어도, 지역에 학교가 없어도, 상위 500에 안 들어도 전부 같은 화면 | catch + 세 경우를 다른 문구로 |
| Q-22 | `firms/page.tsx:40, 45, 51, 52` | `.catch` **없음 × 4** | 업체 화면의 TOP·검색·성적·추이가 각각 조용히 빔 | 한 화면의 4개 요청이 전부 무방비 | catch |
| Q-23 | `analysis/[id]/page.tsx:18-19`, `auction/[bidNo]/page.tsx:13, 19, 22` | `.catch` **없음 × 5** (서버 컴포넌트) | 서버 렌더 중 throw → **Next 에러 페이지** | 클라이언트와 달리 여기는 부분 실패가 아니라 화면 전체가 죽는다. `page.tsx:13`의 `open`이 null이면 별도 처리가 있지만(`:14-16`) fetch 자체가 던지면 그 분기에 못 간다 | try/catch + 부분 렌더 |

---

## 6. DB 컬럼 → 응답 커버리지 (축 2-①)

라이브 `information_schema` 138컬럼 전수 대조. 서빙 테이블(auth 제외)만 정리한다.

| 테이블 | 컬럼 | 응답에 실리는가 | 비고 |
|---|---|---|---|
| `firm_bids` (10) | 전부 | ✓ | **`valid` 컬럼은 존재하지 않는다.** DEBT의 "`bids.valid`를 안 실어서"는 정정 필요 — 없는 컬럼이다. 그 부재가 D-1/X-1의 원인 |
| `school_auctions` (15) | 전부 | ✓ | `reserves`는 실리지만 웹 읽기 2회(타입 선언 포함) |
| `schools` (14) | 13 | `purr_cd` **미포함** | Z-3. 게다가 DB에서 **0/4,700 채워짐** |
| `open_auctions` (11) | 전부 | ✓ | 단 `allowed_regions`는 웹 읽기 **0회** |
| `firms` (8) | 5 | `first_seen`·`last_seen`·`updated_at` **미포함** | U-14 |
| `school_roster` / `_cat` (7/8) | 전부 | ✓ | `_cat`은 웹이 한 번도 요청 안 함 |
| `market_regions` (11) | 전부 | ✓ | `updated_at` 읽기 0회 |
| `events` (5) | `meta` **미포함** | U-16 | |
| `user_mark` (6) | `updated_at` **미포함** | U-17 | |

**"안 실어서 화면이 각자 복원하게 만든 것"의 전수** — `bids.valid` 외에 같은 구조는 다음 셋:

1. **`open_auctions.allowed_regions`는 싣는데 판정(`unrestricted`)을 화면이 안 읽어서** 웹이 `homes.includes(sigungu)`로 자기 판정을 만든다 (§7-1).
2. **`firms.first_seen/last_seen`을 안 실어서** 업체 화면이 "얼마나 오래 했나"를 못 말한다 — 복원할 재료조차 없다.
3. **`events.meta`를 안 실어서** 깔때기 화면이 유입 경로를 못 본다 — `track.ts`가 보내는 `from`이 DB에만 쌓인다.

---

## 7. 지금 라이브에서 실제로 틀린 것

아래 6건은 **오늘 이 서버·이 DB로 재현된다.** 추정 아님.

### 7-1. 🔴 자격 지역 사용자에게 공고 66건이 0건으로 보인다

웹은 `/api/open`에 **`region`을 한 번도 안 보낸다**(6개 호출처 전부).
그래서 서버의 `eligibleFor`(`app.module.ts:153-161`)는 **한 번도 실행되지 않고**,
화면은 `homes.includes(o.sigungu)`(학교 소재지)로 자기 판정을 만든다 — `today/page.tsx:129, 327`, `region-status.tsx:19`, `region-switcher.tsx:19`.

허용지역(누가 낼 수 있나)과 학교 소재지(어디 학교인가)는 다른 개념이다. 실측:

| 자격 지역 | 웹 헤더/목록이 세는 수 | 서버 규칙이 통과시키는 수 |
|---|---|---|
| 의정부시 | **0** | **65** |
| 강남구 | **0** | **65** |
| 금정구 | 5 | 65 |
| 창원시 | 5 | 69 |
| 전주시 | 7 | 72 |
| 정읍시 | 10 | 75 |

열린 공고 121건 중 **65건(54%)이 지역 제한 없음**이다. 의정부 사장이 앱을 열면
"진행 중 공고 0건" → **"진행 중인 공고가 없습니다"**(`today/page.tsx:282`)를 본다.
낼 수 있는 공고 65건이 "전국 더 보기" 뒤에만 있다.

**그리고 공고 상세는 정반대로 거짓말한다**: `auction-detail.tsx:139`의 `<Badge>자격 충족</Badge>`는
**조건이 하나도 없다.** 정읍 제한 공고를 의정부 사장이 열면 **"자격 충족"**이라고 단언한다.
같은 공고에 대해 오늘 카드는 뱃지를 안 주고 상세는 무조건 준다 — **"두 화면이 다른 말을 한다" 6번째 사고**.

처방: `/api/open?region=`을 보내고, 뱃지를 `unrestricted`/`qualificationBasis`로 그려라. 재료는 이미 응답에 있다.

### 7-2. 🔴 `/api/firms/bids?summary=1`이 100% HTTP 500

```
GET /api/firms/bids?bizNos=1268639553&summary=1        → 500
GET /api/firms/bids?bizNos=1268639553,8568602410&summary=1 → 500
GET /api/firms/bids?bizNos=...&summary=1&months=6      → 500
```

원인 (서버 로그 실측): `app.module.ts:501`
```
fb.biz_no = any(${bizNos})   →   생성 SQL: any(($1))   params: '1268639553'
PostgresError 22P02: malformed array literal: "1268639553"
```
drizzle의 `sql` 템플릿이 JS 배열을 배열 파라미터가 아니라 개별 파라미터로 펼쳐
`any()`에 스칼라가 들어간다. 원소 수와 무관하게 항상 깨진다.

**규모**: 이 분기 31줄(`:483-513`)이 `winRatePct`·`winSum`·`runnerUp`·`below`·`pushed`를
**전 원장 기준으로** 내도록 만들어졌다(주석: "U11: 행 배열 없이 KPI만 — 전체 기준 수치를 싸게").

**사용자에게 보이는 모습**: 아무것도. **호출처가 0곳이라 아무도 이 500을 못 본다.**
대신 `record/page.tsx`가 같은 값을 **표에 불러온 300행 창**에서 다시 계산한다 —
`runnerUps`(`:71`), `ruMed`(`:73`), `winSum`(`:74`), 낙찰률(`:146`).
"아깝게 진 판 N번 2등"은 전 원장이 아니라 최근 300행 중 최근 12개월 안의 수다.
화면은 그 차이를 `winSum`에만 고지한다(`:94`).

처방: 배열 바인딩을 고치고(`inArray(firmBids.bizNo, bizNos)` 또는 `${sql.raw}` 대신 파라미터 배열)
`record/page.tsx`의 4개 클라이언트 집계를 이 응답으로 교체. 안 할 거면 31줄을 지워라.

### 7-3. 🔴 학교명 단독 조인이 서로 다른 두 학교를 합친다

`/api/schools/:id/my-bids`(`app.module.ts:139`)와 `/api/firms/badges`(`:623`)는
`firm_bids.school_name`**만**으로 조인한다. 시군구를 안 본다.

실측:
- 학교명이 2개 이상 시군구에 존재: **608개 이름 / 679개 학교**
- 그 이름 아래 2개 이상 시군구에 투찰한 사업자: **20,149곳**, 합쳐지는 원장 **219,325행**
- **지금 열린 공고 121건 중 18건(15%)**이 그런 이름이고, 그 18건에 걸리는 사업자 **186곳**

예: `지산고등학교` — 원장 6,223행 중 파주시는 1,128행. 두 곳 모두에 투찰한 업체는
오늘 카드 뱃지 "투찰 N회 · 낙찰 M회"와 공고 상세 "내 기록"에서 **다른 학교의 전적을 자기 것으로 본다.**

같은 조인이 반대로도 샌다: `school_name` 22,561행이 `school_auctions.school_id`의 이름과 달라
(9개 학교, X-2) **그 회차들은 my-bids에서 통째로 빠진다.**

처방: `school_id`(또는 `sigungu`+`school_name`)로 조인. `bid_id` 조인이 가능한 자리는 그쪽으로.

### 7-4. 🔴 학교 찾기: 4,700곳 중 4,200곳(89%)이 지역 필터로 도달 불가

`schools/page.tsx:49-57`은 `/api/schools?limit=500`만 부르고(검색어 없을 때),
지역 필터를 **클라이언트**에서 건다(`:74`). 서버 정렬은 `n_auctions desc` 전국 기준이다.
`/api/schools?sigungu=`가 있는데(`app.module.ts:23`) 안 보낸다.

실측 — 지역별 "그 지역 학교 수 / 전국 상위 500에 든 수":

| 시군구 | 학교 수 | 보이는 수 | 가려진 수 |
|---|---|---|---|
| 전주시 | 146 | **0** | 146 |
| 서구 | 119 | **0** | 119 |
| 북구 | 99 | **0** | 99 |
| 진주시 | 81 | **0** | 81 |
| 동구 | 79 | **0** | 79 |
| 창원시 | 225 | 70 | 155 |
| 수원시 | 146 | 21 | 125 |
| 화성시 | 129 | 6 | 123 |
| 용인시 | 120 | 6 | 114 |

전주 사장이 자기 지역을 고르면 **"0개 학교"**를 본다. 화면은 이유를 말하지 않는다
(`:102`의 "상위 500 표시" 문구는 검색어가 없을 때만 뜨고, 지역 필터와의 관계를 설명하지 않는다).

### 7-5. 🟠 학교 찾기 품목 필터가 품목당 1,700~2,398곳을 버린다

서버는 포함 기준(`cat_counts ? cat`)을 구현해 뒀다(`app.module.ts:25`).
웹은 그 파라미터를 안 보내고 **대표 품목 완전일치**로 거른다(`schools/page.tsx:75`, `s.category === cat`).

| 품목 | 서버 규칙(포함) | 웹 규칙(대표) | 웹이 버리는 학교 |
|---|---|---|---|
| 공산 | 4,518 | 2,120 | **2,398** |
| 수산 | 2,145 | 245 | **1,900** |
| 농산 | 2,497 | 609 | **1,888** |
| 축산 | 3,205 | 1,503 | **1,702** |
| 김치 | 1,095 | 198 | 897 |
| 기타 | 381 | 25 | 356 |

학교 4,700곳 중 **3,899곳(83%)이 다품목**이라 대표 하나로 거르면 대부분이 사라진다.
"공고 15,604건이 화면에서 사라진다"며 서버에 넣은 그 규칙(`app.module.ts:280-284` 주석)이
**학교 목록에서는 안 쓰이고 있다.** (§7-4의 500행 절단과 곱해져 실제 손실은 더 크다.)

### 7-6. 🟠 데이터 규모 문구 세 숫자가 전부 틀렸고 3곳에 복사돼 있다

`today/page.tsx:211` · `auction-detail.tsx:153` · `welcome/page.tsx:138`:
> 전국 **137개** 시군구 · 공고 **10만 건** · 투찰 **694만**

실측: 시군구 **144곳**(API가 내주는 건 **113곳**) · 회차 **147,633건(14.8만)** · 투찰 **7,919,833건(792만)**.

세 숫자 다 틀렸고 방향도 섞였다. 공고·투찰은 각각 **48%·14% 과소**,
시군구는 실제로 고를 수 있는 수(113)보다 **과대**. 같은 앱의 `/dashboard/my` 지역 목록은 113개를 보여준다.
로더가 도는 한 이 격차는 계속 벌어진다.

---

## 8. 아직 안 터진 것 (지금은 값이 맞지만 구조가 예약해 둔 것)

| # | 자리 | 왜 지금은 안 터지나 | 무엇이 방아쇠인가 |
|---|---|---|---|
| L-1 | `effFloor` 서버 2사본 (`app.module.ts:533-534`, `:709-710`) | 두 사본이 글자까지 같다 | 한쪽만 수정. 오늘 화면 리허설과 분석판 회차표가 갈린다 |
| L-2 | `dday` 웹 3사본 | 세 사본이 같고 전부 `Date.now()` | 기준 시각을 하나만 바꾸면 **팀이 이미 겪은 D-day 하루 어긋남 사고가 그대로 재현**된다 |
| L-3 | `firm_bids`의 `base_price`/`floor_rate`/`win_rate` 사본 (X-5) | 현재 **불일치 0행** | 재적재가 `school_auctions`만 갱신하면 `/firms/bids`의 표시값과 `effFloor` 분모가 달라진다 |
| L-4 | 중앙값 8사본 (D-4) | 짝수 표본 규약이 우연히 전부 같다 | 한 곳을 "두 값 평균"으로 바꾸면 같은 학교의 중앙값이 화면마다 갈린다 |
| L-5 | `rate` 미러 이중 파생 (D-11) | 웹이 서버 미러를 덮어써서 웹 규칙만 보인다 | `marks.ts:17-24`를 걷어내면 **미지정 슬롯을 우선하는 서버 규칙**이 드러나 값이 바뀐다 |
| L-6 | 분석판 학교 조회 (Q-13) | 자기 이름 상위 5에 못 드는 학교가 **6곳뿐** | 학교가 늘거나 `limit=5`가 유지된 채 동명 학교가 늘면 조용히 확대 |
| L-7 | `/wins/crowd` 캐시 무효 (Q-19) | 값은 옳고 지금 트래픽이 작다 | 사용자가 늘면 매 요청 792만행 집계. 캐시를 "고쳤다"고 착각할 여지 |
| L-8 | `schools.purr_cd` (U-15, Z-3) | 아무도 안 읽는다 | 로더가 채우기 시작하면 **배포된 서버가 이 컬럼을 응답에 안 싣는다** — 채웠는데 화면에 안 온다 |
| L-9 | 응답 형태 배열/객체 이중 (Z-9) | 5개 호출처가 전부 방어 코드를 손으로 썼다 | 새 호출처가 방어를 빠뜨리면 `d.rows`가 `undefined` |
| L-10 | `sigungu = '급식실'` | 열린 공고 **5건**, 원장 **11,712행 / 47개 학교명** | 주소 파서 산출물이 시군구 자리에 들어와 있다. `SGG_RE`를 통과 못 해 `/wins/regions`에 안 뜨므로 **그 학교들은 어떤 지역 필터로도 안 잡힌다**. 지역 필터를 서버로 옮기는 순간(§7-4 처방) 이 행들의 처리를 정해야 한다 |
| L-11 | zod 응답 계약 11개 (Z-1~Z-7) | 런타임 검증에 **0개** 쓰여서 어긋나도 조용하다 | 계약을 실제로 켜는 순간 `/api/open`은 16개 필드가 계약 밖이라 `.strict()`면 전부 깨진다. **계약을 켜기 전에 계약을 응답에 맞춰야 한다 — 반대가 아니다** |

---

## 9. 처방 우선순위 (규모 × 위험)

**1순위 — 라이브에서 사람이 틀린 걸 보고 있다**
1. §7-1 자격 판정: `/api/open?region=` 전송 + `auction-detail.tsx:139` 무조건 뱃지 제거 — **65건/121건**
2. §7-3 이름 조인: `my-bids`·`badges`를 `school_id`로 — **20,149 사업자 / 186곳이 지금 영향**
3. §7-4 학교 찾기: `?sigungu=` 전송 — **4,200곳(89%) 도달 불가**
4. §7-5 품목 필터: `?category=` 전송 — **품목당 최대 2,398곳**

**2순위 — 숫자가 갈리는 규칙**
5. X-1 하한미달 규칙 통일 (4,645행) + 이름 통일(현재 4가지)
6. §7-2 `summary=1` 500 수정 후 `record` 화면 배선, 또는 31줄 삭제
7. §7-6 하드코딩 규모 문구 3곳 제거

**3순위 — 조용한 실패를 말하게**
8. Q-1·Q-2·Q-10: "못 받음"과 "없음"을 타입에서 구분(`undefined` vs `[]`)
9. Q-6 `fetchedAt`을 목록과 분리
10. Q-16 `delivery/page.tsx:31` UTC → KST

**4순위 — 안 터졌지만 예약된 것** (L-1~L-11). 리팩터링 주간에 D-1~D-14를 `shared`로 모을 때 함께.
