/**
 * @module 책임: provider 세션이 증명한 주체를 application이 쓰는 identity 좌표와 표시용 라벨로 정의한다.
 *
 * 여기에는 framework도 provider library도 들어오지 않는다. guard·use case·adapter가 같은 좌표 하나를
 * 보게 만들어 인증 기술 선택이 application 관계로 새지 않게 한다(ADR 0018).
 */

/**
 * Better Auth의 `user.id`는 Google `sub`가 아니다. 설치된 1.7.2의 OAuth 연결 경로는 provider가 준 id를
 * 버리고(`const { id: _id, ... } = userInfo`) 자기 user 행을 새로 만든 뒤 provider subject를
 * `account.accountId`/`account.issuer`에만 남긴다. 그러므로 우리가 principal에 매다는 subject는 provider의
 * 것이 아니라 이 인증 시스템이 만든 사용자 식별자이며, provider namespace도 그 사실대로 적는다.
 */
export const AUTH_IDENTITY_PROVIDER = "better-auth";

/**
 * issuer는 배포 origin이 아니라 고정 namespace다. origin을 쓰면 포트 하나만 바뀌어도 같은 사람이 다른
 * principal이 되고, 이미 저장된 워크스페이스가 통째로 보이지 않게 된다.
 */
export const AUTH_IDENTITY_ISSUER = "urn:eatbid:auth";

export interface AuthenticatedSubject {
  /** 이 인증 시스템이 소유한 사용자 식별자 문자열이다. 어떤 application FK도 되지 않는다. */
  readonly subject: string;
  readonly displayName: string | null;
  readonly email: string | null;
}

/**
 * 계정 확인에 필요한 최소값만 남긴다. 전체 주소를 응답과 로그에 흘리지 않으려고 서버가 여기서 자른다.
 * 도메인은 계정을 구분하는 데 필요하므로 남기고 local part는 첫 글자만 남긴다.
 */
export function maskEmail(email: string | null): string | null {
  if (email === null) return null;
  const separator = email.lastIndexOf("@");
  if (separator <= 0) return null;
  const local = email.slice(0, separator);
  const domain = email.slice(separator);
  return `${local.slice(0, 1)}***${domain}`;
}
