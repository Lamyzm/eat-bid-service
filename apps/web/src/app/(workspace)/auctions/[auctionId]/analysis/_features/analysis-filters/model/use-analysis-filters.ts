/** @module 책임: 공통 조건의 편집 초안을 들고 고른 즉시 전체 DTO를 URL에 한 번으로 적용한다. */
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

/**
 * 손으로 적는 칸이다. 한 글자마다 조회하면 `24`를 적는 동안 `2`로 한 번 더 물어 표본 수가 두 번
 * 흔들린다. 그렇다고 타이머로 미루지도 않는다 — setTimeout 지연값은 `ElapsedMilliseconds`에서만
 * 와야 하는데 그 타입은 client bundle에 들어갈 수 없다(AGENTS 15·17). 그래서 칸을 떠날 때 보낸다.
 * 날짜 칸은 여기 없다. `type=date`는 값이 완성되기 전까지 빈 문자열이라 고른 순간이 곧 최종 값이다.
 */
const TYPED_FIELDS: ReadonlySet<AnalysisTextField> = new Set(['min', 'max']);

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
  const apply = (next: AnalysisDraft) => {
    const result = validateAnalysisDraft(next, setup);
    if (result.state === 'invalid') {
      setErrors(result.errors);
      return;
    }
    setErrors({});
    // 조회 조건 전체를 원자적으로 바꾸고, 표시 탭과 전체보기는 그대로 유지한다.
    void setQuery(JSON.stringify(result.filter));
  };
  const change = (field: AnalysisTextField, value: string) => {
    const next = { ...draft, [field]: value };
    setDraft(next);
    setErrors({});
    if (!TYPED_FIELDS.has(field)) apply(next);
  };
  const changeComparison = (selection: string) => {
    const option = setup.options.regions.find((region) => region.codeValueId === selection);
    if (selection !== 'national' && option === undefined) {
      setErrors({ comparisonScope: '확인된 공고지역을 선택해 주세요.' });
      return;
    }
    const next: AnalysisDraft = {
      ...draft,
      comparisonScope:
        option === undefined
          ? { kind: 'national' }
          : { kind: 'region', scheme: option.scheme, codeValueId: option.codeValueId }
    };
    setDraft(next);
    setErrors({});
    apply(next);
  };
  /** 적어 넣는 칸을 떠났거나 Enter를 눌렀을 때다. 더 적을 뜻이 없으므로 지금 보낸다. */
  const commit = () => apply(draft);
  const selectPreset = (value: string) => {
    const period = setup.presets.find((preset) => preset.value === value)?.period;
    if (!period) return;
    const next = { ...draft, ...period };
    setDraft(next);
    setErrors({});
    apply(next);
  };
  return { draft, errors, pending, change, changeComparison, commit, selectPreset };
}
