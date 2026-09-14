/** @module 책임: 비교조건의 날짜·코드·명단 입력과 해당 필드의 오류를 같은 자리에 표시한다. */
'use client';
import { useId } from 'react';
import { Input } from '@/shared/ui/input';
import type {
  AnalysisDraft,
  AnalysisDraftErrors,
  AnalysisFilterSetup,
  AnalysisTextField
} from '../model/analysis-filter-types';

type Props = {
  readonly setup: AnalysisFilterSetup;
  readonly draft: AnalysisDraft;
  readonly errors: AnalysisDraftErrors;
  readonly change: (field: AnalysisTextField, value: string) => void;
  readonly changeComparison: (selection: string) => void;
};
const selectClass =
  'h-9 max-w-full min-w-0 rounded-lg border border-input bg-background px-2.5 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring';

function Field({
  label,
  error,
  children
}: {
  readonly label: string;
  readonly error?: string;
  readonly children: (id: string, descriptionId: string | undefined) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className='grid min-w-0 gap-1'>
      <label htmlFor={id} className='text-xs font-medium text-muted-foreground'>
        {label}
      </label>
      {children(id, error ? `${id}-error` : undefined)}
      {error ? (
        <p id={`${id}-error`} role='alert' className='text-xs text-destructive'>
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function AnalysisDateFields({ draft, errors, change }: Props) {
  return (
    <div className='grid grid-cols-2 gap-2'>
      <Field label='시작일' error={errors.from}>
        {(id, description) => (
          <Input
            id={id}
            name='from'
            type='date'
            value={draft.from}
            aria-invalid={!!errors.from}
            aria-describedby={description}
            onChange={(event) => change('from', event.target.value)}
            className='h-9 w-36 max-w-full'
          />
        )}
      </Field>
      <Field label='종료일' error={errors.to}>
        {(id, description) => (
          <Input
            id={id}
            name='to'
            type='date'
            value={draft.to}
            aria-invalid={!!errors.to}
            aria-describedby={description}
            onChange={(event) => change('to', event.target.value)}
            className='h-9 w-36 max-w-full'
          />
        )}
      </Field>
    </div>
  );
}

export function AnalysisConditionFields({ setup, draft, errors, change, changeComparison }: Props) {
  const itemOptions = setup.options.itemOptions;
  return (
    <div
      data-slot='analysis-condition-fields'
      className='grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 lg:grid-cols-7'
    >
      <Field label='날짜 기준'>
        {(id) => (
          <select
            id={id}
            name='dateBasis'
            className={selectClass}
            value={draft.dateBasis}
            onChange={(event) => change('dateBasis', event.target.value)}
          >
            <option value='opened'>개찰일</option>
            <option value='announced'>공고일</option>
          </select>
        )}
      </Field>
      <Field label='비교 공고지역' error={errors.comparisonScope}>
        {(id, description) => (
          <select
            id={id}
            name='comparisonScope'
            className={selectClass}
            value={
              draft.comparisonScope.kind === 'national'
                ? 'national'
                : draft.comparisonScope.codeValueId
            }
            aria-invalid={!!errors.comparisonScope}
            aria-describedby={description}
            onChange={(event) => changeComparison(event.target.value)}
          >
            <option value='national'>전국</option>
            {setup.options.regions.map((region) => (
              <option key={region.codeValueId} value={region.codeValueId}>
                {region.label ?? '지역명 미확인'}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label='낙찰하한율' error={errors.floor}>
        {(id, description) => (
          <select
            id={id}
            name='floor'
            className={selectClass}
            value={draft.floor}
            aria-invalid={!!errors.floor}
            aria-describedby={description}
            onChange={(event) => change('floor', event.target.value)}
          >
            {draft.floor === '' ? <option value=''>미확인</option> : null}
            {setup.options.floorRates.map((floor) => (
              <option key={floor.value} value={floor.value}>
                {floor.value}%
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label='낙찰방식' error={errors.awardMethod}>
        {(id, description) => (
          <select
            id={id}
            name='awardMethod'
            className={selectClass}
            value={draft.awardMethod}
            aria-invalid={!!errors.awardMethod}
            aria-describedby={description}
            onChange={(event) => change('awardMethod', event.target.value)}
          >
            {draft.awardMethod === '' ? <option value=''>미확인</option> : null}
            {setup.options.awardMethods.map((method) => (
              <option key={method.codeValueId} value={method.codeValueId}>
                {method.label ?? '방식명 미확인'}
              </option>
            ))}
          </select>
        )}
      </Field>
      <Field label='명단 최소' error={errors.min}>
        {(id, description) => (
          <Input
            id={id}
            name='min'
            inputMode='numeric'
            value={draft.min}
            placeholder='제한 없음'
            aria-invalid={!!errors.min}
            aria-describedby={description}
            onChange={(event) => change('min', event.target.value)}
            className='h-9'
          />
        )}
      </Field>
      <Field label='명단 최대' error={errors.max}>
        {(id, description) => (
          <Input
            id={id}
            name='max'
            inputMode='numeric'
            value={draft.max}
            placeholder='제한 없음'
            aria-invalid={!!errors.max}
            aria-describedby={description}
            onChange={(event) => change('max', event.target.value)}
            className='h-9'
          />
        )}
      </Field>
      <Field label='이 기관 품목' error={errors.item}>
        {(id, description) => (
          <select
            id={id}
            name='item'
            className={selectClass}
            value={draft.item}
            aria-invalid={!!errors.item}
            aria-describedby={description}
            onChange={(event) => change('item', event.target.value)}
          >
            <option value='all'>전체 품목</option>
            {itemOptions.state === 'ready'
              ? itemOptions.options.map((item) => (
                  <option key={item.codeValueId} value={item.codeValueId}>
                    {item.label ?? '품목명 미확인'}
                  </option>
                ))
              : null}
          </select>
        )}
      </Field>
    </div>
  );
}
