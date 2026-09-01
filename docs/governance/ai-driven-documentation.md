---
id: DOC-GOVERNANCE
status: active
canonical_for: cross-agent-knowledge-and-delivery-workflow
last_reviewed: 2026-09-02
review_trigger: workflow-tool-or-document-authority-change
---

# Codex·Claude Code 기반 AI-driven 운영체계

## 1. 결론

eatbid는 특정 AI 도구의 대화나 task list가 아니라 **공유 작업 계약과 검증 가능한 저장소
상태**를 중심으로 운영한다.

```text
제품 outcome
  → Linear issue/project
  → 필요할 때만 OpenSpec delta / ADR
  → 한 writing agent의 격리 구현
  → 다른 agent의 독립 review
  → PR + CI + 사람이 확인한 evidence
```

문서 수나 AI가 생성한 코드량은 진척도가 아니다. 사용자가 승인한 범위, 실제 diff, 재현 가능한
검증 evidence가 일치할 때만 완료다.

## 2. 진실 원천

| 질문 | 권위 | 권위가 아닌 것 |
|---|---|---|
| 현재 제품 경계와 비목표는 무엇인가? | `docs/architecture/product-and-quality.md` + Accepted ADR | roadmap 확장 가설, agent 대화 |
| 어떤 capability 가설과 outcome 순서로 성장하는가? | `docs/product/roadmap.md` | Project의 임시 메모 |
| work item의 문제·scope·acceptance는 무엇인가? | Linear issue | agent 대화, Markdown roadmap 상태, GitHub Issue |
| 여러 work item의 우선순위·담당·진행 상태는 무엇인가? | Linear project의 issue view | GitHub Project, 별도 Markdown task board |
| 기능 행동이 이번 변경에서 어떻게 달라지는가? | Linear issue acceptance, 필요 시 OpenSpec delta | 구현자가 대화에서 만든 암묵적 가정 |
| 시스템 경계를 왜 선택했는가? | Accepted ADR | plan, PR 코멘트만으로 남긴 결정 |
| 목표 데이터·런타임 구조는 무엇인가? | `docs/architecture/` | 현재 코드에서 우연히 추론한 구조 |
| 실제 구현은 무엇인가? | 병합된 code·schema·migration | spec 또는 plan의 예상 파일 목록 |
| 완료됐는가? | PR diff + CI + acceptance evidence | agent의 “완료했습니다” 선언 |
| 운영자는 어떻게 실행·복구하는가? | `docs/operations/` runbook | 개인 shell history |
| 반복 절차를 agent가 어떻게 수행하는가? | 공용 Agent Skill + 저장소 script | 매번 복사하는 장문 prompt |

같은 상태를 두 진실 원천에서 관리하지 않는다. 링크는 허용하지만 상태·acceptance·결정을 복사하지
않는다.

## 3. 공통 계층과 도구별 adapter

### 3.1 공통 계층

- `AGENTS.md`: 모든 사람·Codex·Claude가 지키는 불변식과 필수 읽기 지도
- `ARCHITECTURE.md`, architecture docs, ADR: 목표 구조와 결정
- Linear issue: 작업 문제, scope, acceptance, owner, 결정과 handoff
- Linear project: issue를 복사하지 않고 우선순위, status, blocker를 투영하는 portfolio view
- OpenSpec change: 중대형 행동 변경의 delta 계약
- repository script와 CI: deterministic verification
- PR: 구현 diff, review, 실행 evidence

### 3.2 Claude Code adapter

- 루트 `CLAUDE.md`는 `@AGENTS.md`를 import하고 Claude 전용 최소 지침만 둔다.
- 하위 `CLAUDE.md`도 같은 위치의 `AGENTS.md`를 import하는 adapter로만 사용한다.
- 과거 `.claude/rules/`의 사고 기록은 `docs/evidence/claude-incident-lessons/`에 보존하며 현재
  Claude 지침으로 자동 로드하지 않는다.
- Claude auto memory와 session task는 개인 실행 보조물이다. 다른 machine·agent와 공유되는 결정
  기록으로 인용하지 않는다.
- hook은 공용 script를 자동 호출할 수 있지만 hook 자체에 유일한 품질 규칙을 구현하지 않는다.
- `.claude/skills`는 `.agents/skills`의 생성 projection이다. `pnpm agent:skills:write`로만 갱신하고
  `pnpm architecture:check`가 drift를 실패시킨다.
