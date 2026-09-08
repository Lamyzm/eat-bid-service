# EAT-40 실제 내 투찰을 기존 차트에 연결한다

이 단계는 EAT47 실제 로그인·사업자 설정 웹과 EAT40 batch backend, EAT115 승인 UI가 검증·통합된 뒤 실행한다. 현재 인수 담당 Claude/Codex가 그 증거를 검토하고 통합 base를 확정한다. 이전 Codex 세션이 살아 있어야 하는 조건은 없다. 사용자 승인 범위는 로그인 사용자가 등록한 사업자의 실제 제출을 차트에서 보고 점을 눌러 같은 회차 명단을 여는 최소 기능이다. 추천·자동투찰·성적표·지도·새 전역 레이아웃은 추가하지 않는다. sole writer assign/claim/doctor, 관련 AGENTS/계약/vertical slice skill을 적용하고 실제 구현·브라우저 검증까지 완료한다. 공유 outbox sync와 운영 DB 쓰기·DDL·배포 금지.

## 선행 결과를 재사용

- 기존 계정 계약, private API transport/query key/로그아웃 정리, shadcn 입력·선택 컴포넌트, 로그인·설정 진입을 재사용한다. localStorage 사업자번호를 새 SSOT로 쓰거나 인증 우회를 만들지 않는다.
- 공개 history operation에 `includeRevision=true`를 요청하고 `HistoryRow.revisionId`에 보존한다. opt-in이 무시되거나 값이 없으면 최신 revision으로 추정하지 말고 준비 안 됨/계약 오류로 닫는다.
- 기존 `auctionQueries.roster(auctionId, revisionId)`가 이미 있다. 오른쪽 기록은 이 경로에 표·차트가 고른 revision을 반드시 전달한다. 새로운 roster API가 필요하지 않다.
- EAT40 `myBidObservationV1Operations`의 batch 하나를 소비한다. `businessId/organizationId/buildId/attemptId+revisionId` 계약과 실제 응답 union을 읽고 다른 DTO를 발명하지 않는다. 전체 roster를 회차마다 받아 브라우저에서 번호로 찾는 N+1 금지.
- 차트 표본은 현재 첫 페이지 60회이며 확대한 과거 표의 누적 최대 600회와 다르다. batch 상한 200을 표 확대 한도와 혼동하지 않는다. 이번 실제 점은 차트에 보여주는 유효 history 집합만 요청한다. 더 불러온 회차의 기록 열기는 기존 roster 하나를 필요할 때만 읽는다.

## 표시와 선택

등록이 한 개면 그 사업자를 사용할 수 있고 여러 개면 명시적으로 선택한다. shadcn Select/Dropdown을 재사용하며 사용자 번호를 URL query에 넣지 않는다. 표시 선택 상태는 현재 principal/workspace 안에 한정하며 계정이 바뀌면 이전 선택과 점을 비운다. 등록·수정·주소는 EAT47 설정 화면에서 한다.

- 실제 점 범례는 `내 투찰`. 기존 가정 `myRate` 수평선과 색·형태·이름을 구별한다. 가정값을 실제 제출로 이름만 바꾸지 않는다.
- 원천 예정가격 대비 `bidRate`를 exact 소수 셋째 자리 그대로 표시한다. Number는 렌더 좌표 변환에만 사용한다. 100 초과도 지우지 않는다.
- `EFT_ALL_AMT`의 submittedAmount가 없으면 금액 미확인이다. sourceCalculatedAmount나 금액 환산으로 실제 제출을 만들지 않는다.
- 미로그인은 짧은 로그인 연결, 사업자 없음은 설정 연결, supplier unobserved/conflict·명단 미관측·명단 내 기록 없음·조회 오류는 서로 다른 상태로 처리한다. '번호 등록'을 법적 사업자 인증으로 표현하지 않는다.
- 같은 날·같은 회차의 여러 source account/여러 제출을 모두 보존한다. 겹친 점은 회차·품목·비율·실제 금액 등의 선택 목록으로 구분하며 raw 내부 계정 ID를 제품 설명으로 도배하지 않는다. DOM key는 submissionId를 쓴다. 점 선택은 기존 AttemptSelectionProvider로 오른쪽 해당 회차 기록을 열고 중앙 현재 공고를 바꾸지 않는다.

## LWC 최소 렌더링 경계

설치 5.2.1의 **custom series 하나**를 권고한다. 날짜별 unique time 한 행에 submissions 배열을 담고 renderer가 같은 x에 각각의 y를 그리면 중복 시간을 버리지 않는다. 일반 LineSeries는 동일 time 중복을 허용하지 않으므로 첫 값 선택·평균·가짜 초·jitter를 넣지 않는다. 자동 conflation도 끈다. 엔진·테마·범례·선택·휠·pan은 기존 controller를 유지한다.

