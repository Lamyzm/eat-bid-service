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
