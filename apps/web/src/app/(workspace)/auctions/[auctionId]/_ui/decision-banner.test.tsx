import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { auctionFixture, fixtureNow, openAuctionFixture } from '../__fixtures__/auction';
import { presentDecision } from '../_model/present-decision';
import { DecisionBanner } from './decision-banner';

describe('결정 화면 배너', () => {
  test('진행 중이면 열려 있다는 문장과 마감까지 남은 시간을 보인다', () => {
    const markup = renderToStaticMarkup(<DecisionBanner decision={presentDecision(openAuctionFixture, fixtureNow)} record={null} />);
    expect(markup).toContain('이 공고가 열려 있습니다');
    expect(markup).toContain('24시간 30분');
    expect(markup).toContain('아직 없음');
    expect(markup).not.toContain('NeaT');
  });
  test('기록이 있으면 값과 시각을 보인다', () => {
    const markup = renderToStaticMarkup(<DecisionBanner decision={presentDecision(openAuctionFixture, fixtureNow)} record={{ rate: '90.309', recordedAt: '10:32' }} />);
    expect(markup).toContain('90.309 · 10:32');
  });
  test('마감이 관측되지 않았으면 미확인이라고 쓴다', () => {
    const markup = renderToStaticMarkup(<DecisionBanner decision={presentDecision(auctionFixture, fixtureNow)} record={null} />);
    expect(markup).toContain('아직 관측되지 않았습니다');
    expect(markup).toContain('미확인');
  });
});
