# 오른쪽 보조 공간의 최소 구현 계획

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
- [ ] canonical AI advisory를 읽고 실제 근거와 대조한 결과를 작업 기록에 남긴다.

## 다음 데이터 단위

관심은 app의 사용자 작성 상태, 최근 본의 저장 범위·보존 기간은 별도 사용자 상태 계약으로 결정한다.
내 공고는 `Workspace × SupplierParty × AuctionAttempt` 관계로 조회한다. 세 항목의 인증·사업자 범위와
operation 계약을 먼저 만들고 같은 보조 패널에 연결한다. 이번 UI 배치 완료로 이 기능까지 완료했다고
보고하지 않는다.
