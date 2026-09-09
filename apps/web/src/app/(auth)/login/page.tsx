/** @module 책임: 로그인 route에서 세션 판정과 돌아갈 경로 검증을 Suspense 안 loader로 격리한다. */
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { getCurrentSessionFromServer } from '@/api/account/server';
import {
  RETURN_PATH_PARAMETER,
  isSameAppReturnPath,
  returnRoute,
  safeReturnPath,
  setupRouteWithReturn
} from '@/shell/auth/return-path';

import { LoginScreen } from './_ui/login-screen';
import { LoginScreenSkeleton } from './_ui/login-screen-skeleton';

type LoginSearchParams = PageProps<'/login'>['searchParams'];

async function LoginLoader({ searchParams }: { readonly searchParams: LoginSearchParams }) {
  const search = await searchParams;
  // 돌아갈 경로는 화면에 닿기 전에 좁힌다. 검증을 client로 미루면 검증 전 값이 한 번은 렌더 트리에 실린다.
  const requested = search[RETURN_PATH_PARAMETER];
  const returnPath = safeReturnPath(requested);
  const read = await getCurrentSessionFromServer();
  if (read.kind === 'session' && read.response.state === 'active') {
    redirect(returnRoute(requested));
  }
  // 로그인은 됐지만 app 계정이 없는 사용자를 로그인 화면에 남기면 고칠 수 없는 로그인을 반복한다.
  // 돌아갈 화면은 설정으로 넘길 때도 잃지 않는다. 보던 공고로 돌아오는 것이 이 흐름의 목적이다.
  if (read.kind === 'session' && read.response.state === 'uninitialized') {
    redirect(setupRouteWithReturn(requested));
  }
  return (
    <LoginScreen
      returnPath={returnPath}
      authUnavailable={read.kind === 'auth-unavailable'}
      hasReturnScreen={isSameAppReturnPath(requested)}
    />
  );
}

export default function LoginPage({ searchParams }: PageProps<'/login'>) {
  return (
    <Suspense fallback={<LoginScreenSkeleton />}>
      <LoginLoader searchParams={searchParams} />
    </Suspense>
  );
}
