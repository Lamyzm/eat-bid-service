import { describe, expect, test } from 'bun:test';
import { createLoader } from 'nuqs/server';

import { buildFloorRoute } from '@/routing/floor';
import { floorSearchParsers, regionIdOf } from './floor-search';

const load = createLoader(floorSearchParsers);

describe('하한선 자리 주소 읽기', () => {
  test('다른 화면의 입구 줄이 만든 주소를 이 화면 parser가 같은 값으로 되읽는다', () => {
    expect(load(`http://local${buildFloorRoute({ region: '459', period: '3y', view: 'months', month: '2024-03' })}`)).toEqual({
      region: '459',
      period: '3y',
      ranks: false,
      view: 'months',
      month: '2024-03'
    });
    expect(load(`http://local${buildFloorRoute({ region: '459' })}`)).toEqual({ region: '459', period: '1y', ranks: false, view: 'points', month: null });
  });

  test('지역은 내부 숫자 ID 모양일 때만 읽는다', () => {
    expect(regionIdOf('459')).toBe('459');
    expect(regionIdOf('0459')).toBeNull();
    expect(regionIdOf('459; path=/')).toBeNull();
    expect(regionIdOf(null)).toBeNull();
  });
});
