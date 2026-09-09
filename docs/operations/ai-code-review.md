---
id: AI-CODE-REVIEW
status: active
canonical_for: local-ai-advisory-review
last_reviewed: 2026-09-10
review_trigger: review-policy-provider-adapter-or-git-hook-change
---

# 읽기 전용 AI 코드 리뷰 운영

## 1. 결론

eatbid의 AI 리뷰는 lint·typecheck·test·contract·architecture gate를 대신하지 않는 advisory다. 사람, Codex,
Claude가 어떤 도구로 코드를 작성하더라도 활성 Git hook인 루트 `.githooks`가 같은 저장소 명령을 호출한다.
PR에서는 publication 권한이 없는 `.github/workflows/validate.yml`이 결정적 검증을 실행하며 AI advisory는
required check가 되지 않는다.

```text
모든 commit
  → node tools/architecture/run-checks.mjs --changed (필수, merge-base 대비 변경 경로에 해당하는 검사만 병렬)

모든 push
  → pnpm test (필수, 실패 시 중단)

refs/heads/main push
  → pnpm architecture:check (필수, 실패 시 중단)
  → pnpm review:ai -- --base origin/main --provider auto (advisory, 사용 불가여도 push 유지)
       Codex 허용 장애 → Claude Code 구독으로 한 번 폴백
       둘 다 unavailable → 경고 후 push 유지
```

feature branch에서 명시적으로 실행할 때는 다음 환경만 사용한다.

```text
EATBID_AI_REVIEW=1 EATBID_REVIEW_BASE=origin/main git push
pnpm review:ai -- --base origin/main
pnpm review:ai -- --base HEAD~1 --provider claude
pnpm review:ai -- --base HEAD~1 --prefer claude
pnpm review:doctor
```

## 2. provider 선택과 폴백

- `--provider auto`(기본)는 `codex → claude` 순서이며 `--prefer claude`만 순서를 뒤집는다. `--provider codex|claude`는
  폴백하지 않는다.
- 유효한 결과는 finding이 있어도 `success`다. 다른 provider로 다시 판정하지 않는다.
- 폴백을 허용하는 reason은 `missing-cli`, `cli-version`, `auth-unavailable`, `quota-exhausted`, `rate-limited`,
  `provider-overloaded`, `timeout`, `process-failed`, `invalid-output`, `tool-failed`뿐이다.
- `invalid-request`, `preflight-failed`, `dirty-tree`, `invalid-base`, `denied-path`, `too-many-files`, `too-many-lines`,
  `patch-too-large`, `lock-contention`은 provider를 호출하기 전에 `refused`로 끝난다. `context-failed`, `internal-error`,
  `budget-exhausted`는 `unavailable`이며 폴백하지 않는다.
- prompt에는 변경 경로, 저장소 규칙 발췌, 재사용 catalog와 함께 `baseRef...HEAD` unified diff가 들어간다. binary hunk와
  credential이 감지된 파일의 hunk는 경로와 사유만 남기고 본문은 넣지 않는다.
- 전체 실행 예산은 300초, provider 하나의 상한은 180초다. 남은 예산이 30초 미만이면 다음 provider를 시작하지 않는다.

## 3. 안전 경계

- Codex는 `--sandbox read-only`, `--ask-for-approval never`, `--ephemeral`, `--ignore-user-config`, `--ignore-rules`로
  실행한다. Claude는 `claude -p --restricted --strict-mcp-config --disable-slash-commands --no-session-persistence
  --tools Read,Grep,Glob --permission-mode dontAsk`와 JSON Schema 구조화 출력으로 실행한다.
- Claude child는 `claude auth status --json`이 `loggedIn`, `authMethod: "claude.ai"`, `apiProvider: "firstParty"`,
  비어 있지 않은 `subscriptionType`을 보고할 때만 시작한다. child 환경은 allowlist라 `ANTHROPIC_*`,
  `CLAUDE_CODE_OAUTH_TOKEN`, Bedrock·Vertex·Foundry, Infisical, Linear, `DATABASE_URL`이 전달되지 않는다.
  `--bare`는 OAuth를 읽지 않으므로 쓰지 않는다.
- Windows npm shim(`codex.cmd`, `claude.cmd`)은 shell 없이 실행할 수 없어 shim이 가리키는 `codex.js`·`claude.exe`를
  직접 실행한다. `CODEX_REVIEW_BIN`, `CLAUDE_REVIEW_BIN`으로 덮어쓸 수 있다.
