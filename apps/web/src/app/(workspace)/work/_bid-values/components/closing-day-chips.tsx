/**
 * @module 책임: 내일부터의 마감일 칩 줄을 그린다. 칩은 꺾지 않고 좁으면 옆으로 밀며, 주가 바뀌는 자리에 구분선을 긋는다. 어느 칩을
 * 골랐는지는 부모가 소유한다.
 */
import { Fragment } from 'react';

import { formatCount } from '@/shared/lib/number-format';
import { cn } from '@/shared/lib/cn';

import type { ClosingDay } from '../utils/work-board';

export function ClosingDayChips({
  days,
  selected,
  onSelect
}: {
  readonly days: readonly ClosingDay[];
  readonly selected: string;
  readonly onSelect: (key: string) => void;
}) {
  return (
    <div role='group' aria-label='마감일' className='-mx-1 flex gap-2 overflow-x-auto px-1 pb-0.5'>
      {days.map((day) => {
        const current = day.key === selected;
        return (
          <Fragment key={day.key}>
            {day.weekBreak ? (
              <span aria-hidden className='mx-1.5 my-1.5 w-px shrink-0 self-stretch bg-line' />
            ) : null}
            <button
              type='button'
              // 칩은 하나만 고르는 자리라 켜고 끄는 토글(aria-pressed)이 아니라 지금 고른 것(aria-current)이다.
              aria-current={current ? 'true' : undefined}
              onClick={() => onSelect(day.key)}
              className={cn(
                'pressable grid shrink-0 rounded-control px-3.5 py-2.25 text-left',
                current ? 'bg-foreground text-card' : 'bg-card hover:bg-muted'
              )}
            >
              <span className='text-body font-bold whitespace-nowrap'>{day.label}</span>{' '}
              <span className={cn('text-label tabular-nums', current ? 'text-card' : 'text-ink-3')}>
                {formatCount(day.count)}
              </span>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}
