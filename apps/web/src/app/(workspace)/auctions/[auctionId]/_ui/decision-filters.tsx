/** @module 책임: 공고의 하한 원값과 조회된 기관 이력 코드로 적용 가능한 조건 메뉴를 조립한다. */
import { DECISION_PERIODS, DECISION_SCOPES, buildDecisionFilterRoute, type DecisionSearch } from '../_lib/decision-search-params';
import type { HistoryPresentation } from '../_model/attempt-history';
import { historyFloorOf, normalizeItemParam } from '../_model/decision-cohort';
import type { DecisionPresentation } from '../_model/present-decision';
import { ConditionMenu } from './condition-menu';

export function DecisionFilters({ decision, search, history }: {
  readonly decision: DecisionPresentation;
  readonly search: DecisionSearch;
  readonly history?: HistoryPresentation;
}) {
  const route = (change: Parameters<typeof buildDecisionFilterRoute>[2]) => buildDecisionFilterRoute(decision.identity.auctionId, search, change);
  const floor = historyFloorOf(decision.floorRateValue ?? undefined, search.floor);
  // 메뉴는 전체 코드 사전이 아니다. 현재 공고와 실제로 조회된 행의 조건만 제시한다. 전체 선택으로
  // 범위를 넓힐 수 있으며 라벨에서 품목 ID나 공고 하한을 되추론하지 않는다.
  const floors = [...new Set([decision.floorRateValue, floor, ...history?.rows.map((row) => row.floorRateText) ?? []])]
    .filter((value): value is string => value != null && value !== 'all' && value !== 'unknown');
  const floorChoices = [
    ...floors.map((value) => ({ value, label: `${value}%${value === decision.floorRateValue ? ' · 현재 공고' : ''}` })),
    { value: 'all', label: '전체 하한율' },
    { value: 'unknown', label: '하한율 미확인' }
  ];
  const items = new Map<string, string>();
  for (const row of history?.rows ?? []) if (row.itemCodeValueId !== null) items.set(row.itemCodeValueId, row.itemLabel);
  const item = normalizeItemParam(search.item);
  if (item !== null && !items.has(item)) items.set(item, '선택한 품목');
  return (
    <div className='flex min-w-0 flex-wrap items-center gap-2' aria-label='분석 조건'>
      <ConditionMenu label='기간' value={search.period} choices={DECISION_PERIODS.map((period) => ({ label: period, href: route({ period }), selected: search.period === period }))} />
      <ConditionMenu label='하한율' value={floor === 'all' ? '전체' : floor === 'unknown' ? '미확인' : `${floor}%`} choices={floorChoices.map(({ value, label }) => ({ label, href: route({ floor: value }), selected: floor === value }))} />
      <ConditionMenu label='품목' value={item === null ? '전체 품목' : items.get(item) ?? '선택한 품목'} choices={[
        { label: '전체 품목', href: route({ item: null }), selected: item === null },
        ...[...items].map(([id, label]) => ({ label, href: route({ item: id }), selected: item === id }))
      ]} />
      {search.view === '비교집단' ? <ConditionMenu label='분포 범위' value={search.scope} choices={DECISION_SCOPES.map((scope) => ({ label: scope, href: route({ scope }), selected: search.scope === scope }))} /> : null}
      <span className='text-xs text-muted-foreground'>기관 이력 · 현재 공고와 같은 낙찰 방식</span>
    </div>
  );
}
