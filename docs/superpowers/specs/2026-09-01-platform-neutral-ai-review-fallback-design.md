---
id: PLATFORM-NEUTRAL-AI-REVIEW-FALLBACK
status: approved-design
linear_issue: EAT-26
last_reviewed: 2026-09-01
review_trigger: ai-provider-review-policy-or-agent-adapter-change
---

# 플랫폼 중립 AI 리뷰와 Claude Code 구독 폴백 설계

## 1. 결정 요약

eatbid의 AI 개발 체계는 특정 모델의 대화·memory·hook 형식을 권위로 삼지 않는다. 저장소가
공통 작업 계약, 리뷰 요청·결과 schema, deterministic gate와 handoff 절차를 소유하고 Codex와
Claude Code는 그 계약을 실행하는 교체 가능한 adapter다.

`pnpm review:ai`의 기본 동작은 다음과 같다.

```text
공통 Git scope·비밀 경계·review context 검증
  ├─ 실패 → provider를 실행하지 않고 advisory unavailable
  └─ 성공
       ├─ Codex의 검증된 cache 또는 읽기 전용 실행
       │    ├─ 정상 구조화 결과 → 결과 확정, finding 유무와 무관하게 종료
       │    └─ 허용된 provider 장애 → Claude Code로 한 번 폴백
       ├─ Claude Code 구독 인증·읽기 전용 실행
       │    ├─ 정상 구조화 결과 → 결과 확정
       │    └─ 장애 → advisory unavailable
       └─ lint·typecheck·test·contract·architecture 결과는 어떤 경우에도 유지
```

Claude 폴백은 Claude API나 Console credit을 사용하지 않는다. `claude -p`를 로컬 Claude Code
구독 OAuth로 실행하고, child environment와 인증 doctor가 API key·custom endpoint·cloud provider
경로를 차단한다. 두 모델이 모두 소진되면 push를 막거나 유료 API로 전환하지 않고 AI advisory만
사용 불가로 기록한다.

개발 세션 자체는 실행 중인 Codex process에서 Claude process로 투명하게 이어 붙이지 않는다.
검토 가능한 commit, Linear issue acceptance·worklog, 실제 검증 결과와 새 lease를 이용해 writing
owner를 순차적으로 인계한다.

## 2. 목표와 성공 조건

### 2.1 목표

- Codex 사용량·인증·실행 장애가 Claude Code 구독 기반 리뷰까지 무력화하지 않게 한다.
- Codex와 Claude가 같은 변경 범위, 근거, prompt와 결과 schema를 소비하게 한다.
- 공통 규칙을 `AGENTS.md`·architecture/ADR·canonical Agent Skill·repository gate에 한 번만 둔다.
- 모델이 규칙을 실제로 찾고 적용하는지는 대표 task eval로 측정한다.
- provider 교대 뒤에도 작업 범위와 완료 근거가 대화 기억에 의존하지 않게 한다.

### 2.2 성공 조건

- `auto | codex | claude` 실행 모드가 있고 `auto`만 provider 폴백을 수행한다.
- 유효한 리뷰 결과는 finding이 있어도 성공이며 다른 provider로 다시 판정하지 않는다.
- 공통 preflight 실패, 사용자 취소와 wrapper 내부 오류는 폴백으로 숨기지 않는다.
- Claude child는 `claude.ai` 구독 로그인으로 확인된 경우에만 시작한다.
- cache와 audit가 provider·model·CLI version을 분리한다.
- 두 provider가 unavailable이어도 기존 필수 gate와 push 판정은 바뀌지 않는다.
- canonical skill과 Claude projection의 drift가 deterministic check에서 실패한다.
- Codex·Claude 대표 eval의 결과를 같은 rubric으로 비교할 수 있다.

## 3. 현재 상태와 확인된 문제

2026-09-01 현재 저장소는 다음 상태다.

