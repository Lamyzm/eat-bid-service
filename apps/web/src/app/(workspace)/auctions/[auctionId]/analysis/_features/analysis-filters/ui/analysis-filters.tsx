/** @module 책임: 상세에 항상 보이는 공통 비교조건을 한 줄로 조립하고 고르는 즉시 적용한다. */
'use client';
import { Button } from '@/shared/ui/button';
import { useAnalysisFilters } from '../model/use-analysis-filters';
import type { AnalysisFilterSetup, AppliedAnalysis } from '../model/analysis-filter-types';
import { AnalysisConditionFields, AnalysisDateFields } from './analysis-filter-fields';

/**
 * 조건은 고르는 즉시 적용된다. `조건 적용` 버튼을 두면 버튼 줄 하나와 "수정했어요" 안내 줄 하나가
 * 늘 자리를 차지하고, 그만큼 결과가 화면 밖으로 밀린다. 누르지 않아 결과가 안 바뀌는 상태도
 * 사라진다. 적어 넣는 칸만 칸을 떠날 때 보내며, 이 form의 `submit`은 그 칸에서 누른 Enter를
 * 페이지 새로고침이 아니라 적용으로 받는다.
 */
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
    changeComparison: form.changeComparison,
    changeItems: form.changeItems,
    commit: form.commit
  };
  return (
    <form
      aria-label='기관과 지역 비교조건'
      noValidate
      className='analysis-filter-form'
      onSubmit={(event) => {
        event.preventDefault();
        form.commit();
      }}
    >
      <div role='group' aria-label='조회 기간' className='flex flex-wrap items-center gap-1'>
        <span className='mr-1 text-xs whitespace-nowrap text-muted-foreground'>조회 기간</span>
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
            className='h-8 aria-pressed:bg-primary/10 aria-pressed:text-primary'
            onClick={() => form.selectPreset(preset.value)}
          >
            {preset.label}
          </Button>
        ))}
      </div>
      <AnalysisDateFields {...fields} />
      <AnalysisConditionFields {...fields} />
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
    </form>
  );
}
