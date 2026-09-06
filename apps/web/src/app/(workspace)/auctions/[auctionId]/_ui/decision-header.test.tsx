import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';

import { fixtureNow, openAuctionFixture } from '../__fixtures__/auction';
import { presentDecision } from '../_model/present-decision';
import { DecisionHeader } from './decision-header';

const search = { period: '12개월', scope: '전국', view: '비교집단', item: null, myRate: null, expand: false } as const;

describe('결정 화면 헤더', () => {
  test('제목과 화면 조건 칩 셋을 보인다', () => {
    const screen = render(<DecisionHeader decision={presentDecision(openAuctionFixture, fixtureNow)} search={search} />);
    expect(screen.getByRole('heading', { name: openAuctionFixture.identity.title })).toBeTruthy();
    expect(screen.getByText('12개월')).toBeTruthy();
    expect(screen.getByText('전국')).toBeTruthy();
    expect(screen.getByText('공고 기준')).toBeTruthy();
  });

  test('관측된 하한율과 품목 라벨을 보인다', () => {
    const screen = render(<DecisionHeader decision={presentDecision(openAuctionFixture, fixtureNow)} search={search} />);
    expect(screen.getByText(/하한율 90\.000/)).toBeTruthy();
    expect(screen.getByText('축산')).toBeTruthy();
  });

  test('하한율과 품목이 관측되지 않으면 미확인이라고 말한다', () => {
    const unobserved = { ...openAuctionFixture, terms: null, location: null, classification: null };
    const screen = render(<DecisionHeader decision={presentDecision(unobserved, fixtureNow)} search={search} />);
    expect(screen.getByText(/하한율 미확인/)).toBeTruthy();
    expect(screen.getByText('품목 미확인')).toBeTruthy();
  });
});
