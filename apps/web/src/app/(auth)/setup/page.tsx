/**
 * @module 책임: 설정 route에서 세션 gating과 복귀 경로 검증을 Suspense 안 loader로 격리하고, 첫 페인트에
 * 필요한 세션·등록 사업자를 서버에서 읽어 브라우저 캐시로 넘긴 뒤 화면 상태 소유는 client에 넘긴다.
 */
import { HydrationBoundary } from '@tanstack/react-query';
import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import {
  getCurrentSessionFromServer,
  listMyBusinessesFromServer,
  myBusinessesCacheKey
} from '@/api/account/server';
import type { CurrentSessionV1Response } from '@/api/account';
import {
  RETURN_PATH_PARAMETER,
  isSameAppReturnPath,
  loginRouteWithReturn
} from '@/shell/auth/return-path';
import { dehydrateServerReads } from '@/shell/providers/server-hydration';

import { SetupScreen } from './_ui/setup-screen';
import { SetupScreenSkeleton } from './_ui/setup-screen-skeleton';

type SetupPageProps = PageProps<'/setup'>;

/**
 * 활성 세션에서만 목록을 읽는다. 초기화가 끝나지 않은 계정에는 워크스페이스가 없어 목록을 담을 캐시
 * 자리 자체가 없고, 그 화면이 요구하는 것은 목록이 아니라 시작 command 하나다.
 *
 * key는 조회를 소유한 query factory에서 온다. 여기서 새로 적으면 등록·주소 변경 뒤의 무효화가 다른
 * 자리를 지워 화면이 옛 목록에 머문다.
 */
async function hydratedBusinesses(session: CurrentSessionV1Response) {
  if (session.state !== 'active') return undefined;
  const read = await listMyBusinessesFromServer();
  if (read.kind === 'unread') return undefined;
  const scope = {
    principalId: session.principalId,
    workspaceId: session.workspace.workspaceId
  };
  return dehydrateServerReads([
    { queryKey: myBusinessesCacheKey(scope), data: read.response }
  ]);
}

async function SetupLoader({ searchParams }: { readonly searchParams: SetupPageProps['searchParams'] }) {
  const search = await searchParams;
  const requested = search[RETURN_PATH_PARAMETER];
  // 돌아갈 경로는 화면에 닿기 전에 좁힌다. 검증을 client로 미루면 검증 전 값이 한 번은 렌더 트리에 실린다.
  const returnPath = isSameAppReturnPath(requested) ? requested : undefined;
  const read = await getCurrentSessionFromServer();
  // web guard는 UX이고 권위는 Nest guard다. 여기서 보내지 못한 요청도 개인 자료를 받지 못한다(ADR 0032 §1).
  if (read.kind === 'session' && read.response.state === 'unauthenticated') {
    redirect(loginRouteWithReturn(returnPath ?? '/setup'));
  }
  const session = read.kind === 'session' ? read.response : undefined;
  return (
    <HydrationBoundary state={session === undefined ? undefined : await hydratedBusinesses(session)}>
      <SetupScreen returnPath={returnPath} initialSession={session} />
    </HydrationBoundary>
  );
}

export default function SetupPage({ searchParams }: SetupPageProps) {
  return (
    <Suspense fallback={<SetupScreenSkeleton />}>
      <SetupLoader searchParams={searchParams} />
    </Suspense>
  );
}
