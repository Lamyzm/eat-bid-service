/** @module 책임: 비교할 회차의 명단 규모 하한·상한을 여닫이 한 칸으로 접고 닫힌 상태에서 요약한다. */
'use client';
import { useId } from 'react';
import { Input } from '@/shared/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import type { AnalysisDraft, AnalysisDraftErrors, AnalysisTextField } from '../model/analysis-filter-types';

/** 닫힌 상태가 말해야 하는 것은 "지금 몇 곳짜리 회차를 보고 있나"다. 빈 칸 두 개는 그 말을 못 한다. */
function listCountSummary(min: string, max: string): string {
  if (min === '' && max === '') return '전체';
  if (min === '') return `${max}곳 이하`;
  if (max === '') return `${min}곳 이상`;
  return `${min}~${max}곳`;
}

/**
 * 명단 규모는 최소·최대 두 칸이 한 조건이다. 두 칸을 조건 막대에 늘 펼쳐 두면 라벨까지 170px을
 * 상시 쓰는데, 이 조건은 기본값(전체)으로 두고 거의 건드리지 않는다. 자주 안 고치는 조건이 자주 보는
 * 차트를 밀어내지 않도록 닫아 둔다.
 */
export function AnalysisListCountField({
  draft,
  errors,
  change,
  commit
}: {
  readonly draft: AnalysisDraft;
  readonly errors: AnalysisDraftErrors;
  readonly change: (field: AnalysisTextField, value: string) => void;
  readonly commit: () => void;
}) {
  const id = useId();
  const error = errors.min ?? errors.max;
  const summary = listCountSummary(draft.min, draft.max);
  return (
    <Popover>
      <PopoverTrigger
        className='w-26 justify-start'
        aria-label={`명단 ${summary}`}
        aria-invalid={error !== undefined}
      >
        <span className='text-xs text-muted-foreground'>명단</span>
        <span className='min-w-0 flex-1 truncate text-left'>{summary}</span>
      </PopoverTrigger>
      <PopoverContent className='w-64'>
        {/*
          패널 안에서도 두 칸은 한 조건이라 한 묶음으로 세운다. 이름은 칸마다 남겨 어느 끝인지 말한다.
        */}
        <div role='group' aria-labelledby={`${id}-label`} className='flex flex-col gap-1.5'>
          <span id={`${id}-label`} className='text-xs text-muted-foreground'>
            명단 규모
          </span>
          <div className='flex items-center gap-1.5'>
            <Input
              name='min'
              inputMode='numeric'
              value={draft.min}
              placeholder='최소'
              aria-label='명단 최소'
              aria-invalid={!!errors.min}
              aria-describedby={error === undefined ? undefined : `${id}-error`}
              onChange={(event) => change('min', event.target.value)}
              onBlur={commit}
              className='h-8 w-20'
            />
            <span aria-hidden className='text-xs text-muted-foreground'>
              ~
            </span>
            <Input
              name='max'
              inputMode='numeric'
              value={draft.max}
              placeholder='최대'
              aria-label='명단 최대'
              aria-invalid={!!errors.max}
              aria-describedby={error === undefined ? undefined : `${id}-error`}
              onChange={(event) => change('max', event.target.value)}
              onBlur={commit}
              className='h-8 w-20'
            />
            <span className='text-xs text-muted-foreground'>곳</span>
          </div>
          {error === undefined ? (
            <p className='text-xs text-muted-foreground'>비우면 규모를 안 가려요.</p>
          ) : (
            <p id={`${id}-error`} role='alert' className='text-xs text-destructive'>
              {error}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
