import { describe, expect, test } from 'bun:test';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
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

describe('기관·지역 비교조건 입력', () => {
  test('한쪽 명단 경계를 적용하면 DTO 전체를 한 번의 URL 전환으로 보낸다', async () => {
    const user = userEvent.setup();
    const updates: UrlUpdateEvent[] = [];
    const screen = render(
      <NuqsTestingAdapter hasMemory onUrlUpdate={(event) => updates.push(event)}>
        <AnalysisFilters setup={setup} applied={readAppliedAnalysis(null, setup)} />
      </NuqsTestingAdapter>
    );

    await user.type(screen.getByLabelText('명단 최소'), '24');
    expect(updates).toHaveLength(0);
    await act(async () => {
      fireEvent.submit(screen.getByRole('form', { name: '기관과 지역 비교조건' }));
    });
    await waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]!.options.shallow).toBe(false);
    const filter = JSON.parse(updates[0]!.searchParams.get('analysis')!);
    expect(filter.listCountRange).toEqual({ min: 24, max: null });
  });
  test('초안 수정은 조회하지 않고 잘못된 범위를 입력 옆에 설명한다', async () => {
    const user = userEvent.setup();
    const updates: UrlUpdateEvent[] = [];
    const screen = render(
      <NuqsTestingAdapter hasMemory onUrlUpdate={(event) => updates.push(event)}>
        <AnalysisFilters setup={setup} applied={readAppliedAnalysis(null, setup)} />
      </NuqsTestingAdapter>
    );

    await user.type(screen.getByLabelText('명단 최소'), '24');
    await user.type(screen.getByLabelText('명단 최대'), '12');
    expect(updates).toHaveLength(0);
    fireEvent.submit(screen.getByRole('form', { name: '기관과 지역 비교조건' }));
    expect(screen.getByLabelText('명단 최대').getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain('최소 이상');
    expect(updates).toHaveLength(0);
  });

  test('관측이 없는 전체 기간과 기관 품목은 준비 상태를 설명한다', () => {
    const screen = render(
      <NuqsTestingAdapter>
        <AnalysisFilters setup={setup} applied={readAppliedAnalysis(null, setup)} />
      </NuqsTestingAdapter>
    );

    expect(screen.getByRole('button', { name: '전 기간' }).hasAttribute('disabled')).toBe(true);
    expect(
      screen.getByText('전 기간은 보유기간 확인 후 열려요. 기관 품목별 조회는 준비 중이에요.')
    ).toBeTruthy();
    expect(screen.getByLabelText('이 기관 품목').textContent).toBe('전체 품목');
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
