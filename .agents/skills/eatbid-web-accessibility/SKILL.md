---
name: eatbid-web-accessibility
description: Eatbid Web에 누르는 것·폼·표·모달·숨김 처리를 만들거나 고칠 때 사용한다. 의미 요소 선택, 접근 가능한 이름과 역할·상태, 폼 연결, 표 머리글, 초점 이동, 숨김의 세 종류를 다룬다.
---

# Eatbid Web 접근성

이 앱은 여러 사람이 매일 쓰는 입찰 업무 도구다. 표와 차트와 모달과 명령 팔레트가 있고 마감은 몇 시간 뒤다.
접근성은 여기서 배려가 아니라 **화면이 말하는 것과 브라우저가 아는 것이 같은가**의 문제다. 둘이 어긋나면
키보드 사용자만 막히는 게 아니라 e2e의 `getByRole` 질의도, 화면 낭독기도, 다음 사람이 읽는 코드도 함께 어긋난다.

아래는 새로 만든 규칙이 아니라 이 저장소가 이미 지키고 있는 형태를 성문화한 것이다. 각 항목은 저장소의
실제 코드를 가리킨다. 어긋난 자리도 함께 적었다.

## 0. 무엇이 이 문서 밖인가

겹치는 문장을 쓰지 않는다. 아래는 각각 소유자가 있다.

| 주제 | 소유자 |
| --- | --- |
| 색 대비, 색 이외의 텍스트, 논리적 focus order 목표 | `docs/product/screen-system.md` §11, `apps/web/AGENTS.md` |
| 화면 문구 자체와 상태 표현 | `apps/web/AGENTS.md` |
| `shared/ui` primitive가 소유하는 범위 | `docs/architecture/frontend-application-foundation.md` §5 |
| 컴포넌트 분리·상태 union·client 경계 | `eatbid-component-design` skill |
| 파일 크기 | AGENTS 18 |
| 모듈 경계와 import 방향 | ADR 0023 |

## 1. 보이는 모습이 곧 실제 의미다

**주소가 바뀌면 `a`, 이 화면의 상태가 바뀌면 `button`이다.** 겉모습은 그다음이다. `div`에 `onClick`을 달고
버튼처럼 칠하지 않는다.

저장소는 이미 이렇게 한다. 오늘 표의 "열기"와 지역·품목 셀은 `<Link>`이고(`open-auction-table.tsx`),
조건 칩도 링크다(`today-filters.tsx`의 `Chip`). 참여 기록 열람은 이 화면의 오른쪽 패널을 여는 일이라
`Button`이다(`history-selection.tsx`의 `HistoryRecordButton`).

**모습과 의미가 갈릴 때는 primitive의 `render`로 합성한다.** 버튼처럼 보여야 하지만 실제로는 이동인 크게
보기 링크는 `Button`에 `nativeButton={false}`와 `render={<Link/>}`를 준다(`expand/decision-expand-link.tsx`).
조건 메뉴의 항목도 같은 방식이다(`condition-menu.tsx`의 `DropdownMenuLinkItem render={<Link/>}`).

**클릭을 가로채더라도 `href`는 남긴다.** 근거 탭은 서버 왕복 없이 바뀌지만 진짜 `href`를 두고 평범한 왼쪽
클릭만 가로챈다(`evidence-view.tsx`의 `EvidenceViewTabs`). 그래야 새 탭 열기와 주소 공유가 그대로 산다.

## 2. 이름·역할·상태

**아이콘이나 기호만 있는 조작에는 접근 가능한 이름을 준다.** 두 가지 방법이 있고 둘 다 쓴다. 이름을 눈에도
보이지 않게 둘 때는 `sr-only` 텍스트(`shell/theme/theme-mode-toggle.tsx`의 "명암 모드 전환"), 짧은 라벨로
충분할 때는 `aria-label`(`shared/ui/responsive-dock.tsx`의 "보조 패널 닫기", `flow-chart.tsx`의 "비율 축 확대").

**상태는 클래스 이름이 아니라 ARIA로 말한다.**

| 상태 | 속성 | 저장소 |
| --- | --- | --- |
| 켜고 끄는 토글 | `aria-pressed` | `flow-legend.tsx`의 계열 토글 |
| 무언가를 여는 조작 | `aria-expanded` | `decision-tools.tsx`(전역 도크를 여는 버튼들) |
| 그 자리에서 펼치는 조작 | `aria-expanded` + `aria-controls` | `rehearsal-panel.tsx`(바로 아래 상세를 가리킨다) |
| 지금 고른 것 | `aria-current` | `today-filters.tsx`(칩), `evidence-view.tsx`(`'page'`), `order-book.tsx`(내 값 행), `condition-menu.tsx` |

