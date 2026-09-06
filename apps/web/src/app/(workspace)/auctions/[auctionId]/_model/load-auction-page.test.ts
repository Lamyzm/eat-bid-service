import { describe, expect, test } from 'bun:test';

import { attemptsFixture } from '../__fixtures__/attempts';
import { auctionFixture, fixtureNow } from '../__fixtures__/auction';
import { floor90DistributionFixture } from '../__fixtures__/distribution';
import type { DecisionSearch } from '../_lib/decision-search-params';
import { loadAuctionPage } from './load-auction-page';

const canonicalAuctionId = auctionFixture.identity.auctionId;
const search: DecisionSearch = {
  period: '12개월',
  scope: '전국',
  view: '비교집단',
  item: null,
  myRate: null,
  expand: false
};

function createDependencies(overrides: Partial<Parameters<typeof loadAuctionPage>[2]> = {}) {
  return {
    parseAuctionId: (auctionId: string) => {
      if (auctionId !== canonicalAuctionId) throw new Error('유효하지 않은 ID');
      return auctionId;
    },
    getAuction: async () => auctionFixture,
    isNotFound: () => false,
    now: () => fixtureNow,
    listAttempts: async () => attemptsFixture,
    findDistribution: async () => floor90DistributionFixture,
    ...overrides
  };
}

describe('공고 상세 route loader', () => {
  test('비동기 params를 기다린 뒤 canonical ID로 공고를 조회한다', async () => {
    const requestedIds: string[] = [];
    const result = await loadAuctionPage(
      Promise.resolve({ auctionId: canonicalAuctionId }),
      search,
      createDependencies({
        getAuction: async ({ auctionId }) => {
          requestedIds.push(auctionId);
          return auctionFixture;
        }
      })
    );

    expect(result?.decision.identity.auctionId).toBe(canonicalAuctionId);
    expect(requestedIds).toEqual([canonicalAuctionId]);
  });

  test('유효하지 않은 ID는 네트워크 I/O 전에 not-found 결과로 중단한다', async () => {
    let requestCount = 0;
    const result = await loadAuctionPage(
      Promise.resolve({ auctionId: '01' }),
      search,
      createDependencies({
        getAuction: async () => {
          requestCount += 1;
          return auctionFixture;
        }
      })
    );

    expect(result).toBeNull();
    expect(requestCount).toBe(0);
  });

  test('resource not found만 not-found로 바꾸고 500과 503은 다시 던진다', async () => {
    const notFoundError = new Error('공고 없음');
    const notFoundResult = await loadAuctionPage(
      Promise.resolve({ auctionId: canonicalAuctionId }),
      search,
      createDependencies({
        getAuction: async () => {
          throw notFoundError;
        },
        isNotFound: (error) => error === notFoundError
      })
    );
    expect(notFoundResult).toBeNull();

    for (const status of [500, 503]) {
      const dependencyError = Object.assign(new Error('의존성 오류'), { status });
      await expect(
        loadAuctionPage(
          Promise.resolve({ auctionId: canonicalAuctionId }),
          search,
          createDependencies({
            getAuction: async () => {
              throw dependencyError;
            }
          })
        )
      ).rejects.toBe(dependencyError);
    }
  });

  test('공고에 organization이 없으면 회차 이력을 조회하지 않고 no-organization을 담는다', async () => {
    let listCalled = false;
    const result = await loadAuctionPage(
      Promise.resolve({ auctionId: canonicalAuctionId }),
      search,
      createDependencies({
        getAuction: async () => ({ ...auctionFixture, organization: null }),
        listAttempts: async () => {
          listCalled = true;
          return attemptsFixture;
        }
      })
    );

    expect(result?.history).toEqual({ state: 'no-organization' });
    expect(listCalled).toBe(false);
  });

  test('회차 이력 조회가 실패해도 공고 본문은 그대로 담고 history만 unavailable로 담는다', async () => {
    const result = await loadAuctionPage(
      Promise.resolve({ auctionId: canonicalAuctionId }),
      search,
      createDependencies({
        listAttempts: async () => {
          throw new Error('404');
        }
      })
    );

    expect(result?.decision.identity.auctionId).toBe(canonicalAuctionId);
    expect(result?.history).toEqual({ state: 'unavailable' });
  });

  test('organization과 회차 이력 조회가 모두 성공하면 ready 상태로 presentation을 담는다', async () => {
    const requestedOrganizationIds: string[] = [];
    const result = await loadAuctionPage(
      Promise.resolve({ auctionId: canonicalAuctionId }),
      search,
      createDependencies({
        listAttempts: async ({ organizationId }) => {
          requestedOrganizationIds.push(organizationId);
          return attemptsFixture;
        }
      })
    );

    expect(requestedOrganizationIds).toEqual([auctionFixture.organization?.organizationId]);
    expect(result?.history.state).toBe('ready');
    if (result?.history.state === 'ready') {
      expect(result.history.presentation.rows).toHaveLength(attemptsFixture.attempts.length);
    }
  });

  test('URL의 item이 양의 정수 형식이 아니면 회차 이력 조회 전에 무효 처리한다', async () => {
    const requestedItems: (string | undefined)[] = [];
    const result = await loadAuctionPage(
      Promise.resolve({ auctionId: canonicalAuctionId }),
      { ...search, item: '007' },
      createDependencies({
        listAttempts: async ({ item }) => {
          requestedItems.push(item);
          return attemptsFixture;
        }
      })
    );

    expect(requestedItems).toEqual([undefined]);
    expect(result?.history.state).toBe('ready');
    if (result?.history.state === 'ready') expect(result.history.presentation.selectedItem).toBeNull();
  });
});
