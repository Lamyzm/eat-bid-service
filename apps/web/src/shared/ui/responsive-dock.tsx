/** @module 책임: 같은 보조 내용을 넓은 화면에서는 본문 옆에, 좁은 화면에서는 접근 가능한 Sheet로 배치한다. */
'use client';
import type { ReactNode } from 'react';
import { useWideWorkspace } from '@/shared/lib/use-wide-workspace';
import { Button } from './button';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from './sheet';
import { IconX } from './workspace-icons';

export function ResponsiveDock({
  open,
  title,
  onClose,
  returnFocus,
  children
}: {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly returnFocus?: () => HTMLElement | null;
}) {
  const wide = useWideWorkspace();
  if (!wide)
    return (
      <Sheet
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose();
        }}
      >
        <SheetContent
          keepMounted
          hidden={!open}
          finalFocus={returnFocus}
          showCloseButton={false}
          className='w-[min(380px,calc(100vw-16px))] gap-0 overflow-y-auto'
        >
          <SheetHeader className='flex-row items-center justify-between border-b'>
            <SheetTitle>{title}</SheetTitle>
            <Button variant='ghost' size='icon' aria-label='보조 패널 닫기' onClick={onClose}>
              <IconX />
            </Button>
            <SheetDescription className='sr-only'>
              닫으면 보고 있던 분석 화면으로 돌아갑니다.
            </SheetDescription>
          </SheetHeader>
          {children}
        </SheetContent>
      </Sheet>
    );
  return (
    <section
      data-slot='responsive-dock'
      hidden={!open}
      aria-label={title}
      className='min-w-0 rounded-xl border border-border bg-card'
    >
      <header className='flex items-center justify-between border-b px-3 py-2'>
        <h2 className='text-base font-semibold'>{title}</h2>
        <Button variant='ghost' size='icon' aria-label='보조 패널 닫기' onClick={onClose}>
          <IconX />
        </Button>
      </header>
      {children}
    </section>
  );
}
