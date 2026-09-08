/** @module 책임: RSC가 요청 쿠키로 세션 상태를 읽는 캐시 없는 server entry를 제공한다. */
import 'server-only';

import type { CurrentSessionV1Response } from '@eatbid/contracts/api/v1/session';

import { privateServerRequest } from '../_transport/private-server-request.server';
import { getCurrentSessionWith } from './get-current-session';
import { isAccountDependencyUnavailableError } from './account-resource-error';

/**
 * 세션 의존 조회에는 `use cache`를 두지 않는다. 이 응답은 쿠키마다 다르고 캐시 경계 안에서는 쿠키를
 * 읽을 수조차 없다(ADR 0028 §4, ADR 0032 §1). 요청 하나 안에서 여러 컴포넌트가 같은 답을 필요로 하면
 * `React.cache`로 요청 범위 안에서만 공유한다.
 */
export type CurrentSessionRead =
  | { readonly kind: 'session'; readonly response: CurrentSessionV1Response }
  | { readonly kind: 'auth-unavailable' };

/**
 * 인증 의존성이 없는 배포는 예외가 아니라 화면이 말해야 하는 상태다. 여기서 던지면 진입 화면이
 * "로그인하면 된다"가 아니라 error 경계를 렌더한다.
 */
export async function getCurrentSessionFromServer(): Promise<CurrentSessionRead> {
  try {
    return { kind: 'session', response: await getCurrentSessionWith(privateServerRequest) };
  } catch (error) {
    if (isAccountDependencyUnavailableError(error)) return { kind: 'auth-unavailable' };
    throw error;
  }
}
