import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';

import { auctionFixture, closedAuctionFixture, fixtureNow, openAuctionFixture } from '../__fixtures__/auction';
import { presentDecision } from '../_model/present-decision';
import { AttemptSelectionProvider } from './attempt-selection';
import { DecisionHeader, summarizeItemLabel } from './decision-header';

// 운영 화면에서 관측된 원천 라벨 모양 그대로다(쉼표 앞뒤 공백 포함).
const MULTI_ITEM_LABEL = '농산물 , 수산물 , 육류 , 가공식품 , 김치류 , 곡류 , 가금류';

// 헤더의 `이 공고 정보`는 회차 선택 context의 패널 상태를 읽는다. 회차 목록은 이 화면 조각과 무관하다.
const renderHeader = (ui: ReactNode) =>
  render(<AttemptSelectionProvider rows={[]}>{ui}</AttemptSelectionProvider>);

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
    const screen = renderHeader(<DecisionHeader decision={presentDecision(openAuctionFixture, fixtureNow)} />);
    expect(screen.getByRole('heading', { name: openAuctionFixture.identity.title })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '기간: 12개월' })).toBeNull();
    expect(screen.getByText('공고 기준')).toBeTruthy();
  });

  test('관측된 하한율과 품목 라벨을 보인다', () => {
    const screen = renderHeader(<DecisionHeader decision={presentDecision(openAuctionFixture, fixtureNow)} />);
    expect(screen.getByText(/하한율 90\.000/)).toBeTruthy();
    expect(screen.getByText('축산')).toBeTruthy();
  });

  test('품목이 여러 개면 칩은 첫 품목 외 n으로 접고 전체 목록은 title로 남긴다', () => {
    const multi = { ...openAuctionFixture, classification: { itemLabel: MULTI_ITEM_LABEL } };
    const screen = renderHeader(<DecisionHeader decision={presentDecision(multi, fixtureNow)} />);
    const chipValue = screen.getByText('농산물 외 6');
    expect(chipValue.parentElement?.getAttribute('title')).toBe('농산물, 수산물, 육류, 가공식품, 김치류, 곡류, 가금류');
    expect(screen.queryByText(MULTI_ITEM_LABEL)).toBeNull();
  });

  test('현재 공고 사실은 제목 다음 한 행에서 조각 단위로 줄이 바뀐다', () => {
    const screen = renderHeader(<DecisionHeader decision={presentDecision(openAuctionFixture, fixtureNow)} />);
    const heading = screen.getByRole('heading', { name: openAuctionFixture.identity.title });
    for (const text of ['공고 지역 경상남도 창원시', '기초 2,761,700원']) {
      const fact = screen.getByText(text);
      expect(fact.parentElement === heading.nextElementSibling).toBe(true);
      expect(fact.className).toContain('whitespace-nowrap');
    }
  });

  test('진행 중 공고는 상태 배지와 마감까지 남은 시간·마감 시각을 짝지어 보인다', () => {
    const decision = presentDecision(openAuctionFixture, fixtureNow);
    const screen = renderHeader(<DecisionHeader decision={decision} />);
    expect(screen.getByText('진행 중')).toBeTruthy();
    expect(screen.getByText(`마감까지 ${decision.banner.remaining}`)).toBeTruthy();
    expect(screen.getByText(decision.banner.deadlineAt)).toBeTruthy();
  });

  test('개찰이 끝난 공고는 개찰 완료와 개찰 후 지난 시간·개찰 시각을 보인다', () => {
    const decision = presentDecision(closedAuctionFixture, fixtureNow);
    const screen = renderHeader(<DecisionHeader decision={decision} />);
    expect(screen.getByText('개찰 완료')).toBeTruthy();
    expect(screen.getByText(`개찰 후 ${decision.banner.remaining}`)).toBeTruthy();
    expect(screen.getByText(decision.banner.openedAt)).toBeTruthy();
  });

  test('마감 시각이 관측되지 않으면 미확인이라고 한 번만 쓰고 꼬리를 중복하지 않는다', () => {
    const screen = renderHeader(<DecisionHeader decision={presentDecision(auctionFixture, fixtureNow)} />);
    expect(screen.getAllByText('마감 미확인')).toHaveLength(2);
    expect(screen.container.textContent).not.toContain('미확인 미확인');
  });

  test('오른쪽 상세 진입은 이름이 보이는 버튼이고 헤더 사실 행이 소유한다', () => {
    const screen = renderHeader(<DecisionHeader decision={presentDecision(openAuctionFixture, fixtureNow)} />);
    const button = screen.getByRole('button', { name: '이 공고 정보' });
    expect(button.tagName).toBe('BUTTON');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(button.closest('[data-slot="decision-summary"]')).not.toBeNull();
  });

  test('기관 발주 주기와 참여 수는 헤더가 다시 강조하지 않는다', () => {
    // 두 값은 오른쪽 현재 공고 정보 패널이 소유한다. 헤더가 함께 강조하면 같은 사실이 두 번 경쟁한다(EAT-115).
    const screen = renderHeader(<DecisionHeader decision={presentDecision(openAuctionFixture, fixtureNow)} />);
    expect(screen.queryByText(/일마다 공고/)).toBeNull();
    expect(screen.queryByText(/대비 [+-]\d/)).toBeNull();
    expect(screen.container.textContent).not.toContain('4곳');
  });

  test('하한율·품목이 관측되지 않으면 미확인이라고 말하고 지역 조각은 그리지 않는다', () => {
    // 공고지역은 관측이 없을 때 요약 줄에서 뺀다. 상세는 오른쪽 현재 공고 정보 패널이 말한다(EAT-115).
    const unobserved = { ...openAuctionFixture, terms: null, location: null, classification: null };
    const screen = renderHeader(<DecisionHeader decision={presentDecision(unobserved, fixtureNow)} />);
    expect(screen.getByText(/하한율 미확인/)).toBeTruthy();
    expect(screen.getByText('품목 미확인')).toBeTruthy();
    expect(screen.queryByText(/공고 지역/)).toBeNull();
  });

  test('표시하는 지역은 eaT 공고지역이며 기관 소재지로 부르지 않는다', () => {
    // 두 축은 별개 코드 체계다. 라벨을 소재지로 부르면 화면이 관측하지 않은 사실을 말한다(AGENTS 2·6).
    const screen = renderHeader(<DecisionHeader decision={presentDecision(openAuctionFixture, fixtureNow)} />);
    expect(screen.getByText('공고 지역 경상남도 창원시')).toBeTruthy();
    expect(screen.queryByText(/소재지/)).toBeNull();
  });
});
