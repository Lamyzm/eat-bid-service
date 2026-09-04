import { describe, expect, test } from 'bun:test';

import { auctionFixture, fixtureNow } from './__fixtures__/auction';
import { loadAuctionPage } from './_model/load-auction-page';

const canonicalAuctionId = auctionFixture.identity.auctionId;

function createDependencies(overrides: Partial<Parameters<typeof loadAuctionPage>[1]> = {}) {
  return {
    parseAuctionId: (auctionId: string) => {
      if (auctionId !== canonicalAuctionId) throw new Error('유효하지 않은 ID');
      return auctionId;
    },
    getAuction: async () => auctionFixture,
    isNotFound: () => false,
    now: () => fixtureNow,
    ...overrides
  };
}

describe('공고 상세 route loader', () => {
  test('비동기 params를 기다린 뒤 canonical ID로 공고를 조회한다', async () => {
    const requestedIds: string[] = [];
    const result = await loadAuctionPage(
      Promise.resolve({ auctionId: canonicalAuctionId }),
      createDependencies({
        getAuction: async ({ auctionId }) => {
          requestedIds.push(auctionId);
          return auctionFixture;
        }
      })
    );

    expect(result?.identity.auctionId).toBe(canonicalAuctionId);
    expect(requestedIds).toEqual([canonicalAuctionId]);
  });

  test('유효하지 않은 ID는 네트워크 I/O 전에 not-found 결과로 중단한다', async () => {
    let requestCount = 0;
    const result = await loadAuctionPage(
      Promise.resolve({ auctionId: '01' }),
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
          createDependencies({
            getAuction: async () => {
              throw dependencyError;
            }
          })
        )
      ).rejects.toBe(dependencyError);
    }
  });
});
