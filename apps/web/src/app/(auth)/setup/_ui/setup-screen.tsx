/** @module 책임: 세션 상태에 따라 설정 화면의 시작하기·등록 관리·재로그인 안내 중 하나만 렌더한다. */
'use client';

import Link from 'next/link';

import type { CurrentSessionV1Response } from '@/api/account';
import { useAccountSession } from '@/capabilities/account';
import { Alert, AlertDescription, AlertTitle } from '@/shared/ui/alert';
import { Button, buttonVariants } from '@/shared/ui/button';
import { isAuctionReturn, loginRouteWithReturn, returnRoute } from '@/shell/auth/return-path';

import { RegionPreferenceCard } from '../_features/region-preference/ui/region-preference-card';
import { AccountInitialization } from './account-initialization';
import { MyBusinessesPanel } from './my-businesses-panel';
import { SetupScreenSkeleton } from './setup-screen-skeleton';

interface SetupScreenProps {
  /** 서버가 이미 같은 앱 상대 경로로 좁힌 값이다. 없으면 돌아갈 곳을 만들지 않는다. */
  readonly returnPath?: string;
  /** loader가 redirect 판정에 쓴 그 답이다. 브라우저가 같은 조회를 다시 보내지 않게 첫 값으로 넘긴다. */
  readonly initialSession?: CurrentSessionV1Response;
}

function SetupFrame({ children }: { readonly children: React.ReactNode }) {
  return (
    <div
      data-slot='setup-screen'
      role='region'
      aria-labelledby='setup-title'
      className='mx-auto grid w-full max-w-2xl gap-4 px-3 py-6 sm:px-4'
    >
      <header>
        <h1 id='setup-title' className='text-xl font-semibold'>내 설정</h1>
        <p className='text-sm text-muted-foreground'>
          여기서 정한 것이 오늘 화면에 무엇이 보일지를 정합니다.
        </p>
      </header>
      {children}
    </div>
  );
}

/**
 * 보던 화면으로 돌아가는 명시적 출구다. 설정을 마쳤는지와 무관하게 언제든 돌아갈 수 있어야 한다.
 * 의미가 탐색이므로 button primitive로 감싸지 않는다. 감싸면 보조 기술에 button으로 읽힌다.
 */
function ReturnLink({ returnPath }: { readonly returnPath: string }) {
  return (
    <div>
      <Link href={returnRoute(returnPath)} className={buttonVariants({ variant: 'outline' })}>
        {isAuctionReturn(returnPath) ? '공고로 돌아가기' : '돌아가기'}
      </Link>
    </div>
  );
}

export function SetupScreen({ returnPath, initialSession }: SetupScreenProps) {
  const view = useAccountSession(initialSession);

  if (view.error != null) {
    return (
      <SetupFrame>
        <Alert variant='destructive'>
          <AlertTitle>저장된 정보를 불러오지 못했습니다</AlertTitle>
          <AlertDescription>다시 시도해 주세요.</AlertDescription>
        </Alert>
        <div>
          <Button onClick={() => view.refetch()}>다시 시도</Button>
        </div>
      </SetupFrame>
    );
  }

  if (view.isPending || view.session === undefined) {
    return <SetupScreenSkeleton />;
  }

  if (view.session.state === 'unauthenticated') {
    return (
      <SetupFrame>
        <Alert>
          <AlertTitle>로그인이 필요합니다</AlertTitle>
          <AlertDescription>다시 로그인해 주세요.</AlertDescription>
        </Alert>
        <div>
          <Link href={loginRouteWithReturn(returnPath ?? '/setup')} className={buttonVariants()}>
            로그인 화면으로
          </Link>
        </div>
      </SetupFrame>
    );
  }

  const accountLabel =
    view.session.account.displayName ?? view.session.account.maskedEmail ?? '이';

  if (view.session.state === 'uninitialized') {
    return (
      <SetupFrame>
        <AccountInitialization accountLabel={accountLabel} />
        {returnPath === undefined ? null : <ReturnLink returnPath={returnPath} />}
      </SetupFrame>
    );
  }

  return (
    <SetupFrame>
      <MyBusinessesPanel
        scope={{
          principalId: view.session.principalId,
          workspaceId: view.session.workspace.workspaceId
        }}
        canWrite={view.session.workspace.role === 'owner'}
      />
      <RegionPreferenceCard
        scope={{
          principalId: view.session.principalId,
          workspaceId: view.session.workspace.workspaceId
        }}
        canWrite={view.session.workspace.role === 'owner'}
      />
      {returnPath === undefined ? null : <ReturnLink returnPath={returnPath} />}
    </SetupFrame>
  );
}
