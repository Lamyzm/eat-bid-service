/** @module 책임: 설정 route에서 세션 gating과 복귀 경로 검증을 Suspense 안 loader로 격리하고 화면 상태 소유는 client에 넘긴다. */
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { getCurrentSessionFromServer } from '@/api/account/server';
import {
  RETURN_PATH_PARAMETER,
  isSameAppReturnPath,
  loginRouteWithReturn
} from '@/shell/auth/return-path';

import { SetupScreen } from './_ui/setup-screen';
import { SetupScreenSkeleton } from './_ui/setup-screen-skeleton';

type SetupSearchParams = PageProps<'/setup'>['searchParams'];

async function SetupLoader({ searchParams }: { readonly searchParams: SetupSearchParams }) {
  const search = await searchParams;
  const requested = search[RETURN_PATH_PARAMETER];
  // 돌아갈 경로는 화면에 닿기 전에 좁힌다. 검증을 client로 미루면 검증 전 값이 한 번은 렌더 트리에 실린다.
  const returnPath = isSameAppReturnPath(requested) ? requested : undefined;
  const read = await getCurrentSessionFromServer();
  // web guard는 UX이고 권위는 Nest guard다. 여기서 보내지 못한 요청도 개인 자료를 받지 못한다(ADR 0032 §1).
  if (read.kind === 'session' && read.response.state === 'unauthenticated') {
    redirect(loginRouteWithReturn(returnPath ?? '/setup'));
  }
  return <SetupScreen returnPath={returnPath} />;
}

export default function SetupPage({ searchParams }: PageProps<'/setup'>) {
  return (
    <Suspense fallback={<SetupScreenSkeleton />}>
      <SetupLoader searchParams={searchParams} />
    </Suspense>
  );
}