- prompt는 두 provider 모두 stdin으로만 전달하고 즉시 닫는다. 같은 prompt bytes와 schema bytes를 받는다.
- dirty tree, 유효하지 않은 ancestor base, 100개 초과 파일, 6,000줄 초과 변경, 1 MiB 초과 patch,
  secret·credential·생성물·lockfile 경로는 provider 실행 전에 거부한다.
- 결과는 JSON Schema `eatbid.ai-review/v2`와 변경 경로·줄 범위·최대 50개 finding 규칙으로 다시 검증한다.
- 같은 정책·prompt·schema·provider·provider version·model·Git 범위 hash에서 완전히 검증된 성공 결과만 Git common dir
  cache로 재사용한다. Codex 결과를 Claude 결과로 재사용하지 않는다.
- Git common dir 잠금은 같은 저장소에서 두 provider process가 동시에 실행되는 것을 막는다.
- audit에는 provider, model, CLI version, fallback reason, commit/hash, cache key, 상태, 실행 시간과 finding 수만
  남긴다. prompt, patch, stderr, 환경변수와 원문 결과는 남기지 않는다.

Anthropic 계정의 요금제와 정책은 외부 상태다. `pnpm review:doctor`는 현재 인증 방식·CLI version·실행 가능성만
보여 주며 영구적인 무과금을 주장하지 않는다. 2026-09-02 기준 `claude -p`는 별도 monthly credit 전환 없이 구독
사용량을 소비한다. 정책이 바뀌면 이 날짜와 guard를 재검토한다.

## 4. Hook 권위와 main 전환 상태

hook 권위는 루트 `.githooks` 하나다. `pnpm install`의 root `prepare`가 `core.hooksPath=.githooks`를 설정한다.
`pre-commit`은 `pnpm architecture:check -- --changed`와 같은 드라이버를 호출해 변경 범위 검사만 실행하고,
`pre-push`는 main push에서 전체 `architecture:check`를 실행하며 `origin/main`을 review base로 쓴다. 변경 범위
검사의 기준 결정 규칙과 예외 ledger 철거는 ADR 0042가 소유한다.

저장소의 `build.yml`은 canonical annotated `release/v<MAJOR>.<MINOR>.<PATCH>` tag push에서만 image
publication을 시작하며 `main` push와 수동 실행에는 그 권한이 없다. private GitHub Free에서는 branch
protection을 서버에서 강제할 수 없으므로 로컬 hook·read-only `validate.yml`·tag preflight를 함께 운영한다.
AI advisory는 어느 경우에도 required check가 아니다.

원격 기본 branch 전환과 `master`·rollback tag 보존 상태는 이 문서가 아니라
[main-authority-cutover.md](main-authority-cutover.md)가 기록한다.

## 5. 장애 확인

| 증상 | 확인 |
|---|---|
| `refused/dirty-tree` | 변경을 커밋한 뒤 다시 실행한다. stash로 숨겨 리뷰 범위를 왜곡하지 않는다. |
| `refused/invalid-base` | 로컬에 base ref가 있고 HEAD의 ancestor인지 확인한다. |
| `refused/denied-path` | 민감·생성·lockfile 변경을 별도 검토 단위로 분리한다. |
| `refused/lock-contention` | 같은 저장소의 먼저 시작한 review가 끝난 뒤 다시 실행한다. |
| `codex:missing-cli` 또는 `claude:missing-cli` | `pnpm review:doctor`로 실행 파일 해석을 확인하고 필요하면 `*_REVIEW_BIN`을 지정한다. |
| `claude:auth-unavailable` | `claude auth status --json`이 claude.ai 구독인지 확인한다. API key나 cloud provider 변수를 제거한다. |
| `quota-exhausted`·`rate-limited` | 필수 gate 결과를 유지하고 사용량 회복 뒤 다시 실행한다. 다른 계정·credential로 우회하지 않는다. |
| `invalid-output` | schema와 변경 경로 밖 finding을 허용하지 말고 reviewer 계약을 수정한다. |
| `budget-exhausted` | 첫 provider가 예산을 소진했다. 변경 범위를 줄이거나 `--provider`로 하나만 실행한다. |

검증 명령은 다음과 같다.

```text
node --test tools/review/*.test.mjs tools/review/providers/*.test.mjs tools/quality/check-commit-message.test.mjs
pnpm review:context -- --base HEAD~1 --check
pnpm review:doctor
pnpm review:ai -- --base HEAD~1 --provider codex
pnpm review:ai -- --base HEAD~1 --provider claude
git config --get core.hooksPath
```
