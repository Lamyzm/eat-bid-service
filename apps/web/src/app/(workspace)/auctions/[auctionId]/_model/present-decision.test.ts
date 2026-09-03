import { describe, expect, test } from 'bun:test';

import { auctionFixture, fixtureNow, openAuctionFixture } from '../__fixtures__/auction';
import { presentDecision } from './present-decision';

describe('결정 화면 표시 모델', () => {
  test('시각을 KST로 표기하고 남은 시간을 주입된 now로 센다', () => {
    const decision = presentDecision(openAuctionFixture, fixtureNow);
    expect(decision.banner.deadlineAt).toBe('09-04 11:00');
    expect(decision.banner.openedAt).toBe('09-04 14:00');
    expect(decision.banner.remaining).toBe('24시간 30분');
    expect(decision.baseAmount.text).toBe('2,761,700');
    expect(decision.railState).toBe('open');
  });
  test('미관측 시각은 미확인이고 남은 시간도 미확인이다', () => {
    const decision = presentDecision(auctionFixture, fixtureNow);
    expect(decision.banner.deadlineAt).toBe('미확인');
    expect(decision.banner.remaining).toBe('미확인');
    expect(decision.railState).toBe('unknown');
  });
  test('개찰이 끝났으면 남은 시간 대신 지난 시간을 쓴다', () => {
    const decision = presentDecision({ ...openAuctionFixture, schedule: { ...openAuctionFixture.schedule, deadlineAt: '2026-09-02T02:00:00Z', openedAt: '2026-09-02T05:00:00Z' } }, fixtureNow);
    expect(decision.railState).toBe('closed');
    expect(decision.banner.remaining).toBe('개찰 20시간 30분 전');
  });
});
