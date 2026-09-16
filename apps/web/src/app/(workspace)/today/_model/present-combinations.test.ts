import { describe, expect, test } from 'bun:test';

import type {
  MyFilterCombinationCountsV1Response,
  MyFilterCombinationsV1Response
} from '@eatbid/contracts/api/v1/me';

import { EMPTY_TODAY_SEARCH, type TodaySearch } from '../_lib/today-search-params';
import { presentCombinations } from './present-combinations';

const TODAY = '2026-09-16';

const savedCombination: MyFilterCombinationsV1Response['combinations'][number] = {
  filterCombinationId: '11',
  name: '김해 축산',
  filter: {
    sido: '48',
    sigungu: null,
    items: ['육류'],
    baseAmountMin: '1000000.00',
    baseAmountMax: null
  },
  createdAt: '2026-09-15T01:00:00Z'
};

const currentSearch: TodaySearch = {
  ...EMPTY_TODAY_SEARCH,
  sido: '48',
  items: ['육류'],
  baseAmountMin: '1000000.00'
};

const counts: MyFilterCombinationCountsV1Response = {
  defaults: [
    { key: 'regionAll', count: 31 },
    { key: 'regionClosingToday', count: 4 },
    { key: 'noBids', count: 2 },
    { key: 'itemUnknownIncluded', count: 9 }
  ],
  saved: [{ filterCombinationId: '11', count: 7 }],
  meta: {
    asOf: '2026-09-16T00:30:00Z',
    openAuctionSnapshotBuild: {
      buildId: '212',
      sourceReleaseId: 'c2eedaf7-bafc-59f1-bdd4-523f57c8a024',
      calcVersion: 'mart-r3',
      computedAt: '2026-09-09T10:32:04Z',
      coverage: 'unknown',
      regionScheme: 'eat:auction-location-sigungu'
    }
  }
};

function present(search: TodaySearch, override: Partial<Parameters<typeof presentCombinations>[0]> = {}) {
  return presentCombinations({
    combinations: [savedCombination],
    counts,
    search,
    today: TODAY,
    savedLimit: 5,
    regionText: '경남/김해시',
    ...override
  });
}

describe('조합 기둥 표시 변환', () => {
  test('건수를 못 읽었으면 0이 아니라 비운다', () => {
    const presentation = present(currentSearch, { counts: null });
    expect(presentation.defaults.map((row) => row.count)).toEqual([null, null, null]);
    expect(presentation.saved[0]!.count).toBeNull();
  });

  test('기본 셋은 오늘이 맨 위이고 관측된 지역 라벨로 부른다', () => {
    const presentation = present(currentSearch);
    expect(presentation.defaults.map((row) => [row.name, row.count])).toEqual([
      ['오늘 경남/김해시', 4],
      ['경남/김해시 전부', 31],
      ['품목 미상 포함', 9]
    ]);
  });

  test('참여 0곳은 계약이 세어 주더라도 기둥에 세우지 않는다', () => {
    // 단독입찰을 허용하지 않는 공고가 대부분이라 참여 0곳은 기회가 아니라 혼자 들어가면 유찰이라는
    // 신호다. 그 조건을 아직 읽지 않아 옆에 적어 줄 수 없으므로 전면에 세우지 않는다(사용자 결정 2026-09-16).
    expect(present(currentSearch).defaults.map((row) => row.key)).not.toContain('noBids');
  });

  test('고른 지역이 하나가 아니면 지역 이름을 지어내지 않는다', () => {
    const presentation = present(currentSearch, { regionText: null });
    expect(presentation.defaults.map((row) => row.name)).toEqual([
      '오늘 내 지역',
      '내 지역 전부',
      '품목 미상 포함'
    ]);
  });

  test('저장 칸에 채울 이름은 축 이름을 빼고 값만 잇는다', () => {
    expect(present(currentSearch).suggestedName).toBe('경남/김해시 · 육류 · 금액 이상');
    expect(present(EMPTY_TODAY_SEARCH).suggestedName).toBe('');
  });

  test('앞 둘은 조건을 지우고 뒤 하나는 지금 조건에 더한다', () => {
    const [closingToday, regionAll, itemUnknown] = present(currentSearch).defaults;
    expect(regionAll!.href).toBe('/today');
    expect(closingToday!.href).toBe(`/today?closesOn=${TODAY}`);
    expect(itemUnknown!.href).toBe('/today?sido=48&items=육류&itemUnknown=include&baseAmountMin=1000000.00');
  });

  test('전체 보기로 넓힌 상태는 기본 넷의 이동에도 따라간다', () => {
    const [closingToday, regionAll] = present({ ...currentSearch, scope: 'all' }).defaults;
    expect(regionAll!.href).toBe('/today?scope=all');
    expect(closingToday!.href).toBe(`/today?scope=all&closesOn=${TODAY}`);
  });

  test('저장된 조합은 저장한 조건만 걸고 날짜 축과 cursor를 지운다', () => {
    const presentation = present({ ...currentSearch, closesOn: TODAY, cursor: 'c1' });
    expect(presentation.saved[0]!.href).toBe('/today?sido=48&items=육류&baseAmountMin=1000000.00');
  });

  test('지금 조건이 저장된 조합과 같으면 켜짐이고 저장할 것이 없다', () => {
    const presentation = present(currentSearch);
    expect(presentation.saved[0]!.active).toBe(true);
    expect(presentation.canSaveCurrent).toBe(false);
  });

  test('날짜 축만 다른 조건도 같은 조합으로 본다 — 조합은 날짜를 저장하지 않는다', () => {
    expect(present({ ...currentSearch, closesOn: TODAY }).saved[0]!.active).toBe(true);
  });

  test('품목 하나가 다르면 다른 조건이라 저장할 것이 생긴다', () => {
    const presentation = present({ ...currentSearch, items: ['육류', '가금류'] });
    expect(presentation.saved[0]!.active).toBe(false);
    expect(presentation.canSaveCurrent).toBe(true);
  });

  test('조건이 하나도 없으면 저장할 것이 없다', () => {
    expect(present(EMPTY_TODAY_SEARCH).canSaveCurrent).toBe(false);
  });

  test('날짜 축만 걸린 조건도 저장 대상이 아니다 — 조합이 저장하지 않는 축이다', () => {
    expect(present({ ...EMPTY_TODAY_SEARCH, closesOn: TODAY }).canSaveCurrent).toBe(false);
  });

  test('저장된 조합만 지울 수 있다', () => {
    const presentation = present(currentSearch);
    expect(presentation.defaults.every((row) => row.filterCombinationId === null)).toBe(true);
    expect(presentation.saved[0]!.filterCombinationId).toBe('11');
  });
});
