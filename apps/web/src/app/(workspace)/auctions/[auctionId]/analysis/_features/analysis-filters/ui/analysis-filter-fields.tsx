/** @module 책임: 비교조건의 날짜·코드·명단 입력과 해당 필드의 오류를 같은 줄에 표시한다. */
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
  /** 적어 넣는 칸을 떠났을 때 지금까지 적은 값을 보낸다. */
  readonly commit: () => void;
};
const selectClass =
  'h-8 max-w-44 min-w-0 rounded-lg border border-input bg-background px-2 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring';

/**
 * 라벨을 입력 **위**가 아니라 **옆**에 둔다. 조건이 열 개라 라벨을 쌓으면 그것만으로 한 줄(52px)이
 * 더 생기고, 그만큼 차트가 화면 아래로 밀려 조건과 결과를 함께 볼 수 없다. 라벨 자체는 지우지
 * 않는다 — `htmlFor` 연결이 이름이고, 이름이 없으면 무엇을 고르는지 아무도 모른다.
 */
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
    <div className='flex min-w-0 items-center gap-1.5'>
      <label htmlFor={id} className='text-xs whitespace-nowrap text-muted-foreground'>
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
    <>
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
            className='h-8 w-34 max-w-full'
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
            className='h-8 w-34 max-w-full'
          />
        )}
      </Field>
    </>
  );
}

export function AnalysisConditionFields({
  setup,
  draft,
  errors,
  change,
  changeComparison,
  commit
}: Props) {
  const itemOptions = setup.options.itemOptions;
  return (
    <>
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
            onBlur={commit}
            className='h-8 w-24'
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
            onBlur={commit}
            className='h-8 w-24'
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
    </>
  );
}