- Claude Code project hook은 `pnpm workflow:*` lifecycle 명령과 Linear 읽기 MCP 도구를 lease 없이 허용하므로
  Claude 세션도 스스로 claim한다.

### 3.3 Codex adapter

- Codex는 `AGENTS.md`와 현재 저장소의 skill 지시를 따른다.
- Codex task/thread의 plan과 goal은 실행 보조 상태다. Linear issue나 PR의 공유 상태를 대신하지 않는다.
- 장기 자동화는 준비된 Linear issue, 격리 workspace, CI 판정이 갖춰진 뒤에만 도입한다.
- 공용 advisory 리뷰는 도구별 prompt가 아니라 `pnpm review:ai -- --provider auto`를 사용한다. Codex와 Claude Code는
  같은 계약을 실행하는 교체 가능한 provider이며 실제 실행·격리·폴백·실패 정책은
  [`ai-code-review.md`](../operations/ai-code-review.md)와 ADR 0026이 소유한다.

### 3.4 Linear adapter와 공통 hook

- Codex와 Claude Code는 공식 `https://mcp.linear.app/mcp`를 각 client의 OAuth로 연결한다.
- 두 client의 project hook은 `tools/agent-workflow/hook.mjs`만 호출한다. 도구별 hook 파일에
  서로 다른 업무 규칙을 복사하지 않는다.
- 읽기·조사는 issue 없이 허용하고 저장소 mutation 전 온라인 검증된 Linear lease를 요구한다.
- deterministic claim/sync용 API key는 전용 process 환경변수로만 주입한다. 실패 event는 `.git` 아래
  outbox에 보존하며 GitHub Issue나 Markdown board를 fallback으로 만들지 않는다.
- 실제 연결, 진단, 장애 복구 절차는
  [`linear-agent-workflow.md`](../operations/linear-agent-workflow.md)를 따른다.

## 4. 작업 계약

모든 delivery work는 대화 기록 없이도 다음 질문에 답해야 한다.

1. 어떤 사용자의 어떤 문제인가?
2. 성공하면 관측 가능한 결과가 무엇인가?
3. 이번 변경 범위와 비목표는 무엇인가?
4. 어떤 evidence가 이 주장을 뒷받침하는가?
5. 어떤 acceptance로 완료를 판정하는가?
6. 데이터 권위, 제품 경계, 운영 경계를 바꾸는가?
7. 무엇을 실행해 검증하고 무엇을 검증하지 못했는가?

이 질문의 기본 소유자는 Linear issue다. 자세한 명세가 필요해도 issue에는 목적·scope·acceptance와
OpenSpec/ADR/PR 링크가 남는다.

도구 사이의 필드 소유권은 다음처럼 나눈다.

| 필드 | 유일한 owner |
|---|---|
| problem, outcome, scope, non-goals, high-level acceptance, risk, work type | Linear issue |
| writing owner | Linear issue assignee |
| priority, status, blocker | Linear project와 issue |
| 상세 `ADDED | MODIFIED | REMOVED` behavior | 선택된 OpenSpec change |
| 아키텍처 결정과 supersession | ADR |
| acceptance별 실행 evidence와 확인하지 못한 범위 | PR |

OpenSpec이 존재해도 Linear issue의 승인 scope와 outcome을 넓힐 수 없다. 충돌하면
`Accepted ADR·AGENTS > 승인된 Linear issue scope > OpenSpec 상세 behavior > 구현 plan` 순서로 멈춰
사람이 계약을 갱신한다. 상위 문장을 하위 문서에 복사해 해결하지 않는다.

## 5. 변경 규모별 workflow

| 규모 | 기준 | 공유 계약 | 실행 |
|---|---|---|---|
| S | 행동 의미나 경계를 바꾸지 않는 작은 수정 | 간단 Issue + 짧은 acceptance | 한 agent 구현 → 필요한 검증 → 위험에 따라 review |
| M | 기존 화면 행동, API contract, 분석 presentation 변경 | Issue + 명시적 acceptance, 필요할 때만 OpenSpec delta | human scope gate → 한 agent 구현 → 다른 agent review |
| L | 새 제품 흐름, 데이터 소유권, DDL, 런타임·시스템 경계 변경 | Issue + delta spec + 필요한 ADR | discovery/human gate → 격리 구현 → 독립 review와 전체 evidence |

