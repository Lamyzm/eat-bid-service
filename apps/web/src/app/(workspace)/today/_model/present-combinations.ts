/** @module 책임: 조합 건수 응답을 왼쪽 기둥이 그대로 쓰는 줄 목록(이름·건수·주소·켜짐)으로 바꾸고, 기본 넷의 문구를 화면 어휘로 소유한다. */
import type { MyFilterCombinationCountsV1Response, MyFilterCombinationsV1Response } from '@eatbid/contracts/api/v1/me';

import { buildTodayRoute, EMPTY_TODAY_SEARCH, type TodayRoute, type TodaySearch } from '../_lib/today-search-params';

export type CombinationRowPresentation = {
  readonly key: string;
  readonly name: string;
  /** 못 셌으면 null이다. 0으로 채우면 화면이 "이 조합에 공고가 없다"고 거짓말한다(AGENTS 3). */
  readonly count: number | null;
  readonly href: TodayRoute;
  readonly active: boolean;
  /** 저장된 조합만 지울 수 있다. 기본 넷은 저장된 것이 아니라 매번 파생하는 틀이다. */
  readonly filterCombinationId: string | null;
};

export type CombinationsPresentation = {
  readonly defaults: readonly CombinationRowPresentation[];
  readonly saved: readonly CombinationRowPresentation[];
  readonly savedLimit: number;
  /** 지금 조건이 켜진 조합과 다르면 저장할 것이 있다는 뜻이다. */
  readonly canSaveCurrent: boolean;
};

/**
 * 기본 넷의 문구는 **화면이 소유한다.** 계약은 어느 이동인지를 열쇠로만 싣는다 — `오늘 김해`의 `김해`는
 * 사장님 것이지 모두의 것이 아니고, 지역 라벨은 아직 관측되지 않아(EAT-100) 계약이 지어낼 수 없다.
 *
 * 그래서 이름에 지역을 넣지 않고 `내 지역`이라고 부른다. 라벨이 오면 그때 이름에 넣는다.
 */
const DEFAULT_NAMES: Record<MyFilterCombinationCountsV1Response['defaults'][number]['key'], string> = {
  regionAll: '내 지역 전부',
  regionClosingToday: '오늘 마감',
  noBids: '참여 0곳',
  itemUnknownIncluded: '품목 미상 포함'
};

/**
 * 기본 넷이 누르면 가는 자리다. 앞 둘은 **조건을 지우는** 이동이고 뒤 둘은 **지금 조건에 더하는** 이동이라
 * 링크가 지우는 것과 남기는 것이 서로 다르다.
 */
function defaultRoute(key: keyof typeof DEFAULT_NAMES, search: TodaySearch, today: string): TodayRoute {
  if (key === 'regionAll') return buildTodayRoute({ ...EMPTY_TODAY_SEARCH, scope: search.scope });
  if (key === 'regionClosingToday') {
    return buildTodayRoute({ ...EMPTY_TODAY_SEARCH, scope: search.scope, closesOn: today });
  }
  if (key === 'noBids') return buildTodayRoute({ ...search, bidState: 'none', cursor: null });
  return buildTodayRoute({ ...search, itemUnknown: 'include', cursor: null });
}

function defaultActive(key: keyof typeof DEFAULT_NAMES, search: TodaySearch, today: string): boolean {
  if (key === 'regionAll') {
    return search.sido === null && search.items === null && search.closesOn === null
      && search.announcedOn === null && search.baseAmountMin === null && search.baseAmountMax === null
      && search.bidState === null && search.itemUnknown === null;
  }
  if (key === 'regionClosingToday') return search.closesOn === today;
  if (key === 'noBids') return search.bidState === 'none';
  return search.itemUnknown === 'include';
}

/** 저장된 조합이 가리키는 조건이다. 저장한 atom만 걸고 나머지는 지운다 — 조합은 조건 한 벌 전체다. */
function savedRoute(
  combination: MyFilterCombinationsV1Response['combinations'][number],
  search: TodaySearch
): TodayRoute {
  return buildTodayRoute({
    ...EMPTY_TODAY_SEARCH,
    scope: search.scope,
    sido: combination.filter.sido,
    items: combination.filter.items,
    baseAmountMin: combination.filter.baseAmountMin,
    baseAmountMax: combination.filter.baseAmountMax
  });
}

function sameFilter(
  combination: MyFilterCombinationsV1Response['combinations'][number],
  search: TodaySearch
): boolean {
  const items = combination.filter.items;
  const sameItems = items === null
    ? search.items === null
    : search.items !== null && items.length === search.items.length
      && items.every((label, index) => label === search.items![index]);
  return combination.filter.sido === search.sido
    && sameItems
    && combination.filter.baseAmountMin === search.baseAmountMin
    && combination.filter.baseAmountMax === search.baseAmountMax;
}

export function presentCombinations(input: {
  readonly combinations: MyFilterCombinationsV1Response['combinations'];
  readonly counts: MyFilterCombinationCountsV1Response | null;
  readonly search: TodaySearch;
  readonly today: string;
  readonly savedLimit: number;
}): CombinationsPresentation {
  const countByKey = new Map((input.counts?.defaults ?? []).map((entry) => [entry.key, entry.count]));
  const countById = new Map((input.counts?.saved ?? []).map((entry) => [entry.filterCombinationId, entry.count]));
  const defaults = (Object.keys(DEFAULT_NAMES) as (keyof typeof DEFAULT_NAMES)[]).map((key) => ({
    key,
    name: DEFAULT_NAMES[key],
    count: countByKey.get(key) ?? null,
    href: defaultRoute(key, input.search, input.today),
    active: defaultActive(key, input.search, input.today),
    filterCombinationId: null
  }));
  const saved = input.combinations.map((combination) => ({
    key: combination.filterCombinationId,
    name: combination.name,
    count: countById.get(combination.filterCombinationId) ?? null,
    href: savedRoute(combination, input.search),
    active: sameFilter(combination, input.search),
    filterCombinationId: combination.filterCombinationId
  }));
  return {
    defaults,
    saved,
    savedLimit: input.savedLimit,
    // 조건이 없으면 저장할 것이 없고, 켜진 조합과 같으면 이미 저장돼 있다.
    canSaveCurrent: !saved.some((row) => row.active)
      && (input.search.sido !== null || input.search.items !== null
        || input.search.baseAmountMin !== null || input.search.baseAmountMax !== null)
  };
}
