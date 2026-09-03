import { describe, expect, test } from 'bun:test';

import { closedAuctionFixture, fixtureNow, openAuctionFixture, auctionFixture } from '../__fixtures__/auction';
import { deriveRailState } from './rail-state';

describe('rail 상태 판정', () => {
  test('마감 전이면 진행 중이다', () => {
    expect(deriveRailState(openAuctionFixture.schedule, fixtureNow)).toBe('open');
  });
  test('개찰 시각이 지났으면 개찰 완료다', () => {
    expect(deriveRailState(closedAuctionFixture.schedule, fixtureNow)).toBe('closed');
  });
  test('마감이 지났지만 개찰 전이면 진행 중이 아니라 미확인이다', () => {
    expect(deriveRailState({ ...openAuctionFixture.schedule, deadlineAt: '2026-09-02T00:00:00Z', openedAt: '2026-09-05T00:00:00Z' }, fixtureNow)).toBe('unknown');
  });
  test('마감이 관측되지 않았으면 미확인이다', () => {
    expect(deriveRailState(auctionFixture.schedule, fixtureNow)).toBe('unknown');
  });
});
