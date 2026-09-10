---
status: active
last_reviewed: 2026-09-10
review_trigger: dev-login-flag-seed-account-or-auth-environment-contract-change
---

# 로컬 개발 로그인 절차

EAT-138 이후 업무 화면은 로그인 뒤에 있다. 인증 환경변수 없이 띄운 로컬은 서버가 `auth: null`로 부팅하고
게이트 대상 read가 503이므로 오늘 화면 대신 로그인 화면만 본다. 이 문서는 Google OAuth client 없이 로컬에서
**실제 로그인**을 하는 절차다. 게이트·guard·세션 코드에 개발 우회는 없다. 로컬에서 켜는 것은 provider의
이메일·비밀번호 방법 하나뿐이고, 그 세션은 운영과 같은 판정 경로(proxy 쿠키 유무 → 세션 계약 loader → Nest
guard)를 지난다. 결정과 이유는 [ADR 0032 §13](../adr/0032-authentication-and-authorization-boundary.md)이 소유한다.

## 1. 환경변수

| 변수 | 값 | 누가 읽는가 | 비고 |
|---|---|---|---|
| `EATBID_DEV_LOGIN` | `true` | server, web | 명시적 opt-in. `SWAGGER_ENABLED`처럼 `"true" \| "false"`이며 없으면 꺼짐. production은 server가 기동을 거부하고 web은 폼을 열지 않는다 |
| `BETTER_AUTH_SECRET` | 32자 이상 임의 문자열 | server | 세션 쿠키와 서명된 세션 사본의 서명 열쇠. 고정 개발값을 코드에 두지 않으므로 기기마다 직접 만든다(`openssl rand -base64 48`) |
| `BETTER_AUTH_URL` | `http://localhost:3000` | server | 브라우저가 보는 web origin. 비운영에서는 loopback host의 http만 허용 |
| `CORS_ORIGINS` | 생략 가능(기본 `http://localhost:3000`) | server | provider의 CSRF·콜백 검사도 이 목록을 쓴다. web 포트를 바꿨으면 함께 바꾼다 |
| `DATABASE_URL` | 로컬 개발 DB(`eatbid_api` 역할) | server | 시드 명령도 같은 값을 읽는다 |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | 없어도 된다 | server | 둘 다 있으면 Google 버튼도 함께 동작한다. 하나만 있으면 기동이 실패한다 |
| `API_URL` | `http://localhost:4400`(기본) | web | 개발 서버의 `/api` rewrite 대상 |

`EATBID_DEV_LOGIN`은 비밀이 아니다. 셸이나 로컬 env 파일에 두고 Infisical의 `prod` 환경에는 넣지 않는다.
운영 secret 계약은 [`infra/product/secret-contract.md`](../../infra/product/secret-contract.md)가, Infisical 주입
방법은 [`infisical.md`](infisical.md)가 소유한다.

거부되는 조합은 전부 기동 시점에 한 줄로 드러난다.

| 조합 | 결과 |
|---|---|
| `NODE_ENV=production` + `EATBID_DEV_LOGIN=true` | `Dev login cannot be enabled in production` — 다른 값이 모두 정상이어도 실패 |
| 플래그만 있고 secret·URL이 없다 | `Authentication configuration is incomplete; missing BETTER_AUTH_SECRET, BETTER_AUTH_URL` |
| secret·URL만 있고 Google도 플래그도 없다 | `Authentication configuration has no sign-in method; ...` |
| 인증 값이 하나도 없다 | 기동은 되지만 `auth_disabled` 로그가 남고 로그인 화면은 "지금은 로그인할 수 없습니다" |

## 2. 시드 계정

```text
pnpm --filter @eatbid/server seed:dev-login
```

server 환경변수가 주입된 셸에서 실행한다(1절의 값과 `DATABASE_URL`). 명령은 `@eatbid/db`를 먼저 빌드한 뒤
`apps/server/src/platform/auth/dev-login-seed.ts`를 Bun으로 돌린다.

만드는 것은 셋이며 전부 멱등이다. 몇 번을 돌려도 같은 관계 하나만 남는다.

