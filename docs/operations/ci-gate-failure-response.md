---
id: CI-GATE-FAILURE-RESPONSE
status: active
canonical_for: pr-and-main-push-gate-coverage
last_reviewed: 2026-09-11
review_trigger: validate-yml-job-set-or-notification-mechanism-change
---

# PR·main push 게이트 범위와 실패 대응

## 1. 결론

`.github/workflows/validate.yml`이 pull request와 `main` push에서 도는 유일한 결정적(read-only) 게이트다.
`build.yml`은 `release/v*` annotated tag에서만 뜨므로(ADR 0024) validate.yml이 놓친 회귀는 릴리즈 시점에야
드러난다. EAT-158 이전에는 e2e 스크립트 넷(`test:e2e:auth`·`test:e2e:cache`·`test:e2e:today`·
`test:e2e:own-bid`)과 dataplane 파이썬 검사(pytest·ruff·pyright)가 전부 이 게이트 밖에 있었고, `main`이
13번의 병합 동안 빨간 채로 아무도 보지 않았다(2026-09-10, `/login` prerender 회귀). 이 문서는 지금 게이트가
실제로 도는 것과 의도적으로 뺀 것, 그리고 `main`이 빨갈 때 사람이 무엇을 하는지를 적는다.

## 2. validate.yml이 실제로 도는 것 (EAT-158 이후)

`repository` job (ubuntu-latest):

- `pnpm architecture:check -- --base origin/main`
- `pnpm dataplane:lint`(ruff), `pnpm dataplane:typecheck`(pyright) — `pnpm test`보다 먼저 돈다. 둘 다
  수 초 안에 끝나 파이썬 문법·타입 실패를 싸게 먼저 드러낸다.
- `pnpm test`(TypeScript workspace: tools·domain·contracts·db·server·web)
- `pnpm dataplane:test`(pytest, `apps/dataplane/tests`) — 일부(`tests/integration`)는 testcontainers로
  Docker에 PostgreSQL을 띄우고 그 안에서 `pnpm --filter @eatbid/db build`와 migration을 직접 실행한다
  (`apps/dataplane/tests/integration/conftest.py`). 그래서 dataplane을 따로 떼어 병렬 job으로 두어도
  TypeScript workspace 설치를 다시 해야 하므로, TypeScript workspace 설치가 이미 끝난 이 job 안에서 돈다.
- `pnpm build`(TypeScript workspace)

`frontend-browser` job (ubuntu-latest, 기본 제공 Docker 사용), 순서대로:

- `test:e2e:foundation`, `test:e2e:decision`(기존)
- `test:e2e:today` — foundation·decision과 같은 dev 모드 fixture 서버라 비용이 같다(로컬 실측 8개 전부
  통과, Playwright 리포트 22.4초).
- `test:e2e:cache` — `playwright.cache.config.ts`는 `next build && next start`로 돈다(dev 모드는 `use
  cache` 수명이 달라 증거가 되지 않는다, ADR 0036 §4). `server-read-reuse.spec.ts`의 핵심 단언(서버가
  세션을 정확히 한 번 읽는다, EAT-143의 보장)은 이 config에서만 조건이 참이 된다. §3에 이 항목만 따로
  적는다 — "next build가 필요해 비싸다"는 가정에서 출발해 실측으로 뒤집은 판단이라서다.
- `test:e2e:auth` — `account-setup.spec.ts`를 실제 migration DB·실제 Nest·실제 서명 세션 위에서 돌리는
  유일한 경로다. 계정 간 자료 격리, 남의 등록 id로 보낸 요청의 403 거부, 로그아웃 뒤 세션 쿠키 재사용
  거부를 검사한다(ADR 0032). `apps/server/fixtures/disposable-database.fixture.ts`가 `docker run`으로
  자기 PostgreSQL container를 직접 띄우고 정리하므로 이 job에 `services:` 컨테이너가 필요 없다. 로컬
  실측 12개 전부 통과, Playwright 리포트 28.3초(pretest build 포함 49초).
- `test:e2e:own-bid` — 내 투찰 화면의 등록·증거 대조 상태·mart build 전환을 같은 방식으로 검사한다.
  **EAT-158을 wiring한 시점에는 이 step이 빨갰다.** `own-bid-e2e.ts`의 `smoke()`가 인증 없이 공고 단건을
  조회하는데 EAT-138이 그 controller에 class 레벨 guard를 달아 401이 났다. 같은 구조(`'use cache'` 서버
  read가 쿠키를 못 들고 간다)로 로그인한 사용자의 `/today`·결정 화면도 깨져 있었다. **EAT-165가 셋을 함께
  고쳤다** — 게이트가 걸린 서버 read에서 `use cache`를 빼고 세션을 전달하며, `smoke()`도 로그인한 호출이
  됐다. 이 step은 이제 초록이고, 로그인한 사용자가 실제로 공고 행을 보는 것을 진짜 Nest 위에서 증명한다.

