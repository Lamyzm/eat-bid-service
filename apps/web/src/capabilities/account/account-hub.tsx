/** @module 책임: 사이드바 계정 슬롯에서 세션 상태를 그대로 보여 주고 로그인·설정·로그아웃 진입만 제공한다. */
'use client';

import { useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Suspense, useState } from 'react';
import { toast } from 'sonner';

import {
  isAccountDependencyUnavailableError,
  type CurrentSessionV1Response
} from '@/api/account';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuLinkItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/shared/ui/dropdown-menu';
import { IconLogin, IconLogout, IconSettings } from '@/shared/ui/workspace-icons';
import { isProviderAuthError, signInWithGoogle } from '@/shell/auth/auth-client';
import { setupRouteWithReturn } from '@/shell/auth/return-path';
import { AccountSlotFace } from './account-slot-face';
import { useAccountSession, signOutAndDiscardAccountCache } from './use-account-session';

/** 화면 문구는 세션 계약의 상태를 그대로 옮긴다. 여기서 새 역할 판정을 만들지 않는다(ADR 0032 §5). */
function accountTitle(view: ReturnType<typeof useAccountSession>): string {
  if (isAccountDependencyUnavailableError(view.error)) return '지금은 로그인할 수 없음';
  if (view.error != null) return '계정 확인 실패';
  if (view.isPending || view.session === undefined) return '계정 확인 중';
  if (view.session.state === 'unauthenticated') return '로그인하지 않음';
  return view.session.account.displayName ?? view.session.account.maskedEmail ?? '내 계정';
}

function accountDetail(view: ReturnType<typeof useAccountSession>): string {
  if (view.error != null) return '잠시 뒤 다시 시도해 주세요';
  if (view.isPending || view.session === undefined) return '';
  if (view.session.state === 'unauthenticated') return 'Google 계정으로 로그인합니다';
  if (view.session.state === 'uninitialized') return '사업자 등록이 남았습니다';
  return view.session.workspace.name;
}

/**
 * `usePathname`은 dynamic param route의 static shell을 만드는 동안 suspend한다(ADR 0028). 읽기를 leaf로
 * 내려 계정 슬롯 자체는 prerender하고 돌아갈 경로만 request 시점에 streaming한다.
 */
interface AccountHubProps {
  /** layout이 서버에서 읽어 넘긴 같은 요청의 세션이다. 없으면 브라우저가 직접 묻는다. */
  readonly initialSession?: CurrentSessionV1Response;
}

export function AccountHub({ initialSession }: AccountHubProps) {
  return (
    <Suspense fallback={<AccountMenu initialSession={initialSession} />}>
      <CurrentPathAccountMenu initialSession={initialSession} />
    </Suspense>
  );
}

function CurrentPathAccountMenu({ initialSession }: AccountHubProps) {
  const pathname = usePathname();
  // 보던 화면에서 계정 설정으로 갔다가 그대로 돌아오게 한다. 값은 받는 쪽에서 한 번 더 판정한다.
  return (
    <AccountMenu
      returnPath={pathname === '/setup' ? undefined : pathname}
      initialSession={initialSession}
    />
  );
}

function AccountMenu({
  returnPath,
  initialSession
}: AccountHubProps & { readonly returnPath?: string }) {
  const view = useAccountSession(initialSession);
  const client = useQueryClient();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const unavailable = isAccountDependencyUnavailableError(view.error);
  const signedIn = view.session?.state === 'active' || view.session?.state === 'uninitialized';

  async function login() {
    setPending(true);
    try {
      await signInWithGoogle(returnPath);
    } catch {
      toast.error('Google 로그인을 시작하지 못했습니다.');
      setPending(false);
    }
  }

  async function logout() {
    setPending(true);
    try {
      await signOutAndDiscardAccountCache(client);
      // 이전 계정으로 렌더된 RSC와 router 상태를 남기지 않는다.
      router.refresh();
    } catch (error) {
      // provider 호출이 실패했을 때만 로그아웃 자체가 안 됐다고 말한다. 그 뒤 단계의 실패는 로그아웃
      // 여부를 말해 주지 않으므로 확인하지 못했다고만 한다. 네트워크 실패도 세션 생존을 보장하지 않는다.
      toast.error(
        isProviderAuthError(error)
          ? '로그아웃하지 못했습니다. 다시 시도해 주세요.'
          : '로그아웃을 확인하지 못했습니다. 화면을 새로 고쳐 주세요.'
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant='ghost' className='h-12 w-full justify-start px-2' />}
        aria-label='계정 메뉴'
      >
        <AccountSlotFace title={accountTitle(view)} detail={accountDetail(view)} alert={unavailable} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className='w-(--anchor-width) min-w-56 rounded-lg' side='top' align='start'>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{accountTitle(view)}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLinkItem
            closeOnClick
            render={<Link href={setupRouteWithReturn(returnPath)} aria-label='내 사업자 설정' />}
          >
            <IconSettings /> 내 사업자 설정
          </DropdownMenuLinkItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          {signedIn ? (
            <DropdownMenuItem disabled={pending} onClick={() => void logout()}>
              <IconLogout /> 로그아웃
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem disabled={pending || unavailable} onClick={() => void login()}>
              <IconLogin /> Google로 로그인
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