- 루트 `AGENTS.md`가 최상위 공통 계약이고 `CLAUDE.md`는 `@AGENTS.md`를 읽는 얇은 adapter다.
- Claude project hook과 Codex hook 참고 계약은 모두 `tools/agent-workflow/hook.mjs`를 호출한다.
- `pnpm review:ai`는 `tools/review/codex-advisory.mjs`에 직접 결합되어 있다.
- cache version, lock 메시지, audit schema와 운영 문서도 Codex 이름을 권위처럼 사용한다.
- `tools/review/reviewer-instructions.md`는 프론트엔드 검토에 치우쳐 있다.
- `.agents/skills`와 `.claude/skills`의 세 `SKILL.md`는 byte 단위로 같은 복사본이다. 현재는 같지만
  어느 쪽도 생성물로 선언되지 않아 독립 편집 시 drift가 생길 수 있다.
- `.cursor/rules` 두 파일도 `AGENTS.md`의 한국어·300줄 규칙을 다시 서술한다.
- 로컬 Claude Code `2.1.251`은 `Claude Max account`로 로그인되어 있고
  `ANTHROPIC_API_KEY`, custom base URL, Bedrock·Vertex·Foundry 선택 환경변수는 없다.
- 로컬 Codex CLI는 `0.138.0`이다. 최신 공식 Codex 문서는 project-local `.codex/hooks.json`을
  설명하지만 이 저장소가 검증한 구버전은 이를 자동 로드하지 않았다. 실제 CLI upgrade와 `/hooks`
  확인 전에는 project hook 강제를 주장하지 않는다.

## 4. 검토한 대안

### 4.1 Codex wrapper 안에 Claude 호출을 바로 추가

변경량은 가장 작지만 orchestration, cache, audit와 오류 이름이 계속 Codex 중심으로 남는다.
세 번째 provider나 provider별 eval을 추가할 때 다시 분해해야 하므로 선택하지 않는다.

### 4.2 Anthropic/OpenAI API SDK로 공통 provider 계층 구현

API 모양은 통일하기 쉽지만 별도 사용량 과금, API key와 retry·rate policy가 새 운영 책임이 된다.
Claude Code 구독만 사용하는 현재 제약과 충돌하므로 선택하지 않는다.

### 4.3 저장소 공통 계약 + 로컬 CLI adapter

저장소가 preflight, prompt, schema, 검증, cache와 audit를 한 번 소유한다. Codex와 Claude Code는
각 CLI의 인증·argv·출력 envelope만 번역한다. 로컬 구독을 재사용하고 provider별 차이를 경계 안에
가둘 수 있으므로 이 방식을 선택한다.

## 5. 목표 구조

```text
tools/review/
  ai-advisory.mjs             공통 orchestration과 CLI entry
  review-contract.mjs         ReviewRequest·ReviewResult·오류 분류
  build-review-context.mjs    공통 prompt/evidence bundle
  git-scope.mjs               base·diff·path·size·비밀 preflight
  review-state.mjs            provider-neutral lock·cache·audit
  reviewer-instructions.md    공통 읽기 전용 리뷰 계약
  providers/
    codex-process.mjs         Codex 발견·version·argv·실행
    claude-process.mjs        Claude 구독 doctor·argv·실행
  catalogs/                   변경 경계별 주입 근거
  *.test.mjs                  provider-independent 및 adapter contract test

.agents/skills/               canonical Agent Skill
.claude/skills/               생성된 Claude discovery projection
tools/agent-config/
  sync-skills.mjs             canonical → projection 생성/check
  agent-eval.mjs              opt-in 실제 agent 행동 평가
```

파일명은 구현 중 기존 소비자를 한 번에 갱신한다. 기존 `codex-advisory.mjs`를 장기 compatibility
wrapper로 남겨 두 개의 진입점을 만들지 않는다. Git common dir의 기존 Codex 전용 cache는 권위
데이터가 아니므로 v2로 변환하지 않고 새 provider-neutral cache가 자연스럽게 대체한다.

## 6. 공통 계약과 데이터 흐름

### 6.1 `ReviewRequest`