`notify-main-failure` job — `main` push에서 위 두 job 중 하나라도 실패하면 이슈를 연다(§4).

EAT-158 시점에 `apps/web/package.json`의 e2e 스크립트 여섯 개(`foundation`·`decision`·`today`·`cache`·
`auth`·`own-bid`) 전부가 이 게이트에 있다. 의도적으로 뺀 것은 없다. `test:e2e:own-bid`는 EAT-158을
wiring할 때 위에 적은 회귀로 빨갰지만 그것을 이유로 게이트에서 빼지 않았고, EAT-165가 회귀를 고쳐
초록이 됐다. 뺐다면 이 스위트가 다시 깨져도 아무도 못 보는, EAT-158이 막으려는 바로 그 상태로 돌아갔을 것이다.

## 3. `test:e2e:cache`를 넣기로 판단한 과정

이 이슈는 원래 "`next build`가 필요해 비싸다"는 가정으로 시작했다(로컬에서 `pnpm dataplane:test`가 pytest
632개를 2분 23초에 끝냈으니 비슷한 자릿수를 예상했다). 실측해 보니 로컬에서 `next build && next start` +
Playwright 5개가 총 46초(Playwright 리포트 기준 40.0초)에 끝났고, 이마저 이 PC에서 `test:e2e:own-bid`가
동시에 돌아 자원을 나눠 쓰는 상태에서 나온 숫자다. "비싸다"는 가정이 틀렸으므로 뺄 이유가 없어 게이트에
넣었다. 가정만으로 판단해 빼지 않고 실제로 돌려 확인한 뒤 판단을 뒤집은 사례라 별도로 남긴다.

CI 러너(GitHub-hosted ubuntu-latest)는 이 PC보다 느릴 수 있다. 그래도 `server-read-reuse.spec.ts`의
EAT-143 보장이 지금까지 어떤 CI에서도 검사된 적이 없었다는 것과 견주면, 수십 초~수 분의 여유는 남는
비용이다. CI 실측치로 이 판단이 틀렸다고 밝혀지면(예: 5분을 넘기면) 이 절만 갱신하고 대안(예: 캐시 검사만
별도 job으로 병렬화)을 다시 판단한다.

## 4. main이 빨갛다면

1. `notify-main-failure` job이 실패한 push의 `repository`/`frontend-browser` 실행 링크를 담아 새 GitHub
   이슈를 연다(같은 실행이 이미 열려 있어도 매번 새로 연다 — 중복 감지보다 "절대 놓치지 않음"을 택했다).
2. `gh run list --repo Lamyzm/eat-bid-service --workflow=validate.yml --branch=main --limit=5`로 최근
   실행을 본다.
3. `gh run view <run-id> --repo Lamyzm/eat-bid-service --log-failed`로 실패한 step의 로그만 본다.
4. `repository`/`frontend-browser` 중 어느 job인지, 그 안의 어느 step인지 확인한다.
5. 고치는 새 커밋을 `main`에 push하거나, 원인이 된 병합을 되돌린다(`git revert`). 직접 push해도 이미지는
   발행되지 않으므로(ADR 0024, [`main-authority-cutover.md`](main-authority-cutover.md) §1) 급하게 release
   tag부터 만들지 않는다 — `validate.yml`이 다시 초록인 것을 먼저 본다.
6. 이슈를 닫는다. 이슈 자체가 "닫힐 때까지 남는" 신호라 별도 대시보드가 없어도 지금 빨간지 알 수 있다.

개인 알림도 같이 켜 둔다. GitHub Free의 Actions 알림(Settings → Notifications → System → Actions)은
기본값이 "Don't notify"이고 계정마다 개별로 켜야 하는 opt-in이라(2026-09-11 조사) 그것만 믿지 않는다.
"Only notify for failed workflows"를 선택하면 이 저장소를 포함해 자신이 촉발한 실행이 실패할 때마다
이메일/웹 알림이 온다. 이 설정은 개인 계정 단위라 저장소 파일로 대신 켤 수 없고, 그래서 §4의 이슈 생성이
주 안전망이고 이 설정은 보조다.
