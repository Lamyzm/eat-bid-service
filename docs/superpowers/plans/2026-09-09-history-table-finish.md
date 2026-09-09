# EAT-115 과거 회차 표와 현재 공고 진입 마무리

**상태:** 2026-09-09 사용자가 시안대로 일반/확대 회차 표와 현재 공고 오른쪽 정보를 마무리하라고
승인했다. 이 문서는 이번 변경의 실행 단위와 인수 증거만 소유한다. 시안 인수의 현재 차이는
[`notice-design-fidelity.md`](../../product/notice-design-fidelity.md), 전역 배치 기준은
[`workspace-dock-implementation.md`](../../product/workspace-dock-implementation.md)가 소유한다.

**범위 밖:** 기관 비교·관심·최근 본·내 공고, API 계약·서버·수집, 인증 UI. 새 시안 파일을 만들지 않는다.

## 1. 지금 코드에서 확인한 상태 경계 결함

`?expand=과거 회차`로 연 모달의 두 번째 페이지 회차는 고를 수 없고, 닫으면 그 페이지가 사라진다.
원인은 서로 다른 세 곳이며 버튼만 추가해서는 고쳐지지 않는다.

| 위치 | 지금 동작 | 결과 |
|---|---|---|
| `_model/load-auction-page.ts` `normalizeHistoryPages` | 확대가 아니면 무조건 `1` | 닫는 순간 이어 붙인 페이지가 버려진다 |
| `_lib/decision-search-params.ts` `decisionQuery` | 확대일 때만 `pages`를 싣는다 | 닫기 주소에서 `pages`가 지워진다 |
| `_ui/decision-screen.tsx` `AttemptSelectionProvider` | 첫 페이지 `history.presentation.rows`만 받는다 | 두 번째 페이지 회차 ID가 조회 밖으로 판정돼 선택이 즉시 해제된다 |

`pages`는 "확대가 열렸다"가 아니라 "이 조회가 이어 붙인 표본 크기"를 뜻하는 값이다. 세 곳을 그
뜻으로 맞춘다. 상한 `MAX_HISTORY_PAGES`(10)와 페이지당 60행은 그대로 두고 client 무제한 fetch를
만들지 않는다. 조건이 바뀌면 `buildDecisionFilterRoute`가 이미 `pages: 1`로 되돌린다.

## 2. 실행 단위

### A. 하나의 회차 표

- `_ui/history-table.tsx`는 **받은 행을 그리는 책임만** 갖는다. 12행 상한 slice를 표에서 걷어내
  상위 composition으로 올린다.
- `_ui/expand/history-expand-table.tsx`와 `expand/rate-delta.ts`를 삭제하고 확대 본문도 같은
  `HistoryTable`을 쓴다. 열·정렬·기록 버튼이 하나의 정의에서 나온다.
- 열은 개찰 · 품목 · 낙찰률(사정률) · 2등가(사정률) · 명단 · 판정으로 통일한다. 사용자가 뺀
  그날 하한·낙찰 업체 열은 복원하지 않는다. 확대 전용이던 기초금액·하한율·`하한 아래` 막대와
  `낙찰 − 내 값` 열은 "동일 열" 결정에 따라 표에서 걷는다. 원본 명단 상세(`AuctionRosterPanel`)의
  실제 참여 상태와 값은 그대로 둔다.
- 일반 표의 명단 셀에 붙어 있던 `하한 아래 N`도 같은 이유로 뺀다. 참여 열은 짧은 참여 수와
  독립된 `기록 보기` 버튼만 남긴다.
- 세로로 긴 확대 표에서도 열 머리가 남도록 `thead th`를 `sticky top-0`으로 둔다. 일반 12행에서는
  세로 스크롤이 없어 보이는 차이가 없으므로 모드 boolean을 만들지 않는다.

### B. 과거 회차 확대는 모달이 아니라 집중 모드

- `_ui/expand/decision-expand.tsx`는 비교집단 히트맵 모달만 소유한다. 과거 회차 dialog를 없앤다.
- `DecisionFrame`의 `focus`를 `'flow' | 'history'`로 넓히고 `decision-layout.css`가 공통 집중
  geometry(뷰포트 높이·문서 스크롤 제거·필터 static)를 한 번만 정의한 뒤 어느 본문을 키울지만
  값으로 가른다. 전역 오른쪽 slot과 가용 폭은 `ApplicationShell`이 이미 소유하므로 재사용한다.
- 확대 표가 오른쪽 참여 기록을 덮지 않는다. 모달이 아니므로 패널이 그대로 보인다.
- 여는·닫는 링크는 기존 `DecisionExpandLink`를 `target`으로 일반화해 Escape 복귀와 스크롤 복원을
  차트 확대와 같은 코드로 얻는다.
- 새 `_ui/history-card.tsx`가 제목·표본 문구·확대 진입과 "12행이냐 누적 행이냐"를 소유한다.
  `decision-screen.tsx`가 더 커지지 않게 분리한다.

