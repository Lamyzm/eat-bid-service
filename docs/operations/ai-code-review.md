---
id: AI-CODE-REVIEW
status: active
canonical_for: local-codex-advisory-review
last_reviewed: 2026-09-01
review_trigger: review-policy-or-git-hook-change
---

# Codex 읽기 전용 코드 리뷰 운영

## 1. 결론

eatbid의 AI 리뷰는 lint·typecheck·test·contract·architecture gate를 대신하지 않는 advisory다. 사람, Codex,
Claude가 어떤 도구로 코드를 작성하더라도 활성 Git hook인 루트 `.githooks`가 같은 저장소 명령을 호출한다.
PR에서는 publication 권한이 없는 `.github/workflows/validate.yml`이 architecture·test·build와 browser 기반
프론트엔드 검증을 실행한다. AI advisory는 이 결정적 CI 판정을 대체하거나 required check가 되지 않는다.

```text
모든 push
  → pnpm test (필수, 실패 시 중단)

refs/heads/main push
  → pnpm architecture:check (필수, 실패 시 중단)
  → pnpm review:ai -- --base origin/main (advisory, 사용 불가여도 push 유지)
```

feature branch에서 명시적으로 실행할 때는 다음 환경만 사용한다.

```text
EATBID_AI_REVIEW=1 EATBID_REVIEW_BASE=master git push
pnpm review:ai -- --base master
```

## 2. 안전 경계

- Codex CLI는 `--sandbox read-only`, `--ask-for-approval never`, `--ephemeral`, `--ignore-user-config`,
  `--ignore-rules`로 실행한다.
- 현재 CLI가 `exec review --base`와 custom stdin prompt를 함께 허용하지 않으므로 일반 `codex exec`가
  prompt의 `baseRef...HEAD` 범위만 읽기 전용으로 검토한다.
- prompt는 shell 인수가 아니라 stdin으로만 전달한다.
- child 환경은 실행 경로와 Codex 인증 위치에 필요한 allowlist만 전달한다. `DATABASE_URL`, Infisical,
  Linear와 provider token은 전달하지 않는다.
- dirty tree, 유효하지 않은 ancestor base, 100개 초과 파일, 6,000줄 초과 변경, 1 MiB 초과 patch,
  secret·credential·생성물·lockfile 경로는 Codex 실행 전에 거부한다.
- 결과는 JSON Schema와 변경 경로·줄 범위·최대 50개 finding 규칙으로 다시 검증한다.
- 같은 정책·prompt·schema·Codex version·model·Git 범위 hash에서 완전히 검증된 성공 결과만 Git common dir
  cache로 재사용한다. unavailable이나 검증 실패 결과는 cache하지 않는다.
- Git common dir 잠금은 같은 저장소에서 Codex review process가 중복 실행되는 것을 막는다. owner PID가
  종료된 stale 잠금은 확인 후 `recovered-*`로 격리하고 새 실행을 허용한다.
- audit에는 commit/hash, cache key, 상태, 실행 시간과 finding 수만 남긴다. prompt, patch, 환경변수와
  원문 결과는 남기지 않는다.

read-only sandbox는 강한 비밀 격리 경계가 아니다. 그래서 민감 경로와 환경을 wrapper가 먼저 차단하며,
advisory가 unavailable이어도 결정적 gate 성공을 실패로 바꾸지 않는다.

## 3. Hook 권위와 main 전환 상태

hook 권위는 루트 `.githooks` 하나다. `apps/web`의 Husky 의존성과 app-local hook은 기존 template 흔적이며
실행 권위가 아니다. app-local `prepare`도 제거했다. `pnpm install`의 root `prepare`가
`core.hooksPath=.githooks`를 설정한다.

2026-09-01 전환 이후 원격 기본 branch와 `origin/HEAD`는 `main`이다. `main` push와 PR은 publication
권한이 없는 결정적 검증만 실행하며, image publication은 현재 remote `main` HEAD를 가리키는 canonical
annotated `release/v<MAJOR>.<MINOR>.<PATCH>` tag만 시작할 수 있다. private GitHub Free에서는 branch
protection과 required check를 서버에서 강제할 수 없으므로 로컬 hook·read-only CI·tag preflight를 함께
운영한다. `master`와 `rollback/pre-main-cutover-2026-09-01` tag는 관찰 기간의 복구 기준으로 보존한다.

## 4. 장애 확인

| 증상 | 확인 |
|---|---|
| `advisory unavailable: dirty-tree` | 변경을 커밋한 뒤 다시 실행한다. stash로 숨겨 리뷰 범위를 왜곡하지 않는다. |
| `invalid-base` | 로컬에 base ref가 있고 HEAD의 ancestor인지 확인한다. |
| `denied-path` | 민감·생성·lockfile 변경을 별도 검토 단위로 분리한다. |
| `lock-contention` | 같은 저장소의 먼저 시작한 review가 끝난 뒤 다시 실행한다. |
| Codex CLI 없음·인증 실패·timeout | 필수 gate 결과를 유지하고 CLI 설치·로그인을 별도로 복구한다. |
| 구조화 결과 거부 | schema와 변경 경로 밖 finding을 허용하지 말고 reviewer prompt를 수정한다. |

검증 명령은 다음과 같다.

```text
node --test tools/review/*.test.mjs tools/quality/check-commit-message.test.mjs
pnpm review:context -- --base HEAD~1 --check
pnpm review:ai -- --base HEAD~1
git config --get core.hooksPath
```
