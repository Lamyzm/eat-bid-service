---
name: senior-engineer-mindset
description: 코드를 쓰기 전에 시니어·프린시펄·디스팅귀시드/펠로우·경영진(CTO/VP-Eng) 수준으로 생각할 때 어떤 사고 규율을 적용할지 고르고 연결해 주는 라우터다. 기능을 만들거나, 라이브러리·프레임워크·DB를 고르거나, API·데이터 모델을 설계하거나, 원인이 분명치 않은 버그를 고치거나, 리팩터링할 때 먼저 사용한다. 한 줄짜리 수정, 명백한 프로토타입, 이미 완전히 정해진 계획을 그대로 타이핑하는 경우에는 건너뛴다.
---

# 시니어 + 프린시펄 + 디스팅귀시드 + 경영진 엔지니어 사고 (라우터)

주니어와 시니어의 차이는 "코드를 얼마나 잘 쓰는가"가 아니라 **쓰기 전에 무엇을 생각하는가**다.
LLM은 코드를 유창하게 생성하기 때문에 이 단계를 건너뛰기가 특히 쉽다 — 처음 떠오른 그럴듯한
아이디어가 곧바로 코드가 된다.

네 관점을 쌓아서 본다. 대부분 첫 번째만 필요하고, 판이 커지면 위 관점이 필요해진다.

- **시니어**: 이 코드베이스에서 이 변경이 올바르고 범위가 맞고 유지보수 가능한가?
- **프린시펄**: 팀·분기를 넘어 다른 사람이 베끼는 패턴으로 버티는가?
- **디스팅귀시드/펠로우**: 회사·업계 전체, 여러 해에 걸쳐, 오늘의 맥락 없는 5년 후 합류자에게도
  말이 되는가? 여전히 권한이 아니라 기술적 신뢰로 미치는 영향이다.
- **경영진(CTO/VP-Eng)**: 인력·팀 구조, 예산·총소유비용, 규제·경쟁·고객신뢰 같은 조직 레버를
  건드리는가? 여기서부터 순수 기술 관점을 벗어난다.

네 관점은 별도 트랙이 아니라 아래 세부 스킬 안에 "관점" 문구로 나타난다. 단일 파일 수정에
몰입해 있을 때도 파급 범위가 보였던 것보다 크면 그 지점에서 단계가 올라간다.

작업은 대략 `검증 → 이해 → 탐색 → 결정 → 설계 점검 → 검증 설계 → 계획 → 위임 → 구현 → 회고` 흐름을
따른다. 이 스킬은 **각 단계에서 어떤 규율을 끌어올지 고르는 라우터**일 뿐이며 내용은 각 세부
스킬에 있다. 전부 적용하지 말고 실제로 걸리는 2~4개만 고른다.

## 단계별 세부 스킬

- **검증**: `search-first`(API/라이브러리는 기억이 아니라 문서로) · `context-economy`(컨텍스트 대
  파일) · `persistent-memory`(반복 교정을 파일로 고정)
- **이해**: `clarify-the-real-problem`(요청 뒤 진짜 목표)
- **탐색**: `widen-the-solution-space`(첫 아이디어에 안착하기 전 후보 넓히기)
- **결정**: `weigh-tradeoffs`(대안 비교와 결정 무게) · `record-the-why`(결정·기각 대안을 ADR로)
- **설계 점검**: `premortem`(happy path보다 먼저 실패 시나리오) · `simplicity-budget`(YAGNI) ·
  `design-for-the-next-reader`(6개월 후 독자, 인터페이스 먼저) · `interface-contracts`(Hyrum의
  법칙) · `threat-and-scale-check`(신뢰 경계·스케일·계층형 방어)
- **검증 설계**: `verifiability-first`(성공 기준 먼저)
- **계획**: `bite-sized-plan`(작고 독립 검증 가능한 작업으로)
- **위임**: `delegate-to-subagents`
- **디버깅**: `root-cause-discipline`(이미 풀린 문제인지 → 근본 원인 → 증거)
- **실행 규율**: `chestertons-fence`(제거 전 존재 이유 이해) · `surgical-change`(요청 밖 줄을
  더하지 않음) · `measure-before-optimizing`(성능은 측정부터) · `honest-artifacts`(미검증 라벨,
  재현성, 지표 함정)
- **회고**: `fresh-context-review`(가정을 걷어내고 재검토) · `verify-before-claiming`(실행 후
  주장) · `adversarial-review`(반증 편향 심문)

## 상황별 선택 (예시)