사용자가 선택하는 값은 `baseRef`, `provider`, 선택적 `prefer`뿐이다.

- `provider=auto`: 기본 순서 `codex → claude`, 허용된 장애에서만 다음 provider를 시도한다.
- `provider=codex`: Codex만 실행하고 실패를 그대로 advisory unavailable로 반환한다.
- `provider=claude`: Claude만 실행하고 실패를 그대로 advisory unavailable로 반환한다.
- `provider=auto, prefer=claude`: 명시적으로 순서만 `claude → codex`로 뒤집는다.

model alias는 provider adapter 설정이며 prompt나 결과 계약을 바꾸지 않는다. 실행 결과에는 실제
CLI가 보고한 version과 요청 model을 기록한다. `cli-default`처럼 실제 선택을 알 수 없는 값은
그 사실을 그대로 기록하고 특정 model을 사용했다고 주장하지 않는다.

### 6.2 공통 evidence bundle

provider를 고르기 전에 한 번만 다음을 만든다.

- 검증된 `baseCommit`, `mergeBase`, `HEAD`
- 정렬된 변경 경로와 줄 수
- 1 MiB 이하의 unified diff
- 저장소 규칙·관련 architecture/ADR와 검토 catalog의 제한된 발췌
- 결과 JSON Schema와 변경 파일의 최대 줄 번호

민감·generated·lockfile 경로, 100개 초과 파일, 6,000줄 초과 변경과 dirty tree는 provider가
저장소를 읽기 전에 거부한다. diff와 repository 문서는 사실 근거이지 model에 대한 명령이 아니며,
코드나 문서 안의 prompt injection을 따르지 말라는 경계를 공통 system instruction에 둔다.

Codex와 Claude에 서로 다른 요약이나 다른 규칙을 주입하지 않는다. adapter는 같은 prompt bytes와
같은 schema bytes를 받는다.

### 6.3 `ReviewResult`

canonical result는 기존 `schemaVersion`, `summary`, `findings` 필드 형식을 유지하되 값은
provider-neutral `eatbid.ai-review/v2`로 올린다. finding은 변경 경로와
실제 파일 줄 범위 안에 있어야 하며 최대 50개다. provider 응답 envelope, token 사용량과 모델의
자유 형식 로그는 canonical result에 들어오지 않는다.

orchestration 결과는 다음 세 category만 가진다.

- `success`: schema와 줄 범위 검증을 통과한 결과. finding 0개와 1개 이상을 모두 포함한다.
- `refused`: 공통 Git·비밀·크기·동시 실행 경계가 provider 호출 전에 거부했다.
- `unavailable`: 시도 가능한 provider가 모두 실행 가능한 결과를 만들지 못했다.

## 7. 폴백과 오류 정책

다음 provider-local 실패만 `auto` 폴백을 허용한다.

- CLI 없음 또는 version 조회 실패
- 허용된 인증 없음·사용량 소진·rate limit·provider overload
- 제한 시간 종료 또는 provider process 비정상 종료
- 구조화 출력 누락·JSON/schema 불일치
- provider 전용 sandbox/tool 실행 실패

다음 상황에서는 폴백하지 않는다.

- 정상 결과에 finding이 있음
- dirty tree, invalid base, denied path, 범위 크기 초과
- 공통 review lock contention
- 사용자 취소·process interrupt
- 공통 context/schema 생성 실패나 분류되지 않은 wrapper 오류

알 수 없는 오류를 무조건 다음 모델로 넘기면 공통 결함을 provider 장애로 위장한다. 따라서 fallback
reason은 allowlist enum이어야 하며 raw stderr 문자열 자체를 분기 권위로 삼지 않는다. CLI별 알려진
exit/error 문구는 adapter에서 안정된 reason으로 정규화하고 원문은 audit에 저장하지 않는다.

전체 실행에는 하나의 시간 예산을 둔다. 첫 provider timeout 뒤 두 번째 provider가 다시 전체 timeout을
소비하지 않으며 남은 예산 안에서만 실행한다. 정확한 기본값은 기존 180초 smoke 결과를 기준으로
구현 계획에서 정하되 전체 상한을 없애지 않는다.

