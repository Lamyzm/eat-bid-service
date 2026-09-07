import { describe, expect, test } from 'bun:test';

import { attemptsFixture } from '../__fixtures__/attempts';
import { auctionFixture, fixtureNow } from '../__fixtures__/auction';
import { floor90DistributionFixture } from '../__fixtures__/distribution';
import type { DecisionSearch } from '../_lib/decision-search-params';
import { loadAuctionPage, type DecisionAuctionRead } from './load-auction-page';

const canonicalAuctionId = auctionFixture.identity.auctionId;
const auctionRead: DecisionAuctionRead = { kind: 'auction', response: auctionFixture };
const search: DecisionSearch = {
  period: '12개월',
  scope: '전국',
  view: '비교집단',
  item: null,
  myRate: null,
  rate: null,
  expand: null,
  pages: 1
};

function createDependencies(overrides: Partial<Parameters<typeof loadAuctionPage>[2]> = {}) {
  return {
    parseAuctionId: (auctionId: string) => {
      if (auctionId !== canonicalAuctionId) throw new Error('유효하지 않은 ID');
      return auctionId;
    },
    getAuction: async () => auctionRead,
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
          return auctionRead;
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
          return auctionRead;
        }
      })
    );

    expect(result).toBeNull();
    expect(requestCount).toBe(0);
  });

  test('not-found 결과 값만 404로 바꾸고 500과 503 예외는 다시 던진다', async () => {
    // 없음은 `use cache` 경계를 예외로 넘을 수 없어 값으로 온다. 예외로 오는 것은 모두 예상 밖 실패다.
    const notFoundResult = await loadAuctionPage(
      Promise.resolve({ auctionId: canonicalAuctionId }),
      search,
      createDependencies({ getAuction: async () => ({ kind: 'not-found' }) })
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
        getAuction: async () => ({ kind: 'auction', response: { ...auctionFixture, organization: null } }),
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

  test('회차 이력에 보고 있는 공고 자신이 있으면 표 행에서 뺀다', async () => {
    // 이미 개찰된 공고를 열면 서버 필터를 통과한 그 회차가 자기 과거 표에 실린다. 그 한 행만 화면이 뺀다.
    const self = { ...attemptsFixture.attempts[0]!, attemptId: canonicalAuctionId };
    const result = await loadAuctionPage(
      Promise.resolve({ auctionId: canonicalAuctionId }),
      search,
      createDependencies({
        listAttempts: async () => ({ ...attemptsFixture, attempts: [self, ...attemptsFixture.attempts] })
      })
    );

    expect(result?.history.state).toBe('ready');
    if (result?.history.state === 'ready') {
      expect(result.history.presentation.rows.map((row) => row.attemptId)).not.toContain(canonicalAuctionId);
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

  test('분포는 공고의 하한율·낙찰방식·기간을 코호트로 옮겨 조회한다', async () => {
    const requested: unknown[] = [];
    const result = await loadAuctionPage(
      Promise.resolve({ auctionId: canonicalAuctionId }),
      search,
      createDependencies({
        findDistribution: async (input) => {
          requested.push(input);
          return floor90DistributionFixture;
        }
      })
    );

    expect(requested).toEqual([
      {
        scope: 'national',
        floorRate: '90.000',
        awardMethod: '31',
        // fixtureNow(2026-09-03T01:30Z)는 KST로 10:30이라 이번 달이 2026-09다.
        from: '2025-10',
        to: '2026-09',
        granularity: 'total'
      }
    ]);
    expect(result?.distribution.state).toBe('ready');
  });

  test('크게 보기는 같은 계약을 달별 칸까지 요청한다', async () => {
    const requested: { granularity?: string }[] = [];
    await loadAuctionPage(
      Promise.resolve({ auctionId: canonicalAuctionId }),
      { ...search, expand: '비교집단' },
      createDependencies({
        findDistribution: async (input) => {
          requested.push(input);
          return floor90DistributionFixture;
        }
      })
    );
    expect(requested[0]?.granularity).toBe('month');
  });

  test('과거 회차 모달의 pages만큼 nextCursor를 따라 이어 붙이고 첫 페이지 presentation은 그대로 둔다', async () => {
    const requested: { cursor?: string; limit?: number }[] = [];
    const second = { ...attemptsFixture, attempts: attemptsFixture.attempts.slice(0, 3).map((attempt) => ({ ...attempt, attemptId: `9${attempt.attemptId}` })), nextCursor: null };
    const result = await loadAuctionPage(
      Promise.resolve({ auctionId: canonicalAuctionId }),
      { ...search, expand: '과거 회차', pages: 3 },
      createDependencies({
        listAttempts: async ({ cursor, limit }) => {
          requested.push({ cursor, limit });
          return cursor === undefined ? { ...attemptsFixture, nextCursor: '77' } : second;
        }
      })
    );
    if (result?.history.state !== 'ready') throw new Error('회차 이력이 준비되지 않았다');
    // 두 번째 페이지가 이력 끝이라 세 번째 요청은 나가지 않는다.
    expect(requested).toEqual([{ cursor: undefined, limit: 60 }, { cursor: '77', limit: 60 }]);
    expect(result.history.presentation.rows).toHaveLength(attemptsFixture.attempts.length);
    expect(result.history.expanded.presentation.rows).toHaveLength(attemptsFixture.attempts.length + 3);
    expect(result.history.expanded.presentation.nextCursor).toBeNull();
    expect(result.history.expanded.loadFailed).toBe(false);
  });

  test('pages는 과거 회차 모달이 열렸을 때만 뜻이 있고 손으로 고친 값은 1 이상 상한 이하로만 믿는다', async () => {
    for (const [expand, pages, expectedCalls] of [[null, 5, 1], ['과거 회차', 0, 1], ['과거 회차', 2.5, 1], ['과거 회차', 99, 10]] as const) {
      let calls = 0;
      await loadAuctionPage(
        Promise.resolve({ auctionId: canonicalAuctionId }),
        { ...search, expand, pages },
        createDependencies({
          listAttempts: async () => {
            calls += 1;
            return { ...attemptsFixture, nextCursor: String(calls) };
          }
        })
      );
      expect(calls).toBe(expectedCalls);
    }
  });

  test('이어 부르던 페이지가 실패하면 그 앞까지만 싣고 실패 사실을 남긴다', async () => {
    const result = await loadAuctionPage(
      Promise.resolve({ auctionId: canonicalAuctionId }),
      { ...search, expand: '과거 회차', pages: 2 },
      createDependencies({
        listAttempts: async ({ cursor }) => {
          if (cursor !== undefined) throw new Error('cursor invalid');
          return { ...attemptsFixture, nextCursor: '77' };
        }
      })
    );
    if (result?.history.state !== 'ready') throw new Error('회차 이력이 준비되지 않았다');
    expect(result.history.expanded.loadFailed).toBe(true);
    expect(result.history.expanded.presentation.rows).toHaveLength(attemptsFixture.attempts.length);
    expect(result.history.expanded.presentation.nextCursor).toBe('77');
  });

  test('코호트 재료가 없으면 조회하지 않고 잠긴 이유를 담는다', async () => {
    let called = false;
    const result = await loadAuctionPage(
      Promise.resolve({ auctionId: canonicalAuctionId }),
      search,
      createDependencies({
        getAuction: async () => ({ kind: 'auction', response: { ...auctionFixture, terms: null } }),
        findDistribution: async () => {
          called = true;
          return floor90DistributionFixture;
        }
      })
    );
    expect(result?.distribution).toEqual({ state: 'locked', reason: 'missing-terms' });
    expect(called).toBe(false);
  });

  test('분포 조회가 실패해도 화면 전체를 죽이지 않고 unavailable로 담는다', async () => {
    const result = await loadAuctionPage(
      Promise.resolve({ auctionId: canonicalAuctionId }),
      search,
      createDependencies({
        findDistribution: async () => {
          throw new Error('503');
        }
      })
    );
    expect(result?.decision.identity.auctionId).toBe(canonicalAuctionId);
    expect(result?.distribution).toEqual({ state: 'unavailable' });
    expect(result?.history.state).toBe('ready');
  });

  test('회차 이력과 분포는 공고 조회 뒤 함께 부른다', async () => {
    const started: string[] = [];
    const finished: string[] = [];
    await loadAuctionPage(
      Promise.resolve({ auctionId: canonicalAuctionId }),
      search,
      createDependencies({
        listAttempts: async () => {
          started.push('history');
          await Promise.resolve();
          finished.push('history');
          return attemptsFixture;
        },
        findDistribution: async () => {
          started.push('distribution');
          finished.push('distribution');
          return floor90DistributionFixture;
        }
      })
    );
    // 순차로 부르면 분포 시작이 회차 이력 완료 뒤에 온다. 병렬이면 둘 다 먼저 시작한다.
    expect(started).toEqual(['history', 'distribution']);
    expect(finished).toEqual(['distribution', 'history']);
  });

  test('URL의 내 값을 사다리 표시 모델에 그대로 넘긴다', async () => {
    const result = await loadAuctionPage(
      Promise.resolve({ auctionId: canonicalAuctionId }),
      { ...search, myRate: '90.030' },
      createDependencies()
    );
    expect(result?.distribution.state).toBe('ready');
    if (result?.distribution.state === 'ready') {
      expect(result.distribution.presentation.ladder?.myRate?.text).toBe('90.030');
    }
  });

  test('지역 모집단은 build의 코드 체계가 행안부가 아니면 회색으로 담긴다', async () => {
    const result = await loadAuctionPage(
      Promise.resolve({ auctionId: canonicalAuctionId }),
      { ...search, scope: '도' },
      createDependencies()
    );
    expect(result?.distribution.state).toBe('ready');
    if (result?.distribution.state === 'ready') {
      expect(result.distribution.presentation.state).toBe('unknown');
      expect(result.distribution.presentation.reason).toContain('행안부 기준이 아닙니다');
    }
  });
});
