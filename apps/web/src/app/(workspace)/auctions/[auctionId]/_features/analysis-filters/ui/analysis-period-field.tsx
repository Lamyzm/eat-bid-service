/** @module 책임: 조회 기간의 시작일·종료일을 여닫이 한 칸으로 접고 닫힌 상태에서 범위를 글로 말한다. */
'use client';
import { useId } from 'react';
import { Input } from '@/shared/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/shared/ui/popover';
import type { AnalysisDraft, AnalysisDraftErrors, AnalysisTextField } from '../model/analysis-filter-types';

function dotted(value: string): string {
  return value.replaceAll('-', '.');
}

/**
 * 날짜 두 칸을 나란히 두면 라벨까지 400px을 쓰고, 그 폭 때문에 뒤 조건이 통째로 다음 줄로 밀린다
 * (2026-09-18 1024px 실측: 20px 차이로 `종료일`이 넘어갔다). 조건 막대는 sticky라 한 줄이 늘 때마다
 * 차트가 40px씩 화면 밖으로 나간다. 그래서 닫힌 상태는 범위를 말하는 글 한 줄만 쓰고 고치는 칸은
 * 패널 안에 둔다.
 */
function rangeText(from: string, to: string): string {
  if (from === '' && to === '') return '전 기간';
  if (from === '') return `~ ${dotted(to)}`;
  if (to === '') return `${dotted(from)} ~`;
  return `${dotted(from)} – ${dotted(to)}`;
}

export function AnalysisPeriodField({
  draft,
  errors,
  change
}: {
  readonly draft: AnalysisDraft;
  readonly errors: AnalysisDraftErrors;
  readonly change: (field: AnalysisTextField, value: string) => void;
}) {
  const id = useId();
  const summary = rangeText(draft.from, draft.to);
  const error = errors.from ?? errors.to;
  return (
    <Popover>
      {/*
        라벨을 칸 안에 넣지 않는다. 이 칸은 `조회 기간` 줄 안에 서므로 줄 라벨이 이미 무엇을 고르는지
        말한다. 화면 낭독기에는 줄 이름이 함께 읽히지 않으므로 이름만 따로 갖춘다.
      */}
      <PopoverTrigger
        className='w-56 justify-start'
        aria-label={`조회 기간 ${summary}`}
        aria-invalid={error !== undefined}
      >
        <span className='min-w-0 flex-1 truncate text-left tabular-nums'>{summary}</span>
      </PopoverTrigger>
      <PopoverContent className='w-60'>
        <div className='flex flex-col gap-2'>
          <label className='flex flex-col gap-1 text-xs text-muted-foreground' htmlFor={`${id}-from`}>
            시작일
            <Input
              id={`${id}-from`}
              name='from'
              type='date'
              value={draft.from}
              aria-invalid={!!errors.from}
              aria-describedby={error === undefined ? undefined : `${id}-error`}
              onChange={(event) => change('from', event.target.value)}
              className='h-8 w-full'
            />
          </label>
          <label className='flex flex-col gap-1 text-xs text-muted-foreground' htmlFor={`${id}-to`}>
            종료일
            <Input
              id={`${id}-to`}
              name='to'
              type='date'
              value={draft.to}
              aria-invalid={!!errors.to}
              aria-describedby={error === undefined ? undefined : `${id}-error`}
              onChange={(event) => change('to', event.target.value)}
              className='h-8 w-full'
            />
          </label>
          {error === undefined ? null : (
            <p id={`${id}-error`} role='alert' className='text-xs text-destructive'>
              {error}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
