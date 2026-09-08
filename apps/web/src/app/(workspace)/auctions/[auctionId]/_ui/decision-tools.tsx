/** @module 책임: 현재 공고와 선택 회차에 대한 진입을 좁은 상단 메뉴와 넓은 도구 줄로 제공한다. */
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
import { useAttemptSelection } from './attempt-selection';
import type { DecisionPresentation } from '../_model/present-decision';

export function DecisionTools({ placement }: { readonly placement: 'top' | 'rail' }) {
  const { row, panel, openCurrent, openRecord, close, setReturnFocus } = useAttemptSelection();
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
              disabled={!row}
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
    <nav data-slot='decision-tool-rail' aria-label='공고 도구'>
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
        disabled={!row}
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

export function CurrentAuctionFacts({ decision }: { readonly decision: DecisionPresentation }) {
  return (
    <section aria-label='현재 공고 사실' className='border-b px-4 py-3'>
      <h3 className='mb-3 text-sm font-semibold break-keep wrap-anywhere'>
        {decision.identity.title}
      </h3>
      <dl className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm'>
        {(
          [
            ['공고 지역', decision.locationText],
            ['품목', decision.itemLabelText],
            ['기초금액', `${decision.baseAmount.text}원`],
            ['하한율', decision.floorRateText],
            ['마감 (KST)', decision.banner.deadlineAt],
            ['개찰 (KST)', decision.banner.openedAt]
          ] as const
        ).map(([label, value]) => (
          <div key={label} className='contents'>
            <dt className='text-muted-foreground'>{label}</dt>
            <dd className='m-0 text-right break-keep wrap-anywhere tabular-nums'>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
