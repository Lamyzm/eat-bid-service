---
name: understanding-review
description: 큰 변경을 사람이 5분 안에 이해하게 만드는 검토. 전체 구조 → 변경 흐름 → 주요 결정 → 위험 순으로 그림 한 장(Whiteboard 가 기본 — 꺼져 있으면 켠다. 켜지 못할 때만 Artifact 의 Mermaid)을 만들고, 구현하지 않은 별도 reviewer 가 그림·요구사항·코드·테스트가 서로 맞는지 검증한다. "understanding review 해줘", "이해 리뷰", "이 변경 그림으로 보여줘" 에 쓴다. 주인이 요청할 때만 돌린다(2026-10-01 — 자동으로 돌리지 않는다).
---

# Understanding Review

규약 전문은 `docs/ai-protocol.md`. 이 skill 은 그중 **MAP → AUDIT → VERIFY** 를 한 번에 돌리는 절차다.
기준은 "코드가 몇 줄인가" 가 아니라 **"사장님이 5분 안에 이 변경을 이해할 수 있는가"** 다.

## 언제

- 주인이 요청할 때만(2026-10-01 주인 결정 — 전에는 큰 변경마다 자동이었다). 요청이 오면 그 변경이 리뷰 루프(`docs/architecture/code-review-loop.md`)를 끝낸 커밋에 고정해 그린다. 그림을 그리는 동안 마지막 리뷰와 나란히 돌려도 된다(고정은 push 할 커밋).
- 릴리스 범위 그림도 주인이 요청할 때만. `/release` 4-1 은 이 skill 을 부르지 않고 이미 있는 그림 링크와 변경 기록 요약을 모은다. 요청이 오면 범위는 지난 `v` 태그..릴리스 브랜치, 이미 만든 그림은 링크로 모으고 첫 칸은 "이번 릴리스로 사용자에게 달라지는 것" 세 줄.
- 하지 않음: 파일 하나의 명확한 버그, 문구·스타일만 바꾼 UI. 그때는 요약 + 검증만.

## 어디에 그리나

- **그림은 Whiteboard 가 기본이다(주인 결정, 2026-09-28).** 먼저 `whiteboard_status` 를 본다.
  - `desktopAvailable` 이 false 면 **켠다**: `whiteboard app launch`(PATH 에 없으면 `%LOCALAPPDATA%\Programs\Review\bin\whiteboard.cmd app launch`, Windows 샌드박스가 막으면 샌드박스 밖에서). 그다음 `whiteboard_status` 를 다시 보고 `desktopAvailable: true` 를 확인한다.
  - 켠 뒤 `session_get_instructions` 를 읽고 그 흐름을 따른다(저장소 등록 → 범위 커밋에 고정한 세션 → diff → 무엇·왜 → 설계 → 구현). 이 skill 의 순서(구조 → 흐름 → 결정 → 위험)는 그 안의 절 이름으로 옮긴다.
- Artifact(Mermaid 한 페이지)는 **켜기를 시도했는데도 실패했을 때만** 쓴다. 쓰면 사용자에게 "Whiteboard 를 켜지 못해 Artifact 로 만들었다(까닭: …)" 를 먼저 말하고, 변경 기록의 줄에도 까닭을 적는다. Desktop 이 꺼져 있다는 것만으로 Artifact 로 넘어가지 않는다. 같은 파일 경로로 다시 게시해 링크를 유지한다.
- 하위 에이전트에게 그림을 맡길 때도 이 절을 그대로 따르게 한다(브리프에 "Whiteboard 기본, 꺼져 있으면 켠다" 를 적는다).
- 어느 쪽이든 `docs/architecture/changes/<그 변경>.md` 끝에 `이해 그림: <링크 또는 Whiteboard 세션 이름>` 한 줄을 넣는다(Whiteboard 면 `이해 그림: Whiteboard "<세션 이름>" (<세션 id>)` — 하위 에이전트에게 이 줄을 그대로 돌려 달라고 한다) — 릴리스 때 모으는 근거이고, 이 줄이 없으면 master push 를 훅(`.githooks/pre-push`)이 막는다. 그림이 필요 없던 변경은 `이해 그림: 없음 — <까닭>`.

## 1. 범위 정하기

