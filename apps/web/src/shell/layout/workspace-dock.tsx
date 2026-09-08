/** @module 책임: 페이지와 독립된 전역 바로가기와 화면이 주입하는 맥락 도구의 표시 자리를 조립한다. */
'use client';
import { Button } from '@/shared/ui/button';
import { DockSlotHost } from '@/shared/ui/workspace-dock-slots';
import {
  IconHeart,
  IconClock,
  IconBriefcase,
  IconLayoutSidebarRight
} from '@/shared/ui/workspace-icons';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/shared/ui/dropdown-menu';

// 사용자 상태 계약이 연결되기 전에는 목록 조회 성공이나 저장 가능 상태를 연출하지 않는다.
const shortcuts = [
  { label: '관심', icon: IconHeart },
  { label: '최근 본', icon: IconClock },
  { label: '내 공고', icon: IconBriefcase }
] as const;

export function WorkspaceToolRail() {
  return (
    <aside data-slot='workspace-tool-rail' aria-label='전역 바로가기'>
      <nav aria-label='개인 바로가기' className='grid gap-2'>
        {shortcuts.map(({ label, icon: Icon }) => (
          <Button
            key={label}
            variant='ghost'
            disabled
            aria-label={`${label} (준비 중)`}
            title={`${label} · 준비 중`}
          >
            <Icon />
            <span>{label}</span>
          </Button>
        ))}
      </nav>
      <DockSlotHost slot='rail' />
    </aside>
  );
}

export function WorkspaceHeaderTools() {
  return (
    <div data-slot='workspace-header-tools'>
      <DockSlotHost slot='header' />
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant='ghost' size='icon' aria-label='바로가기' />}>
          <IconLayoutSidebarRight />
        </DropdownMenuTrigger>
        <DropdownMenuContent align='end'>
          {shortcuts.map(({ label, icon: Icon }) => (
            <DropdownMenuItem key={label} disabled>
              <Icon />
              {label}
              <span className='ml-auto text-xs'>준비 중</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