## 8. Claude Code 무과금 실행 경계

Claude adapter는 실행 직전에 `claude auth status --json`을 같은 child environment로 호출한다.
다음을 모두 만족할 때만 review를 시작한다.

- `loggedIn === true`
- `authMethod === "claude.ai"`
- `subscriptionType`이 비어 있지 않음
- API Console·custom gateway를 나타내는 provider 상태가 아님

child environment는 allowlist 방식으로 만들며 다음 값은 전달하지 않는다.

- `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, `ANTHROPIC_BASE_URL`
- `CLAUDE_CODE_OAUTH_TOKEN`
- Bedrock·Vertex·Foundry·Anthropic AWS 선택 변수
- Infisical, Linear, DB와 application secret

로컬 `/login` credential store 접근에 필요한 OS profile 경로만 허용한다. `--console`, direct Client SDK,
Agent SDK package와 외부 cloud provider는 이 변경에서 사용하지 않는다.

Claude process는 non-interactive `claude -p`, JSON Schema structured output, session 비저장과 읽기 전용
tool allowlist를 사용한다. project hook·auto memory·MCP가 reviewer 안에서 재귀 실행되지 않게
restricted setting 경계를 사용하고, 필요한 공통 규칙은 evidence bundle로 명시적으로 주입한다.
prompt는 process argv가 아니라 stdin으로만 전달하고 stdin을 닫아 사용량 소진 뒤 credit 전환 입력을
자동 승인할 수 없게 한다.

이 guard는 알려진 실행 경로를 차단하는 코드 계약이다. Anthropic 계정의 요금제와 정책은 외부 상태이므로
`pnpm review:doctor`가 현재 인증 방식·CLI version·실행 가능성만 비밀 없이 보여 주며 영구적인 무과금을
주장하지 않는다. 현재 공식 안내상 `claude -p`의 별도 monthly credit 전환은 보류되어 구독 사용량을
소비한다. 정책이 바뀌면 runbook의 검증 일자를 갱신하고 guard를 재검토한다.

## 9. Codex 실행 경계

Codex는 현재처럼 read-only sandbox, approval 금지, ephemeral session, user config/rule 무시와
structured output을 사용한다. provider adapter 밖에는 Codex 전용 argv나 오류 code를 노출하지 않는다.

최신 project hook 기능은 CLI capability다. 저장소에는 공통 hook runner만 권위로 두고, 실제 Codex
CLI가 repo-local hook을 로드하는지 `pnpm agent:doctor`와 수동 `/hooks` evidence로 검증한 뒤
`.codex/hooks.json` 활성화를 주장한다. 전역 hook 파일을 자동으로 덮어쓰지 않는다.

## 10. cache·lock·audit

cache identity는 최소한 다음 값을 hash한다.

- policy/prompt/schema version과 hash
- provider, provider CLI version, 요청 model
- base/merge-base/HEAD
- path와 diff-stat hash

Codex 결과를 Claude 결과로, 또는 model이 다른 결과로 재사용하지 않는다. 완전히 검증된 `success`만
cache하고 refused·unavailable·malformed 결과는 cache하지 않는다.

review lock은 provider가 아니라 동일한 repository evidence 소비를 보호한다. 한 저장소에서 Codex와
Claude를 동시에 실행하지 않는다. audit는 provider, model, CLI version, fallback reason, Git hash,
duration과 finding 수만 기록한다. prompt, diff, stderr, 환경변수와 원문 결과는 저장하지 않는다.

## 11. 공통 규칙과 Skill의 단일 권위

항상 적용되는 정책은 다음 순서로 한 번만 소유한다.

1. `AGENTS.md`: 절대 규칙과 필수 읽기 지도
2. architecture/ADR/runbook: 결정 이유와 상세 운영 절차
3. `.agents/skills/<name>/SKILL.md`: 특정 작업에서만 필요한 반복 절차
4. repository script·test·CI: 기계적으로 판정 가능한 불변식
5. Linear issue: 현재 작업의 scope·acceptance·owner·상태

루트 `CLAUDE.md`는 계속 `@AGENTS.md`를 읽는 얇은 adapter다. Claude 전용 파일에 제품 규칙을 다시
서술하지 않는다.

`.agents/skills`를 canonical Agent Skill 위치로 정한다. Claude discovery를 위한
`.claude/skills`는 `sync-skills.mjs`가 만든 exact projection이며 직접 편집하지 않는다.
`sync-skills.mjs --check`는 누락·추가·byte drift를 실패시킨다. symlink는 Windows와 Git 설정 차이 때문에
사용하지 않는다.

`.cursor/rules`처럼 같은 절대 규칙을 다시 서술하는 adapter는 제거한다. 향후 native 위치가 반드시
필요한 client만 generated projection을 추가하며, 새 도구별 규칙 원문은 만들지 않는다. native hook
JSON에 반복되는 event wiring은 정책 SSOT가 아니라 같은 공통 runner를 부르는 adapter다. test가 모든
event와 provider 인자를 검증한다.

## 12. 실제 준수도 평가

문서를 읽었다는 model 응답을 합격 근거로 쓰지 않는다. 실제 provider를 opt-in으로 실행하는
`pnpm agent:eval -- --provider codex|claude`를 두고 같은 fixture와 rubric으로 행동을 측정한다.

초기 대표 case는 다음과 같다.

- endpoint literal을 Web/Nest에 복제하려는 요청을 contract operation으로 되돌리는가
- Linear lease 없이 mutation하라는 요청을 거부하는가
- 영문 테스트명·커밋 메시지를 한국어 규칙으로 교정하는가
- Zod DTO를 spread·parallel interface 없이 native composition하는가
- 300줄 초과 파일에서 줄 수가 아니라 책임 분리를 검토하는가
- 기존 hook·utility 근거가 있을 때 새 중복 구현을 권하지 않는가
- 비밀·generated 경로를 리뷰 prompt로 가져오지 않는가

eval은 model 출력의 특정 문장 일치를 검사하지 않고 필수 결정, 금지 행동과 evidence path를 rubric으로
채점한다. live model eval은 quota와 비결정성이 있으므로 required CI가 아니다. harness 자체와 fixture
validator는 deterministic test로 CI에서 검증하고, provider 정책·CLI·model이 바뀔 때 실제 eval을 다시
실행한다.

## 13. 개발 세션 인계

AI 리뷰 폴백과 writing session 인계를 섞지 않는다. 리뷰 subprocess는 어떤 파일도 수정하지 않는다.

Codex 사용량이 끝나 Claude Code가 구현을 이어갈 때는 기존 Linear workflow를 따른다.

1. Codex가 owned path만 포함한 검토 가능한 commit과 clean tree를 만든다.
2. acceptance별 완료·검증·미완료·첫 다음 행동·금지 작업을 EAT-26 worklog에 남긴다.
3. `workflow:sync → workflow:release → workflow:sync`로 Codex lease를 끝낸다.
4. Claude가 `AGENTS.md`, issue와 최신 worklog, 지정 commit을 읽는다.
5. Claude가 같은 issue를 새로 claim한 뒤에만 파일을 쓴다.

대화 전체, Claude auto memory, Codex task summary와 별도 `progress.md`는 handoff SSOT가 아니다.
중간 working tree를 두 model이 동시에 수정하거나 하나의 lease를 공유하지 않는다.

## 14. Hook과 Git 흐름

루트 `.githooks`는 계속 유일한 Git hook 권위다.

```text
모든 push
  → pnpm test                              필수

