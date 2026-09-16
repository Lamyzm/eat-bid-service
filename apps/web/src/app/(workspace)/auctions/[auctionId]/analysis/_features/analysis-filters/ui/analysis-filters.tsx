/** @module 책임: 상세에 항상 보이는 공통 비교조건과 초안 적용·오류 안내를 조립한다. */
'use client';
import { Button } from '@/shared/ui/button';
import { LoadingButton } from '@/shared/ui/loading-button';
import { useAnalysisFilters } from '../model/use-analysis-filters';
import type { AnalysisFilterSetup, AppliedAnalysis } from '../model/analysis-filter-types';
import { AnalysisConditionFields, AnalysisDateFields } from './analysis-filter-fields';

export function AnalysisFilters({
  setup,
  applied
}: {
  readonly setup: AnalysisFilterSetup;
  readonly applied: AppliedAnalysis;
}) {
  const form = useAnalysisFilters(setup, applied);
  const fields = {
    setup,
    draft: form.draft,
    errors: form.errors,
    change: form.change,
    changeComparison: form.changeComparison
  };
  return (
    <form
      aria-label='기관과 지역 비교조건'
      noValidate
      className='analysis-filter-form'
      onSubmit={(event) => {
        event.preventDefault();
        const element = event.currentTarget;
        if (!form.apply())
          requestAnimationFrame(() =>
            element.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
          );
      }}
    >
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <div role='group' aria-label='조회 기간' className='flex flex-wrap items-center gap-1 pb-1'>
          <span className='mr-3 text-xs text-muted-foreground'>조회 기간</span>
          {setup.presets.map((preset) => (
            <Button
              type='button'
              key={preset.value}
              size='sm'
              variant='ghost'
              disabled={preset.period === null}
              title={preset.period === null ? '보유기간 확인 후 선택할 수 있어요' : undefined}
              aria-pressed={
                preset.period !== null &&
                preset.period.from === form.draft.from &&
                preset.period.to === form.draft.to
              }
              className='aria-pressed:bg-primary/10 aria-pressed:text-primary'
              onClick={() => form.selectPreset(preset.value)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
        <AnalysisDateFields {...fields} />
      </div>
      <AnalysisConditionFields {...fields} />
      <div className='flex flex-wrap items-center justify-between gap-x-4 gap-y-2'>
        <div className='flex flex-wrap items-center gap-3 text-xs text-muted-foreground'>
          <span>품목은 이 기관에만 적용 · 비교군은 전체 품목</span>
          <details className='analysis-filter-help'>
            <summary className='cursor-pointer underline underline-offset-4'>조건 안내</summary>
            <div className='mt-2 grid gap-1 leading-relaxed'>
              <p>날짜는 한국 시간 기준이며 시작일과 종료일을 포함해요.</p>
              <p>명단은 철회 포함 관측 행 수예요. 최소·최대 중 한쪽만 입력할 수도 있어요.</p>
              <p>현재 공고에서 확인된 지역·하한율·낙찰방식을 선택할 수 있어요.</p>
              <p>전 기간은 보유기간 확인 후 열려요. 기관 품목별 조회는 준비 중이에요.</p>
            </div>
          </details>
        </div>
        <div className='flex items-center gap-2'>
          <Button type='button' variant='ghost' size='sm' onClick={form.reset}>
            조건 초기화
          </Button>
          <LoadingButton
            type='submit'
            size='sm'
            loading={form.pending}
            loadingLabel='비교조건 적용 중'
          >
            조건 적용
          </LoadingButton>
        </div>
      </div>
      {form.errors.form ? (
        <p role='alert' className='text-xs text-destructive'>
          {form.errors.form}
        </p>
      ) : null}
      {applied.state === 'invalid' ? (
        <p role='alert' className='text-xs text-destructive'>
          {applied.message}
        </p>
      ) : null}
      {form.dirty ? (
        <p role='status' className='text-xs text-primary'>
          조건을 수정했어요. 적용하면 아래 분석과 이력이 함께 바뀌어요.
        </p>
      ) : null}
    </form>
  );
}
