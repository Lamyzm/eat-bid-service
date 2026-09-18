import { describe, expect, test } from 'bun:test';
import {
  auctionFixture,
  fixtureNow,
  openAuctionFixture
} from '@/app/(workspace)/auctions/[auctionId]/__fixtures__/auction';
import { loadAnalysisPage } from './load-analysis-page';
import { presentAnalysisHeader } from './present-analysis-header';

const appliedFilter = {
  targetOrganizationId: '41',
  excludeAttemptId: null,
  period: { from: '2026-01-01', to: '2026-09-04' },
  dateBasis: 'opened',
  comparisonScope: { kind: 'national' },
  floorRate: { value: '90.000', unit: 'percentage-points' },
  awardMethodCodeValueId: '31',
  listCountRange: { min: null, max: null },
  targetItemFilter: { kind: 'all' }
} as const;

const emptySeries = {
  kind: 'series',
  response: {
    axis: null,
    target: null,
    targetTruncated: false,
    comparison: null,
    meta: { state: 'unavailable', reason: 'snapshot-unavailable', effectiveFilter: appliedFilter }
  }
} as const;

describe('새 상세의 공고 조회와 표시', () => {
  test('공고 한 건과 한 번의 시각으로 초기 비교조건을 만들고 그 조건으로만 시간축을 조회한다', async () => {
    let reads = 0;
    let clocks = 0;
    const queries: unknown[] = [];
    const data = await loadAnalysisPage('5796468', null, {
      parseId: (id) => id,
      readAuction: async ({ auctionId }) => {
        reads += 1;
        expect(auctionId).toBe('5796468');
        return { kind: 'auction', response: openAuctionFixture };
      },
      readTimeSeries: async (query) => {
        queries.push(query);
        return emptySeries;
      },
      now: () => {
        clocks += 1;
        return fixtureNow;
      }
    });
    expect(reads).toBe(1);
    expect(clocks).toBe(1);
    // 조건은 한 번만 해석되고 그 조건 그대로 한 번만 조회한다.
    expect(queries).toHaveLength(1);
    expect(data?.timeSeries).toEqual({
      kind: 'unavailable',
      reason: '이 조건의 분석 자료가 아직 만들어지지 않았어요.'
    });
    expect(data?.applied.state).toBe('pending');
    expect(data?.header.organization).toBe('창원 남산초등학교');
    expect(data?.header.facts[0]?.value).toBe('2,761,700원');
    expect(data?.header.facts[3]?.value).toBe('2026-09-04 14:00');
  });

  test('기관과 일정이 없으면 제목에서 추론하지 않고 미확인을 표시하며 정밀 금액을 보존한다', () => {
    const header = presentAnalysisHeader({ ...auctionFixture, organization: null });
    expect(header.organization).toBe('구매기관 미확인');
    expect(header.facts[0]?.value).toBe('9,007,199,254,740,993.5원');
    expect(header.facts[2]?.value).toBe('미확인');
    expect(
      presentAnalysisHeader({
        ...auctionFixture,
        organization: { ...auctionFixture.organization, name: null }
      }).organization
    ).toBe('기관명 미확인');
  });

  test('조건이 무효하면 시간축을 조회하지 않는다', async () => {
    let series = 0;
    const data = await loadAnalysisPage('5796468', '{"이건":"조건이 아니다"}', {
      parseId: (id) => id,
      readAuction: async () => ({ kind: 'auction', response: openAuctionFixture }),
      readTimeSeries: async () => {
        series += 1;
        return emptySeries;
      },
      now: () => fixtureNow
    });
    // 무효 조건으로 보낸 요청은 400 왕복이 되고, 그때 화면이 보여야 할 것은 표본이 아니라 조건 안내다.
    expect(data?.applied.state).toBe('invalid');
    expect(data?.timeSeries).toBeNull();
    expect(series).toBe(0);
  });

  test('식별자가 잘못됐거나 공고가 없으면 조회를 조용히 다른 공고로 바꾸지 않는다', async () => {
    let reads = 0;
    const dependencies = {
      parseId: () => {
        throw new Error('잘못된 ID');
      },
      readAuction: async () => {
        reads += 1;
        return { kind: 'not-found' } as const;
      },
      readTimeSeries: async () => emptySeries,
      now: () => fixtureNow
    };
    expect(await loadAnalysisPage('bad', null, dependencies)).toBeNull();
    expect(reads).toBe(0);
    expect(await loadAnalysisPage('99', null, { ...dependencies, parseId: (id) => id })).toBeNull();
    expect(reads).toBe(1);
  });
});
