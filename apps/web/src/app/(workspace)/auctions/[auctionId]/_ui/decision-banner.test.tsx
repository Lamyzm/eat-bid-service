import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { auctionFixture, closedAuctionFixture, fixtureNow, openAuctionFixture } from '../__fixtures__/auction';
import { presentDecision } from '../_model/present-decision';
import { DecisionBanner } from './decision-banner';

describe('결정 화면 배너', () => {
  test('진행 중이면 열려 있다는 문장과 마감까지 남은 시간을 보인다', () => {
    const markup = renderToStaticMarkup(<DecisionBanner decision={presentDecision(openAuctionFixture, fixtureNow)} />);
    expect(markup).toContain('이 공고가 열려 있습니다');
    expect(markup).toContain('마감까지');
    expect(markup).toContain('24시간 30분');
    expect(markup).toContain('개찰');
    expect(markup).not.toContain('NeaT');
  });
  test('개찰이 끝났으면 개찰 후 지난 시간과 마감 시각을 따로 보이고 개찰 시각을 두 번 쓰지 않는다', () => {
    const decision = presentDecision(closedAuctionFixture, fixtureNow);
    const markup = renderToStaticMarkup(<DecisionBanner decision={decision} />);
    expect(markup).toContain('개찰이 끝났습니다');
    expect(markup).toContain('개찰 후');
    expect(markup).toContain('20일 20시간');
    expect(markup).toContain(`>마감<`);
    expect(markup).toContain(decision.banner.deadlineAt);
    expect((markup.match(new RegExp(decision.banner.openedAt, 'g')) ?? []).length).toBe(1);
    expect(markup).not.toContain('개찰개찰');
  });
  test('마감 시각이 관측되지 않았으면 미확인이라고 한 번만 쓰고 꼬리를 중복하지 않는다', () => {
    const markup = renderToStaticMarkup(<DecisionBanner decision={presentDecision(auctionFixture, fixtureNow)} />);
    expect(markup).toContain('아직 관측되지 않았습니다');
    expect(markup).not.toContain('미확인 미확인');
    expect(markup).not.toContain('미확인미확인');
  });
});
