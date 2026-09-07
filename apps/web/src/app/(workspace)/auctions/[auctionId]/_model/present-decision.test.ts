import { describe, expect, test } from 'bun:test';

import { auctionFixture, closedAuctionFixture, fixtureNow, openAuctionFixture } from '../__fixtures__/auction';
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
    expect(decision.plannedAmount.text).toBe('미확인');
  });
  test('개찰이 끝났으면 남은 시간 대신 지난 시간을 접두사 없이 쓴다', () => {
    const decision = presentDecision({ ...openAuctionFixture, schedule: { ...openAuctionFixture.schedule, deadlineAt: '2026-09-02T02:00:00Z', openedAt: '2026-09-02T05:00:00Z' } }, fixtureNow);
    expect(decision.railState).toBe('closed');
    expect(decision.banner.remaining).toBe('20시간 30분');
  });
  test('지난 시간이 24시간을 넘으면 일 단위로 접는다', () => {
    const decision = presentDecision(closedAuctionFixture, fixtureNow);
    expect(decision.railState).toBe('closed');
    expect(decision.banner.remaining).toBe('20일 20시간');
  });
  test('기초금액 소수부가 0이 아니면 그대로 보이고 0이면 생략한다', () => {
    const decision = presentDecision(
      { ...openAuctionFixture, pricing: { ...openAuctionFixture.pricing, baseAmount: { amount: '1234567890.50', currency: 'KRW' } } },
      fixtureNow
    );
    expect(decision.baseAmount.text).toBe('1,234,567,890.50');
  });

  test('소재지는 관측된 시도·시군구 라벨을 잇고 라벨이 없는 축은 코드로 대신하지 않는다', () => {
    expect(presentDecision(openAuctionFixture, fixtureNow).locationText).toBe('경상남도 창원시');
    const sidoOnly = { ...openAuctionFixture, location: { sido: openAuctionFixture.location.sido, sigungu: { ...openAuctionFixture.location.sigungu, label: null } } };
    expect(presentDecision(sidoOnly, fixtureNow).locationText).toBe('경상남도');
    expect(presentDecision({ ...openAuctionFixture, location: null }, fixtureNow).locationText).toBe('미확인');
  });
  test('참여 수는 관측 시각과 어제 대비 증감을 함께 내고 증감 0도 그대로 말한다', () => {
    const decision = presentDecision(openAuctionFixture, fixtureNow);
    expect(decision.participation).toEqual({ countText: '4곳', deltaText: '어제보다 +2', observedAtText: '09-03 10:00' });
    const flat = { ...openAuctionFixture, participation: { latest: { bidCount: 2, observedAt: '2026-09-03T01:00:00Z' }, dayEarlier: { bidCount: 2, observedAt: '2026-09-02T00:30:00Z' } } };
    expect(presentDecision(flat, fixtureNow).participation.deltaText).toBe('어제보다 +0');
    expect(presentDecision(auctionFixture, fixtureNow).participation).toEqual({ countText: '미확인', deltaText: null, observedAtText: null });
  });
});
