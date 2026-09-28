import { describe, expect, test } from 'bun:test';
import {
  auctionFixture,
  fixtureNow
} from '@/app/(workspace)/auctions/[auctionId]/__fixtures__/auction';
import { presentAnalysisHeader } from './present-analysis-header';

describe('새 상세 상단의 최신 관측 표시', () => {
  test('더 늦은 관측이 제외됐으면 받은 두 시각을 KST로 적은 문장을 싣는다', () => {
    const header = presentAnalysisHeader(
      {
        ...auctionFixture,
        latestObservation: {
          state: 'not-reflected',
          excludedObservedAt: '2026-09-03T01:05:00Z',
          reflectedObservedAt: '2026-09-02T23:05:00Z'
        }
      },
      fixtureNow
    );
    expect(header.latestObservation).toEqual({
      title: '최신 관측 반영 안 됨',
      description:
        'eaT에서 2026-09-03 10:05에 받은 내용은 형식 문제로 반영하지 못했어요. ' +
        '아래는 2026-09-03 08:05에 받은 내용이라 지금 eaT와 다를 수 있어요.'
    });
  });

  test('반영됐거나 판정 재료가 없으면 경고하지 않는다', () => {
    expect(presentAnalysisHeader(auctionFixture, fixtureNow).latestObservation).toBeNull();
    expect(
      presentAnalysisHeader({ ...auctionFixture, latestObservation: { state: 'unknown' } }, fixtureNow)
        .latestObservation
    ).toBeNull();
  });
});
