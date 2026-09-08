# 전역 오른쪽 공간과 전체 폭 분석 화면의 구현 계획

**상태:** 2026-09-08 계획 검토와 전역 메뉴/전체 폭 기준 재확인 후 사용자가 "진행해봐"로 실행을
승인했다. 아래 A/B와 브라우저 검증을 dev에 구현했으며 마지막 AI advisory와 handoff를 기록한다.

**목표:** 분석 화면의 좌우 바깥 여백과 최대 폭 제한을 없애고, 공고·기록 도구와 선택 상세를
공통 레이아웃의 오른쪽 끝에 배치한다. 기존 차트·표·명단·shadcn 컴포넌트를 재사용한다.

**구조:** `ApplicationShell`은 화면의 열·높이·고정 위치를, 공고 route는 현재 공고와 선택 회차를
소유한다. shared의 작은 portal slot primitive를 통해 route의 React context를 보존한 채 표시 위치만
옮긴다. shell이 공고 API나 route-private 모듈을 import하지 않는다.

**기술:** 현재 React/Next.js, Base UI 기반 shadcn, React DOM portal, 기존 Lightweight Charts 엔진.
**명세:** `screen-system.md` §4의 최신 배치 합의. 이 계획의 아래 완료 체크는 이전 로컬 패널의
구현 기록이며 이번 전역 배치의 완료 증거가 아니다.

## 1. 고정할 기준과 범위

- **서로 독립된 두 정책:** 오른쪽 메뉴는 앱의 전역 탐색 영역이다. 현재 공고 분석 화면은 차트 작업
  화면이므로 중앙 지면의 좌우 여백 없이 가용 폭 전체를 쓴다. 전역 메뉴가 있다는 이유로 중앙에
  별도 여백이나 route 내부 사이드바를 만들지 않는다. 홈·설정의 중앙 폭 정책은 이와 별개다.
- 배치 비교 기준은 `b78a76c` 시점의 `prototypes/shell-comparison-2026-09-08/` A 왼쪽 메뉴 시안이다.
  이후 구현에 맞춰 시안을 몰래 수정하지 않는다. 초기 Claude 화면과 v6/v7은 참고 자료다.
- 분석 route의 `max-w-[1600px]`, 중앙 정렬용 `mx-auto`, 외곽 `px-3/sm:px-4`를 제거한다.
  차트 축·텍스트·클릭 영역의 **내부 padding**은 유지한다. 폰트나 데이터 표시를 이번에 다시 설계하지 않는다.
- 왼쪽 업무 메뉴와 실제 경로를 유지한다. 홈·설정의 읽기 폭은 각 화면이 소유한다.
  이번 전체 폭 변경은 분석 화면에 적용하며 모든 대시보드의 폭 제한을 일괄 삭제하지 않는다.
- 오른쪽 도구 줄의 기준 폭은 시안과 같은 64px, 펼친 상세는 320px이다. 두 영역 사이와 중앙 본문
  사이에는 불필요한 gutter를 두지 않고 경계선으로 구분한다. 닫으면 상세 폭 전체를 중앙에 반환한다.
- 오른쪽 도구와 상세는 상단 공통 헤더 바로 아래부터 viewport 하단까지 이어진다.
  공고 제목·배너·필터 아래에서 시작하거나 중앙 본문 최대 폭 안에 들어가지 않는다.
- 1200px 미만에서는 오른쪽 줄 자체가 0px이고 **공통 헤더**에서 접근한다. 상세는 기존 Sheet를 쓴다.
- 관심·최근 본·내 공고는 전역 기능을 위한 설계 대상이다. 실제 조회·저장은 이 레이아웃 수정에
  포함하지 않는다. 빈 목록을 조회 성공처럼 보이게 하거나 복제된 placeholder endpoint를 만들지 않는다.
  미제공 기능 때문에 공고·기록을 route 내부 배치로 되돌리지 않는다.

## 2. 코드의 책임과 조립

