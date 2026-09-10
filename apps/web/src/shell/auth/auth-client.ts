/** @module 책임: provider 세션 수명주기 client 하나를 만들고 Google·이메일 로그인과 로그아웃 호출의 실패를 그대로 드러낸다. */
'use client';

import { createAuthClient } from 'better-auth/react';

import { safeReturnPath } from './return-path';

/**
 * 세션 쿠키는 same-origin이므로 브라우저 origin을 그대로 쓴다. `/api/auth`는 Nest ingress가 서빙하고
 * 개발에서는 Next rewrite가 같은 경로를 넘긴다. 이 client는 세션 수명주기만 소유하며 app principal과
 * 워크스페이스 상태는 canonical 세션 계약이 소유한다(ADR 0032 §1).
 */
export const authClient = createAuthClient({
  baseURL: typeof window === 'undefined' ? undefined : window.location.origin,
  basePath: '/api/auth'
});

/**
 * 이 hook이 세션을 살린다. GET `/get-session` 응답의 `needsRefresh`를 받아 provider에 POST를 보내고
 * 브라우저가 갱신 쿠키를 직접 받는 경로는 여기뿐이다. `authClient.getSession()` 한 번 호출은 그 POST를
 * 하지 않으므로 화면은 이 hook을 마운트해 둔다(ADR 0032 §1·Consequences).
 */
const useProviderSession = authClient.useSession;

/**
 * provider가 관측한 로그인 주체다. `undefined`는 아직 관측 전, `null`은 로그인 없음을 뜻한다.
 * 세션 토큰과 만료 시각은 이 경계 밖으로 내보내지 않는다.
 */
export type ProviderSubject = string | null | undefined;

/**
 * 계정 전환을 알아채는 marker 하나만 노출한다. 이 값은 "브라우저가 지금 누구의 쿠키를 보내는가"가
 * 바뀌었는지만 말하며, app principal과 워크스페이스의 권위는 canonical 세션 계약이 그대로 소유한다
 * (ADR 0032 §1·§9). 세션 id 대신 사용자 id를 쓰는 이유는 세션 갱신마다 값이 바뀌면 갱신을 전환으로
 * 오인하기 때문이다.
 */
export function useProviderSubject(): ProviderSubject {
  const session = useProviderSession();
  if (session.isPending) return undefined;
  return session.data?.user.id ?? null;
}

export class ProviderAuthError extends Error {
  readonly name = 'ProviderAuthError';

  constructor(message: string, cause: unknown) {
    super(message, { cause });
  }
}

/** 로그아웃 실패 문구를 실패한 단계에 맞추기 위해 provider 호출 실패만 가려낸다. */
export function isProviderAuthError(error: unknown): error is ProviderAuthError {
  return error instanceof ProviderAuthError;
}

/** 로그인 성공 뒤 돌아갈 곳은 같은 앱의 상대 경로만 허용한다. 판정은 provider 호출 전에 끝난다. */
export async function signInWithGoogle(returnPath: unknown): Promise<void> {
  const { error } = await authClient.signIn.social({
    provider: 'google',
    callbackURL: safeReturnPath(returnPath)
  });
  if (error) throw new ProviderAuthError('Google 로그인을 시작하지 못했습니다.', error);
}

export type EmailSignInOutcome = 'signed-in' | 'invalid-credentials';

/**
 * 개발 로그인 provider의 이메일·비밀번호 로그인이다. 서버는 `EATBID_DEV_LOGIN` 없이 이 방법을 열지 않으므로
 * 화면의 폼 판정과 서버의 판정이 어긋나면 그 실패는 자격 오류가 아니라 `ProviderAuthError`로 드러난다.
 * 자격 오류(401)만 값으로 돌려주는 이유는 화면이 그 경우에만 "입력을 확인하라"고 말할 수 있기 때문이다.
 * 성공하면 provider client가 검증된 복귀 경로로 브라우저를 옮기므로 호출자는 이동을 따로 하지 않는다.
 */
export async function signInWithEmail(input: {
  readonly email: string;
  readonly password: string;
  readonly returnPath: unknown;
}): Promise<EmailSignInOutcome> {
  const { error } = await authClient.signIn.email({
    email: input.email,
    password: input.password,
    callbackURL: safeReturnPath(input.returnPath)
  });
  if (!error) return 'signed-in';
  if (error.status === 401) return 'invalid-credentials';
  throw new ProviderAuthError('이메일 로그인을 시작하지 못했습니다.', error);
}

/**
 * 로그아웃 실패를 삼키지 않는다. 삼키면 화면은 로그아웃됐다고 말하는데 세션 쿠키는 그대로 살아 있고,
 * 공용 PC에서 그 차이가 다음 사람에게 그대로 남는다.
 */
export async function signOutFromProvider(): Promise<void> {
  const { error } = await authClient.signOut();
  if (error) throw new ProviderAuthError('로그아웃하지 못했습니다.', error);
}
