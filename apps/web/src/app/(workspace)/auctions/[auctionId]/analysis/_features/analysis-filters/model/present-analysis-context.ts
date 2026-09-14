/** @module 책임: 적용된 두 집단의 조건을 하나의 표시 모델로 만들어 차트·분포·이력에서 같은 설명을 쓴다. */
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
    range.min === null && range.max === null
      ? '명단 전체'
      : '명단 ' + (range.min ?? '제한 없음') + '–' + (range.max ?? '제한 없음');
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
      filter.floorRate.value +
      '% · ' +
      count,
    method:
      setup.options.awardMethods.find(
        (value) => value.codeValueId === filter.awardMethodCodeValueId
      )?.label ?? '낙찰방식 미확인'
  } as const;
}
export type AnalysisContextView = ReturnType<typeof presentAnalysisContext>;
