import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';

import { fixtureNow, openAuctionsFixture } from '../__fixtures__/open-auctions';
import { EMPTY_TODAY_SEARCH } from '../_lib/today-search-params';
import { groupClosingSlots, koreanClockText } from '../_model/group-closing-slots';
import { presentOpenAuction } from '../_model/present-open-auctions';
import { OpenAuctionCards } from './open-auction-cards';

const rows = openAuctionsFixture.auctions.map((auction) => presentOpenAuction(auction, fixtureNow));

function renderCards() {
  return render(<OpenAuctionCards groups={groupClosingSlots(rows, fixtureNow)} search={{ ...EMPTY_TODAY_SEARCH, closesWithinHours: 72 }} />);
}

describe('마감 시각 묶음', () => {
  test('같은 날 같은 시각이 한 묶음이고 오늘은 시각과 남은 시간을, 다른 날은 날짜까지 말한다', () => {
    // fixture 지금은 KST 09-07 10:30이다. 20:00 마감은 9시간 뒤, 다음 날 00:30은 내일, 09-10 11:00은 사흘 뒤.
    const groups = groupClosingSlots(rows, fixtureNow);
    expect(groups.map((group) => [group.titleText, group.awayText, group.count, group.newDay, group.past])).toEqual([
      ['오후 8시 마감', '9시간 뒤', 1, false, false],
      ['9월 8일 화 · 오전 12시 30분 마감', '내일', 1, true, false],
      ['9월 10일 목 · 오전 11시 마감', '사흘 뒤', 1, true, false],
      ['마감 미확인', '', 1, true, false]
    ]);
  });

  test('지난 시각은 0이 아니라 지났어요이고 한 시간 안은 분으로 센다', () => {
    const later = groupClosingSlots(rows, '2026-09-07T10:45:00Z');
    expect(later[0]!.awayText).toBe('15분 뒤');
    const past = groupClosingSlots(rows, '2026-09-07T11:30:00Z');
    expect(past[0]!.awayText).toBe('지났어요');
    expect(past[0]!.past).toBe(true);
  });

  test('시각은 오전·오후 열두 시간 말로 적는다', () => {
    expect(koreanClockText(0, 0)).toBe('오전 12시');
    expect(koreanClockText(9, 0)).toBe('오전 9시');
    expect(koreanClockText(12, 0)).toBe('오후 12시');
    expect(koreanClockText(15, 30)).toBe('오후 3시 30분');
  });
});

describe('열린 공고 카드 목록', () => {
  test('마감 임박 순서를 응답 순서 그대로 렌더하고 행에는 표가 없다', () => {
    const screen = renderCards();
    const rendered = [...screen.container.querySelectorAll('[data-slot="auction-row"]')];
    expect(rendered.map((row) => row.getAttribute('data-closes'))).toEqual(['today', 'tomorrow', 'later', 'unknown']);
    expect(screen.container.querySelector('table')).toBeNull();
    // 묶음 머리가 시각을 말하므로 행에는 시각이 없다.
    expect(rendered[0]!.textContent).not.toContain('20:00');
  });

  test('묶음 머리는 시각·남은 시간·건수 한 줄이고 오늘 묶음에만 빨강, 내일 묶음에 amber가 붙는다', () => {
    const screen = renderCards();
    const heads = [...screen.container.querySelectorAll('[data-slot="closes"]')];
    expect(heads.map((node) => node.textContent)).toEqual(['오후 8시 마감', '9월 8일 화 · 오전 12시 30분 마감', '9월 10일 목 · 오전 11시 마감', '마감 미확인']);
    expect([...screen.container.querySelectorAll('.text-destructive')].map((node) => node.textContent)).toEqual(['오후 8시 마감']);
    expect([...screen.container.querySelectorAll('.text-pushed')].map((node) => node.textContent)).toEqual(['9월 8일 화 · 오전 12시 30분 마감']);
    // 행 안에는 상태색이 없다. 제한지역 미관측은 색이 아니라 굵기다.
    expect(screen.container.querySelectorAll('[data-slot="auction-row"] .text-destructive, [data-slot="auction-row"] .text-pushed').length).toBe(0);
    expect(screen.container.textContent).toContain('제한지역 미관측');
  });

  test('첫 줄은 기관 이름 링크와 품목 조각이고 결정 화면을 가리킨다', () => {
    const screen = renderCards();
    const links = [...screen.container.querySelectorAll('[data-slot="auction-row"] p:first-child > a')];
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/auctions/5796468', '/auctions/5796470', '/auctions/5796471', '/auctions/5796472']);
    expect(links[0]!.textContent).toBe('창원 남산초등학교');
    expect(screen.queryAllByText('열기').length).toBe(0);
    // 품목 링크가 거는 것은 첫 조각 하나다. 합성 라벨을 통째로 걸면 `육류`만 있는 행이 빠진다(EAT-230).
    expect(screen.getAllByRole('link', { name: '육류' })[0]!.getAttribute('href')).toBe('/today?items=육류&closesWithinHours=72');
    expect(screen.getByText('외 1', { exact: false })).toBeTruthy();
    expect(screen.getAllByText('품목 모름').length).toBe(2);
  });

  test('둘째 줄은 제목·공고번호 복사 손잡이·제한지역 미관측이고 지역은 행에 없다', () => {
    const screen = renderCards();
    const lines = [...screen.container.querySelectorAll('[data-slot="auction-row"] > div:first-child > p:nth-child(2)')].map((node) => node.textContent);
    // 제목이 없는 행은 빈칸이 아니라 미관측이다. 지역은 기둥의 축이라 행에 적지 않는다(U9).
    expect(lines).toEqual([
      '2026년 10월 학교급식 식재료(축산물) 구매 소액수의 견적 제출공고번호 복사 2026-0001',
      '제목 미관측공고번호 복사 2026-0001',
      '제목 미관측제한지역 미관측',
      '제목 미관측제한지역 미관측'
    ]);
    expect(screen.queryAllByRole('link', { name: '창원시' }).length).toBe(0);
    expect(screen.container.textContent).not.toContain('코드 ');
    expect(screen.getAllByRole('button', { name: '공고번호 복사 2026-0001' }).length).toBe(2);
  });

  test('셋째 줄은 지금·지난번·보통이고 참여 0은 아직 0곳이며 보통에는 표본 수가 붙는다', () => {
    const screen = renderCards();
    const lines = [...screen.container.querySelectorAll('[data-slot="auction-row"] > div:first-child > p:last-child')].map((node) => node.textContent);
    expect(lines).toEqual([
      '지금 5곳·지난번 17곳 (09-02) · 하한 아래 2·보통 5곳 12회 기준',
      '참여 미관측·지난번 개찰 회차 없음·보통 — 0회 기준',
      '아직 0곳',
      '아직 0곳'
    ]);
  });

  test('오른쪽은 금액과 하한이고 관측하지 못한 값은 미확인이다', () => {
    const screen = renderCards();
    const values = [...screen.container.querySelectorAll('[data-slot="auction-row"] > div:last-child')].map((node) => node.textContent);
    expect(values).toEqual(['2,761,700원하한 90%', '43,879,200원하한 90%', '미확인하한 미확인', '미확인하한 미확인']);
  });
});