```text
ApplicationShell
└ SidebarProvider + DockSlotsProvider
  ├ AppSidebar                         기존 왼쪽 탐색
  └ SidebarInset                       기존 단일 main landmark
    ├ Header                           전역 헤더 / 좁은 화면의 도구 진입 slot
    └ WorkspaceColumns                 화면 전체 가용 폭
      ├ WorkspacePage                  route children, min-width: 0
      │ └ DecisionScreen
      │   ├ DecisionFrame              제목·상태·필터·차트·표만
      │   └ AuctionWorkspaceDock       공고의 도구와 상세를 slot으로 전달
      ├ DockSlotHost(panel)            전역 상세 영역
      └ WorkspaceToolRail
        ├ GlobalShortcuts             전역 메뉴 구성은 shell 소유
        └ DockSlotHost(rail)           공고·기록 등 현재 화면의 맥락 도구
```

`DockSlotsProvider`, `DockSlotHost`, `DockSlot`은
`apps/web/src/shared/ui/workspace-dock-slots.tsx`가 제공하는 범용 UI primitive다.
`slot`은 `'panel' | 'rail' | 'header'`로 제한하며 DOM host와 표시할 `ReactNode`만 취급한다.
호스트 없는 독립 렌더에서는 slot을 출력하지 않는다. 제품 코드와 통합 테스트는 provider/host로 감싼다.
DOM selector, `document.querySelector`, 전역 window registry, 별도 event bus를 사용하지 않는다.

```tsx
type DockSlotName = 'panel' | 'rail' | 'header';
// 각 함수의 children은 ReactNode, Host의 className은 선택적 string이다.
<DockSlotsProvider>{children}</DockSlotsProvider>
<DockSlotHost slot='panel' />
<DockSlot slot='panel'>{panelContent}</DockSlot>
```

- host는 공통 레이아웃이 안정된 callback ref로 제공하고, `DockSlot`은 같은 host에 portal을 만든다.
  패널 열림이나 테마 전환으로 host DOM을 교체하지 않는다. route의 QueryClient·선택·후보 context는
  portal을 통과해 유지되므로 shell로 데이터나 ReactNode state를 복사할 필요가 없다.
- Next의 Activity가 이전 화면을 숨겨 보관할 때 단순 portal은 숨은 DOM 때문에 전역 상세 폭을
  남겼다. slot별로 안정된 mount 노드를 만들고 layout Effect에서 host에 붙이거나 해제한다.
  Activity의 Effect 정리에 따라 지면을 비우고 다시 활성화하면 같은 노드를 붙여 상태를 복원한다.
  provider는 host만 소유하며 API나 전역 selector를 추가하지 않는다.
- `AttemptSelectionProvider`는 중앙 분석 대상과 다른 `selectedId`, 공고/기록 관점, 열림을 유지한다.
  이번 실제 연결은 기존의 한 개 활성 패널만 사용한다. 전역 세 목록을 연결하는 후속 작업에서도
  동시에 다른 패널을 추가하지 않고 이 한 공간의 활성 관점을 전환해야 한다.
- `AuctionWorkspaceDock`은 route-private 모듈이다. `DecisionTools`, `CurrentAuctionFacts`,
  `AuctionRosterPanel`, `BidRail`, `ResponsiveDock`을 조립한다. shell은 이 모듈을 import하지 않는다.
- 공통 헤더의 `dockControls` slot과 shell의 rail은 위치만 제공한다. `DecisionTools`가 자신의
  DropdownMenu와 진입 버튼을 함께 portal로 전달해 Base UI와 공고 context를 보존한다.
- `GlobalShortcuts`는 `workspace-dock.tsx` 안에서 shell이 조립하는 전역 메뉴다. 공고 화면이
  전역 메뉴 자체를 생성하거나 제거하지 않는다. 현재 화면의 맥락 도구 slot과 전역 메뉴는 별개이며,
  상세 내용이 바뀌어도 전역 메뉴의 위치와 구성이 함께 바뀌지 않는다.
- 조건 필터가 선택 회차를 제외하면 기존대로 무효화한다. 다른 공고로 이동하면 이전 route의
  portal도 해제되어 다른 페이지에 낡은 공고·기록 버튼이나 명단이 남지 않는다. 전역 메뉴는 유지한다.

## 3. 선택과 스크롤 동작

