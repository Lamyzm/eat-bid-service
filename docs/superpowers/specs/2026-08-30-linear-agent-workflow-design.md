---
status: accepted
date: 2026-08-30
canonical_for: linear-backed-agent-delivery-workflow-design
---

# Linear 기반 Codex·Claude Code 작업 흐름 설계

## 1. 목적

eatbid의 살아 있는 delivery 상태를 Linear 한 곳에 두고, Codex와 Claude Code가 같은 작업 계약과
같은 기계적 gate를 사용하게 한다. GitHub는 코드, PR, CI와 병합된 장기 문서를 소유한다.

이 변경은 제품 런타임이나 데이터 권위 사슬을 바꾸지 않는다. 개발 업무 상태의 권위만
GitHub Issue/Project에서 Linear로 옮긴다.

## 2. 소유권

| 질문 | 유일한 권위 |
|---|---|
| 현재 work item의 문제, 범위, acceptance, owner, priority, status, blocker | Linear issue/project |
| 제품 방향과 capability gate | `docs/product/roadmap.md` |
| 시스템 경계와 확정된 결정 | architecture docs와 Accepted ADR |
| 실제 구현과 review evidence | GitHub branch, PR, CI, 병합된 코드·문서 |
| AI 세션의 임시 계획과 조사 메모 | 해당 세션과 로컬 상태; 공유 권위가 아님 |

Linear와 GitHub에 같은 status나 acceptance를 복사하지 않는다. PR은 Linear issue 식별자를 링크하고
검증 evidence만 소유한다.

## 3. 공통 실행 구조

```text
Codex hook ───┐
              ├─> tools/agent-workflow/hook.mjs
Claude hook ──┘        │
                       ├─ 검증된 worktree lease mutation gate
                       ├─ Git common dir/eatbid-agent-workflow/state.json
                       └─ Linear GraphQL sync / durable outbox

Codex MCP ────┐
              ├─> https://mcp.linear.app/mcp (각 client의 OAuth)
Claude MCP ───┘
```

공통 러너는 Node 24 표준 라이브러리만 사용한다. shell별 quoting 차이를 최소화하고 Windows,
macOS, Linux에서 같은 코드 경로를 실행한다.

## 4. 동작 계약

### 4.1 읽기와 쓰기

- 조사, 분석, 설명, 계획은 Linear issue 없이 허용한다.
- 저장소 파일을 변경하기 전 `workflow:claim`이 Linear에서 issue 존재, team, assignee와 source
  state를 온라인 검증하고 만료되는 worktree lease를 만든다.
- prompt 또는 branch의 `EAT-123` 식별자는 lease를 선택하거나 검증할 뿐 claim을 대신하지 않는다.
- 유효한 lease가 없거나 prompt/branch와 lease가 다르면 Edit/Write/apply_patch 계열 mutation을
  차단한다.
- shell 명령은 확실한 read-only allowlist만 issue 없이 허용한다. 알 수 없는 명령은 lease를 요구한다.
- pipe·chain·redirect·substitution 또는 write/update flag가 섞인 shell은 read-only prefix로 시작해도
  mutation으로 취급한다. test/lint runner도 파일을 쓸 수 있으므로 lease 없이 허용하지 않는다.
- 첫 mutation의 provider/session이 lease writer가 된다. 같은 worktree의 다른 session과 같은 local
  Git common dir에서 동일 issue를 claim한 다른 linked worktree는 release 또는 만료 전까지
  mutation하지 못한다.

### 4.2 상태 동기화

- 온라인 claim만 `Ready → In Progress`와 비어 있는 assignee의 자기 할당을 수행한다.
- hook 종료 시 PostToolUse에서 관찰한 session-owned 경로가 있을 때만 짧은 worklog event를 만든다.
  shell mutation의 실제 diff 귀속은 PR evidence가 최종 권위다.
- PR이 생성되면 `In Review`, 병합되면 `Done`으로 만드는 것은 GitHub/Linear integration이 소유한다.
  agent의 문장 추측으로 review 또는 done을 판정하지 않는다.
- hook은 network를 critical path에 두지 않고 lock 아래 local lease gate와 worklog event 기록만
  수행한다. `workflow:sync`가 outbox를 전송한다.

### 4.3 인증과 비밀

- 저장소에는 Linear URL, team key, workflow 상태 이름만 둔다.
- `LINEAR_API_KEY`는 claim과 명시적 sync command에서만 읽으며 환경변수로만 주입한다.
- Codex와 Claude Code는 공식 Linear MCP OAuth를 각각 한 번 연결한다. OAuth token과 API key는
  저장소, `.env`, hook log, Linear comment에 기록하지 않는다.
- API key가 없거나 Linear가 중단되면 새 claim은 금지한다. 이미 온라인 검증한 미만료 lease의
  작업과 local outbox 보존만 계속한다.

## 5. Linear 모델

초기 상태는 `Backlog | Ready | In Progress | In Review | Blocked | Done`을 사용한다. 최소 label은
`S | M | L`, `Discovery | Delivery | Debt | Ops`, `R0`~`R5`다.

issue description은 다음 필드를 소유한다.

1. 사용자 문제 또는 운영 문제
2. 기대 outcome
3. scope와 non-goals
4. acceptance criteria
5. 근거와 unknown
6. 검증 계획
7. 관련 roadmap, spec, ADR, PR 링크

문서 영향 label은 검토 경로를 선택한다.

| label | 구현 전 확인할 장기 문서 |
|---|---|
| `architecture` | 새 ADR 또는 기존 경계 유지 근거 |
| `data-model` | `domain-and-data.md`, Drizzle migration |
| `runtime` | `runtime-and-deployment.md` |
| `product` | roadmap 또는 화면 행동 명세 |
| `research` | 출처, 관측일, evidence |

## 6. 실패와 안전성

- hook 설정이 신뢰되지 않았거나 비활성화된 client에서는 `AGENTS.md`와 PR validation이 최종
  방어선이다. hook만을 보안 경계로 주장하지 않는다.
- 로컬 state는 linked worktree가 공유하는 Git common dir 아래에 두어 커밋과 worktree diff에
  섞이지 않게 하고, lock으로 전체 load→reduce→save transaction을 직렬화한다.
- state write는 임시 파일 후 rename으로 교체한다. 손상된 state는 별도 파일로 격리하고 mutation은
  fail-closed한다. 빈 state로 추측 복구하지 않는다.
- lock은 PID와 생성 시각을 기록한다. 비정상 종료의 stale lock은 owner 생존 여부를 확인하는 명시적
  recovery command만 timestamp 경로로 격리하며, 자동 삭제하지 않는다.
- outbox event에는 issue ID, event kind, 생성 시각, 변경 파일명만 둔다. prompt 전문이나 source
  payload, credential은 넣지 않는다.
- 한 issue의 writing owner는 한 명이다. Linear assignee, 유일한 active worktree lease와 bound
  provider/session이 확인되지 않으면 다른 agent는 read-only 조사나 review만 한다.

## 7. 의도적으로 하지 않는 것

- hook이 agent나 subagent를 자동 생성하지 않는다.
- Linear를 제품 데이터, 아키텍처 결정, 운영 run ledger로 사용하지 않는다.
- AI 답변 문구로 `Done`을 판정하지 않는다.
- OpenAI Symphony, Sortie, Spec Kit 같은 별도 orchestration framework를 지금 설치하지 않는다.
  Linear issue 품질과 gate가 안정된 뒤 autonomous dispatch가 필요할 때 다시 평가한다.
