/** @module 책임: 상세에 항상 보이는 공통 비교조건을 조회 기간 줄과 비교 조건 줄로 세우고 고르는 즉시 적용한다. */
'use client';
import { useId, useState } from 'react';
import { Button } from '@/shared/ui/button';
import { Icons } from '@/shared/ui/icons';
import { useAnalysisFilters } from '../model/use-analysis-filters';
import type { AnalysisFilterSetup, AppliedAnalysis } from '../model/analysis-filter-types';
import { AnalysisConditionFields, AnalysisPeriodFields } from './analysis-filter-fields';

/**
 * 조건은 고르는 즉시 적용된다. `조건 적용` 버튼을 두면 버튼 줄 하나와 "수정했어요" 안내 줄 하나가
 * 늘 자리를 차지하고, 그만큼 결과가 화면 밖으로 밀린다. 누르지 않아 결과가 안 바뀌는 상태도
 * 사라진다. 적어 넣는 칸만 칸을 떠날 때 보내며, 이 form의 `submit`은 그 칸에서 누른 Enter를
 * 페이지 새로고침이 아니라 적용으로 받는다.
 *
 * 줄은 둘이고 각 줄은 왼쪽 라벨을 갖는다. 아홉 칸을 한 뭉치로 흘려 두면 어디까지가 "언제를 보나"이고
 * 어디부터가 "무엇과 견주나"인지 폭마다 달라져 사용자가 매번 다시 읽는다(2026-09-18 디자인 심사).
 */
export function AnalysisFilters({
  setup,
  applied
}: {
  readonly setup: AnalysisFilterSetup;
  readonly applied: AppliedAnalysis;
}) {
  const form = useAnalysisFilters(setup, applied);
  const rowsId = useId();
  /**
   * 폰에서는 이 막대가 펼쳐진 채로 화면 첫 장을 통째로 먹어 차트가 한 점도 안 보인다(390px 실측
   * 288px). 조건을 매번 고치는 화면이 아니라 결과를 보는 화면이므로 기본은 접어 두고, 지금 걸린
   * 조건은 바로 아래 맥락 줄이 문장으로 말한다.
   */
  const [openOnPhone, setOpenOnPhone] = useState(false);
  const fields = {
    setup,
    draft: form.draft,
    errors: form.errors,
    change: form.change,
    changeComparison: form.changeComparison,
    changeItems: form.changeItems,
    changeOverlays: form.changeOverlays,
    commit: form.commit,
    applied: applied.state === 'pending' ? applied.filter : null
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
      <Button
        type='button'
        size='sm'
        variant='outline'
        aria-expanded={openOnPhone}
        aria-controls={rowsId}
        className='h-8 self-start sm:hidden'
        onClick={() => setOpenOnPhone((open) => !open)}
      >
        조건 고치기
        <Icons.chevronDown
          aria-hidden
          className={`size-4 transition-transform${openOnPhone ? ' rotate-180' : ''}`}
        />
      </Button>
      <div
        id={rowsId}
        className={`flex min-w-0 flex-col gap-2${openOnPhone ? '' : ' max-sm:hidden'}`}
      >
        <div role='group' aria-label='조회 기간' className='analysis-filter-row'>
          <span className='analysis-filter-row-label'>조회 기간</span>
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
              className='h-8 px-2 aria-pressed:bg-primary/10 aria-pressed:text-primary'
              onClick={() => form.selectPreset(preset.value)}
            >
              {preset.label}
            </Button>
          ))}
          <AnalysisPeriodFields {...fields} />
        </div>
        <div role='group' aria-label='비교 조건' className='analysis-filter-row'>
          <span className='analysis-filter-row-label'>비교 조건</span>
          <AnalysisConditionFields {...fields} />
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
    </form>
  );
}
