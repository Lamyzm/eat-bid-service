/**
 * @module 책임: 브라우저 스위트가 로그인 상태로 화면을 열 수 있도록 세션 쿠키 하나와 그 쿠키에 답하는
 * 세션 계약 응답을 소유한다. 제품 코드는 이 파일을 import하지 않는다.
 *
 * 값은 서명되지 않은 fixture 문자열이다. 이 스위트가 검증하는 것은 게이트가 "세션이 있다고 볼 근거"를
 * 보고 화면을 여는지이며, 서명·만료·회수 판정은 실제 provider를 쓰는 인증 스위트가 맡는다.
 */
import type { AccountLabel, CurrentSessionV1Response } from '@eatbid/contracts/api/v1/session';
import { sessionV1Operations } from '@eatbid/contracts/api/v1/session';

export const SESSION_COOKIE_NAME = 'better-auth.session_token';
const SESSION_COOKIE_VALUE = 'fixture-session';
/**
 * 같은 쿠키에 이 값을 넣으면 세션은 유효하지만 app 계정 초기화가 아직 끝나지 않은 상태가 된다.
 * 쿠키 유무만 보는 proxy는 통과시키고 세션 계약을 읽는 layout만 걸러야 하는 상태다.
 */
export const UNINITIALIZED_SESSION_COOKIE_VALUE = 'fixture-uninitialized';

const ACCOUNT: AccountLabel = { displayName: '검사 계정', maskedEmail: 'e***@example.com' };

const ACTIVE_SESSION: CurrentSessionV1Response = {
  state: 'active',
  account: ACCOUNT,
  principalId: '1',
  workspace: { workspaceId: '1', name: '검사 워크스페이스', role: 'owner' }
};

const UNINITIALIZED_SESSION: CurrentSessionV1Response = {
  state: 'uninitialized',
  account: ACCOUNT
};
const UNAUTHENTICATED_SESSION: CurrentSessionV1Response = { state: 'unauthenticated' };

/**
 * Playwright context에 심는 로그인 상태다. `use.storageState`로 전체 스위트에 적용하고, 게이트 자체를
 * 검사하는 스위트만 빈 상태로 덮어쓴다. 파일로 떨어뜨리지 않고 config 안에서 값으로 만든다.
 */
export function signedInStorageState(host: string) {
  return {
    cookies: [
      {
        name: SESSION_COOKIE_NAME,
        value: SESSION_COOKIE_VALUE,
        domain: host,
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: 'Lax' as const
      }
    ],
    origins: []
  };
}

/**
 * 세션 계약을 재현한다. 쿠키가 없는 요청에 미로그인을 돌려주는 것이 중요하다. 항상 활성으로 답하면
 * 게이트를 검사하는 스위트가 통과해도 아무것도 증명하지 못한다.
 */
export function sessionResponse(request: Request): Response | undefined {
  const { pathname } = new URL(request.url);
  if (pathname !== sessionV1Operations.getCurrentSession.openApiPath) return undefined;
  const cookie = request.headers.get('cookie') ?? '';
  if (cookie.includes(`${SESSION_COOKIE_NAME}=${UNINITIALIZED_SESSION_COOKIE_VALUE}`)) {
    return Response.json(UNINITIALIZED_SESSION);
  }
  const signedIn = cookie.includes(`${SESSION_COOKIE_NAME}=`);
  return Response.json(signedIn ? ACTIVE_SESSION : UNAUTHENTICATED_SESSION);
}