복잡하다는 이유만으로 문서를 늘리지 않는다. 사람 또는 다음 agent가 구현 전에 합의해야 하는
행동 차이가 있을 때만 OpenSpec을 사용한다.

## 6. OpenSpec 도입 원칙

OpenSpec은 전면 설치 대상이 아니라 **brownfield delta-spec 파일럿 후보**다.

- 기존 시스템 전체를 역문서화하지 않는다.
- 현재 바꾸는 작은 capability만 `ADDED | MODIFIED | REMOVED`로 기록한다.
- 첫 파일럿은 아키텍처 전환 전체가 아니라 경계가 분명한 실제 변경 하나로 한다.
- change가 끝나면 살아 있는 spec에 합치고 change artifact를 archive한다.
- Linear status, 담당자, 일정, PR evidence를 OpenSpec에 복사하지 않는다.
- 한 파일럿을 끝낸 뒤 이해 시간, 중복, 누락, archive 동작을 검토하고 표준화 여부를 결정한다.

첫 후보는 `오늘의 투찰함에서 변경·재입찰 상태를 구분해 보여주는 한 흐름`처럼 UI·API·데이터
acceptance가 작고 분명한 변경이 적합하다. `F-001` 전체를 한 번에 파일럿으로 삼지 않는다.

## 7. Codex와 Claude의 협업 규칙

### 7.1 한 work item, 한 writing agent

- 파일을 쓰기 전에 Linear issue를 자신에게 assign하고 `branch/worktree | owned paths`를 마지막
  handoff에 남긴다. Linear assignee가 writing owner의 유일한 원천이며 project는 이를 view로만
  표시한다.
- 이미 다른 writing owner가 있거나 claim 상태를 확인할 수 없으면 파일을 쓰지 않고 read-only
  조사·review만 한다.
- 한 issue에는 하나의 active worktree lease만 두고, 그 worktree에서는 lease에 결박된 한
  provider/session만 파일을 쓴다.
- 다른 agent는 같은 파일을 병렬 수정하지 않고 research, 공격적 review, 검증을 맡는다.
- 병렬 구현이 필요하면 파일 소유권을 분리하고 별도 worktree를 사용한다.
- handoff는 “대화 요약”이 아니라 Linear issue, OpenSpec/ADR, 실제 diff, 검증 결과로 한다.

### 7.2 독립 review

M/L 변경은 구현하지 않은 다른 agent가 다음 순서로 검토한다. S 변경은 위험과 diff 크기에 따라
독립 review를 생략할 수 있다.

1. **spec review:** 사용자 outcome, 비목표, unknown, 아키텍처 경계가 닫혔는가?
2. **diff review:** 구현이 승인 범위만 바꾸고 데이터 권위를 지켰는가?
3. **evidence review:** acceptance별 evidence가 실제 상태에서 재현되는가?

한 agent가 “계획 → 구현 → 자기확인”을 모두 수행한 결과는 독립 검토를 대체하지 않는다.

### 7.3 agent team 사용 경계

- 여러 가설이 독립적인 조사, 공격자/수비자 토론, 서로 다른 영역의 review에 사용한다.
- 순차 작업, 같은 파일 편집, 강하게 의존하는 작은 작업에는 단일 agent를 사용한다.
- agent team의 공유 task list는 Linear project를 대체하지 않는다.

### 7.4 PR evidence와 CI

- PR은 Issue 링크, acceptance별 evidence, 실행한 검증, 실행하지 못한 검증, 잔여 위험을 가진다.
- CI가 `pull_request`에서 실행된 경우에만 `CI 통과`라고 말한다. `.github/workflows/validate.yml`은
  publication 권한 없이 architecture·test·build와 frontend browser evidence를 검증한다.
- image publish·서명·promotion workflow를 PR 검증에 재사용하지 않는다. 자동 agent delivery를
  열더라도 publish 권한이 없는 PR validation workflow만 merge 판정에 사용한다.
- 원격 `main` protection에 required check가 연결되기 전에는 scope에 맞는 local command evidence,
  구현하지 않은 reviewer의 검토, 사람의 명시적 승인이 모두 있을 때만 임시로 merge할 수 있다.
  `required check 미구성`을 그대로 남기며 자동 merge는 금지한다.
