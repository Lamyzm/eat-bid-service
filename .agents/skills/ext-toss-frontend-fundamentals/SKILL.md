---
name: ext-toss-frontend-fundamentals
description: 토스 Frontend Fundamentals(코드 품질) 원문 고정본 — 네 기준(가독성·예측 가능성·응집도·결합도)과 예시 17개의 개선 전/후 코드, 토스 공식 플러그인의 기준 스킬 넷. 화면 코드(컴포넌트·훅)를 짜거나 리뷰·리팩터링할 때, "토스처럼" 을 판정할 때 읽는다. 우리 AGENTS·ADR·REVIEW.md 가 먼저다.
---

# ext-toss-frontend-fundamentals — 외부 원문 (토스)

출처: github.com/toss/frontend-fundamentals @161d3d6a(2026-03-08, main 과 같음 — 2026-10-02 확인), MIT([LICENSE.md](LICENSE.md), Copyright (c) 2024 Viva Republica, Inc). 들인 날 2026-10-02.
- `references/overview/four-criteria.md` — `fundamentals/code-quality/code/index.md`(네 기준과 전략 목록)
- `references/examples/*.md` — `fundamentals/code-quality/code/examples/` 17개 **그대로**(개선 전 코드 · 코드 냄새 · 개선 후 코드). 그림(`../../images/...`)은 들이지 않았다 — 글이 같은 것을 말한다.
- `references/criteria/*.md` — 토스 공식 Claude 플러그인 `frontend-fundamentals-plugin/skills/{readability,predictability,cohesion,coupling}/SKILL.md` 그대로(요약판 — 예시가 사이트보다 적다)
- `references/plugin/reviewer-agent.md` — 같은 플러그인의 리뷰어 에이전트 그대로. 꼴의 참고다: **판정 전에 기준을 반드시 먼저 읽는다**, Critical/Warnings/Suggestions, 고침 → 다시 리뷰를 Critical 이 없을 때까지. 우리는 이 에이전트를 그대로 띄우지 않고 `REVIEW.md` 와 `refactor-loop` 의 리뷰어가 같은 꼴로 한다(모델·`git diff main...HEAD` 가 우리와 다르다).

편집하지 않고 들였다. 새 판은 같은 방법으로 다시 들인다(`gh api repos/toss/frontend-fundamentals/contents/<경로>?ref=<sha>`).

## 쓰는 법

1. 판정할 냄새에 맞는 예시를 **원문으로** 연다(아래 표). "토스처럼 읽히나" 는 기억이 아니라 그 예시의 개선 코드(대개 "✏️ 개선해보기" 절 — FF-C3 `form-fields.md` 처럼 그 절 없이 두 꼴을 견주는 예시도 있다)와 견준다.
2. 우리 해석·반례·우리 꼴은 [FF 카드](../../../docs/references/frontend-fundamentals.md)와 [lens](../refactor-loop/references/lens.md)에 있다 — 원문이 예시로 든 꼴도 우리 코드에 그대로 맞지 않을 수 있다(카드의 반례/비용). FF 의 권위만으로 고칠 필요를 입증하지 않는다.
3. 근거는 `FF-R1`(토스 예시 "같이 실행되지 않는 코드 분리하기", `references/examples/submit-button.md`)처럼 단다.

## 예시 17개 — 카드 ID · 원문

| 카드 | 토스 예시 | 원문 |
| --- | --- | --- |
| FF-R1 | 같이 실행되지 않는 코드 분리하기 | [submit-button.md](references/examples/submit-button.md) |
| FF-R2 | 구현 상세 추상화하기 | [login-start-page.md](references/examples/login-start-page.md) |
| FF-R3 | 로직 종류에 따라 합쳐진 함수 쪼개기 | [use-page-state-readability.md](references/examples/use-page-state-readability.md) |
| FF-R4 | 복잡한 조건에 이름 붙이기 | [condition-name.md](references/examples/condition-name.md) |
| FF-R5 | 매직 넘버에 이름 붙이기 | [magic-number-readability.md](references/examples/magic-number-readability.md) |
| FF-R6 | 삼항 연산자 단순하게 하기 | [ternary-operator.md](references/examples/ternary-operator.md) |
| FF-R7 | 시점 이동 줄이기 | [user-policy.md](references/examples/user-policy.md) |
| FF-R8 | 왼쪽에서 오른쪽으로 읽히게 하기 | [comparison-order.md](references/examples/comparison-order.md) |
| FF-P1 | 이름 겹치지 않게 관리하기 | [http.md](references/examples/http.md) |
| FF-P2 | 같은 종류의 함수는 반환 타입 통일하기 | [use-user.md](references/examples/use-user.md) |
| FF-P3 | 숨은 로직 드러내기 | [hidden-logic.md](references/examples/hidden-logic.md) |
| FF-C1 | 함께 수정되는 파일을 같은 디렉토리에 두기 | [code-directory.md](references/examples/code-directory.md) |
| FF-C2 | 매직 넘버 없애기 | [magic-number-cohesion.md](references/examples/magic-number-cohesion.md) |
| FF-C3 | 폼의 응집도 생각하기 | [form-fields.md](references/examples/form-fields.md) |
| FF-K1 | 책임을 하나씩 관리하기 | [use-page-state-coupling.md](references/examples/use-page-state-coupling.md) |
| FF-K2 | 중복 코드 허용하기 | [use-bottom-sheet.md](references/examples/use-bottom-sheet.md) |
| FF-K3 | Props Drilling 지우기 | [item-edit-modal.md](references/examples/item-edit-modal.md) |

네 기준의 정의와 기준 사이의 상충(한 기준을 올리면 다른 기준이 내려갈 수 있다)은 [four-criteria.md](references/overview/four-criteria.md).
