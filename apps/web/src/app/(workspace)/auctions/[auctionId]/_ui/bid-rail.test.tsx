import { describe, expect, test } from 'bun:test';
import { fireEvent, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { fixtureNow, openAuctionFixture } from '../__fixtures__/auction';
import { createMemoryBidRecordPort } from '../_lib/bid-record-port';
import { presentDecision } from '../_model/present-decision';
import { BidRail } from './bid-rail';

const decision = presentDecision(openAuctionFixture, fixtureNow);

describe('투찰 rail', () => {
  test('손잡이를 누르면 투찰률과 넣을 금액이 같이 바뀐다', () => {
    const screen = render(<BidRail decision={decision} port={createMemoryBidRecordPort()} initialRate='90.309' />);
    expect(screen.getByText('2,494,063')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+0.001' }));
    expect(screen.getByDisplayValue('90.310')).toBeTruthy();
    expect(screen.getByText('2,494,091')).toBeTruthy();
  });

  // happy-dom 환경에서 fireEvent.change는 React onChange를 트리거하지 않는다(네이티브 값 추적기가
  // 우회됨). 이 저장소의 다른 텍스트 입력 테스트(command-palette.test.tsx)와 같은 방식으로
  // userEvent.type을 쓴다. 또한 같은 input에 clear+type을 두 번 연달아 실행하면 이 조합의 React
  // 19 + happy-dom 이벤트 시스템이 내부 오류(getInstIfValueChanged)를 내며 두 번째 이후 상태 갱신이
  // 끊긴다. 렌더를 새로 해 시나리오별로 분리해 그 상호작용을 피한다.
  test('직접 입력한 값은 셋째 자리로 고정된다', async () => {
    const user = userEvent.setup();
    const screen = render(<BidRail decision={decision} port={createMemoryBidRecordPort()} initialRate='90.309' />);
    const input = screen.getByLabelText('투찰률');
    await user.clear(input);
    await user.type(input, '90.3');
    fireEvent.blur(input);
    expect(screen.getByDisplayValue('90.300')).toBeTruthy();
  });

  test('잘못된 값을 입력하면 이전 값을 지킨다', async () => {
    const user = userEvent.setup();
    const screen = render(<BidRail decision={decision} port={createMemoryBidRecordPort()} initialRate='90.309' />);
    const input = screen.getByLabelText('투찰률');
    await user.clear(input);
    await user.type(input, '엉뚱');
    fireEvent.blur(input);
    expect(screen.getByDisplayValue('90.309')).toBeTruthy();
  });

  test('내 값 기록을 누르면 port에 저장되고 상태 줄이 값으로 바뀐다(시각은 서버 영속화 전까지 null)', async () => {
    const port = createMemoryBidRecordPort();
    const screen = render(<BidRail decision={decision} port={port} initialRate='90.309' />);
    expect(screen.getByText('아직 기록 없음')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '내 값 기록' }));
    await waitFor(() => expect(screen.getByText('90.309 기록됨')).toBeTruthy());
    const saved = await port.load(openAuctionFixture.identity.auctionId);
    expect(saved?.amount).toBe('2494063');
    expect(saved?.recordedAt).toBeNull();
  });

  test('개찰 완료면 손잡이와 기록 버튼 대신 복기 안내를 보인다', () => {
    const closed = presentDecision({ ...openAuctionFixture, schedule: { ...openAuctionFixture.schedule, deadlineAt: '2026-09-02T02:00:00Z', openedAt: '2026-09-02T05:00:00Z' } }, fixtureNow);
    const screen = render(<BidRail decision={closed} port={createMemoryBidRecordPort()} />);
    expect(screen.queryByRole('button', { name: '내 값 기록' })).toBeNull();
    expect(screen.getByText('개찰이 끝난 공고입니다')).toBeTruthy();
  });
});