### C. 현재 공고 요약과 `이 공고 정보`

- `DecisionHeader`가 검토 중인 공고 한 문맥을 소유한다: 상태 배지 · 제목 · 소재지 · 마감(또는
  개찰) · 기초금액 · 하한율 · 품목 칩 · `이 공고 정보` 버튼.
- `DecisionBanner`를 없앤다. 같은 마감·기초금액을 두 번 강조하던 자리였고, 배너만 갖고 있던
  공고일·참여 수·정정·납품과 기관 발주 주기는 오른쪽 `현재 공고 정보` 패널로 옮긴다. 시안과
  fidelity 문서의 "상세 수치는 오른쪽 현재 공고 패널에서 계속 읽는다"를 그대로 따른다.
- `CurrentAuctionFacts`를 `_ui/current-auction-facts.tsx`로 분리한다. `decision-tools.tsx`는 진입
  도구만 소유하고 새 `CurrentAuctionInfoButton`이 기존 `openCurrent()`로 같은 전역 slot을 연다.
- 기관명은 계약의 관측값이 있을 때만 쓸 수 있다. 공고 제목·정규식에서 추정하지 않고, 이번 변경은
  없는 기관 목록도 만들지 않는다.

### D. 좁은 화면과 접근성

- `ResponsiveDock`의 1200px 경계와 Sheet 진입을 바꾸지 않는다.
- 표는 자기 컨테이너에서만 가로로 움직인다. 문서 가로 넘침과 전체+메인 이중 세로 스크롤을 만들지
  않는다.
- `이 공고 정보` 버튼과 닫기는 기본 button이라 Tab·Enter로 닿고 초점은 기존 `setReturnFocus`
  경로로 돌아온다.

## 3. 인수 증거

- 단위: `pnpm --filter @eatbid/web test`(변경 범위), `typecheck`, `lint:strict`, `build`.
- 저장소 gate: `pnpm quality:check`, `pnpm architecture:check`, `pnpm lint:web-boundaries`.
- Playwright: `test:e2e:decision`, `flow-focus.spec.ts`. fixture 서버(4410)와 별도 dev(3101)만
  쓰고 실행 중인 dev 3002·server 4400·preview 8767은 건드리지 않는다.
- 브라우저: 1440×1000·1280×800·1024×768·375×812에서 가로 넘침, 확대 표 내부 스크롤, 오른쪽
  패널 가림 여부, 두 번째 페이지 선택과 닫기 후 유지.
- 결정적 검사 뒤 `pnpm review:ai -- --base be1e52c --provider auto`.

증거와 잔여 차이는 `notice-design-fidelity.md`의 현황 표를 고쳐 남긴다.

## 4. 총괄 검토에서 추가된 단위 (2026-09-09)

- **표 스크롤 보존:** 확대·복귀 분기에서 표를 각각 감싸면 DOM이 다시 마운트돼 위치를 잃는다. 표의
  자리를 하나로 고정하고, 컨테이너가 세로로 넘치는 동안의 위치를 기억했다가 다시 넘치게 되는
  전환에서만 되돌린다. 조회 조건이 바뀌면 코호트 key로 표를 새로 만들어 기억을 버린다.
- **낮은 창:** 집중 모드 geometry를 `@media (min-height: 640px)` 뒤로 옮겨 낮은 창에서는 문서 흐름을
  유지한다. 뷰포트 높이 강제와 표 내부 스크롤이 겹쳐 스크롤 소유자가 둘이 되는 것을 없앤다.
- **지역 라벨:** 공고 응답의 location은 eaT 공고지역이므로 `공고 지역`으로 부르고, 관측이 없으면
  요약 줄에서 조각을 그리지 않는다.
- **검증 표면:** 기관 회차 fixture가 실제 필터와 `meta.cohort`를 구현하고, 회차 명단 fixture를
  추가한다. 낡은 SVG 차트 선택자와 "기본 탭은 비교집단" 가정을 현행 UI에 맞춘다.

## 5. 실행 결과

- 구현·검증 결과와 남은 차이는 `notice-design-fidelity.md`가 소유한다. 이 문서는 계획 단위를
  다시 쓰지 않는다.

## 6. 최종 리뷰 보완 (2026-09-09)

`decision-screen.spec.ts`의 폭 판정 helper는 `[data-slot="decision-screen"]` 안만 셌다. 현재 공고 상세와
투찰 레일·펼친 기관 요약은 전역 dock portal로 옮겨졌으므로, 그 둘을 펼친 뒤 부르는 검사 2개가 문서
가로폭만 보고 노드별 nowrap·넘침은 보지 못했다. helper가 root selector 목록을 받게 좁게 고치고 두 검사에만
dock root를 더했다. 상자가 없는 노드(닫힌 패널·숨긴 관점)는 제외하고 표의 `overflow-x` 컨테이너 제외 규칙은
그대로 둔다. selector가 없으면 조용히 통과하지 않고 실패한다.