- CI가 실패했는데 agent의 자기확인이나 사람의 승인만으로 우회하지 않는다.

## 8. Linear 운영안

Linear의 하나의 project가 portfolio 상태를 소유한다. issue description이 작업 계약을 소유하며
project view는 이를 복사하지 않고 우선순위와 상태를 투영한다. agent가 Linear를 읽을 권한이 없거나
일시적으로 연결할 수 없으면 Git common dir의 `eatbid-agent-workflow/state.json` outbox에 동기화
event만 보존한다. Markdown이나 GitHub Issue를 fallback status board로 만들지 않는다.

Linear workflow가 소유할 최소 field:

- `Status`: Backlog | Ready | In Progress | In Review | Blocked | Done
- `Priority`: portfolio 순서
- `Blocker`: 막힌 외부 조건이나 선행 issue

Writing owner는 Linear issue assignee가 소유한다. Outcome, work type, risk, spec 링크는 issue가,
검증 evidence는 PR이 소유하므로 project custom field에 복사하지 않는다.

권장 view는 `Now`, `Discovery`, `Delivery`, `Blocked`, `Roadmap` 다섯 개다. 실제 약속이 없는
target date와 진척률 숫자는 만들지 않는다.

작업을 다른 session에 넘길 때 Linear issue의 마지막 handoff에는 `현재 상태 | 다음 행동 | blocker |
마지막 evidence`만 갱신한다. 과거 대화 전체를 복사하지 않는다.

## 9. 문서 수명과 hygiene

| 종류 | 수명 규칙 |
|---|---|
| product/architecture/ADR | 질문별 권위 문서 하나를 유지한다. |
| active Issue/OpenSpec change | 현재 scope와 acceptance만 담고 완료 후 닫거나 archive한다. |
| implementation plan | 실행 당시 기록이다. 완료 후 현재 상태를 설명하는 문서로 사용하지 않는다. |
| research/audit | 관측 시점의 evidence다. 결정으로 승격되면 권위 문서를 링크한다. |
| generated reference | code/schema에서 재생성하며 수기 편집하지 않는다. |

다음 신호가 반복되면 문장을 더 쓰지 말고 기계적 장치로 승격한다.

- 같은 review 지적 두 번 이상 → lint/test/공용 Skill 후보
- 반복 shell 절차 → repository script 후보
- 누락 시 데이터 손상 가능 → CI 또는 runtime gate
- 제품 판단이 필요한 예외 → 자동화하지 않고 human gate

## 10. 도입 순서

1. `AGENTS.md`와 얇은 Claude adapter를 공통 진입점으로 사용한다.
2. 기존 roadmap은 capability와 outcome gate만 소유하게 한다.
3. 새 delivery work는 Linear issue template의 공통 intake 형식으로 시작한다.
4. 다음의 작은 M 규모 변경 하나에서 OpenSpec을 파일럿한다.
5. 반복이 실제로 확인된 절차만 공용 Agent Skill로 만든다.
6. Issue 품질, worktree 격리, CI 판정이 안정된 뒤에만 장기 agent orchestration을 검토한다.

## 11. 참고한 공식 자료

- [OpenAI — Harness engineering](https://openai.com/index/harness-engineering/)
- [Claude Code — project memory와 AGENTS.md import](https://code.claude.com/docs/en/memory)
- [Claude Code — Agent Skills](https://code.claude.com/docs/en/slash-commands)
- [Claude Code — parallel agents와 worktrees](https://code.claude.com/docs/en/agents)
- [Claude Code — hooks](https://code.claude.com/docs/en/hooks-guide)
- [Linear — MCP server](https://linear.app/docs/mcp)
- [Linear — GraphQL API](https://linear.app/developers/graphql)
- [OpenSpec](https://github.com/Fission-AI/OpenSpec)
- [OpenSpec — existing projects](https://github.com/Fission-AI/OpenSpec/blob/main/docs/existing-projects.md)
- [GitHub Spec Kit](https://github.github.com/spec-kit/)
- [Thoughtworks Technology Radar Vol. 34](https://www.thoughtworks.com/content/dam/thoughtworks/documents/radar/2026/04/tr_technology_radar_vol_34_en.pdf)