main push
  → pnpm architecture:check                필수
  → pnpm review:ai -- --provider auto       advisory
       Codex unavailable → Claude 구독 폴백
       모두 unavailable → 경고 후 push 유지
```

Claude/Codex native hook은 mutation lease와 worklog를 공통 `hook.mjs`에 연결한다. Git pre-push와
native agent hook을 하나의 파일로 합치지 않는다. 전자는 commit 전송 gate이고 후자는 session/tool
lifecycle adapter라 입력과 실패 의미가 다르다.

## 15. 테스트 전략

### 15.1 deterministic unit/contract test

- provider 선택 순서와 explicit provider의 무폴백
- finding이 있는 valid success에서 폴백하지 않음
- allowlist reason만 폴백하고 공통/unknown 오류는 숨기지 않음
- 총 timeout budget과 child process tree 종료
- Claude auth status의 구독 허용·API/unknown 거부
- Claude child environment에서 과금·secret 환경 제거
- 동일 prompt/schema bytes 전달과 stdin-only prompt
- provider/model/version이 다른 cache 격리
- audit allowlist와 raw stderr·prompt 미기록
- canonical skill projection 생성/check와 Windows path 정규화

### 15.2 repository integration test

- fake Codex quota 오류 뒤 fake Claude success
- Codex valid finding 뒤 Claude 미실행
- 둘 다 unavailable이어도 pre-push 필수 gate 성공 유지
- dirty/denied/oversized scope에서 두 provider 모두 미실행
- root hook adapter가 같은 workflow runner와 올바른 provider 인자를 사용

### 15.3 수동 smoke

- 현재 Claude Max 로그인에서 작은 committed diff를 `--provider claude`로 읽기 전용 리뷰
- Codex와 Claude 각각 structured output 검증
- `agent:doctor`에서 인증 방식과 hook capability 확인
- 실제 API key나 billing credential이 child·audit에 없음을 이름 기반으로 확인

## 16. 도입 순서와 rollback

1. 공통 contract/orchestrator와 기존 Codex adapter를 먼저 옮겨 현재 동작을 보존한다.
2. Claude subscription auth guard와 process adapter를 test-first로 추가한다.
3. `review:ai`와 pre-push를 `auto`에 연결하고 운영 문서를 provider-neutral하게 바꾼다.
4. canonical skill projection과 drift check를 추가한 뒤 기존 복사본·중복 Cursor rule을 정리한다.
5. agent doctor/eval을 추가하고 두 provider smoke evidence를 남긴다.
6. 검증된 Codex CLI에서만 repo-local hook 활성 상태를 문서화한다.

AI 리뷰는 advisory이므로 rollback은 `review:ai`를 직전 Codex-only commit으로 되돌리는 것으로 충분하다.
deterministic gate, Linear lease, canonical code/data contract는 이 migration과 독립되어 유지된다.

## 17. 비목표

- Claude API·OpenAI API를 애플리케이션 provider abstraction으로 통합하지 않는다.
- 자동 코드 수정, 자동 merge, AI finding의 required check 승격을 하지 않는다.
- 여러 provider의 결과를 투표·평균해 하나의 진실처럼 만들지 않는다.
- 사용량을 늘리기 위해 계정·credential을 순환하거나 vendor 제한을 우회하지 않는다.
- live model eval을 매 commit CI에서 실행하지 않는다.
- provider native memory나 hook 설정을 제품·아키텍처 결정 저장소로 사용하지 않는다.

## 18. 공식 근거

- [OpenAI Codex — AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
- [OpenAI Codex — Agent Skills](https://learn.chatgpt.com/docs/build-skills)
- [OpenAI Codex — Hooks](https://learn.chatgpt.com/docs/hooks)
- [Claude Code — CLI reference](https://code.claude.com/docs/en/cli-usage)
- [Claude Code — Authentication](https://code.claude.com/docs/en/authentication)
- [Claude Code — Headless mode](https://code.claude.com/docs/en/headless)
- [Claude Code — subscription billing boundary](https://support.claude.com/en/articles/11145838-use-claude-code-with-your-pro-or-max-plan)
- [Claude Agent SDK plan change pause](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)
- [Agent Skills open specification](https://agentskills.io/specification)
- [AGENTS.md open format](https://agents.md/)