- 검토할 커밋 범위를 정한다(보통 `origin/master..HEAD`, 또는 사용자가 말한 기능). 그림은 **범위 끝 커밋에 고정** 한다(`base..<sha>`).
- 그림을 그리는 동안 검토 지적 고침이 더 들어오면 범위가 움직인 것이다. 새 끝 커밋으로 다시 고정하고, 바뀐 칸을 고치고, reviewer 에게 그 커밋으로 다시 대조하게 한다. **push 할 커밋에서 `MATCHES` 가 나온 그림만** 변경 기록에 적는다 — 옛 커밋의 MATCHES 는 새 커밋의 근거가 아니다.
- `git log --oneline <범위>`, `git diff --stat <범위>` 로 바뀐 파일을 모은다. **읽지 않은 코드는 그리지 않는다.**
- 요구사항 원문(사용자 메시지·spec·plan·`docs/architecture/changes/*`)을 찾아 둔다.

## 2. 그림 만들기 (MAP)

Whiteboard 에 만든다(꺼져 있으면 위 "어디에 그리나" 대로 켠다). Artifact 는 켜기가 실패했을 때만. 순서는 고정한다.

1. **전체 구조** — 이번 변경이 속한 층: 화면(page/Client) → 전송(Server Action/Route Handler) → 인증·권한 → 로직 → DB(표·정책·RPC) → 무효화 → 화면 반영.
2. **변경 흐름** — 사용자 입력부터 결과까지, 바뀐 경로만 굵게. 전후 비교가 필요하면 두 그림.
3. **주요 결정** — AUDIT 표: DECISION / WHY / ALTERNATIVES / TRADEOFF / RISK. DB·권한·동시성·캐시·보안·마이그레이션은 빠짐없이.
4. **위험 부분** — 깨지면 무엇이 잘못되는지, 어디를 먼저 볼지(REVIEW FIRST 1~3개).

규칙
- 그림의 모든 칸에 `파일:함수` 를 단다. 확인 못 한 것은 점선 + "확인 안 함".
- 사람 말로 쓴다(해요체). 기술 이름은 칸 아래 작게.
- 개인정보·비밀값·운영 화면 캡처를 넣지 않는다.

## 3. 별도 reviewer 로 검증 (VERIFY)

**검수를 두 번 돌리지 않는다.** 이 변경의 리뷰 루프가 끝나 조정자가 READY TO PUSH 를 냈으면(기록: `.superpowers/sdd/*-review.md`·`리뷰 루프:` 줄) 그 결과를 재사용하고, 새 reviewer 에게는 **그림 ↔ 코드 일치와 설명 안 된 동작만** 맡긴다. 검수가 없었으면 아래 전체를 맡긴다.

구현한 에이전트가 아닌 **새 subagent** 를 띄운다. 구현자의 설명을 믿지 말고 코드를 직접 읽게 한다. 넘길 것: 범위, 요구사항, 그림(파일 경로), 테스트 결과.

reviewer 가 대조할 것

```
요구사항 ↔ 구현 ↔ 그림 ↔ 테스트
```

찾을 것: 요구엔 있는데 없는 기능 · 구현됐는데 설명 안 된 동작 · 그림과 코드 불일치 · 죽은 코드 · 불필요한 추상화 · 중복 로직 · 회귀 가능성 · 테스트 안 된 중요한 경로.
새 도우미는 `docs/reuse-catalog.md` 와 견준다 — 목록에 있는 것(es-toolkit·es-hangul·우리 공용 모듈)을 손으로 다시 짰으면 **SHOULD-FIX** 로 적는다.
결과는 `.superpowers/sdd/understanding-<주제>.md` 에 쓰고 끝줄에 `MATCHES` 또는 `MISMATCHES` 를 둔다.

`MISMATCHES` 의 까닭이 그림이 아니라 **코드 결함** 이면(예: 버튼이 제 주석과 반대로 보인다) 그림을 코드에 맞춰 덮지 않는다. 코드를 먼저 고쳐 독립 검토를 받고, 그 커밋으로 다시 고정해 대조한다.

## 4. 사장님께 보고

그림 링크와 함께 7항목으로 짧게:

WHAT CHANGED · SYSTEM IMPACT · FLOW · AI DECISIONS · RISKS · VERIFICATION · REVIEW FIRST

reviewer 가 불일치를 찾았으면 숨기지 않고 먼저 말한다. 고친 뒤 그림을 다시 게시한다(Whiteboard 는 같은 세션을 고치고, Artifact 였다면 같은 경로로 재게시해 링크를 유지).
