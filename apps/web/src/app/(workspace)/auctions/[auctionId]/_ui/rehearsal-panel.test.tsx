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
    const screen = renderPanel('90.345');
    expect(screen.getByText('지난 20회 중 낙찰됐을 회차')).toBeTruthy();
    expect(screen.getByText('6회')).toBeTruthy();
    expect(screen.getByText('지금 값을 그때 냈다면')).toBeTruthy();
  });

  test('무효였을 회차가 없으면 무효 행을 아예 만들지 않는다', () => {
    const screen = renderPanel('90.345');
    expect(screen.queryByText('그날 하한보다 낮아 무효였을 회차')).toBeNull();
  });

  test('그날 하한을 밑도는 값이면 무효였을 회차를 따로 센다', () => {
    const screen = renderPanel('90.100');
    expect(screen.getByText('그날 하한보다 낮아 무효였을 회차')).toBeTruthy();
    expect(screen.getByText('7회')).toBeTruthy();
    expect(screen.getByText('9회')).toBeTruthy();
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
    const screen = render(
      <BidRateProvider initialRate='90.345'>
        <BidRail decision={decision} port={createMemoryBidRecordPort()} rehearsal={<RehearsalPanel rows={rows} />} />
        <HistoryTable rows={rows} />
      </BidRateProvider>
    );
    expect(screen.getByText('90.345 썼다면')).toBeTruthy();
    expect(screen.getByText('6회')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '투찰률 0.001 올리기' }));

    expect(screen.getByText('90.346 썼다면')).toBeTruthy();
    expect(screen.getByText('5회')).toBeTruthy();
  });
});
