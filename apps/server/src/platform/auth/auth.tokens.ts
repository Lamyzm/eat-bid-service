/**
 * @module 책임: 인증·인가 판정에 필요한 port의 주입 토큰을 소유해 guard와 조립이 같은 이름을 공유하게 한다.
 */
export const AUTH_TOKENS = {
  operatorGrantReader: Symbol("OperatorGrantReader"),
  principalReader: Symbol("PrincipalReader"),
  sessionAuthenticator: Symbol("SessionAuthenticator"),
} as const;
