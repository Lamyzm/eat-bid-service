# 아키텍처 문서 운영

이 디렉터리는 eatbid의 목표 구조를 설명한다. 루트 [`AGENTS.md`](../../AGENTS.md)는
지켜야 할 규칙, [`ARCHITECTURE.md`](../../ARCHITECTURE.md)는 진입점, 이 디렉터리는 그
결정을 구현 가능한 수준으로 풀어쓴 설계다.

## 문서별 책임

| 문서 | 답하는 질문 |
|---|---|
| [product-and-quality.md](product-and-quality.md) | 무엇을 만들며, 성공과 실패를 어떻게 판단하는가? |
| [domain-and-data.md](domain-and-data.md) | 어떤 사실을 어떤 단위와 식별자로 저장하는가? |
| [c4.md](c4.md) | 사람·외부 시스템·컨테이너·컴포넌트 경계는 무엇인가? |
| [runtime-and-deployment.md](runtime-and-deployment.md) | 수집·재처리·배포·복구는 어떻게 흐르는가? |
| [arc42.md](arc42.md) | 전체 설계를 한 문맥에서 어떻게 설명하는가? |
| [legacy-disposition.md](legacy-disposition.md) | 무엇을 보존하고 무엇을 폐기하는가? |
| [backend-application-foundation.md](backend-application-foundation.md) | Nest·Effect·HTTP·DB application boundary를 어떻게 책임 분리하는가? |
| [glossary.md](glossary.md) | 같은 단어를 같은 의미로 쓰고 있는가? |
| [stack/README.md](stack/README.md) | 현재 기술 기준과 production 전 게이트는 무엇인가? |

## 문서 우선순위

충돌 시 우선순위는 다음과 같다.

1. 최신 Accepted ADR
2. 루트 `AGENTS.md`의 불변 규칙
3. 이 디렉터리의 목표 설계
4. 기존 `docs/SPEC-*`, `docs/ARCH-*`와 코드에서 추론한 현행 구조

Accepted ADR끼리 충돌하면 번호가 큰 문서가 자동 승리하지 않는다. 새 ADR이 기존 ADR을
`Supersedes`로 명시해야 한다.

## 변경 규율

- 코드 변경이 경계를 바꾸면 같은 변경에서 관련 문서와 ADR을 갱신한다.
- 계획과 현재 상태를 목표 아키텍처 문장에 섞지 않는다. 구현 현황은 별도 체크리스트로 관리한다.
- 미결정은 `TBD`로 숨기지 말고 ADR의 `Proposed` 상태나 위험 항목으로 기록한다.
- Mermaid 다이어그램은 설명을 보조한다. 엔터티와 경계의 정확한 의미는 표와 본문이 기준이다.
