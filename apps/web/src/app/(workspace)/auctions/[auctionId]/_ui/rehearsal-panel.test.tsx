import { describe, expect, test } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';

import { attemptsFixture } from '../__fixtures__/attempts';
import { fixtureNow, openAuctionFixture } from '../__fixtures__/auction';
import { createMemoryBidRecordPort } from '../_lib/bid-record-port';
import { presentHistory } from '../_model/attempt-history';
import { presentDecision } from '../_model/present-decision';
import { BidRail } from './bid-rail';
import { BidRateProvider } from './bid-rate-context';
import { HistoryTable } from './history-table';
import { RehearsalPanel } from './rehearsal-panel';

const rows = presentHistory(attemptsFixture, null).rows;
const decision = presentDecision(openAuctionFixture, fixtureNow);

function renderPanel(initialRate: string) {
  return render(
    <BidRateProvider initialRate={initialRate}>
      <RehearsalPanel rows={rows} />
    </BidRateProvider>
  );
}

describe('이 값이면 패널', () => {
  test('지난 회차 수와 낙찰됐을 회차를 칸 스트립과 함께 보인다', () => {
    // 손잡이는 투찰률이라 판정 값도 투찰률 축이다. 예정가격을 모르는 5회차는 분모에서 빠진다.
    const screen = renderPanel('92.500');
    expect(screen.getByText('지난 15회 중 낙찰됐을 회차')).toBeTruthy();
    expect(screen.getByText('10회')).toBeTruthy();
    expect(screen.getByText('지금 값을 그때 냈다면')).toBeTruthy();
  });

  test('무효였을 회차가 없으면 무효 행을 아예 만들지 않는다', () => {
    const screen = renderPanel('92.500');
    expect(screen.queryByText('그날 하한보다 낮아 무효였을 회차')).toBeNull();
  });

  test('그날 하한을 밑도는 값이면 무효였을 회차를 같은 분모와 함께 센다', () => {
    const screen = renderPanel('90.100');
    const row = screen.getByText('그날 하한보다 낮아 무효였을 회차').closest('div');
    expect(row?.textContent).toContain('7회');
    expect(row?.textContent).toContain('15회 중');
    expect(screen.getByText('8회')).toBeTruthy();
  });

  test('회차가 칸으로 세기에 많으면 칸 대신 비율을 숫자로 함께 말한다', () => {
    // 칸 스트립 상한(24회)을 넘기려고 같은 회차를 두 벌로 늘린다. 낙찰·무효 판정은 그대로 두 배다.
    const many = [...rows, ...rows.map((row) => ({ ...row, attemptId: `${row.attemptId}-b` }))];
    const screen = render(
      <BidRateProvider initialRate='90.100'>
        <RehearsalPanel rows={many} />
      </BidRateProvider>
    );
    const won = screen.getByText('지난 30회 중 낙찰됐을 회차').closest('div');
    expect(won?.textContent).toContain('16회');
    expect(won?.textContent).toContain('53%');
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
        <HistoryTable rows={rows} />
      </BidRateProvider>
    );
    expect(screen.getByText('92.760 썼다면')).toBeTruthy();
    expect(screen.getByText('5회')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '투찰률 0.001 올리기' }));

    expect(screen.getByText('92.761 썼다면')).toBeTruthy();
    expect(screen.getByText('4회')).toBeTruthy();
  });
});