**`aria-label`은 역할이 있는 요소에만 붙는다.** 맨 `div`·`span`은 role이 generic이라 이름이 무시된다.
이름이 필요하면 `section`·`nav`·`figure`·`table`처럼 역할이 있는 요소로 감싼다. 저장소가 제대로 하는 자리는
`today-frame.tsx`·`decision-frame.tsx`의 `<section aria-label>`, `decision-tools.tsx`의 `<nav aria-label>`,
`flow-chart.tsx:89`의 `<figure aria-label>`이다.

**어긋난 자리.** `decision-filters.tsx:30`, `flow-chart.tsx:100`(차트 캔버스 `div`),
`auction-roster-panel.tsx:157`(철회 여부 `span`)은 역할 없는 요소에 `aria-label`을 걸어 이름이 사라진다.
그리고 회차 표의 선택 행은 `data-selected`만 갖는데(`history-selection.tsx`), 같은 "지금 이 행"을
호가창은 `aria-current`로도 말한다(`order-book.tsx`). 같은 뜻을 두 화면이 다르게 말하고 있다.

## 3. 폼

**모든 입력에 연결된 라벨을 둔다.** id는 `useId`로 만들고 `htmlFor`로 잇는다
(`app/(auth)/setup/_ui/business-location-form.tsx`). 한 화면에 하나뿐이라 고정 id가 안전한 자리는 리터럴을
써도 된다(`my-rate-input.tsx`의 `my-rate`).

**placeholder는 라벨이 아니다.** 채워 넣는 순간 사라지므로 이름을 담을 수 없다. `bid-rail.tsx`의 주석이
같은 이유로 예시 숫자도 거부한다 — 예시 값은 추천값으로 읽힌다(AGENTS 8).

**보조 설명과 오류는 입력에 프로그램적으로 잇는다.** `aria-describedby`로 잇고, 오류일 때만 그 요소를
`role='alert'`로 올린다. `business-location-form.tsx`는 도움말과 실패 문구가 **같은 `<p>` 하나**라 설명이
자리를 옮기지 않는다. 값 자체가 형식에 안 맞으면 `aria-invalid`를 함께 준다(`my-rate-input.tsx`). 색만으로
오류를 말하지 않는다.

**진행 중은 비활성이 아니라 상태다.** `LoadingButton`은 `aria-busy`를 걸고 `role='status' aria-live='polite'`
sr-only 문장으로 진행을 읽어 준다(`shared/ui/loading-button.tsx`). 새로 만드는 pending 버튼은 이것을 쓴다.

**어긋난 자리.** `bid-rail.tsx`의 투찰률 입력은 `<label htmlFor='bid-rate'>`와 `aria-label='투찰률'`을 함께
갖는데 `aria-label`이 이기므로 라벨의 "눌러서 직접 입력"이 이름에서 사라진다. 이름은 한 곳에서만 만든다.

## 4. 표

**머리글에 `scope`를 준다.** 열 머리글은 `scope='col'`, 행 머리글은 `scope='row'`다
(`open-auction-table.tsx`, `order-book.tsx`).

**표의 목적을 말한다.** `<caption>`이거나 감싸는 section의 `aria-label`이다. 호가창은 캡션으로
모집단과 세는 대상을 말하고(`order-book.tsx`), 오늘 표와 과거 회차 표는 각각
`<section aria-label='열린 공고'>`·`<section aria-label='과거 회차'>` 안에 산다.

**열 이름을 `sr-only`로 숨기지 않는다.** `position: absolute`가 `thead`를 표 상자 밖으로 빼내 `scope` 연결이
끊긴다. 시각적으로 낮추고 싶으면 표 흐름 안에 둔 채 글자 크기와 색만 낮춘다 — 이유는 `order-book.tsx`의
주석에 이미 적혀 있다.

**어긋난 자리.** `open-auction-table.tsx`의 마지막 `open` 열은 머리글이 빈 문자열이라 행동 열에 이름이 없다.
`scope='col'`만 있고 읽을 것이 없는 `th`다.

## 5. 모달과 초점

**초점 가둠·복귀·Esc는 primitive가 소유한다.** Base UI `Dialog`(`expand/expand-dialog.tsx`)와
`Sheet`(`shared/ui/responsive-dock.tsx`)를 쓰고 직접 만들지 않는다. 뒤 배경을 초점 순서에서 빼는 일도
primitive의 몫이다 — 배경에 `aria-hidden`을 직접 걸지 않는다.

