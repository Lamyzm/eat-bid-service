/** @module 책임: 로그인 화면이 이메일·비밀번호 폼을 보일지 web runtime 환경값 둘로 판정한다. */

export interface DevLoginSource {
  readonly nodeEnv: string | undefined;
  readonly devLogin: string | undefined;
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