| 행동 | 중앙 | 오른쪽 |
|---|---|---|
| 공고 정보 열기 | 분석 대상 유지 | 현재 공고 제목·상태·사실 |
| 차트 점 / 과거 회차 선택 | 선택 강조, 분석 대상 유지 | 선택 회차의 상세·실제 참여 기록 |
| 닫기 / 재열기 | 차트 범위·표 스크롤·선택 유지 | 마지막으로 요청한 관점 표시 |
| 다른 공고 페이지로 이동 | 새 분석 대상 | 이전 회차 내용 해제 |
| 필터로 선택 회차 제외 | 새 조회 표본 | 이전 선택 및 명단 해제 |

배치가 전역이라는 이유로 중앙 공고 ID를 선택 회차 ID로 덮어쓰지 않는다. 현재 공고와 과거 회차는
제목·품목·개찰일 등 확인된 정보로 구분한다. 부족한 기관명·분류를 이름에서 추정하지 않는다.

분석은 기본 보기부터 전체 가용 **폭**을 쓴다. `크게 보기`는 같은 본문에서 차트의 **높이 배분**을
늘린다. 기본 보기의 날짜·과거 회차 영역을 무작정 줄여 전체 화면처럼 보이게 하지 않는다.

일반 보기는 기존 문서 스크롤 하나와 sticky 공통 헤더·필터를 유지한다. 오른쪽 도구는 viewport에
남고 긴 명단만 패널 내부에서 스크롤한다. 중앙에 추가 세로 스크롤 wrapper를 만들지 않는다.
집중 보기는 기존의 충분한 높이 조건에서 중앙 높이를 제한하고 이력 표만 내부 스크롤하며 문서
스크롤을 없앤다. 낮은 화면은 문서 스크롤로 돌아간다. 상단 높이를 여러 파일의 56/128px 계산으로
복제하지 않고 공통 레이아웃 CSS 변수 하나로 전달한다.

## 4. 구현 단위와 검증 순서

실행 시 `superpowers:executing-plans`로 아래 단위를 따른다. 이 문서 작성 자체는 구현 시작이 아니다.

### A. 공통 레이아웃의 자리와 수명주기

수정: `apps/web/src/shell/layout/application-shell.tsx`,
`apps/web/src/components/layout/header.tsx`.
추가: `apps/web/src/shell/layout/workspace-dock.tsx`, `workspace-layout.css`,
`apps/web/src/shared/ui/workspace-dock-slots.tsx`, `workspace-dock-slots.test.tsx`.

- [x] 먼저 slot 안에서 route context 값을 읽는 통합 테스트를 쓴다. 값 변경 후 같은 상세에 반영되고
  route child를 제거하면 공통 host가 비는 것을 확인한다. 구현 전 실패를 확인한다.
- [x] `createPortal(children, mount)`로 slot primitive를 구현한다. callback ref가 host를 해제하면
  portal도 해제한다. 새 query/store/서버 호출을 만들지 않는다.
- [x] shell에서 Header 아래 공통 열을 조립하고, 오른쪽 상세·도구의 폭과 높이는 shell CSS가 소유한다.
  기존 `SidebarInset`을 재사용해 main landmark를 중복 생성하지 않는다.
- [x] 통합 테스트와 TypeScript를 통과시켰다. 실제 연결과 Activity 검증을 함께 검토하도록 B와 같은
  구현 커밋으로 묶는다.

### B. 실제 공고·기록 이동과 전체 폭

수정: canonical auctions `[auctionId]/_ui/decision-frame.tsx`, `decision-layout.css`,
`decision-screen.tsx`, `decision-screen-skeleton.tsx`, `decision-tools.tsx`,
`auction-roster-panel.tsx`, 해당 `decision-screen.test.tsx`, `auction-roster-panel.test.tsx`.
추가: 같은 `_ui/auction-workspace-dock.tsx`.
공유 패널의 테두리·높이 조정이 필요하면 `shared/ui/responsive-dock.tsx`에서 시각 variant로 제공한다.

- [x] 기존 테스트를 공통 host가 있는 harness로 확장한다. 기록 선택 후 명단은 frame 외부 host에 있고,
  중앙 공고 제목은 그대로이며 닫기 후 선택이 유지되는 것을 구현 전 실패로 확인한다.