- 부정 대조: dock의 `dd` 하나를 nowrap 긴 문자열로 바꾸면 dock 포함 판정은 `overflow 4 · wrapped 1`,
  기존 화면 slot 판정은 `0 · 0`이었다. 보완한 검사가 실제로 dock 내용을 본다는 근거다. 이 주입은 확인 뒤 되돌렸다.
- 검증: `playwright test decision-screen.spec.ts` 35개 통과, `pnpm --filter @eatbid/web typecheck` 통과,
  변경 파일 `oxlint --deny-warnings` 통과, `pnpm quality:check` 통과. `lint:strict` 전체는 legacy
  `src/components`·`src/app/dashboard` 경고로 이 변경 전부터 실패하며 이번 변경 파일과 무관하다.

## 7. 참여 관측 날짜 보완 (2026-09-09)

계약의 `participation.dayEarlier`는 "최신 관측보다 24시간 이상 앞선 관측 중 가장 늦은 것"이라 상한이 없다.
그런데 화면은 무조건 `어제보다 +n`이라 적어, 사흘이나 몇 주 전 관측을 어제 것으로 위장할 수 있었다. 값 자체는
실제 관측이므로 지우거나 조회를 다시 설계하지 않고, 이미 응답에 있는 두 `observedAt`으로 비교 대상을 밝힌다.

- `present-decision.ts`: `deltaText`가 `09-07 대비 +1`처럼 비교한 관측의 KST 날짜를 말한다. 기존 `kst()`와 같은
  방식의 날짜 formatter를 쓰고 문자열을 되파싱하지 않는다. 하루 전 관측이 없으면 여전히 `null`이다.
  최신 관측과 해가 다르면 `2026-12-31 대비`처럼 연도를 붙인다. `dayEarlier`에 상한이 없어 해를 넘긴 관측도
  올 수 있고, 그때 월일만 보이면 작년 관측이 며칠 전으로 읽힌다(`pnpm review:ai` finding 1건을 이렇게 판정했다.
  패널의 다른 시각은 `MM-DD`라 항상 연도를 붙이는 대신 해가 다른 경우로 좁혔다).
- `current-auction-facts.tsx`: 참여 꼬리가 최신 관측 시각(`09-08 19:31 기준`)을 먼저 말하고 비교가 있을 때만
  증감을 잇는다. 꼬리는 조각 목록이며 조각마다 `whitespace-nowrap`이라 `09-07 대비`와 `+1`이 다른 줄로 갈라지지
  않는다. 좁은 dock에서 실제로 갈라지던 것을 실물 확인으로 잡았다.
- 실제 API 확인: `API_URL=http://127.0.0.1:4400`으로 별도 dev(3111)를 띄워 공고 89를 Chromium으로 열었다.
  참여 행이 `1곳 09-08 19:31 기준 · 09-07 대비 +1`로 그려졌고, 이는 응답의 `latest 2026-09-08T10:31:04Z`(1곳)과
  `dayEarlier 2026-09-07T10:30:49Z`(0곳)와 같다. 임시 config·spec은 확인 뒤 삭제했다.
- 회귀: 비교가 사흘 전인 경우 `08-31 대비 +0`이라 적고 `어제`를 쓰지 않는 단위 검사, 해를 넘긴 비교가 연도까지
  말하는 검사, 비교 관측이 없을 때 증감 없이 기준 시각만 남는 검사, 참여 관측 자체가 없을 때 셋 다 비는 검사를
  `present-decision.test.ts`에 뒀다. 브라우저 검사는 25시간 떨어진 fixture 두 관측의 KST 날짜가 서로 다른지까지 본다.
- 검증: `pnpm --filter @eatbid/web test` 434개 통과, `typecheck` 통과, `test:e2e:decision` 35개 통과,
  변경 파일 `oxlint --deny-warnings` 통과, `pnpm quality:check`·`pnpm lint:web-boundaries` 통과. 계약과 서버는
  건드리지 않아 `contracts:check`는 대상이 아니다.
- 남은 차이: `지난 공고` 행은 dt 라벨과 dd 값(`지난 공고 07-24 · 41일 만`)이 겹쳐 읽힌다. 값 문자열은
  `org-cadence.ts`가 소유하므로 이번 writer 범위 밖이라 그대로 뒀다.
- 총괄 마감 검토: 두 번째 AI advisory의 구분점 단독 줄바꿈 지적을 표시 품질 문제로 수용했다. `·`를
  뒤따르는 날짜 조각의 `nowrap` 안으로 옮기고 조각 앞 공백에서만 줄을 바꾸게 했다. 사실·계약·레이아웃
  구조는 바뀌지 않으며 이 마감은 기존 표시 단위 검사와 변경 파일 lint로 확인한다.