- 작은 순수 own 표시 모델(전체 history에서 생성), custom renderer, 기존 controller의 `setOwnSubmissions` 경계로 책임을 나눈다. framework나 별도 차트 엔진을 만들지 않는다.
- `FlowChartCanvas`의 model.points가 낙찰값 null을 제외하고 생성 자체를 막는 조건을 고친다. 개찰일 calendar가 있고 실제 내 점만 있는 경우도 엔진이 동작해야 한다. 낙찰값 없음과 모든 기록 없음을 구별한다.
- own 응답/사업자 ID를 remount key에 넣지 않는다. 같은 canvas의 own 계열만 교체하고 자동 업데이트에 fitContent를 호출하지 않는다. 현재 logical/time·price range를 보존하며, '전체 값'을 눌렀을 때만 공개 표시 계열과 own을 함께 포함한다.
- 비동기 응답 도착, 계정/사업자 전환, 필터/build 변경에서 이전 계정 점이 잠깐 남거나 늦은 응답이 복귀하지 않게 EAT47 query 취소·폐기 정책을 공유한다.

참고한 공식 문서: https://tradingview.github.io/lightweight-charts/docs/plugins/custom_series 및 설치본 typings.d.ts의 ICustomSeriesPaneView/PaneRendererCustomData/CustomBarItemData. 실제 설치 API가 권위이며 존재하지 않는 API를 추측하지 않는다.

## build 전환과 재조회

첫 history 응답의 buildId/asOf를 다음 페이지 요청에 고정한다. opened=only 조건에서 둘 중 하나를 빠뜨리지 않는다. 코호트/기간이 바뀌면 별도 집합이며 이전 cursor를 이어 쓰지 않는다. 페이지 응답의 build와 요청한 revision projection을 소비 측에서도 검증한다.

현재 RSC history는 use cache(stale300/revalidate900/expire3600)라 router.refresh만 해도 오래된 첫 페이지가 다시 올 수 있다. **409 → router.refresh만 반복하는 구현은 불충분하다.** 확인한 build 전환에서 누적 표·선택·개인 점을 같은 새 집합으로 갱신하고, 자동 복구는 유계 횟수 뒤 명시적 재시도를 제공한다. stale 공개 데이터와 새 own 응답을 섞지 않는다. 실패를 '이력 끝'이나 0건으로 보이지 않는다. nonce cache key·공유캐시 전체 비우기·새 Next public API·개인 데이터 RSC공유cache는 금지한다.

총괄이 읽기 검토 후 택한 최소 복구는 **stable route freshness 모드**다. 예를 들어 `historyRead=latest`(기본 cached)라는 유한 값 하나로 409 복구 시 기존 route에 다시 들어간다. RSC는 이 모드에서만 organizations resource의 cookie 없는 no-store **uncached entry**를 주입하고 기존 loadHistory/presentHistory/presentOrgCadence 조립을 그대로 쓴다. 바깥 use-cache를 호출한 채 내부 fetch만 no-store로 바꾸면 stale은 남으므로 안 된다. 새 snapshot을 별도 client provider로 복제하거나 DecisionScreen에 use client를 붙여 Temporal 경계를 넓히지 않는다.

- 이 값은 nonce나 임의 timestamp가 아니다. view/expand/pages 주소 빌더가 유한 모드를 보존한다. 현재 decisionQuery가 허용 키를 직접 열거하므로 parser만 고치면 안 된다. 다른 공고로 새로 진입할 때는 기본 cached 경로다.
- cached 상태에서 실제409가 나면 latest로 자동 전환은 한 번만 한다. 이미 latest에서 다시 충돌하면 명시적 재시도를 보이고 반복 자동 navigation을 하지 않는다. 늦은 이전 scope의 응답이 현재 route를 전환하지 못하게 한다.
- 한 RSC read에서 첫 페이지의 build/asOf를 모든 후속 페이지에 고정한다. 중간409면 catch-all partial success로 prefix를 반환하지 말고 누적 결과 전체를 폐기한다. 최신 모드에서 pages를 늘리면 전체 prefix를 새로 조립해 한 번에 교체한다.
- 기존 dataplane의 shared cache 무효화 소유권은 유지한다. 공용 태그 무효화를 사용자에게 열지 않는다. 문서는 이 예외 읽기와 성능 상한을 명시한다. 이력 표·차트·기관 요약은 서버의 같은 표시모델을 계속 사용한다.

## 인수

작은 단위·계약소비 시험 후 실제 브라우저에서 합성 세션/자료를 사용한다. EAT47의 실제 disposable DB/Nest+Playwright composition을 재사용하고 회사번호를 운영 자료에서 복사하지 않는다.

필수: 같은 날짜의 복수 계정·복수 제출·완전 겹침, winner null이고 own만 있는 회차, placeholder 금액을 실제로 보이지 않음, batch60회차 1요청, own 도착 전후 및 사업자 전환 후 같은 canvas·zoom 유지, 이전 응답 지연 복귀 차단, 실제 점 클릭→오른쪽 같은 attempt/revision, 데이터 발행 중409→같은 새 build 복구, 로그아웃/다른 계정 private cache 격리. 캔버스 존재만 확인하고 점 검증이 됐다고 하지 않는다.

관련 typecheck/quality/web boundary/architecture/contracts check, 실제 브라우저 viewport/keyboard와 canonical pnpm review:ai를 마무리한다. 이전 광범위 legacy lint 실패는 새 변경 실패와 구별하고 baseline을 넓혀 통과시키지 않는다. 한국어 commit/실제 검증 결과/한계/lease 반납을 남긴다. 실제 Google 왕복은 구성 미확인이라 아직 검증된 것으로 보고하지 않는다.
