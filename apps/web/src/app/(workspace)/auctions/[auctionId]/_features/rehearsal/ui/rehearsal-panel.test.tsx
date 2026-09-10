import { describe, expect, test } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';

import { attemptsFixture } from '@/app/(workspace)/auctions/[auctionId]/__fixtures__/attempts';
import { fixtureNow, openAuctionFixture } from '@/app/(workspace)/auctions/[auctionId]/__fixtures__/auction';
import { createMemoryBidRecordPort } from '@/app/(workspace)/auctions/[auctionId]/_lib/bid-record-port';
import { attemptKeys, presentHistory } from '@/app/(workspace)/auctions/[auctionId]/_features/history/model/attempt-history';
import { presentDecision } from '@/app/(workspace)/auctions/[auctionId]/_lib/present-decision';
import { FORBIDDEN_VERDICT_WORDS } from '../model/verdict-vocabulary';
import { BidRail } from '@/app/(workspace)/auctions/[auctionId]/_widgets/bid-rail';
import { BidRateProvider } from '@/app/(workspace)/auctions/[auctionId]/_lib/bid-rate-context';
import { HistoryTable } from '@/app/(workspace)/auctions/[auctionId]/_features/history/ui/history-table';
import { AttemptSelectionProvider } from '@/app/(workspace)/auctions/[auctionId]/_lib/attempt-selection';
import { RehearsalPanel } from './rehearsal-panel';

const rows = presentHistory(attemptsFixture, null).rows;
const decision = presentDecision(openAuctionFixture, fixtureNow);

// initialRate는 사용자가 URL `rate`에 남긴 값을 흉내 낸다. 화면 자체의 시작값은 없다(EAT-84).
function renderPanel(initialRate: string | null) {
  return render(
    <BidRateProvider initialRate={initialRate}>
      <RehearsalPanel rows={rows} />
    </BidRateProvider>
  );
}

