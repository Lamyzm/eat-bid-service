/** @module 책임: 공통 조건의 편집 초안을 들고 고른 즉시 전체 DTO를 URL에 한 번으로 적용한다. */
'use client';
import { useQueryState } from 'nuqs';
import { useState, useTransition } from 'react';
import type { AuctionItemAtom } from '@eatbid/contracts/api/v1/auctions';
import { analysisSearchParsers } from '@/app/(workspace)/auctions/[auctionId]/analysis/_lib/analysis-search';
import { ITEM_UNKNOWN_VALUE } from '../ui/analysis-item-field';
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
  /** 고른 비교 지역이다. 목록이 사전에서 오므로 화면은 고른 값을 그대로 담고 존재 확인은 서버가 한다. */
  const changeComparison = (scope: AnalysisDraft['comparisonScope']) => {
    const next: AnalysisDraft = { ...draft, comparisonScope: scope };
    setDraft(next);
    setErrors({});
    apply(next);
  };
  /** 겹쳐 찍을 기관이다. 조건이 아니라 표시 축이지만 주소에 함께 실려야 공유한 링크가 같은 그림을 연다. */
  const changeOverlays = (selection: readonly string[]) => {
    const next: AnalysisDraft = { ...draft, overlayOrganizationIds: [...selection] };
    setDraft(next);
    setErrors({});
    apply(next);
  };
  /**
   * 고른 품목이다. `품목 미확인`은 어휘의 원자가 아니라 "다리 행이 없음"이라 목록에서만 같은 줄에
   * 서고 초안에서는 따로 담는다 — 아홉째 원자로 섞으면 어휘가 우리 것이 된다(EAT-230 §4.3).
   */
  const changeItems = (selection: readonly string[]) => {
    const next = {
      ...draft,
      items: selection.filter((value): value is AuctionItemAtom => value !== ITEM_UNKNOWN_VALUE),
      itemUnknown: selection.includes(ITEM_UNKNOWN_VALUE)
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
  return {
    draft,
    errors,
    pending,
    change,
    changeComparison,
    changeItems,
    changeOverlays,
    commit,
    selectPreset
  };
}
