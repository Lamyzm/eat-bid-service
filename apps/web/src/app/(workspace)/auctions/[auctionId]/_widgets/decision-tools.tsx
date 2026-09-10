/** @module 책임: 현재 공고와 선택 회차에 대한 진입을 공고 본문·좁은 상단 메뉴·넓은 도구 줄 세 자리에서 제공하고 모두 같은 전역 오른쪽 패널을 연다. */
'use client';
import { useRef } from 'react';
import { Button } from '@/shared/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/shared/ui/dropdown-menu';
import {
  IconFileDescription,
  IconHistory,
  IconLayoutSidebarRight
} from '@/shared/ui/workspace-icons';
import { useAttemptSelection } from '../_lib/attempt-selection';

export function DecisionTools({ placement }: { readonly placement: 'top' | 'rail' }) {
  const { attempt, panel, openCurrent, openRecord, close, setReturnFocus } = useAttemptSelection();
  const trigger = useRef<HTMLButtonElement>(null);
  if (placement === 'top')
    return (
      <div data-slot='decision-tools-top'>
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button ref={trigger} variant='outline' />}>
            <IconLayoutSidebarRight />
            상세 보기
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='min-w-44'>
            <DropdownMenuItem
              onClick={() => {
                openCurrent();
                setReturnFocus(trigger.current);
              }}
            >
              현재 공고 정보
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!attempt}
              onClick={() => {
                openRecord();
                setReturnFocus(trigger.current);
              }}
            >
              선택 회차 기록
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  return (
    <nav data-slot='decision-tool-rail' aria-label='공고 도구' className='grid gap-2'>
      <Button
        variant={panel === 'current' ? 'secondary' : 'ghost'}
        aria-label='현재 공고 정보'
        aria-expanded={panel === 'current'}
        onClick={panel === 'current' ? close : openCurrent}
      >
        <IconFileDescription />
        <span>공고</span>
      </Button>
      <Button
        variant={panel === 'record' ? 'secondary' : 'ghost'}
        disabled={!attempt}
        aria-label='선택 회차 기록'
        aria-expanded={panel === 'record'}
        onClick={panel === 'record' ? close : openRecord}
      >
        <IconHistory />
        <span>기록</span>
      </Button>
    </nav>
  );
}

/**
 * 공고 본문 안의 진입이다. 도구 줄·상단 메뉴와 같은 `openCurrent()`를 부르므로 어느 자리에서 눌러도
 * 같은 전역 오른쪽 패널이 열리고, 초점은 누른 버튼으로 돌아온다(EAT-115).
 */
export function CurrentAuctionInfoButton() {
  const { panel, openCurrent, close, setReturnFocus } = useAttemptSelection();
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Button
      ref={trigger}
      variant='outline'
      size='sm'
      aria-expanded={panel === 'current'}
      onClick={() => {
        if (panel === 'current') {
          close();
          return;
        }
        openCurrent();
        setReturnFocus(trigger.current);
      }}
    >
      이 공고 정보
    </Button>
  );
}
