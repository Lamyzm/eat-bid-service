/** @module 책임: 공통 조건의 편집 초안과 적용된 URL을 분리하고 전체 DTO를 한 번에 적용한다. */
'use client';
import { useQueryState } from 'nuqs';
import { useState, useTransition } from 'react';
import { analysisSearchParsers } from '@/app/(workspace)/auctions/[auctionId]/analysis/_lib/analysis-search';
import { draftOfAnalysis, validateAnalysisDraft } from './analysis-filter-draft';
import type {
  AnalysisDraft,
  AnalysisDraftErrors,
  AnalysisFilterSetup,
  AnalysisTextField,
  AppliedAnalysis
} from './analysis-filter-types';

export function useAnalysisFilters(setup: AnalysisFilterSetup, applied: AppliedAnalysis) {
  const initial =
    applied.state === 'pending' ? draftOfAnalysis(applied.filter) : setup.initialDraft;
  const [draft, setDraft] = useState<AnalysisDraft>(initial);
  const [errors, setErrors] = useState<AnalysisDraftErrors>({});
  const [pending, startTransition] = useTransition();
  const [, setQuery] = useQueryState(
    'analysis',
    analysisSearchParsers.analysis.withOptions({
      shallow: false,
      history: 'push',
      scroll: false,
      startTransition
    })
  );
  const change = (field: AnalysisTextField, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors({});
  };
  const changeComparison = (selection: string) => {
    if (selection === 'national') {
      setDraft((current) => ({ ...current, comparisonScope: { kind: 'national' } }));
    } else {
      const option = setup.options.regions.find((region) => region.codeValueId === selection);
      if (!option) {
        setErrors({ comparisonScope: '확인된 공고지역을 선택해 주세요.' });
        return;
      }
      setDraft((current) => ({
        ...current,
        comparisonScope: {
          kind: 'region',
          scheme: option.scheme,
          codeValueId: option.codeValueId
        }
      }));
    }
    setErrors({});
  };
  const apply = () => {
    const result = validateAnalysisDraft(draft, setup);
    if (result.state === 'invalid') {
      setErrors(result.errors);
      return false;
    }
    setErrors({});
    // 조회 조건 전체를 원자적으로 바꾸고, 표시 탭과 전체보기는 그대로 유지한다.
    void setQuery(JSON.stringify(result.filter));
    return true;
  };
  const reset = () => {
    setDraft(setup.initialDraft);
    setErrors({});
  };
  const selectPreset = (value: string) => {
    const period = setup.presets.find((preset) => preset.value === value)?.period;
    if (period) {
      setDraft((current) => ({ ...current, ...period }));
      setErrors({});
    }
  };
  return {
    draft,
    errors,
    pending,
    change,
    changeComparison,
    apply,
    reset,
    selectPreset,
    dirty: JSON.stringify(draft) !== JSON.stringify(initial)
  };
}
