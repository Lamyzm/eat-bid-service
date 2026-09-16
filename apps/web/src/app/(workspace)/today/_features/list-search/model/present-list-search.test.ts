import { describe, expect, test } from 'bun:test';

import { EMPTY_TODAY_SEARCH } from '@/app/(workspace)/today/_lib/today-search-params';

import { presentListSearch } from './present-list-search';

describe('오늘 화면 검색 칸 표시 모델', () => {
  test('검색 중이 아니면 입력은 비어 있고 결과 문장이 없다', () => {
    const model = presentListSearch({ ...EMPTY_TODAY_SEARCH, sido: '41' }, 4);
    expect(model.valueText).toBe('');
    expect(model.active).toBeNull();
    // 검색어만 바꿔도 다른 조건이 풀리지 않게 hidden으로 함께 보낸다.
    expect(model.carried).toEqual([{ key: 'sido', value: '41' }]);
  });

  test('검색 중이면 범위가 지금 조건 안임을 문장이 말하고 지우기 링크는 검색어만 뗀다', () => {
    const search = { ...EMPTY_TODAY_SEARCH, sido: '41', items: ['육류', '가금류'], q: '남산', cursor: '5796468' };
    const model = presentListSearch(search, 2);
    expect(model.valueText).toBe('남산');
    expect(model.active).toEqual({ text: '지금 조건 안에서 “남산” · 2건', clearHref: '/today?sido=41&items=육류,가금류' });
    // cursor는 조건이 바뀌면 뜻을 잃어 함께 보내지 않고, 검색어 자체는 입력 칸이 보낸다.
    expect(model.carried).toEqual([{ key: 'sido', value: '41' }, { key: 'items', value: '육류,가금류' }]);
  });

  test('결과 수를 모르면 건수 없이 범위만 말한다', () => {
    expect(presentListSearch({ ...EMPTY_TODAY_SEARCH, q: '남산' }, null).active?.text).toBe('지금 조건 안에서 “남산”');
  });
});
