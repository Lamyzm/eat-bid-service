/** @module 책임: 프리셋(저장된 조건 한 벌) 건수 응답을 왼쪽 기둥이 그대로 쓰는 줄 목록(이름·건수·주소·켜짐)으로 바꾸고, 기본 셋의 문구를 화면 어휘로 소유한다. */
import type { MyFilterCombinationCountsV1Response, MyFilterCombinationsV1Response } from '@eatbid/contracts/api/v1/me';

import { buildTodayRoute, EMPTY_TODAY_SEARCH, type TodayRoute, type TodaySearch } from '../_lib/today-search-params';

export type CombinationRowPresentation = {
  readonly key: string;
  readonly name: string;
  /** 못 셌으면 null이다. 0으로 채우면 화면이 "이 조합에 공고가 없다"고 거짓말한다(AGENTS 3). */
  readonly count: number | null;
  readonly href: TodayRoute;
  readonly active: boolean;
  /** 저장된 조합만 지울 수 있다. 기본 셋은 저장된 것이 아니라 매번 파생하는 틀이다. */
  readonly filterCombinationId: string | null;
};

export type CombinationsPresentation = {
  readonly defaults: readonly CombinationRowPresentation[];
  readonly saved: readonly CombinationRowPresentation[];
  readonly savedLimit: number;
  /** 지금 조건이 켜진 조합과 다르면 저장할 것이 있다는 뜻이다. */
  readonly canSaveCurrent: boolean;
  /** 저장 칸에 미리 채울 이름이다. 사용자가 그대로 두거나 고쳐 쓴다. */
  readonly suggestedName: string;
};

type DefaultKey = MyFilterCombinationCountsV1Response['defaults'][number]['key'];

/**
 * 기둥에 서는 순서다. **`오늘 <지역>`이 맨 위다** — 사장님이 아침에 여는 자리가 여기이고, 그 아래 둘은
 * 거기서 넓히거나(전부) 좁히는(품목) 이동이다. 계약의 열쇠 순서가 아니라 이 목록이 순서를 정한다.
 *
 * `noBids`(참여 0곳)는 계약이 세어 주지만 기둥에 세우지 않는다. 단독입찰을 허용하지 않는 공고가 대부분이라
 * (2026-09-16 표본 30건 중 29건) 참여 0곳은 기회가 아니라 혼자 들어가면 유찰이라는 신호인데, 그 조건을
 * 아직 읽지 않아 화면이 옆에 적어 줄 수 없다. 조건 자체(`bidState=none`)는 남아 있어 사용자가 직접 걸 수 있다.
 */
const DEFAULT_ORDER: readonly DefaultKey[] = ['regionClosingToday', 'regionAll', 'itemUnknownIncluded'];

/**
 * 기본 셋의 문구는 **화면이 소유한다.** 계약은 어느 이동인지를 열쇠로만 싣는다 — `오늘 김해시`의 `김해시`는
 * 사장님 것이지 모두의 것이 아니라서 계약이 지어낼 수 없다.
 *
 * 지역 이름은 **관측된 라벨일 때만** 쓴다. 워크스페이스가 고른 지역이 하나면 그 라벨을 부르고, 둘 이상이면
 * 어느 것으로 불러도 나머지를 숨기게 되므로 `내 지역`으로 물러선다. 라벨 `서울/전체`는 `서울`로, `경남/김해시`는
 * `김해시`로 줄인다 — `오늘 서울/전체`·`서울/전체 전부`는 말이 아니다(사용자 결정 2026-09-17). 자르는 규칙은
 * 라벨의 `/` 하나뿐이고 낱말을 바꾸지는 않는다.
 */
export function shortRegionText(regionText: string): string {
  const [sido, rest] = regionText.split('/', 2);
  if (rest === undefined || rest === '') return regionText;
  return rest === '전체' ? sido! : rest;
}

function defaultName(key: DefaultKey, regionText: string | null): string {
  const region = regionText === null ? '내 지역' : shortRegionText(regionText);
  if (key === 'regionClosingToday') return `오늘 ${region}`;
  if (key === 'regionAll') return `${region} 전체`;
  if (key === 'noBids') return '참여 0곳';
  return '품목 미상 포함';
}

/**
 * 기본 셋이 누르면 가는 자리다. 앞 둘은 **조건을 지우는** 이동이고 뒤 하나는 **지금 조건에 더하는** 이동이라
 * 링크가 지우는 것과 남기는 것이 서로 다르다.
 */
function defaultRoute(key: DefaultKey, search: TodaySearch, today: string): TodayRoute {
  if (key === 'regionAll') return buildTodayRoute({ ...EMPTY_TODAY_SEARCH, scope: search.scope });
  if (key === 'regionClosingToday') {
    return buildTodayRoute({ ...EMPTY_TODAY_SEARCH, scope: search.scope, closesOn: today });
  }
  if (key === 'noBids') return buildTodayRoute({ ...search, bidState: 'none', cursor: null });
  return buildTodayRoute({ ...search, itemUnknown: 'include', cursor: null });
}

function defaultActive(key: DefaultKey, search: TodaySearch, today: string): boolean {
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

/**
 * 저장 칸에 미리 채울 이름이다. **사용자가 빈 칸을 마주하지 않게 한다** — 방금 건 조건을 스스로 다시
 * 문장으로 옮기는 일은 우리가 이미 아는 것을 사용자에게 시키는 것이다.
 *
 * 축 이름(`지역`·`품목`)은 빼고 값만 잇는다. 이름표는 무엇으로 좁혔는지가 아니라 어느 판인지를 부르는
 * 말이라 `지역 경남/김해시 · 품목 육류`보다 `경남/김해시 · 육류`가 짧고 알아보기 쉽다.
 *
 * 40자는 계약의 상한이라 여기서 끊어 보내면 저장이 길이로 거절되지 않는다.
 */
export function suggestCombinationName(search: TodaySearch, regionText: string | null): string {
  const parts: string[] = [];
  if (search.sido !== null) parts.push(regionText ?? `코드 ${search.sido}`);
  if (search.items !== null) parts.push(...search.items);
  if (search.baseAmountMin !== null || search.baseAmountMax !== null) {
    parts.push(search.baseAmountMin === null ? '금액 이하' : '금액 이상');
  }
  return parts.join(' · ').slice(0, 40);
}

export function presentCombinations(input: {
  readonly combinations: MyFilterCombinationsV1Response['combinations'];
  readonly counts: MyFilterCombinationCountsV1Response | null;
  readonly search: TodaySearch;
  readonly today: string;
  readonly savedLimit: number;
  /** 워크스페이스가 고른 지역이 하나일 때 관측된 그 라벨이다. 둘 이상이거나 못 읽었으면 null이다. */
  readonly regionText: string | null;
}): CombinationsPresentation {
  const countByKey = new Map((input.counts?.defaults ?? []).map((entry) => [entry.key, entry.count]));
  const countById = new Map((input.counts?.saved ?? []).map((entry) => [entry.filterCombinationId, entry.count]));
  const defaults = DEFAULT_ORDER.map((key) => ({
    key,
    name: defaultName(key, input.regionText),
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
    suggestedName: suggestCombinationName(input.search, input.regionText),
    // 조건이 없으면 저장할 것이 없고, 켜진 조합과 같으면 이미 저장돼 있다.
    canSaveCurrent: !saved.some((row) => row.active)
      && (input.search.sido !== null || input.search.items !== null
        || input.search.baseAmountMin !== null || input.search.baseAmountMax !== null)
  };
}
