/** @module 책임: 적용된 두 집단의 조건을 하나의 표시 모델로 만들어 차트·분포·이력에서 같은 설명을 쓴다. */
import { appliedItemText, appliedOverlayText, floorText, listCountText } from '../lib/condition-text';
import type { AnalysisFilterSetup, AppliedAnalysis } from './analysis-filter-types';
export function presentAnalysisContext(setup: AnalysisFilterSetup, applied: AppliedAnalysis) {
  if (applied.state === 'invalid')
    return {
      state: 'invalid',
      title: '비교조건을 확인해 주세요',
      description: applied.message
    } as const;
  const filter = applied.filter;
  const scope = filter.comparisonScope;
  const comparison =
    scope.kind === 'national'
      ? '전국'
      : (setup.options.regions.find(
          (option) => option.codeValueId === scope.codeValueId && option.scheme === scope.scheme
        )?.label ?? '지역명 미확인');
  const range = filter.listCountRange;
  const count =
    '명단 ' +
    listCountText(
      range.min === null ? null : String(range.min),
      range.max === null ? null : String(range.max)
    );
  /**
   * 조건 막대를 접는 폭(휴대폰)에서는 이 문장이 걸린 조건을 말하는 유일한 자리다. 기본값이 아닌
   * 것만 덧붙여, 무엇을 건드렸는지가 문장 길이에 드러나게 한다.
   */
  const extra = [appliedItemText(filter.itemFilter), appliedOverlayText(filter.overlayOrganizationIds)]
    .filter((part): part is string => part !== null)
    .join(' · ');
  return {
    state: 'pending',
    organization: setup.organizationLabel,
    comparison,
    title: setup.organizationLabel + ' vs ' + comparison + ' 전체',
    description:
      filter.period.from +
      ' – ' +
      filter.period.to +
      ' · ' +
      (filter.dateBasis === 'opened' ? '개찰일' : '공고일') +
      ' · 하한율 ' +
      floorText(filter.floorRate.value) +
      '% · ' +
      count +
      (extra === '' ? '' : ' · ' + extra),
    method:
      setup.options.awardMethods.find(
        (value) => value.codeValueId === filter.awardMethodCodeValueId
      )?.label ?? '낙찰방식 미확인'
  } as const;
}
export type AnalysisContextView = ReturnType<typeof presentAnalysisContext>;
