import { describe, expect, test } from 'bun:test';
import { fireEvent, render as renderUI } from '@testing-library/react';
import type { ReactNode } from 'react';
import { WorkspaceDockFixture } from '../__fixtures__/workspace-dock';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuctionRosterV1Response } from '@eatbid/contracts/api/v1/auctions';
import { auctionQueries } from '@/api/auctions';
import { attemptsFixture } from '../__fixtures__/attempts';
import { attemptKeys, presentHistory } from '../_model/attempt-history';
import { BidRateProvider } from './bid-rate-context';
import { HistoryTable } from './history-table';
import { AuctionRosterPanel } from './auction-roster-panel';
import { AuctionWorkspaceDock } from './auction-workspace-dock';
import { DecisionScreen } from './decision-screen';
import { fixtureNow, openAuctionFixture } from '../__fixtures__/auction';
import { presentDecision } from '../_model/present-decision';
import type { DecisionSearch } from '../_lib/decision-search-params';
import { AttemptSelectionProvider } from './attempt-selection';

const render = (ui: ReactNode) => renderUI(ui, { wrapper: WorkspaceDockFixture });

const rows = presentHistory(attemptsFixture, null).rows;
const selected = rows[0]!;
const selectedKey = attemptKeys([selected])[0]!;
// fixture 행의 revision 규칙(`<attemptId>1`)과 같아야 표 행이 고른 revision의 명단으로 조회된다.
function payload(auctionId: string): AuctionRosterV1Response {
  return {
    auctionId,
    revisionId: `${auctionId}1`,
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
  client.setQueryData(auctionQueries.roster(data.auctionId, data.revisionId).queryKey, data);
  return client;
}
describe('회차 명단 상세', () => {
  test('행의 revision이 없으면 최신 명단으로 추정하지 않고 확인 불가를 말한다', () => {
    const screen = render(
      <QueryClientProvider client={clientWith(payload(selected.attemptId))}>
        <AuctionRosterPanel attempt={{ ...selectedKey, revisionId: null }} onClose={() => undefined} />
      </QueryClientProvider>
    );
    expect(screen.getByRole('alert').textContent).toContain('회차 해석을 확인하지 못해');
    expect(screen.queryByText('검증 업체', { exact: false })).toBeNull();
  });

  test('행이 고른 revision의 명단을 조회하고 최신 revision 항목은 읽지 않는다', () => {
    const client = clientWith(payload(selected.attemptId));
    // 같은 회차의 다른(최신) 해석이 캐시에 있어도 행이 고른 revision과 다르면 읽지 않는다.
    const latest = { ...payload(selected.attemptId), revisionId: '99' };
    latest.rows[0]!.supplier.name = '최신 해석 업체';
    client.setQueryData(auctionQueries.roster(selected.attemptId, '99').queryKey, latest);
    const screen = render(
      <QueryClientProvider client={client}>
        <AuctionRosterPanel attempt={selectedKey} onClose={() => undefined} />
      </QueryClientProvider>
    );
    expect(screen.getByText('검증 업체', { exact: false })).toBeTruthy();
    expect(screen.queryByText('최신 해석 업체', { exact: false })).toBeNull();
  });

  test('조회에서 제외한 회차는 닫고 조건을 되돌려도 지난 선택을 다시 열지 않는다', () => {
    const client = clientWith(payload(selected.attemptId));
    function Workspace({ currentRows }: { currentRows: typeof rows }) {
      return (
        <QueryClientProvider client={client}>
          <BidRateProvider initialRate={null}>
            <AttemptSelectionProvider attempts={attemptKeys(currentRows)}>
              <HistoryTable rows={currentRows} />
              <AuctionWorkspaceDock fallback={<p>현재 공고 본문</p>} />
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
    client.setQueryData(auctionQueries.roster(second.attemptId, next.revisionId).queryKey, next);
    const screen = render(
      <QueryClientProvider client={client}>
        <BidRateProvider initialRate={null}>
          <AttemptSelectionProvider attempts={attemptKeys(rows)}>
            <HistoryTable rows={rows} />
            <AuctionWorkspaceDock fallback={null} />
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
    expect(screen.getByLabelText('투찰률 눌러서 직접 입력')).toBeTruthy();
  });
  test('두 번째 페이지 회차도 기록을 열고 확대를 닫아도 그 선택과 누적 페이지를 유지한다', () => {
    // 첫 페이지만 선택 provider에 주면 두 번째 페이지 회차가 "조회 밖"으로 판정돼 고르는 즉시 풀린다(EAT-115).
    const presentation = presentHistory(attemptsFixture, null);
    const secondPageId = `1${rows[0]!.attemptId}`;
    const merged = presentHistory(
      {
        ...attemptsFixture,
        attempts: [
          ...attemptsFixture.attempts,
          // 두 번째 페이지 회차도 자기 revision을 갖는다. 규칙은 payload와 같은 `<attemptId>1`이다.
          ...attemptsFixture.attempts.map((attempt) => ({ ...attempt, attemptId: `1${attempt.attemptId}`, revisionId: `1${attempt.attemptId}1` }))
        ],
        nextCursor: null
      },
      null
    );
    const client = clientWith(payload(secondPageId));
    const search: DecisionSearch = {
      period: '12개월',
      scope: '전국',
      view: '흐름',
      item: null,
      myRate: null,
      rate: null,
      expand: '과거 회차',
      pages: 2
    };
    function Screen({ current }: { current: DecisionSearch }) {
      return (
        <QueryClientProvider client={client}>
          <DecisionScreen
            decision={presentDecision(openAuctionFixture, fixtureNow)}
            search={current}
            history={{ state: 'ready', presentation, expanded: { presentation: merged, loadFailed: false } }}
            distribution={{ state: 'locked', reason: 'missing-terms' }}
          />
        </QueryClientProvider>
      );
    }
    const screen = render(<Screen current={search} />);
    const table = screen.getByRole('region', { name: '과거 회차' });
    const buttons = screen.getAllByRole('button', { name: /회차 참여 기록 보기/ });
    expect(buttons.length).toBe(merged.rows.length);

    fireEvent.click(buttons[presentation.rows.length]!);

    const panel = screen.getByRole('region', { name: '선택 회차 참여 기록' });
    expect(panel.textContent).toContain('검증 업체');
    const selectedRows = [...table.querySelectorAll('tbody tr[data-selected]')];
    expect(selectedRows).toHaveLength(1);
    expect(selectedRows[0]).toBe([...table.querySelectorAll('tbody tr')][presentation.rows.length]!);

    // 확대를 닫아도 오른쪽 기록과 누적 표본이 남고 현재 공고 제목은 바뀌지 않는다. 좁은 화면 Sheet가
    // 열려 있는 동안 뒤 본문은 접근성 트리에서 감춰지므로 표는 role이 아니라 같은 노드로 확인한다.
    screen.rerender(<Screen current={{ ...search, expand: null }} />);
    expect(screen.getByRole('region', { name: '선택 회차 참여 기록' }).textContent).toContain('검증 업체');
    expect(screen.container.querySelector('#decision-title')?.textContent).toBe(
      openAuctionFixture.identity.title
    );
    expect(table.querySelectorAll('tbody tr')).toHaveLength(12);
    expect(table.querySelectorAll('tbody tr[data-selected]')).toHaveLength(0);
  });

  test('필터가 선택 회차를 조회에서 빼면 오른쪽 기록도 함께 닫힌다', () => {
    const presentation = presentHistory(attemptsFixture, null);
    const client = clientWith(payload(selected.attemptId));
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
    const narrowed = {
      ...presentation,
      rows: presentation.rows.filter((row) => row.attemptId !== selected.attemptId)
    };
    function Screen({ current }: { current: typeof presentation }) {
      return (
        <QueryClientProvider client={client}>
          <DecisionScreen
            decision={presentDecision(openAuctionFixture, fixtureNow)}
            search={search}
            history={{ state: 'ready', presentation: current, expanded: { presentation: current, loadFailed: false } }}
            distribution={{ state: 'locked', reason: 'missing-terms' }}
          />
        </QueryClientProvider>
      );
    }
    const screen = render(<Screen current={presentation} />);
    fireEvent.click(screen.getAllByRole('button', { name: /회차 참여 기록 보기/ })[0]!);
    expect(screen.getByRole('region', { name: '선택 회차 참여 기록' })).toBeTruthy();

    screen.rerender(<Screen current={narrowed} />);

    expect(screen.queryByRole('region', { name: '선택 회차 참여 기록' })).toBeNull();
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
        <AuctionRosterPanel attempt={selectedKey} onClose={() => undefined} />
      </QueryClientProvider>
    );
    expect(screen.getByText('낙찰실패')).toBeTruthy();
    expect(screen.getByText('철회')).toBeTruthy();
    // 값만으로는 어느 항목인지 모른다. 맨 span의 aria-label은 무시되므로 이름을 sr-only 문구로 싣는다.
    const label = screen.getByText('철회 여부');
    expect(label.className).toContain('sr-only');
    expect(label.nextElementSibling?.textContent).toBe('철회');
  });
  test('원천 계산용 자리표시자를 제출금액으로 보여주지 않고 관측 제출금액과 세 자리 비율을 보존한다', () => {
    const screen = render(
      <QueryClientProvider client={clientWith(payload(selected.attemptId))}>
        <AuctionRosterPanel attempt={selectedKey} onClose={() => undefined} />
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
        <AuctionRosterPanel attempt={selectedKey} onClose={() => undefined} />
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
          <AttemptSelectionProvider attempts={attemptKeys(rows)}>
            <HistoryTable rows={rows} />
            <AuctionWorkspaceDock fallback={null} />
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
