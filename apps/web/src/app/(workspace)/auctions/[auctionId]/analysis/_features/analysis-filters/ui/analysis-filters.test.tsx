import { describe, expect, test } from 'bun:test';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { render, waitFor } from '@testing-library/react';
import { NuqsTestingAdapter, type UrlUpdateEvent } from 'nuqs/adapters/testing';
import userEvent from '@testing-library/user-event';
import {
  fixtureNow,
  openAuctionFixture
} from '@/app/(workspace)/auctions/[auctionId]/__fixtures__/auction';
import { presentAnalysisFilters, readAppliedAnalysis } from '../model/present-analysis-filters';
import { AnalysisFilters } from './analysis-filters';
import { AnalysisResultsGate } from './analysis-results-gate';

const setup = presentAnalysisFilters(openAuctionFixture, fixtureNow);

/** 명단 범위는 여닫이 안에 있다. 칸을 만지려면 먼저 열어야 한다. */
async function openListCount(user: ReturnType<typeof userEvent.setup>, screen: ReturnType<typeof render>) {
  await user.click(screen.getByRole('button', { name: /^명단/ }));
}

/**
 * 조건 막대는 지역·기관·품목 건수를 조건 사전에서 읽는다. 그 조회는 이 시험의 관심사가 아니므로
 * 아예 끈다 — 건수가 아직 없는 상태도 화면이 서야 하는 정상 갈래이고, 여기서 확인하는 것은 조건을
 * 고르는 일이다. 사전이 실제로 무엇을 세는지는 서버 통합 시험이 본다.
 */
function withQueryClient(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('기관·지역 비교조건 입력', () => {
  test('목록에서 고른 값은 누르지 않아도 그 자리에서 조회된다', async () => {
    const user = userEvent.setup();
    const updates: UrlUpdateEvent[] = [];
    const screen = render(
      <NuqsTestingAdapter hasMemory onUrlUpdate={(event) => updates.push(event)}>
        {withQueryClient(<AnalysisFilters setup={setup} applied={readAppliedAnalysis(null, setup)} />)}
      </NuqsTestingAdapter>
    );

    await user.selectOptions(screen.getByLabelText('날짜 기준'), 'announced');
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]!.options.shallow).toBe(false);
    expect(JSON.parse(updates[0]!.searchParams.get('analysis')!).dateBasis).toBe('announced');
  });

  test('적어 넣는 칸은 다 적고 칸을 떠날 때 DTO 전체를 한 번에 보낸다', async () => {
    const user = userEvent.setup();
    const updates: UrlUpdateEvent[] = [];
    const screen = render(
      <NuqsTestingAdapter hasMemory onUrlUpdate={(event) => updates.push(event)}>
        {withQueryClient(<AnalysisFilters setup={setup} applied={readAppliedAnalysis(null, setup)} />)}
      </NuqsTestingAdapter>
    );

    await openListCount(user, screen);
    await user.type(screen.getByLabelText('명단 최소'), '24');
    // `2`까지 적은 시점에 보내면 서버에 두 번 묻고 표본 수가 두 번 흔들린다.
    expect(updates).toHaveLength(0);
    await user.tab();
    await waitFor(() => expect(updates).toHaveLength(1));
    const filter = JSON.parse(updates[0]!.searchParams.get('analysis')!);
    expect(filter.listCountRange).toEqual({ min: 24, max: null });
  });

  test('잘못된 범위는 조회하지 않고 입력 옆에 설명한다', async () => {
    const user = userEvent.setup();
    const updates: UrlUpdateEvent[] = [];
    const screen = render(
      <NuqsTestingAdapter hasMemory onUrlUpdate={(event) => updates.push(event)}>
        {withQueryClient(<AnalysisFilters setup={setup} applied={readAppliedAnalysis(null, setup)} />)}
      </NuqsTestingAdapter>
    );

    await openListCount(user, screen);
    await user.type(screen.getByLabelText('명단 최대'), '12');
    await user.type(screen.getByLabelText('명단 최소'), '24');
    await user.tab();
    await waitFor(() =>
      expect(screen.getByLabelText('명단 최대').getAttribute('aria-invalid')).toBe('true')
    );
    expect(screen.getByRole('alert').textContent).toContain('최소 이상');
    // 한쪽만 적힌 채로 보낸 적은 있어도, 서로 어긋난 범위로는 조회하지 않는다.
    expect(
      updates.some((update) => JSON.parse(update.searchParams.get('analysis')!).listCountRange.min === 24)
    ).toBe(false);
  });

  test('아직 고를 수 없는 전 기간은 조작 자체가 말하고 품목은 안 고른 상태가 전체다', () => {
    const screen = render(
      <NuqsTestingAdapter>
        {withQueryClient(<AnalysisFilters setup={setup} applied={readAppliedAnalysis(null, setup)} />)}
      </NuqsTestingAdapter>
    );

    const wholePeriod = screen.getByRole('button', { name: '전 기간' });
    expect(wholePeriod.hasAttribute('disabled')).toBe(true);
    expect(wholePeriod.getAttribute('title')).toBe('보유기간 확인 후 선택할 수 있어요');
    // 빈 칸이 "아무것도 안 나온다"로 읽히지 않도록 무엇을 보고 있는지 여닫이가 직접 말한다.
    // 라벨이 `공통`으로 시작하는 이유는 이 조건이 비교하는 집단 전부에 같게 걸리기 때문이다(PDR-0007).
    expect(screen.getByRole('combobox', { name: '공통 품목 전체' })).toBeTruthy();
  });

  test('새 조건이 URL에 반영된 뒤에는 늦은 이전 응답의 자료를 표시하지 않는다', () => {
    const screen = render(
      <NuqsTestingAdapter searchParams={{ analysis: 'new-filter' }}>
        <AnalysisResultsGate requestKey='old-filter'>
          <p>이전 차트의 999건</p>
        </AnalysisResultsGate>
      </NuqsTestingAdapter>
    );
    expect(screen.queryByText('이전 차트의 999건')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('비교조건을 적용하고 있어요.');
  });
});
