import { describe, expect, test } from 'bun:test';
import { createSerializer } from 'nuqs';

import {
  EMPTY_TODAY_SEARCH,
  buildTodayFilterRoute,
  buildTodayRoute,
  carriedTodaySearch,
  todaySearchParsers
} from './today-search-params';

describe('오늘 화면 search param', () => {
  test('필터 링크는 값이 없는 조건을 주소에 남기지 않는다', () => {
    expect(buildTodayRoute(EMPTY_TODAY_SEARCH)).toBe('/today');
    // 링크는 parser가 직렬화한 그대로다. 한글은 브라우저가 요청 전에 URL 규격대로 인코딩한다.
    expect(buildTodayRoute({ ...EMPTY_TODAY_SEARCH, items: ['육류', '가금류'], closesWithinHours: 72 })).toBe('/today?items=육류,가금류&closesWithinHours=72');
  });

  test('조건 하나를 바꾸는 링크는 다른 조건을 지우지 않되 cursor는 되돌린다', () => {
    const search = { ...EMPTY_TODAY_SEARCH, sido: '41', closesWithinHours: 24, cursor: '5796468' };
    expect(buildTodayFilterRoute(search, { items: ['육류'] })).toBe('/today?sido=41&items=육류&closesWithinHours=24');
    expect(buildTodayFilterRoute(search, { sido: null })).toBe('/today?closesWithinHours=24');
    // 다음 페이지 링크만 cursor를 그대로 싣는다.
    expect(buildTodayRoute(search)).toBe('/today?sido=41&closesWithinHours=24&cursor=5796468');
  });

  test('GET form이 함께 보낼 조건은 바꾸는 조건과 cursor를 뺀 나머지이고 배열은 링크와 같은 쉼표 규칙이다', () => {
    const search = { ...EMPTY_TODAY_SEARCH, sido: '41', items: ['육류', '가금류'], q: '남산', cursor: '5796468' };
    expect(carriedTodaySearch(search, ['q'])).toEqual([
      { key: 'sido', value: '41' },
      { key: 'items', value: '육류,가금류' }
    ]);
    expect(carriedTodaySearch(search, ['baseAmountMin', 'baseAmountMax'])).toContainEqual({ key: 'q', value: '남산' });
  });

  test('parser는 주소를 왕복 보존하고 형식 검증은 loader에 맡긴다', () => {
    const serialize = createSerializer(todaySearchParsers);
    expect(serialize({ sido: '41', closesWithinHours: 72 })).toBe('?sido=41&closesWithinHours=72');
    // 범위 밖 값도 parser는 통과시킨다. 걸러 내는 것은 loader의 계약 schema다.
    expect(todaySearchParsers.closesWithinHours.parse('721')).toBe(721);
  });
});
