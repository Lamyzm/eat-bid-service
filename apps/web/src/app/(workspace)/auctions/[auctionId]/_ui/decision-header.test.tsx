import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';

import { fixtureNow, openAuctionFixture } from '../__fixtures__/auction';
import { presentDecision } from '../_model/present-decision';
import { DecisionHeader, summarizeItemLabel } from './decision-header';

const search = { period: '12개월', scope: '전국', view: '비교집단', item: null, myRate: null, rate: null, expand: null, pages: 1 } as const;
// 운영 화면에서 관측된 원천 라벨 모양 그대로다(쉼표 앞뒤 공백 포함).
const MULTI_ITEM_LABEL = '농산물 , 수산물 , 육류 , 가공식품 , 김치류 , 곡류 , 가금류';

describe('품목 라벨 축약', () => {
  test('품목이 하나면 라벨을 그대로 두고 전체 목록을 남기지 않는다', () => {
    expect(summarizeItemLabel('축산')).toEqual({ text: '축산', full: null });
  });

  test('품목이 여러 개면 첫 품목 외 나머지 개수로 접고 전체 목록을 다듬어 남긴다', () => {
    expect(summarizeItemLabel(MULTI_ITEM_LABEL)).toEqual({
      text: '농산물 외 6',
      full: '농산물, 수산물, 육류, 가공식품, 김치류, 곡류, 가금류'
    });
  });

  test('빈 조각(연속 쉼표·끝 쉼표)은 품목으로 세지 않는다', () => {
    expect(summarizeItemLabel('농산물,,수산물,')).toEqual({ text: '농산물 외 1', full: '농산물, 수산물' });
  });
});

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

  test('품목이 여러 개면 칩은 첫 품목 외 n으로 접고 전체 목록은 title로 남긴다', () => {
    const multi = { ...openAuctionFixture, classification: { itemLabel: MULTI_ITEM_LABEL } };
    const screen = render(<DecisionHeader decision={presentDecision(multi, fixtureNow)} search={search} />);
    const chipValue = screen.getByText('농산물 외 6');
    expect(chipValue.parentElement?.getAttribute('title')).toBe('농산물, 수산물, 육류, 가공식품, 김치류, 곡류, 가금류');
    expect(screen.queryByText(MULTI_ITEM_LABEL)).toBeNull();
  });

  test('품목 칩은 기간·모집단 칩과 같은 줄바꿈 컨테이너의 직계 자식이다', () => {
    const screen = render(<DecisionHeader decision={presentDecision(openAuctionFixture, fixtureNow)} search={search} />);
    const itemChip = screen.getByText('축산').parentElement;
    const periodChip = screen.getByText('12개월').parentElement;
    const heading = screen.getByRole('heading', { name: openAuctionFixture.identity.title });
    expect(itemChip?.parentElement).toBe(heading.parentElement);
    expect(periodChip?.parentElement).toBe(heading.parentElement);
    expect(heading.parentElement?.className).toContain('flex-wrap');
  });

  test('하한율과 품목이 관측되지 않으면 미확인이라고 말한다', () => {
    const unobserved = { ...openAuctionFixture, terms: null, location: null, classification: null };
    const screen = render(<DecisionHeader decision={presentDecision(unobserved, fixtureNow)} search={search} />);
    expect(screen.getByText(/하한율 미확인/)).toBeTruthy();
    expect(screen.getByText('품목 미확인')).toBeTruthy();
  });
});
