import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';

import { fixtureNow, openAuctionFixture } from '../__fixtures__/auction';
import { presentDecision } from '../_model/present-decision';
import { DecisionHeader } from './decision-header';

describe('결정 화면 헤더', () => {
  test('제목과 화면 조건 칩 셋을 보인다', () => {
    const screen = render(<DecisionHeader decision={presentDecision(openAuctionFixture, fixtureNow)} search={{ period: '12개월', scope: '전국' }} />);
    expect(screen.getByRole('heading', { name: openAuctionFixture.identity.title })).toBeTruthy();
    expect(screen.getByText('12개월')).toBeTruthy();
    expect(screen.getByText('전국')).toBeTruthy();
    expect(screen.getByText('공고 기준')).toBeTruthy();
  });
});
