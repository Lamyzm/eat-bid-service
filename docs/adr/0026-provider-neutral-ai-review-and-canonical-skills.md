# 0026 — provider 중립 AI advisory 리뷰와 canonical Agent Skill 위치

- Status: Accepted
- Date: 2026-09-02
- Supersedes: 없음

## Context

`pnpm review:ai`는 Codex CLI 하나에 결합되어 있어 Codex 사용량·인증·실행 장애가 공통 AI advisory를 즉시
무력화했다. Claude Code 구독은 활성화되어 있지만 API 과금 없이 쓰는 실행 경계가 코드로 강제되지 않았다.
`.agents/skills`와 `.claude/skills`는 같은 내용의 독립 복사본이었고 `.cursor/rules`는 `AGENTS.md` 규칙을 다시
서술했다. Claude Code는 project hook을 강제하므로 Claude 세션은 lease를 스스로 claim하지 못해 인계 절차와
모순됐다. 설계는 `docs/superpowers/specs/2026-09-01-platform-neutral-ai-review-fallback-design.md`에 있다.

## Decision

1. 저장소가 `ReviewRequest`·`ReviewResult`·fallback reason allowlist·preflight·prompt·schema·cache·audit를
   `tools/review/`에서 한 번 소유하고, Codex와 Claude Code는 `tools/review/providers/`의 교체 가능한 CLI adapter다.
2. `provider=auto`는 `codex → claude` 순서로 allowlist reason에서만 한 번 폴백한다. 유효한 결과는 finding이 있어도
   success이며 다시 판정하지 않는다. 두 provider가 모두 unavailable이어도 deterministic gate와 push 판정은 바뀌지 않는다.
3. Claude adapter는 `claude auth status --json`이 claude.ai 구독·firstParty를 보고할 때만 `claude -p`를 실행하고,
   child 환경을 allowlist로 만들어 API key·custom endpoint·cloud provider·secret을 전달하지 않는다. Claude API,
   Agent SDK, Console credit은 사용하지 않는다.
4. `.agents/skills`가 canonical Agent Skill 위치이고 `.claude/skills`는 `sync-skills.mjs`가 만든 byte-exact projection이다.
   symlink와 도구별 규칙 원문(`.cursor/rules`)은 두지 않는다.
5. agent 준수도는 opt-in `agent:eval`로 측정하며 harness와 fixture validator만 CI에서 검증한다.
6. Claude·Codex 세션 모두 `pnpm workflow:claim`을 직접 실행한다. hook 분류기는 workflow lifecycle 명령과 Linear
   읽기 MCP 도구를 lease 없이 허용하고 나머지는 fail-closed를 유지한다.

## Consequences

- 세 번째 provider는 adapter 하나와 doctor 항목만 추가하면 된다. orchestration·cache·audit는 바뀌지 않는다.
- Windows npm shim은 shell 없이 spawn할 수 없으므로 adapter가 실제 실행 파일을 해석한다. `*_REVIEW_BIN`으로 덮어쓴다.
- Anthropic 요금제 정책은 외부 상태다. `review:doctor`는 현재 인증 방식만 보고하고 영구 무과금을 주장하지 않는다.
- Codex 전용 cache(`eatbid.codex-review-cache/v1`)는 변환하지 않고 v2 cache가 자연스럽게 대체한다.
- `apps/web/.claude/skills`의 symlink·부분 복사는 이 결정의 범위 밖이며 별도 issue에서 projection 규칙 확장을 결정한다.

## Rejected alternatives

- Codex wrapper 안에 Claude 호출 추가: orchestration·cache·오류 이름이 Codex 중심으로 남는다.
- Anthropic/OpenAI API SDK 공통 provider 계층: 별도 과금·API key·retry 정책이 새 운영 책임이 되고 구독만 쓰는 제약과 충돌한다.
- symlink projection: Windows와 Git 설정 차이로 byte 보장이 되지 않는다.
- 사용자가 매 세션 claim 대행: Claude Code는 project hook을 강제하므로 agent 자체 claim이 막혀 인계 절차와 모순된다.