- 요구사항 모호 / 기술 선택: clarify-the-real-problem · widen-the-solution-space · weigh-tradeoffs
- 새 기능 / API·데이터 모델 설계: premortem · verifiability-first · design-for-the-next-reader · interface-contracts · threat-and-scale-check
- 외부 라이브러리·API 사용: search-first · premortem
- 버그 수정 / 성능 문제: root-cause-discipline · verifiability-first · measure-before-optimizing · honest-artifacts
- 리팩터링 / 기존 코드에 끼워넣기: chestertons-fence · simplicity-budget · surgical-change
- 구현 마무리 / 인계: verify-before-claiming · fresh-context-review · context-economy
- 되돌리기 어려운 결정, 다른 팀이 베낄 선택: adversarial-review · weigh-tradeoffs · record-the-why
- 서브에이전트/다중 에이전트 실행: delegate-to-subagents · bite-sized-plan

표에 없으면 `clarify-the-real-problem` + `premortem` + `weigh-tradeoffs`로 시작한다.

## 먼저: 세 트랙 중 하나로 분류한다

첫 질문 전에 이 작업이 어느 트랙인지 **명시적으로** 말한다 — 사용자가 뒤집을 수 있게.

- **스파이크** — 가능성 질문. 결과물은 **답, 코드가 아니다.** 2~3문장으로 시도할 것을 말하고
  가장 싼 방법으로 확인하며, 만든 것은 버릴 것으로 표시한다.
- **경계형** — 저장소에 **이미 존재하는** 흐름에 대한 좁은 변경. 기준은 "이런 앱을 안다"가 아니라
  **바뀌는 흐름을 바로 여기서 짚을 수 있는가**다. 짚을 흐름이 없으면 경계형이 아니다. 짧은 설계를
  채팅에 제시하고 멈춘다.
- **구조형** — 새 프로젝트·서브시스템, 또는 다른 곳이 의존하는 인터페이스를 바꾸는 일. 전체 경로를
  걷는다: 질문 → 대안 → 설계 → 계획(`bite-sized-plan`).

**불확실하면 더 무거운 트랙을 고른다.** 래칫은 한쪽으로만 돈다 — 숨은 복잡성이 드러나면 트랙을
올리고 그렇게 말한다. 다른 팀이 패턴으로 베낄 한 파일짜리 변경은 diff가 작아도 구조형이다.

"너무 단순해서 설계가 필요 없다"는 단순하면 짧은 설계가 필요한 것이지 설계가 없어도 되는 것이
아니다. "경계형이라 부르고 스펙을 건너뛴다"는 그 핑계 자체가 위험 신호다. 경계형은 **저장소**가
판단하지 "이런 앱을 안다"는 익숙함이 판단하지 않는다. 작업이 커졌는데 "거의 끝났으니"라며
재분류를 건너뛰지 않는다 — 숨은 복잡성은 트랙을 올리고, 그 사실을 멈춰서 말한다.

## 형식은 규모에 따라만 바뀐다

- **스파이크** — 2~3문장.
- **경계형** — 3~5줄 설계 노트. 실제로 걸리는 규율만.
- **구조형** — 아래 형식으로 작성 후 `bite-sized-plan`에 넘긴다.

```markdown
**설계 노트 — [작업명]**
- [항목]: [한 줄 결론]
- 선택: [택한 방향]. 이유: [한두 문장]
- 남겨둔 것: [지금 의도적으로 안 하는 것]
```

승인 요청이 아니다 — 방향이 명백하면 쓰고 진행한다. 되돌리기 어려운 결정, 대안 우선순위가
사용자 우선순위에 따라 뒤바뀔 때, 문자 그대로 따르면 진짜 목표를 놓칠 때는 노트를 쓰고 한 번
멈춰 확인받는다.

## 건너뛰기

한 줄 수정·오타·변수 이름, "이대로 그냥 만들어줘"로 결정이 끝난 요청, "실험적/프로토타입" 코드,
같은 대화 안에서 이미 이 사고 과정을 거친 작업(단 `fresh-context-review`는 구현 후 별도로 돈다).

## 이 저장소에서

- "구조형" 트랙의 위임·인계·dev 통합 절차는 `.agents/skills/eatbid-supervised-delivery`가 이미
  소유한다. 역할과 인수 기준은 그 스킬과 `docs/governance/ai-driven-documentation.md` 7절을 따르고
  여기서 다시 정의하지 않는다.
- 트랙과 무관하게 커밋 전에는 정언명령 20에 따라 Linear issue를 assign하고 `pnpm workflow:claim`으로
  claim한다. 한 worktree는 한 세션만 쓴다.
- 설계 노트·계획·인계는 정언명령 21에 따라 한국어로 쓴다. 코드 식별자·CLI 명령·라이브러리 고유명은
  영문을 유지할 수 있다.
- 원본 스킬은 하드-투-리버스 변경 전 확인을 유도하는 보조 hook 스크립트를 함께 두지만, 이
  저장소는 그 자리를 결정적 gate(`pnpm architecture:check`)가 대신한다 — 별도 Python hook을
  추가하지 않는다.
