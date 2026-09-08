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
  test('참여 수는 최신 관측 시각과 비교 관측 날짜 대비 증감을 함께 내고 증감 0도 그대로 말한다', () => {
    const decision = presentDecision(openAuctionFixture, fixtureNow);
    expect(decision.participation).toEqual({ countText: '4곳', deltaText: '09-02 대비 +2', observedAtText: '09-03 10:00' });
    const flat = { ...openAuctionFixture, participation: { latest: { bidCount: 2, observedAt: '2026-09-03T01:00:00Z' }, dayEarlier: { bidCount: 2, observedAt: '2026-09-02T00:30:00Z' } } };
    expect(presentDecision(flat, fixtureNow).participation.deltaText).toBe('09-02 대비 +0');
  });
  // 계약의 dayEarlier는 24시간 "이상" 앞선 관측이라 상한이 없다. 사흘 전 관측을 어제라고 부르지 않는지 본다.
  test('비교 관측이 사흘 전이면 어제라 하지 않고 그 날짜를 그대로 말한다', () => {
    const stale = {
      ...openAuctionFixture,
      participation: { latest: { bidCount: 4, observedAt: '2026-09-03T01:00:00Z' }, dayEarlier: { bidCount: 4, observedAt: '2026-08-31T02:00:00Z' } }
    };
    const { participation } = presentDecision(stale, fixtureNow);
    expect(participation.deltaText).toBe('08-31 대비 +0');
    expect(participation.deltaText).not.toContain('어제');
    // 최신 기준 시각이 함께 나와야 사용자가 두 날짜의 간격을 읽을 수 있다.
    expect(participation.observedAtText).toBe('09-03 10:00');
  });
  // 해를 넘긴 비교는 월일만으로 최신 날짜와 구분되지 않는다. 그때만 연도를 붙인다.
  test('비교 관측이 최신과 다른 해면 연도까지 말한다', () => {
    const acrossYear = {
      ...openAuctionFixture,
      participation: { latest: { bidCount: 4, observedAt: '2027-01-02T01:00:00Z' }, dayEarlier: { bidCount: 4, observedAt: '2026-12-31T02:00:00Z' } }
    };
    expect(presentDecision(acrossYear, '2027-01-02T01:30:00Z').participation.deltaText).toBe('2026-12-31 대비 +0');
  });
  test('비교 관측이 없으면 증감을 지어내지 않고 관측 자체가 없으면 시각도 비운다', () => {
    const latestOnly = { ...openAuctionFixture, participation: { latest: { bidCount: 13, observedAt: '2026-09-03T01:00:00Z' }, dayEarlier: null } };
    expect(presentDecision(latestOnly, fixtureNow).participation).toEqual({ countText: '13곳', deltaText: null, observedAtText: '09-03 10:00' });
    expect(presentDecision(auctionFixture, fixtureNow).participation).toEqual({ countText: '미확인', deltaText: null, observedAtText: null });
  });
});
