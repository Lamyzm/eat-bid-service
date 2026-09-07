import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { attemptsFixture } from '../__fixtures__/attempts';
import { auctionFixture, closedAuctionFixture, fixtureNow, openAuctionFixture } from '../__fixtures__/auction';
import { presentHistory } from '../_model/attempt-history';
import { presentOrgCadence } from '../_model/org-cadence';
import { presentDecision } from '../_model/present-decision';
import { DecisionBanner } from './decision-banner';

const cadence = presentOrgCadence({ state: 'ready', presentation: presentHistory(attemptsFixture, null) }, { announcedAt: openAuctionFixture.schedule.announcedAt });
const unknownCadence = presentOrgCadence({ state: 'unavailable' }, { announcedAt: auctionFixture.schedule.announcedAt });

describe('결정 화면 배너', () => {
  test('진행 중이면 열려 있다는 문장과 마감까지 남은 시간을 보인다', () => {
    const markup = renderToStaticMarkup(<DecisionBanner decision={presentDecision(openAuctionFixture, fixtureNow)} cadence={cadence} />);
    expect(markup).toContain('이 공고가 열려 있습니다');
    expect(markup).toContain('마감까지');
    expect(markup).toContain('24시간 30분');
    expect(markup).toContain('개찰');
    expect(markup).not.toContain('NeaT');
  });
  test('개찰이 끝났으면 개찰 후 지난 시간과 마감 시각을 따로 보이고 개찰 시각을 두 번 쓰지 않는다', () => {
    const decision = presentDecision(closedAuctionFixture, fixtureNow);
    const markup = renderToStaticMarkup(<DecisionBanner decision={decision} cadence={cadence} />);
    expect(markup).toContain('개찰이 끝났습니다');
    expect(markup).toContain('개찰 후');
    expect(markup).toContain('20일 20시간');
    expect(markup).toContain(`>마감<`);
    expect(markup).toContain(decision.banner.deadlineAt);
    expect((markup.match(new RegExp(decision.banner.openedAt, 'g')) ?? []).length).toBe(1);
    expect(markup).not.toContain('개찰개찰');
  });
  test('마감 시각이 관측되지 않았으면 미확인이라고 한 번만 쓰고 꼬리를 중복하지 않는다', () => {
    const markup = renderToStaticMarkup(<DecisionBanner decision={presentDecision(auctionFixture, fixtureNow)} cadence={unknownCadence} />);
    expect(markup).toContain('아직 관측되지 않았습니다');
    expect(markup).not.toContain('미확인 미확인');
    expect(markup).not.toContain('미확인미확인');
  });

  test('참여 업체 수는 목록 관측과 어제 대비 증감으로, 정정·납품은 미확인으로, 지난 공고는 회차 이력으로 보인다', () => {
    const markup = renderToStaticMarkup(<DecisionBanner decision={presentDecision(openAuctionFixture, fixtureNow)} cadence={cadence} />);
    expect(markup).toContain('>참여<');
    expect(markup).toContain('4곳');
    expect(markup).toContain('어제보다 +2');
    expect(markup).toContain('정정 미확인');
    expect(markup).toContain('>납품<');
    expect(markup).toContain('지난 공고 08-07 · 25일 만');
  });
  test('하루 전 관측이 없으면 증감 대신 관측 시각을, 관측 자체가 없으면 참여 미확인을 꼬리 없이 보인다', () => {
    const latestOnly = { ...openAuctionFixture, participation: { latest: { bidCount: 13, observedAt: '2026-09-03T01:00:00Z' }, dayEarlier: null } };
    const withTime = renderToStaticMarkup(<DecisionBanner decision={presentDecision(latestOnly, fixtureNow)} cadence={cadence} />);
    expect(withTime).toContain('13곳');
    expect(withTime).toContain('09-03 10:00 관측');
    expect(withTime).not.toContain('어제보다');

    const none = renderToStaticMarkup(<DecisionBanner decision={presentDecision(auctionFixture, fixtureNow)} cadence={unknownCadence} />);
    expect(none).not.toContain('어제보다');
    expect(none).not.toContain('관측</span>');
    expect(none).not.toContain('지난 공고');
  });
});
