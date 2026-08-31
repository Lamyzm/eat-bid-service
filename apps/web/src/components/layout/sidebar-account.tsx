'use client';
/**
 * 사이드바 하단 계정 허브 — "나에 관한 것" 한자리 (스타터 user-nav 자리)
 * 헤더에 흩어져 있던 이메일·로그아웃을 여기로 통합한다 (헤더는 최소로).
 */
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useSession } from '@/lib/session';
import { signInGoogle, signOut } from '@/lib/auth-client';
import { openGlobalSettings } from '@/components/global-settings';
import { Icons } from '@/components/icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar';

export function SidebarAccount() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { ready, guest, user, googleEnabled, bizNos, bizNames } = useSession();

  const title = !ready ? '계정'
    : guest ? '게스트'
    : (user?.name || user?.email || '내 계정');
  const firmLine = bizNos.length
    ? bizNos.map(b => bizNames[b] ?? b).join(' · ')
    : '사업자 미등록';

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size='lg'
                className='data-popup-open:bg-sidebar-accent data-popup-open:text-sidebar-accent-foreground'
              />
            }
          >
            <Icons.account className='size-5 shrink-0' />
            <span className='grid min-w-0 flex-1 text-left leading-tight'>
              <span className='truncate text-sm font-medium'>{title}</span>
              <span className='text-muted-foreground truncate text-xs'>{firmLine}</span>
            </span>
            <Icons.chevronsUpDown className='ml-auto size-4' />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className='w-(--anchor-width) min-w-56 rounded-lg'
            side='top'
            align='start'
            sideOffset={4}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className='p-0 font-normal'>
                <div className='px-2 py-1.5'>
                  <div className='text-sm font-medium'>{title}</div>
                  <div className='text-muted-foreground truncate text-xs'>
                    {guest ? '이 브라우저에만 저장됩니다' : (user?.email ?? '')}
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => router.push('/dashboard/my')}>
                <Icons.user className='mr-2 size-4' /> 내 사업자
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openGlobalSettings()}>
                <Icons.settings className='mr-2 size-4' /> 전역 설정 (지역·품목)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>
                <Icons.sun className='mr-2 size-4' /> {resolvedTheme === 'dark' ? '라이트 모드' : '다크 모드'}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {guest ? (
                googleEnabled && (
                  <DropdownMenuItem onClick={() => void signInGoogle()}>
                    <Icons.login className='mr-2 size-4' /> Google로 로그인
                  </DropdownMenuItem>
                )
              ) : (
                <>
                  <DropdownMenuItem onClick={() => void signOut(false)}>
                    <Icons.logout className='mr-2 size-4' /> 로그아웃 (기록 유지)
                  </DropdownMenuItem>
                  <DropdownMenuItem variant='destructive' onClick={() => void signOut(true)}>
                    <Icons.trash className='mr-2 size-4' /> 로그아웃 + 이 브라우저 기록 삭제
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