| 대상 | 값 | 만드는 방법 |
|---|---|---|
| 사용자 | `dev@eatbid.local`, 비밀번호 `eatbid-dev-login`, 이름 `개발 사용자` | Better Auth 서버 API(`signUpEmail`). 비밀번호 해시가 provider의 것과 같다 |
| 워크스페이스 | `내 워크스페이스`, 역할 `owner` | 계정 모듈의 명시적 초기화 command(ADR 0032 §2·§8) |
| 등록 사업자 | `900-00-00016` | 계정 모듈의 등록 command. 검증번호는 통과하지만 실제 납품업체가 아닌 합성 번호라 "수집 원본에 아직 이 번호가 없습니다"가 정상이다 |

출력은 JSON 한 줄이다. 비밀번호는 출력하지 않는다.

```text
{"email":"dev@eatbid.local","subject":"...","user":"created","principalId":"...","workspaceId":"...","business":"registered"}
```

두 번째 실행부터 `user`와 `business`가 `existing`이다. production이거나 `EATBID_DEV_LOGIN`이 없으면 DB에 닿기
전에 `개발 로그인 시드 실패: Error: Dev login seed requires EATBID_DEV_LOGIN=true outside production`으로 끝난다.

비밀번호 재설정과 메일 발송은 없다. 시드 계정의 비밀번호는 바꾸지 않는다. 다른 계정이 필요하면 provider의
`POST /api/auth/sign-up/email`이 개발 로그인 모드에서만 열려 있지만, 워크스페이스 초기화는 화면의 "시작하기"가
따로 해야 한다.

## 3. 확인 순서

1. server를 띄운다(`pnpm --filter @eatbid/server dev`). 시작 로그에 `auth_disabled`가 없어야 한다. 있으면
   인증 값이 하나도 주입되지 않은 것이다.
2. provider에 직접 로그인해 본다.

   ```text
   curl -i -X POST http://localhost:4400/api/auth/sign-in/email \
     -H "content-type: application/json" -H "origin: http://localhost:3000" \
     -d "{\"email\":\"dev@eatbid.local\",\"password\":\"eatbid-dev-login\"}"
   ```

   200과 `Set-Cookie: better-auth.session_token=...`이 와야 한다. 플래그 없이 띄운 server는 400과
   `EMAIL_PASSWORD_DISABLED`를 돌려준다(경로는 항상 있고 handler가 거부한다). 401은 시드가 아직 없거나
   비밀번호가 다른 것이다.
3. web을 `EATBID_DEV_LOGIN=true`로 띄운다(`pnpm --filter @eatbid/web dev`). `/login`에 Google 버튼 아래
   이메일·비밀번호 폼이 보인다. 폼이 없으면 web 쪽 플래그가 없거나 `NODE_ENV=production`이다.
4. 시드 계정으로 로그인하면 `/today`(또는 `next`로 넘긴 화면)로 돌아온다. 로그인 뒤 `/setup`에서 등록 사업자
   `900-00-00016`이 목록에 있어야 시드가 끝까지 돈 것이다.
5. 자동 검증은 다음 셋이다. e2e는 Docker가 필요하다.

   ```text
   pnpm --filter @eatbid/server exec bun test src/platform/config src/platform/auth
   pnpm --filter @eatbid/server exec bun test src/testing/dev-login.e2e.test.ts
   cd apps/web && bun test 'src/app/(auth)/login'
   ```

## 4. 대안: 로컬 Google OAuth client

Google Cloud console에서 web 유형 OAuth client를 만들고 승인된 리디렉션 URI에
`http://localhost:3000/api/auth/callback/google`을 넣은 뒤 `GOOGLE_CLIENT_ID`·`GOOGLE_CLIENT_SECRET`을 주입하면
개발 로그인 없이도 Google 버튼이 동작한다. 동작하지만 팀원마다 client를 만들고 URI를 맞춰야 하므로 기본
절차로 삼지 않는다. 두 방법은 함께 켤 수 있다.

## 5. 하지 않는 것

- `auth: null`일 때 게이트가 통과시키는 개발 분기. 운영 오설정 한 번이 전면 개방이 된다(ADR 0032 §9·§13).
- 운영 가입 방법 변경. 운영은 Google 하나이며 이 플래그는 production 기동을 실패시킨다.
- secret·base URL의 고정 개발값. 코드에 적힌 공개 secret은 `development`로 띄운 공유 환경의 세션을 위조
  가능하게 만든다.