describe('이 값이면 패널', () => {
  test('손잡이 값이 없으면 회차를 세지 않고 값 없음과 무엇을 하면 계산되는지만 말한다', () => {
    const screen = renderPanel(null);
    expect(screen.getByText('이 값이면')).toBeTruthy();
    expect(screen.getByText('값 없음')).toBeTruthy();
    expect(screen.getByText('투찰률을 넣으면 지난 회차와 견줍니다')).toBeTruthy();
    expect(screen.queryByText(/낙찰값 이하였을 회차/)).toBeNull();
    expect(screen.queryByText(/\d+회/)).toBeNull();
  });

  test('지난 회차 수와 낙찰값 이하였을 회차를 칸 스트립과 함께 보인다', () => {
    // 손잡이는 투찰률이라 비교 값도 투찰률 축이다. 예정가격을 모르는 5회차는 분모에서 빠진다.
    const screen = renderPanel('92.500');
    expect(screen.getByText('지난 15회 중 낙찰값 이하였을 회차')).toBeTruthy();
    expect(screen.getByText('10회')).toBeTruthy();
    expect(screen.getByText('지금 값을 그때 냈다면')).toBeTruthy();
  });

  test('그날 하한보다 낮았을 회차가 없으면 그 행을 아예 만들지 않는다', () => {
    const screen = renderPanel('92.500');
    expect(screen.queryByText('그날 하한보다 낮았을 회차')).toBeNull();
  });

  test('그날 하한을 밑도는 값이면 하한보다 낮았을 회차를 같은 분모와 함께 센다', () => {
    const screen = renderPanel('90.100');
    const row = screen.getByText('그날 하한보다 낮았을 회차').closest('div');
    expect(row?.textContent).toContain('7회');
    expect(row?.textContent).toContain('15회 중');
    expect(screen.getByText('8회')).toBeTruthy();
  });

  test('그날 하한 행의 부제는 하한이 관측이 아니라 계산한 값임을 밝힌다', () => {
    const screen = renderPanel('90.100');
    expect(screen.getByText('하한율 × 예정가로 계산')).toBeTruthy();
  });

  test('패널 어디에도 원본 판정 코드에 없는 판정어(무효·유효·실격 등)가 나오지 않는다', () => {
    // 하한 아래 행까지 그려지는 값이라 패널의 모든 문구가 한 번에 나온다.
    const screen = renderPanel('90.100');
    const markup = screen.container.textContent ?? '';
    for (const word of FORBIDDEN_VERDICT_WORDS) expect(markup).not.toContain(word);
  });

  test('회차가 칸으로 세기에 많으면 칸 대신 비율을 숫자로 함께 말한다', () => {
    // 칸 스트립 상한(24회)을 넘기려고 같은 회차를 두 벌로 늘린다. 낙찰값 이하·하한 아래 수는 그대로 두 배다.
    const many = [...rows, ...rows.map((row) => ({ ...row, attemptId: `${row.attemptId}-b` }))];
    const screen = render(
      <BidRateProvider initialRate='90.100'>
        <RehearsalPanel rows={many} />
      </BidRateProvider>
    );
    const won = screen.getByText('지난 30회 중 낙찰값 이하였을 회차').closest('div');
    expect(won?.textContent).toContain('16회');
    expect(won?.textContent).toContain('53%');
  });

  test('낙찰값 바로 위 0.1 안에 행은 낙찰값 이하 회차를 분모로 투찰률 축에서 센다', () => {
    const screen = renderPanel('92.700');
    const row = screen.getByText('낙찰값 바로 위 0.1 안에').closest('div');
    expect(row?.textContent).toContain('6회');
    expect(row?.textContent).toContain('9회 중');
    expect(screen.getByText('낙찰값 이하 중 0.1%p 안')).toBeTruthy();
  });

  test('손잡이 값이 없으면 낙찰값 바로 위 0.1 안에 행도 세지 않는다', () => {
    const screen = renderPanel(null);
    expect(screen.queryByText('낙찰값 바로 위 0.1 안에')).toBeNull();
    expect(screen.getByText('값 없음')).toBeTruthy();
  });

  test('이 학교와 내 기록 더 보기는 손잡이 값이 없어도 접힌 채 있고, 펼치면 기관 요약과 빈 내 기록 슬롯이 보인다', () => {
    const screen = renderPanel(null);
    const toggle = screen.getByRole('button', { name: '이 학교와 내 기록 더 보기' }) as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    // 접힌 동안은 세어 놓은 숫자가 DOM에도 없어야 "값 없음" 레일이 정말 비어 있다.
    expect(screen.queryByText('누적 회차')).toBeNull();

    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: '접기' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('누적 회차').closest('div')?.textContent).toContain('20회');
    // 최근 낙찰은 사정률이라 축 이름을 함께 적는다. 손잡이(투찰률)와 바로 견주면 안 된다(PDR-0004).
    const latest = screen.getByText('최근 낙찰').closest('div');
    expect(latest?.textContent).toContain('90.126');
    expect(latest?.textContent).toContain('사정률');
    expect(latest?.textContent).toContain('26-08-10 개찰');
    expect(screen.getByText('발주 주기').closest('div')?.textContent).toContain('보통 30일');
    expect(screen.getByText('내 기록')).toBeTruthy();
    expect(screen.getByText('사업자 인증 뒤에 붙습니다')).toBeTruthy();
    expect(screen.getByText('기록 없음')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '접기' }));
    expect(screen.getByRole('button', { name: '이 학교와 내 기록 더 보기' })).toBeTruthy();
  });

  test('회차가 없으면 기관 요약도 숫자를 지어내지 않고 기록 없음으로 둔다', () => {
    const screen = render(
      <BidRateProvider initialRate={null}>
        <RehearsalPanel rows={[]} />
      </BidRateProvider>
    );
    fireEvent.click(screen.getByRole('button', { name: '이 학교와 내 기록 더 보기' }));
    expect(screen.getByText('누적 회차').closest('div')?.textContent).toContain('0회');
    expect(screen.getByText('최근 낙찰').closest('div')?.textContent).toContain('기록 없음');
    expect(screen.getByText('발주 주기').closest('div')?.textContent).toContain('기록 없음');
  });

  test('비교할 회차가 없으면 숫자를 지어내지 않고 없다고 말한다', () => {
    const screen = render(
      <BidRateProvider initialRate='90.000'>
        <RehearsalPanel rows={[]} />
      </BidRateProvider>
    );
    expect(screen.getByText('비교할 회차가 없습니다')).toBeTruthy();
  });

  test('레일 손잡이를 누르면 표 마지막 열 머리와 패널 값이 같은 값으로 함께 바뀐다', () => {
    // 92.7606과 92.7617 사이라 0.001 한 칸이 낙찰 회차 하나를 실제로 가른다.
    const screen = render(
      <BidRateProvider initialRate='92.760'>
        <BidRail decision={decision} port={createMemoryBidRecordPort()} rehearsal={<RehearsalPanel rows={rows} />} />
        <AttemptSelectionProvider attempts={attemptKeys(rows)}><HistoryTable rows={rows} /></AttemptSelectionProvider>
      </BidRateProvider>
    );
    expect(screen.getByText('92.760 썼다면')).toBeTruthy();
    expect(screen.getByText('5회')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '투찰률 0.001 올리기' }));

    expect(screen.getByText('92.761 썼다면')).toBeTruthy();
    expect(screen.getByText('4회')).toBeTruthy();
  });
});
