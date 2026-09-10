/** @module 책임: 전역 명령 palette를 여는 접근 가능한 검색형 trigger를 제공한다. */
'use client';
import { useCommandPalette } from './context';
import { Icons } from '@/shared/ui/icons';
import { Button } from '@/shared/ui/button';

/**
 * 아직 어떤 화면에도 mount하지 않는다. 현재 palette를 여는 수단은 Cmd/Ctrl+K뿐이고, 이 trigger를 header에
 * 붙이는 것은 모든 업무 화면의 header가 바뀌는 제품 결정이라 배치 정리(EAT-148)와 같은 변경에서 하지 않는다.
 * palette가 마우스로도 열려야 한다고 정하는 issue가 이 component를 header slot에 넣는다.
 */
export default function SearchInput() {
  const { openPalette } = useCommandPalette();
  return (
    <div className='w-full space-y-2'>
      <Button
        variant='outline'
        aria-label='명령 검색'
        className='bg-background text-muted-foreground relative h-9 w-full justify-start rounded-[0.5rem] text-sm font-normal shadow-none sm:pr-12 md:w-40 lg:w-64'
        onClick={openPalette}
      >
        <Icons.search className='mr-2 h-4 w-4' />
        명령 검색...
        <kbd className='bg-muted pointer-events-none absolute top-[0.3rem] right-[0.3rem] hidden h-6 items-center gap-1 rounded border px-1.5 font-mono text-[10px] font-medium opacity-100 select-none sm:flex'>
          <span className='text-xs'>⌘</span>K
        </kbd>
      </Button>
    </div>
  );
}
