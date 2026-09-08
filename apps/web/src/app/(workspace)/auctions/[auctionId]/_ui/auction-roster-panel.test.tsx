import { describe, expect, test } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuctionRosterV1Response } from '@eatbid/contracts/api/v1/auctions';
import { auctionQueries } from '@/api/auctions';
import { attemptsFixture } from '../__fixtures__/attempts';
import { presentHistory } from '../_model/attempt-history';
import { BidRateProvider } from './bid-rate-context';
import { HistoryTable } from './history-table';
import { AuctionRosterPanel, SelectedAttemptRail } from './auction-roster-panel';
import { DecisionScreen } from './decision-screen';
import { fixtureNow, openAuctionFixture } from '../__fixtures__/auction';
import { presentDecision } from '../_model/present-decision';
import type { DecisionSearch } from '../_lib/decision-search-params';
import { AttemptSelectionProvider } from './attempt-selection';

const rows = presentHistory(attemptsFixture, null).rows;
const selected = rows[0]!;
function payload(auctionId: string): AuctionRosterV1Response {
  return {
    auctionId,
    revisionId: '99',
    state: 'observed',
    rows: [
      {
        submissionId: '9007199254740993',
        rosterOrdinal: 0,
        supplier: { supplierPartyId: '1', sourceSupplierAccountId: '2', name: '검증 업체' },
        sourceCalculatedAmount: { amount: '10000000043768.00', currency: 'KRW' },
        submittedAmount: { amount: '43120180.00', currency: 'KRW' },
        bidRate: { value: '87.910', unit: 'percentage-points' },
        rank: 14,
        submittedAt: null,
        sourceStatus: {
          codeValueId: '3',
          code: '005',
          scheme: 'eat:bid-status',
          label: '낙찰실패'
        },
        withdrawal: null
      }
    ],
    award: null,
    meta: {
      rowCount: 1,
      sourceRosterSize: 2,
      observedAt: '2026-09-06T17:18:17Z',
      provenance: {
        sourceSystem: 'eat',
        observationId: '4',
        normalizedRecordId: '5',
        contentSha256: 'a'.repeat(64)
      }
    }
  };
}
function clientWith(data: AuctionRosterV1Response) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } }
  });
  client.setQueryData(auctionQueries.roster(data.auctionId).queryKey, data);
  return client;
}
describe('회차 명단 상세', () => {
  test('조회에서 제외한 회차는 닫고 조건을 되돌려도 지난 선택을 다시 열지 않는다', () => {
    const client = clientWith(payload(selected.attemptId));
    function Workspace({ currentRows }: { currentRows: typeof rows }) {
      return (
        <QueryClientProvider client={client}>
          <BidRateProvider initialRate={null}>
            <AttemptSelectionProvider rows={currentRows}>
              <HistoryTable rows={currentRows} />
              <SelectedAttemptRail fallback={<p>현재 공고 본문</p>} />
            </AttemptSelectionProvider>
          </BidRateProvider>
        </QueryClientProvider>
      );
    }
    const screen = render(<Workspace currentRows={rows} />);
    fireEvent.click(screen.getAllByRole('button', { name: /회차 참여 기록 보기/ })[0]!);
    expect(screen.getByRole('region', { name: '선택 회차 참여 기록' })).toBeTruthy();
    screen.rerender(
      <Workspace currentRows={rows.filter((row) => row.attemptId !== selected.attemptId)} />
    );
    expect(screen.queryByRole('region', { name: '선택 회차 참여 기록' })).toBeNull();
    expect(screen.getByText('현재 공고 본문')).toBeTruthy();
    screen.rerender(<Workspace currentRows={rows} />);
    expect(screen.queryByRole('region', { name: '선택 회차 참여 기록' })).toBeNull();
  });

  test('다른 회차의 명단을 선택하면 이전 업체를 남기지 않고 Escape로 원래 버튼에 돌아간다', () => {
    const second = rows[1]!;
    const client = clientWith(payload(selected.attemptId));
    const next = payload(second.attemptId);
    next.rows[0]!.supplier.name = '다음 회차 업체';
    client.setQueryData(auctionQueries.roster(second.attemptId).queryKey, next);
    const screen = render(
      <QueryClientProvider client={client}>
        <BidRateProvider initialRate={null}>
          <AttemptSelectionProvider rows={rows}>
            <HistoryTable rows={rows} />
            <SelectedAttemptRail fallback={null} />
          </AttemptSelectionProvider>
        </BidRateProvider>
      </QueryClientProvider>
    );
    const buttons = screen.getAllByRole('button', { name: /회차 참여 기록 보기/ });
    buttons[0]!.focus();
    fireEvent.click(buttons[0]!);
    expect(screen.getByText('검증 업체', { exact: false })).toBeTruthy();
    buttons[1]!.focus();
    fireEvent.click(buttons[1]!);
    expect(screen.queryByText('검증 업체', { exact: false })).toBeNull();
    expect(screen.getByText('다음 회차 업체', { exact: false })).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('region', { name: '선택 회차 참여 기록' }), {
      key: 'Escape'
    });
    expect(screen.queryByRole('region', { name: '선택 회차 참여 기록' })).toBeNull();
    expect(document.activeElement).toBe(buttons[1]);
  });

  test('실제 화면은 과거 표와 현재 공고를 유지하고 선택 회차를 오른쪽에 연다', () => {
    const client = clientWith(payload(selected.attemptId));
    const presentation = presentHistory(attemptsFixture, null);
    const search: DecisionSearch = {
      period: '12개월',
      scope: '전국',
      view: '흐름',
      item: null,
      myRate: null,
      rate: null,
      expand: null,
      pages: 1
    };
    const screen = render(
      <QueryClientProvider client={client}>
        <DecisionScreen
          decision={presentDecision(openAuctionFixture, fixtureNow)}
          search={search}
          history={{ state: 'ready', presentation, expanded: { presentation, loadFailed: false } }}
          distribution={{ state: 'locked', reason: 'missing-terms' }}
        />
      </QueryClientProvider>
    );
    const title = screen.container.querySelector('#decision-title')?.textContent;
    const table = screen.getByRole('region', { name: '과거 회차' });
    const beforeRows = table.querySelectorAll('tbody tr').length;
    fireEvent.click(screen.getAllByRole('button', { name: /회차 참여 기록 보기/ })[0]!);
    const panel = screen.getByRole('region', { name: '선택 회차 참여 기록' });
    expect(screen.getByRole('dialog').contains(panel)).toBe(true);
    expect(panel.textContent).toContain('검증 업체');
    expect(table.querySelectorAll('tbody tr').length).toBe(beforeRows);
    expect(screen.container.querySelector('#decision-title')?.textContent).toBe(title);
    fireEvent.click(screen.getByRole('button', { name: '보조 패널 닫기' }));
    expect(screen.queryByRole('region', { name: '선택 회차 참여 기록' })).toBeNull();
    expect(screen.getByLabelText('투찰률')).toBeTruthy();
  });
  test('원천 낙찰 상태를 유지하면서 철회 관측을 별도로 보여준다', () => {
    const data = payload(selected.attemptId);
    data.rows[0]!.withdrawal = {
      codeValueId: '6',
      code: 'Y',
      scheme: 'eat:withdrawal-flag',
      label: null
    };
    const screen = render(
      <QueryClientProvider client={clientWith(data)}>
        <AuctionRosterPanel row={selected} onClose={() => undefined} />
      </QueryClientProvider>
    );
    expect(screen.getByText('낙찰실패')).toBeTruthy();
    expect(screen.getByText('철회')).toBeTruthy();
  });
  test('원천 계산용 자리표시자를 제출금액으로 보여주지 않고 관측 제출금액과 세 자리 비율을 보존한다', () => {
    const screen = render(
      <QueryClientProvider client={clientWith(payload(selected.attemptId))}>
        <AuctionRosterPanel row={selected} onClose={() => undefined} />
      </QueryClientProvider>
    );
    expect(screen.getByText('43,120,180 원')).toBeTruthy();
    expect(screen.getByText('87.910')).toBeTruthy();
    expect(screen.container.textContent).not.toContain('10,000,000,043,768');
  });
  test('제출금액이 없으면 계산용 원천 값으로 채우지 않는다', () => {
    const data = payload(selected.attemptId);
    data.rows[0]!.submittedAmount = null;
    const screen = render(
      <QueryClientProvider client={clientWith(data)}>
        <AuctionRosterPanel row={selected} onClose={() => undefined} />
      </QueryClientProvider>
    );
    expect(screen.getAllByText('미확인')).toHaveLength(2);
    expect(screen.queryByText('철회 아님')).toBeNull();
    expect(screen.container.textContent).not.toContain('10,000,000,043,768');
  });
  test('참여 수를 누른 회차의 명단만 열고 닫을 수 있다', () => {
    const screen = render(
      <QueryClientProvider client={clientWith(payload(selected.attemptId))}>
        <BidRateProvider initialRate={null}>
          <AttemptSelectionProvider rows={rows}>
            <HistoryTable rows={rows} />
            <SelectedAttemptRail fallback={null} />
          </AttemptSelectionProvider>
        </BidRateProvider>
      </QueryClientProvider>
    );
    expect(screen.queryByRole('region', { name: '선택 회차 참여 기록' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /회차 참여 기록 보기/ })[0]!);
    expect(screen.getByRole('region', { name: '선택 회차 참여 기록' }).textContent).toContain(
      '검증 업체'
    );
    fireEvent.click(screen.getByRole('button', { name: '보조 패널 닫기' }));
    expect(screen.queryByRole('region', { name: '선택 회차 참여 기록' })).toBeNull();
  });
});
