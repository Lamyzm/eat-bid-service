/** @module 책임: 로그인 화면이 이메일·비밀번호 폼을 보일지, 로컬 dev에서 시드 계정으로 자동 제출할지를 web runtime 환경값으로 판정한다. */

export interface DevLoginSource {
  readonly nodeEnv: string | undefined;
  readonly devLogin: string | undefined;
  /** `pnpm dev:local`만 켜는 값이다. 개발 로그인이 열려 있을 때만 뜻이 있다. */
  readonly devAutoLogin?: string | undefined;
}

/**
 * 두 조건을 모두 요구한다. `EATBID_DEV_LOGIN`만 보면 운영 환경에 값이 새어 들어왔을 때 폼이 열리고, `NODE_ENV`만
 * 보면 로컬의 모든 사람에게 폼이 보이는데 서버는 같은 플래그 없이 그 로그인을 받지 않는다. 폼은 안내일 뿐이고
 * 권위는 서버의 provider 조립이므로(ADR 0032 §13) 어긋나면 로그인이 실패로 드러날 뿐 열리지는 않는다.
 * 판정은 RSC에서만 하며 브라우저 bundle에는 이 값이 실리지 않는다.
 */
export function isDevLoginEnabled(source: DevLoginSource): boolean {
  return source.nodeEnv !== 'production' && source.devLogin === 'true';
}

/**
 * `apps/server/src/platform/auth/dev-login-seed.ts`가 만드는 시드 계정이다. 두 값은 운영 비밀이 아니라
 * `docs/operations/local-dev-login.md`에 적힌 공개 개발값이며, 시드가 바뀌면 이 값도 함께 바꾼다.
 */
export const DEV_LOGIN_ACCOUNT = { email: 'dev@eatbid.local', password: 'eatbid-dev-login' } as const;

/**
 * 로컬 dev에서 로그인 화면이 시드 계정으로 스스로 제출할지다. 개발 로그인 판정을 그대로 요구하므로
 * production에서는 열리지 않는다. 우회가 아니라 provider의 이메일 로그인을 대신 눌러 줄 뿐이라, 세션은 운영과
 * 같은 판정 경로를 지난다(ADR 0032 §13). e2e는 이 값을 켜지 않아 폼을 직접 다룬다.
 */
export function isDevAutoLoginEnabled(source: DevLoginSource): boolean {
  return isDevLoginEnabled(source) && source.devAutoLogin === 'true';
}
