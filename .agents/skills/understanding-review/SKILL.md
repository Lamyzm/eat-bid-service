---
name: understanding-review
description: 큰 변경을 사람이 5분 안에 이해하게 만드는 검토. 전체 구조 → 변경 흐름 → 주요 결정 → 위험 순으로 그림 한 장(Whiteboard가 기본 — 꺼져 있으면 켠다. 켜지 못할 때만 Artifact의 Mermaid)을 만들고, 구현하지 않은 별도 reviewer가 그림·요구사항·코드·테스트가 서로 맞는지 검증한다. "understanding review 해줘", "이해 리뷰", "이 변경 그림으로 보여줘"에 쓴다. 사용자가 요청할 때만 돌린다.
---

# Understanding Review

기준은 "코드가 몇 줄인가"가 아니라 **"사장님이 5분 안에 이 변경을 이해할 수 있는가"**다. onnuri-attendance 저장소의 같은
이름 절차를 eatbid 경로로 옮겼다(2026-11-17, #218).

## 언제

- 사용자가 요청할 때만. 요청이 오면 그 변경이 리뷰([`REVIEW.md`](../../../REVIEW.md))를 끝낸 커밋에 고정해 그린다.
- 하지 않음: 파일 하나의 명확한 버그, 문구·스타일만 바꾼 UI. 그때는 요약 + 검증만.

## 어디에 그리나

- **그림은 Whiteboard가 기본이다.** 먼저 `whiteboard_status`를 본다. `desktopAvailable`이 false면 켜고 다시 확인한다.
  켠 뒤 `session_get_instructions`를 읽고 그 흐름을 따른다(저장소 등록 → 범위 커밋에 고정한 세션 → diff → 무엇·왜 → 설계 →
  구현). 이 skill의 순서(구조 → 흐름 → 결정 → 위험)는 그 안의 절 이름으로 옮긴다.
- Artifact(Mermaid 한 페이지)는 **켜기를 시도했는데도 실패했을 때만** 쓴다. 쓰면 사용자에게 까닭을 먼저 말한다. 같은 파일
  경로로 다시 게시해 링크를 유지한다.
- 그림 링크(또는 `Whiteboard "<세션 이름>" (<세션 id>)`)는 그 변경의 pull request 본문이나 GitHub issue 댓글에 한 줄로 남긴다.
  eatbid는 공개 저장소라 그림에 운영 화면 캡처·사업자 정보·비밀을 넣지 않는다.

## 1. 범위 정하기

- 검토할 커밋 범위를 정한다(보통 `origin/main..HEAD`). 그림은 **범위 끝 커밋에 고정**한다.
- 그리는 동안 고침이 더 들어오면 새 끝 커밋으로 다시 고정하고, 바뀐 칸을 고치고, reviewer에게 그 커밋으로 다시 대조하게 한다.
  **push할 커밋에서 `MATCHES`가 나온 그림만** 남긴다.
- `git log --oneline <범위>`, `git diff --stat <범위>`로 바뀐 파일을 모은다. **읽지 않은 코드는 그리지 않는다.**
- 요구사항 원문(GitHub issue·사용자 메시지·plan·ADR)을 찾아 둔다.

## 2. 그림 만들기 (MAP)

1. **전체 구조** — 이번 변경이 속한 층: Web 화면 → API operation(`packages/contracts`) → Nest server 모듈 → 도메인 → DB
   (`core`·`app`·`mart`) 또는 dataplane(수집 → raw R2 → 파싱 → 발행) → 화면 반영.
2. **변경 흐름** — 사용자 입력이나 예약 실행부터 결과까지, 바뀐 경로만 굵게. 전후 비교가 필요하면 두 그림.
3. **주요 결정** — DECISION / WHY / ALTERNATIVES / TRADEOFF / RISK 표. DB·권한·동시성·캐시·재처리·마이그레이션은 빠짐없이.
4. **위험 부분** — 깨지면 무엇이 잘못되는지, 어디를 먼저 볼지(REVIEW FIRST 1~3개).

규칙
- 그림의 모든 칸에 `파일:함수`를 단다. 확인 못 한 것은 점선 + "확인 안 함".
- 사람 말로 쓴다(해요체). 기술 이름은 칸 아래 작게.

## 3. 별도 reviewer로 검증 (VERIFY)

구현한 에이전트가 아닌 **새 subagent**를 띄운다(name 없이 — 이름 붙인 subagent는 보고가 돌아오지 않는다). 구현자의 설명을
믿지 말고 코드를 직접 읽게 한다. 넘길 것: 범위, 요구사항, 그림, 테스트 결과.

reviewer가 대조할 것

```
요구사항 ↔ 구현 ↔ 그림 ↔ 테스트
```

찾을 것: 요구엔 있는데 없는 기능 · 구현됐는데 설명 안 된 동작 · 그림과 코드 불일치 · 죽은 코드 · 불필요한 추상화 · 중복 로직 ·
회귀 가능성 · 테스트 안 된 중요한 경로. 새 도우미는 [`reuse-review`](../reuse-review/SKILL.md)의 찾을 것과 견준다.
결과 끝줄에 `MATCHES` 또는 `MISMATCHES`를 둔다.

`MISMATCHES`의 까닭이 그림이 아니라 **코드 결함**이면 그림을 코드에 맞춰 덮지 않는다. 코드를 먼저 고쳐 다시 리뷰를 받고,
그 커밋으로 다시 고정해 대조한다.

## 4. 사장님께 보고

그림 링크와 함께 7항목으로 짧게:

WHAT CHANGED · SYSTEM IMPACT · FLOW · AI DECISIONS · RISKS · VERIFICATION · REVIEW FIRST

reviewer가 불일치를 찾았으면 숨기지 않고 먼저 말한다. 고친 뒤 그림을 다시 게시한다.
