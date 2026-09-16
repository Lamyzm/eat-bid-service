/** @module 책임: 주소의 검색어와 결과 수를 달력 아래 검색 칸이 그리는 값(입력값·함께 보낼 조건·결과 문장·지우기 링크)으로 바꾼다. 검색 범위가 지금 조건 안이라는 사실을 문장이 소유한다. */
import {
  buildTodayFilterRoute,
  carriedTodaySearch,
  type TodayRoute,
  type TodaySearch
} from '@/app/(workspace)/today/_lib/today-search-params';

export type ListSearchPresentation = {
  /** 입력 칸의 현재 값이다. 검색 중이 아니면 빈 문자열이고 placeholder가 선다. */
  readonly valueText: string;
  /** 검색어만 바꿔도 나머지 조건이 풀리지 않게 GET form이 함께 보낼 값들이다. cursor는 뺀다. */
  readonly carried: readonly { readonly key: string; readonly value: string }[];
  /**
   * 검색 중일 때만 있다. 문장이 "지금 조건 안에서"를 말하는 이유는 2026-09-15 리뷰가 검색 범위가 현재 조합인지
   * 전체인지 화면에 안 보인다고 지적했기 때문이다 — 검색은 다른 축을 풀지 않는다.
   */
  readonly active: { readonly text: string; readonly clearHref: TodayRoute } | null;
};

export function presentListSearch(search: TodaySearch, sampleCount: number | null): ListSearchPresentation {
  const q = search.q;
  return {
    valueText: q ?? '',
    carried: carriedTodaySearch(search, ['q']),
    active: q === null ? null : {
      text: sampleCount === null ? `지금 조건 안에서 “${q}”` : `지금 조건 안에서 “${q}” · ${sampleCount}건`,
      clearHref: buildTodayFilterRoute(search, { q: null })
    }
  };
}
