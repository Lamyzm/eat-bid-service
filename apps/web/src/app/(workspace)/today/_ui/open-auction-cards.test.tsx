import { describe, expect, test } from 'bun:test';
import { render } from '@testing-library/react';

import { fixtureNow, openAuctionsFixture } from '../__fixtures__/open-auctions';
import { EMPTY_TODAY_SEARCH } from '../_lib/today-search-params';
import { groupClosingDays, groupClosingSlots, koreanClockText } from '../_model/group-closing-slots';
import { presentOpenAuction } from '../_model/present-open-auctions';
import { OpenAuctionCards } from './open-auction-cards';

const rows = openAuctionsFixture.auctions.map((auction) => presentOpenAuction(auction, fixtureNow));

function renderCards() {
  const days = groupClosingDays(groupClosingSlots(rows, fixtureNow), fixtureNow);
  return render(<OpenAuctionCards days={days} search={{ ...EMPTY_TODAY_SEARCH, closesWithinHours: 72 }} />);
}

describe('마감 시각 묶음', () => {
  test('같은 날 같은 시각이 한 묶음이고 묶음 머리는 날짜를 적지 않는다', () => {
    // fixture 지금은 KST 09-07 10:30이다. 20:00 마감은 9시간 뒤, 다음 날 00:30은 내일, 09-10 11:00은 사흘 뒤.
    // 날짜는 한 단 위의 날짜 묶음이 한 번만 말하므로 시각 묶음 머리에는 시각만 있다.
    const groups = groupClosingSlots(rows, fixtureNow);
    expect(groups.map((group) => [group.titleText, group.awayText, group.count, group.past])).toEqual([
      ['오후 8시 마감', '9시간 뒤', 1, false],
      ['오전 12시 30분 마감', '내일', 1, false],
      ['오전 11시 마감', '사흘 뒤', 1, false],
      ['마감 미확인', '', 1, false]
    ]);
  });

  test('날짜 묶음이 시각 묶음을 날짜별로 다시 묶고 오늘은 남은 시간을 되풀이하지 않는다', () => {
    const days = groupClosingDays(groupClosingSlots(rows, fixtureNow), fixtureNow);
    expect(days.map((day) => [day.dayText, day.awayText, day.count])).toEqual([
      // 오늘의 급함은 `9시간 뒤`처럼 시각 묶음이 말하므로 날짜 머리는 비운다.
      ['오늘', '', 1],
      ['9월 8일 화', '내일', 1],
      ['9월 10일 목', '사흘 뒤', 1],
      ['마감 미확인', '', 1]
    ]);
    // 한 날에 시각 묶음이 여럿이면 건수는 합이다.
    expect(days.every((day) => day.count === day.slots.reduce((sum, slot) => sum + slot.count, 0))).toBe(true);
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

  test('날짜 머리가 붙어 따라오고 시각 머리는 그 아래에서 날짜 없이 시각만 말한다', () => {
    const screen = renderCards();
    const dayHeads = [...screen.container.querySelectorAll('[data-slot="closes-day"]')];
    expect(dayHeads.map((node) => node.textContent)).toEqual(['오늘1건', '9월 8일 화내일1건', '9월 10일 목사흘 뒤1건', '마감 미확인1건']);
    // 붙어 따라오지 않으면 스무 행을 지나는 순간 지금 보는 것이 언제 마감인지가 화면에서 사라진다.
    expect(dayHeads.every((node) => node.className.includes('sticky'))).toBe(true);
    const heads = [...screen.container.querySelectorAll('[data-slot="closes"]')];
    // 마감을 관측하지 못한 묶음에는 시각 머리가 없다 — 날짜 머리가 이미 그 말을 했다.
    expect(heads.map((node) => node.textContent)).toEqual(['오후 8시 마감', '오전 12시 30분 마감', '오전 11시 마감']);
    // red·amber를 쓰지 않는다 — amber는 stale·부분 수집의 색이고, 오늘 마감이 0건인 날에는 첫 화면의
    // 묶음 머리가 전부 `내일`이라 목록이 통째로 경고판이 된다(§9.2).
    expect(screen.container.querySelectorAll('.text-destructive, .text-pushed').length).toBe(0);
    // 급함은 색이 아니라 글자가 말한다. 색 이외의 신호가 늘 함께 있어야 한다(§11).
    expect(screen.container.textContent).toContain('내일');
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
      // 게시 종류가 재입찰인 행이다. 일반공고(97%)와 미관측에는 아무것도 적지 않는다(EAT-262).
      '제목 미관측제한지역 미관측재입찰'
    ]);
    expect(screen.queryAllByRole('link', { name: '창원시' }).length).toBe(0);
    expect(screen.container.textContent).not.toContain('코드 ');
    expect(screen.getAllByRole('button', { name: '공고번호 복사 2026-0001' }).length).toBe(2);
  });


  test('재입찰과 변경공고만 행에 적고 일반공고와 미관측에는 적지 않는다', () => {
    const screen = renderCards();
    // 재입찰이면 이 판은 한 번 유찰되고 다시 열린 판이라 셋째 줄의 `지난번`을 다르게 읽는다(EAT-262).
    expect(screen.getAllByText('재입찰').length).toBe(1);
    // 나머지 셋은 미관측(eat-v5 전 해석)이라 아무 말도 하지 않는다 — 미관측을 일반공고로 접지 않는다(AGENTS 3).
    expect(screen.queryAllByText('변경공고').length).toBe(0);
    expect(screen.container.textContent).not.toContain('일반공고');
    // 급한 일이 아니라 사실이라 색이 아니라 굵기다(screen-system §9.2).
    expect(screen.container.querySelectorAll('[data-slot="auction-row"] .text-destructive').length).toBe(0);
  });

  test('단독입찰을 허용하지 않는 판만 0곳 옆에 그 뜻을 적는다', () => {
    const screen = renderCards();
    // 같은 0곳이라도 허용안함이면 혼자 들어가면 유찰이라 기회가 아니다(EAT-249). 허용 여부를 못 본 판에는
    // 적지 않는다 — 모르는 것을 아는 척하지 않는다(AGENTS 3).
    expect(screen.getAllByText('(혼자면 유찰)').length).toBe(1);
    const rows = [...screen.container.querySelectorAll('[data-slot="auction-row"] > div:first-child > p:last-child')];
    expect(rows[2]!.textContent).toBe('아직 0곳');
    expect(rows[3]!.textContent).toBe('아직 0곳 (혼자면 유찰)');
  });

  test('셋째 줄은 지금·지난번·보통이고 참여 0은 아직 0곳이며 보통에는 표본 수가 붙는다', () => {
    const screen = renderCards();
    const lines = [...screen.container.querySelectorAll('[data-slot="auction-row"] > div:first-child > p:last-child')].map((node) => node.textContent);
    expect(lines).toEqual([
      '지금 5곳·지난번 17곳 (09-02)·보통 5곳 12회 기준',
      '참여 미관측·지난번 개찰 회차 없음·보통 — 0회 기준',
      '아직 0곳',
      '아직 0곳 (혼자면 유찰)'
    ]);
  });

  test('오른쪽은 금액과 하한이고 관측하지 못한 값은 미확인이다', () => {
    const screen = renderCards();
    const values = [...screen.container.querySelectorAll('[data-slot="auction-row"] > div:last-child')].map((node) => node.textContent);
    expect(values).toEqual(['2,761,700원하한 90%', '43,879,200원하한 90%', '미확인하한 미확인', '미확인하한 미확인']);
  });
});
