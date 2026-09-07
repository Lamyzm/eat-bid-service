import { describe, expect, test } from 'bun:test';
import { createSerializer } from 'nuqs';

import { EMPTY_TODAY_SEARCH, buildTodayFilterRoute, buildTodayRoute, todaySearchParsers } from './today-search-params';

describe('오늘 화면 search param', () => {
  test('필터 링크는 값이 없는 조건을 주소에 남기지 않는다', () => {
    expect(buildTodayRoute(EMPTY_TODAY_SEARCH)).toBe('/today');
    expect(buildTodayRoute({ ...EMPTY_TODAY_SEARCH, item: '축산', closesWithinHours: 72 })).toBe('/today?item=%EC%B6%95%EC%82%B0&closesWithinHours=72');
  });

  test('조건 하나를 바꾸는 링크는 다른 조건을 지우지 않되 cursor는 되돌린다', () => {
    const search = { ...EMPTY_TODAY_SEARCH, region: '41', closesWithinHours: 24, cursor: '5796468' };
    expect(buildTodayFilterRoute(search, { item: '축산' })).toBe('/today?region=41&item=%EC%B6%95%EC%82%B0&closesWithinHours=24');
    expect(buildTodayFilterRoute(search, { region: null })).toBe('/today?closesWithinHours=24');
    // 다음 페이지 링크만 cursor를 그대로 싣는다.
    expect(buildTodayRoute(search)).toBe('/today?region=41&closesWithinHours=24&cursor=5796468');
  });

  test('parser는 주소를 왕복 보존하고 형식 검증은 loader에 맡긴다', () => {
    const serialize = createSerializer(todaySearchParsers);
    expect(serialize({ region: '41', closesWithinHours: 72 })).toBe('?region=41&closesWithinHours=72');
    // 범위 밖 값도 parser는 통과시킨다. 걸러 내는 것은 loader의 계약 schema다.
    expect(todaySearchParsers.closesWithinHours.parse('721')).toBe(721);
  });
});