- [x] 기존 `SelectedAttemptRail`의 조립 책임을 `AuctionWorkspaceDock`으로 옮긴다. 실제 명단 rendering과
  query는 `AuctionRosterPanel`에 남기고 복제하지 않는다. 상단 진입도 Header slot으로 옮긴다.
- [x] `DecisionFrame`의 `rail`·`toolbar`와 내부 aside를 제거하고 실제 화면과 skeleton을 함께 고친다.
  상위 root의 max-width·margin auto·외곽 수평 padding만 없앤다. 차트·표 내부 여백은 유지한다.
- [x] 우측 geometry CSS를 shell로 옮기고 route CSS에는 필터와 중앙 chart/history 배분만 남긴다.
  기존 차트 `autoSize`를 활용하고 패널 열림이나 폭 변경을 차트 key에 넣지 않는다.
- [x] UI 상태·명단·화면 테스트, TypeScript, scoped lint, `pnpm quality:check`,
  `pnpm lint:web-boundaries`, `git diff --check`를 통과시키고 커밋한다.

### C. 시안과 실제 화면의 완료 판정

- [x] 시안 A와 dev를 같은 viewport·왼쪽 접힘 상태·오른쪽 열림 상태·일반/집중 보기로 캡처한다.
  시안의 검토용 상단 바는 비교에서 제외하고 제품 헤더 아래 경계를 기준으로 정렬한다.
- [x] 1920×1080, 2560×1440에서 기본 화면이 가용 폭을 쓰는지 확인한다. 왼쪽 256px와 전역 메뉴
  64px가 열려 있으면 중앙은 각각 1600px·2240px이며 두 폭 모두 바깥 여백이 없다.
  공통 도구 줄의 오른쪽 경계가 스크롤바를 제외한 layout viewport 오른쪽과 1 CSS px 이내인지 확인한다.
- [x] 1440×1000, 1200×900, 1199×900, 1024×768, 375×812에서 가로 넘침이 없고,
  1199px 이하 오른쪽 너비 0과 공통 헤더 진입·Sheet Escape·초점 복귀를 확인한다.
- [x] 실제 공고 5270의 과거 회차 명단 6건·34건을 전환한다. 차트 인스턴스·보이는 시간/비율 범위와
  표 스크롤·선택을 확인한다. 폭이 달라지는 동안 캔버스 픽셀 일치는 요구하지 않는다. 같은 폭으로
  닫아 돌아왔을 때의 범위와 표시를 비교한다.
- [x] `/today`, `/dashboard/delivery`, `/dashboard/my`로 이동해 공통 배치와 원래 화면 폭·스크롤·메뉴를
  확인하고 전역 메뉴 유지와 공고 route의 낡은 맥락·명단 해제를 각각 확인한다.
  실제 not-found와 skeleton 테스트, Activity 숨김·복원에서 host의 수명주기를 확인했다.
- [x] 시안 대비 남은 차이를 `notice-dev-cohort-integration.md`에 적는다. 테스트 통과와 시안 일치를
  별도 결과로 보고한다. 실제 데이터 부족은 레이아웃 일치로 해결됐다고 주장하지 않는다.
- [ ] 결정적 검사 후 clean commit을 `pnpm review:ai -- --base b78a76c`으로 검토하고
  evidence와 대조한 결과를 남긴다. Linear handoff 후 lease를 해제한다.

## 이전 로컬 패널 구현 기록

아래는 b0424b0/b78a76c에서 확인한 범위다. 공통 셸 배치·전체 폭은 위 미완료 단위로 교정한다.

실행자는 `superpowers:executing-plans`에 따라 아래 검증 단위를 순서대로 수행한다.

**목표:** 기존 왼쪽 탐색을 유지하면서 좁은 화면에서는 오른쪽 줄을 제거하고 실제 공고·회차 기록에
상단에서 접근하며, 보조 공간을 닫아도 분석 맥락을 유지한다.

**구조:** 기존 `ApplicationShell`과 탐색 경로를 그대로 사용한다. shadcn Sheet 구현을 shared로
이동하고 레거시 import는 재수출해 하나의 구현만 유지한다. 공유 반응형 패널은 배치와 접근성만,
공고 route의 선택 provider는 회차 ID와 열린 보조 관점만 소유한다. API·DB 계약은 변경하지 않는다.

