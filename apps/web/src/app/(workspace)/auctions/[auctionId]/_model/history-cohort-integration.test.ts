import { describe, expect, test } from 'bun:test';
import { attemptsFixture } from '../__fixtures__/attempts';
import { auctionFixture, fixtureNow } from '../__fixtures__/auction';
import { floor90DistributionFixture } from '../__fixtures__/distribution';
import type { DecisionSearch } from '../_lib/decision-search-params';
import { loadAuctionPage } from './load-auction-page';

const search: DecisionSearch = { period: '12개월', scope: '전국', view: '흐름', item: null, myRate: null, rate: null, expand: null, pages: 1 };

async function load(overrides: Partial<DecisionSearch> = {}, auction = auctionFixture) {
  const historyCalls: Record<string, unknown>[] = [];
  const distributionCalls: unknown[] = [];
  let clockCalls = 0;
  const result = await loadAuctionPage(Promise.resolve({ auctionId: auction.identity.auctionId }), { ...search, ...overrides }, {
    parseAuctionId: (id) => id,
    getAuction: async () => ({ kind: 'auction', response: auction }),
    now: () => { clockCalls += 1; return fixtureNow; },
    listAttempts: async (input) => {
      historyCalls.push(input);
      return { ...attemptsFixture, nextCursor: input.cursor ? null : '77' };
    },
    findDistribution: async (input) => { distributionCalls.push(input); return floor90DistributionFixture; }
  });
  return { result, historyCalls, distributionCalls, clockCalls };
}

describe('실제 화면의 기관 비교 조건 연결', () => {
  test('기관 표와 흐름을 공고 하한율·방식·같은 KST 기간으로 서버 조회한다', async () => {
    const { historyCalls, clockCalls } = await load();
    expect(historyCalls).toEqual([{ organizationId: '3101', floorRate: '90.000', awardMethod: '31', from: '2025-10', to: '2026-09', opened: 'only', limit: 60 }]);
    expect(clockCalls).toBe(1);
  });

  test('추가 페이지에도 선택한 하한과 품목 및 5년 기간을 그대로 전달한다', async () => {
    const { historyCalls } = await load({ floor: '88.000', item: '7', period: '5년', expand: '과거 회차', pages: 2 });
    expect(historyCalls).toHaveLength(2);
    for (const input of historyCalls) expect(input).toMatchObject({ floorRate: '88.000', awardMethod: '31', item: '7', from: '2021-10', to: '2026-09' });
    expect(historyCalls[1]?.cursor).toBe('77');
  });

  test('하한 전체와 미확인은 서로 다른 요청이고 지원하지 않는 분포를 조회하지 않는다', async () => {
    for (const floor of ['all', 'unknown']) {
      const { result, historyCalls, distributionCalls } = await load({ floor });
      expect(historyCalls[0]?.floorRate).toBe(floor);
      expect(distributionCalls).toEqual([]);
      expect(result?.distribution).toEqual({ state: 'locked', reason: 'unsupported-filter' });
    }
  });

  test('품목이나 5년을 선택하면 조건을 무시한 전국 분포를 대신 표시하지 않는다', async () => {
    for (const override of [{ item: '7' }, { period: '5년' as const }]) {
      const { result, distributionCalls } = await load(override);
      expect(distributionCalls).toEqual([]);
      expect(result?.distribution).toEqual({ state: 'locked', reason: 'unsupported-filter' });
    }
  });

  test('잘못된 하한 문자열은 공고의 확인된 하한으로 복귀하고 90을 추측하지 않는다', async () => {
    const { historyCalls } = await load({ floor: '88.00' });
    expect(historyCalls[0]?.floorRate).toBe('90.000');
  });
});
