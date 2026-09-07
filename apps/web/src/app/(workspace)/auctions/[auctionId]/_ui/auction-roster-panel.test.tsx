import { describe, expect, test } from 'bun:test';
import { fireEvent, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuctionRosterV1Response } from '@eatbid/contracts/api/v1/auctions';
import { auctionQueries } from '@/api/auctions';
import { attemptsFixture } from '../__fixtures__/attempts';
import { presentHistory } from '../_model/attempt-history';
import { BidRateProvider } from './bid-rate-context';
import { HistoryTable } from './history-table';
import { AuctionRosterPanel } from './auction-roster-panel';

const rows = presentHistory(attemptsFixture, null).rows;
const selected = rows[0]!;
function payload(auctionId: string): AuctionRosterV1Response {
  return {
    auctionId, revisionId: '99', state: 'observed',
    rows: [{
      submissionId: '9007199254740993', rosterOrdinal: 0,
      supplier: { supplierPartyId: '1', sourceSupplierAccountId: '2', name: '검증 업체' },
      sourceCalculatedAmount: { amount: '10000000043768.00', currency: 'KRW' },
      submittedAmount: { amount: '43120180.00', currency: 'KRW' },
      bidRate: { value: '87.910', unit: 'percentage-points' }, rank: 14, submittedAt: null,
      sourceStatus: { codeValueId: '3', code: '005', scheme: 'eat:bid-status', label: '낙찰실패' },
      withdrawal: null,
    }],
    award: null,
    meta: {
      rowCount: 1, sourceRosterSize: 2, observedAt: '2026-09-06T17:18:17Z',
      provenance: { sourceSystem: 'eat', observationId: '4', normalizedRecordId: '5', contentSha256: 'a'.repeat(64) },
    },
  };
}
function clientWith(data: AuctionRosterV1Response) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(auctionQueries.roster(data.auctionId).queryKey, data);
  return client;
}
describe('회차 명단 상세', () => {
  test('원천 계산용 자리표시자를 제출금액으로 보여주지 않고 관측 제출금액과 세 자리 비율을 보존한다', () => {
    const screen = render(<QueryClientProvider client={clientWith(payload(selected.attemptId))}>
      <AuctionRosterPanel row={selected} onClose={() => undefined} />
    </QueryClientProvider>);
    expect(screen.getByText('43,120,180 원')).toBeTruthy();
    expect(screen.getByText('87.910')).toBeTruthy();
    expect(screen.container.textContent).not.toContain('10,000,000,043,768');
  });
  test('제출금액이 없으면 계산용 원천 값으로 채우지 않는다', () => {
    const data = payload(selected.attemptId);
    data.rows[0]!.submittedAmount = null;
    const screen = render(<QueryClientProvider client={clientWith(data)}>
      <AuctionRosterPanel row={selected} onClose={() => undefined} />
    </QueryClientProvider>);
    expect(screen.getByText('미확인')).toBeTruthy();
    expect(screen.container.textContent).not.toContain('10,000,000,043,768');
  });
  test('참여 수를 누른 회차의 명단만 열고 닫을 수 있다', () => {
    const screen = render(<QueryClientProvider client={clientWith(payload(selected.attemptId))}>
      <BidRateProvider initialRate={null}><HistoryTable rows={rows} /></BidRateProvider>
    </QueryClientProvider>);
    expect(screen.queryByRole('region', { name: '선택 회차 참여 기록' })).toBeNull();
    fireEvent.click(screen.getAllByRole('button', { name: /회차 참여 기록 보기/ })[0]!);
    expect(screen.getByRole('region', { name: '선택 회차 참여 기록' }).textContent).toContain('검증 업체');
    fireEvent.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('region', { name: '선택 회차 참여 기록' })).toBeNull();
  });
});