**기술:** 설치된 React, Base UI 기반 shadcn, Lightweight Charts, 현재 명단 Query Options.
**명세:** `screen-system.md`의 전역 셸 및 이번 사용자 승인. 제품 메뉴 확장 권위는 기존 roadmap이다.

## 제약

- 1200px 미만은 오른쪽 바로가기 줄 0px. 상단 진입과 Sheet로 기능에 접근한다.
- 1200px 이상은 얇은 도구 줄과 한 개의 선택 패널만 사용한다.
- 선택 회차와 패널 열림을 분리한다. 닫기는 선택 해제가 아니며 조회에서 제외된 회차만 해제한다.
- 현재 공고와 과거 기록을 동시에 같은 제목 아래 표시하지 않는다.
- 차트와 이력 표를 패널 상태의 key로 다시 만들지 않는다.
- 관심·최근 본·내 공고의 실제 목록은 canonical 계약 연결 후 노출한다. mock이나 레거시 marks를 이식하지 않는다.

## 실행 단위

### 1. 기획과 시안

- [x] `screen-system.md` §4에 왼쪽 유지·좁은 우측 제거·상단 진입·한 패널 정책을 기록한다.
- [x] 비교 시안의 `main.tsx`, `prototype.css`에 1200px 미만 상단 바로가기와 우측 숨김을 반영한다.
- [x] 375·1024·1199·1200px에서 줄의 실제 폭과 접근 경로를 확인한다.

### 2. 공유 패널

- [x] `components/ui/sheet.tsx`를 `shared/ui/sheet.tsx`로 옮겨 기존 경로에서 재수출한다.
- [x] `shared/lib/use-wide-workspace.ts`는 `(min-width: 1200px)` 구독 하나와 안정된 SSR snapshot을 제공한다.
- [x] `shared/ui/responsive-dock.tsx`는 `open`, `title`, `onClose`, `children`을 받아 넓은 화면의 inline
  패널과 좁은 화면의 Sheet를 조립한다. 기능별 데이터 조회를 소유하지 않는다.

### 3. 공고 정보와 회차 연결

- [x] `attempt-selection.tsx`에 선택 ID와 별도의 `panel: 'current' | 'record' | null`을 둔다.
  `select(id)`는 기록을 열고 `close()`는 ID를 유지한다. rows에서 사라진 ID는 이전처럼 무효화한다.
- [x] 상태 테스트에서 `select(id) → close → reopen` 후 동일 ID 유지와 조회 제외 후 복원되지 않음을 확인한다.
- [x] `decision-tools.tsx`는 상단 진입과 넓은 화면의 도구 줄을 소유한다. 실제 제공하는 항목만 노출한다.
- [x] `SelectedAttemptRail`이 공유 패널을 사용하고, 기존 `AuctionRosterPanel`과 `BidRail`을 재사용한다.
- [x] `DecisionFrame`과 CSS는 닫힘에 따른 본문 폭 회복, 좁은 화면의 도구 줄 제거를 반영한다.

### 4. 검증과 기록

- [x] 기존 공고 UI 테스트와 새 선택 상태 테스트, TypeScript, scoped lint, quality와 web boundary를 실행한다.
- [x] dev 실데이터에서 회차 5274/5271 선택, 현재 공고 전환, 닫기·재열기, 모바일 Escape를 확인한다.
- [x] 확대 차트·표 스크롤의 유지, 1199/1200px 전환, 375px 가로 넘침을 확인한다.
- [x] canonical AI advisory를 읽고 실제 근거와 대조한 결과를 작업 기록에 남긴다.

## 다음 데이터 단위

관심은 app의 사용자 작성 상태, 최근 본의 저장 범위·보존 기간은 별도 사용자 상태 계약으로 결정한다.
내 공고는 `Workspace × SupplierParty × AuctionAttempt` 관계로 조회한다. 세 항목의 인증·사업자 범위와
operation 계약을 먼저 만들고 같은 보조 패널에 연결한다. 이번 UI 배치 완료로 이 기능까지 완료했다고
보고하지 않는다.
