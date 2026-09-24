import { describe, expect, test } from 'bun:test';
import type { AnalysisFilterValue } from '@eatbid/contracts/api/v1/analysis';
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
  itemFilter: { kind: 'all' },
  overlayOrganizationIds: []
} satisfies AnalysisFilterValue;

const emptySeries = {
  kind: 'series' as const,
  response: {
    axis: null,
    target: null,
    targetTruncated: false,
    comparison: null,
    overlays: null,
    meta: {
      state: 'unavailable' as const,
      reason: 'snapshot-unavailable' as const,
      effectiveFilter: appliedFilter
    }
  }
};

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

  test('시간축 조회가 실패해도 공고 정보와 비교조건은 그대로 선다', async () => {
    // 차트 하나를 못 그린 일이 화면이 사라진 일이 되면 안 된다. 실패는 갈래로 오고 나머지는 남는다.
    const data = await loadAnalysisPage('5796468', null, {
      parseId: (id) => id,
      readAuction: async () => ({ kind: 'auction', response: openAuctionFixture }),
      readTimeSeries: async () => ({ kind: 'read-failed' }),
      now: () => fixtureNow
    });
    expect(data?.timeSeries).toEqual({ kind: 'read-failed' });
    expect(data?.header.organization).toBe('창원 남산초등학교');
    expect(data?.applied.state).toBe('pending');
    expect(data?.setup.presets.length).toBeGreaterThan(0);
  });

  test('기관과 일정이 없으면 제목에서 추론하지 않고 미확인을 표시하며 정밀 금액을 보존한다', () => {
    const header = presentAnalysisHeader({ ...auctionFixture, organization: null }, fixtureNow);
    expect(header.organization).toBe('구매기관 미확인');
    expect(header.facts[0]?.value).toBe('9,007,199,254,740,993.5원');
    expect(header.facts[2]?.value).toBe('미확인');
    expect(
      presentAnalysisHeader(
        { ...auctionFixture, organization: { ...auctionFixture.organization, name: null } },
        fixtureNow
      ).organization
    ).toBe('기관명 미확인');
  });

  test('상태 칩은 원천 라벨을 번역하지 않고 옮기며 빈 라벨은 미확인이라고 말한다', () => {
    // 운영 source_status는 코드가 아니라 원천 한글 문구다. 예전 판은 영문 코드만 알아 운영에서 늘 미확인이었다.
    for (const label of ['입찰마감', '낙찰', '유찰', '공고취소', '저장중'])
      expect(statusOf(label)).toBe(label);
    expect(statusOf('  ')).toBe('공고 상태 미확인');
  });

  test('원천이 진행중이라 말해도 마감 시각이 지났으면 마감이 지났다는 사실을 함께 말한다', () => {
    // fixtureNow는 2026-09-03T01:30:00Z다. 마감 순간은 이미 지난 것으로 본다.
    expect(statusAtDeadline('2026-09-03T02:00:00Z')).toBe('진행중');
    expect(statusAtDeadline('2026-09-03T01:30:00Z')).toBe('진행중 · 마감 지남');
    expect(statusAtDeadline('2026-09-02T23:00:00Z')).toBe('진행중 · 마감 지남');
    // 마감을 모르면 지났다고 말할 근거가 없다.
    expect(statusAtDeadline(null)).toBe('진행중');
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

function statusOf(status: string): string {
  return presentAnalysisHeader(
    { ...auctionFixture, identity: { ...auctionFixture.identity, status } },
    fixtureNow
  ).status;
}

function statusAtDeadline(deadlineAt: string | null): string {
  return presentAnalysisHeader(
    {
      ...auctionFixture,
      identity: { ...auctionFixture.identity, status: '진행중' },
      schedule: { ...auctionFixture.schedule, deadlineAt }
    },
    fixtureNow
  ).status;
}