**우리가 소유하는 것은 "어디로 돌아가는가"다.** 여는 쪽이 누른 요소를 기억하고 닫을 때 그리로 돌려준다.
`attempt-selection.tsx`가 `trigger`·`returnFocus`·`setReturnFocus`를 갖고, `responsive-dock.tsx`가
`finalFocus={returnFocus}`로 Sheet에 넘기며, 여러 자리에서 같은 패널을 여는 `decision-tools.tsx`는
누른 버튼을 `setReturnFocus`로 등록한다. 열림 상태가 주소에 있으면 닫기는 그 param을 지운 주소로
`replace`한다(`expand-dialog.tsx`) — `push`하면 뒤로 가기가 모달을 다시 연다.

**모달이 아닌 확대에도 Esc를 준다.** 다만 이미 소비된 Esc를 두 번 처리하지 않는다.
`expand/decision-expand-link.tsx`는 `event.defaultPrevented`와 `event.isComposing`을 확인한다. 앞은 Base UI
메뉴·Sheet가 먼저 닫힌 경우이고, 뒤는 한글 조합 중의 Esc다.

**넓은 화면의 도크는 모달이 아니다.** `responsive-dock.tsx`는 좁으면 Sheet, 넓으면 그냥 `<section hidden>`이다.
넓은 자리는 초점을 가두지 않고 본문과 나란히 읽힌다. 이 구분을 없애고 항상 모달로 만들지 않는다.

## 6. 숨김의 세 종류를 섞지 않는다

| 방법 | 눈 | 접근성 트리 | 쓰는 자리 | 저장소 |
| --- | --- | --- | --- | --- |
| `sr-only` | 없음 | 있음 | 눈으로는 자명하지만 이름이 필요한 것 | `today-filters.tsx`의 "지역 조건 해제", `application-shell.tsx`의 건너뛰기 링크 |
| `hidden` | 없음 | 없음 | 지금 이 화면이 아닌 것 | `evidence-view.tsx`의 꺼진 근거 본문, `responsive-dock.tsx` |
| `aria-hidden` | 있음 | 없음 | 그리기 방식일 뿐 내용이 아닌 것 | `order-book.tsx`의 막대, `condition-menu.tsx`의 `▾`, `skeleton.tsx` |

**셋을 같은 요소에 겹치지 않는다.** `sr-only`와 `aria-hidden`을 함께 걸면 아무도 그것을 못 읽는다.

**`aria-hidden`을 초점 가능한 요소에 걸지 않는다.** 눈에 보이는데 이름이 없는 초점 대상이 생긴다.

**`hidden`에 배치 utility를 함께 걸지 않는다.** `display` utility가 `[hidden]`보다 뒤 layer라 숨김이 지고
두 벌이 겹쳐 보인다(`evidence-view.tsx`의 `EvidenceViewPanel` 주석).

**DOM에서 지울지 `hidden`으로 둘지는 비용이 정한다.** 다시 그리는 데 새 조회가 필요하면 `hidden`으로 두고
(근거 본문 두 벌), 접힌 동안 남으면 안 되는 파생 숫자가 있으면 지운다(`rehearsal-panel.tsx`).

## 7. 검사가 보는 것과 못 보는 것

기계 검사는 `apps/web/.oxlintrc.json`의 `jsx-a11y` plugin이다. 위 항목이 가리키는 규칙은 그 파일에
severity를 명시해 못 박혀 있으므로 oxlint의 category 재편에 조용히 사라지지 않는다. 별도 도구를 들이지 않는다.

`prefer-tag-over-role`은 끈 채로 둔다. 이 규칙은 `role='status'`에 `<output>`을, `role='region'`에
`<section>`을 요구하는데 `<output>`은 폼 계산 결과의 요소이고 이름 없는 `<section>`은 region이 되지 않는다.
저장소의 16곳이 이 요구와 어긋나며 전부 지금 형태가 맞다.

**lint가 못 보는 다섯 가지는 사람이 리뷰에서 본다.** 역할 없는 요소의 `aria-label`(항목 2), 읽을 것이 없는
`th`(항목 4), 초점 복귀와 Esc(항목 5), 숨김의 종류 선택(항목 6), 그리고 이름이 실제로 사용자가 아는 말인지.

e2e가 두 번째 그물이다. `e2e/*.spec.ts`가 화면을 `getByRole('button'|'link'|'region'|'dialog', { name })`으로
찾으므로 접근 가능한 이름이 사라지면 시나리오가 먼저 깨진다. 새 상호작용을 만들 때 selector를
`data-*`로 잡지 말고 role과 이름으로 잡는 이유가 이것이다.

## 출처

WAI-ARIA Authoring Practices(이름·역할·상태, dialog의 초점 계약), HTML 표준의 `hidden`과 접근성 트리,
`eslint-plugin-jsx-a11y` 규칙 목록과 oxlint의 `jsx-a11y` 구현, 그리고 이 저장소의 EAT-39·EAT-82·EAT-115·EAT-139에서
내린 판정.
