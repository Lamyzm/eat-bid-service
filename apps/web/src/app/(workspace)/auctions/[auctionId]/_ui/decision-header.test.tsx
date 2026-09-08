import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';

import { attemptsFixture } from '../__fixtures__/attempts';
import { fixtureNow, openAuctionFixture } from '../__fixtures__/auction';
import { presentHistory } from '../_model/attempt-history';
import { presentOrgCadence } from '../_model/org-cadence';
import { presentDecision } from '../_model/present-decision';
import { DecisionHeader, summarizeItemLabel } from './decision-header';

const cadence = presentOrgCadence({ state: 'ready', presentation: presentHistory(attemptsFixture, null) }, { announcedAt: openAuctionFixture.schedule.announcedAt });
const unknownCadence = presentOrgCadence({ state: 'unavailable' }, { announcedAt: openAuctionFixture.schedule.announcedAt });
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
  test('현재 공고 제목과 품목을 보이고 분석 기간 메뉴는 분리한다', () => {
    const screen = render(<DecisionHeader decision={presentDecision(openAuctionFixture, fixtureNow)} cadence={cadence} />);
    expect(screen.getByRole('heading', { name: openAuctionFixture.identity.title })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '기간: 12개월' })).toBeNull();
    expect(screen.getByText('공고 기준')).toBeTruthy();
  });

  test('관측된 하한율과 품목 라벨을 보인다', () => {
    const screen = render(<DecisionHeader decision={presentDecision(openAuctionFixture, fixtureNow)} cadence={cadence} />);
    expect(screen.getByText(/하한율 90\.000/)).toBeTruthy();
    expect(screen.getByText('축산')).toBeTruthy();
  });

  test('품목이 여러 개면 칩은 첫 품목 외 n으로 접고 전체 목록은 title로 남긴다', () => {
    const multi = { ...openAuctionFixture, classification: { itemLabel: MULTI_ITEM_LABEL } };
    const screen = render(<DecisionHeader decision={presentDecision(multi, fixtureNow)} cadence={cadence} />);
    const chipValue = screen.getByText('농산물 외 6');
    expect(chipValue.parentElement?.getAttribute('title')).toBe('농산물, 수산물, 육류, 가공식품, 김치류, 곡류, 가금류');
    expect(screen.queryByText(MULTI_ITEM_LABEL)).toBeNull();
  });

  test('현재 공고 품목은 제목 다음 사실 행에서 확인한다', () => {
    const screen = render(<DecisionHeader decision={presentDecision(openAuctionFixture, fixtureNow)} cadence={cadence} />);
    const itemChip = screen.getByText('축산').parentElement;
    const heading = screen.getByRole('heading', { name: openAuctionFixture.identity.title });
    expect(itemChip?.parentElement === heading.nextElementSibling).toBe(true);
    expect(itemChip?.parentElement?.className).toContain('flex-wrap');
  });

  test('소재지·누적 회차·발주 주기를 기관 사실 조각으로 보이고 발주 주기에는 간격 표본 수를 붙인다', () => {
    const screen = render(<DecisionHeader decision={presentDecision(openAuctionFixture, fixtureNow)} cadence={cadence} />);
    expect(screen.getByText('소재지 경상남도 창원시')).toBeTruthy();
    expect(screen.getByText(cadence.attemptCountText)).toBeTruthy();
    expect(screen.getByText(cadence.cadenceText!)).toBeTruthy();
    expect(screen.getByText(cadence.cadenceBasisText!)).toBeTruthy();
    // 공고 번호는 헤더 조각이 아니다(spec A-1). 추적 정보로 옮겼다.
    expect(screen.queryByText(/공고 EAT-2026-0001/)).toBeNull();
  });

  test('사실 조각은 제목 다음 행에서 조각 단위로 줄이 바뀐다', () => {
    const screen = render(<DecisionHeader decision={presentDecision(openAuctionFixture, fixtureNow)} cadence={cadence} />);
    const heading = screen.getByRole('heading', { name: openAuctionFixture.identity.title });
    for (const text of ['소재지 경상남도 창원시', cadence.attemptCountText]) {
      const fact = screen.getByText(text);
      expect(fact.parentElement === heading.nextElementSibling).toBe(true);
      expect(fact.className).toContain('whitespace-nowrap');
    }
  });

  test('하한율·품목·소재지·회차가 관측되지 않으면 미확인이라고 말하고 주기 조각은 그리지 않는다', () => {
    const unobserved = { ...openAuctionFixture, terms: null, location: null, classification: null };
    const screen = render(<DecisionHeader decision={presentDecision(unobserved, fixtureNow)} cadence={unknownCadence} />);
    expect(screen.getByText(/하한율 미확인/)).toBeTruthy();
    expect(screen.getByText('품목 미확인')).toBeTruthy();
    expect(screen.getByText('소재지 미확인')).toBeTruthy();
    expect(screen.getByText('회차 미확인')).toBeTruthy();
    expect(screen.queryByText(/일마다 공고/)).toBeNull();
  });
});
