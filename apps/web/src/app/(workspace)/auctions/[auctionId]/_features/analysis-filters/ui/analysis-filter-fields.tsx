/** @module 책임: 하나만 고르는 코드 조건을 같은 여닫이 껍데기에 담고 조회 기간 줄과 비교 조건 줄을 각각 조립한다. */
'use client';
import { useId, type ReactNode } from 'react';
import type { AnalysisFilterValue } from '@/api/analysis';
import { cn } from '@/shared/lib/cn';
import { controlPillClass, controlPillIconClass } from '@/shared/ui/control-pill';
import { Icons } from '@/shared/ui/icons';
import { floorText } from '../lib/condition-text';
import { useConditionOptions } from '../model/use-condition-options';
import { AnalysisItemField } from './analysis-item-field';
import { AnalysisListCountField } from './analysis-list-count-field';
import { AnalysisOrganizationField } from './analysis-organization-field';
import { AnalysisPeriodField } from './analysis-period-field';
import { AnalysisRegionField } from './analysis-region-field';
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
  readonly changeComparison: (scope: AnalysisDraft['comparisonScope']) => void;
  readonly changeItems: (selection: readonly string[]) => void;
  readonly changeOverlays: (selection: readonly string[]) => void;
  /** 적용된 조건이다. 조건 사전은 이것으로 묻는다. 무효한 조건이면 null이라 묻지 않는다. */
  readonly applied: AnalysisFilterValue | null;
  /** 적어 넣는 칸을 떠났을 때 지금까지 적은 값을 보낸다. */
  readonly commit: () => void;
};

/**
 * 여덟 개 남짓을 하나 고르는 자리는 네이티브 `select`가 가장 적은 조작으로 끝난다(폰에서는 OS 고르개가
 * 뜬다). 다만 그대로 두면 같은 줄의 여닫이들과 테두리·화살표가 달라 보이므로, 껍데기만 공통 pill로
 * 감싸고 `select`에서는 네이티브 화살표를 지운다. 라벨을 껍데기 **안**에 두는 이유도 같다 — 옆에 두면
 * 다른 칸은 라벨이 테두리 안에 있고 이 칸만 밖에 있다.
 */
function ConditionSelect({
  label,
  labelOptional,
  srLabel,
  name,
  value,
  error,
  className,
  onChange,
  children
}: {
  /** 눈에 보이는 라벨이다. 줄 라벨이 이미 그 말을 하는 칸은 비운다. */
  readonly label: string;
  /** 좁은 폭에서 라벨을 눈에서만 감출지다. 값만으로 무엇을 고른 것인지 말하는 칸에만 준다. */
  readonly labelOptional?: boolean;
  /** 라벨을 비웠을 때 화면 낭독기가 읽을 이름이다. 보이지 않을 뿐 이름은 늘 있어야 한다. */
  readonly srLabel?: string;
  readonly name: string;
  readonly value: string;
  readonly error?: string;
  readonly className?: string;
  readonly onChange: (value: string) => void;
  readonly children: ReactNode;
}) {
  const id = useId();
  return (
    <div className='flex min-w-0 items-center gap-1.5'>
      <span
        className={cn(
          controlPillClass,
          'focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
          className
        )}
      >
        <label
          htmlFor={id}
          className={
            label === ''
              ? 'sr-only'
              : `text-xs whitespace-nowrap text-muted-foreground${labelOptional ? ' analysis-optional-label' : ''}`
          }
        >
          {label === '' ? srLabel : label}
        </label>
        <select
          id={id}
          name={name}
          value={value}
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          onChange={(event) => onChange(event.target.value)}
          className='min-w-0 flex-1 appearance-none bg-transparent text-sm font-medium text-foreground outline-none'
        >
          {children}
        </select>
        <Icons.chevronDown aria-hidden className={controlPillIconClass} />
      </span>
      {error ? (
        <p id={`${id}-error`} role='alert' className='text-xs text-destructive'>
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** 조회 기간 줄의 칸들이다. 프리셋 칩은 이 줄의 주인인 `AnalysisFilters`가 직접 그린다. */
export function AnalysisPeriodFields({ draft, errors, change }: Props) {
  return (
    <>
      <AnalysisPeriodField draft={draft} errors={errors} change={change} />
      {/*
        날짜 기준은 기간을 무엇으로 세는지를 정하므로 기간 줄에 선다. 라벨 없이 값만 두는 이유는
        기간 칸과 같다 — 줄 라벨이 이미 `조회 기간`이라고 말하고 있다.
      */}
      <ConditionSelect
        label=''
        srLabel='날짜 기준'
        name='dateBasis'
        value={draft.dateBasis}
        className='w-24'
        onChange={(value) => change('dateBasis', value)}
      >
        <option value='opened'>개찰일</option>
        <option value='announced'>공고일</option>
      </ConditionSelect>
    </>
  );
}

/**
 * 비교 조건 줄의 칸들이다. 순서는 **무엇을 비교하느냐(지역)부터 어떻게 거르느냐**로 간다. 지역이
 * 항상 이 줄의 첫 칸이어야 하는 이유는, 폭마다 다른 줄로 떠다니면 사용자가 그것이 조회 범위인지
 * 비교 대상인지 매번 다시 읽어야 하기 때문이다(2026-09-18 디자인 심사).
 */
export function AnalysisConditionFields({
  setup,
  draft,
  errors,
  change,
  changeComparison,
  changeItems,
  changeOverlays,
  commit,
  applied
}: Props) {
  // 품목 건수도 지역·기관과 같은 사전에서 온다. 같은 조건을 두 번 묻지 않도록 한 조회를 나눠 쓴다.
  const { options } = useConditionOptions(applied, { sido: null, organizationQuery: null });
  return (
    <>
      <AnalysisRegionField
        filter={applied}
        scope={draft.comparisonScope}
        changeComparison={changeComparison}
      />
      <ConditionSelect
        label='하한'
        name='floor'
        value={draft.floor}
        error={errors.floor}
        className='w-26'
        onChange={(value) => change('floor', value)}
      >
        {draft.floor === '' ? <option value=''>미확인</option> : null}
        {setup.options.floorRates.map((floor) => (
          <option key={floor.value} value={floor.value}>
            {floorText(floor.value)}%
          </option>
        ))}
      </ConditionSelect>
      <ConditionSelect
        label='방식'
        labelOptional
        name='awardMethod'
        value={draft.awardMethod}
        error={errors.awardMethod}
        className='w-28 max-xl:w-20'
        onChange={(value) => change('awardMethod', value)}
      >
        {draft.awardMethod === '' ? <option value=''>미확인</option> : null}
        {setup.options.awardMethods.map((method) => (
          <option key={method.codeValueId} value={method.codeValueId}>
            {method.label ?? '방식명 미확인'}
          </option>
        ))}
      </ConditionSelect>
      <AnalysisListCountField draft={draft} errors={errors} change={change} commit={commit} />
      <AnalysisItemField draft={draft} changeItems={changeItems} options={options} />
      <AnalysisOrganizationField
        filter={applied}
        selected={draft.overlayOrganizationIds}
        changeOverlays={changeOverlays}
      />
    </>
  );
}
